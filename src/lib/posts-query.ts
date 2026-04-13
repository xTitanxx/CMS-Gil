import type { Prisma } from "@prisma/client";
import { normalizeForSearch } from "@/lib/search-normalize";

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
  /** "2" = posts with 2 or more media attached */
  multiMedia?: string;
  /** "yes" = has at least one AI tag, "no" = has zero tags, else = no filter */
  tagged?: string;
  /** "stories" = FB story posts only, "posts" = non-story posts, else = all */
  kind?: string;
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

type SortField = "originalDate" | "createdAt";
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
  opts?: { postIdAllowlist?: string[] | null },
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

  if (filters.kind === "stories") {
    extraAnds.push({ sourceId: { startsWith: STORY_SOURCE_ID_PREFIX } });
  } else if (filters.kind === "posts") {
    extraAnds.push({
      NOT: { sourceId: { startsWith: STORY_SOURCE_ID_PREFIX } },
    });
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
    ...(filters.link === "with" ? { platformUrl: { not: null } } : {}),
    ...(filters.link === "without" ? { platformUrl: null } : {}),
    ...(filters.tagged === "yes" ? { tags: { isEmpty: false } } : {}),
    ...(filters.tagged === "no" ? { tags: { isEmpty: true } } : {}),
    ...(opts?.postIdAllowlist != null ? { id: { in: opts.postIdAllowlist } } : {}),
    ...(extraAnds.length > 0 ? { AND: extraAnds } : {}),
  };

  const orderBy: Prisma.PostOrderByWithRelationInput[] = [
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

export function buildCursorClause(
  sort: string | undefined,
  cursor: PostCursor,
): Prisma.PostWhereInput {
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
  row: { id: string; originalDate: Date; createdAt: Date },
): PostCursor {
  const { field } = parseSort(sort);
  return {
    value: row[field].toISOString(),
    id: row.id,
  };
}

export function buildNeighborQueries(
  sort: string | undefined,
  current: { id: string; originalDate: Date; createdAt: Date },
): {
  prevWhere: Prisma.PostWhereInput;
  prevOrderBy: Prisma.PostOrderByWithRelationInput[];
  nextWhere: Prisma.PostWhereInput;
  nextOrderBy: Prisma.PostOrderByWithRelationInput[];
} {
  const { field, dir } = parseSort(sort);
  const value = current[field];
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
