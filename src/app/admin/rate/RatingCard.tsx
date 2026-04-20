"use client";
import { useEffect, useRef, useState } from "react";
import { Trash2, Check, AlertTriangle, ChevronDown, ThumbsUp, MessageCircle, Share2, Eye } from "lucide-react";
import { StarRow } from "@/components/StarRow";
import { useSwipe } from "@/hooks/useSwipe";

const POSITIVE = ["great-photo", "strong-writing", "signature-voice", "timeless", "resonant"];
const NEGATIVE = ["too-personal", "not-me-anymore", "weak-photo", "overposted-theme", "low-energy", "outdated-reference"];
function chipsForStars(s: number): string[] {
  if (s >= 4) return POSITIVE;
  if (s <= 2) return NEGATIVE;
  return [...POSITIVE, ...NEGATIVE];
}

type Media = { id: string; mimeType: string; url?: string; thumbnailUrl?: string };
type Rating = { stars: number; reasons: string[]; note: string | null };
type Lifecycle = "EVERGREEN" | "EPHEMERAL" | "SEASONAL" | "UNKNOWN";
type Analytics = {
  reactions: number | null;
  comments: number | null;
  shares: number | null;
  reach: number | null;
  impressions: number | null;
  platform: string;
} | null;

type Post = {
  id: string;
  body: string;
  originalDate: string;
  tags: string[];
  media: Media[];
  rating: Rating | null;
  lifecycle: Lifecycle;
  readiness?: string;
  analytics?: Analytics;
};

type RatingData = { stars: number; reasons: string[]; note: string | null; lifecycle?: Lifecycle } | undefined;

export function RatingCard({
  post,
  onKeep,
  onDelete,
  onTriage,
  onSkip,
}: {
  post: Post;
  onKeep: (rd?: RatingData) => void;
  onDelete: (rd?: RatingData) => void;
  onTriage: (rd?: RatingData) => void;
  onSkip: () => void;
}) {
  const [stars, setStars] = useState<number | null>(post.rating?.stars ?? null);
  const [reasons, setReasons] = useState<string[]>(post.rating?.reasons ?? []);
  const [note, setNote] = useState(post.rating?.note ?? "");
  const [expanded, setExpanded] = useState(false);
  const [ratingOpen, setRatingOpen] = useState(false);
  const [lifecycle, setLifecycle] = useState<Lifecycle>(post.lifecycle);
  const [exiting, setExiting] = useState<"left" | "right" | null>(null);

  const cardRef = useRef<HTMLDivElement>(null);

  function getRatingData(): RatingData {
    if (stars === null) return undefined;
    return { stars, reasons, note: note || null, lifecycle };
  }

  function doAction(action: "KEEP" | "DELETE" | "TRIAGE") {
    const rd = getRatingData();
    const dir = action === "DELETE" ? "left" : action === "KEEP" ? "right" : null;
    if (dir) {
      setExiting(dir);
      setTimeout(() => {
        if (action === "KEEP") onKeep(rd);
        else onDelete(rd);
      }, 250);
    } else {
      onTriage(rd);
    }
  }

  const swipe = useSwipe(cardRef, {
    onSwipeLeft: () => doAction("DELETE"),
    onSwipeRight: () => doAction("KEEP"),
  });

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target && (e.target as HTMLElement).tagName === "TEXTAREA") return;
      if (e.key === "d" || e.key === "D" || e.key === "ArrowLeft") doAction("DELETE");
      else if (e.key === "k" || e.key === "K" || e.key === "ArrowRight") doAction("KEEP");
      else if (e.key === "t" || e.key === "T") doAction("TRIAGE");
      else if (e.key === "s" || e.key === "S") onSkip();
      else if (e.key >= "1" && e.key <= "5") {
        setStars(Number(e.key));
        if (!ratingOpen) setRatingOpen(true);
      }
      else if (e.key === "e" || e.key === "E") {
        setLifecycle((l) => (l === "EVERGREEN" ? "EPHEMERAL" : "EVERGREEN"));
        if (!ratingOpen) setRatingOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stars, reasons, note, lifecycle, ratingOpen]);

  const firstMedia = post.media[0];
  const chips = stars !== null ? chipsForStars(stars) : [];
  const toggle = (c: string) =>
    setReasons((rs) => (rs.includes(c) ? rs.filter((x) => x !== c) : [...rs, c]));

  const analytics = post.analytics;

  // Swipe visual feedback
  const swipeStyle: React.CSSProperties = exiting
    ? {
        transform: `translateX(${exiting === "left" ? "-120vw" : "120vw"})`,
        opacity: 0,
        transition: "transform 250ms ease-out, opacity 250ms ease-out",
      }
    : swipe.swiping && swipe.deltaX !== 0
    ? {
        transform: `translateX(${swipe.deltaX}px) rotate(${swipe.deltaX * 0.02}deg)`,
        transition: "none",
      }
    : { transition: "transform 200ms ease-out" };

  const swipeOverlayOpacity = Math.min(1, Math.abs(swipe.deltaX) / 150);

  return (
    <div
      ref={cardRef}
      style={swipeStyle}
      className="relative flex-1 flex flex-col w-full max-w-xl mx-auto bg-white rounded-lg shadow-sm overflow-hidden select-none"
    >
      {/* Swipe overlays */}
      {swipe.direction === "left" && (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center bg-red-500/80 rounded-lg pointer-events-none"
          style={{ opacity: swipeOverlayOpacity }}
        >
          <div className="text-white text-2xl font-bold flex items-center gap-2">
            <Trash2 className="h-8 w-8" /> DELETE
          </div>
        </div>
      )}
      {swipe.direction === "right" && (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center bg-green-500/80 rounded-lg pointer-events-none"
          style={{ opacity: swipeOverlayOpacity }}
        >
          <div className="text-white text-2xl font-bold flex items-center gap-2">
            <Check className="h-8 w-8" /> KEEP
          </div>
        </div>
      )}

      {/* Readiness badge */}
      {post.readiness && post.readiness !== "READY" && (
        <div className="absolute top-2 left-2 z-20 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white uppercase">
          {post.readiness}
        </div>
      )}

      {/* Media */}
      {firstMedia && (
        <div className="relative w-full bg-gray-200 flex items-center justify-center overflow-hidden">
          {firstMedia.mimeType.startsWith("video/") ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video
              src={firstMedia.url}
              className="block w-full max-h-[50vh] object-contain bg-gray-200"
              autoPlay
              muted
              playsInline
              loop
              controls
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={firstMedia.url ?? firstMedia.thumbnailUrl}
              alt=""
              className="block w-full max-h-[50vh] object-contain"
            />
          )}
        </div>
      )}

      <div className="p-4 flex-1 flex flex-col gap-3 text-gray-900">
        {/* Body */}
        <div className={`whitespace-pre-wrap text-sm leading-relaxed ${expanded ? "" : "line-clamp-6"}`}>
          {post.body}
        </div>
        {!expanded && post.body.split("\n").length > 6 && (
          <button className="text-xs opacity-70 self-start" onClick={() => setExpanded(true)}>
            Read more
          </button>
        )}

        {/* Date + tags */}
        <div className="flex flex-wrap gap-1 text-xs text-gray-500">
          <span>{new Date(post.originalDate).toLocaleDateString()}</span>
          {post.tags.slice(0, 6).map((t) => (
            <span key={t} className="px-1.5 py-0.5 rounded bg-gray-100">{t}</span>
          ))}
        </div>

        {/* Analytics bar */}
        {analytics && (
          <div className="flex flex-wrap gap-2">
            {analytics.reactions != null && analytics.reactions > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-600">
                <ThumbsUp className="h-3 w-3" /> {analytics.reactions}
              </span>
            )}
            {analytics.comments != null && analytics.comments > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-600">
                <MessageCircle className="h-3 w-3" /> {analytics.comments}
              </span>
            )}
            {analytics.shares != null && analytics.shares > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-600">
                <Share2 className="h-3 w-3" /> {analytics.shares}
              </span>
            )}
            {analytics.reach != null && analytics.reach > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-600">
                <Eye className="h-3 w-3" /> {analytics.reach}
              </span>
            )}
          </div>
        )}

        {/* Optional rating section — collapsible */}
        <div className="border-t border-gray-100 pt-2">
          <button
            type="button"
            onClick={() => setRatingOpen(!ratingOpen)}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors touch-manipulation"
          >
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${ratingOpen ? "rotate-180" : ""}`} />
            {ratingOpen ? "Hide rating" : "Rate this post"}
            {stars !== null && <span className="ml-1 text-amber-500">{"★".repeat(stars)}</span>}
          </button>
          {ratingOpen && (
            <div className="mt-3 space-y-3">
              <div className="flex justify-center">
                <StarRow value={stars} onChange={setStars} size="lg" />
              </div>
              <div className="flex items-center justify-center gap-2 text-xs">
                <span className="text-gray-500">Evergreen?</span>
                <button
                  type="button"
                  onClick={() => setLifecycle("EVERGREEN")}
                  className={`px-3 py-1.5 rounded-full border transition touch-manipulation ${
                    lifecycle === "EVERGREEN"
                      ? "bg-green-400 text-black border-green-400"
                      : "bg-gray-100 border-gray-300 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  Yes
                </button>
                <button
                  type="button"
                  onClick={() => setLifecycle("EPHEMERAL")}
                  className={`px-3 py-1.5 rounded-full border transition touch-manipulation ${
                    lifecycle === "EPHEMERAL"
                      ? "bg-orange-400 text-black border-orange-400"
                      : "bg-gray-100 border-gray-300 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  No
                </button>
              </div>
              {stars !== null && chips.length > 0 && (
                <div className="flex flex-wrap gap-2 justify-center">
                  {chips.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => toggle(c)}
                      className={`px-3 py-1.5 rounded-full text-xs border touch-manipulation ${
                        reasons.includes(c)
                          ? "bg-yellow-400 text-black border-yellow-400"
                          : "bg-gray-100 border-gray-300 text-gray-700 hover:bg-gray-200"
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              )}
              {stars !== null && (
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Optional note..."
                  className="w-full rounded bg-white border border-gray-200 p-2 text-sm"
                  rows={2}
                />
              )}
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="mt-auto pt-2 space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => doAction("DELETE")}
              className="flex items-center justify-center gap-1.5 py-3 rounded-lg bg-red-50 text-red-600 border border-red-200 text-sm font-medium hover:bg-red-100 transition touch-manipulation"
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </button>
            <button
              type="button"
              onClick={() => doAction("TRIAGE")}
              className="flex items-center justify-center gap-1.5 py-3 rounded-lg bg-amber-50 text-amber-600 border border-amber-200 text-sm font-medium hover:bg-amber-100 transition touch-manipulation"
            >
              <AlertTriangle className="h-4 w-4" />
              Triage
            </button>
            <button
              type="button"
              onClick={() => doAction("KEEP")}
              className="flex items-center justify-center gap-1.5 py-3 rounded-lg bg-green-50 text-green-600 border border-green-200 text-sm font-medium hover:bg-green-100 transition touch-manipulation"
            >
              <Check className="h-4 w-4" />
              Keep
            </button>
          </div>
          <div className="flex items-center justify-between text-[10px] text-gray-400 px-1">
            <span>D / ←</span>
            <button
              type="button"
              onClick={onSkip}
              className="px-3 py-1 rounded text-gray-500 hover:bg-gray-100 text-xs touch-manipulation"
            >
              Skip (S)
            </button>
            <span>K / →</span>
          </div>
        </div>
      </div>
    </div>
  );
}
