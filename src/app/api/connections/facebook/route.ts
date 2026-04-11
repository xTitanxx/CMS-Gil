// Facebook OAuth — Authorization Code Flow
// Requests both personal-profile analytics scopes and Page publishing scopes
// in a single consent screen, then the callback stores two PlatformToken rows.
// Docs: https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

const META_APP_ID = process.env.META_APP_ID!;
const REDIRECT_URI = `${process.env.APP_URL}/api/connections/facebook/callback`;

// user_posts was deprecated by Meta in 2024 and now causes "Invalid Scopes"
// errors on OAuth dialog. The analytics cron that used /me/posts is broken
// for new connections as a result — out of scope for this feature; revisit
// when analytics is rewritten to read from Page endpoints instead.
const SCOPES = [
  "public_profile",
  "read_insights",
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "pages_manage_engagement",
].join(",");

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const params = new URLSearchParams({
    client_id: META_APP_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    response_type: "code",
    state: session.user.id,
  });

  return NextResponse.redirect(
    `https://www.facebook.com/v21.0/dialog/oauth?${params.toString()}`
  );
}
