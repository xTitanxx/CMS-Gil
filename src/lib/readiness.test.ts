import { describe, it, expect } from "vitest";
import { computeReadiness } from "./readiness";

const basePost = {
  body: "A reflective post.",
  share: null as unknown,
  readiness: "UNCHECKED" as const,
  notReadyReasons: [] as string[],
};

describe("computeReadiness", () => {
  it("returns READY for a normal post with body", () => {
    expect(computeReadiness(basePost, [])).toEqual({
      readiness: "READY",
      reasons: [],
    });
  });

  it("flags empty when body blank and no media", () => {
    expect(computeReadiness({ ...basePost, body: "   " }, [])).toEqual({
      readiness: "NOT_READY",
      reasons: ["empty"],
    });
  });

  it("does NOT flag empty when body is blank but media exists", () => {
    const r = computeReadiness({ ...basePost, body: "" }, [
      { mimeType: "image/jpeg", hasAudio: null },
    ]);
    expect(r.readiness).toBe("READY");
  });

  it("flags silent-video when any video has hasAudio=false", () => {
    const r = computeReadiness(basePost, [
      { mimeType: "video/mp4", hasAudio: false },
    ]);
    expect(r.reasons).toContain("silent-video");
    expect(r.readiness).toBe("NOT_READY");
  });

  it("flags unchecked-audio when video has hasAudio=null", () => {
    const r = computeReadiness(basePost, [
      { mimeType: "video/mp4", hasAudio: null },
    ]);
    expect(r.reasons).toContain("unchecked-audio");
  });

  it("prefers silent-video over unchecked-audio when both present", () => {
    const r = computeReadiness(basePost, [
      { mimeType: "video/mp4", hasAudio: false },
      { mimeType: "video/mp4", hasAudio: null },
    ]);
    expect(r.reasons).toContain("silent-video");
    expect(r.reasons).not.toContain("unchecked-audio");
  });

  it("flags share-only when share present and body < 20 chars", () => {
    const r = computeReadiness(
      { ...basePost, body: "nice", share: { url: "https://x.com" } },
      []
    );
    expect(r.reasons).toContain("share-only");
  });

  it("flags share-only when body is only a URL", () => {
    const r = computeReadiness(
      { ...basePost, body: "https://example.com/thing" },
      []
    );
    expect(r.reasons).toContain("share-only");
  });

  it("preserves dont-post flag across computation", () => {
    const r = computeReadiness(
      { ...basePost, notReadyReasons: ["dont-post"] },
      []
    );
    expect(r.reasons).toContain("dont-post");
    expect(r.readiness).toBe("NOT_READY");
  });

  it("short-circuits on ARCHIVED", () => {
    const r = computeReadiness(
      { ...basePost, readiness: "ARCHIVED", notReadyReasons: ["silent-video"] },
      []
    );
    expect(r.readiness).toBe("ARCHIVED");
    expect(r.reasons).toEqual(["silent-video"]);
  });
});
