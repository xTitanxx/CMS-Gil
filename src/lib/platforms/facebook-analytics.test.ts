// src/lib/platforms/facebook-analytics.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { discoverFacebookPostId, fetchPostInsights } from "./facebook-analytics";

describe("discoverFacebookPostId", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("returns post ID when timestamp matches within 60 seconds", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ id: "123456_789", created_time: "2023-01-15T12:00:05+0000" }],
        paging: {},
      }),
    } as Response);

    const result = await discoverFacebookPostId(
      "token",
      new Date("2023-01-15T12:00:00Z"),
      "fb_1673784000"
    );
    expect(result).toBe("123456_789");
  });

  it("returns null when no match found across all pages", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ data: [], paging: {} }),
    } as Response);

    const result = await discoverFacebookPostId(
      "token",
      new Date("2023-01-15T12:00:00Z"),
      "fb_1673784000"
    );
    expect(result).toBeNull();
  });

  it("uses me/photos endpoint for photo sourceIds", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [], paging: {} }),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);

    await discoverFacebookPostId("token", new Date(), "fb_photo_abc123.jpg");
    expect(String(fetchMock.mock.calls[0][0])).toContain("me/photos");
  });

  it("uses me/posts endpoint for non-photo sourceIds", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [], paging: {} }),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);

    await discoverFacebookPostId("token", new Date(), "fb_1673784000");
    expect(String(fetchMock.mock.calls[0][0])).toContain("me/posts");
  });

  it("does not match when timestamp differs by more than 60 seconds", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ id: "123456_789", created_time: "2023-01-15T12:02:00+0000" }],
        paging: {},
      }),
    } as Response);

    const result = await discoverFacebookPostId(
      "token",
      new Date("2023-01-15T12:00:00Z"),
      "fb_1673784000"
    );
    expect(result).toBeNull();
  });
});

describe("fetchPostInsights", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("returns engagement metrics from first call", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          reactions: { summary: { total_count: 42 } },
          comments: { summary: { total_count: 7 } },
          shares: { count: 3 },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [], error: { message: "not available" } }),
      } as Response);

    const result = await fetchPostInsights("token", "123_456");
    expect(result.reactions).toBe(42);
    expect(result.comments).toBe(7);
    expect(result.shares).toBe(3);
    expect(result.reach).toBeNull();
    expect(result.impressions).toBeNull();
  });

  it("returns reach and impressions when Professional Mode insights available", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          reactions: { summary: { total_count: 10 } },
          comments: { summary: { total_count: 2 } },
          shares: { count: 1 },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            { name: "post_impressions_unique", values: [{ value: 500 }] },
            { name: "post_impressions", values: [{ value: 750 }] },
          ],
        }),
      } as Response);

    const result = await fetchPostInsights("token", "123_456");
    expect(result.reach).toBe(500);
    expect(result.impressions).toBe(750);
  });

  it("still returns engagement when insights call fails", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          reactions: { summary: { total_count: 5 } },
          comments: { summary: { total_count: 1 } },
          shares: { count: 0 },
        }),
      } as Response)
      .mockRejectedValueOnce(new Error("Network error"));

    const result = await fetchPostInsights("token", "123_456");
    expect(result.reactions).toBe(5);
    expect(result.reach).toBeNull();
    expect(result.impressions).toBeNull();
  });

  it("returns all nulls when both calls fail", async () => {
    vi.mocked(fetch)
      .mockRejectedValueOnce(new Error("Network error"))
      .mockRejectedValueOnce(new Error("Network error"));

    const result = await fetchPostInsights("token", "123_456");
    expect(result).toEqual({
      reactions: null,
      comments: null,
      shares: null,
      reach: null,
      impressions: null,
    });
  });
});
