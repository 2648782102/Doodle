/**
 * `get_board`: read the shared board.
 *
 * Sends the full drawing guide once per process, then degrades to a compact
 * payload; with `since_revision` it returns a final-state delta plus the human
 * handoff instead of the whole board.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { READ_ONLY_LOCAL_ANNOTATIONS, type BoardToolContext } from "../context.js";
import {
  boardAgentPayload,
  boardGuidance,
  boardJson,
  boardRecipes,
  compactDiagnosis,
  errorResult,
  viewPayload,
} from "../presentation.js";
import { boardAgentDelta, summarizeAgentBoard } from "../../agent-view.js";
import { BoardValidationError } from "../../errors.js";
import { describeHandoff, handoffNextStep } from "../../handoff.js";

export function registerGetBoardTool(
  server: McpServer,
  ctx: BoardToolContext,
  state: { guideSent: boolean },
): void {
server.registerTool(
  "get_board",
  {
    description: "读取人和 AI 共享画布的数据：revision、对象 ID、坐标、作者、BOARD_JSON 和画图规范。用于回答画布内容或给 Agent 提供视觉上下文；只读，不打开浏览器，也不写项目文件。重复读取同一画板时传 since_revision，只返回变化的对象。画布保真元数据不会出现在返回里。想显示可编辑画布时调用 show_board。",
    inputSchema: z.object({
      since_revision: z.number().int().optional()
        .describe("Optional revision you already read. Returns only objects added, updated, or removed since it, or a compact unchanged summary."),
      include_guide: z.boolean().optional()
        .describe("Include the full capabilities, recipes, and drawing guide. Defaults to true on a first or empty read and false on later reads, where the initialization instructions already cover them."),
      include_canvas_fidelity: z.boolean().optional()
        .describe("Return Excalidraw scene fidelity with each item. Use only to rebuild a canvas; it is large and not useful for reading or drawing."),
      view: z.string().optional()
        .describe("Token level. `full` (default) returns the complete board in both text and structuredContent. `summary` returns digest/diagnosis only, `structure` adds ids/coordinates/roles without text blobs, `detail` is the agent payload without capabilities/guide. Graded views put the data in structuredContent only and omit the duplicate BOARD_JSON text copy, so they cost roughly a third of `full`."),
    }),
    annotations: READ_ONLY_LOCAL_ANNOTATIONS,
  },
  async ({ since_revision, include_guide, include_canvas_fidelity, view: rawView }: { since_revision?: number; include_guide?: boolean; include_canvas_fidelity?: boolean; view?: string }) => {
    try {
      /*
       * Both arguments are validated here rather than by `z.enum` / `.min(0)`
       * so a bad value comes back as `ERROR_JSON` naming the accepted range,
       * the same as every other bound. A read is cheap to retry, but the model
       * still should not have to guess what the field accepts.
       */
      const VIEWS = ["summary", "structure", "detail", "full"] as const;
      if (rawView !== undefined && !VIEWS.includes(rawView as typeof VIEWS[number])) {
        throw new BoardValidationError(
          `view is ${JSON.stringify(rawView)}; expected one of ${VIEWS.join(", ")}`,
          "INVALID_VIEW",
          "view",
          VIEWS.join(", "),
          `Leave it out for a full read, or use "summary" for a status check and "structure" for ids and coordinates without text.`,
        );
      }
      if (since_revision !== undefined && (!Number.isInteger(since_revision) || since_revision < 0)) {
        throw new BoardValidationError(
          `since_revision is ${JSON.stringify(since_revision)}; it must be a revision you already read`,
          "INVALID_SINCE_REVISION",
          "since_revision",
          "a non-negative integer",
          `Pass the revision from the last get_board reply, or omit it for a full read.`,
        );
      }
      const view = rawView as typeof VIEWS[number] | undefined;
      const current = await ctx.board.snapshot();
      const revisions = ctx.revisions;
      /*
       * A revision only means something relative to the board it came from.
       *
       * The cache is keyed by revision alone, so asking for a delta after a
       * library switch compared the *new* board against the *old* board's
       * revision. The reply then described every object of the new board as
       * "added" and every object of the old one as "removed" — a change report
       * for something the person never did. Dropping `previous` when the ids
       * differ falls back to a full read that says so.
       */
      const cached = since_revision === undefined ? undefined : revisions?.get(since_revision);
      const previous = cached && cached.id === current.id ? cached : undefined;
      revisions?.remember(current);
      const payload = include_canvas_fidelity
        ? boardJson(current, (await ctx.library.apply({ type: "list" }, current)).index)
        : boardAgentPayload(current, (await ctx.library.apply({ type: "list" }, current)).index);
      const visiblePayload = viewPayload(payload as Record<string, unknown>, view);
      const firstUse = payload.itemCount === 0;
      /*
       * `guideSent` has to be the deciding flag.
       *
       * `firstUse || !state.guideSent` made the guide permanent on an empty
       * board: `firstUse` stayed true on every reread, so `guideSent` never
       * suppressed anything and four consecutive empty reads each cost the
       * same 10,989 bytes. An empty board is the most-reread state there is -
       * an agent checking whether the person has drawn yet - so it was the
       * worst place to repeat the full guide.
       */
      const withGuide = include_guide ?? !state.guideSent;
      if (withGuide) state.guideSent = true;
      const guidance = firstUse ? [
        "FIRST_USE: 空画板。用户想看时调用 show_board；AI 表达意图时调用 draw_board。",
        "NEXT_STEPS: draw_board → 保持画布可见 → 读取人的画图后用 get_board 或当前会话上下文。",
      ] : [
        `NEXT: 这是 revision ${payload.revision} 的完整画板。下次只在需要时传 since_revision: ${payload.revision} 读差量；show_board 显示，draw_board 画图回应。Use draw_board to visualize any context.`,
        /*
         * A full read of a large board is genuinely expensive — 400 objects
         * came to 152 KB, against 6 KB for the same board at view: "summary".
         * Naming the cheaper entries in the reply is what lets a model choose
         * them without being told the byte counts first.
         */
        ...(payload.itemCount > 80 ? [
          `SIZE: ${payload.itemCount} 个对象，整板约 ${Math.round(JSON.stringify(payload).length / 1024)} KB。只想确认状态用 view: "summary"（约 6 KB）；只要对象骨架用 view: "structure"；已知 revision 就传 since_revision 只读差量。`,
        ] : []),
      ];

      if (since_revision !== undefined && previous) {
        const delta = boardAgentDelta(current, previous);
        const handoff = describeHandoff(current, previous);
        const deltaText = [
          `🎨 共享画布 · rev ${delta.baseRevision} → rev ${delta.revision} · ${delta.unchanged ? "无变化" : `新增 ${delta.added.length} · 更新 ${delta.updated.length} · 删除 ${delta.removed.length}`}`,
          "",
          `HANDOFF: ${handoff.summary}`,
          ...(handoff.needsAttention ? [
            ...(handoff.readings.length ? [
              "HANDOFF_READINGS:",
              ...handoff.readings.map((reading) => `- ${reading.reading}${reading.suggestion ? ` → ${reading.suggestion}` : ""}`),
              "",
            ] : []),
            "HANDOFF_JSON:",
            JSON.stringify(handoff),
            "",
          ] : []),
          "BOARD_DELTA_JSON:",
          JSON.stringify(delta),
          "",
          "BOARD_SUMMARY_JSON:",
          JSON.stringify(summarizeAgentBoard(current)),
          "",
          "VISUAL_DIAGNOSIS_JSON:",
          // A delta answers "what changed", so the full per-object diagnosis
          // (1.4 KB at 80 objects) is the wrong shape here: counts suffice.
          JSON.stringify(compactDiagnosis(payload.diagnosis)),
          "",
          handoffNextStep(handoff),
          `PANEL_URL: ${ctx.preview.panelUrl ?? "unavailable (standalone preview not started)"}`,
        ].join("\n");
        return {
          content: [{ type: "text" as const, text: deltaText }],
          structuredContent: {
            version: 1,
            readOnly: true,
            mode: "delta",
            ...delta,
            handoff,
            summary: summarizeAgentBoard(current),
            diagnosis: compactDiagnosis(payload.diagnosis),
          },
        };
      }

      const staleSince = since_revision !== undefined && !previous;
      const switchedBoard = since_revision !== undefined && Boolean(cached) && cached!.id !== current.id;
      return {
        content: [{
          type: "text" as const,
          text: [
            `🎨 共享画布 · revision ${payload.revision} · ${payload.itemCount} 个对象`,
            ``,
            ...(switchedBoard
              ? [`NOTE: revision ${since_revision} 属于另一张画板（切换前）。差量只在同一张板内有意义，这里返回完整画板。`, ``]
              : staleSince ? [`NOTE: revision ${since_revision} 已不在缓存中，返回完整画板。`, ``] : []),
            ...guidance,
            "VISUAL_DIAGNOSIS:",
            JSON.stringify(visiblePayload.diagnosis, null, 2),
            "",
            /*
             * `full` keeps a complete `BOARD_JSON` copy; graded views do not.
             *
             * The text copy is byte-identical to `structuredContent`, so on a
             * `full` read it is 11 KB of the 32 KB response — real value for a
             * model that only reads text, and a contract several docs pin. But
             * `view` exists to cut tokens, and it was still shipping both
             * channels in full: `detail` cost 24.5 KB. A graded view names its
             * payload and lets the host read `structuredContent`, which every
             * MCP client receives regardless.
             */
            ...(view && view !== "full"
              ? [
                `BOARD_VIEW_${view.toUpperCase()}: 见 structuredContent（已省略重复的文本副本；需要完整 JSON 时用 view: "full"）。`,
                `BOARD_VIEW_${view.toUpperCase()}_BYTES: ${JSON.stringify(visiblePayload).length}`,
              ]
              : ["BOARD_JSON:", JSON.stringify(visiblePayload)]),
            ``,
            /*
             * `view` has to cut the text block too, not only the payload.
             *
             * `view: "summary"` dropped `items` from the structured half while
             * the text half still carried CAPABILITIES, RECIPES, and the full
             * drawing guide - so the cheap view cost 15,239 bytes, barely less
             * than a full read. A summary read is a status check; it does not
             * need authoring instructions.
             */
            ...(view === "summary" ? [] : withGuide ? [
              ...(firstUse ? [boardGuidance(), ``] : []),
              "CAPABILITIES:",
              JSON.stringify((visiblePayload as any).capabilities ?? payload.capabilities),
              "VISUAL_DIGEST:",
              JSON.stringify(visiblePayload.visualDigest, null, 2),
              "RECIPES:",
              boardRecipes(),
            ] : [
              `GUIDE: capabilities, recipes, and the drawing guide are omitted on rereads. Call get_board with include_guide: true when you need them.`,
              "VISUAL_DIGEST:",
              JSON.stringify(visiblePayload.visualDigest, null, 2),
            ]),
            ``,
            `PANEL_URL: ${ctx.preview.panelUrl ?? "unavailable (standalone preview not started)"}`,
          ].join("\n"),
        }],
        structuredContent: visiblePayload,
      };
    } catch (error) {
      return errorResult("get_board", error);
    }
  },
);
}
