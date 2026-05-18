// Inspect the GoogleIntegration row: does it have a refresh token, when does
// the access token expire, and does the scope include youtube?
import { config } from "dotenv";
config({ path: ".env.local" });
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = process.env.POSTGRES_URL_NON_POOLING;
}
import { prisma } from "../src/lib/prisma";

async function main() {
  const integrations = await prisma.googleIntegration.findMany({
    select: {
      userId: true,
      email: true,
      scope: true,
      expiresAt: true,
      youtubeChannelId: true,
      youtubeChannelTitle: true,
      // We don't need the plaintext value — just whether it's non-null/non-empty.
      accessToken: true,
      refreshToken: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  for (const row of integrations) {
    const expiresAt = row.expiresAt
      ? new Date(row.expiresAt * 1000).toISOString()
      : null;
    console.log(
      JSON.stringify(
        {
          userId: row.userId,
          email: row.email,
          scope: row.scope,
          hasAccess: !!row.accessToken,
          accessLen: row.accessToken?.length ?? 0,
          hasRefresh: !!row.refreshToken,
          refreshLen: row.refreshToken?.length ?? 0,
          expiresAt,
          isExpired: row.expiresAt
            ? row.expiresAt * 1000 < Date.now()
            : null,
          youtubeChannelId: row.youtubeChannelId,
          youtubeChannelTitle: row.youtubeChannelTitle,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        },
        null,
        2,
      ),
    );
  }

  console.log("\n--- legacy Google Account rows (fallback) ---");
  const legacy = await prisma.account.findMany({
    where: { provider: "google" },
    select: {
      userId: true,
      scope: true,
      expires_at: true,
      access_token: true,
      refresh_token: true,
    },
  });
  for (const a of legacy) {
    console.log(
      JSON.stringify(
        {
          userId: a.userId,
          scope: a.scope,
          expires_at: a.expires_at
            ? new Date(a.expires_at * 1000).toISOString()
            : null,
          hasAccess: !!a.access_token,
          hasRefresh: !!a.refresh_token,
        },
        null,
        2,
      ),
    );
  }
}

main().finally(() => prisma.$disconnect());
