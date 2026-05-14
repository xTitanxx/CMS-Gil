import { Prisma } from "@prisma/client";
import { normalizeForSearch } from "@/lib/search-normalize";
import {
  getSuggesterCandidateWhere,
  SUGGESTER_ORDER_BY,
} from "@/lib/planner/suggester-filter";

/**
 * Suggester-queue sort: matches the one-card suggester at /admin/suggest, so
 * Eitan can see and triage the full queue from the All Posts page.
 */
export const QUEUE_SORT = "queue_asc";
export const SHUFFLED_QUEUE_SORT = "shuffled_queue_asc";

export function isQueueSort(sort: string | undefined): boolean {
  return sort === QUEUE_SORT;
}

export function isShuffledQueueSort(sort: string | undefined): boolean {
  return sort === SHUFFLED_QUEUE_SORT;
}

export interface PostsFilters {
  search?: string;
  sort?: string;
  tags?: string;
  /**
   * CSV of content categories to include. Missing/empty = all included.
   * Values: "caption" (body + no media), "image" (has image),
   *         "video" (has video), "nocaption" (empty body).
   */
  content?: string;
  /**
   * CSV of audio categories to include. Missing/empty = all included.
   * Values: "audible" (video + audio), "silent" (all-silent video),
   *         "nonvideo" (no video media).
   */
  audio?: string;
  from?: string;
  to?: string;
  /** "with" = has platformUrl, "without" = no platformUrl, else = no filter */
  link?: string;
  /** "2" = posts with 2 or more media attached; "none" = posts with no media */
  multiMedia?: string;
  /** "yes" = has at least one AI tag, "no" = has zero tags, else = no filter */
  tagged?: string;
  /** "stories" = FB story posts only, "posts" = non-story posts, else = all */
  kind?: string;
  /**
   * Secondary tab within the current kind:
   *   kind=posts   → "repostable" (default), "silent", "shared"
   *   kind=stories → "withsound"  (default), "silent"
   * Empty / unknown values = default for that kind.
   */
  subKind?: string;
  /**
   * Share-status filter:
   *   "original" — share IS NULL (no share card)
   *   "external" — share has a URL (recoverable link share)
   *   "stripped" — share flagged but no URL (internal FB-post share; card
   *                content stripped by FB on export)
   *   "any"      — share IS NOT NULL (either flavor above)
   */
  share?: string;
  /**
   * Quality filter:
   *   "clean"  — has FB link AND no silent videos (non-video or all videos have audio)
   *   "issues" — missing FB link OR has at least one silent video
   */
  quality?: string;
  captionQuality?: string;
  /** "yes" = has PostAnalytics with platform FACEBOOK, "no" = does not, else = no filter */
  enriched?: string;
  /** When "true", restricts to posts that have been pushed through the hub
   *  at least once (Post.hubPublishCount > 0). */
  publishedViaHub?: string;
}

const STORY_SOURCE_ID_PREFIX = "fb_story_";

export const CONTENT_CATEGORIES = [
  "caption",
  "image",
  "video",
  "nocaption",
] as const;
export type ContentCategory = (typeof CONTENT_CATEGORIES)[number];

export const AUDIO_CATEGORIES = ["audible", "silent", "nonvideo"] as const;
export type AudioCategory = (typeof AUDIO_CATEGORIES)[number];

type SearchParamsLike =
  | URLSearchParams
  | Record<string, string | string[] | undefined>;

function getParam(sp: SearchParamsLike, key: string): string | undefined {
  if (sp instanceof URLSearchParams) return sp.get(key) ?? undefined;
  const v = sp[key];
  return Array.isArray(v) ? v[0] : v;
}

function validDate(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : s;
}

export function parsePostsFilters(sp: SearchParamsLike): PostsFilters {
  return {
    search: getParam(sp, "search") || undefined,
    sort: getParam(sp, "sort") || undefined,
    tags: getParam(sp, "tags") || undefined,
    content: getParam(sp, "content") || undefined,
    audio: getParam(sp, "audio") || undefined,
    from: validDate(getParam(sp, "from")),
    to: validDate(getParam(sp, "to")),
    link: getParam(sp, "link") || undefined,
    multiMedia: getParam(sp, "multiMedia") || undefined,
    tagged: getParam(sp, "tagged") || undefined,
    kind: getParam(sp, "kind") || undefined,
    subKind: getParam(sp, "subKind") || undefined,
    share: getParam(sp, "share") || undefined,
    quality: getParam(sp, "quality") || undefined,
    captionQuality: getParam(sp, "captionQuality") || undefined,
    enriched: getParam(sp, "enriched") || undefined,
    publishedViaHub: getParam(sp, "publishedViaHub") || undefined,
  };
}

function parseCsvSet<T extends string>(
  raw: string | undefined,
  allowed: readonly T[]
): Set<T> | null {
  if (!raw) return null; // null = "all" (no filter applied)
  const set = new Set<T>();
  for (const part of raw.split(",")) {
    const v = part.trim();
    if ((allowed as readonly string[]).includes(v)) set.add(v as T);
  }
  return set;
}

type SortField = "originalDate" | "createdAt" | "lastPublishedViaHubAt";
type SortDir = "asc" | "desc";

export function parseSort(sort: string | undefined): {
  field: SortField;
  dir: SortDir;
} {
  switch (sort) {
    case "originalDate_asc":
      return { field: "originalDate", dir: "asc" };
    case "createdAt_desc":
      return { field: "createdAt", dir: "desc" };
    case "createdAt_asc":
      return { field: "createdAt", dir: "asc" };
    case "lastPublishedViaHubAt_desc":
      return { field: "lastPublishedViaHubAt", dir: "desc" };
    case "lastPublishedViaHubAt_asc":
      return { field: "lastPublishedViaHubAt", dir: "asc" };
    default:
      return { field: "originalDate", dir: "desc" };
  }
}

/**
 * Build an OR clause for content-type filtering. Returns null when all
 * four categories are included (no filter needed). Returns a clause matching
 * nothing when the caller passes an empty set (user unchecked everything).
 */
function buildContentClause(
  content: Set<ContentCategory> | null
): Prisma.PostWhereInput | null {
  if (content === null) return null;
  if (content.size === CONTENT_CATEGORIES.length) return null;
  if (content.size === 0) return { id: "__impossible__" };

  const or: Prisma.PostWhereInput[] = [];
  if (content.has("caption")) {
    or.push({ AND: [{ body: { not: "" } }, { media: { none: {} } }] });
  }
  if (content.has("image")) {
    or.push({
      media: { some: { mimeType: { startsWith: "image/" } } },
    });
  }
  if (content.has("video")) {
    or.push({
      media: { some: { mimeType: { startsWith: "video/" } } },
    });
  }
  if (content.has("nocaption")) {
    or.push({ body: "" });
  }
  return { OR: or };
}

/**
 * Build an OR clause for audio-type filtering.
 *   "audible"  = post has at least one video with audio
 *   "silent"   = post has at least one video and no video has audio
 *   "nonvideo" = post has no video media
 */
function buildAudioClause(
  audio: Set<AudioCategory> | null
): Prisma.PostWhereInput | null {
  if (audio === null) return null;
  if (audio.size === AUDIO_CATEGORIES.length) return null;
  if (audio.size === 0) return { id: "__impossible__" };

  const or: Prisma.PostWhereInput[] = [];
  if (audio.has("audible")) {
    or.push({
      media: {
        some: { mimeType: { startsWith: "video/" }, hasAudio: true },
      },
    });
  }
  if (audio.has("silent")) {
    or.push({
      AND: [
        {
          media: {
            some: { mimeType: { startsWith: "video/" }, hasAudio: false },
          },
        },
        {
          media: {
            none: { mimeType: { startsWith: "video/" }, hasAudio: true },
          },
        },
      ],
    });
  }
  if (audio.has("nonvideo")) {
    or.push({
      media: { none: { mimeType: { startsWith: "video/" } } },
    });
  }
  return { OR: or };
}

export function buildPostsQuery(
  filters: PostsFilters,
  userId: string,
  opts?: {
    postIdAllowlist?: string[] | null;
    /** Extra Prisma PostWhereInput clauses to AND into the final where. */
    extraWhere?: Prisma.PostWhereInput[];
  },
): {
  where: Prisma.PostWhereInput;
  orderBy: Prisma.PostOrderByWithRelationInput[];
} {
  const { field, dir } = parseSort(filters.sort);
  const tagList = filters.tags
    ? filters.tags.split(",").map((t) => t.trim()).filter(Boolean)
    : [];

  // Content + audio filters each return an OR clause (or null). They cannot
  // share the top-level `OR` slot (which may already be occupied by the search
  // filter) so we push them into a top-level AND array.
  const extraAnds: Prisma.PostWhereInput[] = [];
  const contentClause = buildContentClause(
    parseCsvSet(filters.content, CONTENT_CATEGORIES)
  );
  if (contentClause) extraAnds.push(contentClause);
  const audioClause = buildAudioClause(
    parseCsvSet(filters.audio, AUDIO_CATEGORIES)
  );
  if (audioClause) extraAnds.push(audioClause);

  // link filter — CSV of {with, without}. Both or neither = no filter.
  const linkSet = parseCsvSet(filters.link, ["with", "without"] as const);
  if (linkSet && linkSet.size === 1) {
    if (linkSet.has("with")) extraAnds.push({ platformUrl: { not: null } });
    else extraAnds.push({ platformUrl: null });
  }

  // multiMedia filter — CSV of {1, 2, none}. Only "none" has a backend clause
  // today (the 1 vs 2+ distinction isn't implemented); keep that behavior.
  const mmSet = parseCsvSet(filters.multiMedia, ["1", "2", "none"] as const);
  if (mmSet && mmSet.size > 0 && mmSet.size < 3) {
    const or: Prisma.PostWhereInput[] = [];
    if (mmSet.has("none")) or.push({ media: { none: {} } });
    if (mmSet.has("1") || mmSet.has("2")) or.push({ media: { some: {} } });
    if (or.length > 0) extraAnds.push({ OR: or });
  }

  // tagged filter — CSV of {yes, no}. Both or neither = no filter.
  const tagSet = parseCsvSet(filters.tagged, ["yes", "no"] as const);
  if (tagSet && tagSet.size === 1) {
    if (tagSet.has("yes")) extraAnds.push({ tags: { isEmpty: false } });
    else extraAnds.push({ tags: { isEmpty: true } });
  }

  // share filter — CSV of {original, external, stripped}. Legacy "any" expands
  // to {external, stripped}. Empty or all three = no filter.
  const shareSet = new Set<string>();
  if (filters.share) {
    for (const s of filters.share.split(",")) {
      const v = s.trim();
      if (["original", "external", "stripped", "any"].includes(v)) {
        shareSet.add(v);
      }
    }
    if (shareSet.has("any")) {
      shareSet.delete("any");
      shareSet.add("external");
      shareSet.add("stripped");
    }
  }
  if (shareSet.size > 0 && shareSet.size < 3) {
    const or: Prisma.PostWhereInput[] = [];
    if (shareSet.has("original")) or.push({ share: { equals: Prisma.DbNull } });
    if (shareSet.has("external")) {
      or.push({ share: { path: ["url"], not: Prisma.DbNull } });
    }
    if (shareSet.has("stripped")) {
      or.push({
        AND: [
          { share: { not: Prisma.DbNull } },
          { share: { path: ["url"], equals: Prisma.DbNull } },
        ],
      });
    }
    extraAnds.push({ OR: or });
  }

  // quality filter — CSV of {clean, issues}. Both or neither = no filter.
  const qualitySet = parseCsvSet(filters.quality, ["clean", "issues"] as const);
  if (qualitySet && qualitySet.size === 1) {
    if (qualitySet.has("clean")) {
      // Has FB link AND no silent videos
      extraAnds.push({
        AND: [
          { platformUrl: { not: null } },
          {
            media: {
              none: { mimeType: { startsWith: "video/" }, hasAudio: false },
            },
          },
        ],
      });
    } else {
      // Missing FB link OR has at least one silent video
      extraAnds.push({
        OR: [
          { platformUrl: null },
          {
            media: {
              some: { mimeType: { startsWith: "video/" }, hasAudio: false },
            },
          },
        ],
      });
    }
  }

  // caption quality filter — CSV of {good, ok, weak, not-analyzed, has-rewrite}
  const captionSet = parseCsvSet(filters.captionQuality, ["good", "ok", "weak", "not-analyzed", "has-rewrite"] as const);
  if (captionSet && captionSet.size < 5) {
    const orClauses: Prisma.PostWhereInput[] = [];
    if (captionSet.has("good")) orClauses.push({ captionQuality: { gte: 4 } });
    if (captionSet.has("ok")) orClauses.push({ captionQuality: 3 });
    if (captionSet.has("weak")) orClauses.push({ captionQuality: { lte: 2, not: null } });
    if (captionSet.has("not-analyzed")) orClauses.push({ captionAnalyzedAt: null });
    if (captionSet.has("has-rewrite")) orClauses.push({ captionSuggestion: { not: null } });
    if (orClauses.length > 0) extraAnds.push({ OR: orClauses });
  }

  // enriched filter — CSV of {yes, no}. Both or neither = no filter.
  const enrichedSet = parseCsvSet(filters.enriched, ["yes", "no"] as const);
  if (enrichedSet && enrichedSet.size === 1) {
    if (enrichedSet.has("yes")) {
      extraAnds.push({ analytics: { some: { platform: "FACEBOOK" } } });
    } else {
      extraAnds.push({ analytics: { none: { platform: "FACEBOOK" } } });
    }
  }

  // publishedViaHub filter — only "true" matters. Default omits the clause
  // so existing posts list views aren't affected.
  if (filters.publishedViaHub === "true") {
    extraAnds.push({ hubPublishCount: { gt: 0 } });
  }

  if (filters.kind === "stories") {
    extraAnds.push({ postType: "STORY" });
  } else {
    // Default to excluding stories when kind is "posts" or unset
    extraAnds.push({ postType: { not: "STORY" } });
  }

  // Media-type sub-tabs: all (default), video-audio, video-silent, photo, text, quoted.
  // Only apply when subKind is present — undefined means "show all" (used for
  // the kind-level total count).
  if (filters.subKind != null && filters.subKind !== "all") {
    if (filters.subKind === "video-audio") {
      // Has at least one video with audio
      extraAnds.push({
        media: { some: { mimeType: { startsWith: "video/" }, hasAudio: true } },
      });
    } else if (filters.subKind === "video-silent") {
      // Has at least one video AND none of its videos have audio
      extraAnds.push({
        AND: [
          { media: { some: { mimeType: { startsWith: "video/" } } } },
          { media: { none: { mimeType: { startsWith: "video/" }, hasAudio: true } } },
        ],
      });
    } else if (filters.subKind === "photo") {
      // Has image(s) but no video
      extraAnds.push({
        AND: [
          { media: { some: { mimeType: { startsWith: "image/" } } } },
          { media: { none: { mimeType: { startsWith: "video/" } } } },
        ],
      });
    } else if (filters.subKind === "text") {
      // Genuinely text-only: no media AND not a share/quote
      extraAnds.push({ media: { none: {} } });
      extraAnds.push({ share: { equals: Prisma.DbNull } });
    } else if (filters.subKind === "quoted") {
      // Quoted/shared FB post — has share metadata (shared to group, shared someone's post, etc.)
      extraAnds.push({ share: { not: Prisma.DbNull } });
    }
  }

  if (opts?.extraWhere && opts.extraWhere.length > 0) {
    extraAnds.push(...opts.extraWhere);
  }

  // Queue sort: layer in the suggester's eligibility filter so the All Posts
  // page mirrors what the one-card suggester would serve. Same logic for the
  // reshuffled test sort.
  if (isQueueSort(filters.sort) || isShuffledQueueSort(filters.sort)) {
    const suggesterWhere = getSuggesterCandidateWhere(userId);
    if (suggesterWhere.readiness) extraAnds.push({ readiness: suggesterWhere.readiness });
  }

  const where: Prisma.PostWhereInput = {
    userId,
    ...(filters.search
      ? {
          OR: [
            // bodyNormalized is written at insert/update time via normalizeForSearch()
            // so that typed keyboard text matches FB's smart-punctuation variants.
            { bodyNormalized: { contains: normalizeForSearch(filters.search) } },
            { tags: { has: filters.search.toLowerCase() } },
            // Exact cuid lookup so pasting a Post.id into the search bar finds
            // the row directly. cuids are 25 chars, lowercase alnum, starting
            // with "c" — cheap to sniff without a false-positive risk.
            ...(/^c[a-z0-9]{24}$/.test(filters.search.trim())
              ? [{ id: filters.search.trim() }]
              : []),
          ],
        }
      : {}),
    ...(tagList.length > 0 ? { tags: { hasSome: tagList } } : {}),
    ...(filters.from || filters.to
      ? {
          originalDate: {
            ...(filters.from ? { gte: new Date(filters.from) } : {}),
            ...(filters.to ? { lte: new Date(filters.to) } : {}),
          },
        }
      : {}),
    ...(opts?.postIdAllowlist != null ? { id: { in: opts.postIdAllowlist } } : {}),
    ...(extraAnds.length > 0 ? { AND: extraAnds } : {}),
  };

  const orderBy: Prisma.PostOrderByWithRelationInput[] = isQueueSort(filters.sort)
    ? SUGGESTER_ORDER_BY
    : isShuffledQueueSort(filters.sort)
      ? [
          { shufflePosition: { sort: "asc", nulls: "last" } } as Prisma.PostOrderByWithRelationInput,
          { id: "asc" },
        ]
      : [
          { [field]: dir } as Prisma.PostOrderByWithRelationInput,
          { id: dir },
        ];

  return { where, orderBy };
}

export interface PostCursor {
  value: string;
  id: string;
}

export function encodeCursor(c: PostCursor): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}

export function decodeCursor(s: string | null | undefined): PostCursor | null {
  if (!s) return null;
  try {
    const parsed = JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
    if (typeof parsed?.value === "string" && typeof parsed?.id === "string") {
      return { value: parsed.value, id: parsed.id };
    }
  } catch {
    // fall through
  }
  return null;
}

/**
 * Queue-sort cursor value is `${publishCount}|${originalDateISO}` — a composite
 * over the two-key ordering (publishCount asc, originalDate asc). The id from
 * the cursor envelope serves as the third tie-breaker.
 */
function parseQueueCursorValue(value: string): { publishCount: number; originalDate: Date } | null {
  const sep = value.indexOf("|");
  if (sep < 0) return null;
  const pc = Number(value.slice(0, sep));
  const od = new Date(value.slice(sep + 1));
  if (!Number.isFinite(pc) || Number.isNaN(od.getTime())) return null;
  return { publishCount: pc, originalDate: od };
}

export function buildCursorClause(
  sort: string | undefined,
  cursor: PostCursor,
): Prisma.PostWhereInput {
  if (isQueueSort(sort)) {
    const parsed = parseQueueCursorValue(cursor.value);
    if (!parsed) return {};
    const { publishCount, originalDate } = parsed;
    // Lexicographic > on the (publishCount, originalDate, id) tuple
    return {
      OR: [
        { publishCount: { gt: publishCount } },
        {
          publishCount,
          originalDate: { gt: originalDate },
        },
        {
          publishCount,
          originalDate,
          id: { gt: cursor.id },
        },
      ],
    };
  }

  if (isShuffledQueueSort(sort)) {
    // Cursor value is the shufflePosition float, or "null" once we're in the
    // NULLS LAST tail (unshuffled rows).
    if (cursor.value === "null") {
      return { shufflePosition: null, id: { gt: cursor.id } };
    }
    const pos = Number(cursor.value);
    if (!Number.isFinite(pos)) return {};
    return {
      OR: [
        { shufflePosition: { gt: pos } },
        { shufflePosition: pos, id: { gt: cursor.id } },
        // Cross into the NULLS LAST tail once shuffled rows are exhausted
        { shufflePosition: null },
      ],
    };
  }

  const { field, dir } = parseSort(sort);
  const op = dir === "desc" ? "lt" : "gt";
  const value = new Date(cursor.value);
  return {
    OR: [
      { [field]: { [op]: value } } as Prisma.PostWhereInput,
      {
        [field]: value,
        id: { [op]: cursor.id },
      } as Prisma.PostWhereInput,
    ],
  };
}

export function cursorFromRow(
  sort: string | undefined,
  row: {
    id: string;
    originalDate: Date;
    createdAt: Date;
    lastPublishedViaHubAt?: Date | null;
    publishCount?: number;
    shufflePosition?: number | null;
  },
): PostCursor {
  if (isQueueSort(sort)) {
    return {
      value: `${row.publishCount ?? 0}|${row.originalDate.toISOString()}`,
      id: row.id,
    };
  }
  if (isShuffledQueueSort(sort)) {
    return {
      value: row.shufflePosition == null ? "null" : String(row.shufflePosition),
      id: row.id,
    };
  }
  const { field } = parseSort(sort);
  const v = row[field];
  return {
    // Null-safe: only the published-list path uses lastPublishedViaHubAt as a
    // sort key, and it filters hubPublishCount>0, so null is unreachable in
    // practice. Fall back to epoch in the unlikely null case to avoid throwing.
    value: (v ?? new Date(0)).toISOString(),
    id: row.id,
  };
}

export function buildNeighborQueries(
  sort: string | undefined,
  current: { id: string; originalDate: Date; createdAt: Date; lastPublishedViaHubAt?: Date | null },
): {
  prevWhere: Prisma.PostWhereInput;
  prevOrderBy: Prisma.PostOrderByWithRelationInput[];
  nextWhere: Prisma.PostWhereInput;
  nextOrderBy: Prisma.PostOrderByWithRelationInput[];
} {
  const { field, dir } = parseSort(sort);
  const value = current[field] ?? new Date(0);
  const prevOp = dir === "desc" ? "gt" : "lt";
  const prevDir: SortDir = dir === "desc" ? "asc" : "desc";
  const nextOp = dir === "desc" ? "lt" : "gt";
  const nextDir: SortDir = dir;

  return {
    prevWhere: {
      OR: [
        { [field]: { [prevOp]: value } } as Prisma.PostWhereInput,
        {
          [field]: value,
          id: { [prevOp]: current.id },
        } as Prisma.PostWhereInput,
      ],
    },
    prevOrderBy: [
      { [field]: prevDir } as Prisma.PostOrderByWithRelationInput,
      { id: prevDir },
    ],
    nextWhere: {
      OR: [
        { [field]: { [nextOp]: value } } as Prisma.PostWhereInput,
        {
          [field]: value,
          id: { [nextOp]: current.id },
        } as Prisma.PostWhereInput,
      ],
    },
    nextOrderBy: [
      { [field]: nextDir } as Prisma.PostOrderByWithRelationInput,
      { id: nextDir },
    ],
  };
}

export const POST_FILTER_KEYS = [
  "search",
  "sort",
  "tags",
  "content",
  "audio",
  "from",
  "to",
  "link",
  "multiMedia",
  "tagged",
  "kind",
  "view",
  "share",
  "subKind",
  "quality",
  "captionQuality",
  "enriched",
  "publishedViaHub",
] as const;

export function serializeFilters(
  sp: SearchParamsLike,
): string {
  const out = new URLSearchParams();
  for (const key of POST_FILTER_KEYS) {
    const v = getParam(sp, key);
    if (v) out.set(key, v);
  }
  return out.toString();
}
