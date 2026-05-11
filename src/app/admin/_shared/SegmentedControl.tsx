"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SegmentedOption<T extends string> {
  id: T;
  label: string;
  icon?: LucideIcon;
  /** If set, the option renders as a Link and clicking navigates there. */
  href?: string;
}

interface BaseProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  value: T;
  ariaLabel?: string;
  className?: string;
}

type SegmentedControlProps<T extends string> =
  | (BaseProps<T> & { onChange: (value: T) => void; mode?: "button" })
  | (BaseProps<T> & { onChange?: undefined; mode: "link" });

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex shrink-0 overflow-hidden rounded-md border border-gray-200 bg-white",
        className,
      )}
    >
      {options.map((opt, i) => {
        const active = opt.id === value;
        const Icon = opt.icon;
        const inner = (
          <>
            {Icon && <Icon className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">{opt.label}</span>
          </>
        );
        const cls = cn(
          "inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium transition-colors",
          i > 0 && "border-l border-gray-200",
          active ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-50",
        );

        if (opt.href) {
          return (
            <Link key={opt.id} href={opt.href} aria-current={active ? "page" : undefined} className={cls}>
              {inner}
            </Link>
          );
        }
        return (
          <button
            key={opt.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange?.(opt.id)}
            className={cls}
          >
            {inner}
          </button>
        );
      })}
    </div>
  );
}
