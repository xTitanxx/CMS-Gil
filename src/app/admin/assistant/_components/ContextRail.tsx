"use client";
import { useEffect, useState } from "react";
import { PostCard } from "./PostCard";

interface BriefPayloadItem {
  postId: string;
  reasons?: string[];
  score?: number;
}

export function ContextRail() {
  const [brief, setBrief] = useState<{ payload: BriefPayloadItem[] } | null>(null);

  useEffect(() => {
    fetch("/api/assistant/brief")
      .then((r) => r.json())
      .then((d) => {
        if (d.brief) setBrief(d.brief as { payload: BriefPayloadItem[] });
      })
      .catch(() => { /* no brief yet is fine */ });
  }, []);

  return (
    <aside className="border-r p-3 w-72 hidden lg:block">
      <h2 className="text-sm font-semibold mb-2">Today's brief</h2>
      {!brief && (
        <p className="text-xs text-gray-500">
          No brief yet — check back in the morning.
        </p>
      )}
      {brief && (
        <div className="space-y-2">
          {brief.payload.map((p) => (
            <PostCard key={p.postId} data={{ postId: p.postId, reasons: p.reasons }} />
          ))}
        </div>
      )}
    </aside>
  );
}
