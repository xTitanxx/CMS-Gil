# Threads + Substack Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Threads (full Meta API) and Substack (manual-helper) as publishing destinations alongside the existing platforms.

**Architecture:** Threads is implemented like Instagram — a `src/lib/platforms/threads.ts` module with 2-step container/publish flow, its own OAuth pair of routes, a `PlatformToken` row, and a `case "THREADS"` branch in the publish-dispatch switch. Substack has no posting API, so it follows the existing `FACEBOOK_PERSONAL` marker pattern: a UI marker that places posts into a `/admin/manual-substack` queue (mirroring `/admin/manual-fb`) where the user copies body to clipboard, opens Substack's editor, and pastes the resulting permalink back.

**Tech Stack:** Next.js 16.2 App Router, Prisma 7 + Supabase Postgres, NextAuth v5 (admin sessions), `fetchWithTimeout` for HTTP, Tailwind + Lucide for UI, Vitest for tests.

---

## File Structure

**Create:**
- `src/lib/platforms/threads.ts` — Threads API client (`postToThreads`, container helpers, publish, permalink, token refresh).
- `src/lib/platforms/threads.test.ts` — unit tests for `postToThreads` with mocked fetch.
- `src/app/api/connections/threads/route.ts` — OAuth start.
- `src/app/api/connections/threads/callback/route.ts` — OAuth callback.
- `src/app/api/admin/manual-substack-queue/route.ts` — list endpoint for the manual-substack queue.
- `src/app/api/admin/manual-substack-queue/count/route.ts` — overdue count for the sidebar badge.
- `src/app/api/admin/manual-substack-queue/mark-published/route.ts` — accept the Substack permalink and flip the publish record.
- `src/app/api/admin/substack-settings/route.ts` — GET/PUT for the publication URL.
- `src/app/admin/manual-substack/page.tsx` — server component, loads the queue.
- `src/app/admin/manual-substack/ManualSubstackQueueClient.tsx` — client UI mirroring `ManualFbQueueClient.tsx`.

**Modify:**
- `prisma/schema.prisma` — extend `enum Platform` (add `THREADS`, `SUBSTACK`) and `User` (add `substackPublicationUrl String?`).
- `src/lib/platform-eligibility.ts` — add `THREADS` to `ALL_PUBLISHABLE_PLATFORMS` and the eligibility switch.
- `src/lib/planner/platform-assignment.ts` — add `THREADS` to `MAIN_MEDIA_PLATFORMS` and `MAIN_TEXT_PLATFORMS`.
- `src/app/api/posts/[id]/publish/route.ts` — add `case "THREADS"` to the dispatch switch.
- `src/app/api/posts/[id]/scheduled-platforms/route.ts` — add `THREADS` to `ALLOWED_INPUT` and `AUTO_PLATFORMS`; add `SUBSTACK` marker handled like `FB_PERSONAL_MARKER`.
- `src/app/admin/_shared/PlatformPickerModal.tsx` — add Threads chip to `AUTO_CHIPS`, add a Substack chip to a manual list alongside `FB_PERSONAL_CHIP`.
- `src/app/admin/connections/ConnectionsPage.tsx` — add Threads + Substack rows.
- `docs/env-vars.md` — document `THREADS_APP_ID`, `THREADS_APP_SECRET`.

Substack's `Platform` enum value lives on `PublishRecord` rows only — it never reaches the publish-dispatch switch and never has a `PlatformToken` row. The marker pattern (`SUBSTACK` in `WeeklyPlanSlot.platforms`) matches how `FACEBOOK_PERSONAL` already routes posts to `/admin/manual-fb` without a real Platform enum entry — except here we DO have a real enum value, so the `PublishRecord` can carry it.

---

## Task 1: Prisma schema — add Threads + Substack to Platform enum, Substack URL to User

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_threads_substack/migration.sql` (generated)

- [ ] **Step 1: Edit `prisma/schema.prisma` enum + User**

Find the `enum Platform` block and append:

```prisma
enum Platform {
  FACEBOOK
  FACEBOOK_PAGE
  INSTAGRAM
  LINKEDIN
  YOUTUBE
  TIKTOK
  THREADS
  SUBSTACK
}
```

Find the `model User` block and add this line before the relations list (keep alongside `passwordHash`, `isAdmin`):

```prisma
  // Substack publication root URL (e.g. https://example.substack.com). Used
  // by the manual-substack queue to open the editor at <url>/publish/post.
  // Null until the user configures it from /admin/connections.
  substackPublicationUrl String?
```

- [ ] **Step 2: Generate migration SQL**

The project's recipe (CLAUDE.md) avoids `prisma migrate dev` because `DATABASE_URL` points at the pooler. Generate the diff and apply with psql:

```bash
cd /Users/eitan/Documents/Code-Projects/cms-gil-threads-substack
export DATABASE_URL="$POSTGRES_URL_NON_POOLING"
mkdir -p prisma/migrations/$(date +%Y%m%d%H%M%S)_add_threads_substack
npx prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --script -o migration.sql
```

Expected: `migration.sql` written to repo root with two `ALTER TYPE "Platform" ADD VALUE` statements and one `ALTER TABLE "User" ADD COLUMN "substackPublicationUrl"` statement.

- [ ] **Step 3: Inspect the generated SQL**

Open `migration.sql`. It should look like:

```sql
ALTER TYPE "Platform" ADD VALUE 'THREADS';
ALTER TYPE "Platform" ADD VALUE 'SUBSTACK';
ALTER TABLE "User" ADD COLUMN "substackPublicationUrl" TEXT;
```

If anything else is in there, abort and re-diff — the schema should have no other pending drift.

- [ ] **Step 4: Apply the migration**

```bash
psql "$POSTGRES_URL_NON_POOLING" -f migration.sql
```

Expected output: `ALTER TYPE`, `ALTER TYPE`, `ALTER TABLE`. No errors.

- [ ] **Step 5: Record as applied + regenerate client**

```bash
MIG_NAME="add_threads_substack"
mv migration.sql prisma/migrations/$(date +%Y%m%d%H%M%S)_${MIG_NAME}/migration.sql
npx prisma migrate resolve --applied $(ls prisma/migrations | tail -1)
npx prisma generate
```

Expected: prisma client regenerates; `Platform` type now includes `THREADS | SUBSTACK`.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(schema): add THREADS, SUBSTACK platforms and User.substackPublicationUrl"
```

---

## Task 2: Add Threads to eligibility + planner

**Files:**
- Modify: `src/lib/platform-eligibility.ts`
- Modify: `src/lib/planner/platform-assignment.ts`
- Test: `src/lib/planner/platform-assignment.test.ts` (extend)

- [ ] **Step 1: Add THREADS to `ALL_PUBLISHABLE_PLATFORMS` and the switch**

In `src/lib/platform-eligibility.ts`:

```ts
export const ALL_PUBLISHABLE_PLATFORMS = [
  "FACEBOOK_PAGE",
  "INSTAGRAM",
  "LINKEDIN",
  "YOUTUBE",
  "TIKTOK",
  "THREADS",
] as const;
```

In the same file, update `isPlatformEligible`. Threads accepts text, images, and video (carousels too), like LinkedIn — any media shape is OK:

```ts
export function isPlatformEligible(
  platform: PublishablePlatform | string,
  shape: MediaShape
): boolean {
  const { hasVideo, hasImage } = shape;
  switch (platform) {
    case "YOUTUBE":
    case "TIKTOK":
      return hasVideo;
    case "INSTAGRAM":
      return hasVideo || hasImage;
    case "FACEBOOK_PAGE":
    case "LINKEDIN":
    case "THREADS":
      return true;
    default:
      return false;
  }
}
```

- [ ] **Step 2: Add THREADS to planner platform-assignment**

In `src/lib/planner/platform-assignment.ts`, add to both sets so Threads is treated as a MAIN platform (text or media):

```ts
const MAIN_MEDIA_PLATFORMS = new Set([
  "FACEBOOK_PAGE",
  "INSTAGRAM",
  "LINKEDIN",
  "THREADS",
]);
const MAIN_TEXT_PLATFORMS = new Set([
  "FACEBOOK_PAGE",
  "LINKEDIN",
  "THREADS",
]);
```

- [ ] **Step 3: Add tests for THREADS in `platform-assignment.test.ts`**

Append to the existing describe block:

```ts
it("includes THREADS for text posts", () => {
  const connected = ["FACEBOOK_PAGE", "INSTAGRAM", "LINKEDIN", "THREADS"];
  const result = getEligiblePlatforms([], connected, "MAIN");
  expect(result).toEqual(["FACEBOOK_PAGE", "LINKEDIN", "THREADS"]);
});

it("includes THREADS for image posts", () => {
  const connected = ["FACEBOOK_PAGE", "INSTAGRAM", "LINKEDIN", "THREADS"];
  const result = getEligiblePlatforms(["image/jpeg"], connected, "MAIN");
  expect(result).toEqual([
    "FACEBOOK_PAGE",
    "INSTAGRAM",
    "LINKEDIN",
    "THREADS",
  ]);
});

it("treats a THREADS-only slot as MAIN", () => {
  expect(inferSlotGroup(["THREADS"])).toBe("MAIN");
});
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/lib/planner/platform-assignment.test.ts
```

Expected: all green, including the three new cases.

- [ ] **Step 5: Commit**

```bash
git add src/lib/platform-eligibility.ts src/lib/planner/platform-assignment.ts src/lib/planner/platform-assignment.test.ts
git commit -m "feat(planner): treat Threads as a MAIN platform with text+media eligibility"
```

---

## Task 3: `src/lib/platforms/threads.ts` (text + image + video + carousel + publish)

**Files:**
- Create: `src/lib/platforms/threads.ts`

Implementation hews very close to `src/lib/platforms/instagram.ts`. The two-step container/publish flow is the same; only base URL, field names, and one quirk differ (Threads accepts text-only — IG doesn't).

- [ ] **Step 1: Write the full module**

Create `src/lib/platforms/threads.ts`:

```ts
// Meta Graph API — Threads Content Publishing
// Docs: https://developers.facebook.com/docs/threads/
// Requires scopes: threads_basic, threads_content_publish
// Base URL: https://graph.threads.net/v1.0

import { getSignedDownloadUrl } from "@/lib/storage";
import { fetchWithTimeout } from "@/lib/platforms/_fetch";

const BASE_URL = "https://graph.threads.net/v1.0";

// Meta's URL fetcher refuses URLs with literal spaces or other unsafe bytes.
// encodeURI leaves `:/?#&=` alone so already-valid URLs are unchanged.
function encodeForRemoteFetch(url: string): string {
  return encodeURI(url);
}

interface PublishResult {
  platformPostId: string;
  platformUrl?: string;
}

interface ThreadsCredentials {
  accessToken: string;
  platformUserId: string;
}

function isVideoKey(key: string): boolean {
  return /\.(mp4|mov|avi|webm)$/i.test(key);
}

export async function postToThreads(
  creds: ThreadsCredentials,
  body: string,
  mediaKeys: string[],
  _postType: string = "POST",
): Promise<PublishResult> {
  const { accessToken, platformUserId } = creds;

  if (mediaKeys.length === 0) {
    // Text-only post
    const containerId = await createTextContainer(platformUserId, body, accessToken);
    return publishContainer(platformUserId, containerId, accessToken);
  }

  if (mediaKeys.length === 1) {
    const mediaUrl = await getSignedDownloadUrl(mediaKeys[0]);
    const containerId = isVideoKey(mediaKeys[0])
      ? await createVideoContainer(platformUserId, mediaUrl, body, accessToken)
      : await createImageContainer(platformUserId, mediaUrl, body, accessToken);
    await waitForContainer(containerId, accessToken);
    return publishContainer(platformUserId, containerId, accessToken);
  }

  // Carousel — Threads supports up to 20 items per post.
  const childIds: string[] = [];
  for (const key of mediaKeys.slice(0, 20)) {
    const mediaUrl = await getSignedDownloadUrl(key);
    const id = isVideoKey(key)
      ? await createVideoContainer(platformUserId, mediaUrl, undefined, accessToken, true)
      : await createImageContainer(platformUserId, mediaUrl, undefined, accessToken, true);
    childIds.push(id);
  }
  await Promise.all(childIds.map((id) => waitForContainer(id, accessToken)));

  const carouselId = await createCarouselContainer(
    platformUserId,
    childIds,
    body,
    accessToken,
  );
  await waitForContainer(carouselId, accessToken);
  return publishContainer(platformUserId, carouselId, accessToken);
}

async function createTextContainer(
  userId: string,
  text: string,
  accessToken: string,
): Promise<string> {
  const res = await fetchWithTimeout(`${BASE_URL}/${userId}/threads`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      media_type: "TEXT",
      text,
      access_token: accessToken,
    }),
    timeoutMs: 30_000,
  });
  const data = await res.json();
  if (!data.id) throw new Error(`Threads text container error: ${JSON.stringify(data)}`);
  return data.id;
}

async function createImageContainer(
  userId: string,
  imageUrl: string,
  text: string | undefined,
  accessToken: string,
  isCarouselItem = false,
): Promise<string> {
  const res = await fetchWithTimeout(`${BASE_URL}/${userId}/threads`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      media_type: "IMAGE",
      image_url: encodeForRemoteFetch(imageUrl),
      ...(text !== undefined ? { text } : {}),
      ...(isCarouselItem ? { is_carousel_item: true } : {}),
      access_token: accessToken,
    }),
    timeoutMs: 30_000,
  });
  const data = await res.json();
  if (!data.id) throw new Error(`Threads image container error: ${JSON.stringify(data)}`);
  return data.id;
}

async function createVideoContainer(
  userId: string,
  videoUrl: string,
  text: string | undefined,
  accessToken: string,
  isCarouselItem = false,
): Promise<string> {
  const res = await fetchWithTimeout(`${BASE_URL}/${userId}/threads`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      media_type: "VIDEO",
      video_url: encodeForRemoteFetch(videoUrl),
      ...(text !== undefined ? { text } : {}),
      ...(isCarouselItem ? { is_carousel_item: true } : {}),
      access_token: accessToken,
    }),
    timeoutMs: 30_000,
  });
  const data = await res.json();
  if (!data.id) throw new Error(`Threads video container error: ${JSON.stringify(data)}`);
  return data.id;
}

async function createCarouselContainer(
  userId: string,
  childIds: string[],
  text: string,
  accessToken: string,
): Promise<string> {
  const res = await fetchWithTimeout(`${BASE_URL}/${userId}/threads`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      media_type: "CAROUSEL",
      children: childIds.join(","),
      text,
      access_token: accessToken,
    }),
    timeoutMs: 30_000,
  });
  const data = await res.json();
  if (!data.id) throw new Error(`Threads carousel container error: ${JSON.stringify(data)}`);
  return data.id;
}

// Threads container polling. Image containers usually FINISH on the first
// poll; video containers can take 30–120s. Poll fast for the first ~30s,
// then back off. Mirrors Instagram's strategy in instagram.ts.
async function waitForContainer(
  containerId: string,
  accessToken: string,
  maxWaitMs = 240_000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const res = await fetchWithTimeout(
      `${BASE_URL}/${containerId}?fields=status&access_token=${accessToken}`,
      { timeoutMs: 15_000 },
    );
    const data = await res.json();
    const status = (data.status ?? data.status_code) as string | undefined;
    if (status === "FINISHED") return;
    if (status === "ERROR") throw new Error("Threads media processing failed");
    if (status === "EXPIRED") throw new Error("Threads container expired before publish");
    const elapsed = Date.now() - start;
    await new Promise((r) => setTimeout(r, elapsed < 30_000 ? 3_000 : 10_000));
  }
  throw new Error("Threads container processing timed out");
}

async function publishContainer(
  userId: string,
  containerId: string,
  accessToken: string,
): Promise<PublishResult> {
  const res = await fetchWithTimeout(
    `${BASE_URL}/${userId}/threads_publish`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        creation_id: containerId,
        access_token: accessToken,
      }),
      timeoutMs: 30_000,
    },
  );
  const data = await res.json();
  if (!data.id) throw new Error(`Threads publish error: ${JSON.stringify(data)}`);

  let platformUrl: string | undefined;
  try {
    const permalinkRes = await fetchWithTimeout(
      `${BASE_URL}/${data.id}?fields=permalink&access_token=${accessToken}`,
      { timeoutMs: 15_000 },
    );
    const permalinkData = await permalinkRes.json();
    if (typeof permalinkData.permalink === "string") {
      platformUrl = permalinkData.permalink;
    }
  } catch {
    // Best-effort permalink lookup — publish itself succeeded.
  }

  return { platformPostId: data.id, platformUrl };
}

// Long-lived Threads tokens last 60 days and can be refreshed any time after
// they're 24h old, returning a new 60-day token. Call this before publish
// when the stored token has <7 days remaining.
export async function refreshThreadsToken(accessToken: string): Promise<{
  accessToken: string;
  expiresIn: number;
}> {
  const url = new URL(`${BASE_URL.replace("/v1.0", "")}/refresh_access_token`);
  url.searchParams.set("grant_type", "th_refresh_token");
  url.searchParams.set("access_token", accessToken);
  const res = await fetchWithTimeout(url.toString(), { timeoutMs: 15_000 });
  const data = await res.json();
  if (!data.access_token) {
    throw new Error(`Threads refresh failed: ${JSON.stringify(data)}`);
  }
  return {
    accessToken: data.access_token as string,
    expiresIn: (data.expires_in as number | undefined) ?? 5183944,
  };
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/platforms/threads.ts
git commit -m "feat(threads): platform client with text, image, video, carousel + token refresh"
```

---

## Task 4: `threads.test.ts` — unit tests with mocked fetch

**Files:**
- Create: `src/lib/platforms/threads.test.ts`

- [ ] **Step 1: Write the test file**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { postToThreads } from "./threads";

// Stub the storage signing — every key maps to a deterministic URL.
vi.mock("@/lib/storage", () => ({
  getSignedDownloadUrl: vi.fn(async (key: string) => `https://r2.example.com/${key}`),
}));

// Stub fetchWithTimeout in a way that we can drive per-call responses.
type FetchResponse = { json: () => Promise<unknown> };
const fetchQueue: FetchResponse[] = [];
function enqueue(response: unknown) {
  fetchQueue.push({ json: async () => response });
}

vi.mock("@/lib/platforms/_fetch", () => ({
  fetchWithTimeout: vi.fn(async () => {
    const next = fetchQueue.shift();
    if (!next) throw new Error("fetchQueue exhausted — test forgot to enqueue a response");
    return next;
  }),
}));

const CREDS = { accessToken: "TOK", platformUserId: "USER1" };

beforeEach(() => {
  fetchQueue.length = 0;
});

afterEach(() => {
  if (fetchQueue.length > 0) {
    throw new Error(`fetchQueue not drained — ${fetchQueue.length} unused responses`);
  }
});

describe("postToThreads", () => {
  it("posts a text-only thread", async () => {
    enqueue({ id: "C1" }); // createTextContainer
    enqueue({ id: "M1" }); // publishContainer
    enqueue({ permalink: "https://threads.net/@u/post/M1" }); // permalink lookup

    const result = await postToThreads(CREDS, "hello world", []);

    expect(result).toEqual({
      platformPostId: "M1",
      platformUrl: "https://threads.net/@u/post/M1",
    });
  });

  it("posts a single image, waiting for the container", async () => {
    enqueue({ id: "C2" }); // createImageContainer
    enqueue({ status: "IN_PROGRESS" }); // first poll
    enqueue({ status: "FINISHED" }); // second poll
    enqueue({ id: "M2" }); // publish
    enqueue({ permalink: "https://threads.net/@u/post/M2" });

    const result = await postToThreads(CREDS, "caption", ["uploads/photo.jpg"]);
    expect(result.platformPostId).toBe("M2");
  });

  it("posts a single video, waiting for FINISHED", async () => {
    enqueue({ id: "C3" }); // createVideoContainer
    enqueue({ status: "IN_PROGRESS" });
    enqueue({ status: "FINISHED" });
    enqueue({ id: "M3" }); // publish
    enqueue({ permalink: "https://threads.net/@u/post/M3" });

    const result = await postToThreads(CREDS, "video", ["uploads/clip.mp4"]);
    expect(result.platformPostId).toBe("M3");
  });

  it("posts a carousel, waiting for each child then the parent", async () => {
    enqueue({ id: "child1" }); // createImageContainer #1 (carousel item)
    enqueue({ id: "child2" }); // createImageContainer #2 (carousel item)
    enqueue({ status: "FINISHED" }); // poll child1
    enqueue({ status: "FINISHED" }); // poll child2
    enqueue({ id: "parent" }); // createCarouselContainer
    enqueue({ status: "FINISHED" }); // poll parent
    enqueue({ id: "M4" }); // publish
    enqueue({ permalink: "https://threads.net/@u/post/M4" });

    const result = await postToThreads(CREDS, "two pics", [
      "uploads/a.jpg",
      "uploads/b.jpg",
    ]);
    expect(result.platformPostId).toBe("M4");
  });

  it("throws if container creation returns no id", async () => {
    enqueue({ error: { message: "bad" } });
    await expect(postToThreads(CREDS, "x", [])).rejects.toThrow(/text container error/);
  });

  it("returns without platformUrl if permalink lookup fails", async () => {
    enqueue({ id: "C5" });
    enqueue({ id: "M5" }); // publish ok
    enqueue({ /* permalink missing */ });

    const result = await postToThreads(CREDS, "no link", []);
    expect(result.platformPostId).toBe("M5");
    expect(result.platformUrl).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
npx vitest run src/lib/platforms/threads.test.ts
```

Expected: 6 passing tests.

- [ ] **Step 3: Commit**

```bash
git add src/lib/platforms/threads.test.ts
git commit -m "test(threads): cover text/image/video/carousel paths with mocked fetch"
```

---

## Task 5: Threads OAuth — start route

**Files:**
- Create: `src/app/api/connections/threads/route.ts`

- [ ] **Step 1: Write the route**

```ts
// Threads OAuth start.
// Docs: https://developers.facebook.com/docs/threads/get-started/get-access-tokens-and-permissions/

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createOAuthState } from "@/lib/oauth-state";

const THREADS_APP_ID = process.env.THREADS_APP_ID!;
const REDIRECT_URI = `${process.env.APP_URL}/api/connections/threads/callback`;

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const params = new URLSearchParams({
    client_id: THREADS_APP_ID,
    redirect_uri: REDIRECT_URI,
    scope: "threads_basic,threads_content_publish",
    response_type: "code",
    state: createOAuthState({ userId: session.user.id }),
  });

  return NextResponse.redirect(
    `https://threads.net/oauth/authorize?${params.toString()}`,
  );
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/connections/threads/route.ts
git commit -m "feat(threads): OAuth start route"
```

---

## Task 6: Threads OAuth — callback

**Files:**
- Create: `src/app/api/connections/threads/callback/route.ts`

- [ ] **Step 1: Write the callback**

```ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/encrypt";
import { auth } from "@/lib/auth";
import { verifyOAuthState } from "@/lib/oauth-state";
import { redactSecrets } from "@/lib/redact";

const THREADS_APP_ID = process.env.THREADS_APP_ID!;
const THREADS_APP_SECRET = process.env.THREADS_APP_SECRET!;
const REDIRECT_URI = `${process.env.APP_URL}/api/connections/threads/callback`;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const stateParam = searchParams.get("state");
  const error = searchParams.get("error");

  if (error || !code || !stateParam) {
    return NextResponse.redirect(
      new URL(`/admin/connections?error=threads_denied`, req.url),
    );
  }

  const state = verifyOAuthState(stateParam);
  const session = await auth();
  if (
    !state ||
    !session?.user?.id ||
    session.user.role !== "admin" ||
    session.user.id !== state.userId
  ) {
    return NextResponse.redirect(
      new URL(`/admin/connections?error=threads_state`, req.url),
    );
  }
  const userId = state.userId;

  try {
    // Exchange code for a short-lived token (~1h).
    const shortRes = await fetch("https://graph.threads.net/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: THREADS_APP_ID,
        client_secret: THREADS_APP_SECRET,
        grant_type: "authorization_code",
        redirect_uri: REDIRECT_URI,
        code,
      }),
    });
    const shortData = await shortRes.json();
    if (!shortData.access_token) {
      throw new Error(`Threads token exchange failed: ${JSON.stringify(shortData)}`);
    }

    // Exchange the short-lived token for a long-lived one (60 days).
    const longUrl = new URL("https://graph.threads.net/access_token");
    longUrl.searchParams.set("grant_type", "th_exchange_token");
    longUrl.searchParams.set("client_secret", THREADS_APP_SECRET);
    longUrl.searchParams.set("access_token", shortData.access_token);
    const longRes = await fetch(longUrl.toString());
    const longData = await longRes.json();
    const accessToken = longData.access_token ?? shortData.access_token;
    const expiresIn = longData.expires_in ?? 5183944;

    // Look up the user's Threads id + username.
    const meRes = await fetch(
      `https://graph.threads.net/v1.0/me?fields=id,username&access_token=${accessToken}`,
    );
    const me = await meRes.json();
    const platformUserId = me.id as string | undefined;
    const platformUsername = (me.username as string | undefined) ?? "Threads";

    await prisma.platformToken.upsert({
      where: { userId_platform: { userId, platform: "THREADS" } },
      create: {
        userId,
        platform: "THREADS",
        accessToken: encrypt(accessToken),
        expiresAt: new Date(Date.now() + expiresIn * 1000),
        platformUserId,
        platformUsername,
        scopes: "threads_basic,threads_content_publish",
      },
      update: {
        accessToken: encrypt(accessToken),
        expiresAt: new Date(Date.now() + expiresIn * 1000),
        platformUserId,
        platformUsername,
      },
    });

    return NextResponse.redirect(
      new URL("/admin/connections?success=threads", req.url),
    );
  } catch (err) {
    console.error("Threads callback error:", redactSecrets(err));
    return NextResponse.redirect(
      new URL(`/admin/connections?error=threads_failed`, req.url),
    );
  }
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/connections/threads/callback/route.ts
git commit -m "feat(threads): OAuth callback persists long-lived token to PlatformToken"
```

---

## Task 7: Wire Threads into publish dispatch

**Files:**
- Modify: `src/app/api/posts/[id]/publish/route.ts`

The switch around line 199 currently handles INSTAGRAM, LINKEDIN, YOUTUBE, TIKTOK, FACEBOOK_PAGE. We add Threads with the same shape as Instagram (`creds + body + mediaKeys + postType`), plus a token-refresh call when the stored token is close to expiry.

- [ ] **Step 1: Add the import**

Open `src/app/api/posts/[id]/publish/route.ts` and add to the existing platform-import group near the top:

```ts
import { postToThreads, refreshThreadsToken } from "@/lib/platforms/threads";
```

- [ ] **Step 2: Add the case to the dispatch switch**

In the `switch (platform)` block, add this case before `default`:

```ts
case "THREADS": {
  // Refresh long-lived token if it's within 7 days of expiry. Threads tokens
  // can only be refreshed after they're at least 24h old, so for very fresh
  // tokens we just use them as-is.
  let usableToken = accessToken;
  const tokenAgeMs = Date.now() - (token?.createdAt?.getTime() ?? 0);
  const expiresInMs = (token?.expiresAt?.getTime() ?? 0) - Date.now();
  if (tokenAgeMs > 24 * 60 * 60 * 1000 && expiresInMs < 7 * 24 * 60 * 60 * 1000) {
    const refreshed = await refreshThreadsToken(accessToken);
    usableToken = refreshed.accessToken;
    await prisma.platformToken.update({
      where: { userId_platform: { userId, platform: "THREADS" } },
      data: {
        accessToken: encrypt(refreshed.accessToken),
        expiresAt: new Date(Date.now() + refreshed.expiresIn * 1000),
      },
    });
  }

  result = await postToThreads(
    { accessToken: usableToken, platformUserId: platformUserId! },
    post.body,
    mediaKeys,
    post.postType,
  );
  break;
}
```

If `token`, `userId`, or `encrypt` aren't already in scope at this point in the file, scroll up: the prior INSTAGRAM/LINKEDIN cases already use them. If `token.createdAt` isn't selected in the prior token lookup, fall back to the simpler refresh trigger:

```ts
const expiresInMs = (token?.expiresAt?.getTime() ?? 0) - Date.now();
if (expiresInMs < 7 * 24 * 60 * 60 * 1000) {
  // refresh
}
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors. If `token.createdAt` is not on the selected fields, edit the relevant `prisma.platformToken.findFirst` / similar lookup near the top of the route to include `createdAt: true`.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/posts/[id]/publish/route.ts
git commit -m "feat(threads): wire into publish dispatch with token refresh"
```

---

## Task 8: Add THREADS + SUBSTACK to scheduled-platforms API

**Files:**
- Modify: `src/app/api/posts/[id]/scheduled-platforms/route.ts`

This route accepts the platform set the user picked for a scheduled post, creates `PublishRecord` rows for the automated platforms, and stores the marker for manual platforms in `WeeklyPlanSlot.platforms`.

- [ ] **Step 1: Update the allowed input + auto sets**

Near the top of the file, alongside `FB_PERSONAL_MARKER`:

```ts
const FB_PERSONAL_MARKER = "FACEBOOK_PERSONAL";
const SUBSTACK_MARKER = "SUBSTACK"; // manual queue marker (also a real Platform enum value)

const ALLOWED_INPUT = [
  "FACEBOOK_PAGE",
  "INSTAGRAM",
  "LINKEDIN",
  "YOUTUBE",
  "TIKTOK",
  "THREADS",
  FB_PERSONAL_MARKER,
  SUBSTACK_MARKER,
] as const;

const AUTO_PLATFORMS = [
  "FACEBOOK_PAGE",
  "INSTAGRAM",
  "LINKEDIN",
  "YOUTUBE",
  "TIKTOK",
  "THREADS",
] as const satisfies readonly Platform[];
```

- [ ] **Step 2: Handle the SUBSTACK marker like FB_PERSONAL**

Find the loop that filters requested platforms:

```ts
for (const p of requested) {
  if (p === FB_PERSONAL_MARKER) {
    filtered.add(p);
    continue;
  }
  ...
}
```

Extend it so SUBSTACK is also always allowed and is recorded as a real PublishRecord (unlike FB Personal):

```ts
for (const p of requested) {
  if (p === FB_PERSONAL_MARKER) {
    filtered.add(p);
    continue;
  }
  if (p === SUBSTACK_MARKER) {
    filtered.add(p);
    continue;
  }
  if (!isPlatformEligible(p, shape)) continue;
  if (!connected.has(p)) continue;
  filtered.add(p);
}
```

Then, when the route computes `autoTargets`, SUBSTACK still appears in `filtered` but is **not** in `AUTO_PLATFORMS` so `autoTargets` skips it — that's correct for the create-publish-records phase. We need a separate path to create the SUBSTACK PublishRecord. Add it right after the auto-target reconciliation:

```ts
// Substack — create a manual-flow PublishRecord that the cron publisher
// ignores (no dispatch case) and that the /admin/manual-substack queue picks
// up. We don't add it to AUTO_PLATFORMS so the existing reconciliation skips
// it cleanly.
if (filtered.has(SUBSTACK_MARKER) && scheduledAt) {
  const existing = live.find(
    (r) => r.platform === "SUBSTACK" && r.status === "PENDING",
  );
  if (!existing) {
    await prisma.publishRecord.create({
      data: {
        postId,
        platform: "SUBSTACK",
        status: "PENDING",
        scheduledAt,
      },
    });
  }
} else if (!filtered.has(SUBSTACK_MARKER)) {
  // User dropped Substack — cancel any pending Substack record.
  const pendingSubstack = live.find(
    (r) => r.platform === "SUBSTACK" && r.status === "PENDING",
  );
  if (pendingSubstack) {
    await prisma.publishRecord.update({
      where: { id: pendingSubstack.id },
      data: { status: "CANCELLED" },
    });
  }
}
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors. If `Platform` type doesn't accept `"SUBSTACK"` yet, ensure Task 1's `prisma generate` ran.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/posts/[id]/scheduled-platforms/route.ts
git commit -m "feat(scheduled-platforms): accept THREADS (auto) and SUBSTACK (manual) markers"
```

---

## Task 9: Substack publication URL settings API

**Files:**
- Create: `src/app/api/admin/substack-settings/route.ts`

- [ ] **Step 1: Write the route**

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const putSchema = z.object({
  publicationUrl: z.string().url().nullable(),
});

export async function GET() {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { substackPublicationUrl: true },
  });
  return NextResponse.json({
    publicationUrl: user?.substackPublicationUrl ?? null,
  });
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }
  const parsed = putSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  // Normalize: strip trailing slash so we can append `/publish/post` cleanly.
  let url = parsed.data.publicationUrl;
  if (url) url = url.replace(/\/+$/, "");

  await prisma.user.update({
    where: { id: session.user.id },
    data: { substackPublicationUrl: url },
  });

  return NextResponse.json({ ok: true, publicationUrl: url });
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/admin/substack-settings/route.ts
git commit -m "feat(substack): GET/PUT API for the publication URL"
```

---

## Task 10: manual-substack queue API (list + count)

**Files:**
- Create: `src/app/api/admin/manual-substack-queue/route.ts`
- Create: `src/app/api/admin/manual-substack-queue/count/route.ts`

Both routes mirror their manual-fb counterparts (`src/app/api/admin/manual-fb-queue/{route.ts,count/route.ts}`) but key off the SUBSTACK marker and SUBSTACK PublishRecord status.

- [ ] **Step 1: Write the list route**

Create `src/app/api/admin/manual-substack-queue/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildSlotDate } from "@/lib/planner/fixed-slots";
import { FIXED_SLOT_HOURS } from "@/lib/planner/slot-constants";

const LOOKBACK_DAYS = 30;
const MAX_RESULTS = 100;

export type SubstackQueueItem = {
  slotId: string | null;
  postId: string;
  publishRecordId: string;
  scheduledAt: string;
  status: "SCHEDULED" | "APPROVED" | "AD_HOC";
  reminderSentAt: string | null;
  body: string;
  platformUrl: string | null;
  media: { id: string; mimeType: string; url: string | null }[];
};

export async function GET(_req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }
  const userId = session.user.id;

  const now = new Date();
  const lookbackStart = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const lookbackDayKey = new Date(
    Date.UTC(
      lookbackStart.getUTCFullYear(),
      lookbackStart.getUTCMonth(),
      lookbackStart.getUTCDate() - 1,
    ),
  );

  // Planner-scheduled Substack slots.
  const slots = await prisma.weeklyPlanSlot.findMany({
    where: {
      plan: { userId },
      status: { in: ["APPROVED", "SCHEDULED"] },
      day: { gte: lookbackDayKey },
      platforms: { has: "SUBSTACK" },
    },
    select: {
      id: true,
      status: true,
      day: true,
      hour: true,
      reminderSentAt: true,
      post: {
        select: {
          id: true,
          body: true,
          platformUrl: true,
          publishes: {
            where: { platform: "SUBSTACK" },
            select: { id: true, status: true },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
          media: {
            select: { id: true, mimeType: true, storageKey: true },
            orderBy: { createdAt: "asc" },
          },
        },
      },
    },
  });

  const items: SubstackQueueItem[] = [];
  const seenPostIds = new Set<string>();
  for (const slot of slots) {
    const record = slot.post.publishes[0];
    if (!record || record.status === "PUBLISHED" || record.status === "CANCELLED") {
      continue;
    }
    const hour = slot.hour ?? FIXED_SLOT_HOURS[0];
    const scheduledAt = buildSlotDate(slot.day, hour);
    if (scheduledAt < lookbackStart) continue;

    seenPostIds.add(slot.post.id);
    items.push({
      slotId: slot.id,
      postId: slot.post.id,
      publishRecordId: record.id,
      scheduledAt: scheduledAt.toISOString(),
      status: slot.status as "SCHEDULED" | "APPROVED",
      reminderSentAt: slot.reminderSentAt?.toISOString() ?? null,
      body: slot.post.body ?? "",
      platformUrl: slot.post.platformUrl,
      media: slot.post.media.map((m) => ({
        id: m.id,
        mimeType: m.mimeType,
        url: m.storageKey,
      })),
    });
  }

  // Ad-hoc Substack publishes: rows pushed without going through the weekly
  // planner. Mirrors manual-fb-queue's adhoc branch.
  const adhocRecords = await prisma.publishRecord.findMany({
    where: {
      platform: "SUBSTACK",
      status: "PENDING",
      post: {
        userId,
        ...(seenPostIds.size > 0 ? { id: { notIn: [...seenPostIds] } } : {}),
      },
      createdAt: { gte: lookbackStart },
    },
    select: {
      id: true,
      scheduledAt: true,
      createdAt: true,
      post: {
        select: {
          id: true,
          body: true,
          platformUrl: true,
          media: {
            select: { id: true, mimeType: true, storageKey: true },
            orderBy: { createdAt: "asc" },
          },
        },
      },
    },
    take: MAX_RESULTS,
  });

  for (const record of adhocRecords) {
    const moment = record.scheduledAt ?? record.createdAt;
    if (moment < lookbackStart) continue;
    items.push({
      slotId: null,
      postId: record.post.id,
      publishRecordId: record.id,
      scheduledAt: moment.toISOString(),
      status: "AD_HOC",
      reminderSentAt: null,
      body: record.post.body ?? "",
      platformUrl: record.post.platformUrl,
      media: record.post.media.map((m) => ({
        id: m.id,
        mimeType: m.mimeType,
        url: m.storageKey,
      })),
    });
  }

  items.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  return NextResponse.json({
    items: items.slice(0, MAX_RESULTS),
    total: items.length,
  });
}
```

- [ ] **Step 2: Write the count route**

Create `src/app/api/admin/manual-substack-queue/count/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildSlotDate } from "@/lib/planner/fixed-slots";
import { FIXED_SLOT_HOURS } from "@/lib/planner/slot-constants";

const LOOKBACK_DAYS = 30;

export async function GET(_req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }
  const userId = session.user.id;

  const now = new Date();
  const lookbackStart = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const lookbackDayKey = new Date(
    Date.UTC(
      lookbackStart.getUTCFullYear(),
      lookbackStart.getUTCMonth(),
      lookbackStart.getUTCDate() - 1,
    ),
  );

  const slots = await prisma.weeklyPlanSlot.findMany({
    where: {
      plan: { userId },
      status: { in: ["APPROVED", "SCHEDULED"] },
      day: { gte: lookbackDayKey },
      platforms: { has: "SUBSTACK" },
    },
    select: {
      day: true,
      hour: true,
      post: {
        select: {
          publishes: {
            where: { platform: "SUBSTACK" },
            select: { status: true },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      },
    },
  });

  let overdue = 0;
  for (const slot of slots) {
    const status = slot.post.publishes[0]?.status;
    if (!status || status === "PUBLISHED" || status === "CANCELLED") continue;
    const hour = slot.hour ?? FIXED_SLOT_HOURS[0];
    const scheduledAt = buildSlotDate(slot.day, hour);
    if (scheduledAt < lookbackStart) continue;
    if (scheduledAt <= now) overdue++;
  }

  return NextResponse.json({ overdue });
}
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/admin/manual-substack-queue
git commit -m "feat(manual-substack): queue list + overdue count API"
```

---

## Task 11: manual-substack mark-published endpoint

**Files:**
- Create: `src/app/api/admin/manual-substack-queue/mark-published/route.ts`

- [ ] **Step 1: Write the route**

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const schema = z.object({
  publishRecordId: z.string(),
  permalink: z.string().url(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }
  const userId = session.user.id;

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const { publishRecordId, permalink } = parsed.data;

  // Sanity-check the permalink against the user's stored publication URL so
  // paste mistakes don't get filed as "published".
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { substackPublicationUrl: true },
  });
  if (user?.substackPublicationUrl) {
    try {
      const host = new URL(permalink).host;
      const expectedHost = new URL(user.substackPublicationUrl).host;
      if (host !== expectedHost) {
        return NextResponse.json(
          { error: `permalink host (${host}) doesn't match publication (${expectedHost})` },
          { status: 400 },
        );
      }
    } catch {
      return NextResponse.json({ error: "invalid permalink" }, { status: 400 });
    }
  }

  const record = await prisma.publishRecord.findFirst({
    where: {
      id: publishRecordId,
      platform: "SUBSTACK",
      post: { userId },
    },
    select: { id: true, status: true },
  });
  if (!record) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (record.status === "PUBLISHED") {
    return NextResponse.json({ ok: true, alreadyPublished: true });
  }

  await prisma.publishRecord.update({
    where: { id: record.id },
    data: {
      status: "PUBLISHED",
      publishedAt: new Date(),
      platformUrl: permalink,
    },
  });

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/admin/manual-substack-queue/mark-published
git commit -m "feat(manual-substack): mark-published endpoint with host check"
```

---

## Task 12: `/admin/manual-substack` page + client

**Files:**
- Create: `src/app/admin/manual-substack/page.tsx`
- Create: `src/app/admin/manual-substack/ManualSubstackQueueClient.tsx`

The client mirrors `ManualFbQueueClient.tsx` very closely. Rather than retype 300+ LOC, this task builds the client by **copying** the FB version and applying the specific diffs below.

- [ ] **Step 1: Write the server component**

Create `src/app/admin/manual-substack/page.tsx`:

```tsx
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ManualSubstackQueueClient } from "./ManualSubstackQueueClient";

export const metadata = { title: "Manual Substack queue" };
export const dynamic = "force-dynamic";

export default async function ManualSubstackQueuePage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/api/auth/signin?callbackUrl=/admin/manual-substack");
  }

  // Initial fetch lives on the client to keep this page identical in shape
  // to /admin/manual-fb's behavior post-recent-refactor (the client owns
  // queue state and polls for refresh).
  return <ManualSubstackQueueClient />;
}
```

- [ ] **Step 2: Copy the FB client as a starting point**

```bash
cp src/app/admin/manual-fb/ManualFbQueueClient.tsx \
   src/app/admin/manual-substack/ManualSubstackQueueClient.tsx
```

- [ ] **Step 3: Apply edits to the copied client**

In `src/app/admin/manual-substack/ManualSubstackQueueClient.tsx`:

1. Rename the exported component: `ManualFbQueueClient` → `ManualSubstackQueueClient`.

2. Replace the icon import. Change:

```tsx
import { SiFacebook } from "react-icons/si";
```

to:

```tsx
import { Mail } from "lucide-react"; // Substack uses a "letter" brand vibe; Lucide's Mail is the closest standard icon
```

(If you have `react-icons/si`'s `SiSubstack` available, prefer that; check `node_modules/react-icons/si` for an export named `SiSubstack`. If present, use it instead of `Mail`.)

3. Replace every visible "Facebook" / "FB" string with "Substack":
   - "Manual FB queue" → "Manual Substack queue"
   - "Cross-post to FB" → "Open in Substack"
   - "FB permalink" → "Substack permalink"
   - "Mark as posted to FB" → "Mark as published to Substack"

4. Replace the API endpoints:
   - `/api/admin/manual-fb-queue` → `/api/admin/manual-substack-queue`
   - There's no FB mark-published endpoint today (the manual-fb client toggles status differently); for Substack, point the "Mark as published" button at `POST /api/admin/manual-substack-queue/mark-published` with `{ publishRecordId, permalink }`.

5. Extend the `QueueItem` type to include `publishRecordId: string` (returned by the new API). Use it as the field sent to `mark-published`.

6. Replace the "Open in Facebook" button handler. Instead of opening Facebook's compose URL, open Substack's `/publish/post` editor on the user's stored publication URL. Add a fetch on mount to load the publication URL:

```tsx
const [publicationUrl, setPublicationUrl] = useState<string | null>(null);

useEffect(() => {
  fetch("/api/admin/substack-settings")
    .then((r) => r.json())
    .then((d) => setPublicationUrl(d.publicationUrl ?? null))
    .catch(() => {});
}, []);

async function openInSubstack(item: QueueItem) {
  await copyTextToClipboard(item.body);
  if (!publicationUrl) {
    alert(
      "Set your Substack publication URL in /admin/connections first.",
    );
    return;
  }
  window.open(`${publicationUrl}/publish/post`, "_blank", "noopener,noreferrer");
}
```

7. Replace the "Cross-post to FB" button with a card region containing:
   - One primary button: "Copy body & open Substack" → calls `openInSubstack(item)`.
   - One secondary input + button: "Substack permalink" text input, "Mark published" button → POSTs to `/api/admin/manual-substack-queue/mark-published`.
   - Image previews: each `media` entry that's an image gets a small thumbnail with a "Download" link to open in a new tab (Substack's editor needs manual upload).

8. Remove the FB-specific share-sheet code (`navigator.share` with files, the `NavWithShare` typedef, `buildShareFiles`). Substack doesn't take shared files — users paste body into the editor and upload images themselves.

Run a diff to verify:

```bash
diff -u src/app/admin/manual-fb/ManualFbQueueClient.tsx \
        src/app/admin/manual-substack/ManualSubstackQueueClient.tsx | head -80
```

Expected: clear changes corresponding to the edits above.

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors. If `SiSubstack` isn't exported, fall back to `Mail` (per step 2 note).

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/manual-substack
git commit -m "feat(manual-substack): queue page + client mirroring manual-fb"
```

---

## Task 13: PlatformPickerModal — Threads + Substack chips

**Files:**
- Modify: `src/app/admin/_shared/PlatformPickerModal.tsx`

- [ ] **Step 1: Add Threads to `AUTO_CHIPS`**

Find the `AUTO_CHIPS` array and append:

```tsx
{
  key: "THREADS",
  label: "Threads",
  Icon: SiThreads, // import from "react-icons/si"
  iconColor: "text-black",
  activeClasses: "border-black bg-black/5 text-black",
},
```

Add the import at the top:

```tsx
import { SiFacebook, SiInstagram, SiYoutube, SiTiktok, SiThreads } from "react-icons/si";
```

If `SiThreads` doesn't exist in your `react-icons` version, use a fallback:

```tsx
import { AtSign } from "lucide-react";
// ...
Icon: AtSign,
```

- [ ] **Step 2: Add a Substack manual chip alongside `FB_PERSONAL_CHIP`**

Below `FB_PERSONAL_CHIP`:

```tsx
const SUBSTACK_MARKER = "SUBSTACK";

const SUBSTACK_CHIP: ChipDef = {
  key: SUBSTACK_MARKER,
  label: "Substack",
  Icon: Mail, // import { Mail } from "lucide-react"; or SiSubstack if present
  iconColor: "text-[#FF6719]",
  activeClasses: "border-dashed border-[#FF6719] bg-[#FF6719]/10 text-[#FF6719]",
  manual: true,
};
```

Add the `Mail` import at the top:

```tsx
import { Loader2, Mail, X } from "lucide-react";
```

- [ ] **Step 3: Render the Substack chip**

Find where `FB_PERSONAL_CHIP` is rendered (the manual chips section of the modal). Render `SUBSTACK_CHIP` directly after it with the same `manual` styling.

The exact rendering site is around the chip grid — search for `FB_PERSONAL_CHIP` and add the parallel render. If the manual chips are mapped from an array, add `SUBSTACK_CHIP` to that array; if rendered ad-hoc, add an adjacent `<Chip ... />` element.

- [ ] **Step 4: Type-check + visual smoke (deferred to user)**

```bash
npx tsc --noEmit
```

Expected: no errors. UI verification is the user's job — note "needs visual check" when handing off.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/_shared/PlatformPickerModal.tsx
git commit -m "feat(picker): add Threads (auto) and Substack (manual) chips"
```

---

## Task 14: ConnectionsPage — Threads + Substack rows + Substack URL config

**Files:**
- Modify: `src/app/admin/connections/ConnectionsPage.tsx`

- [ ] **Step 1: Add Threads row to `PLATFORMS`**

In `PLATFORMS`, after the LinkedIn entry, add:

```tsx
{
  id: "THREADS",
  label: "Threads",
  caps: {
    Text: true,
    Photos: true,
    Video: true,
    Stories: false,
    Analytics: false,
    Page: false,
    "Personal profile": true,
  },
  color: "text-black",
  connectUrl: "/api/connections/threads",
},
```

- [ ] **Step 2: Add Substack row (manual, no Connect button)**

At the end of `PLATFORMS`, add:

```tsx
{
  id: "SUBSTACK",
  label: "Substack",
  caps: {
    Text: true,
    Photos: true, // (manual upload)
    Video: false,
    Stories: false,
    Analytics: false,
    Page: false,
    "Personal profile": true,
  },
  note: "Manual helper — Substack has no posting API",
  color: "text-[#FF6719]",
  connectUrl: "", // no OAuth
},
```

The component needs to skip the Connect button when `connectUrl` is empty. Find the render path that shows the Connect button per platform and gate it:

```tsx
{platform.connectUrl ? (
  <Button asChild>
    <a href={platform.connectUrl}>Connect</a>
  </Button>
) : null}
```

- [ ] **Step 3: Add Substack publication URL editor**

Below the Substack row's normal rendering (or as a sub-section under it), add a small inline form. Use existing state hooks in the component — if the page is currently fully static, lift state with `useState`:

```tsx
const [substackUrl, setSubstackUrl] = useState<string | null>(null);
const [substackInput, setSubstackInput] = useState("");
const [substackSaving, setSubstackSaving] = useState(false);

useEffect(() => {
  fetch("/api/admin/substack-settings")
    .then((r) => r.json())
    .then((d) => {
      setSubstackUrl(d.publicationUrl ?? null);
      setSubstackInput(d.publicationUrl ?? "");
    })
    .catch(() => {});
}, []);

async function saveSubstackUrl() {
  setSubstackSaving(true);
  try {
    const res = await fetch("/api/admin/substack-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ publicationUrl: substackInput || null }),
    });
    const data = await res.json();
    if (res.ok) {
      setSubstackUrl(data.publicationUrl ?? null);
    }
  } finally {
    setSubstackSaving(false);
  }
}
```

And in the JSX, under the Substack row:

```tsx
{platform.id === "SUBSTACK" && (
  <div className="flex flex-col gap-2 mt-2 min-w-0">
    <label className="text-xs text-gray-500">Publication URL</label>
    <div className="flex flex-wrap gap-2 min-w-0">
      <input
        type="url"
        placeholder="https://you.substack.com"
        value={substackInput}
        onChange={(e) => setSubstackInput(e.target.value)}
        className="flex-1 min-w-0 border px-2 py-1 rounded text-sm"
      />
      <Button onClick={saveSubstackUrl} disabled={substackSaving} size="sm">
        {substackSaving ? <Spinner /> : "Save"}
      </Button>
    </div>
    {substackUrl ? (
      <p className="text-xs text-gray-500">Current: {substackUrl}</p>
    ) : (
      <p className="text-xs text-amber-600">
        Set this before using the manual-substack queue.
      </p>
    )}
  </div>
)}
```

The `min-w-0` + `flex-wrap` + `flex-1 min-w-0` on the input keep this safe at iPhone-SE width (375px) per the project's mobile rule.

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/connections/ConnectionsPage.tsx
git commit -m "feat(connections): Threads + Substack rows; inline Substack URL editor"
```

---

## Task 15: Env-vars docs + final sweep

**Files:**
- Modify: `docs/env-vars.md`

- [ ] **Step 1: Document the new env vars**

Find the Meta/Facebook section in `docs/env-vars.md` and add Threads alongside:

```markdown
## Threads (Meta)

- `THREADS_APP_ID` — Meta App ID for Threads (separate product within the same Meta app as FB/IG). Set in Vercel preview + production.
- `THREADS_APP_SECRET` — Threads app secret. Vercel preview + production only; never commit.
```

- [ ] **Step 2: Full type-check + test sweep**

```bash
npx tsc --noEmit
npx vitest run
```

Expected: no errors, all tests green.

- [ ] **Step 3: Push env vars to Vercel (user's action — list the exact commands)**

Add to the commit message / handoff note for the user. The pre-approved-in-memory `vercel env add` is allowed without per-push approval:

```bash
vercel env add THREADS_APP_ID preview --value <VALUE> --yes
vercel env add THREADS_APP_SECRET preview --value <VALUE> --yes
vercel env add THREADS_APP_ID production --value <VALUE> --yes
vercel env add THREADS_APP_SECRET production --value <VALUE> --yes
```

(Skip if env vars aren't set up yet — the OAuth flow can't run without them, but the rest of the code compiles and the manual-substack queue is fully usable without any env work.)

- [ ] **Step 4: Commit docs**

```bash
git add docs/env-vars.md
git commit -m "docs: env vars for THREADS_APP_ID / THREADS_APP_SECRET"
```

- [ ] **Step 5: Push the branch and open a PR**

```bash
git push -u origin feature/threads-substack-publishing
gh pr create --title "feat: Threads (API) + Substack (manual) publishing" --body "$(cat <<'EOF'
## Summary
- Add Threads as a fully automated publishing platform via Meta's official Threads API (Instagram-style 2-step container/publish flow).
- Add Substack as a manual-helper platform mirroring `/admin/manual-fb` — Substack has no posting API in 2026.
- Schema: `THREADS` + `SUBSTACK` added to `enum Platform`; `User.substackPublicationUrl` added.
- New OAuth pair for Threads, new manual-substack queue + mark-published endpoint, new Substack publication URL setting.

## Test plan
- [ ] Connect Threads from /admin/connections (requires THREADS_APP_ID + SECRET on this preview)
- [ ] Schedule a text post to Threads → it publishes after the cron tick (or via "Publish now")
- [ ] Schedule an image post to Threads → publishes correctly
- [ ] Schedule a video post to Threads → publishes after container transcoding
- [ ] Set Substack publication URL on /admin/connections
- [ ] Schedule a Substack post → it appears in /admin/manual-substack
- [ ] Click "Open in Substack" → body in clipboard, Substack editor opens in new tab
- [ ] Paste permalink and click "Mark published" → record flips to PUBLISHED
- [ ] iPhone-SE width (375px): all new UIs render without horizontal scroll

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**1. Spec coverage:** Walked the spec sections — Goal ✓ (T1–T14), Scope/In ✓ (all 8 bullets mapped to tasks), Data model ✓ (T1), Threads/`threads.ts` ✓ (T3), Threads OAuth ✓ (T5+T6), Threads dispatch ✓ (T7), App Review note ✓ (acknowledged, not blocking — no task needed). Manual-substack page ✓ (T12), Substack settings ✓ (T9+T14), Publish dispatch (Substack excluded) ✓ (T7+T8 implicitly — no SUBSTACK case added to switch). Connections UI ✓ (T14). Error handling — Threads errors propagate via existing `PublishRecord` failure path (no extra task needed); Substack permalink validation in T11. Testing ✓ (T4 unit tests; planner tests in T2). Migration ✓ (T1). Env vars ✓ (T15). Rollout ✓ (task order matches spec's rollout-order list).

**2. Placeholder scan:** Searched for "TBD", "TODO", "implement later", "similar to". One "Similar to" pattern in Task 12 — replaced with explicit copy-then-edit steps and concrete diffs. No bare "Add appropriate error handling" lines — Threads errors throw with structured messages; Substack mark-published validates host. No "Write tests for the above" without code — all test code is inline.

**3. Type consistency:** `postToThreads(creds, body, mediaKeys, postType)` — matches the dispatch caller in T7. `refreshThreadsToken(accessToken)` returns `{ accessToken, expiresIn }` — matches T7's destructuring. `SubstackQueueItem.publishRecordId: string` defined in T10, consumed in T11 (mark-published) and T12 (client). `SUBSTACK_MARKER` value `"SUBSTACK"` is consistent across T8 (scheduled-platforms route), T13 (picker chip), and T10 (queue route's `platforms: { has: "SUBSTACK" }`).

No issues found beyond the Task 12 "Similar to" pattern, already fixed inline.
