/**
 * Recover missing media for DB posts that were imported as text-only but
 * actually had photos/videos attached in the original Facebook export.
 *
 * Strategy:
 *   1. Walk the FB export tree and index every media file on disk by basename.
 *   2. Walk every `.html` file in the HTML export and extract each
 *      `<section class="_a6-g">` block:
 *         - all media filenames (href/src pointing into posts/media/...)
 *         - body text from `<div class="_3-95">`
 *         - permalink URL from the footer `<a href="...dyi/l/...">`
 *         - footer display date
 *   3. For each DB post with zero media rows, try to find a matching HTML
 *      entry by (in priority order):
 *         a. exact platformUrl match  (works when the post already has a URL)
 *         b. normalized-body match, tiebroken by closest originalDate
 *   4. Upload each missing media file to Cloudinary and create Media rows.
 *
 * Unlike backfill-media.ts, this script bypasses the JSON parser's notion of
 * `sourceId`. The JSON parser sets sourceId = `fb_<timestamp>` for posts
 * whose JSON entry lacked a media attachment, which then cannot be matched to
 * media files whose sourceId is `fb_media_<filename>`. The HTML export does
 * not have this gap — every post section carries its own media link.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/backfill-missing-media.ts               # dry run, all FB posts with no media
 *   npx tsx --env-file=.env.local scripts/backfill-missing-media.ts --apply
 *   npx tsx --env-file=.env.local scripts/backfill-missing-media.ts --post=<id>   # single post
 *   npx tsx --env-file=.env.local scripts/backfill-missing-media.ts --limit=50
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { v2 as cloudinary, type UploadApiResponse } from "cloudinary";
import { prisma } from "../src/lib/prisma";
import { uploadBuffer, mediaKey, hasAudioFromResource } from "../src/lib/storage";
import { guessMimeType } from "../src/lib/facebook-parser";

function fixFBEncoding(str: string): string {
  try {
    return decodeURIComponent(escape(str));
  } catch {
    return str;
  }
}
import { normalizeForSearch } from "../src/lib/search-normalize";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const EXPORT_ROOT =
  "/Users/eitan/Documents/Code-Projects/CMS-Gil.nosync/sample-exports";

const LARGE_THRESHOLD = 90 * 1024 * 1024;
const CLOUDINARY_MAX = 100 * 1024 * 1024;

interface HtmlEntry {
  body: string;
  bodyNormalized: string;
  mediaPaths: string[]; // relative paths as they appear in HTML (href/src)
  platformUrl: string;  // may be "" if footer lacked a link
  footerDate: Date | null;
  sourceFile: string;
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

function decodeHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

const MEDIA_EXT_RE = /\.(jpe?g|png|gif|webp|heic|mp4|mov|m4v|webm|avi)$/i;

function parseSections(html: string, sourceFile: string): HtmlEntry[] {
  const out: HtmlEntry[] = [];
  const chunks = html.split(/<section class="_a6-g"[^>]*>/);
  chunks.shift();

  for (const chunk of chunks) {
    // Collect all media paths referenced in this section (supports galleries).
    const mediaPaths = new Set<string>();
    const mediaRe =
      /(?:href|src)="(your_facebook_activity\/[^"]+?\.(?:jpe?g|png|gif|webp|heic|mp4|mov|m4v|webm|avi))"/gi;
    let m: RegExpExecArray | null;
    while ((m = mediaRe.exec(chunk)) !== null) {
      mediaPaths.add(m[1]);
    }

    const bodyMatch = chunk.match(/<div class="_3-95">([\s\S]*?)<\/div>/);
    const body = bodyMatch ? decodeHtml(bodyMatch[1]) : "";

    // Accept any dyi/l URL — including &s=... ones that backfill-fb-urls
    // skipped. Those are still unique fingerprints even if they redirect
    // to the activity log.
    const urlMatch = chunk.match(
      /<footer[^>]*>[\s\S]*?href="(https:\/\/www\.facebook\.com\/dyi\/l\/[^"]+)"/
    );
    const platformUrl = urlMatch ? urlMatch[1].replace(/&amp;/g, "&") : "";

    const footerDateStr = chunk
      .match(/<footer[\s\S]*?<div class="_a72d">([^<]+)<\/div>/)
      ?.[1]?.trim();
    const footerDate = footerDateStr ? new Date(footerDateStr) : null;

    if (mediaPaths.size === 0) continue; // only care about sections that carry media

    out.push({
      body,
      bodyNormalized: normalizeForSearch(body),
      mediaPaths: [...mediaPaths],
      platformUrl,
      footerDate: footerDate && !Number.isNaN(footerDate.getTime()) ? footerDate : null,
      sourceFile,
    });
  }

  return out;
}

async function uploadLarge(key: string, filePath: string) {
  const publicId = key.replace(/\.[^/.]+$/, "");
  const result = await new Promise<UploadApiResponse>((resolve, reject) => {
    cloudinary.uploader.upload_large(
      filePath,
      {
        public_id: publicId,
        resource_type: "video",
        type: "upload",
        media_metadata: true,
        chunk_size: 20 * 1024 * 1024,
      },
      (error, uploadResult) => {
        if (error) return reject(error);
        if (!uploadResult) return reject(new Error("Cloudinary returned no result"));
        resolve(uploadResult);
      }
    );
  });
  return { hasAudio: hasAudioFromResource(result) };
}

async function main() {
  const dryRun = !process.argv.includes("--apply");
  const onlyPostId = process.argv.find((a) => a.startsWith("--post="))?.slice(7);
  const limitArg = process.argv.find((a) => a.startsWith("--limit="))?.slice(8);
  const limit = limitArg ? parseInt(limitArg, 10) : undefined;

  console.log(`Indexing files under ${EXPORT_ROOT}...`);
  const all = await walk(EXPORT_ROOT);

  const mediaByBasename = new Map<string, string>();
  const mediaByRelpath = new Map<string, string>();
  const htmlFiles: string[] = [];

  for (const file of all) {
    const base = path.basename(file);
    if (MEDIA_EXT_RE.test(base)) {
      if (!mediaByBasename.has(base)) mediaByBasename.set(base, file);
      const idx = file.indexOf("your_facebook_activity");
      if (idx >= 0) {
        const rel = file.slice(idx);
        if (!mediaByRelpath.has(rel)) mediaByRelpath.set(rel, file);
      }
    } else if (file.endsWith(".html")) {
      htmlFiles.push(file);
    }
  }
  console.log(`  ${mediaByBasename.size} media files on disk, ${htmlFiles.length} HTML files`);

  console.log("Parsing HTML sections...");
  const entries: HtmlEntry[] = [];
  for (const hf of htmlFiles) {
    try {
      const html = await fs.readFile(hf, "utf8");
      const parsed = parseSections(html, hf);
      entries.push(...parsed);
    } catch {
      // skip unreadable
    }
  }
  console.log(`  ${entries.length} sections with at least one media reference`);

  // Also parse JSON-native photo sources: your_uncategorized_photos.json and
  // album/*.json. These carry (uri, creation_timestamp, description) with no
  // body-bearing HTML section, so they're invisible to the HTML matcher. We
  // synthesize pseudo-HtmlEntries from them keyed on the description text.
  console.log("Parsing JSON photo manifests...");
  const jsonFiles = all.filter((f) => f.endsWith(".json"));
  let jsonEntryCount = 0;
  for (const jf of jsonFiles) {
    const base = path.basename(jf);
    const isUncat = base === "your_uncategorized_photos.json";
    const isAlbum = jf.includes("/album/") && /\/\d+\.json$/.test(jf);
    if (!isUncat && !isAlbum) continue;
    try {
      const raw = JSON.parse(await fs.readFile(jf, "utf8"));
      const photos: Array<{ uri?: string; creation_timestamp?: number; description?: string }> = isUncat
        ? raw.other_photos_v2 ?? []
        : raw.photos ?? [];
      for (const ph of photos) {
        if (!ph.uri || !ph.creation_timestamp) continue;
        const desc = ph.description ? fixFBEncoding(ph.description) : "";
        if (!desc) continue; // need body to match
        entries.push({
          body: desc,
          bodyNormalized: normalizeForSearch(desc),
          mediaPaths: [ph.uri],
          platformUrl: "",
          footerDate: new Date(ph.creation_timestamp * 1000),
          sourceFile: jf,
        });
        jsonEntryCount++;
      }
    } catch {
      // skip unparseable
    }
  }
  console.log(`  ${jsonEntryCount} synthetic entries from photo JSONs`);

  // Index entries for matching.
  const entriesByUrl = new Map<string, HtmlEntry[]>();
  const entriesByBody = new Map<string, HtmlEntry[]>();
  for (const e of entries) {
    if (e.platformUrl) {
      const arr = entriesByUrl.get(e.platformUrl) ?? [];
      arr.push(e);
      entriesByUrl.set(e.platformUrl, arr);
    }
    if (e.bodyNormalized) {
      const arr = entriesByBody.get(e.bodyNormalized) ?? [];
      arr.push(e);
      entriesByBody.set(e.bodyNormalized, arr);
    }
  }

  // Select posts to process.
  const where = onlyPostId
    ? { id: onlyPostId }
    : { source: "FACEBOOK" as const, media: { none: {} } };

  async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
    for (let attempt = 1; attempt <= 8; attempt++) {
      try {
        return await fn();
      } catch (e) {
        const msg = (e as { message?: string })?.message ?? String(e);
        if (attempt === 8) throw e;
        const wait = Math.min(1000 * attempt, 5000);
        console.log(`  [RETRY ${attempt}] ${label} failed (${msg.slice(0, 60)}), waiting ${wait}ms`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
    throw new Error("unreachable");
  }

  const posts = await withRetry(
    () =>
      prisma.post.findMany({
        where,
        select: {
          id: true,
          userId: true,
          body: true,
          bodyNormalized: true,
          originalDate: true,
          platformUrl: true,
          media: { select: { id: true, originalUri: true } },
        },
        orderBy: { originalDate: "desc" },
        take: limit,
      }),
    "findMany"
  );
  console.log(`Examining ${posts.length} posts\n`);

  let recovered = 0;
  let uploads = 0;
  let unmatched = 0;
  let ambiguous = 0;

  for (const post of posts) {
    if (post.media.length > 0 && !onlyPostId) continue;

    // (a) exact platformUrl match
    let candidates: HtmlEntry[] = [];
    let matchReason = "";
    if (post.platformUrl) {
      const hit = entriesByUrl.get(post.platformUrl);
      if (hit && hit.length > 0) {
        candidates = hit;
        matchReason = "url";
      }
    }

    // (b) normalized body match with date tiebreaker
    if (candidates.length === 0 && post.bodyNormalized) {
      const bodyHits = entriesByBody.get(post.bodyNormalized) ?? [];
      if (bodyHits.length === 1) {
        candidates = bodyHits;
        matchReason = "body";
      } else if (bodyHits.length > 1) {
        let best: HtmlEntry | null = null;
        let bestDelta = Infinity;
        for (const e of bodyHits) {
          if (!e.footerDate) continue;
          const delta = Math.abs(e.footerDate.getTime() - post.originalDate.getTime());
          if (delta < bestDelta) {
            best = e;
            bestDelta = delta;
          }
        }
        // require within 7 days to trust the match
        if (best && bestDelta < 7 * 24 * 3600 * 1000) {
          candidates = [best];
          matchReason = "body+date";
        } else {
          candidates = bodyHits;
          matchReason = "body-ambiguous";
        }
      }
    }

    if (candidates.length === 0) {
      unmatched++;
      if (process.argv.includes("--debug-unmatched")) {
        const bodyPreview = post.body.slice(0, 80).replace(/\n/g, " ");
        console.log(
          `  [UNMATCH] ${post.id} url=${post.platformUrl ? "Y" : "N"} body="${bodyPreview}"`
        );
      }
      continue;
    }
    if (matchReason === "body-ambiguous") {
      ambiguous++;
      console.log(`  [AMBIG] ${post.id} body="${post.body.slice(0, 60)}" → ${candidates.length} candidates`);
      continue;
    }

    // Collect all media paths across matching entries (dedup).
    const seenRel = new Set(
      post.media.map((m) => m.originalUri).filter((u): u is string => !!u)
    );
    const toFetch: string[] = [];
    for (const entry of candidates) {
      for (const rel of entry.mediaPaths) {
        if (!seenRel.has(rel)) {
          seenRel.add(rel);
          toFetch.push(rel);
        }
      }
    }
    if (toFetch.length === 0) continue;

    console.log(
      `  [MATCH:${matchReason}] ${post.id} ← ${toFetch.length} media (${candidates[0].sourceFile
        .split("/")
        .slice(-2)
        .join("/")})`
    );

    for (const rel of toFetch) {
      const base = path.basename(rel);
      const filePath = mediaByRelpath.get(rel) ?? mediaByBasename.get(base);
      if (!filePath) {
        console.log(`    [MISS-FILE] ${rel}`);
        continue;
      }

      const stat = await fs.stat(filePath);
      if (stat.size > CLOUDINARY_MAX) {
        console.log(`    [SKIP-SIZE] ${base} ${(stat.size / 1024 / 1024).toFixed(1)}MB`);
        continue;
      }

      const mimeType = guessMimeType(base);

      if (dryRun) {
        console.log(`    [DRY] ${base} (${(stat.size / 1024 / 1024).toFixed(2)}MB ${mimeType})`);
        uploads++;
        continue;
      }

      const key = mediaKey(post.userId, base);
      let hasAudio: boolean | null = null;
      try {
        if (stat.size > LARGE_THRESHOLD) {
          ({ hasAudio } = await uploadLarge(key, filePath));
        } else {
          const buf = await fs.readFile(filePath);
          ({ hasAudio } = await uploadBuffer(key, buf));
        }
      } catch (err) {
        const msg = (err as { message?: string })?.message ?? String(err);
        console.log(`    [FAIL-UPLOAD] ${base} — ${msg}`);
        continue;
      }

      try {
        await withRetry(
          () =>
            prisma.media.create({
              data: {
                postId: post.id,
                storageKey: key,
                originalUri: rel,
                mimeType,
                sizeBytes: stat.size,
                hasAudio,
              },
            }),
          `media.create ${base}`
        );
      } catch (err) {
        const msg = (err as { message?: string })?.message ?? String(err);
        console.log(`    [FAIL-DB] ${base} — ${msg}`);
        continue;
      }
      console.log(`    [OK] ${base}`);
      uploads++;
    }
    recovered++;
  }

  console.log(
    `\nSummary: posts-recovered=${recovered}  uploads=${uploads}  unmatched=${unmatched}  ambiguous=${ambiguous}  dryRun=${dryRun}`
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
