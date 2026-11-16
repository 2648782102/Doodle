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
  errorResult,
  viewPayload,
} from "../presentation.js";
import { boardAgentDelta, summarizeAgentBoard } from "../../agent-view.js";
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
      since_revision: z.number().int().min(0).optional()
        .describe("Optional revision you already read. Returns only objects added, updated, or removed since it, or a compact unchanged summary."),
      include_guide: z.boolean().optional()
        .describe("Include the full capabilities, recipes, and drawing guide. Defaults to true on a first or empty read and false on later reads, where the initialization instructions already cover them."),
      include_canvas_fidelity: z.boolean().optional()
        .describe("Return Excalidraw scene fidelity with each item. Use only to rebuild a canvas; it is large and not useful for reading or drawing."),
      view: z.enum(["summary", "structure", "detail", "full"]).optional()
        .describe("Token level. `full` (default) is unchanged; `summary` returns digest/diagnosis only, `structure` adds ids/coordinates/roles without text blobs, `detail` is the normal agent payload without capabilities/guide."),
    }),
    annotations: READ_ONLY_LOCAL_ANNOTATIONS,
  },
  async ({ since_revision, include_guide, include_canvas_fidelity, view }: { since_revision?: number; include_guide?: boolean; include_canvas_fidelity?: boolean; view?: "summary" | "structure" | "detail" | "full" }) => {
    try {
      const current = await ctx.board.snapshot();
      const revisions = ctx.revisions;
      const previous = since_revision === undefined ? undefined : revisions?.get(since_revision);
      revisions?.remember(current);
      const payload = include_canvas_fidelity
        ? boardJson(current, (await ctx.library.apply({ type: "list" }, current)).index)
        : boardAgentPayload(current, (await ctx.library.apply({ type: "list" }, current)).index);
      const visiblePayload = viewPayload(payload as Record<string, unknown>, view);
      const firstUse = payload.itemCount === 0;
      const withGuide = include_guide ?? (firstUse || !state.guideSent);
      if (withGuide) state.guideSent = true;
      const guidance = firstUse ? [
        "FIRST_USE: 空画板。用户想看时调用 show_board；AI 表达意图时调用 draw_board。",
        "NEXT_STEPS: draw_board → 保持画布可见 → 读取人的画图后用 get_board 或当前会话上下文。首张画板见下方 Drawing guide。",
      ] : [
        `NEXT: 这是 revision ${payload.revision} 的完整画板。下次只在需要时传 since_revision: ${payload.revision} 读差量；show_board 显示，draw_board 画图回应。Use draw_board to visualize any context.`,
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
            JSON.stringify(handoff, null, 2),
            "",
          ] : []),
          "BOARD_DELTA_JSON:",
          JSON.stringify(delta, null, 2),
          "",
          "BOARD_SUMMARY_JSON:",
          JSON.stringify(summarizeAgentBoard(current), null, 2),
          "",
          "VISUAL_DIAGNOSIS_JSON:",
          JSON.stringify(payload.diagnosis, null, 2),
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
            diagnosis: payload.diagnosis,
          },
        };
      }

      const staleSince = since_revision !== undefined && !previous;
      return {
        content: [{
          type: "text" as const,
          text: [
            `🎨 共享画布 · revision ${payload.revision} · ${payload.itemCount} 个对象`,
            ``,
            ...(staleSince ? [`NOTE: revision ${since_revision} 已不在缓存中，返回完整画板。`, ``] : []),
            ...guidance,
            "VISUAL_DIAGNOSIS:",
            JSON.stringify(visiblePayload.diagnosis, null, 2),
            "",
            `${view && view !== "full" ? `BOARD_VIEW_${view.toUpperCase()}` : "BOARD_JSON"}:`,
            JSON.stringify(visiblePayload, null, 2),
            ``,
            ...(withGuide ? [
              ...(firstUse ? [boardGuidance(), ``] : []),
              "CAPABILITIES:",
              JSON.stringify((visiblePayload as any).capabilities ?? payload.capabilities, null, 2),
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
