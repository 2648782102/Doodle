/**
 * `scan_project`: optional read-only project context.
 *
 * Returns bounded paths and evidence plus a ready-to-draw diagram draft. It
 * never writes project files and never draws on its own.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { READ_ONLY_LOCAL_ANNOTATIONS, type BoardToolContext } from "../context.js";
import { errorResult } from "../presentation.js";
import { scanProject } from "../../project-scan.js";
import { projectDiagramDraft } from "../../project-diagram.js";

export function registerScanProjectTool(server: McpServer, ctx: BoardToolContext): void {
server.registerTool(
  "scan_project",
  {
    description: "可选能力：只读扫描当前工作区的目录与文件路径，并返回少量 file:line 证据文本，同时给一份可直接传给 draw_board.diagram 的草图（DIAGRAM_DRAFT_JSON）。项目结构只是画板可以讨论的内容之一；本工具不生成图、不改画板、不写文件，也不授权代码变更。要可视化时把草图传给 draw_board。",
    inputSchema: z.object({
      max_depth: z.number().int().min(1).max(6).optional().describe("Maximum directory depth; defaults to 3, maximum 6"),
      max_files: z.number().int().min(1).max(400).optional().describe("Maximum number of entries; defaults to 80, maximum 400"),
      include_evidence: z.boolean().optional().describe("Include bounded file:line evidence; defaults to true"),
    }),
    annotations: READ_ONLY_LOCAL_ANNOTATIONS,
  },
  async ({ max_depth, max_files, include_evidence }) => {
    try {
      const snapshot = await scanProject(ctx.config.workspaceRoot, {
        maxDepth: max_depth,
        maxFiles: max_files,
        includeEvidence: include_evidence,
      });
      return {
        content: [{
          type: "text" as const,
          text: [
            "PROJECT_JSON:",
            JSON.stringify(snapshot, null, 2),
            "DIAGRAM_DRAFT_JSON:",
            JSON.stringify(projectDiagramDraft(snapshot), null, 2),
          ].join("\n"),
        }],
        structuredContent: {
          ...snapshot,
          diagramDraft: projectDiagramDraft(snapshot),
        },
      };
    } catch (error) {
      return errorResult("scan_project", error);
    }
  },
);
}
