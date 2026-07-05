"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { SiFacebook } from "react-icons/si";
import { copyTextToClipboard, shareFilesToFacebook } from "@/lib/client/shareToFacebook";
import { FacebookConfirmPrompt } from "@/app/admin/_shared/FacebookConfirmPrompt";

type Media = { id: string; mimeType: string; url: string | null };

async function fetchAsFiles(media: Media[], namePrefix: string): Promise<File[]> {
  const files: File[] = [];
  for (const m of media) {
    if (!m.url) continue;
    try {
      const res = await fetch(m.url);
      if (!res.ok) continue;
      const blob = await res.blob();
      const ext = m.mimeType.split("/")[1] ?? "bin";
      files.push(new File([blob], `${namePrefix}-${m.id}.${ext}`, { type: m.mimeType }));
    } catch {
      // Skip media that fails to fetch — a partial share beats none.
    }
  }
  return files;
}

/**
 * Surfaces on the post detail page whenever a draft was routed through the
 * compose page's "Post" button but hasn't been confirmed as posted yet
 * (Post.fbShareStartedAt is set) — e.g. the tab was closed before answering,
 * or the share sheet was dismissed without picking Facebook.
 */
export function NeedsFacebookBanner({
  postId,
  body,
  media,
}: {
  postId: string;
  body: string;
  media: Media[];
}) {
  const router = useRouter();
  const [sharing, setSharing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleShare() {
    setSharing(true);
    setError(null);
    try {
      await copyTextToClipboard(body);
      const files = await fetchAsFiles(media, `gil-${postId}`);
      await shareFilesToFacebook({ body, files });
      setConfirming(true);
    } catch {
      setError("Couldn't open Facebook — try again.");
    } finally {
      setSharing(false);
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-blue-200 bg-blue-50 shadow-sm">
      <div className="px-4 py-3">
        <p className="mb-2 text-[13px] font-semibold text-blue-900">
          This post still needs to go up on Facebook.
        </p>
        {confirming ? (
          <FacebookConfirmPrompt
            postId={postId}
            onResolved={(confirmed) => {
              if (!confirmed) {
                setConfirming(false);
                return;
              }
              router.refresh();
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => void handleShare()}
            disabled={sharing}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {sharing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <SiFacebook className="h-4 w-4" />
            )}
            Share to Facebook
          </button>
        )}
        {error && <p className="mt-2 text-[12px] text-red-700">{error}</p>}
      </div>
    </div>
  );
}
