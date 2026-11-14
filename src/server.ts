import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  BoardHttpServer,
  BoardLibrary,
  BoardStore,
  MCP_INSTRUCTIONS,
  registerBoardTools,
} from "./board/index.js";
import { ensureOutputDirWritable, loadRuntimeConfig } from "./infra/config.js";
import { logger } from "./infra/logger.js";
import { SERVER_VERSION } from "./infra/version.js";

const TOOL_COUNT = 4;

export async function createServer() {
  const config = await loadRuntimeConfig();
  await ensureOutputDirWritable(config.outputDir);

  const board = new BoardStore(config.outputDir);
  await board.init();
  const library = new BoardLibrary(config.outputDir);
  const preview = new BoardHttpServer(board, config);
  const mcp = new McpServer(
    { name: "doodle-mcp", version: SERVER_VERSION },
    { instructions: MCP_INSTRUCTIONS },
  );

  registerBoardTools(mcp, { board, preview, config, library });
  logger.info(`${TOOL_COUNT} MCP tools registered`);

  return { mcp, preview, config, board };
}
