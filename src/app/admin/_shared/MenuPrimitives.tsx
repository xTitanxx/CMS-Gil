"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/**
 * Clamps a `right-0`-anchored dropdown so it stays within the viewport.
 * Returns the inline `right` value (in px) to apply to the menu element.
 * Falls back to 0 (button-anchored) when the dropdown already fits.
 */
export function useClampedDropdown(
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

/**
 * Tailwind's `md` breakpoint (768px) as a media query. Used to render
 * dropdowns as a bottom sheet on mobile while keeping desktop dropdowns intact.
 */
export function useIsMobile() {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return mobile;
}

/**
 * Mobile bottom sheet: fixed full-width panel that slides up from below.
 * Renders via portal so parent overflow doesn't clip it and the body
 * scroll is locked while open.
 */
export function BottomSheet({
  open,
  onClose,
  title,
  rightAction,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  rightAction?: React.ReactNode;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end justify-center md:hidden">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/40 animate-[fade-in_0.15s_ease-out]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative flex max-h-[88vh] w-full flex-col rounded-t-2xl bg-white shadow-2xl animate-[slide-up_0.18s_cubic-bezier(0.32,0.72,0,1)]"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.5rem)" }}
      >
        <div className="flex justify-center pt-2.5 pb-1">
          <span aria-hidden className="h-1.5 w-10 rounded-full bg-gray-300" />
        </div>
        <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-4 pb-3 pt-1">
          <span className="min-w-0 truncate text-base font-semibold text-gray-900">
            {title}
          </span>
          <div className="flex flex-shrink-0 items-center gap-2">
            {rightAction}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-3">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Trigger-style helper used by SortMenu and the generic filter menu. */
export function MenuButton({
  innerRef,
  active,
  onClick,
  label,
  ariaLabel,
  title,
  icon,
  trailing,
}: {
  innerRef?: React.Ref<HTMLButtonElement>;
  active?: boolean;
  onClick: () => void;
  label: React.ReactNode;
  ariaLabel?: string;
  title?: string;
  icon: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  return (
    <button
      ref={innerRef}
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      title={title}
      className={`inline-flex h-10 items-center gap-1.5 rounded-full border px-3 text-sm font-medium md:h-9 ${
        active
          ? "border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100"
          : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
      } focus:border-gray-400 focus:outline-none`}
    >
      <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center">{icon}</span>
      <span className="min-w-0 truncate">{label}</span>
      {trailing}
    </button>
  );
}

/**
 * Section wrapper for grouped filter options inside a filter menu.
 * Mirrors PostFilterUI's `FilterSection` so the visual language matches.
 */
export function FilterSection({
  title,
  selected,
  total,
  onSelectAll,
  children,
}: {
  title: string;
  selected?: number;
  total?: number;
  onSelectAll?: () => void;
  children: React.ReactNode;
}) {
  const isActive = selected != null && total != null && selected !== total;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
            {title}
          </p>
          {isActive && (
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-blue-500" />
          )}
        </div>
        {onSelectAll && (
          <button
            type="button"
            onClick={onSelectAll}
            disabled={!isActive}
            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition-colors ${
              isActive ? "text-blue-600 hover:bg-blue-50" : "cursor-default text-gray-300"
            }`}
            title={isActive ? "Clear this filter (select all)" : "All options selected"}
          >
            Any
          </button>
        )}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

/** Single checkbox row used inside FilterSection. */
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
    <label className="group flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg px-2 py-2.5 text-[15px] text-gray-800 hover:bg-gray-50 md:min-h-0 md:gap-2 md:px-1.5 md:py-1 md:text-sm md:text-gray-700">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="h-5 w-5 flex-shrink-0 cursor-pointer rounded border-gray-300 text-blue-600 md:h-4 md:w-4"
      />
      <span className="min-w-0 flex-1 break-words">{label}</span>
      {onOnly && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onOnly();
          }}
          className="ml-auto flex-shrink-0 rounded px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-blue-600 hover:bg-blue-50 md:hidden md:px-1.5 md:py-0.5 md:text-[10px] md:group-hover:inline"
        >
          Only
        </button>
      )}
    </label>
  );
}
