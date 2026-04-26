# CMS-Gil — Claude Instructions

## Stack
- **Framework**: Next.js 16.2 App Router (`next@16.2.1`, React 19.2)
- **Auth**: NextAuth v5 beta (`next-auth@5.0.0-beta.30`) — Google OAuth only (sign-in)
- **Database**: Supabase PostgreSQL via Prisma 7 (`@prisma/adapter-pg`) — migrated from Neon
- **Storage**: **Cloudflare R2** (via `@aws-sdk/client-s3`) for all media; Vercel Blob for ZIP upload staging. (Cloudinary was the previous media host; all rows have been migrated to R2 and the Cloudinary SDK + fallback have been removed.)
- **AI**: Anthropic SDK (`@anthropic-ai/sdk@^0.82`) — `claude-sonnet-4-6` for tagging/chat/planner/assistant, `claude-haiku-4-5` (pinned in places as `claude-haiku-4-5-20251001`) for search + retrieval
- **Deployment**: Vercel at `cms-gil.vercel.app`
- **Language**: TypeScript, React 19

## Local Development
```bash
npm run dev                        # http://localhost:3000
npx vercel env pull .env.local     # sync env vars, then manually add:
#   AUTH_URL=http://localhost:3000
#   NEXTAUTH_URL=http://localhost:3000
#   APP_URL=http://localhost:3000
npx vercel --prod --yes            # deploy to production (ASK FIRST — see Autonomy)
npm test                           # vitest unit tests
```

Restart the dev server after any `.env.local` change.

## Route Structure

The app splits into a **public front** and an **admin content hub**:

- **Public** (unauthenticated, no admin chrome):
  - `/` — public feed (infinite scroll) + stories row
  - `/p/[id]` — individual post page with related posts
  - `/s/[id]` — standalone story page
  - `/chat` — public AI chatbot over the archive
- **Admin** (`/admin/*`, auth-gated):
  - `/admin` — redirects to `/admin/assistant` (the real home)
  - `/admin/assistant` — persistent AI assistant chat (primary interaction surface)
  - `/admin/dashboard` — weekly planner view (`PlannerDashboard`)
  - `/admin/posts`, `/admin/posts/[id]` — posts list + detail
  - `/admin/triage` — triage view over posts needing fixes / AI suggestions
  - `/admin/scheduled` — upcoming `PublishRecord`s
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

Weekly planner surfaces at `/admin/dashboard`. AI tool-use generates slot recommendations. Key routes:
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
- **AI chat** (`/api/chat`): Loads user's last 500 posts (body + tags + date) into the system prompt, streams via `ReadableStream`.
- **AI search** (`/api/posts/ai-search`): Haiku maps natural-language queries to tag matches + keyword fallbacks.
- **Assistant** (`src/lib/assistant/`): Persistent agent with tool use over the whole CMS (see Assistant section). Retrieval uses Haiku.
- **Readiness** (`src/lib/readiness.ts`, `readiness-service.ts`): Per-post readiness scoring, recomputed by the daily cron.

### Analytics
New module `src/lib/analytics/` fetches engagement snapshots from each connected platform (Instagram, Facebook, LinkedIn *not available for personal profiles*, TikTok, YouTube). Entry point: `GET /api/posts/[id]/analytics`. Records impressions / reach / likes / comments / shares / saves / videoViews into the DB.

### Cron Jobs (`vercel.json`)
All require `Authorization: Bearer <CRON_SECRET>`:
- `/api/cron/publish` — daily 00:00, processes due `PENDING` `PublishRecord`s (max 20/tick)
- `/api/cron/drive-sync` — daily 02:00, syncs all enabled `DriveSync` configs
- `/api/cron/readiness` — daily 03:00, recomputes per-post readiness
- `/api/cron/daily-brief` — daily 05:00, builds the assistant's daily brief

`/api/cron/keepalive` exists in the codebase but is **not** scheduled in `vercel.json`.

### API Routes
Post detail page is a **server component** (fetches directly via Prisma). The posts list is a client component with pagination + multi-select. `useAutoSavePost` (`src/hooks/useAutoSavePost.ts`) debounces client-side PATCHes to `/api/posts/[id]` with idle/saving/saved/error states (default 800ms debounce).

Notable API namespaces beyond the above: `/api/assistant`, `/api/audio`, `/api/blob`, `/api/drive`, `/api/media`, `/api/public`, `/api/ratings`, `/api/tags`, `/api/triage`, `/api/trash`, `/api/users`.

## Environment Variables

| Variable | Where | Purpose |
|---|---|---|
| `DATABASE_URL` | Vercel + local | Supabase PostgreSQL |
| `AUTH_SECRET` / `NEXTAUTH_SECRET` | Vercel + local | NextAuth signing key |
| `GOOGLE_CLIENT_ID/SECRET` | Vercel + local | Google OAuth (auth + Drive + YouTube) |
| `AUTH_REDIRECT_PROXY_URL` | Vercel only | PKCE proxy for preview deployments |
| `AUTH_URL` / `NEXTAUTH_URL` | Local only | `http://localhost:3000` |
| `APP_URL` | Vercel + local | Base URL for OAuth redirect URIs |
| `R2_ENDPOINT` | Vercel + local | Cloudflare R2 S3 endpoint |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | Vercel + local | R2 credentials |
| `R2_BUCKET_NAME` | Vercel + local | R2 bucket (defaults to `cms-gil-media`) |
| `R2_PUBLIC_URL` | Vercel + local | Public base URL for R2 (required) |
| `BLOB_READ_WRITE_TOKEN` | Vercel + local | Vercel Blob for ZIP staging |
| `ENCRYPTION_KEY` | Vercel + local | Encrypts platform OAuth tokens in DB |
| `ANTHROPIC_API_KEY` | Vercel + local | Claude API (tagging, chat, search, assistant) |
| `META_APP_ID/SECRET` | Vercel + local | Instagram + Facebook OAuth |
| `TIKTOK_CLIENT_KEY/SECRET` | Vercel + local | TikTok OAuth |
| `LINKEDIN_CLIENT_ID/SECRET` | Vercel + local | LinkedIn OAuth |
| `CRON_SECRET` | Vercel + local | Authenticates Vercel cron requests |

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

Also at the **start and end of every session**, run `git fetch --prune && git branch -r` and check for branches with merged or stale PRs. Delete the merged ones; flag stale open PRs to the user for a judgment call (don't auto-close them).

The only branches that should exist are:
- `claude/personal-cms-social-posting-QV57t` (main)
- 1–3 branches with **active, in-progress work**

Stale branches cause real bugs (e.g. localhost vs prod mismatch when the dev server runs from the wrong branch) — they're not just cosmetic clutter.

## UI Testing
The user handles browser/UI verification. Do **not** start a dev server, open Playwright, or otherwise drive the UI to validate frontend changes — just implement the change, make sure it type-checks and unit tests pass, then hand off. The user will test in the browser and report back if anything is broken.

## Autonomy
Claude must work with **maximum autonomy**. Do not ask Eitan to make decisions, choose between approaches, or confirm before proceeding. When facing ambiguity, make the best judgment call and execute. Only escalate when a genuine business decision is required (e.g., "should we delete these posts or archive them?"). Batch your work — investigate fully, fix everything you find, then report results.

Specifically:
- **Don't ask "should I X or Y?"** — pick the better option and do it
- **Don't ask "shall I proceed?"** — just proceed
- **Don't present options** — present results
- **Fix adjacent issues** you discover along the way without asking permission
- **When a script/fix partially works**, iterate until it fully works before reporting back
- **Exception**: never deploy to Vercel without explicit user approval

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
