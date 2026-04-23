# Planner card — handoff for Claude Code

Reference prototype: **`Planner Redesign.html`** (this project). The "★ Revised · feedback incorporated" section at the top of the canvas shows the target states. Component source: `components/PlannerV2.jsx`.

Read that file for exact markup, class names, and CSS. This doc is the spec summary.

---

## What this screen does

The Planner shows posts the assistant has picked for a given day. Each post is either:

- **Proposed** — the assistant suggested it, user hasn't acted yet.
- **Scheduled** — user confirmed; it's on the queue to post at `scheduledAt`.

The user's job here is to confirm or skip each proposed post, or unschedule an already-scheduled one.

## Problems in the current card (do not reintroduce)

1. Post type shown three times (icon + "Image" badge + the thumbnail itself).
2. Status shown twice and inconsistently — "APPROVED" pill + "Approved — ready to schedule" line.
3. "Scheduled" state said "ready to schedule" — contradicts itself.
4. Evergreen / never-posted repeated via leaf icon, "never republished" chip, and AI rationale text.
5. No clear primary action; everything weighted equally.
6. Six accent colors on one card (blue borders, blue pill, gold dots, green leaf, red calendar, purple rationale).

## Design rules

- **One status, one place.** The card background colour IS the status. No badges for proposed/scheduled.
  - Proposed → warm cream `#fbf7ee` bg, `#ebe3cc` border.
  - Scheduled → soft green `#f0f6ef` bg, `#d6e4d3` border.
- **One signal per fact.**
  - Post type: one compact `{icon} Image` / `Video` / `Text` badge. Thumbnail still present, but no extra image-frame icon.
  - Original post age (from the FB import): `Originally 1mo ago` chip, history-clock icon.
  - Reposts through our planner: `Reposted 2×` chip, ↻ icon. If 0, render `Never reposted`. Warm tint when > 0.
  - Rating: 5 small stars, gold `#d4a23e`.
  - Evergreen: small green leaf glyph, no label (tooltip only).
- **Platform chips are prominent** (24px desktop, 13–14px icon on mobile) with brand-tinted backgrounds — that's what the planner does, surface where things go.
- **AI rationale is collapsed.** Rendered as a small `Why this?` toggle button with sparkle icon and chevron. Opens a dark tooltip above the button. Not visible by default.
- **Schedule is icon-only** (checkmark). Skip is icon-only (×). Edit is icon-only (pencil). Primary (Schedule) is the filled black button; others are ghost.
- **Scheduled cards don't show Schedule.** They show Edit + Unschedule (×) instead.

## Desktop layout (≥ 700px)

Timeline-spine layout. Left → right:

1. **Time rail** (64px wide, right-aligned): big time `9:30 AM`, small date `Fri Apr 25` below.
2. **Spine** (12px wide): a hollow 11px circle with a 2.5px border coloured by state (amber for proposed, green for scheduled). A 1.5px light-gray vertical line runs from below the node down to the next row, except the last row.
3. **Card** (flex-1): rounded 14px, border + bg tinted by state. Inside:
   - **Top section** (14px padding, 14px gap): 92×92 thumbnail on the left; main column on the right with:
     - Signals row: type badge · leaf (if evergreen) · 5-star rating · `<flex:1>` · channel chips (right-aligned).
     - Text (2-line clamp, 14.5px / 1.45).
     - Meta chip row: `Originally {age}` + `Reposted {n}×`.
   - **Bottom section** (10px padding, rgba white 35% bg, top border rgba black 5%):
     - Status label: `✓ Scheduled` / `● Proposed` (colour matches state).
     - `Why this?` toggle.
     - `<flex:1>` spacer.
     - Actions: for Proposed → Skip ghost / Edit ghost / Schedule primary. For Scheduled → Edit ghost / Unschedule ghost.

## Mobile layout (< 700px)

Single column, no spine — vertical space is cheap.

1. Card only, same 14px radius + state-tinted bg.
2. **Top section**: 72×72 thumbnail, main column with signals row (type, leaf, stars, `<flex:1>`, channel chips at 13px), 3-line text clamp, meta chip row.
3. **Time bar** (new, bottom area above footer): its own row, slightly stronger bg (`rgba(255,255,255,.55)`), showing full schedule: `✓ Scheduled · Fri Apr 25 · 9:30 AM` or `● Proposed for Fri Apr 25 · 9:30 AM`.
4. **Footer**: `Why this?` toggle · `<flex:1>` · icon-only actions (Skip + Schedule for proposed, Edit + Unschedule for scheduled).

## Header (both)

- Day title: e.g. `Friday, Apr 25` — 17px 600 weight.
- Subtitle: `3 posts · 1 scheduled · 2 proposed` — 12.5px `#7a7870`.
- Right side: `Approve all` button — black pill, 7px × 13px padding.
- Thin `#eae7df` bottom border.

## Tokens

```
Fonts      SF Pro Text / -apple-system stack, 14px base.
Text       #161513 primary, #3a3832 secondary, #7a7870 muted.
Borders    #eae7df (neutral), state-tinted otherwise.
Primary    #161513 button bg, #fff text.
Radii      14 (card), 12 (mobile card), 10 (desktop thumb), 8 (buttons, chips), 7 (platform tiles).
```

## Platform brand colours (icon + tinted bg)

| key | name | color | bg |
|-----|------|-------|-----|
| ig  | Instagram | `#E1306C` | `#FCE7F0` |
| fb  | Facebook  | `#1877F2` | `#E5EFFE` |
| li  | LinkedIn  | `#0A66C2` | `#E3EEF9` |
| yt  | YouTube   | `#FF0000` | `#FDE7E7` |
| tt  | TikTok    | `#111111` | `#ECECEC` |

## Fields expected on each post

```ts
type PlannerPost = {
  id: string;
  type: 'image' | 'video' | 'text';
  image?: string;           // thumbnail url
  text: string;             // body, clamp in UI
  rationale: string;        // AI reason, revealed via "Why this?"
  channels: Array<'ig'|'fb'|'li'|'yt'|'tt'>;
  scheduledAt: string;      // "Fri Apr 25 · 9:30 AM" — or structured datetime you format
  rating: 1|2|3|4|5;
  evergreen: boolean;
  originalAge: string;      // "1mo ago" — from source-platform post date
  reposts: number;          // count of times we reposted it through the planner
  status: 'proposed' | 'scheduled';
};
```

## Acceptance

- No badge pills for "Approved" / "Ready to schedule" / "Scheduled". State lives in bg colour + one status label in the footer only.
- No "Image" icon + "Image" badge duplication. One compact type chip.
- `Originally 1mo ago` and `Reposted N×` are two separate chips, visibly distinct.
- Rationale is only visible after tapping `Why this?`.
- Primary Schedule button is icon-only.
- Mobile view keeps all info present on desktop; no chips dropped.
