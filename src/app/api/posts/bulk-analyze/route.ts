import { NextResponse } from "next/server";
import { after } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { analyzePost } from "@/lib/analyze-post";

export const maxDuration = 300;

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const body = await req.json().catch(() => ({}));
  const postIds: string[] | undefined = body.postIds;

  let toAnalyze: { id: string }[];

  if (Array.isArray(postIds) && postIds.length > 0) {
    // Specific posts — verify they belong to this user
    toAnalyze = await prisma.post.findMany({
      where: { userId, id: { in: postIds } },
      select: { id: true },
    });
  } else {
    // All untagged posts
    toAnalyze = await prisma.post.findMany({
      where: { userId, tags: { isEmpty: true } },
      select: { id: true },
      orderBy: { originalDate: "desc" },
    });
  }

  if (toAnalyze.length === 0) {
    return NextResponse.json({ queued: 0, message: postIds ? "No matching posts found." : "All posts already have tags." });
  }

  // Process in background with concurrency limit
  after(async () => {
    const CONCURRENCY = 3;
    let i = 0;
    while (i < toAnalyze.length) {
      const batch = toAnalyze.slice(i, i + CONCURRENCY);
      await Promise.allSettled(
        batch.map((p) => analyzePost(p.id).catch((err) => {
          console.error(`Failed to analyze post ${p.id}:`, err);
        }))
      );
      i += CONCURRENCY;
    }
  });

  return NextResponse.json({ queued: toAnalyze.length });
}
