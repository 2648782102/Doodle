import { describe, expect, it } from "vitest";
import {
  buildBoardModelContext,
  diffBoardStates,
} from "../dist/board/app-context.js";

function item(overrides = {}) {
  return {
    id: "a",
    type: "note",
    x: 10,
    y: 20,
    w: 180,
    h: 120,
    text: "草稿",
    color: "#f6d365",
    author: "human",
    createdAt: "2026-11-12T00:00:00.000Z",
    updatedAt: "2026-11-12T00:00:00.000Z",
    ...overrides,
  };
}

function board(revision, items) {
  return {
    version: 1,
    id: "board_test",
    title: "和 AI 一起画",
    revision,
    updatedAt: `2026-11-12T00:00:0${revision}.000Z`,
    items,
    itemCount: items.length,
  };
}

describe("host model context shares final board state", () => {
  it("reports all current objects as additions on the first sync", () => {
    const current = board(1, [item()]);
    const context = buildBoardModelContext(current);
    expect(context.structuredContent.type).toBe("doodle_board_context");
    expect(context.structuredContent.delta).toMatchObject({
      baseRevision: 0,
      added: [item()],
      updated: [],
      removed: [],
    });
    expect(context.structuredContent.board).toEqual(current);
    expect(context.content[0].text).toContain("不是点击、拖拽或操作记录");
    expect(context.content[0].text).toContain("当前最终快照");
    expect(context.structuredContent.safety).toMatchObject({
      finalStateNotOperationLog: true,
      authoritativeTool: "get_board",
    });
  });

  it("uses final object values for updates and IDs for removals", () => {
    const before = board(4, [item(), item({ id: "b", text: "待删除", x: 240 })]);
    const updated = item({ text: "最终文字", author: "ai", updatedAt: "2026-11-12T00:00:05.000Z" });
    const after = board(5, [item({ id: "c", text: "新增", x: 480 }), updated]);
    const delta = diffBoardStates(before, after);
    expect(delta.baseRevision).toBe(4);
    expect(delta.added.map((entry) => entry.id)).toEqual(["c"]);
    expect(delta.updated).toEqual([updated]);
    expect(delta.removed).toEqual(["b"]);
    const context = buildBoardModelContext(after, before);
    expect(context.structuredContent.delta).toEqual(delta);
    expect(context.structuredContent.board).toEqual(after);
    expect(context.content[0].text).toContain("最终文字");
    expect(context.content[0].text).toContain("rev 4 → rev 5");
  });

  it("keeps no-change updates explicit and bounded", () => {
    const current = board(9, [item({ text: "x".repeat(600) })]);
    const context = buildBoardModelContext(current, current, { maxTextItems: 0, maxTextChars: 20 });
    expect(context.structuredContent.delta).toMatchObject({
      baseRevision: 9,
      added: [],
      updated: [],
      removed: [],
    });
    expect(context.content[0].text).toContain("新增 0 · 更新 0 · 删除 0");
    expect(context.content[0].text).not.toContain("x".repeat(100));
    expect(context.content[0].text).toContain("省略部分对象");
    expect(context.structuredContent.board.items[0].text).toBe("x".repeat(600));
  });

  it("embeds the complete final-state payload in text when structured context is unsupported", () => {
    const current = board(3, [item({ text: "全文最终状态" })]);
    const context = buildBoardModelContext(current, board(2, []), { includeStructuredContent: false });
    expect(context.content[0].text).toContain("DOODLE_BOARD_CONTEXT_JSON:");
    expect(context.content[0].text).toContain("全文最终状态");
    expect(context.content[0].text).toContain('"finalStateNotOperationLog": true');
    expect(context.structuredContent.board).toEqual(current);
  });

  it("projects visual-expression fields into bounded model context", () => {
    const current = board(4, [
      item({
        text: "输入", title: "开始", role: "step", variant: "card", z: 2,
        style: { fontSize: 18 }, startItemId: "source", endItemId: "target",
      }),
    ]);
    const context = buildBoardModelContext(current);
    expect(context.structuredContent.board.items[0]).toMatchObject({
      title: "开始", role: "step", variant: "card", z: 2, startItemId: "source",
    });
    expect(context.content[0].text).toContain("source → target");
  });
});
