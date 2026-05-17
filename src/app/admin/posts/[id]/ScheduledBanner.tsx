import { Clock, Loader2 } from "lucide-react";
import { SiInstagram, SiYoutube, SiTiktok, SiFacebook } from "react-icons/si";
import { FaLinkedin } from "react-icons/fa";

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
  const timePart = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (sameDay) return `Today · ${timePart}`;
  if (isTomorrow) return `Tomorrow · ${timePart}`;
  const datePart = d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  return `${datePart} · ${timePart}`;
}

export type ScheduledBannerEntry = {
  platform: Platform;
  status: PublishStatus;
  scheduledAt: string | null;
  publishedAt: string | null;
};

export type ManualSlotInfo = {
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
  // PROCESSING beats PENDING for "what's happening right now" — surface those
  // separately so the user sees the live upload state instead of a stale
  // "scheduled" message while the lambda is mid-upload.
  const processing = publishes.filter((p) => p.status === "PROCESSING");
  const pending = publishes
    .filter((p) => p.status === "PENDING")
    .sort((a, b) => (a.scheduledAt ?? "").localeCompare(b.scheduledAt ?? ""));

  const showManualSlot =
    !!manualSlot && !manualSlot.fbPublished && new Date(manualSlot.scheduledAt).getTime() > 0;

  if (processing.length === 0 && pending.length === 0 && !showManualSlot) return null;

  if (processing.length > 0) {
    return (
      <div className="overflow-hidden rounded-2xl border border-blue-200 bg-blue-50 shadow-sm">
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-100">
            <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-blue-900">Publishing now…</p>
            <p className="text-[12px] text-blue-800">
              {processing.map((p) => PLATFORM_LABEL[p.platform]).join(" · ")}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const nextWhen =
    pending[0]?.scheduledAt ?? manualSlot?.scheduledAt ?? null;

  return (
    <div className="overflow-hidden rounded-2xl border border-amber-200 bg-amber-50 shadow-sm">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100">
          <Clock className="h-4 w-4 text-amber-700" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-amber-900">
            Scheduled{nextWhen ? ` — ${formatWhen(nextWhen)}` : ""}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {pending.map((p) => (
              <span
                key={`auto-${p.platform}`}
                className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-amber-900 ring-1 ring-inset ring-amber-200"
              >
                {platformIcon(p.platform, "h-3 w-3")}
                {PLATFORM_LABEL[p.platform]}
              </span>
            ))}
            {showManualSlot && (
              <span
                className="inline-flex items-center gap-1 rounded-full border border-dashed border-blue-400 bg-white px-2 py-0.5 text-[11px] font-medium text-blue-700"
                title="Facebook Personal profile — you'll cross-post this manually"
              >
                <SiFacebook className="h-3 w-3" />
                Facebook Personal
                <span className="ml-0.5 rounded-sm bg-blue-50 px-1 py-px text-[8px] font-bold uppercase tracking-wider text-blue-700 ring-1 ring-inset ring-blue-200">
                  Manual
                </span>
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
