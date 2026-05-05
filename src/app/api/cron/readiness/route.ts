import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { computeReadiness } from "@/lib/readiness";
import { isAuthorizedCron } from "@/lib/cron-auth";

// HEAD-fetch every media URL daily; 200 posts × ~1-3 media each is up to
// ~600 requests. The per-fetch timeout caps a single hung URL from stalling
// the whole tick, and parallelizing brings the wall time from ~30-60s down
// to seconds. maxDuration extends past Vercel's 60s default so a slow run
// doesn't terminate mid-update.
export const maxDuration = 300;

const HEAD_TIMEOUT_MS = 3000;
const POST_CONCURRENCY = 8;

async function isBroken(storageKey: string): Promise<boolean> {
  if (!storageKey.startsWith("http")) return true;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), HEAD_TIMEOUT_MS);
  try {
    const res = await fetch(storageKey, { method: "HEAD", signal: ac.signal });
    return !res.ok;
  } catch {
    return true;
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const posts = await prisma.post.findMany({
    where: {
      OR: [{ readinessCheckedAt: null }, { readinessCheckedAt: { lt: since } }],
      NOT: { readiness: "ARCHIVED" },
    },
    include: { media: true },
    take: 200,
  });

  let updated = 0;

  // Process posts in bounded-concurrency chunks. Within each post, all
  // media HEADs run in parallel; if any is broken the post is flagged.
  for (let i = 0; i < posts.length; i += POST_CONCURRENCY) {
    const chunk = posts.slice(i, i + POST_CONCURRENCY);
    await Promise.all(
      chunk.map(async (post) => {
        const brokenChecks = await Promise.all(
          post.media.map((m) => isBroken(m.storageKey))
        );
        const anyBroken = brokenChecks.some(Boolean);
        const brokenReasons = anyBroken ? ["broken-media"] : [];
        const carry = post.notReadyReasons.filter((r) => r === "dont-post");
        const notReadyReasons = [...carry, ...brokenReasons];
        const { readiness, reasons } = computeReadiness(
          {
            body: post.body,
            share: post.share,
            readiness: post.readiness,
            notReadyReasons,
          },
          post.media.map((m) => ({ mimeType: m.mimeType, hasAudio: m.hasAudio }))
        );
        await prisma.post.update({
          where: { id: post.id },
          data: { readiness, notReadyReasons: reasons, readinessCheckedAt: new Date() },
        });
        updated++;
      })
    );
  }

  return NextResponse.json({ updated });
}
