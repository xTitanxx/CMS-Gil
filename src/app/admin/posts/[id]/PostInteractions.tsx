// src/app/(dashboard)/posts/[id]/PostInteractions.tsx
"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Trash2, RefreshCw } from "lucide-react";
import { PublishPanel, type PublishPanelMedia } from "@/components/posts/PublishPanel";
import { useAsync } from "@/hooks/useAsync";
import { useConfirm } from "@/hooks/useConfirm";
import { Spinner } from "@/components/ui/spinner";

export function DeleteButton({ postId }: { postId: string }) {
  const router = useRouter();
  const { isLoading, run } = useAsync();

  const handleDelete = useCallback(async () => {
    await run(async () => {
      const res = await fetch(`/api/posts/${postId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
    });
    router.push("/posts");
  }, [postId, run, router]);

  const { confirming, trigger } = useConfirm(handleDelete);

  return (
    <Button
      variant="ghost"
      size="sm"
      className={
        confirming
          ? "text-amber-600 hover:text-amber-700 hover:bg-amber-50"
          : "text-red-500 hover:text-red-700 hover:bg-red-50"
      }
      disabled={isLoading}
      onClick={trigger}
    >
      {isLoading ? <Spinner /> : <Trash2 className="h-4 w-4" />}
      {isLoading ? "Deleting..." : confirming ? "Are you sure?" : "Delete"}
    </Button>
  );
}

export function ReanalyzeButton({ postId }: { postId: string }) {
  const router = useRouter();
  const { isLoading, status, message, run } = useAsync();

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        variant="outline"
        size="sm"
        disabled={isLoading}
        onClick={() =>
          run(async () => {
            const res = await fetch(`/api/posts/${postId}/analyze`, { method: "POST" });
            if (!res.ok) throw new Error("Re-analysis failed");
            router.refresh();
          }, "Re-analysis complete")
        }
      >
        {isLoading ? <Spinner /> : <RefreshCw className="h-4 w-4" />}
        {isLoading ? "Analyzing..." : "Re-analyze"}
      </Button>
      {status === "success" && (
        <p className="text-xs text-green-600">{message}</p>
      )}
      {status === "error" && (
        <p className="text-xs text-red-600">{message}</p>
      )}
    </div>
  );
}

export function PublishPanelWithRefresh({
  postId,
  body,
  hasVideo,
  media,
}: {
  postId: string;
  body: string;
  hasVideo: boolean;
  media: PublishPanelMedia[];
}) {
  const router = useRouter();
  return (
    <PublishPanel
      postId={postId}
      body={body}
      hasVideo={hasVideo}
      media={media}
      onPublished={() => router.refresh()}
    />
  );
}
