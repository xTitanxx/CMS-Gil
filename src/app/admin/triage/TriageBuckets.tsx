"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

const BUCKETS = [
  { slug: undefined, label: "Needs fixes" },
  { slug: "silent-video", label: "Silent" },
  { slug: "unchecked-audio", label: "Unchecked" },
  { slug: "empty", label: "Empty" },
  { slug: "share-only", label: "Share-only" },
  { slug: "broken-media", label: "Broken" },
  { slug: "missing-media", label: "Missing" },
  { slug: "dont-post", label: "Don't-post" },
] as const;

type BucketSlug = (typeof BUCKETS)[number]["slug"];

const RELEVANT_PARAMS = [
  "kind",
  "subKind",
  "search",
  "sort",
  "tags",
  "content",
  "audio",
  "link",
  "multiMedia",
  "tagged",
  "share",
  "quality",
  "captionQuality",
  "enriched",
];

export function TriageBuckets() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const activeBucket: BucketSlug = useMemo(() => {
    const q = searchParams.get("bucket") ?? undefined;
    return (BUCKETS.find((b) => b.slug === q)?.slug) ?? undefined;
  }, [searchParams]);

  const [counts, setCounts] = useState<{ total: number; byReason: Record<string, number> } | null>(null);

  const paramsKey = RELEVANT_PARAMS.map((k) => `${k}=${searchParams.get(k) ?? ""}`).join("&");

  useEffect(() => {
    const qs = new URLSearchParams();
    for (const k of RELEVANT_PARAMS) {
      const v = searchParams.get(k);
      if (v) qs.set(k, v);
    }
    fetch(`/api/triage/count${qs.toString() ? `?${qs}` : ""}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setCounts(j))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramsKey]);

  function selectBucket(slug: BucketSlug) {
    const params = new URLSearchParams(searchParams.toString());
    if (slug) params.set("bucket", slug);
    else params.delete("bucket");
    router.push(`${pathname}?${params.toString()}`);
  }

  function countFor(slug: BucketSlug): number {
    if (!counts) return 0;
    if (!slug) return counts.total;
    return counts.byReason[slug] ?? 0;
  }

  return (
    <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
      {BUCKETS.map(({ slug, label }) => {
        const count = countFor(slug);
        const active = activeBucket === slug;
        return (
          <button
            key={slug ?? "all"}
            onClick={() => selectBucket(slug)}
            className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
              active
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {label}
            {count > 0 && (
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                  active ? "bg-white/20 text-white" : "bg-gray-300 text-gray-700"
                }`}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
