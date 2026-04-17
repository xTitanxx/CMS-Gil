import { promises as fs } from "node:fs";
import { prisma } from "../src/lib/prisma";
import { mediaKey, uploadBuffer } from "../src/lib/storage";
import { guessMimeType } from "../src/lib/facebook-parser";

async function main() {
  const postId = "cmnp8dsqg0095gvsbaynhu3qj";
  const filePath = "/Users/eitan/Documents/Code-Projects/CMS-Gil.nosync//tmp/1184457369879995.mp4";
  const rel = "your_facebook_activity/posts/media/videos/1184457369879995.mp4";
  const base = "1184457369879995.mp4";

  const post = await prisma.post.findUniqueOrThrow({ where: { id: postId } });
  const stat = await fs.stat(filePath);
  const key = mediaKey(post.userId, base);

  const buf = await fs.readFile(filePath);
  const { url, hasAudio } = await uploadBuffer(key, buf);
  console.log("uploaded:", url);

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
        hasAudio,
      },
    });
    console.log("media row:", created.id);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
