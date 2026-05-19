import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const putSchema = z.object({
  publicationUrl: z.string().url().nullable(),
});

export async function GET() {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { substackPublicationUrl: true },
  });
  return NextResponse.json({
    publicationUrl: user?.substackPublicationUrl ?? null,
  });
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }
  const parsed = putSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  // Normalize: strip trailing slash so we can append `/publish/post` cleanly.
  let url = parsed.data.publicationUrl;
  if (url) url = url.replace(/\/+$/, "");

  await prisma.user.update({
    where: { id: session.user.id },
    data: { substackPublicationUrl: url },
  });

  return NextResponse.json({ ok: true, publicationUrl: url });
}
