import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildPostsQuery, parsePostsFilters } from "@/lib/posts-query";
import type { Prisma } from "@prisma/client";

const REASONS = [
  "silent-video",
  "unchecked-audio",
  "empty",
  "share-only",
  "broken-media",
  "missing-media",
  "dont-post",
  "skipped-in-suggester",
];

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }
  const userId = session.user.id;

  const { searchParams } = new URL(req.url);
  const filters = parsePostsFilters(searchParams);

  const notReadyBase: Prisma.PostWhereInput[] = [{ readiness: "NOT_READY" }];
  const { where: baseWhere } = buildPostsQuery(filters, userId, {
    extraWhere: notReadyBase,
  });

  const [total, ...reasonCounts] = await Promise.all([
    prisma.post.count({ where: baseWhere }),
    ...REASONS.map((r) => {
      const { where } = buildPostsQuery(filters, userId, {
        extraWhere: [...notReadyBase, { notReadyReasons: { has: r } }],
      });
      return prisma.post.count({ where });
    }),
  ]);

  const byReason: Record<string, number> = {};
  REASONS.forEach((r, i) => {
    byReason[r] = reasonCounts[i] ?? 0;
  });

  return NextResponse.json({ total, byReason });
}
