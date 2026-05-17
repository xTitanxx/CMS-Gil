import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import { findSubscriberByCode } from "@/lib/subscribers/service";
import { subscriberSignInLimiter } from "@/lib/subscribers/signin-rate-limit";

const providers = [];

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  providers.push(
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      checks: ["state"],
      // Safe given the signIn callback below already gates by allowlist —
      // an attacker can't trigger linking unless their email is allowed.
      // Without this flag, NextAuth throws OAuthAccountNotLinked when an
      // admin pre-creates a User row (no Account yet) and the new admin then
      // signs in with Google for the first time.
      allowDangerousEmailAccountLinking: true,
      authorization: {
        params: {
          // Sign-in is identity only. YouTube + Drive scopes are granted
          // separately via /api/connections/google so the integration tokens
          // live in `GoogleIntegration`, not on the NextAuth `Account` row.
          scope: ["openid", "email", "profile"].join(" "),
        },
      },
    })
  );
}

providers.push(
  Credentials({
    id: "subscriber-credentials",
    name: "Subscriber Code",
    credentials: {
      code: { label: "Access code", type: "text" },
    },
    async authorize(credentials, request) {
      const code = (credentials?.code as string | undefined)?.trim();
      if (!code) return null;

      const ip =
        request?.headers?.get?.("x-forwarded-for")?.split(",")[0]?.trim() ??
        request?.headers?.get?.("x-real-ip") ??
        "unknown";
      const limit = subscriberSignInLimiter.check(ip);
      if (!limit.allowed) return null;

      const sub = await findSubscriberByCode(code);
      if (!sub) return null;
      await prisma.subscriber.update({
        where: { id: sub.id },
        data: { lastSeenAt: new Date() },
      });
      return {
        id: sub.id,
        name: sub.name,
        email: null,
        image: null,
        role: "subscriber",
        subscriberId: sub.id,
      };
    },
  })
);

function isAdminEmailEnv(email: string | null | undefined): boolean {
  if (!email) return false;
  const allowed = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (allowed.length === 0) return false;
  return allowed.includes(email.toLowerCase());
}

// Two-tier allowlist: env var ADMIN_EMAILS (bootstrap, baked at deploy time)
// PLUS the User.isAdmin flag (DB-side, editable from /admin/settings without
// redeploy). Env var wins on a tie — useful when the DB flag was accidentally
// cleared and you need to recover via env.
async function isAllowedAdmin(email: string | null | undefined): Promise<boolean> {
  if (!email) return false;
  if (isAdminEmailEnv(email)) return true;
  try {
    const row = await prisma.user.findUnique({
      where: { email },
      select: { isAdmin: true },
    });
    return !!row?.isAdmin;
  } catch {
    // DB unavailable — fall back to env-var-only allowlist (already returned
    // false above if it would have allowed). This means a transient DB
    // outage during sign-in denies new admins, which is the safer failure mode.
    return false;
  }
}

// 1-year session keeps subscribers (and admins) signed in across visits.
// Cohort skews older — re-entering the access code every few weeks would be
// a deal-breaker. Admin tokens still get a 5-min DB recheck via the jwt
// callback below, so demotion propagates promptly even on long sessions.
const SESSION_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_SECONDS },
  jwt: { maxAge: SESSION_MAX_AGE_SECONDS },
  providers,
  trustHost: true,
  callbacks: {
    async signIn({ user, account }) {
      // Subscribers always allowed (rate-limited at the provider's authorize step).
      if (account?.provider === "subscriber-credentials") return true;
      // Anything else is an admin sign-in (currently only Google OAuth).
      // Two-tier allowlist: ADMIN_EMAILS env (bootstrap) + User.isAdmin (DB).
      const ok = await isAllowedAdmin(user.email);
      if (!ok) {
        console.warn(
          `[signIn] denied admin: provider=${account?.provider} email=${user.email ?? "<null>"}`
        );
      }
      return ok;
    },
    async jwt({ token, user }) {
      if (user) {
        const isSubscriber = user.role === "subscriber";
        token.role = isSubscriber ? "subscriber" : "admin";
        if (isSubscriber) {
          token.sub = user.id;
          token.subscriberId = user.id;
          token.name = user.name ?? null;
          token.email = null;
        } else {
          // Existing admin behavior: collapse co-admins to the owner.
          // Use OWNER_USER_ID env var so auth doesn't depend on a DB call
          // (Neon cold starts can cause the query to fail during sign-in).
          token.sub = process.env.OWNER_USER_ID ?? user.id;
          token.subscriberId = undefined;
          token.email = user.email ?? null;
        }
      }
      // Defense in depth: re-validate admin tokens periodically. Demotion
      // (via Settings UI flipping User.isAdmin → false or removing the email
      // from ADMIN_EMAILS) propagates within ADMIN_RECHECK_MS without paying
      // a DB hit on every request.
      const ADMIN_RECHECK_MS = 5 * 60 * 1000;
      if (token.role === "admin") {
        const now = Date.now();
        const lastCheck = (token.adminCheckedAt as number | undefined) ?? 0;
        if (now - lastCheck > ADMIN_RECHECK_MS) {
          const stillAllowed = await isAllowedAdmin(
            token.email as string | null | undefined
          );
          if (!stillAllowed) {
            token.role = "subscriber";
            token.sub = undefined;
            token.subscriberId = undefined;
            return token;
          }
          token.adminCheckedAt = now;
        }
      }
      return token;
    },
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      // Fail-closed default: a JWT with no role claim (older token, mid-flight
      // upgrade, or any future bug that strips it) becomes a subscriber, not
      // an admin. The jwt callback above only re-validates when role is
      // ALREADY admin, so this default has to be the safe one.
      session.user.role = (token.role ?? "subscriber") as "admin" | "subscriber";
      if (token.subscriberId) {
        session.user.subscriberId = token.subscriberId;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
});
