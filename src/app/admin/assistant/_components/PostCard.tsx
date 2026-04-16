"use client";
import Link from "next/link";

export interface PostCardData {
  postId: string;
  body?: string;
  tags?: string[];
  stars?: number | null;
  lifecycle?: string | null;
  thumbUrl?: string | null;
  reasons?: string[];
  score?: number;
}

export function PostCard({
  data,
  onSchedule,
}: {
  data: PostCardData;
  onSchedule?: (postId: string) => void;
}) {
  return (
    <div className="rounded-lg border p-3 flex gap-3 items-start bg-white">
      {data.thumbUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={data.thumbUrl} alt="" className="w-20 h-20 object-cover rounded" />
      ) : (
        <div className="w-20 h-20 rounded bg-gray-100" />
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm line-clamp-2">{data.body}</p>
        <div className="flex flex-wrap gap-1 text-xs mt-1 text-gray-500">
          {data.stars ? <span>{"★".repeat(data.stars)}</span> : null}
          {data.lifecycle ? <span>· {data.lifecycle.toLowerCase()}</span> : null}
          {data.reasons?.map((r) => (
            <span key={r}>· {r}</span>
          ))}
        </div>
        <div className="flex gap-2 mt-2">
          <Link href={`/admin/posts/${data.postId}`} className="text-xs underline">
            Open
          </Link>
          {onSchedule && (
            <button
              onClick={() => onSchedule(data.postId)}
              className="text-xs underline"
            >
              Schedule…
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
