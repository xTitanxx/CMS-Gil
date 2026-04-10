# Spec: Platform brand icons on publish buttons

## Goal

Add recognizable brand marks to the platform selector chips in `PublishPanel` so users can identify Instagram, LinkedIn, YouTube, and TikTok at a glance.

## Scope

Frontend-only change. Single component. No database, API, or auth changes. No new routes.

## Branch

`feature/platform-icons`

## Files touched

- `src/components/posts/PublishPanel.tsx` — add icons inside the existing platform chips
- `package.json` / `package-lock.json` — new dependency

## Implementation

### 1. Install the icon library

```bash
npm install react-icons
```

`react-icons/si` (Simple Icons) is chosen because it has all four official brand marks, including TikTok, which `lucide-react` does not ship due to trademark policy. Tree-shaken imports keep the bundle impact around 30KB.

### 2. Import the four icons

In `src/components/posts/PublishPanel.tsx`, add:

```ts
import { SiInstagram, SiLinkedin, SiYoutube, SiTiktok } from "react-icons/si";
```

### 3. Map platforms to icons

Alongside the existing `PLATFORM_COLORS` constant, add:

```ts
const PLATFORM_ICONS: Record<Platform, React.ComponentType<{ size?: number; "aria-hidden"?: boolean }>> = {
  INSTAGRAM: SiInstagram,
  LINKEDIN: SiLinkedin,
  YOUTUBE: SiYoutube,
  TIKTOK: SiTiktok,
};
```

### 4. Render the icon inside each chip

In the existing `PLATFORMS.map((p) => ...)` block, render the icon to the left of the platform label:

```tsx
const Icon = PLATFORM_ICONS[p];
return (
  <button
    key={p}
    type="button"
    aria-label={p}
    aria-pressed={selected.has(p)}
    onClick={() => toggle(p)}
    className={/* existing classes */}
  >
    <Icon size={16} aria-hidden />
    <span>{p}</span>
  </button>
);
```

The chip's existing flex layout should already accommodate this; add `gap-2` if the icon and label crowd.

### 5. Color handling

Do **not** hardcode icon colors. Each icon should inherit `currentColor` so the existing `PLATFORM_COLORS` text color (e.g. `text-pink-700` for Instagram) carries through. Result: Instagram icon ends up pink, LinkedIn icon blue, YouTube red, TikTok white — brand-consistent without a ransom-note rainbow effect.

## Accessibility

- Icons get `aria-hidden` since the text label remains visible.
- Each button gets `aria-label={p}` and `aria-pressed={selected.has(p)}` for screen readers.

## Test plan

- [ ] `npm run dev` and open a post with publish access
- [ ] All four chips show their brand icon on the left
- [ ] Icon color matches the chip's text color (pink/blue/red/white respectively)
- [ ] Clicking a chip still toggles selection (unchanged behavior)
- [ ] Screen reader announces platform name (spot-check with VoiceOver or browser a11y tools)
- [ ] Build succeeds: `npm run build`

## Out of scope

- Changing the chip colors or layout
- Adding icons anywhere else in the app
- Animations or hover states
