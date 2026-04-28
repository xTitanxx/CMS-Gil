import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// List the user's conversations, newest first. Empty conversations (no
// messages) are filtered out so the abandoned "New chat" stubs don't show up.
export async function GET() {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await prisma.conversation.findMany({
    where: { userId: session.user.id, messages: { some: {} } },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      updatedAt: true,
      _count: { select: { messages: true } },
    },
    take: 100,
  });

  const conversations = rows.map((r) => ({
    id: r.id,
    title: r.title,
    updatedAt: r.updatedAt,
    messageCount: r._count.messages,
  }));
  return NextResponse.json({ conversations });
}
