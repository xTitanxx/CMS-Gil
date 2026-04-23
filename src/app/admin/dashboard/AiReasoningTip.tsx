"use client";

import { Sparkles } from "lucide-react";

interface AiReasoningTipProps {
  reasoning: string | null;
}

export function AiReasoningTip({ reasoning }: AiReasoningTipProps) {
  if (!reasoning) return null;

  return (
    <div className="flex items-start gap-2 pt-2" title={reasoning}>
      <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-purple-400" />
      <p className="line-clamp-1 text-[13px] italic leading-snug text-purple-500/70">{reasoning}</p>
    </div>
  );
}
