// TikTok Content Posting API v2
// Scopes: video.publish, video.upload

import { getObject } from "@/lib/storage";

interface PublishResult {
  platformPostId: string;
  platformUrl?: string;
}

interface TikTokCredentials {
  accessToken: string;
}

// TikTok requires chunk_size between 5 MB and 64 MB. Single-chunk uploads
// must have chunk_size === video_size. For multi-chunk, the last chunk
// absorbs the remainder, so total_chunk_count uses Math.floor.
const MIN_CHUNK_SIZE = 5 * 1024 * 1024;
const PREFERRED_CHUNK_SIZE = 10 * 1024 * 1024;

export async function postToTikTok(
  creds: TikTokCredentials,
  body: string,
  mediaKeys: string[]
): Promise<PublishResult> {
  const videoKey = mediaKeys.find((k) =>
    k.match(/\.(mp4|mov|avi|webm)$/i)
  );
  if (!videoKey) {
    throw new Error("TikTok requires a video file");
  }

  const { accessToken } = creds;
  const videoBuffer = await getObject(videoKey);
  const totalBytes = videoBuffer.length;

  let chunkSize: number;
  let chunkCount: number;
  if (totalBytes < MIN_CHUNK_SIZE) {
    // Whole video uploaded as a single sub-min chunk; TikTok allows this when
    // chunk_size === video_size and total_chunk_count === 1.
    chunkSize = totalBytes;
    chunkCount = 1;
  } else {
    chunkSize = PREFERRED_CHUNK_SIZE;
    chunkCount = Math.floor(totalBytes / chunkSize);
  }

  // 1. Initialize upload
  const initRes = await fetch(
    "https://open.tiktokapis.com/v2/post/publish/video/init/",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({
        post_info: {
          title: truncate(body, 150),
          privacy_level: "PUBLIC_TO_EVERYONE",
          disable_duet: false,
          disable_comment: false,
          disable_stitch: false,
          video_cover_timestamp_ms: 1000,
        },
        source_info: {
          source: "FILE_UPLOAD",
          video_size: totalBytes,
          chunk_size: chunkSize,
          total_chunk_count: chunkCount,
        },
      }),
    }
  );

  const initData = await initRes.json();
  if (initData.error?.code !== "ok" && initData.error?.code !== undefined) {
    throw new Error(`TikTok init error: ${JSON.stringify(initData.error)}`);
  }

  const publishId: string = initData.data?.publish_id;
  const uploadUrl: string = initData.data?.upload_url;

  if (!publishId || !uploadUrl) {
    throw new Error(`TikTok init missing fields: ${JSON.stringify(initData)}`);
  }

  // 2. Upload chunks. The last chunk absorbs any remainder bytes so the
  // whole video is uploaded even when totalBytes is not a multiple of
  // chunkSize.
  for (let i = 0; i < chunkCount; i++) {
    const start = i * chunkSize;
    const end = i === chunkCount - 1 ? totalBytes - 1 : start + chunkSize - 1;
    const chunk = videoBuffer.slice(start, end + 1);

    const uploadRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Range": `bytes ${start}-${end}/${totalBytes}`,
        "Content-Type": "video/mp4",
        "Content-Length": String(chunk.length),
      },
      body: chunk,
    });

    if (!uploadRes.ok) {
      throw new Error(`TikTok chunk ${i} upload failed: ${uploadRes.status}`);
    }
  }

  // 3. Poll for publish status
  const platformPostId = await pollTikTokStatus(publishId, accessToken);

  return {
    platformPostId,
    platformUrl: undefined, // TikTok doesn't return URL directly
  };
}

async function pollTikTokStatus(
  publishId: string,
  accessToken: string,
  maxWaitMs = 120000
): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    await sleep(5000);
    const res = await fetch(
      "https://open.tiktokapis.com/v2/post/publish/status/fetch/",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
        },
        body: JSON.stringify({ publish_id: publishId }),
      }
    );
    const data = await res.json();
    const status = data.data?.status;
    if (status === "PUBLISH_COMPLETE") {
      return data.data?.publicaly_available_post_id?.[0] ?? publishId;
    }
    if (status === "FAILED") {
      throw new Error(`TikTok publish failed: ${JSON.stringify(data.data)}`);
    }
  }
  throw new Error("TikTok publish polling timed out");
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max - 3) + "..." : str;
}
