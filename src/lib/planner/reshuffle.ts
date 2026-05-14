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

const RECENT_FLOOR_DAYS = 90;
const GENERIC_TAG_THRESHOLD = 0.6;
const DECLUMP_LOOKAHEAD = 3;

export interface ComputeShuffledOrderOptions {
  now?: Date;
  /** Optional integer seed for deterministic in-bucket shuffling (tests). */
  seed?: number;
}

/**
 * Mulberry32 PRNG — fast, dependency-free, good distribution for small N.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleInPlace<T>(arr: T[], rng: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/**
 * Best-effort single-pass de-clump. For each adjacent pair (i-1, i) sharing a
 * non-generic tag, look at positions i+1..i+DECLUMP_LOOKAHEAD for a swap
 * candidate that wouldn't introduce a new collision at position i. First
 * acceptable candidate wins; if none, leave the position alone.
 */
function declump(
  ids: string[],
  byId: Map<string, ReshufflePost>,
  generic: Set<string>,
): string[] {
  const out = [...ids];
  function nonGenericOverlap(a: string, b: string): boolean {
    const pa = byId.get(a);
    const pb = byId.get(b);
    if (!pa || !pb) return false;
    for (const t of pa.tags) {
      if (generic.has(t)) continue;
      if (pb.tags.includes(t)) return true;
    }
    return false;
  }
  for (let i = 1; i < out.length; i++) {
    if (!nonGenericOverlap(out[i - 1], out[i])) continue;
    for (let j = i + 1; j <= Math.min(i + DECLUMP_LOOKAHEAD, out.length - 1); j++) {
      const cand = out[j];
      const beforeCand = out[i - 1];
      const afterCand = j === i + 1 ? out[i] : out[i + 1] ?? null;
      if (nonGenericOverlap(beforeCand, cand)) continue;
      if (afterCand && nonGenericOverlap(cand, afterCand)) continue;
      [out[i], out[j]] = [out[j], out[i]];
      break;
    }
  }
  return out;
}

/**
 * Runs the full reshuffle pipeline over an eligible-post snapshot. Pure: no
 * side effects, no DB. Position floats are assigned by the writer.
 */
export function computeShuffledOrder(
  posts: ReshufflePost[],
  opts: ComputeShuffledOrderOptions = {},
): string[] {
  if (posts.length === 0) return [];
  const now = opts.now ?? new Date();
  const rng = opts.seed !== undefined ? mulberry32(opts.seed) : Math.random;

  const generic = computeGenericTags(posts, GENERIC_TAG_THRESHOLD);
  const cutoff = now.getTime() - RECENT_FLOOR_DAYS * 86_400_000;
  const aged: ReshufflePost[] = [];
  const recent: ReshufflePost[] = [];
  for (const p of posts) {
    if (p.originalDate.getTime() < cutoff) aged.push(p);
    else recent.push(p);
  }

  function orderPartition(part: ReshufflePost[]): string[] {
    const buckets: { video: ReshufflePost[]; image: ReshufflePost[]; text: ReshufflePost[] } = {
      video: [],
      image: [],
      text: [],
    };
    for (const p of part) buckets[dominantMediaKind(p.mediaMimeTypes)].push(p);
    shuffleInPlace(buckets.video, rng);
    shuffleInPlace(buckets.image, rng);
    shuffleInPlace(buckets.text, rng);

    const interleaved = proportionalInterleave({
      video: buckets.video.map((p) => p.id),
      image: buckets.image.map((p) => p.id),
      text: buckets.text.map((p) => p.id),
    });

    const byId = new Map(part.map((p) => [p.id, p]));
    return declump(interleaved, byId, generic);
  }

  return [...orderPartition(aged), ...orderPartition(recent)];
}
