import type { Prisma } from "@prisma/client";

export type PostTypeFilter = "story" | "video" | "image" | null;

export function parsePostTypeFilter(value: string | null): PostTypeFilter {
  if (value === "story" || value === "video" || value === "image") return value;
  return null;
}

export function postTypeWhere(type: PostTypeFilter): Prisma.PostWhereInput {
  if (type === "story") return { postType: "STORY" };
  if (type === "video") {
    return {
      postType: { not: "STORY" },
      media: { some: { mimeType: { startsWith: "video/" } } },
    };
  }
  if (type === "image") {
    return {
      postType: { not: "STORY" },
      AND: [
        { media: { some: { mimeType: { startsWith: "image/" } } } },
        { media: { none: { mimeType: { startsWith: "video/" } } } },
      ],
    };
  }
  return {};
}
