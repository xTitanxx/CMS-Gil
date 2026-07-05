"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, ExternalLink, Loader2, Trash2 } from "lucide-react";
import { SiFacebook } from "react-icons/si";
import { useAsync } from "@/hooks/useAsync";
import { useConfirm } from "@/hooks/useConfirm";
import { BackToListLink } from "./BackToListLink";

interface Props {
  postId: string;
  listHref: string;
  prevHref: string | null;
  nextHref: string | null;
  platformUrl: string | null;
}

const PILL_BASE =
  "pointer-events-auto flex h-10 w-10 items-center justify-center rounded-full bg-white/90 shadow-[0_2px_8px_rgba(0,0,0,0.08)] active:bg-white/95 touch-manipulation transition-colors";

// Mobile-only floating action row. Sits in the same fixed top band as the
// burger from MobilePageHeader — burger pinned left, these pills pinned right.
// Hidden on md+ where PostNavBar takes over as a sticky horizontal bar.
export function MobilePostActions({ postId, listHref, prevHref, nextHref, platformUrl }: Props) {
  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-30 flex justify-end px-2 md:hidden"
      style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
    >
      <div className="my-2 flex items-center gap-1.5">
        <BackToListLink
          fallbackHref={listHref}
          ariaLabel="Back"
          className={`${PILL_BASE} text-[#0d0d0d]`}
        >
          <ArrowLeft className="h-5 w-5" strokeWidth={1.75} />
        </BackToListLink>

        {platformUrl && (
          <a
            href={platformUrl}
            target="_blank"
            rel="noreferrer"
            aria-label="Open original"
            className={`${PILL_BASE} text-blue-600`}
          >
            <ExternalLink className="h-[18px] w-[18px]" />
          </a>
        )}

        <Link
          href={`/admin/m/${postId}?from=${encodeURIComponent(`/admin/posts/${postId}`)}`}
          aria-label="Post to Facebook"
          className={`${PILL_BASE} bg-[#1877F2]/90 text-white supports-[backdrop-filter]:bg-[#1877F2]/80 active:bg-[#1877F2]`}
        >
          <SiFacebook className="h-[18px] w-[18px]" />
        </Link>

        <DeletePill postId={postId} />

        <PrevNextPill href={prevHref} direction="prev" />
        <PrevNextPill href={nextHref} direction="next" />
      </div>
    </div>
  );
}

function DeletePill({ postId }: { postId: string }) {
  const router = useRouter();
  const { isLoading, run } = useAsync();

  const handleDelete = useCallback(async () => {
    await run(async () => {
      const res = await fetch(`/api/posts/${postId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
    });
    router.push("/admin/posts");
  }, [postId, run, router]);

  const { confirming, trigger } = useConfirm(handleDelete);

  return (
    <button
      type="button"
      onClick={trigger}
      disabled={isLoading}
      aria-label={confirming ? "Tap again to confirm delete" : "Delete"}
      className={`${PILL_BASE} ${
        confirming
          ? "bg-amber-500 text-white active:bg-amber-500/90 animate-pulse"
          : "text-red-600"
      } disabled:opacity-60`}
    >
      {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Trash2 className="h-5 w-5" />}
    </button>
  );
}

function PrevNextPill({
  href,
  direction,
}: {
  href: string | null;
  direction: "prev" | "next";
}) {
  const Icon = direction === "prev" ? ChevronLeft : ChevronRight;
  const label = direction === "prev" ? "Previous post" : "Next post";
  if (!href) {
    return (
      <span aria-disabled="true" aria-label={label} className={`${PILL_BASE} text-[#0d0d0d] opacity-40`}>
        <Icon className="h-5 w-5" strokeWidth={2} />
      </span>
    );
  }
  return (
    <Link href={href} aria-label={label} prefetch className={`${PILL_BASE} text-[#0d0d0d]`}>
      <Icon className="h-5 w-5" strokeWidth={2} />
    </Link>
  );
}
