# CMS-Gil — Claude Instructions

## Stack
- **Framework**: Next.js 16.2 App Router
- **Auth**: NextAuth v5 beta (`next-auth@5.0.0-beta.30`) — Google OAuth only (sign-in)
- **Database**: Neon PostgreSQL via Prisma 7
- **Storage**: Cloudinary (`cloudinary` v2) for media; Vercel Blob for ZIP upload staging
- **AI**: Anthropic SDK (`@anthropic-ai/sdk`) — `claude-sonnet-4-6` for tagging/chat, `claude-haiku-4-5` for search
- **Deployment**: Vercel at `cms-gil.vercel.app`
- **Language**: TypeScript, React 19

## Local Development
```bash
npm run dev                        # http://localhost:3000
npx vercel env pull .env.local     # sync env vars, then manually add:
#   AUTH_URL=http://localhost:3000
#   NEXTAUTH_URL=http://localhost:3000
#   APP_URL=http://localhost:3000
npx vercel --prod --yes            # deploy to production
npm test                           # vitest unit tests
```

Restart the dev server after any `.env.local` change.

## Route Structure

The app is split into a **public front** and an **admin content hub**:

- **Public** (unauthenticated, no layout chrome):
  - `/` — public feed (infinite scroll) + stories row
  - `/p/[id]` — individual post page with related posts
  - `/s/[id]` — standalone story page
  - `/chat` — public AI chatbot over the archive
- **Admin** (`/admin/*`, auth-gated via `(auth)` group):
  - `/admin` — weekly planner + chat layout (home for logged-in user)
  - `/admin/posts` — posts list with Posts/Stories/Reels kind tabs, multi-select, pagination
  - `/admin/posts/[id]` — post detail (server component, fetches via Prisma directly)
  - `/admin/scheduled`, `/admin/calendar`, `/admin/import`, `/admin/connections`, `/admin/trash`, `/admin/todo`, `/admin/dashboard`

All internal links use the `/admin/*` prefix. The dashboard used to live at the root; it was moved under `/admin` when the public site launched.

## Content Kinds

`Post.kind` distinguishes `POST`, `STORY`, and `REEL`. Public feed and admin Posts tab exclude stories and reels; stories render in a dedicated row, reels in their own tab/feed.

## Planner

Weekly planner (`/admin`) uses AI tool-use to generate slot recommendations. Key routes:
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

### Cloudinary (Media Storage)
- All uploads use `resource_type: "auto"`, `type: "upload"` (public)
- **Critical**: Strip file extension from `public_id` before uploading — Cloudinary appends format automatically; keeping it causes double-extension URLs (`.jpg.jpg`) → 404
- URL generation uses `resource_type: "image"` or `"video"` based on mimeType — never `"auto"` (invalid in CDN URLs)
- `mediaKey(userId, filename)` generates the storage key (stored with extension in DB, stripped when calling Cloudinary)

### Import System
- ZIP uploads staged via Vercel Blob (client-side direct upload) to bypass ~4.5MB serverless body limit
- Processing runs in `after()` (Next.js) — keeps lambda alive after response
- Facebook export formats: `your_posts_1.json` array and `{ name, photos: [...] }` albums
- `fixFBEncoding()` handles latin1-encoded UTF-8 strings in Facebook exports

### Social Platform Connections
Platforms use custom OAuth flows (not NextAuth providers) stored in `PlatformToken`. LinkedIn login-as-auth was removed; LinkedIn remains only as a publishing connection:

- **Instagram**: Business Login API — `https://www.instagram.com/oauth/authorize`, scopes `instagram_business_basic,instagram_business_content_publish`, long-lived token via `https://graph.instagram.com/access_token`
- **Facebook**: publish connection (current `feature/facebook-publish` work)
- **LinkedIn**: Authorization Code Flow — `https://www.linkedin.com/oauth/v2/authorization`, scopes `openid profile email w_member_social` (publish only)
- **TikTok**: PKCE (plain method)
- **YouTube/Google**: Drive + YouTube scopes via Google OAuth (`googleapis` SDK); same OAuth flow also used for Google Drive sync

All redirect URIs use `APP_URL` env var (not `NEXTAUTH_URL`).

### AI Features
- **Post tagging** (`src/lib/analyze-post.ts`): Claude vision analyzes text + images/video frames → `String[]` tags saved to `Post.tags`. Video frames fetched from Cloudinary at 0/25/50/75/100% offsets. Runs automatically on import with concurrency limiting.
- **AI chat** (`/api/chat`): Loads user's last 500 posts (body + tags + date) into system prompt, streams response via `ReadableStream`.
- **AI search** (`/api/posts/ai-search`): Uses available tag vocabulary to map natural-language queries to tag matches + keyword fallbacks.

### Cron Jobs (`vercel.json`)
- `/api/cron/publish` — runs daily at midnight, processes `PENDING` `PublishRecord`s whose `scheduledAt` has passed (max 20/tick)
- `/api/cron/drive-sync` — runs daily at 2am, syncs all enabled `DriveSync` configs
- Both require `Authorization: Bearer <CRON_SECRET>` header

### API Routes
- Post detail page is a **server component** — fetches directly from Prisma, no client-side API call
- Posts list is a client component with pagination and multi-select

## Environment Variables

| Variable | Where | Purpose |
|---|---|---|
| `DATABASE_URL` | Vercel + local | Neon PostgreSQL |
| `AUTH_SECRET` / `NEXTAUTH_SECRET` | Vercel + local | NextAuth signing key |
| `GOOGLE_CLIENT_ID/SECRET` | Vercel + local | Google OAuth (auth + Drive + YouTube) |
| `AUTH_REDIRECT_PROXY_URL` | Vercel only | PKCE proxy for preview deployments |
| `AUTH_URL` / `NEXTAUTH_URL` | Local only | `http://localhost:3000` |
| `APP_URL` | Vercel + local | Base URL for OAuth redirect URIs |
| `CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET` | Vercel + local | Media storage |
| `BLOB_READ_WRITE_TOKEN` | Vercel + local | Vercel Blob for ZIP staging |
| `ENCRYPTION_KEY` | Vercel + local | Encrypts platform OAuth tokens in DB |
| `ANTHROPIC_API_KEY` | Vercel + local | Claude API (tagging, chat, search) |
| `META_APP_ID/SECRET` | Vercel + local | Instagram OAuth |
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

## Running Commands
Never ask Eitan to run a command. Running scripts, migrations, backfills, tests, deploys — all of that is **your** job. Eitan's only job is checking the results you produce. If a command fails (network hiccup, missing env, DB cold start), diagnose and retry until it works; don't hand it back. Iterate to completion, then surface concrete results for him to review.

## Shell Command Rules
- Always quote paths with spaces: `cd "My Folder"` not `cd My\ Folder`
- Never use backslash-escaped whitespace in paths
- Do not chain commands with `&&` or `;` — run each command as a separate step
- Never combine `cd` with another command in the same line

## Common Gotchas
- `serverActions.bodySizeLimit: "500mb"` in `next.config.ts` applies to Server Actions only, not Route Handlers
- `after()` from `next/server` keeps the lambda alive post-response for background work
- Neon has cold start latency — first DB query after idle is slow
- `Post.tags` uses a GIN index for array queries; use Prisma raw queries or array operators for tag filtering
