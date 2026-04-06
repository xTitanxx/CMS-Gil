# Content Calendar — Design Spec

**Date:** 2026-04-06  
**Route:** `/scheduled`  
**Status:** Approved

---

## Overview

A visual content calendar at `/scheduled` (already linked in the sidebar) showing scheduled and published posts as thumbnails on the days they are associated with. Supports month and week zoom levels. Clicking a day opens a right-side panel to view that day's posts and schedule new ones.

---

## Data Model

The calendar surfaces three kinds of entries, each placed at a specific date:

| Type | Date field | Color |
|---|---|---|
| **Scheduled** — `PublishRecord` with status `PENDING` | `scheduledAt` | Blue |
| **Published** — `PublishRecord` with status `PUBLISHED` | `publishedAt` | Green |
| **Imported** — `Post` with `source=FACEBOOK` and no `PublishRecord` | `originalDate` | Gray |

A single post can appear on multiple calendar dates if it has PublishRecords on different dates (e.g., scheduled for Instagram on Monday and LinkedIn on Wednesday). Manually created posts with no PublishRecord are not shown.

---

## API

### `GET /api/calendar?start=YYYY-MM-DD&end=YYYY-MM-DD`

Returns a flat array of calendar entries for the given date range. The client passes:
- Month view: ~35-day window (first visible day to last visible day of the grid)
- Week view: 7-day window

**Response:**
```ts
{
  entries: {
    postId: string
    date: string          // ISO date string (YYYY-MM-DD)
    status: "PENDING" | "PUBLISHED" | "IMPORTED"
    platform?: Platform   // undefined for IMPORTED entries
    thumbUrl: string | null
    body: string
  }[]
}
```

Auth: requires session, scoped to `userId`.

---

## Components

```
/scheduled/page.tsx              ← server component shell (layout only)
  ContentCalendar.tsx            ← "use client", owns all calendar state
    CalendarHeader               ← view toggle + period navigation
    MonthView                    ← 7-col grid
      DayCell                    ← date + thumbnails + overflow count
    WeekView                     ← 7-col grid, taller columns
    DayPanel                     ← right-side drawer
      PostList                   ← scrollable list of that day's entries
      PostSearch                 ← AI search (shown when scheduling existing post)
      PlatformPicker             ← platform checkboxes + confirm (shown after selecting a post)
```

### State in `ContentCalendar`

```ts
view: "month" | "week"
cursor: Date              // drives which period is shown
selectedDay: Date | null  // drives DayPanel open/close
entries: CalendarEntry[]  // fetched when cursor changes
```

---

## Views

### Month View

- 7-column grid (Sun–Sat), 5–6 rows
- Each day cell:
  - Date number top-left; today highlighted with a blue dot
  - Up to 3 post thumbnails (28×28px squares), colored ring indicates status
  - "+N" overflow label if >3 posts on that day
  - Click anywhere on cell → opens DayPanel

### Week View

- 7-column grid (Sun–Sat), single row of taller columns
- Each column header: abbreviated day + date (e.g. "Mon 7")
- Each post shown as a small card: thumbnail + truncated body + platform badge(s)
- Column scrolls vertically if many posts

### Calendar Header

- Left: `< [Period label] >` navigation (arrows + period string)
  - Month: "April 2026"
  - Week: "Apr 6–12"
- Right: pill toggle **Month | Week**

---

## Day Panel

Fixed right-side drawer, ~320px wide, slides in on day click.

**Header:** formatted date ("Monday, April 6")

**Body:** scrollable list of posts for that day:
- Each row: thumbnail + body snippet + platform badge + status color dot
- Clicking a post navigates to `/posts/[id]`

**Footer actions:**
1. **New post** → navigates to `/posts/new`
2. **Schedule existing** → expands AI search inline:
   - User types query → calls `/api/posts/ai-search`
   - Results shown as a scrollable list
   - Clicking a result shows `PlatformPicker` (checkboxes for connected platforms)
   - Confirm → `POST /api/posts/[id]/publish` with `{ platforms, scheduledAt: selectedDay }`
   - On success: close picker, refresh calendar entries

---

## Files to Create / Modify

| File | Action |
|---|---|
| `src/app/(dashboard)/scheduled/page.tsx` | Create — server component shell |
| `src/app/(dashboard)/scheduled/ContentCalendar.tsx` | Create — main client component |
| `src/app/(dashboard)/scheduled/MonthView.tsx` | Create |
| `src/app/(dashboard)/scheduled/WeekView.tsx` | Create |
| `src/app/(dashboard)/scheduled/DayPanel.tsx` | Create |
| `src/app/api/calendar/route.ts` | Create — calendar data API |

No modifications needed to existing files (sidebar already has the `/scheduled` link).

---

## Edge Cases

- **Empty days:** cells render with just the date number, still clickable
- **No entries in range:** calendar renders normally, DayPanel shows "Nothing scheduled for this day"
- **Post with multiple PublishRecords on the same day:** each record is a separate entry
- **Timezone:** all dates stored as UTC in DB; calendar renders in the user's local timezone (client-side `Date` handling)
- **PlatformPicker:** only shows platforms the user has connected (from existing connections page logic)
