/**
 * Backfill Post.share for already-imported Facebook posts.
 *
 * Re-parses the original FB JSON export directory with the share-detecting
 * parser and updates matching posts (joined by sourceId). Only touches rows
 * where share is currently null so it's safe to re-run.
 *
 * Also reports pure-share stubs that, under the new parser, would have been
 * skipped — these are imported-but-broken posts you may want to trash.
 *
 * Usage:
 *   node --env-file=.env.local node_modules/.bin/tsx \
 *     scripts/backfill-fb-shares.ts --json <dir>            # dry run
 *   node --env-file=.env.local node_modules/.bin/tsx \
 *     scripts/backfill-fb-shares.ts --json <dir> --apply    # write
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { prisma } from "../src/lib/prisma";
import { parseFacebookFile, ParsedPost } from "../src/lib/facebook-parser";

const args = process.argv.slice(2);
function flag(name: string): string | null {
  const i = args.indexOf(name);
  if (i === -1) return null;
  return args[i + 1] ?? null;
}
const jsonDir = flag("--json");
const apply = args.includes("--apply");
const trashStubs = args.includes("--trash-stubs");
const TRASH_ROOT = path.join(process.cwd(), "trash");

if (!jsonDir) {
  console.error("Usage: ... --json <dir> [--apply]");
  process.exit(1);
}

function findJsonFiles(dir: string): string[] {
  const files: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) files.push(...findJsonFiles(full));
    else if (e.name.endsWith(".json") && !e.name.startsWith(".")) files.push(full);
  }
  return files;
}

// Mirrors the drop in parseFacebookExport: re-scan raw posts to find
// pure-share stubs (title "X shared …" with external_context, no body) that
// the new parser would skip.
interface SharelessStub {
  sourceId: string;
  title: string;
  url?: string;
}
function findSharelessStubs(raw: unknown): SharelessStub[] {
  if (!Array.isArray(raw)) return [];
  // First pass: bucket entries by timestamp so we can see all sibling entries
  // for a given sourceId at once. FB often serializes a shared post as TWO
  // entries with the same timestamp — a bare "stub" with just update_timestamp
  // and a real entry with `data[].post`. An entry is only a true stub if NO
  // entry with the same timestamp carries a body.
  const byTs = new Map<number, Array<Record<string, unknown>>>();
  for (const item of raw as Array<Record<string, unknown>>) {
    const ts = item.timestamp as number | undefined;
    if (!ts) continue;
    const arr = byTs.get(ts) ?? [];
    arr.push(item);
    byTs.set(ts, arr);
  }

  const stubs: SharelessStub[] = [];
  for (const [ts, siblings] of byTs) {
    const first = siblings[0];
    const title = first.title as string | undefined;
    if (!title) continue;
    if (!/\sshared\s(a|an|his|her|their|[^\s]+'s)\s/i.test(title)) continue;
    // Any sibling with a body disqualifies the whole timestamp as a stub.
    const anyBody = siblings.some((s) => {
      const data = s.data as Array<{ post?: string }> | undefined;
      return Array.isArray(data) && data.some((d) => d?.post);
    });
    if (anyBody) continue;
    // Pull metadata from whichever entry happens to carry it.
    const item = siblings.find((s) => s.attachments) ?? first;
    const attachments = item.attachments as
      | Array<{ data?: Array<{ external_context?: { url?: string } }> }>
      | undefined;
    let url: string | undefined;
    if (Array.isArray(attachments)) {
      for (const att of attachments) {
        for (const d of att.data ?? []) {
          if (d.external_context?.url) {
            url = d.external_context.url;
            break;
          }
        }
        if (url) break;
      }
    }
    stubs.push({ sourceId: `fb_${ts}`, title, url });
  }
  return stubs;
}

async function main() {
  const files = findJsonFiles(jsonDir!);
  console.log(`Scanning ${files.length} JSON files in ${jsonDir}`);

  const withShare: ParsedPost[] = [];
  const stubs: SharelessStub[] = [];

  for (const f of files) {
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(f, "utf8"));
    } catch {
      continue;
    }
    const parsed = parseFacebookFile(raw);
    for (const p of parsed) if (p.share) withShare.push(p);
    stubs.push(...findSharelessStubs(raw));
  }

  console.log(`\nFound ${withShare.length} parsed posts with share metadata`);
  console.log(`Found ${stubs.length} pure-share stubs (new parser drops these)`);

  // Match by sourceId — chunked to avoid giant IN clauses hitting pg limits.
  const sourceIds = withShare.map((p) => p.sourceId);
  const existing: Array<{ id: string; sourceId: string | null; share: unknown; body: string }> = [];
  const CHUNK = 500;
  for (let i = 0; i < sourceIds.length; i += CHUNK) {
    const rows = await prisma.post.findMany({
      where: { sourceId: { in: sourceIds.slice(i, i + CHUNK) } },
      select: { id: true, sourceId: true, share: true, body: true },
    });
    existing.push(...rows);
  }
  const bySourceId = new Map(existing.map((e) => [e.sourceId!, e]));

  let willUpdate = 0;
  let alreadySet = 0;
  let notFound = 0;
  const samples: Array<{ id: string; body: string; share: unknown }> = [];
  for (const p of withShare) {
    const row = bySourceId.get(p.sourceId);
    if (!row) {
      notFound++;
      continue;
    }
    if (row.share != null) {
      alreadySet++;
      continue;
    }
    willUpdate++;
    if (samples.length < 5) {
      samples.push({ id: row.id, body: row.body.slice(0, 80), share: p.share });
    }
    if (apply) {
      await prisma.post.update({
        where: { id: row.id },
        data: { share: p.share as object },
      });
    }
  }

  console.log(`\nshare backfill:`);
  console.log(`  updated : ${willUpdate}`);
  console.log(`  already : ${alreadySet}`);
  console.log(`  missing : ${notFound} (parsed but not in DB)`);

  if (samples.length) {
    console.log(`\n  sample updates:`);
    for (const s of samples) {
      console.log(`    ${s.id}  body=${JSON.stringify(s.body)}  share=${JSON.stringify(s.share)}`);
    }
  }

  // Check stubs against DB — these are broken imports
  const stubIds = stubs.map((s) => s.sourceId);
  const stubRows: Array<{ id: string; sourceId: string | null; body: string; originalDate: Date }> = [];
  for (let i = 0; i < stubIds.length; i += CHUNK) {
    const rows = await prisma.post.findMany({
      where: { sourceId: { in: stubIds.slice(i, i + CHUNK) } },
      select: { id: true, sourceId: true, body: true, originalDate: true },
    });
    stubRows.push(...rows);
  }
  console.log(`\npure-share stubs in DB: ${stubRows.length} / ${stubs.length}`);
  if (stubRows.length) {
    const stubBySource = new Map(stubs.map((s) => [s.sourceId, s]));
    console.log(`  sample broken imports (consider trashing with --trash-stubs):`);
    for (const r of stubRows.slice(0, 10)) {
      const s = stubBySource.get(r.sourceId!);
      console.log(
        `    ${r.id}  date=${r.originalDate.toISOString().slice(0, 10)}  title=${JSON.stringify(s?.title)}  url=${s?.url ?? "-"}`
      );
    }
  }

  if (trashStubs && stubRows.length) {
    if (!apply) {
      console.log(`\n--trash-stubs given without --apply → skipping (add --apply to actually trash).`);
    } else {
      await trashStubPosts(stubRows, stubs);
    }
  }

  if (!apply) console.log(`\nDRY RUN — re-run with --apply to write.`);
}

// Snapshot stub posts to ./trash/<stamp>-rule-F-fb-share-stubs/ then delete
// them from the DB, mirroring the format produced by scripts/dedupe-posts.ts
// so the /admin/trash UI can render them. The manifest records, per stub,
// the original FB title and the external_context url (if any) so the reason
// for trashing is self-evident on restore.
async function trashStubPosts(
  rows: Array<{ id: string; sourceId: string | null; body: string; originalDate: Date }>,
  stubs: SharelessStub[],
) {
  const fs = await import("node:fs/promises");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const trashDir = path.join(TRASH_ROOT, `${stamp}-rule-F-fb-share-stubs`);
  const postsDir = path.join(trashDir, "posts");
  await fs.mkdir(postsDir, { recursive: true });

  const stubBySource = new Map(stubs.map((s) => [s.sourceId, s]));
  const manifest = {
    rule: "F" as const,
    createdAt: new Date().toISOString(),
    groupCount: rows.length,
    trashedCount: 0,
    reason:
      "Empty Facebook share stubs — imported from FB export with only a 'X shared a post.' title, no body, no media, no original commentary. With the new share-aware parser these would be dropped at import time.",
    groups: [] as Array<{ keep: string; dropped: string[]; fbTitle?: string; fbUrl?: string }>,
  };

  const idsToDelete: string[] = [];
  let skippedNonEmpty = 0;
  for (const r of rows) {
    const s = stubBySource.get(r.sourceId!);
    const snap = await prisma.post.findUnique({
      where: { id: r.id },
      include: { media: true, publishes: true, analytics: true },
    });
    if (!snap) continue;
    // Defense in depth: never trash a row whose DB body is non-empty, even if
    // the JSON file made it look like a stub. FB can serialize a shared post
    // as two entries (stub + real) under the same timestamp; the stub-finder
    // already handles that, but this guard catches any future mismatch.
    if ((snap.body ?? "").trim().length > 0 || (snap.media?.length ?? 0) > 0) {
      skippedNonEmpty++;
      continue;
    }
    // Stash the FB stub metadata alongside the snapshot so restore + UI can
    // explain why this row was trashed without needing the original export.
    const enriched = {
      ...snap,
      _trashReason: {
        rule: "F",
        fbTitle: s?.title,
        fbUrl: s?.url ?? null,
        note:
          "Facebook 'shared a post' wrapper with no user-authored content. Dropped because the import produced a post with no body, no media, and no recoverable context.",
      },
    };
    await fs.writeFile(
      path.join(postsDir, `${r.id}.json`),
      JSON.stringify(enriched, null, 2),
    );
    manifest.groups.push({
      keep: "",
      dropped: [r.id],
      fbTitle: s?.title,
      fbUrl: s?.url,
    });
    manifest.trashedCount++;
    idsToDelete.push(r.id);
  }

  await fs.writeFile(
    path.join(trashDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );

  const CHUNK = 500;
  let deleted = 0;
  for (let i = 0; i < idsToDelete.length; i += CHUNK) {
    const chunk = idsToDelete.slice(i, i + CHUNK);
    const res = await prisma.post.deleteMany({ where: { id: { in: chunk } } });
    deleted += res.count;
  }

  const rel = path.relative(process.cwd(), trashDir);
  console.log(`\ntrashed ${deleted} empty-share stub(s) → ${rel}`);
  if (skippedNonEmpty > 0) {
    console.log(
      `  skipped ${skippedNonEmpty} row(s) whose DB body/media was non-empty (safety guard)`,
    );
  }
  console.log(
    `  Restore: node --env-file=.env.local node_modules/.bin/tsx scripts/dedupe-posts.ts --restore=${rel}`,
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
