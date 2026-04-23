"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";

export function AnalyticsRefreshButton({ postId }: { postId: string }) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function refresh() {
    setLoading(true);
    try {
      await fetch(`/api/posts/${postId}/analytics`, { method: "POST" });
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={refresh}
      disabled={loading}
      className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50"
    >
      <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
      {loading ? "Refreshing..." : "Refresh analytics"}
    </button>
  );
}
