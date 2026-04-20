import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Action = "KEEP" | "DELETE" | "TRIAGE";

interface Body {
  action: Action;
  stars?: number;
  reasons?: string[];
  note?: string;
  lifecycle?: string;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const post = await prisma.post.findFirst({
    where: { id, userId: session.user.id },
    select: { id: true },
  });
  if (!post)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body: Body = await req.json();
  const { action, stars, reasons, note, lifecycle } = body;

  if (!["KEEP", "DELETE", "TRIAGE"].includes(action))
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });

  // Apply readiness change
  const now = new Date();
  const postUpdate: Record<string, unknown> = {};

  if (action === "KEEP") {
    postUpdate.readiness = "READY";
  } else if (action === "DELETE") {
    postUpdate.readiness = "ARCHIVED";
    postUpdate.archivedAt = now;
  } else if (action === "TRIAGE") {
    postUpdate.readiness = "NOT_READY";
  }

  if (lifecycle && ["EVERGREEN", "EPHEMERAL", "SEASONAL", "UNKNOWN"].includes(lifecycle)) {
    postUpdate.lifecycle = lifecycle;
    postUpdate.lifecycleOverridden = true;
  }

  await prisma.post.update({ where: { id: post.id }, data: postUpdate });

  // Optional rating upsert
  if (typeof stars === "number" && stars >= 1 && stars <= 5) {
    await prisma.postRating.upsert({
      where: { postId: post.id },
      create: {
        postId: post.id,
        stars,
        reasons: Array.isArray(reasons) ? reasons.filter((r) => typeof r === "string") : [],
        note: typeof note === "string" ? note : null,
      },
      update: {
        stars,
        reasons: Array.isArray(reasons) ? reasons.filter((r) => typeof r === "string") : [],
        note: typeof note === "string" ? note : null,
      },
    });
  }

  return NextResponse.json({ ok: true, action });
}
