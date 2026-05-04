# Subscriber Gate for Public Archive — Design Spec

**Date:** 2026-04-28
**Branch:** `feature/subscriber-gate`
**Status:** Approved — proceed to implementation plan

## Goal

Gate the public archive (feed, post pages, story pages, virtual-Gil chat) behind a per-person access code so only invited Facebook subscribers can enter. Each subscriber has a fixed name pre-set by the admin, persistent chat memory with virtual Gil, and a monthly API-cost budget so the service remains economically viable at a $1.50/sub/month price point (after Facebook subscription fees).

## Non-goals

- Self-service subscriber sign-up (every subscriber is invited).
- Email/password recovery (subscribers re-request a code from Gil out of band).
- Tiered plans (single $2/$1.50 plan, single budget default).
- Public sharing of post URLs (unauthenticated visitors land on `/welcome`, not on a specific post).
- Subscriber-managed display name (admin sets the name; subscribers sign in as that name).

## User stories

1. As Gil, I want to issue an access code with a name pre-attached so I know exactly who is on the other end of every chat.
2. As Gil, I want to see real dollar API spend per subscriber so I can spot abuse and stay within budget.
3. As Gil, I want to revoke an individual subscriber without affecting others.
4. As a subscriber, I want to paste my code once, then return to the site without re-entering it.
5. As a subscriber, I want virtual Gil to remember our prior conversations.
6. As a subscriber, I want clear feedback when I've used my monthly chat allowance, with a reset date.

## Architecture

### Auth model

Subscribers live in a new `Subscriber` table, distinct from `User`. Authentication piggybacks on the existing NextAuth v5 setup via a new Credentials provider that authenticates against a hashed access code rather than email + password.

The NextAuth JWT carries `role: "admin" | "subscriber"` plus either `userId` (admin) or `subscriberId` (subscriber). Middleware enforces role per route. The admin Google OAuth flow is unchanged; subscribers go through a separate `/welcome` sign-in page.

**Why a separate table** (not adding a `role` flag on `User`):
- `User` carries admin-only relations (posts, plans, drive sync, todos, etc.) — none apply to subscribers.
- `User.email` is unique; subscribers don't have email in this flow.
- Keeping the tables apart prevents accidental privilege escalation if the role flag is ever forgotten.

**Why extend NextAuth** (not a separate session system):
- Single cookie, single `auth()` helper, single middleware pattern. Reuses session/CSRF machinery already in production.

### Access code lifecycle

1. Admin creates a subscriber: provides name → server generates a code (`gil-{8 lowercase alphanum}`, ~$10^{12}$ space, fine for the size of this audience), stores `bcrypt(code)` in `Subscriber.codeHash`, returns the plaintext code **once** in the response.
2. Admin shows the code in a copy-to-clipboard panel. After dismissing the modal, the plaintext is gone. (UI shows "send this on Facebook — you won't see it again". A "regenerate code" button exists for cases where the code is lost.)
3. Subscriber pastes the code on `/welcome`. Server brute-force-protects with rate limit (10 attempts per IP per hour). Match found → NextAuth issues a JWT-backed session cookie with `role: "subscriber"`, `subscriberId`, and `name`. No match → soft error.
4. Session cookie persists 90 days, sliding expiration. Re-entering the code on a new device just creates another session for the same `Subscriber` row.
5. Admin can revoke (`Subscriber.revokedAt = now`) or hard-delete. Revoked subs are blocked at the chat API and at middleware. Existing session cookies are honored at the cookie level but rejected at middleware/API on each request — effectively immediate revocation.

### Cost tracking

Every chat turn:
1. Read subscriber row.
2. If `Subscriber.cycleStart < startOfCurrentMonth(UTC)`, lazily reset: `cycleUsedUsd = 0`, `cycleStart = startOfCurrentMonth`.
3. If `cycleUsedUsd >= monthlyBudgetUsd` → return 429 with `cycleResetsAt`.
4. Call Anthropic with `cache_control: { type: "ephemeral", ttl: "1h" }` on the system prompt block.
5. After streaming completes, compute the actual cost from `response.usage`:
   - `input_tokens × $1/MTok` (regular input, includes the user's message)
   - `cache_creation_input_tokens × $2/MTok` (1h cache write rate)
   - `cache_read_input_tokens × $0.10/MTok`
   - `output_tokens × $5/MTok`
6. Increment `cycleUsedUsd` by the computed cost. Insert a `SubscriberUsage` row (audit log).
7. Update `Subscriber.lastSeenAt`.

`Subscriber.lastSeenAt` is also touched on every successful subscriber-signin and on `/api/chat/conversation` reads, so the "last seen" column in the admin panel reflects archive visits, not just chat activity.

Cache writes are charged to the subscriber that triggered them. This is the simplest and most accurate attribution; in active use the cache stays hot and write hits are spread across whoever happens to chat first in each hour.

Pricing table is hard-coded as constants matching Haiku 4.5's published rates. If the model is changed, the constants must be updated in lockstep.

## Data model

```prisma
model Subscriber {
  id               String                    @id @default(cuid())
  name             String
  codeHash         String                    @unique
  monthlyBudgetUsd Decimal                   @default(1.20) @db.Decimal(8, 4)
  cycleStart       DateTime                  @default(now())
  cycleUsedUsd     Decimal                   @default(0) @db.Decimal(8, 4)
  createdAt        DateTime                  @default(now())
  lastSeenAt       DateTime?
  revokedAt        DateTime?
  createdById      String
  createdBy        User                      @relation(fields: [createdById], references: [id])
  conversations    SubscriberConversation[]
  usageEvents      SubscriberUsage[]

  @@index([revokedAt])
}

model SubscriberConversation {
  id           String              @id @default(cuid())
  subscriberId String
  subscriber   Subscriber          @relation(fields: [subscriberId], references: [id], onDelete: Cascade)
  title        String?
  createdAt    DateTime            @default(now())
  updatedAt    DateTime            @updatedAt
  messages     SubscriberMessage[]

  @@index([subscriberId, updatedAt])
}

model SubscriberMessage {
  id             String                 @id @default(cuid())
  conversationId String
  conversation   SubscriberConversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  role           String                 // "user" | "assistant"
  content        String
  createdAt      DateTime               @default(now())

  @@index([conversationId, createdAt])
}

model SubscriberUsage {
  id                       String     @id @default(cuid())
  subscriberId             String
  subscriber               Subscriber @relation(fields: [subscriberId], references: [id], onDelete: Cascade)
  inputTokens              Int
  cacheCreationInputTokens Int        @default(0)
  cacheReadInputTokens     Int        @default(0)
  outputTokens             Int
  costUsd                  Decimal    @db.Decimal(8, 6)
  createdAt                DateTime   @default(now())

  @@index([subscriberId, createdAt])
}
```

A reverse relation `User.subscribersCreated Subscriber[]` is added on `User` for the audit trail.

The existing `Conversation`/`Message` tables (admin assistant chat) are untouched. Subscriber chat lives in its own pair of tables because the surface differs: no tool use, different system prompt, different lifecycle.

`cycleUsedUsd` is denormalized for fast budget checks (no aggregate query per chat turn). `SubscriberUsage` is the audit log.

## API surface

All routes return JSON; HTTP status codes follow REST norms.

### Public

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/api/auth/subscriber-signin` | `{ code: string }` | Sets NextAuth session cookie. 401 on bad code. Rate-limited per IP. |
| POST | `/api/auth/signout` | — | Existing NextAuth route; works for both roles. |

### Subscriber-only (or admin)

| Method | Path | Notes |
|---|---|---|
| POST | `/api/chat` | Existing route, modified: budget-checked, prompt-cached, usage-logged, persists messages to `SubscriberConversation`. Admin role bypasses budget check. |
| GET | `/api/chat/conversation` | Returns the subscriber's persistent conversation (creates one if absent). |
| GET | `/api/chat/budget` | `{ usedUsd, budgetUsd, percentUsed, cycleResetsAt }`. |

### Admin-only

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/admin/subscribers` | — | List with `{ id, name, createdAt, lastSeenAt, monthlyBudgetUsd, cycleUsedUsd, revokedAt, conversationsCount }` per row plus aggregates. |
| POST | `/api/admin/subscribers` | `{ name, monthlyBudgetUsd? }` | `{ id, name, code }` — plaintext code returned **only** here. |
| PATCH | `/api/admin/subscribers/[id]` | `{ name?, monthlyBudgetUsd?, revoked? }` | Updated row. |
| POST | `/api/admin/subscribers/[id]/regenerate-code` | — | `{ code }` — plaintext, replaces old hash. |
| DELETE | `/api/admin/subscribers/[id]` | — | Hard delete; cascades to conversations + usage. |

## Middleware

Updates to `src/middleware.ts`:

- `/admin/*` → require `role === "admin"`. Else redirect to `/admin-login` (existing behavior preserved).
- `/`, `/p/[id]`, `/s/[id]`, `/chat` → require any signed-in role. Else redirect to `/welcome?next=<original-path>`.
- `/welcome` → public; if signed in, redirect to `/` (or `next` param if present).
- `/api/chat`, `/api/chat/*` → require signed-in role; subscriber path enforces `revokedAt IS NULL`.
- `/api/admin/*` → require admin.

A feature flag `PUBLIC_GATE_ENABLED` (env var, defaults to `false`) controls whether the public-route gate is active. When `false`, public routes are open as today. When `true`, the gate enforces. The middleware reads `process.env.PUBLIC_GATE_ENABLED` once per cold start.

## UI surface

### Public

**`/welcome`** — new route. Centered card on `bg-gray-100`, mobile-first:
- Banner image (smaller crop of the existing `/banner.jpg`)
- Avatar
- Headline: "Welcome to Gil's archive"
- Body: "Enter your access code to come in. If you don't have one, message Gil on Facebook."
- Single text input + "Enter" button
- Inline error states: "Code not recognized", "Too many attempts — try again in X minutes"
- On success: redirect to `next` query param or `/`

**Subscriber-signed-in chrome** — across `/`, `/p/[id]`, `/s/[id]`, `/chat`:
- A thin header bar (only when subscriber, not admin) at the top of `<main>` showing "Hi, {name}" and a small "Sign out" link. Doesn't replace the existing profile/cover header on `/`.
- Existing layout otherwise unchanged.

**`/chat` (subscriber view)**:
- Above the message input, a small budget meter: progress bar + label "{X}% of monthly chat allowance used. Renews May 1." Pulled from `/api/chat/budget` on mount.
- At budget cap: input disabled, replaced with "You've used your monthly chat allowance. It will renew on May 1. Thanks!"
- Past messages load from `/api/chat/conversation` on mount; new messages append to the same conversation.

### Admin

**`/admin/settings/subscribers`** — new tab/section in the existing settings page:
- Aggregate strip: total subs, active in last 7d, total $ spent this month, projected month-end spend (linear extrapolation).
- "Add subscriber" button → modal with `name` field (optional `monthlyBudgetUsd`, default 1.20). On submit, modal switches to a "Code generated" view with the plaintext code and a copy-to-clipboard button. Modal cannot be reopened with the same code.
- Table of subscribers: name, created, last seen, $ used / $ budget (with bar), state (active / revoked), actions menu (edit name + budget, regenerate code, revoke, delete).
- Per-row drill-down (optional in scope): view conversation history. **Out of scope for v1**; keep tracking it but don't surface a UI for it. (Update: see "Iteration 2" below.)

## Server modules

```
src/lib/subscribers/
  service.ts          // CRUD: create, list, update, revoke, regenerateCode, delete
  auth.ts             // verifyCode, signInSubscriber (the NextAuth credentials authorize fn)
  budget.ts           // checkBudget, recordUsage, computeHaikuCost, lazyResetCycle
  code.ts             // generateCode, hashCode, verifyCodeHash
src/lib/auth.ts       // extended with new SubscriberCredentials provider + role JWT/session callbacks
src/middleware.ts     // role-aware routing
```

`src/app/api/chat/route.ts` is modified, not replaced: same structure, with budget checks before the call and usage recording after the stream resolves. The existing IP-based rate limiter is removed for subscribers (replaced by the per-subscriber budget) but kept as a safety net for admin / no-auth dev paths.

## Cost & rate-limit details

### Pricing constants (Haiku 4.5)

```ts
const PRICES = {
  inputPerMTok: 1.0,
  cacheWrite1hPerMTok: 2.0,
  cacheReadPerMTok: 0.10,
  outputPerMTok: 5.0,
};

function computeHaikuCost(usage: Anthropic.Usage): number {
  return (
    (usage.input_tokens / 1_000_000) * PRICES.inputPerMTok +
    ((usage.cache_creation_input_tokens ?? 0) / 1_000_000) * PRICES.cacheWrite1hPerMTok +
    ((usage.cache_read_input_tokens ?? 0) / 1_000_000) * PRICES.cacheReadPerMTok +
    (usage.output_tokens / 1_000_000) * PRICES.outputPerMTok
  );
}
```

`SubscriberUsage.costUsd` stores 6-decimal precision because per-turn costs can be sub-cent.

### Cycle reset

Calendar month, UTC. `startOfCurrentMonth()` is a pure helper. Reset happens lazily on the first chat-API call of a new month — no cron required. If a subscriber doesn't visit in a given month, `cycleUsedUsd` stays at last month's value until they next chat; this is fine because we only read `cycleUsedUsd` after the lazy reset.

### Anti-abuse layers

1. **Code sign-in**: 10 attempts per IP per hour (existing `createRateLimiter` helper).
2. **Per-subscriber monthly $ budget**: prevents runaway cost.
3. **Output cap**: `max_tokens: 1024` per turn (already in place).
4. **Hard floor on `monthlyBudgetUsd`**: minimum $0 (admin can zero it to soft-disable a sub without revoking the session).

### Admin chat behavior

Admin already has `/admin/assistant` for primary chat. The public `/chat` exists mainly for end-user testing in an admin session. When an admin session hits `/api/chat`:

- Budget check is skipped.
- `SubscriberUsage` is **not** written.
- `SubscriberConversation` is **not** written; the admin's `/chat` session is ephemeral, in-memory only (the existing client-side message state is preserved per session, but nothing persists across reloads).
- `/api/chat/conversation` returns an empty conversation for admin (no historical replay).

This keeps subscriber tables free of admin-test noise and means the budget meter UI is the single signal an admin uses to evaluate the subscriber experience (admins can preview the meter by signing into a test subscriber account).

## Migration & rollout

### Migration

Single Prisma migration adding 4 models + 1 reverse relation. No data migration required (no existing rows to backfill).

### Rollout sequence

1. Land the migration + code on `feature/subscriber-gate`.
2. Deploy to production with `PUBLIC_GATE_ENABLED=false`. Public site stays open. Admin can use `/admin/settings/subscribers` to seed test subscribers. Admin can verify the gate works on staging-style by setting the env locally.
3. Admin generates a few subscribers, confirms `/welcome` flow on a private window with a real code.
4. Admin sets `PUBLIC_GATE_ENABLED=true` in production. Public routes immediately require sign-in.
5. Admin posts the welcome link to FB along with each subscriber's individual code.

### Reversibility

Setting `PUBLIC_GATE_ENABLED=false` re-opens the site instantly. The chat budget logic is on independent of the gate — even with the gate off, subscribers who sign in are still budget-tracked. Admin testing is not budget-tracked.

## Testing strategy

Unit tests (vitest):
- `code.ts`: generate produces the expected format; hash-then-verify round-trip works.
- `budget.ts`: `computeHaikuCost` matches hand-computed values for representative usage shapes; `lazyResetCycle` resets only when crossing a UTC month boundary.
- `service.ts`: CRUD happy paths + revocation + duplicate-name allowed (codes are the identity).

Integration tests (route handlers):
- `/api/auth/subscriber-signin`: bad code → 401; revoked sub → 401; valid → 200 + cookie; rate-limit kicks in after N attempts.
- `/api/chat`: subscriber over budget → 429; subscriber under budget → 200 + usage row written + cycleUsedUsd incremented; admin role → no usage row + no budget check.
- `/api/admin/subscribers`: full CRUD; non-admin → 403.

Manual UI verification (handed off to Eitan):
- `/welcome` on mobile + desktop, valid + invalid code paths.
- Header strip on signed-in feed.
- Budget meter on `/chat`; behavior at 90%, 100%, on cap-block.
- Admin panel: add → see code → copy → revoke → regenerate.

## Open questions / iteration 2

- Should subscribers see who else is in (a tiny "members" page)? Not in v1.
- Should we surface a per-subscriber chat history viewer in the admin panel? Probably yes, but defer to v1.1 — the data is there in `SubscriberConversation`, just no UI.
- Tiered plans (Pro at $5/mo with $4 budget)? Out of scope; wait for evidence of demand.
- Email notification when a subscriber hits 80% budget? Nice-to-have, not in v1.

## Definition of done

- `/welcome` gate works end-to-end, with a feature flag to disable.
- Admin can create, list, edit, revoke, regenerate-code, delete subscribers.
- `/api/chat` with a subscriber session: budget-checked, prompt-cached (cache hits visible in usage), persists to `SubscriberConversation`, increments `cycleUsedUsd`.
- Budget meter renders on `/chat` for subscribers.
- All unit + integration tests pass.
- Migration applied cleanly; no data loss.
