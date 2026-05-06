// Admin shadow Subscriber. Lets the admin like/bookmark/comment without
// logging out — useful for testing engagement features end-to-end. The shadow
// is revoked-on-creation so it can never sign in (and never appears as an
// active subscriber in /admin/settings) — its only job is to satisfy the
// subscriberId FK on PostLike/PostBookmark/PostComment when the actor is
// actually an admin user.

import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";

const SHADOW_NAME_PREFIX = "[admin]";

export async function getOrCreateAdminShadowSubscriber(
  adminUserId: string,
): Promise<{ id: string; displayName: string | null }> {
  const existing = await prisma.subscriber.findFirst({
    where: {
      createdById: adminUserId,
      name: { startsWith: SHADOW_NAME_PREFIX },
    },
    select: { id: true, displayName: true },
  });
  if (existing) return existing;

  const user = await prisma.user.findUnique({
    where: { id: adminUserId },
    select: { name: true, email: true },
  });
  const adminLabel = user?.name ?? user?.email ?? "admin";

  const created = await prisma.subscriber.create({
    data: {
      name: `${SHADOW_NAME_PREFIX} ${adminLabel}`,
      displayName: adminLabel,
      // codeHash + codeBlindIndex are unique-indexed; use random unguessable
      // tokens so they never collide with a real subscriber code.
      codeHash: `__shadow_${randomBytes(16).toString("hex")}`,
      codeBlindIndex: `__shadow_${randomBytes(16).toString("hex")}`,
      revokedAt: new Date(),
      createdById: adminUserId,
    },
    select: { id: true, displayName: true },
  });
  return created;
}

// Resolve the subscriberId an action should write under, given a session.
// Returns null if the session has neither a subscriberId nor admin role —
// the caller should 401/403 in that case.
export async function resolveActorSubscriberId(session: {
  user?: { id?: string; role?: string; subscriberId?: string };
} | null): Promise<string | null> {
  if (!session?.user) return null;
  const role = session.user.role;
  const subscriberId = session.user.subscriberId;
  if (role === "subscriber" && subscriberId) return subscriberId;
  if (role === "admin" && session.user.id) {
    const shadow = await getOrCreateAdminShadowSubscriber(session.user.id);
    return shadow.id;
  }
  return null;
}
