import { NextResponse } from "next/server";
import { after } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { analyzePost } from "@/lib/analyze-post";

export const maxDuration = 300;

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  // Find posts with no tags (empty array)
  const untagged = await prisma.post.findMany({
    where: { userId, tags: { isEmpty: true } },
    select: { id: true },
    orderBy: { originalDate: "desc" },
  });

  if (untagged.length === 0) {
    return NextResponse.json({ queued: 0, message: "All posts already have tags." });
  }

  // Process in background with concurrency limit
  after(async () => {
    const CONCURRENCY = 3;
    let i = 0;
    while (i < untagged.length) {
      const batch = untagged.slice(i, i + CONCURRENCY);
      await Promise.allSettled(
        batch.map((p) => analyzePost(p.id).catch((err) => {
          console.error(`Failed to analyze post ${p.id}:`, err);
        }))
      );
      i += CONCURRENCY;
    }
  });

  return NextResponse.json({ queued: untagged.length });
}
