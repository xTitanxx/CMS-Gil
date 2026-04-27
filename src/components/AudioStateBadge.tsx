import { Music, VolumeX } from "lucide-react";
import type { PostAudioState } from "@/lib/post-audio-state";

interface Props {
  state: PostAudioState;
  /** Extra className for positioning (e.g. absolute) by the parent. */
  className?: string;
}

/**
 * Pill rendered next to a video thumbnail to communicate its audio state.
 * Returns null for "has-audio" (no badge needed).
 *
 * - silent      → orange/warning, "Silent". The post will publish muted.
 * - music-added → blue/info, "Music added". The publish pipeline will mux
 *                 the attached AudioTrack onto the video before upload.
 */
export function AudioStateBadge({ state, className }: Props) {
  if (state === "has-audio") return null;
  if (state === "music-added") {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full bg-blue-500/85 px-2 py-0.5 text-[11px] font-medium text-white ${className ?? ""}`}
        title="Silent video with custom audio attached — will be muxed at publish time."
      >
        <Music className="h-3 w-3" />
        <span>Music added</span>
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-orange-500/85 px-2 py-0.5 text-[11px] font-medium text-white ${className ?? ""}`}
      title="Silent video — no audio track. Attach music before publishing."
    >
      <VolumeX className="h-3 w-3" />
      <span>Silent</span>
    </span>
  );
}
