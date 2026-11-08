import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { AppConfig } from "../infra/config.js";
import { logger } from "../infra/logger.js";
import type { BoardHttpServer } from "./http.js";
import { projectSnapshotText, scanProject } from "./project-scan.js";
import type { BoardStore } from "./store.js";
import {
  addBoardItem,
  addBoardNote,
  boardCopyText,
  removeBoardItem,
  updateBoardItem,
  type SimpleBoard,
} from "./types.js";

export interface BoardToolContext {
  board: BoardStore;
  preview: BoardHttpServer;
  config: AppConfig;
}

function errorResult(tool: string, error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : String(error);
  logger.error(`${tool} failed: ${message}`);
  return { content: [{ type: "text" as const, text: `❌ ${tool} failed: ${message}` }], isError: true };
}

function jsonLine(payload: Record<string, string | number | boolean>): string {
  return `JSON: ${JSON.stringify(payload)}`;
}

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
    "- A line is an arrow from (x,y) to (x+w,y+h); w/h represent direction, not a box size. They may be negative.",
    "- Place line endpoints just outside the source and target shapes; the arrow text is a short centered label.",
    "- Prefer a clean replace when redrawing a whole diagram: remove_ids for the old objects, then add the new ones.",
    "- Board tools do not open a browser and never grant project-write authority.",
    "- scan_project is optional read-only structure context; draw its result with draw_board if useful.",
  ].join("\n");
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

export function registerBoardTools(server: McpServer, ctx: BoardToolContext): void {
  server.tool(
    "get_board",
    "读取人和 AI 共享的无限画布：便签、文本、形状、有方向箭头、坐标、作者与最近短留言。开始协作或回答「画板上有什么」时先用本工具；它只读，不打开浏览器，也不写项目文件。",
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
                version: 1,
                revision: payload.revision,
                items: payload.itemCount,
                notes: payload.noteCount,
                readOnly: true,
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
      } catch (error) {
        return errorResult("get_board", error);
      }
    },
  );

  server.tool(
    "draw_board",
    "让 AI 直接在共享无限画布上画或改：批量新增/更新便签、文字、矩形、椭圆或有方向箭头，也可按 ID 删除对象。line 的 (x,y) 是起点，(x+w,y+h) 是终点，w/h 可为负数；其他对象是左上角与宽高。先用 get_board 读取现有 ID 和坐标，按整齐网格布局；不打开浏览器，不写项目文件。",
    {
      items: z.array(itemInput).max(100).optional().describe("Objects to create (without id) or update (with id)"),
      remove_ids: z.array(z.string()).max(100).optional().describe("Existing object IDs to remove"),
      author: z.enum(["human", "ai"]).optional().describe("Author marker; AI responses should normally use ai"),
    },
    async ({ items, remove_ids, author }) => {
      try {
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
                revision: board.revision,
                created,
                updated,
                removed: remove_ids?.length ?? 0,
              }),
              ``,
              "Only board visuals changed; no project file was written.",
            ].join("\n"),
          }],
        };
      } catch (error) {
        return errorResult("draw_board", error);
      }
    },
  );

  server.tool(
    "reply_on_board",
    "把 AI 的一句话回应放在共享画板旁边，可指向某个画布对象；这是围绕图形沟通的轻量备注，不是独立聊天产品，不打开浏览器，不写项目文件，也不授权代码变更。",
    {
      body: z.string().min(1).max(1200).describe("Short response shown beside the board"),
      item_id: z.string().optional().describe("Optional board object this response refers to"),
    },
    async ({ body, item_id }) => {
      try {
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
              jsonLine({ id: note.id, revision: board.revision, author: "ai" }),
              ``,
              "The note is shared board context only; no project file was written.",
            ].join("\n"),
          }],
        };
      } catch (error) {
        return errorResult("reply_on_board", error);
      }
    },
  );

  server.tool(
    "scan_project",
    "可选能力：只读扫描当前工作区的目录与文件路径，并返回少量 file:line 证据文本。项目结构只是画板可以讨论的内容之一；本工具不生成图、不改画板、不写文件，也不授权代码变更。需要可视化时用 draw_board 把路径画到共享画板。",
    {
      max_depth: z.number().int().min(1).max(6).optional().describe("Maximum directory depth; defaults to 3, maximum 6"),
      max_files: z.number().int().min(1).max(400).optional().describe("Maximum number of entries; defaults to 80, maximum 400"),
      include_evidence: z.boolean().optional().describe("Include bounded file:line evidence; defaults to true"),
    },
    async ({ max_depth, max_files, include_evidence }) => {
      try {
        const snapshot = await scanProject(ctx.config.workspaceRoot, {
          maxDepth: max_depth,
          maxFiles: max_files,
          includeEvidence: include_evidence,
        });
        return {
          content: [{
            type: "text" as const,
            text: [
              `📁 项目结构 · ${snapshot.files.length} 项 · read-only`,
              ``,
              jsonLine({
                version: 1,
                files: snapshot.files.length,
                evidence: snapshot.evidence.length,
                truncated: snapshot.truncated,
                writes: "none",
              }),
              ``,
              "PROJECT_JSON:",
              JSON.stringify(snapshot, null, 2),
              ``,
              "PROJECT_TEXT:",
              projectSnapshotText(snapshot),
              ``,
              "Use draw_board to visualize this read-only context on the same canvas. No project file was written.",
            ].join("\n"),
          }],
        };
      } catch (error) {
        return errorResult("scan_project", error);
      }
    },
  );
}
