import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { decide } from "@/lib/proxy-decide";

// Default-deny role boundary for the whole app.
//
// Three audiences:
//   - Admin: full access. Hard-allowlisted by ADMIN_EMAILS in src/lib/auth.ts.
//   - Subscriber: paid public-archive access. Allowed surface is the explicit
//     allowlist in proxy-decide.ts — anything else returns 403 / redirects.
//   - Unauthenticated: public archive read paths only; everything else
//     redirects to /welcome (pages) or 401s (API).
//
// Routing decisions live in src/lib/proxy-decide.ts so the matrix can be
// unit-tested without booting NextAuth. This file only translates a decision
// into a NextResponse.

export default auth((req) => {
  const { pathname, search } = req.nextUrl;
  const role = req.auth?.user?.role;
  const decision = decide(pathname, role);

  switch (decision) {
    case "allow":
      return NextResponse.next();
    case "forbid-api":
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    case "unauth-api":
      return NextResponse.json({ error: "Sign in required." }, { status: 401 });
    case "redirect-login": {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      url.search = "";
      return NextResponse.redirect(url);
    }
    case "redirect-home": {
      const url = req.nextUrl.clone();
      url.pathname = "/";
      url.search = "";
      return NextResponse.redirect(url);
    }
    case "redirect-welcome": {
      const url = req.nextUrl.clone();
      url.pathname = "/welcome";
      url.search = "";
      url.searchParams.set("next", pathname + search);
      return NextResponse.redirect(url);
    }
  }
});

export const config = {
  matcher: [
    // Run on everything except static assets that don't have an extension match
    "/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)",
  ],
};
