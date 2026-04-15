"use client";
import { useEffect, useState } from "react";
import { StarRow } from "@/components/StarRow";

const POSITIVE = ["great-photo","strong-writing","signature-voice","timeless","resonant"];
const NEGATIVE = ["too-personal","not-me-anymore","weak-photo","overposted-theme","low-energy","outdated-reference"];
function chipsForStars(s: number): string[] {
  if (s >= 4) return POSITIVE;
  if (s <= 2) return NEGATIVE;
  return [...POSITIVE, ...NEGATIVE];
}

type Media = { id: string; mimeType: string; url?: string; thumbnailUrl?: string };
type Rating = { stars: number; reasons: string[]; note: string | null };
type Lifecycle = "EVERGREEN" | "EPHEMERAL" | "SEASONAL" | "UNKNOWN";
type Post = {
  id: string;
  body: string;
  originalDate: string;
  tags: string[];
  media: Media[];
  rating: Rating | null;
  lifecycle: Lifecycle;
};

export function RatingCard({
  post,
  onSave,
  onSkip,
}: {
  post: Post;
  onSave: (v: { stars: number; reasons: string[]; note: string | null }) => void;
  onSkip: () => void;
}) {
  const [stars, setStars] = useState<number | null>(post.rating?.stars ?? null);
  const [reasons, setReasons] = useState<string[]>(post.rating?.reasons ?? []);
  const [noteOpen, setNoteOpen] = useState(!!post.rating?.note);
  const [note, setNote] = useState(post.rating?.note ?? "");
  const [expanded, setExpanded] = useState(false);
  const [lifecycle, setLifecycle] = useState<Lifecycle>(post.lifecycle);
  const [savingLifecycle, setSavingLifecycle] = useState(false);

  async function setEvergreen(next: "EVERGREEN" | "EPHEMERAL") {
    if (savingLifecycle || lifecycle === next) return;
    setSavingLifecycle(true);
    const prev = lifecycle;
    setLifecycle(next);
    try {
      const res = await fetch(`/api/posts/${post.id}/lifecycle`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lifecycle: next, season: null }),
      });
      if (!res.ok) setLifecycle(prev);
    } catch {
      setLifecycle(prev);
    } finally {
      setSavingLifecycle(false);
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target && (e.target as HTMLElement).tagName === "TEXTAREA") return;
      if (e.key >= "1" && e.key <= "5") setStars(Number(e.key));
      else if (e.key === " ") { e.preventDefault(); if (stars) onSave({ stars, reasons, note: note || null }); }
      else if (e.key.toLowerCase() === "s") onSkip();
      else if (e.key.toLowerCase() === "n") setNoteOpen((v) => !v);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stars, reasons, note, onSave, onSkip]);

  const firstMedia = post.media[0];
  const chips = stars !== null ? chipsForStars(stars) : [];
  const toggle = (c: string) =>
    setReasons((rs) => (rs.includes(c) ? rs.filter((x) => x !== c) : [...rs, c]));

  return (
    <div className="flex-1 flex flex-col w-full max-w-xl mx-auto">
      {firstMedia && (
        <div className="relative w-full bg-gray-900 flex items-center justify-center overflow-hidden">
          {firstMedia.mimeType.startsWith("video/") ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video
              src={firstMedia.url}
              className="block w-full max-h-[60vh] object-contain"
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
              className="block w-full max-h-[60vh] object-contain"
            />
          )}
        </div>
      )}
      <div className="p-4 flex-1 flex flex-col gap-4">
        <div className={`whitespace-pre-wrap text-sm leading-relaxed ${expanded ? "" : "line-clamp-[10]"}`}>
          {post.body}
        </div>
        {!expanded && post.body.split("\n").length > 10 && (
          <button className="text-xs opacity-70 self-start" onClick={() => setExpanded(true)}>Read more</button>
        )}
        <div className="flex flex-wrap gap-1 text-xs opacity-70">
          <span>{new Date(post.originalDate).toLocaleDateString()}</span>
          {post.tags.slice(0, 6).map((t) => (
            <span key={t} className="px-1.5 py-0.5 rounded bg-white/10">{t}</span>
          ))}
        </div>
        <div className="flex justify-center">
          <StarRow value={stars} onChange={setStars} size="lg" />
        </div>

        <div className="flex items-center justify-center gap-2 text-xs">
          <span className="opacity-70">Evergreen?</span>
          <button
            type="button"
            onClick={() => setEvergreen("EVERGREEN")}
            disabled={savingLifecycle}
            className={`px-3 py-1.5 rounded-full border transition ${
              lifecycle === "EVERGREEN"
                ? "bg-green-400 text-black border-green-400"
                : "bg-white/5 border-white/20 hover:bg-white/10"
            }`}
          >
            Yes
          </button>
          <button
            type="button"
            onClick={() => setEvergreen("EPHEMERAL")}
            disabled={savingLifecycle}
            className={`px-3 py-1.5 rounded-full border transition ${
              lifecycle === "EPHEMERAL"
                ? "bg-orange-400 text-black border-orange-400"
                : "bg-white/5 border-white/20 hover:bg-white/10"
            }`}
          >
            No
          </button>
        </div>
        {stars !== null && (
          <div className="flex flex-wrap gap-2 justify-center">
            {chips.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => toggle(c)}
                className={`px-3 py-1.5 rounded-full text-xs border ${
                  reasons.includes(c)
                    ? "bg-yellow-400 text-black border-yellow-400"
                    : "bg-white/5 border-white/20 hover:bg-white/10"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        )}
        {stars !== null && (
          <div>
            {!noteOpen && (
              <button className="text-xs opacity-60" onClick={() => setNoteOpen(true)}>
                + add note
              </button>
            )}
            {noteOpen && (
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="why?"
                className="w-full mt-2 rounded bg-white/5 border border-white/10 p-2 text-sm"
                rows={2}
              />
            )}
          </div>
        )}
        <div className="mt-auto flex gap-2">
          <button
            type="button"
            onClick={onSkip}
            className="flex-1 py-3 rounded border border-white/20 text-sm"
          >
            Skip (S)
          </button>
          <button
            type="button"
            disabled={stars === null}
            onClick={() => stars && onSave({ stars, reasons, note: note || null })}
            className="flex-1 py-3 rounded bg-yellow-400 text-black font-medium text-sm disabled:opacity-40"
          >
            Save &amp; next →
          </button>
        </div>
      </div>
    </div>
  );
}
