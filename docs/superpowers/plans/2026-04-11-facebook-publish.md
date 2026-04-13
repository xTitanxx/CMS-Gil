# Facebook Publish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface two Facebook publish destinations in the CMS: a manual copy-to-clipboard row for personal profiles, and an API-backed "Facebook Page" toggle that publishes via Meta Graph API.

**Architecture:** Extend the existing `/api/connections/facebook` OAuth flow to request Page scopes in the same consent, store the page access token as a new `FACEBOOK_PAGE` `PlatformToken` row (separate from the existing analytics token), add a `postToFacebook` helper that mirrors the other `src/lib/platforms/*` modules, and wire it into the publish dispatcher and `PublishPanel` alongside the existing platforms. The manual personal-profile row is a purely client-side action — no backend touch.

**Tech Stack:** Next.js 16 App Router, Prisma 7 + Neon Postgres, Meta Graph API v21.0, Cloudinary signed URLs, Tailwind (no new UI deps).

**Spec:** `docs/superpowers/specs/2026-04-11-facebook-manual-publish-design.md`

---

## Prep — Feature branch

Per CLAUDE.md, feature work must live on a dedicated branch. The current branch (`claude/personal-cms-social-posting-QV57t`) has unrelated dirty files; they'll ride along on the new branch but are untouched by this work.

- [ ] **Step P.1: Create the feature branch**

```bash
git checkout -b feature/facebook-publish
```

- [ ] **Step P.2: Confirm branch created**

```bash
git branch --show-current
```

Expected output: `feature/facebook-publish`

---

## Task 1: Add `FACEBOOK_PAGE` to the Prisma Platform enum

**Files:**
- Modify: `prisma/schema.prisma:144-150`
- Create: `prisma/migrations/<timestamp>_add_facebook_page_platform/migration.sql`

- [ ] **Step 1.1: Edit the enum**

Change lines 144–150 of `prisma/schema.prisma` from:

```prisma
enum Platform {
  FACEBOOK
  INSTAGRAM
  LINKEDIN
  YOUTUBE
  TIKTOK
}
```

to:

```prisma
enum Platform {
  FACEBOOK
  FACEBOOK_PAGE
  INSTAGRAM
  LINKEDIN
  YOUTUBE
  TIKTOK
}
```

- [ ] **Step 1.2: Generate the migration**

Run:

```bash
npx prisma migrate dev --name add_facebook_page_platform
```

Expected: Prisma creates a new migration directory under `prisma/migrations/` and applies it to the local DB. The generated `migration.sql` should contain a single `ALTER TYPE "Platform" ADD VALUE 'FACEBOOK_PAGE'` statement (Postgres enum value add).

If Prisma warns about the DB being out of sync with the schema due to unrelated uncommitted migrations, do NOT `--create-only` and do NOT `migrate reset` — investigate. The only change in the schema delta should be the one enum value.

- [ ] **Step 1.3: Regenerate the Prisma client**

```bash
npx prisma generate
```

Expected: regenerates `node_modules/.prisma/client` with the new enum variant typed.

- [ ] **Step 1.4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(fb): add FACEBOOK_PAGE platform enum value"
```

---

## Task 2: Expand Facebook OAuth scopes

**Files:**
- Modify: `src/app/api/connections/facebook/route.ts`

- [ ] **Step 2.1: Edit the scope string**

Replace the `scope` value in the `URLSearchParams` block so it requests Page management alongside the existing analytics scopes. The full file becomes:

```ts
// Facebook OAuth — Authorization Code Flow
// Requests both personal-profile analytics scopes and Page publishing scopes
// in a single consent screen, then the callback stores two PlatformToken rows.
// Docs: https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

const META_APP_ID = process.env.META_APP_ID!;
const REDIRECT_URI = `${process.env.APP_URL}/api/connections/facebook/callback`;

const SCOPES = [
  "public_profile",
  "user_posts",
  "read_insights",
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "pages_manage_engagement",
].join(",");

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const params = new URLSearchParams({
    client_id: META_APP_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    response_type: "code",
    state: session.user.id,
  });

  return NextResponse.redirect(
    `https://www.facebook.com/v21.0/dialog/oauth?${params.toString()}`
  );
}
```

- [ ] **Step 2.2: Commit**

```bash
git add src/app/api/connections/facebook/route.ts
git commit -m "feat(fb): request Page management scopes on Facebook OAuth"
```

---

## Task 3: Store Page access token in the callback

**Files:**
- Modify: `src/app/api/connections/facebook/callback/route.ts`

- [ ] **Step 3.1: Extend the callback handler**

Replace the current body of `GET` in `src/app/api/connections/facebook/callback/route.ts` with the version below. The new block calls `GET /me/accounts` after the long-lived user token exchange, picks the first page, and upserts a `FACEBOOK_PAGE` row. If the user admins zero pages, it logs and continues — the redirect still signals success so the user is not stranded.

```ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/encrypt";

const META_APP_ID = process.env.META_APP_ID!;
const META_APP_SECRET = process.env.META_APP_SECRET!;
const REDIRECT_URI = `${process.env.APP_URL}/api/connections/facebook/callback`;

const USER_SCOPES =
  "public_profile,user_posts,read_insights,pages_show_list,pages_read_engagement,pages_manage_posts,pages_manage_engagement";

interface PageAccount {
  id: string;
  name: string;
  access_token: string;
}

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
    // 1. Short-lived user token
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
      throw new Error(
        `Token exchange failed [redirect_uri=${REDIRECT_URI}]: ${JSON.stringify(tokenData)}`
      );
    }

    // 2. Long-lived user token (~60 days)
    const longLivedRes = await fetch(
      `https://graph.facebook.com/v21.0/oauth/access_token?${new URLSearchParams({
        grant_type: "fb_exchange_token",
        client_id: META_APP_ID,
        client_secret: META_APP_SECRET,
        fb_exchange_token: tokenData.access_token,
      })}`
    );
    const longLived = await longLivedRes.json();
    const userAccessToken: string = longLived.access_token ?? tokenData.access_token;
    const userExpiresIn: number = longLived.expires_in ?? 5183944;

    // 3. Personal profile info (for analytics card label)
    const meRes = await fetch(
      `https://graph.facebook.com/v21.0/me?fields=id,name&access_token=${userAccessToken}`
    );
    const meData = await meRes.json();

    // 4. Upsert the FACEBOOK (personal analytics) token
    await prisma.platformToken.upsert({
      where: { userId_platform: { userId, platform: "FACEBOOK" } },
      create: {
        userId,
        platform: "FACEBOOK",
        accessToken: encrypt(userAccessToken),
        expiresAt: new Date(Date.now() + userExpiresIn * 1000),
        platformUserId: meData.id ?? null,
        platformUsername: meData.name ?? "Facebook",
        scopes: USER_SCOPES,
      },
      update: {
        accessToken: encrypt(userAccessToken),
        expiresAt: new Date(Date.now() + userExpiresIn * 1000),
        platformUserId: meData.id ?? null,
        platformUsername: meData.name ?? "Facebook",
        scopes: USER_SCOPES,
      },
    });

    // 5. Fetch pages the user admins, pick the first one, upsert FACEBOOK_PAGE.
    //    A user with zero pages gets no FACEBOOK_PAGE row — they can still use
    //    the analytics connection and the manual copy-to-clipboard row.
    const pagesRes = await fetch(
      `https://graph.facebook.com/v21.0/me/accounts?fields=id,name,access_token&access_token=${userAccessToken}`
    );
    const pagesData = await pagesRes.json();
    const pages: PageAccount[] = Array.isArray(pagesData.data) ? pagesData.data : [];

    if (pages.length > 0) {
      const page = pages[0];
      await prisma.platformToken.upsert({
        where: { userId_platform: { userId, platform: "FACEBOOK_PAGE" } },
        create: {
          userId,
          platform: "FACEBOOK_PAGE",
          accessToken: encrypt(page.access_token),
          // Page access tokens derived from a long-lived user token are themselves
          // long-lived and generally do not expire — leave expiresAt null.
          expiresAt: null,
          platformUserId: page.id,
          platformUsername: page.name,
          scopes: "pages_manage_posts,pages_read_engagement,pages_manage_engagement",
        },
        update: {
          accessToken: encrypt(page.access_token),
          expiresAt: null,
          platformUserId: page.id,
          platformUsername: page.name,
          scopes: "pages_manage_posts,pages_read_engagement,pages_manage_engagement",
        },
      });
    } else {
      // Clear any stale page token from a previous connection.
      await prisma.platformToken.deleteMany({
        where: { userId, platform: "FACEBOOK_PAGE" },
      });
    }

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

- [ ] **Step 3.2: Typecheck the file**

```bash
npx tsc --noEmit
```

Expected: no errors. If `FACEBOOK_PAGE` is flagged as not assignable to `Platform`, you skipped `npx prisma generate` in Task 1 — re-run it.

- [ ] **Step 3.3: Commit**

```bash
git add src/app/api/connections/facebook/callback/route.ts
git commit -m "feat(fb): store Facebook Page access token in callback"
```

---

## Task 4: Create `postToFacebook`

**Files:**
- Create: `src/lib/platforms/facebook.ts`

- [ ] **Step 4.1: Write the module**

Create `src/lib/platforms/facebook.ts` with the full contents below. This mirrors the shape of `src/lib/platforms/instagram.ts` — same `PublishResult` contract, same use of `getSignedDownloadUrl`, same single-exported entry point called by the dispatcher.

```ts
// Meta Graph API — Facebook Page Content Publishing
// Scopes required on the Page access token: pages_manage_posts,
// pages_read_engagement (for the `id` response field). Requires a Page
// access token (from /me/accounts), not a user access token.

import { getSignedDownloadUrl } from "@/lib/storage";

interface PublishResult {
  platformPostId: string;
  platformUrl?: string;
}

interface FacebookCredentials {
  accessToken: string; // Page access token
  platformUserId: string; // Page ID
}

const GRAPH = "https://graph.facebook.com/v21.0";
const VIDEO_RE = /\.(mp4|mov|avi|webm|mkv)$/i;

export async function postToFacebook(
  creds: FacebookCredentials,
  body: string,
  mediaKeys: string[]
): Promise<PublishResult> {
  const { accessToken, platformUserId: pageId } = creds;

  // Text-only feed post
  if (mediaKeys.length === 0) {
    return feedPost(pageId, accessToken, { message: body });
  }

  // Single photo
  if (mediaKeys.length === 1 && !VIDEO_RE.test(mediaKeys[0])) {
    const url = await getSignedDownloadUrl(mediaKeys[0], 3600);
    return photoPost(pageId, accessToken, { url, caption: body });
  }

  // Single video
  if (mediaKeys.length === 1 && VIDEO_RE.test(mediaKeys[0])) {
    const url = await getSignedDownloadUrl(mediaKeys[0], 3600);
    return videoPost(pageId, accessToken, { file_url: url, description: body });
  }

  // Multiple files — if all photos, make one multi-photo feed post.
  const allPhotos = mediaKeys.every((k) => !VIDEO_RE.test(k));
  if (allPhotos) {
    return multiPhotoPost(pageId, accessToken, mediaKeys, body);
  }

  // Mixed media or multiple videos — fall back to one post per file.
  // The first post carries the caption; subsequent posts carry media only.
  // This keeps the implementation small; we can upgrade to a proper mixed
  // carousel later if it becomes important.
  let firstResult: PublishResult | null = null;
  for (let i = 0; i < mediaKeys.length; i++) {
    const key = mediaKeys[i];
    const caption = i === 0 ? body : "";
    const url = await getSignedDownloadUrl(key, 3600);
    const result = VIDEO_RE.test(key)
      ? await videoPost(pageId, accessToken, { file_url: url, description: caption })
      : await photoPost(pageId, accessToken, { url, caption });
    if (i === 0) firstResult = result;
  }
  return firstResult!;
}

async function feedPost(
  pageId: string,
  accessToken: string,
  fields: { message: string }
): Promise<PublishResult> {
  const form = new URLSearchParams({
    message: fields.message,
    published: "true",
    access_token: accessToken,
  });
  const res = await fetch(`${GRAPH}/${pageId}/feed`, { method: "POST", body: form });
  const data = await res.json();
  if (!res.ok || !data.id) {
    throw new Error(`Facebook feed post failed: ${JSON.stringify(data)}`);
  }
  return {
    platformPostId: data.id,
    platformUrl: facebookPostUrl(pageId, data.id),
  };
}

async function photoPost(
  pageId: string,
  accessToken: string,
  fields: { url: string; caption: string }
): Promise<PublishResult> {
  const form = new URLSearchParams({
    url: fields.url,
    caption: fields.caption,
    published: "true",
    access_token: accessToken,
  });
  const res = await fetch(`${GRAPH}/${pageId}/photos`, { method: "POST", body: form });
  const data = await res.json();
  if (!res.ok || !(data.id || data.post_id)) {
    throw new Error(`Facebook photo post failed: ${JSON.stringify(data)}`);
  }
  const postId: string = data.post_id ?? data.id;
  return {
    platformPostId: postId,
    platformUrl: facebookPostUrl(pageId, postId),
  };
}

async function videoPost(
  pageId: string,
  accessToken: string,
  fields: { file_url: string; description: string }
): Promise<PublishResult> {
  const form = new URLSearchParams({
    file_url: fields.file_url,
    description: fields.description,
    access_token: accessToken,
  });
  const res = await fetch(`${GRAPH}/${pageId}/videos`, { method: "POST", body: form });
  const data = await res.json();
  if (!res.ok || !data.id) {
    throw new Error(`Facebook video post failed: ${JSON.stringify(data)}`);
  }
  return {
    platformPostId: data.id,
    platformUrl: facebookPostUrl(pageId, data.id),
  };
}

async function multiPhotoPost(
  pageId: string,
  accessToken: string,
  keys: string[],
  caption: string
): Promise<PublishResult> {
  // 1. Upload each photo unpublished and collect media_fbid values.
  const mediaFbids: string[] = [];
  for (const key of keys) {
    const url = await getSignedDownloadUrl(key, 3600);
    const form = new URLSearchParams({
      url,
      published: "false",
      access_token: accessToken,
    });
    const res = await fetch(`${GRAPH}/${pageId}/photos`, { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok || !data.id) {
      throw new Error(`Facebook multi-photo upload failed: ${JSON.stringify(data)}`);
    }
    mediaFbids.push(data.id);
  }

  // 2. Create a feed post that references them via attached_media[{n}].
  const form = new URLSearchParams();
  form.set("message", caption);
  form.set("published", "true");
  form.set("access_token", accessToken);
  mediaFbids.forEach((id, i) => {
    form.set(`attached_media[${i}]`, JSON.stringify({ media_fbid: id }));
  });

  const res = await fetch(`${GRAPH}/${pageId}/feed`, { method: "POST", body: form });
  const data = await res.json();
  if (!res.ok || !data.id) {
    throw new Error(`Facebook multi-photo feed post failed: ${JSON.stringify(data)}`);
  }
  return {
    platformPostId: data.id,
    platformUrl: facebookPostUrl(pageId, data.id),
  };
}

function facebookPostUrl(pageId: string, postId: string): string {
  // postId is returned as "{pageId}_{numericId}" for feed posts, or a bare
  // numeric id for photos/videos. Either works in the /{pageId}/posts/{id}
  // shape — Facebook normalizes it.
  const numeric = postId.includes("_") ? postId.split("_")[1] : postId;
  return `https://www.facebook.com/${pageId}/posts/${numeric}`;
}
```

- [ ] **Step 4.2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4.3: Commit**

```bash
git add src/lib/platforms/facebook.ts
git commit -m "feat(fb): add postToFacebook for Facebook Page publishing"
```

---

## Task 5: Wire `FACEBOOK_PAGE` into the publish dispatcher

**Files:**
- Modify: `src/app/api/posts/[id]/publish/route.ts`

- [ ] **Step 5.1: Import `postToFacebook`**

Add to the import block at the top of the file, after the other `postTo*` imports:

```ts
import { postToFacebook } from "@/lib/platforms/facebook";
```

- [ ] **Step 5.2: Add the dispatcher case**

Inside the `switch (platform)` block around line 107, add a new case before `default`:

```ts
case "FACEBOOK_PAGE":
  result = await postToFacebook(
    { accessToken, platformUserId: platformUserId! },
    post.body,
    mediaKeys
  );
  break;
```

Keep the existing INSTAGRAM / LINKEDIN / YOUTUBE / TIKTOK cases exactly as they are. The `FACEBOOK_PAGE` branch does **not** need any special token lookup — the existing `else` branch at line 95 that reads from `PlatformToken` already covers it correctly because the row is keyed by `(userId, FACEBOOK_PAGE)`.

- [ ] **Step 5.3: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5.4: Commit**

```bash
git add src/app/api/posts/[id]/publish/route.ts
git commit -m "feat(fb): dispatch FACEBOOK_PAGE publishes to postToFacebook"
```

---

## Task 6: Add `FACEBOOK_PAGE` as a toggleable platform in PublishPanel

**Files:**
- Modify: `src/components/posts/PublishPanel.tsx`

This task only adds the API-backed toggle. The manual personal-profile row is added separately in Task 7 so the diffs stay narrowly scoped.

- [ ] **Step 6.1: Add `FACEBOOK_PAGE` to the PLATFORMS const and color map**

Update the top of `src/components/posts/PublishPanel.tsx`:

```ts
const PLATFORMS = ["FACEBOOK_PAGE", "INSTAGRAM", "LINKEDIN", "YOUTUBE", "TIKTOK"] as const;
type Platform = (typeof PLATFORMS)[number];

const VIDEO_ONLY_PLATFORMS: ReadonlySet<Platform> = new Set(["YOUTUBE", "TIKTOK"]);

const PLATFORM_LABELS: Record<Platform, string> = {
  FACEBOOK_PAGE: "Facebook Page",
  INSTAGRAM: "Instagram",
  LINKEDIN: "LinkedIn",
  YOUTUBE: "YouTube",
  TIKTOK: "TikTok",
};

const PLATFORM_COLORS: Record<Platform, string> = {
  FACEBOOK_PAGE: "bg-blue-50 border-blue-200 text-blue-700",
  INSTAGRAM: "bg-pink-50 border-pink-200 text-pink-700",
  LINKEDIN: "bg-blue-50 border-blue-200 text-blue-800",
  YOUTUBE: "bg-red-50 border-red-200 text-red-700",
  TIKTOK: "bg-gray-900 border-gray-700 text-white",
};
```

Note the two deliberate changes:
- Added `PLATFORM_LABELS` so the toggle row can render `"Facebook Page"` instead of the raw enum string. Previously the JSX rendered `{p}` — replace that reference too.
- Nudged LinkedIn's text class to `text-blue-800` so the Facebook Page row (which uses `text-blue-700`) and LinkedIn row don't look identical.

- [ ] **Step 6.2: Update the toggle button label**

Inside the `.map((p) => { ... })` loop in the JSX, replace:

```tsx
<span>{p}</span>
```

with:

```tsx
<span>{PLATFORM_LABELS[p]}</span>
```

Keep the `disabled`/`selected` logic exactly as it is.

- [ ] **Step 6.3: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6.4: Commit**

```bash
git add src/components/posts/PublishPanel.tsx
git commit -m "feat(fb): add Facebook Page as a toggleable publish platform"
```

---

## Task 7: Add the manual "Facebook (Personal)" action row

**Files:**
- Modify: `src/components/posts/PublishPanel.tsx`
- Modify: `src/app/(dashboard)/posts/[id]/PostInteractions.tsx`
- Modify: `src/app/(dashboard)/posts/[id]/page.tsx`

The manual row is a non-toggle sibling of the platform list, rendered directly under the toggle group inside the same "Select Platforms" section so it reads as part of the list. It copies the post body to the clipboard and shows a tooltip explaining why it behaves differently.

- [ ] **Step 7.1: Add the `body` prop to `PublishPanel`**

Update the interface and destructuring at the top of `PublishPanel.tsx`:

```ts
interface PublishPanelProps {
  postId: string;
  body: string;
  hasVideo: boolean;
  onPublished?: () => void;
}

export function PublishPanel({ postId, body, hasVideo, onPublished }: PublishPanelProps) {
```

- [ ] **Step 7.2: Add new imports and copy state**

Add to the lucide import at the top of the file:

```ts
import { Send, Clock, Video, Copy, Check, HelpCircle } from "lucide-react";
```

Inside the `PublishPanel` function body, alongside the existing `useState` hooks:

```ts
const [copied, setCopied] = useState(false);
const [copyError, setCopyError] = useState("");
const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
```

And add `useRef` to the `react` import:

```ts
import { useRef, useState } from "react";
```

- [ ] **Step 7.3: Add the copy handler**

Inside the function body, below the existing `publish` handler:

```ts
const copyCaption = async () => {
  if (!body) return;
  if (typeof navigator === "undefined" || !navigator.clipboard) {
    setCopyError("Copy not supported in this browser");
    return;
  }
  try {
    await navigator.clipboard.writeText(body);
    setCopied(true);
    setCopyError("");
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    copyTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
  } catch {
    setCopyError("Copy failed — try again");
  }
};
```

- [ ] **Step 7.4: Render the manual row**

Inside the JSX, immediately after the closing `</div>` of the `{PLATFORMS.map(...)}` block (still inside the `Select Platforms` `<div className="space-y-2">`), add:

```tsx
{/* Manual Facebook (Personal) action row — not a toggle */}
<div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
  <div className="flex items-center justify-between gap-2">
    <div className="flex items-center gap-2 text-blue-700">
      <span className="font-medium">Facebook (Personal)</span>
      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-gray-500">
        Manual
      </span>
      <span className="group relative inline-flex focus-within:outline-none">
        <button
          type="button"
          aria-label="Why is Facebook manual?"
          className="inline-flex h-4 w-4 items-center justify-center rounded-full text-gray-400 hover:text-gray-600 focus:text-gray-600 focus:outline-none"
        >
          <HelpCircle className="h-4 w-4" />
        </button>
        <span
          role="tooltip"
          className="pointer-events-none absolute left-1/2 top-full z-10 mt-2 w-64 -translate-x-1/2 rounded-md bg-gray-900 px-3 py-2 text-[11px] leading-snug text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
        >
          Meta&apos;s Graph API doesn&apos;t allow publishing to personal
          Facebook profiles, even in Professional Mode. Copy the caption and
          paste it into the Facebook app to post.
        </span>
      </span>
    </div>
    <button
      type="button"
      onClick={copyCaption}
      disabled={!body}
      className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {copied ? (
        <>
          <Check className="h-3 w-3" />
          Copied!
        </>
      ) : (
        <>
          <Copy className="h-3 w-3" />
          Copy caption
        </>
      )}
    </button>
  </div>
  {!body && (
    <p className="mt-1 text-[11px] text-gray-400">
      No caption — this post has no text.
    </p>
  )}
  {copyError && (
    <p className="mt-1 text-[11px] text-red-600">{copyError}</p>
  )}
</div>
```

- [ ] **Step 7.5: Thread `body` through `PublishPanelWithRefresh`**

Edit `src/app/(dashboard)/posts/[id]/PostInteractions.tsx` around line 76. Change the wrapper:

```tsx
export function PublishPanelWithRefresh({
  postId,
  body,
  hasVideo,
}: {
  postId: string;
  body: string;
  hasVideo: boolean;
}) {
  const router = useRouter();
  return (
    <PublishPanel
      postId={postId}
      body={body}
      hasVideo={hasVideo}
      onPublished={() => router.refresh()}
    />
  );
}
```

- [ ] **Step 7.6: Pass `post.body` in from the page**

Edit `src/app/(dashboard)/posts/[id]/page.tsx:150`. Change:

```tsx
<PublishPanelWithRefresh postId={id} hasVideo={hasVideo} />
```

to:

```tsx
<PublishPanelWithRefresh postId={id} body={post.body} hasVideo={hasVideo} />
```

- [ ] **Step 7.7: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7.8: Commit**

```bash
git add src/components/posts/PublishPanel.tsx src/app/(dashboard)/posts/[id]/PostInteractions.tsx src/app/(dashboard)/posts/[id]/page.tsx
git commit -m "feat(fb): manual Facebook (Personal) copy-caption row in PublishPanel"
```

---

## Task 8: Update the Facebook card on the Connections page

**Files:**
- Modify: `src/app/(dashboard)/connections/page.tsx`

- [ ] **Step 8.1: Update the Facebook entry in `PLATFORMS`**

Edit the Facebook object in the `PLATFORMS` array (lines 20–26) so the description reflects the new dual purpose:

```ts
{
  id: "FACEBOOK",
  label: "Facebook",
  description:
    "Connect your Facebook account to enable analytics on imported posts and publishing to a Facebook Page you admin. Personal profile publishing is not available — use the manual Copy caption row on a post.",
  color: "text-blue-700",
  connectUrl: "/api/connections/facebook",
},
```

- [ ] **Step 8.2: Surface the Facebook Page state next to the personal profile state**

Directly below the existing `connected && token && (...)` block inside the Facebook card, add a second bit of state that reads the `FACEBOOK_PAGE` token. Since the existing render loop is generic across `PLATFORMS[]`, scope the addition to `platform.id === "FACEBOOK"` so only this card gets the extra line.

Inside the `<CardContent>` block, after the existing `{connected && token && (...)}` block, add:

```tsx
{platform.id === "FACEBOOK" && (() => {
  const pageToken = tokens.find((t) => t.platform === "FACEBOOK_PAGE");
  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
      {pageToken ? (
        <span>
          <span className="font-medium">Page:</span> @{pageToken.platformUsername}
        </span>
      ) : connected ? (
        <span className="text-gray-400">
          No pages found — Facebook Page publishing unavailable
        </span>
      ) : null}
    </div>
  );
})()}
```

Keep the existing Connect / Reconnect / Disconnect buttons on this card exactly as they are — one Disconnect click will cascade to the page row once Task 9 lands.

- [ ] **Step 8.3: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 8.4: Commit**

```bash
git add src/app/(dashboard)/connections/page.tsx
git commit -m "feat(fb): show Facebook Page state on the connections card"
```

---

## Task 9: Cascade `FACEBOOK` disconnect → `FACEBOOK_PAGE`

**Files:**
- Modify: `src/app/api/connections/route.ts:96-112`

- [ ] **Step 9.1: Extend the DELETE handler**

Replace the `DELETE` function body so that disconnecting `FACEBOOK` also removes the `FACEBOOK_PAGE` row:

```ts
// DELETE /api/connections?platform=INSTAGRAM — disconnect a platform
export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const platform = req.nextUrl.searchParams.get("platform") as Platform | null;
  if (!platform) {
    return NextResponse.json({ error: "Platform required" }, { status: 400 });
  }

  // Disconnecting FACEBOOK cascades to FACEBOOK_PAGE — both are granted by
  // the same OAuth consent, so removing one without the other leaves the user
  // in an inconsistent state.
  const platforms: Platform[] =
    platform === "FACEBOOK" ? ["FACEBOOK", "FACEBOOK_PAGE"] : [platform];

  await prisma.platformToken.deleteMany({
    where: { userId: session.user.id, platform: { in: platforms } },
  });

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 9.2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 9.3: Commit**

```bash
git add src/app/api/connections/route.ts
git commit -m "feat(fb): cascade FACEBOOK disconnect to FACEBOOK_PAGE"
```

---

## Task 10: End-to-end manual verification

No automated UI tests exist in this repo; the spec explicitly calls for manual verification. Run the dev server, walk through every branch of the new behavior, and check each box.

- [ ] **Step 10.1: Restart dev server**

```bash
npm run dev
```

Visit `http://localhost:3000` in a browser. Wait for the first compile to finish.

- [ ] **Step 10.2: Manual row — non-empty body**

1. Navigate to any post with caption text.
2. In the Publish panel, confirm the `Facebook (Personal)` row is rendered below the toggles.
3. Click `Copy caption`. The button flips to `Copied!` with a check icon.
4. Paste into a scratch text field — the exact `post.body` should land.
5. Wait ~2 seconds — the button should revert to `Copy caption`.
6. Re-click within the 2s window — it should stay on `Copied!` and restart the timer (no double-flip).

Expected: all six hold.

- [ ] **Step 10.3: Manual row — empty body**

1. Navigate to an imported Facebook post with no caption (there are several in the user's data).
2. The `Copy caption` button is disabled and the "No caption — this post has no text." hint is visible.

- [ ] **Step 10.4: Tooltip**

1. Hover the `?` icon → tooltip reveals, mentions "Meta's Graph API doesn't allow publishing to personal Facebook profiles".
2. Move the mouse away → tooltip hides.
3. Tab the keyboard into the `?` button → tooltip reveals via `focus-within`.
4. Tab away → tooltip hides.

- [ ] **Step 10.5: Toggle platforms still work**

1. Select `Instagram` and `LinkedIn` in the toggle list.
2. Confirm they light up as selected.
3. Confirm `Facebook (Personal)` is not selectable and has no "Selected" badge.
4. Click `Post Now` with a scheduled time in the past — publish should fire for the toggled platforms only. Facebook (Personal) does not create a `PublishRecord`.

Check the DB to confirm only IG/LI records were created:

```bash
npx prisma studio
```

Open `PublishRecord`, filter by this `postId`, confirm no `FACEBOOK` or `FACEBOOK_PAGE` row.

- [ ] **Step 10.6: Facebook OAuth flow**

1. Go to `/connections`, click `Reconnect` (or `Connect` if not yet connected) on the Facebook card.
2. On Meta's consent screen, confirm the new scopes appear: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `pages_manage_engagement` alongside the existing `user_posts`, `read_insights`.
3. Approve.
4. Land back on `/connections?success=facebook`.
5. The Facebook card shows both `@{your_name}` (personal profile) and `Page: @{your_page_name}`.

Check the DB:

```bash
npx prisma studio
```

Open `PlatformToken`, filter by your `userId`. Confirm two rows: `FACEBOOK` and `FACEBOOK_PAGE`. The `FACEBOOK_PAGE` row has `platformUserId` = Facebook page numeric id and `platformUsername` = page name.

- [ ] **Step 10.7: Publish text-only post to Facebook Page**

1. Open a post with a non-empty caption and no media.
2. In the Publish panel, toggle `Facebook Page`.
3. Click `Post Now`.
4. Watch the publish history card below — a new `FACEBOOK_PAGE` record should appear, transition through `PROCESSING` → `PUBLISHED`, and show a `platformUrl`.
5. Click the external-link icon — it should open the live post on the Facebook Page.
6. Confirm the post text matches.

- [ ] **Step 10.8: Publish single photo to Facebook Page**

1. Open a post with one image and a caption.
2. Toggle `Facebook Page` → `Post Now`.
3. Wait for `PUBLISHED` status.
4. Open the live URL → confirm photo + caption rendered correctly.

- [ ] **Step 10.9: Publish single video to Facebook Page**

1. Open a post with one video (and ideally a caption).
2. Toggle `Facebook Page` → `Post Now`.
3. Video upload via `file_url` can take up to a minute — wait for `PUBLISHED` status.
4. Open the live URL → confirm video plays and the description shows the caption.

- [ ] **Step 10.10: Publish multi-photo post to Facebook Page**

1. Open a post with 2+ photos and no video.
2. Toggle `Facebook Page` → `Post Now`.
3. Wait for `PUBLISHED` status.
4. Open the live URL → confirm all photos are attached to a single feed post with the caption.

- [ ] **Step 10.11: Disconnect cascade**

1. Go to `/connections`, click `Disconnect` on the Facebook card.
2. Reload. Both the personal profile label and the `Page: @...` line should be gone.
3. Check `PlatformToken` in Prisma Studio — neither `FACEBOOK` nor `FACEBOOK_PAGE` row should exist for your user.
4. Reconnect for subsequent testing if needed.

- [ ] **Step 10.12: Zero-page account (optional but recommended)**

If you have access to a Facebook account that admins zero Pages, run through the OAuth flow with it. Expected:

- OAuth completes successfully (`?success=facebook`).
- The Facebook card shows the personal profile line and "No pages found — Facebook Page publishing unavailable" in the page slot.
- `PublishPanel` still shows the `Facebook Page` toggle, but clicking `Post Now` with it selected fails with a clear error ("No FACEBOOK_PAGE token found"). That's acceptable for v1 — we can grey out the toggle in a follow-up if this failure mode is observed in practice.

If you don't have a zero-page account, skip this step.

- [ ] **Step 10.13: Final commit (only if you made small fixups during verification)**

If verification surfaced small fixes (typos, color tweaks, null-check omissions), commit them now with a `fix(fb):` prefix and move on. If verification was clean, nothing to commit.

---

## Done criteria

- [ ] Prisma migration applied; `FACEBOOK_PAGE` exists in `Platform` enum and in generated client.
- [ ] `/api/connections/facebook` grants Page scopes; callback stores `FACEBOOK` and `FACEBOOK_PAGE` rows.
- [ ] `src/lib/platforms/facebook.ts` exports `postToFacebook` covering text / single photo / single video / multi-photo / mixed-media-fallback.
- [ ] Publish dispatcher routes `FACEBOOK_PAGE` to `postToFacebook`.
- [ ] PublishPanel has `Facebook Page` toggle and non-selectable `Facebook (Personal)` manual row with `?` tooltip and copy-to-clipboard.
- [ ] Connections page shows one Facebook card that surfaces both personal and page state.
- [ ] DELETE cascade removes both rows when Facebook is disconnected.
- [ ] Every step in Task 10 verified by the engineer.

## Out of scope (explicitly, for later)

- Facebook Stories / Reels endpoints (`/photo_stories`, `/video_stories`, `/video_reels`).
- Multi-page picker when `/me/accounts` returns more than one page.
- Chunked video upload for videos that exceed the 1-hour signed URL window.
- IG Stories / TikTok photo posts and the post-type picker UI discussed during brainstorming.
- Radix Tooltip primitive — revisit only if a second tooltip consumer shows up.
