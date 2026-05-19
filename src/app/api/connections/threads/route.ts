// Threads OAuth start.
// Docs: https://developers.facebook.com/docs/threads/get-started/get-access-tokens-and-permissions/

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createOAuthState } from "@/lib/oauth-state";

const THREADS_APP_ID = process.env.THREADS_APP_ID!;
const REDIRECT_URI = `${process.env.APP_URL}/api/connections/threads/callback`;

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const params = new URLSearchParams({
    client_id: THREADS_APP_ID,
    redirect_uri: REDIRECT_URI,
    scope: "threads_basic,threads_content_publish",
    response_type: "code",
    state: createOAuthState({ userId: session.user.id }),
  });

  return NextResponse.redirect(
    `https://threads.net/oauth/authorize?${params.toString()}`,
  );
}
