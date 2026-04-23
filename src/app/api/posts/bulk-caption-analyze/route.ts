import { NextResponse } from "next/server";
import { after } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { analyzeCaption, getHighQualityExamples, suggestCaption } from "@/lib/analyze-caption";

export const maxDuration = 300;

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const job = await prisma.bulkCaptionAnalyzeJob.findFirst({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ job });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const existing = await prisma.bulkCaptionAnalyzeJob.findFirst({
    where: { userId, status: "RUNNING" },
  });
  if (existing) {
    return NextResponse.json({ queued: 0, job: existing, message: "A caption-analysis job is already running." });
  }

  const body = await req.json().catch(() => ({}));
  const postIds: string[] | undefined = body.postIds;
  const reanalyze: boolean = body.reanalyze === true;

  // Candidates: posts with media attached. Optionally scoped to postIds or to
  // posts that haven't been analyzed yet.
  let toAnalyze: { id: string }[];
  if (Array.isArray(postIds) && postIds.length > 0) {
    toAnalyze = await prisma.post.findMany({
      where: { userId, id: { in: postIds } },
      select: { id: true },
    });
  } else {
    toAnalyze = await prisma.post.findMany({
      where: {
        userId,
        media: { some: {} }, // caption analysis is specifically for media posts per product spec
        ...(reanalyze ? {} : { captionAnalyzedAt: null }),
      },
      select: { id: true },
      orderBy: { originalDate: "desc" },
    });
  }

  if (toAnalyze.length === 0) {
    return NextResponse.json({
      queued: 0,
      message: postIds ? "No matching posts found." : "All media posts already analyzed.",
    });
  }

  const job = await prisma.bulkCaptionAnalyzeJob.create({
    data: { userId, total: toAnalyze.length, status: "RUNNING" },
  });

  after(async () => {
    const CONCURRENCY = 3;

    // Phase A: analyze every caption (cheap, Haiku, text-only)
    let i = 0;
    while (i < toAnalyze.length) {
      const current = await prisma.bulkCaptionAnalyzeJob.findUnique({
        where: { id: job.id },
        select: { status: true },
      });
      if (!current || current.status === "CANCELLED") return;
      const batch = toAnalyze.slice(i, i + CONCURRENCY);
      await Promise.allSettled(
        batch.map((p) =>
          analyzeCaption(p.id).catch((err) => {
            console.error(`[caption-analyze] failed for ${p.id}:`, err);
          }),
        ),
      );
      i += batch.length;
      await prisma.bulkCaptionAnalyzeJob
        .update({ where: { id: job.id }, data: { completed: i } })
        .catch(() => {});
    }

    // Phase B: generate suggestions for posts flagged as low-quality or non-evergreen.
    // Use the user's own high-quality evergreen captions as few-shot style examples.
    const examples = await getHighQualityExamples(userId, 6);
    if (examples.length === 0) {
      // No HQ corpus yet — skip suggestions.
      await prisma.bulkCaptionAnalyzeJob
        .update({ where: { id: job.id }, data: { status: "DONE" } })
        .catch(() => {});
      return;
    }

    const flagged = await prisma.post.findMany({
      where: {
        userId,
        media: { some: {} },
        id: { in: toAnalyze.map((p) => p.id) },
        OR: [{ captionQuality: { lte: 2 } }, { captionEvergreen: false }],
      },
      select: { id: true },
    });

    // Update total to reflect the second pass so progress stays meaningful.
    await prisma.bulkCaptionAnalyzeJob
      .update({
        where: { id: job.id },
        data: { total: toAnalyze.length + flagged.length, completed: toAnalyze.length },
      })
      .catch(() => {});

    let j = 0;
    while (j < flagged.length) {
      const current = await prisma.bulkCaptionAnalyzeJob.findUnique({
        where: { id: job.id },
        select: { status: true },
      });
      if (!current || current.status === "CANCELLED") return;
      const batch = flagged.slice(j, j + CONCURRENCY);
      await Promise.allSettled(
        batch.map((p) =>
          suggestCaption({ postId: p.id, examples }).catch((err) => {
            console.error(`[caption-suggest] failed for ${p.id}:`, err);
          }),
        ),
      );
      j += batch.length;
      await prisma.bulkCaptionAnalyzeJob
        .update({ where: { id: job.id }, data: { completed: toAnalyze.length + j } })
        .catch(() => {});
    }

    await prisma.bulkCaptionAnalyzeJob
      .update({ where: { id: job.id }, data: { status: "DONE" } })
      .catch(() => {});
  });

  return NextResponse.json({ queued: toAnalyze.length, job });
}

export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await prisma.bulkCaptionAnalyzeJob.updateMany({
    where: { userId: session.user.id, status: "RUNNING" },
    data: { status: "CANCELLED" },
  });
  return NextResponse.json({ cancelled: result.count });
}
