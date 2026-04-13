import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await prisma.$queryRaw<{ tag: string; count: bigint }[]>`
    SELECT unnest(tags) AS tag, COUNT(*) AS count
    FROM "Post"
    WHERE "userId" = ${session.user.id}
    GROUP BY tag
    ORDER BY count DESC
  `;

  return NextResponse.json(
    rows.map((r) => ({ tag: r.tag, count: Number(r.count) }))
  );
}
