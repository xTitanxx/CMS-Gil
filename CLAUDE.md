# CMS-Gil — Claude Instructions

## Stack
- **Framework**: Next.js 16.2 App Router (`next@16.2.1`, React 19.2)
- **Auth**: NextAuth v5 beta (`next-auth@5.0.0-beta.30`) — Google OAuth only (sign-in)
- **Database**: Supabase PostgreSQL via Prisma 7 (`@prisma/adapter-pg`) — migrated from Neon
- **Storage**: **Cloudflare R2** (via `@aws-sdk/client-s3`) for all media; Vercel Blob for ZIP upload staging. (Cloudinary was the previous media host; all rows have been migrated to R2 and the Cloudinary SDK + fallback have been removed.)
- **AI**: Anthropic SDK (`@anthropic-ai/sdk@^0.82`) — `claude-sonnet-4-6` for tagging/planner/assistant, `claude-haiku-4-5` for search + retrieval + the public `/api/chat` (with 1h prompt caching on the 90k-token system prompt). Markdown rendering on `/chat` via `react-markdown`.
- **Deployment**: Vercel at `cms-gil.vercel.app`
- **Language**: TypeScript, React 19

## Local Development
```bash
npm run dev                        # http://localhost:3000
npx vercel env pull .env.local     # sync env vars, then manually add:
#   AUTH_URL=http://localhost:3000
#   NEXTAUTH_URL=http://localhost:3000
#   APP_URL=http://localhost:3000
npm run deploy                     # deploy to production (ASK FIRST — see Autonomy + Deploys)
npm test                           # vitest unit tests
```

Restart the dev server after any `.env.local` change.

## Parallel Sessions — Workspace Safety

**Multiple Claude sessions may share this working directory at once.** Any session that runs `git checkout`, switches branches, or otherwise mutates Git state changes the files on disk under every other session, silently breaking their in-progress edits. (Symptom we've already seen: a parallel session switching branches mid-edit, corrupting the active session's work.)

**Treat the workspace as pinned. Your job is editing code, not managing the repository.**

**Allowed without asking:**
- Reading anything (`Read`, `git status`, `git log`, `git diff`, `git show`, `git branch -v`)
- Editing files (`Edit`, `Write`) and proposing diffs
- Running tests, type checks, scripts that don't touch Git state
- Committing on the **current** branch when the user has asked you to commit
- Pushing the **current** branch (`git push`, `gh pr create`) when the user has asked

**Off-limits unless the user explicitly asks for it in this task:**
- `git checkout`, `git switch`, `git checkout -b`, `git worktree`, branch creation or deletion
- `git stash`, `git reset`, `git restore`, `git clean`
- `git pull`, `git merge`, `git rebase`, `git fetch` — anything that updates local refs or the working tree
- Force-pushes or history rewrites
- Auto-pruning, auto-cleanup, or any "tidy up the repo" actions that weren't requested

If a task appears to require one of these (e.g. "this fix needs a new branch", "main is behind origin"), state what you'd do and **wait for the user to confirm or do it themselves** before proceeding. Do not switch to main to "sync" before editing. Do not stash uncommitted changes you didn't make. Do not assume the session-start branch snapshot is wrong and try to fix it.

**Why this matters:** the working tree is shared physical state, but each session has its own conversation context. Mid-task Git mutations are invisible to other sessions, so they corrupt edits silently — the other session keeps editing as if the old file contents are still there. Treating Git state as read-only by default keeps every session's edits coherent with what its conversation believes is on disk. **This rule overrides any auto-cleanup guidance elsewhere in this file.**

## Route Structure

The app splits into a **public front** and an **admin content hub**:

- **Public** (unauthenticated, no admin chrome):
  - `/` — public feed (infinite scroll) + stories row — always public
  - `/p/[id]` — individual post page with related posts — always public
  - `/s/[id]` — standalone story page — always public
  - `/chat` — AI chatbot over the archive — **subscriber-only** (always gated; admins also pass). Proxy redirects unauthenticated visitors to `/welcome?next=/chat`. Budget-tracked.
  - `/welcome` — Virtual Gil sign-in screen + subscribe explainer (paste an admin-issued code; default `next=/chat`).
- **Admin** (`/admin/*`, auth-gated):
  - `/admin` — redirects to `/admin/assistant` (the real home)
  - `/admin/assistant` — persistent AI assistant chat (primary interaction surface)
  - `/admin/planner` — weekly planner view (`PlannerDashboard`)
  - `/admin/posts`, `/admin/posts/[id]` — posts list + detail
  - `/admin/triage` — triage view over posts needing fixes / AI suggestions
  - `/admin/scheduled` — upcoming `PublishRecord`s on a calendar grid; a "Planner" toggle swaps in the same weekly planner UI
  - `/admin/rate` — rating / review UI (ratings API)
  - `/admin/audio` — audio asset management
  - `/admin/import` — ZIP / Drive import
  - `/admin/connections` — platform OAuth connections
  - `/admin/settings` — user settings
  - `/admin/todo` — todo list
  - `/admin/trash` — soft-deleted posts

`/admin/calendar` was removed — calendar-style views are served by dashboard + scheduled. Shared admin UI lives in `src/app/admin/_shared/` (notably `PostListShell`, used by posts + triage).

## Content Kinds

`Post.kind` distinguishes `POST`, `STORY`, and `REEL`. Public feed and admin Posts tab exclude stories and reels; stories render in a dedicated row, reels get their own tab/feed.

## Assistant (primary surface)

`/admin/assistant` is the home for the logged-in user — chat-first, AI-driven. Other admin pages are read-only views of what the assistant did.

- `POST /api/assistant` — main chat turn (tool use)
- `GET/POST /api/assistant/thread` — persistent thread state
- `GET /api/assistant/brief` — daily brief summary (backed by `/api/cron/daily-brief`)

The planner still exists as a feature (see below) but is typically driven via the assistant rather than a dedicated planner page.

## Planner

Weekly planner surfaces at `/admin/planner` (also reachable as a "Planner" toggle inside `/admin/scheduled`). AI tool-use generates slot recommendations. Key routes:
- `GET /api/planner/current` — current week's plan
- `POST /api/planner/generate` — AI recommendation
- `PATCH /api/planner/[planId]` — slot edits
- `POST /api/planner/[planId]/schedule` — approve plan → creates `PublishRecord`s (guarded against re-scheduling / empty platforms)
- `POST /api/chat/planner` — planning chat with tool use

## Key Architecture Decisions

### Auth
- Uses `trustHost: true` for Vercel forwarded headers
- `AUTH_REDIRECT_PROXY_URL` set on Vercel (Production + Preview) for PKCE cookies across preview deployments
- Do **not** set `NEXTAUTH_URL` on Vercel — it breaks the proxy
- **Two roles** on the JWT (`session.user.role`): `"admin"` and `"subscriber"`. Admins sign in via Google OAuth at `/login`; subscribers sign in at `/welcome` with a code (the `subscriber-credentials` Credentials provider in `src/lib/auth.ts`). Type augmentation in `src/types/next-auth.d.ts`.
- Role-aware gating lives in **`src/proxy.ts`** (Next 16's renamed `middleware.ts` — *do not* re-add `export const runtime = "nodejs"`; proxy always runs on Node and the export is rejected at build). The archive (`/`, `/p/*`, `/s/*`) is always public. Only `/chat` and `/api/chat` are gated — anonymous page hits redirect to `/welcome?next=/chat`; anonymous API hits get a 401 JSON response. Admin routes (`/admin/*`, `/api/admin/*`) require `role === "admin"`.

### Subscriber Gate
Per-person paid access (~$2/mo on FB Subscriptions) to the **virtual-Gil chat**. The archive itself is fully public — only `/chat` requires a subscriber session. Admin-issued codes, persistent per-subscriber chat memory, real-USD monthly budget per subscriber tracked from Anthropic `response.usage`.

- **Tables**: `Subscriber` (name + bcrypt code hash + monthly budget + cycle tracking + revoke timestamp), `SubscriberConversation`, `SubscriberMessage`, `SubscriberUsage` (audit log per chat turn).
- **Admin UI**: section in `/admin/settings` — generate codes, regenerate, revoke, see live $ spent / budget per subscriber. Plaintext code is shown **once** at creation, then only the bcrypt hash is stored.
- **Subscriber UI**: `<SubscriberHeader />` (in `src/components/`) renders on every archive page (`/`, `/p/*`, `/s/*`). For subscribers it shows "Hi, {name} · Talk to Virtual Gil · Sign out"; for anonymous visitors it shows a single "Talk to Virtual Gil →" CTA pointing at `/welcome`; for admins it returns null. Budget meter on `/chat` refetches after every turn via a `refreshKey` prop on `<BudgetMeter />`.
- **Budget enforcement** in `src/lib/subscribers/budget.ts`: lazy reset on first chat call of each UTC month, hard 429 when over, sequential awaits (no `$transaction` — pgbouncer transaction-pool mode times out).
- **Code library** in `src/lib/subscribers/{code,budget,service,signin-rate-limit}.ts`. Format `gil-{8-char alnum}`. 10 sign-in attempts/IP/hour rate-limit.
- **Pricing constants for Haiku 4.5** are hard-coded in `budget.ts` — update in lockstep if the model is changed.
- **Welcome / sign-in screen** (`/welcome`) is framed as the Virtual Gil sign-in. It includes a subscribe explainer with a `SUBSCRIBE_URL` constant at the top of `src/app/welcome/page.tsx` (placeholder Facebook supporters URL — swap to the real one when known), a "Browse the archive" escape hatch back to `/`, and the `SignInForm` Credentials sign-in.
- **`/api/chat`** is the rewritten public chat: requires a session (subscriber or admin), enforces the budget for subscribers (admin bypasses), wraps the system prompt in a `cache_control: { type: "ephemeral", ttl: "1h" }` block for prompt caching (~10× cost reduction), persists messages to `SubscriberConversation`, records usage. **Strip non-Anthropic fields from incoming `messages`** (the chat client stores rendered post-card data on each message; Anthropic rejects extra keys with 400).

### Storage — Cloudflare R2
`src/lib/storage.ts` is the single storage module. All writes and reads go to R2:
- `uploadBuffer(pathname, buffer, { contentType })` → PUTs to R2, returns a full public R2 URL and `hasAudio` (ffprobed for videos). The returned `url` is what gets stored in `Media.storageKey` / `AudioTrack.storageKey` — never store the bare path.
- `mediaKey(userId, filename)` / `audioKey(userId, filename)` → key helpers that prefix with `media/` or `audio/`
- `getSignedDownloadUrl(url)` / `getMediaUrl({ storageKey })` → return the URL as-is (pass-throughs; kept as stable callsites)
- `getThumbnailUrl(url, mimeType?)` → for videos, swaps extension to `.poster.jpg` (poster is generated + uploaded alongside the video); images/unknown pass through
- `getObject(url)` → fetches the buffer
- `deleteObject(url)` → parses the key from the URL and deletes from R2

**Historical migrations** (`scripts/migrate-cloudinary-to-r2.ts`, `scripts/migrate-blob-to-r2.ts`, `scripts/recover-orphaned-videos.ts`) were used to move every row off Cloudinary / Vercel Blob staging into R2. They're kept in-tree as reference; nothing in the running app still hits Cloudinary.

### Import System
- ZIP uploads staged via Vercel Blob (client-side direct upload) to bypass the ~4.5MB serverless body limit
- Processing runs in `after()` (Next.js) — keeps the lambda alive after response
- Facebook export formats: `your_posts_1.json` array and `{ name, photos: [...] }` albums
- `fixFBEncoding()` handles latin1-encoded UTF-8 strings in FB exports
- Google Drive sync (`/api/drive/*`, `DriveSync` model) is an alternative ingest path

### Social Platform Connections
Platforms use custom OAuth flows (not NextAuth providers) stored in `PlatformToken`. LinkedIn login-as-auth was removed; LinkedIn remains only as a publishing connection.

Platform modules under `src/lib/platforms/`: `instagram.ts`, `facebook.ts`, `linkedin.ts`, `tiktok.ts`, `youtube.ts`. OAuth routes under `src/app/api/connections/{instagram,facebook,linkedin,tiktok,google}/`.

- **Instagram**: Business Login API — `https://www.instagram.com/oauth/authorize`, scopes `instagram_business_basic,instagram_business_content_publish`, long-lived token via `https://graph.instagram.com/access_token`
- **Facebook**: publish connection (Graph API)
- **LinkedIn**: Authorization Code Flow — scopes `openid profile email w_member_social` (publish only)
- **TikTok**: PKCE (plain method)
- **YouTube/Google**: Drive + YouTube scopes via Google OAuth (`googleapis` SDK); same flow powers Google Drive sync

All redirect URIs use `APP_URL` env var (not `NEXTAUTH_URL`).

### AI Features
- **Post tagging** (`src/lib/analyze-post.ts`): Claude vision analyzes text + image/video frames → `String[]` tags saved to `Post.tags`. Video frames fetched from storage at 0/25/50/75/100% offsets. Runs automatically on import; bulk re-analysis via `/api/posts/bulk-analyze` and `/api/posts/bulk-caption-analyze`.
- **Caption analysis** (`src/lib/analyze-caption.ts`): per-post caption suggestions — `/api/posts/[id]/caption-suggestion`, `/api/posts/[id]/analyze`.
- **AI chat** (`/api/chat`): Loads user's last 500 posts (body + tags + date) into the system prompt, streams via `ReadableStream`. Uses Haiku 4.5 with 1h ephemeral prompt caching. Requires a NextAuth session; for subscribers, gated by their monthly USD budget. Persists to `SubscriberConversation` for subscribers; admin sessions are ephemeral (no DB writes from `/api/chat`). See "Subscriber Gate" above.
- **AI search** (`/api/posts/ai-search`): Haiku maps natural-language queries to tag matches + keyword fallbacks.
- **Assistant** (`src/lib/assistant/`): Persistent agent with tool use over the whole CMS (see Assistant section). Retrieval uses Haiku.
- **Readiness** (`src/lib/readiness.ts`, `readiness-service.ts`): Per-post readiness scoring, recomputed by the daily cron.

### Analytics
New module `src/lib/analytics/` fetches engagement snapshots from each connected platform (Instagram, Facebook, LinkedIn *not available for personal profiles*, TikTok, YouTube). Entry point: `GET /api/posts/[id]/analytics`. Records impressions / reach / likes / comments / shares / saves / videoViews into the DB.

### Cron Jobs (`vercel.json`)
All require `Authorization: Bearer <CRON_SECRET>`:
- `/api/cron/publish` — every 5 minutes, processes due `PENDING` `PublishRecord`s (max 20/tick). Was daily 00:00 until 2026-05-05 — that meant a post scheduled for 12:09 AM had to wait ~24h for the next tick.
- `/api/cron/drive-sync` — daily 02:00, syncs all enabled `DriveSync` configs
- `/api/cron/readiness` — daily 03:00, recomputes per-post readiness
- `/api/cron/daily-brief` — daily 05:00, builds the assistant's daily brief

`/api/cron/keepalive` exists in the codebase but is **not** scheduled in `vercel.json`.

### API Routes
Post detail page is a **server component** (fetches directly via Prisma). The posts list is a client component with pagination + multi-select. `useAutoSavePost` (`src/hooks/useAutoSavePost.ts`) debounces client-side PATCHes to `/api/posts/[id]` with idle/saving/saved/error states (default 800ms debounce).

Notable API namespaces beyond the above: `/api/assistant`, `/api/audio`, `/api/blob`, `/api/drive`, `/api/media`, `/api/public`, `/api/ratings`, `/api/tags`, `/api/triage`, `/api/trash`, `/api/users`.

## Environment Variables

Full list with `Where` + `Purpose` columns lives in [`docs/env-vars.md`](docs/env-vars.md). Two non-obvious ones worth keeping front-of-mind:
- `OWNER_USER_ID` / `GIL_USER_ID` — without these, `/` returns 500.
- `ADMIN_EMAILS` — comma-separated allowlist for admin Google sign-ins; without it, no Google account can be promoted to admin.
- `SUBSCRIBER_INDEX_PEPPER` — 32-byte hex; HMAC pepper for `Subscriber.codeBlindIndex` fast-lookup. Rotating without re-indexing forces every sign-in through the legacy O(N) bcrypt path.

## Feature Branch Workflow

Every new feature must be developed on a dedicated branch and pushed as a PR when complete:

1. **Before starting any feature work**, create a branch:
   ```bash
   git checkout -b feature/<short-name>
   ```
2. Do all implementation work on that branch
3. **When complete**, push and open a PR:
   ```bash
   git push -u origin feature/<short-name>
   gh pr create ...
   ```

Never commit feature work directly to `claude/personal-cms-social-posting-QV57t`. Bug fixes and config changes on the main branch are fine.

### Branch Hygiene

**Cleanup is part of "done".** A feature is not finished when the code is merged — it's finished when the branch is gone too. Whenever work in a session reaches the deployed-and-working state, immediately:

1. Merge the PR (or fast-forward main if local-only)
2. Delete the local branch (`git branch -d feature/<short-name>`)
3. Delete the remote branch (`git push origin --delete feature/<short-name>`, or `gh pr merge --delete-branch`)

Do this **without being asked** — the user should never have to say "clean up the branches". If you deployed it, delete the branch in the same response.

```bash
git checkout claude/personal-cms-social-posting-QV57t
git pull --ff-only
git branch -d feature/<short-name>
git push origin --delete feature/<short-name>
```

~~Also at the start and end of every session, run `git fetch --prune && git branch -r`...~~ **Removed.** Per *Parallel Sessions — Workspace Safety* above, sessions must not run `git fetch`, prune, or delete branches unprompted — those mutations affect other live sessions. If the user explicitly asks for a branch sweep, do it then and only then.

The only branches that should exist are:
- `claude/personal-cms-social-posting-QV57t` (main)
- 1–3 branches with **active, in-progress work**

Stale branches cause real bugs (e.g. localhost vs prod mismatch when the dev server runs from the wrong branch) — they're not just cosmetic clutter.

## Parallel Sessions — Use Worktrees

Eitan typically has **3–4 Claude Code sessions open in this repo at once**. They all share the same working tree at `/Users/eitan/Documents/Code-Projects/CMS-Gil.nosync`, which means **another session can switch the branch out from under you between turns** — your `git status` snapshot at session start is unreliable, and a `git commit` you intended for branch A can land on branch B that another session checked out.

This has caused real bugs: commits on the wrong branch, overwritten WIP, force-resets that nuked another session's in-flight work.

**Default rule: any work that isn't a one-line fix goes in a dedicated worktree.** Worktrees are isolated checkouts — other sessions can't switch your branch, your uncommitted changes can't follow another session's `git checkout`, and you can run a dev server in one without breaking the others.

```bash
# Create a worktree off main on a new branch
git worktree add ../cms-gil-<feature> -b feature/<name> origin/claude/personal-cms-social-posting-QV57t
cd ../cms-gil-<feature>
# ...do work, commit, push, PR as normal...

# When done (after PR is merged):
git worktree remove ../cms-gil-<feature>
```

The `superpowers:using-git-worktrees` skill walks through the safe pattern.

**If you must work in the main checkout** (one-line fixes, urgent hotfixes):
- Run `git branch --show-current` **immediately before any `Edit`/`Write`** and **immediately before `git commit`**. The branch you saw at session start may not be the branch you're on now.
- Never `git checkout <existing-branch>` if there are uncommitted changes you don't want to carry — they follow you across branches and silently land in the next commit.
- If `git status` shows commits, files, or stash entries you don't recognize, **STOP**. Run `git log --all --since="2 hours ago"` and `gh pr list` to see what other sessions are doing. Do not run any destructive op (`reset --hard`, force-push, `stash drop`, `branch -D`) until you've identified whose work it is.
- Name your stashes with intent (`git stash push -m "WIP on feature/X: <reason>"`) so other sessions can tell whose stash is whose.

When you do a destructive recovery (e.g. `reset --keep` to restore a branch after another session contaminated it), preserve the work first by force-updating the correct branch ref to point at your commit, then reset.

## UI Testing
The user handles browser/UI verification. Do **not** start a dev server, open Playwright, or otherwise drive the UI to validate frontend changes — just implement the change, make sure it type-checks and unit tests pass, then hand off. The user will test in the browser and report back if anything is broken.

### Mobile is part of "done"
The user reads this site on his phone. A UI change isn't done until it survives at iPhone-SE width (~375px). A `PostToolUse` hook in `.claude/settings.json` injects a mobile checklist after every `*.tsx` edit — when you see it, treat it as a blocking review of the component you just changed. Fix any item that fails before declaring the work complete. Recurring offenders are predictable: missing `min-w-0` on flex children, untruncated user strings, button rows without `flex-wrap`, fixed widths exceeding viewport, and modals without `max-h` + scroll.

## Autonomy
Claude must work with **maximum autonomy**. Do not ask Eitan to make decisions, choose between approaches, or confirm before proceeding. When facing ambiguity, make the best judgment call and execute. Only escalate when a genuine business decision is required (e.g., "should we delete these posts or archive them?"). Batch your work — investigate fully, fix everything you find, then report results.

Specifically:
- **Don't ask "should I X or Y?"** — pick the better option and do it
- **Don't ask "shall I proceed?"** — just proceed
- **Don't present options** — present results
- **Fix adjacent issues** you discover along the way without asking permission
- **When a script/fix partially works**, iterate until it fully works before reporting back
- **Exception**: never deploy to Vercel without explicit user approval

## Deploys

**Always use `npm run deploy`. Never use `vercel --prod` or `npx vercel`.**

`npm run deploy` runs `scripts/deploy.ts`, which POSTs to Vercel's REST API with `gitSource: { type: "github", ref: "claude/personal-cms-social-posting-QV57t", sha }`. Vercel pulls the commit straight from GitHub and builds it on Vercel's servers — the local working tree is never uploaded. This rules out a class of bug where a parallel session's WIP on disk leaks into prod.

`vercel --prod` does the opposite — it tars the working directory and uploads it. That's how PR #41's first deploy attempt failed: my filesystem had a half-refactored `AllPostsView.tsx` from another session's branch even though the merged commit on origin was clean.

Mechanics:
- Token: `VERCEL_TOKEN` is in `.env.local` (gitignored). Created at https://vercel.com/account/tokens. If a deploy ever fails with 401/403, check whether the token is still valid.
- The script pins a specific SHA (from `git rev-parse origin/claude/personal-cms-social-posting-QV57t`) so the deploy is deterministic — if someone pushes between read-and-build, the SHA we asked for is still what builds.
- Deploys still need explicit user approval per `Autonomy` above. Approval is per-PR, never standing.

## Running Commands
Never ask Eitan to run a command. Running scripts, migrations, backfills, tests, deploys — all of that is **your** job. Eitan's only job is checking the results you produce. If a command fails (network hiccup, missing env, DB cold start), diagnose and retry until it works; don't hand it back. Iterate to completion, then surface concrete results for him to review.

## Shell Command Rules
- Always quote paths with spaces: `cd "My Folder"` not `cd My\ Folder`
- Never use backslash-escaped whitespace in paths
- Do not chain commands with `&&` or `;` — run each command as a separate step
- Never combine `cd` with another command in the same line

## Live Working Documents (Do Not Delete)

Some files in `docs/` are **persistent state for ongoing pipelines**, not historical notes. They get read and rewritten across sessions, and losing them breaks resumption. Keep them committed; never delete, stash-and-forget, or treat them as scratch.

| File | What it tracks |
|---|---|
| `docs/fb-scraping-state.md` | Live progress + technique reference for the Facebook analytics scraper (Playwright MCP). Updated at the end of every scraping session. |

If a file like this turns up uncommitted on a feature branch where it doesn't belong, commit it to main as a docs change rather than discarding it.

## Common Gotchas
- `serverActions.bodySizeLimit: "500mb"` in `next.config.ts` applies to Server Actions only, not Route Handlers
- `after()` from `next/server` keeps the lambda alive post-response for background work
- Supabase has cold start latency — first DB query after idle is slow
- `Post.tags` uses a GIN index for array queries; use Prisma raw queries or array operators for tag filtering
- `Media.storageKey` / `AudioTrack.storageKey` always hold a full R2 URL — never concatenate URLs manually; go through `src/lib/storage.ts` helpers
- **Prisma + Supabase: do NOT run `prisma migrate dev`.** `DATABASE_URL` points at the production Supabase pooler, and `migrate dev` (even with `--create-only`) needs a writable shadow DB it can't get. Generate offline SQL with `npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script -o migration.sql` and apply with `psql -f`, then mark resolved via `npx prisma migrate resolve --applied <name>`.
- **Prisma transactions over pgbouncer (P2028 "Unable to start a transaction in the given time")**: `prisma.$transaction([...])` frequently fails on the Vercel/Supabase wiring because of pgbouncer's transaction-pool mode. Replace with sequential awaits when atomicity isn't strictly required. See `src/lib/subscribers/budget.ts`'s `recordUsage` for the pattern.
- **`.env.local` doesn't define `DATABASE_URL`** — `src/lib/prisma.ts` derives the connection from `POSTGRES_URL_NON_POOLING`. If you need `DATABASE_URL` for one-off Prisma CLI commands, `export DATABASE_URL="$POSTGRES_URL_NON_POOLING"` first.
- **`messages` field stripping in `/api/chat`**: the client message shape includes a `posts` field (rendered post-card data). Anthropic rejects extra keys with `messages.N.posts: Extra inputs are not permitted`. Server-side filter to `{role, content}` only — see `src/app/api/chat/route.ts`.
- **Vercel preview env vars are scoped per-branch by default in agent mode.** Pushing env vars without a branch arg fails the agent-mode prompt. To apply to all preview branches, use `vercel env add NAME preview --value VAL --yes` (omit branch); the CLI will prompt and may need clarification. To scope to one branch: `vercel env add NAME preview <branch> --value VAL --yes`. See `feedback_vercel_env_var_pushes.md` in agent memory for the auto-approve scope.
