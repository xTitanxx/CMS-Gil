import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/encrypt";

const META_APP_ID = process.env.META_APP_ID!;
const META_APP_SECRET = process.env.META_APP_SECRET!;
const REDIRECT_URI = `${process.env.APP_URL}/api/connections/facebook/callback`;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const userId = searchParams.get("state");
  const error = searchParams.get("error");

  if (error || !code || !userId) {
    return NextResponse.redirect(
      new URL("/connections?error=facebook_denied", req.url)
    );
  }

  try {
    // Exchange code for short-lived token
    const tokenRes = await fetch(
      `https://graph.facebook.com/v21.0/oauth/access_token?${new URLSearchParams({
        client_id: META_APP_ID,
        client_secret: META_APP_SECRET,
        redirect_uri: REDIRECT_URI,
        code,
      })}`
    );
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      throw new Error(`Token exchange failed [redirect_uri=${REDIRECT_URI}]: ${JSON.stringify(tokenData)}`);
    }

    // Exchange for long-lived token (~60 days)
    const longLivedRes = await fetch(
      `https://graph.facebook.com/v21.0/oauth/access_token?${new URLSearchParams({
        grant_type: "fb_exchange_token",
        client_id: META_APP_ID,
        client_secret: META_APP_SECRET,
        fb_exchange_token: tokenData.access_token,
      })}`
    );
    const longLived = await longLivedRes.json();
    const accessToken = longLived.access_token ?? tokenData.access_token;
    const expiresIn: number = longLived.expires_in ?? 5183944; // 60 days default

    // Get user profile
    const meRes = await fetch(
      `https://graph.facebook.com/v21.0/me?fields=id,name&access_token=${accessToken}`
    );
    const meData = await meRes.json();

    await prisma.platformToken.upsert({
      where: { userId_platform: { userId, platform: "FACEBOOK" } },
      create: {
        userId,
        platform: "FACEBOOK",
        accessToken: encrypt(accessToken),
        expiresAt: new Date(Date.now() + expiresIn * 1000),
        platformUserId: meData.id ?? null,
        platformUsername: meData.name ?? "Facebook",
        scopes: "public_profile,user_posts,read_insights",
      },
      update: {
        accessToken: encrypt(accessToken),
        expiresAt: new Date(Date.now() + expiresIn * 1000),
        platformUserId: meData.id ?? null,
        platformUsername: meData.name ?? "Facebook",
      },
    });

    return NextResponse.redirect(new URL("/connections?success=facebook", req.url));
  } catch (err) {
    console.error("Facebook callback error:", err);
    const msg = encodeURIComponent(String(err).slice(0, 200));
    return NextResponse.redirect(
      new URL(`/connections?error=facebook_failed&detail=${msg}`, req.url)
    );
  }
}
