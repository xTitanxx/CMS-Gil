import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const body = z.object({
  lifecycle: z.enum(["EVERGREEN", "EPHEMERAL", "SEASONAL", "UNKNOWN"]),
  season: z.enum(["SPRING", "SUMMER", "FALL", "WINTER"]).nullable(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauth" }, { status: 401 });
  const { id } = await params;
  const { lifecycle, season } = body.parse(await req.json());

  const post = await prisma.post.findUnique({ where: { id } });
  if (!post || post.userId !== session.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  await prisma.post.update({
    where: { id },
    data: {
      lifecycle,
      season: lifecycle === "SEASONAL" ? season : null,
      lifecycleOverridden: true,
    },
  });
  return NextResponse.json({ ok: true });
}
