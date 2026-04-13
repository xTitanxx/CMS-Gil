"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export function BackButton() {
  const router = useRouter();
  const [canGoBack, setCanGoBack] = useState(false);

  useEffect(() => {
    setCanGoBack(window.history.length > 1);
  }, []);

  if (canGoBack) {
    return (
      <button
        onClick={() => router.back()}
        className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
      >
        ← Back to feed
      </button>
    );
  }

  return (
    <Link
      href="/"
      className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
    >
      ← Back to feed
    </Link>
  );
}
