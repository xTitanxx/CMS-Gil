"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Copy, Check, Download } from "lucide-react";

interface ManualFacebookActionsProps {
  body: string;
  postId: string;
}

export function ManualFacebookActions({ body, postId }: ManualFacebookActionsProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(body);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        onClick={handleCopy}
        className="h-7 gap-1.5 px-2 text-xs"
      >
        {copied ? (
          <>
            <Check className="h-3.5 w-3.5 text-green-600" />
            <span className="text-green-600">Copied!</span>
          </>
        ) : (
          <>
            <Copy className="h-3.5 w-3.5" />
            Copy caption
          </>
        )}
      </Button>

      <Button
        size="sm"
        variant="outline"
        asChild
        className="h-7 gap-1.5 px-2 text-xs"
      >
        <a href={`/admin/posts/${postId}`} target="_blank" rel="noopener noreferrer">
          <Download className="h-3.5 w-3.5" />
          Download media
        </a>
      </Button>
    </div>
  );
}
