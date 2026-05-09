import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

interface SubscribeBody {
  endpoint?: unknown;
  keys?: { p256dh?: unknown; auth?: unknown };
  userAgent?: unknown;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as SubscribeBody;
  const endpoint = typeof body.endpoint === "string" ? body.endpoint : null;
  const p256dh = typeof body.keys?.p256dh === "string" ? body.keys.p256dh : null;
  const authKey = typeof body.keys?.auth === "string" ? body.keys.auth : null;
  const userAgent = typeof body.userAgent === "string" ? body.userAgent : null;
  if (!endpoint || !p256dh || !authKey) {
    return NextResponse.json({ error: "endpoint and keys required" }, { status: 400 });
  }

  // Endpoint is unique — re-subscribing from the same browser updates the row
  // (keys can rotate, and userId can shift if a different account signed in).
  await prisma.pushSubscription.upsert({
    where: { endpoint },
    create: { userId: session.user.id, endpoint, p256dh, auth: authKey, userAgent },
    update: { userId: session.user.id, p256dh, auth: authKey, userAgent },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const endpoint = searchParams.get("endpoint");
  if (!endpoint) {
    return NextResponse.json({ error: "endpoint required" }, { status: 400 });
  }

  await prisma.pushSubscription.deleteMany({
    where: { endpoint, userId: session.user.id },
  });
  return NextResponse.json({ ok: true });
}
