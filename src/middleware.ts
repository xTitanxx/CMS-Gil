import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

// Required: this middleware uses Prisma (via auth() -> findSubscriberByCode-adjacent paths
// during session verification), which can't run on the edge runtime.
export const runtime = "nodejs";

const PUBLIC_PROTECTED_PATHS = ["/", "/p", "/s", "/chat"];
const ADMIN_PATH_PREFIX = "/admin";
const ADMIN_API_PREFIX = "/api/admin";
const ALWAYS_PUBLIC = [
  "/welcome",
  "/login",
  "/api/auth", // NextAuth callbacks (incl. /api/auth/callback/subscriber-credentials)
  "/_next",
  "/favicon.ico",
  "/banner.jpg",
  "/avatar.jpg",
  "/manifest.webmanifest",
  "/api/public",
];

function isAlwaysPublic(pathname: string): boolean {
  return ALWAYS_PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

function isPublicProtected(pathname: string): boolean {
  if (pathname === "/") return true;
  return PUBLIC_PROTECTED_PATHS.some((p) => p !== "/" && (pathname === p || pathname.startsWith(p + "/")));
}

export default auth((req) => {
  const { pathname, search } = req.nextUrl;
  if (isAlwaysPublic(pathname)) return NextResponse.next();

  const session = req.auth;
  const role = session?.user?.role;

  // Admin pages + API
  if (pathname.startsWith(ADMIN_PATH_PREFIX) || pathname.startsWith(ADMIN_API_PREFIX)) {
    if (role !== "admin") {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  // Public archive routes — gated by feature flag
  if (process.env.PUBLIC_GATE_ENABLED === "true" && isPublicProtected(pathname)) {
    if (!session) {
      const url = req.nextUrl.clone();
      url.pathname = "/welcome";
      url.searchParams.set("next", pathname + search);
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    // Run on everything except static assets that don't have an extension match
    "/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)",
  ],
};
