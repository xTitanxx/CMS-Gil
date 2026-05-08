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
    // Identity scopes (`email profile`) let us call the userinfo endpoint
    // in the callback to capture which Google account this is. We omit
    // `openid` deliberately — combining it with the restricted
    // `drive.readonly` scope on an unverified app trips Google's OAuth 2.0
    // policy ("Access blocked: invalid_request").
    scope: [
      "email",
      "profile",
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/youtube.upload",
      "https://www.googleapis.com/auth/youtube.readonly",
    ],
    state: createOAuthState({ userId: session.user.id, extra: from }),
  });

  return NextResponse.redirect(authUrl);
}
