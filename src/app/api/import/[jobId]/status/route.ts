import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { jobId } = await params;
  const job = await prisma.importJob.findFirst({
    where: { id: jobId, userId: session.user.id },
    select: {
      id: true,
      status: true,
      filename: true,
      source: true,
      totalPosts: true,
      importedPosts: true,
      skippedPosts: true,
      errorLog: true,
      startedAt: true,
      completedAt: true,
      createdAt: true,
    },
  });

  if (!job) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(job);
}
