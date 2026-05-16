// TikTok OAuth token refresh.
//
// Access tokens last ~24h; refresh tokens last ~365d (and rotate on use).
// Without this, every publish or analytics fetch >24h after the last reconnect
// hit "The access token is invalid or not found in the request." and forced
// the user to walk through the OAuth dance again.

import { prisma } from "@/lib/prisma";
import { encrypt, decrypt } from "@/lib/encrypt";
import { fetchWithTimeout } from "@/lib/platforms/_fetch";

const TIKTOK_CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY!;
const TIKTOK_CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET!;

// Refresh slightly before true expiry so a long upload doesn't start with a
// near-dead token. 5 minutes is well inside the 24h TTL and the cost of a
// premature refresh is one extra HTTP call.
const EXPIRY_SKEW_MS = 5 * 60 * 1000;

export async function getValidTikTokAccessToken(userId: string): Promise<string> {
  const row = await prisma.platformToken.findUnique({
    where: { userId_platform: { userId, platform: "TIKTOK" } },
  });
  if (!row) throw new Error("TikTok not connected");

  const stillValid =
    row.expiresAt && row.expiresAt.getTime() - Date.now() > EXPIRY_SKEW_MS;
  if (stillValid) return decrypt(row.accessToken);

  if (!row.refreshToken) {
    throw new Error(
      "TikTok access token expired and no refresh token stored — reconnect TikTok in /admin/connections",
    );
  }

  const refresh = decrypt(row.refreshToken);

  const res = await fetchWithTimeout(
    "https://open.tiktokapis.com/v2/oauth/token/",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: TIKTOK_CLIENT_KEY,
        client_secret: TIKTOK_CLIENT_SECRET,
        grant_type: "refresh_token",
        refresh_token: refresh,
      }).toString(),
      timeoutMs: 20_000,
    },
  );
  const data = await res.json();
  if (!data.access_token) {
    throw new Error(
      `TikTok refresh failed: ${JSON.stringify(data)} — reconnect TikTok in /admin/connections`,
    );
  }

  // TikTok rotates the refresh token on every refresh; the new one inherits
  // the original's expiry. Persist whatever they returned, falling back to the
  // existing one only if the response is missing the field (shouldn't happen).
  await prisma.platformToken.update({
    where: { userId_platform: { userId, platform: "TIKTOK" } },
    data: {
      accessToken: encrypt(data.access_token),
      refreshToken: data.refresh_token
        ? encrypt(data.refresh_token)
        : row.refreshToken,
      expiresAt: data.expires_in
        ? new Date(Date.now() + data.expires_in * 1000)
        : null,
    },
  });

  return data.access_token;
}
