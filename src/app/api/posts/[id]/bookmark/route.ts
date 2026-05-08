import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { toggleBookmark } from "@/lib/engagement/bookmark";
import { resolveActorSubscriberId } from "@/lib/engagement/admin-shadow";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauth" }, { status: 401 });

  const actorId = await resolveActorSubscriberId(session);
  if (!actorId) {
    return NextResponse.json({ error: "subscriber_required" }, { status: 403 });
  }

  if (session.user.role === "subscriber") {
    const sub = await prisma.subscriber.findUnique({
      where: { id: actorId },
      select: { revokedAt: true },
    });
    if (!sub || sub.revokedAt) {
      return NextResponse.json({ error: "revoked" }, { status: 403 });
    }
  }

  const { id } = await params;
  const post = await prisma.post.findUnique({ where: { id }, select: { id: true } });
  if (!post) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const result = await toggleBookmark(id, actorId);
  return NextResponse.json(result);
}
