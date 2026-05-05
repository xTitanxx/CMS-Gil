import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

const ADMIN_PATH_PREFIX = "/admin";
const ADMIN_API_PREFIX = "/api/admin";
const CHAT_PATH = "/chat";
const CHAT_API_PATH = "/api/chat";

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

function isChatRoute(pathname: string): boolean {
  return (
    pathname === CHAT_PATH ||
    pathname.startsWith(CHAT_PATH + "/") ||
    pathname === CHAT_API_PATH ||
    pathname.startsWith(CHAT_API_PATH + "/")
  );
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

  // Virtual Gil chat — subscriber-only (admins also pass through).
  // The /api/chat handler returns 401 JSON for API hits without a session;
  // the page route gets a redirect so visitors land on the sign-in screen.
  if (isChatRoute(pathname)) {
    if (!session) {
      if (pathname.startsWith(CHAT_API_PATH)) {
        return NextResponse.json({ error: "Sign in required." }, { status: 401 });
      }
      const url = req.nextUrl.clone();
      url.pathname = "/welcome";
      url.searchParams.set("next", pathname + search);
      return NextResponse.redirect(url);
    }
  }

  // Archive (`/`, `/p/*`, `/s/*`) is fully public.
  return NextResponse.next();
});

export const config = {
  matcher: [
    // Run on everything except static assets that don't have an extension match
    "/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)",
  ],
};
