import { google, Auth } from "googleapis";
import { prisma } from "@/lib/prisma";
import { decryptGoogleToken, encryptGoogleToken } from "@/lib/google-tokens";
import { redactSecrets } from "@/lib/redact";

export interface GoogleIntegrationTokens {
  accessToken: string;
  refreshToken: string | null;
  scope: string | null;
  expiresAt: number | null;
  email: string | null;
  youtubeChannelId: string | null;
  youtubeChannelTitle: string | null;
}

// Reads the user's Google integration tokens. Prefers the new
// GoogleIntegration row; falls back to the legacy `Account` row (provider:
// "google") if the new table is empty for this user, so existing admins keep
// working until they reconnect once. Remove the fallback in a follow-up commit
// after the prod admin has reconnected.
export async function getGoogleIntegration(
  userId: string,
): Promise<GoogleIntegrationTokens | null> {
  const integration = await prisma.googleIntegration.findUnique({
    where: { userId },
  });

  if (integration) {
    const accessToken = decryptGoogleToken(integration.accessToken, userId);
    if (!accessToken) return null;
    return {
      accessToken,
      refreshToken: decryptGoogleToken(integration.refreshToken, userId),
      scope: integration.scope,
      expiresAt: integration.expiresAt,
      email: integration.email,
      youtubeChannelId: integration.youtubeChannelId,
      youtubeChannelTitle: integration.youtubeChannelTitle,
    };
  }

  // Legacy fallback — pre-separation, integration tokens lived on the
  // NextAuth Account row. Drop after the admin has reconnected once.
  const account = await prisma.account.findFirst({
    where: { userId, provider: "google" },
    select: {
      access_token: true,
      refresh_token: true,
      scope: true,
      expires_at: true,
    },
  });
  if (!account?.access_token) return null;
  const accessToken = decryptGoogleToken(account.access_token, userId);
  if (!accessToken) return null;
  return {
    accessToken,
    refreshToken: decryptGoogleToken(account.refresh_token, userId),
    scope: account.scope,
    expiresAt: account.expires_at,
    email: null,
    youtubeChannelId: null,
    youtubeChannelTitle: null,
  };
}

export function hasYouTubeScope(scope: string | null | undefined): boolean {
  return !!scope && scope.includes("youtube");
}

// Builds an OAuth2 client with credentials set AND a 'tokens' listener that
// persists refreshed access tokens back to the GoogleIntegration row. Without
// this, googleapis refreshes in memory and the new token is discarded, so the
// next request decrypts the same stale value.
export function buildGoogleOAuthClient(
  userId: string,
  tokens: GoogleIntegrationTokens,
): Auth.OAuth2Client {
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );
  client.setCredentials({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken ?? undefined,
    expiry_date: tokens.expiresAt ? tokens.expiresAt * 1000 : undefined,
  });
  client.on("tokens", (refreshed) => {
    void persistRefreshedTokens(userId, refreshed).catch((err) => {
      // Best-effort: a write failure here means we'll just refresh again
      // next request. Don't crash the calling handler.
      console.error("[google-integration] persist refresh failed:", redactSecrets(err));
    });
  });
  return client;
}

async function persistRefreshedTokens(
  userId: string,
  refreshed: Auth.Credentials,
): Promise<void> {
  if (!refreshed.access_token) return;
  // Only update the new table — legacy Account fallback is read-only here so
  // we don't accidentally bring stale rows back to life after disconnect.
  const exists = await prisma.googleIntegration.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (!exists) return;
  await prisma.googleIntegration.update({
    where: { userId },
    data: {
      accessToken: encryptGoogleToken(refreshed.access_token, userId),
      ...(refreshed.expiry_date
        ? { expiresAt: Math.floor(refreshed.expiry_date / 1000) }
        : {}),
      ...(refreshed.refresh_token
        ? { refreshToken: encryptGoogleToken(refreshed.refresh_token, userId) }
        : {}),
      ...(refreshed.scope ? { scope: refreshed.scope } : {}),
    },
  });
}

interface UpsertInput {
  userId: string;
  googleSub: string;
  email: string;
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: number | null;
  scope?: string | null;
  youtubeChannelId?: string | null;
  youtubeChannelTitle?: string | null;
}

export async function upsertGoogleIntegration(input: UpsertInput): Promise<void> {
  const { userId } = input;
  const accessTokenEnc = encryptGoogleToken(input.accessToken, userId);
  const refreshTokenEnc = input.refreshToken
    ? encryptGoogleToken(input.refreshToken, userId)
    : undefined;

  await prisma.googleIntegration.upsert({
    where: { userId },
    create: {
      userId,
      googleSub: input.googleSub,
      email: input.email,
      accessToken: accessTokenEnc,
      refreshToken: refreshTokenEnc ?? null,
      expiresAt: input.expiresAt ?? null,
      scope: input.scope ?? null,
      youtubeChannelId: input.youtubeChannelId ?? null,
      youtubeChannelTitle: input.youtubeChannelTitle ?? null,
    },
    update: {
      googleSub: input.googleSub,
      email: input.email,
      accessToken: accessTokenEnc,
      // Google omits refresh_token on subsequent consents if the prior one is
      // still valid — only overwrite when present.
      ...(refreshTokenEnc ? { refreshToken: refreshTokenEnc } : {}),
      ...(input.expiresAt != null ? { expiresAt: input.expiresAt } : {}),
      ...(input.scope != null ? { scope: input.scope } : {}),
      ...(input.youtubeChannelId !== undefined
        ? { youtubeChannelId: input.youtubeChannelId }
        : {}),
      ...(input.youtubeChannelTitle !== undefined
        ? { youtubeChannelTitle: input.youtubeChannelTitle }
        : {}),
    },
  });
}

export async function deleteGoogleIntegration(userId: string): Promise<void> {
  await prisma.googleIntegration.deleteMany({ where: { userId } });
}

export interface ConnectedGoogleIdentity {
  permissionId: string;
  email: string;
  displayName: string | null;
  youtubeChannelId: string | null;
  youtubeChannelTitle: string | null;
}

// Identify the Google account that just consented, using only the granted
// non-identity scopes. Drive's about.get returns the user's email + display
// name under `drive.readonly`; YouTube's channels.list returns the channel
// under `youtube.readonly`. This avoids requesting `openid`/`email`/`profile`,
// which Google's OAuth 2.0 policy blocks for unverified apps when combined
// with restricted scopes like `drive.readonly` / `youtube.upload`.
export async function fetchConnectedGoogleIdentity(
  oauth2Client: Auth.OAuth2Client,
): Promise<ConnectedGoogleIdentity> {
  const drive = google.drive({ version: "v3", auth: oauth2Client });
  const about = await drive.about.get({
    fields: "user(permissionId,emailAddress,displayName)",
  });
  const user = about.data.user;
  if (!user?.permissionId || !user?.emailAddress) {
    throw new Error("Google Drive did not return user identity");
  }

  let youtubeChannelId: string | null = null;
  let youtubeChannelTitle: string | null = null;
  try {
    const youtube = google.youtube({ version: "v3", auth: oauth2Client });
    const res = await youtube.channels.list({ mine: true, part: ["snippet"] });
    const channel = res.data.items?.[0];
    if (channel?.id) {
      youtubeChannelId = channel.id;
      youtubeChannelTitle = channel.snippet?.title ?? null;
    }
  } catch (err) {
    // Some Google accounts have no YouTube channel — that's fine, the Drive
    // half of the integration still works.
    console.warn(
      "[google-integration] channels.list failed; continuing without channel info:",
      redactSecrets(err),
    );
  }

  return {
    permissionId: user.permissionId,
    email: user.emailAddress,
    displayName: user.displayName ?? null,
    youtubeChannelId,
    youtubeChannelTitle,
  };
}
