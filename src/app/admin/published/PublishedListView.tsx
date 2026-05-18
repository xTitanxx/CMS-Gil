"use client";

import { useCallback, useEffect, useState } from "react";
import { PostListShell } from "@/app/admin/_shared/PostListShell";
import { PostingHubTabs } from "@/app/admin/_shared/PostingHubTabs";
import type { PostRowData } from "@/app/admin/posts/PostRow";
import { PublishedPostRow } from "./PublishedPostRow";

// Only publish-date sorts make sense here — everything in this list has been
// published, so the user only ever wants to scrub the timeline. The first
// entry's value is the default when there's no `?sort=` query param.
const PUBLISHED_SORT_OPTIONS = [
  { value: "lastPublishedViaHubAt_desc", label: "Recently published" },
  { value: "lastPublishedViaHubAt_asc", label: "Oldest published" },
];

export function PublishedListView() {
  const [, setPosts] = useState<PostRowData[]>([]);
  // Set of postIds that still need a manual FB Personal cross-post. Same
  // source as the Manual FB queue page so badge state stays consistent across
  // the hub.
  const [fbPendingPostIds, setFbPendingPostIds] = useState<Set<string>>(new Set());

  const refreshFbPending = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/manual-fb-queue", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { items: { postId: string }[] };
      setFbPendingPostIds(new Set(data.items.map((i) => i.postId)));
    } catch {
      // best-effort; absence just means the yellow "still in queue" cue is
      // missing, not a fatal error
    }
  }, []);

  useEffect(() => {
    void refreshFbPending();
  }, [refreshFbPending]);

  return (
    <>
      <PostingHubTabs />
      <PostListShell<PostRowData>
        apiEndpoint="/api/posts"
        // The publishedViaHub flag narrows to Post.hubPublishCount > 0 server-side.
        extraParams={{ publishedViaHub: "true" }}
        sortOptions={PUBLISHED_SORT_OPTIONS}
        title="Published"
        itemNoun={{ singular: "post", plural: "posts" }}
        hideKindTabs
        getPostId={(p) => p.id}
        onPostsChanged={setPosts}
        emptyState={
          <div className="py-16 text-center text-sm text-gray-500">
            Nothing has been published through the hub yet.
          </div>
        }
        renderRow={(post, index) => (
          <PublishedPostRow
            post={post}
            index={index}
            href={`/admin/posts/${post.id}`}
            fbPending={fbPendingPostIds.has(post.id)}
          />
        )}
      />
    </>
  );
}
