"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Check, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Props {
  postId: string;
  currentBody: string;
  suggestion: string | null;
  quality: number | null;
  evergreen: boolean | null;
}

export function CaptionSuggestionPanel({
  postId,
  currentBody,
  suggestion,
  quality,
  evergreen,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(false);
  const router = useRouter();

  if (hidden) return null;

  async function accept() {
    setBusy(true);
    const res = await fetch(`/api/posts/${postId}/caption-suggestion`, { method: "POST" });
    setBusy(false);
    if (res.ok) {
      setHidden(true);
      router.refresh();
    }
  }

  async function dismiss() {
    setBusy(true);
    const res = await fetch(`/api/posts/${postId}/caption-suggestion`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) {
      setHidden(true);
      router.refresh();
    }
  }

  return (
    <Card className="border-amber-200 bg-amber-50">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-amber-600" />
          Caption improvement
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex flex-wrap gap-2 text-xs">
          {quality != null && (
            <span className="rounded-md border border-amber-200 bg-white px-2 py-0.5 text-amber-900">
              quality {quality}/5
            </span>
          )}
          {evergreen === false && (
            <span className="rounded-md border border-amber-200 bg-white px-2 py-0.5 text-amber-900">
              non-evergreen caption
            </span>
          )}
        </div>

        {suggestion && (
          <>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-amber-700">Current</p>
              <p className="mt-1 whitespace-pre-wrap rounded-md border border-amber-200 bg-white/70 p-2 text-gray-700">
                {currentBody}
              </p>
            </div>

            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-amber-700">Suggested</p>
              <p className="mt-1 whitespace-pre-wrap rounded-md border border-amber-200 bg-white p-2 text-gray-900">
                {suggestion}
              </p>
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={accept}
                disabled={busy}
                className="flex items-center gap-1 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
              >
                <Check className="h-3.5 w-3.5" />
                Accept
              </button>
              <button
                onClick={dismiss}
                disabled={busy}
                className="flex items-center gap-1 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
              >
                <X className="h-3.5 w-3.5" />
                Dismiss
              </button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
