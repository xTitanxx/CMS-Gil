import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { google } from "googleapis";
import { createOAuthState } from "@/lib/oauth-state";

const REDIRECT_URI = `${process.env.APP_URL}/api/connections/google/callback`;

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    REDIRECT_URI
  );

  const from = new URL(req.url).searchParams.get("from") ?? "import";

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    // `select_account` forces the Google account chooser even if only one
    // account is signed in, so the admin can connect a Google account that
    // differs from the one used for admin sign-in. `consent` keeps the
    // refresh-token guarantee on subsequent re-grants.
    prompt: "select_account consent",
    // No identity scopes (no `openid`, `email`, or `profile`). Google's
    // OAuth 2.0 policy blocks unverified apps from mixing identity scopes
    // with restricted scopes like `drive.readonly` / `youtube.upload`
    // — the symptom is "Access blocked: invalid_request" rendered before
    // the account chooser, so the user can't even pick which account to
    // connect. We identify the connected account in the callback via
    // `drive.about.get` (allowed under `drive.readonly`) and
    // `youtube.channels.list` (allowed under `youtube.readonly`), which
    // give us email + display name + channel info without an identity
    // scope grant.
    scope: [
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/youtube.upload",
      "https://www.googleapis.com/auth/youtube.readonly",
    ],
    state: createOAuthState({ userId: session.user.id, extra: from }),
  });

  return NextResponse.redirect(authUrl);
}
