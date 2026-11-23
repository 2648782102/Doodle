/**
 * `show_board`: render the interactive canvas in a compatible MCP Apps host.
 *
 * Separate from `get_board` because showing the canvas is a UI action; reading
 * the board must stay useful in hosts that cannot render it.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { APP_RESOURCE_URI, CANVAS_UI_META, READ_ONLY_LOCAL_ANNOTATIONS, type BoardToolContext } from "../context.js";
import { boardJson, boardRecipes, errorResult } from "../presentation.js";

export function registerShowBoardTool(
  server: McpServer,
  ctx: BoardToolContext,
  state: { guideSent: boolean },
): void {
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
      const current = await ctx.board.snapshot();
      const snapshot = boardJson(current, (await ctx.library.apply({ type: "list" }, current)).index);
      /*
       * The canvas needs the board; the model needs the guide once.
       *
       * `show_board` returned CAPABILITIES and RECIPES on every call, and it is
       * called repeatedly (once per view request, and after a draw in hosts
       * that cannot render the MCP App from the write result). The guide is the
       * same bytes each time and `get_board` already shares this flag.
       */
      const withGuide = !state.guideSent;
      if (withGuide) state.guideSent = true;
      return {
        content: [{
          type: "text" as const,
          text: [
            `🎨 共享画布 · revision ${snapshot.revision} · ${snapshot.itemCount} 个对象`,
            `兼容宿主会显示可交互画布；文本宿主打开下方 PANEL_URL。`,
            `PANEL_URL: ${ctx.preview.panelUrl ?? "unavailable (standalone preview not started)"}`,
            `NEXT: 画布显示的是完整保真数据；要读对象用 get_board（可传 since_revision: ${snapshot.revision} 只取差量）。`,
            ...(withGuide ? [
              "CAPABILITIES:",
              JSON.stringify(snapshot.capabilities),
              "RECIPES:",
              boardRecipes(),
            ] : [
              "GUIDE: capabilities and recipes are omitted on repeat shows. Call get_board with include_guide: true when you need them.",
            ]),
            "VISUAL_DIGEST:",
            JSON.stringify(snapshot.visualDigest, null, 2),
          ].join("\n"),
        }],
        structuredContent: snapshot,
      };
    } catch (error) {
      return errorResult("show_board", error);
    }
  },
);
}
