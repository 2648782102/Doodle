#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { logger } from "./infra/logger.js";

async function main() {
  const { mcp, preview } = await createServer();
  const transport = new StdioServerTransport();
  await mcp.connect(transport);
  try {
    await preview.start();
    logger.info("doodle-mcp is running (stdio + preview server)");
    // stdout carries MCP JSON-RPC, so the human hint goes to stderr. Without it
    // a person who runs `npx doodle-mcp` sees a server start and no idea that a
    // canvas exists or where it is.
    if (preview.panelUrl) {
      process.stderr.write(`\n  Doodle 画板: ${preview.panelUrl}\n  在浏览器打开即可直接画；和 AI 一起用时在宿主里说「打开 Doodle 画板」。\n\n`);
    }
  } catch (error) {
    logger.error(`Preview unavailable: ${error instanceof Error ? error.message : String(error)}`);
    logger.info("doodle-mcp is running (stdio only)");
  }
}

main().catch((err) => {
  logger.error(`Fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
