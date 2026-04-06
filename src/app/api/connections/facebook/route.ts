// Facebook OAuth — Authorization Code Flow (Personal Profile / Professional Mode)
// Docs: https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

const META_APP_ID = process.env.META_APP_ID!;
const REDIRECT_URI = `${process.env.APP_URL}/api/connections/facebook/callback`;

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const params = new URLSearchParams({
    client_id: META_APP_ID,
    redirect_uri: REDIRECT_URI,
    scope: "public_profile,user_posts,read_insights",
    response_type: "code",
    state: session.user.id,
  });

  return NextResponse.redirect(
    `https://www.facebook.com/v21.0/dialog/oauth?${params.toString()}`
  );
}
