/**
 * AI-assisted duplicate detection across any Post kind.
 *
 * Catches near-duplicates that rule-based dedupe (scripts/dedupe-posts.ts)
 * can't see: same content re-uploaded with different timestamps, re-encoded
 * videos with different filenames, empty-body media without byte-identical
 * files, etc. Uses Claude vision to compare media + body for candidate pairs.
 *
 * Pipeline:
 *   1. Bucket posts by (userId, postType, day-of-originalDate) — configurable
 *      window via --window=<hours>.
 *   2. Within each bucket, generate every pair.
 *   3. Cheap prefilter (mime category match, media-count sanity).
 *   4. Ask Claude if each pair is the same post. Response: {same, confidence, reason}.
 *   5. Union-find over positive pairs → duplicate groups.
 *   6. Within a group, keep the oldest createdAt and report/trash the rest.
 *
 * Usage:
 *   node --env-file=.env.local node_modules/.bin/tsx scripts/ai-dedupe.ts
 *     [--kind=POST|STORY|REEL|all]    filter post kind (default: all)
 *     [--window=24]                   same-bucket window in hours (default: 24)
 *     [--source=FACEBOOK|MANUAL|all]  filter source (default: all)
 *     [--user=<userId>]               limit to a single user
 *     [--ids=id1,id2,id3]             compare only these specific posts
 *     [--confidence=0.85]             threshold for auto-trash (default: 0.85)
 *     [--model=haiku|sonnet]          vision model (default: haiku)
 *     [--max-pairs=200]               safety cap on Claude calls (default: 200)
 *     [--apply]                       actually move droppable rows to trash
 *
 * Output:
 *   - Dry run: prints candidate groups with confidence + reason.
 *   - --apply: snapshots droppable rows to ./trash/<stamp>-rule-AI/ (same
 *     format as dedupe-posts.ts, so /admin/trash + --restore both work).
 */
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { v2 as cloudinary } from "cloudinary";
import { prisma } from "../src/lib/prisma";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const client = new Anthropic();
const TRASH_ROOT = path.join(process.cwd(), "trash");

// ────────────────────────────────────────────────────────── arg helpers

function getArg(name: string, def?: string): string | undefined {
  const pref = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(pref));
  return found?.slice(pref.length) ?? def;
}
function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const KIND = (getArg("kind", "all") ?? "all").toUpperCase();
const SOURCE = (getArg("source", "all") ?? "all").toUpperCase();
const WINDOW_HOURS = Number(getArg("window", "24"));
const USER = getArg("user");
const IDS = (getArg("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const CONFIDENCE = Number(getArg("confidence", "0.85"));
const MODEL = (getArg("model", "haiku") ?? "haiku").toLowerCase();
const MAX_PAIRS = Number(getArg("max-pairs", "200"));
const APPLY = hasFlag("apply");
const RESUME_FROM = getArg("resume");

const MODEL_ID =
  MODEL === "sonnet" ? "claude-sonnet-4-6" : "claude-haiku-4-5-20251001";

// ────────────────────────────────────────────────────────── types

type PostRow = {
  id: string;
  userId: string;
  body: string;
  originalDate: Date;
  createdAt: Date;
  postType: string;
  source: string;
  media: Array<{
    id: string;
    storageKey: string;
    mimeType: string;
    sizeBytes: bigint | number | null;
  }>;
};

type Verdict = { same: boolean; confidence: number; reason: string };

// ────────────────────────────────────────────────────────── fetching

async function loadPosts(): Promise<PostRow[]> {
  const where: Record<string, unknown> = {};
  if (IDS.length) where.id = { in: IDS };
  if (KIND !== "ALL") where.postType = KIND;
  if (SOURCE !== "ALL") where.source = SOURCE;
  if (USER) where.userId = USER;

  const rows = await prisma.post.findMany({
    where,
    include: { media: true },
    orderBy: { originalDate: "asc" },
  });
  return rows as unknown as PostRow[];
}

// ────────────────────────────────────────────────────────── bucketing

function bucketKey(p: PostRow): string {
  // Floor originalDate into WINDOW_HOURS-sized buckets. Pairs within the same
  // bucket (and adjacent buckets, handled by overlap pass below) are candidates.
  const ms = p.originalDate.getTime();
  const bucketMs = WINDOW_HOURS * 3600 * 1000;
  const bucket = Math.floor(ms / bucketMs);
  return `${p.userId}|${p.postType}|${bucket}`;
}

function pairsForPosts(posts: PostRow[]): Array<[PostRow, PostRow]> {
  // Group into buckets; also emit pairs across adjacent buckets so content
  // near a bucket boundary isn't missed.
  const byBucket = new Map<string, PostRow[]>();
  for (const p of posts) {
    const k = bucketKey(p);
    if (!byBucket.has(k)) byBucket.set(k, []);
    byBucket.get(k)!.push(p);
  }

  const pairs: Array<[PostRow, PostRow]> = [];
  for (const [, group] of byBucket) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        pairs.push([group[i], group[j]]);
      }
    }
  }
  // Adjacent-bucket spillover: same (user, kind), bucket diff == 1, time diff
  // within WINDOW_HOURS.
  const sorted = [...posts].sort(
    (a, b) => a.originalDate.getTime() - b.originalDate.getTime()
  );
  const bucketMs = WINDOW_HOURS * 3600 * 1000;
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i];
      const b = sorted[j];
      if (a.userId !== b.userId || a.postType !== b.postType) continue;
      const dt = b.originalDate.getTime() - a.originalDate.getTime();
      if (dt > bucketMs) break;
      // Skip if already paired via same bucket.
      if (bucketKey(a) === bucketKey(b)) continue;
      pairs.push([a, b]);
    }
  }
  return pairs;
}

// ────────────────────────────────────────────────────────── prefilter

function shouldSkipPair(a: PostRow, b: PostRow): string | null {
  // Skip pairs where text-only bodies already match exactly — rule B/D
  // in dedupe-posts.ts handles those.
  if (a.media.length === 0 && b.media.length === 0) {
    if (a.body.trim() && a.body.trim() === b.body.trim()) {
      return "identical text — use rule B/D";
    }
    if (!a.body.trim() && !b.body.trim()) {
      return "both empty and no media";
    }
  }
  // Skip when one is text-only and the other is pure media (very unlikely dup).
  if (a.media.length === 0 && b.media.length > 0 && !a.body.trim()) {
    return "text-empty vs media";
  }
  if (b.media.length === 0 && a.media.length > 0 && !b.body.trim()) {
    return "text-empty vs media";
  }
  // Skip when media mime categories disagree (all video vs all image).
  const cat = (m: PostRow["media"]) =>
    new Set(m.map((x) => x.mimeType.split("/")[0]));
  const ca = cat(a.media);
  const cb = cat(b.media);
  if (ca.size === 1 && cb.size === 1) {
    const [onlyA] = ca;
    const [onlyB] = cb;
    if (onlyA !== onlyB) return `mime category ${onlyA} vs ${onlyB}`;
  }
  return null;
}

// ────────────────────────────────────────────────────────── media → base64

type ImgBlock = {
  type: "image";
  source: {
    type: "base64";
    media_type: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
    data: string;
  };
};

async function fetchAsBase64(url: string): Promise<ImgBlock | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const ct = res.headers.get("content-type") ?? "image/jpeg";
    const media_type = (
      ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(ct)
        ? ct
        : "image/jpeg"
    ) as ImgBlock["source"]["media_type"];
    return {
      type: "image",
      source: { type: "base64", media_type, data: buf.toString("base64") },
    };
  } catch {
    return null;
  }
}

async function mediaBlocksFor(post: PostRow, maxBlocks: number): Promise<ImgBlock[]> {
  const out: ImgBlock[] = [];
  for (const m of post.media) {
    if (out.length >= maxBlocks) break;
    const publicId = m.storageKey.replace(/\.[^/.]+$/, "");
    if (m.mimeType.startsWith("image/")) {
      const url = cloudinary.url(publicId, {
        resource_type: "image",
        type: "upload",
        transformation: [{ width: 512, crop: "limit", quality: "auto" }],
        format: "jpg",
      });
      const b = await fetchAsBase64(url);
      if (b) out.push(b);
    } else if (m.mimeType.startsWith("video/")) {
      // Two frames: start + midpoint. Enough to disambiguate re-uploads.
      for (const offset of ["0p", "50p"]) {
        if (out.length >= maxBlocks) break;
        const url = cloudinary.url(publicId, {
          resource_type: "video",
          type: "upload",
          transformation: [
            { start_offset: offset },
            { width: 512, crop: "limit", quality: "auto" },
          ],
          format: "jpg",
        });
        const b = await fetchAsBase64(url);
        if (b) out.push(b);
      }
    }
  }
  return out;
}

// ────────────────────────────────────────────────────────── Claude compare

const PAIR_PROMPT = `You compare two social-media posts and decide whether they are duplicates (the same underlying content, possibly re-uploaded, re-encoded, cropped slightly, or reshared by the same user).

Return ONLY a JSON object with:
  "same": boolean
  "confidence": number 0..1
  "reason": short string (≤ 120 chars)

Duplicates: same scene/subject/moment, same text meaning. Slight re-encoding, format changes, resolution changes → still duplicates.
Not duplicates: different scene, different people, same location on different days, same caption reused for new content.

If media is identical OR near-identical, set confidence ≥ 0.9.
If only body is similar but media clearly differs, set same=false.
If you genuinely can't tell, set confidence ≤ 0.5.`;

async function comparePair(a: PostRow, b: PostRow): Promise<Verdict> {
  // Budget: up to 3 thumbnails per post, 6 total images.
  const aBlocks = await mediaBlocksFor(a, 3);
  const bBlocks = await mediaBlocksFor(b, 3);

  const content: Anthropic.MessageParam["content"] = [];
  content.push({
    type: "text",
    text:
      `POST A (id=${a.id}, ${a.postType}, ${a.originalDate.toISOString()}):\n` +
      `body: ${JSON.stringify(a.body.slice(0, 400))}\n` +
      `media: ${a.media.length} file(s), mime=${a.media.map((m) => m.mimeType).join(",") || "-"}`,
  });
  for (const blk of aBlocks) content.push(blk);
  content.push({
    type: "text",
    text:
      `POST B (id=${b.id}, ${b.postType}, ${b.originalDate.toISOString()}):\n` +
      `body: ${JSON.stringify(b.body.slice(0, 400))}\n` +
      `media: ${b.media.length} file(s), mime=${b.media.map((m) => m.mimeType).join(",") || "-"}`,
  });
  for (const blk of bBlocks) content.push(blk);
  content.push({ type: "text", text: PAIR_PROMPT });

  const response = await client.messages.create({
    model: MODEL_ID,
    max_tokens: 256,
    messages: [{ role: "user", content }],
  });
  const text =
    response.content.find((b): b is Anthropic.TextBlock => b.type === "text")
      ?.text ?? "{}";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { same: false, confidence: 0, reason: "no json from model" };
  try {
    const parsed = JSON.parse(match[0]) as Partial<Verdict>;
    return {
      same: !!parsed.same,
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence ?? 0))),
      reason: String(parsed.reason ?? "").slice(0, 200),
    };
  } catch {
    return { same: false, confidence: 0, reason: "json parse error" };
  }
}

// ────────────────────────────────────────────────────────── union-find

class UF {
  parent = new Map<string, string>();
  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let p = this.parent.get(x)!;
    while (p !== this.parent.get(p)) {
      p = this.parent.get(p)!;
    }
    this.parent.set(x, p);
    return p;
  }
  union(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

// ────────────────────────────────────────────────────────── main

// Parse a prior run's log into a map of pair-key → prior verdict so the new
// run can skip already-evaluated pairs. Pair key is alphabetically sorted
// "idA|idB" so orientation differences don't miss matches.
function loadPriorVerdicts(logPath: string): Map<string, Verdict> {
  const out = new Map<string, Verdict>();
  let text: string;
  try {
    text = fsSync.readFileSync(logPath, "utf8");
  } catch {
    console.warn(`⚠ --resume log not readable: ${logPath}`);
    return out;
  }
  // Match both DUP and --- (not-dup) lines so we can skip either outcome.
  const re =
    /\[\d+\/\d+\]\s+(c[a-z0-9]{24})\s+vs\s+(c[a-z0-9]{24})\s+…\s+(DUP|---)\s+conf=([\d.]+)\s+(.+?)$/;
  let count = 0;
  for (const line of text.split("\n")) {
    const m = line.match(re);
    if (!m) continue;
    const [, a, b, verdict, conf, reason] = m;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    out.set(key, {
      same: verdict === "DUP",
      confidence: Number(conf),
      reason: reason.trim(),
    });
    count++;
  }
  console.log(`Loaded ${count} prior verdict(s) from ${logPath}.`);
  return out;
}

async function main() {
  console.log(
    `AI dedupe: kind=${KIND} source=${SOURCE} window=${WINDOW_HOURS}h model=${MODEL_ID} confidence≥${CONFIDENCE}${APPLY ? " [APPLY]" : " [DRY]"}${RESUME_FROM ? ` resume=${RESUME_FROM}` : ""}`
  );
  const priorVerdicts = RESUME_FROM
    ? loadPriorVerdicts(RESUME_FROM)
    : new Map<string, Verdict>();

  const posts = await loadPosts();
  console.log(`Loaded ${posts.length} post(s).`);

  const allPairs = pairsForPosts(posts);
  console.log(`Candidate pairs (by bucket): ${allPairs.length}`);

  // Dedup identical pairs that can arise from bucket + adjacent-spillover overlap.
  const seenPair = new Set<string>();
  const pairs: Array<[PostRow, PostRow]> = [];
  for (const [a, b] of allPairs) {
    const k = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
    if (seenPair.has(k)) continue;
    seenPair.add(k);
    pairs.push([a, b]);
  }

  // Prefilter
  const evaluable: Array<[PostRow, PostRow]> = [];
  let skipped = 0;
  for (const [a, b] of pairs) {
    const skip = shouldSkipPair(a, b);
    if (skip) {
      skipped++;
      continue;
    }
    evaluable.push([a, b]);
  }
  console.log(`After prefilter: ${evaluable.length} (skipped ${skipped}).`);

  if (evaluable.length > MAX_PAIRS) {
    console.log(
      `⚠ capping at --max-pairs=${MAX_PAIRS}. Re-run with a tighter --window, --kind, or --user, or raise --max-pairs.`
    );
    evaluable.length = MAX_PAIRS;
  }

  // Ask Claude per pair (or replay a prior verdict when --resume supplied).
  const verdicts: Array<{ a: PostRow; b: PostRow; v: Verdict }> = [];
  let reused = 0;
  for (let i = 0; i < evaluable.length; i++) {
    const [a, b] = evaluable[i];
    const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
    const prior = priorVerdicts.get(key);
    if (prior) {
      verdicts.push({ a, b, v: prior });
      reused++;
      // Keep the same log format so a future resume can read this log too.
      console.log(
        `  [${i + 1}/${evaluable.length}] ${a.id} vs ${b.id} … ${prior.same ? "DUP" : "---"} conf=${prior.confidence.toFixed(2)}  ${prior.reason}  (resumed)`
      );
      continue;
    }
    process.stdout.write(`  [${i + 1}/${evaluable.length}] ${a.id} vs ${b.id} … `);
    try {
      const v = await comparePair(a, b);
      verdicts.push({ a, b, v });
      console.log(
        `${v.same ? "DUP" : "---"} conf=${v.confidence.toFixed(2)}  ${v.reason}`
      );
    } catch (e) {
      console.log(`ERR ${(e as Error).message}`);
    }
  }
  if (reused > 0) {
    console.log(`\nReused ${reused} prior verdict(s); called Claude for ${evaluable.length - reused}.`);
  }

  // Build groups from positive verdicts
  const uf = new UF();
  const keep = new Map<string, PostRow>();
  for (const { a, b, v } of verdicts) {
    keep.set(a.id, a);
    keep.set(b.id, b);
    if (v.same && v.confidence >= CONFIDENCE) {
      uf.union(a.id, b.id);
    }
  }

  const groups = new Map<string, string[]>();
  for (const id of keep.keys()) {
    const r = uf.find(id);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(id);
  }

  const dupGroups: Array<{ keep: PostRow; drop: PostRow[]; notes: string[] }> = [];
  for (const [, ids] of groups) {
    if (ids.length < 2) continue;
    const rows = ids
      .map((id) => keep.get(id)!)
      .sort((x, y) => {
        const dt = x.createdAt.getTime() - y.createdAt.getTime();
        return dt !== 0 ? dt : x.id.localeCompare(y.id);
      });
    const [k, ...rest] = rows;
    const notes = verdicts
      .filter(
        (vv) =>
          ids.includes(vv.a.id) && ids.includes(vv.b.id) && vv.v.same
      )
      .map(
        (vv) =>
          `${vv.a.id}↔${vv.b.id}  conf=${vv.v.confidence.toFixed(2)}  ${vv.v.reason}`
      );
    dupGroups.push({ keep: k, drop: rest, notes });
  }

  console.log(`\nDuplicate groups: ${dupGroups.length}`);
  for (const g of dupGroups) {
    console.log(
      `\n  keep  ${g.keep.id}  ${g.keep.originalDate.toISOString().slice(0, 16)}  body=${JSON.stringify(g.keep.body.slice(0, 60))}`
    );
    for (const d of g.drop) {
      console.log(
        `  drop  ${d.id}  ${d.originalDate.toISOString().slice(0, 16)}  body=${JSON.stringify(d.body.slice(0, 60))}`
      );
    }
    for (const n of g.notes) console.log(`        ${n}`);
  }

  if (!APPLY) {
    console.log(`\nDRY RUN — re-run with --apply to move drops to trash.`);
    return;
  }

  if (dupGroups.length === 0) {
    console.log(`\nNothing to trash.`);
    return;
  }

  // Snapshot to trash/, then delete — mirrors dedupe-posts.ts format.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const trashDir = path.join(TRASH_ROOT, `${stamp}-rule-AI`);
  const postsDir = path.join(trashDir, "posts");
  await fs.mkdir(postsDir, { recursive: true });

  const manifest = {
    rule: "AI" as const,
    createdAt: new Date().toISOString(),
    model: MODEL_ID,
    confidenceThreshold: CONFIDENCE,
    groupCount: 0,
    trashedCount: 0,
    groups: [] as Array<{
      keep: string;
      dropped: string[];
      notes: string[];
    }>,
  };

  const idsToDelete: string[] = [];
  for (const g of dupGroups) {
    manifest.groups.push({
      keep: g.keep.id,
      dropped: g.drop.map((d) => d.id),
      notes: g.notes,
    });
    manifest.groupCount++;
    for (const d of g.drop) {
      const snap = await prisma.post.findUnique({
        where: { id: d.id },
        include: { media: true, publishes: true, analytics: true },
      });
      if (!snap) continue;
      await fs.writeFile(
        path.join(postsDir, `${d.id}.json`),
        JSON.stringify(snap, null, 2)
      );
      idsToDelete.push(d.id);
      manifest.trashedCount++;
    }
  }

  await fs.writeFile(
    path.join(trashDir, "manifest.json"),
    JSON.stringify(manifest, null, 2)
  );

  const CHUNK = 500;
  let deleted = 0;
  for (let i = 0; i < idsToDelete.length; i += CHUNK) {
    const chunk = idsToDelete.slice(i, i + CHUNK);
    const res = await prisma.post.deleteMany({ where: { id: { in: chunk } } });
    deleted += res.count;
  }

  const rel = path.relative(process.cwd(), trashDir);
  console.log(
    `\nRule AI: trashed ${deleted} post(s) across ${manifest.groupCount} group(s).`
  );
  console.log(`Trash dir: ${rel}`);
  console.log(
    `  Restore : node --env-file=.env.local node_modules/.bin/tsx scripts/dedupe-posts.ts --restore=${rel}`
  );
  console.log(
    `  Purge   : node --env-file=.env.local node_modules/.bin/tsx scripts/dedupe-posts.ts --purge=${rel}`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
