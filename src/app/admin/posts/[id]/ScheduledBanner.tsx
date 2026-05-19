"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Clock, Loader2, XCircle } from "lucide-react";
import { SiInstagram, SiYoutube, SiTiktok, SiFacebook } from "react-icons/si";
import { FaLinkedin } from "react-icons/fa";
import { useConfirm } from "@/hooks/useConfirm";

type Platform =
  | "INSTAGRAM"
  | "LINKEDIN"
  | "YOUTUBE"
  | "TIKTOK"
  | "FACEBOOK_PAGE"
  | "FACEBOOK";

type PublishStatus = "PENDING" | "PROCESSING" | "PUBLISHED" | "FAILED" | "CANCELLED";

const PLATFORM_LABEL: Record<Platform, string> = {
  INSTAGRAM: "Instagram",
  LINKEDIN: "LinkedIn",
  YOUTUBE: "YouTube",
  TIKTOK: "TikTok",
  FACEBOOK_PAGE: "Facebook Page",
  FACEBOOK: "Facebook Personal profile",
};

function platformIcon(platform: Platform, className: string) {
  switch (platform) {
    case "INSTAGRAM":
      return <SiInstagram className={className} />;
    case "LINKEDIN":
      return <FaLinkedin className={className} />;
    case "YOUTUBE":
      return <SiYoutube className={className} />;
    case "TIKTOK":
      return <SiTiktok className={className} />;
    case "FACEBOOK_PAGE":
    case "FACEBOOK":
      return <SiFacebook className={className} />;
  }
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const isTomorrow =
    d.getFullYear() === tomorrow.getFullYear() &&
    d.getMonth() === tomorrow.getMonth() &&
    d.getDate() === tomorrow.getDate();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate();
  const timePart = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (sameDay) return `Today · ${timePart}`;
  if (isTomorrow) return `Tomorrow · ${timePart}`;
  if (isYesterday) return `Yesterday · ${timePart}`;
  const datePart = d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  return `${datePart} · ${timePart}`;
}

function relativeWhen(iso: string): { label: string; isOverdue: boolean } {
  const t = new Date(iso).getTime();
  const diffMin = Math.round((t - Date.now()) / 60_000);
  if (diffMin < 0) {
    const ago = -diffMin;
    if (ago < 60) return { label: `${ago}m overdue`, isOverdue: true };
    if (ago < 60 * 24) return { label: `${Math.round(ago / 60)}h overdue`, isOverdue: true };
    return { label: `${Math.round(ago / (60 * 24))}d overdue`, isOverdue: true };
  }
  if (diffMin < 60) return { label: `in ${diffMin || 0}m`, isOverdue: false };
  if (diffMin < 60 * 24) return { label: `in ${Math.round(diffMin / 60)}h`, isOverdue: false };
  return { label: `in ${Math.round(diffMin / (60 * 24))}d`, isOverdue: false };
}

export type ScheduledBannerEntry = {
  id: string;
  platform: Platform;
  status: PublishStatus;
  scheduledAt: string | null;
  publishedAt: string | null;
};

export type ManualSlotInfo = {
  slotId: string;
  planId: string;
  scheduledAt: string;
  // Whether a FACEBOOK publish already exists for this post — if so, the slot
  // is satisfied and we don't surface it.
  fbPublished: boolean;
};

/**
 * Single source of truth for "is this post scheduled?" on the detail page.
 * Renders nothing when the post has no pending or in-flight work; renders a
 * prominent blue/amber banner otherwise so the user immediately sees that
 * something is queued up rather than having to scroll to the Activity panel.
 */
export function ScheduledBanner({
  publishes,
  manualSlot,
}: {
  publishes: ScheduledBannerEntry[];
  manualSlot: ManualSlotInfo | null;
}) {
  const router = useRouter();
  const [cancelling, setCancelling] = useState(false);

  // PROCESSING beats PENDING for "what's happening right now" — surface those
  // separately so the user sees the live upload state instead of a stale
  // "scheduled" message while the lambda is mid-upload.
  const processing = publishes.filter((p) => p.status === "PROCESSING");
  const pending = publishes
    .filter((p) => p.status === "PENDING")
    .sort((a, b) => (a.scheduledAt ?? "").localeCompare(b.scheduledAt ?? ""));

  const showManualSlot =
    !!manualSlot && !manualSlot.fbPublished && new Date(manualSlot.scheduledAt).getTime() > 0;

  const cancelTargetIds = useMemo(
    () => [...processing.map((p) => p.id), ...pending.map((p) => p.id)],
    [processing, pending],
  );

  const handleCancel = useCallback(async () => {
    setCancelling(true);
    try {
      // Cancel each in-flight/pending PublishRecord. Done in parallel — the
      // cancel endpoint is idempotent enough that ordering doesn't matter.
      await Promise.all(
        cancelTargetIds.map((id) =>
          fetch(`/api/publish/${id}/cancel`, { method: "POST" }).catch(() => null),
        ),
      );
      // Then remove the planner slot (if any) so the manual-FB queue + planner
      // status reflect reality. The planner handler also sweeps any leftover
      // PENDING records for the slot's platforms, which covers slots whose
      // records weren't surfaced in `publishes` for some reason.
      if (manualSlot) {
        await fetch(`/api/planner/${manualSlot.planId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "remove", slotId: manualSlot.slotId }),
        }).catch(() => null);
      }
      router.refresh();
    } finally {
      setCancelling(false);
    }
  }, [cancelTargetIds, manualSlot, router]);

  const { confirming, trigger } = useConfirm(handleCancel);

  if (processing.length === 0 && pending.length === 0 && !showManualSlot) return null;

  if (processing.length > 0) {
    return (
      <div className="overflow-hidden rounded-2xl border border-blue-200 bg-blue-50 shadow-sm">
        <div className="flex items-start gap-3 px-4 py-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-100">
            <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-blue-900">Publishing now…</p>
            <p className="text-[12px] text-blue-800">
              {processing.map((p) => PLATFORM_LABEL[p.platform]).join(" · ")}
            </p>
            {cancelTargetIds.length > 0 && (
              <div className="mt-2">
                <CancelButton
                  variant="blue"
                  confirming={confirming}
                  cancelling={cancelling}
                  onClick={trigger}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  const nextWhen =
    pending[0]?.scheduledAt ?? manualSlot?.scheduledAt ?? null;
  const relative = nextWhen ? relativeWhen(nextWhen) : null;
  // Only flag overdue when the slot the user controls is past due — auto-
  // scheduled publishes fire within seconds of `scheduledAt`, so a "PENDING"
  // record a minute past its time is normal lambda lag, not user-actionable.
  // Manual FB slots, on the other hand, sit there until the user posts them.
  const isOverdue = !!relative?.isOverdue && showManualSlot;

  const containerClasses = isOverdue
    ? "overflow-hidden rounded-2xl border border-red-200 bg-red-50 shadow-sm"
    : "overflow-hidden rounded-2xl border border-amber-200 bg-amber-50 shadow-sm";
  const iconBubbleClasses = isOverdue ? "bg-red-100" : "bg-amber-100";
  const iconClasses = isOverdue ? "text-red-700" : "text-amber-700";
  const titleClasses = isOverdue ? "text-red-900" : "text-amber-900";
  const relPillClasses = isOverdue
    ? "bg-red-100 text-red-800 ring-red-200"
    : "bg-amber-100 text-amber-800 ring-amber-200";
  const autoChipClasses = isOverdue
    ? "inline-flex min-w-0 items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-red-900 ring-1 ring-inset ring-red-200"
    : "inline-flex min-w-0 items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-amber-900 ring-1 ring-inset ring-amber-200";

  const canCancel = cancelTargetIds.length > 0 || !!manualSlot;
  const variant: CancelVariant = isOverdue ? "red" : "amber";

  return (
    <div className={containerClasses}>
      <div className="flex items-start gap-3 px-4 py-3">
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${iconBubbleClasses}`}>
          {isOverdue ? (
            <AlertTriangle className={`h-4 w-4 ${iconClasses}`} />
          ) : (
            <Clock className={`h-4 w-4 ${iconClasses}`} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <p className={`min-w-0 break-words text-[13px] font-semibold ${titleClasses}`}>
              {isOverdue ? "Overdue" : "Scheduled"}
              {nextWhen ? ` — ${formatWhen(nextWhen)}` : ""}
            </p>
            {relative && (
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset ${relPillClasses}`}
              >
                {relative.label}
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {pending.map((p) => (
              <span
                key={`auto-${p.platform}`}
                className={autoChipClasses}
              >
                {platformIcon(p.platform, "h-3 w-3 shrink-0")}
                <span className="truncate">{PLATFORM_LABEL[p.platform]}</span>
              </span>
            ))}
            {showManualSlot && (
              <span
                className={`inline-flex min-w-0 items-center gap-1 rounded-full border border-dashed bg-white px-2 py-0.5 text-[11px] font-medium ${
                  isOverdue ? "border-red-400 text-red-700" : "border-blue-400 text-blue-700"
                }`}
                title="Facebook Personal profile — you'll cross-post this manually"
              >
                <SiFacebook className="h-3 w-3 shrink-0" />
                <span className="truncate">Facebook Personal</span>
                <span
                  className={`ml-0.5 shrink-0 rounded-sm px-1 py-px text-[8px] font-bold uppercase tracking-wider ring-1 ring-inset ${
                    isOverdue
                      ? "bg-red-50 text-red-700 ring-red-200"
                      : "bg-blue-50 text-blue-700 ring-blue-200"
                  }`}
                >
                  Manual
                </span>
              </span>
            )}
          </div>
          {canCancel && (
            <div className="mt-2">
              <CancelButton
                variant={variant}
                confirming={confirming}
                cancelling={cancelling}
                onClick={trigger}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

type CancelVariant = "amber" | "red" | "blue";

function CancelButton({
  variant,
  confirming,
  cancelling,
  onClick,
}: {
  variant: CancelVariant;
  confirming: boolean;
  cancelling: boolean;
  onClick: () => void;
}) {
  // Idle / confirm / loading styles per banner tone. Idle is a quiet outline on
  // the banner's own background so it doesn't shout; confirm flips to a filled
  // red to make the second click obvious.
  const idle =
    variant === "red"
      ? "border-red-300 bg-white text-red-700 hover:border-red-400 hover:bg-red-100"
      : variant === "amber"
        ? "border-amber-300 bg-white text-amber-800 hover:border-amber-400 hover:bg-amber-100"
        : "border-blue-300 bg-white text-blue-700 hover:border-blue-400 hover:bg-blue-100";
  const confirm = "border-red-500 bg-red-600 text-white hover:bg-red-700";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={cancelling}
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${
        confirming ? confirm : idle
      }`}
    >
      {cancelling ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <XCircle className="h-3 w-3" />
      )}
      {cancelling
        ? "Cancelling…"
        : confirming
          ? "Click again to confirm"
          : "Cancel schedule"}
    </button>
  );
}
