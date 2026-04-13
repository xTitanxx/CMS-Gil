/**
 * Backfill Post.platformUrl from a Facebook HTML export file.
 *
 * Matching strategy:
 *   (a) First-media filename — each HTML section links to a local media file
 *       (your_facebook_activity/posts/media/…/FILE.ext). Post.media.originalUri
 *       also stores that path, so we join by `endsWith('/' + filename)`.
 *   (b) Normalized body — fallback when (a) misses (e.g. text-only posts or
 *       cases where JSON and HTML exports picked different media for the same
 *       post). Uses the same normalizeForSearch() helper that powers /posts
 *       search, so smart-quote/dash differences are absorbed.
 *   (c) Body + date window — fallback for (b) ambiguity: pick the candidate
 *       whose originalDate is closest to the HTML footer date.
 *
 * Usage:
 *   tsx scripts/backfill-fb-urls.ts <html-file>              # dry-run
 *   tsx scripts/backfill-fb-urls.ts <html-file> --apply      # write
 *
 * Env:
 *   node --env-file=.env.local is required (DATABASE_URL from Neon).
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { prisma } from "../src/lib/prisma";
import { normalizeForSearch } from "../src/lib/search-normalize";

interface HtmlEntry {
  body: string;
  mediaFilename: string | null;
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

/**
 * Facebook's HTML export uses `<section class="_a6-g" …>` blocks for every
 * post-like item across albums, stories, and reels. The tag may have trailing
 * attributes (e.g. `aria-labelledby`) in stories/reels but not in albums.
 */
function parseFbHtml(html: string): HtmlEntry[] {
  const out: HtmlEntry[] = [];
  // Split on opening section tag, tolerating extra attributes.
  const chunks = html.split(/<section class="_a6-g"[^>]*>/);
  chunks.shift();

  for (const chunk of chunks) {
    const mediaMatch = chunk.match(
      /(?:href|src)="(your_facebook_activity\/[^"]+\.(?:jpg|jpeg|png|webp|gif|mp4|mov|m4v))"/i
    );
    const mediaFilename = mediaMatch
      ? path.basename(mediaMatch[1]).replace(/\?.*$/, "")
      : null;

    // User-authored caption lives in <div class="_3-95">. If absent, the
    // section is usually a photo/story with no caption — we still capture the
    // URL + media so it can match on media filename alone.
    const bodyMatch = chunk.match(/<div class="_3-95">([\s\S]*?)<\/div>/);
    const body = bodyMatch ? decodeHtml(bodyMatch[1]) : "";

    // Footer link — same shape across all FB HTML exports
    const urlMatch = chunk.match(
      /<footer[^>]*>[\s\S]*?href="(https:\/\/www\.facebook\.com\/dyi\/l\/[^"]+)"/
    );
    // Decode &amp; back to & so the URL is click-ready
    const platformUrl = urlMatch ? urlMatch[1].replace(/&amp;/g, "&") : "";
    if (!platformUrl) continue;
    // Skip URLs with &s= parameter — those come from your_posts__*.html and
    // archived_stories.html and redirect to the activity log instead of the
    // actual post. Album/video/photo HTML files produce working direct-links.
    if (platformUrl.includes("&s=")) continue;

    const footerDateStr = chunk
      .match(/<footer[\s\S]*?<div class="_a72d">([^<]+)<\/div>/)
      ?.[1]?.trim();
    const footerDate = footerDateStr ? new Date(footerDateStr) : null;

    out.push({ body, mediaFilename, platformUrl, footerDate });
  }

  return out;
}

interface MatchResult {
  entry: HtmlEntry;
  postId: string | null;
  reason: "media" | "body-unique" | "body-date" | "unmatched" | "ambiguous";
}

async function matchEntry(entry: HtmlEntry): Promise<MatchResult> {
  // (a) media filename
  if (entry.mediaFilename) {
    const mediaHits = await prisma.media.findMany({
      where: { originalUri: { endsWith: "/" + entry.mediaFilename } },
      select: { postId: true },
      take: 5,
    });
    if (mediaHits.length === 1) {
      return { entry, postId: mediaHits[0].postId, reason: "media" };
    }
    if (mediaHits.length > 1) {
      const postIds = mediaHits.map((h) => h.postId);
      const byBody = await prisma.post.findMany({
        where: {
          id: { in: postIds },
          bodyNormalized: normalizeForSearch(entry.body),
        },
        select: { id: true },
        take: 2,
      });
      if (byBody.length === 1) {
        return { entry, postId: byBody[0].id, reason: "media" };
      }
      return { entry, postId: null, reason: "ambiguous" };
    }
  }

  // (b/c) body match
  const nBody = normalizeForSearch(entry.body);
  if (!nBody) return { entry, postId: null, reason: "unmatched" };

  const bodyHits = await prisma.post.findMany({
    where: { bodyNormalized: nBody },
    select: { id: true, originalDate: true },
    take: 10,
  });
  if (bodyHits.length === 0) {
    return { entry, postId: null, reason: "unmatched" };
  }
  if (bodyHits.length === 1) {
    return { entry, postId: bodyHits[0].id, reason: "body-unique" };
  }
  // Multiple body matches — use footer date to pick the closest
  if (entry.footerDate) {
    let best: { id: string; delta: number } | null = null;
    for (const h of bodyHits) {
      const delta = Math.abs(
        h.originalDate.getTime() - entry.footerDate.getTime()
      );
      if (!best || delta < best.delta) best = { id: h.id, delta };
    }
    if (best && best.delta < 1000 * 60 * 60 * 24) {
      // within 24h
      return { entry, postId: best.id, reason: "body-date" };
    }
  }
  return { entry, postId: null, reason: "ambiguous" };
}

async function processFile(htmlPath: string, apply: boolean) {
  const html = await fs.readFile(htmlPath, "utf8");
  const entries = parseFbHtml(html);
  console.log(`\n── ${htmlPath}  (${entries.length} entries)`);

  const results: MatchResult[] = [];
  for (const entry of entries) {
    results.push(await matchEntry(entry));
  }

  const matched = results.filter((r) => r.postId);
  const byReason = {
    media: results.filter((r) => r.reason === "media").length,
    "body-unique": results.filter((r) => r.reason === "body-unique").length,
    "body-date": results.filter((r) => r.reason === "body-date").length,
    ambiguous: results.filter((r) => r.reason === "ambiguous").length,
    unmatched: results.filter((r) => r.reason === "unmatched").length,
  };

  console.log(
    `  matched ${matched.length}/${entries.length} (${((matched.length / entries.length) * 100).toFixed(1)}%)`
  );
  console.log(
    `    media=${byReason.media}  body=${byReason["body-unique"]}  body+date=${byReason["body-date"]}`
  );
  console.log(
    `  ambiguous=${byReason.ambiguous}  unmatched=${byReason.unmatched}`
  );

  if (byReason.unmatched > 0 && !apply) {
    // Show up to 3 unmatched with body snippets — they're potentially net-new
    const unmatchedRs = results.filter((r) => r.reason === "unmatched");
    console.log(`  sample unmatched (net-new?):`);
    for (const r of unmatchedRs.slice(0, 3)) {
      const preview = r.entry.body
        ? JSON.stringify(r.entry.body.slice(0, 60))
        : `(no body, media=${r.entry.mediaFilename ?? "none"})`;
      console.log(`    ${preview}`);
    }
  }

  if (apply && matched.length > 0) {
    const PARALLEL = 20;
    let done = 0;
    for (let i = 0; i < matched.length; i += PARALLEL) {
      const batch = matched.slice(i, i + PARALLEL);
      await Promise.all(
        batch.map((r) =>
          prisma.post.update({
            where: { id: r.postId! },
            data: { platformUrl: r.entry.platformUrl },
          })
        )
      );
      done += batch.length;
    }
    console.log(`  applied: wrote ${done} platformUrl(s)`);
  }

  return { entries: entries.length, matched: matched.length, byReason };
}

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== "--apply");
  const apply = process.argv.includes("--apply");
  if (args.length === 0) {
    console.error(
      "Usage: tsx scripts/backfill-fb-urls.ts <html-file> [<more-files>...] [--apply]"
    );
    process.exit(1);
  }

  const totals = { entries: 0, matched: 0 };
  for (const f of args) {
    const r = await processFile(f, apply);
    totals.entries += r.entries;
    totals.matched += r.matched;
  }

  console.log("\n══ grand total ══");
  console.log(`  entries : ${totals.entries}`);
  console.log(`  matched : ${totals.matched}`);
  console.log(
    `  rate    : ${((totals.matched / totals.entries) * 100).toFixed(1)}%`
  );

  if (!apply) {
    console.log(`\nDRY RUN — re-run with --apply to write.`);
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
