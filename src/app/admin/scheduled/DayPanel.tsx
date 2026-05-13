"use client";

import Link from "next/link";
import { useState } from "react";
import { format } from "date-fns";
import { X, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CalendarEntry } from "./types";
import { PlatformIcons } from "./PlatformIcons";

interface Props {
  day: Date;
  entries: CalendarEntry[];
  onClose: () => void;
  onScheduled: () => void;
}

export function DayPanel({ day, entries, onClose, onScheduled }: Props) {
  const [cancelling, setCancelling] = useState<Set<string>>(() => new Set());

  async function cancelEntry(ids: string[]) {
    const tag = ids.join(",");
    setCancelling((prev) => {
      const next = new Set(prev);
      next.add(tag);
      return next;
    });
    try {
      await Promise.all(
        ids.map((id) => fetch(`/api/publish/${id}/cancel`, { method: "POST" })),
      );
      onScheduled();
    } finally {
      setCancelling((prev) => {
        const next = new Set(prev);
        next.delete(tag);
        return next;
      });
    }
  }

  return (
    <div className="flex h-full w-80 flex-shrink-0 flex-col border-l border-gray-200 bg-white">
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-gray-900">
            {format(day, "EEEE")}
          </div>
          <div className="text-xs text-gray-500">
            {format(day, "MMMM d, yyyy")}
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {entries.length === 0 ? (
          <div className="pt-6 text-center text-sm text-gray-500">
            No posts on this day
          </div>
        ) : (
          entries.map((e, i) => {
            const cancellable =
              e.status === "PENDING" &&
              e.publishRecordIds &&
              e.publishRecordIds.length > 0;
            const tag = cancellable ? e.publishRecordIds!.join(",") : "";
            const isCancelling = cancellable && cancelling.has(tag);
            return (
              <div
                key={`${e.postId}-${e.status}-${i}`}
                className="rounded-lg border border-gray-200 transition-colors hover:bg-gray-50"
              >
                <Link
                  href={`/admin/posts/${e.postId}`}
                  className="flex gap-3 p-2"
                >
                  <div className="h-14 w-14 flex-shrink-0 overflow-hidden rounded bg-gray-100">
                    {e.thumbUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={e.thumbUrl}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {e.platforms.length > 0 ? (
                        <PlatformIcons platforms={e.platforms} size={14} />
                      ) : null}
                      <span
                        className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusBadge(e.status)}`}
                      >
                        {e.platforms.length > 0
                          ? e.status
                          : e.status === "PROPOSED"
                            ? "Proposed"
                            : e.status === "PLAN_APPROVED"
                              ? "Approved"
                              : "Imported"}
                      </span>
                      {e.time && (
                        <span className="text-[11px] font-medium text-gray-600">{e.time}</span>
                      )}
                    </div>
                    <div className="mt-1 line-clamp-3 break-words text-xs text-gray-700">
                      {e.body || "(no caption)"}
                    </div>
                  </div>
                </Link>
                {cancellable && (
                  <div className="border-t border-gray-100 px-2 py-1.5">
                    <button
                      type="button"
                      onClick={() => cancelEntry(e.publishRecordIds!)}
                      disabled={isCancelling}
                      className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-600 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <XCircle className="h-3 w-3" />
                      {isCancelling ? "Cancelling…" : "Cancel scheduling"}
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function statusBadge(status: CalendarEntry["status"]): string {
  switch (status) {
    case "PUBLISHED":
      return "bg-green-100 text-green-800";
    case "PENDING":
      return "bg-yellow-100 text-yellow-800";
    case "IMPORTED":
      return "bg-gray-100 text-gray-700";
    case "PROPOSED":
      return "border border-dashed border-gray-400 bg-white text-gray-500";
    case "PLAN_APPROVED":
      return "border border-blue-400 bg-blue-50 text-blue-800";
  }
}
