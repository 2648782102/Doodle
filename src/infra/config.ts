import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveWorkspaceRoot } from "./workspace.js";

const sourceDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(sourceDir, "../..");

export interface AppConfig {
  previewHost: string;
  previewPort: number;
  outputDir: string;
  workspaceRoot: string;
}

function parsePort(raw: string | undefined): number {
  const value = Number.parseInt(raw ?? "3399", 10);
  if (!Number.isFinite(value) || value < 1 || value > 65535) {
    throw new Error(`PREVIEW_PORT invalid (got ${JSON.stringify(raw)}). Use 1–65535.`);
  }
  return value;
}

export function loadConfig(): AppConfig {
  return {
    previewHost: (process.env.PREVIEW_HOST ?? "127.0.0.1").trim() || "127.0.0.1",
    previewPort: parsePort(process.env.PREVIEW_PORT),
    outputDir: path.resolve(process.env.OUTPUT_DIR ?? path.join(packageRoot, "output")),
    workspaceRoot: resolveWorkspaceRoot(),
  };
}

export async function ensureOutputDirWritable(outputDir: string): Promise<void> {
  await fs.mkdir(outputDir, { recursive: true });
  const probe = path.join(outputDir, ".ai-draw-write-probe");
  try {
    await fs.writeFile(probe, "ok", "utf8");
    await fs.unlink(probe);
  } catch (error) {
    throw new Error(`OUTPUT_DIR not writable: ${outputDir}\n${error instanceof Error ? error.message : String(error)}`);
  }
}
