import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Platform } from "@prisma/client";
import { decrypt, encrypt } from "@/lib/encrypt";
import { postToInstagram } from "@/lib/platforms/instagram";
import { postToLinkedIn } from "@/lib/platforms/linkedin";
import { postToYouTube } from "@/lib/platforms/youtube";
import { postToFacebook } from "@/lib/platforms/facebook";
import { postToTikTok } from "@/lib/platforms/tiktok";
import { getValidTikTokAccessToken } from "@/lib/platforms/tiktok-auth";
import { postToThreads, refreshThreadsToken } from "@/lib/platforms/threads";
import { preparePublishKeys } from "@/lib/publish-prep";

// This handler is now dispatch-only: it creates the PublishRecord rows and
// fans out to /api/internal/publish-record so every platform gets its own
// lambda invocation (and its own 300s budget). Previously all selected
// platforms ran concurrently inside this single lambda; when the slowest
// blew past 300s the lambda died and any other platform still uploading was
// left stuck in PROCESSING forever.
export const maxDuration = 60;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json();
  const { platforms, scheduledAt } = body as {
    platforms: Platform[];
    scheduledAt?: string;
  };

  if (!platforms?.length) {
    return NextResponse.json({ error: "Select at least one platform" }, { status: 400 });
  }

  const post = await prisma.post.findFirst({
    where: { id, userId: session.user.id },
    include: {
      media: { include: { audioTrack: { select: { storageKey: true } } } },
    },
  });

  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const scheduled = scheduledAt ? new Date(scheduledAt) : null;
  const records: Array<{ id: string; platform: Platform; status: string }> = [];

  for (const platform of platforms) {
    // Cancel any existing pending or stuck-processing record for this
    // post+platform. PROCESSING records get orphaned when a lambda dies
    // mid-flight; without clearing them here, re-publishing is blocked.
    await prisma.publishRecord.updateMany({
      where: { postId: id, platform, status: { in: ["PENDING", "PROCESSING"] } },
      data: { status: "CANCELLED" },
    });

    const record = await prisma.publishRecord.create({
      data: {
        postId: id,
        platform,
        status: "PENDING",
        scheduledAt: scheduled,
      },
    });
    records.push(record);
  }

  // Dispatch synchronously (no after()) so the network calls go out as part
  // of the request lifecycle, not in a post-response callback. Empirically
  // after() was leaving immediate posts in PENDING — the callback would not
  // reliably fire its fetches before the lambda exited. Each internal call
  // returns 202 in ~100ms after handing off to its OWN after() (in a fresh
  // lambda with a fresh 300s budget), so even 5 platforms in parallel finish
  // well inside the 60s budget here.
  if (!scheduled) {
    const baseUrl = new URL("/api/internal/publish-record", req.url);
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      console.error("CRON_SECRET missing — cannot dispatch publish");
    } else {
      await Promise.allSettled(
        records.map((r) =>
          fetch(baseUrl, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${cronSecret}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ recordId: r.id }),
            // Cap per-dispatch wall time so a single stuck network call
            // can't block the whole response. The cron's null-scheduledAt
            // safety net catches anything that misses.
            signal: AbortSignal.timeout(8000),
          }).catch((err) =>
            console.error("publish dispatch failed", { recordId: r.id, err }),
          ),
        ),
      );
    }
  }

  // Re-read so the response reflects PROCESSING (or whatever terminal state
  // the worker reached if it was fast) instead of stale PENDING — the UI
  // uses these statuses for its initial render.
  const fresh = await prisma.publishRecord.findMany({
    where: { id: { in: records.map((r) => r.id) } },
    select: { id: true, platform: true, status: true },
  });

  return NextResponse.json({ records: fresh });
}

// Hard self-deadline well under the worker lambda's 300 s budget. The cron
// reaper IS a safety net, but GitHub Actions cron under load runs roughly
// once an hour instead of every 5 minutes, so users see "Processing" for an
// hour before the reaper steps in. This timer is the primary mechanism for
// flipping orphaned PROCESSING rows to FAILED; the cron stays as a backstop
// for the case where this whole lambda is killed (OOM, host eviction) before
// the timer fires.
const PUBLISH_DEADLINE_MS = 270_000;

export async function publishNow(
  recordId: string,
  userId: string,
  post: {
    id: string;
    body: string;
    postType: string;
    media: {
      storageKey: string;
      mimeType: string;
      hasAudio?: boolean | null;
      audioTrack?: { storageKey: string } | null;
    }[];
  },
  platform: Platform
) {
  // The row is already PROCESSING — the internal dispatcher claimed it
  // synchronously before scheduling this call. If the user cancels mid-flight
  // the terminal updateMany writes below (gated on status === PROCESSING)
  // will no-op, so the upload finishes silently but the record stays
  // CANCELLED.
  const deadlineTimer = setTimeout(() => {
    // Same `status: "PROCESSING"` guard as the success/failure paths: if the
    // upload already finished (PUBLISHED) or the user cancelled (CANCELLED),
    // we leave the terminal state alone. If we hit the deadline first, mark
    // FAILED with a clear message so the UI surfaces a real error instead of
    // sitting on the spinner.
    void prisma.publishRecord
      .updateMany({
        where: { id: recordId, status: "PROCESSING" },
        data: {
          status: "FAILED",
          errorMessage: `Publish exceeded ${Math.round(PUBLISH_DEADLINE_MS / 1000)}s deadline (large media or slow upstream)`,
          retryCount: { increment: 1 },
        },
      })
      .catch((e) =>
        console.error("publishNow deadline mark-failed errored", { recordId, e }),
      );
  }, PUBLISH_DEADLINE_MS);
  try {
    const token = await prisma.platformToken.findUnique({
      where: { userId_platform: { userId, platform } },
    });

    // YouTube and TikTok handle their own token fetch/refresh inside the
    // platform module (Google's googleapis client + getValidTikTokAccessToken
    // respectively), so they don't need the PlatformToken row here. Everything
    // else uses the access token straight from PlatformToken.
    let accessToken: string = "";
    let platformUserId: string | undefined;
    if (platform !== "YOUTUBE" && platform !== "TIKTOK") {
      if (!token) throw new Error(`No ${platform} token found`);
      accessToken = decrypt(token.accessToken);
      platformUserId = token.platformUserId ?? undefined;
    }

    // Mux any silent video that has an attached AudioTrack before handing off
    // to the platform module. Keys come back unchanged for everything else.
    const mediaKeys = await preparePublishKeys(
      userId,
      post.media.map((m) => ({
        storageKey: m.storageKey,
        mimeType: m.mimeType,
        hasAudio: m.hasAudio ?? null,
        audioTrack: m.audioTrack ?? null,
      })),
    );

    let result: { platformPostId: string; platformUrl?: string };

    switch (platform) {
      case "INSTAGRAM":
        result = await postToInstagram(
          { accessToken, platformUserId: platformUserId! },
          post.body,
          mediaKeys,
          post.postType
        );
        break;
      case "LINKEDIN":
        result = await postToLinkedIn(
          { accessToken, platformUserId: platformUserId! },
          post.body,
          mediaKeys
        );
        break;
      case "YOUTUBE":
        // postToYouTube uses buildGoogleOAuthClient internally so the googleapis
        // client knows the access token's expiry, refreshes proactively, and
        // persists the rotated token back to the GoogleIntegration row.
        result = await postToYouTube(userId, post.body, post.body, mediaKeys);
        break;
      case "TIKTOK": {
        // Refresh-or-return; access token is ~24h, refresh token is ~365d and
        // rotates on every refresh. Without this, every publish >24h after the
        // last reconnect hits "The access token is invalid or not found".
        const freshToken = await getValidTikTokAccessToken(userId);
        result = await postToTikTok({ accessToken: freshToken }, post.body, mediaKeys);
        break;
      }
      case "FACEBOOK_PAGE":
        result = await postToFacebook(
          { accessToken, platformUserId: platformUserId! },
          post.body,
          mediaKeys,
          post.postType
        );
        break;
      case "THREADS": {
        // Refresh long-lived token if it's within 7 days of expiry. Threads tokens
        // can only be refreshed after they're at least 24h old, so for very fresh
        // tokens we just use them as-is.
        let usableToken = accessToken;
        const tokenAgeMs = Date.now() - (token?.createdAt?.getTime() ?? 0);
        const expiresInMs = (token?.expiresAt?.getTime() ?? 0) - Date.now();
        if (tokenAgeMs > 24 * 60 * 60 * 1000 && expiresInMs < 7 * 24 * 60 * 60 * 1000) {
          const refreshed = await refreshThreadsToken(accessToken);
          usableToken = refreshed.accessToken;
          await prisma.platformToken.update({
            where: { userId_platform: { userId, platform: "THREADS" } },
            data: {
              accessToken: encrypt(refreshed.accessToken),
              expiresAt: new Date(Date.now() + refreshed.expiresIn * 1000),
            },
          });
        }

        result = await postToThreads(
          { accessToken: usableToken, platformUserId: platformUserId! },
          post.body,
          mediaKeys,
          post.postType,
        );
        break;
      }
      default:
        throw new Error(`Publishing to ${platform} is not supported`);
    }

    const publishedAt = new Date();
    // updateMany with a status filter so a user-cancelled row (CANCELLED) isn't
    // overwritten back to PUBLISHED by a lambda that finished after the click.
    // The upload itself can't be aborted mid-flight, but the record reflects
    // the user's intent: they said cancel, so it stays cancelled.
    const updated = await prisma.publishRecord.updateMany({
      where: { id: recordId, status: "PROCESSING" },
      data: {
        status: "PUBLISHED",
        publishedAt,
        platformPostId: result.platformPostId,
        platformUrl: result.platformUrl ?? null,
      },
    });
    if (updated.count === 0) {
      // Row was cancelled (or reaped) while the upload was running. The post
      // did go live on the platform — surface that in logs so we can manually
      // reconcile if needed — but don't touch the record state.
      console.warn("publishNow: record no longer PROCESSING, leaving status as-is", {
        recordId,
        platformPostId: result.platformPostId,
        platformUrl: result.platformUrl,
      });
      return;
    }

    // Mirror the publish event onto Post so list views can sort/filter by
    // hub-publish state directly without joining PublishRecord. Sequential
    // awaits — pgbouncer transaction-pool mode rejects $transaction here.
    // Failure here is non-fatal: PublishRecord is the source of truth, the
    // Post column is a cache. Don't roll the PublishRecord back to FAILED.
    try {
      await prisma.post.update({
        where: { id: post.id },
        data: {
          hubPublishCount: { increment: 1 },
          lastPublishedViaHubAt: publishedAt,
        },
      });
    } catch (denormErr) {
      console.error("Post hub-publish denorm failed", { postId: post.id, denormErr });
    }
  } catch (err) {
    // Same guard as the success path — don't overwrite a CANCELLED row, and
    // don't clobber a FAILED row that the deadline timer already wrote.
    await prisma.publishRecord.updateMany({
      where: { id: recordId, status: "PROCESSING" },
      data: {
        status: "FAILED",
        errorMessage: String(err),
        retryCount: { increment: 1 },
      },
    });
    throw err;
  } finally {
    clearTimeout(deadlineTimer);
  }
}
