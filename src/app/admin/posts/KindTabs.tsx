"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

export type PostKind = "posts" | "stories";

interface KindCounts {
  posts: number;
  stories: number;
}

export function KindTabs({ current, counts }: { current: PostKind; counts?: KindCounts | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const setKind = useCallback(
    (next: PostKind) => {
      if (next === current) return;
      const params = new URLSearchParams(searchParams.toString());
      if (next === "posts") {
        params.delete("kind");
      } else {
        params.set("kind", next);
      }
      const qs = params.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [current, pathname, router, searchParams],
  );

  return (
    <div className="flex gap-1 border-b border-gray-200">
      {(["posts", "stories"] as const).map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => setKind(k)}
          className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
            current === k
              ? "border-blue-600 text-blue-700"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          {k === "posts" ? "Posts" : "Stories"}
          {counts && (
            <span className="ml-1.5 text-xs text-gray-400">
              {counts[k].toLocaleString()}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
