"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { SiFacebook } from "react-icons/si";
import { copyTextToClipboard, shareFilesToFacebook } from "@/lib/client/shareToFacebook";
import { FacebookConfirmPrompt } from "@/app/admin/_shared/FacebookConfirmPrompt";

type ShareMedia = { id: string; mimeType: string; url: string };

async function fetchAsFiles(media: ShareMedia[], namePrefix: string): Promise<File[]> {
  const files: File[] = [];
  for (const m of media) {
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
 * A permanent, always-visible action on every post detail page — not gated
 * on Post.fbShareStartedAt, so it works equally for re-sharing an
 * already-posted post, a post that never went through the compose page's
 * immediate-share flow, or a fresh draft still awaiting its first share.
 */
export function ShareToFacebookButton({
  postId,
  body,
}: {
  postId: string;
  body: string;
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
      // Media is fetched (and, server-side, mux/remuxed as needed) from
      // /api/posts/[id]/share-media rather than passed in as a prop — but
      // that fetch is itself a network round trip, which already breaks
      // the fresh-tap requirement navigator.share() needs. Confirmed on
      // real devices: forcing the reliable download+open-Facebook fallback
      // (allowNativeShare: false) here, rather than gambling on a native
      // share sheet that silently drops the media/caption once that delay
      // has happened.
      const res = await fetch(`/api/posts/${postId}/share-media`);
      if (!res.ok) throw new Error("failed to prepare media");
      const data: { media: ShareMedia[] } = await res.json();
      const files = await fetchAsFiles(data.media, `gil-${postId}`);
      await shareFilesToFacebook({ body, files, allowNativeShare: false });
      setConfirming(true);
    } catch {
      setError("Couldn't open Facebook — try again.");
    } finally {
      setSharing(false);
    }
  }

  if (confirming) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-3 shadow-sm">
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
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => void handleShare()}
        disabled={sharing}
        className="inline-flex items-center gap-1.5 rounded-lg bg-[#1877F2] px-3 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-60"
      >
        {sharing ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <SiFacebook className="h-4 w-4" />
        )}
        Share to Facebook
      </button>
      {error && <p className="mt-1.5 text-[12px] text-red-700">{error}</p>}
    </div>
  );
}
