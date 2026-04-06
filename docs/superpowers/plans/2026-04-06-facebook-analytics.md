# Facebook Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pull reactions, comments, shares, and Professional Mode reach/impressions from the Facebook Graph API for imported Facebook posts, refreshed nightly via cron, displayed on the post detail page and as a compact summary on the post list.

**Architecture:** Add a `PostAnalytics` model to store per-platform engagement metrics. A nightly cron first runs a "discovery pass" (paginating the Graph API to match imported posts to real Facebook post IDs by timestamp), then an "insights pass" (fetching metrics for all matched posts). The detail page is a server component that reads directly from Prisma; the list page fetches from the existing `/api/posts` endpoint which is extended to include analytics.

**Tech Stack:** Prisma 7, Next.js 16 App Router, Facebook Graph API v21.0, Vitest

---

## File Map

**Create:**
- `src/app/api/connections/facebook/route.ts` — OAuth initiation (redirects to Facebook Login)
- `src/app/api/connections/facebook/callback/route.ts` — OAuth callback (exchanges code, stores token)
- `src/lib/platforms/facebook-analytics.ts` — `discoverFacebookPostId` + `fetchPostInsights`
- `src/lib/platforms/facebook-analytics.test.ts` — Vitest unit tests for the analytics library
- `src/app/api/cron/facebook-analytics/route.ts` — Nightly cron job

**Modify:**
- `prisma/schema.prisma` — Add `FACEBOOK` to `Platform` enum, add `PostAnalytics` model, add `analytics` relation to `Post`
- `src/app/(dashboard)/connections/page.tsx` — Add Facebook card
- `src/app/api/posts/route.ts` — Include analytics in list response
- `src/app/(dashboard)/posts/page.tsx` — Render engagement summary on cards
- `src/app/(dashboard)/posts/[id]/page.tsx` — Add analytics panel
- `vercel.json` — Add cron schedule

---

## Task 1: Prisma Schema — Add FACEBOOK + PostAnalytics

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add `FACEBOOK` to the Platform enum and `PostAnalytics` model**

In `prisma/schema.prisma`, make the following changes:

Change the `Platform` enum (add `FACEBOOK` as first entry):
```prisma
enum Platform {
  FACEBOOK
  INSTAGRAM
  LINKEDIN
  YOUTUBE
  TIKTOK
}
```

Add `analytics PostAnalytics[]` to the `Post` model, directly after the `publishes` line:
```prisma
  publishes    PublishRecord[]
  analytics    PostAnalytics[]
```

Add the new model at the end of the file, after the `DriveSync` model:
```prisma
// ─── Analytics ───────────────────────────────────────────────────────────────

model PostAnalytics {
  id             String   @id @default(cuid())
  postId         String
  post           Post     @relation(fields: [postId], references: [id], onDelete: Cascade)
  platform       Platform

  platformPostId String?
  reactions      Int?
  comments       Int?
  shares         Int?
  reach          Int?
  impressions    Int?

  fetchedAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@unique([postId, platform])
  @@index([postId])
}
```

- [ ] **Step 2: Run the migration**

```bash
npx prisma migrate dev --name add-facebook-analytics
```

Expected output:
```
Applying migration `..._add_facebook_analytics`
Your database is now in sync with your schema.
```

- [ ] **Step 3: Verify the Prisma client regenerated**

```bash
npx prisma generate
```

Expected: `Generated Prisma Client` with no errors.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add PostAnalytics model and FACEBOOK platform"
```

---

## Task 2: Facebook OAuth Initiation Route

**Files:**
- Create: `src/app/api/connections/facebook/route.ts`

- [ ] **Step 1: Create the initiation route**

```typescript
// src/app/api/connections/facebook/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

const META_APP_ID = process.env.META_APP_ID!;
const REDIRECT_URI = `${process.env.APP_URL}/api/connections/facebook/callback`;

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const params = new URLSearchParams({
    client_id: META_APP_ID,
    redirect_uri: REDIRECT_URI,
    scope: "public_profile,user_posts,read_insights",
    response_type: "code",
    state: session.user.id,
  });

  return NextResponse.redirect(
    `https://www.facebook.com/v21.0/dialog/oauth?${params.toString()}`
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/connections/facebook/route.ts
git commit -m "feat: add Facebook OAuth initiation route"
```

---

## Task 3: Facebook OAuth Callback Route

**Files:**
- Create: `src/app/api/connections/facebook/callback/route.ts`

- [ ] **Step 1: Create the callback route**

```typescript
// src/app/api/connections/facebook/callback/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/encrypt";

const META_APP_ID = process.env.META_APP_ID!;
const META_APP_SECRET = process.env.META_APP_SECRET!;
const REDIRECT_URI = `${process.env.APP_URL}/api/connections/facebook/callback`;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const userId = searchParams.get("state");
  const error = searchParams.get("error");

  if (error || !code || !userId) {
    return NextResponse.redirect(
      new URL("/connections?error=facebook_denied", req.url)
    );
  }

  try {
    // Exchange code for short-lived token
    const tokenRes = await fetch(
      `https://graph.facebook.com/v21.0/oauth/access_token?${new URLSearchParams({
        client_id: META_APP_ID,
        client_secret: META_APP_SECRET,
        redirect_uri: REDIRECT_URI,
        code,
      })}`
    );
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      throw new Error(`Token exchange failed [redirect_uri=${REDIRECT_URI}]: ${JSON.stringify(tokenData)}`);
    }

    // Exchange for long-lived token (~60 days)
    const longLivedRes = await fetch(
      `https://graph.facebook.com/v21.0/oauth/access_token?${new URLSearchParams({
        grant_type: "fb_exchange_token",
        client_id: META_APP_ID,
        client_secret: META_APP_SECRET,
        fb_exchange_token: tokenData.access_token,
      })}`
    );
    const longLived = await longLivedRes.json();
    const accessToken = longLived.access_token ?? tokenData.access_token;
    const expiresIn: number = longLived.expires_in ?? 5183944; // 60 days default

    // Get user profile
    const meRes = await fetch(
      `https://graph.facebook.com/v21.0/me?fields=id,name&access_token=${accessToken}`
    );
    const meData = await meRes.json();

    await prisma.platformToken.upsert({
      where: { userId_platform: { userId, platform: "FACEBOOK" } },
      create: {
        userId,
        platform: "FACEBOOK",
        accessToken: encrypt(accessToken),
        expiresAt: new Date(Date.now() + expiresIn * 1000),
        platformUserId: meData.id ?? null,
        platformUsername: meData.name ?? "Facebook",
        scopes: "public_profile,user_posts,read_insights",
      },
      update: {
        accessToken: encrypt(accessToken),
        expiresAt: new Date(Date.now() + expiresIn * 1000),
        platformUserId: meData.id ?? null,
        platformUsername: meData.name ?? "Facebook",
      },
    });

    return NextResponse.redirect(new URL("/connections?success=facebook", req.url));
  } catch (err) {
    console.error("Facebook callback error:", err);
    const msg = encodeURIComponent(String(err).slice(0, 200));
    return NextResponse.redirect(
      new URL(`/connections?error=facebook_failed&detail=${msg}`, req.url)
    );
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/connections/facebook/callback/route.ts
git commit -m "feat: add Facebook OAuth callback route"
```

---

## Task 4: Add Facebook Card to Connections Page

**Files:**
- Modify: `src/app/(dashboard)/connections/page.tsx`

- [ ] **Step 1: Add Facebook to the PLATFORMS array**

In `src/app/(dashboard)/connections/page.tsx`, insert the Facebook entry as the first item in the `PLATFORMS` array (before `INSTAGRAM`):

```typescript
const PLATFORMS: PlatformInfo[] = [
  {
    id: "FACEBOOK",
    label: "Facebook",
    description: "Connect your Facebook profile to enable analytics (reactions, comments, shares, and Professional Mode reach).",
    color: "text-blue-700",
    connectUrl: "/api/connections/facebook",
  },
  {
    id: "INSTAGRAM",
    // ... existing entry unchanged
```

- [ ] **Step 2: Verify the page renders the Facebook card**

Run the dev server and navigate to `/connections`. Confirm a "Facebook" card appears with "Not connected" status and a "Connect" button.

```bash
npm run dev
```

Open `http://localhost:3000/connections` in a browser.

- [ ] **Step 3: Commit**

```bash
git add src/app/(dashboard)/connections/page.tsx
git commit -m "feat: add Facebook connection card to connections page"
```

---

## Task 5: Facebook Analytics Library + Tests

**Files:**
- Create: `src/lib/platforms/facebook-analytics.ts`
- Create: `src/lib/platforms/facebook-analytics.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/platforms/facebook-analytics.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { discoverFacebookPostId, fetchPostInsights } from "./facebook-analytics";

describe("discoverFacebookPostId", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("returns post ID when timestamp matches within 60 seconds", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ id: "123456_789", created_time: "2023-01-15T12:00:05+0000" }],
        paging: {},
      }),
    } as Response);

    const result = await discoverFacebookPostId(
      "token",
      new Date("2023-01-15T12:00:00Z"),
      "fb_1673784000"
    );
    expect(result).toBe("123456_789");
  });

  it("returns null when no match found across all pages", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ data: [], paging: {} }),
    } as Response);

    const result = await discoverFacebookPostId(
      "token",
      new Date("2023-01-15T12:00:00Z"),
      "fb_1673784000"
    );
    expect(result).toBeNull();
  });

  it("uses me/photos endpoint for photo sourceIds", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [], paging: {} }),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);

    await discoverFacebookPostId("token", new Date(), "fb_photo_abc123.jpg");
    expect(String(fetchMock.mock.calls[0][0])).toContain("me/photos");
  });

  it("uses me/posts endpoint for non-photo sourceIds", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [], paging: {} }),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);

    await discoverFacebookPostId("token", new Date(), "fb_1673784000");
    expect(String(fetchMock.mock.calls[0][0])).toContain("me/posts");
  });

  it("does not match when timestamp differs by more than 60 seconds", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ id: "123456_789", created_time: "2023-01-15T12:02:00+0000" }],
        paging: {},
      }),
    } as Response);

    const result = await discoverFacebookPostId(
      "token",
      new Date("2023-01-15T12:00:00Z"),
      "fb_1673784000"
    );
    expect(result).toBeNull();
  });
});

describe("fetchPostInsights", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("returns engagement metrics from first call", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          reactions: { summary: { total_count: 42 } },
          comments: { summary: { total_count: 7 } },
          shares: { count: 3 },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [], error: { message: "not available" } }),
      } as Response);

    const result = await fetchPostInsights("token", "123_456");
    expect(result.reactions).toBe(42);
    expect(result.comments).toBe(7);
    expect(result.shares).toBe(3);
    expect(result.reach).toBeNull();
    expect(result.impressions).toBeNull();
  });

  it("returns reach and impressions when Professional Mode insights available", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          reactions: { summary: { total_count: 10 } },
          comments: { summary: { total_count: 2 } },
          shares: { count: 1 },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            { name: "post_impressions_unique", values: [{ value: 500 }] },
            { name: "post_impressions", values: [{ value: 750 }] },
          ],
        }),
      } as Response);

    const result = await fetchPostInsights("token", "123_456");
    expect(result.reach).toBe(500);
    expect(result.impressions).toBe(750);
  });

  it("still returns engagement when insights call fails", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          reactions: { summary: { total_count: 5 } },
          comments: { summary: { total_count: 1 } },
          shares: { count: 0 },
        }),
      } as Response)
      .mockRejectedValueOnce(new Error("Network error"));

    const result = await fetchPostInsights("token", "123_456");
    expect(result.reactions).toBe(5);
    expect(result.reach).toBeNull();
    expect(result.impressions).toBeNull();
  });

  it("returns all nulls when both calls fail", async () => {
    vi.mocked(fetch)
      .mockRejectedValueOnce(new Error("Network error"))
      .mockRejectedValueOnce(new Error("Network error"));

    const result = await fetchPostInsights("token", "123_456");
    expect(result).toEqual({
      reactions: null,
      comments: null,
      shares: null,
      reach: null,
      impressions: null,
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- facebook-analytics
```

Expected: FAIL — `Cannot find module './facebook-analytics'`

- [ ] **Step 3: Implement the analytics library**

```typescript
// src/lib/platforms/facebook-analytics.ts

const GRAPH_API = "https://graph.facebook.com/v21.0";
const MAX_PAGES = 5;
const PAGE_SIZE = 100;

export interface AnalyticsResult {
  reactions: number | null;
  comments: number | null;
  shares: number | null;
  reach: number | null;
  impressions: number | null;
}

/**
 * Finds the real Facebook post ID for an imported post by matching timestamp.
 * Facebook export sourceIds are synthetic (fb_{timestamp} or fb_photo_{filename})
 * and do not contain the actual Graph API post ID.
 */
export async function discoverFacebookPostId(
  accessToken: string,
  originalDate: Date,
  sourceId: string
): Promise<string | null> {
  const targetTs = originalDate.getTime();
  const isPhoto = sourceId.startsWith("fb_photo_");
  const endpoint = isPhoto ? "me/photos" : "me/posts";

  let url: string | null =
    `${GRAPH_API}/${endpoint}?fields=id,created_time&limit=${PAGE_SIZE}&access_token=${accessToken}`;

  for (let page = 0; page < MAX_PAGES && url; page++) {
    const res = await fetch(url);
    const data = await res.json();

    if (data.error) throw new Error(`Facebook API error: ${data.error.message}`);

    const items: Array<{ id: string; created_time: string }> = data.data ?? [];

    for (const item of items) {
      const itemTs = new Date(item.created_time).getTime();
      if (Math.abs(itemTs - targetTs) < 60_000) {
        return item.id;
      }
    }

    url = data.paging?.next ?? null;
  }

  return null;
}

/**
 * Fetches engagement metrics for a known Facebook post ID.
 * Makes two parallel calls: one for reactions/comments/shares,
 * one for Professional Mode insights (reach/impressions).
 * Failures in either call are handled gracefully — the other call's data is still returned.
 */
export async function fetchPostInsights(
  accessToken: string,
  fbPostId: string
): Promise<AnalyticsResult> {
  const [engagementRes, insightsRes] = await Promise.allSettled([
    fetch(
      `${GRAPH_API}/${fbPostId}?fields=reactions.summary(true),comments.summary(true),shares&access_token=${accessToken}`
    ),
    fetch(
      `${GRAPH_API}/${fbPostId}/insights?metric=post_impressions,post_impressions_unique&access_token=${accessToken}`
    ),
  ]);

  let reactions: number | null = null;
  let comments: number | null = null;
  let shares: number | null = null;
  let reach: number | null = null;
  let impressions: number | null = null;

  if (engagementRes.status === "fulfilled" && engagementRes.value.ok) {
    const data = await engagementRes.value.json();
    if (!data.error) {
      reactions = data.reactions?.summary?.total_count ?? null;
      comments = data.comments?.summary?.total_count ?? null;
      shares = data.shares?.count ?? null;
    }
  }

  if (insightsRes.status === "fulfilled" && insightsRes.value.ok) {
    const data = await insightsRes.value.json();
    if (!data.error && Array.isArray(data.data)) {
      for (const metric of data.data as Array<{ name: string; values: Array<{ value: number }> }>) {
        const value = metric.values?.[0]?.value ?? null;
        if (metric.name === "post_impressions_unique") reach = value;
        if (metric.name === "post_impressions") impressions = value;
      }
    }
  }

  return { reactions, comments, shares, reach, impressions };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- facebook-analytics
```

Expected: All 9 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/platforms/facebook-analytics.ts src/lib/platforms/facebook-analytics.test.ts
git commit -m "feat: add Facebook analytics library with discovery and insights fetching"
```

---

## Task 6: Nightly Cron Job + vercel.json

**Files:**
- Create: `src/app/api/cron/facebook-analytics/route.ts`
- Modify: `vercel.json`

- [ ] **Step 1: Create the cron route**

```typescript
// src/app/api/cron/facebook-analytics/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/encrypt";
import { discoverFacebookPostId, fetchPostInsights } from "@/lib/platforms/facebook-analytics";

const CRON_SECRET = process.env.CRON_SECRET!;
const POSTS_PER_USER_PER_RUN = 50;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const facebookTokens = await prisma.platformToken.findMany({
    where: { platform: "FACEBOOK" },
    select: { userId: true, accessToken: true },
  });

  const results = { users: 0, discovered: 0, updated: 0, errors: 0 };

  for (const token of facebookTokens) {
    results.users++;
    const accessToken = decrypt(token.accessToken);

    try {
      const posts = await prisma.post.findMany({
        where: { userId: token.userId, source: "FACEBOOK", sourceId: { not: null } },
        include: {
          analytics: { where: { platform: "FACEBOOK" } },
        },
        orderBy: { originalDate: "asc" },
      });

      // Discovery pass: posts with no analytics record or no platformPostId yet
      const undiscovered = posts.filter((p) => !p.analytics[0]?.platformPostId);
      for (const post of undiscovered) {
        try {
          const fbPostId = await discoverFacebookPostId(
            accessToken,
            post.originalDate,
            post.sourceId!
          );
          if (fbPostId) {
            await prisma.postAnalytics.upsert({
              where: { postId_platform: { postId: post.id, platform: "FACEBOOK" } },
              create: { postId: post.id, platform: "FACEBOOK", platformPostId: fbPostId },
              update: { platformPostId: fbPostId },
            });
            results.discovered++;
          }
        } catch (err) {
          console.error(`Discovery failed for post ${post.id}:`, err);
          results.errors++;
        }
      }

      // Insights pass: posts with a known platformPostId, oldest-updated first, capped at 50
      const discovered = posts
        .filter((p) => p.analytics[0]?.platformPostId)
        .sort((a, b) => {
          const aTs = a.analytics[0]?.updatedAt?.getTime() ?? 0;
          const bTs = b.analytics[0]?.updatedAt?.getTime() ?? 0;
          return aTs - bTs;
        })
        .slice(0, POSTS_PER_USER_PER_RUN);

      for (const post of discovered) {
        const fbPostId = post.analytics[0].platformPostId!;
        try {
          const metrics = await fetchPostInsights(accessToken, fbPostId);
          await prisma.postAnalytics.update({
            where: { postId_platform: { postId: post.id, platform: "FACEBOOK" } },
            data: { ...metrics, fetchedAt: new Date() },
          });
          results.updated++;
        } catch (err) {
          console.error(`Insights failed for post ${post.id}:`, err);
          results.errors++;
        }
      }
    } catch (err) {
      console.error(`Facebook analytics cron failed for user ${token.userId}:`, err);
      results.errors++;
    }
  }

  return NextResponse.json(results);
}
```

- [ ] **Step 2: Add cron schedule to vercel.json**

Replace the contents of `vercel.json` with:

```json
{
  "crons": [
    {
      "path": "/api/cron/publish",
      "schedule": "0 0 * * *"
    },
    {
      "path": "/api/cron/drive-sync",
      "schedule": "0 2 * * *"
    },
    {
      "path": "/api/cron/facebook-analytics",
      "schedule": "0 3 * * *"
    }
  ]
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/cron/facebook-analytics/route.ts vercel.json
git commit -m "feat: add nightly Facebook analytics cron job"
```

---

## Task 7: Analytics Panel on Post Detail Page

**Files:**
- Modify: `src/app/(dashboard)/posts/[id]/page.tsx`

- [ ] **Step 1: Add `analytics` to the Prisma query**

In `src/app/(dashboard)/posts/[id]/page.tsx`, update the `prisma.post.findFirst` call to include analytics:

```typescript
  const post = await prisma.post.findFirst({
    where: { id, userId: session.user.id },
    include: {
      media: true,
      publishes: { orderBy: { createdAt: "desc" } },
      analytics: { where: { platform: "FACEBOOK" } },
    },
  });
```

- [ ] **Step 2: Add the analytics panel**

Add the following imports at the top of the file (after the existing imports):

```typescript
import { BarChart2 } from "lucide-react";
```

Add a `MetricTile` helper component just before the `export default async function PostDetailPage` line:

```typescript
function MetricTile({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-lg bg-gray-50 px-4 py-3 text-center">
      <p className="text-xl font-semibold text-gray-900">{value ?? "—"}</p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
    </div>
  );
}
```

Add the analytics panel inside the `lg:col-span-2 space-y-4` div, after the existing "Publish history" card block. Place it as the last card in that column:

```tsx
          {/* Facebook Analytics */}
          {post.source === "FACEBOOK" && (() => {
            const fbAnalytics = post.analytics[0] ?? null;
            return (
              <Card>
                <CardHeader className="flex flex-row items-center gap-2 pb-3">
                  <BarChart2 className="h-4 w-4 text-blue-600" />
                  <CardTitle className="text-base">Facebook Analytics</CardTitle>
                </CardHeader>
                <CardContent>
                  {!fbAnalytics ? (
                    <p className="text-sm text-gray-400">Analytics pending — syncs nightly at 3am</p>
                  ) : !fbAnalytics.platformPostId ? (
                    <p className="text-sm text-gray-400">Post not yet matched — syncs nightly at 3am</p>
                  ) : (
                    <div>
                      <div className="grid grid-cols-3 gap-3">
                        <MetricTile label="Reactions" value={fbAnalytics.reactions} />
                        <MetricTile label="Comments" value={fbAnalytics.comments} />
                        <MetricTile label="Shares" value={fbAnalytics.shares} />
                        {fbAnalytics.reach !== null && (
                          <MetricTile label="Reach" value={fbAnalytics.reach} />
                        )}
                        {fbAnalytics.impressions !== null && (
                          <MetricTile label="Impressions" value={fbAnalytics.impressions} />
                        )}
                      </div>
                      <p className="mt-3 text-xs text-gray-400">
                        Last updated:{" "}
                        {format(new Date(fbAnalytics.fetchedAt), "MMM d, yyyy 'at' h:mm a")}
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })()}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/(dashboard)/posts/[id]/page.tsx
git commit -m "feat: add Facebook analytics panel to post detail page"
```

---

## Task 8: Engagement Summary on Post List Cards

**Files:**
- Modify: `src/app/api/posts/route.ts`
- Modify: `src/app/(dashboard)/posts/page.tsx`

- [ ] **Step 1: Include analytics in the posts API response**

In `src/app/api/posts/route.ts`, update the `prisma.post.findMany` `include` block to add analytics:

```typescript
      include: {
        media: { select: { id: true, storageKey: true, mimeType: true } },
        publishes: {
          select: { platform: true, status: true, platformUrl: true, scheduledAt: true },
        },
        analytics: {
          where: { platform: "FACEBOOK" },
          select: { reactions: true, comments: true, shares: true, platformPostId: true },
        },
      },
```

- [ ] **Step 2: Update the Post interface and render the engagement row**

In `src/app/(dashboard)/posts/page.tsx`, update the `Post` interface to include analytics:

```typescript
interface Post {
  id: string;
  body: string;
  source: string;
  originalDate: string;
  thumbUrl: string | null;
  tags: string[];
  media: { id: string; mimeType: string }[];
  publishes: { platform: string; status: string }[];
  analytics: {
    reactions: number | null;
    comments: number | null;
    shares: number | null;
    platformPostId: string | null;
  }[];
}
```

In the same file, add the engagement summary row inside the post card's content `div` (the `min-w-0 flex-1` div), directly after the tags block:

```tsx
                    {post.source === "FACEBOOK" &&
                      post.analytics?.[0]?.platformPostId && (
                        <div className="mt-1.5 flex items-center gap-3 text-xs text-gray-400">
                          {post.analytics[0].reactions !== null && (
                            <span>❤ {post.analytics[0].reactions}</span>
                          )}
                          {post.analytics[0].comments !== null && (
                            <span>💬 {post.analytics[0].comments}</span>
                          )}
                          {post.analytics[0].shares !== null && (
                            <span>↗ {post.analytics[0].shares}</span>
                          )}
                        </div>
                      )}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Run all tests**

```bash
npm test
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/posts/route.ts src/app/(dashboard)/posts/page.tsx
git commit -m "feat: show Facebook engagement summary on post list cards"
```

---

## Final Verification

- [ ] Run the dev server: `npm run dev`
- [ ] Navigate to `/connections` — Facebook card present with Connect button
- [ ] Click Connect — should redirect to Facebook Login (needs `META_APP_ID` set in `.env.local`)
- [ ] After connecting, card shows name + expiry date
- [ ] Navigate to any `source: FACEBOOK` post detail — Analytics panel visible with pending message
- [ ] Manually trigger the cron to test end-to-end:
  ```bash
  curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/facebook-analytics
  ```
  Expected response: `{"users":1,"discovered":N,"updated":0,"errors":0}` on first run (discovery only)
- [ ] Run cron a second time — `updated` count increases as insights are fetched
- [ ] Reload post detail — analytics panel shows metric tiles
- [ ] Reload posts list — engagement row visible on matched Facebook posts
