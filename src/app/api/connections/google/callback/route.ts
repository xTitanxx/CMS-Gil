import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { google } from "googleapis";
import { verifyOAuthState } from "@/lib/oauth-state";
import { redactSecrets } from "@/lib/redact";
import {
  decodeIdTokenClaims,
  upsertGoogleIntegration,
} from "@/lib/google-integration";

const REDIRECT_URI = `${process.env.APP_URL}/api/connections/google/callback`;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const stateParam = searchParams.get("state");
  const error = searchParams.get("error");

  if (error || !code || !stateParam) {
    return NextResponse.redirect(new URL("/import?error=google_denied", req.url));
  }

  const state = verifyOAuthState(stateParam);
  const session = await auth();
  if (
    !state ||
    !session?.user?.id ||
    session.user.role !== "admin" ||
    session.user.id !== state.userId
  ) {
    return NextResponse.redirect(new URL("/import?error=google_state", req.url));
  }

  const userId = state.userId;
  const from = state.extra ?? "import";

  try {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      REDIRECT_URI
    );

    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.access_token) {
      throw new Error("No access token returned from Google");
    }

    // Identify the Google account that consented. id_token is signed by
    // Google over TLS in this exchange — no need to re-verify locally.
    const claims = tokens.id_token ? decodeIdTokenClaims(tokens.id_token) : null;
    if (!claims) {
      throw new Error("Google did not return identifying claims");
    }

    await upsertGoogleIntegration({
      userId,
      googleSub: claims.sub,
      email: claims.email,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? null,
      expiresAt: tokens.expiry_date ? Math.floor(tokens.expiry_date / 1000) : null,
      scope: tokens.scope ?? null,
    });

    const successUrl =
      from === "connections" ? "/connections?success=youtube" : "/import?success=google";
    return NextResponse.redirect(new URL(successUrl, req.url));
  } catch (err) {
    console.error("Google callback error:", redactSecrets(err));
    return NextResponse.redirect(new URL(`/import?error=google_failed`, req.url));
  }
}
