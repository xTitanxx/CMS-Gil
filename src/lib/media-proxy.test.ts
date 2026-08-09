import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: { media: { findUnique: vi.fn() } },
}));

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { proxyMediaRequest } from "./media-proxy";

const mockAuth = vi.mocked(auth);
const mockFindUnique = vi.mocked(prisma.media.findUnique);

describe("proxyMediaRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GIL_USER_ID = "gil";
    process.env.R2_PUBLIC_URL = "https://pub-example.r2.dev";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("streams public media and forwards a video byte range", async () => {
    mockFindUnique.mockResolvedValue({
      storageKey: "https://pub-example.r2.dev/media/video.mp4",
      mimeType: "video/mp4",
      post: { userId: "gil" },
    } as never);
    const fetchMock = vi.fn().mockResolvedValue(new Response("bytes", {
      status: 206,
      headers: {
        "content-type": "video/mp4",
        "content-range": "bytes 0-4/100",
        "content-length": "5",
        "accept-ranges": "bytes",
      },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await proxyMediaRequest(
      new Request("https://gilalter.com/api/media/media1/content", {
        headers: { range: "bytes=0-4" },
      }),
      "media1",
      "content",
    );

    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 0-4/100");
    expect(response.headers.get("content-type")).toBe("video/mp4");
    expect(response.headers.get("cache-control")).toContain("public");
    expect(mockAuth).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://pub-example.r2.dev/media/video.mp4",
      expect.objectContaining({
        method: "GET",
        cache: "no-store",
      }),
    );
    const upstreamHeaders = fetchMock.mock.calls[0][1].headers as Headers;
    expect(upstreamHeaders.get("range")).toBe("bytes=0-4");
  });

  it("requires ownership for media outside the public Gil archive", async () => {
    mockFindUnique.mockResolvedValue({
      storageKey: "https://pub-example.r2.dev/media/private.jpg",
      mimeType: "image/jpeg",
      post: { userId: "other-user" },
    } as never);
    mockAuth.mockResolvedValue(null as never);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await proxyMediaRequest(
      new Request("https://gilalter.com/api/media/private/content"),
      "private",
      "content",
    );

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the derived R2 poster object for poster requests", async () => {
    mockFindUnique.mockResolvedValue({
      storageKey: "https://pub-example.r2.dev/media/video.mp4",
      mimeType: "video/mp4",
      post: { userId: "gil" },
    } as never);
    const fetchMock = vi.fn().mockResolvedValue(new Response("jpeg", {
      headers: { "content-type": "image/jpeg" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await proxyMediaRequest(
      new Request("https://gilalter.com/api/media/media1/poster"),
      "media1",
      "poster",
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://pub-example.r2.dev/media/video.poster.jpg",
      expect.any(Object),
    );
  });
});
