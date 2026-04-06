# Content Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/scheduled` calendar page with month/week views that shows scheduled and published posts as thumbnails, and lets users schedule existing posts to a day via AI search.

**Architecture:** A single API route (`GET /api/calendar`) fetches PublishRecords and imported posts for a date range. A client-side `ContentCalendar` component owns view state (month/week), cursor navigation, and selected-day panel. Pure date utility functions (`calendar-utils.ts`) are shared across components and tested in isolation.

**Tech Stack:** Next.js 15 App Router, React 19, Prisma 7, date-fns (already installed), Tailwind CSS, shadcn/ui Button/Badge, Vitest (node environment)

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/app/(dashboard)/scheduled/types.ts` | Create | Shared `CalendarEntry` type |
| `src/app/(dashboard)/scheduled/calendar-utils.ts` | Create | Pure date functions: grid days, date range, group by date |
| `src/app/(dashboard)/scheduled/calendar-utils.test.ts` | Create | Unit tests for calendar-utils |
| `src/app/api/calendar/route.ts` | Create | GET handler: query PublishRecords + imported posts |
| `src/app/(dashboard)/scheduled/page.tsx` | Create | Server component shell |
| `src/app/(dashboard)/scheduled/ContentCalendar.tsx` | Create | Client component: state, fetch, view toggle, navigation |
| `src/app/(dashboard)/scheduled/MonthView.tsx` | Create | 7-col month grid with DayCell thumbnails |
| `src/app/(dashboard)/scheduled/WeekView.tsx` | Create | 7-col week grid with post cards |
| `src/app/(dashboard)/scheduled/DayPanel.tsx` | Create | Right drawer: post list, AI search, platform picker |

---

## Task 1: Shared types + date utilities

**Files:**
- Create: `src/app/(dashboard)/scheduled/types.ts`
- Create: `src/app/(dashboard)/scheduled/calendar-utils.ts`
- Create: `src/app/(dashboard)/scheduled/calendar-utils.test.ts`

- [ ] **Step 1: Create the types file**

```typescript
// src/app/(dashboard)/scheduled/types.ts

export interface CalendarEntry {
  postId: string;
  date: string; // YYYY-MM-DD
  status: "PENDING" | "PUBLISHED" | "IMPORTED";
  platform?: string;
  thumbUrl: string | null;
  body: string;
}
```

- [ ] **Step 2: Create calendar-utils.ts**

```typescript
// src/app/(dashboard)/scheduled/calendar-utils.ts

import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
} from "date-fns";
import type { CalendarEntry } from "./types";

export function getGridDays(view: "month" | "week", cursor: Date): Date[] {
  if (view === "week") {
    return eachDayOfInterval({
      start: startOfWeek(cursor),
      end: endOfWeek(cursor),
    });
  }
  const monthStart = startOfMonth(cursor);
  const monthEnd = endOfMonth(cursor);
  return eachDayOfInterval({
    start: startOfWeek(monthStart),
    end: endOfWeek(monthEnd),
  });
}

export function getDateRange(
  view: "month" | "week",
  cursor: Date
): { start: Date; end: Date } {
  const days = getGridDays(view, cursor);
  return { start: days[0], end: days[days.length - 1] };
}

export function groupEntriesByDate(
  entries: CalendarEntry[]
): Record<string, CalendarEntry[]> {
  return entries.reduce(
    (acc, entry) => {
      if (!acc[entry.date]) acc[entry.date] = [];
      acc[entry.date].push(entry);
      return acc;
    },
    {} as Record<string, CalendarEntry[]>
  );
}
```

- [ ] **Step 3: Write the test file**

```typescript
// src/app/(dashboard)/scheduled/calendar-utils.test.ts

import { describe, it, expect } from "vitest";
import { getGridDays, getDateRange, groupEntriesByDate } from "./calendar-utils";
import type { CalendarEntry } from "./types";

describe("getGridDays", () => {
  it("month view: returns 35+ days, starts Sunday, ends Saturday", () => {
    const cursor = new Date("2026-04-15");
    const days = getGridDays("month", cursor);
    expect(days.length).toBeGreaterThanOrEqual(35);
    expect(days[0].getDay()).toBe(0);
    expect(days[days.length - 1].getDay()).toBe(6);
  });

  it("week view: returns exactly 7 days, starts Sunday, ends Saturday", () => {
    const cursor = new Date("2026-04-15");
    const days = getGridDays("week", cursor);
    expect(days.length).toBe(7);
    expect(days[0].getDay()).toBe(0);
    expect(days[6].getDay()).toBe(6);
  });
});

describe("getDateRange", () => {
  it("start <= end and start is a Sunday", () => {
    const { start, end } = getDateRange("month", new Date("2026-04-15"));
    expect(start <= end).toBe(true);
    expect(start.getDay()).toBe(0);
  });

  it("week range spans exactly 7 days", () => {
    const { start, end } = getDateRange("week", new Date("2026-04-15"));
    const diff = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
    expect(diff).toBe(6);
  });
});

describe("groupEntriesByDate", () => {
  it("groups entries by date key", () => {
    const entries: CalendarEntry[] = [
      { postId: "a", date: "2026-04-06", status: "PENDING", thumbUrl: null, body: "foo" },
      { postId: "b", date: "2026-04-06", status: "PUBLISHED", thumbUrl: null, body: "bar" },
      { postId: "c", date: "2026-04-07", status: "IMPORTED", thumbUrl: null, body: "baz" },
    ];
    const grouped = groupEntriesByDate(entries);
    expect(grouped["2026-04-06"]).toHaveLength(2);
    expect(grouped["2026-04-07"]).toHaveLength(1);
    expect(grouped["2026-04-08"]).toBeUndefined();
  });

  it("returns empty object for no entries", () => {
    expect(groupEntriesByDate([])).toEqual({});
  });
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- calendar-utils`

Expected output: `5 tests passed`

- [ ] **Step 5: Commit**

```bash
git add src/app/\(dashboard\)/scheduled/types.ts src/app/\(dashboard\)/scheduled/calendar-utils.ts src/app/\(dashboard\)/scheduled/calendar-utils.test.ts
git commit -m "feat: add calendar types and date utilities"
```

---

## Task 2: Calendar API route

**Files:**
- Create: `src/app/api/calendar/route.ts`

- [ ] **Step 1: Create the route**

```typescript
// src/app/api/calendar/route.ts

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getSignedDownloadUrl } from "@/lib/storage";

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const start = req.nextUrl.searchParams.get("start");
  const end = req.nextUrl.searchParams.get("end");
  if (!start || !end) {
    return NextResponse.json({ error: "start and end required" }, { status: 400 });
  }

  const startDate = new Date(`${start}T00:00:00.000Z`);
  const endDate = new Date(`${end}T23:59:59.999Z`);
  const userId = session.user.id;

  const [publishRecords, importedPosts] = await Promise.all([
    prisma.publishRecord.findMany({
      where: {
        post: { userId },
        OR: [
          { status: "PENDING", scheduledAt: { gte: startDate, lte: endDate } },
          { status: "PUBLISHED", publishedAt: { gte: startDate, lte: endDate } },
        ],
      },
      include: {
        post: { include: { media: { take: 1 } } },
      },
    }),
    prisma.post.findMany({
      where: {
        userId,
        source: "FACEBOOK",
        originalDate: { gte: startDate, lte: endDate },
        publishes: { none: {} },
      },
      include: { media: { take: 1 } },
    }),
  ]);

  const entries = await Promise.all([
    ...publishRecords.map(async (r) => {
      const media = r.post.media[0];
      const thumbUrl = media
        ? await getSignedDownloadUrl(media.storageKey, 3600, media.mimeType).catch(() => null)
        : null;
      const date = r.status === "PUBLISHED" ? r.publishedAt! : r.scheduledAt!;
      return {
        postId: r.postId,
        date: toDateKey(date),
        status: r.status as "PENDING" | "PUBLISHED",
        platform: r.platform as string,
        thumbUrl,
        body: r.post.body,
      };
    }),
    ...importedPosts.map(async (p) => {
      const media = p.media[0];
      const thumbUrl = media
        ? await getSignedDownloadUrl(media.storageKey, 3600, media.mimeType).catch(() => null)
        : null;
      return {
        postId: p.id,
        date: toDateKey(p.originalDate),
        status: "IMPORTED" as const,
        platform: undefined as string | undefined,
        thumbUrl,
        body: p.body,
      };
    }),
  ]);

  return NextResponse.json({ entries });
}
```

- [ ] **Step 2: Manually verify the route**

Start dev server (`npm run dev`), open browser to:
`http://localhost:3000/api/calendar?start=2026-04-01&end=2026-04-30`

Expected: JSON with `{ entries: [...] }` (may be empty if no scheduled posts, but no 500 error).

- [ ] **Step 3: Commit**

```bash
git add src/app/api/calendar/route.ts
git commit -m "feat: add GET /api/calendar route"
```

---

## Task 3: Page shell + ContentCalendar

**Files:**
- Create: `src/app/(dashboard)/scheduled/page.tsx`
- Create: `src/app/(dashboard)/scheduled/ContentCalendar.tsx`

- [ ] **Step 1: Create the server component page shell**

```tsx
// src/app/(dashboard)/scheduled/page.tsx

import { ContentCalendar } from "./ContentCalendar";

export default function ScheduledPage() {
  return (
    <div className="flex flex-col h-full space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Content Calendar</h1>
        <p className="text-sm text-gray-500">Scheduled and published posts</p>
      </div>
      <div className="flex-1 min-h-0">
        <ContentCalendar />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create ContentCalendar.tsx**

```tsx
// src/app/(dashboard)/scheduled/ContentCalendar.tsx

"use client";

import { useState, useEffect, useCallback } from "react";
import {
  format,
  addMonths,
  subMonths,
  addWeeks,
  subWeeks,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MonthView } from "./MonthView";
import { WeekView } from "./WeekView";
import { DayPanel } from "./DayPanel";
import { getGridDays, getDateRange } from "./calendar-utils";
import type { CalendarEntry } from "./types";

export function ContentCalendar() {
  const [view, setView] = useState<"month" | "week">("month");
  const [cursor, setCursor] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [entries, setEntries] = useState<CalendarEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    const { start, end } = getDateRange(view, cursor);
    const params = new URLSearchParams({
      start: format(start, "yyyy-MM-dd"),
      end: format(end, "yyyy-MM-dd"),
    });
    const res = await fetch(`/api/calendar?${params}`);
    const data = await res.json();
    setEntries(data.entries ?? []);
    setLoading(false);
  }, [view, cursor]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  function navigate(dir: 1 | -1) {
    setCursor((c) =>
      view === "month"
        ? dir === 1 ? addMonths(c, 1) : subMonths(c, 1)
        : dir === 1 ? addWeeks(c, 1) : subWeeks(c, 1)
    );
  }

  function periodLabel() {
    if (view === "month") return format(cursor, "MMMM yyyy");
    const days = getGridDays("week", cursor);
    const start = days[0];
    const end = days[6];
    return format(start, "MMM d") + "–" + format(end, "d, yyyy");
  }

  return (
    <div className="flex h-full gap-0">
      {/* Calendar area */}
      <div className="flex-1 min-w-0 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-base font-semibold w-44 text-center">
              {periodLabel()}
            </span>
            <Button variant="ghost" size="icon" onClick={() => navigate(1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            <button
              onClick={() => setView("month")}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                view === "month"
                  ? "bg-blue-600 text-white"
                  : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              Month
            </button>
            <button
              onClick={() => setView("week")}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                view === "week"
                  ? "bg-blue-600 text-white"
                  : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              Week
            </button>
          </div>
        </div>

        {/* Grid */}
        {loading ? (
          <div className="h-96 flex items-center justify-center text-gray-400 text-sm">
            Loading…
          </div>
        ) : view === "month" ? (
          <MonthView
            cursor={cursor}
            entries={entries}
            onDayClick={setSelectedDay}
            selectedDay={selectedDay}
          />
        ) : (
          <WeekView
            cursor={cursor}
            entries={entries}
            onDayClick={setSelectedDay}
            selectedDay={selectedDay}
          />
        )}
      </div>

      {/* Day panel */}
      {selectedDay && (
        <DayPanel
          day={selectedDay}
          entries={entries.filter(
            (e) => e.date === format(selectedDay, "yyyy-MM-dd")
          )}
          onClose={() => setSelectedDay(null)}
          onScheduled={fetchEntries}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify the page loads**

Navigate to `http://localhost:3000/scheduled`. Expected: heading "Content Calendar" with a loading spinner then an empty calendar grid. No console errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(dashboard\)/scheduled/page.tsx src/app/\(dashboard\)/scheduled/ContentCalendar.tsx
git commit -m "feat: add ContentCalendar with view toggle and navigation"
```

---

## Task 4: MonthView

**Files:**
- Create: `src/app/(dashboard)/scheduled/MonthView.tsx`

- [ ] **Step 1: Create MonthView.tsx**

```tsx
// src/app/(dashboard)/scheduled/MonthView.tsx

"use client";

import { format, isSameMonth, isToday, isSameDay } from "date-fns";
import { ImageIcon } from "lucide-react";
import { getGridDays, groupEntriesByDate } from "./calendar-utils";
import type { CalendarEntry } from "./types";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const STATUS_RING: Record<string, string> = {
  PENDING: "ring-2 ring-blue-400",
  PUBLISHED: "ring-2 ring-green-400",
  IMPORTED: "ring-2 ring-gray-300",
};

interface Props {
  cursor: Date;
  entries: CalendarEntry[];
  onDayClick: (day: Date) => void;
  selectedDay: Date | null;
}

export function MonthView({ cursor, entries, onDayClick, selectedDay }: Props) {
  const days = getGridDays("month", cursor);
  const grouped = groupEntriesByDate(entries);

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 border-b border-gray-200 bg-gray-50">
        {DAY_LABELS.map((d) => (
          <div
            key={d}
            className="py-2 text-center text-xs font-medium text-gray-500"
          >
            {d}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7">
        {days.map((day, i) => {
          const key = format(day, "yyyy-MM-dd");
          const dayEntries = grouped[key] ?? [];
          const isCurrentMonth = isSameMonth(day, cursor);
          const isSelected = selectedDay ? isSameDay(day, selectedDay) : false;

          return (
            <button
              key={i}
              onClick={() => onDayClick(day)}
              className={[
                "min-h-[80px] p-1.5 border-b border-r border-gray-100 text-left",
                "hover:bg-blue-50 transition-colors",
                !isCurrentMonth ? "bg-gray-50" : "bg-white",
                isSelected ? "bg-blue-50" : "",
              ].join(" ")}
            >
              {/* Date number */}
              <span
                className={[
                  "text-xs font-medium w-5 h-5 flex items-center justify-center rounded-full mb-1",
                  isToday(day)
                    ? "bg-blue-600 text-white"
                    : isCurrentMonth
                    ? "text-gray-800"
                    : "text-gray-400",
                ].join(" ")}
              >
                {format(day, "d")}
              </span>

              {/* Thumbnails */}
              <div className="flex flex-wrap gap-0.5">
                {dayEntries.slice(0, 3).map((entry, idx) => (
                  <div
                    key={idx}
                    className={`w-7 h-7 rounded overflow-hidden flex-shrink-0 ${STATUS_RING[entry.status] ?? ""}`}
                  >
                    {entry.thumbUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={entry.thumbUrl}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full bg-gray-100 flex items-center justify-center">
                        <ImageIcon className="w-3 h-3 text-gray-300" />
                      </div>
                    )}
                  </div>
                ))}
                {dayEntries.length > 3 && (
                  <span className="text-xs text-gray-400 self-end ml-0.5">
                    +{dayEntries.length - 3}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify visually**

Navigate to `http://localhost:3000/scheduled` in month view. Expected: a 7-column grid with today's date highlighted by a blue circle. Clicking any day should open the DayPanel (will be a placeholder until Task 6).

- [ ] **Step 3: Commit**

```bash
git add src/app/\(dashboard\)/scheduled/MonthView.tsx
git commit -m "feat: add MonthView with thumbnail cells"
```

---

## Task 5: WeekView

**Files:**
- Create: `src/app/(dashboard)/scheduled/WeekView.tsx`

- [ ] **Step 1: Create WeekView.tsx**

```tsx
// src/app/(dashboard)/scheduled/WeekView.tsx

"use client";

import { format, isToday, isSameDay } from "date-fns";
import Link from "next/link";
import { ImageIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { getGridDays, groupEntriesByDate } from "./calendar-utils";
import type { CalendarEntry } from "./types";

const STATUS_CARD: Record<string, string> = {
  PENDING: "bg-blue-50 border-blue-200",
  PUBLISHED: "bg-green-50 border-green-200",
  IMPORTED: "bg-gray-50 border-gray-200",
};

const BADGE_VARIANT: Record<string, "secondary" | "success" | "outline"> = {
  PENDING: "secondary",
  PUBLISHED: "success",
  IMPORTED: "outline",
};

interface Props {
  cursor: Date;
  entries: CalendarEntry[];
  onDayClick: (day: Date) => void;
  selectedDay: Date | null;
}

export function WeekView({ cursor, entries, onDayClick, selectedDay }: Props) {
  const days = getGridDays("week", cursor);
  const grouped = groupEntriesByDate(entries);

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <div className="grid grid-cols-7 divide-x divide-gray-100">
        {days.map((day, i) => {
          const key = format(day, "yyyy-MM-dd");
          const dayEntries = grouped[key] ?? [];
          const isSelected = selectedDay ? isSameDay(day, selectedDay) : false;

          return (
            <div
              key={i}
              className={`flex flex-col min-h-[400px] ${isSelected ? "bg-blue-50" : "bg-white"}`}
            >
              {/* Column header — clicking it opens the DayPanel */}
              <button
                onClick={() => onDayClick(day)}
                className="py-2 text-center border-b border-gray-100 hover:bg-gray-50 transition-colors w-full"
              >
                <div className="text-xs text-gray-500">{format(day, "EEE")}</div>
                <div
                  className={[
                    "text-sm font-medium mx-auto w-7 h-7 flex items-center justify-center rounded-full",
                    isToday(day) ? "bg-blue-600 text-white" : "text-gray-800",
                  ].join(" ")}
                >
                  {format(day, "d")}
                </div>
              </button>

              {/* Post cards */}
              <div className="flex-1 p-1 space-y-1 overflow-y-auto">
                {dayEntries.map((entry, idx) => (
                  <Link
                    key={idx}
                    href={`/posts/${entry.postId}`}
                    className={`flex items-start gap-1.5 p-1.5 rounded border text-left ${STATUS_CARD[entry.status] ?? ""} hover:opacity-80 transition-opacity`}
                  >
                    <div className="w-8 h-8 flex-shrink-0 rounded overflow-hidden">
                      {entry.thumbUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={entry.thumbUrl}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full bg-gray-100 flex items-center justify-center">
                          <ImageIcon className="w-3 h-3 text-gray-300" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-gray-700 line-clamp-2 leading-tight">
                        {entry.body}
                      </p>
                      {entry.platform && (
                        <Badge
                          variant={BADGE_VARIANT[entry.status] ?? "outline"}
                          className="text-xs mt-0.5 py-0 h-4"
                        >
                          {entry.platform}
                        </Badge>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify visually**

Switch to week view at `http://localhost:3000/scheduled`. Expected: 7 columns with abbreviated day names and date numbers. Posts (if any) appear as colored cards. Clicking a column header opens the DayPanel.

- [ ] **Step 3: Commit**

```bash
git add src/app/\(dashboard\)/scheduled/WeekView.tsx
git commit -m "feat: add WeekView with post cards"
```

---

## Task 6: DayPanel

**Files:**
- Create: `src/app/(dashboard)/scheduled/DayPanel.tsx`

- [ ] **Step 1: Create DayPanel.tsx**

```tsx
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
    setAiSearching(false);
  }

  function selectPost(post: SearchPost) {
    setSelectedPost(post);
    setSelectedPlatforms([]);
    setMode("pick-platform");
  }

  async function handleSchedule() {
    if (!selectedPost || !selectedPlatforms.length) return;
    setScheduling(true);
    await fetch(`/api/posts/${selectedPost.id}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platforms: selectedPlatforms,
        scheduledAt: day.toISOString(),
      }),
    });
    setScheduling(false);
    setMode("default");
    setSelectedPost(null);
    setSelectedPlatforms([]);
    setAiQuery("");
    setSearchResults([]);
    onScheduled();
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
        {entries.map((entry, i) => (
          <Link
            key={i}
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

      {/* Footer — back button in search/pick-platform mode */}
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
```

- [ ] **Step 2: Full flow test**

1. Navigate to `http://localhost:3000/scheduled`
2. Click any day — panel slides in with date header and "Nothing scheduled" message
3. Click "Schedule existing post" — AI search input appears
4. Type a search query and submit — post results appear
5. Click a result — platform checkboxes appear
6. Check a platform and click "Schedule" — panel resets and calendar refreshes
7. The scheduled post thumbnail now appears on that day in the grid
8. Clicking a post in the panel navigates to `/posts/[id]`

- [ ] **Step 3: Commit**

```bash
git add src/app/\(dashboard\)/scheduled/DayPanel.tsx
git commit -m "feat: add DayPanel with AI search and platform picker"
```
