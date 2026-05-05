import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function requireAdmin() {
  const session = await auth();
  if (!session || session.user.role !== "admin") return null;
  return session;
}

export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
      accounts: { select: { provider: true } },
    },
    orderBy: { name: "asc" },
  });

  const result = users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    image: u.image,
    loginMethod: u.accounts.length > 0 ? u.accounts[0].provider : "pending",
  }));

  return NextResponse.json(result);
}

// POST creates a placeholder User row that PrismaAdapter will link to on
// first Google sign-in (provided the email is also added to ADMIN_EMAILS).
// Email/password sign-in is no longer supported, so password is not accepted.
export async function POST(req: Request) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { email, name } = body as { email?: string; name?: string };

  if (!email) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json(
      { error: "A user with this email already exists" },
      { status: 409 }
    );
  }

  const user = await prisma.user.create({
    data: { email, name: name || null },
  });

  return NextResponse.json(
    { id: user.id, email: user.email, name: user.name },
    { status: 201 }
  );
}
