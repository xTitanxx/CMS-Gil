import { format } from "date-fns";
import { prisma } from "@/lib/prisma";

export const ARCHIVE_INDEX_BODY_CHARS = 800;
export const ARCHIVE_INDEX_MIN_BODY_CHARS = 30;
export const ARCHIVE_INDEX_MAX_TAGS = 5;

export interface ArchiveIndexEntry {
  id: string;
  originalDate: Date;
  kind: string;
  tags: string[];
  body: string;
  truncated: boolean;
}

export function truncateBody(body: string, max: number): { body: string; truncated: boolean } {
  const trimmed = body.trim();
  if (trimmed.length <= max) return { body: trimmed, truncated: false };
  // Cut on a word boundary near the cap.
  const slice = trimmed.slice(0, max);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > max - 80 ? slice.slice(0, lastSpace) : slice;
  return { body: cut.trimEnd() + "…", truncated: true };
}

export function formatEntry(e: ArchiveIndexEntry): string {
  const tags = e.tags.slice(0, ARCHIVE_INDEX_MAX_TAGS).join(", ");
  const header = `[post:${e.id} | ${format(e.originalDate, "yyyy-MM-dd")} | ${e.kind} | ${tags}]`;
  return `${header}\n${e.body}`;
}

export function formatIndex(entries: ArchiveIndexEntry[]): string {
  return entries.map(formatEntry).join("\n\n");
}

export async function loadArchiveEntries(userId: string): Promise<ArchiveIndexEntry[]> {
  const rows = await prisma.post.findMany({
    where: {
      userId,
      readiness: { not: "ARCHIVED" },
      body: { not: "" },
    },
    select: { id: true, originalDate: true, postType: true, tags: true, body: true },
    orderBy: { originalDate: "desc" },
  });
  const entries: ArchiveIndexEntry[] = [];
  for (const r of rows) {
    const raw = (r.body ?? "").trim();
    if (raw.length < ARCHIVE_INDEX_MIN_BODY_CHARS) continue;
    const { body, truncated } = truncateBody(raw, ARCHIVE_INDEX_BODY_CHARS);
    entries.push({
      id: r.id,
      originalDate: r.originalDate,
      kind: r.postType,
      tags: r.tags,
      body,
      truncated,
    });
  }
  return entries;
}

export async function buildArchiveIndex(userId: string): Promise<{ text: string; postCount: number; truncatedCount: number }> {
  const entries = await loadArchiveEntries(userId);
  return {
    text: formatIndex(entries),
    postCount: entries.length,
    truncatedCount: entries.filter((e) => e.truncated).length,
  };
}
