import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

declare const __DOODLE_PLUGIN_VERSION__: string | undefined;

const sourceDir = path.dirname(fileURLToPath(import.meta.url));
const candidates = [
  path.resolve(sourceDir, "../../package.json"),
  path.resolve(sourceDir, "../..", "..", "package.json"),
];

function readVersion(): string {
  if (typeof __DOODLE_PLUGIN_VERSION__ === "string" && __DOODLE_PLUGIN_VERSION__) {
    return __DOODLE_PLUGIN_VERSION__;
  }
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(fs.readFileSync(candidate, "utf8")) as { version?: string };
      if (parsed.version) return parsed.version;
    } catch {}
  }
  return "0.0.0";
}

export const SERVER_VERSION = readVersion();
