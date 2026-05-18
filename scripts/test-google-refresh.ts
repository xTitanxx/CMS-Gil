// Try refreshing the YouTube access token and see what Google returns.
// This isolates whether the issue is refresh-side or upload-side.
import { config } from "dotenv";
config({ path: ".env.local" });
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = process.env.POSTGRES_URL_NON_POOLING;
}
import { google } from "googleapis";
import { prisma } from "../src/lib/prisma";
import { decryptGoogleToken } from "../src/lib/google-tokens";

async function main() {
  const row = await prisma.googleIntegration.findFirstOrThrow({
    where: { scope: { contains: "youtube" } },
  });
  const refreshToken = decryptGoogleToken(row.refreshToken, row.userId);
  console.log("refresh token present:", !!refreshToken);

  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );
  client.setCredentials({ refresh_token: refreshToken ?? undefined });

  try {
    const { credentials } = await client.refreshAccessToken();
    console.log("refresh OK", {
      access_present: !!credentials.access_token,
      expiry_date: credentials.expiry_date
        ? new Date(credentials.expiry_date).toISOString()
        : null,
      scope: credentials.scope,
      refresh_returned: !!credentials.refresh_token,
    });

    // Try a real YouTube call with the freshly minted token.
    client.setCredentials({ access_token: credentials.access_token! });
    const yt = google.youtube({ version: "v3", auth: client });
    const channels = await yt.channels.list({ mine: true, part: ["snippet"] });
    console.log(
      "channels.list OK:",
      channels.data.items?.map((i) => ({ id: i.id, title: i.snippet?.title })),
    );
  } catch (err) {
    console.error("refresh FAILED:", err);
  }
}

main().finally(() => prisma.$disconnect());
