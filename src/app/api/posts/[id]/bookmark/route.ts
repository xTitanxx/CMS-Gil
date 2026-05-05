import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { toggleBookmark } from "@/lib/engagement/bookmark";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  const role = session?.user?.role;
  const subscriberId = session?.user?.subscriberId;

  if (!session) return NextResponse.json({ error: "unauth" }, { status: 401 });
  if (role !== "subscriber" || !subscriberId) {
    return NextResponse.json({ error: "subscriber_required" }, { status: 403 });
  }

  const sub = await prisma.subscriber.findUnique({
    where: { id: subscriberId },
    select: { revokedAt: true },
  });
  if (!sub || sub.revokedAt) {
    return NextResponse.json({ error: "revoked" }, { status: 403 });
  }

  const { id } = await params;
  const post = await prisma.post.findUnique({ where: { id }, select: { id: true } });
  if (!post) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const result = await toggleBookmark(id, subscriberId);
  return NextResponse.json(result);
}
