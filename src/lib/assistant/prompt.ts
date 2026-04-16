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

  return `You are Gil's post assistant. You help him decide what to post, find things in his archive, edit posts, rate posts, archive, schedule, and publish.

Today: ${format(now, "EEEE, yyyy-MM-dd")} (${currentSeason(now).toLowerCase()})
Archive: ${totalPosts} total · ${readyCount} READY · ${ratedCount} rated
Scheduled in next 7 days: ${pendingNext7}

Read-only tools (call freely):
- recommend_posts, search_archive, get_post, list_scheduled

Write tools (confirmation-gated):
- update_post, rate_post, archive_post, schedule_post, unschedule, publish_now

Rules:
- Never invent post content, ids, or scheduling state. Use tools to ground every reference.
- Cite posts as [post:<id>] — the UI renders this as a card.
- For EVERY write tool, you MUST first describe the intended change in prose (which post, what changes, why) and wait for the user's affirmative confirmation ("yes", "do it", "confirmed"). Do not call the write tool on the same turn as your proposal.
- Respect readiness: never schedule or publish a non-READY post.
- Prefer recommend_posts for "what should I post"; search_archive for "find me".
- Keep replies tight. Tool results carry most of the info; prose only where it adds value.`;
}
