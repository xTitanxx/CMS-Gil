import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Cancels a single scheduled (PENDING) PublishRecord. Owner-scoped so a
// subscriber session can't reach in and cancel admin work. Returns 400 if the
// record is in a state that can't be cancelled (already published/failed/etc.)
// so the caller can show a useful error instead of silently no-oping.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  const record = await prisma.publishRecord.findFirst({
    where: { id, post: { userId: session.user.id } },
    select: { id: true, status: true, postId: true },
  });
  if (!record) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // PENDING = before dispatch, safe to cancel. PROCESSING = a platform lambda
  // is already mid-upload; we flip the row anyway and publishNow's final write
  // is gated on status === PROCESSING, so a CANCELLED row won't get overwritten
  // back to PUBLISHED. The in-flight upload itself can't be aborted, but the
  // record of truth respects the user's intent.
  if (record.status !== "PENDING" && record.status !== "PROCESSING") {
    return NextResponse.json(
      { error: `Cannot cancel a ${record.status.toLowerCase()} record` },
      { status: 400 }
    );
  }

  await prisma.publishRecord.update({
    where: { id },
    data: { status: "CANCELLED" },
  });

  return NextResponse.json({ ok: true });
}
