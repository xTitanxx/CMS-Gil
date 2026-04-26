"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback } from "react";
import { List, Rows } from "lucide-react";

export function ViewToggle() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = (searchParams.get("view") ?? "list") as "list" | "feed";

  const setView = useCallback(
    (view: "list" | "feed") => {
      const next = new URLSearchParams(searchParams.toString());
      if (view === "list") {
        next.delete("view");
      } else {
        next.set("view", view);
      }
      const qs = next.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [router, pathname, searchParams],
  );

  const base =
    "inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium transition-colors";

  return (
    <div
      className="inline-flex overflow-hidden rounded-md border border-gray-200 bg-white"
      role="group"
      aria-label="View"
    >
      <button
        type="button"
        onClick={() => setView("list")}
        className={`${base} ${
          current === "list"
            ? "bg-gray-900 text-white"
            : "text-gray-600 hover:bg-gray-50"
        }`}
        aria-pressed={current === "list"}
      >
        <List className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">List</span>
      </button>
      <button
        type="button"
        onClick={() => setView("feed")}
        className={`${base} border-l border-gray-200 ${
          current === "feed"
            ? "bg-gray-900 text-white"
            : "text-gray-600 hover:bg-gray-50"
        }`}
        aria-pressed={current === "feed"}
      >
        <Rows className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Feed</span>
      </button>
    </div>
  );
}
