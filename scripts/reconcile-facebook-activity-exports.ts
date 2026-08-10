/**
 * Reconcile Facebook Stories/Reels JSON plus Posts HTML ZIP exports.
 *
 * The command is read-only unless --apply is supplied. It never extracts an
 * archive: ZIP central directories are indexed and individual media entries
 * are streamed into memory only when they must be uploaded.
 *
 *   node --env-file=.env.production.local node_modules/.bin/tsx \
 *     scripts/reconcile-facebook-activity-exports.ts \
 *     --dir sample-exports --user-id <id>
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Prisma, type PostType } from "@prisma/client";
import unzipper from "unzipper";
import { fixFBEncoding, guessMimeType } from "../src/lib/facebook-parser";
import { normalizeForSearch } from "../src/lib/search-normalize";
import { prisma } from "../src/lib/prisma";
import { uploadBuffer } from "../src/lib/storage";
import { extractPoster } from "../src/lib/video-processing";

type Kind = "STORY" | "REEL";
type RawObject = Record<string, unknown>;

interface MediaRef {
  archiveName: string;
  archivePath: string;
  internalPath: string;
  sizeBytes: number;
  crc32: number;
  entry: unzipper.File;
}

interface Activity {
  kind: Kind;
  index: number;
  timestamp: number;
  occurredAt: Date;
  title: string;
  body: string;
  mediaUris: string[];
  canonicalKey: string;
  sourceArchive: string;
  sourcePath: string;
  raw: RawObject;
}

interface ActivityPlan {
  canonicalKey: string;
  kind: Kind;
  action:
    | "CREATE"
    | "LINK_OR_RECLASSIFY"
    | "NO_CHANGE"
    | "LEDGER_ONLY"
    | "REVIEW_MULTIPLE_MATCHES"
    | "REVIEW_BODY_CONFLICT"
    | "REVIEW_MEDIA_CONFLICT";
  postId: string | null;
  candidatePostIds: string[];
  missingSourceUris: string[];
  note: string | null;
}

interface ScanResult {
  archives: Array<{
    name: string;
    sizeBytes: number;
    entries: number;
    role: string;
  }>;
  activities: Activity[];
  storyMedia: Map<string, MediaRef[]>;
  reelMedia: Map<string, MediaRef[]>;
  postHtmlMedia: Map<string, MediaRef[]>;
  postHtml: {
    files: number;
    sections: number;
    mediaReferences: string[];
    externalUrls: string[];
  };
}

const argv = process.argv.slice(2);
const has = (name: string) => argv.includes(name);
const value = (name: string) => {
  const index = argv.indexOf(name);
  return index < 0 ? null : (argv[index + 1] ?? null);
};
const sourceDir = path.resolve(value("--dir") ?? "sample-exports");
const userIdArg = value("--user-id");
const apply = has("--apply");
const onlyKind = value("--kind")?.toUpperCase() as Kind | undefined;
const reportPath = path.resolve(
  value("--report") ??
    path.join(sourceDir, "Audit by codex", "facebook-activity-final-audit.json"),
);

function normalizePath(input: string): string {
  return input.replace(/\\/g, "/").replace(/^\/+/, "");
}

function asObject(value: unknown): RawObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RawObject)
    : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? fixFBEncoding(value) : "";
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function archiveRole(name: string): "STORY_JSON" | "REEL_JSON" | "POST_HTML" | "OTHER" {
  const lower = name.toLowerCase();
  if (lower.includes("reel") && lower.includes("json")) return "REEL_JSON";
  if ((lower.includes("stor") || lower.includes("sotir")) && lower.includes("json")) {
    return "STORY_JSON";
  }
  if (lower.includes("post") && lower.includes("html")) return "POST_HTML";
  return "OTHER";
}

function addRef(map: Map<string, MediaRef[]>, ref: MediaRef): void {
  const refs = map.get(ref.internalPath) ?? [];
  refs.push(ref);
  map.set(ref.internalPath, refs);
}

function extractActivity(raw: unknown, kind: Kind, index: number, archive: string, sourcePath: string): Activity | null {
  const item = asObject(raw);
  if (!item || typeof item.timestamp !== "number" || item.timestamp <= 0) return null;
  const bodies = (Array.isArray(item.data) ? item.data : [])
    .map(asObject)
    .filter((row): row is RawObject => row !== null)
    .map((row) => text(row.post))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  const mediaUris: string[] = [];
  for (const attachmentValue of Array.isArray(item.attachments) ? item.attachments : []) {
    const attachment = asObject(attachmentValue);
    for (const rowValue of Array.isArray(attachment?.data) ? attachment.data : []) {
      const row = asObject(rowValue);
      const media = asObject(row?.media);
      const uri = text(media?.uri);
      if (uri) mediaUris.push(normalizePath(uri));
    }
  }
  const title = text(item.title);
  const identity = `${item.timestamp}|${normalizeForSearch(title)}|${unique(mediaUris).join("|")}`;
  const hash = createHash("sha256").update(identity).digest("hex").slice(0, 20);
  return {
    kind,
    index,
    timestamp: item.timestamp,
    occurredAt: new Date(item.timestamp * 1000),
    title,
    body: bodies[0] ?? "",
    mediaUris: unique(mediaUris),
    canonicalKey: `fb_${kind.toLowerCase()}_${item.timestamp}_${hash}`,
    sourceArchive: archive,
    sourcePath,
    raw: item,
  };
}

function inspectPostHtml(html: string, result: ScanResult["postHtml"]): void {
  const sections = html.split(/<section class="_a6-g"[^>]*>/i);
  result.sections += Math.max(0, sections.length - 1);
  const mediaRe = /(?:href|src)="(your_facebook_activity\/[^"?#]+?\.(?:jpe?g|png|gif|webp|heic|mp4|mov|m4v|webm|avi))"/gi;
  for (const match of html.matchAll(mediaRe)) result.mediaReferences.push(normalizePath(match[1]));
  const urlRe = /href="(https?:\/\/[^"#]+)"/gi;
  for (const match of html.matchAll(urlRe)) {
    const decoded = match[1].replace(/&amp;/g, "&");
    if (!decoded.includes("facebook.com/dyi/l/")) result.externalUrls.push(decoded);
  }
}

async function scanExports(): Promise<ScanResult> {
  const names = (await readdir(sourceDir)).filter((name) => /\.zip$/i.test(name)).sort();
  if (names.length === 0) throw new Error(`No ZIP files found in ${sourceDir}`);
  const result: ScanResult = {
    archives: [],
    activities: [],
    storyMedia: new Map(),
    reelMedia: new Map(),
    postHtmlMedia: new Map(),
    postHtml: { files: 0, sections: 0, mediaReferences: [], externalUrls: [] },
  };
  const storyManifests: Array<{ archive: string; sourcePath: string; rows: unknown[] }> = [];
  const reelManifests: Array<{ archive: string; sourcePath: string; rows: unknown[] }> = [];

  for (const name of names) {
    const archivePath = path.join(sourceDir, name);
    const [details, directory] = await Promise.all([stat(archivePath), unzipper.Open.file(archivePath)]);
    const role = archiveRole(name);
    result.archives.push({ name, sizeBytes: details.size, entries: directory.files.length, role });
    for (const entry of directory.files) {
      if (entry.type !== "File") continue;
      const internalPath = normalizePath(entry.path);
      const ref: MediaRef = {
        archiveName: name,
        archivePath,
        internalPath,
        sizeBytes: entry.uncompressedSize,
        crc32: entry.crc32,
        entry,
      };
      if (/\.(?:jpe?g|png|gif|webp|heic|mp4|mov|m4v|webm|avi)$/i.test(internalPath)) {
        if (role === "STORY_JSON") addRef(result.storyMedia, ref);
        if (role === "REEL_JSON") addRef(result.reelMedia, ref);
        if (role === "POST_HTML") addRef(result.postHtmlMedia, ref);
      }
      if (/\/stories\/archived_stories\.json$/i.test(internalPath)) {
        const parsed = JSON.parse((await entry.buffer()).toString("utf8"));
        storyManifests.push({ archive: name, sourcePath: internalPath, rows: parsed.archived_stories_v2 ?? [] });
      }
      if (/\/reels\/your_reels\.json$/i.test(internalPath)) {
        const parsed = JSON.parse((await entry.buffer()).toString("utf8"));
        reelManifests.push({ archive: name, sourcePath: internalPath, rows: parsed.lasso_videos_v2 ?? [] });
      }
      if (role === "POST_HTML" && /\/posts\/your_posts__check_ins__photos_and_videos_\d+\.html$/i.test(internalPath)) {
        result.postHtml.files++;
        inspectPostHtml((await entry.buffer()).toString("utf8"), result.postHtml);
      }
    }
  }

  if (storyManifests.length !== 1) {
    throw new Error(`Expected one archived_stories.json manifest, found ${storyManifests.length}`);
  }
  if (reelManifests.length !== 1) {
    throw new Error(`Expected one your_reels.json manifest, found ${reelManifests.length}`);
  }
  for (const manifest of storyManifests) {
    manifest.rows.forEach((row, index) => {
      const activity = extractActivity(row, "STORY", index, manifest.archive, manifest.sourcePath);
      if (activity) result.activities.push(activity);
    });
  }
  for (const manifest of reelManifests) {
    manifest.rows.forEach((row, index) => {
      const activity = extractActivity(row, "REEL", index, manifest.archive, manifest.sourcePath);
      if (activity) result.activities.push(activity);
    });
  }
  result.postHtml.mediaReferences = unique(result.postHtml.mediaReferences);
  result.postHtml.externalUrls = unique(result.postHtml.externalUrls);
  return result;
}

function sourceMap(scan: ScanResult, kind: Kind): Map<string, MediaRef[]> {
  return kind === "STORY" ? scan.storyMedia : scan.reelMedia;
}

function resolveRef(map: Map<string, MediaRef[]>, uri: string): { ref: MediaRef | null; reason: string | null } {
  const refs = map.get(normalizePath(uri)) ?? [];
  if (refs.length === 0) return { ref: null, reason: "missing" };
  const signatures = new Set(refs.map((ref) => `${ref.sizeBytes}|${ref.crc32}`));
  if (signatures.size > 1) return { ref: null, reason: "conflicting bytes at the same path" };
  return { ref: refs[0], reason: null };
}

async function resolveUserId(): Promise<string> {
  if (userIdArg) {
    const found = await prisma.user.findUnique({ where: { id: userIdArg }, select: { id: true } });
    if (!found) throw new Error(`User not found: ${userIdArg}`);
    return found.id;
  }
  const users = await prisma.user.findMany({ select: { id: true }, take: 2 });
  if (users.length !== 1) throw new Error(`Found ${users.length} users; pass --user-id explicitly`);
  return users[0].id;
}

async function buildPlan(userId: string, scan: ScanResult, activities: Activity[]): Promise<ActivityPlan[]> {
  const allUris = unique(activities.flatMap((activity) => activity.mediaUris));
  const canonicalKeys = activities.map((activity) => activity.canonicalKey);
  const posts = await prisma.post.findMany({
    where: {
      userId,
      OR: [
        { sourceId: { in: canonicalKeys } },
        { media: { some: { originalUri: { in: allUris } } } },
      ],
    },
    select: {
      id: true,
      sourceId: true,
      postType: true,
      originalDate: true,
      body: true,
      media: { select: { id: true, originalUri: true, storageKey: true, sizeBytes: true, contentHash: true, hasAudio: true } },
    },
  });
  const bySource = new Map(posts.filter((post) => post.sourceId).map((post) => [post.sourceId!, post]));
  const byUri = new Map<string, typeof posts>();
  for (const post of posts) {
    for (const media of post.media) {
      if (!media.originalUri) continue;
      const rows = byUri.get(media.originalUri) ?? [];
      rows.push(post);
      byUri.set(media.originalUri, rows);
    }
  }

  return activities.map((activity) => {
    const missingSourceUris = activity.mediaUris.filter((uri) => !resolveRef(sourceMap(scan, activity.kind), uri).ref);
    const candidates = new Map<string, (typeof posts)[number]>();
    const canonical = bySource.get(activity.canonicalKey);
    if (canonical) candidates.set(canonical.id, canonical);
    for (const uri of activity.mediaUris) {
      for (const post of byUri.get(uri) ?? []) {
        if (Math.abs(post.originalDate.getTime() - activity.occurredAt.getTime()) <= 24 * 60 * 60 * 1000) {
          candidates.set(post.id, post);
        }
      }
    }
    const candidateRows = [...candidates.values()];
    if (candidateRows.length > 1) {
      return { canonicalKey: activity.canonicalKey, kind: activity.kind, action: "REVIEW_MULTIPLE_MATCHES", postId: null, candidatePostIds: candidateRows.map((post) => post.id), missingSourceUris, note: "Multiple nearby posts share an exact exported media URI" };
    }
    if (candidateRows.length === 0) {
      const canCreate = (activity.body.trim() || activity.mediaUris.length) && missingSourceUris.length === 0;
      return { canonicalKey: activity.canonicalKey, kind: activity.kind, action: canCreate ? "CREATE" : "LEDGER_ONLY", postId: null, candidatePostIds: [], missingSourceUris, note: canCreate ? null : "Source media is missing or the activity has no renderable content" };
    }
    const post = candidateRows[0];
    if (activity.body.trim() && post.body.trim() && normalizeForSearch(activity.body) !== normalizeForSearch(post.body)) {
      return { canonicalKey: activity.canonicalKey, kind: activity.kind, action: "REVIEW_BODY_CONFLICT", postId: post.id, candidatePostIds: [post.id], missingSourceUris, note: "The exact-media match has a conflicting non-empty caption" };
    }
    const postUris = post.media.map((media) => media.originalUri).filter((uri): uri is string => Boolean(uri));
    if (postUris.some((uri) => !activity.mediaUris.includes(uri))) {
      return { canonicalKey: activity.canonicalKey, kind: activity.kind, action: "REVIEW_MEDIA_CONFLICT", postId: post.id, candidatePostIds: [post.id], missingSourceUris, note: "The matched post contains additional media not present in this activity export" };
    }
    const sameType = post.postType === activity.kind;
    const sameDate = post.originalDate.getTime() === activity.occurredAt.getTime();
    return {
      canonicalKey: activity.canonicalKey,
      kind: activity.kind,
      action: sameType && sameDate ? "NO_CHANGE" : "LINK_OR_RECLASSIFY",
      postId: post.id,
      candidatePostIds: [post.id],
      missingSourceUris,
      note: `Exact media identity within 24 hours; ${activity.kind.toLowerCase()} and posts exports describe one Facebook object`,
    };
  });
}

function deterministicKey(userId: string, hash: string, uri: string): string {
  const extension = path.extname(uri).toLowerCase().replace(/[^.a-z0-9]/g, "");
  return `media/${userId}/facebook/${hash}${extension}`;
}

interface PreparedMedia {
  uri: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  contentHash: string;
  hasAudio: boolean | null;
}

async function prepareMedia(userId: string, uri: string, ref: MediaRef, cache: Map<string, PreparedMedia>): Promise<PreparedMedia> {
  const cached = cache.get(`${ref.archiveName}|${ref.internalPath}`);
  if (cached) return cached;
  const buffer = await ref.entry.buffer();
  const contentHash = createHash("sha256").update(buffer).digest("hex");
  const mimeType = guessMimeType(uri);
  const storageKey = deterministicKey(userId, contentHash, uri);
  const uploaded = await uploadBuffer(storageKey, buffer, { contentType: mimeType });
  if (mimeType.startsWith("video/")) {
    const poster = await extractPoster(buffer);
    await uploadBuffer(storageKey.replace(/\.[^/.]+$/, ".poster.jpg"), poster, { contentType: "image/jpeg" });
  }
  const result = { uri, storageKey: uploaded.url, mimeType, sizeBytes: buffer.length, contentHash, hasAudio: uploaded.hasAudio };
  cache.set(`${ref.archiveName}|${ref.internalPath}`, result);
  return result;
}

function statusFor(expected: string[], available: string[]): "COMPLETE" | "NO_MEDIA_EXPECTED" | "PARTIAL_MEDIA" | "MISSING_MEDIA" {
  if (expected.length === 0) return "NO_MEDIA_EXPECTED";
  if (available.length === expected.length) return "COMPLETE";
  if (available.length === 0) return "MISSING_MEDIA";
  return "PARTIAL_MEDIA";
}

async function persistActivityLedger(userId: string, activity: Activity, plan: ActivityPlan, postId: string | null, prepared: PreparedMedia[]): Promise<void> {
  const source = sourceMap(currentScan!, activity.kind);
  const available = activity.mediaUris.filter((uri) => Boolean(resolveRef(source, uri).ref));
  const missing = activity.mediaUris.filter((uri) => !available.includes(uri));
  const video = prepared.filter((media) => media.mimeType.startsWith("video/"));
  const data = {
    userId,
    postId,
    canonicalKey: activity.canonicalKey,
    sourceArchive: activity.sourceArchive,
    sourcePath: activity.sourcePath,
    sourceIndexes: [activity.index],
    occurredAt: activity.occurredAt,
    activityTitle: activity.title,
    bodySnapshot: activity.body,
    shareSnapshot: Prisma.DbNull,
    expectedMediaUris: activity.mediaUris,
    availableMediaUris: available,
    missingMediaUris: missing,
    silentVideoUris: video.filter((media) => media.hasAudio === false).map((media) => media.uri),
    unknownAudioUris: video.filter((media) => media.hasAudio === null).map((media) => media.uri),
    rawEntries: [{ ...activity.raw, __codex_source: { archiveName: activity.sourceArchive, internalPath: activity.sourcePath, sourceIndex: activity.index } }] as Prisma.InputJsonValue,
    status: statusFor(activity.mediaUris, available),
    reconciliationAction: plan.action,
    resolutionNote: plan.note,
    appliedAt: new Date(),
  };
  await prisma.facebookImportEvent.upsert({
    where: { userId_canonicalKey: { userId, canonicalKey: activity.canonicalKey } },
    create: data,
    update: data,
  });
}

let currentScan: ScanResult | null = null;

async function applyActivities(userId: string, scan: ScanResult, activities: Activity[], plans: ActivityPlan[]) {
  const byKey = new Map(activities.map((activity) => [activity.canonicalKey, activity]));
  const cache = new Map<string, PreparedMedia>();
  const result = { created: 0, linkedOrReclassified: 0, unchanged: 0, ledgerOnly: 0, review: 0, sourceUpgrades: 0, failed: 0 };
  for (let index = 0; index < plans.length; index++) {
    const plan = plans[index];
    const activity = byKey.get(plan.canonicalKey)!;
    try {
      if (plan.action.startsWith("REVIEW_")) {
        await persistActivityLedger(userId, activity, plan, null, []);
        result.review++;
        continue;
      }
      if (plan.action === "LEDGER_ONLY") {
        await persistActivityLedger(userId, activity, plan, null, []);
        result.ledgerOnly++;
        continue;
      }
      let postId = plan.postId;
      const source = sourceMap(scan, activity.kind);
      const prepared: PreparedMedia[] = [];
      if (plan.action === "CREATE") {
        for (const uri of activity.mediaUris) {
          const ref = resolveRef(source, uri).ref;
          if (!ref) throw new Error(`Source media disappeared after planning: ${uri}`);
          prepared.push(await prepareMedia(userId, uri, ref, cache));
        }
        const post = await prisma.post.create({
          data: {
            userId,
            source: "FACEBOOK",
            sourceId: activity.canonicalKey,
            postType: activity.kind,
            body: activity.body,
            bodyNormalized: normalizeForSearch(activity.body),
            originalDate: activity.occurredAt,
          },
        });
        postId = post.id;
        for (let position = 0; position < prepared.length; position++) {
          const media = prepared[position];
          await prisma.media.create({ data: { postId, originalUri: media.uri, storageKey: media.storageKey, mimeType: media.mimeType, sizeBytes: media.sizeBytes, contentHash: media.contentHash, hasAudio: media.hasAudio, position } });
        }
        result.created++;
      } else if (postId) {
        const existing = await prisma.post.findUniqueOrThrow({ where: { id: postId }, select: { body: true, media: { select: { id: true, originalUri: true, sizeBytes: true, storageKey: true, mimeType: true, contentHash: true, hasAudio: true } } } });
        const body = activity.body || existing.body;
        await prisma.post.update({ where: { id: postId }, data: { postType: activity.kind as PostType, originalDate: activity.occurredAt, body, bodyNormalized: normalizeForSearch(body) } });
        for (const uri of activity.mediaUris) {
          const row = existing.media.find((media) => media.originalUri === uri);
          const ref = resolveRef(source, uri).ref;
          if (!ref) continue;
          if (row && row.sizeBytes !== null && row.sizeBytes >= ref.sizeBytes) {
            prepared.push({ uri, storageKey: row.storageKey, mimeType: row.mimeType, sizeBytes: row.sizeBytes, contentHash: row.contentHash ?? "", hasAudio: row.hasAudio });
            continue;
          }
          const media = await prepareMedia(userId, uri, ref, cache);
          prepared.push(media);
          await prisma.media.upsert({ where: { postId_originalUri: { postId, originalUri: uri } }, create: { postId, originalUri: uri, storageKey: media.storageKey, mimeType: media.mimeType, sizeBytes: media.sizeBytes, contentHash: media.contentHash, hasAudio: media.hasAudio }, update: { storageKey: media.storageKey, mimeType: media.mimeType, sizeBytes: media.sizeBytes, contentHash: media.contentHash, hasAudio: media.hasAudio } });
          if (row) result.sourceUpgrades++;
        }
        if (plan.action === "NO_CHANGE") result.unchanged++;
        else result.linkedOrReclassified++;
      }
      await persistActivityLedger(userId, activity, plan, postId, prepared);
    } catch (error) {
      result.failed++;
      console.error(`Failed ${plan.canonicalKey}: ${String(error)}`);
    }
    if ((index + 1) % 20 === 0 || index + 1 === plans.length) {
      console.log(`Activity apply progress ${index + 1}/${plans.length}`);
    }
  }
  return result;
}

async function repairPostsFromHtml(userId: string, scan: ScanResult, dryRun: boolean) {
  const ledgers = await prisma.facebookImportEvent.findMany({
    where: { userId, missingMediaUris: { isEmpty: false }, canonicalKey: { startsWith: "fb_timeline_" } },
    select: { id: true, postId: true, expectedMediaUris: true, availableMediaUris: true, missingMediaUris: true, resolutionNote: true },
  });
  const plans = ledgers.map((ledger) => {
    const recoverable = ledger.missingMediaUris.filter((uri) => Boolean(resolveRef(scan.postHtmlMedia, uri).ref));
    const conflicts = ledger.missingMediaUris.filter((uri) => resolveRef(scan.postHtmlMedia, uri).reason === "conflicting bytes at the same path");
    return { ledger, recoverable, conflicts, stillMissing: ledger.missingMediaUris.filter((uri) => !recoverable.includes(uri)) };
  });
  if (dryRun) {
    return {
      ledgerEventsWithMissingMedia: ledgers.length,
      linkedLedgerEvents: ledgers.filter((ledger) => ledger.postId).length,
      unlinkedLedgerEvents: ledgers.filter((ledger) => !ledger.postId).length,
      recoverableEvents: plans.filter((plan) => plan.recoverable.length).length,
      recoverableUnlinkedEvents: plans.filter((plan) => !plan.ledger.postId && plan.recoverable.length).length,
      recoverableMedia: plans.reduce((sum, plan) => sum + plan.recoverable.length, 0),
      conflictingMedia: plans.reduce((sum, plan) => sum + plan.conflicts.length, 0),
      stillMissingMedia: plans.reduce((sum, plan) => sum + plan.stillMissing.length, 0),
    };
  }
  const cache = new Map<string, PreparedMedia>();
  let repairedEvents = 0;
  let repairedMedia = 0;
  let sourceLocatedForUnlinkedEvents = 0;
  let failed = 0;
  for (let index = 0; index < plans.length; index++) {
    const plan = plans[index];
    if (plan.recoverable.length === 0) continue;
    try {
      if (plan.ledger.postId) {
        for (const uri of plan.recoverable) {
          const ref = resolveRef(scan.postHtmlMedia, uri).ref!;
          const media = await prepareMedia(userId, uri, ref, cache);
          const position = plan.ledger.expectedMediaUris.indexOf(uri);
          await prisma.media.upsert({ where: { postId_originalUri: { postId: plan.ledger.postId, originalUri: uri } }, create: { postId: plan.ledger.postId, originalUri: uri, storageKey: media.storageKey, mimeType: media.mimeType, sizeBytes: media.sizeBytes, contentHash: media.contentHash, hasAudio: media.hasAudio, position: Math.max(0, position) }, update: { storageKey: media.storageKey, mimeType: media.mimeType, sizeBytes: media.sizeBytes, contentHash: media.contentHash, hasAudio: media.hasAudio, position: Math.max(0, position) } });
          repairedMedia++;
        }
      } else {
        sourceLocatedForUnlinkedEvents++;
      }
      const available = unique([...plan.ledger.availableMediaUris, ...plan.recoverable]);
      const missing = plan.ledger.expectedMediaUris.filter((uri) => !available.includes(uri));
      const repairNote = plan.ledger.postId
        ? `Recovered ${plan.recoverable.length} media file(s) from Posts HTML export`
        : `Located ${plan.recoverable.length} media file(s) in Posts HTML export; event remains unlinked pending reconciliation`;
      await prisma.facebookImportEvent.update({ where: { id: plan.ledger.id }, data: { availableMediaUris: available, missingMediaUris: missing, status: statusFor(plan.ledger.expectedMediaUris, available), reconciliationAction: plan.ledger.postId ? "HTML_MEDIA_REPAIR" : "HTML_SOURCE_LOCATED_UNLINKED", resolutionNote: [plan.ledger.resolutionNote, repairNote].filter(Boolean).join("; "), appliedAt: new Date() } });
      if (plan.ledger.postId) {
        const post = await prisma.post.findUniqueOrThrow({ where: { id: plan.ledger.postId }, select: { notReadyReasons: true } });
        const retained = post.notReadyReasons.filter((reason) => !reason.startsWith("Facebook export missing "));
        const reasons = missing.length ? [...retained, `Facebook export missing ${missing.length}/${plan.ledger.expectedMediaUris.length} expected media files`] : retained;
        await prisma.post.update({ where: { id: plan.ledger.postId }, data: { notReadyReasons: reasons } });
      }
      repairedEvents++;
    } catch (error) {
      failed++;
      console.error(`Failed HTML repair ${plan.ledger.id}: ${String(error)}`);
    }
    if ((index + 1) % 20 === 0 || index + 1 === plans.length) {
      console.log(`HTML repair progress ${index + 1}/${plans.length}`);
    }
  }
  return { ledgerEventsWithMissingMedia: ledgers.length, repairedEvents, repairedMedia, sourceLocatedForUnlinkedEvents, failed };
}

function actionSummary(plans: ActivityPlan[]) {
  return Object.fromEntries([...new Set(plans.map((plan) => plan.action))].sort().map((action) => [action, plans.filter((plan) => plan.action === action).length]));
}

async function main() {
  console.log(`Scanning ZIPs without extraction: ${sourceDir}`);
  const scan = await scanExports();
  currentScan = scan;
  const activities = scan.activities.filter((activity) => !onlyKind || activity.kind === onlyKind);
  const userId = await resolveUserId();
  const plans = await buildPlan(userId, scan, activities);
  const htmlRepairPlan = await repairPostsFromHtml(userId, scan, true);
  const referencedPostMedia = new Set(scan.postHtml.mediaReferences);
  const timelineExpected = await prisma.facebookImportEvent.findMany({ where: { userId, canonicalKey: { startsWith: "fb_timeline_" } }, select: { expectedMediaUris: true } });
  const expectedUris = unique(timelineExpected.flatMap((row) => row.expectedMediaUris));
  const postHtmlExtras = [...referencedPostMedia].filter((uri) => !expectedUris.includes(uri));
  const report: Record<string, unknown> = {
    version: 2,
    generatedAt: new Date().toISOString(),
    apply,
    userId,
    sourceDirectory: sourceDir,
    archives: scan.archives,
    sourceSummary: {
      stories: scan.activities.filter((activity) => activity.kind === "STORY").length,
      reels: scan.activities.filter((activity) => activity.kind === "REEL").length,
      storyMediaFiles: scan.storyMedia.size,
      reelMediaFiles: scan.reelMedia.size,
      postHtmlFiles: scan.postHtml.files,
      postHtmlSections: scan.postHtml.sections,
      postHtmlMediaReferences: scan.postHtml.mediaReferences.length,
      postHtmlExternalUrls: scan.postHtml.externalUrls.length,
      postHtmlExtraMediaVariants: postHtmlExtras,
      mediaSelection: "Prefer Stories/Reels JSON bytes; retain a larger existing DB copy; use Posts HTML only to repair JSON media gaps",
    },
    planSummary: actionSummary(plans),
    htmlRepairPlan,
    plans,
  };
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ sourceSummary: report.sourceSummary, planSummary: report.planSummary, htmlRepairPlan }, null, 2));
  if (apply) {
    report.htmlRepairResult = await repairPostsFromHtml(userId, scan, false);
    report.activityApplyResult = await applyActivities(userId, scan, activities, plans);
    report.completedAt = new Date().toISOString();
    await writeFile(reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ htmlRepairResult: report.htmlRepairResult, activityApplyResult: report.activityApplyResult }, null, 2));
  }
  console.log(`${apply ? "Final import" : "Dry-run audit"}: ${reportPath}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
