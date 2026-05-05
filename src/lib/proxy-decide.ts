// Pure routing decision for src/proxy.ts.
//
// Kept in its own module (no next/server, no next-auth, no Prisma) so the
// allow/deny matrix can be unit-tested without booting the NextAuth runtime.
// proxy.ts is the only call site; everything in this file should stay
// dependency-free.

const ALWAYS_PUBLIC_EXACT = new Set([
  "/welcome",
  "/login",
  "/favicon.ico",
  "/banner.jpg",
  "/avatar.jpg",
  "/manifest.webmanifest",
]);

const ALWAYS_PUBLIC_PREFIXES = [
  "/_next",
  "/api/auth", // NextAuth callbacks (incl. /api/auth/callback/subscriber-credentials)
  "/api/public", // Public archive feed/stories
];

// Public archive — readable by anyone, including unauthenticated visitors.
const PUBLIC_ARCHIVE_EXACT = new Set(["/"]);
const PUBLIC_ARCHIVE_PREFIXES = ["/p/", "/s/"];

// Subscriber-only pages.
const SUBSCRIBER_PAGES_EXACT = new Set(["/chat", "/bookmarks"]);
const SUBSCRIBER_PAGES_PREFIXES = ["/chat/"];

// Subscriber-reachable API endpoints. Exact match only — prefix matching would
// accidentally permit /api/chat/planner (admin-only) under /api/chat.
const SUBSCRIBER_API_EXACT = new Set([
  "/api/chat",
  "/api/chat/budget",
  "/api/chat/conversation",
  "/api/me/engagement",
  "/api/posts/preview", // inline post cards rendered by /chat
]);

// Per-post engagement endpoints:
//   /api/posts/<id>/like
//   /api/posts/<id>/bookmark
//   /api/posts/<id>/comments
//   /api/posts/<id>/comments/<commentId>
const POST_ENGAGEMENT_RE =
  /^\/api\/posts\/[^/]+\/(like|bookmark|comments)(?:\/[^/]+)?$/;

function matchesAnyPrefix(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((p) => pathname === p || pathname.startsWith(p));
}

export function isAlwaysPublic(pathname: string): boolean {
  if (ALWAYS_PUBLIC_EXACT.has(pathname)) return true;
  return ALWAYS_PUBLIC_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
}

export function isPublicArchive(pathname: string): boolean {
  if (PUBLIC_ARCHIVE_EXACT.has(pathname)) return true;
  return matchesAnyPrefix(pathname, PUBLIC_ARCHIVE_PREFIXES);
}

export function isSubscriberSurface(pathname: string): boolean {
  if (SUBSCRIBER_PAGES_EXACT.has(pathname)) return true;
  if (matchesAnyPrefix(pathname, SUBSCRIBER_PAGES_PREFIXES)) return true;
  if (SUBSCRIBER_API_EXACT.has(pathname)) return true;
  if (POST_ENGAGEMENT_RE.test(pathname)) return true;
  return false;
}

export function isAdminOnlyPath(pathname: string): boolean {
  return pathname.startsWith("/admin") || pathname.startsWith("/api/admin");
}

export type ProxyDecision =
  | "allow"
  | "forbid-api"
  | "unauth-api"
  | "redirect-login"
  | "redirect-home"
  | "redirect-welcome";

/**
 * Decide what the proxy should do for a given (role, path) pair.
 *
 * Default-deny model:
 *   - Admin: full access.
 *   - Subscriber: explicit subscriber surface + public archive only.
 *   - Unauthenticated: public archive + endpoints that tolerate no-session.
 *
 * Per-route role checks remain as defense-in-depth, but the default for any
 * new route under /api/* is admin-only without further code changes.
 */
export function decide(
  pathname: string,
  role: "admin" | "subscriber" | undefined
): ProxyDecision {
  const isApi = pathname.startsWith("/api/");

  if (isAlwaysPublic(pathname)) return "allow";

  if (role === "admin") return "allow";

  if (isAdminOnlyPath(pathname)) {
    if (isApi) return "forbid-api";
    return role === "subscriber" ? "redirect-home" : "redirect-login";
  }

  if (role === "subscriber") {
    if (isPublicArchive(pathname) || isSubscriberSurface(pathname)) return "allow";
    return isApi ? "forbid-api" : "redirect-home";
  }

  // Unauthenticated.
  if (isPublicArchive(pathname)) return "allow";
  if (POST_ENGAGEMENT_RE.test(pathname)) return "allow";
  if (pathname === "/api/me/engagement") return "allow";
  return isApi ? "unauth-api" : "redirect-welcome";
}
