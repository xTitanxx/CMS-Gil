# Weekly Planner Dashboard — Design Spec

**Date:** 2026-04-12
**Status:** Draft

## Overview

Replace the current dashboard home (stats cards + recent posts) with an AI-powered weekly content planner. Gil opens the dashboard once a week, the AI fills 7 days with recycled posts, Gil reviews/tweaks via an integrated chat, approves, and the system schedules publishing across all connected platforms automatically.

## Core Workflow

1. Gil opens the dashboard
2. Clicks "Plan My Week" (or types it in chat)
3. AI selects 7 posts — one per day — optimizing for tag diversity, recency, publish count, and evergreen suitability
4. Gil reviews the plan, swaps posts via chat or UI buttons
5. Gil approves (all at once or per-day)
6. System creates PublishRecords for each post × eligible platform
7. Existing cron job (`/api/cron/publish`) publishes them on schedule
8. Facebook personal profile remains manual — copy caption + download media

## Section 1: Dashboard Layout

### Two-Pane Split

**Left pane (~60%): Weekly Plan**
- 7 rows, Monday through Sunday, for the upcoming week
- Each row displays:
  - Day and date
  - Post thumbnail (first media item)
  - Body snippet (2 lines, truncated)
  - Tags as chips
  - Platform icons (auto-determined by media type)
  - AI reasoning (expandable tooltip: "You haven't posted cooking in 3 weeks")
- Row states: **empty**, **proposed**, **approved**, **scheduled**
- Row actions:
  - **Swap** — ask AI for an alternative
  - **Remove** — clear the slot
  - **Pin** — manually search and assign a specific post
  - **Approve** — lock in this day individually
- Header: **"Plan My Week"** button to trigger AI generation
- Footer: **"Approve & Schedule"** button to commit all proposed posts

**Right pane (~40%): AI Chat**
- Persistent chat panel with planning-aware system prompt
- Supports natural language commands that mutate the plan
- Suggested prompts on empty state: "Plan my week", "Focus on uplifting content", "Include something about cooking"
- Proactive personality — explains picks, flags patterns, suggests swaps

**Stats relocation:** Total posts / published / scheduled counts move to a compact bar above the planner or into the sidebar.

## Section 2: AI Recommendation Engine

### Candidate Selection

The AI receives a curated context payload to make recommendations:

**Candidate pool** — posts eligible for recycling:
- Has at least one media item preferred (text-only posts are eligible but deprioritized since they only reach Facebook + LinkedIn)
- Not published to any platform in the last 4 weeks
- Not already scheduled for a future date
- Lower `publishCount` preferred over higher

**Context provided to AI:**
1. Candidate posts: body snippet, tags, original date, media types (photo/video/audio), last published date, publishCount
2. Recent publishing history: last 4-6 weeks of published posts with tags — so the AI sees topic distribution
3. Tag vocabulary: full list of tags with frequency counts — the AI knows the content universe
4. Gil's optional preferences from the chat message (e.g., "heavy on food this week")

### Selection Logic (in the AI prompt)

- **Tag diversity across the week** — spread topics; don't cluster similar content on consecutive days
- **Recency avoidance** — prefer posts not recycled recently; enforce 4-week minimum gap
- **Publish count fairness** — deprioritize posts recycled many times; favor under-used content
- **Evergreen detection** — skip posts that are clearly time-bound (holiday-specific, news reactions, birthday posts, dated references like "today I..." with temporal context). Use judgment from text + tags, not a hard rule.
- **Future: engagement signals** — when PostAnalytics data flows in from Instagram/YouTube/etc., high-performing posts get a boost. Not built now, but the prompt structure accommodates it.

### AI Response Format

Structured JSON: array of 7 objects:
```json
[
  {
    "day": "2026-04-14",
    "postId": "clx...",
    "reasoning": "You haven't posted cooking content in 3 weeks, and this pasta recipe has only been shared twice."
  }
]
```

### Platform Auto-Assignment Per Post

Based on media types present:
| Media | Platforms |
|---|---|
| Has video | Facebook (manual), Instagram, LinkedIn, TikTok, YouTube |
| Photos only | Facebook (manual), Instagram, LinkedIn |
| Text only | Facebook (manual), LinkedIn |

Only platforms with an active PlatformToken connection are included.

## Section 3: Chat Integration & Tool Use

### Planning-Specific Chat Endpoint

New endpoint: `POST /api/chat/planner`

Differs from the existing `/api/chat`:
- Loads candidate pool + publishing history instead of raw post bodies
- Planning-aware system prompt with tool definitions
- Supports Claude tool use for plan mutations
- Returns both streamed text (conversational) and structured data (plan state changes)

### Chat Tools

| Tool | Description | Parameters |
|---|---|---|
| `plan_week` | Fill all empty slots with AI recommendations | `preferences?: string` (optional guidance) |
| `swap_day` | Replace a specific day's post | `day: string, reason?: string` |
| `remove_day` | Clear a day's slot | `day: string` |
| `assign_post` | Pin a specific post to a day (AI searches by description, e.g., "the pasta recipe post") | `day: string, query: string` |
| `explain_pick` | Explain why a post was chosen | `day: string` |

Each tool call returns the updated plan state. The UI reflects changes immediately via the response.

### Chat Personality

Proactive and opinionated:
- "I notice you haven't shared anything about cooking in 3 weeks — I slotted one in on Tuesday"
- "This post has been recycled 5 times already, want me to swap it for something fresher?"
- "Wednesday's pick is a video post so it'll go to all 5 platforms"

## Section 4: Approve & Schedule Flow

### Approval

- **Bulk approve:** "Approve & Schedule" button converts all PROPOSED slots to SCHEDULED
- **Individual approve:** each row has its own approve button
- **Partial plans are fine:** Gil can approve 4 of 7 days and come back later

### What Happens on Approve

For each approved slot:
1. Slot status → SCHEDULED
2. Post's `publishCount` incremented by 1
3. PublishRecords created — one per eligible platform:
   - `scheduledAt` = slot date at a configurable time (default 9:00 AM, user's local timezone stored in plan or user settings)
   - `status` = PENDING
   - Platform determined by media-type rules above
4. **Facebook exception:** no PublishRecord created. The planner row shows manual posting actions (copy caption + download media) using the existing ManualFacebookRow component pattern.

### Post-Approval

- Scheduled posts appear on the Content Calendar automatically (it reads PublishRecords)
- Existing cron job `/api/cron/publish` picks up PENDING records at midnight and publishes
- Gil can unschedule a day (deletes PENDING PublishRecords, decrements publishCount, slot → APPROVED)
- Already-published posts cannot be unscheduled

## Section 5: Data Model Changes

### New Field: `Post.publishCount`

```prisma
model Post {
  // ... existing fields
  publishCount  Int      @default(0)
}
```

Lifetime count of times this post has been selected for publishing. Incremented on schedule, decremented on unschedule.

### New Model: `WeeklyPlan`

```prisma
model WeeklyPlan {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  weekStart DateTime // Monday of the plan week
  status    PlanStatus @default(DRAFT)
  slots     WeeklyPlanSlot[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([userId, weekStart])
}

enum PlanStatus {
  DRAFT
  PARTIAL
  APPROVED
}
```

### New Model: `WeeklyPlanSlot`

```prisma
model WeeklyPlanSlot {
  id        String     @id @default(cuid())
  planId    String
  plan      WeeklyPlan @relation(fields: [planId], references: [id], onDelete: Cascade)
  postId    String
  post      Post       @relation(fields: [postId], references: [id])
  day       DateTime   // the specific date
  status    SlotStatus @default(PROPOSED)
  reasoning String?    // AI's explanation for this pick
  platforms String[]   // auto-determined eligible platforms

  @@unique([planId, day])
}

enum SlotStatus {
  PROPOSED
  APPROVED
  SCHEDULED
  SKIPPED
}
```

### Unchanged Models

PublishRecord, PostAnalytics, PlatformToken, Media — all work as-is. No modifications needed.

### API Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/planner/current` | Get or create this week's plan |
| POST | `/api/planner/generate` | AI generates recommendations, fills slots |
| PATCH | `/api/planner/[planId]` | Update a slot (swap, approve, remove) |
| POST | `/api/planner/[planId]/schedule` | Approve & create PublishRecords |
| POST | `/api/chat/planner` | Chat endpoint with tool use for plan mutations |

## Section 6: Content Calendar Integration

### Calendar Shows Plan State

The existing Content Calendar page gains awareness of WeeklyPlan data in addition to PublishRecords:

- **Gray/dashed** = proposed (WeeklyPlanSlot with PROPOSED status)
- **Blue** = approved (slot APPROVED, no PublishRecords yet)
- **Green** = scheduled (PublishRecords exist with PENDING status)
- **Checkmark** = published (PublishRecord status PUBLISHED)

### Platform Icons

Each calendar entry shows platform icons for which platforms the post will go to. Reuses the existing PlatformIcons component.

### Click-Through

Clicking a calendar entry opens the post detail page. No modals.

### Historical View

Scrolling back shows past weeks' published content. Already works since PublishRecords store `publishedAt`.

### No Editing from Calendar

All plan manipulation happens on the dashboard planner. The calendar is read-only visualization. This avoids building two editing UIs.

## Future Considerations (Not In Scope)

- **PostAnalytics integration:** when engagement data flows in from Instagram/YouTube/etc., the recommendation engine incorporates performance signals (high engagement → boost priority). The PostAnalytics model already exists; the AI prompt just gets richer context.
- **Multi-week planning:** plan 2-4 weeks ahead in one session.
- **Auto-pilot mode:** AI generates and schedules without review (Approach C from brainstorming).
- **Per-platform scheduling:** different posts for different platforms rather than cross-posting everything.
- **Optimal posting time:** use analytics to determine best time-of-day per platform.
