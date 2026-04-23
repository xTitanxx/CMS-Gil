import { describe, expect, it } from "vitest";
import {
  buildCursorClause,
  buildNeighborQueries,
  buildPostsQuery,
  cursorFromRow,
  decodeCursor,
  encodeCursor,
  parsePostsFilters,
  parseSort,
} from "./posts-query";

describe("parseSort", () => {
  it("defaults to originalDate desc", () => {
    expect(parseSort(undefined)).toEqual({ field: "originalDate", dir: "desc" });
    expect(parseSort("bogus")).toEqual({ field: "originalDate", dir: "desc" });
  });
  it("maps the supported keys", () => {
    expect(parseSort("originalDate_asc")).toEqual({ field: "originalDate", dir: "asc" });
    expect(parseSort("createdAt_desc")).toEqual({ field: "createdAt", dir: "desc" });
    expect(parseSort("createdAt_asc")).toEqual({ field: "createdAt", dir: "asc" });
  });
});

describe("parsePostsFilters", () => {
  it("reads from a Next.js-style searchParams object", () => {
    const filters = parsePostsFilters({
      search: "hello",
      tags: "a,b",
      sort: "originalDate_asc",
      audio: "silent",
    });
    expect(filters).toEqual({
      search: "hello",
      tags: "a,b",
      sort: "originalDate_asc",
      audio: "silent",
      from: undefined,
      to: undefined,
    });
  });
  it("reads from a URLSearchParams instance", () => {
    const sp = new URLSearchParams("search=hi&tags=travel");
    expect(parsePostsFilters(sp).search).toBe("hi");
    expect(parsePostsFilters(sp).tags).toBe("travel");
  });
});

describe("buildPostsQuery", () => {
  it("always orders by composite (field, id) to tiebreak", () => {
    const { orderBy } = buildPostsQuery({}, "user_1");
    expect(orderBy).toEqual([
      { originalDate: "desc" },
      { id: "desc" },
    ]);
  });
  it("scopes to the user", () => {
    const { where } = buildPostsQuery({}, "user_1");
    expect(where).toMatchObject({ userId: "user_1" });
  });
  it("applies tag filter with hasSome", () => {
    const { where } = buildPostsQuery({ tags: "travel,food" }, "user_1");
    expect(where).toMatchObject({ tags: { hasSome: ["travel", "food"] } });
  });
  it("applies audio=silent clause", () => {
    const { where } = buildPostsQuery({ audio: "silent" }, "user_1");
    const w = where as Record<string, unknown>;
    const andClauses = w.AND as Array<Record<string, unknown>> | undefined;
    const audioClause = andClauses?.find((c) => Array.isArray(c.OR));
    expect(audioClause).toBeDefined();
  });
});

describe("buildPostsQuery extraWhere option", () => {
  it("AND-merges extraWhere clauses into the resulting where", () => {
    const { where } = buildPostsQuery(
      { kind: "posts" },
      "user-1",
      {
        extraWhere: [
          { readiness: "NOT_READY" },
          { notReadyReasons: { has: "silent-video" } },
        ],
      },
    );
    const ands = (where.AND ?? []) as Array<Record<string, unknown>>;
    expect(ands).toEqual(
      expect.arrayContaining([
        { readiness: "NOT_READY" },
        { notReadyReasons: { has: "silent-video" } },
      ]),
    );
  });

  it("ignores missing/empty extraWhere", () => {
    const { where } = buildPostsQuery({ kind: "posts" }, "user-1");
    expect(where.userId).toBe("user-1");
  });
});

describe("cursor encoding", () => {
  it("round-trips", () => {
    const c = { value: "2024-01-01T00:00:00.000Z", id: "abc123" };
    const s = encodeCursor(c);
    expect(typeof s).toBe("string");
    expect(decodeCursor(s)).toEqual(c);
  });
  it("rejects garbage", () => {
    expect(decodeCursor("garbage")).toBeNull();
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor("")).toBeNull();
  });
  it("cursorFromRow picks the sort field", () => {
    const row = {
      id: "p1",
      originalDate: new Date("2024-01-01"),
      createdAt: new Date("2024-02-02"),
    };
    expect(cursorFromRow("originalDate_desc", row).value).toBe(
      row.originalDate.toISOString(),
    );
    expect(cursorFromRow("createdAt_desc", row).value).toBe(
      row.createdAt.toISOString(),
    );
  });
});

describe("buildCursorClause", () => {
  it("uses lt for desc sort", () => {
    const clause = buildCursorClause("originalDate_desc", {
      value: "2024-01-01T00:00:00.000Z",
      id: "abc",
    });
    const or = (clause as { OR: Array<Record<string, unknown>> }).OR;
    expect(or).toHaveLength(2);
    expect(or[0]).toEqual({
      originalDate: { lt: new Date("2024-01-01T00:00:00.000Z") },
    });
    expect(or[1]).toEqual({
      originalDate: new Date("2024-01-01T00:00:00.000Z"),
      id: { lt: "abc" },
    });
  });
  it("uses gt for asc sort", () => {
    const clause = buildCursorClause("originalDate_asc", {
      value: "2024-01-01T00:00:00.000Z",
      id: "abc",
    });
    const or = (clause as { OR: Array<Record<string, unknown>> }).OR;
    expect(or[0]).toEqual({
      originalDate: { gt: new Date("2024-01-01T00:00:00.000Z") },
    });
  });
});

describe("buildNeighborQueries", () => {
  const current = {
    id: "p1",
    originalDate: new Date("2024-06-01"),
    createdAt: new Date("2024-07-01"),
  };
  it("desc sort: prev uses gt + asc, next uses lt + desc", () => {
    const { prevWhere, prevOrderBy, nextWhere, nextOrderBy } =
      buildNeighborQueries("originalDate_desc", current);
    expect(prevOrderBy[0]).toEqual({ originalDate: "asc" });
    expect(prevOrderBy[1]).toEqual({ id: "asc" });
    expect(nextOrderBy[0]).toEqual({ originalDate: "desc" });
    expect(nextOrderBy[1]).toEqual({ id: "desc" });

    const prevOr = (prevWhere as { OR: Array<Record<string, unknown>> }).OR;
    expect(prevOr[0]).toEqual({ originalDate: { gt: current.originalDate } });
    expect(prevOr[1]).toEqual({
      originalDate: current.originalDate,
      id: { gt: "p1" },
    });

    const nextOr = (nextWhere as { OR: Array<Record<string, unknown>> }).OR;
    expect(nextOr[0]).toEqual({ originalDate: { lt: current.originalDate } });
    expect(nextOr[1]).toEqual({
      originalDate: current.originalDate,
      id: { lt: "p1" },
    });
  });
  it("asc sort flips directions", () => {
    const { prevWhere, prevOrderBy, nextWhere, nextOrderBy } =
      buildNeighborQueries("originalDate_asc", current);
    expect(prevOrderBy[0]).toEqual({ originalDate: "desc" });
    expect(nextOrderBy[0]).toEqual({ originalDate: "asc" });

    const prevOr = (prevWhere as { OR: Array<Record<string, unknown>> }).OR;
    expect(prevOr[0]).toEqual({ originalDate: { lt: current.originalDate } });

    const nextOr = (nextWhere as { OR: Array<Record<string, unknown>> }).OR;
    expect(nextOr[0]).toEqual({ originalDate: { gt: current.originalDate } });
  });
  it("createdAt sort uses createdAt as the cursor field", () => {
    const { prevWhere } = buildNeighborQueries("createdAt_desc", current);
    const prevOr = (prevWhere as { OR: Array<Record<string, unknown>> }).OR;
    expect(prevOr[0]).toEqual({ createdAt: { gt: current.createdAt } });
  });
});
