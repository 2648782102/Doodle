import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as bundle } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(root, "src");
const distDir = path.join(root, "dist");
const sourceDir = path.join(root, "src", "infra", "templates");
const targetDir = path.join(distDir, "infra", "templates");
const excalidrawProdDir = path.join(root, "node_modules", "@excalidraw", "excalidraw", "dist", "prod");
const excalidrawTargetDir = path.join(targetDir, "excalidraw");

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
expected.add("infra/templates/board.html");
expected.add("infra/templates/excalidraw");
await fs.mkdir(distDir, { recursive: true });
await pruneCompiledFiles(distDir, expected);
await fs.mkdir(targetDir, { recursive: true });
for (const name of await fs.readdir(targetDir)) {
  if (!expected.has(`infra/templates/${name}`)) {
    await fs.rm(path.join(targetDir, name), { recursive: true, force: true });
  }
}
for (const name of ["excalidraw.html"]) {
  await fs.copyFile(path.join(sourceDir, name), path.join(targetDir, name));
}
await fs.copyFile(path.join(sourceDir, "excalidraw.html"), path.join(targetDir, "board.html"));
await fs.mkdir(excalidrawTargetDir, { recursive: true });
for (const name of await fs.readdir(excalidrawTargetDir)) {
  await fs.rm(path.join(excalidrawTargetDir, name), { recursive: true, force: true });
}
await fs.copyFile(path.join(excalidrawProdDir, "index.css"), path.join(excalidrawTargetDir, "index.css"));
await fs.cp(path.join(excalidrawProdDir, "fonts"), path.join(excalidrawTargetDir, "fonts"), { recursive: true });
const excalidrawBundle = await bundle({
  entryPoints: [path.join(sourceDir, "excalidraw-app.tsx")],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  outdir: excalidrawTargetDir,
  entryNames: "excalidraw-app",
  splitting: true,
  conditions: ["production"],
  write: false,
  define: { "process.env.NODE_ENV": '"production"' },
});
for (const file of excalidrawBundle.outputFiles) {
  await fs.writeFile(file.path, file.contents);
}
console.log(`📦 Bundled Excalidraw engine (${excalidrawBundle.outputFiles.reduce((size, file) => size + file.contents.length, 0)} bytes)`);
console.log("✅ Copied Excalidraw-only board template");
