// TikTok OAuth 2.0 with PKCE
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { randomBytes } from "crypto";

const TIKTOK_CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY!;
const REDIRECT_URI = `${process.env.NEXTAUTH_URL}/api/connections/tiktok/callback`;

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = codeVerifier; // plain method

  const params = new URLSearchParams({
    client_key: TIKTOK_CLIENT_KEY,
    scope: "user.info.basic,video.publish,video.upload",
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    state: `${session.user.id}|${codeVerifier}`,
    code_challenge: codeChallenge,
    code_challenge_method: "plain",
  });

  const response = NextResponse.redirect(
    `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`
  );

  // Store verifier in cookie (short-lived)
  response.cookies.set("tiktok_cv", codeVerifier, {
    httpOnly: true,
    maxAge: 600,
    path: "/",
    sameSite: "lax",
  });

  return response;
}
