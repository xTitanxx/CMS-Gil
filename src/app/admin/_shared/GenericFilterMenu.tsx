"use client";

import { useEffect, useRef, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import {
  BottomSheet,
  CheckRow,
  FilterSection,
  useClampedDropdown,
  useIsMobile,
} from "./MenuPrimitives";

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterGroup {
  /** Unique within the menu. Used as a Map key when toggling. */
  id: string;
  /** Section heading. */
  title: string;
  /** All possible values in this group. A selection equal to the full set =
   *  "no filter applied" (matches PostFilterUI's convention). */
  options: FilterOption[];
  /** Currently selected values (must be a subset of options). */
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}

interface GenericFilterMenuProps {
  groups: FilterGroup[];
  /** Reset every group back to "all selected". */
  onReset: () => void;
}

function isActive(group: FilterGroup): boolean {
  return group.selected.size !== group.options.length;
}

export function countActiveGroups(groups: FilterGroup[]): number {
  return groups.filter(isActive).length;
}

function toggle(group: FilterGroup, value: string) {
  const next = new Set(group.selected);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  group.onChange(next);
}

export function GenericFilterMenu({ groups, onReset }: GenericFilterMenuProps) {
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const clampedRight = useClampedDropdown(open && !isMobile, ref, menuRef);

  useEffect(() => {
    if (!open || isMobile) return;
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
  }, [open, isMobile]);

  const activeCount = countActiveGroups(groups);

  const sectionsList = (
    <div className="divide-y divide-gray-100">
      {groups.map((group, i) => (
        <div key={group.id} className={i === 0 ? "pb-3" : "py-3"}>
          <FilterSection
            title={group.title}
            selected={group.selected.size}
            total={group.options.length}
            onSelectAll={() =>
              group.onChange(new Set(group.options.map((o) => o.value)))
            }
          >
            {group.options.map((o) => (
              <CheckRow
                key={o.value}
                checked={group.selected.has(o.value)}
                onChange={() => toggle(group, o.value)}
                onOnly={() => group.onChange(new Set([o.value]))}
                label={o.label}
              />
            ))}
          </FilterSection>
        </div>
      ))}
    </div>
  );

  const resetButton = activeCount > 0 ? (
    <button
      type="button"
      onClick={onReset}
      className="text-xs font-medium text-blue-600 hover:underline"
    >
      Reset all
    </button>
  ) : null;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={activeCount > 0 ? `Filters (${activeCount} active)` : "Filters"}
        aria-expanded={open}
        className={`inline-flex h-10 items-center gap-1.5 rounded-full border px-3 text-sm font-medium md:h-9 ${
          activeCount > 0
            ? "border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100"
            : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
        } focus:border-gray-400 focus:outline-none`}
      >
        <SlidersHorizontal className="h-4 w-4 flex-shrink-0" />
        <span className="hidden md:inline">Filter</span>
        {activeCount > 0 && (
          <span className="ml-0.5 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] font-semibold text-white">
            {activeCount}
          </span>
        )}
      </button>

      {/* Desktop dropdown */}
      {open && !isMobile && (
        <div
          ref={menuRef}
          style={{ right: clampedRight }}
          className="absolute top-full z-20 mt-1 hidden w-72 max-w-[calc(100vw-1rem)] rounded-lg border border-gray-200 bg-white p-3 shadow-lg md:block"
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
              Filters
            </span>
            {resetButton}
          </div>
          <div className="max-h-[60vh] overflow-y-auto pr-1">{sectionsList}</div>
        </div>
      )}

      {/* Mobile bottom sheet */}
      <BottomSheet
        open={open && isMobile}
        onClose={() => setOpen(false)}
        title="Filters"
        rightAction={resetButton}
      >
        {sectionsList}
      </BottomSheet>
    </div>
  );
}
