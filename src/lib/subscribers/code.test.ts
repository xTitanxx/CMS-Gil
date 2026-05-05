import { describe, it, expect } from "vitest";
import { generateCode, hashCode, verifyCode } from "./code";

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
});
