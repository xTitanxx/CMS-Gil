import { prisma } from "@/lib/prisma";
import { getGoogleIntegration, hasYouTubeScope } from "@/lib/google-integration";

// Returns the set of platforms the user can actually publish to.
//
// All platforms except YouTube store their tokens in `PlatformToken`.
// YouTube tokens live in `GoogleIntegration` (shared with Drive — one OAuth
// grant covers both). Anything that needs to know "is YouTube connected?"
// must check both, otherwise YouTube is invisible (e.g. planner platform
// suggestions).
export async function getConnectedPlatforms(userId: string): Promise<string[]> {
  const [tokens, googleIntegration] = await Promise.all([
    prisma.platformToken.findMany({
      where: { userId },
      select: { platform: true },
    }),
    getGoogleIntegration(userId),
  ]);
  const platforms = new Set<string>();
  for (const t of tokens) {
    // FACEBOOK personal profile isn't publishable; FACEBOOK_PAGE is.
    if (t.platform === "FACEBOOK") continue;
    platforms.add(t.platform);
  }
  if (hasYouTubeScope(googleIntegration?.scope)) platforms.add("YOUTUBE");
  return Array.from(platforms);
}
