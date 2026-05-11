"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { buildInviteMessage } from "../inviteMessage";

interface Subscriber {
  id: string;
  name: string;
  email: string | null;
  displayName: string | null;
  monthlyBudgetUsd: number;
  cycleUsedUsd: number;
  cycleStart: string;
  createdAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
  commentsDisabledAt: string | null;
}

interface Props {
  subscriber: Subscriber;
  pct: number;
  lifetimeSpend: number;
  lifetimeTurns: number;
}

export function SubscriberDetailHeader({
  subscriber,
  pct,
  lifetimeSpend,
  lifetimeTurns,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [generated, setGenerated] = useState<string | null>(null);
  const [budgetDraft, setBudgetDraft] = useState<string>(
    subscriber.monthlyBudgetUsd.toFixed(2)
  );
  const [savingBudget, setSavingBudget] = useState(false);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/subscribers/${subscriber.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke() {
    const revoking = !subscriber.revokedAt;
    if (
      revoking &&
      !confirm(
        `Revoke ${subscriber.name}? Their code stops working immediately.`
      )
    )
      return;
    await patch({ revoked: revoking });
  }

  async function handleToggleComments() {
    await patch({ commentsDisabled: !subscriber.commentsDisabledAt });
  }

  async function handleSaveBudget(e: React.FormEvent) {
    e.preventDefault();
    const value = Number(budgetDraft);
    if (!Number.isFinite(value) || value < 0) return;
    setSavingBudget(true);
    try {
      const res = await fetch(`/api/admin/subscribers/${subscriber.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monthlyBudgetUsd: value }),
      });
      if (res.ok) router.refresh();
    } finally {
      setSavingBudget(false);
    }
  }

  async function handleRegenerate() {
    if (
      !confirm(
        `Regenerate code for ${subscriber.name}? The old code will stop working.`
      )
    )
      return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/admin/subscribers/${subscriber.id}/regenerate-code`,
        { method: "POST" }
      );
      if (res.ok) {
        const { code } = await res.json();
        setGenerated(code);
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (
      !confirm(
        `Delete ${subscriber.name}? Their chat history, bookmarks, and comments will also be deleted.`
      )
    )
      return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/subscribers/${subscriber.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        window.location.href = "/admin/subscribers";
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <h1 className="text-xl font-bold text-gray-900">{subscriber.name}</h1>
            {subscriber.revokedAt ? (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                Revoked
              </span>
            ) : (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                Active
              </span>
            )}
            {subscriber.commentsDisabledAt && (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                Comments off
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-gray-600">
            {subscriber.email ?? <span className="italic">No email on file</span>}
          </p>
          <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-500">
            <div>
              <dt className="inline">Created:</dt>{" "}
              <dd className="inline text-gray-700">
                {new Date(subscriber.createdAt).toLocaleDateString()}
              </dd>
            </div>
            <div>
              <dt className="inline">Last seen:</dt>{" "}
              <dd className="inline text-gray-700">
                {subscriber.lastSeenAt
                  ? new Date(subscriber.lastSeenAt).toLocaleString()
                  : "never"}
              </dd>
            </div>
            <div>
              <dt className="inline">Cycle started:</dt>{" "}
              <dd className="inline text-gray-700">
                {new Date(subscriber.cycleStart).toLocaleDateString()}
              </dd>
            </div>
          </dl>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleRegenerate}
            disabled={busy}
          >
            Regenerate code
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleToggleComments}
            disabled={busy}
          >
            {subscriber.commentsDisabledAt ? "Allow comments" : "Block comments"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleRevoke}
            disabled={busy}
          >
            {subscriber.revokedAt ? "Restore" : "Revoke"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleDelete}
            disabled={busy}
            className="text-red-600 hover:text-red-700"
          >
            Delete
          </Button>
        </div>
      </div>

      {generated && (
        <div className="mt-4 rounded border border-emerald-300 bg-emerald-50 p-3 text-sm">
          <div className="flex items-start gap-4">
            <div className="flex-1">
              <p className="mb-2 text-xs text-gray-600">
                New code:{" "}
                <code className="rounded bg-white px-2 py-0.5 font-mono text-sm">
                  {generated}
                </code>
                {" "}— old code no longer works.
              </p>
              <pre className="whitespace-pre-wrap rounded border border-emerald-200 bg-white p-2 font-mono text-xs leading-relaxed text-gray-800">
                {buildInviteMessage(subscriber.name, generated)}
              </pre>
            </div>
            <div className="flex shrink-0 flex-col gap-2">
              <button
                type="button"
                onClick={() =>
                  navigator.clipboard.writeText(
                    buildInviteMessage(subscriber.name, generated)
                  )
                }
                className="rounded bg-emerald-600 px-3 py-1.5 text-xs text-white hover:bg-emerald-700"
              >
                Copy message
              </button>
              <button
                type="button"
                className="text-xs text-gray-500 hover:underline"
                onClick={() => setGenerated(null)}
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-500">
            This cycle
          </p>
          <p className="mt-1 text-lg font-semibold text-gray-900">
            ${subscriber.cycleUsedUsd.toFixed(2)}{" "}
            <span className="text-sm font-normal text-gray-500">
              / ${subscriber.monthlyBudgetUsd.toFixed(2)}
            </span>
          </p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-100">
            <div
              className={
                pct >= 100
                  ? "h-full bg-red-500"
                  : pct >= 80
                  ? "h-full bg-amber-500"
                  : "h-full bg-emerald-500"
              }
              style={{ width: `${Math.min(100, pct)}%` }}
            />
          </div>
          <form onSubmit={handleSaveBudget} className="mt-3 flex items-end gap-2">
            <div>
              <label className="block text-xs text-gray-500">Monthly budget</label>
              <input
                value={budgetDraft}
                onChange={(e) => setBudgetDraft(e.target.value)}
                inputMode="decimal"
                className="mt-0.5 w-28 rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <Button
              type="submit"
              size="sm"
              variant="secondary"
              disabled={
                savingBudget ||
                Number(budgetDraft) === subscriber.monthlyBudgetUsd
              }
            >
              {savingBudget ? "Saving…" : "Save"}
            </Button>
          </form>
        </div>

        <div>
          <p className="text-xs uppercase tracking-wide text-gray-500">Lifetime</p>
          <p className="mt-1 text-lg font-semibold text-gray-900">
            ${lifetimeSpend.toFixed(2)}
          </p>
          <p className="text-xs text-gray-500">
            across {lifetimeTurns.toLocaleString()} chat turn
            {lifetimeTurns === 1 ? "" : "s"}
          </p>
        </div>
      </div>
    </section>
  );
}
