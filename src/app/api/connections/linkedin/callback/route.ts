import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/encrypt";
import { auth } from "@/lib/auth";
import { verifyOAuthState } from "@/lib/oauth-state";
import { redactSecrets } from "@/lib/redact";

const CLIENT_ID = process.env.LINKEDIN_CLIENT_ID!;
const CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET!;
const REDIRECT_URI = `${process.env.APP_URL}/api/connections/linkedin/callback`;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const stateParam = searchParams.get("state");
  const error = searchParams.get("error");

  if (error || !code || !stateParam) {
    return NextResponse.redirect(
      new URL(`/connections?error=linkedin_denied`, req.url)
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
      new URL(`/connections?error=linkedin_state`, req.url)
    );
  }
  const userId = state.userId;

  try {
    // Exchange code for access token
    const tokenRes = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      throw new Error(`Token exchange failed: ${JSON.stringify(tokenData)}`);
    }

    const accessToken: string = tokenData.access_token;
    const expiresIn: number = tokenData.expires_in ?? 5183944;

    // Get LinkedIn profile (sub = person URN ID)
    const profileRes = await fetch("https://api.linkedin.com/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const profile = await profileRes.json();
    const platformUserId: string = profile.sub ?? "";
    const username: string = profile.name ?? profile.email ?? "LinkedIn";

    await prisma.platformToken.upsert({
      where: { userId_platform: { userId, platform: "LINKEDIN" } },
      create: {
        userId,
        platform: "LINKEDIN",
        accessToken: encrypt(accessToken),
        expiresAt: new Date(Date.now() + expiresIn * 1000),
        platformUserId,
        platformUsername: username,
        scopes: "openid profile email w_member_social",
      },
      update: {
        accessToken: encrypt(accessToken),
        expiresAt: new Date(Date.now() + expiresIn * 1000),
        platformUserId,
        platformUsername: username,
      },
    });

    return NextResponse.redirect(new URL("/connections?success=linkedin", req.url));
  } catch (err) {
    console.error("LinkedIn callback error:", redactSecrets(err));
    return NextResponse.redirect(
      new URL("/connections?error=linkedin_failed", req.url)
    );
  }
}
