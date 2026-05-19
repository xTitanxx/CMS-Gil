// Meta Graph API — Threads Content Publishing
// Docs: https://developers.facebook.com/docs/threads/
// Requires scopes: threads_basic, threads_content_publish
// Base URL: https://graph.threads.net/v1.0

import { getSignedDownloadUrl } from "@/lib/storage";
import { fetchWithTimeout } from "@/lib/platforms/_fetch";

const BASE_URL = "https://graph.threads.net/v1.0";

// Meta's URL fetcher refuses URLs with literal spaces or other unsafe bytes.
// encodeURI leaves `:/?#&=` alone so already-valid URLs are unchanged.
function encodeForRemoteFetch(url: string): string {
  return encodeURI(url);
}

interface PublishResult {
  platformPostId: string;
  platformUrl?: string;
}

interface ThreadsCredentials {
  accessToken: string;
  platformUserId: string;
}

function isVideoKey(key: string): boolean {
  return /\.(mp4|mov|avi|webm)$/i.test(key);
}

export async function postToThreads(
  creds: ThreadsCredentials,
  body: string,
  mediaKeys: string[],
  _postType: string = "POST",
): Promise<PublishResult> {
  const { accessToken, platformUserId } = creds;

  if (mediaKeys.length === 0) {
    // Text-only post
    const containerId = await createTextContainer(platformUserId, body, accessToken);
    return publishContainer(platformUserId, containerId, accessToken);
  }

  if (mediaKeys.length === 1) {
    const mediaUrl = await getSignedDownloadUrl(mediaKeys[0]);
    const containerId = isVideoKey(mediaKeys[0])
      ? await createVideoContainer(platformUserId, mediaUrl, body, accessToken)
      : await createImageContainer(platformUserId, mediaUrl, body, accessToken);
    await waitForContainer(containerId, accessToken);
    return publishContainer(platformUserId, containerId, accessToken);
  }

  // Carousel — Threads supports up to 20 items per post.
  const childIds: string[] = [];
  for (const key of mediaKeys.slice(0, 20)) {
    const mediaUrl = await getSignedDownloadUrl(key);
    const id = isVideoKey(key)
      ? await createVideoContainer(platformUserId, mediaUrl, undefined, accessToken, true)
      : await createImageContainer(platformUserId, mediaUrl, undefined, accessToken, true);
    childIds.push(id);
  }
  await Promise.all(childIds.map((id) => waitForContainer(id, accessToken)));

  const carouselId = await createCarouselContainer(
    platformUserId,
    childIds,
    body,
    accessToken,
  );
  await waitForContainer(carouselId, accessToken);
  return publishContainer(platformUserId, carouselId, accessToken);
}

async function createTextContainer(
  userId: string,
  text: string,
  accessToken: string,
): Promise<string> {
  const res = await fetchWithTimeout(`${BASE_URL}/${userId}/threads`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      media_type: "TEXT",
      text,
      access_token: accessToken,
    }),
    timeoutMs: 30_000,
  });
  const data = await res.json();
  if (!data.id) throw new Error(`Threads text container error: ${JSON.stringify(data)}`);
  return data.id;
}

async function createImageContainer(
  userId: string,
  imageUrl: string,
  text: string | undefined,
  accessToken: string,
  isCarouselItem = false,
): Promise<string> {
  const res = await fetchWithTimeout(`${BASE_URL}/${userId}/threads`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      media_type: "IMAGE",
      image_url: encodeForRemoteFetch(imageUrl),
      ...(text !== undefined ? { text } : {}),
      ...(isCarouselItem ? { is_carousel_item: true } : {}),
      access_token: accessToken,
    }),
    timeoutMs: 30_000,
  });
  const data = await res.json();
  if (!data.id) throw new Error(`Threads image container error: ${JSON.stringify(data)}`);
  return data.id;
}

async function createVideoContainer(
  userId: string,
  videoUrl: string,
  text: string | undefined,
  accessToken: string,
  isCarouselItem = false,
): Promise<string> {
  const res = await fetchWithTimeout(`${BASE_URL}/${userId}/threads`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      media_type: "VIDEO",
      video_url: encodeForRemoteFetch(videoUrl),
      ...(text !== undefined ? { text } : {}),
      ...(isCarouselItem ? { is_carousel_item: true } : {}),
      access_token: accessToken,
    }),
    timeoutMs: 30_000,
  });
  const data = await res.json();
  if (!data.id) throw new Error(`Threads video container error: ${JSON.stringify(data)}`);
  return data.id;
}

async function createCarouselContainer(
  userId: string,
  childIds: string[],
  text: string,
  accessToken: string,
): Promise<string> {
  const res = await fetchWithTimeout(`${BASE_URL}/${userId}/threads`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      media_type: "CAROUSEL",
      children: childIds.join(","),
      text,
      access_token: accessToken,
    }),
    timeoutMs: 30_000,
  });
  const data = await res.json();
  if (!data.id) throw new Error(`Threads carousel container error: ${JSON.stringify(data)}`);
  return data.id;
}

// Threads container polling. Image containers usually FINISH on the first
// poll; video containers can take 30–120s. Poll fast for the first ~30s,
// then back off. Mirrors Instagram's strategy in instagram.ts.
async function waitForContainer(
  containerId: string,
  accessToken: string,
  maxWaitMs = 240_000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const res = await fetchWithTimeout(
      `${BASE_URL}/${containerId}?fields=status&access_token=${accessToken}`,
      { timeoutMs: 15_000 },
    );
    const data = await res.json();
    const status = (data.status ?? data.status_code) as string | undefined;
    if (status === "FINISHED") return;
    if (status === "ERROR") throw new Error("Threads media processing failed");
    if (status === "EXPIRED") throw new Error("Threads container expired before publish");
    const elapsed = Date.now() - start;
    await new Promise((r) => setTimeout(r, elapsed < 30_000 ? 3_000 : 10_000));
  }
  throw new Error("Threads container processing timed out");
}

async function publishContainer(
  userId: string,
  containerId: string,
  accessToken: string,
): Promise<PublishResult> {
  const res = await fetchWithTimeout(
    `${BASE_URL}/${userId}/threads_publish`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        creation_id: containerId,
        access_token: accessToken,
      }),
      timeoutMs: 30_000,
    },
  );
  const data = await res.json();
  if (!data.id) throw new Error(`Threads publish error: ${JSON.stringify(data)}`);

  let platformUrl: string | undefined;
  try {
    const permalinkRes = await fetchWithTimeout(
      `${BASE_URL}/${data.id}?fields=permalink&access_token=${accessToken}`,
      { timeoutMs: 15_000 },
    );
    const permalinkData = await permalinkRes.json();
    if (typeof permalinkData.permalink === "string") {
      platformUrl = permalinkData.permalink;
    }
  } catch {
    // Best-effort permalink lookup — publish itself succeeded.
  }

  return { platformPostId: data.id, platformUrl };
}

// Long-lived Threads tokens last 60 days and can be refreshed any time after
// they're 24h old, returning a new 60-day token. Call this before publish
// when the stored token has <7 days remaining.
export async function refreshThreadsToken(accessToken: string): Promise<{
  accessToken: string;
  expiresIn: number;
}> {
  const url = new URL(`${BASE_URL.replace("/v1.0", "")}/refresh_access_token`);
  url.searchParams.set("grant_type", "th_refresh_token");
  url.searchParams.set("access_token", accessToken);
  const res = await fetchWithTimeout(url.toString(), { timeoutMs: 15_000 });
  const data = await res.json();
  if (!data.access_token) {
    throw new Error(`Threads refresh failed: ${JSON.stringify(data)}`);
  }
  return {
    accessToken: data.access_token as string,
    expiresIn: (data.expires_in as number | undefined) ?? 5183944,
  };
}
