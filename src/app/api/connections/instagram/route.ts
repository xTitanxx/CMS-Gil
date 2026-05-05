// Instagram OAuth via Meta — Authorization Code Flow
// Docs: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createOAuthState } from "@/lib/oauth-state";

const META_APP_ID = process.env.META_APP_ID!;
const REDIRECT_URI = `${process.env.APP_URL}/api/connections/instagram/callback`;

// GET /api/connections/instagram — redirect to Meta OAuth
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const params = new URLSearchParams({
    client_id: META_APP_ID,
    redirect_uri: REDIRECT_URI,
    scope: "instagram_basic,instagram_content_publish,instagram_manage_media",
    response_type: "code",
    state: createOAuthState({ userId: session.user.id }),
  });

  return NextResponse.redirect(
    `https://www.facebook.com/v21.0/dialog/oauth?${params.toString()}`
  );
}
