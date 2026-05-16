import { NextRequest, NextResponse, after } from "next/server";
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

  // Fire-and-forget dispatch to the internal worker endpoint. Wrapped in
  // after() so the lambda stays alive long enough to actually send each
  // request before terminating; each fetch returns ~quickly (202 from the
  // worker once it's scheduled its own background work).
  if (!scheduled) {
    const baseUrl = new URL("/api/internal/publish-record", req.url);
    const cronSecret = process.env.CRON_SECRET;
    after(async () => {
      if (!cronSecret) {
        console.error("CRON_SECRET missing — cannot dispatch publish");
        return;
      }
      await Promise.allSettled(
        records.map((r) =>
          fetch(baseUrl, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${cronSecret}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ recordId: r.id }),
          }).catch((err) =>
            console.error("publish dispatch failed", { recordId: r.id, err }),
          ),
        ),
      );
    });
  }

  return NextResponse.json({
    records: records.map((r) => ({ id: r.id, platform: r.platform, status: r.status })),
  });
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
  await prisma.publishRecord.update({
    where: { id: recordId },
    data: { status: "PROCESSING" },
  });

  // Everything after this point is wrapped in try/catch so that ANY failure
  // (missing token, decrypt error, provider error) transitions the record to
  // FAILED instead of leaving it orphaned in PROCESSING forever.
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
    await prisma.publishRecord.update({
      where: { id: recordId },
      data: {
        status: "PUBLISHED",
        publishedAt,
        platformPostId: result.platformPostId,
        platformUrl: result.platformUrl ?? null,
      },
    });

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
    await prisma.publishRecord.update({
      where: { id: recordId },
      data: {
        status: "FAILED",
        errorMessage: String(err),
        retryCount: { increment: 1 },
      },
    });
    throw err;
  }
}
