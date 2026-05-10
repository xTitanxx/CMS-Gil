"use client";

import { useState } from "react";
import { Sparkles, ChevronDown } from "lucide-react";

interface AiReasoningTipProps {
  reasoning: string | null;
}

export function AiReasoningTip({ reasoning }: AiReasoningTipProps) {
  const [open, setOpen] = useState(false);

  if (!reasoning) return null;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-[12px] text-[#7a7870] hover:text-[#3a3832] transition-colors"
      >
        <Sparkles className="h-3 w-3" />
        <span>Why this?</span>
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <p className="mt-1.5 rounded-[8px] bg-[#1c1b19] px-3 py-2 text-[12px] leading-relaxed text-white/90">
          {reasoning}
        </p>
      )}
    </div>
  );
}
