/**
 * POC: parse a Facebook HTML export file (an album HTML page as produced by
 * "Download Your Information" in HTML format), extract
 * {body, mediaFilename, platformUrl} tuples, then try to match each one
 * against an existing Post row in the DB. Dry-run only; no writes.
 *
 * Usage:
 *   node --env-file=.env.local node_modules/.bin/tsx scripts/poc-fb-html-match.ts sample-exports/0.html
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { prisma } from "../src/lib/prisma";
import { normalizeForSearch } from "../src/lib/search-normalize";

interface HtmlEntry {
  body: string;
  mediaFilename: string | null;
  platformUrl: string;
}

// Very small, FB-specific HTML extractor. We are NOT using a general HTML
// parser because the FB templates are stable and a few regexes are enough.
// If this gets hairy we can swap in cheerio.
function parseFbAlbumHtml(html: string): HtmlEntry[] {
  const out: HtmlEntry[] = [];

  // Split on the known section marker. The first chunk is the file header.
  const chunks = html.split(/<section class="_a6-g">/);
  chunks.shift();

  for (const chunk of chunks) {
    // Local media href inside the first <a> of the section
    const mediaMatch = chunk.match(/href="(your_facebook_activity\/posts\/media\/[^"]+)"/);
    const mediaFilename = mediaMatch
      ? path.basename(mediaMatch[1]).replace(/\?.*$/, "")
      : null;

    // Body is inside <div class="_3-95">...</div>
    const bodyMatch = chunk.match(/<div class="_3-95">([\s\S]*?)<\/div>/);
    const bodyHtml = bodyMatch ? bodyMatch[1] : "";
    // Strip any nested tags (e.g. <br>) and decode entities
    const body = bodyHtml
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

    // Footer's dyi/l/ link — the one we care about
    const urlMatch = chunk.match(/<footer[^>]*>[\s\S]*?href="(https:\/\/www\.facebook\.com\/dyi\/l\/[^"]+)"/);
    const platformUrl = urlMatch ? urlMatch[1] : "";

    if (!platformUrl) continue; // malformed section
    out.push({ body, mediaFilename, platformUrl });
  }

  return out;
}

async function main() {
  const htmlPath = process.argv[2];
  if (!htmlPath) {
    console.error("Usage: tsx scripts/poc-fb-html-match.ts <path-to-html>");
    process.exit(1);
  }

  const html = await fs.readFile(htmlPath, "utf8");
  const entries = parseFbAlbumHtml(html);
  console.log(`Parsed ${entries.length} entries from ${htmlPath}`);
  console.log(
    `  with body      : ${entries.filter((e) => e.body).length}`
  );
  console.log(
    `  with media     : ${entries.filter((e) => e.mediaFilename).length}`
  );
  console.log(
    `  with both      : ${entries.filter((e) => e.body && e.mediaFilename).length}`
  );
  console.log();

  // Show a sample
  console.log("Sample entries:");
  for (const e of entries.slice(0, 3)) {
    console.log(
      `  body[0:60]: ${JSON.stringify(e.body.slice(0, 60))}`
    );
    console.log(`  media    : ${e.mediaFilename}`);
    console.log(`  url[0:80]: ${e.platformUrl.slice(0, 80)}…`);
    console.log();
  }

  // ────────────────────────────────────────────────────────── matching

  let matched = 0;
  let matchedByMedia = 0;
  let matchedByBodyUnique = 0;
  let matchedByBodyDate = 0;
  let ambiguous = 0;
  let unmatched = 0;
  const unmatchedSamples: HtmlEntry[] = [];

  for (const e of entries) {
    // Strategy (a): match by media filename. Media.originalUri typically
    // looks like "your_facebook_activity/posts/media/Mobileuploads_.../FILE.jpg",
    // so endsWith(filename) works. To make it index-friendly we use `contains`.
    if (e.mediaFilename) {
      const hits = await prisma.media.findMany({
        where: { originalUri: { endsWith: "/" + e.mediaFilename } },
        select: { postId: true },
        take: 5,
      });
      if (hits.length === 1) {
        matched++;
        matchedByMedia++;
        continue;
      }
      if (hits.length > 1) {
        // Shouldn't happen — FB media IDs are unique. If it does, we disambiguate by body.
        const postIds = hits.map((h) => h.postId);
        const nBody = normalizeForSearch(e.body);
        const byBody = await prisma.post.findMany({
          where: { id: { in: postIds }, bodyNormalized: nBody },
          select: { id: true },
          take: 2,
        });
        if (byBody.length === 1) {
          matched++;
          matchedByMedia++;
          continue;
        }
        ambiguous++;
        continue;
      }
      // No media hit — either we didn't upload this file, or media filename format differs.
      // Fall through to body-based match.
    }

    // Strategy (b): match by normalized body (text-only posts)
    const nBody = normalizeForSearch(e.body);
    if (!nBody) {
      unmatched++;
      if (unmatchedSamples.length < 5) unmatchedSamples.push(e);
      continue;
    }
    const byBody = await prisma.post.findMany({
      where: { bodyNormalized: nBody },
      select: { id: true, originalDate: true },
      take: 10,
    });
    if (byBody.length === 0) {
      unmatched++;
      if (unmatchedSamples.length < 5) unmatchedSamples.push(e);
      continue;
    }
    if (byBody.length === 1) {
      matched++;
      matchedByBodyUnique++;
      continue;
    }
    // Multiple matches — in the POC we just mark ambiguous so we see the
    // scale of the problem. A real backfill would break the tie by date.
    ambiguous++;
  }

  console.log("── Match report ───────────────────────");
  console.log(`  Total HTML entries       : ${entries.length}`);
  console.log(`  Matched                  : ${matched}`);
  console.log(`    by media filename      : ${matchedByMedia}`);
  console.log(`    by unique body         : ${matchedByBodyUnique}`);
  console.log(`    by body + date window  : ${matchedByBodyDate}`);
  console.log(`  Ambiguous                : ${ambiguous}`);
  console.log(`  Unmatched                : ${unmatched}`);
  const rate = ((matched / entries.length) * 100).toFixed(1);
  console.log(`  Match rate               : ${rate}%`);

  if (unmatchedSamples.length > 0) {
    console.log("\n── Sample unmatched entries ─");
    for (const e of unmatchedSamples) {
      console.log(`  media: ${e.mediaFilename}`);
      console.log(`  body : ${JSON.stringify(e.body.slice(0, 80))}`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
