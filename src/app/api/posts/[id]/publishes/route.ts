import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Lightweight feed for the post detail Activity panel — returns publish
// records (with analytics) and the scraped Facebook origin snapshot. Used
// for client-side polling while a publish is PROCESSING.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const post = await prisma.post.findFirst({
    where: { id, userId: session.user.id },
    select: {
      id: true,
      publishes: { orderBy: { createdAt: "desc" }, include: { analytics: true } },
      analytics: { where: { platform: "FACEBOOK" }, take: 1 },
      fbComments: { orderBy: { scrapedAt: "desc" } },
    },
  });

  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({
    publishes: post.publishes,
    analytics: post.analytics,
    fbComments: post.fbComments,
  });
}
