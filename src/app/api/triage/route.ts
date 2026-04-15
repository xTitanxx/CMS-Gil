import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauth" }, { status: 401 });
  const url = new URL(req.url);
  const bucket = url.searchParams.get("bucket");
  const cursor = url.searchParams.get("cursor");

  const where = {
    userId: session.user.id,
    readiness: "NOT_READY" as const,
    ...(bucket ? { notReadyReasons: { has: bucket } } : {}),
  };

  const posts = await prisma.post.findMany({
    where,
    include: { media: true, rating: true },
    orderBy: { originalDate: "desc" },
    take: 21,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
  });

  const hasMore = posts.length > 20;
  return NextResponse.json({
    items: posts.slice(0, 20),
    nextCursor: hasMore ? posts[19].id : null,
  });
}
