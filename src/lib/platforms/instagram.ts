// Meta Graph API — Instagram Content Publishing
// Requires: instagram_basic, instagram_content_publish scopes
// Requires Professional (Business or Creator) account

import { getSignedDownloadUrl } from "@/lib/storage";
import { fetchWithTimeout } from "@/lib/platforms/_fetch";

// Same constraint as Facebook (see facebook.ts): Meta's URL fetcher refuses
// URLs containing literal unsafe bytes (spaces in particular). encodeURI
// leaves `:/?#&=` alone so already-valid URLs are unchanged; spaces become
// %20 so the URL survives JSON-decoding by Meta's side.
function encodeForRemoteFetch(url: string): string {
  return encodeURI(url);
}

interface PublishResult {
  platformPostId: string;
  platformUrl?: string;
}

interface InstagramCredentials {
  accessToken: string;
  platformUserId: string; // Instagram Business/Creator account ID
}

export async function postToInstagram(
  creds: InstagramCredentials,
  body: string,
  mediaKeys: string[],
  postType: string = "POST"
): Promise<PublishResult> {
  const { accessToken, platformUserId } = creds;
  const baseUrl = "https://graph.instagram.com/v21.0";

  if (mediaKeys.length === 0) {
    // Text-only posts are not supported on Instagram; post as caption only with a placeholder
    throw new Error("Instagram requires at least one media file");
  }

  if (mediaKeys.length === 1) {
    const mediaUrl = await getSignedDownloadUrl(mediaKeys[0]);
    const isVideo = mediaKeys[0].match(/\.(mp4|mov|avi|webm)$/i);

    // Determine media_type based on postType
    let mediaType: string | undefined;
    if (postType === "STORY") {
      mediaType = "STORIES";
    } else if (postType === "REEL") {
      mediaType = "REELS";
    } else if (isVideo) {
      // POST + video: still goes as REELS on Instagram (default IG behavior)
      mediaType = "REELS";
    }
    // POST + image: no media_type needed (default IMAGE behavior)

    const containerRes = await fetchWithTimeout(
      `${baseUrl}/${platformUserId}/media`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          [isVideo ? "video_url" : "image_url"]: encodeForRemoteFetch(mediaUrl),
          caption: body,
          access_token: accessToken,
          ...(mediaType ? { media_type: mediaType } : {}),
        }),
        timeoutMs: 30_000,
      }
    );

    const container = await containerRes.json();
    if (!container.id) {
      throw new Error(`Instagram container error: ${JSON.stringify(container)}`);
    }

    // Poll until container is ready (for videos and stories)
    if (isVideo || postType === "STORY") {
      await waitForContainer(baseUrl, container.id, accessToken);
    }

    return publishContainer(baseUrl, platformUserId, container.id, accessToken);
  }

  // Carousel post (multiple media)
  const itemIds: string[] = [];
  for (const key of mediaKeys.slice(0, 10)) {
    const mediaUrl = await getSignedDownloadUrl(key);
    const isVideo = key.match(/\.(mp4|mov|avi|webm)$/i);
    const itemRes = await fetchWithTimeout(
      `${baseUrl}/${platformUserId}/media`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          [isVideo ? "video_url" : "image_url"]: encodeForRemoteFetch(mediaUrl),
          is_carousel_item: true,
          access_token: accessToken,
        }),
        timeoutMs: 30_000,
      }
    );
    const item = await itemRes.json();
    if (!item.id) throw new Error(`Carousel item error: ${JSON.stringify(item)}`);
    itemIds.push(item.id);
  }

  const carouselRes = await fetchWithTimeout(
    `${baseUrl}/${platformUserId}/media`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        media_type: "CAROUSEL",
        children: itemIds.join(","),
        caption: body,
        access_token: accessToken,
      }),
      timeoutMs: 30_000,
    }
  );
  const carousel = await carouselRes.json();
  if (!carousel.id) throw new Error(`Carousel container error: ${JSON.stringify(carousel)}`);

  return publishContainer(baseUrl, platformUserId, carousel.id, accessToken);
}

async function publishContainer(
  baseUrl: string,
  userId: string,
  containerId: string,
  accessToken: string
): Promise<PublishResult> {
  const res = await fetchWithTimeout(`${baseUrl}/${userId}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      creation_id: containerId,
      access_token: accessToken,
    }),
    timeoutMs: 30_000,
  });
  const data = await res.json();
  if (!data.id) throw new Error(`Instagram publish error: ${JSON.stringify(data)}`);

  // The returned id is an internal numeric media id, not the shortcode used in
  // https://www.instagram.com/p/{shortcode}/ URLs. Fetch the permalink field to
  // get the real post URL.
  let platformUrl: string | undefined;
  try {
    const permalinkRes = await fetchWithTimeout(
      `${baseUrl}/${data.id}?fields=permalink&access_token=${accessToken}`,
      { timeoutMs: 15_000 },
    );
    const permalinkData = await permalinkRes.json();
    if (typeof permalinkData.permalink === "string") {
      platformUrl = permalinkData.permalink;
    }
  } catch {
    // If the permalink lookup fails, we still return the post id so the publish
    // itself is recorded successfully; platformUrl just stays undefined.
  }

  return {
    platformPostId: data.id,
    platformUrl,
  };
}

// Instagram Reels transcoding routinely takes 90–180s for short videos; the
// previous 60s window was hitting timeout long before IG was actually stuck.
// Poll fast (3s) for the first ~30s when most images finish, then back off to
// 10s for the longer tail so we don't hammer Graph for 4 minutes straight.
async function waitForContainer(
  baseUrl: string,
  containerId: string,
  accessToken: string,
  maxWaitMs = 240_000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const res = await fetchWithTimeout(
      `${baseUrl}/${containerId}?fields=status_code&access_token=${accessToken}`,
      { timeoutMs: 15_000 },
    );
    const data = await res.json();
    const status = data.status_code as string | undefined;
    if (status === "FINISHED") return;
    if (status === "ERROR") {
      throw new Error("Instagram media processing failed");
    }
    if (status === "EXPIRED") {
      // Container TTL elapsed before publish — typically means the media URL
      // we handed Meta became unreachable mid-transcode. Fail fast instead of
      // burning the rest of the budget.
      throw new Error(
        "Instagram container expired before publish (media URL likely unreachable)",
      );
    }
    if (status !== "IN_PROGRESS" && status !== undefined) {
      console.warn("Instagram container status unrecognised", { status });
    }
    const elapsed = Date.now() - start;
    await sleep(elapsed < 30_000 ? 3_000 : 10_000);
  }
  throw new Error("Instagram container processing timed out");
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
