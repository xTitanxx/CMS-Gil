import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/encrypt";
import { auth } from "@/lib/auth";
import { verifyOAuthState } from "@/lib/oauth-state";
import { redactSecrets } from "@/lib/redact";

const THREADS_APP_ID = process.env.THREADS_APP_ID!;
const THREADS_APP_SECRET = process.env.THREADS_APP_SECRET!;
const REDIRECT_URI = `${process.env.APP_URL}/api/connections/threads/callback`;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const stateParam = searchParams.get("state");
  const error = searchParams.get("error");

  if (error || !code || !stateParam) {
    return NextResponse.redirect(
      new URL(`/admin/connections?error=threads_denied`, req.url),
    );
  }

  const state = verifyOAuthState(stateParam);
  const session = await auth();
  if (
    !state ||
    !session?.user?.id ||
    session.user.role !== "admin" ||
    session.user.id !== state.userId
  ) {
    return NextResponse.redirect(
      new URL(`/admin/connections?error=threads_state`, req.url),
    );
  }
  const userId = state.userId;

  try {
    // Exchange code for a short-lived token (~1h).
    const shortRes = await fetch("https://graph.threads.net/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: THREADS_APP_ID,
        client_secret: THREADS_APP_SECRET,
        grant_type: "authorization_code",
        redirect_uri: REDIRECT_URI,
        code,
      }),
    });
    const shortData = await shortRes.json();
    if (!shortData.access_token) {
      throw new Error(`Threads token exchange failed: ${JSON.stringify(shortData)}`);
    }

    // Exchange the short-lived token for a long-lived one (60 days).
    const longUrl = new URL("https://graph.threads.net/access_token");
    longUrl.searchParams.set("grant_type", "th_exchange_token");
    longUrl.searchParams.set("client_secret", THREADS_APP_SECRET);
    longUrl.searchParams.set("access_token", shortData.access_token);
    const longRes = await fetch(longUrl.toString());
    const longData = await longRes.json();
    const accessToken = longData.access_token ?? shortData.access_token;
    const expiresIn = longData.expires_in ?? 5183944;

    // Look up the user's Threads id + username.
    const meRes = await fetch(
      `https://graph.threads.net/v1.0/me?fields=id,username&access_token=${accessToken}`,
    );
    const me = await meRes.json();
    const platformUserId = me.id as string | undefined;
    const platformUsername = (me.username as string | undefined) ?? "Threads";

    await prisma.platformToken.upsert({
      where: { userId_platform: { userId, platform: "THREADS" } },
      create: {
        userId,
        platform: "THREADS",
        accessToken: encrypt(accessToken),
        expiresAt: new Date(Date.now() + expiresIn * 1000),
        platformUserId,
        platformUsername,
        scopes: "threads_basic,threads_content_publish",
      },
      update: {
        accessToken: encrypt(accessToken),
        expiresAt: new Date(Date.now() + expiresIn * 1000),
        platformUserId,
        platformUsername,
      },
    });

    return NextResponse.redirect(
      new URL("/admin/connections?success=threads", req.url),
    );
  } catch (err) {
    console.error("Threads callback error:", redactSecrets(err));
    return NextResponse.redirect(
      new URL(`/admin/connections?error=threads_failed`, req.url),
    );
  }
}
