/**
 * MCP tool registration: composition only.
 *
 * Each tool lives in its own module under `mcp/tools/` so a change to one
 * surface cannot accidentally alter another. This file wires them together and
 * owns the one piece of shared state: whether the full drawing guide has
 * already been sent in this process.
 */

import { registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BoardToolContext } from "./context.js";
import { APP_RESOURCE_URI } from "./context.js";
import { registerDrawBoardTool } from "./tools/registerDrawBoardTool.js";
import { registerGetBoardTool } from "./tools/registerGetBoardTool.js";
import { registerScanProjectTool } from "./tools/registerScanProjectTool.js";
import { registerShowBoardTool } from "./tools/registerShowBoardTool.js";

export function registerBoardTools(server: McpServer, ctx: BoardToolContext): void {
  registerAppResource(server, "Doodle Excalidraw board", APP_RESOURCE_URI, {
    _meta: { ui: { prefersBorder: true } },
  }, async () => {
    const html = await ctx.preview.getAppHtml();
    return {
      contents: [{
        uri: APP_RESOURCE_URI,
        mimeType: RESOURCE_MIME_TYPE,
        text: html,
        _meta: { ui: { prefersBorder: true } },
      }],
    };
  });

  // The full guide is expensive and does not change between reads, so send it
  // once per server process unless the caller explicitly asks for it again.
  const state = { guideSent: false };
  registerGetBoardTool(server, ctx, state);
  registerShowBoardTool(server, ctx, state);
  registerDrawBoardTool(server, ctx);
  registerScanProjectTool(server, ctx);
}
