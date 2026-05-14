import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { findNextOpenSlot } from "@/lib/planner/find-next-slot";
import { getEligiblePlatforms } from "@/lib/planner/platform-assignment";
import { getConnectedPlatforms } from "@/lib/connected-platforms";

/**
 * Returns the next open planner slot. If `postId` is provided, also returns
 * the eligible publish platforms for that post (filtered by media type ∩
 * connected accounts). Used by the post detail page's schedule panel.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const url = new URL(req.url);
  const postId = url.searchParams.get("postId");

  const slot = await findNextOpenSlot(userId);
  if (!slot) {
    return NextResponse.json({
      slot: null,
      platforms: [],
      error: "No open slots in the next 8 weeks",
    });
  }

  let platforms: string[] = [];
  if (postId) {
    const post = await prisma.post.findFirst({
      where: { id: postId, userId },
      select: { media: { select: { mimeType: true } } },
    });
    if (post) {
      const connected = await getConnectedPlatforms(userId);
      platforms = getEligiblePlatforms(
        post.media.map((m) => m.mimeType),
        connected,
      );
    }
  }

  return NextResponse.json({
    slot: { day: slot.dayKey, hour: slot.hour },
    platforms,
  });
}
