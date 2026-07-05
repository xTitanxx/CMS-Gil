import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: { post: { create: vi.fn() } },
}));
vi.mock("@/lib/readiness-service", () => ({ refreshReadiness: vi.fn() }));

import { POST } from "./route";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { refreshReadiness } from "@/lib/readiness-service";

const mockAuth = vi.mocked(auth);
const mockCreate = vi.mocked(prisma.post.create);
const mockRefreshReadiness = vi.mocked(refreshReadiness);

function makeReq(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

describe("POST /api/posts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sets fbShareStartedAt when intendedForFacebook is true", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user1" } } as never);
    mockCreate.mockResolvedValue({ id: "post1" } as never);
    mockRefreshReadiness.mockResolvedValue(undefined as never);

    await POST(makeReq({ text: "hello", intendedForFacebook: true }));

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const data = mockCreate.mock.calls[0][0].data;
    expect(data.fbShareStartedAt).toBeInstanceOf(Date);
  });

  it("leaves fbShareStartedAt null when intendedForFacebook is omitted", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user1" } } as never);
    mockCreate.mockResolvedValue({ id: "post1" } as never);
    mockRefreshReadiness.mockResolvedValue(undefined as never);

    await POST(makeReq({ text: "hello" }));

    const data = mockCreate.mock.calls[0][0].data;
    expect(data.fbShareStartedAt).toBeNull();
  });
});
