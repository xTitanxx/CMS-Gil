import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Platform } from "@prisma/client";
import { decrypt } from "@/lib/encrypt";
import { postToInstagram } from "@/lib/platforms/instagram";
import { postToLinkedIn } from "@/lib/platforms/linkedin";
import { postToYouTube } from "@/lib/platforms/youtube";
import { postToTikTok } from "@/lib/platforms/tiktok";

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
    include: { media: true },
  });

  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const scheduled = scheduledAt ? new Date(scheduledAt) : null;
  const records = [];

  for (const platform of platforms) {
    // Cancel any existing pending record for this post+platform
    await prisma.publishRecord.updateMany({
      where: { postId: id, platform, status: "PENDING" },
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

    // If immediate, publish now
    if (!scheduled) {
      publishNow(record.id, session.user.id, post, platform).catch(console.error);
    }
  }

  return NextResponse.json({
    records: records.map((r) => ({ id: r.id, platform: r.platform, status: r.status })),
  });
}

export async function publishNow(
  recordId: string,
  userId: string,
  post: { id: string; body: string; media: { storageKey: string; mimeType: string }[] },
  platform: Platform
) {
  await prisma.publishRecord.update({
    where: { id: recordId },
    data: { status: "PROCESSING" },
  });

  const token = await prisma.platformToken.findUnique({
    where: { userId_platform: { userId, platform } },
  });

  // For YouTube/Drive the token is in the Account table (NextAuth)
  let accessToken: string;
  let refreshToken: string | undefined;
  let platformUserId: string | undefined;

  if (platform === "YOUTUBE") {
    const account = await prisma.account.findFirst({
      where: { userId, provider: "google" },
    });
    accessToken = account?.access_token ?? "";
    refreshToken = account?.refresh_token ?? undefined;
  } else {
    if (!token) throw new Error(`No ${platform} token found`);
    accessToken = decrypt(token.accessToken);
    refreshToken = token.refreshToken ? decrypt(token.refreshToken) : undefined;
    platformUserId = token.platformUserId ?? undefined;
  }

  const mediaKeys = post.media.map((m) => m.storageKey);

  try {
    let result: { platformPostId: string; platformUrl?: string };

    switch (platform) {
      case "INSTAGRAM":
        result = await postToInstagram(
          { accessToken, platformUserId: platformUserId! },
          post.body,
          mediaKeys
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
          post.body.slice(0, 100),
          post.body,
          mediaKeys
        );
        break;
      case "TIKTOK":
        result = await postToTikTok({ accessToken }, post.body, mediaKeys);
        break;
      default:
        throw new Error(`Publishing to ${platform} is not supported`);
    }

    await prisma.publishRecord.update({
      where: { id: recordId },
      data: {
        status: "PUBLISHED",
        publishedAt: new Date(),
        platformPostId: result.platformPostId,
        platformUrl: result.platformUrl ?? null,
      },
    });
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
