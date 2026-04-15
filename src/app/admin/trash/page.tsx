import Link from "next/link";
import { format } from "date-fns";
import {
  ChevronDown,
  Image as ImageIcon,
  Info,
  Play,
  Trash2,
  Copy,
  Layers,
  Type,
  Fingerprint,
  FileText,
  Share2,
  Bot,
  Merge,
  HelpCircle,
} from "lucide-react";
import { v2 as cloudinary } from "cloudinary";
import { Badge } from "@/components/ui/badge";
import {
  listTrashBatches,
  RULE_LABELS,
  type TrashedPost,
  type TrashRule,
} from "@/lib/trash";
import { displayBody } from "@/lib/post-body";
import { CopyIdChip } from "./CopyIdChip";
import { TrashActions } from "./[dir]/TrashActions";
import { TrashScrollContainer } from "./TrashScrollContainer";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

function thumbUrlFor(post: TrashedPost): string | null {
  const first = post.media[0];
  if (!first) return null;
  const publicId = first.storageKey.replace(/\.[^/.]+$/, "");
  const isVideo = first.mimeType?.startsWith("video");
  return cloudinary.url(publicId, {
    resource_type: isVideo ? "video" : "image",
    type: "upload",
    format: "jpg",
    transformation: [{ width: 256, crop: "limit", quality: "auto" }],
  });
}

const RULE_STYLES: Record<string, { border: string; bg: string; badge: string; icon: React.ElementType }> = {
  A:  { border: "border-l-red-400",    bg: "bg-red-50",    badge: "bg-red-100 text-red-700",    icon: Copy },
  B:  { border: "border-l-orange-400", bg: "bg-orange-50", badge: "bg-orange-100 text-orange-700", icon: Type },
  C:  { border: "border-l-amber-400",  bg: "bg-amber-50",  badge: "bg-amber-100 text-amber-700",  icon: Fingerprint },
  D:  { border: "border-l-yellow-400", bg: "bg-yellow-50", badge: "bg-yellow-100 text-yellow-700", icon: FileText },
  E:  { border: "border-l-lime-400",   bg: "bg-lime-50",   badge: "bg-lime-100 text-lime-700",   icon: Type },
  F:  { border: "border-l-teal-400",   bg: "bg-teal-50",   badge: "bg-teal-100 text-teal-700",   icon: Share2 },
  AI: { border: "border-l-purple-400", bg: "bg-purple-50", badge: "bg-purple-100 text-purple-700", icon: Bot },
  "reconcile-main": { border: "border-l-blue-400", bg: "bg-blue-50", badge: "bg-blue-100 text-blue-700", icon: Merge },
};
const DEFAULT_STYLE = { border: "border-l-gray-400", bg: "bg-gray-50", badge: "bg-gray-100 text-gray-700", icon: HelpCircle };

function getRuleStyle(rule: string) {
  return RULE_STYLES[rule] ?? DEFAULT_STYLE;
}

export const dynamic = "force-dynamic";

function PostRow({
  post,
  dir,
  keepId,
}: {
  post: TrashedPost;
  dir: string;
  keepId?: string;
}) {
  const body = displayBody(post.body);
  const hasVideo = post.media.some((m) => m.mimeType?.startsWith("video/"));
  const thumb = thumbUrlFor(post);

  return (
    <div className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2.5 transition-colors hover:border-gray-300 hover:bg-gray-50">
      <span aria-hidden className="h-4 w-4 flex-shrink-0 self-center" />
      <Link
        href={`/admin/trash/${encodeURIComponent(dir)}/post/${post.id}`}
        className="flex min-w-0 flex-1 items-center gap-4"
      >
        <div className="relative h-28 w-28 flex-shrink-0 overflow-hidden rounded-md bg-gray-100">
          {thumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumb} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center">
              <ImageIcon className="h-6 w-6 text-gray-300" />
            </div>
          )}
          {hasVideo && thumb && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/20">
              <Play className="h-6 w-6 fill-white text-white drop-shadow" />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <CopyIdChip id={post.id} />
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
      {keepId && (
        <Link
          href={`/admin/posts/${keepId}`}
          target="_blank"
          rel="noopener"
          className="flex-shrink-0 self-center rounded border border-green-200 bg-green-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-green-700 hover:bg-green-100"
          title={`Open the kept post (${keepId}) in a new tab`}
        >
          Go to kept version ↗
        </Link>
      )}
    </div>
  );
}

function GroupPreview({
  post,
}: {
  post: TrashedPost;
}) {
  const body = displayBody(post.body);
  const hasVideo = post.media.some((m) => m.mimeType?.startsWith("video/"));
  const thumb = thumbUrlFor(post);

  return (
    <div className="flex min-w-0 flex-1 items-center gap-4">
      <div className="relative h-28 w-28 flex-shrink-0 overflow-hidden rounded-md bg-gray-100">
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center">
            <ImageIcon className="h-6 w-6 text-gray-300" />
          </div>
        )}
        {hasVideo && thumb && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/20">
            <Play className="h-6 w-6 fill-white text-white drop-shadow" />
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
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Trash</h1>
            <p className="text-sm text-gray-500">
              Deleted duplicates from cleanup runs. Review, restore, or purge.
            </p>
          </div>
          <Link
            href="/admin/trash/review"
            className="flex-shrink-0 rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100"
          >
            AI dedupe review →
          </Link>
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
        <TrashScrollContainer className="min-h-0 flex-1 space-y-4 overflow-y-auto pb-8">
          {(() => {
            // Merge batches by rule so the UI shows one section per rule
            // instead of one per timestamped run.
            const byRule = new Map<string, typeof batches>();
            for (const b of batches) {
              const arr = byRule.get(b.manifest.rule) ?? [];
              arr.push(b);
              byRule.set(b.manifest.rule, arr);
            }
            return [...byRule.entries()].map(([rule, ruleBatches]) => {
              const label = RULE_LABELS[rule] ?? {
                name: rule,
                description: "Unknown rule",
              };
              const style = getRuleStyle(rule);
              const Icon = style.icon;
              const totalPosts = ruleBatches.reduce(
                (n, b) => n + b.manifest.trashedCount,
                0,
              );
              type Group = {
                batchDir: string;
                index: string;
                keepId: string | undefined;
                droppedPosts: TrashedPost[];
              };
              const groups: Group[] = [];
              const ungrouped: Array<{ post: TrashedPost; dir: string }> = [];
              for (const batch of ruleBatches) {
                const postsById = new Map(batch.posts.map((p) => [p.id, p]));
                batch.manifest.groups.forEach((g, i) => {
                  groups.push({
                    batchDir: batch.dir,
                    index: `${batch.dir}-${i}`,
                    keepId: g.keep || undefined,
                    droppedPosts: g.dropped
                      .map((id) => postsById.get(id))
                      .filter((p): p is TrashedPost => p != null),
                  });
                });
                const groupedIds = new Set(
                  batch.manifest.groups.flatMap((g) => g.dropped),
                );
                for (const p of batch.posts) {
                  if (!groupedIds.has(p.id)) ungrouped.push({ post: p, dir: batch.dir });
                }
              }

              return (
                <section
                  key={rule}
                  className={`rounded-lg border border-l-4 ${style.border} border-gray-200 bg-white shadow-sm`}
                >
                  {/* Section header */}
                  <div className={`flex items-center justify-between gap-3 rounded-t-lg px-4 py-3 ${style.bg}`}>
                    <div className="flex items-center gap-3">
                      <Icon className="h-5 w-5 flex-shrink-0 opacity-60" />
                      <div>
                        <div className="flex items-center gap-2">
                          <h2 className="text-base font-semibold text-gray-900">
                            {label.name}
                          </h2>
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${style.badge}`}>
                            {totalPosts}
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs text-gray-500">
                          {label.description}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {ruleBatches.length > 1 && (
                        <span className="text-xs text-gray-400">
                          {ruleBatches.length} batches
                        </span>
                      )}
                      {ruleBatches.length === 1 && (
                        <TrashActions dir={ruleBatches[0].dir} />
                      )}
                    </div>
                  </div>

                  {/* Batch management (multi-batch only) */}
                  {ruleBatches.length > 1 && (
                    <details className="border-b border-gray-100 px-4 py-2 text-xs text-gray-500">
                      <summary className="cursor-pointer select-none font-medium hover:text-gray-700">
                        Manage {ruleBatches.length} batches
                      </summary>
                      <ul className="mt-2 space-y-1.5 pb-1">
                        {ruleBatches.map((b) => (
                          <li
                            key={b.dir}
                            className="flex items-center justify-between gap-3"
                          >
                            <span className="truncate">
                              {format(
                                new Date(b.manifest.createdAt),
                                "MMM d, HH:mm",
                              )}{" "}
                              — {b.manifest.trashedCount} post
                              {b.manifest.trashedCount === 1 ? "" : "s"}
                            </span>
                            <TrashActions dir={b.dir} />
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}

                  {/* Posts list */}
                  <div className="space-y-1.5 p-3">
                    {groups.map((group) => {
                      if (group.droppedPosts.length === 0) return null;
                      const preview = group.droppedPosts[0];

                      if (group.droppedPosts.length === 1) {
                        return (
                          <PostRow
                            key={group.index}
                            post={preview}
                            dir={group.batchDir}
                            keepId={group.keepId}
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
                            {group.keepId && (
                              <Link
                                href={`/admin/posts/${group.keepId}`}
                                target="_blank"
                                rel="noopener"
                                className="flex-shrink-0 rounded border border-green-200 bg-green-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-green-700 hover:bg-green-100"
                                title={`Open the kept post (${group.keepId}) in a new tab`}
                              >
                                Go to kept version ↗
                              </Link>
                            )}
                          </summary>
                          <div className="space-y-1.5 border-t border-gray-100 p-2">
                            {group.droppedPosts.slice(1).map((post) => (
                              <PostRow
                                key={post.id}
                                post={post}
                                dir={group.batchDir}
                                keepId={group.keepId}
                              />
                            ))}
                          </div>
                        </details>
                      );
                    })}

                    {ungrouped.map(({ post, dir }) => (
                      <PostRow key={post.id} post={post} dir={dir} />
                    ))}
                  </div>
                </section>
              );
            });
          })()}
        </TrashScrollContainer>
      )}
    </div>
  );
}
