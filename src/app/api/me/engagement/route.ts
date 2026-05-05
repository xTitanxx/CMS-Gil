import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getLikedPostIds } from "@/lib/engagement/like";
import { getBookmarkedPostIds } from "@/lib/engagement/bookmark";

const MAX_IDS = 100;

/**
 * GET /api/me/engagement?postIds=a,b,c
 *
 * Returns the current subscriber's liked + bookmarked post IDs from the
 * given set, used by the feed/post-detail to render filled-in icons.
 *
 * Anonymous gets `{ liked: [], bookmarked: [] }` with status 200 (not 401)
 * — UI-only enrichment, avoids per-page-load console noise.
 */
export async function GET(req: NextRequest) {
  const idsParam = req.nextUrl.searchParams.get("postIds") ?? "";
  const postIds = idsParam
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_IDS);

  const session = await auth();
  const subscriberId = session?.user?.subscriberId;
  const role = session?.user?.role;

  if (role !== "subscriber" || !subscriberId || postIds.length === 0) {
    return NextResponse.json({ liked: [], bookmarked: [] });
  }

  const [liked, bookmarked] = await Promise.all([
    getLikedPostIds(subscriberId, postIds),
    getBookmarkedPostIds(subscriberId, postIds),
  ]);

  return NextResponse.json({ liked, bookmarked });
}
