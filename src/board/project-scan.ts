import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_MAX_FILES = 80;
const DEFAULT_MAX_DEPTH = 3;
const MAX_TEXT_BYTES = 64 * 1024;
const SOURCE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".md",
  ".css", ".scss", ".html", ".yml", ".yaml", ".toml", ".py", ".go", ".rs",
]);
const SKIPPED_DIRECTORIES = new Set([
  ".git", "node_modules", "dist", "build", "coverage", ".next", ".nuxt",
  ".cache", ".codex", "vendor", "output", ".ai-draw",
]);

export interface ProjectEvidence {
  path: string;
  line: number;
  kind: "definition" | "heading" | "import";
  excerpt: string;
}

export interface ProjectFile {
  path: string;
  kind: "file" | "directory";
  depth: number;
  size?: number;
  evidence?: ProjectEvidence[];
}

export interface ProjectSnapshot {
  version: 1;
  workspaceName: string;
  maxDepth: number;
  maxFiles: number;
  files: ProjectFile[];
  directories: string[];
  evidence: ProjectEvidence[];
  truncated: boolean;
  generatedAt: string;
  readOnly: true;
  writes: "none";
}

export interface ProjectScanOptions {
  maxDepth?: number;
  maxFiles?: number;
  includeEvidence?: boolean;
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.floor(value)));
}

function relativePath(root: string, absolute: string): string {
  return path.relative(root, absolute).split(path.sep).join("/");
}

function isPrivateEntry(relative: string): boolean {
  return relative.split("/").some((segment) =>
    segment.startsWith(".") || segment.toLowerCase().startsWith(".env"));
}

async function collectEvidence(root: string, absolute: string): Promise<ProjectEvidence[]> {
  const relative = relativePath(root, absolute);
  if (!SOURCE_EXTENSIONS.has(path.extname(absolute).toLowerCase())) return [];
  let source: string;
  try {
    const stats = await fs.stat(absolute);
    if (stats.size > MAX_TEXT_BYTES) return [];
    source = await fs.readFile(absolute, "utf8");
  } catch {
    return [];
  }
  const evidence: ProjectEvidence[] = [];
  const lines = source.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    if (evidence.length >= 5) break;
    const trimmed = line.trim().slice(0, 160);
    if (!trimmed) continue;
    let kind: ProjectEvidence["kind"] | null = null;
    if (/^(export\s+)?(async\s+)?(function|class|interface|type|const|enum)\b/.test(trimmed)) kind = "definition";
    else if (/^import\s.+\sfrom\s/.test(trimmed) || /^from\s.+\simport\s/.test(trimmed)) kind = "import";
    else if (/^#{1,6}\s/.test(trimmed)) kind = "heading";
    if (kind) evidence.push({ path: relative, line: index + 1, kind, excerpt: trimmed });
  }
  return evidence;
}

export async function scanProject(root: string, options: ProjectScanOptions = {}): Promise<ProjectSnapshot> {
  const workspaceRoot = path.resolve(root);
  const maxDepth = boundedInteger(options.maxDepth, DEFAULT_MAX_DEPTH, 1, 6);
  const maxFiles = boundedInteger(options.maxFiles, DEFAULT_MAX_FILES, 1, 400);
  const includeEvidence = options.includeEvidence !== false;
  const files: ProjectFile[] = [];
  const directories: string[] = [];
  const evidence: ProjectEvidence[] = [];
  let truncated = false;

  async function walk(absolute: string, depth: number): Promise<void> {
    if (files.length >= maxFiles) {
      truncated = true;
      return;
    }
    let entries;
    try {
      entries = await fs.readdir(absolute, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (files.length >= maxFiles) {
        truncated = true;
        break;
      }
      const child = path.join(absolute, entry.name);
      const relative = relativePath(workspaceRoot, child);
      if (!relative || relative.startsWith("..") || isPrivateEntry(relative)) continue;
      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
        directories.push(relative);
        files.push({ path: relative, kind: "directory", depth });
        if (depth < maxDepth) await walk(child, depth + 1);
      } else if (entry.isFile()) {
        let size: number | undefined;
        try {
          size = (await fs.stat(child)).size;
        } catch {
          continue;
        }
        const fileEvidence = includeEvidence ? await collectEvidence(workspaceRoot, child) : [];
        evidence.push(...fileEvidence);
        files.push({ path: relative, kind: "file", depth, size, evidence: fileEvidence });
      }
    }
  }

  await walk(workspaceRoot, 0);
  return {
    version: 1,
    workspaceName: path.basename(workspaceRoot) || "workspace",
    maxDepth,
    maxFiles,
    files,
    directories,
    evidence,
    truncated,
    generatedAt: new Date().toISOString(),
    readOnly: true,
    writes: "none",
  };
}

export function projectSnapshotText(snapshot: ProjectSnapshot): string {
  const lines = [
    `PROJECT_JSON version 1 · ${snapshot.files.length} entries · depth <= ${snapshot.maxDepth}`,
    snapshot.truncated ? "Truncated at the requested bounded limit." : "Complete within the requested limit.",
    "Use draw_board to put the structure on the shared canvas. This tool only reads the workspace.",
    `Directories: ${snapshot.directories.slice(0, 24).join(", ") || "(none)"}`,
  ];
  for (const file of snapshot.files.slice(0, 80)) {
    lines.push(`${file.kind === "directory" ? "dir " : "file"} ${file.path}${file.size !== undefined ? ` (${file.size}B)` : ""}`);
  }
  if (snapshot.evidence.length) {
    lines.push("Evidence:");
    for (const item of snapshot.evidence.slice(0, 40)) {
      lines.push(`- ${item.path}:${item.line} · ${item.kind} · ${item.excerpt}`);
    }
  }
  return lines.join("\n");
}
