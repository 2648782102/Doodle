/**
 * Recovering edits made while the board was unreachable.
 *
 * The whole point of this layer is the hard case: the person drew during an
 * outage *and* someone else drew meanwhile. A queue that only replays verbatim
 * would drop that work, so these tests are mostly about what happens when both
 * sides moved.
 */
import { describe, expect, it } from "vitest";
import { mergeBoardEdits } from "../dist/infra/templates/client/three-way-merge.js";
import { createPendingEdits } from "../dist/infra/templates/client/pending-edits.js";
import { recoverPendingEdit, recoverAll } from "../dist/infra/templates/client/recover-edits.js";

const item = (id, patch = {}) => ({
  id,
  type: "rect",
  x: 0, y: 0, w: 100, h: 50,
  color: "#f6d365",
  author: "human",
  ...patch,
});
const board = (id, revision, items) => ({ id, revision, items });

describe("three-way merge", () => {
  it("sends only what the person changed when nobody else moved", () => {
    const base = board("b", 1, [item("keep"), item("edit")]);
    const mine = board("b", 1, [item("keep"), item("edit", { x: 200 })]);
    const theirs = board("b", 2, [item("keep"), item("edit")]);
    const merged = mergeBoardEdits(base, mine, theirs);
    expect(merged.conflicts).toEqual([]);
    expect(merged.change.updates).toHaveLength(1);
    expect(merged.change.updates[0].id).toBe("edit");
    expect(merged.change.updates[0].patch.x).toBe(200);
    // An untouched object is never re-sent.
    expect(merged.change.updates.some((update) => update.id === "keep")).toBe(false);
  });

  it("keeps the person's new object even when someone else added one too", () => {
    const base = board("b", 1, []);
    const mine = board("b", 1, [item("mine_new")]);
    const theirs = board("b", 2, [item("ai_new")]);
    const merged = mergeBoardEdits(base, mine, theirs);
    expect(merged.conflicts).toEqual([]);
    expect(merged.change.items).toHaveLength(1);
    // Added items go out as inputs: the server mints the id.
    expect(merged.change.items[0].id).toBeUndefined();
    expect(merged.change.items[0].createdAt).toBeUndefined();
  });

  it("keeps the person's deletion and the other side's addition", () => {
    const base = board("b", 1, [item("gone")]);
    const mine = board("b", 1, []);
    const theirs = board("b", 2, [item("gone"), item("ai_new")]);
    const merged = mergeBoardEdits(base, mine, theirs);
    expect(merged.conflicts).toEqual([]);
    expect(merged.change.remove_ids).toEqual(["gone"]);
  });

  it("does not resurrect an object the other side deleted", () => {
    // The person changed a field on an object that is now gone entirely.
    const base = board("b", 1, [item("shared")]);
    const mine = board("b", 1, [item("shared", { x: 999 })]);
    const theirs = board("b", 2, []);
    const merged = mergeBoardEdits(base, mine, theirs);
    // Deleting wins only when the person did not touch it; here both moved, so
    // it is reported rather than silently dropping the person's edit.
    expect(merged.conflicts).toEqual(["shared"]);
    expect(merged.change.items).toHaveLength(0);
  });

  it("reports a genuine overlap and sends neither version", () => {
    const base = board("b", 1, [item("both")]);
    const mine = board("b", 1, [item("both", { x: 400 })]);
    const theirs = board("b", 2, [item("both", { x: 800 })]);
    const merged = mergeBoardEdits(base, mine, theirs);
    expect(merged.conflicts).toEqual(["both"]);
    expect(merged.change.updates).toHaveLength(0);
  });

  it("treats identical results from both sides as no conflict", () => {
    const base = board("b", 1, [item("same")]);
    const mine = board("b", 1, [item("same", { x: 300 })]);
    const theirs = board("b", 2, [item("same", { x: 300 })]);
    const merged = mergeBoardEdits(base, mine, theirs);
    expect(merged.conflicts).toEqual([]);
    expect(merged.change.updates).toHaveLength(0);
    expect(merged.noop).toBe(1);
    expect(merged.empty).toBe(true);
  });

  it("merges when both sides edited different objects", () => {
    const base = board("b", 1, [item("a"), item("b")]);
    const mine = board("b", 1, [item("a", { x: 50 }), item("b")]);
    const theirs = board("b", 2, [item("a"), item("b", { x: 70 })]);
    const merged = mergeBoardEdits(base, mine, theirs);
    expect(merged.conflicts).toEqual([]);
    expect(merged.change.updates.map((update) => update.id)).toEqual(["a"]);
  });

  it("refuses to merge onto a different board", () => {
    const base = board("b1", 1, []);
    const mine = board("b1", 1, [item("x")]);
    const theirs = board("b2", 9, []);
    const merged = mergeBoardEdits(base, mine, theirs);
    expect(merged.conflicts).toEqual(["__board__"]);
    expect(merged.empty).toBe(true);
  });

  it("ignores timestamp-only differences", () => {
    const base = board("b", 1, [item("a")]);
    const mine = board("b", 1, [item("a")]);
    const theirs = board("b", 2, [item("a", { updatedAt: "2026-01-01T00:00:00.000Z" })]);
    const merged = mergeBoardEdits(base, mine, theirs);
    expect(merged.conflicts).toEqual([]);
    expect(merged.empty).toBe(true);
  });
});

describe("pending edits storage", () => {
  const memory = () => {
    let value = [];
    return { read: async () => value, write: async (next) => { value = next; } };
  };
  const edit = (boardId, x = 0) => ({
    boardId,
    baseRevision: 1,
    base: board(boardId, 1, []),
    mine: board(boardId, 1, [item("n", { x })]),
  });

  it("keeps only the newest edit per board", async () => {
    const pending = createPendingEdits(memory());
    await pending.save(edit("b1", 10));
    await pending.save(edit("b1", 20));
    const all = await pending.all();
    expect(all).toHaveLength(1);
    expect(all[0].mine.items[0].x).toBe(20);
  });

  it("keeps boards apart and drops one at a time", async () => {
    const pending = createPendingEdits(memory());
    await pending.save(edit("b1"));
    await pending.save(edit("b2"));
    await pending.drop("b1");
    expect((await pending.all()).map((entry) => entry.boardId)).toEqual(["b2"]);
  });

  it("survives a corrupt store", async () => {
    const pending = createPendingEdits({ read: async () => "nonsense", write: async () => {} });
    expect(await pending.all()).toEqual([]);
  });
});

describe("recovery", () => {
  const edit = (boardId = "b1") => ({
    boardId,
    baseRevision: 1,
    base: board(boardId, 1, [item("a")]),
    mine: board(boardId, 1, [item("a", { x: 999 })]),
    queuedAt: "2026-01-01T00:00:00.000Z",
  });

  it("drops the copy when the board already contains the edit", async () => {
    let dropped = null;
    const outcome = await recoverPendingEdit(edit(), {
      load: async () => board("b1", 5, [item("a", { x: 999 })]),
      send: async () => { throw new Error("should not send"); },
      drop: async (id) => { dropped = id; },
    });
    expect(outcome.kind).toBe("already-merged");
    expect(dropped).toBe("b1");
  });

  it("sends the merge and drops the copy on success", async () => {
    let sent = null;
    let dropped = null;
    const outcome = await recoverPendingEdit(edit(), {
      load: async () => board("b1", 5, [item("a"), item("ai_added")]),
      send: async (_id, change, revision) => { sent = { change, revision }; },
      drop: async (id) => { dropped = id; },
    });
    expect(outcome.kind).toBe("merged");
    expect(sent.revision).toBe(5);
    expect(sent.change.updates[0].id).toBe("a");
    expect(dropped).toBe("b1");
  });

  it("keeps the copy on a conflict, naming the objects", async () => {
    let dropped = null;
    const outcome = await recoverPendingEdit(edit(), {
      load: async () => board("b1", 5, [item("a", { x: 111 })]),
      send: async () => { throw new Error("should not send"); },
      drop: async (id) => { dropped = id; },
    });
    expect(outcome.kind).toBe("conflict");
    expect(outcome.conflicts).toEqual(["a"]);
    expect(dropped).toBeNull();
  });

  it("keeps the copy when the send fails, so the next reconnect retries", async () => {
    let dropped = null;
    const outcome = await recoverPendingEdit(edit(), {
      load: async () => board("b1", 5, [item("a")]),
      send: async () => { throw new Error("offline again"); },
      drop: async (id) => { dropped = id; },
    });
    expect(outcome.kind).toBe("failed");
    expect(dropped).toBeNull();
  });

  it("reports a board that no longer exists", async () => {
    const outcome = await recoverPendingEdit(edit("gone"), {
      load: async () => null,
      send: async () => { throw new Error("should not send"); },
      drop: async () => {},
    });
    expect(outcome.kind).toBe("board-missing");
  });

  it("recovers each board independently", async () => {
    const outcomes = await recoverAll([edit("b1"), edit("b2")], {
      load: async (id) => (id === "b1" ? board("b1", 5, [item("a")]) : null),
      send: async () => {},
      drop: async () => {},
    });
    expect(outcomes.map((outcome) => outcome.kind)).toEqual(["merged", "board-missing"]);
  });
});
