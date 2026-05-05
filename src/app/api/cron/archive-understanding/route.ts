import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildUnderstanding, persistUnderstanding } from "@/lib/assistant/archive-understanding";
import { isAuthorizedCron } from "@/lib/cron-auth";

const MIN_POSTS_TO_BUILD = 50;

// Generation hits Claude twice per user (Sonnet + Haiku) and reads ~1K posts —
// well above Vercel's default 60s. 300s is the new platform default and fits.
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const users = await prisma.user.findMany({ select: { id: true } });
  const built: { userId: string; postCount: number; durationMs: number }[] = [];
  const skipped: { userId: string; reason: string }[] = [];
  const failed: { userId: string; error: string }[] = [];

  for (const u of users) {
    const eligibleCount = await prisma.post.count({
      where: { userId: u.id, readiness: { not: "ARCHIVED" }, body: { not: "" } },
    });
    if (eligibleCount < MIN_POSTS_TO_BUILD) {
      skipped.push({ userId: u.id, reason: `only ${eligibleCount} usable posts` });
      continue;
    }
    const started = Date.now();
    try {
      const result = await buildUnderstanding(u.id);
      await persistUnderstanding(u.id, result);
      built.push({ userId: u.id, postCount: result.basedOnPostCount, durationMs: Date.now() - started });
    } catch (err) {
      failed.push({ userId: u.id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return NextResponse.json({ ok: true, built, skipped, failed });
}
