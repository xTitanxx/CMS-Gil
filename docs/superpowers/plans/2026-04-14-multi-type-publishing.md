# Multi-Type Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `postType` field (POST/REEL/STORY) to the Post model that drives content-type-aware publishing across all connected platforms.

**Architecture:** New `PostType` enum on the Post model replaces the current `fb:` tag-based classification. Platform publish functions receive `postType` and branch to the correct API endpoint (e.g. Facebook Reels endpoint, Instagram Stories endpoint). The UI adds a segmented control to the post editor for changing type, and the list/tabs read from the field instead of tags.

**Tech Stack:** Prisma 7 (migration + enum), Next.js API routes, Meta Graph API v21.0, Google YouTube Data API v3

---

### Task 1: Schema Migration — Add PostType Enum and Field

**Files:**
- Modify: `prisma/schema.prisma:63-97`
- Create: `prisma/migrations/<timestamp>_add_post_type/migration.sql`

- [ ] **Step 1: Add the enum and field to the schema**

In `prisma/schema.prisma`, add the enum after the existing `PostSource` enum (line ~101):

```prisma
enum PostType {
  POST
  REEL
  STORY
}
```

Add the field to the `Post` model (after `tags` at line ~89):

```prisma
  postType   PostType  @default(POST)
```

- [ ] **Step 2: Generate and run the migration**

Run: `npx prisma migrate dev --name add_post_type`

Expected: Migration creates the enum and adds the column with default `POST`.

- [ ] **Step 3: Verify the migration**

Run: `npx prisma generate`

Expected: Prisma client regenerated with `PostType` enum available.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add PostType enum and postType field to Post model"
```

---

### Task 2: Backfill Script — Migrate fb: Tags to postType Field

**Files:**
- Create: `scripts/backfill-post-type.ts`

- [ ] **Step 1: Write the backfill script**

Create `scripts/backfill-post-type.ts`:

```typescript
/**
 * Backfills Post.postType from fb: tags and removes the fb: tags.
 *
 * Usage:
 *   node --env-file=.env.local node_modules/.bin/tsx scripts/backfill-post-type.ts
 */
import { prisma } from "../src/lib/prisma";

async function main() {
  // 1. Backfill postType from fb: tags
  const reels = await prisma.post.updateMany({
    where: { tags: { has: "fb:reel" } },
    data: { postType: "REEL" },
  });
  console.log("Set REEL:", reels.count);

  const stories = await prisma.post.updateMany({
    where: { tags: { has: "fb:story" } },
    data: { postType: "STORY" },
  });
  console.log("Set STORY:", stories.count);

  // POST is already the default — no update needed for fb:post

  // 2. Remove fb: tags from all posts
  const postsWithFbTags = await prisma.post.findMany({
    where: {
      tags: { hasSome: ["fb:post", "fb:reel", "fb:story"] },
    },
    select: { id: true, tags: true },
  });

  console.log("Posts with fb: tags to clean:", postsWithFbTags.length);

  const PARALLEL = 20;
  for (let i = 0; i < postsWithFbTags.length; i += PARALLEL) {
    const batch = postsWithFbTags.slice(i, i + PARALLEL);
    await Promise.all(
      batch.map((p) =>
        prisma.post.update({
          where: { id: p.id },
          data: {
            tags: p.tags.filter((t) => !t.startsWith("fb:")),
          },
        })
      )
    );
  }

  console.log("Cleaned fb: tags from all posts");

  // 3. Verify
  const counts = await Promise.all([
    prisma.post.count({ where: { postType: "POST" } }),
    prisma.post.count({ where: { postType: "REEL" } }),
    prisma.post.count({ where: { postType: "STORY" } }),
    prisma.post.count({ where: { tags: { hasSome: ["fb:post", "fb:reel", "fb:story"] } } }),
  ]);
  console.log("Final: POST:", counts[0], "| REEL:", counts[1], "| STORY:", counts[2]);
  console.log("Remaining fb: tags:", counts[3], "(should be 0)");

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Run the backfill**

Run: `node --env-file=.env.local node_modules/.bin/tsx scripts/backfill-post-type.ts`

Expected output:
```
Set REEL: 36
Set STORY: 487
Posts with fb: tags to clean: ~1839
Cleaned fb: tags from all posts
Final: POST: 1316 | REEL: 36 | STORY: 487
Remaining fb: tags: 0 (should be 0)
```

- [ ] **Step 3: Commit**

```bash
git add scripts/backfill-post-type.ts
git commit -m "feat: backfill postType from fb: tags and clean up"
```

---

### Task 3: API — Accept postType in PATCH and Filter by postType in GET

**Files:**
- Modify: `src/app/api/posts/[id]/route.ts:37-67` (PATCH handler)
- Modify: `src/app/api/posts/route.ts:115-140` (GET handler — kindCounts)
- Modify: `src/lib/posts-query.ts:212-216` (kind filter)

- [ ] **Step 1: Update PATCH to accept postType**

In `src/app/api/posts/[id]/route.ts`, add postType handling to the PATCH data object (after the tags block, ~line 58):

```typescript
      ...(body.postType !== undefined &&
        ["POST", "REEL", "STORY"].includes(body.postType)
        ? { postType: body.postType }
        : {}),
```

- [ ] **Step 2: Update posts-query.ts kind filter to use postType**

In `src/lib/posts-query.ts`, replace the kind filter block (~lines 212-216):

```typescript
  if (filters.kind === "stories") {
    extraAnds.push({ postType: "STORY" });
  } else if (filters.kind === "posts") {
    extraAnds.push({ postType: { not: "STORY" } });
  }
```

- [ ] **Step 3: Update GET /api/posts kindCounts to use postType**

In `src/app/api/posts/route.ts`, replace the storiesCount query (~line 126):

```typescript
    prisma.post.count({ where: { userId, postType: "STORY" } }),
  ]);
  const postsCount = await prisma.post.count({ where: { userId } }) - storiesCount;
```

(This replaces the current `tags: { has: "fb:story" }` query.)

- [ ] **Step 4: Verify type-check passes**

Run: `npx tsc --noEmit 2>&1 | grep -E "posts-query|route" | head -10`

Expected: No errors in the modified files.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/posts/[id]/route.ts src/app/api/posts/route.ts src/lib/posts-query.ts
git commit -m "feat: filter and update posts by postType field instead of fb: tags"
```

---

### Task 4: UI — Post List Badge and Tags Cleanup

**Files:**
- Modify: `src/app/admin/posts/PostsList.tsx:1062-1096`

- [ ] **Step 1: Update badge to read postType instead of fb: tags**

In `src/app/admin/posts/PostsList.tsx`, replace the badge rendering block (~lines 1062-1063):

From:
```tsx
const fbVariant = post.tags.find((t) => t.startsWith("fb:"));
const label = `${post.source}${fbVariant ? ` ${fbVariant.replace("fb:", "").toUpperCase()}` : ""}`;
```

To:
```tsx
const typeLabel = post.postType && post.postType !== "POST" ? ` ${post.postType}` : "";
const label = `${post.source}${typeLabel}`;
```

- [ ] **Step 2: Remove fb: tag filtering from visible tags**

In the same file (~line 1096), replace:
```tsx
{(() => { const visibleTags = post.tags.filter((t) => !t.startsWith("fb:")); return visibleTags.length > 0 ? (
```

With:
```tsx
{(() => { const visibleTags = post.tags; return visibleTags.length > 0 ? (
```

(No more fb: tags to filter out since they were removed in the backfill.)

- [ ] **Step 3: Ensure the Post interface includes postType**

Find the Post interface/type in PostsList.tsx and add `postType: string;` if not already present. The API already returns all Post fields.

- [ ] **Step 4: Verify type-check passes**

Run: `npx tsc --noEmit 2>&1 | grep "PostsList" | head -5`

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/posts/PostsList.tsx
git commit -m "feat: post list badge reads postType field instead of fb: tags"
```

---

### Task 5: UI — PostType Selector in Post Editor

**Files:**
- Modify: `src/app/admin/posts/[id]/PostEditor.tsx:38-46,67-79`
- Modify: `src/app/admin/posts/[id]/page.tsx:145-153`

- [ ] **Step 1: Add postType prop and state to PostEditor**

In `src/app/admin/posts/[id]/PostEditor.tsx`, add to the props interface (~line 38):

```typescript
interface PostEditorProps {
  postId: string;
  initialBody: string;
  initialOriginalDate: Date;
  initialTags: string[];
  initialMedia: MediaItem[];
  initialPostType: string;
  source: string;
  platformUrl: string | null;
}
```

Add to the component function params and state (~line 76):

```typescript
export function PostEditor({
  postId,
  initialBody,
  initialOriginalDate,
  initialTags,
  initialMedia,
  initialPostType,
  source,
  platformUrl,
}: PostEditorProps) {
  const [body, setBody] = useState(initialBody);
  const [date, setDate] = useState(() => toDatetimeLocal(new Date(initialOriginalDate)));
  const [tags, setTags] = useState<string[]>(initialTags);
  const [postType, setPostType] = useState(initialPostType);
  const [media, setMedia] = useState<MediaItem[]>(initialMedia);
```

- [ ] **Step 2: Add the postType segmented control to the editor UI**

Add this segmented control near the top of the editor's return JSX, after the source badge and before the body textarea. Find the appropriate location in the JSX and add:

```tsx
{/* Post type selector */}
<div className="flex items-center gap-2">
  <span className="text-xs font-medium text-gray-500">Type</span>
  <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5">
    {(["POST", "REEL", "STORY"] as const).map((t) => (
      <button
        key={t}
        type="button"
        onClick={async () => {
          setPostType(t);
          await fetch(`/api/posts/${postId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ postType: t }),
          });
        }}
        className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
          postType === t
            ? "bg-white text-gray-900 shadow-sm"
            : "text-gray-500 hover:text-gray-700"
        }`}
      >
        {t === "POST" ? "Post" : t === "REEL" ? "Reel" : "Story"}
      </button>
    ))}
  </div>
</div>
```

- [ ] **Step 3: Pass initialPostType from the page**

In `src/app/admin/posts/[id]/page.tsx`, add the prop to the PostEditor call (~line 145):

```tsx
<PostEditor
  postId={id}
  initialBody={displayBody(post.body)}
  initialOriginalDate={post.originalDate}
  initialTags={post.tags}
  initialMedia={mediaWithUrls}
  initialPostType={post.postType}
  source={post.source}
  platformUrl={post.platformUrl}
/>
```

- [ ] **Step 4: Verify type-check passes**

Run: `npx tsc --noEmit 2>&1 | grep -E "PostEditor|page" | head -5`

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/posts/[id]/PostEditor.tsx src/app/admin/posts/[id]/page.tsx
git commit -m "feat: add postType selector to post editor"
```

---

### Task 6: Publish Logic — Pass postType to Platform Functions

**Files:**
- Modify: `src/app/api/posts/[id]/publish/route.ts:70-168`
- Modify: `src/app/api/cron/publish/route.ts:31-38`

- [ ] **Step 1: Update publishNow signature to accept postType**

In `src/app/api/posts/[id]/publish/route.ts`, update the function signature (~line 70):

```typescript
export async function publishNow(
  recordId: string,
  userId: string,
  post: {
    id: string;
    body: string;
    postType: string;
    media: { storageKey: string; mimeType: string }[];
  },
  platform: Platform
) {
```

- [ ] **Step 2: Pass postType to platform functions in the switch statement**

Update each case in the switch (~lines 111-146):

```typescript
    switch (platform) {
      case "INSTAGRAM":
        result = await postToInstagram(
          { accessToken, platformUserId: platformUserId! },
          post.body,
          mediaKeys,
          post.postType
        );
        break;
      case "LINKEDIN":
        result = await postToLinkedIn(
          { accessToken, platformUserId: platformUserId! },
          post.body,
          mediaKeys
        );
        break;
      case "YOUTUBE":
        result = await postToYouTube(
          { accessToken, refreshToken },
          post.body.slice(0, 100),
          post.body,
          mediaKeys
        );
        break;
      case "TIKTOK":
        result = await postToTikTok({ accessToken }, post.body, mediaKeys);
        break;
      case "FACEBOOK_PAGE":
        result = await postToFacebook(
          { accessToken, platformUserId: platformUserId! },
          post.body,
          mediaKeys,
          post.postType
        );
        break;
      default:
        throw new Error(`Publishing to ${platform} is not supported`);
    }
```

Note: only Instagram and Facebook receive `postType` since they're the only ones with type-specific endpoints. TikTok, YouTube, and LinkedIn ignore it.

- [ ] **Step 3: Ensure POST handler includes postType in the post query**

In the same file, verify the post query at ~line 32 already includes `postType` (it does via `findFirst` without `select`, so all fields are returned). No change needed.

- [ ] **Step 4: Update cron job to pass the full post object**

In `src/app/api/cron/publish/route.ts`, the post is already included via `include: { post: { include: { media: true } } }` at line 22, which returns all fields including `postType`. No change needed — the `publishNow` call at line 33 already passes `record.post`.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/posts/[id]/publish/route.ts
git commit -m "feat: pass postType to platform publish functions"
```

---

### Task 7: Instagram — Support POST, REEL, and STORY Types

**Files:**
- Modify: `src/lib/platforms/instagram.ts:17-60`

- [ ] **Step 1: Update function signature**

In `src/lib/platforms/instagram.ts`, update the function signature (~line 17):

```typescript
export async function postToInstagram(
  creds: InstagramCredentials,
  body: string,
  mediaKeys: string[],
  postType: string = "POST"
): Promise<PublishResult> {
```

- [ ] **Step 2: Add STORY support for single media**

Replace the single-media block (~lines 30-60) with type-aware logic:

```typescript
  if (mediaKeys.length === 1) {
    const mediaUrl = await getSignedDownloadUrl(mediaKeys[0], 3600);
    const isVideo = mediaKeys[0].match(/\.(mp4|mov|avi|webm)$/i);

    // Determine media_type based on postType
    let mediaType: string | undefined;
    if (postType === "STORY") {
      mediaType = "STORIES";
    } else if (postType === "REEL" || (postType === "POST" && isVideo)) {
      // POST + video still goes as REELS on Instagram (their default behavior)
      mediaType = "REELS";
    }
    // POST + image: no media_type needed (default IMAGE behavior)

    const containerRes = await fetch(
      `${baseUrl}/${platformUserId}/media`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          [isVideo ? "video_url" : "image_url"]: mediaUrl,
          caption: body,
          access_token: accessToken,
          ...(mediaType ? { media_type: mediaType } : {}),
        }),
      }
    );

    const container = await containerRes.json();
    if (!container.id) {
      throw new Error(`Instagram container error: ${JSON.stringify(container)}`);
    }

    // Poll until container is ready (for videos and stories)
    if (isVideo || postType === "STORY") {
      await waitForContainer(baseUrl, container.id, accessToken);
    }

    return publishContainer(baseUrl, platformUserId, container.id, accessToken);
  }
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/platforms/instagram.ts
git commit -m "feat: Instagram publish supports POST, REEL, and STORY types"
```

---

### Task 8: Facebook — Support REEL and STORY Types

**Files:**
- Modify: `src/lib/platforms/facebook.ts:21-66`

- [ ] **Step 1: Update function signature**

In `src/lib/platforms/facebook.ts`, update the function signature (~line 21):

```typescript
export async function postToFacebook(
  creds: FacebookCredentials,
  body: string,
  mediaKeys: string[],
  postType: string = "POST"
): Promise<PublishResult> {
```

- [ ] **Step 2: Add reelPost and storyPost helper functions**

Add after the existing `videoPost` function (~after line 132):

```typescript
async function reelPost(
  pageId: string,
  accessToken: string,
  fields: { file_url: string; description: string }
): Promise<PublishResult> {
  // Step 1: Initialize the reel upload
  const initForm = new URLSearchParams({
    upload_phase: "start",
    access_token: accessToken,
  });
  const initRes = await fetch(`${GRAPH}/${pageId}/video_reels`, {
    method: "POST",
    body: initForm,
  });
  const initData = await initRes.json();
  if (!initRes.ok || !initData.video_id) {
    throw new Error(`Facebook reel init failed: ${JSON.stringify(initData)}`);
  }

  // Step 2: Upload the video binary
  const videoRes = await fetch(fields.file_url);
  const videoBuffer = await videoRes.arrayBuffer();
  const uploadRes = await fetch(
    `${GRAPH}/${initData.video_id}`,
    {
      method: "POST",
      headers: {
        Authorization: `OAuth ${accessToken}`,
        offset: "0",
        file_size: String(videoBuffer.byteLength),
        "Content-Type": "application/octet-stream",
      },
      body: videoBuffer,
    }
  );
  const uploadData = await uploadRes.json();
  if (!uploadRes.ok || !uploadData.success) {
    throw new Error(`Facebook reel upload failed: ${JSON.stringify(uploadData)}`);
  }

  // Step 3: Publish the reel
  const publishForm = new URLSearchParams({
    upload_phase: "finish",
    video_id: initData.video_id,
    title: fields.description.slice(0, 100),
    description: fields.description,
    access_token: accessToken,
  });
  const publishRes = await fetch(`${GRAPH}/${pageId}/video_reels`, {
    method: "POST",
    body: publishForm,
  });
  const publishData = await publishRes.json();
  if (!publishRes.ok || !publishData.success) {
    throw new Error(`Facebook reel publish failed: ${JSON.stringify(publishData)}`);
  }

  return {
    platformPostId: initData.video_id,
    platformUrl: await fetchPermalink(initData.video_id, accessToken),
  };
}

async function storyPost(
  pageId: string,
  accessToken: string,
  fields: { url: string; isVideo: boolean }
): Promise<PublishResult> {
  const endpoint = fields.isVideo
    ? `${GRAPH}/${pageId}/video_stories`
    : `${GRAPH}/${pageId}/photo_stories`;

  const form = new URLSearchParams({
    [fields.isVideo ? "file_url" : "url"]: fields.url,
    access_token: accessToken,
  });
  const res = await fetch(endpoint, { method: "POST", body: form });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(`Facebook story post failed: ${JSON.stringify(data)}`);
  }

  const postId = data.post_id ?? data.id;
  return {
    platformPostId: postId ?? "story",
    platformUrl: postId ? await fetchPermalink(postId, accessToken) : undefined,
  };
}
```

- [ ] **Step 3: Route to the correct function based on postType**

Replace the single-video block in the main function (~lines 40-43):

```typescript
  // Single video
  if (mediaKeys.length === 1 && VIDEO_RE.test(mediaKeys[0])) {
    const url = await getSignedDownloadUrl(mediaKeys[0], 3600);
    if (postType === "REEL") {
      return reelPost(pageId, accessToken, { file_url: url, description: body });
    }
    if (postType === "STORY") {
      return storyPost(pageId, accessToken, { url, isVideo: true });
    }
    return videoPost(pageId, accessToken, { file_url: url, description: body });
  }
```

And update the single-photo block (~lines 34-37):

```typescript
  // Single photo
  if (mediaKeys.length === 1 && !VIDEO_RE.test(mediaKeys[0])) {
    const url = await getSignedDownloadUrl(mediaKeys[0], 3600);
    if (postType === "STORY") {
      return storyPost(pageId, accessToken, { url, isVideo: false });
    }
    return photoPost(pageId, accessToken, { url, caption: body });
  }
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/platforms/facebook.ts
git commit -m "feat: Facebook publish supports REEL and STORY types"
```

---

### Task 9: YouTube — Auto-detect Shorts

**Files:**
- Modify: `src/lib/platforms/youtube.ts:18-68`

- [ ] **Step 1: Add Shorts detection and hashtag**

In `src/lib/platforms/youtube.ts`, update the `postToYouTube` function. After getting the video buffer (~line 42), add duration/dimension detection and modify the description:

```typescript
export async function postToYouTube(
  creds: YouTubeCredentials,
  title: string,
  body: string,
  mediaKeys: string[]
): Promise<PublishResult> {
  const videoKey = mediaKeys.find((k) =>
    k.match(/\.(mp4|mov|avi|webm|mkv)$/i)
  );
  if (!videoKey) {
    throw new Error("YouTube requires a video file");
  }

  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  auth.setCredentials({
    access_token: creds.accessToken,
    refresh_token: creds.refreshToken,
  });

  const youtube = google.youtube({ version: "v3", auth });

  const videoBuffer = await getObject(videoKey);
  const stream = Readable.from(videoBuffer);

  // Append #Shorts to description — YouTube auto-detects Shorts
  // from vertical aspect ratio + ≤60s duration. The hashtag is a
  // signal to YouTube's classifier but doesn't force it.
  const description = body.includes("#Shorts")
    ? truncate(body, 5000)
    : truncate(body + "\n\n#Shorts", 5000);

  const res = await youtube.videos.insert({
    part: ["snippet", "status"],
    requestBody: {
      snippet: {
        title: truncate(title || body.slice(0, 100), 100),
        description,
        categoryId: "22", // People & Blogs
      },
      status: {
        privacyStatus: "public",
      },
    },
    media: {
      mimeType: "video/*",
      body: stream,
    },
  });

  const videoId = res.data.id!;
  return {
    platformPostId: videoId,
    platformUrl: `https://www.youtube.com/watch?v=${videoId}`,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/platforms/youtube.ts
git commit -m "feat: YouTube uploads append #Shorts hashtag for short-form detection"
```

---

### Task 10: Integration Verification

**Files:**
- No new files — verification only

- [ ] **Step 1: Type-check the entire project**

Run: `npx tsc --noEmit`

Expected: No new errors from the changes (pre-existing test file errors are OK).

- [ ] **Step 2: Run existing tests**

Run: `npm test`

Expected: All facebook-parser tests pass. Pre-existing posts-query test failure is OK (unrelated audio filter test).

- [ ] **Step 3: Verify database state**

Run:
```bash
node --env-file=.env.local node_modules/.bin/tsx -e "
import { prisma } from './src/lib/prisma';
(async () => {
  const counts = await Promise.all([
    prisma.post.count({ where: { postType: 'POST' } }),
    prisma.post.count({ where: { postType: 'REEL' } }),
    prisma.post.count({ where: { postType: 'STORY' } }),
    prisma.post.count({ where: { tags: { hasSome: ['fb:post', 'fb:reel', 'fb:story'] } } }),
  ]);
  console.log('POST:', counts[0], '| REEL:', counts[1], '| STORY:', counts[2]);
  console.log('Remaining fb: tags:', counts[3], '(should be 0)');
  await prisma.\$disconnect();
})();
"
```

Expected:
```
POST: 1316 | REEL: 36 | STORY: 487
Remaining fb: tags: 0 (should be 0)
```

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: multi-type publishing — postType field drives content format per platform"
```
