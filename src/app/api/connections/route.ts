import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Platform } from "@prisma/client";
import { encrypt } from "@/lib/encrypt";

// GET /api/connections — list all connected platforms
export async function GET(_req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tokens = await prisma.platformToken.findMany({
    where: { userId: session.user.id },
    select: {
      platform: true,
      platformUsername: true,
      platformUserId: true,
      expiresAt: true,
      updatedAt: true,
    },
  });

  // Also check Google/YouTube connection via NextAuth Account
  const googleAccount = await prisma.account.findFirst({
    where: { userId: session.user.id, provider: "google" },
    select: { scope: true },
  });

  const connectedPlatforms = tokens.map((t) => t.platform);
  const hasYouTube =
    googleAccount?.scope?.includes("youtube") ?? false;

  return NextResponse.json({
    tokens,
    youtube: hasYouTube
      ? { connected: true, viaGoogle: true }
      : { connected: false },
  });
}

// POST /api/connections — save an OAuth token (called after OAuth callback)
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { platform, accessToken, refreshToken, expiresIn, platformUserId, platformUsername, scopes } =
    body as {
      platform: Platform;
      accessToken: string;
      refreshToken?: string;
      expiresIn?: number;
      platformUserId?: string;
      platformUsername?: string;
      scopes?: string;
    };

  if (!platform || !accessToken) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const expiresAt = expiresIn
    ? new Date(Date.now() + expiresIn * 1000)
    : null;

  await prisma.platformToken.upsert({
    where: { userId_platform: { userId: session.user.id, platform } },
    create: {
      userId: session.user.id,
      platform,
      accessToken: encrypt(accessToken),
      refreshToken: refreshToken ? encrypt(refreshToken) : null,
      expiresAt,
      platformUserId,
      platformUsername,
      scopes,
    },
    update: {
      accessToken: encrypt(accessToken),
      refreshToken: refreshToken ? encrypt(refreshToken) : null,
      expiresAt,
      platformUserId,
      platformUsername,
      scopes,
    },
  });

  return NextResponse.json({ ok: true });
}

// DELETE /api/connections?platform=INSTAGRAM — disconnect a platform
export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const platform = req.nextUrl.searchParams.get("platform") as Platform | null;
  if (!platform) {
    return NextResponse.json({ error: "Platform required" }, { status: 400 });
  }

  await prisma.platformToken.deleteMany({
    where: { userId: session.user.id, platform },
  });

  return NextResponse.json({ ok: true });
}
