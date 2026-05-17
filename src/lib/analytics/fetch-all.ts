import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/encrypt";
import { getGoogleIntegration } from "@/lib/google-integration";
import { getValidTikTokAccessToken } from "@/lib/platforms/tiktok-auth";
import { fetchAnalytics } from "./index";
import type { Platform } from "@prisma/client";

/**
 * Fetch analytics for all posts published in the last 30 days.
 * Called from the publish cron via after().
 */
export async function fetchAnalyticsForRecentPublishes(): Promise<{
  success: number;
  failed: number;
  errors: string[];
}> {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const records = await prisma.publishRecord.findMany({
    where: {
      status: "PUBLISHED",
      publishedAt: { gte: thirtyDaysAgo },
      platformPostId: { not: null },
    },
    include: { post: { select: { userId: true } } },
  });

  let success = 0;
  let failed = 0;
  const errors: string[] = [];

  // Process in batches of 10 to respect rate limits
  for (let i = 0; i < records.length; i += 10) {
    const batch = records.slice(i, i + 10);
    const results = await Promise.allSettled(
      batch.map((record) => fetchAndStore(record))
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        success++;
      } else {
        failed++;
        errors.push(result.reason?.message ?? String(result.reason));
      }
    }

    // Small delay between batches
    if (i + 10 < records.length) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  return { success, failed, errors };
}

/**
 * Fetch analytics for a single PublishRecord and upsert to DB.
 */
export async function fetchAndStoreForRecord(publishRecordId: string) {
  const record = await prisma.publishRecord.findUnique({
    where: { id: publishRecordId },
    include: { post: { select: { userId: true } } },
  });
  if (!record || !record.platformPostId) {
    throw new Error("Record not found or missing platformPostId");
  }
  return fetchAndStore(record);
}

async function fetchAndStore(record: {
  id: string;
  platform: Platform;
  platformPostId: string | null;
  post: { userId: string };
}) {
  if (!record.platformPostId) return;

  const accessToken = await getAccessToken(
    record.post.userId,
    record.platform
  );

  const snapshot = await fetchAnalytics(
    record.platform,
    record.platformPostId,
    accessToken
  );

  await prisma.publishAnalytics.upsert({
    where: { publishRecordId: record.id },
    create: {
      publishRecordId: record.id,
      impressions: snapshot.impressions,
      reach: snapshot.reach,
      likes: snapshot.likes,
      comments: snapshot.comments,
      shares: snapshot.shares,
      saves: snapshot.saves,
      videoViews: snapshot.videoViews,
      rawJson: JSON.parse(JSON.stringify(snapshot.rawJson)),
      fetchedAt: new Date(),
    },
    update: {
      impressions: snapshot.impressions,
      reach: snapshot.reach,
      likes: snapshot.likes,
      comments: snapshot.comments,
      shares: snapshot.shares,
      saves: snapshot.saves,
      videoViews: snapshot.videoViews,
      rawJson: JSON.parse(JSON.stringify(snapshot.rawJson)),
      fetchedAt: new Date(),
    },
  });
}

async function getAccessToken(
  userId: string,
  platform: Platform
): Promise<string> {
  if (platform === "YOUTUBE") {
    const integration = await getGoogleIntegration(userId);
    if (!integration) throw new Error("No YouTube/Google token");
    return integration.accessToken;
  }

  // TikTok access tokens expire after 24h; the helper refreshes via the
  // stored refresh token instead of leaving every >24h analytics fetch silently
  // failing as "access token invalid".
  if (platform === "TIKTOK") return getValidTikTokAccessToken(userId);

  const token = await prisma.platformToken.findUnique({
    where: { userId_platform: { userId, platform } },
  });
  if (!token) throw new Error(`No ${platform} token found`);
  return decrypt(token.accessToken);
}
