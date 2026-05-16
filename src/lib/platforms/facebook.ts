// Meta Graph API — Facebook Page Content Publishing
// Scopes required on the Page access token: pages_manage_posts,
// pages_read_engagement (for the `id` response field). Requires a Page
// access token (from /me/accounts), not a user access token.

import { getSignedDownloadUrl } from "@/lib/storage";
import { fetchWithTimeout } from "@/lib/platforms/_fetch";

interface PublishResult {
  platformPostId: string;
  platformUrl?: string;
}

interface FacebookCredentials {
  accessToken: string; // Page access token
  platformUserId: string; // Page ID
}

const GRAPH = "https://graph.facebook.com/v21.0";
const VIDEO_RE = /\.(mp4|mov|avi|webm|mkv)$/i;

// FB's URL fetcher rejects URLs that contain literal unsafe characters (most
// commonly spaces — historical R2 keys preserve the source filename verbatim,
// so a clip named "how we transport.mp4" lands as a storageKey with literal
// spaces). URLSearchParams encodes form values once and FB decodes them once,
// which means FB still sees the unsafe URL. encodeURI pre-encodes those bytes
// so after FB's single decode the URL is still %20-encoded and fetchable.
// encodeURI is the right primitive: it leaves `:/?#&=` alone so already-valid
// URLs round-trip unchanged.
function encodeForRemoteFetch(url: string): string {
  return encodeURI(url);
}

// FB Graph code 1 ("API Unknown" — message: "Please reduce the amount of
// data you're asking for, then retry your request") and code 2 ("API
// Service") are documented as transient. Retry the same call a few times
// before surfacing the error to the user.
async function graphPost(path: string, body: URLSearchParams): Promise<Response> {
  const url = `${GRAPH}${path}`;
  let last: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    // 60s per attempt: video posts can chunk-upload server-side and the
    // graph call won't return until Meta finishes ingesting. Raw fetch
    // here would hang indefinitely on a stalled connection and drain the
    // lambda's whole 300s budget.
    const res = await fetchWithTimeout(url, {
      method: "POST",
      body,
      timeoutMs: 60_000,
    });
    if (res.ok) return res;
    let code: number | undefined;
    try {
      code = (await res.clone().json())?.error?.code;
    } catch {}
    if (code !== 1 && code !== 2) return res;
    last = res;
    if (attempt < 2) await new Promise((r) => setTimeout(r, 500 * (attempt + 1) ** 2));
  }
  return last!;
}

export async function postToFacebook(
  creds: FacebookCredentials,
  body: string,
  mediaKeys: string[],
  postType: string = "POST"
): Promise<PublishResult> {
  const { accessToken, platformUserId: pageId } = creds;

  // Text-only feed post
  if (mediaKeys.length === 0) {
    return feedPost(pageId, accessToken, { message: body });
  }

  // Single photo
  if (mediaKeys.length === 1 && !VIDEO_RE.test(mediaKeys[0])) {
    const url = await getSignedDownloadUrl(mediaKeys[0]);
    if (postType === "STORY") {
      return storyPost(pageId, accessToken, { url, isVideo: false });
    }
    return photoPost(pageId, accessToken, { url, caption: body });
  }

  // Single video
  if (mediaKeys.length === 1 && VIDEO_RE.test(mediaKeys[0])) {
    const url = await getSignedDownloadUrl(mediaKeys[0]);
    if (postType === "REEL") {
      return reelPost(pageId, accessToken, { file_url: url, description: body });
    }
    if (postType === "STORY") {
      return storyPost(pageId, accessToken, { url, isVideo: true });
    }
    return videoPost(pageId, accessToken, { file_url: url, description: body });
  }

  // Multiple files — if all photos, make one multi-photo feed post.
  const allPhotos = mediaKeys.every((k) => !VIDEO_RE.test(k));
  if (allPhotos) {
    return multiPhotoPost(pageId, accessToken, mediaKeys, body);
  }

  // Mixed media or multiple videos — fall back to one post per file.
  // The first post carries the caption; subsequent posts carry media only.
  // This keeps the implementation small; we can upgrade to a proper mixed
  // carousel later if it becomes important.
  let firstResult: PublishResult | null = null;
  for (let i = 0; i < mediaKeys.length; i++) {
    const key = mediaKeys[i];
    const caption = i === 0 ? body : "";
    const url = await getSignedDownloadUrl(key);
    const result = VIDEO_RE.test(key)
      ? await videoPost(pageId, accessToken, { file_url: url, description: caption })
      : await photoPost(pageId, accessToken, { url, caption });
    if (i === 0) firstResult = result;
  }
  return firstResult!;
}

async function feedPost(
  pageId: string,
  accessToken: string,
  fields: { message: string }
): Promise<PublishResult> {
  const form = new URLSearchParams({
    message: fields.message,
    published: "true",
    access_token: accessToken,
  });
  const res = await graphPost(`/${pageId}/feed`, form);
  const data = await res.json();
  if (!res.ok || !data.id) {
    throw new Error(`Facebook feed post failed: ${JSON.stringify(data)}`);
  }
  return {
    platformPostId: data.id,
    platformUrl: await fetchPermalink(data.id, accessToken),
  };
}

async function photoPost(
  pageId: string,
  accessToken: string,
  fields: { url: string; caption: string }
): Promise<PublishResult> {
  const form = new URLSearchParams({
    url: encodeForRemoteFetch(fields.url),
    caption: fields.caption,
    published: "true",
    access_token: accessToken,
  });
  const res = await graphPost(`/${pageId}/photos`, form);
  const data = await res.json();
  if (!res.ok || !data.post_id) {
    // published=true must return post_id. If it's absent, the photo uploaded
    // but the page post didn't land — fail instead of recording a broken URL.
    throw new Error(`Facebook photo post failed: ${JSON.stringify(data)}`);
  }
  return {
    platformPostId: data.post_id,
    platformUrl: await fetchPermalink(data.post_id, accessToken),
  };
}

async function videoPost(
  pageId: string,
  accessToken: string,
  fields: { file_url: string; description: string }
): Promise<PublishResult> {
  const form = new URLSearchParams({
    file_url: encodeForRemoteFetch(fields.file_url),
    description: fields.description,
    access_token: accessToken,
  });
  const res = await graphPost(`/${pageId}/videos`, form);
  const data = await res.json();
  if (!res.ok || !data.id) {
    throw new Error(`Facebook video post failed: ${JSON.stringify(data)}`);
  }
  // /videos returns the *video* id, not the wall post id. The video node's
  // permalink_url points at facebook.com/watch/?v=... which opens a
  // standalone player, not the post we just made. Resolve the wall post id
  // via `?fields=post_id` and use that to fetch the post's permalink so
  // "Take me to the post" lands on the actual feed entry.
  const wallPostId = await fetchVideoPostId(data.id, accessToken);
  const idForPermalink = wallPostId ?? data.id;
  return {
    platformPostId: wallPostId ?? data.id,
    platformUrl: await fetchPermalink(idForPermalink, accessToken),
  };
}

async function fetchVideoPostId(
  videoId: string,
  accessToken: string
): Promise<string | undefined> {
  try {
    const res = await fetchWithTimeout(
      `${GRAPH}/${videoId}?fields=post_id&access_token=${accessToken}`,
      { timeoutMs: 15_000 },
    );
    if (!res.ok) return undefined;
    const data = await res.json();
    return typeof data.post_id === "string" ? data.post_id : undefined;
  } catch {
    return undefined;
  }
}

async function reelPost(
  pageId: string,
  accessToken: string,
  fields: { file_url: string; description: string }
): Promise<PublishResult> {
  // Step 1: Initialize the reel upload
  const initForm = new URLSearchParams({
    upload_phase: "start",
    access_token: accessToken,
  });
  const initRes = await fetchWithTimeout(`${GRAPH}/${pageId}/video_reels`, {
    method: "POST",
    body: initForm,
    timeoutMs: 30_000,
  });
  const initData = await initRes.json();
  if (!initRes.ok || !initData.video_id) {
    throw new Error(`Facebook reel init failed: ${JSON.stringify(initData)}`);
  }

  // Step 2: Upload the video binary
  const videoRes = await fetchWithTimeout(fields.file_url, { timeoutMs: 60_000 });
  if (!videoRes.ok) {
    throw new Error(`Facebook reel: R2 fetch failed (${videoRes.status})`);
  }
  const videoBuffer = await videoRes.arrayBuffer();
  const uploadRes = await fetchWithTimeout(
    `${GRAPH}/${initData.video_id}`,
    {
      method: "POST",
      headers: {
        Authorization: `OAuth ${accessToken}`,
        offset: "0",
        file_size: String(videoBuffer.byteLength),
        "Content-Type": "application/octet-stream",
      },
      body: videoBuffer,
      timeoutMs: 120_000,
    }
  );
  const uploadData = await uploadRes.json();
  if (!uploadRes.ok || !uploadData.success) {
    throw new Error(`Facebook reel upload failed: ${JSON.stringify(uploadData)}`);
  }

  // Step 3: Publish the reel
  const publishForm = new URLSearchParams({
    upload_phase: "finish",
    video_id: initData.video_id,
    title: fields.description.slice(0, 100),
    description: fields.description,
    access_token: accessToken,
  });
  const publishRes = await fetchWithTimeout(`${GRAPH}/${pageId}/video_reels`, {
    method: "POST",
    body: publishForm,
    timeoutMs: 30_000,
  });
  const publishData = await publishRes.json();
  if (!publishRes.ok || !publishData.success) {
    throw new Error(`Facebook reel publish failed: ${JSON.stringify(publishData)}`);
  }

  return {
    platformPostId: initData.video_id,
    platformUrl: await fetchPermalink(initData.video_id, accessToken),
  };
}

async function storyPost(
  pageId: string,
  accessToken: string,
  fields: { url: string; isVideo: boolean }
): Promise<PublishResult> {
  const endpoint = fields.isVideo
    ? `${GRAPH}/${pageId}/video_stories`
    : `${GRAPH}/${pageId}/photo_stories`;

  const form = new URLSearchParams({
    [fields.isVideo ? "file_url" : "url"]: encodeForRemoteFetch(fields.url),
    access_token: accessToken,
  });
  const res = await fetchWithTimeout(endpoint, {
    method: "POST",
    body: form,
    timeoutMs: 60_000,
  });
  const data = await res.json();
  if (!res.ok || !(data.success || data.id || data.post_id)) {
    throw new Error(`Facebook story post failed: ${JSON.stringify(data)}`);
  }

  const postId = data.post_id ?? data.id;
  return {
    platformPostId: postId ?? "story",
    platformUrl: postId ? await fetchPermalink(postId, accessToken) : undefined,
  };
}

async function multiPhotoPost(
  pageId: string,
  accessToken: string,
  keys: string[],
  caption: string
): Promise<PublishResult> {
  // 1. Upload each photo unpublished and collect media_fbid values.
  const mediaFbids: string[] = [];
  for (const key of keys) {
    const url = await getSignedDownloadUrl(key);
    const form = new URLSearchParams({
      url: encodeForRemoteFetch(url),
      published: "false",
      access_token: accessToken,
    });
    const res = await graphPost(`/${pageId}/photos`, form);
    const data = await res.json();
    if (!res.ok || !data.id) {
      throw new Error(`Facebook multi-photo upload failed: ${JSON.stringify(data)}`);
    }
    mediaFbids.push(data.id);
  }

  // 2. Create a feed post that references them via attached_media[{n}]={json}.
  //    The PHP-style indexed-key form is what Graph API accepts for
  //    application/x-www-form-urlencoded bodies (same shape used by Meta's
  //    own SDKs).
  const form = new URLSearchParams();
  form.set("message", caption);
  form.set("published", "true");
  form.set("access_token", accessToken);
  mediaFbids.forEach((id, i) => {
    form.set(`attached_media[${i}]`, JSON.stringify({ media_fbid: id }));
  });

  const res = await graphPost(`/${pageId}/feed`, form);
  const data = await res.json();
  if (!res.ok || !data.id) {
    throw new Error(`Facebook multi-photo feed post failed: ${JSON.stringify(data)}`);
  }
  return {
    platformPostId: data.id,
    platformUrl: await fetchPermalink(data.id, accessToken),
  };
}

// Fetches the canonical permalink for a Facebook post id. Hand-constructing
// URLs is brittle — feed posts use `{pageId}_{numeric}`, photos/videos use
// bare numeric ids, and the visible URL shape depends on whether the page has
// a vanity handle. Asking Graph API for it directly mirrors the Instagram
// publish flow (see instagram.ts:124).
async function fetchPermalink(
  postId: string,
  accessToken: string
): Promise<string | undefined> {
  try {
    const res = await fetchWithTimeout(
      `${GRAPH}/${postId}?fields=permalink_url&access_token=${accessToken}`,
      { timeoutMs: 15_000 },
    );
    if (!res.ok) return undefined;
    const data = await res.json();
    const raw =
      typeof data.permalink_url === "string" ? data.permalink_url : undefined;
    if (!raw) return undefined;
    // Some Graph API node types (notably videos and certain page objects)
    // return a path-only string like `/PageName/posts/pfbid...`. Without a
    // host the browser resolves it against cms-gil.vercel.app — broken.
    return raw.startsWith("/") ? `https://www.facebook.com${raw}` : raw;
  } catch {
    return undefined;
  }
}
