// LinkedIn API v2 — UGC Posts
// Scopes: w_member_social, r_basicprofile

import { getSignedDownloadUrl } from "@/lib/storage";
import { fetchWithTimeout } from "@/lib/platforms/_fetch";

interface PublishResult {
  platformPostId: string;
  platformUrl?: string;
}

interface LinkedInCredentials {
  accessToken: string;
  platformUserId: string; // LinkedIn "sub" / person URN
}

export async function postToLinkedIn(
  creds: LinkedInCredentials,
  body: string,
  mediaKeys: string[]
): Promise<PublishResult> {
  const { accessToken, platformUserId } = creds;
  const authorUrn = `urn:li:person:${platformUserId}`;
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "X-Restli-Protocol-Version": "2.0.0",
  };

  let shareMediaCategory = "NONE";
  const media: object[] = [];

  for (const key of mediaKeys.slice(0, 9)) {
    const isVideo = key.match(/\.(mp4|mov|avi|webm)$/i);
    const mediaUrl = await getSignedDownloadUrl(key);

    if (isVideo) {
      shareMediaCategory = "VIDEO";
      const assetUrn = await registerLinkedInMedia(
        authorUrn,
        "video",
        key,
        mediaUrl,
        accessToken
      );
      media.push({
        status: "READY",
        media: assetUrn,
        title: { text: "Video" },
      });
    } else {
      shareMediaCategory = media.length > 0 ? shareMediaCategory : "IMAGE";
      const assetUrn = await registerLinkedInMedia(
        authorUrn,
        "image",
        key,
        mediaUrl,
        accessToken
      );
      media.push({
        status: "READY",
        media: assetUrn,
        title: { text: "Image" },
      });
    }
  }

  const payload: Record<string, unknown> = {
    author: authorUrn,
    lifecycleState: "PUBLISHED",
    specificContent: {
      "com.linkedin.ugc.ShareContent": {
        shareCommentary: { text: truncateToLimit(body, 3000) },
        shareMediaCategory,
        ...(media.length > 0 ? { media } : {}),
      },
    },
    visibility: {
      "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC",
    },
  };

  const res = await fetchWithTimeout("https://api.linkedin.com/v2/ugcPosts", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    timeoutMs: 30_000,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`LinkedIn post error ${res.status}: ${err}`);
  }

  const postId = res.headers.get("x-restli-id") ?? "";
  return {
    platformPostId: postId,
    platformUrl: postId
      ? `https://www.linkedin.com/feed/update/${postId}/`
      : undefined,
  };
}

async function registerLinkedInMedia(
  authorUrn: string,
  type: "image" | "video",
  key: string,
  mediaUrl: string,
  accessToken: string
): Promise<string> {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "X-Restli-Protocol-Version": "2.0.0",
  };

  // Register upload
  const registerRes = await fetchWithTimeout(
    "https://api.linkedin.com/v2/assets?action=registerUpload",
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        registerUploadRequest: {
          recipes: [
            type === "image"
              ? "urn:li:digitalmediaRecipe:feedshare-image"
              : "urn:li:digitalmediaRecipe:feedshare-video",
          ],
          owner: authorUrn,
          serviceRelationships: [
            {
              relationshipType: "OWNER",
              identifier: "urn:li:userGeneratedContent",
            },
          ],
        },
      }),
      timeoutMs: 30_000,
    }
  );

  const registerData = await registerRes.json();
  const uploadUrl =
    registerData.value?.uploadMechanism?.[
      "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"
    ]?.uploadUrl;
  const assetUrn = registerData.value?.asset;

  if (!uploadUrl || !assetUrn) {
    throw new Error(`LinkedIn register upload failed: ${JSON.stringify(registerData)}`);
  }

  // Stream R2 → LinkedIn instead of buffering the whole video in lambda RAM.
  // Buffering a >300 MB video into an ArrayBuffer (then duplicating it into the
  // PUT body) silently OOM-kills the 1 GB lambda before any catch/deadline
  // can fire, which is what left the publish stuck in PROCESSING. Streaming
  // keeps memory bounded to the fetch internal buffer.
  //
  // LinkedIn's single-PUT upload requires Content-Length; we fetch that via
  // a quick HEAD instead of trusting whatever R2 echoes back on GET.
  const headRes = await fetchWithTimeout(mediaUrl, {
    method: "HEAD",
    timeoutMs: 15_000,
  });
  if (!headRes.ok) {
    throw new Error(
      `LinkedIn media HEAD failed for ${key}: ${headRes.status}`,
    );
  }
  const contentLengthHeader = headRes.headers.get("content-length");
  if (!contentLengthHeader) {
    throw new Error(
      `LinkedIn media HEAD missing Content-Length for ${key}`,
    );
  }
  const contentLength = contentLengthHeader;

  const mediaRes = await fetchWithTimeout(mediaUrl, { timeoutMs: 30_000 });
  if (!mediaRes.ok || !mediaRes.body) {
    throw new Error(
      `LinkedIn media download failed for ${key}: ${mediaRes.status}`,
    );
  }
  const uploadRes = await fetchWithTimeout(uploadUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Length": contentLength,
    },
    // ReadableStream body — Node fetch streams without buffering.
    body: mediaRes.body,
    // @ts-expect-error — duplex required by Node fetch when body is a stream
    duplex: "half",
    timeoutMs: 240_000,
  });
  if (!uploadRes.ok) {
    throw new Error(
      `LinkedIn asset upload failed for ${key}: ${uploadRes.status}`,
    );
  }

  return assetUrn;
}

function truncateToLimit(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return text.slice(0, limit - 3) + "...";
}
