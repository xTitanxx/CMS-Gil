"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CheckboxOption<K extends string = string> {
  value: K;
  label: string;
}

interface CheckboxDropdownProps<K extends string = string> {
  label: string;
  options: ReadonlyArray<CheckboxOption<K>>;
  value: ReadonlySet<K>;
  onChange: (next: Set<K>) => void;
  className?: string;
}

/**
 * Dropdown button that opens a popover of checkboxes. All options default to
 * checked and can be toggled independently. Closes on outside click or Esc.
 */
export function CheckboxDropdown<K extends string = string>({
  label,
  options,
  value,
  onChange,
  className,
}: CheckboxDropdownProps<K>) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggle(v: K) {
    const next = new Set(value);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onChange(next);
  }

  const allChecked = options.every((o) => value.has(o.value));
  const noneChecked = options.every((o) => !value.has(o.value));

  // Compact summary: "all" / "none" / "N selected"
  const summary = allChecked
    ? "all"
    : noneChecked
    ? "none"
    : `${value.size} of ${options.length}`;

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm transition-colors hover:border-gray-400 focus:border-blue-500 focus:outline-none",
          !allChecked && "border-blue-400 text-blue-700"
        )}
      >
        <span>{label}</span>
        <span className="text-xs text-gray-500">({summary})</span>
        <ChevronDown className="h-4 w-4 text-gray-400" />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 min-w-[220px] rounded-lg border border-gray-200 bg-white p-1 shadow-lg">
          <div className="flex items-center justify-between px-2 py-1 text-xs text-gray-400">
            <button
              type="button"
              onClick={() => onChange(new Set(options.map((o) => o.value)))}
              className="hover:text-blue-600"
            >
              Select all
            </button>
            <button
              type="button"
              onClick={() => onChange(new Set())}
              className="hover:text-blue-600"
            >
              Clear
            </button>
          </div>
          <div className="h-px bg-gray-100" />
          {options.map((o) => {
            const checked = value.has(o.value);
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => toggle(o.value)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-gray-50"
              >
                <span
                  className={cn(
                    "flex h-4 w-4 items-center justify-center rounded border",
                    checked
                      ? "border-blue-600 bg-blue-600 text-white"
                      : "border-gray-300 bg-white"
                  )}
                >
                  {checked && <Check className="h-3 w-3" />}
                </span>
                {o.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
