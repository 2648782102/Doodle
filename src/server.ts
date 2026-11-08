import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  BoardHttpServer,
  BoardStore,
  MCP_INSTRUCTIONS,
  registerBoardTools,
} from "./board/index.js";
import { loadConfig, ensureOutputDirWritable } from "./infra/config.js";
import { logger } from "./infra/logger.js";
import { SERVER_VERSION } from "./infra/version.js";

const TOOL_COUNT = 4;

export async function createServer() {
  const config = loadConfig();
  await ensureOutputDirWritable(config.outputDir);

  const board = new BoardStore(config.outputDir);
  await board.init();
  const preview = new BoardHttpServer(board, config);
  const mcp = new McpServer(
    { name: "doodle-mcp", version: SERVER_VERSION },
    { instructions: MCP_INSTRUCTIONS },
  );

  registerBoardTools(mcp, { board, preview, config });
  logger.info(`${TOOL_COUNT} MCP tools registered`);

  return { mcp, preview, config, board };
}
