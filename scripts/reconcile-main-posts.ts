/**
 * Reconcile the DB against the authoritative "your_posts__check_ins__…*.json"
 * file from a Facebook export. This fixes two problems left behind by
 * historical file-by-file imports:
 *
 *  1. Multi-media parent posts were split into N single-media rows because
 *     album / video files were imported before the main posts file, so the
 *     cross-file dedupe in parser never ran together.
 *  2. Album-imported photos are missing the caption the main post had.
 *
 * For each entry in the main JSON:
 *   - Look up all DB Post rows whose media matches any of the entry's
 *     mediaUris (by `originalUri endsWith '/<filename>'`).
 *   - Categorize:
 *       already-correct — one DB post holds every file listed in JSON
 *       needs-merge     — >1 distinct DB post rows hold the files
 *       body-only       — one row with one media, body empty, JSON has a body
 *       partial         — one row holding a strict subset of the JSON files
 *       missing         — no DB rows at all (not imported)
 *   - For needs-merge: pick the keeper (most media, oldest createdAt),
 *     UPDATE keeper body + originalDate + bodyNormalized from JSON, move
 *     all Media rows from dropped posts onto the keeper, snapshot the
 *     dropped posts to `./trash/<stamp>-reconcile-main/posts/<id>.json`,
 *     then delete the dropped post rows (cascades publishes + analytics
 *     which we already snapshot).
 *   - For body-only: UPDATE body + bodyNormalized in place.
 *
 * Usage:
 *   tsx scripts/reconcile-main-posts.ts <json-path>                # dry-run
 *   tsx scripts/reconcile-main-posts.ts <json-path> --apply        # write
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { prisma } from "../src/lib/prisma";
import { parseFacebookExport, type ParsedPost } from "../src/lib/facebook-parser";
import { normalizeForSearch } from "../src/lib/search-normalize";

const TRASH_ROOT = path.join(process.cwd(), "trash");

type Category =
  | "already-correct"
  | "needs-merge"
  | "body-only"
  | "partial"
  | "missing";

interface Plan {
  parsed: ParsedPost;
  filenames: string[];
  category: Category;
  keeperId?: string;
  droppedIds?: string[];
  bodyFromJson: string;
}

function filenameOf(uri: string): string {
  return path.basename(uri).replace(/\?.*$/, "");
}

async function classify(entry: ParsedPost): Promise<Plan> {
  const filenames = entry.mediaUris.map(filenameOf);
  const plan: Plan = {
    parsed: entry,
    filenames,
    category: "missing",
    bodyFromJson: entry.body,
  };

  if (filenames.length === 0) {
    // The reconciler only addresses the multi-media / missing-body issue,
    // which requires at least one media anchor to find DB rows. Body-only
    // entries from the main file are out of scope for this pass.
    plan.category = "missing";
    return plan;
  }

  const mediaHits = await prisma.media.findMany({
    where: { OR: filenames.map((f) => ({ originalUri: { endsWith: "/" + f } })) },
    select: { postId: true, originalUri: true },
  });
  const byPostId = new Map<string, Set<string>>();
  for (const m of mediaHits) {
    const fn = filenameOf(m.originalUri ?? "");
    if (!filenames.includes(fn)) continue;
    const s = byPostId.get(m.postId) ?? new Set();
    s.add(fn);
    byPostId.set(m.postId, s);
  }

  if (byPostId.size === 0) {
    plan.category = "missing";
    return plan;
  }

  if (byPostId.size === 1) {
    const [postId] = [...byPostId.keys()];
    const held = byPostId.get(postId)!;
    if (held.size === filenames.length) {
      // Already contains every file — may still need a body backfill
      if (entry.body.trim() !== "") {
        const post = await prisma.post.findUnique({
          where: { id: postId },
          select: { body: true },
        });
        if (post && post.body === "") {
          plan.category = "body-only";
          plan.keeperId = postId;
          return plan;
        }
      }
      plan.category = "already-correct";
      plan.keeperId = postId;
      return plan;
    }
    plan.category = "partial";
    plan.keeperId = postId;
    return plan;
  }

  // ≥2 rows hold pieces of this parent post → merge
  // Pick keeper: row that holds the most matched files, tiebreak oldest createdAt
  const candidateIds = [...byPostId.keys()];
  const candidates = await prisma.post.findMany({
    where: { id: { in: candidateIds } },
    select: { id: true, createdAt: true },
  });
  candidates.sort((a, b) => {
    const aHeld = byPostId.get(a.id)!.size;
    const bHeld = byPostId.get(b.id)!.size;
    if (aHeld !== bHeld) return bHeld - aHeld;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
  plan.keeperId = candidates[0].id;
  plan.droppedIds = candidates.slice(1).map((c) => c.id);
  plan.category = "needs-merge";
  return plan;
}

async function snapshotPost(id: string, postsDir: string) {
  const snap = await prisma.post.findUnique({
    where: { id },
    include: { media: true, publishes: true, analytics: true },
  });
  if (!snap) return;
  await fs.writeFile(
    path.join(postsDir, `${id}.json`),
    JSON.stringify(snap, null, 2)
  );
}

async function applyPlan(plans: Plan[], trashDir: string) {
  const postsDir = path.join(trashDir, "posts");
  await fs.mkdir(postsDir, { recursive: true });

  const manifest = {
    rule: "reconcile-main" as const,
    createdAt: new Date().toISOString(),
    merges: 0,
    bodyOnlyUpdates: 0,
    rowsTrashed: 0,
    groups: [] as Array<{ keep: string; dropped: string[] }>,
  };

  for (const plan of plans) {
    if (plan.category === "needs-merge") {
      const keeperId = plan.keeperId!;
      const droppedIds = plan.droppedIds!;

      // 1. Snapshot every dropped post so the merge is reversible
      for (const id of droppedIds) {
        await snapshotPost(id, postsDir);
        manifest.rowsTrashed++;
      }
      manifest.groups.push({ keep: keeperId, dropped: [...droppedIds] });
      manifest.merges++;

      // 2. Move all Media rows from dropped posts onto the keeper
      for (const droppedId of droppedIds) {
        await prisma.media.updateMany({
          where: { postId: droppedId },
          data: { postId: keeperId },
        });
      }

      // 3. Update keeper body + date + normalized-body from JSON
      await prisma.post.update({
        where: { id: keeperId },
        data: {
          body: plan.bodyFromJson,
          bodyNormalized: normalizeForSearch(plan.bodyFromJson),
          originalDate: plan.parsed.originalDate,
        },
      });

      // 4. Delete the dropped post rows (cascades publishes+analytics;
      //    those were snapshotted in step 1)
      await prisma.post.deleteMany({
        where: { id: { in: droppedIds } },
      });
    } else if (plan.category === "body-only") {
      const id = plan.keeperId!;
      await prisma.post.update({
        where: { id },
        data: {
          body: plan.bodyFromJson,
          bodyNormalized: normalizeForSearch(plan.bodyFromJson),
        },
      });
      manifest.bodyOnlyUpdates++;
    }
  }

  await fs.writeFile(
    path.join(trashDir, "manifest.json"),
    JSON.stringify(manifest, null, 2)
  );
  return manifest;
}

async function main() {
  const jsonPath = process.argv[2];
  const apply = process.argv.includes("--apply");
  if (!jsonPath) {
    console.error(
      "Usage: tsx scripts/reconcile-main-posts.ts <path-to-main-posts-json> [--apply]"
    );
    process.exit(1);
  }

  const raw = JSON.parse(await fs.readFile(jsonPath, "utf8"));
  const parsed = parseFacebookExport(raw);
  console.log(`Parsed ${parsed.length} entries from ${jsonPath}`);

  // We care about entries with ≥1 media (multi-media and single-media); body-only
  // entries from the main file are handled by text-dedupe elsewhere.
  const withMedia = parsed.filter((p) => p.mediaUris.length > 0);
  console.log(`  with media: ${withMedia.length}`);

  const plans: Plan[] = [];
  for (const entry of withMedia) {
    plans.push(await classify(entry));
  }

  const counts: Record<Category, number> = {
    "already-correct": 0,
    "needs-merge": 0,
    "body-only": 0,
    partial: 0,
    missing: 0,
  };
  for (const p of plans) counts[p.category]++;

  console.log("\n── Classification ───────────────");
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(17)}: ${v}`);

  // Sample what would change
  const mergeSamples = plans.filter((p) => p.category === "needs-merge").slice(0, 3);
  for (const s of mergeSamples) {
    console.log(
      `\n  merge: keep ${s.keeperId}  drop [${(s.droppedIds ?? []).join(", ")}]`
    );
    console.log(`    body → ${JSON.stringify(s.bodyFromJson.slice(0, 60))}`);
    console.log(`    files: ${s.filenames.join(", ")}`);
  }
  const bodySamples = plans.filter((p) => p.category === "body-only").slice(0, 3);
  for (const s of bodySamples) {
    console.log(
      `\n  body-only: ${s.keeperId}  → ${JSON.stringify(s.bodyFromJson.slice(0, 60))}`
    );
  }

  if (!apply) {
    console.log(`\nDRY RUN — re-run with --apply to perform merges.`);
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const trashDir = path.join(TRASH_ROOT, `${stamp}-reconcile-main`);
  const manifest = await applyPlan(plans, trashDir);
  const rel = path.relative(process.cwd(), trashDir);

  console.log(`\n── Applied ──`);
  console.log(`  merges               : ${manifest.merges}`);
  console.log(`  body-only updates    : ${manifest.bodyOnlyUpdates}`);
  console.log(`  rows trashed         : ${manifest.rowsTrashed}`);
  console.log(`  trash dir            : ${rel}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
