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
    <div
      role="tablist"
      className="inline-flex w-fit items-center gap-0.5 rounded-full border border-gray-200 bg-gray-100/70 p-0.5"
    >
      {(["posts", "stories"] as const).map((k) => {
        const active = current === k;
        return (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => setKind(k)}
            className={`relative inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
              active
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            <span>{k === "posts" ? "Posts" : "Stories"}</span>
            {counts && (
              <span
                className={`text-xs tabular-nums ${
                  active ? "text-gray-400" : "text-gray-400"
                }`}
              >
                {counts[k].toLocaleString()}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
