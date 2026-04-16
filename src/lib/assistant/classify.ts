import type { PostType } from "@prisma/client";

export type ContentKind = "video" | "image" | "short-text" | "long-text";

const SHORT_TEXT_CHARS = 400;

export function classifyContent(args: {
  postType: PostType;
  body: string;
  mediaMimes: string[];
}): ContentKind {
  const hasVideo = args.postType === "REEL" || args.mediaMimes.some((m) => m.startsWith("video/"));
  if (hasVideo) return "video";
  const hasImage = args.mediaMimes.some((m) => m.startsWith("image/"));
  if (hasImage) return "image";
  const len = args.body.trim().length;
  return len <= SHORT_TEXT_CHARS ? "short-text" : "long-text";
}
