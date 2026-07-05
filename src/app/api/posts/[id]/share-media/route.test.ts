import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: { post: { findFirst: vi.fn() } },
}));
vi.mock("@/lib/publish-prep", () => ({ preparePublishKeys: vi.fn() }));

import { GET } from "./route";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { preparePublishKeys } from "@/lib/publish-prep";

const fakeReq = {} as NextRequest;
const mockAuth = vi.mocked(auth);
const mockFindFirst = vi.mocked(prisma.post.findFirst);
const mockPreparePublishKeys = vi.mocked(preparePublishKeys);

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/posts/[id]/share-media", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue(null as never);
    const res = await GET(fakeReq, makeParams("post1"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when the post does not belong to the user", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user1" } } as never);
    mockFindFirst.mockResolvedValue(null);
    const res = await GET(fakeReq, makeParams("post1"));
    expect(res.status).toBe(404);
  });

  it("returns mux-aware URLs in the same order as the post's media", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user1" } } as never);
    mockFindFirst.mockResolvedValue({
      media: [
        {
          id: "media1",
          mimeType: "video/mp4",
          storageKey: "https://r2.example/video.mp4",
          hasAudio: false,
          audioTrack: { storageKey: "https://r2.example/song.mp3" },
        },
        {
          id: "media2",
          mimeType: "image/jpeg",
          storageKey: "https://r2.example/photo.jpg",
          hasAudio: null,
          audioTrack: null,
        },
      ],
    } as never);
    mockPreparePublishKeys.mockResolvedValue([
      "https://r2.example/muxed-video.mp4",
      "https://r2.example/photo.jpg",
    ]);

    const res = await GET(fakeReq, makeParams("post1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockPreparePublishKeys).toHaveBeenCalledWith("user1", [
      {
        id: "media1",
        mimeType: "video/mp4",
        storageKey: "https://r2.example/video.mp4",
        hasAudio: false,
        audioTrack: { storageKey: "https://r2.example/song.mp3" },
      },
      {
        id: "media2",
        mimeType: "image/jpeg",
        storageKey: "https://r2.example/photo.jpg",
        hasAudio: null,
        audioTrack: null,
      },
    ]);
    expect(body).toEqual({
      media: [
        { id: "media1", mimeType: "video/mp4", url: "https://r2.example/muxed-video.mp4" },
        { id: "media2", mimeType: "image/jpeg", url: "https://r2.example/photo.jpg" },
      ],
    });
  });
});
