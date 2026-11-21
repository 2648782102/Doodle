import { describe, expect, it } from "vitest";
import { describeEntry, orderLibrary, relativeTime } from "../dist/infra/templates/client/library-list.js";
import { readFileSync } from "node:fs";

function entry(id, name, extra = {}) {
  return { id, name, revision: 1, itemCount: 0, updatedAt: "2026-01-01T00:00:00.000Z", ...extra };
}

describe("board library list", () => {
  it("filters by name, case-insensitively", () => {
    const boards = [entry("a", "和 AI 一起画"), entry("b", "Roadmap"), entry("c", "road trip")];
    // Equal timestamps tie-break by id, so the two "road…" boards stay stable.
    expect(orderLibrary(boards, "road", "recent").map((item) => item.id)).toEqual(["b", "c"]);
    // Blank and whitespace-only queries are not a filter.
    expect(orderLibrary(boards, "   ", "recent")).toHaveLength(3);
  });

  it("keeps the active board first in both orders", () => {
    /*
     * The active board is the one a person is looking at. Sorting it into the
     * middle of twenty identically named boards is how it gets lost.
     */
    const boards = [
      entry("a", "Zeta", { updatedAt: "2026-01-03T00:00:00.000Z" }),
      entry("b", "Alpha", { active: true, updatedAt: "2026-01-01T00:00:00.000Z" }),
      entry("c", "Beta", { updatedAt: "2026-01-02T00:00:00.000Z" }),
    ];
    expect(orderLibrary(boards, "", "recent")[0].id).toBe("b");
    expect(orderLibrary(boards, "", "name")[0].id).toBe("b");
  });

  it("orders by recency, then by name", () => {
    const boards = [
      entry("old", "B", { updatedAt: "2026-01-01T00:00:00.000Z" }),
      entry("new", "A", { updatedAt: "2026-01-05T00:00:00.000Z" }),
    ];
    expect(orderLibrary(boards, "", "recent").map((item) => item.id)).toEqual(["new", "old"]);
    expect(orderLibrary(boards, "", "name").map((item) => item.id)).toEqual(["new", "old"]);
  });

  it("survives a malformed timestamp instead of emitting Invalid Date", () => {
    const boards = [entry("bad", "A", { updatedAt: "not a date" }), entry("ok", "B")];
    expect(() => orderLibrary(boards, "", "recent")).not.toThrow();
    expect(relativeTime("not a date")).toBe("");
    expect(describeEntry(entry("x", "A", { updatedAt: undefined }))).toBe("0 个对象");
  });

  it("says 刚刚 for something saved seconds ago", () => {
    const now = Date.parse("2026-01-01T12:00:00.000Z");
    expect(relativeTime("2026-01-01T11:59:30.000Z", now)).toBe("刚刚");
    expect(relativeTime("2026-01-01T11:45:00.000Z", now)).toBe("15 分钟前");
    expect(relativeTime("2026-01-01T09:00:00.000Z", now)).toBe("3 小时前");
    expect(relativeTime("2025-12-30T12:00:00.000Z", now)).toBe("2 天前");
    // Beyond a week a date is more useful than a count of days.
    expect(relativeTime("2025-12-01T12:00:00.000Z", now)).toBe("2025/12/1");
  });

  it("replaces the raw revision counter with something a person can read", () => {
    const now = Date.parse("2026-01-01T12:00:00.000Z");
    const text = describeEntry(entry("a", "Board", { itemCount: 8, revision: 586, updatedAt: "2026-01-01T11:00:00.000Z" }), now);
    expect(text).toBe("8 个对象 · 1 小时前");
    expect(text, "the internal revision leaked into the library").not.toContain("586");
  });

  it("keeps the library thumbnail off the active-board route", () => {
    /*
     * A row's picture must name its own board. Resolving to "the active board"
     * would make a row's image depend on which row happened to be active when
     * the request fired, and an `<img>` whose src silently changes meaning shows
     * the wrong board's picture.
     */
    const ui = readFileSync(new URL("../src/infra/templates/client/library-ui.ts", import.meta.url), "utf8");
    expect(ui).toContain("/api/board/library/");
    expect(ui, "the thumbnail falls back to the active board").not.toMatch(/thumbnailUrl[^\n]*\/api\/board\.svg/);
    // Embedded hosts have no page routes; the picture must be optional there.
    expect(ui).toContain("deps.transport.embedded");
  });
});
