import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getVapidPublicKey } from "@/lib/push/web-push";

// Returns the VAPID public key the client uses when calling
// `pushManager.subscribe`. Auth-gated so we don't leak it broadly, even
// though it's a public-by-spec value.
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const publicKey = getVapidPublicKey();
  if (!publicKey) {
    return NextResponse.json({ error: "VAPID not configured" }, { status: 503 });
  }
  return NextResponse.json({ publicKey });
}
