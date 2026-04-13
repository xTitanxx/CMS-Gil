/**
 * Import posts from a local Facebook export directory (JSON files + media).
 * Optionally enriches with HTML export for platformUrl + date correction.
 *
 * Usage:
 *   node --env-file=.env.local node_modules/.bin/tsx scripts/import-local-export.ts \
 *     --json "./sample-exports/3-4 - 10:4 April JSON" \
 *     --html "./sample-exports/3:4 - 10:4 April HTML" \
 *     [--dry-run]
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { prisma } from "../src/lib/prisma";
import {
  parseFacebookFile,
  dedupeParsedPosts,
  guessMimeType,
  ParsedPost,
} from "../src/lib/facebook-parser";
import { uploadBuffer, mediaKey } from "../src/lib/storage";
import { normalizeForSearch } from "../src/lib/search-normalize";
import { analyzePost } from "../src/lib/analyze-post";

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function flag(name: string): string | null {
  const i = args.indexOf(name);
  if (i === -1) return null;
  return args[i + 1] ?? null;
}
const jsonDir = flag("--json");
const htmlDir = flag("--html");
const dryRun = args.includes("--dry-run");

if (!jsonDir) {
  console.error("Usage: ... --json <dir> [--html <dir>] [--dry-run]");
  process.exit(1);
}

// ── HTML parser (inline, mirrors backfill-fb-urls.ts) ─────────────────────────
interface HtmlEntry {
  body: string;
  mediaFilenames: string[];
  platformUrl: string;
  footerDate: Date | null;
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

function parseFbHtml(html: string): HtmlEntry[] {
  const out: HtmlEntry[] = [];
  const chunks = html.split(/<section class="_a6-g"[^>]*>/);
  chunks.shift();

  for (const chunk of chunks) {
    // Collect ALL media filenames (not just the first)
    const mediaMatches = [
      ...chunk.matchAll(
        /(?:href|src)="(your_facebook_activity\/[^"]+\.(?:jpg|jpeg|png|webp|gif|mp4|mov|m4v))"/gi
      ),
    ];
    const mediaFilenames = mediaMatches.map((m) =>
      path.basename(m[1]).replace(/\?.*$/, "")
    );

    const bodyMatch = chunk.match(/<div class="_3-95">([\s\S]*?)<\/div>/);
    const body = bodyMatch ? decodeHtml(bodyMatch[1]) : "";

    const urlMatch = chunk.match(
      /<footer[^>]*>[\s\S]*?href="(https:\/\/www\.facebook\.com\/dyi\/l\/[^"]+)"/
    );
    const platformUrl = urlMatch ? urlMatch[1].replace(/&amp;/g, "&") : "";
    if (!platformUrl) continue;

    const dateMatch = chunk.match(
      /<footer[^>]*>[\s\S]*?<div class="_a72d">(.*?)<\/div>/
    );
    let footerDate: Date | null = null;
    if (dateMatch) {
      const parsed = new Date(dateMatch[1]);
      if (!isNaN(parsed.getTime())) footerDate = parsed;
    }

    out.push({ body, mediaFilenames, platformUrl, footerDate });
  }
  return out;
}

// ── Gather JSON files ─────────────────────────────────────────────────────────
function findJsonFiles(dir: string): string[] {
  const files: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      files.push(...findJsonFiles(full));
    } else if (e.name.endsWith(".json") && !e.name.startsWith(".")) {
      files.push(full);
    }
  }
  return files;
}

// Files we know are not importable post data
const SKIP_FILES = new Set([
  "let_anyone_mention_you_setting.json",
  "your_received_shared_album_invites.json",
  "content_sharing_links_you_have_created.json",
  "places_you_have_been_tagged_in.json",
  "media_used_for_memories.json",
  "shared_memories.json",
  "edits_you_made_to_posts.json",
  "trash.json",
  "your_uncategorized_photos.json",
  "story_reactions.json",
  "reels_creator_achievements_settings.json",
]);

// ── Concurrency helper ────────────────────────────────────────────────────────
function semaphore(limit: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= limit) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    active++;
    try {
      return await fn();
    } finally {
      active--;
      queue.shift()?.();
    }
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const user = await prisma.user.findFirst();
  if (!user) throw new Error("No user found in DB");
  const userId = user.id;
  console.log(`User: ${userId}`);

  // 1. Parse all JSON files
  const jsonFiles = findJsonFiles(jsonDir!);
  console.log(`\nFound ${jsonFiles.length} JSON files in ${jsonDir}`);

  let allParsed: ParsedPost[] = [];
  for (const file of jsonFiles) {
    const basename = path.basename(file);
    if (SKIP_FILES.has(basename)) {
      console.log(`  skip: ${basename}`);
      continue;
    }
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    const parsed = parseFacebookFile(raw);
    if (parsed.length > 0) {
      console.log(`  ${basename}: ${parsed.length} posts`);
      allParsed.push(...parsed);
    } else {
      console.log(`  ${basename}: 0 posts (no importable data)`);
    }
  }

  // 2. Dedupe
  const deduped = dedupeParsedPosts(allParsed);
  console.log(`\nParsed ${allParsed.length} → deduped to ${deduped.length}`);

  // 3. Build HTML lookup for URL enrichment
  let htmlByMedia = new Map<string, HtmlEntry>();
  let htmlByBody = new Map<string, HtmlEntry[]>();

  if (htmlDir) {
    const htmlFiles = findHtmlFiles(htmlDir);
    console.log(`\nFound ${htmlFiles.length} HTML files in ${htmlDir}`);
    let totalEntries = 0;
    for (const file of htmlFiles) {
      const html = fs.readFileSync(file, "utf8");
      const entries = parseFbHtml(html);
      totalEntries += entries.length;
      for (const entry of entries) {
        // Skip URLs with &s= parameter — those come from your_posts__*.html and
        // archived_stories.html and redirect to the activity log, not the actual
        // post. Album and video HTML files produce working direct-link URLs
        // (without &s=).
        if (entry.platformUrl.includes("&s=")) continue;
        for (const fn of entry.mediaFilenames) {
          htmlByMedia.set(fn, entry);
        }
        if (entry.body) {
          const key = normalizeForSearch(entry.body);
          const arr = htmlByBody.get(key) ?? [];
          arr.push(entry);
          htmlByBody.set(key, arr);
        }
      }
    }
    console.log(`  HTML entries with URLs: ${totalEntries}`);
  }

  // 4. Check which already exist
  const existingSourceIds = new Set(
    (
      await prisma.post.findMany({
        where: { userId, sourceId: { in: deduped.map((p) => p.sourceId) } },
        select: { sourceId: true },
      })
    ).map((p) => p.sourceId)
  );

  const toImport = deduped.filter((p) => !existingSourceIds.has(p.sourceId));
  const skipping = deduped.length - toImport.length;
  console.log(
    `\nTo import: ${toImport.length} new posts (skipping ${skipping} already in DB)`
  );

  if (dryRun) {
    console.log("\n[DRY RUN] Would import:");
    for (const p of toImport) {
      console.log(
        `  ${p.sourceId} | ${p.originalDate.toISOString().slice(0, 16)} | ${p.mediaUris.length}media | ${p.body.slice(0, 50) || "(no body)"}`
      );
    }
    await prisma.$disconnect();
    return;
  }

  // 5. Import
  const throttle = semaphore(5);
  const tagPromises: Promise<void>[] = [];
  let imported = 0;
  let errors: string[] = [];

  // Resolve base path for media files relative to JSON dir
  // JSON media URIs look like "your_facebook_activity/posts/media/..." but the
  // files are at "<jsonDir>/posts/media/..." or "<jsonDir>/stories/media/..."
  function resolveMediaPath(uri: string): string | null {
    // Try direct relative from JSON dir
    const stripped = uri.replace(/^your_facebook_activity\//, "");
    const direct = path.join(jsonDir!, stripped);
    if (fs.existsSync(direct)) return direct;
    // Try under posts/
    const underPosts = path.join(jsonDir!, "posts", path.basename(uri));
    if (fs.existsSync(underPosts)) return underPosts;
    // Try full URI relative to JSON dir parent
    const fromParent = path.join(jsonDir!, uri);
    if (fs.existsSync(fromParent)) return fromParent;
    return null;
  }

  for (const parsed of toImport) {
    try {
      // Match to HTML entry for URL enrichment
      let platformUrl: string | null = null;
      let correctedDate: Date | null = null;

      // Try media filename match first
      const firstMediaFilename = parsed.mediaUris[0]
        ? path.basename(parsed.mediaUris[0]).replace(/\.[^/.]+$/, "")
        : null;
      if (firstMediaFilename) {
        // Try with various extensions
        for (const ext of ["jpg", "jpeg", "png", "mp4", "mov", "gif", "webp"]) {
          const entry = htmlByMedia.get(`${firstMediaFilename}.${ext}`);
          if (entry) {
            platformUrl = entry.platformUrl;
            if (entry.footerDate) correctedDate = entry.footerDate;
            break;
          }
        }
      }

      // Fallback: body match
      if (!platformUrl && parsed.body) {
        const key = normalizeForSearch(parsed.body);
        const candidates = htmlByBody.get(key);
        if (candidates?.length === 1) {
          platformUrl = candidates[0].platformUrl;
          if (candidates[0].footerDate) correctedDate = candidates[0].footerDate;
        } else if (candidates && candidates.length > 1) {
          // Pick closest date
          const postTime = parsed.originalDate.getTime();
          candidates.sort(
            (a, b) =>
              Math.abs((a.footerDate?.getTime() ?? 0) - postTime) -
              Math.abs((b.footerDate?.getTime() ?? 0) - postTime)
          );
          platformUrl = candidates[0].platformUrl;
          if (candidates[0].footerDate) correctedDate = candidates[0].footerDate;
        }
      }

      const post = await prisma.post.create({
        data: {
          userId,
          body: parsed.body ?? "",
          bodyNormalized: normalizeForSearch(parsed.body ?? ""),
          source: "FACEBOOK",
          sourceId: parsed.sourceId,
          originalDate: correctedDate ?? parsed.originalDate,
          platformUrl,
        },
      });

      // Upload media
      for (const uri of parsed.mediaUris) {
        try {
          const localPath = resolveMediaPath(uri);
          if (!localPath) {
            errors.push(`Media file not found: ${uri}`);
            continue;
          }
          const fileBuffer = Buffer.from(fs.readFileSync(localPath));
          const filename = path.basename(uri);
          const mimeType = guessMimeType(filename);
          const key = mediaKey(userId, filename);

          const { hasAudio } = await uploadBuffer(key, fileBuffer);

          await prisma.media.create({
            data: {
              postId: post.id,
              storageKey: key,
              originalUri: uri,
              mimeType,
              sizeBytes: fileBuffer.length,
              hasAudio,
            },
          });
        } catch (mediaErr) {
          errors.push(`Media error for ${parsed.sourceId}: ${String(mediaErr)}`);
        }
      }

      imported++;
      console.log(
        `  [${imported}/${toImport.length}] ${parsed.sourceId} | ${post.originalDate.toISOString().slice(0, 16)} | ${parsed.mediaUris.length}media${platformUrl ? " | +URL" : ""}`
      );

      // Fire-and-forget AI tagging
      tagPromises.push(
        throttle(() => analyzePost(post.id).catch(() => {})) as Promise<void>
      );
    } catch (postErr) {
      errors.push(`Post error ${parsed.sourceId}: ${String(postErr)}`);
      console.error(`  ERROR: ${parsed.sourceId}: ${String(postErr)}`);
    }
  }

  console.log(`\nWaiting for AI tagging to finish...`);
  await Promise.allSettled(tagPromises);

  console.log(`\n=== Done ===`);
  console.log(`Imported: ${imported}`);
  console.log(`Skipped (already in DB): ${skipping}`);
  if (errors.length > 0) {
    console.log(`Errors: ${errors.length}`);
    for (const e of errors) console.log(`  ${e}`);
  }

  await prisma.$disconnect();
}

function findHtmlFiles(dir: string): string[] {
  const files: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      files.push(...findHtmlFiles(full));
    } else if (e.name.endsWith(".html") && !e.name.startsWith(".")) {
      // Skip start_here.html and non-content pages
      if (e.name === "start_here.html") continue;
      files.push(full);
    }
  }
  return files;
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
