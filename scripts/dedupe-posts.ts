/**
 * Dedupe Posts with soft-delete (trash) workflow.
 *
 * Rules:
 *   A  same (userId, sourceId)                        — sourceId NOT NULL
 *   B  same (userId, body, originalDate)              — non-empty body
 *   C  same (userId, body, originalDate, media fingerprint) — body may be empty
 *   D  same (userId, bodyNormalized), non-empty body  — ignores originalDate,
 *      AGGRESSIVE: collapses distinct posts with reused captions. Use only
 *      if you've verified none of your posts reuse captions.
 *   E  same (userId, bodyNormalized), non-empty body, AND every row in the
 *      group has zero media. This is the safe variant of D: it catches
 *      Facebook-export edit-history artifacts (same text posted twice because
 *      FB serializes both the pre-edit and post-edit entries) without touching
 *      legitimate media series that share a caption.
 *
 * Within a duplicate group, keep the row with the oldest createdAt (ties
 * broken by smallest id) and mark the rest for trashing.
 *
 * Modes:
 *   --rule=<A|B|C>          choose detection rule (default A)
 *   (no other flag)         dry-run report
 *   --trash                 snapshot droppable rows to ./trash/… then delete
 *                           them from the DB (cascades Media / PublishRecord /
 *                           PostAnalytics rows in the DB only — Cloudinary
 *                           blobs are never touched)
 *   --list-trash            list trash directories with a summary
 *   --restore=<trash-dir>   recreate posts from a trash dir (full fidelity)
 *   --purge=<trash-dir>     permanently delete a trash dir
 *
 * Load env vars with `node --env-file=.env.local`.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { prisma } from "../src/lib/prisma";
import { normalizeForSearch } from "../src/lib/search-normalize";

const TRASH_ROOT = path.join(process.cwd(), "trash");

type Rule = "A" | "B" | "C" | "D" | "E";

type Group = {
  userId: string;
  sourceId: string | null;
  body: string;
  originalDate: Date | null;
  postIds: string[]; // ordered: [keep, ...drop]
};

// ────────────────────────────────────────────────────────── arg helpers

function getArg(name: string): string | undefined {
  const pref = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(pref));
  return found?.slice(pref.length);
}
function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

// ────────────────────────────────────────────────────────── detection

async function findGroupsA(): Promise<Group[]> {
  const groups = await prisma.$queryRaw<
    { userId: string; sourceId: string; cnt: bigint }[]
  >`
    SELECT "userId", "sourceId", COUNT(*)::bigint AS cnt
    FROM "Post"
    WHERE "sourceId" IS NOT NULL
    GROUP BY "userId", "sourceId"
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC
  `;
  const out: Group[] = [];
  for (const g of groups) {
    const ids = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Post"
      WHERE "userId" = ${g.userId} AND "sourceId" = ${g.sourceId}
      ORDER BY "createdAt" ASC, id ASC
    `;
    out.push({
      userId: g.userId,
      sourceId: g.sourceId,
      body: "",
      originalDate: null,
      postIds: ids.map((r) => r.id),
    });
  }
  return out;
}

async function findGroupsB(): Promise<Group[]> {
  const groups = await prisma.$queryRaw<
    { userId: string; body: string; originalDate: Date; cnt: bigint }[]
  >`
    SELECT "userId", body, "originalDate", COUNT(*)::bigint AS cnt
    FROM "Post"
    WHERE body IS NOT NULL AND body <> ''
    GROUP BY "userId", body, "originalDate"
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC
  `;
  const out: Group[] = [];
  for (const g of groups) {
    const ids = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Post"
      WHERE "userId" = ${g.userId}
        AND body = ${g.body}
        AND "originalDate" = ${g.originalDate}
      ORDER BY "createdAt" ASC, id ASC
    `;
    out.push({
      userId: g.userId,
      sourceId: null,
      body: g.body,
      originalDate: g.originalDate,
      postIds: ids.map((r) => r.id),
    });
  }
  return out;
}

async function findGroupsC(): Promise<Group[]> {
  // 1. coarse buckets: same (userId, body, originalDate), empty body allowed
  const coarse = await prisma.$queryRaw<
    { userId: string; body: string; originalDate: Date; cnt: bigint }[]
  >`
    SELECT "userId", body, "originalDate", COUNT(*)::bigint AS cnt
    FROM "Post"
    GROUP BY "userId", body, "originalDate"
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC
  `;

  const out: Group[] = [];
  for (const g of coarse) {
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Post"
      WHERE "userId" = ${g.userId}
        AND body = ${g.body}
        AND "originalDate" = ${g.originalDate}
      ORDER BY "createdAt" ASC, id ASC
    `;

    // 2. split by media fingerprint (sorted originalUri ?? storageKey)
    const buckets = new Map<string, string[]>();
    for (const r of rows) {
      const media = await prisma.$queryRaw<
        { storageKey: string; originalUri: string | null }[]
      >`
        SELECT "storageKey", "originalUri" FROM "Media" WHERE "postId" = ${r.id}
      `;
      const fp = media
        .map((m) => m.originalUri ?? m.storageKey)
        .sort()
        .join("||");
      const list = buckets.get(fp) ?? [];
      list.push(r.id);
      buckets.set(fp, list);
    }

    for (const ids of buckets.values()) {
      if (ids.length > 1) {
        out.push({
          userId: g.userId,
          sourceId: null,
          body: g.body,
          originalDate: g.originalDate,
          postIds: ids, // already sorted by createdAt ASC from outer query
        });
      }
    }
  }
  return out;
}

async function findGroupsD(): Promise<Group[]> {
  const groups = await prisma.$queryRaw<
    { userId: string; bodyNormalized: string; cnt: bigint }[]
  >`
    SELECT "userId", "bodyNormalized", COUNT(*)::bigint AS cnt
    FROM "Post"
    WHERE "bodyNormalized" IS NOT NULL AND "bodyNormalized" <> ''
    GROUP BY "userId", "bodyNormalized"
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC
  `;
  const out: Group[] = [];
  for (const g of groups) {
    const rows = await prisma.$queryRaw<{ id: string; body: string; originalDate: Date }[]>`
      SELECT id, body, "originalDate" FROM "Post"
      WHERE "userId" = ${g.userId} AND "bodyNormalized" = ${g.bodyNormalized}
      ORDER BY "createdAt" ASC, id ASC
    `;
    out.push({
      userId: g.userId,
      sourceId: null,
      body: rows[0]?.body ?? "",
      originalDate: rows[0]?.originalDate ?? null,
      postIds: rows.map((r) => r.id),
    });
  }
  return out;
}

async function findGroupsE(): Promise<Group[]> {
  // Start from D's groups, then keep only those where every row has zero media.
  const dGroups = await findGroupsD();
  const out: Group[] = [];
  for (const g of dGroups) {
    const mediaCounts = await prisma.$queryRaw<{ id: string; mc: number }[]>`
      SELECT p.id,
        (SELECT COUNT(*)::int FROM "Media" m WHERE m."postId" = p.id) AS mc
      FROM "Post" p
      WHERE p.id = ANY(${g.postIds}::text[])
    `;
    const allTextOnly = mediaCounts.every((r) => r.mc === 0);
    if (allTextOnly) out.push(g);
  }
  return out;
}

async function findGroups(rule: Rule): Promise<Group[]> {
  if (rule === "A") return findGroupsA();
  if (rule === "B") return findGroupsB();
  if (rule === "C") return findGroupsC();
  if (rule === "D") return findGroupsD();
  return findGroupsE();
}

// ────────────────────────────────────────────────────────── dry-run

async function doDryRun(rule: Rule) {
  const groups = await findGroups(rule);
  const totalDrop = groups.reduce((n, g) => n + g.postIds.length - 1, 0);

  if (groups.length === 0) {
    console.log(`Rule ${rule}: no duplicate groups found.`);
    return;
  }

  console.log(
    `Rule ${rule}: ${groups.length} duplicate group(s), ${totalDrop} row(s) would move to trash.\n`
  );

  const sampleN = Math.min(10, groups.length);
  console.log(`Sample (${sampleN} of ${groups.length} groups):`);
  for (let i = 0; i < sampleN; i++) {
    const g = groups[i];
    const rows = await prisma.$queryRaw<
      {
        id: string;
        body: string;
        createdAt: Date;
        mc: number;
        pc: number;
      }[]
    >`
      SELECT
        p.id,
        p.body,
        p."createdAt",
        (SELECT COUNT(*)::int FROM "Media" m WHERE m."postId" = p.id) AS mc,
        (SELECT COUNT(*)::int FROM "PublishRecord" pr WHERE pr."postId" = p.id) AS pc
      FROM "Post" p
      WHERE p.id = ANY(${g.postIds}::text[])
      ORDER BY p."createdAt" ASC, p.id ASC
    `;
    console.log(`\n  Group ${i + 1}: ${g.postIds.length} rows`);
    if (rule !== "A") {
      const bodyPreview = (g.body || "(empty)").replace(/\s+/g, " ").slice(0, 70);
      console.log(`    body : "${bodyPreview}"`);
      console.log(`    date : ${g.originalDate?.toISOString().slice(0, 10)}`);
    } else {
      console.log(`    sourceId : ${g.sourceId}`);
    }
    rows.forEach((r, idx) => {
      const label = idx === 0 ? "KEEP" : "DROP";
      console.log(
        `    ${label}  ${r.id}  ${r.createdAt.toISOString()}  media=${r.mc} pub=${r.pc}`
      );
    });
  }

  console.log(`\nDRY RUN — no changes made.`);
  console.log(`Move to trash with: --rule=${rule} --trash`);
}

// ────────────────────────────────────────────────────────── trash

async function doTrash(rule: Rule) {
  const groups = await findGroups(rule);
  if (groups.length === 0) {
    console.log(`Rule ${rule}: no duplicates. Nothing to trash.`);
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const trashDir = path.join(TRASH_ROOT, `${stamp}-rule-${rule}`);
  const postsDir = path.join(trashDir, "posts");
  await fs.mkdir(postsDir, { recursive: true });

  const manifest = {
    rule,
    createdAt: new Date().toISOString(),
    groupCount: 0,
    trashedCount: 0,
    groups: [] as Array<{ keep: string; dropped: string[] }>,
  };

  const idsToDelete: string[] = [];

  for (const g of groups) {
    const [keep, ...drop] = g.postIds;
    if (drop.length === 0) continue;
    manifest.groups.push({ keep, dropped: drop });
    manifest.groupCount++;

    for (const dropId of drop) {
      const snap = await prisma.post.findUnique({
        where: { id: dropId },
        include: { media: true, publishes: true, analytics: true },
      });
      if (!snap) continue;
      await fs.writeFile(
        path.join(postsDir, `${dropId}.json`),
        JSON.stringify(snap, null, 2)
      );
      idsToDelete.push(dropId);
      manifest.trashedCount++;
    }
  }

  await fs.writeFile(
    path.join(trashDir, "manifest.json"),
    JSON.stringify(manifest, null, 2)
  );

  // Delete from DB in chunks (cascades to related rows in the DB only)
  const CHUNK = 500;
  let deleted = 0;
  for (let i = 0; i < idsToDelete.length; i += CHUNK) {
    const chunk = idsToDelete.slice(i, i + CHUNK);
    const res = await prisma.post.deleteMany({ where: { id: { in: chunk } } });
    deleted += res.count;
  }

  const rel = path.relative(process.cwd(), trashDir);
  console.log(
    `Rule ${rule}: trashed ${deleted} post(s) across ${manifest.groupCount} group(s).`
  );
  console.log(`Trash dir: ${rel}`);
  console.log(`\nReview, then:`);
  console.log(
    `  Restore : node --env-file=.env.local node_modules/.bin/tsx scripts/dedupe-posts.ts --restore=${rel}`
  );
  console.log(
    `  Purge   : node --env-file=.env.local node_modules/.bin/tsx scripts/dedupe-posts.ts --purge=${rel}`
  );
}

// ────────────────────────────────────────────────────────── restore

type Snap = {
  id: string;
  userId: string;
  body: string;
  bodyHtml: string | null;
  source: string;
  sourceId: string | null;
  originalDate: string;
  createdAt: string;
  updatedAt: string;
  tags: string[];
  media: Array<{
    id: string;
    storageKey: string;
    originalUri: string | null;
    mimeType: string;
    width: number | null;
    height: number | null;
    sizeBytes: number | null;
    altText: string | null;
    hasAudio: boolean | null;
    createdAt: string;
  }>;
  publishes: Array<{
    id: string;
    platform: string;
    status: string;
    scheduledAt: string | null;
    publishedAt: string | null;
    platformPostId: string | null;
    platformUrl: string | null;
    errorMessage: string | null;
    retryCount: number;
    createdAt: string;
    updatedAt: string;
  }>;
  analytics: Array<{
    id: string;
    platform: string;
    platformPostId: string | null;
    reactions: number | null;
    comments: number | null;
    shares: number | null;
    reach: number | null;
    impressions: number | null;
    fetchedAt: string;
    updatedAt: string;
  }>;
};

async function doRestore(trashDir: string) {
  const resolved = path.resolve(trashDir);
  const postsDir = path.join(resolved, "posts");
  const files = await fs.readdir(postsDir);
  let restored = 0;
  let skipped = 0;

  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    const raw = await fs.readFile(path.join(postsDir, f), "utf8");
    const s = JSON.parse(raw) as Snap;

    const exists = await prisma.post.findUnique({ where: { id: s.id } });
    if (exists) {
      skipped++;
      continue;
    }

    await prisma.post.create({
      data: {
        id: s.id,
        userId: s.userId,
        body: s.body,
        bodyHtml: s.bodyHtml,
        bodyNormalized: normalizeForSearch(s.body),
        source: s.source as "FACEBOOK" | "MANUAL",
        sourceId: s.sourceId,
        originalDate: new Date(s.originalDate),
        createdAt: new Date(s.createdAt),
        updatedAt: new Date(s.updatedAt),
        tags: s.tags,
        media: {
          create: s.media.map((m) => ({
            id: m.id,
            storageKey: m.storageKey,
            originalUri: m.originalUri,
            mimeType: m.mimeType,
            width: m.width,
            height: m.height,
            sizeBytes: m.sizeBytes,
            altText: m.altText,
            hasAudio: m.hasAudio,
            createdAt: new Date(m.createdAt),
          })),
        },
        publishes: {
          create: s.publishes.map((p) => ({
            id: p.id,
            platform: p.platform as never,
            status: p.status as never,
            scheduledAt: p.scheduledAt ? new Date(p.scheduledAt) : null,
            publishedAt: p.publishedAt ? new Date(p.publishedAt) : null,
            platformPostId: p.platformPostId,
            platformUrl: p.platformUrl,
            errorMessage: p.errorMessage,
            retryCount: p.retryCount,
            createdAt: new Date(p.createdAt),
            updatedAt: new Date(p.updatedAt),
          })),
        },
        analytics: {
          create: s.analytics.map((a) => ({
            id: a.id,
            platform: a.platform as never,
            platformPostId: a.platformPostId,
            reactions: a.reactions,
            comments: a.comments,
            shares: a.shares,
            reach: a.reach,
            impressions: a.impressions,
            fetchedAt: new Date(a.fetchedAt),
            updatedAt: new Date(a.updatedAt),
          })),
        },
      },
    });
    restored++;
  }
  console.log(`Restored ${restored} post(s) from ${trashDir} (skipped ${skipped} already-present)`);
}

// ────────────────────────────────────────────────────────── purge / list

async function doPurge(trashDir: string) {
  const resolved = path.resolve(trashDir);
  await fs.rm(resolved, { recursive: true, force: true });
  console.log(`Purged ${trashDir}`);
}

async function doListTrash() {
  let entries: string[];
  try {
    entries = await fs.readdir(TRASH_ROOT);
  } catch {
    console.log("(no trash directory)");
    return;
  }
  if (entries.length === 0) {
    console.log("(empty)");
    return;
  }
  for (const d of entries.sort()) {
    const full = path.join(TRASH_ROOT, d);
    const stat = await fs.stat(full);
    if (!stat.isDirectory()) continue;
    try {
      const raw = await fs.readFile(path.join(full, "manifest.json"), "utf8");
      const m = JSON.parse(raw);
      console.log(
        `${d}  rule=${m.rule}  groups=${m.groupCount}  posts=${m.trashedCount}`
      );
    } catch {
      console.log(`${d}  (no manifest)`);
    }
  }
}

// ────────────────────────────────────────────────────────── main

async function main() {
  const rule = ((getArg("rule") ?? "A").toUpperCase()) as Rule;
  const trash = hasFlag("trash");
  const listTrash = hasFlag("list-trash");
  const restore = getArg("restore");
  const purge = getArg("purge");

  if (listTrash) return doListTrash();
  if (restore) return doRestore(restore);
  if (purge) return doPurge(purge);

  if (!["A", "B", "C", "D", "E"].includes(rule)) {
    console.error(`Invalid rule: ${rule}. Use A, B, C, D, or E.`);
    process.exit(1);
  }

  if (trash) return doTrash(rule);
  return doDryRun(rule);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
