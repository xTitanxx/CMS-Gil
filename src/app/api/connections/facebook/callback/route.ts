import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/encrypt";
import { auth } from "@/lib/auth";
import { verifyOAuthState } from "@/lib/oauth-state";
import { redactSecrets } from "@/lib/redact";

const META_APP_ID = process.env.META_APP_ID!;
const META_APP_SECRET = process.env.META_APP_SECRET!;
const REDIRECT_URI = `${process.env.APP_URL}/api/connections/facebook/callback`;

const USER_SCOPES =
  "public_profile,read_insights,pages_show_list,pages_read_engagement,pages_manage_posts,pages_manage_engagement";

interface DebugTokenGranularScope {
  scope: string;
  target_ids?: string[];
}

interface DebugTokenResponse {
  data?: {
    granular_scopes?: DebugTokenGranularScope[];
  };
}

interface PageLookup {
  id: string;
  name: string;
  access_token: string;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const stateParam = searchParams.get("state");
  const error = searchParams.get("error");

  if (error || !code || !stateParam) {
    return NextResponse.redirect(
      new URL("/connections?error=facebook_denied", req.url)
    );
  }

  const state = verifyOAuthState(stateParam);
  const session = await auth();
  if (
    !state ||
    !session?.user?.id ||
    session.user.role !== "admin" ||
    session.user.id !== state.userId
  ) {
    return NextResponse.redirect(
      new URL("/connections?error=facebook_state", req.url)
    );
  }
  const userId = state.userId;

  try {
    // 1. Short-lived user token
    const tokenRes = await fetch(
      `https://graph.facebook.com/v21.0/oauth/access_token?${new URLSearchParams({
        client_id: META_APP_ID,
        client_secret: META_APP_SECRET,
        redirect_uri: REDIRECT_URI,
        code,
      })}`
    );
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      throw new Error(
        `Token exchange failed [redirect_uri=${REDIRECT_URI}]: ${JSON.stringify(tokenData)}`
      );
    }

    // 2. Long-lived user token (~60 days)
    const longLivedRes = await fetch(
      `https://graph.facebook.com/v21.0/oauth/access_token?${new URLSearchParams({
        grant_type: "fb_exchange_token",
        client_id: META_APP_ID,
        client_secret: META_APP_SECRET,
        fb_exchange_token: tokenData.access_token,
      })}`
    );
    const longLived = await longLivedRes.json();
    const userAccessToken: string = longLived.access_token ?? tokenData.access_token;
    const userExpiresIn: number = longLived.expires_in ?? 5183944;

    // 3. Personal profile info (for analytics card label)
    const meRes = await fetch(
      `https://graph.facebook.com/v21.0/me?fields=id,name&access_token=${userAccessToken}`
    );
    const meData = await meRes.json();

    // 4. Upsert the FACEBOOK (personal analytics) token
    await prisma.platformToken.upsert({
      where: { userId_platform: { userId, platform: "FACEBOOK" } },
      create: {
        userId,
        platform: "FACEBOOK",
        accessToken: encrypt(userAccessToken),
        expiresAt: new Date(Date.now() + userExpiresIn * 1000),
        platformUserId: meData.id ?? null,
        platformUsername: meData.name ?? "Facebook",
        scopes: USER_SCOPES,
      },
      update: {
        accessToken: encrypt(userAccessToken),
        expiresAt: new Date(Date.now() + userExpiresIn * 1000),
        platformUserId: meData.id ?? null,
        platformUsername: meData.name ?? "Facebook",
        scopes: USER_SCOPES,
      },
    });

    // 5. Discover the target Page via /debug_token.
    //
    //    Facebook Login for Business grants a per-Page "granular scope" rather
    //    than returning all admin'd pages via /me/accounts. The classic
    //    /me/accounts endpoint returns an empty array for this app type even
    //    when the user just selected a Page during the consent flow. The
    //    granted target Page IDs live in the token's granular_scopes, which
    //    we read via the app-level /debug_token endpoint. We then fetch the
    //    Page Access Token for the first target Page.
    //
    //    See: https://developers.facebook.com/docs/facebook-login/guides/access-tokens/debug
    const appAccessToken = `${META_APP_ID}|${META_APP_SECRET}`;
    const debugRes = await fetch(
      `https://graph.facebook.com/v21.0/debug_token?input_token=${userAccessToken}&access_token=${encodeURIComponent(appAccessToken)}`
    );
    const debugData: DebugTokenResponse = await debugRes.json();
    const granularScopes = debugData.data?.granular_scopes ?? [];

    // Collect unique target Page IDs across all page_* granular scopes. The
    // Union handles the case where the user granted different scopes against
    // different pages (rare but possible via the consent picker).
    const targetPageIds = new Set<string>();
    for (const gs of granularScopes) {
      if (!gs.scope.startsWith("pages_")) continue;
      for (const id of gs.target_ids ?? []) targetPageIds.add(id);
    }

    // Resolve the first target Page to a Page Access Token. Multi-page picking
    // is explicitly out of scope for this iteration — the spec's "take the
    // first" decision stands; we now pick it from granular scopes instead.
    const firstPageId = targetPageIds.values().next().value as string | undefined;
    let pageLookup: PageLookup | null = null;
    if (firstPageId) {
      const pageRes = await fetch(
        `https://graph.facebook.com/v21.0/${firstPageId}?fields=id,name,access_token&access_token=${userAccessToken}`
      );
      const pageData = await pageRes.json();
      if (pageData?.id && pageData?.access_token) {
        pageLookup = {
          id: pageData.id,
          name: pageData.name ?? "Facebook Page",
          access_token: pageData.access_token,
        };
      }
    }

    if (pageLookup) {
      await prisma.platformToken.upsert({
        where: { userId_platform: { userId, platform: "FACEBOOK_PAGE" } },
        create: {
          userId,
          platform: "FACEBOOK_PAGE",
          accessToken: encrypt(pageLookup.access_token),
          // Page access tokens derived from a long-lived user token are
          // themselves long-lived and generally do not expire — leave null.
          expiresAt: null,
          platformUserId: pageLookup.id,
          platformUsername: pageLookup.name,
          scopes: "pages_manage_posts,pages_read_engagement,pages_manage_engagement",
        },
        update: {
          accessToken: encrypt(pageLookup.access_token),
          expiresAt: null,
          platformUserId: pageLookup.id,
          platformUsername: pageLookup.name,
          scopes: "pages_manage_posts,pages_read_engagement,pages_manage_engagement",
        },
      });
    } else {
      // Clear any stale page token from a previous connection.
      await prisma.platformToken.deleteMany({
        where: { userId, platform: "FACEBOOK_PAGE" },
      });
    }

    return NextResponse.redirect(new URL("/connections?success=facebook", req.url));
  } catch (err) {
    // Redact provider responses before logging — Meta occasionally embeds
    // access_token / fb_exchange_token in error_description fields.
    console.error("Facebook callback error:", redactSecrets(err));
    return NextResponse.redirect(
      new URL("/connections?error=facebook_failed", req.url)
    );
  }
}
