"use client";

import { useState, useMemo, useTransition } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { Check, X, RotateCcw, Play, Image as ImageIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { displayBody } from "@/lib/post-body";

type Decision = "pending" | "approve" | "reject";

interface Drop {
  id: string;
  body: string;
  originalDate: string;
  mimeType: string | null;
  thumbUrl: string | null;
  confidence: number;
  reason: string;
  decision: Decision;
}

interface Group {
  id: string;
  keep: {
    id: string;
    body: string;
    originalDate: string;
    mimeType: string | null;
    thumbUrl: string | null;
  };
  drops: Drop[];
}

export function ReviewClient({
  dir,
  createdAt,
  groups: initial,
}: {
  dir: string;
  createdAt: string;
  groups: Group[];
}) {
  const [groups, setGroups] = useState<Group[]>(initial);
  const [isPending, startTransition] = useTransition();
  const [flash, setFlash] = useState<string | null>(null);

  const counts = useMemo(() => {
    let pending = 0;
    let approved = 0;
    let rejected = 0;
    for (const g of groups) {
      for (const d of g.drops) {
        if (d.decision === "pending") pending++;
        else if (d.decision === "approve") approved++;
        else rejected++;
      }
    }
    return { pending, approved, rejected };
  }, [groups]);

  function setDecision(dropId: string, decision: Decision) {
    setGroups((prev) =>
      prev.map((g) => ({
        ...g,
        drops: g.drops.map((d) => (d.id === dropId ? { ...d, decision } : d)),
      })),
    );
    // Persist single decision best-effort; don't block UI.
    fetch(`/api/trash/review/${encodeURIComponent(dir)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "decide",
        decisions: [{ dropId, decision }],
      }),
    }).catch(() => {});
  }

  function bulkDecideGroup(groupId: string, decision: Decision) {
    const target = groups.find((g) => g.id === groupId);
    if (!target) return;
    const pending = target.drops.filter((d) => d.decision === "pending");
    if (pending.length === 0) return;
    setGroups((prev) =>
      prev.map((g) =>
        g.id === groupId
          ? {
              ...g,
              drops: g.drops.map((d) =>
                d.decision === "pending" ? { ...d, decision } : d,
              ),
            }
          : g,
      ),
    );
    fetch(`/api/trash/review/${encodeURIComponent(dir)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "decide",
        decisions: pending.map((d) => ({ dropId: d.id, decision })),
      }),
    }).catch(() => {});
  }

  function bulkApproveHighConf() {
    const pending = groups.flatMap((g) =>
      g.drops.filter(
        (d) => d.decision === "pending" && d.confidence >= 0.95,
      ),
    );
    if (pending.length === 0) return;
    setGroups((prev) =>
      prev.map((g) => ({
        ...g,
        drops: g.drops.map((d) =>
          d.decision === "pending" && d.confidence >= 0.95
            ? { ...d, decision: "approve" }
            : d,
        ),
      })),
    );
    fetch(`/api/trash/review/${encodeURIComponent(dir)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "decide",
        decisions: pending.map((d) => ({
          dropId: d.id,
          decision: "approve" as const,
        })),
      }),
    }).catch(() => {});
    setFlash(`Approved ${pending.length} high-confidence drops.`);
  }

  function finalize() {
    if (counts.approved === 0) {
      setFlash("Nothing approved to finalize.");
      return;
    }
    if (
      !confirm(
        `Trash ${counts.approved} approved post(s)? This deletes them from the DB (reversible via /admin/trash).`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const res = await fetch(
        `/api/trash/review/${encodeURIComponent(dir)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "finalize" }),
        },
      );
      const data = await res.json();
      if (data.trashDir) {
        setFlash(
          `Trashed ${data.trashedCount} post(s) across ${data.groupCount} group(s). Open /admin/trash to review.`,
        );
        // Remove approved groups from the UI.
        setGroups((prev) =>
          prev
            .map((g) => ({
              ...g,
              drops: g.drops.filter((d) => d.decision === "pending"),
            }))
            .filter((g) => g.drops.length > 0),
        );
      } else {
        setFlash("Nothing finalized.");
      }
    });
  }

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">
            Review · {format(new Date(createdAt), "MMM d, HH:mm")}
          </h1>
          <p className="text-sm text-gray-500">
            {counts.pending} pending · {counts.approved} approved ·{" "}
            {counts.rejected} rejected
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/trash/review"
            className="text-sm text-blue-600 hover:underline"
          >
            ← back
          </Link>
          <button
            type="button"
            onClick={bulkApproveHighConf}
            disabled={isPending}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Approve all ≥0.95
          </button>
          <button
            type="button"
            onClick={finalize}
            disabled={isPending || counts.approved === 0}
            className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending
              ? "Finalizing…"
              : `Finalize & trash (${counts.approved})`}
          </button>
        </div>
      </div>

      {flash && (
        <div className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-800">
          {flash}
        </div>
      )}

      {groups.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-gray-200 py-16 text-center text-gray-500">
          <p>Nothing left to review.</p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pb-8">
          {groups.map((g) => (
            <section
              key={g.id}
              className="rounded-lg border border-gray-200 bg-white"
            >
              <header className="flex items-center justify-between border-b border-gray-100 px-4 py-2 text-xs text-gray-500">
                <span>
                  group {g.id} · {g.drops.length + 1} post
                  {g.drops.length === 0 ? "" : "s"}
                </span>
                {g.drops.some((d) => d.decision === "pending") && (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => bulkDecideGroup(g.id, "approve")}
                      className="rounded border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-red-700 hover:bg-red-100"
                      title="Trash every remaining pending drop in this group"
                    >
                      Trash all {g.drops.filter((d) => d.decision === "pending").length}
                    </button>
                    <button
                      type="button"
                      onClick={() => bulkDecideGroup(g.id, "reject")}
                      className="rounded border border-gray-200 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gray-600 hover:bg-gray-50"
                      title="Keep every remaining pending drop in this group"
                    >
                      Keep all
                    </button>
                  </div>
                )}
              </header>

              <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,2fr)] items-start gap-4 p-4">
                <PostCard
                  role="keep"
                  thumbUrl={g.keep.thumbUrl}
                  mimeType={g.keep.mimeType}
                  body={g.keep.body}
                  originalDate={g.keep.originalDate}
                  postId={g.keep.id}
                />

                <div className="self-center text-xs font-semibold uppercase tracking-wider text-gray-400">
                  vs
                </div>

                <div className="space-y-3">
                  {g.drops.map((d) => (
                    <div
                      key={d.id}
                      className="flex items-stretch gap-3 rounded-md border border-gray-100 p-2"
                    >
                      <div className="flex-1">
                        <PostCard
                          role="drop"
                          thumbUrl={d.thumbUrl}
                          mimeType={d.mimeType}
                          body={d.body}
                          originalDate={d.originalDate}
                          postId={d.id}
                        />
                        <p className="mt-2 text-[11px] leading-snug text-gray-500">
                          <Badge variant="outline" className="mr-1 text-[10px]">
                            conf {d.confidence.toFixed(2)}
                          </Badge>
                          {d.reason}
                        </p>
                      </div>
                      <div className="flex flex-col items-stretch justify-center gap-1">
                        <DecisionButton
                          active={d.decision === "approve"}
                          onClick={() => setDecision(d.id, "approve")}
                          tone="approve"
                          icon={<Check className="h-4 w-4" />}
                          label="Trash"
                        />
                        <DecisionButton
                          active={d.decision === "reject"}
                          onClick={() => setDecision(d.id, "reject")}
                          tone="reject"
                          icon={<X className="h-4 w-4" />}
                          label="Keep"
                        />
                        {d.decision !== "pending" && (
                          <button
                            type="button"
                            onClick={() => setDecision(d.id, "pending")}
                            className="flex items-center justify-center gap-1 rounded px-2 py-1 text-[10px] text-gray-400 hover:bg-gray-50 hover:text-gray-600"
                          >
                            <RotateCcw className="h-3 w-3" />
                            undo
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function PostCard({
  role,
  thumbUrl,
  mimeType,
  body,
  originalDate,
  postId,
}: {
  role: "keep" | "drop";
  thumbUrl: string | null;
  mimeType: string | null;
  body: string;
  originalDate: string;
  postId: string;
}) {
  const text = displayBody(body);
  const isVideo = mimeType?.startsWith("video");
  const ring =
    role === "keep"
      ? "ring-2 ring-green-400"
      : "ring-1 ring-gray-200";
  return (
    <div className="flex gap-3">
      <div
        className={`relative h-32 w-32 flex-shrink-0 overflow-hidden rounded-md bg-gray-100 ${ring}`}
      >
        {thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbUrl}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <ImageIcon className="h-6 w-6 text-gray-300" />
          </div>
        )}
        {isVideo && thumbUrl && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/20">
            <Play className="h-6 w-6 fill-white text-white drop-shadow" />
          </div>
        )}
        {role === "keep" && (
          <span className="absolute left-1 top-1 rounded bg-green-500 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">
            Keep
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[11px] text-gray-400">
          <span>{format(new Date(originalDate), "MMM d, yyyy HH:mm")}</span>
          <Link
            href={`/admin/posts/${postId}`}
            target="_blank"
            rel="noopener"
            className="text-blue-600 hover:underline"
          >
            open ↗
          </Link>
        </div>
        {text ? (
          <p className="mt-1 line-clamp-4 text-sm text-gray-700">{text}</p>
        ) : (
          <p className="mt-1 text-sm italic text-gray-400">No caption</p>
        )}
      </div>
    </div>
  );
}

function DecisionButton({
  active,
  onClick,
  tone,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  tone: "approve" | "reject";
  icon: React.ReactNode;
  label: string;
}) {
  const activeCls =
    tone === "approve"
      ? "bg-red-600 text-white border-red-600 hover:bg-red-700"
      : "bg-gray-900 text-white border-gray-900 hover:bg-gray-800";
  const idleCls =
    tone === "approve"
      ? "border-red-200 bg-white text-red-700 hover:bg-red-50"
      : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center justify-center gap-1 rounded border px-2 py-1 text-[11px] font-semibold transition-colors ${active ? activeCls : idleCls}`}
    >
      {icon}
      {label}
    </button>
  );
}
