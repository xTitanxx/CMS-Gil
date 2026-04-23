"use client";

import { useState } from "react";

/**
 * Small chip that shows a truncated Post.id and copies the full id to the
 * clipboard on click. Stops event propagation so clicking it inside a <Link>
 * row doesn't trigger navigation.
 */
export function CopyIdChip({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        navigator.clipboard.writeText(id);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      title={`Click to copy: ${id}`}
      className="cursor-pointer rounded bg-gray-100 px-1 py-0.5 font-mono text-[10px] text-gray-500 hover:bg-gray-200 hover:text-gray-700"
    >
      {copied ? "copied" : id.slice(0, 8) + "…"}
    </button>
  );
}
