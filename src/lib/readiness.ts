export type ReadinessState = "UNCHECKED" | "READY" | "NOT_READY" | "ARCHIVED";

export interface PostLike {
  body: string;
  share: unknown;
  readiness: ReadinessState;
  notReadyReasons: string[];
}

export interface MediaLike {
  mimeType: string;
  hasAudio: boolean | null;
}

export interface ReadinessResult {
  readiness: ReadinessState;
  reasons: string[];
}

const URL_ONLY = /^\s*https?:\/\/\S+\s*$/i;

function isShareOnly(post: PostLike): boolean {
  const trimmed = post.body.trim();
  if (URL_ONLY.test(trimmed)) return true;
  if (post.share && trimmed.length < 20) return true;
  return false;
}

export function computeReadiness(
  post: PostLike,
  media: MediaLike[]
): ReadinessResult {
  if (post.readiness === "ARCHIVED") {
    return { readiness: "ARCHIVED", reasons: post.notReadyReasons };
  }

  const reasons: string[] = [];

  if (post.notReadyReasons.includes("dont-post")) reasons.push("dont-post");
  if (post.notReadyReasons.includes("skipped-in-suggester"))
    reasons.push("skipped-in-suggester");

  const body = post.body.trim();
  if (body.length === 0 && media.length === 0) reasons.push("empty");

  if (isShareOnly(post)) reasons.push("share-only");

  const videos = media.filter((m) => m.mimeType.startsWith("video/"));
  if (videos.some((v) => v.hasAudio === false)) {
    reasons.push("silent-video");
  } else if (videos.some((v) => v.hasAudio === null)) {
    reasons.push("unchecked-audio");
  }

  if (post.notReadyReasons.includes("broken-media")) reasons.push("broken-media");

  return {
    readiness: reasons.length ? "NOT_READY" : "READY",
    reasons,
  };
}
