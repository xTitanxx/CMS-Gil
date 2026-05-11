// SSRF guards: every server-side fetch whose URL comes from the client (or
// from a DB row that the client can write) must be checked against a host
// allowlist. Without these, an attacker can point us at IMDS, internal
// services, or any host that returns sensitive data and exfiltrate via the
// download / probe-audio / readiness routes.

function parse(url: string): URL | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u;
  } catch {
    return null;
  }
}

// Cloudflare R2: any URL under R2_PUBLIC_URL is ours. R2_PUBLIC_URL is the
// public base set on Vercel; CLAUDE.md flags it as required for storage.
export function isOurR2Url(url: string): boolean {
  const base = process.env.R2_PUBLIC_URL;
  if (!base) return false;
  const u = parse(url);
  const b = parse(base);
  if (!u || !b) return false;
  if (u.protocol !== b.protocol) return false;
  if (u.host !== b.host) return false;
  // Path scoping: u.pathname must start with b.pathname (typically "/")
  const basePath = b.pathname === "/" ? "/" : b.pathname.replace(/\/$/, "") + "/";
  return u.pathname === b.pathname.replace(/\/$/, "") || u.pathname.startsWith(basePath);
}
