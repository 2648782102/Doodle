import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as bundle } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(root, "src");
const distDir = path.join(root, "dist");
const sourceDir = path.join(root, "src", "infra", "templates");
const targetDir = path.join(distDir, "infra", "templates");

async function expectedCompiledFiles(directory) {
  const result = new Set();
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      for (const file of await expectedCompiledFiles(absolute)) result.add(file);
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      const relative = path.relative(sourceRoot, absolute).split(path.sep).join("/").replace(/\.ts$/, "");
      for (const extension of [".js", ".js.map", ".d.ts", ".d.ts.map"]) {
        result.add(`${relative}${extension}`);
      }
    }
  }
  return result;
}

async function pruneCompiledFiles(directory, expected, prefix = "") {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await pruneCompiledFiles(absolute, expected, relative);
      if ((await fs.readdir(absolute)).length === 0) await fs.rmdir(absolute);
    } else if (entry.isFile() && !expected.has(relative) && !relative.startsWith("infra/templates/")) {
      await fs.rm(absolute);
    }
  }
}

const expected = await expectedCompiledFiles(sourceRoot);
for (const name of ["board.html"]) expected.add(`infra/templates/${name}`);
await fs.mkdir(distDir, { recursive: true });
await pruneCompiledFiles(distDir, expected);
await fs.mkdir(targetDir, { recursive: true });
for (const name of await fs.readdir(targetDir)) {
  if (!expected.has(`infra/templates/${name}`)) {
    await fs.rm(path.join(targetDir, name), { recursive: true, force: true });
  }
}
for (const name of await fs.readdir(sourceDir)) {
  await fs.copyFile(path.join(sourceDir, name), path.join(targetDir, name));
}
const appBundle = await bundle({
  entryPoints: [path.join(sourceRoot, "board", "app.ts")],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  write: false,
});
await fs.writeFile(path.join(targetDir, "board-app.js"), appBundle.outputFiles[0].text);
console.log(`📦 Bundled MCP App (${Buffer.byteLength(appBundle.outputFiles[0].text)} bytes)`);
console.log("✅ Copied board template");
