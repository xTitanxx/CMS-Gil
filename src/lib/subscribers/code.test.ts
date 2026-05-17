import { describe, it, expect } from "vitest";
import {
  deriveCodeFromName,
  generateCode,
  hashCode,
  isWellFormedCode,
  normalizeCode,
  verifyCode,
} from "./code";

describe("subscriber code", () => {
  it("generates a code matching the gil-{8 alnum} format", () => {
    const code = generateCode();
    expect(code).toMatch(/^gil-[a-z0-9]{8}$/);
  });

  it("generates distinct codes across calls", () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateCode()));
    expect(codes.size).toBe(50);
  });

  it("hashes a code so the hash differs from the plaintext", async () => {
    const code = generateCode();
    const hash = await hashCode(code);
    expect(hash).not.toEqual(code);
    expect(hash.length).toBeGreaterThan(20);
  });

  it("verifies a correct code against its hash", async () => {
    const code = generateCode();
    const hash = await hashCode(code);
    expect(await verifyCode(code, hash)).toBe(true);
  });

  it("rejects a wrong code against a hash", async () => {
    const hash = await hashCode(generateCode());
    expect(await verifyCode("gil-wrongone", hash)).toBe(false);
  });

  it("normalizeCode trims and lowercases", () => {
    expect(normalizeCode("  Gil-Bob  ")).toBe("gil-bob");
    expect(normalizeCode("GIL-BOB")).toBe("gil-bob");
    expect(normalizeCode("gil-bob")).toBe("gil-bob");
  });

  it("deriveCodeFromName produces a lowercase code", () => {
    expect(deriveCodeFromName("Bob")).toBe("gil-bob");
    expect(deriveCodeFromName("Alice Smith")).toBe("gil-alicesmith");
    expect(deriveCodeFromName("")).toBe("");
  });

  it("verifyCode is case-insensitive on the typed code", async () => {
    const hash = await hashCode("gil-bob");
    expect(await verifyCode("gil-bob", hash)).toBe(true);
    expect(await verifyCode("Gil-Bob", hash)).toBe(true);
    expect(await verifyCode("GIL-BOB", hash)).toBe(true);
    expect(await verifyCode("  gil-bob  ", hash)).toBe(true);
    expect(await verifyCode("gil-alice", hash)).toBe(false);
  });

  it("isWellFormedCode accepts uppercase input but only lowercase suffix chars", () => {
    expect(isWellFormedCode("gil-bob")).toBe(true);
    expect(isWellFormedCode("Gil-Bob")).toBe(true); // normalize first
    expect(isWellFormedCode("gil-bob_smith")).toBe(false); // underscore not allowed
    expect(isWellFormedCode("notgil-bob")).toBe(false);
    expect(isWellFormedCode("gil-")).toBe(false);
  });
});
