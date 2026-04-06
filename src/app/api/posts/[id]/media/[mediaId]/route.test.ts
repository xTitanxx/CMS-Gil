import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: { media: { findFirst: vi.fn(), delete: vi.fn() } },
}));
vi.mock("@/lib/storage", () => ({ deleteObject: vi.fn() }));

import { DELETE } from "./route";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { deleteObject } from "@/lib/storage";

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
    mockAuth.mockResolvedValue(null);
    const res = await DELETE({} as Request, makeParams("post1", "media1"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when media does not belong to user", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user1" } } as never);
    mockFindFirst.mockResolvedValue(null);
    const res = await DELETE({} as Request, makeParams("post1", "media1"));
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

    const res = await DELETE({} as Request, makeParams("post1", "media1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(mockDeleteObject).toHaveBeenCalledWith("users/user1/photo.jpg", "image/jpeg");
    expect(mockDeleteRecord).toHaveBeenCalledWith({ where: { id: "media1" } });
  });

  it("still deletes DB record if storage delete fails", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user1" } } as never);
    mockFindFirst.mockResolvedValue({
      id: "media1",
      storageKey: "users/user1/photo.jpg",
      mimeType: "image/jpeg",
    } as never);
    mockDeleteObject.mockRejectedValue(new Error("Cloudinary error"));
    mockDeleteRecord.mockResolvedValue({} as never);

    const res = await DELETE({} as Request, makeParams("post1", "media1"));
    expect(res.status).toBe(200);
    expect(mockDeleteRecord).toHaveBeenCalled();
  });
});
