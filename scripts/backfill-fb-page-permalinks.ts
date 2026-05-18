// Backfill FACEBOOK_PAGE PublishRecord rows whose platformUrl was never
// populated (or was stored as a Graph API path-only `/reel/.../` string)
// because the publisher called fetchPermalink with a bare numeric id and
// Graph rejected it with error #12. The fix updates both:
//   - platformPostId: rewrite to the composite "{pageId}_{numeric}" form so
//     future analytics + permalink lookups go through the supported endpoint.
//   - platformUrl: re-fetch via permalink_url against the composite id.

import { config } from "dotenv";
config({ path: ".env.local" });
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = process.env.POSTGRES_URL ?? process.env.POSTGRES_URL_NON_POOLING;
}
import { prisma } from "../src/lib/prisma";
import { decrypt } from "../src/lib/encrypt";

const GRAPH = "https://graph.facebook.com/v21.0";

function composite(pageId: string, postId: string): string {
  return postId.includes("_") ? postId : `${pageId}_${postId}`;
}

async function fetchPermalink(
  postId: string,
  accessToken: string
): Promise<string | undefined> {
  try {
    const res = await fetch(
      `${GRAPH}/${postId}?fields=permalink_url&access_token=${accessToken}`
    );
    if (!res.ok) return undefined;
    const data = await res.json();
    const raw =
      typeof data.permalink_url === "string" ? data.permalink_url : undefined;
    if (!raw) return undefined;
    return raw.startsWith("/") ? `https://www.facebook.com${raw}` : raw;
  } catch {
    return undefined;
  }
}

async function main() {
  const recs = await prisma.publishRecord.findMany({
    where: {
      platform: "FACEBOOK_PAGE",
      status: "PUBLISHED",
      platformPostId: { not: null },
      OR: [
        { platformUrl: null },
        { platformUrl: { startsWith: "/" } },
      ],
    },
    select: {
      id: true,
      platformPostId: true,
      platformUrl: true,
      post: { select: { userId: true } },
    },
  });
  console.log(`Found ${recs.length} FACEBOOK_PAGE rows missing a usable platformUrl.`);
  if (recs.length === 0) return;

  // Cache tokens by userId.
  const tokenByUser = new Map<string, { token: string; pageId: string }>();
  async function tokenFor(userId: string) {
    if (tokenByUser.has(userId)) return tokenByUser.get(userId)!;
    const t = await prisma.platformToken.findFirst({
      where: { userId, platform: "FACEBOOK_PAGE" },
      select: { accessToken: true, platformUserId: true },
    });
    if (!t || !t.platformUserId) {
      throw new Error(`No FACEBOOK_PAGE token for user ${userId}`);
    }
    const entry = { token: decrypt(t.accessToken), pageId: t.platformUserId };
    tokenByUser.set(userId, entry);
    return entry;
  }

  let fixed = 0;
  let skipped = 0;
  for (const r of recs) {
    if (!r.platformPostId) {
      skipped++;
      continue;
    }
    const { token, pageId } = await tokenFor(r.post.userId);
    const id = composite(pageId, r.platformPostId);
    const url = await fetchPermalink(id, token);
    if (!url) {
      console.log(`  [skip] ${r.id} (${r.platformPostId}) — Graph returned no permalink`);
      skipped++;
      continue;
    }
    await prisma.publishRecord.update({
      where: { id: r.id },
      data: { platformPostId: id, platformUrl: url },
    });
    console.log(`  [fixed] ${r.id} ${r.platformPostId} -> ${id} | ${url}`);
    fixed++;
  }
  console.log(`\nFixed ${fixed}, skipped ${skipped} of ${recs.length}.`);
}

main().finally(() => prisma.$disconnect());
