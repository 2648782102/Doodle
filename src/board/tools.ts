import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AppConfig } from "../infra/config.js";
import { logger } from "../infra/logger.js";
import type { BoardHttpServer } from "./http.js";
import { projectSnapshotText, scanProject } from "./project-scan.js";
import type { BoardStore } from "./store.js";
import { BoardRevisionConflictError } from "./errors.js";
import {
  addBoardItem,
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

const APP_RESOURCE_URI = "ui://doodle/board/v1.html";
const CANVAS_UI_META = {
  ui: { resourceUri: APP_RESOURCE_URI, prefersBorder: true },
} as const;
const READ_ONLY_LOCAL_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
} as const;
const BOARD_WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  openWorldHint: false,
} as const;
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
function appBundleCandidates(config: AppConfig): string[] {
  return [
    path.resolve(config.cwd, "infra", "templates", "board-app.js"),
    path.resolve(config.cwd, "server", "infra", "templates", "board-app.js"),
    path.resolve(moduleDir, "../../../infra/templates/board-app.js"),
    path.resolve(moduleDir, "../infra/templates/board-app.js"),
    path.resolve(moduleDir, "../../dist/infra/templates/board-app.js"),
  ];
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
    items: board.items,
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
    "- The MCP App displays this canvas beside the agent chat in compatible hosts; board tools do not open a browser or grant project-write authority.",
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
  registerAppResource(server, "Doodle shared board", APP_RESOURCE_URI, {
    _meta: { ui: { prefersBorder: true } },
  }, async () => {
    let bundle = "";
    for (const candidate of appBundleCandidates(ctx.config)) {
      try {
        bundle = await fs.readFile(candidate, "utf8");
        break;
      } catch {}
    }
    if (!bundle) throw new Error("Doodle MCP App bundle is missing; rebuild the package");
    const html = await ctx.preview.getAppHtml(bundle);
    return {
      contents: [{
        uri: APP_RESOURCE_URI,
        mimeType: RESOURCE_MIME_TYPE,
        text: html,
        _meta: { ui: { prefersBorder: true } },
      }],
    };
  });

  server.registerTool(
    "get_board",
    {
      description: "读取人和 AI 共享画布的数据：revision、对象 ID、坐标、作者、BOARD_JSON 和画图规范。用于回答画布内容或给 Agent 提供视觉上下文；只读，不打开浏览器，也不写项目文件。想显示可编辑画布时调用 show_board。",
      inputSchema: z.object({}),
      annotations: READ_ONLY_LOCAL_ANNOTATIONS,
    },
    async () => {
      try {
        const payload = boardJson(await ctx.board.snapshot());
        return {
          content: [{
            type: "text" as const,
            text: [
                `🎨 共享画布 · revision ${payload.revision} · ${payload.itemCount} 个对象`,
              ``,
              "FIRST_USE:",
              "- 先在聊天里说明你想画什么；AI 用 draw_board 落在同一张画布。",
              "- 人可直接点按、拖拽、双击改字；兼容宿主会显示画布，其他宿主用 PANEL_URL。",
              ``,
              "NEXT_STEPS:",
              "- 用户说「打开画板」：调用 show_board。",
              "- 需要画或改：调用 draw_board；成功后保持画布可见。",
              "- 人改完后：再次调用 get_board 读取最新内容。",
              ``,
              jsonLine({
                version: 1,
                revision: payload.revision,
                items: payload.itemCount,
                readOnly: true,
              }),
              ``,
              "BOARD_JSON:",
              JSON.stringify(payload, null, 2),
              ``,
              boardGuidance(),
              ``,
              `PANEL_URL: ${ctx.preview.panelUrl ?? "unavailable (standalone preview not started)"}`,
              ``,
              "BOARD_JSON is the read-only shared state. Use draw_board to add or edit visual objects. Conversation belongs in the agent chat; put shared context on the canvas itself.",
            ].join("\n"),
          }],
          structuredContent: payload,
        };
      } catch (error) {
        return errorResult("get_board", error);
      }
    },
  );

  server.registerTool(
    "show_board",
    {
      description: "在人和 AI 的 Agent 对话旁显示共享无限画布，供用户直接查看和编辑。用户要求打开、查看、展示或编辑 Doodle 画布时调用。支持 MCP Apps 的宿主会嵌入交互式画布；其他宿主仍可通过普通工具读写画布。",
      inputSchema: z.object({}),
      annotations: READ_ONLY_LOCAL_ANNOTATIONS,
      _meta: { ui: { resourceUri: APP_RESOURCE_URI } },
    },
    async () => {
      try {
        const snapshot = boardJson(await ctx.board.snapshot());
        return {
          content: [{
            type: "text" as const,
            text: `🎨 已打开共享画布 · revision ${snapshot.revision} · ${snapshot.itemCount} 个对象`,
          }],
          structuredContent: snapshot,
        };
      } catch (error) {
        return errorResult("show_board", error);
      }
    },
  );

  server.registerTool(
    "draw_board",
    {
      description: "让 AI 直接在共享无限画布上画或改：批量新增/更新便签、文字、矩形、椭圆或有方向箭头，也可按 ID 删除对象。每次操作会在锁内读取最新画板，避免覆盖其他进程的更新。line 的 (x,y) 是起点，(x+w,y+h) 是终点，w/h 可为负数；其他对象是左上角与宽高。按整齐网格布局；不打开浏览器，不写项目文件。",
      inputSchema: z.object({
        items: z.array(itemInput).max(100).optional().describe("Objects to create (without id) or update (with id)"),
        remove_ids: z.array(z.string()).max(100).optional().describe("Existing object IDs to remove"),
        author: z.enum(["human", "ai"]).optional().describe("Author marker; AI responses should normally use ai"),
        expected_revision: z.number().int().nonnegative().optional().describe("Optional board revision for rejecting stale canvas edits"),
      }),
      annotations: BOARD_WRITE_ANNOTATIONS,
      _meta: CANVAS_UI_META,
    },
    async ({ items, remove_ids, author, expected_revision }) => {
      try {
        let created = 0;
        let updated = 0;
        const removed = new Set(remove_ids ?? []);
        const change = (current: SimpleBoard) => {
          let next = current;
          for (const raw of items ?? []) {
            const input = { ...raw, author: author ?? "ai" as const };
            if (raw.id) {
              const { id: _id, ...patch } = input;
              next = updateBoardItem(next, raw.id, patch);
              updated += 1;
            } else {
              next = addBoardItem(next, input);
              created += 1;
            }
          }
          for (const id of removed) next = removeBoardItem(next, id);
          return next;
        };
        const initial = await ctx.board.snapshot();
        if (expected_revision !== undefined && expected_revision !== initial.revision) {
          throw new BoardRevisionConflictError(expected_revision, initial.revision);
        }
        let candidate = initial;
        candidate = change(candidate);
        const board = await ctx.board.replaceIfRevision(candidate, initial.revision);
        ctx.preview.broadcast({ type: "board_updated", revision: board.revision });
        return {
          content: [{
            type: "text" as const,
            text: [
              `✅ 画板已更新 · 新增 ${created} · 更新 ${updated} · 删除 ${removed.size}`,
              `Revision: ${board.revision} · objects: ${board.items.length}`,
              `NEXT: 保持画布可见；让用户直接修改，再用 get_board 读取。`,
              ``,
              jsonLine({
                revision: board.revision,
                created,
                updated,
                removed: removed.size,
              }),
              ``,
              "Only board visuals changed; no project file was written.",
            ].join("\n"),
          }],
          structuredContent: boardJson(board),
        };
      } catch (error) {
        return errorResult("draw_board", error);
      }
    },
  );

  server.registerTool(
    "scan_project",
    {
      description: "可选能力：只读扫描当前工作区的目录与文件路径，并返回少量 file:line 证据文本。项目结构只是画板可以讨论的内容之一；本工具不生成图、不改画板、不写文件，也不授权代码变更。需要可视化时用 draw_board 把路径画到共享画板。",
      inputSchema: z.object({
        max_depth: z.number().int().min(1).max(6).optional().describe("Maximum directory depth; defaults to 3, maximum 6"),
        max_files: z.number().int().min(1).max(400).optional().describe("Maximum number of entries; defaults to 80, maximum 400"),
        include_evidence: z.boolean().optional().describe("Include bounded file:line evidence; defaults to true"),
      }),
      annotations: READ_ONLY_LOCAL_ANNOTATIONS,
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
