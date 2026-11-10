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
const result = spawnSync("zip", ["-q", "-r", archive, "doodle"], {
  cwd: path.join(root, ".doodle-plugin"),
  stdio: "inherit",
});
if (result.status !== 0) throw new Error(`Failed to build submission ZIP: ${result.status}`);
const stats = await fs.stat(archive);
console.log(`✅ Built submission ZIP at ${path.relative(root, archive)} (${stats.size} bytes)`);
