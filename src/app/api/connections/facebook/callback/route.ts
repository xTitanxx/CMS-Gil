import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/encrypt";

const META_APP_ID = process.env.META_APP_ID!;
const META_APP_SECRET = process.env.META_APP_SECRET!;
const REDIRECT_URI = `${process.env.APP_URL}/api/connections/facebook/callback`;

const USER_SCOPES =
  "public_profile,user_posts,read_insights,pages_show_list,pages_read_engagement,pages_manage_posts,pages_manage_engagement";

interface PageAccount {
  id: string;
  name: string;
  access_token: string;
}

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
    // 1. Short-lived user token
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
      throw new Error(
        `Token exchange failed [redirect_uri=${REDIRECT_URI}]: ${JSON.stringify(tokenData)}`
      );
    }

    // 2. Long-lived user token (~60 days)
    const longLivedRes = await fetch(
      `https://graph.facebook.com/v21.0/oauth/access_token?${new URLSearchParams({
        grant_type: "fb_exchange_token",
        client_id: META_APP_ID,
        client_secret: META_APP_SECRET,
        fb_exchange_token: tokenData.access_token,
      })}`
    );
    const longLived = await longLivedRes.json();
    const userAccessToken: string = longLived.access_token ?? tokenData.access_token;
    const userExpiresIn: number = longLived.expires_in ?? 5183944;

    // 3. Personal profile info (for analytics card label)
    const meRes = await fetch(
      `https://graph.facebook.com/v21.0/me?fields=id,name&access_token=${userAccessToken}`
    );
    const meData = await meRes.json();

    // 4. Upsert the FACEBOOK (personal analytics) token
    await prisma.platformToken.upsert({
      where: { userId_platform: { userId, platform: "FACEBOOK" } },
      create: {
        userId,
        platform: "FACEBOOK",
        accessToken: encrypt(userAccessToken),
        expiresAt: new Date(Date.now() + userExpiresIn * 1000),
        platformUserId: meData.id ?? null,
        platformUsername: meData.name ?? "Facebook",
        scopes: USER_SCOPES,
      },
      update: {
        accessToken: encrypt(userAccessToken),
        expiresAt: new Date(Date.now() + userExpiresIn * 1000),
        platformUserId: meData.id ?? null,
        platformUsername: meData.name ?? "Facebook",
        scopes: USER_SCOPES,
      },
    });

    // 5. Fetch pages the user admins, pick the first one, upsert FACEBOOK_PAGE.
    //    A user with zero pages gets no FACEBOOK_PAGE row — they can still use
    //    the analytics connection and the manual copy-to-clipboard row.
    const pagesRes = await fetch(
      `https://graph.facebook.com/v21.0/me/accounts?fields=id,name,access_token&access_token=${userAccessToken}`
    );
    const pagesData = await pagesRes.json();
    const pages: PageAccount[] = Array.isArray(pagesData.data) ? pagesData.data : [];

    if (pages.length > 0) {
      const page = pages[0];
      await prisma.platformToken.upsert({
        where: { userId_platform: { userId, platform: "FACEBOOK_PAGE" } },
        create: {
          userId,
          platform: "FACEBOOK_PAGE",
          accessToken: encrypt(page.access_token),
          // Page access tokens derived from a long-lived user token are themselves
          // long-lived and generally do not expire — leave expiresAt null.
          expiresAt: null,
          platformUserId: page.id,
          platformUsername: page.name,
          scopes: "pages_manage_posts,pages_read_engagement,pages_manage_engagement",
        },
        update: {
          accessToken: encrypt(page.access_token),
          expiresAt: null,
          platformUserId: page.id,
          platformUsername: page.name,
          scopes: "pages_manage_posts,pages_read_engagement,pages_manage_engagement",
        },
      });
    } else {
      // Clear any stale page token from a previous connection.
      await prisma.platformToken.deleteMany({
        where: { userId, platform: "FACEBOOK_PAGE" },
      });
    }

    return NextResponse.redirect(new URL("/connections?success=facebook", req.url));
  } catch (err) {
    console.error("Facebook callback error:", err);
    const msg = encodeURIComponent(String(err).slice(0, 200));
    return NextResponse.redirect(
      new URL(`/connections?error=facebook_failed&detail=${msg}`, req.url)
    );
  }
}
