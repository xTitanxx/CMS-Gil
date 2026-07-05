import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    post: { findFirst: vi.fn(), update: vi.fn() },
    publishRecord: { create: vi.fn() },
  },
}));

import { POST } from "./route";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const mockAuth = vi.mocked(auth);
const mockFindFirst = vi.mocked(prisma.post.findFirst);
const mockPostUpdate = vi.mocked(prisma.post.update);
const mockRecordCreate = vi.mocked(prisma.publishRecord.create);

function makeReq(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}
function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/posts/[id]/manual-publish", () => {
  beforeEach(() => vi.clearAllMocks());

  it("clears fbShareStartedAt after a manual FACEBOOK publish is recorded", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user1" } } as never);
    mockFindFirst.mockResolvedValue({ id: "post1" } as never);
    mockRecordCreate.mockResolvedValue({ id: "record1" } as never);
    mockPostUpdate.mockResolvedValue({} as never);

    const res = await POST(
      makeReq({ platform: "FACEBOOK", status: "PUBLISHED" }),
      makeParams("post1"),
    );

    expect(res.status).toBe(200);
    expect(mockPostUpdate).toHaveBeenCalledWith({
      where: { id: "post1" },
      data: { fbShareStartedAt: null },
    });
  });

  it("clears fbShareStartedAt when the manual FACEBOOK entry is a skip (CANCELLED)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user1" } } as never);
    mockFindFirst.mockResolvedValue({ id: "post1" } as never);
    mockRecordCreate.mockResolvedValue({ id: "record1" } as never);
    mockPostUpdate.mockResolvedValue({} as never);

    await POST(
      makeReq({ platform: "FACEBOOK", status: "CANCELLED" }),
      makeParams("post1"),
    );

    expect(mockPostUpdate).toHaveBeenCalledWith({
      where: { id: "post1" },
      data: { fbShareStartedAt: null },
    });
  });

  it("does not touch fbShareStartedAt for non-Facebook platforms", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user1" } } as never);
    mockFindFirst.mockResolvedValue({ id: "post1" } as never);
    mockRecordCreate.mockResolvedValue({ id: "record1" } as never);

    await POST(
      makeReq({ platform: "LINKEDIN", status: "PUBLISHED" }),
      makeParams("post1"),
    );

    expect(mockPostUpdate).not.toHaveBeenCalled();
  });
});
