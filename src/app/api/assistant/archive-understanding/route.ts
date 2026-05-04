import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildUnderstanding, persistUnderstanding } from "@/lib/assistant/archive-understanding";

export const maxDuration = 300;

// GET — return the current understanding metadata (so the UI can show a
// "last refreshed" stamp and a rebuild button later).
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const row = await prisma.userArchiveUnderstanding.findUnique({
    where: { userId: session.user.id },
    select: { generatedAt: true, basedOnPostCount: true, updatedAt: true },
  });
  return NextResponse.json(row ?? null);
}

// POST — rebuild on demand. Used by the user explicitly ("rebuild your
// understanding") and as the bootstrap path before the first weekly cron.
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const started = Date.now();
  const result = await buildUnderstanding(session.user.id);
  await persistUnderstanding(session.user.id, result);
  return NextResponse.json({
    ok: true,
    basedOnPostCount: result.basedOnPostCount,
    sampleSize: result.sampleBodies.length,
    durationMs: Date.now() - started,
  });
}
