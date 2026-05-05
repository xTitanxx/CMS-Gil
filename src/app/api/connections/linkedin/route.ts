// LinkedIn OAuth 2.0 — Authorization Code Flow
// Scopes: w_member_social (post), openid profile email (identity)

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createOAuthState } from "@/lib/oauth-state";

const CLIENT_ID = process.env.LINKEDIN_CLIENT_ID!;
const REDIRECT_URI = `${process.env.APP_URL}/api/connections/linkedin/callback`;

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: "openid profile email w_member_social",
    state: createOAuthState({ userId: session.user.id }),
  });

  return NextResponse.redirect(
    `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`
  );
}
