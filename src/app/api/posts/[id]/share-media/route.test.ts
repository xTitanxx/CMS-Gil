import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: { post: { findFirst: vi.fn() } },
}));
vi.mock("@/lib/publish-prep", () => ({ preparePublishKeys: vi.fn() }));
vi.mock("@/lib/storage", () => ({
  getObject: vi.fn(),
  uploadBuffer: vi.fn(),
  mediaKey: vi.fn((userId: string, filename: string) => `media/${userId}/${filename}`),
}));
vi.mock("@/lib/video-processing", () => ({ remuxToMp4: vi.fn() }));

import { GET } from "./route";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { preparePublishKeys } from "@/lib/publish-prep";
import { getObject, uploadBuffer } from "@/lib/storage";
import { remuxToMp4 } from "@/lib/video-processing";

const fakeReq = {} as NextRequest;
const mockAuth = vi.mocked(auth);
const mockFindFirst = vi.mocked(prisma.post.findFirst);
const mockPreparePublishKeys = vi.mocked(preparePublishKeys);
const mockGetObject = vi.mocked(getObject);
const mockUploadBuffer = vi.mocked(uploadBuffer);
const mockRemuxToMp4 = vi.mocked(remuxToMp4);

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

  it("remuxes a plain (no music) non-mp4 video into a real mp4", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user1" } } as never);
    mockFindFirst.mockResolvedValue({
      media: [
        {
          id: "media1",
          mimeType: "video/quicktime",
          storageKey: "https://r2.example/clip.mov",
          hasAudio: true,
          audioTrack: null,
        },
      ],
    } as never);
    mockPreparePublishKeys.mockResolvedValue(["https://r2.example/clip.mov"]);
    mockGetObject.mockResolvedValue(Buffer.from("mov-bytes"));
    mockRemuxToMp4.mockResolvedValue(Buffer.from("remuxed-mp4-bytes"));
    mockUploadBuffer.mockResolvedValue({ url: "https://r2.example/remuxed.mp4" } as never);

    const res = await GET(fakeReq, makeParams("post1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockGetObject).toHaveBeenCalledWith("https://r2.example/clip.mov");
    expect(mockRemuxToMp4).toHaveBeenCalledWith(Buffer.from("mov-bytes"));
    expect(mockUploadBuffer).toHaveBeenCalledWith(
      expect.stringMatching(/\.mp4$/),
      Buffer.from("remuxed-mp4-bytes"),
      { contentType: "video/mp4" },
    );
    expect(body).toEqual({
      media: [{ id: "media1", mimeType: "video/mp4", url: "https://r2.example/remuxed.mp4" }],
    });
  });

  it("does not remux a video that's already mp4", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user1" } } as never);
    mockFindFirst.mockResolvedValue({
      media: [
        {
          id: "media1",
          mimeType: "video/mp4",
          storageKey: "https://r2.example/clip.mp4",
          hasAudio: true,
          audioTrack: null,
        },
      ],
    } as never);
    mockPreparePublishKeys.mockResolvedValue(["https://r2.example/clip.mp4"]);

    const res = await GET(fakeReq, makeParams("post1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockRemuxToMp4).not.toHaveBeenCalled();
    expect(body).toEqual({
      media: [{ id: "media1", mimeType: "video/mp4", url: "https://r2.example/clip.mp4" }],
    });
  });
});
