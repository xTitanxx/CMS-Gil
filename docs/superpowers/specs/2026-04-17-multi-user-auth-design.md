# Multi-User Auth with Credentials Login

**Date:** 2026-04-17
**Branch:** `feature/multi-user-auth`

## Problem

The CMS admin hub currently relies solely on Google OAuth, which is tied to an unverified Google app (test-user mode). Adding new users requires manually registering them as test users in Google Cloud Console. The owner wants to grant co-admin access to others without sharing Google credentials or managing Google's test user list.

## Solution

Add a native email/password (credentials) login alongside the existing Google OAuth. No open registration — accounts are created by existing admins through a new Settings page.

## Changes

### 1. User Model — Add Password Field

Add a nullable `passwordHash` field to the `User` model in Prisma:

```prisma
model User {
  // ... existing fields
  passwordHash String?
}
```

Nullable because Eitan's account uses Google OAuth and has no password.

### 2. NextAuth Credentials Provider

Add the `Credentials` provider to the existing NextAuth config in `src/lib/auth.ts`:

- Accepts `email` and `password`
- Looks up user by email, verifies password hash with `bcrypt`
- Returns user object on success, `null` on failure
- Sits alongside the existing Google provider

Session strategy stays as `database` — NextAuth's PrismaAdapter handles session creation for both providers.

**Note:** NextAuth v5 with database sessions requires manually creating the session in the `signIn` callback for credentials, since the Credentials provider doesn't go through the adapter's `createUser` flow. The `authorize` function returns the user, and the `signIn` callback creates the DB session + sets the cookie.

### 3. Login Page Update

Update `/app/(auth)/login/page.tsx` and `SignInButtons.tsx`:

- Add an email + password form above or below the Google button
- Simple form: email input, password input, submit button
- Show inline error on invalid credentials
- Keep the existing Google sign-in button unchanged

### 4. Seed Ana's Account

Create a seed script or migration that inserts:

- **Email:** anavollmer4@gmail.com
- **Name:** Ana
- **Password:** bcrypt hash of `1234`

This runs as a one-time Prisma seed or direct DB insert.

### 5. Admin Settings Page (`/admin/settings`)

New page at `/admin/settings` with a "Manage Users" section:

- **User list** — shows all users (email, name, login method indicator)
- **Add user form** — email, name, password fields. Creates a new credentials user.
- **Remove user** — delete button per user (cannot delete yourself)
- **Reset password** — set a new password for any credentials user

API routes:
- `GET /api/users` — list all users
- `POST /api/users` — create user (email, name, password)
- `DELETE /api/users/[id]` — remove user
- `PATCH /api/users/[id]` — update user (reset password)

All routes auth-gated (same pattern as existing API routes).

### 6. Sidebar Update

Add a "Settings" link to the admin sidebar, pointing to `/admin/settings`.

## What Stays the Same

- Google OAuth remains for Eitan's account
- All existing admin layout gating (`if (!session) redirect("/login")`)
- All existing API route auth checks
- All co-admins see everything — no role/permission system
- Public routes remain unauthenticated

## Dependencies

- `bcrypt` (or `bcryptjs` for pure JS, better serverless compat) — password hashing

## Out of Scope

- Role-based access control
- Self-registration
- Password reset via email
- "Manage Connections" in settings (future)
