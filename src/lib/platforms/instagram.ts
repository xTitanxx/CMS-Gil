// Meta Graph API — Instagram Content Publishing
// Requires: instagram_basic, instagram_content_publish scopes
// Requires Professional (Business or Creator) account

import { getSignedDownloadUrl } from "@/lib/storage";

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
    const mediaUrl = await getSignedDownloadUrl(mediaKeys[0], 3600);
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

    const containerRes = await fetch(
      `${baseUrl}/${platformUserId}/media`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          [isVideo ? "video_url" : "image_url"]: mediaUrl,
          caption: body,
          access_token: accessToken,
          ...(mediaType ? { media_type: mediaType } : {}),
        }),
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
    const mediaUrl = await getSignedDownloadUrl(key, 3600);
    const isVideo = key.match(/\.(mp4|mov|avi|webm)$/i);
    const itemRes = await fetch(
      `${baseUrl}/${platformUserId}/media`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          [isVideo ? "video_url" : "image_url"]: mediaUrl,
          is_carousel_item: true,
          access_token: accessToken,
        }),
      }
    );
    const item = await itemRes.json();
    if (!item.id) throw new Error(`Carousel item error: ${JSON.stringify(item)}`);
    itemIds.push(item.id);
  }

  const carouselRes = await fetch(
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
  const res = await fetch(`${baseUrl}/${userId}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      creation_id: containerId,
      access_token: accessToken,
    }),
  });
  const data = await res.json();
  if (!data.id) throw new Error(`Instagram publish error: ${JSON.stringify(data)}`);

  // The returned id is an internal numeric media id, not the shortcode used in
  // https://www.instagram.com/p/{shortcode}/ URLs. Fetch the permalink field to
  // get the real post URL.
  let platformUrl: string | undefined;
  try {
    const permalinkRes = await fetch(
      `${baseUrl}/${data.id}?fields=permalink&access_token=${accessToken}`
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

async function waitForContainer(
  baseUrl: string,
  containerId: string,
  accessToken: string,
  maxWaitMs = 60000
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const res = await fetch(
      `${baseUrl}/${containerId}?fields=status_code&access_token=${accessToken}`
    );
    const data = await res.json();
    if (data.status_code === "FINISHED") return;
    if (data.status_code === "ERROR") throw new Error("Instagram media processing failed");
    await sleep(3000);
  }
  throw new Error("Instagram container processing timed out");
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
