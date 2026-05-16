import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Platform } from "@prisma/client";
import { decrypt } from "@/lib/encrypt";
import { getGoogleIntegration } from "@/lib/google-integration";
import { postToInstagram } from "@/lib/platforms/instagram";
import { postToLinkedIn } from "@/lib/platforms/linkedin";
import { postToYouTube } from "@/lib/platforms/youtube";
import { postToFacebook } from "@/lib/platforms/facebook";
import { postToTikTok } from "@/lib/platforms/tiktok";
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
  try {
    const token = await prisma.platformToken.findUnique({
      where: { userId_platform: { userId, platform } },
    });

    // YouTube reads from GoogleIntegration; everything else from PlatformToken.
    let accessToken: string;
    let refreshToken: string | undefined;
    let platformUserId: string | undefined;

    if (platform === "YOUTUBE") {
      const integration = await getGoogleIntegration(userId);
      if (!integration) throw new Error("YouTube not connected");
      accessToken = integration.accessToken;
      refreshToken = integration.refreshToken ?? undefined;
    } else {
      if (!token) throw new Error(`No ${platform} token found`);
      accessToken = decrypt(token.accessToken);
      refreshToken = token.refreshToken ? decrypt(token.refreshToken) : undefined;
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
        result = await postToYouTube(
          { accessToken, refreshToken },
          post.body,
          post.body,
          mediaKeys
        );
        break;
      case "TIKTOK":
        result = await postToTikTok({ accessToken }, post.body, mediaKeys);
        break;
      case "FACEBOOK_PAGE":
        result = await postToFacebook(
          { accessToken, platformUserId: platformUserId! },
          post.body,
          mediaKeys,
          post.postType
        );
        break;
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
    // Same guard as the success path — don't overwrite a CANCELLED row.
    await prisma.publishRecord.updateMany({
      where: { id: recordId, status: "PROCESSING" },
      data: {
        status: "FAILED",
        errorMessage: String(err),
        retryCount: { increment: 1 },
      },
    });
    throw err;
  }
}
