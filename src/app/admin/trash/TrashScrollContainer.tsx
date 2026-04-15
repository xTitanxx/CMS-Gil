"use client";

import { useEffect, useRef } from "react";

const KEY = "trash-scroll";

export function TrashScrollContainer({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const saved = sessionStorage.getItem(KEY);
    if (saved) {
      const n = Number(saved);
      if (!Number.isNaN(n)) el.scrollTop = n;
    }
    let frame = 0;
    function onScroll() {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (el) sessionStorage.setItem(KEY, String(el.scrollTop));
      });
    }
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
