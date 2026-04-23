/**
 * Server-side helpers for AI-dedupe review batches.
 *
 * A review batch lives at ./trash-review/<stamp>-rule-AI/candidates.json and
 * contains Claude's duplicate verdicts awaiting human approval. Approving a
 * drop moves it into ./trash/<stamp>-rule-AI/ using the same manifest format
 * that /admin/trash already renders. Rejecting leaves the DB untouched and
 * drops the row from the candidates file.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { prisma } from "@/lib/prisma";

export const REVIEW_ROOT = path.join(process.cwd(), "trash-review");
const TRASH_ROOT = path.join(process.cwd(), "trash");

export interface ReviewDrop {
  id: string;
  body: string;
  originalDate: string;
  storageKey: string | null;
  mimeType: string | null;
  confidence: number;
  reason: string;
  decision: "pending" | "approve" | "reject";
}

export interface ReviewGroup {
  id: string;
  keep: {
    id: string;
    body: string;
    originalDate: string;
    storageKey: string | null;
    mimeType: string | null;
  };
  drops: ReviewDrop[];
}

export interface ReviewBatch {
  dir: string;
  rule: "AI";
  createdAt: string;
  source: string;
  confidenceThreshold: number;
  groupCount: number;
  pendingDropCount: number;
  groups: ReviewGroup[];
}

export function isSafeDirName(name: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(name) && name !== "." && name !== "..";
}

async function readBatch(dir: string): Promise<ReviewBatch | null> {
  try {
    const raw = await fs.readFile(
      path.join(REVIEW_ROOT, dir, "candidates.json"),
      "utf8",
    );
    const data = JSON.parse(raw) as Omit<ReviewBatch, "dir">;
    return { dir, ...data };
  } catch {
    return null;
  }
}

export async function listReviewBatches(): Promise<ReviewBatch[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(REVIEW_ROOT);
  } catch {
    return [];
  }
  const out: ReviewBatch[] = [];
  for (const e of entries) {
    if (!isSafeDirName(e)) continue;
    const b = await readBatch(e);
    if (b) out.push(b);
  }
  out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return out;
}

export async function getReviewBatch(dir: string): Promise<ReviewBatch | null> {
  if (!isSafeDirName(dir)) return null;
  return readBatch(dir);
}

async function writeBatch(batch: ReviewBatch): Promise<void> {
  const { dir, ...rest } = batch;
  rest.pendingDropCount = rest.groups.reduce(
    (a, g) => a + g.drops.filter((d) => d.decision === "pending").length,
    0,
  );
  rest.groupCount = rest.groups.length;
  await fs.writeFile(
    path.join(REVIEW_ROOT, dir, "candidates.json"),
    JSON.stringify(rest, null, 2),
  );
}

export async function decide(
  dir: string,
  decisions: Array<{ dropId: string; decision: "approve" | "reject" | "pending" }>,
): Promise<ReviewBatch | null> {
  const batch = await getReviewBatch(dir);
  if (!batch) return null;
  const byId = new Map(decisions.map((d) => [d.dropId, d.decision]));
  for (const g of batch.groups) {
    for (const d of g.drops) {
      const next = byId.get(d.id);
      if (next) d.decision = next;
    }
  }
  await writeBatch(batch);
  return batch;
}

/**
 * Finalize the batch: move every approved drop into a standard trash folder
 * (./trash/<stamp>-rule-AI/) + delete it from the DB. Rejected drops are
 * discarded. Pending drops stay in the review batch for later.
 */
export async function finalize(dir: string): Promise<{
  trashedCount: number;
  groupCount: number;
  trashDir: string | null;
}> {
  const batch = await getReviewBatch(dir);
  if (!batch) return { trashedCount: 0, groupCount: 0, trashDir: null };

  const approvedGroups = batch.groups
    .map((g) => ({
      keep: g.keep,
      approved: g.drops.filter((d) => d.decision === "approve"),
    }))
    .filter((g) => g.approved.length > 0);

  if (approvedGroups.length === 0) {
    // Nothing to finalize — still remove fully-rejected/empty groups.
    batch.groups = batch.groups.filter((g) =>
      g.drops.some((d) => d.decision === "pending"),
    );
    await writeBatch(batch);
    return { trashedCount: 0, groupCount: 0, trashDir: null };
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = path.join(TRASH_ROOT, `${stamp}-rule-AI`);
  const postsDir = path.join(outDir, "posts");
  await fs.mkdir(postsDir, { recursive: true });

  const manifest = {
    rule: "AI" as const,
    createdAt: new Date().toISOString(),
    source: batch.source,
    confidenceThreshold: batch.confidenceThreshold,
    groupCount: 0,
    trashedCount: 0,
    groups: [] as Array<{
      keep: string;
      dropped: string[];
      notes: string[];
    }>,
  };

  const idsToDelete: string[] = [];

  for (const g of approvedGroups) {
    const dropIds = g.approved.map((d) => d.id);
    manifest.groups.push({
      keep: g.keep.id,
      dropped: dropIds,
      notes: g.approved.map(
        (d) => `conf=${d.confidence.toFixed(2)}  ${d.reason}`,
      ),
    });
    manifest.groupCount++;

    for (const d of g.approved) {
      const snap = await prisma.post.findUnique({
        where: { id: d.id },
        include: { media: true, publishes: true, analytics: true },
      });
      if (!snap) continue;
      await fs.writeFile(
        path.join(postsDir, `${d.id}.json`),
        JSON.stringify(snap, null, 2),
      );
      idsToDelete.push(d.id);
      manifest.trashedCount++;
    }
  }

  await fs.writeFile(
    path.join(outDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );

  const CHUNK = 500;
  for (let i = 0; i < idsToDelete.length; i += CHUNK) {
    await prisma.post.deleteMany({
      where: { id: { in: idsToDelete.slice(i, i + CHUNK) } },
    });
  }

  // Purge approved drops from the review batch; keep pending; drop fully-
  // decided (reject or empty) groups.
  for (const g of batch.groups) {
    g.drops = g.drops.filter((d) => d.decision === "pending");
  }
  batch.groups = batch.groups.filter((g) => g.drops.length > 0);
  await writeBatch(batch);

  return {
    trashedCount: manifest.trashedCount,
    groupCount: manifest.groupCount,
    trashDir: path.relative(process.cwd(), outDir),
  };
}

export async function deleteBatch(dir: string): Promise<boolean> {
  if (!isSafeDirName(dir)) return false;
  try {
    await fs.rm(path.join(REVIEW_ROOT, dir), { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}
