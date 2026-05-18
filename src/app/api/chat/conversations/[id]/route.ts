import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveActorSubscriberId } from "@/lib/engagement/admin-shadow";

// Loading + deleting a specific conversation. Ownership is enforced by
// matching subscriberId against the actor's resolved id (own row for real
// subscribers, shadow row for admins).

const COST_TRAILER_STRIP_RE = /\n?​?__USAGE_USD:[0-9.]+__/g;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session) {
    return Response.json({ error: "Sign in required." }, { status: 401 });
  }

  const actorSubscriberId = await resolveActorSubscriberId(session);
  if (!actorSubscriberId) {
    return Response.json({ messages: [], role: session.user.role ?? null });
  }

  const { id } = await params;
  const conv = await prisma.subscriberConversation.findFirst({
    where: { id, subscriberId: actorSubscriberId },
    select: {
      id: true,
      title: true,
      messages: { orderBy: { createdAt: "asc" }, take: 200 },
    },
  });

  if (!conv) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  return Response.json({
    id: conv.id,
    title: conv.title,
    messages: conv.messages.map((m) => ({
      role: m.role,
      content: m.content.replace(COST_TRAILER_STRIP_RE, "").trimEnd(),
    })),
    role: session.user.role ?? null,
  });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session) {
    return Response.json({ error: "Sign in required." }, { status: 401 });
  }

  const actorSubscriberId = await resolveActorSubscriberId(session);
  if (!actorSubscriberId) {
    return Response.json({ error: "Invalid session." }, { status: 401 });
  }

  const { id } = await params;
  // deleteMany scoped to actorSubscriberId — a request for someone else's
  // conversation id just deletes nothing and returns 0 rather than 403'ing.
  // Messages cascade via the schema's onDelete: Cascade relation.
  const result = await prisma.subscriberConversation.deleteMany({
    where: { id, subscriberId: actorSubscriberId },
  });

  if (result.count === 0) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  return Response.json({ ok: true });
}
