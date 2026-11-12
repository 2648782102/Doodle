import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { projectWorkspace } from "./project-workspace.js";
import { resolveWorkspaceRoot } from "./workspace.js";

const sourceDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(sourceDir, "../..");

export interface AppConfig {
  previewHost: string;
  previewPort: number | null;
  outputDir: string;
  workspaceRoot: string;
  cwd: string;
}

function parsePort(raw: string): number {
  const value = Number.parseInt(raw, 10);
  if (raw.trim() === "0") return 0;
  if (!Number.isFinite(value) || value < 0 || value > 65535) {
    throw new Error(`PREVIEW_PORT invalid (got ${JSON.stringify(raw)}). Use 0 for auto, or 1–65535.`);
  }
  return value;
}

function resolveOutputDir(): string {
  const explicit = process.env.OUTPUT_DIR?.trim();
  if (explicit) return path.resolve(explicit);

  const pluginData = process.env.PLUGIN_DATA?.trim() || process.env.CLAUDE_PLUGIN_DATA?.trim();
  if (pluginData) return path.join(path.resolve(pluginData), "doodle");

  const workspace = projectWorkspace();
  return workspace === packageRoot
    ? path.join(packageRoot, "output")
    : path.join(workspace, ".doodle-data");
}

export function loadConfig(): AppConfig {
  const rawPort = process.env.PREVIEW_PORT?.trim();
  return {
    previewHost: (process.env.PREVIEW_HOST ?? "127.0.0.1").trim() || "127.0.0.1",
    previewPort: rawPort ? parsePort(rawPort) : null,
    outputDir: resolveOutputDir(),
    workspaceRoot: resolveWorkspaceRoot(),
    cwd: process.cwd(),
  };
}

export async function loadRuntimeConfig(): Promise<AppConfig> {
  return loadConfig();
}

export async function ensureOutputDirWritable(outputDir: string): Promise<void> {
  await fs.mkdir(outputDir, { recursive: true });
  const probe = path.join(outputDir, ".doodle-write-probe");
  try {
    await fs.writeFile(probe, "ok", "utf8");
    await fs.unlink(probe);
  } catch (error) {
    throw new Error(`OUTPUT_DIR not writable: ${outputDir}\n${error instanceof Error ? error.message : String(error)}`);
  }
}
