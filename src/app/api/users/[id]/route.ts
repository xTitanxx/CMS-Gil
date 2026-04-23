import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  if (id === session.user.id)
    return NextResponse.json(
      { error: "Cannot delete yourself" },
      { status: 400 }
    );

  await prisma.user.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const { password, name } = body as { password?: string; name?: string };

  const data: { passwordHash?: string; name?: string } = {};
  if (password) data.passwordHash = await bcrypt.hash(password, 12);
  if (name !== undefined) data.name = name;

  if (Object.keys(data).length === 0)
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  const user = await prisma.user.update({ where: { id }, data });
  return NextResponse.json({ id: user.id, email: user.email, name: user.name });
}
