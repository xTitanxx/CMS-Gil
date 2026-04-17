import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
      passwordHash: false,
      accounts: { select: { provider: true } },
    },
    orderBy: { name: "asc" },
  });

  const result = users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    image: u.image,
    loginMethod: u.accounts.length > 0 ? u.accounts[0].provider : "credentials",
  }));

  return NextResponse.json(result);
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { email, name, password } = body as {
    email?: string;
    name?: string;
    password?: string;
  };

  if (!email || !password)
    return NextResponse.json(
      { error: "Email and password are required" },
      { status: 400 }
    );

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing)
    return NextResponse.json(
      { error: "A user with this email already exists" },
      { status: 409 }
    );

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.create({
    data: { email, name: name || null, passwordHash },
  });

  return NextResponse.json(
    { id: user.id, email: user.email, name: user.name },
    { status: 201 }
  );
}
