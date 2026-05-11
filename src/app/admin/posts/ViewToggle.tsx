"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback } from "react";
import { List, Rows } from "lucide-react";
import { SegmentedControl } from "@/app/admin/_shared/SegmentedControl";

type View = "list" | "feed";

const OPTIONS = [
  { id: "list" as const, label: "List", icon: List },
  { id: "feed" as const, label: "Feed", icon: Rows },
];

export function ViewToggle() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current: View = (searchParams.get("view") ?? "list") as View;

  const setView = useCallback(
    (view: View) => {
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

  return <SegmentedControl options={OPTIONS} value={current} onChange={setView} ariaLabel="View" />;
}
