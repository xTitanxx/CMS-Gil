/**
 * Fix Text-Only Posts — Find media for posts that the JSON export missed
 * by parsing the HTML export which embeds media references.
 *
 * Strategy:
 * 1. Parse the HTML export to extract (body_text → media_uris) mappings
 * 2. Match text-only DB posts by body text
 * 3. Find the media files on disk and upload them
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/fix-textonly-from-html.ts              # dry run
 *   npx tsx --env-file=.env.local scripts/fix-textonly-from-html.ts --apply      # actually upload
 */

import * as fs from "fs";
import * as path from "path";
import { prisma } from "../src/lib/prisma";
import { uploadBuffer, mediaKey } from "../src/lib/storage";
import { guessMimeType } from "../src/lib/facebook-parser";

const EXPORTS_DIR = path.join(__dirname, "../sample-exports");
const USER_ID = "cmnala41x000004lgj4riwp83";

const args = process.argv.slice(2);
const DRY_RUN = !args.includes("--apply");

function buildMediaIndex(): Map<string, string> {
  const index = new Map<string, string>();
  const indexFiles = [
    path.join(EXPORTS_DIR, "main-export/media-index.txt"),
    path.join(EXPORTS_DIR, "april-export/media-index.txt"),
    path.join(EXPORTS_DIR, "html-media-index.txt"),
  ];
  for (const indexFile of indexFiles) {
    if (!fs.existsSync(indexFile)) continue;
    for (const line of fs.readFileSync(indexFile, "utf-8").trim().split("\n")) {
      const [filename, filepath] = line.split("|");
      if (filename && filepath && !index.has(filename)) {
        index.set(filename, filepath);
      }
    }
  }
  return index;
}

interface HtmlPost {
  bodySnippet: string; // first ~200 chars of body text
  mediaUris: string[];
  date?: string;
}

/**
 * Parse FB HTML export to extract posts with their media references.
 * FB HTML structure: each post is in a section with:
 *   - <div class="_3-95 _a6-g"> containing text
 *   - <img src="..."> or <video src="..."> for media
 *   - <div class="_a72d"> containing date
 */
function parseHtmlExport(htmlPath: string): HtmlPost[] {
  const html = fs.readFileSync(htmlPath, "utf-8");
  const posts: HtmlPost[] = [];

  // FB HTML exports wrap each post in <section class="_a6-g">.
  // Inside each section:
  //   - Text body is in <div class="_3-95">TEXT or <div class="_2pin"><div>TEXT
  //   - Media is in <img src="your_facebook_activity/..."> or <a href="...mp4">
  //   - Date is in <div class="_a72d">DATE</div>
  const sections = html.split(/<section class="_a6-g"/i);

  for (const section of sections.slice(1)) {
    // Extract all text blocks longer than 15 chars (skip titles, labels)
    const allTextBlocks: string[] = [];

    // Pattern: text inside <div class="_3-95">...</div>
    const styledBlocks = [...section.matchAll(/class="_3-95[^"]*"[^>]*>([^<]{10,})/g)];
    for (const m of styledBlocks) {
      allTextBlocks.push(decodeHtmlEntities(m[1].trim()));
    }

    // Pattern: plain text in <div> tags (post body)
    const plainBlocks = [...section.matchAll(/<div>([^<]{15,})<\/div>/g)];
    for (const m of plainBlocks) {
      const text = m[1].trim();
      // Skip date strings and FB boilerplate
      if (text.match(/^\w{3} \d{1,2}, \d{4}/)) continue;
      if (text.startsWith("Updated ")) continue;
      if (text.startsWith("Mobile uploads")) continue;
      allTextBlocks.push(decodeHtmlEntities(text));
    }

    // Use the longest text block as body
    let bodyText = "";
    if (allTextBlocks.length > 0) {
      bodyText = allTextBlocks.reduce((a, b) => a.length > b.length ? a : b);
    }

    // Extract media URIs from src= and href= attributes
    const mediaUris: string[] = [];
    const seen = new Set<string>();
    const mediaMatches = section.matchAll(/(src|href)="([^"]*\.(jpg|jpeg|png|gif|mp4|mov|webp))"/gi);
    for (const m of mediaMatches) {
      const uri = m[2];
      if (seen.has(uri)) continue;
      seen.add(uri);
      // Skip FB boilerplate (CDN, icons, profile pics)
      if (uri.includes("fbcdn.net") || uri.includes("fb_logo") || uri.includes("profile_pic")) continue;
      if (uri.includes("your_facebook_activity") || uri.includes("posts/media")) {
        mediaUris.push(uri);
      }
    }

    // Extract date
    const dateMatch = section.match(/<div class="_a72d">([^<]+)<\/div>/);
    const date = dateMatch ? dateMatch[1].trim() : undefined;

    if (bodyText.length >= 10 && mediaUris.length > 0) {
      posts.push({
        bodySnippet: bodyText.substring(0, 200),
        mediaUris,
        date,
      });
    }
  }

  return posts;
}

/**
 * Try to decode FB HTML encoding (they use HTML entities + UTF-8)
 */
function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/**
 * Normalize text for fuzzy matching: lowercase, strip whitespace variants,
 * remove smart quotes, etc.
 */
function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u2018\u2019\u201C\u201D]/g, "'") // smart quotes
    .replace(/\u2014/g, "-") // em dash
    .replace(/\u2013/g, "-") // en dash
    .replace(/\u2026/g, "...") // ellipsis
    .replace(/\u00A0/g, " ") // nbsp
    .replace(/\s+/g, " ")
    .trim();
}

async function main() {
  console.log(`🔧 Fix Text-Only Posts from HTML ${DRY_RUN ? "(DRY RUN)" : "(APPLYING)"}\n`);

  // Get text-only FB posts from DB
  const textOnlyPosts = await prisma.post.findMany({
    where: { source: "FACEBOOK", media: { none: {} } },
    select: { id: true, sourceId: true, body: true, originalDate: true },
  });
  console.log(`Text-only FB posts in DB: ${textOnlyPosts.length}`);

  // Load all HTML files into one big string for searching
  const htmlFiles = [
    path.join(EXPORTS_DIR, "html-exports/partial-2025-2026-no-media/posts2/your_posts__check_ins__photos_and_videos_1.html"),
    path.join(EXPORTS_DIR, "_original-layout/HTML/3:4 - 10:4 April HTML/your_facebook_activity/posts/your_posts__check_ins__photos_and_videos_1.html"),
  ];

  const htmlContents: string[] = [];
  for (const f of htmlFiles) {
    if (!fs.existsSync(f)) continue;
    htmlContents.push(fs.readFileSync(f, "utf-8"));
    console.log(`  Loaded: ${path.basename(f)} (${Math.round(fs.statSync(f).size / 1024)}KB)`);
  }
  console.log();

  const mediaIndex = buildMediaIndex();

  let matched = 0;
  let noMatch = 0;
  let mediaFound = 0;
  let mediaNotFound = 0;
  let uploaded = 0;

  /**
   * For each text-only post, search for its body text directly in the HTML.
   * Then look backward/forward from that position for media references
   * within the same <section> block.
   */
  function findMediaInHtml(bodyText: string): string[] {
    // Try multiple search strings: full 60 chars, then shorter substrings
    const candidates = [
      bodyText.substring(0, 60),
      bodyText.substring(0, 40),
      bodyText.substring(0, 25),
    ].filter(s => s.length >= 10);

    for (const html of htmlContents) {
      let idx = -1;
      for (const searchText of candidates) {
        idx = html.indexOf(searchText);
        if (idx >= 0) break;
      }
      if (idx < 0) continue;

      // FB HTML has nested sections — media often appears 1000-3000 chars before
      // the post text in a parent div. Search a wide window unconditionally.
      const windowStart = Math.max(0, idx - 5000);
      const windowEnd = Math.min(html.length, idx + 2000);
      const window = html.substring(windowStart, windowEnd);

      // Extract media URIs
      const mediaUris: string[] = [];
      const seen = new Set<string>();
      const matches = window.matchAll(/(src|href)="([^"]*\.(jpg|jpeg|png|gif|mp4|mov|webp))"/gi);
      for (const m of matches) {
        const uri = m[2];
        if (seen.has(uri)) continue;
        seen.add(uri);
        if (uri.includes("fbcdn.net") || uri.includes("fb_logo") || uri.includes("profile_pic")) continue;
        if (uri.includes("your_facebook_activity") || uri.includes("posts/media")) {
          mediaUris.push(uri);
        }
      }
      return mediaUris;
    }
    return [];
  }

  for (const dbPost of textOnlyPosts) {
    const mediaUris = findMediaInHtml(dbPost.body);

    if (mediaUris.length === 0) {
      noMatch++;
      continue;
    }
    matched++;

    // Try to find media files on disk
    const foundFiles: { uri: string; path: string }[] = [];
    for (const uri of mediaUris) {
      const filename = uri.split("/").pop() || "";
      const filePath = mediaIndex.get(filename);
      if (filePath && fs.existsSync(filePath)) {
        foundFiles.push({ uri, path: filePath });
        mediaFound++;
      } else {
        mediaNotFound++;
      }
    }

    if (foundFiles.length === 0) {
      if (DRY_RUN) {
        console.log(`  ⚠ ${dbPost.id} | matched but no files: ${mediaUris.map(u => u.split("/").pop()).join(", ")}`);
      }
      continue;
    }

    if (DRY_RUN) {
      console.log(`  ✓ ${dbPost.id} | ${foundFiles.length}/${mediaUris.length} media | "${dbPost.body.substring(0, 50).replace(/\n/g, " ")}"`);
      continue;
    }

    // Upload media
    for (const { uri, path: filePath } of foundFiles) {
      try {
        const buffer = fs.readFileSync(filePath);
        const filename = uri.split("/").pop() ?? "media";
        const mimeType = guessMimeType(filename);
        const key = mediaKey(USER_ID, filename);
        const { hasAudio } = await uploadBuffer(key, buffer);

        await prisma.media.create({
          data: {
            postId: dbPost.id,
            storageKey: key,
            originalUri: uri,
            mimeType,
            sizeBytes: buffer.length,
            hasAudio,
          },
        });
        uploaded++;
        console.log(`  ✓ ${dbPost.id} | ${filename} | ${mimeType}`);
      } catch (err) {
        console.log(`  ✗ ${dbPost.id} | ${uri.split("/").pop()} | ${String(err).substring(0, 80)}`);
      }
    }
  }

  console.log(`\n📊 Results:`);
  console.log(`  Text-only posts:          ${textOnlyPosts.length}`);
  console.log(`  Matched to HTML:          ${matched}`);
  console.log(`  No HTML match:            ${noMatch}`);
  console.log(`  Media files found:        ${mediaFound}`);
  console.log(`  Media files not on disk:  ${mediaNotFound}`);
  if (!DRY_RUN) {
    console.log(`  Uploaded:                 ${uploaded}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
