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
  { slug: "skipped-in-suggester", label: "Skipped" },
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
    <div className="-mx-4 overflow-x-auto px-4 scrollbar-hide md:mx-0 md:px-0">
      <div className="mb-4 flex w-max items-center gap-1.5 pb-0.5">
        {BUCKETS.map(({ slug, label }) => {
          const count = countFor(slug);
          const active = activeBucket === slug;
          return (
            <button
              key={slug ?? "all"}
              onClick={() => selectBucket(slug)}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                active
                  ? "border-gray-900 bg-gray-900 text-white"
                  : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50"
              }`}
            >
              {label}
              {count > 0 && (
                <span className={`tabular-nums ${active ? "text-gray-300" : "text-gray-400"}`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
