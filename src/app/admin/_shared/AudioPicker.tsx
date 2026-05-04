"use client";

import { useState } from "react";
import { Music } from "lucide-react";

interface AudioTrackSummary {
  id: string;
  title: string;
  url?: string | null;
}

interface AudioPickerProps {
  currentTrack: { id: string; title: string } | null;
  onSetAudio: (audioTrackId: string | null) => void;
}

export function AudioPicker({ currentTrack, onSetAudio }: AudioPickerProps) {
  const [open, setOpen] = useState(false);
  const [tracks, setTracks] = useState<AudioTrackSummary[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function openPicker() {
    setOpen((v) => !v);
    if (tracks != null) return;
    setLoading(true);
    try {
      const res = await fetch("/api/audio");
      if (res.ok) {
        const data = (await res.json()) as AudioTrackSummary[];
        setTracks(data);
      }
    } finally {
      setLoading(false);
    }
  }

  const currentId = currentTrack?.id ?? null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          openPicker();
        }}
        className="flex items-center gap-1 rounded-full bg-white/90 px-2.5 py-1 text-[10px] text-gray-700 shadow-sm backdrop-blur-sm hover:bg-white"
        title="Add or change music"
      >
        <Music className="h-3 w-3" />
        <span>{currentTrack ? "Change" : "Add music"}</span>
      </button>
      {open && (
        <div
          className="absolute bottom-full right-0 mb-1 w-56 rounded-xl border border-gray-100 bg-white/95 shadow-xl backdrop-blur-sm"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="max-h-64 overflow-y-auto p-1 text-xs">
            {loading && <div className="px-3 py-2 text-gray-500">Loading…</div>}
            {!loading && tracks && tracks.length === 0 && (
              <div className="px-3 py-2 text-gray-500">
                No tracks yet.{" "}
                <a href="/admin/audio" className="text-blue-600 hover:underline">
                  Upload one
                </a>
              </div>
            )}
            {currentId && (
              <button
                type="button"
                onClick={() => {
                  onSetAudio(null);
                  setOpen(false);
                }}
                className="mx-1 block w-[calc(100%-0.5rem)] rounded-lg px-2.5 py-1.5 text-left text-red-600 hover:bg-red-50"
              >
                Remove music
              </button>
            )}
            {tracks?.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  onSetAudio(t.id);
                  setOpen(false);
                }}
                className={`mx-1 block w-[calc(100%-0.5rem)] rounded-lg px-2.5 py-1.5 text-left hover:bg-gray-50 ${
                  t.id === currentId
                    ? "bg-purple-50 font-medium text-purple-700 ring-1 ring-purple-200"
                    : ""
                }`}
              >
                {t.title}
              </button>
            ))}
          </div>
          <div className="border-t border-gray-100 px-3 py-2 text-[11px] text-gray-500">
            <a href="/admin/audio" className="text-blue-600 hover:underline">
              Manage library →
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
