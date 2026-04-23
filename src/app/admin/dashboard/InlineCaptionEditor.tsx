"use client";

import { useEffect, useRef, useState } from "react";
import { useAutoSavePost } from "@/hooks/useAutoSavePost";

interface InlineCaptionEditorProps {
  postId: string;
  initialBody: string;
  isOpen: boolean;
  onToggle: () => void;
  onBodyChange: (newBody: string) => void;
}

export function InlineCaptionEditor({
  postId,
  initialBody,
  isOpen,
  onToggle,
  onBodyChange,
}: InlineCaptionEditorProps) {
  const [draft, setDraft] = useState(initialBody);
  const { save, status } = useAutoSavePost(postId);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isOpen && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = textareaRef.current.scrollHeight + "px";
    }
  }, [isOpen]);

  useEffect(() => {
    setDraft(initialBody);
  }, [initialBody]);

  if (!isOpen) {
    return (
      <button onClick={onToggle} className="min-w-0 flex-1 text-left">
        <p className="line-clamp-2 text-sm leading-relaxed text-gray-700 hover:text-blue-700 transition-colors md:line-clamp-3 md:text-base">
          {initialBody}
        </p>
      </button>
    );
  }

  return (
    <div className="min-w-0 flex-1 space-y-1.5">
      <textarea
        ref={textareaRef}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          save({ body: e.target.value });
          onBodyChange(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") onToggle();
        }}
        className="w-full resize-none rounded-md border border-gray-300 bg-white p-2 text-sm text-gray-800 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
        style={{ minHeight: 60 }}
        onInput={(e) => {
          const el = e.currentTarget;
          el.style.height = "auto";
          el.style.height = el.scrollHeight + "px";
        }}
      />
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <div
            className={`h-2 w-2 rounded-full transition-colors ${
              status === "saving" ? "animate-pulse bg-blue-400" :
              status === "saved" ? "bg-green-400" :
              status === "error" ? "bg-red-400" :
              "bg-gray-300"
            }`}
          />
          <span className="text-[10px] text-gray-400">
            {status === "saving" ? "Saving…" : status === "saved" ? "Saved" : status === "error" ? "Error" : ""}
          </span>
        </div>
        <button
          onClick={onToggle}
          className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-700"
        >
          Done
        </button>
      </div>
    </div>
  );
}
