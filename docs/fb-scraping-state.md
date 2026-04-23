# Facebook Analytics Scraping — State & Reference

## Status
- **Phase 1 (URL collection)**: 481 URLs saved to `/tmp/fb-scraped-urls.json`. Coverage: posts from ~April 2026 back past **October 2025** (515 URLs). More older posts remain. Year filter exists on FB profiles but doesn't work from secondary account.
- **Phase 2 (post detail scraping)**: 93 of 515 URLs visited with engagement data. 427 URLs remaining in `/tmp/fb-phase2-queue.json`. Visited tracker: `/tmp/fb-visited-urls.json`.
- **Phase 2 workflow**: Read queue → scrape batch of 5 → update visited → repeat. No DB import during scraping (matching needs fixing). Bulk import after all scraped.
- **DB import**: 15 posts matched and imported to local DB. Matching needs improvement (longer text, encoding handling).
- **Last session**: 2026-04-22
- **Next session**: Continue Phase 1 scrolling further back (start by fast-scrolling past known posts). Then Phase 2 on remaining 347 URLs. Check what date the last post reached to track progress.

## Profile Info
- Profile URL: `https://www.facebook.com/gil.alter.7`
- All posts are public
- Use a **secondary Facebook account** (Red Phant) — never use Gil's real account
- User logs in manually, then Claude drives the automation

## Scraping Technique

### Phase 1: Collect Post URLs from Timeline
```js
// Initialize accumulator
await page.evaluate(() => { window.__scrapedPosts = new Set(); });

// Scroll with mouse wheel (natural behavior)
const scrollSteps = 2 + Math.floor(Math.random() * 5);
for (let s = 0; s < scrollSteps; s++) {
  await page.mouse.wheel(0, 100 + Math.random() * 280);
  await page.waitForTimeout(150 + Math.random() * 500);
}

// Collect URLs after each scroll
await page.evaluate(() => {
  const links = document.querySelectorAll('a[href*="/posts/pfbid"]');
  for (const l of links) window.__scrapedPosts.add(l.href.split('?')[0]);
  return window.__scrapedPosts.size;
});
```

**Key details:**
- Facebook uses virtual scrolling — old posts leave the DOM as you scroll
- Must accumulate URLs in `window.__scrapedPosts` Set across scrolls
- Random delays: 2-7 seconds between scroll bursts
- Occasional scroll back up (human-like)
- Occasional longer pauses (6-15 seconds, simulates reading)
- **SAVE URLs to file periodically** — browser can crash after long scrolling

### Phase 2: Extract Data from Each Post

Navigate to each post permalink and extract:

```js
const postData = await page.evaluate(() => {
  const post = {};
  
  // 1. BODY: Match page title to find correct text block
  const tm = document.title.match(/Gil Alter - (.+?)(?:\.\.\.)? \| Facebook/);
  if (tm) {
    const fl = tm[1];
    for (const d of document.querySelectorAll('div[dir="auto"]')) {
      if (d.innerText.trim().startsWith(fl)) {
        let c = d, bt = d.innerText.trim();
        for (let i = 0; i < 5; i++) {
          c = c.parentElement;
          if (!c) break;
          const t = c.innerText.trim();
          if (t.length > bt.length && t.length < 3000 && t.startsWith(fl)) bt = t;
        }
        post.body = bt;
        break;
      }
    }
  }
  
  // 2. ENGAGEMENT: Max "Like" button = post reactions, siblings = comments/shares
  let mb = null, mv = 0;
  for (const b of document.querySelectorAll('[aria-label="Like"][role="button"]')) {
    const v = parseInt(b.textContent.trim());
    if (!isNaN(v) && v > mv) { mv = v; mb = b; }
  }
  if (mb && mv > 0) {
    post.reactions = mv;
    const siblings = mb.parentElement?.parentElement?.children;
    if (siblings) {
      const nums = Array.from(siblings).map(s => parseInt(s.textContent.trim())).filter(n => !isNaN(n));
      // Order: reactions, comments, shares
      if (nums[1] !== undefined) post.commentCount = nums[1];
      if (nums[2] !== undefined) post.shares = nums[2];
    }
  }
  
  // 3. COMMENTS: From article elements with "Comment by" aria-label
  const comments = [], seen = new Set();
  for (const a of document.querySelectorAll('[role="article"]')) {
    const l = a.getAttribute('aria-label') || '';
    if (l.startsWith('Comment by') || l.startsWith('Reply by')) {
      const td = a.querySelector('div[dir="auto"]');
      const am = l.match(/(?:Comment|Reply) by (.+?)(?:\s+\d|\s+to)/);
      if (td) {
        const key = (am?.[1]||'') + '|' + td.innerText.trim().substring(0,100);
        if (!seen.has(key)) {
          seen.add(key);
          comments.push({
            author: am ? am[1] : 'Unknown',
            text: td.innerText.trim().substring(0, 500),
            isReply: l.startsWith('Reply')
          });
        }
      }
    }
  }
  post.comments = comments;
  return post;
});
```

**Key selector details (discovered through trial and error):**
- Body text: DON'T use "longest dir=auto" — it grabs comments. Use page title to find the correct block.
- Reactions: `[aria-label="Like"][role="button"]` — take MAX value (comment reactions are smaller)
- The engagement bar siblings are: [reactions, comments, shares] in order
- Comments: `role="article"` with `aria-label="Comment by..."` — Facebook renders comments twice, so deduplicate by author+text
- Photo/video posts have no body text in the title — ~50% of posts

### DB Matching Strategy

```js
// Normalize and search by first 40 chars of body text
const searchText = post.body.substring(0, 40).toLowerCase();
const dbPosts = await prisma.post.findMany({
  where: { bodyNormalized: { contains: searchText } },
  select: { id: true, platformUrl: true }
});
```

**Current limitations:**
- Only matches posts WITH body text (~50% of posts)
- Photo/video-only posts need matching by other means (date, platformUrl redirect resolution)
- Smart quotes and encoding differences can prevent matches
- Should use longer search text (40 chars truncation loses uniqueness)

### Safety Measures
- Secondary account only
- Random delays: 4-13 seconds between post navigations
- Mouse wheel scrolling (not window.scrollBy jumps)
- Occasional scroll-back-up behavior
- Occasional long pauses (reading simulation)
- Read-only — never click like/comment/share
- Stop on any CAPTCHA
- Batch sizes of 5-15 posts per run

## Files

| File | Purpose |
|------|---------|
| `/tmp/fb-scraped-urls.json` | 134 post permalink URLs from Phase 1 |
| `/tmp/fb-scraped-posts.json` | Scraped post data (body, reactions, comments) — partially populated |
| `prisma/schema.prisma` | FacebookComment model added |
| `src/app/admin/posts/[id]/page.tsx` | Analytics panel on post detail |
| `src/app/admin/posts/PostsList.tsx` | Engagement badge on posts list |
| `src/app/admin/posts/PostFilterUI.tsx` | Enriched filter dropdown |
| `src/lib/posts-query.ts` | Enriched filter query logic |
| `src/lib/prisma.ts` | SSL disabled for localhost |

## DB Schema

```prisma
model FacebookComment {
  id         String   @id @default(cuid())
  postId     String
  post       Post     @relation(fields: [postId], references: [id], onDelete: Cascade)
  authorName String
  body       String
  scrapedAt  DateTime @default(now())
  @@index([postId])
}
```

Uses existing `PostAnalytics` model with `platform: FACEBOOK` for reactions/comments/shares.

## Local Dev DB
- `postgresql://eitan@localhost:5432/cms_gil_dev`
- Start with: `brew services start postgresql@16`
- `.env.local` has `DATABASE_URL=postgresql://eitan@localhost:5432/cms_gil_dev`

## Next Steps
1. Re-run Phase 1 to collect more URLs (we saw 319 before crash, only saved 134)
2. Run Phase 2 on new URLs
3. Improve matching: resolve `platformUrl` redirects, use longer text, handle encoding
4. Push analytics data to production Supabase
5. Deploy to Vercel
