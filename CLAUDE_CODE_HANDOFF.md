# Assistant page — handoff for Claude Code

## The bug (from the attached screenshot)

The mobile assistant page header (menu button, title pill, edit button) is
rendered as an **absolutely-positioned overlay on top of the scrollable
messages**, with a transparent background. When the user scrolls, message
text (bullets, prose) slides *behind* the pill and the icon buttons and
becomes visible through them — the header reads as a floating layer over
blurry-but-opaque content instead of a proper app bar.

## Root cause

In `src/app/admin/assistant/_components/ThreadView.tsx`, the menu + new-chat
buttons are rendered inside:

```tsx
<div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between px-4 pt-4">
  <button …>Menu</button>
  <button …>SquarePen</button>
</div>
```

- No background on this container.
- No title pill at all (the reference shows a centered title pill).
- The `.flex-1 overflow-y-auto` messages region starts at the top of the
  frame, with only `pt-16` spacing — nothing opaque covers the top band.

## The fix

Replace that overlay with a **real header bar** that has a background:

1. Container: a non-overlay element at the top of the column flex —
   `sticky top-0 z-20 flex h-14 items-center justify-between px-2`.
2. Background: **Frosted** — `bg-white/80 backdrop-blur-xl
   supports-[backdrop-filter]:bg-white/70`. **No bottom shadow / separator
   line.** The header should dissolve into the scroll area as one
   continuous surface.
3. Structure (three zones):
   - **Left:** 40×40 ghost icon button — Menu.
   - **Center:** the **title pill** — `inline-flex items-center gap-2 rounded-full
     border border-gray-200 bg-white px-3.5 py-1.5 text-sm font-semibold
     shadow-[0_1px_2px_rgba(0,0,0,0.04)]`. Content: "Assistant" (or current
     model label). Optional 8px green status dot on the left.
   - **Right:** 40×40 ghost icon button — SquarePen (new chat). The old
     overflow `...` menu isn't needed here.
4. Messages region: remove `pt-16`. The sticky header occupies its own
   56px, so messages just start after it naturally. Keep
   `pb-[calc(110px+env(safe-area-inset-bottom))]` or similar to clear the
   composer.

## Reference implementation

See `Assistant Page.html` in this project — it renders three artboards:

- **Buggy** — reproduces the current state (transparent bleed-through).
- **Solid** — the recommended fix.
- **Blur** — alternative frosted variant.

Flip between the three with the Tweaks panel (right-side toggle in the
preview). The component source is `components/AssistantScreen.jsx`. The
CSS there is vanilla — translate it to Tailwind classes when editing
`ThreadView.tsx`.

## Concrete diff for `ThreadView.tsx`

Replace the floating overlay block:

```tsx
{/* Floating overlay buttons — matching ChatGPT proportions */}
<div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between px-4 pt-4">
  <button … Menu …/>
  <button … SquarePen …/>
</div>
```

…with a real header bar, placed at the **top of the outer flex column**
(before the `.flex-1 overflow-y-auto` messages div):

```tsx
<header
  className="sticky top-0 z-20 flex h-14 items-center justify-between px-2
             bg-white/80 backdrop-blur-xl
             supports-[backdrop-filter]:bg-white/70"
  // No shadow/border-bottom — keep header continuous with the scroll area
>
  <button
    onClick={() => window.dispatchEvent(new Event("open-sidebar"))}
    className="flex h-10 w-10 items-center justify-center rounded-full
               text-[#0d0d0d] active:bg-gray-100 md:hidden"
    aria-label="Menu"
  >
    <Menu className="h-6 w-6" strokeWidth={1.5} />
  </button>

  <div className="inline-flex items-center gap-2 rounded-full border border-gray-200
                  bg-white px-3.5 py-1.5 text-sm font-semibold text-[#0d0d0d]
                  shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
    <span className="h-2 w-2 rounded-full bg-emerald-500" />
    <span>Assistant</span>
  </div>

  <button
    onClick={async () => { /* existing new-chat handler */ }}
    disabled={streaming || messages.length === 0}
    className="flex h-10 w-10 items-center justify-center rounded-full
               text-[#0d0d0d] active:bg-gray-100 disabled:opacity-30"
    aria-label="New chat"
  >
    <SquarePen className="h-6 w-6" strokeWidth={1.5} />
  </button>
</header>
```

Then simplify the messages region:

```tsx
<div className="flex-1 overflow-y-auto px-4 pt-4 pb-4">
  …
</div>
```

(Drop the `pt-16` — it was compensating for the now-removed overlay.)

## Composer changes

Also update the composer (bottom input bar) in the same file:

1. **Increase horizontal padding** on the composer wrapper so the pill
   doesn't touch the screen edges. In the outer composer `<div>`:
   - Was: `className="border-t border-gray-200 bg-white px-4 py-3 flex-shrink-0"`
   - Change `px-4` → `px-5` (or `px-6` for more breathing room).
2. **Remove the voice-mode / waveform button** if one exists. The composer
   should end at: `[ + ] [ input ] [ mic ]` — no separate black circular
   voice-mode button after the mic.

(In the current `ThreadView.tsx` the composer is already `+ | input | send-arrow`
— so only the padding bump applies there. If a later iteration adds a voice
button, don't add one.)

## How to talk to Claude Code about this

Paste this file (`CLAUDE_CODE_HANDOFF.md`) into the chat along with the
original screenshot and say:

> Read `CLAUDE_CODE_HANDOFF.md`. The mobile assistant header has a
> bleed-through bug — follow the diff in that doc exactly. Use the blur
> variant. Don't change any composer or message-body code.

Claude Code does best with narrow, file-scoped asks; don't let it wander
into the planner or post-ref logic.
