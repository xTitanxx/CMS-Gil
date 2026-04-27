import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    media: { findFirst: vi.fn(), delete: vi.fn(), update: vi.fn() },
    audioTrack: { findFirst: vi.fn() },
  },
}));
vi.mock("@/lib/storage", () => ({
  deleteObject: vi.fn(),
  getMediaUrl: vi.fn(),
  getSignedDownloadUrl: vi.fn(),
}));

import { DELETE, PATCH } from "./route";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { deleteObject, getMediaUrl, getSignedDownloadUrl } from "@/lib/storage";

const fakeReq = {} as NextRequest;

const mockAuth = vi.mocked(auth);
const mockFindFirst = vi.mocked(prisma.media.findFirst);
const mockDeleteRecord = vi.mocked(prisma.media.delete);
const mockDeleteObject = vi.mocked(deleteObject);

function makeParams(id: string, mediaId: string) {
  return { params: Promise.resolve({ id, mediaId }) };
}

describe("DELETE /api/posts/[id]/media/[mediaId]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue(null as never);
    const res = await DELETE(fakeReq, makeParams("post1", "media1"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when media does not belong to user", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user1" } } as never);
    mockFindFirst.mockResolvedValue(null);
    const res = await DELETE(fakeReq, makeParams("post1", "media1"));
    expect(res.status).toBe(404);
    expect(mockFindFirst).toHaveBeenCalledWith({
      where: { id: "media1", post: { id: "post1", userId: "user1" } },
    });
  });

  it("deletes from storage and DB when authorized", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user1" } } as never);
    mockFindFirst.mockResolvedValue({
      id: "media1",
      storageKey: "users/user1/photo.jpg",
      mimeType: "image/jpeg",
    } as never);
    mockDeleteObject.mockResolvedValue(undefined);
    mockDeleteRecord.mockResolvedValue({} as never);

    const res = await DELETE(fakeReq, makeParams("post1", "media1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(mockDeleteObject).toHaveBeenCalledWith("users/user1/photo.jpg");
    expect(mockDeleteRecord).toHaveBeenCalledWith({ where: { id: "media1" } });
  });

  it("still deletes DB record if storage delete fails", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockAuth.mockResolvedValue({ user: { id: "user1" } } as never);
    mockFindFirst.mockResolvedValue({
      id: "media1",
      storageKey: "users/user1/photo.jpg",
      mimeType: "image/jpeg",
    } as never);
    mockDeleteObject.mockRejectedValue(new Error("Cloudinary error"));
    mockDeleteRecord.mockResolvedValue({} as never);

    const res = await DELETE(fakeReq, makeParams("post1", "media1"));
    expect(res.status).toBe(200);
    expect(mockDeleteRecord).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

describe("PATCH /api/posts/[id]/media/[mediaId]", () => {
  const mockUpdate = vi.mocked(prisma.media.update);
  const mockAudioFind = vi.mocked(prisma.audioTrack.findFirst);
  const mockGetMediaUrl = vi.mocked(getMediaUrl);
  const mockGetSignedDownloadUrl = vi.mocked(getSignedDownloadUrl);

  beforeEach(() => vi.clearAllMocks());

  function makeReq(body: unknown): NextRequest {
    return { json: async () => body } as unknown as NextRequest;
  }

  it("returns the audio track URL after attaching music to a video", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user1" } } as never);
    mockFindFirst.mockResolvedValue({
      id: "media1",
      mimeType: "video/mp4",
      storageKey: "https://r2.example/video.mp4",
    } as never);
    mockAudioFind.mockResolvedValue({ id: "track1" } as never);
    mockUpdate.mockResolvedValue({
      id: "media1",
      mimeType: "video/mp4",
      hasAudio: false,
      storageKey: "https://r2.example/video.mp4",
      audioTrack: {
        id: "track1",
        title: "Sunset Vibes",
        storageKey: "https://r2.example/audio.mp3",
      },
    } as never);
    mockGetMediaUrl.mockResolvedValue("https://r2.example/video.mp4");
    mockGetSignedDownloadUrl.mockResolvedValue("https://r2.example/audio.mp3");

    const res = await PATCH(
      makeReq({ audioTrackId: "track1" }),
      makeParams("post1", "media1"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.audioTrack).toEqual({
      id: "track1",
      title: "Sunset Vibes",
      url: "https://r2.example/audio.mp3",
    });
    expect(body.url).toBe("https://r2.example/video.mp4");
    expect(mockGetSignedDownloadUrl).toHaveBeenCalledWith(
      "https://r2.example/audio.mp3",
    );
  });

  it("returns null audioTrack when clearing music", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user1" } } as never);
    mockFindFirst.mockResolvedValue({
      id: "media1",
      mimeType: "video/mp4",
      storageKey: "https://r2.example/video.mp4",
    } as never);
    mockUpdate.mockResolvedValue({
      id: "media1",
      mimeType: "video/mp4",
      hasAudio: false,
      storageKey: "https://r2.example/video.mp4",
      audioTrack: null,
    } as never);
    mockGetMediaUrl.mockResolvedValue("https://r2.example/video.mp4");

    const res = await PATCH(
      makeReq({ audioTrackId: null }),
      makeParams("post1", "media1"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.audioTrack).toBeNull();
    expect(mockGetSignedDownloadUrl).not.toHaveBeenCalled();
  });
});
