# CMS-Gil — Claude Instructions

## Stack
- **Framework**: Next.js 16.2 App Router (`next@16.2.1`, React 19.2, TypeScript)
- **Auth**: NextAuth v5 beta — Google OAuth for admins, Credentials provider for subscribers
- **Database**: Supabase Postgres via Prisma 7 (`@prisma/adapter-pg`)
- **Storage**: Cloudflare R2 for all media; Vercel Blob only for ZIP upload staging. Single module: `src/lib/storage.ts`.
- **AI**: Anthropic SDK — `claude-sonnet-4-6` for tagging/planner/assistant, `claude-haiku-4-5` for search + `/api/chat` (1h prompt caching).
- **Deploy**: Vercel at `cms-gil.vercel.app`. Always `npm run deploy`.

## Parallel Sessions — Read This First

Eitan runs 3–4 Claude sessions in this repo at once, all sharing the same working tree. **Git mutations in one session silently change files under every other session and corrupt their edits.**

**The rule:** Don't run git commands that change state — `checkout`, `switch`, `branch`, `stash`, `reset`, `restore`, `clean`, `pull`, `merge`, `rebase`, `fetch`, force-push, history rewrites — unless the user asked for this specific action in this task. Reading (`status`, `log`, `diff`, `show`, `branch -v`) is always fine. Committing and pushing the **current** branch when asked is fine.

**For any non-trivial work, use a worktree** so other sessions can't switch your branch out from under you:

```bash
git worktree add ../cms-gil-<feature> -b feature/<name> origin/claude/personal-cms-social-posting-QV57t
cd ../cms-gil-<feature>
# do all work from inside the worktree
git worktree remove ../cms-gil-<feature>   # after PR is merged
```

If a task seems to require a mutation ("main is behind", "need a new branch"), say what you'd do and **wait for the user**. Don't sync, don't stash, don't tidy up — even if it looks helpful. **This rule overrides any cleanup guidance elsewhere in this file.**

Exception: merging a finished PR via `gh pr merge --delete-branch` is allowed without being asked — see Shipping. That command goes through the GitHub API and never touches your local working tree, so it's safe across parallel sessions. Local `git merge` is still off-limits.

## Working Rules

**Autonomy.** Don't ask "should I X or Y?" or "shall I proceed?" Pick the better option and do it. Fix adjacent issues you find. Iterate scripts until they fully work. **Only prod deploys** (`npm run deploy`) need explicit approval, per-PR.

**You run commands, not the user.** Migrations, backfills, tests, scripts. If a command fails (cold DB, network), diagnose and retry.

**Shell.** Quote paths with spaces. No backslash-escaped whitespace. Don't chain with `&&` or `;`. Never combine `cd` with another command on one line.

**UI testing is the user's job.** Don't start dev servers, don't open Playwright. Implement → type-check → unit tests → hand off.

**Mobile is part of "done".** Site is read on iPhone-SE-width (~375px). A `PostToolUse` hook injects a mobile checklist after every `*.tsx` edit — treat it as blocking. Recurring offenders: missing `min-w-0` on flex children, untruncated user strings, button rows without `flex-wrap`, fixed widths over viewport, modals without `max-h` + scroll.

**Long-running ops** (deploys, builds, migrations): use `run_in_background` so the conversation isn't frozen.

## Shipping

**Merge when done — don't wait to be told.** When tests + type-checks pass and the user has confirmed any UI behavior, finish the feature yourself: `gh pr merge --delete-branch` (uses the GitHub API, no local checkout/pull needed) + `git worktree remove ../cms-gil-<feature>`. If another session merged main ahead of you and you hit a conflict, rebase and resolve without asking (GitHub serializes merges, so this just happens sometimes — it's not a problem).

**Don't auto-deploy.** Parallel sessions often finish around the same time, and each deploy ties up a Vercel build slot for minutes. The user batches multiple merged features into one prod deploy. Just merge and stop — `npm run deploy` only when the user asks.

**Always `npm run deploy`. Never `vercel --prod` or `npx vercel`.** `scripts/deploy.ts` POSTs to Vercel's REST API with a pinned SHA from `origin/<main-branch>`; Vercel builds server-side, so parallel-session WIP can't leak into prod. `VERCEL_TOKEN` in `.env.local` (gitignored); 401/403 → token stale.

## App Map

**Public** (no admin chrome): `/` (feed + stories), `/p/[id]`, `/s/[id]` — always public. `/chat` — subscriber-only, budget-gated, proxy redirects anon to `/welcome?next=/chat`. `/welcome` — Virtual Gil sign-in + subscribe explainer.

**Admin** (`/admin/*`, Google OAuth gated): `/admin/assistant` is the home — everything else (posts, planner, scheduled, triage, rate, audio, import, connections, settings, todo, trash) is a read-only view of what the assistant did. Shared UI: `src/app/admin/_shared/`.

`Post.kind` is `POST | STORY | REEL`. Public feed and admin Posts tab exclude stories/reels; stories get a dedicated row, reels their own tab.

For route/feature specifics, read the source under `src/app/`, `src/lib/`, `src/lib/platforms/`.

## Auth

- `trustHost: true` for Vercel forwarded headers. `AUTH_REDIRECT_PROXY_URL` set on Vercel (Prod + Preview) for PKCE across previews. **Do not set `NEXTAUTH_URL` on Vercel** — it breaks the proxy.
- Two JWT roles (`session.user.role`): `"admin"` (Google OAuth via `/login`, allowlist from `ADMIN_EMAILS` + `User.isAdmin`) and `"subscriber"` (Credentials at `/welcome`). Type augmentation: `src/types/next-auth.d.ts`.
- Gating lives in `src/proxy.ts` (Next 16's renamed `middleware.ts`). Archive always public. `/chat` + `/api/chat` require any session. `/admin/*` + `/api/admin/*` require admin. **Do not re-add `export const runtime = "nodejs"`** — the export is rejected at build.
- Social platform OAuth is custom (not NextAuth); tokens in `PlatformToken`. Redirect URIs use `APP_URL`, not `NEXTAUTH_URL`. Modules: `src/lib/platforms/`.

## Subscriber Gate

Per-person paid access (~$2/mo via FB Subscriptions) to the virtual-Gil chat. Archive stays fully public. Admin-issued codes, persistent per-subscriber memory, real-USD monthly budget tracked from Anthropic `response.usage`. Plaintext code shown **once** at creation; only bcrypt hash stored. Code format `gil-{8-char alnum}`, 10 sign-in attempts/IP/hour. Code: `src/lib/subscribers/{code,budget,service,signin-rate-limit}.ts`. Tables: `Subscriber`, `SubscriberConversation`, `SubscriberMessage`, `SubscriberUsage`.

Three load-bearing gotchas:
- **Budget enforcement** (`src/lib/subscribers/budget.ts`): sequential awaits, **no `$transaction`** — pgbouncer transaction-pool times out.
- **Haiku 4.5 pricing constants are hard-coded** in `budget.ts` — update in lockstep if the model changes.
- **`/api/chat` must strip non-Anthropic fields from incoming `messages`** — client adds a `posts` field (rendered card data) and Anthropic rejects extra keys with 400. System prompt is wrapped in `cache_control: { type: "ephemeral", ttl: "1h" }` for ~10× cost reduction.

## Local Development

```bash
npm run dev                        # http://localhost:3000
npx vercel env pull .env.local     # then manually add:
#   AUTH_URL=http://localhost:3000
#   NEXTAUTH_URL=http://localhost:3000
#   APP_URL=http://localhost:3000
npm test                           # vitest
```

Dev server restarts after `.env.local` changes are the user's job (UI testing rule).

## Live Working Documents (Do Not Delete)

Persistent state for ongoing pipelines, not historical notes. Keep committed; never stash-and-forget.

| File | What it tracks |
|---|---|
| `docs/fb-scraping-state.md` | Live progress + technique for the FB analytics scraper (Playwright MCP). Updated end of every scraping session. |

## Environment Variables

Full list in [`docs/env-vars.md`](docs/env-vars.md). Three that break startup or core flows:
- `OWNER_USER_ID` / `GIL_USER_ID` — without these, `/` returns 500.
- `ADMIN_EMAILS` — without it, no Google account can be admin.
- `SUBSCRIBER_INDEX_PEPPER` — 32-byte hex HMAC pepper for `Subscriber.codeBlindIndex`. Rotating without re-indexing forces every sign-in through legacy O(N) bcrypt.

Vercel env var pushes: `vercel env add NAME preview --value VAL --yes` for all preview branches; add a branch arg to scope. Pre-approved per `feedback_vercel_env_var_pushes.md`.

## Common Gotchas

- `serverActions.bodySizeLimit: "500mb"` in `next.config.ts` applies to Server Actions only, **not Route Handlers**.
- `after()` from `next/server` keeps the lambda alive post-response for background work.
- Supabase has cold-start latency — first DB query after idle is slow.
- `Post.tags` uses a GIN index; use Prisma raw queries or array operators for tag filtering.
- `Media.storageKey` / `AudioTrack.storageKey` always hold a **full R2 URL** — never concatenate manually; go through `src/lib/storage.ts`.
- **Prisma + Supabase: do NOT run `prisma migrate dev`.** `DATABASE_URL` points at the production pooler and `migrate dev` needs a writable shadow DB it can't get. Instead: `npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script -o migration.sql`, apply with `psql -f`, then `npx prisma migrate resolve --applied <name>`.
- **Prisma transactions over pgbouncer (P2028)**: `$transaction([...])` frequently times out on Vercel/Supabase. Replace with sequential awaits when atomicity isn't strictly required. Pattern: `src/lib/subscribers/budget.ts` `recordUsage`.
- `.env.local` doesn't define `DATABASE_URL` — `src/lib/prisma.ts` derives it from `POSTGRES_URL_NON_POOLING`. For one-off Prisma CLI: `export DATABASE_URL="$POSTGRES_URL_NON_POOLING"` first.
- ZIP imports stage via Vercel Blob (client-side direct upload) to bypass the ~4.5MB serverless body limit; processing runs in `after()`. FB exports come as `your_posts_1.json` arrays or `{ name, photos: [...] }` albums; `fixFBEncoding()` handles latin1-encoded UTF-8.
