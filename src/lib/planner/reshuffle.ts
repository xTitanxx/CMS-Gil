export interface ReshufflePost {
  id: string;
  tags: string[];
  originalDate: Date;
  mediaMimeTypes: string[];
}

export type MediaKind = "video" | "image" | "text";

/**
 * Returns the set of tags that appear on strictly more than `threshold`
 * fraction of the input posts. These are excluded from the de-clump comparison
 * because they carry no topic signal (e.g. "wheelchair" on 80% of an archive).
 */
export function computeGenericTags(
  posts: Array<{ tags: string[] }>,
  threshold: number,
): Set<string> {
  if (posts.length === 0) return new Set();
  const counts = new Map<string, number>();
  for (const p of posts) {
    const seen = new Set<string>();
    for (const t of p.tags) {
      if (seen.has(t)) continue;
      seen.add(t);
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  const cutoff = threshold * posts.length;
  const generic = new Set<string>();
  for (const [tag, n] of counts) {
    if (n > cutoff) generic.add(tag);
  }
  return generic;
}

export function dominantMediaKind(mimeTypes: string[]): MediaKind {
  if (mimeTypes.some((m) => m.startsWith("video/"))) return "video";
  if (mimeTypes.some((m) => m.startsWith("image/"))) return "image";
  return "text";
}

/**
 * Interleaves up to three buckets so each bucket's items are spread evenly
 * across the output. For each bucket of length N, its i-th item gets target
 * position (i + 0.5) / N. Sorting all (target, kind, item) tuples produces a
 * proportional spread that doesn't clump small buckets at the front.
 *
 * Ties are broken in declaration order: video → image → text.
 */
export function proportionalInterleave(buckets: {
  video: string[];
  image: string[];
  text: string[];
}): string[] {
  const order: MediaKind[] = ["video", "image", "text"];
  type Slot = { target: number; kindIdx: number; item: string };
  const slots: Slot[] = [];
  for (let kindIdx = 0; kindIdx < order.length; kindIdx++) {
    const items = buckets[order[kindIdx]];
    const n = items.length;
    if (n === 0) continue;
    for (let i = 0; i < n; i++) {
      slots.push({ target: (i + 0.5) / n, kindIdx, item: items[i] });
    }
  }
  slots.sort((a, b) => a.target - b.target || a.kindIdx - b.kindIdx);
  return slots.map((s) => s.item);
}
