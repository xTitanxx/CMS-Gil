import Link from "next/link";
import { format } from "date-fns";
import {
  ChevronDown,
  Image as ImageIcon,
  Info,
  Play,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  listTrashBatches,
  RULE_LABELS,
  type TrashedPost,
} from "@/lib/trash";
import { displayBody } from "@/lib/post-body";
import { TrashActions } from "./[dir]/TrashActions";

export const dynamic = "force-dynamic";

function PostRow({ post, dir }: { post: TrashedPost; dir: string }) {
  const body = displayBody(post.body);
  const hasVideo = post.media.some((m) => m.mimeType?.startsWith("video/"));

  return (
    <Link
      href={`/admin/trash/${encodeURIComponent(dir)}/post/${post.id}`}
      className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2.5 transition-colors hover:border-gray-300 hover:bg-gray-50"
    >
      <div className="relative h-10 w-10 flex-shrink-0 overflow-hidden rounded bg-gray-100">
        <div className="flex h-full items-center justify-center">
          <ImageIcon className="h-4 w-4 text-gray-300" />
        </div>
        {hasVideo && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30">
            <Play className="h-3.5 w-3.5 fill-white text-white" />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">
            {format(new Date(post.originalDate), "MMM d, yyyy")}
          </span>
          <Badge variant="outline" className="text-xs">
            {post.source}
          </Badge>
          {post.media.length > 0 && (
            <span className="text-xs text-gray-400">
              {post.media.length} media
            </span>
          )}
        </div>
        {body ? (
          <p className="mt-0.5 line-clamp-2 text-sm text-gray-700">{body}</p>
        ) : (
          <p className="mt-0.5 text-sm italic text-gray-400">No caption</p>
        )}
      </div>
    </Link>
  );
}

function GroupPreview({ post }: { post: TrashedPost }) {
  const body = displayBody(post.body);
  const hasVideo = post.media.some((m) => m.mimeType?.startsWith("video/"));

  return (
    <div className="flex min-w-0 flex-1 items-start gap-3">
      <div className="relative h-10 w-10 flex-shrink-0 overflow-hidden rounded bg-gray-100">
        <div className="flex h-full items-center justify-center">
          <ImageIcon className="h-4 w-4 text-gray-300" />
        </div>
        {hasVideo && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30">
            <Play className="h-3.5 w-3.5 fill-white text-white" />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">
            {format(new Date(post.originalDate), "MMM d, yyyy")}
          </span>
          <Badge variant="outline" className="text-xs">
            {post.source}
          </Badge>
          {post.media.length > 0 && (
            <span className="text-xs text-gray-400">
              {post.media.length} media
            </span>
          )}
        </div>
        {body ? (
          <p className="mt-0.5 line-clamp-1 text-sm text-gray-700">{body}</p>
        ) : (
          <p className="mt-0.5 text-sm italic text-gray-400">No caption</p>
        )}
      </div>
    </div>
  );
}

export default async function TrashPage() {
  const batches = await listTrashBatches();

  return (
    <div className="flex h-[calc(100vh-64px)] flex-col">
      <div className="flex-shrink-0 space-y-3 pb-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Trash</h1>
          <p className="text-sm text-gray-500">
            Deleted duplicates from cleanup runs. Review, restore, or purge.
          </p>
        </div>

        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          Trash is stored locally in <code>./trash/</code> — not visible on
          Vercel production.
        </div>
      </div>

      {batches.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-gray-200 py-16 text-center text-gray-500">
          <Trash2 className="mx-auto mb-3 h-8 w-8 text-gray-300" />
          <p>Nothing in the trash.</p>
          <p className="mt-1 text-xs text-gray-400">
            Run <code>scripts/dedupe-posts.ts --rule=E --trash</code> to
            populate it.
          </p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto pb-8">
          {batches.map((batch) => {
            const label = RULE_LABELS[batch.manifest.rule] ?? {
              name: batch.manifest.rule,
              description: "Unknown rule",
            };
            const postsById = new Map(
              batch.posts.map((p) => [p.id, p]),
            );
            const groups = batch.manifest.groups.map((g, i) => ({
              index: i,
              droppedPosts: g.dropped
                .map((id) => postsById.get(id))
                .filter((p): p is TrashedPost => p != null),
            }));
            const groupedIds = new Set(
              batch.manifest.groups.flatMap((g) => g.dropped),
            );
            const ungrouped = batch.posts.filter(
              (p) => !groupedIds.has(p.id),
            );

            return (
              <section key={batch.dir}>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-semibold text-gray-900">
                      {label.name}
                    </h2>
                    <span
                      className="cursor-help"
                      title={label.description}
                    >
                      <Info className="h-3.5 w-3.5 text-gray-400" />
                    </span>
                    <span className="text-xs text-gray-400">
                      {batch.manifest.trashedCount} post
                      {batch.manifest.trashedCount === 1 ? "" : "s"} ·{" "}
                      {format(
                        new Date(batch.manifest.createdAt),
                        "MMM d, yyyy",
                      )}
                    </span>
                  </div>
                  <TrashActions dir={batch.dir} />
                </div>

                <div className="space-y-1.5">
                  {groups.map((group) => {
                    if (group.droppedPosts.length === 0) return null;
                    const preview = group.droppedPosts[0];

                    if (group.droppedPosts.length === 1) {
                      return (
                        <PostRow
                          key={group.index}
                          post={preview}
                          dir={batch.dir}
                        />
                      );
                    }

                    return (
                      <details
                        key={group.index}
                        className="group rounded-lg border border-gray-200 bg-white"
                      >
                        <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-2.5 hover:bg-gray-50 [&::-webkit-details-marker]:hidden">
                          <ChevronDown className="h-4 w-4 flex-shrink-0 text-gray-400 transition-transform group-open:rotate-180" />
                          <GroupPreview post={preview} />
                          <Badge
                            variant="secondary"
                            className="flex-shrink-0 text-xs"
                          >
                            +{group.droppedPosts.length - 1}
                          </Badge>
                        </summary>
                        <div className="space-y-1.5 border-t border-gray-100 p-2">
                          {group.droppedPosts.slice(1).map((post) => (
                            <PostRow
                              key={post.id}
                              post={post}
                              dir={batch.dir}
                            />
                          ))}
                        </div>
                      </details>
                    );
                  })}

                  {ungrouped.map((post) => (
                    <PostRow
                      key={post.id}
                      post={post}
                      dir={batch.dir}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
