"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useConfirm } from "@/hooks/useConfirm";
import { RotateCcw, Trash2 } from "lucide-react";

export function TrashActions({ dir }: { dir: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"restore" | "purge" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function restore() {
    setBusy("restore");
    setError(null);
    try {
      const res = await fetch(
        `/api/trash/${encodeURIComponent(dir)}/restore`,
        { method: "POST" }
      );
      if (!res.ok) throw new Error((await res.json()).error || "Restore failed");
      router.push("/admin/trash");
      router.refresh();
    } catch (e) {
      setError(String(e));
      setBusy(null);
    }
  }

  async function purge() {
    setBusy("purge");
    setError(null);
    try {
      const res = await fetch(`/api/trash/${encodeURIComponent(dir)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error((await res.json()).error || "Purge failed");
      router.push("/admin/trash");
      router.refresh();
    } catch (e) {
      setError(String(e));
      setBusy(null);
    }
  }

  const { confirming: confirmingPurge, trigger: triggerPurge } = useConfirm(purge);

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={restore}
          disabled={busy !== null}
        >
          {busy === "restore" ? <Spinner /> : <RotateCcw className="h-4 w-4" />}
          {busy === "restore" ? "Restoring..." : "Restore all"}
        </Button>
        <Button
          size="sm"
          variant={confirmingPurge ? "outline" : "destructive"}
          onClick={triggerPurge}
          disabled={busy !== null}
          className={
            confirmingPurge ? "border-amber-400 text-amber-700 hover:bg-amber-50" : ""
          }
        >
          {busy === "purge" ? <Spinner /> : <Trash2 className="h-4 w-4" />}
          {busy === "purge"
            ? "Purging..."
            : confirmingPurge
            ? "Are you sure?"
            : "Purge"}
        </Button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
