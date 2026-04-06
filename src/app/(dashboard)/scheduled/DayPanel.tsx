// src/app/(dashboard)/scheduled/DayPanel.tsx

"use client";

import { useState, useEffect } from "react";
import { format } from "date-fns";
import {
  X,
  Plus,
  Sparkles,
  ChevronRight,
  Search,
  ImageIcon,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { CalendarEntry } from "./types";

interface SearchPost {
  id: string;
  body: string;
  thumbUrl: string | null;
  tags: string[];
  media: { id: string; mimeType: string }[];
}

interface Props {
  day: Date;
  entries: CalendarEntry[];
  onClose: () => void;
  onScheduled: () => void;
}

const PLATFORM_LABELS: Record<string, string> = {
  INSTAGRAM: "Instagram",
  LINKEDIN: "LinkedIn",
  YOUTUBE: "YouTube",
  TIKTOK: "TikTok",
};

const STATUS_DOT: Record<string, string> = {
  PENDING: "bg-blue-400",
  PUBLISHED: "bg-green-400",
  IMPORTED: "bg-gray-300",
};

export function DayPanel({ day, entries, onClose, onScheduled }: Props) {
  const [mode, setMode] = useState<"default" | "search" | "pick-platform">(
    "default"
  );
  const [aiQuery, setAiQuery] = useState("");
  const [aiSearching, setAiSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchPost[]>([]);
  const [selectedPost, setSelectedPost] = useState<SearchPost | null>(null);
  const [connectedPlatforms, setConnectedPlatforms] = useState<string[]>([]);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [scheduling, setScheduling] = useState(false);

  useEffect(() => {
    fetch("/api/connections")
      .then((r) => r.json())
      .then((data) => {
        const platforms: string[] =
          data.tokens?.map((t: { platform: string }) => t.platform) ?? [];
        if (data.youtube?.connected) platforms.push("YOUTUBE");
        setConnectedPlatforms(platforms);
      })
      .catch(() => {});
  }, []);

  async function handleAiSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!aiQuery.trim()) return;
    setAiSearching(true);
    setSearchResults([]);
    try {
      const searchRes = await fetch("/api/posts/ai-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: aiQuery }),
      });
      const { tags, keywords } = await searchRes.json();

      const params = new URLSearchParams({ limit: "10" });
      if (tags?.length) params.set("tags", (tags as string[]).join(","));
      if (keywords?.length) params.set("keywords", (keywords as string[]).join(","));

      const postsRes = await fetch(`/api/posts?${params}`);
      const postsData = await postsRes.json();
      setSearchResults(postsData.posts ?? []);
    } catch (err) {
      console.error("AI search failed:", err);
    } finally {
      setAiSearching(false);
    }
  }

  function selectPost(post: SearchPost) {
    setSelectedPost(post);
    setSelectedPlatforms([]);
    setMode("pick-platform");
  }

  async function handleSchedule() {
    if (!selectedPost || !selectedPlatforms.length) return;
    setScheduling(true);
    try {
      const res = await fetch(`/api/posts/${selectedPost.id}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platforms: selectedPlatforms,
          scheduledAt: day.toISOString(),
        }),
      });
      if (!res.ok) {
        console.error("Scheduling failed:", res.status);
        return;
      }
      setMode("default");
      setSelectedPost(null);
      setSelectedPlatforms([]);
      setAiQuery("");
      setSearchResults([]);
      onScheduled();
    } catch (err) {
      console.error("Scheduling error:", err);
    } finally {
      setScheduling(false);
    }
  }

  function resetToDefault() {
    setMode("default");
    setSelectedPost(null);
    setSelectedPlatforms([]);
    setAiQuery("");
    setSearchResults([]);
  }

  return (
    <div className="w-80 flex-shrink-0 border-l border-gray-200 bg-white flex flex-col h-full ml-4">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
        <span className="font-semibold text-gray-900">
          {format(day, "EEEE, MMMM d")}
        </span>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {/* Existing posts for this day */}
        {entries.length === 0 && mode === "default" && (
          <p className="text-sm text-gray-400">Nothing scheduled for this day.</p>
        )}
        {entries.map((entry) => (
          <Link
            key={entry.postId}
            href={`/posts/${entry.postId}`}
            className="flex items-start gap-2.5 rounded-lg border border-gray-100 bg-gray-50 p-2 hover:bg-gray-100 transition-colors"
          >
            <div className="w-10 h-10 flex-shrink-0 rounded overflow-hidden">
              {entry.thumbUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={entry.thumbUrl}
                  alt=""
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full bg-gray-200 flex items-center justify-center">
                  <ImageIcon className="w-4 h-4 text-gray-300" />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-gray-700 line-clamp-2">{entry.body}</p>
              <div className="flex items-center gap-1.5 mt-1">
                <span
                  className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_DOT[entry.status] ?? "bg-gray-300"}`}
                />
                {entry.platform && (
                  <span className="text-xs text-gray-400">
                    {PLATFORM_LABELS[entry.platform] ?? entry.platform}
                  </span>
                )}
              </div>
            </div>
          </Link>
        ))}

        {/* Search mode */}
        {mode === "search" && (
          <div className="space-y-2 pt-1">
            <form onSubmit={handleAiSearch} className="flex gap-1.5">
              <div className="relative flex-1">
                <Sparkles className="absolute left-2.5 top-2 h-3.5 w-3.5 text-purple-400" />
                <input
                  type="text"
                  placeholder="Search posts…"
                  value={aiQuery}
                  onChange={(e) => setAiQuery(e.target.value)}
                  autoFocus
                  className="w-full rounded-lg border border-purple-200 py-1.5 pl-8 pr-3 text-sm focus:border-purple-400 focus:outline-none"
                />
              </div>
              <Button
                type="submit"
                size="sm"
                disabled={aiSearching}
                className="bg-purple-600 hover:bg-purple-700 text-white px-2"
              >
                {aiSearching ? (
                  "…"
                ) : (
                  <Search className="h-3.5 w-3.5" />
                )}
              </Button>
            </form>

            {searchResults.map((post) => (
              <button
                key={post.id}
                onClick={() => selectPost(post)}
                className="w-full flex items-start gap-2 rounded-lg border border-gray-100 bg-gray-50 p-2 text-left hover:bg-gray-100 transition-colors"
              >
                <div className="w-9 h-9 flex-shrink-0 rounded overflow-hidden">
                  {post.thumbUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={post.thumbUrl}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full bg-gray-200 flex items-center justify-center">
                      <ImageIcon className="w-3 h-3 text-gray-300" />
                    </div>
                  )}
                </div>
                <p className="text-xs text-gray-700 line-clamp-2 flex-1">
                  {post.body}
                </p>
                <ChevronRight className="h-3.5 w-3.5 text-gray-300 flex-shrink-0 mt-0.5" />
              </button>
            ))}
          </div>
        )}

        {/* Platform picker mode */}
        {mode === "pick-platform" && selectedPost && (
          <div className="space-y-3 pt-1">
            {/* Selected post preview */}
            <div className="flex items-start gap-2 rounded-lg border border-purple-100 bg-purple-50 p-2">
              <div className="w-9 h-9 flex-shrink-0 rounded overflow-hidden">
                {selectedPost.thumbUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={selectedPost.thumbUrl}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-gray-200 flex items-center justify-center">
                    <ImageIcon className="w-3 h-3 text-gray-300" />
                  </div>
                )}
              </div>
              <p className="text-xs text-gray-700 line-clamp-2 flex-1">
                {selectedPost.body}
              </p>
            </div>

            <p className="text-xs font-medium text-gray-700">
              Publish to platform(s):
            </p>

            {connectedPlatforms.length === 0 ? (
              <p className="text-xs text-gray-400">
                No platforms connected.{" "}
                <Link href="/connections" className="text-blue-600 hover:underline">
                  Connect one
                </Link>
              </p>
            ) : (
              connectedPlatforms.map((platform) => (
                <label
                  key={platform}
                  className="flex items-center gap-2 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selectedPlatforms.includes(platform)}
                    onChange={(e) => {
                      setSelectedPlatforms((prev) =>
                        e.target.checked
                          ? [...prev, platform]
                          : prev.filter((p) => p !== platform)
                      );
                    }}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600"
                  />
                  <span className="text-sm text-gray-700">
                    {PLATFORM_LABELS[platform] ?? platform}
                  </span>
                </label>
              ))
            )}

            <div className="flex gap-2 pt-1">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setMode("search");
                  setSelectedPost(null);
                  setSelectedPlatforms([]);
                }}
                className="flex-1"
              >
                Back
              </Button>
              <Button
                size="sm"
                disabled={!selectedPlatforms.length || scheduling}
                onClick={handleSchedule}
                className="flex-1"
              >
                {scheduling ? "Scheduling…" : "Schedule"}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Footer — only in default mode */}
      {mode === "default" && (
        <div className="px-4 py-3 border-t border-gray-200 space-y-2">
          <Link href="/posts/new">
            <Button variant="outline" size="sm" className="w-full justify-start gap-2">
              <Plus className="h-4 w-4" />
              New post
            </Button>
          </Link>
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start gap-2"
            onClick={() => setMode("search")}
          >
            <Sparkles className="h-4 w-4 text-purple-500" />
            Schedule existing post
          </Button>
        </div>
      )}

      {/* Footer — cancel button in search/pick-platform mode */}
      {mode !== "default" && (
        <div className="px-4 py-3 border-t border-gray-200">
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-gray-500"
            onClick={resetToDefault}
          >
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
