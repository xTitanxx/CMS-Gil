// YouTube Data API v3 — Video upload
// Scopes: https://www.googleapis.com/auth/youtube.upload

import { google } from "googleapis";
import { getObject, getSignedDownloadUrl } from "@/lib/storage";
import { Readable } from "stream";

interface PublishResult {
  platformPostId: string;
  platformUrl?: string;
}

interface YouTubeCredentials {
  accessToken: string;
  refreshToken?: string;
}

export async function postToYouTube(
  creds: YouTubeCredentials,
  title: string,
  body: string,
  mediaKeys: string[],
  audioOverlayMap?: Map<string, string>
): Promise<PublishResult> {
  const videoKey = mediaKeys.find((k) =>
    k.match(/\.(mp4|mov|avi|webm|mkv)$/i)
  );
  if (!videoKey) {
    throw new Error("YouTube requires a video file");
  }
  const overlayKey = audioOverlayMap?.get(videoKey);

  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  auth.setCredentials({
    access_token: creds.accessToken,
    refresh_token: creds.refreshToken,
  });

  const youtube = google.youtube({ version: "v3", auth });

  let videoBuffer: Buffer;
  if (overlayKey) {
    const url = await getSignedDownloadUrl(videoKey, 3600, "video/mp4", overlayKey);
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Failed to fetch composed video: ${r.status}`);
    videoBuffer = Buffer.from(await r.arrayBuffer());
  } else {
    videoBuffer = await getObject(videoKey);
  }
  const stream = Readable.from(videoBuffer);

  const description = body.includes("#Shorts")
    ? truncate(body, 5000)
    : truncate(body + "\n\n#Shorts", 5000);

  const res = await youtube.videos.insert({
    part: ["snippet", "status"],
    requestBody: {
      snippet: {
        title: truncate(title || body.slice(0, 100), 100),
        description,
        categoryId: "22", // People & Blogs
      },
      status: {
        privacyStatus: "public",
      },
    },
    media: {
      mimeType: "video/*",
      body: stream,
    },
  });

  const videoId = res.data.id!;
  return {
    platformPostId: videoId,
    platformUrl: `https://www.youtube.com/watch?v=${videoId}`,
  };
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max - 3) + "..." : str;
}
