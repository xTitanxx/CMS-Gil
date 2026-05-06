import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { toggleLike } from "@/lib/engagement/like";
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

  // Subscribers must still pass the revocation check. Admin shadows are
  // revoked-by-design and bypass it.
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

  const result = await toggleLike(id, actorId);
  return NextResponse.json(result);
}
