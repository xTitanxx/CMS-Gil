import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Platform } from "@prisma/client";
import {
  deleteGoogleIntegration,
  getGoogleIntegration,
  hasYouTubeScope,
} from "@/lib/google-integration";

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

  const googleIntegration = await getGoogleIntegration(session.user.id);
  const hasYouTube = hasYouTubeScope(googleIntegration?.scope);

  return NextResponse.json({
    tokens,
    youtube: hasYouTube
      ? {
          connected: true,
          viaGoogle: true,
          email: googleIntegration?.email ?? null,
          channelTitle: googleIntegration?.youtubeChannelTitle ?? null,
        }
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

  // YouTube tokens live in the GoogleIntegration table (shared with Drive
  // since one OAuth grant covers both). Revoke at Google then delete the row.
  // The NextAuth Account row is untouched — admin sign-in keeps working and
  // the user stays logged in.
  if (platform === "YOUTUBE") {
    const integration = await getGoogleIntegration(session.user.id);
    if (integration?.accessToken) {
      // Best-effort: a 400 here usually just means the token already expired;
      // either way we still want to drop our local copy.
      try {
        await fetch(
          `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(integration.accessToken)}`,
          { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" } },
        );
      } catch {
        // ignore
      }
    }
    await deleteGoogleIntegration(session.user.id);
    // Belt-and-suspenders: also scrub the legacy Account-row tokens for users
    // who haven't reconnected since the separation refactor. Safe no-op once
    // they have. Remove with the fallback in google-integration.ts.
    await prisma.account.updateMany({
      where: { userId: session.user.id, provider: "google" },
      data: {
        access_token: null,
        refresh_token: null,
        scope: null,
        expires_at: null,
      },
    });
    return NextResponse.json({ ok: true });
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
