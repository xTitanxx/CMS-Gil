import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/encrypt";

const TIKTOK_CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY!;
const TIKTOK_CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET!;
const REDIRECT_URI = `${process.env.APP_URL}/api/connections/tiktok/callback`;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  if (error || !code || !state) {
    return NextResponse.redirect(
      new URL("/connections?error=tiktok_denied", req.url)
    );
  }

  const [userId, codeVerifier] = state.split("|");

  try {
    const tokenRes = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: TIKTOK_CLIENT_KEY,
        client_secret: TIKTOK_CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: REDIRECT_URI,
        code_verifier: codeVerifier,
      }),
    });

    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      throw new Error(`TikTok token error: ${JSON.stringify(tokenData)}`);
    }

    // Get user info
    const userRes = await fetch(
      "https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name",
      {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      }
    );
    const userData = await userRes.json();
    const openId = userData.data?.user?.open_id ?? tokenData.open_id;
    const displayName = userData.data?.user?.display_name ?? "TikTok";

    await prisma.platformToken.upsert({
      where: { userId_platform: { userId, platform: "TIKTOK" } },
      create: {
        userId,
        platform: "TIKTOK",
        accessToken: encrypt(tokenData.access_token),
        refreshToken: tokenData.refresh_token
          ? encrypt(tokenData.refresh_token)
          : null,
        expiresAt: tokenData.expires_in
          ? new Date(Date.now() + tokenData.expires_in * 1000)
          : null,
        platformUserId: openId,
        platformUsername: displayName,
        scopes: tokenData.scope,
      },
      update: {
        accessToken: encrypt(tokenData.access_token),
        refreshToken: tokenData.refresh_token
          ? encrypt(tokenData.refresh_token)
          : null,
        expiresAt: tokenData.expires_in
          ? new Date(Date.now() + tokenData.expires_in * 1000)
          : null,
        platformUserId: openId,
        platformUsername: displayName,
      },
    });

    const response = NextResponse.redirect(
      new URL("/connections?success=tiktok", req.url)
    );
    response.cookies.delete("tiktok_cv");
    return response;
  } catch (err) {
    console.error("TikTok callback error:", err);
    return NextResponse.redirect(
      new URL("/connections?error=tiktok_failed", req.url)
    );
  }
}
