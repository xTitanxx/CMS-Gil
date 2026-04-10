# Spec: Silent video detection

## Goal

Detect videos that have no audio track, mark affected posts in the database, and let the user filter them out of the posts list. Useful for surfacing posts that were published without sound (e.g. a video accidentally recorded muted, or a Facebook-stripped reel).

## Branch

`feature/silent-video-detection`

## Background

The post detail page appears to "know" when a video has no audio because the browser's native `<video>` controls auto-disable the volume slider on silent tracks. The application itself has zero audio-related code (confirmed via grep — no `audio`, `muted`, `volume` references in `src/`). This knowledge lives only in the browser at playback time, not in the database, so there is currently no way to query or filter on it.

Cloudinary already has this information server-side: when you request a video resource with metadata, the response includes an `audio` object (codec, frequency, channels, bit rate). Missing or empty `audio` → no audio track.

## Data model

Add one field to `prisma/schema.prisma`:

```prisma
model Media {
  // ... existing fields
  hasAudio    Boolean?   // null = not yet checked; false = silent; true = has audio
  // ...
}
```

`hasAudio` is nullable so that "unchecked" is distinct from "checked and silent." It is only meaningful for video mimeTypes. Image `Media` rows stay `null` forever.

Run `npx prisma migrate dev --name add_media_has_audio`.

**Post-level "silent" definition** (derived, not stored): a post is considered silent when it has at least one video `Media` row AND every video `Media` row on the post has `hasAudio = false`. A post containing one silent clip and one clip with audio is **not** silent — the common case for flagging is "I posted a video and forgot it was muted," which matches the all-silent rule.

## Detection mechanism

Use Cloudinary's resource API with metadata enabled:

```ts
import { v2 as cloudinary } from "cloudinary";

async function checkAudio(publicId: string): Promise<boolean> {
  const resource = await cloudinary.api.resource(publicId, {
    resource_type: "video",
    media_metadata: true,
  });
  return !!resource.audio && Object.keys(resource.audio).length > 0;
}
```

The `publicId` derivation must match the rest of the codebase — strip the file extension before calling Cloudinary (same gotcha documented in `CLAUDE.md` under "Cloudinary"). The `storageKey` stored in the DB includes the extension; the Cloudinary API does not want it.

## Backfill — `scripts/backfill-audio.ts`

A one-off Node script that walks every unchecked video `Media` row and populates `hasAudio`.

```ts
// scripts/backfill-audio.ts
import { PrismaClient } from "@prisma/client";
import { v2 as cloudinary } from "cloudinary";
import pLimit from "p-limit"; // or write a tiny manual limiter if you want zero deps

const prisma = new PrismaClient();
const limit = pLimit(5); // Cloudinary admin API is rate-limited — 5 parallel is polite

async function main() {
  const rows = await prisma.media.findMany({
    where: {
      mimeType: { startsWith: "video/" },
      hasAudio: null,
    },
    select: { id: true, storageKey: true },
  });

  console.log(`Checking ${rows.length} videos...`);
  let done = 0;

  await Promise.all(
    rows.map((row) =>
      limit(async () => {
        try {
          const publicId = stripExtension(row.storageKey);
          const res = await cloudinary.api.resource(publicId, {
            resource_type: "video",
            media_metadata: true,
          });
          const hasAudio = !!res.audio && Object.keys(res.audio).length > 0;
          await prisma.media.update({
            where: { id: row.id },
            data: { hasAudio },
          });
        } catch (err) {
          console.error(`Failed on ${row.id}:`, err);
        }
        done++;
        if (done % 50 === 0) console.log(`  ${done}/${rows.length}`);
      })
    )
  );

  console.log(`Done. ${done}/${rows.length} processed.`);
  await prisma.$disconnect();
}

function stripExtension(key: string): string {
  return key.replace(/\.[^/.]+$/, "");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Run with:

```bash
npx tsx scripts/backfill-audio.ts
```

The script is **resumable by design**: the `hasAudio IS NULL` filter means rerunning it only processes rows that weren't successfully updated last time. Failed rows keep `hasAudio = null` and get retried on the next run.

**Before running against the full table**, do a dry run against ~20 rows to spot-check results. Facebook exports sometimes contain reels and shares that were already stripped of audio by Facebook itself, so expect a nonzero percentage of silent videos even in a "healthy" library.

## Going-forward — automatic on import

Wherever the import pipeline uploads videos to Cloudinary today, the upload response already contains the same `audio` metadata without needing a second API call. Extract `hasAudio` at upload time and write it to the `Media` row that gets created.

Grep for `cloudinary.uploader.upload` or similar and add the extraction inline. Don't forget manual uploads if those exist separately.

## UI changes

### Filter on posts list

Add a "Hide silent videos" control to the posts list header (client component). Stored in URL as `?silent=false` (default: show all). Three states could be supported eventually (all / silent-only / audible-only) but start with a simple "hide silent" toggle to keep scope small.

The Prisma `where` clause for "hide silent" posts is:

```ts
where: {
  // a post is NOT silent if: it has no videos, OR at least one video has hasAudio = true
  OR: [
    { media: { none: { mimeType: { startsWith: "video/" } } } },
    { media: { some: { mimeType: { startsWith: "video/" }, hasAudio: true } } },
  ],
}
```

### Badge on post cards

When a post qualifies as silent (has videos, all silent), render a small muted-speaker icon (`VolumeX` from `lucide-react`) in a corner of the post card and on the detail page near the media player. Subtle — think "read receipt" not "alert badge." A tooltip on hover: "No audio".

To avoid re-computing per card, have the API return a derived `isSilent: boolean` on each post (computed server-side with the rule above, using an aggregate query or an included `media: { select: { hasAudio: true, mimeType: true } }` field).

## Test plan

- [ ] Migration applies cleanly: `npx prisma migrate dev`
- [ ] Backfill script runs against 20 rows in dev without errors
- [ ] Spot-check 5 known silent videos — all get `hasAudio = false`
- [ ] Spot-check 5 known audible videos — all get `hasAudio = true`
- [ ] Import a new video and confirm `hasAudio` is populated on creation
- [ ] Filter "hide silent" on `/posts` hides the expected rows
- [ ] Silent badge appears on the right post cards
- [ ] Badge also appears on the post detail page
- [ ] Image-only posts are never flagged as silent
- [ ] Mixed-media posts (one audible video + one silent) are NOT flagged as silent
- [ ] `npm run build` and `npm test` pass

## Out of scope

- Re-encoding or fixing silent videos
- Notifying the user at import time "this video has no audio"
- A three-state filter (all / silent-only / audible-only) — start with a simple toggle
