import Link from "next/link";
import { Play } from "lucide-react";

export interface RelatedPostSummary {
  id: string;
  body: string;
  originalDate: string;
  thumbUrl: string | null;
  thumbAlt: string | null;
  thumbIsVideo: boolean;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function RelatedPostsList({ posts }: { posts: RelatedPostSummary[] }) {
  if (posts.length === 0) return null;
  return (
    <section className="mt-6">
      <h2 className="mb-2 px-1 text-sm font-semibold text-gray-700">Related posts</h2>
      <ul className="flex flex-col gap-2">
        {posts.map((p) => {
          return (
            <li key={p.id}>
              <Link
                href={`/p/${p.id}`}
                className="flex items-start gap-3 rounded-lg bg-white p-3 shadow-sm transition-colors hover:bg-gray-50"
              >
                <div className="relative h-20 w-20 flex-shrink-0 overflow-hidden rounded-md bg-gray-100">
                  {p.thumbUrl && p.thumbIsVideo ? (
                    <video
                      src={`${p.thumbUrl}#t=0.001`}
                      muted
                      playsInline
                      preload="metadata"
                      className="h-full w-full object-cover"
                      aria-label={p.thumbAlt ?? "Video preview"}
                    />
                  ) : p.thumbUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.thumbUrl}
                      alt={p.thumbAlt ?? ""}
                      className="h-full w-full object-cover"
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xs text-gray-400">
                      —
                    </div>
                  )}
                  {p.thumbIsVideo && p.thumbUrl && (
                    <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/55 text-white shadow-md">
                        <Play className="h-4 w-4 fill-current" />
                      </span>
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-gray-500">{formatDate(p.originalDate)}</p>
                  <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm text-gray-800 break-words">
                    {p.body || "(no text)"}
                  </p>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
