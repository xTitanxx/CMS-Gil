import { NextResponse } from "next/server";
import * as fs from "node:fs/promises";
import { auth } from "@/lib/auth";
import { resolveTrashDir } from "@/lib/trash";

// DELETE — permanently purge a trash directory from disk.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ dir: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { dir } = await params;
  const full = resolveTrashDir(decodeURIComponent(dir));
  if (!full) {
    return NextResponse.json({ error: "Invalid dir name" }, { status: 400 });
  }

  try {
    await fs.rm(full, { recursive: true, force: true });
  } catch (e) {
    return NextResponse.json(
      { error: "Purge failed: " + String(e) },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true });
}
