import path from "node:path";
import { fileURLToPath } from "node:url";
import { projectWorkspace } from "./project-workspace.js";

const sourceDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(sourceDir, "../..");

/** `DOODLE_WORKSPACE_ROOT` points project scanning at the open project; `AI_DRAW_WORKSPACE_ROOT` remains a legacy alias. */
export function resolveWorkspaceRoot(): string {
  const configured = process.env.DOODLE_WORKSPACE_ROOT?.trim() || process.env.AI_DRAW_WORKSPACE_ROOT?.trim();
  return configured ? path.resolve(configured) : projectWorkspace();
}

export { packageRoot };
