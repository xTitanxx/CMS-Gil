"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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

const PICKER_WIDTH = 224; // w-56 = 14rem
const PICKER_GAP = 4;

export function AudioPicker({ currentTrack, onSetAudio }: AudioPickerProps) {
  const [open, setOpen] = useState(false);
  const [tracks, setTracks] = useState<AudioTrackSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(null);
  const [mounted, setMounted] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

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

  // Position the popover above the trigger using fixed coords, so it can
  // escape any clipping ancestors (e.g. modal scroll containers, tile
  // overflow-hidden) and never gets cut off by narrow tile widths.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const update = () => {
      const rect = triggerRef.current!.getBoundingClientRect();
      const popoverHeight = popoverRef.current?.offsetHeight ?? 280;
      let top = rect.top - popoverHeight - PICKER_GAP;
      // Flip below if not enough space above
      if (top < 8) top = rect.bottom + PICKER_GAP;
      let left = rect.right - PICKER_WIDTH;
      if (left < 8) left = 8;
      const maxLeft = window.innerWidth - PICKER_WIDTH - 8;
      if (left > maxLeft) left = maxLeft;
      setCoords({ left, top });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  // Click outside to close
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        popoverRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const currentId = currentTrack?.id ?? null;

  const popover =
    open && coords ? (
      <div
        ref={popoverRef}
        className="fixed z-[60] w-56 rounded-xl border border-gray-100 bg-white/95 shadow-xl backdrop-blur-sm"
        style={{ left: coords.left, top: coords.top }}
        onMouseDown={(e) => e.stopPropagation()}
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
    ) : null;

  return (
    <>
      <button
        ref={triggerRef}
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
      {mounted && popover ? createPortal(popover, document.body) : null}
    </>
  );
}
