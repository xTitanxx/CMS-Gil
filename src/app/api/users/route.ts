import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function requireAdmin() {
  const session = await auth();
  if (!session || session.user.role !== "admin") return null;
  return session;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
      isAdmin: true,
      accounts: { select: { provider: true } },
    },
    orderBy: { name: "asc" },
  });

  const result = users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    image: u.image,
    isAdmin: u.isAdmin,
    loginMethod: u.accounts.length > 0 ? u.accounts[0].provider : "pending",
  }));

  return NextResponse.json(result);
}

// POST creates a User row marked isAdmin: true. On first Google sign-in for
// that email, NextAuth's Account row is linked via allowDangerousEmailAccountLinking
// (safe because the signIn callback gates by the same allowlist). The email
// must be a Google account that the new admin controls — there's no password
// flow anymore.
export async function POST(req: Request) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { email, name } = body as { email?: string; name?: string };

  const trimmed = email?.trim().toLowerCase();
  if (!trimmed || !EMAIL_RE.test(trimmed)) {
    return NextResponse.json(
      { error: "Valid email is required" },
      { status: 400 }
    );
  }

  const existing = await prisma.user.findUnique({ where: { email: trimmed } });
  if (existing) {
    // If the row already exists but isn't admin, promote it instead of erroring.
    // Common case: the user signed in via Google before being explicitly added.
    if (!existing.isAdmin) {
      const promoted = await prisma.user.update({
        where: { id: existing.id },
        data: { isAdmin: true, ...(name ? { name } : {}) },
      });
      return NextResponse.json(
        { id: promoted.id, email: promoted.email, name: promoted.name, isAdmin: true },
        { status: 200 }
      );
    }
    return NextResponse.json(
      { error: "A user with this email already exists" },
      { status: 409 }
    );
  }

  const user = await prisma.user.create({
    data: { email: trimmed, name: name?.trim() || null, isAdmin: true },
  });

  return NextResponse.json(
    { id: user.id, email: user.email, name: user.name, isAdmin: true },
    { status: 201 }
  );
}
