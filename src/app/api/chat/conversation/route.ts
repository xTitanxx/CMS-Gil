import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveActorSubscriberId } from "@/lib/engagement/admin-shadow";

// Defensive strip — old persisted assistant messages or model-parrot artifacts
// may carry the trailer; never expose it to the client on rehydration.
const COST_TRAILER_STRIP_RE = /\n?​?__USAGE_USD:[0-9.]+__/g;

export async function GET() {
  const session = await auth();
  if (!session) return Response.json({ error: "Sign in required." }, { status: 401 });

  const role = session.user.role ?? null;
  // Both roles use the same SubscriberConversation/Message tables; admins
  // write under their shadow subscriber.
  const actorSubscriberId = await resolveActorSubscriberId(session);
  if (!actorSubscriberId) {
    return Response.json({ messages: [], role });
  }

  const conv = await prisma.subscriberConversation.findFirst({
    where: { subscriberId: actorSubscriberId },
    orderBy: { updatedAt: "desc" },
    select: { id: true, messages: { orderBy: { createdAt: "asc" }, take: 200 } },
  });
  if (!conv) return Response.json({ messages: [], role });

  return Response.json({
    messages: conv.messages.map((m) => ({
      role: m.role,
      content: m.content.replace(COST_TRAILER_STRIP_RE, "").trimEnd(),
    })),
    role,
  });
}
