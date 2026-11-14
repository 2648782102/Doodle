import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = path.join(root, "plugins", "doodle");
const targetDir = path.join(root, ".doodle-plugin", "doodle");
const serverDir = path.join(targetDir, "server");
const serverTemplateDir = path.join(serverDir, "infra", "templates");
const rootTemplateDir = path.join(targetDir, "infra", "templates");
const distTemplateDir = path.join(root, "dist", "infra", "templates");
const packageJson = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));

await fs.rm(targetDir, { recursive: true, force: true });
await fs.mkdir(serverTemplateDir, { recursive: true });
await fs.mkdir(rootTemplateDir, { recursive: true });
await fs.cp(sourceDir, targetDir, { recursive: true });

for (const name of ["board.html", "board-app.js", "excalidraw.html"]) {
  const source = path.join(distTemplateDir, name);
  await fs.copyFile(source, path.join(serverTemplateDir, name));
  await fs.copyFile(source, path.join(rootTemplateDir, name));
}
await fs.cp(path.join(distTemplateDir, "excalidraw"), path.join(serverTemplateDir, "excalidraw"), { recursive: true });
await fs.cp(path.join(distTemplateDir, "excalidraw"), path.join(rootTemplateDir, "excalidraw"), { recursive: true });

await build({
  entryPoints: [path.join(root, "src", "index.ts")],
  outfile: path.join(serverDir, "index.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  external: ["bufferutil", "utf-8-validate"],
  banner: {
    js: [
      "import { createRequire as __doodleCreateRequire } from 'node:module';",
      "const require = __doodleCreateRequire(import.meta.url);",
    ].join(" "),
  },
  define: {
    __DOODLE_PLUGIN_VERSION__: JSON.stringify(packageJson.version),
  },
  logLevel: "warning",
});

console.log("✅ Built installable Doodle plugin at .doodle-plugin/doodle");
