import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { boardCopyText, type SimpleBoard } from "../domain/simple-board.js";
import { errorResult, jsonLine, type ToolContext } from "./_shared.js";

function boardJson(board: SimpleBoard) {
  return {
    version: 1,
    readOnly: true,
    id: board.id,
    title: board.title,
    revision: board.revision,
    updatedAt: board.updatedAt,
    itemCount: board.items.length,
    noteCount: board.notes.length,
    items: board.items,
    notes: board.notes.slice(-50),
    copyText: boardCopyText(board),
    safety: {
      readOnly: true,
      grantsWriteAuthority: false,
      projectWritesRequireHumanApproval: true,
    },
  };
}

function boardGuidance(): string {
  return [
    "Drawing guide:",
    "- Read BOARD_JSON first; reuse item IDs to update or remove existing objects.",
    "- Use a strict grid with short labels. Put author at the draw_board top level, not inside items.",
    "- A line is an arrow from (x,y) to (x+w,y+h); w/h represent direction, not a box size. It may be negative.",
    "- Place line endpoints just outside the source and target shapes; use text for a label instead of crowding the arrow.",
    "- Prefer a clean replace when redrawing a whole diagram: remove_ids for the old objects, then add the new ones.",
    "- Board tools do not open a browser and never grant project-write authority.",
  ].join("\n");
}

export function registerGetBoard(server: McpServer, ctx: ToolContext) {
  server.tool(
    "get_board",
    "读取人和 AI 共享的无限画布：便签、文本、形状、线条、坐标、作者与最近留言。开始协作或回答「画板上有什么」时先用本工具；它只读，不打开浏览器，也不写项目文件。项目结构扫描只是旧工作台的可选能力，不是画板的前提。",
    {},
    async () => {
      try {
        const payload = boardJson(await ctx.board.snapshot());
        return {
          content: [{
            type: "text" as const,
            text: [
              `🎨 共享画板 · revision ${payload.revision} · ${payload.itemCount} 个对象 · ${payload.noteCount} 条留言`,
              ``,
              jsonLine({
                version: "1",
                revision: String(payload.revision),
                items: String(payload.itemCount),
                notes: String(payload.noteCount),
                readOnly: "true",
              }),
              ``,
              "BOARD_JSON:",
              JSON.stringify(payload, null, 2),
              ``,
              boardGuidance(),
              ``,
              "BOARD_JSON is a read-only projection. Use draw_board to add or edit visual objects, and reply_on_board to answer a note.",
            ].join("\n"),
          }],
        };
      } catch (err) {
        return errorResult("get_board", err);
      }
    },
  );
}

const itemInput = z.object({
  id: z.string().optional().describe("Existing item ID to update; omit to create a new item"),
  type: z.enum(["note", "text", "rect", "ellipse", "line"]).describe("Simple visual object type"),
  x: z.number().finite().describe("Canvas X coordinate"),
  y: z.number().finite().describe("Canvas Y coordinate"),
  w: z.number().finite().optional().describe("Shape width, or line endpoint delta X; negative values are allowed for lines"),
  h: z.number().finite().optional().describe("Shape height, or line endpoint delta Y; negative values are allowed for lines"),
  text: z.string().max(1200).optional().describe("Visible text on the object"),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().describe("Hex fill color"),
});

export function registerDrawBoard(server: McpServer, ctx: ToolContext) {
  server.tool(
    "draw_board",
    "让 AI 直接在共享无限画布上画或改：批量新增/更新便签、文字、矩形、椭圆或有方向箭头，也可按 ID 删除对象。line 的 (x,y) 是起点，(x+w,y+h) 是终点，w/h 可为负数；其他对象是左上角与宽高。先用 get_board 读取现有 ID 和坐标，按整齐网格布局；不打开浏览器，不写项目文件，不签发批准凭据。",
    {
      items: z.array(itemInput).max(100).optional().describe("Objects to create (without id) or update (with id)"),
      remove_ids: z.array(z.string()).max(100).optional().describe("Existing object IDs to remove"),
      author: z.enum(["human", "ai"]).optional().describe("Author marker; AI responses should normally use ai"),
    },
    async ({ items, remove_ids, author }) => {
      try {
        const { addBoardItem, updateBoardItem, removeBoardItem } = await import("../domain/simple-board.js");
        let board = await ctx.board.snapshot();
        let created = 0;
        let updated = 0;
        for (const raw of items ?? []) {
          const input = { ...raw, author: author ?? "ai" as const };
          if (raw.id) {
            const { id: _id, ...patch } = input;
            board = updateBoardItem(board, raw.id, patch);
            updated += 1;
          } else {
            board = addBoardItem(board, input);
            created += 1;
          }
        }
        for (const id of remove_ids ?? []) {
          board = removeBoardItem(board, id);
        }
        await ctx.board.replace(board);
        ctx.preview.broadcast({ type: "board_updated", revision: board.revision });
        return {
          content: [{
            type: "text" as const,
            text: [
              `✅ 画板已更新 · 新增 ${created} · 更新 ${updated} · 删除 ${remove_ids?.length ?? 0}`,
              `Revision: ${board.revision} · objects: ${board.items.length}`,
              ``,
              jsonLine({
                revision: String(board.revision),
                created: String(created),
                updated: String(updated),
                removed: String(remove_ids?.length ?? 0),
              }),
              ``,
              "Only board visuals changed; no project file was written.",
            ].join("\n"),
          }],
        };
      } catch (err) {
        return errorResult("draw_board", err);
      }
    },
  );
}

export function registerReplyOnBoard(server: McpServer, ctx: ToolContext) {
  server.tool(
    "reply_on_board",
    "把 AI 的一句话回应放在共享画板旁边，可指向某个画布对象；这是围绕图形沟通的轻量备注，不是独立聊天产品，不打开浏览器，不写项目文件，也不授权代码变更。",
    {
      body: z.string().min(1).max(1200).describe("Short response shown beside the board"),
      item_id: z.string().optional().describe("Optional board object this response refers to"),
    },
    async ({ body, item_id }) => {
      try {
        const { addBoardNote } = await import("../domain/simple-board.js");
        let board = await ctx.board.snapshot();
        board = addBoardNote(board, { body, author: "ai", itemId: item_id });
        await ctx.board.replace(board);
        ctx.preview.broadcast({ type: "board_updated", revision: board.revision });
        const note = board.notes[board.notes.length - 1];
        return {
          content: [{
            type: "text" as const,
            text: [
              "✅ AI 回应已放到画板旁",
              `ID: ${note.id} · Revision: ${board.revision}`,
              ``,
              jsonLine({ id: note.id, revision: String(board.revision), author: "ai" }),
              ``,
              "The note is board context only; project writes still require a reviewed proposal and a one-time human receipt.",
            ].join("\n"),
          }],
        };
      } catch (err) {
        return errorResult("reply_on_board", err);
      }
    },
  );
}
