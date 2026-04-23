import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fetchAndStoreForRecord } from "@/lib/analytics/fetch-all";

// GET — return stored analytics for all PublishRecords of this post
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const records = await prisma.publishRecord.findMany({
    where: { postId: id, status: "PUBLISHED" },
    include: { analytics: true },
    orderBy: { publishedAt: "desc" },
  });

  return NextResponse.json(records);
}

// POST — refresh analytics for all published records of this post
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const records = await prisma.publishRecord.findMany({
    where: {
      postId: id,
      status: "PUBLISHED",
      platformPostId: { not: null },
    },
  });

  const results: { id: string; status: string; error?: string }[] = [];

  for (const record of records) {
    try {
      await fetchAndStoreForRecord(record.id);
      results.push({ id: record.id, status: "ok" });
    } catch (err) {
      results.push({ id: record.id, status: "error", error: String(err) });
    }
  }

  return NextResponse.json({ refreshed: results.length, results });
}
