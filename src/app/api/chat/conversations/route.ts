import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveActorSubscriberId } from "@/lib/engagement/admin-shadow";
import { deriveTitleFromMessage } from "@/lib/chat/conversation-title";

// Listing + creating the actor's chat conversations. Singular /conversation
// stays for the legacy "most-recent" GET — this is the multi-chat surface.

export async function GET() {
  const session = await auth();
  if (!session) {
    return Response.json({ error: "Sign in required." }, { status: 401 });
  }

  const actorSubscriberId = await resolveActorSubscriberId(session);
  if (!actorSubscriberId) {
    return Response.json({ conversations: [], role: session.user.role ?? null });
  }

  const rows = await prisma.subscriberConversation.findMany({
    where: { subscriberId: actorSubscriberId },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      createdAt: true,
      updatedAt: true,
      // Pull the first user message to use as a fallback title — only needed
      // when title is null (older convs never had one written).
      messages: {
        where: { role: "user" },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { content: true },
      },
    },
    take: 100,
  });

  const conversations = rows.map((c) => ({
    id: c.id,
    title:
      c.title ??
      deriveTitleFromMessage(c.messages[0]?.content ?? "") ??
      "New chat",
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  }));

  return Response.json({
    conversations,
    role: session.user.role ?? null,
  });
}

export async function POST() {
  const session = await auth();
  if (!session) {
    return Response.json({ error: "Sign in required." }, { status: 401 });
  }

  const actorSubscriberId = await resolveActorSubscriberId(session);
  if (!actorSubscriberId) {
    return Response.json({ error: "Invalid session." }, { status: 401 });
  }

  const created = await prisma.subscriberConversation.create({
    data: { subscriberId: actorSubscriberId },
    select: { id: true, createdAt: true, updatedAt: true },
  });

  return Response.json({
    id: created.id,
    title: "New chat",
    createdAt: created.createdAt.toISOString(),
    updatedAt: created.updatedAt.toISOString(),
  });
}

