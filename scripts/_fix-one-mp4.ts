import { promises as fs } from "node:fs";
import { v2 as cloudinary, type UploadApiResponse } from "cloudinary";
import { prisma } from "../src/lib/prisma";
import { mediaKey, hasAudioFromResource } from "../src/lib/storage";
import { guessMimeType } from "../src/lib/facebook-parser";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

async function main() {
  const postId = "cmnp8dsqg0095gvsbaynhu3qj";
  const filePath = "/Users/eitan/Documents/Code-Projects/CMS-Gil.nosync//tmp/1184457369879995.mp4";
  const rel = "your_facebook_activity/posts/media/videos/1184457369879995.mp4";
  const base = "1184457369879995.mp4";

  const post = await prisma.post.findUniqueOrThrow({ where: { id: postId } });
  const stat = await fs.stat(filePath);
  const key = mediaKey(post.userId, base);
  const publicId = key.replace(/\.[^/.]+$/, "");

  const result = await new Promise<UploadApiResponse>((resolve, reject) => {
    cloudinary.uploader.upload_large(
      filePath,
      { public_id: publicId, resource_type: "video", type: "upload", media_metadata: true, chunk_size: 20 * 1024 * 1024 },
      (error, r) => (error ? reject(error) : r ? resolve(r) : reject(new Error("no result")))
    );
  });

  console.log("uploaded:", result.secure_url);

  const existing = await prisma.media.findFirst({ where: { postId, storageKey: key } });
  if (existing) {
    console.log("media row already exists:", existing.id);
  } else {
    const created = await prisma.media.create({
      data: {
        postId,
        storageKey: key,
        originalUri: rel,
        mimeType: guessMimeType(base),
        sizeBytes: stat.size,
        hasAudio: hasAudioFromResource(result),
      },
    });
    console.log("media row:", created.id);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
