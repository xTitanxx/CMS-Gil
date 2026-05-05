import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Platform } from "@prisma/client";

async function requireAdmin() {
  const session = await auth();
  if (!session || session.user.role !== "admin") return null;
  return session;
}

// GET /api/connections — list all connected platforms for the admin user.
export async function GET(_req: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

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

  const googleAccount = await prisma.account.findFirst({
    where: { userId: session.user.id, provider: "google" },
    select: { scope: true },
  });

  const hasYouTube = googleAccount?.scope?.includes("youtube") ?? false;

  return NextResponse.json({
    tokens,
    youtube: hasYouTube
      ? { connected: true, viaGoogle: true }
      : { connected: false },
  });
}

// DELETE /api/connections?platform=INSTAGRAM — disconnect a platform.
// (POST was removed — token writes go through the OAuth callbacks only,
// so a client-side POST endpoint would be a token-injection backdoor.)
export async function DELETE(req: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const platform = req.nextUrl.searchParams.get("platform") as Platform | null;
  if (!platform) {
    return NextResponse.json({ error: "Platform required" }, { status: 400 });
  }

  // Disconnecting FACEBOOK cascades to FACEBOOK_PAGE — both are granted by
  // the same OAuth consent, so removing one without the other leaves the user
  // in an inconsistent state.
  const platforms: Platform[] =
    platform === "FACEBOOK" ? ["FACEBOOK", "FACEBOOK_PAGE"] : [platform];

  await prisma.platformToken.deleteMany({
    where: { userId: session.user.id, platform: { in: platforms } },
  });

  return NextResponse.json({ ok: true });
}
