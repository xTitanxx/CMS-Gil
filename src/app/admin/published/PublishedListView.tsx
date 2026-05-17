"use client";

import { useState } from "react";
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
          />
        )}
      />
    </>
  );
}
