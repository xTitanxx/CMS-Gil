import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { google } from "googleapis";
import { verifyOAuthState } from "@/lib/oauth-state";
import { redactSecrets } from "@/lib/redact";
import { encryptGoogleToken } from "@/lib/google-tokens";

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

    // Update the existing Google Account record with fresh tokens.
    // Only overwrite refresh_token if Google returned a new one
    // (Google omits it on subsequent authorizations if it's still valid).
    const updateData: Record<string, unknown> = {
      access_token: encryptGoogleToken(tokens.access_token, userId),
      ...(tokens.expiry_date
        ? { expires_at: Math.floor(tokens.expiry_date / 1000) }
        : {}),
      ...(tokens.scope ? { scope: tokens.scope } : {}),
    };
    if (tokens.refresh_token) {
      updateData.refresh_token = encryptGoogleToken(tokens.refresh_token, userId);
    }

    await prisma.account.updateMany({
      where: { userId, provider: "google" },
      data: updateData,
    });

    const successUrl =
      from === "connections" ? "/connections?success=youtube" : "/import?success=google";
    return NextResponse.redirect(new URL(successUrl, req.url));
  } catch (err) {
    console.error("Google callback error:", redactSecrets(err));
    return NextResponse.redirect(new URL(`/import?error=google_failed`, req.url));
  }
}
