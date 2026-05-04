import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session) return Response.json({ error: "Sign in required." }, { status: 401 });

  if (session.user.role !== "subscriber" || !session.user.subscriberId) {
    // Admin: return empty conversation (admin chat is ephemeral)
    return Response.json({ messages: [] });
  }

  const conv = await prisma.subscriberConversation.findFirst({
    where: { subscriberId: session.user.subscriberId },
    orderBy: { updatedAt: "desc" },
    select: { id: true, messages: { orderBy: { createdAt: "asc" }, take: 200 } },
  });
  if (!conv) return Response.json({ messages: [] });

  return Response.json({
    messages: conv.messages.map((m) => ({ role: m.role, content: m.content })),
  });
}
