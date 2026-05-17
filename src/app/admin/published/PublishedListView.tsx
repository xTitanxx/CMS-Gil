"use client";

import { useState } from "react";
import { PostListShell } from "@/app/admin/_shared/PostListShell";
import { PostingHubTabs } from "@/app/admin/_shared/PostingHubTabs";
import type { PostRowData } from "@/app/admin/posts/PostRow";
import { PublishedPostRow } from "./PublishedPostRow";

export function PublishedListView() {
  const [, setPosts] = useState<PostRowData[]>([]);

  return (
    <>
      <PostingHubTabs />
      <PostListShell<PostRowData>
        apiEndpoint="/api/posts"
        // The publishedViaHub flag narrows to Post.hubPublishCount > 0 server-side.
        // The sort surfaces the most-recently-pushed posts first, matching the
        // mental model "what did we just ship?".
        extraParams={{
          publishedViaHub: "true",
          sort: "lastPublishedViaHubAt_desc",
        }}
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
