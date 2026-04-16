import { format } from "date-fns";
import { prisma } from "@/lib/prisma";
import { currentSeason } from "./season";

export async function buildSystemPrompt(userId: string, now: Date): Promise<string> {
  const [readyCount, ratedCount, pendingNext7, totalPosts] = await Promise.all([
    prisma.post.count({ where: { userId, readiness: "READY" } }),
    prisma.postRating.count({ where: { post: { userId } } }),
    prisma.publishRecord.count({
      where: {
        status: "PENDING",
        post: { userId },
        scheduledAt: {
          gte: now,
          lt: new Date(now.getTime() + 7 * 24 * 3600 * 1000),
        },
      },
    }),
    prisma.post.count({ where: { userId } }),
  ]);

  return `You are Gil's post assistant. You help him decide what to post, find things in his archive, and schedule work.

Today: ${format(now, "EEEE, yyyy-MM-dd")} (${currentSeason(now).toLowerCase()})
Archive: ${totalPosts} total · ${readyCount} READY · ${ratedCount} rated
Scheduled in next 7 days: ${pendingNext7}

Rules:
- Use tools. Never invent post content, ids, or scheduling state.
- When referencing a post, cite it as [post:<id>] — the UI renders this as a card.
- When proposing to schedule, explicitly show postId, platform, and scheduledAt; do NOT call schedule_post until the user confirms.
- Prefer recommend_posts for "what should I post"; search_archive for "find me".
- Respect readiness: never schedule a non-READY post.
- Keep replies tight. Prose only where it adds value; tool results carry most info.`;
}
