/**
 * `draw_board`: the write surface.
 *
 * Three mutually exclusive shapes: a semantic `diagram`, a local `library`
 * action, or a set of item mutations (add / update / remove / arrange). They
 * are dispatched explicitly so an ambiguous call fails loudly instead of
 * half-applying.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BOARD_WRITE_ANNOTATIONS, CANVAS_UI_META, type BoardToolContext } from "../context.js";
import { boardAgentPayload, boardWriteSnapshot, errorResult, jsonLine } from "../presentation.js";
import { diagramInput, itemInput, layoutInput, libraryAction, updateInput } from "../schemas.js";
import {
  boardLibraryIndexText,
  type BoardLibraryAction,
} from "../../library.js";
import { BoardRevisionConflictError, BoardValidationError } from "../../errors.js";
import { expandRecipe } from "../../diagram/recipe.js";
import { changeReport, changeReportText } from "../change-report.js";
import {
  addBoardItems,
  boardVisualDigest,
  diagramToBoardItems,
  parseBoard,
  layoutBoardItems,
  removeBoardItems,
  updateBoardItems,
  replaceBoardContent,
  touchBoard,
  type SimpleBoard,
} from "../../types.js";

export function registerDrawBoardTool(server: McpServer, ctx: BoardToolContext): void {
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
      diagram: diagramInput.optional().describe("Semantic diagram recipe: nodes and optional edges generate one bounded Board v1 diagram with deterministic layout, short labels, and connected arrows. Each node takes `label` (not `title`); `edges` may be omitted for a standalone card or a plain sequence. By default it is added beside existing objects and reuses a numeric id suffix if a generated id is taken; replace:true clears the whole active board first. Every edge becomes a routed line, and a flow longer than six columns snakes instead of becoming one wide strip. To advance an ordered timeline, increment `row` down one column: row-only nodes stack vertically on a single axis. Give an explicit `column` only when you want side-by-side groups."),
    }),
    annotations: BOARD_WRITE_ANNOTATIONS,
    _meta: CANVAS_UI_META,
  },
  async ({ items, updates, remove_ids, layout, replace_board, author, expected_revision, library, diagram }) => {
    try {
      /*
       * Reject a per-item author instead of silently rewriting it.
       *
       * `author` is a top-level field; the write path stamps every item in a
       * call with that one value. A caller sending `author` inside an item was
       * previously overridden without a word, so a model that meant to mark a
       * person's words as `human` stored them as `ai`. Authorship is the field
       * that makes the board two-way, so a wrong marker is worse than a
       * rejection. Callers that need both authors send two calls.
       */
      const itemAuthors = [...(items ?? []), ...(updates ?? []).map((update) => update.patch)]
        .filter((item) => item && typeof item === "object" && "author" in item);
      if (itemAuthors.length) {
        throw new BoardValidationError(
          `author must not be set per item (${itemAuthors.length} item(s) did)`,
          "AUTHOR_ON_ITEM",
          "items[].author",
          "omit it",
          "Set author once at the draw_board top level, and send separate calls for human and ai objects.",
        );
      }
      /*
       * `author` is accepted by the schema only so the check above can fire.
       * Strip it before the write path, where `BoardItemInput.author` is the
       * narrowed `BoardAuthor` this tool owns.
       */
      const stripAuthor = <T extends { author?: string }>(item: T): Omit<T, "author"> => {
        const { author: _perItemAuthor, ...rest } = item;
        return rest;
      };
      const cleanItems = items?.map(stripAuthor);
      const cleanUpdates = updates?.map((update) => ({ ...update, patch: stripAuthor(update.patch) }));
      if (diagram) {
        if (items !== undefined || updates !== undefined || remove_ids !== undefined
          || layout !== undefined || replace_board !== undefined || library !== undefined) {
          throw new Error("diagram replaces the active board and cannot be combined with other draw_board actions");
        }
        const expanded = expandRecipe(diagram);
        const current = await ctx.board.snapshot();
        if (expected_revision !== undefined && expected_revision !== current.revision) {
          throw new BoardRevisionConflictError(expected_revision, current.revision);
        }
        // In append mode the existing ids are reserved so a second iteration
        // that reuses `n1` or `diagram_frame` does not collide.
        const generated = diagramToBoardItems(
          expanded,
          author ?? "ai",
          diagram.replace ? [] : current.items.map((item) => item.id),
        );
        const candidate = touchBoard({
          ...current,
          title: expanded.title ?? current.title,
          items: diagram.replace ? generated : [...current.items, ...generated],
        });
        parseBoard(candidate);
        const board = await ctx.board.replaceIfRevision(candidate, current.revision);
        ctx.revisions?.remember(board);
        ctx.preview.broadcast({ type: "board_updated", revision: board.revision });
        const libraryIndex = (await ctx.library.apply({ type: "list" }, board)).index;
        return {
          content: [{
            type: "text" as const,
            text: [
              `✅ 图已生成 · ${expanded.nodes.length} 个节点 · ${expanded.edges.length} 条连接`,
              `JSON: ${JSON.stringify({ revision: board.revision, created: generated.length })}`,
              changeReportText(changeReport(current, board)),
            ].join("\n"),
          }],
          structuredContent: { ...boardWriteSnapshot(board, libraryIndex), change: changeReport(current, board) },
        };
      }
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
          ctx.revisions?.remember(active);
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
            ...boardAgentPayload(active, result.index),
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
        if (cleanItems?.length) {
          next = addBoardItems(next, cleanItems.map((item) => ({ ...item, author: author ?? "ai" as const })));
          created += cleanItems.length;
        }
        if (cleanUpdates?.length) {
          next = updateBoardItems(next, cleanUpdates, author ?? "ai");
          updated += cleanUpdates.length;
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
      ctx.revisions?.remember(board);
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
            changeReportText(changeReport(initial, board)),
          ].join("\n"),
        }],
          structuredContent: { ...boardWriteSnapshot(board, libraryIndex), change: changeReport(initial, board) },
      };
    } catch (error) {
      return errorResult("draw_board", error);
    }
  },
);
}
