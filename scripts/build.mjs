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
/*
 * Prune by *entry*, not by exact file name.
 *
 * Compiling `src/infra/templates/client/*.ts` creates a directory in `dist`, and
 * the previous exact-name check (`expected.has("infra/templates/client")`) was
 * false, so the whole compiled client tree was deleted after `tsc` produced it.
 * The browser bundle hid that, because esbuild reads `src`, not `dist` — until a
 * test imports a compiled client module and finds nothing there. An entry stays
 * if any expected file lives under it.
 */
const expectedEntries = new Set(
  [...expected]
    .filter((name) => name.startsWith("infra/templates/"))
    .map((name) => name.slice("infra/templates/".length).split("/")[0]),
);
for (const name of await fs.readdir(targetDir)) {
  if (!expectedEntries.has(name)) {
    await fs.rm(path.join(targetDir, name), { recursive: true, force: true });
  }
}
for (const name of ["excalidraw.html"]) {
  await fs.copyFile(path.join(sourceDir, name), path.join(targetDir, name));
}
await fs.copyFile(path.join(sourceDir, "excalidraw.html"), path.join(targetDir, "board.html"));
await fs.rm(excalidrawTargetDir, { recursive: true, force: true });
await fs.mkdir(excalidrawTargetDir, { recursive: true });
await fs.copyFile(path.join(excalidrawProdDir, "index.css"), path.join(excalidrawTargetDir, "index.css"));
const skipXiaolai = await unusedXiaolaiSubsets(excalidrawProdDir);
/*
 * `DOODLE_CANVAS_FONTS=system` swaps Xiaolai for the system CJK font.
 *
 * Xiaolai is 12 MB of the ~19 MB `dist` — the handwriting face Excalidraw falls
 * back to for Chinese. It is worth it for a local board (the browser fetches
 * only the unicode-ranges it needs over loopback), but it dominates a published
 * artifact. The switch drops every subset; the canvas then renders Chinese in
 * the system font. Nothing in Board v1 changes: text, digests, exports and
 * `parseBoard` never looked at the typeface.
 */
const useSystemFonts = process.env.DOODLE_CANVAS_FONTS === "system";
await fs.cp(path.join(excalidrawProdDir, "fonts"), path.join(excalidrawTargetDir, "fonts"), {
  recursive: true,
  filter: (source) => {
    if (useSystemFonts && path.basename(path.dirname(source)) === "Xiaolai") return false;
    return !skipXiaolai.has(path.basename(source));
  },
});
if (skipXiaolai.size > 0) {
  console.log(`✂️  Skipped ${skipXiaolai.size} unused Xiaolai font subsets`);
}
if (useSystemFonts) {
  console.log("🔤 DOODLE_CANVAS_FONTS=system: Xiaolai omitted, Chinese falls back to the system font");
}
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
  plugins: [{
    name: "doodle-prune-unused-excalidraw-chunks",
    setup(build) {
      /*
       * Doodle pins `langCode: "zh-CN"` and hides Excalidraw's Mermaid/AI
       * generation tools (`aiEnabled: false`, Mermaid menu stripped). Stubbing
       * `@excalidraw/mermaid-to-excalidraw` and unused locale chunks at bundle
       * time eliminates ~60 unused chunks and cuts the Mermaid/Chevrotain/
       * lodash-es/KaTeX transitive tree completely out of the shipped browser
       * bundle, while keeping `zh-CN` and `en` intact.
       */
      build.onResolve({ filter: /^@excalidraw\/mermaid-to-excalidraw$/ }, () => ({
        path: "doodle-stub:mermaid-to-excalidraw",
        namespace: "doodle-stub",
      }));
      build.onLoad({ filter: /^doodle-stub:mermaid-to-excalidraw$/, namespace: "doodle-stub" }, () => ({
        contents: `export async function parseMermaidToExcalidraw() { throw new Error("Mermaid import is disabled in Doodle"); }`,
        loader: "js",
      }));
      build.onResolve({ filter: /^\.\/locales\/.+\.(?:json|js)$/ }, (args) => {
        if (!args.importer.includes("@excalidraw")) return null;
        if (/\/(?:en|zh-CN)(?:-[A-Z0-9]+)?\.(?:json|js)$/i.test(args.path)) return null;
        return { path: `doodle-stub:${args.path}`, namespace: "doodle-stub" };
      });
      build.onLoad({ filter: /^doodle-stub:\.\/locales\//, namespace: "doodle-stub" }, () => ({
        contents: "export default {};",
        loader: "js",
      }));
    },
  }],
});
for (const file of excalidrawBundle.outputFiles) {
  await fs.writeFile(file.path, file.contents);
}
console.log(`📦 Bundled Excalidraw engine (${excalidrawBundle.outputFiles.reduce((size, file) => size + file.contents.length, 0)} bytes)`);
console.log("✅ Copied Excalidraw-only board template");

/*
 * The service worker is bundled, not copied.
 *
 * `tsc` emits it under `dist/infra/templates/sw.js`, which is where the server
 * resolves it from, but a raw tsc emit would keep the `self.addEventListener`
 * types untranspiled against the DOM lib. One small esbuild pass targets the
 * worker scope explicitly and gives the server a plain ES2022 script to serve.
 */
const serviceWorker = await bundle({
  entryPoints: [path.join(sourceDir, "sw.ts")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  minify: true,
  write: false,
});
for (const file of serviceWorker.outputFiles) {
  await fs.writeFile(path.join(targetDir, "sw.js"), file.contents);
}
console.log(`📴 Bundled offline shell (${serviceWorker.outputFiles.reduce((size, file) => size + file.contents.length, 0)} bytes)`);

/**
 * Xiaolai is Excalidraw's Chinese fallback font, shipped as ~205 unicode-range
 * subsets. Browsers download only the subsets matching the characters on the
 * board, but every subset is still packed into the npm tarball. Drop the ones
 * covering only scripts this app never needs (Kana, Hangul, Latin extensions,
 * emoji, ...), keeping all CJK ideographs and Chinese punctuation.
 *
 * The subset table is read from Excalidraw's own bundle so file hashes are
 * never hardcoded. If upstream changes that format, the regexes find nothing
 * and pruning is skipped — the build still succeeds with the full font set.
 */
function subsetNeeded(unicodeRange) {
  const keep = [
    [0x2000, 0x2bff], // general punctuation, arrows, math, geometric shapes
    [0x3000, 0x303f], // CJK symbols and punctuation
    [0x3400, 0x4dbf], // CJK unified ideographs extension A
    [0x4e00, 0x9fff], // CJK unified ideographs
    [0xf900, 0xfaff], // CJK compatibility ideographs
    [0xfe30, 0xfe4f], // CJK compatibility forms
    [0xff00, 0xffef], // fullwidth / halfwidth forms
  ];
  for (const part of unicodeRange.split(",")) {
    const match = /^U\+([0-9a-fA-F]+)(?:-([0-9a-fA-F]+))?$/.exec(part.trim());
    if (!match) continue;
    const start = Number.parseInt(match[1], 16);
    const end = match[2] ? Number.parseInt(match[2], 16) : start;
    if (keep.some(([lo, hi]) => start <= hi && end >= lo)) return true;
  }
  return false;
}

async function unusedXiaolaiSubsets(prodDir) {
  let bundleSource = "";
  for (const name of await fs.readdir(prodDir)) {
    if (!name.endsWith(".js")) continue;
    const candidate = await fs.readFile(path.join(prodDir, name), "utf8");
    if (candidate.includes("Xiaolai-Regular")) {
      bundleSource = candidate;
      break;
    }
  }
  if (!bundleSource) return new Set();

  // var xx="./fonts/Xiaolai/Xiaolai-Regular-<hash>.woff2"
  const files = new Map(
    [...bundleSource.matchAll(/var (\w+)="\.\/fonts\/Xiaolai\/(Xiaolai-Regular-[0-9a-f]+\.woff2)"/g)]
      .map(([, variable, file]) => [variable, file]),
  );
  if (files.size === 0) return new Set();

  // {uri:xx,descriptors:{unicodeRange:"U+..."}} — only Xiaolai vars matter
  const byVariable = new Map(
    [...bundleSource.matchAll(/uri:(\w+),descriptors:\{unicodeRange:"([^"]+)"/g)]
      .filter(([, variable]) => files.has(variable))
      .map(([, variable, range]) => [variable, range]),
  );

  const unused = new Set();
  for (const [variable, range] of byVariable) {
    if (!subsetNeeded(range)) unused.add(files.get(variable));
  }
  return unused;
}
