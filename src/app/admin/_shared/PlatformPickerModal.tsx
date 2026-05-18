"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import { SiFacebook, SiInstagram, SiYoutube, SiTiktok } from "react-icons/si";
import { FaLinkedin } from "react-icons/fa";

const FB_PERSONAL = "FACEBOOK_PERSONAL";

type ChipDef = {
  key: string;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
  activeClasses: string;
  manual?: boolean;
};

const AUTO_CHIPS: ChipDef[] = [
  {
    key: "FACEBOOK_PAGE",
    label: "FB Page",
    Icon: SiFacebook,
    iconColor: "text-[#1877F2]",
    activeClasses: "border-[#1877F2] bg-[#1877F2]/10 text-[#1877F2]",
  },
  {
    key: "INSTAGRAM",
    label: "Instagram",
    Icon: SiInstagram,
    iconColor: "text-[#E1306C]",
    activeClasses: "border-[#E1306C] bg-[#E1306C]/10 text-[#E1306C]",
  },
  {
    key: "LINKEDIN",
    label: "LinkedIn",
    Icon: FaLinkedin,
    iconColor: "text-[#0A66C2]",
    activeClasses: "border-[#0A66C2] bg-[#0A66C2]/10 text-[#0A66C2]",
  },
  {
    key: "YOUTUBE",
    label: "YouTube",
    Icon: SiYoutube,
    iconColor: "text-[#FF0000]",
    activeClasses: "border-[#FF0000] bg-[#FF0000]/10 text-[#FF0000]",
  },
  {
    key: "TIKTOK",
    label: "TikTok",
    Icon: SiTiktok,
    iconColor: "text-gray-900",
    activeClasses: "border-gray-900 bg-gray-100 text-gray-900",
  },
];

const FB_PERSONAL_CHIP: ChipDef = {
  key: FB_PERSONAL,
  label: "FB Personal",
  Icon: SiFacebook,
  iconColor: "text-[#1877F2]",
  activeClasses: "border-dashed border-[#1877F2] bg-[#1877F2]/5 text-[#1877F2]",
  manual: true,
};

interface State {
  selected: string[];
  connected: string[];
  eligibleByMedia: string[];
}

interface Props {
  postId: string;
  open: boolean;
  onClose: () => void;
  onSaved?: (platforms: string[]) => void;
}

export function PlatformPickerModal({ postId, open, onClose, onSaved }: Props) {
  const [state, setState] = useState<State | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/posts/${postId}/scheduled-platforms`);
      if (!res.ok) throw new Error(`load ${res.status}`);
      const data = (await res.json()) as {
        selected: string[];
        connected: string[];
        eligibleByMedia: string[];
      };
      setState({
        selected: data.selected,
        connected: data.connected,
        eligibleByMedia: data.eligibleByMedia,
      });
      setPicked(new Set(data.selected));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [postId]);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    dialogRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const isAvailable = (chip: ChipDef): boolean => {
    if (chip.key === FB_PERSONAL) return true;
    if (!state) return false;
    return (
      state.eligibleByMedia.includes(chip.key) &&
      state.connected.includes(chip.key)
    );
  };

  const reasonFor = (chip: ChipDef): string | null => {
    if (chip.key === FB_PERSONAL) return null;
    if (!state) return null;
    // Media shape doesn't reach the client directly; we infer from
    // eligibleByMedia. If the platform isn't eligible by media, we want the
    // tooltip; otherwise fall through to "not connected."
    if (!state.eligibleByMedia.includes(chip.key)) {
      // Mirror the server-side reason heuristically.
      if (chip.key === "YOUTUBE" || chip.key === "TIKTOK") return "Video required";
      if (chip.key === "INSTAGRAM") return "Photo or video required";
      return null;
    }
    if (!state.connected.includes(chip.key)) {
      return "Platform not connected";
    }
    return null;
  };

  const toggle = (key: string) => {
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/posts/${postId}/scheduled-platforms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platforms: [...picked] }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `save ${res.status}`);
      }
      const data = (await res.json()) as { platforms: string[] };
      onSaved?.(data.platforms);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const dirty =
    !!state &&
    (picked.size !== state.selected.length ||
      [...picked].some((p) => !state.selected.includes(p)));

  const allChips = [...AUTO_CHIPS, FB_PERSONAL_CHIP];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-3 py-6 sm:items-center"
      onClick={onClose}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="platform-picker-heading"
        tabIndex={-1}
        className="relative flex max-h-[88vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-xl focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
          <h2
            id="platform-picker-heading"
            className="text-base font-semibold text-gray-900"
          >
            Edit platforms
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-900"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-sm text-gray-500">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : error && !state ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
              {error}
            </div>
          ) : state ? (
            <>
              <p className="mb-3 text-[13px] text-gray-600">
                Toggle which platforms this post should publish to. Adding a
                platform queues it for the slot&apos;s scheduled time; removing
                cancels the pending publish.
              </p>
              <div className="flex flex-wrap gap-2">
                {allChips.map((chip) => {
                  const avail = isAvailable(chip);
                  const active = picked.has(chip.key);
                  const reason = reasonFor(chip);
                  return (
                    <button
                      key={chip.key}
                      type="button"
                      onClick={() => avail && toggle(chip.key)}
                      disabled={!avail}
                      title={reason ?? undefined}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors ${
                        active
                          ? chip.activeClasses
                          : avail
                            ? "border-gray-200 bg-white text-gray-700 hover:border-gray-300"
                            : "cursor-not-allowed border-dashed border-gray-200 bg-gray-50 text-gray-400"
                      }`}
                    >
                      <chip.Icon
                        className={`h-3.5 w-3.5 ${avail ? chip.iconColor : "text-gray-300"}`}
                      />
                      <span>{chip.label}</span>
                      {chip.manual && (
                        <span className="text-[9px] font-bold uppercase tracking-wider">
                          Manual
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              {error && (
                <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-2 text-[12px] text-rose-800">
                  {error}
                </div>
              )}
            </>
          ) : null}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-gray-100 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-[13px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!dirty || saving || loading}
            className="inline-flex items-center gap-1.5 rounded-full bg-gray-900 px-4 py-1.5 text-[13px] font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Save
          </button>
        </footer>
      </div>
    </div>
  );
}

