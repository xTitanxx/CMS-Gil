import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Google from "next-auth/providers/google";
import LinkedIn from "next-auth/providers/linkedin";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
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

if (process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET) {
  providers.push(
    LinkedIn({
      clientId: process.env.LINKEDIN_CLIENT_ID,
      clientSecret: process.env.LINKEDIN_CLIENT_SECRET,
      authorization: {
        params: {
          scope: "openid profile email w_member_social r_basicprofile",
        },
      },
    })
  );
}

providers.push(
  Credentials({
    name: "Email",
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" },
    },
    async authorize(credentials) {
      const email = credentials?.email as string | undefined;
      const password = credentials?.password as string | undefined;
      if (!email || !password) return null;

      const user = await prisma.user.findUnique({ where: { email } });
      if (!user?.passwordHash) return null;

      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) return null;

      return { id: user.id, name: user.name, email: user.email, image: user.image };
    },
  })
);

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

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  providers,
  trustHost: true,
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        const isSubscriber = user.role === "subscriber";
        token.role = isSubscriber ? "subscriber" : "admin";
        if (isSubscriber) {
          token.sub = user.id; // subscriber id
          token.subscriberId = user.id;
          token.name = user.name ?? null;
        } else {
          // Existing admin behavior: collapse co-admins to the owner.
          // Use OWNER_USER_ID env var so auth doesn't depend on a DB call
          // (Neon cold starts can cause the query to fail during sign-in).
          token.sub = process.env.OWNER_USER_ID ?? user.id;
          token.subscriberId = undefined;
        }
      }
      return token;
    },
    session({ session, token }) {
      // With JWT strategy, user id comes from token.sub
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
