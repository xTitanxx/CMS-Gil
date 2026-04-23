"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { FileText, Film, ImageIcon, LayoutGrid, Volume2, VolumeX, Quote } from "lucide-react";
import type { PostKind } from "./KindTabs";

export type SubKindCounts = {
  postsAll: number;
  postsVideoAudio: number;
  postsVideoSilent: number;
  postsPhoto: number;
  postsText: number;
  postsQuoted: number;
  storiesAll: number;
  storiesVideoAudio: number;
  storiesVideoSilent: number;
};

interface Tab {
  value: string;
  label: string;
  countKey: keyof SubKindCounts;
  icon: React.ElementType;
}

const POSTS_TABS: Tab[] = [
  { value: "all", label: "All", countKey: "postsAll", icon: LayoutGrid },
  { value: "video-audio", label: "Video", countKey: "postsVideoAudio", icon: Volume2 },
  { value: "video-silent", label: "Silent video", countKey: "postsVideoSilent", icon: VolumeX },
  { value: "photo", label: "Photo", countKey: "postsPhoto", icon: ImageIcon },
  { value: "text", label: "Text", countKey: "postsText", icon: FileText },
  { value: "quoted", label: "Quoted", countKey: "postsQuoted", icon: Quote },
];

const STORIES_TABS: Tab[] = [
  { value: "all", label: "All", countKey: "storiesAll", icon: LayoutGrid },
  { value: "video-audio", label: "With sound", countKey: "storiesVideoAudio", icon: Volume2 },
  { value: "video-silent", label: "Silent", countKey: "storiesVideoSilent", icon: VolumeX },
];

const DEFAULT_SUB = "all";

export function SubKindTabs({
  kind,
  current,
  counts,
  totals,
}: {
  kind: PostKind;
  current: string;
  counts?: SubKindCounts | null;
  totals?: SubKindCounts | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const tabs = kind === "stories" ? STORIES_TABS : POSTS_TABS;
  const active =
    tabs.find((t) => t.value === current)?.value ?? DEFAULT_SUB;

  const setSub = useCallback(
    (next: string) => {
      if (next === active) return;
      const params = new URLSearchParams(searchParams.toString());
      if (next === DEFAULT_SUB) params.delete("subKind");
      else params.set("subKind", next);
      const qs = params.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [active, pathname, router, searchParams],
  );

  return (
    <div className="flex flex-wrap gap-1.5 border-b border-gray-100 pb-2 pt-2">
      {tabs.map((t) => {
        const isActive = active === t.value;
        const count = counts?.[t.countKey];
        const total = totals?.[t.countKey];
        const showTotal = typeof total === "number" && typeof count === "number" && total !== count;
        const Icon = t.icon;
        return (
          <button
            key={t.value}
            type="button"
            onClick={() => setSub(t.value)}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              isActive
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            <Icon className="h-3 w-3" />
            {t.label}
            {typeof count === "number" && (
              <span
                className={
                  isActive ? "text-blue-100" : "text-gray-400"
                }
              >
                {showTotal
                  ? `${count.toLocaleString()}/${total.toLocaleString()}`
                  : count.toLocaleString()}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
