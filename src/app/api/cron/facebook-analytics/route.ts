import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/encrypt";
import { discoverFacebookPostId, fetchPostInsights } from "@/lib/platforms/facebook-analytics";

const CRON_SECRET = process.env.CRON_SECRET!;
const POSTS_PER_USER_PER_RUN = 50;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const facebookTokens = await prisma.platformToken.findMany({
    where: { platform: "FACEBOOK" },
    select: { userId: true, accessToken: true },
  });

  const results = { users: 0, discovered: 0, updated: 0, errors: 0 };

  for (const token of facebookTokens) {
    results.users++;
    const accessToken = decrypt(token.accessToken);

    try {
      const posts = await prisma.post.findMany({
        where: { userId: token.userId, source: "FACEBOOK", sourceId: { not: null } },
        include: {
          analytics: { where: { platform: "FACEBOOK" } },
        },
        orderBy: { originalDate: "asc" },
      });

      // Discovery pass: posts with no analytics record or no platformPostId yet
      const undiscovered = posts.filter((p) => !p.analytics[0]?.platformPostId);
      for (const post of undiscovered) {
        try {
          const fbPostId = await discoverFacebookPostId(
            accessToken,
            post.originalDate,
            post.sourceId!
          );
          if (fbPostId) {
            await prisma.postAnalytics.upsert({
              where: { postId_platform: { postId: post.id, platform: "FACEBOOK" } },
              create: { postId: post.id, platform: "FACEBOOK", platformPostId: fbPostId },
              update: { platformPostId: fbPostId },
            });
            results.discovered++;
          }
        } catch (err) {
          console.error(`Discovery failed for post ${post.id}:`, err);
          results.errors++;
        }
      }

      // Insights pass: posts with a known platformPostId, oldest-updated first, capped at 50
      const discovered = posts
        .filter((p) => p.analytics[0]?.platformPostId)
        .sort((a, b) => {
          const aTs = a.analytics[0]?.updatedAt?.getTime() ?? 0;
          const bTs = b.analytics[0]?.updatedAt?.getTime() ?? 0;
          return aTs - bTs;
        })
        .slice(0, POSTS_PER_USER_PER_RUN);

      for (const post of discovered) {
        const fbPostId = post.analytics[0].platformPostId!;
        try {
          const metrics = await fetchPostInsights(accessToken, fbPostId);
          await prisma.postAnalytics.update({
            where: { postId_platform: { postId: post.id, platform: "FACEBOOK" } },
            data: { ...metrics, fetchedAt: new Date() },
          });
          results.updated++;
        } catch (err) {
          console.error(`Insights failed for post ${post.id}:`, err);
          results.errors++;
        }
      }
    } catch (err) {
      console.error(`Facebook analytics cron failed for user ${token.userId}:`, err);
      results.errors++;
    }
  }

  return NextResponse.json(results);
}
