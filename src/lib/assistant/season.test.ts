import { describe, it, expect } from "vitest";
import { currentSeason, seasonFit } from "./season";

describe("currentSeason", () => {
  it("maps December to WINTER", () => {
    expect(currentSeason(new Date("2026-12-15"))).toBe("WINTER");
  });
  it("maps February to WINTER", () => {
    expect(currentSeason(new Date("2026-02-10"))).toBe("WINTER");
  });
  it("maps April to SPRING", () => {
    expect(currentSeason(new Date("2026-04-16"))).toBe("SPRING");
  });
  it("maps July to SUMMER", () => {
    expect(currentSeason(new Date("2026-07-04"))).toBe("SUMMER");
  });
  it("maps October to FALL", () => {
    expect(currentSeason(new Date("2026-10-20"))).toBe("FALL");
  });
});

describe("seasonFit", () => {
  it("returns 1 when seasons match", () => {
    expect(seasonFit("SPRING", "SPRING")).toBe(1);
  });
  it("returns 0.3 when seasons are adjacent", () => {
    expect(seasonFit("SPRING", "SUMMER")).toBe(0.3);
    expect(seasonFit("SPRING", "WINTER")).toBe(0.3);
  });
  it("returns -1 when seasons are opposite", () => {
    expect(seasonFit("SPRING", "FALL")).toBe(-1);
    expect(seasonFit("SUMMER", "WINTER")).toBe(-1);
  });
});
