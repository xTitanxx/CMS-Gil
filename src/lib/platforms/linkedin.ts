// LinkedIn API v2 — UGC Posts
// Scopes: w_member_social, r_basicprofile

import { getSignedDownloadUrl } from "@/lib/storage";

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
    const mediaUrl = await getSignedDownloadUrl(key, 3600);

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

  const res = await fetch("https://api.linkedin.com/v2/ugcPosts", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
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
  const registerRes = await fetch(
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

  // Download and re-upload the media
  const mediaBuffer = await fetch(mediaUrl).then((r) => r.arrayBuffer());
  await fetch(uploadUrl, {
    method: "PUT",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: mediaBuffer,
  });

  return assetUrn;
}

function truncateToLimit(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return text.slice(0, limit - 3) + "...";
}
