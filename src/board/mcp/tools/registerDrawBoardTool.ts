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
import { boardWriteSnapshot, errorResult, jsonLine } from "../presentation.js";
import { diagramInput, itemInput, layoutInput, libraryAction, updateInput } from "../schemas.js";
import {
  boardLibraryIndexText,
  type BoardLibraryAction,
} from "../../library.js";
import { BoardRevisionConflictError, BoardValidationError, ObjectConflictError } from "../../errors.js";
import { reportConflicts } from "../../http/conflict.js";
import { expandRecipe } from "../../diagram/recipe.js";
import { changeReport, changeReportText } from "../change-report.js";
import {
  addBoardItems,
  diagramToBoardItems,
  parseBoard,
  layoutBoardItems,
  removeBoardItems,
  updateBoardItems,
  replaceBoardContent,
  touchBoard,
  type BoardItemInput,
  type BoardLayoutInput,
  type DiagramInput,
  type SimpleBoard,
} from "../../types.js";

export function registerDrawBoardTool(server: McpServer, ctx: BoardToolContext): void {
server.registerTool(
  "draw_board",
  {
    description: "让 AI 直接在共享无限画布上画或改。三个互斥的用法：items/updates/remove_ids/layout 做对象级增删改；diagram 用语义 nodes/edges 一次画完一张图，复杂图优先用它而不是手算坐标；library 管理本地可编辑画板库。改已有内容用 updates 复用已有 id，不要整板重建。author 放顶层，items 里不要再写。line 的 (x,y) 是起点，(x+w,y+h) 是终点，w/h 可为负数；其他对象是左上角与宽高。写入串行应用到最新状态；不传 expected_revision 即追加（并发安全），传了则严格校验。不打开浏览器，不写项目文件。",
    inputSchema: z.object({
      items: z.array(itemInput).optional().describe("Objects to create; omit id"),
      updates: z.array(updateInput).optional().describe("Precise updates to existing object IDs"),
      remove_ids: z.array(z.string()).optional().describe("Existing object IDs to remove"),
      layout: layoutInput.optional().describe("Optional deterministic arrangement of existing objects"),
      replace_board: z.unknown().optional().describe("Rare full replacement with a version 1 board snapshot; revision and identity are preserved"),
      author: z.string().optional().describe("Author marker: human or ai. AI responses should normally use ai"),
      expected_revision: z.number().int().nonnegative().optional().describe("Optional board revision for rejecting stale canvas edits"),
      library: libraryAction.optional().describe("Optional local board-library action for saving, switching, renaming, duplicating, importing, or exporting editable board snapshots. create, save, duplicate, and import make the resulting board active unless you pass switchTo: false — so when you are only tidying the library, pass switchTo: false rather than moving the person off the board they are looking at."),
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
       * `author` is a plain string in the schema so this check can name the
       * repair; a `z.enum` would reject with bare SDK prose before the handler.
       */
      if (author !== undefined && author !== "human" && author !== "ai") {
        throw new BoardValidationError(
          `author must be "human" or "ai", got ${JSON.stringify(author)}`,
          "INVALID_AUTHOR",
          "author",
          `"human" or "ai"`,
          `Set author: "ai" for your own objects. Attribution is what makes the board two-way, so a custom name is refused rather than coerced.`,
        );
      }
      /*
       * The schema describes shape, so enums arrive as plain strings and
       * `model/` narrows them. Re-typing here keeps the write path typed
       * without a second validation pass: anything outside the union was
       * already refused by `normalizeItem` with a repair path.
       */
      const narrow = <T extends Record<string, unknown>>(item: T): BoardItemInput => {
        const { author: _perItemAuthor, ...rest } = item as T & { author?: string };
        return rest as unknown as BoardItemInput;
      };
      const stripAuthor = (item: Record<string, unknown>) => narrow(item);
      const cleanItems = items?.map(stripAuthor);
      const cleanUpdates = updates?.map((update) => ({ ...update, patch: stripAuthor(update.patch) }));
      /*
       * Every write branch ends the same way: reject a stale expected revision,
       * land the candidate at the revision it was derived from, and record the
       * committed revision for delta reads. Three inlined copies of that
       * sequence drifted apart once already — the library branch shipped
       * without the snapshot the canvas repaints from — so it lives here.
       */
      const assertRevision = (current: SimpleBoard): void => {
        if (expected_revision !== undefined && expected_revision !== current.revision) {
          throw new BoardRevisionConflictError(expected_revision, current.revision);
        }
      };
      const commit = async (candidate: SimpleBoard, from: SimpleBoard): Promise<SimpleBoard> => {
        const board = await ctx.board.replaceIfRevision(candidate, from.revision);
        ctx.revisions?.remember(board);
        return board;
      };
      /*
       * The per-call batch ceiling moved here from the schema so the rejection
       * carries a repair path. The MCP SDK validates `inputSchema` before this
       * handler runs and reports a failure as bare prose, which is exactly the
       * case a model hits when it tries to draw a large diagram in one call.
       */
      const MUTATION_BATCH_LIMIT = 100;
      for (const [field, list] of [["items", cleanItems], ["updates", cleanUpdates], ["remove_ids", remove_ids]] as const) {
        if (list && list.length > MUTATION_BATCH_LIMIT) {
          throw new BoardValidationError(
            `${field} carries ${list.length} entries, over the ${MUTATION_BATCH_LIMIT} allowed in one call`,
            "BATCH_TOO_LARGE",
            field,
            `at most ${MUTATION_BATCH_LIMIT} entries per call`,
            `Split into ${Math.ceil(list.length / MUTATION_BATCH_LIMIT)} calls of ${MUTATION_BATCH_LIMIT} or fewer. For a diagram, prefer draw_board.diagram with nodes/edges instead of one object per call.`,
          );
        }
      }
      /*
       * The tool has three mutually exclusive shapes, and each must say so.
       *
       * Only `diagram` used to guard this. `replace_board + items` and
       * `library + items` silently dropped the extra field and reported
       * success, so a caller that sent both believed the second half applied.
       * The check is shared now, and it lists the fields that clashed so the
       * caller knows which half to drop.
       */
      const mutationFields = {
        items, updates, remove_ids, layout, replace_board, library, diagram,
      };
      const primaryShapes = (["diagram", "library", "replace_board"] as const)
        .filter((field) => mutationFields[field] !== undefined);
      if (primaryShapes.length > 1) {
        throw new BoardValidationError(
          `draw_board received more than one whole-board action: ${primaryShapes.join(", ")}`,
          "CONFLICTING_ACTIONS",
          primaryShapes[primaryShapes.length - 1],
          "exactly one of diagram, library, or replace_board",
          `Send these as separate calls. A diagram generates a board, library manages saved boards, and replace_board writes a complete one; they cannot be combined.`,
        );
      }
      if (primaryShapes.length === 1) {
        const conflicting = (["items", "updates", "remove_ids", "layout"] as const)
          .filter((field) => mutationFields[field] !== undefined
            && (mutationFields[field] as unknown[] | undefined)?.length !== 0);
        if (conflicting.length) {
          throw new BoardValidationError(
            `${primaryShapes[0]} cannot be combined with ${conflicting.join(", ")}`,
            "CONFLICTING_ACTIONS",
            conflicting[0],
            `only ${primaryShapes[0]}`,
            `${primaryShapes[0]} replaces the board wholesale, so item-level fields would be discarded. Send them as a separate call.`,
          );
        }
      }
      if (diagram) {
        // `resolveDiagramLayout` validates `mode` with a repair path; the
        // schema only proves it is a string.
        const expanded = expandRecipe(diagram as DiagramInput);
        const current = await ctx.board.snapshot();
        assertRevision(current);
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
        const board = await commit(candidate, current);
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
        assertRevision(current);
        const result = await ctx.library.apply(library as BoardLibraryAction, current);
        let active = current;
        if (result.previousRevision !== undefined || result.board.id !== current.id
          || result.board.revision !== current.revision || result.board.title !== current.title) {
          active = await commit({ ...result.board, revision: current.revision + 1 }, current);
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
            /*
             * The canvas repaints from this flat snapshot; `libraryRequest`
             * reads `result.board` first and falls back to it. That fallback is
             * the fix for a real bug: this branch used to return only the agent
             * payload, so `result.board` was always undefined and every library
             * action paid for a second `/api/board` fetch.
             *
             * `active` is deliberately the *current* board, not the requested
             * one: exporting or reading a different saved board must not switch
             * what the person is looking at. The requested board travels in
             * `exportBoard`, which the canvas uses for the download only.
             */
            ...boardWriteSnapshot(active, result.index),
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
        // `layoutBoardItems` validates `mode` itself so the rejection carries a
        // repair path; the schema only proves the field is a string.
        if (layout) next = layoutBoardItems(next, layout as BoardLayoutInput, author ?? "ai");
        return next;
      };
      /*
       * An unpinned write is an append, so it belongs inside the lock.
       *
       * Reading outside the lock and then persisting with that revision made two
       * simultaneous agents fail each other with `expected N, found N+1` even
       * though neither had asked for an optimistic check. `store.mutate`
       * re-reads inside the lock, which is what an unpinned write means. A
       * caller that *did* pin a revision keeps the strict check: that number is
       * a claim about what they last saw, and rebasing it onto a newer board
       * would overwrite whoever got there first.
       */
      let board: SimpleBoard;
      let initial: SimpleBoard;
      /** Set when a pinned write was rebased onto a newer board. */
      let mergedFromRevision: number | undefined;
      if (expected_revision === undefined) {
        initial = await ctx.board.snapshot();
        board = await ctx.board.mutate((current) => change(current));
        ctx.revisions?.remember(board);
      } else {
        initial = await ctx.board.snapshot();
        if (initial.revision === expected_revision) {
          assertRevision(initial);
          board = await commit(change(initial), initial);
        } else if (replace_board !== undefined) {
          throw new BoardRevisionConflictError(expected_revision, initial.revision);
        } else {
          /*
           * A pinned write that lost the race is not automatically a conflict.
           *
           * The revision is board-wide, so an agent drawing a new note was
           * rejected because a person had meanwhile nudged an unrelated card.
           * The HTTP surface already answers the only question that matters —
           * does this request touch anything that moved? — and merges when it
           * does not. The MCP path never did, so a model was told to "reload
           * and retry" for an edit that could simply have landed.
           *
           * A real overlap still refuses, and now names the objects instead of
           * leaving the model to diff two board states itself.
           */
          const base = ctx.revisions?.get(expected_revision);
          /*
           * The cache is per process, so a write from a *different* MCP server
           * (another agent, or the same person in another host) always misses
           * here. Merging needs the board as the caller saw it, and the store
           * keeps only the current one — so this is a real "re-read" case, not
           * a bug. Say so, and give the revision to retry against.
           */
          if (!base) {
            throw new BoardValidationError(
              `Revision ${expected_revision} is not this session's; the board is now at ${initial.revision}`,
              "REVISION_NOT_CACHED",
              "expected_revision",
              `expected_revision: ${initial.revision}`,
              `Call get_board to read the current board and re-send your change with the new revision. A revision is only known to the process that wrote it.`,
            );
          }
          const { touched, conflicts } = reportConflicts(base, initial, {
            updates: cleanUpdates,
            remove_ids,
            layout,
          });
          /*
           * Nothing named, nothing to collide with.
           *
           * `touched` is empty when the request only adds objects: an added
           * item has no id yet, so it cannot overlap an edit someone else made.
           * Treating that as a conflict rejected the most common concurrent
           * write — two agents each drawing a new note — and the loser was told
           * "reload and retry" for a change that never needed to wait.
           */
          if (conflicts.length) throw new ObjectConflictError(expected_revision, initial.revision, conflicts);
          board = await ctx.board.replaceIfRevision(change(initial), initial.revision);
          ctx.revisions?.remember(board);
          mergedFromRevision = expected_revision;
        }
      }
      ctx.preview.broadcast({ type: "board_updated", revision: board.revision });
      const libraryIndex = (await ctx.library.apply({ type: "list" }, board)).index;
      return {
        content: [{
          type: "text" as const,
          text: [
            `✅ 画板已更新 · 新增 ${created} · 更新 ${updated} · 删除 ${removed.size}`,
            /*
             * Say when the write was rebased. The caller pinned a revision, so
             * lying about which one it landed on would hide that someone else
             * wrote in between — the model should know its base moved, even
             * though nothing it touched was overwritten.
             */
            ...(mergedFromRevision === undefined ? [] : [
              `MERGED: 你的 expected_revision ${mergedFromRevision} 已落后；本次改动未碰到他人修改的对象，已合并到 revision ${board.revision}。`,
            ]),
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
        structuredContent: {
          ...boardWriteSnapshot(board, libraryIndex),
          change: changeReport(initial, board),
          ...(mergedFromRevision === undefined ? {} : { mergedFrom: mergedFromRevision }),
        },
      };
    } catch (error) {
      return errorResult("draw_board", error);
    }
  },
);
}
