import type { Prisma } from "@prisma/client";

export interface PostsFilters {
  search?: string;
  sort?: string;
  tags?: string;
  audio?: string;
  from?: string;
  to?: string;
}

type SearchParamsLike =
  | URLSearchParams
  | Record<string, string | string[] | undefined>;

function getParam(sp: SearchParamsLike, key: string): string | undefined {
  if (sp instanceof URLSearchParams) return sp.get(key) ?? undefined;
  const v = sp[key];
  return Array.isArray(v) ? v[0] : v;
}

export function parsePostsFilters(sp: SearchParamsLike): PostsFilters {
  return {
    search: getParam(sp, "search") || undefined,
    sort: getParam(sp, "sort") || undefined,
    tags: getParam(sp, "tags") || undefined,
    audio: getParam(sp, "audio") || undefined,
    from: getParam(sp, "from") || undefined,
    to: getParam(sp, "to") || undefined,
  };
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

function buildAudioClause(audio: string | undefined): Prisma.PostWhereInput {
  if (audio === "silent") {
    return {
      media: {
        some: { mimeType: { startsWith: "video/" }, hasAudio: false },
      },
      AND: [
        {
          media: {
            none: { mimeType: { startsWith: "video/" }, hasAudio: true },
          },
        },
      ],
    };
  }
  if (audio === "audible") {
    return {
      media: {
        some: { mimeType: { startsWith: "video/" }, hasAudio: true },
      },
    };
  }
  if (audio === "hide-silent") {
    return {
      NOT: {
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
      },
    };
  }
  return {};
}

export function buildPostsQuery(
  filters: PostsFilters,
  userId: string,
): {
  where: Prisma.PostWhereInput;
  orderBy: Prisma.PostOrderByWithRelationInput[];
} {
  const { field, dir } = parseSort(filters.sort);
  const tagList = filters.tags
    ? filters.tags.split(",").map((t) => t.trim()).filter(Boolean)
    : [];

  const where: Prisma.PostWhereInput = {
    userId,
    ...(filters.search
      ? {
          OR: [
            { body: { contains: filters.search, mode: "insensitive" as const } },
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
    ...buildAudioClause(filters.audio),
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
  "audio",
  "from",
  "to",
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
