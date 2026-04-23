"use client";
import { useState } from "react";

type Lifecycle = "EVERGREEN" | "EPHEMERAL" | "SEASONAL" | "UNKNOWN";
type Season = "SPRING" | "SUMMER" | "FALL" | "WINTER" | null;

const LABEL: Record<Lifecycle, string> = {
  EVERGREEN: "🔄 Evergreen",
  EPHEMERAL: "⏳ Ephemeral",
  SEASONAL: "🍂 Seasonal",
  UNKNOWN: "❔ Unknown",
};

const SEASON_LABEL: Record<Exclude<Season, null>, string> = {
  SPRING: "Spring",
  SUMMER: "Summer",
  FALL: "Fall",
  WINTER: "Winter",
};

export function LifecycleChip({
  postId,
  initialLifecycle,
  initialSeason,
}: {
  postId: string;
  initialLifecycle: Lifecycle;
  initialSeason: Season;
}) {
  const [open, setOpen] = useState(false);
  const [lifecycle, setLifecycle] = useState<Lifecycle>(initialLifecycle);
  const [season, setSeason] = useState<Season>(initialSeason);
  const [saving, setSaving] = useState(false);

  async function save(nextLifecycle: Lifecycle, nextSeason: Season) {
    setSaving(true);
    try {
      const effectiveSeason = nextLifecycle === "SEASONAL" ? nextSeason : null;
      const res = await fetch(`/api/posts/${postId}/lifecycle`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lifecycle: nextLifecycle, season: effectiveSeason }),
      });
      if (!res.ok) throw new Error("save failed");
      setLifecycle(nextLifecycle);
      setSeason(effectiveSeason);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  const label =
    lifecycle === "SEASONAL" && season
      ? `${LABEL[lifecycle]} · ${SEASON_LABEL[season]}`
      : LABEL[lifecycle];

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={saving}
        className="px-2 py-1 text-xs rounded-full border bg-white/60 hover:bg-white transition"
      >
        {label}
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-44 rounded-md border bg-white shadow-lg p-1 text-sm">
          {(["EVERGREEN", "EPHEMERAL", "SEASONAL", "UNKNOWN"] as Lifecycle[]).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => save(l, season)}
              className={`block w-full text-left px-2 py-1 rounded hover:bg-gray-100 ${
                l === lifecycle ? "font-semibold" : ""
              }`}
            >
              {LABEL[l]}
            </button>
          ))}
          {lifecycle === "SEASONAL" && (
            <div className="border-t mt-1 pt-1">
              <div className="px-2 py-1 text-xs text-gray-500">Season</div>
              {(["SPRING", "SUMMER", "FALL", "WINTER"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => save("SEASONAL", s)}
                  className={`block w-full text-left px-2 py-1 rounded hover:bg-gray-100 ${
                    s === season ? "font-semibold" : ""
                  }`}
                >
                  {SEASON_LABEL[s]}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
