"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

export default function NewPostPage() {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [originalDate, setOriginalDate] = useState(
    new Date().toISOString().slice(0, 16)
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    if (!body.trim()) return;
    setLoading(true);
    setError("");
    const res = await fetch("/api/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: body, originalDate }),
    });
    if (res.ok) {
      const post = await res.json();
      router.push(`/posts/${post.id}`);
    } else {
      const data = await res.json();
      setError(data.error ?? "Failed to create post");
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/posts">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">New Post</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Compose</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Post date
            </label>
            <input
              type="datetime-local"
              value={originalDate}
              onChange={(e) => setOriginalDate(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Content
            </label>
            <textarea
              rows={8}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write your post..."
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none resize-none"
            />
            <p className="mt-1 text-xs text-gray-400">{body.length} characters</p>
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}

          <Button onClick={save} disabled={loading || !body.trim()}>
            {loading ? "Saving..." : "Save Post"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
