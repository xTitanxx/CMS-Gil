import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  type CommentStatus,
  listCommentsForModeration,
} from "@/lib/engagement/comments";

function isStatus(s: string | null): s is CommentStatus {
  return s === "PUBLISHED" || s === "HIDDEN";
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const statusParam = req.nextUrl.searchParams.get("status");
  const cursor = req.nextUrl.searchParams.get("cursor");
  const status = isStatus(statusParam) ? statusParam : undefined;

  const result = await listCommentsForModeration({ status, cursor });
  return NextResponse.json(result);
}
