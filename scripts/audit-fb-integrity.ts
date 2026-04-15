/**
 * FB Import Data Integrity Audit
 *
 * Compares the Facebook export JSONs (ground truth) against the database
 * to find: missing posts, missing media, silent videos, wrong media types,
 * and duplicates.
 *
 * Usage: npx tsx scripts/audit-fb-integrity.ts
 */

import * as fs from "fs";
import * as path from "path";
import { prisma } from "../src/lib/prisma";
import {
  parseFacebookFile,
  dedupeParsedPosts,
  type ParsedPost,
} from "../src/lib/facebook-parser";

const EXPORTS_DIR = path.join(__dirname, "../sample-exports");
const MAIN_JSON = path.join(EXPORTS_DIR, "main-export/json");
const APRIL_JSON = path.join(EXPORTS_DIR, "april-export/json");

// ---------------------------------------------------------------------------
// 1. Parse all FB export JSONs
// ---------------------------------------------------------------------------

function loadJsonFile(filePath: string): unknown {
  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw);
}

function parseAllExports(): ParsedPost[] {
  const allParsed: ParsedPost[] = [];

  // Main export
  const mainFiles = [
    "your_posts__check_ins__photos_and_videos_1.json",
    "your_videos.json",
    "archive.json",
    "your_uncategorized_photos.json",
    "reels_you_have_pinned.json",
  ];

  for (const file of mainFiles) {
    const filePath = path.join(MAIN_JSON, file);
    if (!fs.existsSync(filePath)) continue;
    const raw = loadJsonFile(filePath);
    const parsed = parseFacebookFile(raw);
    console.log(`  ${file}: ${parsed.length} posts`);
    allParsed.push(...parsed);
  }

  // Main album files
  const albumDir = path.join(MAIN_JSON, "album");
  if (fs.existsSync(albumDir)) {
    for (const file of fs.readdirSync(albumDir)) {
      if (!file.endsWith(".json")) continue;
      const raw = loadJsonFile(path.join(albumDir, file));
      const parsed = parseFacebookFile(raw);
      console.log(`  album/${file}: ${parsed.length} posts`);
      allParsed.push(...parsed);
    }
  }

  // April export
  const aprilFiles = [
    "your_posts__check_ins__photos_and_videos_1.json",
    "your_videos.json",
    "archived_stories.json",
  ];

  for (const file of aprilFiles) {
    const filePath = path.join(APRIL_JSON, file);
    if (!fs.existsSync(filePath)) continue;
    const raw = loadJsonFile(filePath);
    const parsed = parseFacebookFile(raw);
    console.log(`  april/${file}: ${parsed.length} posts`);
    allParsed.push(...parsed);
  }

  // April album files
  const aprilAlbumDir = path.join(APRIL_JSON, "album");
  if (fs.existsSync(aprilAlbumDir)) {
    for (const file of fs.readdirSync(aprilAlbumDir)) {
      if (!file.endsWith(".json")) continue;
      const raw = loadJsonFile(path.join(aprilAlbumDir, file));
      const parsed = parseFacebookFile(raw);
      console.log(`  april/album/${file}: ${parsed.length} posts`);
      allParsed.push(...parsed);
    }
  }

  console.log(`\nTotal parsed (before dedup): ${allParsed.length}`);
  const deduped = dedupeParsedPosts(allParsed);
  console.log(`Total parsed (after dedup):  ${deduped.length}`);

  return deduped;
}

// ---------------------------------------------------------------------------
// 2. Query DB
// ---------------------------------------------------------------------------

interface DBPost {
  id: string;
  sourceId: string | null;
  body: string;
  originalDate: Date;
  postType: string;
  media: {
    id: string;
    storageKey: string;
    originalUri: string | null;
    mimeType: string;
    hasAudio: boolean | null;
  }[];
}

async function loadDBPosts(): Promise<DBPost[]> {
  return prisma.post.findMany({
    where: { source: "FACEBOOK" },
    select: {
      id: true,
      sourceId: true,
      body: true,
      originalDate: true,
      postType: true,
      media: {
        select: {
          id: true,
          storageKey: true,
          originalUri: true,
          mimeType: true,
          hasAudio: true,
        },
      },
    },
  });
}

// ---------------------------------------------------------------------------
// 3. Cross-reference
// ---------------------------------------------------------------------------

interface AuditReport {
  // Summary
  fbPostCount: number;
  dbPostCount: number;

  // Issue categories
  missingFromDB: ParsedPost[];                    // In FB but not in DB
  extraInDB: DBPost[];                             // In DB but not in FB (possible dupes or manual)
  missingMedia: { dbPost: DBPost; expected: number; actual: number; missingUris: string[] }[];
  silentVideos: { dbPost: DBPost; mediaId: string; storageKey: string }[];
  unknownAudioVideos: { dbPost: DBPost; mediaId: string; storageKey: string }[];
  wrongMediaType: { dbPost: DBPost; mediaId: string; expectedType: string; actualType: string; uri: string }[];
  duplicateSourceIds: { sourceId: string; posts: DBPost[] }[];
  duplicateBodies: { body: string; posts: DBPost[] }[];
  postsWithNoMedia: DBPost[];                      // DB posts that should have media but don't
  textOnlyCorrect: number;                         // Posts that are correctly text-only
}

function crossReference(fbPosts: ParsedPost[], dbPosts: DBPost[]): AuditReport {
  // Build lookup maps
  const dbBySourceId = new Map<string, DBPost[]>();
  for (const post of dbPosts) {
    if (!post.sourceId) continue;
    const arr = dbBySourceId.get(post.sourceId) || [];
    arr.push(post);
    dbBySourceId.set(post.sourceId, arr);
  }

  const fbBySourceId = new Map<string, ParsedPost>();
  for (const post of fbPosts) {
    fbBySourceId.set(post.sourceId, post);
  }

  // --- Missing from DB ---
  const missingFromDB: ParsedPost[] = [];
  for (const fbPost of fbPosts) {
    if (!dbBySourceId.has(fbPost.sourceId)) {
      missingFromDB.push(fbPost);
    }
  }

  // --- Extra in DB (sourceId not in FB exports) ---
  const extraInDB: DBPost[] = [];
  for (const dbPost of dbPosts) {
    if (dbPost.sourceId && !fbBySourceId.has(dbPost.sourceId)) {
      extraInDB.push(dbPost);
    }
  }

  // --- Missing media ---
  const missingMedia: AuditReport["missingMedia"] = [];
  const postsWithNoMedia: DBPost[] = [];
  let textOnlyCorrect = 0;

  for (const fbPost of fbPosts) {
    const dbMatches = dbBySourceId.get(fbPost.sourceId);
    if (!dbMatches || dbMatches.length === 0) continue;
    const dbPost = dbMatches[0]; // take first match

    if (fbPost.mediaUris.length > 0) {
      if (dbPost.media.length === 0) {
        postsWithNoMedia.push(dbPost);
      } else if (dbPost.media.length < fbPost.mediaUris.length) {
        // Figure out which URIs are missing
        const dbOriginalUris = new Set(dbPost.media.map(m => m.originalUri).filter(Boolean));
        const missingUris = fbPost.mediaUris.filter(uri => {
          // Check if any DB media matches this URI (by filename)
          const fbFilename = uri.split("/").pop() || "";
          return !Array.from(dbOriginalUris).some(dbUri =>
            dbUri && dbUri.includes(fbFilename)
          );
        });
        missingMedia.push({
          dbPost,
          expected: fbPost.mediaUris.length,
          actual: dbPost.media.length,
          missingUris,
        });
      }
    } else {
      if (dbPost.media.length === 0) textOnlyCorrect++;
    }
  }

  // --- Silent videos ---
  const silentVideos: AuditReport["silentVideos"] = [];
  const unknownAudioVideos: AuditReport["unknownAudioVideos"] = [];
  for (const dbPost of dbPosts) {
    for (const media of dbPost.media) {
      if (media.mimeType.startsWith("video/")) {
        if (media.hasAudio === false) {
          silentVideos.push({ dbPost, mediaId: media.id, storageKey: media.storageKey });
        } else if (media.hasAudio === null) {
          unknownAudioVideos.push({ dbPost, mediaId: media.id, storageKey: media.storageKey });
        }
      }
    }
  }

  // --- Wrong media type ---
  const wrongMediaType: AuditReport["wrongMediaType"] = [];
  for (const fbPost of fbPosts) {
    const dbMatches = dbBySourceId.get(fbPost.sourceId);
    if (!dbMatches || dbMatches.length === 0) continue;
    const dbPost = dbMatches[0];

    for (const uri of fbPost.mediaUris) {
      const fbFilename = uri.split("/").pop() || "";
      const isVideo = /\.(mp4|mov|avi|webm)$/i.test(fbFilename);
      const isImage = /\.(jpg|jpeg|png|gif|webp|heic)$/i.test(fbFilename);

      // Find matching DB media
      for (const media of dbPost.media) {
        const dbFilename = (media.originalUri || media.storageKey).split("/").pop() || "";
        if (dbFilename.includes(fbFilename.replace(/\.[^/.]+$/, ""))) {
          const expectedType = isVideo ? "video" : isImage ? "image" : "unknown";
          const actualType = media.mimeType.startsWith("video/") ? "video" : media.mimeType.startsWith("image/") ? "image" : "other";
          if (expectedType !== "unknown" && expectedType !== actualType) {
            wrongMediaType.push({
              dbPost,
              mediaId: media.id,
              expectedType,
              actualType,
              uri,
            });
          }
        }
      }
    }
  }

  // --- Duplicate sourceIds in DB ---
  const duplicateSourceIds: AuditReport["duplicateSourceIds"] = [];
  for (const [sourceId, posts] of dbBySourceId.entries()) {
    if (posts.length > 1) {
      duplicateSourceIds.push({ sourceId, posts });
    }
  }

  // --- Duplicate bodies in DB ---
  const bodyMap = new Map<string, DBPost[]>();
  for (const post of dbPosts) {
    const trimmed = post.body.trim();
    if (!trimmed) continue;
    const arr = bodyMap.get(trimmed) || [];
    arr.push(post);
    bodyMap.set(trimmed, arr);
  }
  const duplicateBodies: AuditReport["duplicateBodies"] = [];
  for (const [body, posts] of bodyMap.entries()) {
    if (posts.length > 1) {
      duplicateBodies.push({ body: body.substring(0, 100), posts });
    }
  }

  return {
    fbPostCount: fbPosts.length,
    dbPostCount: dbPosts.length,
    missingFromDB,
    extraInDB,
    missingMedia,
    silentVideos,
    unknownAudioVideos,
    wrongMediaType,
    duplicateSourceIds,
    duplicateBodies,
    postsWithNoMedia,
    textOnlyCorrect,
  };
}

// ---------------------------------------------------------------------------
// 4. Print report
// ---------------------------------------------------------------------------

function printReport(report: AuditReport) {
  console.log("\n" + "=".repeat(70));
  console.log("  FB IMPORT DATA INTEGRITY AUDIT REPORT");
  console.log("=".repeat(70));

  console.log(`\n📊 SUMMARY`);
  console.log(`  FB export posts (deduped):  ${report.fbPostCount}`);
  console.log(`  DB posts (source=FACEBOOK): ${report.dbPostCount}`);
  console.log(`  Correctly text-only:        ${report.textOnlyCorrect}`);

  console.log(`\n🔴 CRITICAL ISSUES`);

  console.log(`\n  1. Posts MISSING from DB entirely: ${report.missingFromDB.length}`);
  if (report.missingFromDB.length > 0) {
    const withMedia = report.missingFromDB.filter(p => p.mediaUris.length > 0);
    const textOnly = report.missingFromDB.filter(p => p.mediaUris.length === 0);
    console.log(`     - With media: ${withMedia.length}`);
    console.log(`     - Text-only:  ${textOnly.length}`);
    console.log(`     Sample sourceIds:`);
    for (const p of report.missingFromDB.slice(0, 10)) {
      console.log(`       ${p.sourceId} | ${p.originalDate.toISOString().split("T")[0]} | media:${p.mediaUris.length} | "${p.body.substring(0, 60)}..."`);
    }
  }

  console.log(`\n  2. Posts with ZERO media (should have media): ${report.postsWithNoMedia.length}`);
  if (report.postsWithNoMedia.length > 0) {
    for (const p of report.postsWithNoMedia.slice(0, 10)) {
      console.log(`       ${p.id} | ${p.sourceId} | "${p.body.substring(0, 60)}..."`);
    }
  }

  console.log(`\n  3. Posts with FEWER media than expected: ${report.missingMedia.length}`);
  if (report.missingMedia.length > 0) {
    for (const m of report.missingMedia.slice(0, 10)) {
      console.log(`       ${m.dbPost.id} | expected:${m.expected} actual:${m.actual} | missing:${m.missingUris.map(u => u.split("/").pop()).join(", ")}`);
    }
  }

  console.log(`\n🟡 MEDIA ISSUES`);

  console.log(`\n  4. Videos with hasAudio=FALSE (silent): ${report.silentVideos.length}`);
  if (report.silentVideos.length > 0) {
    for (const v of report.silentVideos.slice(0, 10)) {
      console.log(`       post:${v.dbPost.id} | media:${v.mediaId} | ${v.storageKey}`);
    }
  }

  console.log(`\n  5. Videos with hasAudio=NULL (unknown): ${report.unknownAudioVideos.length}`);
  if (report.unknownAudioVideos.length > 0) {
    console.log(`     (Run backfill-audio.ts to check these)`);
    for (const v of report.unknownAudioVideos.slice(0, 5)) {
      console.log(`       post:${v.dbPost.id} | media:${v.mediaId} | ${v.storageKey}`);
    }
  }

  console.log(`\n  6. Wrong media type (e.g. video→image): ${report.wrongMediaType.length}`);
  if (report.wrongMediaType.length > 0) {
    for (const w of report.wrongMediaType.slice(0, 10)) {
      console.log(`       post:${w.dbPost.id} | expected:${w.expectedType} actual:${w.actualType} | ${w.uri.split("/").pop()}`);
    }
  }

  console.log(`\n🟠 DUPLICATES`);

  console.log(`\n  7. Duplicate sourceIds in DB: ${report.duplicateSourceIds.length}`);
  if (report.duplicateSourceIds.length > 0) {
    for (const d of report.duplicateSourceIds.slice(0, 10)) {
      console.log(`       ${d.sourceId}: ${d.posts.length} copies [${d.posts.map(p => p.id).join(", ")}]`);
    }
  }

  console.log(`\n  8. Duplicate bodies in DB: ${report.duplicateBodies.length}`);
  if (report.duplicateBodies.length > 0) {
    for (const d of report.duplicateBodies.slice(0, 10)) {
      console.log(`       "${d.body}..." — ${d.posts.length} copies`);
    }
  }

  console.log(`\n📋 OTHER`);
  console.log(`  Posts in DB not in FB exports: ${report.extraInDB.length}`);
  if (report.extraInDB.length > 0) {
    console.log(`  (Could be from manual creation, different exports, or orphaned imports)`);
  }

  // Write full report JSON for further processing
  const reportPath = path.join(__dirname, "../sample-exports/audit-report.json");
  const serializable = {
    ...report,
    missingFromDB: report.missingFromDB.map(p => ({
      sourceId: p.sourceId,
      body: p.body.substring(0, 200),
      originalDate: p.originalDate.toISOString(),
      mediaUris: p.mediaUris,
    })),
    extraInDB: report.extraInDB.map(p => ({
      id: p.id,
      sourceId: p.sourceId,
      body: p.body.substring(0, 200),
    })),
    postsWithNoMedia: report.postsWithNoMedia.map(p => ({
      id: p.id,
      sourceId: p.sourceId,
      body: p.body.substring(0, 200),
    })),
    missingMedia: report.missingMedia.map(m => ({
      postId: m.dbPost.id,
      sourceId: m.dbPost.sourceId,
      expected: m.expected,
      actual: m.actual,
      missingUris: m.missingUris,
    })),
    silentVideos: report.silentVideos.map(v => ({
      postId: v.dbPost.id,
      mediaId: v.mediaId,
      storageKey: v.storageKey,
    })),
    unknownAudioVideos: report.unknownAudioVideos.map(v => ({
      postId: v.dbPost.id,
      mediaId: v.mediaId,
      storageKey: v.storageKey,
    })),
    wrongMediaType: report.wrongMediaType.map(w => ({
      postId: w.dbPost.id,
      mediaId: w.mediaId,
      expectedType: w.expectedType,
      actualType: w.actualType,
      uri: w.uri,
    })),
    duplicateSourceIds: report.duplicateSourceIds.map(d => ({
      sourceId: d.sourceId,
      postIds: d.posts.map(p => p.id),
    })),
    duplicateBodies: report.duplicateBodies.map(d => ({
      body: d.body,
      postIds: d.posts.map(p => p.id),
    })),
  };
  fs.writeFileSync(reportPath, JSON.stringify(serializable, null, 2));
  console.log(`\n✅ Full report written to: ${reportPath}`);

  console.log("\n" + "=".repeat(70));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("🔍 FB Import Data Integrity Audit\n");

  console.log("Step 1: Parsing FB export JSONs...");
  const fbPosts = parseAllExports();

  console.log("\nStep 2: Loading DB posts...");
  const dbPosts = await loadDBPosts();
  console.log(`  Loaded ${dbPosts.length} posts from DB`);

  console.log("\nStep 3: Cross-referencing...");
  const report = crossReference(fbPosts, dbPosts);

  printReport(report);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
