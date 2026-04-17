import { promises as fs } from "fs";
import path from "path";
import { prisma } from "../src/lib/prisma";
import { parseFacebookFile, guessMimeType } from "../src/lib/facebook-parser";
import { uploadBuffer, mediaKey } from "../src/lib/storage";


const EXPORT_ROOT = "/Users/eitan/Documents/Code-Projects/CMS-Gil.nosync/sample-exports/JSONs/Unzipped JSONs";

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const onlyPostId = process.argv.find((a) => a.startsWith("--post="))?.slice(7);

  console.log(`Indexing files under ${EXPORT_ROOT}...`);
  const all = await walk(EXPORT_ROOT);

  const mediaByBasename = new Map<string, string>();
  const mediaByRelpath = new Map<string, string>();
  const jsonFiles: string[] = [];

  for (const file of all) {
    const base = path.basename(file);
    if (file.endsWith(".json")) {
      jsonFiles.push(file);
      continue;
    }
    if (/\.(jpe?g|png|gif|mp4|mov|avi|webm|heic|webp)$/i.test(base)) {
      if (!mediaByBasename.has(base)) mediaByBasename.set(base, file);
      const idx = file.indexOf("your_facebook_activity");
      if (idx >= 0) {
        const rel = file.slice(idx);
        mediaByRelpath.set(rel, file);
      }
    }
  }
  console.log(`  ${mediaByBasename.size} media files, ${jsonFiles.length} JSON files`);

  console.log("Parsing Facebook JSONs...");
  const parsedBySourceId = new Map<string, { uris: string[] }>();
  for (const jf of jsonFiles) {
    try {
      const raw = JSON.parse(await fs.readFile(jf, "utf8"));
      const posts = parseFacebookFile(raw);
      for (const p of posts) {
        const existing = parsedBySourceId.get(p.sourceId);
        if (existing) {
          for (const u of p.mediaUris) if (!existing.uris.includes(u)) existing.uris.push(u);
        } else {
          parsedBySourceId.set(p.sourceId, { uris: [...p.mediaUris] });
        }
      }
    } catch {
      // skip unparseable
    }
  }
  console.log(`  ${parsedBySourceId.size} unique parsed sourceIds`);

  const where = onlyPostId
    ? { id: onlyPostId }
    : { source: "FACEBOOK" as const, media: { none: {} } };

  const withRetry = async <T>(fn: () => Promise<T>, label: string): Promise<T> => {
    let attempt = 0;
    while (true) {
      try {
        return await fn();
      } catch (e) {
        attempt++;
        if (attempt >= 10) throw e;
        const wait = Math.min(1000 * attempt, 5000);
        console.log(`  [RETRY ${attempt}] ${label} failed, waiting ${wait}ms`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  };

  const posts = await withRetry(
    () =>
      prisma.post.findMany({
        where,
        include: { media: true },
        orderBy: { originalDate: "desc" },
      }),
    "findMany"
  );
  console.log(`Found ${posts.length} posts to examine`);

  let recovered = 0;
  let noParse = 0;
  let noFile = 0;

  for (const post of posts) {
    if (!post.sourceId) continue;
    if (post.media.length > 0 && !onlyPostId) continue;
    const parsed = parsedBySourceId.get(post.sourceId);
    if (!parsed) {
      noParse++;
      continue;
    }

    for (const uri of parsed.uris) {
      const exists = post.media.find((m) => m.originalUri === uri);
      if (exists) continue;

      const normalized = uri.replace(/^\/+/, "");
      const base = path.basename(uri);
      const filePath =
        mediaByRelpath.get(normalized) ??
        mediaByRelpath.get(uri) ??
        mediaByBasename.get(base);

      if (!filePath) {
        console.log(`  [MISS] ${post.id} ${post.sourceId} -> ${uri}`);
        noFile++;
        continue;
      }

      const stat = await fs.stat(filePath);
      const filename = base;
      const mimeType = guessMimeType(filename);

      if (dryRun) {
        console.log(`  [DRY] ${post.id} <- ${filePath} (${stat.size} bytes, ${mimeType})`);
        recovered++;
        continue;
      }

      const key = mediaKey(post.userId, filename);
      let hasAudio: boolean | null = null;
      try {
        const buf = await fs.readFile(filePath);
        ({ hasAudio } = await uploadBuffer(key, buf));
      } catch (err) {
        const msg = (err as { message?: string })?.message ?? String(err);
        console.log(`  [FAIL] ${post.id} ${filename} (${(stat.size / 1024 / 1024).toFixed(1)}MB) — ${msg}`);
        noFile++;
        continue;
      }
      let attempt = 0;
      while (true) {
        try {
          await prisma.media.create({
            data: {
              postId: post.id,
              storageKey: key,
              originalUri: uri,
              mimeType,
              sizeBytes: stat.size,
              hasAudio,
            },
          });
          break;
        } catch (e) {
          attempt++;
          if (attempt >= 5) throw e;
          const wait = 1000 * attempt;
          console.log(`  [RETRY ${attempt}] prisma write failed, waiting ${wait}ms`);
          await new Promise((r) => setTimeout(r, wait));
        }
      }
      console.log(`  [OK ] ${post.id} <- ${filename}`);
      recovered++;
    }
  }

  console.log(`\nSummary: recovered=${recovered}  no-parse=${noParse}  no-file=${noFile}  dryRun=${dryRun}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
