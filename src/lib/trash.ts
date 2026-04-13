/**
 * Disk-backed trash helpers for the /trash UI.
 *
 * Trash data is written by scripts/dedupe-posts.ts to ./trash/<stamp>-rule-<X>/
 * with a manifest.json + posts/<id>.json per trashed row. Vercel's filesystem
 * is ephemeral, so this UI is effectively local-dev-only.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";

export const TRASH_ROOT = path.join(process.cwd(), "trash");

export type TrashRule = "A" | "B" | "C" | "D" | "E";

export interface TrashManifest {
  rule: TrashRule;
  createdAt: string;
  groupCount: number;
  trashedCount: number;
  groups: Array<{ keep: string; dropped: string[] }>;
}

export const RULE_LABELS: Record<TrashRule | string, { name: string; description: string }> = {
  A: { name: "Duplicate Import", description: "Same source ID — exact duplicate from the same import" },
  B: { name: "Same Text & Date", description: "Identical caption posted at the same time" },
  C: { name: "Full Match", description: "Same caption, date, and media fingerprint" },
  D: { name: "Reused Caption", description: "Same caption text across any date or media" },
  E: { name: "Reused Text-Only", description: "Same caption text, only text posts (no media)" },
};

export interface TrashDirSummary {
  dir: string; // basename only
  rule: string;
  createdAt: string;
  groupCount: number;
  trashedCount: number;
}

export interface TrashedPost {
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
    sizeBytes: number | null;
  }>;
  publishes: Array<{ platform: string; status: string }>;
  analytics: Array<{ platform: string; reactions: number | null }>;
}

/** Basic guard: only allow basename-shaped dir names (no slashes, no ..). */
export function isSafeDirName(name: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(name) && name !== "." && name !== "..";
}

export async function listTrashDirs(): Promise<TrashDirSummary[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(TRASH_ROOT);
  } catch {
    return [];
  }
  const summaries: TrashDirSummary[] = [];
  for (const dir of entries) {
    if (!isSafeDirName(dir)) continue;
    const full = path.join(TRASH_ROOT, dir);
    const stat = await fs.stat(full).catch(() => null);
    if (!stat || !stat.isDirectory()) continue;
    try {
      const raw = await fs.readFile(path.join(full, "manifest.json"), "utf8");
      const m = JSON.parse(raw) as TrashManifest;
      summaries.push({
        dir,
        rule: m.rule,
        createdAt: m.createdAt,
        groupCount: m.groupCount,
        trashedCount: m.trashedCount,
      });
    } catch {
      // malformed — still list it so the user can purge it
      summaries.push({
        dir,
        rule: "?",
        createdAt: stat.mtime.toISOString(),
        groupCount: 0,
        trashedCount: 0,
      });
    }
  }
  // newest first
  summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return summaries;
}

export async function readTrashDir(dir: string): Promise<{
  manifest: TrashManifest;
  posts: TrashedPost[];
} | null> {
  if (!isSafeDirName(dir)) return null;
  const full = path.join(TRASH_ROOT, dir);
  let manifest: TrashManifest;
  try {
    manifest = JSON.parse(
      await fs.readFile(path.join(full, "manifest.json"), "utf8")
    ) as TrashManifest;
  } catch {
    return null;
  }
  const postsDir = path.join(full, "posts");
  const files = await fs.readdir(postsDir).catch(() => []);
  const posts: TrashedPost[] = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    try {
      const raw = await fs.readFile(path.join(postsDir, f), "utf8");
      posts.push(JSON.parse(raw) as TrashedPost);
    } catch {
      // skip malformed
    }
  }
  // Keep rows stable: order by original post createdAt ascending
  posts.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return { manifest, posts };
}

export interface TrashBatch {
  dir: string;
  manifest: TrashManifest;
  posts: TrashedPost[];
}

export async function listTrashBatches(): Promise<TrashBatch[]> {
  const dirs = await listTrashDirs();
  const batches: TrashBatch[] = [];
  for (const d of dirs) {
    const data = await readTrashDir(d.dir);
    if (data) batches.push({ dir: d.dir, ...data });
  }
  return batches;
}

export async function readTrashedPost(
  dir: string,
  postId: string,
): Promise<TrashedPost | null> {
  if (!isSafeDirName(dir)) return null;
  if (!isSafeDirName(postId)) return null;
  const file = path.join(TRASH_ROOT, dir, "posts", `${postId}.json`);
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw) as TrashedPost;
  } catch {
    return null;
  }
}

export function resolveTrashDir(dir: string): string | null {
  if (!isSafeDirName(dir)) return null;
  return path.join(TRASH_ROOT, dir);
}
