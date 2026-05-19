import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const schema = z.object({
  publishRecordId: z.string(),
  permalink: z.string().url(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }
  const userId = session.user.id;

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const { publishRecordId, permalink } = parsed.data;

  // Sanity-check the permalink against the user's stored publication URL so
  // paste mistakes don't get filed as "published".
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { substackPublicationUrl: true },
  });
  if (user?.substackPublicationUrl) {
    try {
      const host = new URL(permalink).host;
      const expectedHost = new URL(user.substackPublicationUrl).host;
      if (host !== expectedHost) {
        return NextResponse.json(
          { error: `permalink host (${host}) doesn't match publication (${expectedHost})` },
          { status: 400 },
        );
      }
    } catch {
      return NextResponse.json({ error: "invalid permalink" }, { status: 400 });
    }
  }

  const record = await prisma.publishRecord.findFirst({
    where: {
      id: publishRecordId,
      platform: "SUBSTACK",
      post: { userId },
    },
    select: { id: true, status: true },
  });
  if (!record) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (record.status === "PUBLISHED") {
    return NextResponse.json({ ok: true, alreadyPublished: true });
  }

  await prisma.publishRecord.update({
    where: { id: record.id },
    data: {
      status: "PUBLISHED",
      publishedAt: new Date(),
      platformUrl: permalink,
    },
  });

  return NextResponse.json({ ok: true });
}
