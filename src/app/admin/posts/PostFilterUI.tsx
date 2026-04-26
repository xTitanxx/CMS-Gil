"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  SlidersHorizontal,
  ArrowUpDown,
  CalendarDays,
} from "lucide-react";

/**
 * Clamps a `right-0`-anchored dropdown so it stays within the viewport.
 * Returns the inline `right` value (in px) to apply to the menu element.
 * Falls back to 0 (button-anchored) when the dropdown already fits.
 */
function useClampedDropdown(
  open: boolean,
  parentRef: React.RefObject<HTMLDivElement | null>,
  menuRef: React.RefObject<HTMLDivElement | null>,
) {
  const [right, setRight] = useState(0);
  useLayoutEffect(() => {
    if (!open) return;
    function update() {
      const parent = parentRef.current;
      const menu = menuRef.current;
      if (!parent || !menu) return;
      const parentRect = parent.getBoundingClientRect();
      const menuWidth = menu.offsetWidth;
      const margin = 8;
      const vw = window.innerWidth;
      // dropdown.right (screen) = parent.right - r; dropdown.left = parent.right - r - menuWidth
      // want dropdown.right <= vw - margin → r >= parent.right - vw + margin (minR)
      // want dropdown.left >= margin     → r <= parent.right - menuWidth - margin (maxR)
      const minR = parentRect.right - vw + margin;
      const maxR = parentRect.right - menuWidth - margin;
      let r = 0;
      if (r < minR) r = minR;
      if (r > maxR) r = maxR;
      setRight(r);
    }
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [open, parentRef, menuRef]);
  return right;
}
import {
  CONTENT_CATEGORIES,
  AUDIO_CATEGORIES,
  type ContentCategory,
  type AudioCategory,
} from "@/lib/posts-query";

/* ------------------------------------------------------------------ */
/*  Filter value types & options                                       */
/* ------------------------------------------------------------------ */

export const LINK_VALUES = ["with", "without"] as const;
export type LinkValue = (typeof LINK_VALUES)[number];

export const MULTI_MEDIA_VALUES = ["1", "2", "none"] as const;
export type MultiMediaValue = (typeof MULTI_MEDIA_VALUES)[number];

export const TAGGED_VALUES = ["yes", "no"] as const;
export type TaggedValue = (typeof TAGGED_VALUES)[number];

export const SHARE_VALUES = ["original", "external", "stripped"] as const;
export type ShareValue = (typeof SHARE_VALUES)[number];

export const QUALITY_VALUES = ["clean", "issues"] as const;
export type QualityValue = (typeof QUALITY_VALUES)[number];

export const CAPTION_QUALITY_VALUES = ["good", "ok", "weak", "not-analyzed", "has-rewrite"] as const;
export type CaptionQualityValue = (typeof CAPTION_QUALITY_VALUES)[number];

export const ENRICHED_VALUES = ["yes", "no"] as const;
export type EnrichedValue = (typeof ENRICHED_VALUES)[number];

export const CONTENT_OPTIONS: { value: ContentCategory; label: string }[] = [
  { value: "caption", label: "Caption only" },
  { value: "image", label: "Image" },
  { value: "video", label: "Video" },
  { value: "nocaption", label: "No caption" },
];

export const AUDIO_OPTIONS: { value: AudioCategory; label: string }[] = [
  { value: "audible", label: "Video with audio" },
  { value: "silent", label: "Silent video" },
  { value: "nonvideo", label: "Non-video posts" },
];

export const LINK_OPTIONS: { value: LinkValue; label: string }[] = [
  { value: "with", label: "Has FB link" },
  { value: "without", label: "No FB link" },
];

export const MULTI_MEDIA_OPTIONS: { value: MultiMediaValue; label: string }[] = [
  { value: "1", label: "1 media" },
  { value: "2", label: "2 or more media" },
  { value: "none", label: "No media" },
];

export const TAGGED_OPTIONS: { value: TaggedValue; label: string }[] = [
  { value: "yes", label: "AI tagged" },
  { value: "no", label: "Not yet tagged" },
];

export const SHARE_OPTIONS: { value: ShareValue; label: string }[] = [
  { value: "original", label: "Original posts" },
  { value: "external", label: "Shared external link" },
  { value: "stripped", label: "Shared FB post (card stripped)" },
];

export const QUALITY_OPTIONS: { value: QualityValue; label: string }[] = [
  { value: "clean", label: "No issues (has link + audio)" },
  { value: "issues", label: "Has issues (missing link or audio)" },
];

export const CAPTION_QUALITY_OPTIONS: { value: CaptionQualityValue; label: string }[] = [
  { value: "good", label: "Good caption (4-5)" },
  { value: "ok", label: "OK caption (3)" },
  { value: "weak", label: "Weak caption (1-2)" },
  { value: "not-analyzed", label: "Not analyzed" },
  { value: "has-rewrite", label: "Has AI rewrite" },
];

export const ENRICHED_OPTIONS: { value: EnrichedValue; label: string }[] = [
  { value: "yes", label: "Enriched (has FB analytics)" },
  { value: "no", label: "Not enriched" },
];

export const SORT_OPTIONS = [
  { value: "originalDate_desc", label: "Post date (newest)" },
  { value: "originalDate_asc", label: "Post date (oldest)" },
  { value: "createdAt_desc", label: "Import date (newest)" },
  { value: "createdAt_asc", label: "Import date (oldest)" },
];

/* ------------------------------------------------------------------ */
/*  Utility helpers                                                    */
/* ------------------------------------------------------------------ */

export function parseCsvToSet<T extends string>(
  raw: string | undefined,
  allowed: readonly T[],
): Set<T> {
  if (raw == null) return new Set(allowed);
  const out = new Set<T>();
  for (const part of raw.split(",")) {
    const v = part.trim();
    if ((allowed as readonly string[]).includes(v)) out.add(v as T);
  }
  return out;
}

export function serializeSet<T extends string>(
  set: Set<T>,
  allowed: readonly T[],
): string | null {
  if (allowed.every((v) => set.has(v))) return null;
  return [...set].join(",");
}

/** Count how many filter groups are actively narrowing results. */
export function countActiveFilters(filters: {
  sort: string;
  content: Set<ContentCategory>;
  audio: Set<AudioCategory>;
  link: Set<LinkValue>;
  multiMedia: Set<MultiMediaValue>;
  tagged: Set<TaggedValue>;
  share: Set<ShareValue>;
  quality: Set<QualityValue>;
  captionQuality: Set<CaptionQualityValue>;
  enriched: Set<EnrichedValue>;
}): number {
  let n = 0;
  if (filters.sort !== "originalDate_desc") n++;
  if (filters.content.size !== CONTENT_CATEGORIES.length) n++;
  if (filters.audio.size !== AUDIO_CATEGORIES.length) n++;
  if (filters.link.size !== LINK_VALUES.length) n++;
  if (filters.multiMedia.size !== MULTI_MEDIA_VALUES.length) n++;
  if (filters.tagged.size !== TAGGED_VALUES.length) n++;
  if (filters.share.size !== SHARE_VALUES.length) n++;
  if (filters.quality.size !== QUALITY_VALUES.length) n++;
  if (filters.captionQuality.size !== CAPTION_QUALITY_VALUES.length) n++;
  if (filters.enriched.size !== ENRICHED_VALUES.length) n++;
  return n;
}

/** Serialise current filter state into a URLSearchParams for API calls. */
export function buildFilterParams(f: {
  search: string;
  sort: string;
  aiTags: string[];
  content: Set<ContentCategory>;
  audio: Set<AudioCategory>;
  link: Set<LinkValue>;
  multiMedia: Set<MultiMediaValue>;
  tagged: Set<TaggedValue>;
  share: Set<ShareValue>;
  quality: Set<QualityValue>;
  captionQuality: Set<CaptionQualityValue>;
  enriched: Set<EnrichedValue>;
  kind: string;
  subKind?: string;
}): URLSearchParams {
  const contentParam = serializeSet(f.content, CONTENT_CATEGORIES);
  const audioParam = serializeSet(f.audio, AUDIO_CATEGORIES);
  const linkParam = serializeSet(f.link, LINK_VALUES);
  const multiMediaParam = serializeSet(f.multiMedia, MULTI_MEDIA_VALUES);
  const taggedParam = serializeSet(f.tagged, TAGGED_VALUES);
  const shareParam = serializeSet(f.share, SHARE_VALUES);
  const qualityParam = serializeSet(f.quality, QUALITY_VALUES);
  const captionQualityParam = serializeSet(f.captionQuality, CAPTION_QUALITY_VALUES);
  const enrichedParam = serializeSet(f.enriched, ENRICHED_VALUES);
  const params = new URLSearchParams({
    ...(f.search ? { search: f.search } : {}),
    ...(f.sort !== "originalDate_desc" ? { sort: f.sort } : {}),
    ...(f.aiTags.length > 0 ? { tags: f.aiTags.join(",") } : {}),
    ...(contentParam ? { content: contentParam } : {}),
    ...(audioParam ? { audio: audioParam } : {}),
    ...(linkParam ? { link: linkParam } : {}),
    ...(multiMediaParam ? { multiMedia: multiMediaParam } : {}),
    ...(taggedParam ? { tagged: taggedParam } : {}),
    ...(shareParam ? { share: shareParam } : {}),
    ...(qualityParam ? { quality: qualityParam } : {}),
    ...(captionQualityParam ? { captionQuality: captionQualityParam } : {}),
    ...(enrichedParam ? { enriched: enrichedParam } : {}),
    ...(f.kind !== "posts" ? { kind: f.kind } : {}),
    ...(f.subKind ? { subKind: f.subKind } : {}),
  });
  return params;
}

/* ------------------------------------------------------------------ */
/*  Shared UI primitives                                               */
/* ------------------------------------------------------------------ */

export function FilterSection({
  title,
  selected,
  total,
  onSelectAll,
  children,
}: {
  title: string;
  /** count of values currently in the set */
  selected?: number;
  /** total count of values in this filter */
  total?: number;
  /** restore the set to "all selected" = no filter applied */
  onSelectAll?: () => void;
  children: React.ReactNode;
}) {
  const isActive =
    selected != null && total != null && selected !== total;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
            {title}
          </p>
          {isActive && (
            <span
              aria-hidden
              className="h-1.5 w-1.5 rounded-full bg-blue-500"
            />
          )}
        </div>
        {onSelectAll && (
          <button
            type="button"
            onClick={onSelectAll}
            disabled={!isActive}
            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition-colors ${
              isActive
                ? "text-blue-600 hover:bg-blue-50"
                : "cursor-default text-gray-300"
            }`}
            title={
              isActive
                ? "Clear this filter (select all)"
                : "All options selected"
            }
          >
            Any
          </button>
        )}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

export function RadioRow({
  name,
  checked,
  onChange,
  label,
}: {
  name: string;
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm text-gray-700 hover:bg-gray-50">
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onChange}
        className="h-4 w-4 cursor-pointer border-gray-300 text-blue-600"
      />
      {label}
    </label>
  );
}

export function CheckRow({
  checked,
  onChange,
  onOnly,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  onOnly?: () => void;
  label: string;
}) {
  return (
    <label className="group flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm text-gray-700 hover:bg-gray-50">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="h-4 w-4 cursor-pointer rounded border-gray-300 text-blue-600"
      />
      <span className="flex-1">{label}</span>
      {onOnly && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onOnly();
          }}
          className="ml-auto hidden rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-blue-600 hover:bg-blue-50 group-hover:inline"
        >
          Only
        </button>
      )}
    </label>
  );
}

/* ------------------------------------------------------------------ */
/*  FilterMenu                                                         */
/* ------------------------------------------------------------------ */

export interface FilterMenuProps {
  content: Set<ContentCategory>;
  setContent: (s: Set<ContentCategory>) => void;
  audio: Set<AudioCategory>;
  setAudio: (s: Set<AudioCategory>) => void;
  link: Set<LinkValue>;
  setLink: (s: Set<LinkValue>) => void;
  multiMedia: Set<MultiMediaValue>;
  setMultiMedia: (s: Set<MultiMediaValue>) => void;
  tagged: Set<TaggedValue>;
  setTagged: (s: Set<TaggedValue>) => void;
  share: Set<ShareValue>;
  setShare: (s: Set<ShareValue>) => void;
  quality: Set<QualityValue>;
  setQuality: (s: Set<QualityValue>) => void;
  captionQuality: Set<CaptionQualityValue>;
  setCaptionQuality: (s: Set<CaptionQualityValue>) => void;
  enriched: Set<EnrichedValue>;
  setEnriched: (s: Set<EnrichedValue>) => void;
  activeCount: number;
  onReset: () => void;
}

function toggleIn<T extends string>(
  set: Set<T>,
  v: T,
  apply: (s: Set<T>) => void,
) {
  const next = new Set(set);
  if (next.has(v)) next.delete(v);
  else next.add(v);
  apply(next);
}

export function FilterMenu(props: FilterMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const clampedRight = useClampedDropdown(open, ref, menuRef);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm font-medium transition-colors focus:outline-none ${
          props.activeCount > 0 || open
            ? "border-blue-400 text-blue-700 hover:bg-blue-50"
            : "border-gray-300 text-gray-700 hover:bg-gray-50"
        }`}
      >
        <SlidersHorizontal className="h-4 w-4" />
        Filters
        {props.activeCount > 0 && (
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1.5 text-[10px] font-semibold text-white">
            {props.activeCount}
          </span>
        )}
      </button>
      {open && (
        <div
          ref={menuRef}
          style={{ right: clampedRight }}
          className="absolute top-full z-20 mt-1.5 w-80 max-w-[calc(100vw-1rem)] rounded-xl border border-gray-200 bg-white shadow-xl ring-1 ring-black/5"
        >
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-gray-900">Filters</span>
              {props.activeCount > 0 && (
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1.5 text-[10px] font-semibold text-white">
                  {props.activeCount}
                </span>
              )}
            </div>
            <button
              onClick={props.onReset}
              disabled={props.activeCount === 0}
              className={`text-xs font-medium transition-colors ${
                props.activeCount > 0
                  ? "text-blue-600 hover:underline"
                  : "cursor-default text-gray-300"
              }`}
              title="Reset all filters to Any"
            >
              Reset all
            </button>
          </div>
          <div className="px-4 pb-1 pt-2">
          <div className="max-h-[70vh] divide-y divide-gray-100 overflow-y-auto pr-1">
            <div className="pb-3">
              <FilterSection
                title="Quality"
                selected={props.quality.size}
                total={QUALITY_VALUES.length}
                onSelectAll={() => props.setQuality(new Set(QUALITY_VALUES))}
              >
                {QUALITY_OPTIONS.map((o) => (
                  <CheckRow
                    key={o.value}
                    checked={props.quality.has(o.value)}
                    onChange={() =>
                      toggleIn(props.quality, o.value, props.setQuality)
                    }
                    onOnly={() => props.setQuality(new Set([o.value]))}
                    label={o.label}
                  />
                ))}
              </FilterSection>
            </div>
            <div className="py-3">
              <FilterSection
                title="Caption rating"
                selected={props.captionQuality.size}
                total={CAPTION_QUALITY_VALUES.length}
                onSelectAll={() => props.setCaptionQuality(new Set(CAPTION_QUALITY_VALUES))}
              >
                {CAPTION_QUALITY_OPTIONS.map((o) => (
                  <CheckRow
                    key={o.value}
                    checked={props.captionQuality.has(o.value)}
                    onChange={() =>
                      toggleIn(props.captionQuality, o.value, props.setCaptionQuality)
                    }
                    onOnly={() => props.setCaptionQuality(new Set([o.value]))}
                    label={o.label}
                  />
                ))}
              </FilterSection>
            </div>
            <div className="py-3">
              <FilterSection
                title="Content"
                selected={props.content.size}
                total={CONTENT_CATEGORIES.length}
                onSelectAll={() => props.setContent(new Set(CONTENT_CATEGORIES))}
              >
                {CONTENT_OPTIONS.map((o) => (
                  <CheckRow
                    key={o.value}
                    checked={props.content.has(o.value)}
                    onChange={() =>
                      toggleIn(props.content, o.value, props.setContent)
                    }
                    onOnly={() => props.setContent(new Set([o.value]))}
                    label={o.label}
                  />
                ))}
              </FilterSection>
            </div>
            <div className="py-3">
              <FilterSection
                title="Audio"
                selected={props.audio.size}
                total={AUDIO_CATEGORIES.length}
                onSelectAll={() => props.setAudio(new Set(AUDIO_CATEGORIES))}
              >
                {AUDIO_OPTIONS.map((o) => (
                  <CheckRow
                    key={o.value}
                    checked={props.audio.has(o.value)}
                    onChange={() =>
                      toggleIn(props.audio, o.value, props.setAudio)
                    }
                    onOnly={() => props.setAudio(new Set([o.value]))}
                    label={o.label}
                  />
                ))}
              </FilterSection>
            </div>
            <div className="py-3">
              <FilterSection
                title="Facebook link"
                selected={props.link.size}
                total={LINK_VALUES.length}
                onSelectAll={() => props.setLink(new Set(LINK_VALUES))}
              >
                {LINK_OPTIONS.map((o) => (
                  <CheckRow
                    key={o.value}
                    checked={props.link.has(o.value)}
                    onChange={() =>
                      toggleIn(props.link, o.value, props.setLink)
                    }
                    onOnly={() => props.setLink(new Set([o.value]))}
                    label={o.label}
                  />
                ))}
              </FilterSection>
            </div>
            <div className="py-3">
              <FilterSection
                title="Media count"
                selected={props.multiMedia.size}
                total={MULTI_MEDIA_VALUES.length}
                onSelectAll={() => props.setMultiMedia(new Set(MULTI_MEDIA_VALUES))}
              >
                {MULTI_MEDIA_OPTIONS.map((o) => (
                  <CheckRow
                    key={o.value}
                    checked={props.multiMedia.has(o.value)}
                    onChange={() =>
                      toggleIn(props.multiMedia, o.value, props.setMultiMedia)
                    }
                    onOnly={() => props.setMultiMedia(new Set([o.value]))}
                    label={o.label}
                  />
                ))}
              </FilterSection>
            </div>
            <div className="py-3">
              <FilterSection
                title="Share / crosspost"
                selected={props.share.size}
                total={SHARE_VALUES.length}
                onSelectAll={() => props.setShare(new Set(SHARE_VALUES))}
              >
                {SHARE_OPTIONS.map((o) => (
                  <CheckRow
                    key={o.value}
                    checked={props.share.has(o.value)}
                    onChange={() =>
                      toggleIn(props.share, o.value, props.setShare)
                    }
                    onOnly={() => props.setShare(new Set([o.value]))}
                    label={o.label}
                  />
                ))}
              </FilterSection>
            </div>
            <div className="py-3">
              <FilterSection
                title="AI tags"
                selected={props.tagged.size}
                total={TAGGED_VALUES.length}
                onSelectAll={() => props.setTagged(new Set(TAGGED_VALUES))}
              >
                {TAGGED_OPTIONS.map((o) => (
                  <CheckRow
                    key={o.value}
                    checked={props.tagged.has(o.value)}
                    onChange={() =>
                      toggleIn(props.tagged, o.value, props.setTagged)
                    }
                    onOnly={() => props.setTagged(new Set([o.value]))}
                    label={o.label}
                  />
                ))}
              </FilterSection>
            </div>
            <div className="pt-3">
              <FilterSection
                title="FB analytics"
                selected={props.enriched.size}
                total={ENRICHED_VALUES.length}
                onSelectAll={() => props.setEnriched(new Set(ENRICHED_VALUES))}
              >
                {ENRICHED_OPTIONS.map((o) => (
                  <CheckRow
                    key={o.value}
                    checked={props.enriched.has(o.value)}
                    onChange={() =>
                      toggleIn(props.enriched, o.value, props.setEnriched)
                    }
                    onOnly={() => props.setEnriched(new Set([o.value]))}
                    label={o.label}
                  />
                ))}
              </FilterSection>
            </div>
          </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  SortMenu                                                           */
/* ------------------------------------------------------------------ */

export function SortMenu({
  sort,
  setSort,
}: {
  sort: string;
  setSort: (s: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const clampedRight = useClampedDropdown(open, ref, menuRef);
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);
  const current = SORT_OPTIONS.find((o) => o.value === sort)?.label ?? "Sort";
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:border-blue-500 focus:outline-none"
        title={current}
      >
        <ArrowUpDown className="h-4 w-4" />
        Sort
      </button>
      {open && (
        <div
          ref={menuRef}
          style={{ right: clampedRight }}
          className="absolute top-full z-20 mt-1 w-56 max-w-[calc(100vw-1rem)] rounded-lg border border-gray-200 bg-white p-2 shadow-lg"
        >
          {SORT_OPTIONS.map((o) => (
            <RadioRow
              key={o.value}
              name="sort"
              checked={sort === o.value}
              onChange={() => {
                setSort(o.value);
                setOpen(false);
              }}
              label={o.label}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  JumpToDateMenu                                                     */
/* ------------------------------------------------------------------ */

export function JumpToDateMenu({
  onJump,
}: {
  onJump: (dateStr: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const clampedRight = useClampedDropdown(open, ref, menuRef);
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);
  function submit() {
    if (!value) return;
    onJump(value);
    setOpen(false);
  }
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:border-blue-500 focus:outline-none"
      >
        <CalendarDays className="h-4 w-4" />
        Jump to date
      </button>
      {open && (
        <div
          ref={menuRef}
          style={{ right: clampedRight }}
          className="absolute top-full z-20 mt-1 w-64 max-w-[calc(100vw-1rem)] rounded-lg border border-gray-200 bg-white p-3 shadow-lg"
        >
          <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wider text-gray-400">
            Jump to
          </label>
          <input
            type="date"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
            autoFocus
          />
          <div className="mt-2 flex justify-end gap-2">
            <button
              onClick={() => setOpen(false)}
              className="rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-100"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={!value}
              className="rounded bg-blue-600 px-2 py-1 text-xs font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Jump
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
