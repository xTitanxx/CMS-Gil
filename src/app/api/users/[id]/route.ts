import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function requireAdmin() {
  const session = await auth();
  if (!session || session.user.role !== "admin") return null;
  return session;
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;

  // OWNER_USER_ID collapse means session.user.id is always OWNER_USER_ID for
  // admins. This blocks deleting the owner row from the admin UI; co-admin
  // rows have their own ids and can still be removed.
  if (id === session.user.id) {
    return NextResponse.json({ error: "Cannot delete yourself" }, { status: 400 });
  }

  await prisma.user.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();
  const { name } = body as { name?: string };

  // Only `name` is editable. Email is set on creation and matches OAuth.
  // Password is no longer supported (email/password sign-in was removed).
  if (name === undefined) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const user = await prisma.user.update({ where: { id }, data: { name } });
  return NextResponse.json({ id: user.id, email: user.email, name: user.name });
}
