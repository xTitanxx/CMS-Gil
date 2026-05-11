import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/encrypt";
import { auth } from "@/lib/auth";
import { verifyOAuthState } from "@/lib/oauth-state";
import { redactSecrets } from "@/lib/redact";

const META_APP_ID = process.env.META_APP_ID!;
const META_APP_SECRET = process.env.META_APP_SECRET!;
const REDIRECT_URI = `${process.env.APP_URL}/api/connections/instagram/callback`;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const stateParam = searchParams.get("state");
  const error = searchParams.get("error");

  if (error || !code || !stateParam) {
    return NextResponse.redirect(
      new URL(`/admin/connections?error=instagram_denied`, req.url)
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
      new URL(`/admin/connections?error=instagram_state`, req.url)
    );
  }
  const userId = state.userId;

  try {
    // Exchange code for short-lived token
    const tokenRes = await fetch("https://graph.facebook.com/v21.0/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: META_APP_ID,
        client_secret: META_APP_SECRET,
        redirect_uri: REDIRECT_URI,
        code,
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      throw new Error(`Token exchange failed: ${JSON.stringify(tokenData)}`);
    }

    // Exchange for long-lived token (60 days)
    const longLivedRes = await fetch(
      `https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${META_APP_ID}&client_secret=${META_APP_SECRET}&fb_exchange_token=${tokenData.access_token}`
    );
    const longLived = await longLivedRes.json();
    const accessToken = longLived.access_token ?? tokenData.access_token;
    const expiresIn = longLived.expires_in ?? 5183944;

    // Get Instagram Business Account ID
    const meRes = await fetch(
      `https://graph.facebook.com/v21.0/me/accounts?fields=instagram_business_account&access_token=${accessToken}`
    );
    const meData = await meRes.json();
    const igId = meData.data?.[0]?.instagram_business_account?.id;

    // Get username
    let username = "Instagram";
    if (igId) {
      const igRes = await fetch(
        `https://graph.facebook.com/v21.0/${igId}?fields=username&access_token=${accessToken}`
      );
      const igData = await igRes.json();
      username = igData.username ?? username;
    }

    await prisma.platformToken.upsert({
      where: { userId_platform: { userId, platform: "INSTAGRAM" } },
      create: {
        userId,
        platform: "INSTAGRAM",
        accessToken: encrypt(accessToken),
        expiresAt: new Date(Date.now() + expiresIn * 1000),
        platformUserId: igId ?? undefined,
        platformUsername: username,
        scopes: "instagram_basic,instagram_content_publish",
      },
      update: {
        accessToken: encrypt(accessToken),
        expiresAt: new Date(Date.now() + expiresIn * 1000),
        platformUserId: igId ?? undefined,
        platformUsername: username,
      },
    });

    return NextResponse.redirect(new URL("/admin/connections?success=instagram", req.url));
  } catch (err) {
    console.error("Instagram callback error:", redactSecrets(err));
    return NextResponse.redirect(
      new URL(`/admin/connections?error=instagram_failed`, req.url)
    );
  }
}
