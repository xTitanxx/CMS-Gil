import { NextResponse } from "next/server";
import { after } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { analyzePost } from "@/lib/analyze-post";

export const maxDuration = 300;

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const job = await prisma.bulkAnalyzeJob.findFirst({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ job });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  // Block if there's already a running job
  const existing = await prisma.bulkAnalyzeJob.findFirst({
    where: { userId, status: "RUNNING" },
  });
  if (existing) {
    return NextResponse.json({ queued: 0, job: existing, message: "A tagging job is already running." });
  }

  const body = await req.json().catch(() => ({}));
  const postIds: string[] | undefined = body.postIds;

  let toAnalyze: { id: string }[];

  if (Array.isArray(postIds) && postIds.length > 0) {
    toAnalyze = await prisma.post.findMany({
      where: { userId, id: { in: postIds } },
      select: { id: true },
    });
  } else {
    toAnalyze = await prisma.post.findMany({
      where: { userId, tags: { isEmpty: true } },
      select: { id: true },
      orderBy: { originalDate: "desc" },
    });
  }

  if (toAnalyze.length === 0) {
    return NextResponse.json({ queued: 0, message: postIds ? "No matching posts found." : "All posts already have tags." });
  }

  const job = await prisma.bulkAnalyzeJob.create({
    data: { userId, total: toAnalyze.length, status: "RUNNING" },
  });

  after(async () => {
    const CONCURRENCY = 3;
    let i = 0;
    while (i < toAnalyze.length) {
      const current = await prisma.bulkAnalyzeJob.findUnique({ where: { id: job.id }, select: { status: true } });
      if (!current || current.status === "CANCELLED") {
        return;
      }
      const batch = toAnalyze.slice(i, i + CONCURRENCY);
      await Promise.allSettled(
        batch.map((p) => analyzePost(p.id).catch((err) => {
          console.error(`Failed to analyze post ${p.id}:`, err);
        }))
      );
      i += batch.length;
      await prisma.bulkAnalyzeJob.update({
        where: { id: job.id },
        data: { completed: i },
      }).catch(() => {});
    }
    await prisma.bulkAnalyzeJob.update({
      where: { id: job.id },
      data: { status: "DONE" },
    }).catch(() => {});
  });

  return NextResponse.json({ queued: toAnalyze.length, job });
}

export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await prisma.bulkAnalyzeJob.updateMany({
    where: { userId: session.user.id, status: "RUNNING" },
    data: { status: "CANCELLED" },
  });
  return NextResponse.json({ cancelled: result.count });
}
