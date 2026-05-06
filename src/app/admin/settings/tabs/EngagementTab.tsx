"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export function EngagementTab() {
  const [reconciling, setReconciling] = useState(false);
  const [reconcileMsg, setReconcileMsg] = useState<string | null>(null);

  async function handleReconcile() {
    setReconciling(true);
    setReconcileMsg(null);
    try {
      const res = await fetch("/api/admin/engagement/reconcile", {
        method: "POST",
      });
      if (!res.ok) {
        setReconcileMsg("Reconcile failed. Try again.");
        return;
      }
      const data = (await res.json()) as {
        likesUpdated: number;
        commentsUpdated: number;
      };
      setReconcileMsg(
        `Reconciled. Posts updated: ${data.likesUpdated} likes, ${data.commentsUpdated} comments.`
      );
    } finally {
      setReconciling(false);
    }
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white">
      <div className="border-b border-gray-200 px-6 py-4">
        <h2 className="text-lg font-semibold text-gray-900">Engagement counts</h2>
        <p className="text-sm text-gray-500">
          Recompute Post.likeCount and Post.commentCount from the join tables.
          Drift in practice should be tiny — every mutation does an in-mutation
          recompute. Use this if a count looks wrong on the public archive.
        </p>
      </div>
      <div className="px-6 py-4">
        <div className="flex items-center gap-3">
          <Button
            type="button"
            onClick={handleReconcile}
            disabled={reconciling}
            variant="secondary"
          >
            {reconciling ? "Reconciling…" : "Reconcile engagement counts"}
          </Button>
          {reconcileMsg && <p className="text-xs text-gray-700">{reconcileMsg}</p>}
        </div>
      </div>
    </section>
  );
}
