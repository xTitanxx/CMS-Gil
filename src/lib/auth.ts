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
      authorization: {
        params: {
          scope: [
            "openid",
            "email",
            "profile",
            "https://www.googleapis.com/auth/youtube.upload",
            "https://www.googleapis.com/auth/youtube.readonly",
            "https://www.googleapis.com/auth/drive.readonly",
          ].join(" "),
          access_type: "offline",
          prompt: "consent",
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

function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const allowed = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (allowed.length === 0) return false;
  return allowed.includes(email.toLowerCase());
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  providers,
  trustHost: true,
  callbacks: {
    async signIn({ user, account }) {
      // Subscribers always allowed (rate-limited at the provider's authorize step).
      if (account?.provider === "subscriber-credentials") return true;
      // Anything else is an admin sign-in (currently only Google OAuth).
      // Hard-allowlist by email to prevent any random Google account from
      // being promoted to admin / impersonating the owner via OWNER_USER_ID.
      return isAdminEmail(user.email);
    },
    jwt({ token, user }) {
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
      // Defense in depth: re-validate admin tokens on every refresh so that
      // removing an email from ADMIN_EMAILS revokes existing sessions, and so
      // any pre-fix JWTs (issued before the allowlist existed) lose admin.
      if (token.role === "admin" && !isAdminEmail(token.email as string | null | undefined)) {
        token.role = "subscriber";
      }
      return token;
    },
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      session.user.role = (token.role ?? "admin") as "admin" | "subscriber";
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
