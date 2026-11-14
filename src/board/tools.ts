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
import { scanProject } from "./project-scan.js";
import { BoardLibrary, boardLibraryIndexText, type BoardLibraryAction } from "./library.js";
import type { BoardStore } from "./store.js";
import { BoardRevisionConflictError } from "./errors.js";
import {
  addBoardItem,
  addBoardItems,
  boardCopyText,
  boardVisualDigest,
  layoutBoardItems,
  removeBoardItems,
  updateBoardItems,
  replaceBoardContent,
  type SimpleBoard,
} from "./types.js";

export interface BoardToolContext {
  board: BoardStore;
  preview: BoardHttpServer;
  config: AppConfig;
  library: BoardLibrary;
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

function boardCapabilities() {
  return {
    version: 1,
    objectTypes: ["note", "text", "rect", "ellipse", "line", "stroke", "image"],
    variants: ["plain", "card", "frame", "pill", "diamond", "callout", "heading"],
    roles: ["normal", "label", "frame", "column", "step", "decision", "annotation"],
    layouts: ["grid", "row", "column", "timeline", "cluster"],
    connectors: ["startItemId", "endItemId"],
    recipes: ["flow", "compare", "cluster", "emphasis", "image-annotation"],
    style: ["borderColor", "borderWidth", "textColor", "fontSize", "fontWeight", "textAlign", "strokeWidth", "opacity", "radius", "fillOpacity"],
    library: ["list", "get", "create", "save", "switch", "rename", "duplicate", "delete", "import", "export"],
    canvasEngines: ["dom", "excalidraw"],
    safety: "Visual context only; board objects never authorize project writes.",
  };
}

function boardRecipes(): string {
  return [
    "Visual recipes:",
    "- Flow: use rect/note role: step on a row or timeline, then line with startItemId/endItemId and short labels.",
    "- Compare: use role: column or variant: frame groups with matching child labels; do not fake connectors with text.",
    "- Cluster: set groupId on related objects and use layout.mode: cluster; add one short title or role: label.",
    "- Emphasis: set emphasis: focus, optionally circle it with stroke, and add a short title/note.",
    "- Image annotation: place a bounded image, nearby text/note, and connected arrows or strokes; do not overwrite the image.",
    "- Prefer updates and deterministic layout over clearing a whole board. Connected lines follow bound objects.",
  ].join("\n");
}

function boardJson(board: SimpleBoard, library?: unknown) {
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
    visualDigest: boardVisualDigest(board),
    capabilities: boardCapabilities(),
    ...(library ? { library } : {}),
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
    "- Read BOARD_JSON first; reuse item IDs and use updates/removes for precise changes.",
    "- Use a strict grid with short labels. Put author at the draw_board top level, not inside items.",
    "- A line is an arrow from (x,y) to (x+w,y+h); w/h are signed endpoint deltas. Set shape to straight, curve, or orthogonal.",
    "- Use stroke for freehand marks with local points, image for a data:image/* source, title for a short heading, and emphasis: focus to highlight what matters.",
    "- Use layout for tidy arrangements; human multi-select can group related objects in the canvas.",
    "- Place line endpoints just outside the source and target shapes; the arrow text is a short centered label.",
    "- Prefer updates/removes over clearing everything; replacements should be a last resort.",
    "- Use library actions to save the current board as an editable named image, switch between saved boards, or import/export version 1 board JSON without adding tools.",
    "- Read visualDigest and capabilities to understand the current drawing; use recipes for flow, compare, cluster, emphasis, and image annotation.",
    "- The MCP App displays this canvas beside the agent chat in compatible hosts; board tools do not open a browser or grant project-write authority.",
    "- scan_project is optional read-only structure context; draw its result with draw_board if useful.",
  ].join("\n");
}

const itemInput = z.object({
  id: z.string().optional().describe("Existing item ID to update; omit to create a new item"),
  type: z.enum(["note", "text", "rect", "ellipse", "line", "stroke", "image"]).describe("Visual object type"),
  x: z.number().finite().describe("Canvas X coordinate"),
  y: z.number().finite().describe("Canvas Y coordinate"),
  w: z.number().finite().optional().describe("Shape width, line endpoint delta X, or stroke/image bounds width"),
  h: z.number().finite().optional().describe("Shape height, line endpoint delta Y, or stroke/image bounds height"),
  text: z.string().max(1200).optional().describe("Visible text on the object"),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().describe("Hex fill color"),
  title: z.string().max(120).optional().describe("Short heading rendered above the object text"),
  shape: z.enum(["straight", "curve", "orthogonal"]).optional().describe("Line routing style"),
  points: z.array(z.object({ x: z.number().finite(), y: z.number().finite() })).max(500).optional()
    .describe("Local stroke points relative to the item bounds; use for freehand marks"),
  src: z.string().max(700000).optional().describe("data:image/*;base64 source for image items"),
  mime: z.enum(["image/png", "image/jpeg", "image/gif", "image/webp"]).optional().describe("Image mime type"),
  groupId: z.string().max(80).optional().describe("Optional group marker for moving related objects together"),
  emphasis: z.enum(["normal", "focus"]).optional().describe("Visual emphasis marker"),
  variant: z.enum(["plain", "card", "frame", "pill", "diamond", "callout", "heading"]).optional().describe("Visual variant for shapes and notes"),
  role: z.enum(["normal", "label", "frame", "column", "step", "decision", "annotation"]).optional().describe("Semantic role for visualDigest and recipes"),
  z: z.number().finite().min(-1000).max(1000).optional().describe("Stacking order; higher values render above lower values"),
  style: z.object({
    borderColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    borderWidth: z.number().finite().min(0).max(12).optional(),
    textColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    fontSize: z.number().finite().min(8).max(72).optional(),
    fontWeight: z.enum(["normal", "bold"]).optional(),
    textAlign: z.enum(["left", "center", "right"]).optional(),
    strokeWidth: z.number().finite().min(0.5).max(24).optional(),
    opacity: z.number().finite().min(0.1).max(1).optional(),
    radius: z.number().finite().min(0).max(64).optional(),
    fillOpacity: z.number().finite().min(0).max(1).optional(),
  }).optional().describe("Optional bounded visual styling"),
  startItemId: z.string().optional().describe("Source object ID for a connected line"),
  endItemId: z.string().optional().describe("Target object ID for a connected line"),
});

const updateInput = z.object({
  id: z.string().describe("Existing item ID to update"),
  patch: itemInput.omit({ id: true }).partial().describe("Fields to change on the existing item"),
});

const layoutInput = z.object({
  ids: z.array(z.string()).max(400).optional().describe("Objects to arrange; omit to arrange all non-arrow objects"),
  origin: z.object({ x: z.number().finite(), y: z.number().finite() }).optional().describe("Top-left grid origin"),
  columns: z.number().int().min(1).max(12).optional().describe("Grid columns, 1-12; defaults to 3"),
  gap: z.number().int().min(8).max(200).optional().describe("Gap in canvas units, 8-200; defaults to 24"),
  mode: z.enum(["grid", "row", "column", "timeline", "cluster"]).optional().describe("Arrangement mode; defaults to grid"),
});

const libraryAction = z.discriminatedUnion("type", [
  z.object({ type: z.literal("list") }),
  z.object({ type: z.literal("get"), id: z.string().optional() }),
  z.object({ type: z.literal("create"), name: z.string().max(80).optional(), switchTo: z.boolean().optional() }),
  z.object({ type: z.literal("save"), name: z.string().max(80).optional(), id: z.string().optional(), switchTo: z.boolean().optional(), board: z.unknown().optional() }),
  z.object({ type: z.literal("switch"), id: z.string() }),
  z.object({ type: z.literal("rename"), id: z.string(), name: z.string().max(80) }),
  z.object({ type: z.literal("duplicate"), id: z.string(), name: z.string().max(80).optional(), switchTo: z.boolean().optional() }),
  z.object({ type: z.literal("delete"), id: z.string() }),
  z.object({ type: z.literal("import"), name: z.string().max(80).optional(), board: z.unknown(), switchTo: z.boolean().optional() }),
  z.object({ type: z.literal("export"), id: z.string().optional() }),
]);

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
        const current = await ctx.board.snapshot();
        const payload = boardJson(current, (await ctx.library.apply({ type: "list" }, current)).index);
        const firstUse = payload.itemCount === 0;
        const guidance = firstUse ? [
          "FIRST_USE: 空画板。用户想看时调用 show_board；AI 表达意图时调用 draw_board。",
          "NEXT_STEPS: draw_board → 保持画布可见 → 读取人的画图后用 get_board 或当前会话上下文。首张画板见下方 Drawing guide。",
        ] : [
          "NEXT: BOARD_JSON 中的对象是人和 AI 的双向表达；show_board 显示，draw_board 画图回应，改完后再 get_board 或读当前会话上下文。Use draw_board to visualize any context.",
        ];
        return {
          content: [{
            type: "text" as const,
            text: [
              `🎨 共享画布 · revision ${payload.revision} · ${payload.itemCount} 个对象`,
              ``,
              ...guidance,
              "BOARD_JSON:",
              JSON.stringify(payload, null, 2),
              ``,
              ...(firstUse ? [boardGuidance(), ``] : []),
              "CAPABILITIES:",
              JSON.stringify(payload.capabilities, null, 2),
              "VISUAL_DIGEST:",
              JSON.stringify(payload.visualDigest, null, 2),
              "RECIPES:",
              boardRecipes(),
              ``,
              `PANEL_URL: ${ctx.preview.panelUrl ?? "unavailable (standalone preview not started)"}`,
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
      inputSchema: z.object({
        engine: z.enum(["dom", "excalidraw"]).optional().describe("Optional canvas engine; omit for the stable DOM engine"),
      }),
      annotations: READ_ONLY_LOCAL_ANNOTATIONS,
      _meta: { ui: { resourceUri: APP_RESOURCE_URI } },
    },
    async ({ engine }) => {
      try {
        const current = await ctx.board.snapshot();
        const snapshot = boardJson(current, (await ctx.library.apply({ type: "list" }, current)).index);
        if (engine === "excalidraw") {
          return {
            content: [{
              type: "text" as const,
              text: [
                `🎨 Excalidraw 实验画布 · revision ${snapshot.revision} · ${snapshot.itemCount} 个对象`,
                "打开 PANEL_URL 并在地址后添加 ?engine=excalidraw；MCP App 资源仍以默认 DOM 引擎呈现。",
                `PANEL_URL: ${ctx.preview.panelUrl ?? "unavailable (standalone preview not started)"}`,
              ].join("\n"),
            }],
            structuredContent: snapshot,
          };
        }
        return {
          content: [{
            type: "text" as const,
            text: [
              `🎨 共享画布 · revision ${snapshot.revision} · ${snapshot.itemCount} 个对象`,
              "兼容宿主会显示可交互画布；文本宿主请从 get_board 的 PANEL_URL 打开本地画板。",
              "CAPABILITIES:",
              JSON.stringify(snapshot.capabilities, null, 2),
              "VISUAL_DIGEST:",
              JSON.stringify(snapshot.visualDigest, null, 2),
              "RECIPES:",
              boardRecipes(),
            ].join("\n"),
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
      description: "让 AI 直接在共享无限画布上画或改，也可通过 library 参数保存当前画板、切换本地画板图库中的图、新建/重命名/复制/删除/导入/导出可编辑版本 1 画板。普通写入会串行应用到最新状态；line 的 (x,y) 是起点，(x+w,y+h) 是终点，w/h 可为负数；其他对象是左上角与宽高。按整齐网格布局；不打开浏览器，不写项目文件。",
      inputSchema: z.object({
        items: z.array(itemInput).max(100).optional().describe("Objects to create; omit id"),
        updates: z.array(updateInput).max(100).optional().describe("Precise updates to existing object IDs"),
        remove_ids: z.array(z.string()).max(100).optional().describe("Existing object IDs to remove"),
        layout: layoutInput.optional().describe("Optional deterministic arrangement of existing objects"),
        replace_board: z.unknown().optional().describe("Rare full replacement with a version 1 board snapshot; revision and identity are preserved"),
        author: z.enum(["human", "ai"]).optional().describe("Author marker; AI responses should normally use ai"),
        expected_revision: z.number().int().nonnegative().optional().describe("Optional board revision for rejecting stale canvas edits"),
        library: libraryAction.optional().describe("Optional local board-library action for saving, switching, renaming, duplicating, importing, or exporting editable board snapshots"),
      }),
      annotations: BOARD_WRITE_ANNOTATIONS,
      _meta: CANVAS_UI_META,
    },
    async ({ items, updates, remove_ids, layout, replace_board, author, expected_revision, library }) => {
      try {
        if (library) {
          const current = await ctx.board.snapshot();
          if (expected_revision !== undefined && expected_revision !== current.revision) {
            throw new BoardRevisionConflictError(expected_revision, current.revision);
          }
          const result = await ctx.library.apply(library as BoardLibraryAction, current);
          let active = current;
          if (result.previousRevision !== undefined || result.board.id !== current.id
            || result.board.revision !== current.revision || result.board.title !== current.title) {
            active = await ctx.board.replace(result.previousRevision === undefined
              ? { ...result.board, revision: current.revision + 1 }
              : { ...result.board, revision: current.revision + 1 }, current.revision);
          }
          ctx.preview.broadcast({ type: "board_library_updated", activeId: result.index.activeId, revision: active.revision });
          return {
            content: [{
              type: "text" as const,
              text: [
                `🗂 画板图库 · ${library.type}`,
                boardLibraryIndexText(result.index),
                ...(library.type === "export" || library.type === "get" ? ["BOARD_JSON:", JSON.stringify(result.board, null, 2)] : []),
              ].join("\n"),
            }],
            structuredContent: {
              ...boardJson(active, result.index),
              ...(library.type === "export" || library.type === "get" ? { exportBoard: result.board } : {}),
            },
          };
        }
        let created = 0;
        let updated = 0;
        const removed = new Set(remove_ids ?? []);
        const change = (current: SimpleBoard) => {
          let next = current;
          if (replace_board !== undefined) {
            next = replaceBoardContent(next, replace_board);
            return next;
          }
          if (items?.length) {
            next = addBoardItems(next, items.map((item) => ({ ...item, author: author ?? "ai" as const })));
            created += items.length;
          }
          if (updates?.length) {
            next = updateBoardItems(next, updates ?? [], author ?? "ai");
            updated += updates.length;
          }
          if (removed.size) {
            next = removeBoardItems(next, [...removed]);
          }
          if (layout) next = layoutBoardItems(next, layout, author ?? "ai");
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
        const libraryIndex = (await ctx.library.apply({ type: "list" }, board)).index;
        return {
          content: [{
            type: "text" as const,
            text: [
              `✅ 画板已更新 · 新增 ${created} · 更新 ${updated} · 删除 ${removed.size}`,
              `NEXT: 保持画布可见；人画 / 改完后用 get_board 或当前会话上下文读取。`,
              jsonLine({
                revision: board.revision,
                created,
                updated,
                removed: removed.size,
              }),
            ].join("\n"),
          }],
            structuredContent: boardJson(board, libraryIndex),
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
              "PROJECT_JSON:",
              JSON.stringify(snapshot, null, 2),
            ].join("\n"),
          }],
        };
      } catch (error) {
        return errorResult("scan_project", error);
      }
    },
  );
}
