import { createHmac, randomBytes, timingSafeEqual } from "crypto";

// 10-minute window between starting and completing the OAuth dance.
const TTL_MS = 10 * 60 * 1000;

export interface OAuthStatePayload {
  userId: string;
  // Platform-specific extras (e.g. `from=connections|import` for Google).
  extra?: string;
}

function getSecret(): string {
  const s = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? "";
  if (!s) throw new Error("AUTH_SECRET / NEXTAUTH_SECRET not set");
  return s;
}

function sign(data: string): string {
  return createHmac("sha256", getSecret()).update(data).digest("base64url");
}

export function createOAuthState(payload: OAuthStatePayload): string {
  const body = {
    u: payload.userId,
    e: payload.extra ?? null,
    n: randomBytes(8).toString("base64url"),
    x: Date.now() + TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(body), "utf8").toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

export function verifyOAuthState(
  state: string | null | undefined
): OAuthStatePayload | null {
  if (!state) return null;
  const dot = state.indexOf(".");
  if (dot < 0) return null;
  const encoded = state.slice(0, dot);
  const sig = state.slice(dot + 1);
  let expected: string;
  try {
    expected = sign(encoded);
  } catch {
    return null;
  }
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let body: { u?: unknown; e?: unknown; x?: unknown };
  try {
    body = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof body.u !== "string") return null;
  if (typeof body.x !== "number" || body.x < Date.now()) return null;
  const extra = typeof body.e === "string" ? body.e : undefined;
  return { userId: body.u, extra };
}
