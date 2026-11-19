import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
const pluginRoot = path.join(root, ".doodle-plugin", "doodle");
const archive = path.join(root, "doodle-plugin-submission", `doodle-${packageJson.version}.zip`);

await fs.mkdir(path.dirname(archive), { recursive: true });
await fs.rm(archive, { force: true });
await fs.access(pluginRoot);
/*
 * Windows ships bsdtar in System32, but a Git Bash or MSYS shell puts a GNU tar
 * earlier on PATH. GNU tar reads `C:\...` as a `host:path` remote and fails
 * with "Cannot connect to C: resolve failed", so name the Windows binary.
 */
const archiveCommand = process.platform === "win32"
  ? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe")
  : "zip";
const archiveArgs = process.platform === "win32"
  ? ["-a", "-c", "-f", archive, "doodle"]
  : ["-q", "-r", archive, "doodle"];
const result = spawnSync(archiveCommand, archiveArgs, {
  cwd: path.join(root, ".doodle-plugin"),
  stdio: "inherit",
});
if (result.error || result.status !== 0) {
  throw new Error(`Failed to build submission ZIP: ${result.error?.message ?? result.status}`);
}
const stats = await fs.stat(archive);
console.log(`✅ Built submission ZIP at ${path.relative(root, archive)} (${stats.size} bytes)`);
