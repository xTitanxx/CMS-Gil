import { describe, expect, it } from "vitest";
import { decide, type ProxyDecision } from "./proxy-decide";

type Role = "admin" | "subscriber" | undefined;

function check(role: Role, pathname: string, expected: ProxyDecision) {
  expect(decide(pathname, role), `${role ?? "anon"} → ${pathname}`).toBe(expected);
}

describe("proxy decide()", () => {
  describe("always-public", () => {
    const paths = [
      "/welcome",
      "/login",
      "/favicon.ico",
      "/banner.jpg",
      "/manifest.webmanifest",
      "/_next/static/chunk.js",
      "/api/auth",
      "/api/auth/callback/google",
      "/api/auth/callback/subscriber-credentials",
      "/api/public/feed",
      "/api/public/stories",
    ];
    for (const p of paths) {
      it(`anon, subscriber, admin all reach ${p}`, () => {
        check(undefined, p, "allow");
        check("subscriber", p, "allow");
        check("admin", p, "allow");
      });
    }
  });

  describe("public archive (open to everyone)", () => {
    const paths = ["/", "/p/abc123", "/s/story_xyz", "/p/post-with-dashes"];
    for (const p of paths) {
      it(`anon, subscriber, admin all reach ${p}`, () => {
        check(undefined, p, "allow");
        check("subscriber", p, "allow");
        check("admin", p, "allow");
      });
    }
  });

  describe("subscriber pages", () => {
    it("subscriber can reach /chat and /bookmarks; anon redirected to /welcome", () => {
      check("subscriber", "/chat", "allow");
      check("subscriber", "/bookmarks", "allow");
      check(undefined, "/chat", "redirect-welcome");
      check(undefined, "/bookmarks", "redirect-welcome");
      check("admin", "/chat", "allow");
      check("admin", "/bookmarks", "allow");
    });
  });

  describe("subscriber API surface", () => {
    const paths = [
      "/api/chat",
      "/api/chat/budget",
      "/api/chat/conversation",
      "/api/me/engagement",
      "/api/posts/preview",
    ];
    for (const p of paths) {
      it(`subscriber and admin reach ${p}; anon 401 (except /api/me/engagement)`, () => {
        check("subscriber", p, "allow");
        check("admin", p, "allow");
      });
    }
    it("/api/me/engagement is anon-allowed (returns empty data)", () => {
      check(undefined, "/api/me/engagement", "allow");
    });
    it("/api/chat etc. require sign-in for anon", () => {
      check(undefined, "/api/chat", "unauth-api");
      check(undefined, "/api/chat/budget", "unauth-api");
      check(undefined, "/api/chat/conversation", "unauth-api");
      check(undefined, "/api/posts/preview", "unauth-api");
    });
  });

  describe("post engagement endpoints", () => {
    const paths = [
      "/api/posts/abc/like",
      "/api/posts/abc/bookmark",
      "/api/posts/abc/comments",
      "/api/posts/abc/comments/c123",
    ];
    for (const p of paths) {
      it(`anon, subscriber, admin all reach ${p} (route handles its own auth)`, () => {
        check(undefined, p, "allow");
        check("subscriber", p, "allow");
        check("admin", p, "allow");
      });
    }
  });

  describe("admin-only API blocked for subscribers and anon", () => {
    const paths = [
      "/api/posts",
      "/api/posts/ai-search",
      "/api/posts/bulk-analyze",
      "/api/posts/abc",
      "/api/posts/abc/analyze",
      "/api/posts/abc/caption-suggestion",
      "/api/posts/abc/publish",
      "/api/posts/abc/quick-schedule",
      "/api/posts/abc/analytics",
      "/api/planner/current",
      "/api/planner/generate",
      "/api/planner/abc",
      "/api/chat/planner", // critical: NOT subscriber-allowed despite /api/chat prefix
      "/api/assistant",
      "/api/assistant/brief",
      "/api/users",
      "/api/users/abc",
      "/api/media/abc",
      "/api/audio",
      "/api/audio/abc",
      "/api/connections",
      "/api/connections/facebook",
      "/api/connections/facebook/callback",
      "/api/triage",
      "/api/triage/count",
      "/api/import/upload",
      "/api/import/process",
      "/api/drive/sync",
      "/api/blob",
      "/api/calendar",
      "/api/todo",
      "/api/tags",
      "/api/ratings/queue",
      "/api/trash",
      "/api/cron/publish",
      "/api/cron/readiness",
    ];
    for (const p of paths) {
      it(`subscriber gets 403 on ${p}`, () => {
        check("subscriber", p, "forbid-api");
      });
      it(`anon gets 401 on ${p}`, () => {
        check(undefined, p, "unauth-api");
      });
      it(`admin reaches ${p}`, () => {
        check("admin", p, "allow");
      });
    }
  });

  describe("admin pages", () => {
    const paths = [
      "/admin",
      "/admin/posts",
      "/admin/posts/abc",
      "/admin/planner",
      "/admin/connections",
      "/admin/settings",
      "/api/admin/subscribers",
      "/api/admin/subscribers/abc",
    ];
    for (const p of paths) {
      it(`admin reaches ${p}`, () => {
        check("admin", p, "allow");
      });
    }
    it("subscriber on /admin/* page → redirect home", () => {
      check("subscriber", "/admin/posts", "redirect-home");
      check("subscriber", "/admin", "redirect-home");
    });
    it("anon on /admin/* page → redirect to /login", () => {
      check(undefined, "/admin/posts", "redirect-login");
      check(undefined, "/admin", "redirect-login");
    });
    it("subscriber on /api/admin/* → 403", () => {
      check("subscriber", "/api/admin/subscribers", "forbid-api");
    });
    it("anon on /api/admin/* → 403 (admin-only blanket; not 401)", () => {
      check(undefined, "/api/admin/subscribers", "forbid-api");
    });
  });

  describe("subscriber on admin pages bounced home (not /login)", () => {
    it("subscriber → /admin/posts redirects home, not to /login", () => {
      // /login offers Google OAuth that subscribers can't complete.
      check("subscriber", "/admin/posts", "redirect-home");
    });
  });

  describe("anon trying to load random non-public page → /welcome", () => {
    it("redirects to /welcome with next= preserved (no role)", () => {
      check(undefined, "/some-future-page", "redirect-welcome");
    });
  });

  describe("regression: prior subscriber-can-touch-admin-AI bugs", () => {
    it("/api/chat/planner is admin-only", () => {
      check("subscriber", "/api/chat/planner", "forbid-api");
      check(undefined, "/api/chat/planner", "unauth-api");
      check("admin", "/api/chat/planner", "allow");
    });
    it("/api/posts/ai-search is admin-only", () => {
      check("subscriber", "/api/posts/ai-search", "forbid-api");
    });
    it("/api/planner/generate is admin-only", () => {
      check("subscriber", "/api/planner/generate", "forbid-api");
    });
    it("/api/users/[id] is admin-only", () => {
      check("subscriber", "/api/users/some-admin-id", "forbid-api");
    });
    it("/api/assistant is admin-only", () => {
      check("subscriber", "/api/assistant", "forbid-api");
    });
  });
});
