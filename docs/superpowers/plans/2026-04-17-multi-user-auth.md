# Multi-User Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add email/password login alongside Google OAuth so co-admins can access the hub without a Google account.

**Architecture:** Add `passwordHash` to the User model, add NextAuth Credentials provider, switch session strategy from `database` to `jwt` (required for Credentials + adapter), seed Ana's account, and add an `/admin/settings` page for user management.

**Tech Stack:** NextAuth v5 (beta.30), bcryptjs, Prisma 7, Next.js App Router

---

### Task 1: Add bcryptjs dependency and passwordHash field

**Files:**
- Modify: `prisma/schema.prisma:40-56` (User model)
- Create: `prisma/migrations/<auto>/migration.sql` (auto-generated)

- [ ] **Step 1: Install bcryptjs**

```bash
npm install bcryptjs
npm install -D @types/bcryptjs
```

- [ ] **Step 2: Add passwordHash to User model**

In `prisma/schema.prisma`, add the field to the User model after `image`:

```prisma
model User {
  id             String          @id @default(cuid())
  name           String?
  email          String?         @unique
  emailVerified  DateTime?
  image          String?
  passwordHash   String?
  accounts       Account[]
  sessions       Session[]
  posts          Post[]
  importJobs     ImportJob[]
  platformTokens PlatformToken[]
  driveSync      DriveSync?
  weeklyPlans    WeeklyPlan[]
  audioTracks    AudioTrack[]
  dailyBriefs    DailyBrief[]
  conversations  Conversation[]
}
```

- [ ] **Step 3: Generate and run migration**

```bash
npx prisma migrate dev --name add-user-password-hash
```

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/ package.json package-lock.json
git commit -m "feat(auth): add passwordHash field to User model"
```

---

### Task 2: Seed Ana's account

**Files:**
- Create: `scripts/seed-user.ts`

- [ ] **Step 1: Write seed script**

Create `scripts/seed-user.ts`:

```typescript
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const email = "anavollmer4@gmail.com";
  const password = "1234";
  const name = "Ana";

  const hash = await bcrypt.hash(password, 12);

  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash: hash, name },
    create: { email, name, passwordHash: hash },
  });

  console.log(`Seeded user: ${user.email} (id: ${user.id})`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 2: Run seed script**

```bash
npx tsx scripts/seed-user.ts
```

Expected: `Seeded user: anavollmer4@gmail.com (id: <cuid>)`

- [ ] **Step 3: Commit**

```bash
git add scripts/seed-user.ts
git commit -m "feat(auth): seed Ana's credentials account"
```

---

### Task 3: Add Credentials provider to NextAuth

**Files:**
- Modify: `src/lib/auth.ts`

This is the core change. Two things happen:
1. Session strategy switches from `database` (implicit default with adapter) to `jwt` — required for Credentials provider with PrismaAdapter.
2. Credentials provider is added alongside Google.

The session callback changes: with JWT strategy, the callback receives `token` (not `user`), so we read `user.id` from `token.sub`.

- [ ] **Step 1: Update auth.ts**

Replace the full contents of `src/lib/auth.ts`:

```typescript
import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Google from "next-auth/providers/google";
import LinkedIn from "next-auth/providers/linkedin";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

const providers = [];

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  providers.push(
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      checks: ["state"],
      authorization: {
        params: {
          scope: [
            "openid",
            "email",
            "profile",
            "https://www.googleapis.com/auth/youtube.upload",
            "https://www.googleapis.com/auth/youtube.readonly",
            "https://www.googleapis.com/auth/drive.readonly",
          ].join(" "),
          access_type: "offline",
          prompt: "consent",
        },
      },
    })
  );
}

if (process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET) {
  providers.push(
    LinkedIn({
      clientId: process.env.LINKEDIN_CLIENT_ID,
      clientSecret: process.env.LINKEDIN_CLIENT_SECRET,
      authorization: {
        params: {
          scope: "openid profile email w_member_social r_basicprofile",
        },
      },
    })
  );
}

providers.push(
  Credentials({
    name: "Email",
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" },
    },
    async authorize(credentials) {
      const email = credentials?.email as string | undefined;
      const password = credentials?.password as string | undefined;
      if (!email || !password) return null;

      const user = await prisma.user.findUnique({ where: { email } });
      if (!user?.passwordHash) return null;

      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) return null;

      return { id: user.id, name: user.name, email: user.email, image: user.image };
    },
  })
);

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  providers,
  trustHost: true,
  callbacks: {
    jwt({ token, user }) {
      // On initial sign-in, `user` is present — persist id into the token
      if (user?.id) token.sub = user.id;
      return token;
    },
    session({ session, token }) {
      // With JWT strategy, user id comes from token.sub
      if (token.sub) session.user.id = token.sub;
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
});
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/auth.ts
git commit -m "feat(auth): add Credentials provider, switch to JWT sessions"
```

---

### Task 4: Update login page with email/password form

**Files:**
- Modify: `src/app/(auth)/login/SignInButtons.tsx`

- [ ] **Step 1: Rewrite SignInButtons with email/password form**

Replace `src/app/(auth)/login/SignInButtons.tsx`:

```tsx
"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function SignInButtons() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    setLoading(false);

    if (result?.error) {
      setError("Invalid email or password");
    } else {
      window.location.href = "/admin/dashboard";
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button type="submit" disabled={loading} className="w-full">
          {loading ? "Signing in..." : "Sign in"}
        </Button>
      </form>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t border-gray-200" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-white px-2 text-gray-500">or</span>
        </div>
      </div>

      <Button
        onClick={() => signIn("google", { callbackUrl: "/admin/dashboard" })}
        variant="outline"
        className="w-full gap-3"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4">
          <path
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            fill="#4285F4"
          />
          <path
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            fill="#34A853"
          />
          <path
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            fill="#FBBC05"
          />
          <path
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            fill="#EA4335"
          />
        </svg>
        Continue with Google
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/app/(auth)/login/SignInButtons.tsx
git commit -m "feat(auth): add email/password login form"
```

---

### Task 5: Add user management API routes

**Files:**
- Create: `src/app/api/users/route.ts`
- Create: `src/app/api/users/[id]/route.ts`

- [ ] **Step 1: Create GET/POST handler at `/api/users`**

Create `src/app/api/users/route.ts`:

```typescript
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
```

- [ ] **Step 2: Create DELETE/PATCH handler at `/api/users/[id]`**

Create `src/app/api/users/[id]/route.ts`:

```typescript
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
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/users/route.ts src/app/api/users/\[id\]/route.ts
git commit -m "feat(auth): add user management API routes"
```

---

### Task 6: Build admin settings page with user management UI

**Files:**
- Create: `src/app/admin/settings/page.tsx`
- Modify: `src/components/layout/Sidebar.tsx` (add Settings nav link)

- [ ] **Step 1: Create the settings page**

Create `src/app/admin/settings/page.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Trash2, KeyRound } from "lucide-react";

interface UserRow {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  loginMethod: string;
}

export default function SettingsPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Add user form
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [addError, setAddError] = useState("");
  const [adding, setAdding] = useState(false);

  // Reset password
  const [resetId, setResetId] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState("");

  async function fetchUsers() {
    const res = await fetch("/api/users");
    if (res.ok) setUsers(await res.json());
    setLoading(false);
  }

  useEffect(() => {
    void fetchUsers();
  }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setAddError("");
    setAdding(true);

    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: newEmail, name: newName, password: newPassword }),
    });

    setAdding(false);

    if (!res.ok) {
      const data = await res.json();
      setAddError(data.error || "Failed to add user");
      return;
    }

    setNewEmail("");
    setNewName("");
    setNewPassword("");
    await fetchUsers();
  }

  async function handleDelete(id: string) {
    if (!confirm("Remove this user?")) return;
    const res = await fetch(`/api/users/${id}`, { method: "DELETE" });
    if (res.ok) setUsers((prev) => prev.filter((u) => u.id !== id));
  }

  async function handleResetPassword(id: string) {
    if (!resetPassword) return;
    const res = await fetch(`/api/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: resetPassword }),
    });
    if (res.ok) {
      setResetId(null);
      setResetPassword("");
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500">Manage users and hub configuration</p>
      </div>

      {/* Users section */}
      <section className="rounded-lg border border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">Users</h2>
          <p className="text-sm text-gray-500">
            Everyone listed here has full admin access.
          </p>
        </div>

        {loading ? (
          <div className="px-6 py-8 text-center text-sm text-gray-500">
            Loading...
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {users.map((user) => (
              <li key={user.id} className="flex items-center gap-4 px-6 py-3">
                {user.image ? (
                  <img
                    src={user.image}
                    alt=""
                    className="h-8 w-8 rounded-full"
                  />
                ) : (
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-200 text-xs font-medium text-gray-600">
                    {(user.name?.[0] || user.email?.[0] || "?").toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-900">
                    {user.name || user.email}
                  </p>
                  <p className="truncate text-xs text-gray-500">
                    {user.email} · {user.loginMethod}
                  </p>
                </div>

                {resetId === user.id ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="password"
                      placeholder="New password"
                      value={resetPassword}
                      onChange={(e) => setResetPassword(e.target.value)}
                      className="w-32 rounded border border-gray-300 px-2 py-1 text-sm"
                    />
                    <Button
                      size="sm"
                      onClick={() => handleResetPassword(user.id)}
                    >
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setResetId(null);
                        setResetPassword("");
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1">
                    {user.loginMethod === "credentials" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setResetId(user.id)}
                        title="Reset password"
                      >
                        <KeyRound className="h-4 w-4" />
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-red-600 hover:text-red-700"
                      onClick={() => handleDelete(user.id)}
                      title="Remove user"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {/* Add user form */}
        <div className="border-t border-gray-200 px-6 py-4">
          <h3 className="mb-3 text-sm font-medium text-gray-900">
            Add new user
          </h3>
          <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[160px]">
              <label className="block text-xs text-gray-500 mb-1">Email</label>
              <input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                required
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div className="min-w-[120px]">
              <label className="block text-xs text-gray-500 mb-1">Name</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div className="min-w-[120px]">
              <label className="block text-xs text-gray-500 mb-1">
                Password
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <Button type="submit" disabled={adding}>
              {adding ? "Adding..." : "Add user"}
            </Button>
          </form>
          {addError && (
            <p className="mt-2 text-sm text-red-600">{addError}</p>
          )}
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Add Settings link to Sidebar**

In `src/components/layout/Sidebar.tsx`, add `Settings` import and nav entry:

1. Add `Settings` to the lucide-react import.
2. Add to the `nav` array at the end:
```typescript
{ href: "/admin/settings", label: "Settings", icon: Settings },
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/settings/page.tsx src/components/layout/Sidebar.tsx
git commit -m "feat(auth): add admin settings page with user management"
```

---

### Task 7: Handle JWT session migration for existing database sessions

**Files:**
- No new files — this is a verification/cleanup task

Switching from `database` to `jwt` session strategy means existing database sessions (like Eitan's current session) will no longer be valid. The user will need to sign in again after deployment. No code changes needed, but verify:

- [ ] **Step 1: Verify the app builds**

```bash
npm run build
```

- [ ] **Step 2: Run existing tests**

```bash
npm test
```

- [ ] **Step 3: Final commit (if any test fixes needed) and verify clean state**

```bash
git status
```

All users with active sessions will need to re-authenticate after this deploys. This is expected and harmless — they just sign in again.
