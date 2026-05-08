import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    googleIntegration: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
    account: { findFirst: vi.fn() },
  },
}));

import {
  decodeIdTokenClaims,
  deleteGoogleIntegration,
  getGoogleIntegration,
  hasYouTubeScope,
  upsertGoogleIntegration,
} from "./google-integration";
import { prisma } from "@/lib/prisma";
import { encryptGoogleToken, isEncryptedGoogleToken } from "./google-tokens";

const findUnique = prisma.googleIntegration.findUnique as unknown as ReturnType<typeof vi.fn>;
const accountFindFirst = prisma.account.findFirst as unknown as ReturnType<typeof vi.fn>;
const upsert = prisma.googleIntegration.upsert as unknown as ReturnType<typeof vi.fn>;
const deleteMany = prisma.googleIntegration.deleteMany as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ENCRYPTION_KEY =
    process.env.ENCRYPTION_KEY ?? "0".repeat(64);
});

describe("hasYouTubeScope", () => {
  it("matches the youtube substring anywhere in the scope string", () => {
    expect(hasYouTubeScope("openid email https://www.googleapis.com/auth/youtube.upload")).toBe(true);
    expect(hasYouTubeScope("openid email profile")).toBe(false);
    expect(hasYouTubeScope(null)).toBe(false);
    expect(hasYouTubeScope(undefined)).toBe(false);
  });
});

describe("getGoogleIntegration", () => {
  it("returns decrypted tokens from the GoogleIntegration row", async () => {
    findUnique.mockResolvedValue({
      accessToken: encryptGoogleToken("at-1", "u1"),
      refreshToken: encryptGoogleToken("rt-1", "u1"),
      scope: "openid youtube.upload",
      expiresAt: 1234567890,
      email: "x@gmail.com",
      youtubeChannelId: "CH-1",
      youtubeChannelTitle: "Gil",
    });
    const result = await getGoogleIntegration("u1");
    expect(result).toEqual({
      accessToken: "at-1",
      refreshToken: "rt-1",
      scope: "openid youtube.upload",
      expiresAt: 1234567890,
      email: "x@gmail.com",
      youtubeChannelId: "CH-1",
      youtubeChannelTitle: "Gil",
    });
    expect(accountFindFirst).not.toHaveBeenCalled();
  });

  it("falls back to the legacy Account row when no GoogleIntegration exists", async () => {
    findUnique.mockResolvedValue(null);
    accountFindFirst.mockResolvedValue({
      access_token: encryptGoogleToken("legacy-at", "u2"),
      refresh_token: encryptGoogleToken("legacy-rt", "u2"),
      scope: "openid drive.readonly youtube.readonly",
      expires_at: 999,
    });
    const result = await getGoogleIntegration("u2");
    expect(result?.accessToken).toBe("legacy-at");
    expect(result?.refreshToken).toBe("legacy-rt");
    expect(result?.scope).toContain("youtube");
    expect(result?.email).toBeNull();
  });

  it("returns null when neither table has data", async () => {
    findUnique.mockResolvedValue(null);
    accountFindFirst.mockResolvedValue(null);
    expect(await getGoogleIntegration("u3")).toBeNull();
  });

  it("returns null when the legacy Account has no access_token", async () => {
    findUnique.mockResolvedValue(null);
    accountFindFirst.mockResolvedValue({ access_token: null, refresh_token: null, scope: null, expires_at: null });
    expect(await getGoogleIntegration("u4")).toBeNull();
  });
});

describe("upsertGoogleIntegration", () => {
  it("encrypts the access token and refresh token before storing", async () => {
    upsert.mockResolvedValue(undefined);
    await upsertGoogleIntegration({
      userId: "u1",
      googleSub: "1234567890",
      email: "x@gmail.com",
      accessToken: "raw-at",
      refreshToken: "raw-rt",
      expiresAt: 42,
      scope: "openid youtube.upload",
    });
    const args = upsert.mock.calls[0][0];
    expect(args.where).toEqual({ userId: "u1" });
    expect(isEncryptedGoogleToken(args.create.accessToken)).toBe(true);
    expect(isEncryptedGoogleToken(args.create.refreshToken)).toBe(true);
    // Plaintext must not appear in the encoded payload.
    expect(args.create.accessToken).not.toContain("raw-at");
    expect(args.create.refreshToken).not.toContain("raw-rt");
    // Update path leaves refreshToken alone when not provided.
    expect(args.update.refreshToken).toBeDefined();
  });

  it("omits refreshToken on update when none was passed", async () => {
    upsert.mockResolvedValue(undefined);
    await upsertGoogleIntegration({
      userId: "u1",
      googleSub: "abc",
      email: "x@gmail.com",
      accessToken: "raw-at",
      // no refreshToken
    });
    const args = upsert.mock.calls[0][0];
    expect(args.update.refreshToken).toBeUndefined();
    expect(args.create.refreshToken).toBeNull();
  });
});

describe("deleteGoogleIntegration", () => {
  it("deletes the row by userId", async () => {
    deleteMany.mockResolvedValue({ count: 1 });
    await deleteGoogleIntegration("u1");
    expect(deleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } });
  });
});

describe("decodeIdTokenClaims", () => {
  it("extracts sub and email from a JWT body", () => {
    const payload = Buffer.from(JSON.stringify({ sub: "1234", email: "x@gmail.com" })).toString("base64url");
    const idToken = `header.${payload}.sig`;
    expect(decodeIdTokenClaims(idToken)).toEqual({ sub: "1234", email: "x@gmail.com" });
  });

  it("returns null on malformed tokens", () => {
    expect(decodeIdTokenClaims("not.a.jwt")).toBeNull();
    expect(decodeIdTokenClaims("only.twoparts")).toBeNull();
    const noEmail = Buffer.from(JSON.stringify({ sub: "1234" })).toString("base64url");
    expect(decodeIdTokenClaims(`h.${noEmail}.s`)).toBeNull();
  });
});
