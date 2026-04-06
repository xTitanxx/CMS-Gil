import { describe, it, expect } from "vitest";
import { getGridDays, getDateRange, groupEntriesByDate } from "./calendar-utils";
import type { CalendarEntry } from "./types";

describe("getGridDays", () => {
  it("month view: returns 35+ days, starts Sunday, ends Saturday", () => {
    const cursor = new Date("2026-04-15");
    const days = getGridDays("month", cursor);
    expect(days.length).toBeGreaterThanOrEqual(35);
    expect(days[0].getDay()).toBe(0);
    expect(days[days.length - 1].getDay()).toBe(6);
  });

  it("week view: returns exactly 7 days, starts Sunday, ends Saturday", () => {
    const cursor = new Date("2026-04-15");
    const days = getGridDays("week", cursor);
    expect(days.length).toBe(7);
    expect(days[0].getDay()).toBe(0);
    expect(days[6].getDay()).toBe(6);
  });
});

describe("getDateRange", () => {
  it("start <= end and start is a Sunday", () => {
    const { start, end } = getDateRange("month", new Date("2026-04-15"));
    expect(start <= end).toBe(true);
    expect(start.getDay()).toBe(0);
  });

  it("week range spans exactly 7 days", () => {
    const { start, end } = getDateRange("week", new Date("2026-04-15"));
    const diff = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
    expect(diff).toBe(6);
  });
});

describe("groupEntriesByDate", () => {
  it("groups entries by date key", () => {
    const entries: CalendarEntry[] = [
      { postId: "a", date: "2026-04-06", status: "PENDING", thumbUrl: null, body: "foo" },
      { postId: "b", date: "2026-04-06", status: "PUBLISHED", thumbUrl: null, body: "bar" },
      { postId: "c", date: "2026-04-07", status: "IMPORTED", thumbUrl: null, body: "baz" },
    ];
    const grouped = groupEntriesByDate(entries);
    expect(grouped["2026-04-06"]).toHaveLength(2);
    expect(grouped["2026-04-07"]).toHaveLength(1);
    expect(grouped["2026-04-08"]).toBeUndefined();
  });

  it("returns empty object for no entries", () => {
    expect(groupEntriesByDate([])).toEqual({});
  });
});
