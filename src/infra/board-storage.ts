import path from "node:path";
import { fileURLToPath } from "node:url";

const sourceDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(sourceDir, "../..");

function isPluginInternalPath(candidate: string): boolean {
  return candidate.startsWith(path.join(packageRoot, ".codex"))
    || candidate.includes(`${path.sep}.codex${path.sep}plugins${path.sep}`);
}

/** Resolve a host-provided directory for local board data; never reads its contents. */
export function boardStorageRoot(): string {
  const candidates = [process.env.CODEX_PROJECT_ROOT?.trim(), process.env.PWD?.trim()];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const resolved = path.resolve(candidate);
    if (!isPluginInternalPath(resolved)) return resolved;
  }
  const cwd = process.cwd();
  return isPluginInternalPath(cwd) ? packageRoot : cwd;
}
