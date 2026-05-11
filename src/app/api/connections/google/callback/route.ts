import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { google } from "googleapis";
import { verifyOAuthState } from "@/lib/oauth-state";
import { redactSecrets } from "@/lib/redact";
import {
  fetchConnectedGoogleIdentity,
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

    oauth2Client.setCredentials(tokens);

    // We deliberately don't request identity scopes (`openid`/`email`/`profile`)
    // because mixing them with restricted scopes (`drive.readonly`,
    // `youtube.upload`) trips Google's OAuth 2.0 policy on unverified apps
    // ("Access blocked: invalid_request" before the account chooser even
    // renders). Instead, identify the connected account from the granted
    // scopes themselves: Drive's about.get returns the user's email+name
    // under `drive.readonly`; YouTube's channels.list returns the channel
    // under `youtube.readonly`.
    const identity = await fetchConnectedGoogleIdentity(oauth2Client);

    await upsertGoogleIntegration({
      userId,
      googleSub: identity.permissionId,
      email: identity.email,
      youtubeChannelId: identity.youtubeChannelId,
      youtubeChannelTitle: identity.youtubeChannelTitle,
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
