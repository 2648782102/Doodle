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
  } catch (error) {
    logger.error(`Preview unavailable: ${error instanceof Error ? error.message : String(error)}`);
    logger.info("doodle-mcp is running (stdio only)");
  }
}

main().catch((err) => {
  logger.error(`Fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
