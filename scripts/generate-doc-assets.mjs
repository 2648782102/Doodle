#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(root, "docs");
const checkOnly = process.argv.includes("--check");

const escapeXml = (value) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const rect = (left, top, width, height, fillColor, strokeColor = "#d8dee8") =>
  `<rect x="${left}" y="${top}" width="${width}" height="${height}" rx="10" fill="${fillColor}" stroke="${strokeColor}" stroke-width="1.5"/>`;
const label = (left, top, text, fontSize = 15, textColor = "#1f2937", fontWeight = "600", textAnchor = "middle") =>
  `<text x="${left}" y="${top}" fill="${textColor}" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" font-size="${fontSize}" font-weight="${fontWeight}" text-anchor="${textAnchor}">${escapeXml(text)}</text>`;
const arrow = (fromX, fromY, toX, toY) =>
  `<path d="M ${fromX} ${fromY} C ${fromX + 55} ${fromY}, ${toX - 55} ${toY}, ${toX} ${toY}" fill="none" stroke="#2563eb" stroke-width="2.5" marker-end="url(#arrow)"/>`;
const defs = `<defs>
  <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
    <path d="M 0 0 L 10 5 L 0 10 z" fill="#2563eb"/>
  </marker>
</defs>`;

const loopDiagram = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="420" viewBox="0 0 1200 420" role="img" aria-labelledby="title desc">
<title id="title">AI Draw MCP 简单共享无限画板</title>
<desc id="desc">人和 AI 在同一张无限画布上画便签、文字、形状和线条，并在旁边写短留言；项目工作台只是可选能力。</desc>
${defs}
<rect width="1200" height="420" fill="#f8fafc"/>
${label(600, 54, "AI Draw MCP · 简单共享无限画板", 25, "#111827", "700")}
${label(600, 84, "人画 · AI 读 · AI 画 · 人继续画", 14, "#64748b", "400")}
${rect(70, 145, 220, 110, "#ffffff")}${label(180, 183, "人", 21, "#0f766e")}${label(180, 214, "点一下就画", 14, "#475569", "400")}${label(180, 237, "拖一下就改", 14, "#475569", "400")}
${rect(490, 120, 220, 160, "#eff6ff", "#93c5fd")}${label(600, 164, "无限画布", 21, "#1d4ed8")}${label(600, 196, "便签 · 文字 · 形状 · 线条", 12, "#475569", "400")}${label(600, 222, "人和 AI 的同一份上下文", 12, "#475569", "400")}${label(600, 252, "短留言放在画布旁", 12, "#475569", "400")}
${rect(910, 145, 220, 110, "#ffffff")}${label(1020, 183, "AI", 21, "#5b4bc4")}${label(1020, 214, "get_board", 14, "#475569", "400")}${label(1020, 237, "draw_board", 14, "#475569", "400")}
${arrow(290, 200, 490, 200)}${arrow(710, 200, 910, 200)}
${arrow(910, 235, 710, 260)}${arrow(490, 235, 290, 260)}
${rect(420, 335, 360, 48, "#ffffff")}${label(600, 365, "项目扫描 / diff / 批准 → /workbench（可选）", 13, "#64748b", "500")}
</svg>`;

const workbenchDiagram = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="520" viewBox="0 0 1200 520" role="img" aria-labelledby="title desc">
<title id="title">简单画板交互方向</title>
<desc id="desc">默认界面只有顶栏、工具栏、无限画布和轻量交流区；项目工作台是次级入口。</desc>
${defs}
<rect width="1200" height="520" fill="#f8fafc"/>
${rect(28, 28, 1144, 464, "#ffffff", "#d8dee8")}
<rect x="28" y="28" width="1144" height="48" rx="14" fill="#ffffff"/>
${label(52, 58, "AI 画板", 16, "#111827", "700", "start")}
${label(1144, 58, "项目工作台", 12, "#2563eb", "500", "end")}
<rect x="28" y="76" width="1144" height="1" fill="#e5e7eb"/>
<rect x="44" y="92" width="92" height="34" rx="7" fill="#eff6ff" stroke="#93c5fd"/>${label(90, 114, "选择", 12, "#1d4ed8")}
${rect(144, 92, 70, 34, "#ffffff", "#d8dee8")}${label(179, 114, "便签", 12, "#475569")}
${rect(222, 92, 70, 34, "#ffffff", "#d8dee8")}${label(257, 114, "文字", 12, "#475569")}
${rect(300, 92, 70, 34, "#ffffff", "#d8dee8")}${label(335, 114, "形状", 12, "#475569")}
${rect(378, 92, 70, 34, "#ffffff", "#d8dee8")}${label(413, 114, "线条", 12, "#475569")}
<rect x="44" y="142" width="820" height="326" rx="8" fill="#fbfbfd" stroke="#e5e7eb"/>
<rect x="190" y="214" width="160" height="104" rx="7" fill="#f6d365" stroke="#d6b656"/>${label(270, 270, "一个想法", 15, "#111827")}
<rect x="430" y="190" width="170" height="102" rx="52" fill="#b8e0d2" stroke="#8bbfae"/>${label(515, 247, "AI 补充", 15, "#111827")}
<rect x="310" y="350" width="300" height="42" rx="7" fill="#ffffff" stroke="#d8dee8"/>${label(460, 376, "少一点界面，多一点画布", 13, "#475569", "400")}
<path d="M 350 266 L 430 245" stroke="#64748b" stroke-width="3" fill="none"/>
<rect x="884" y="142" width="272" height="326" rx="8" fill="#ffffff" stroke="#e5e7eb"/>
${label(904, 174, "和 AI 说", 15, "#111827", "700", "start")}
<rect x="904" y="194" width="232" height="54" rx="7" fill="#f8fafc" stroke="#e5e7eb"/>${label(920, 218, "人 · 这里再简单一点", 11, "#0f766e", "500", "start")}${label(920, 238, "关联当前对象", 10, "#94a3b8", "400", "start")}
<rect x="904" y="260" width="232" height="54" rx="7" fill="#f8fafc" stroke="#e5e7eb"/>${label(920, 284, "AI · 好的，我补在画布上", 11, "#5b4bc4", "500", "start")}${label(920, 304, "同一份 BOARD_JSON", 10, "#94a3b8", "400", "start")}
<rect x="904" y="410" width="232" height="38" rx="7" fill="#eff6ff" stroke="#93c5fd"/>${label(1020, 434, "放到画板", 12, "#1d4ed8")}
${label(600, 503, "默认界面不展示扫描、源码证据、流程图仪表盘或提案卡片", 12, "#94a3b8", "400")}
</svg>`;

const assets = [
  { filename: "collaboration-loop.svg", content: loopDiagram },
  { filename: "collaboration-workbench.svg", content: workbenchDiagram },
];
let hasDrift = false;

for (const asset of assets) {
  const assetPath = path.join(outputDir, asset.filename);
  if (checkOnly) {
    let existing = null;
    try {
      existing = await fs.readFile(assetPath, "utf8");
    } catch {
      existing = null;
    }
    if (existing !== asset.content) {
      console.error(`❌ docs/${asset.filename} is out of date; run npm run docs:assets`);
      hasDrift = true;
    }
  } else {
    await fs.writeFile(assetPath, asset.content, "utf8");
  }
}

if (checkOnly && hasDrift) process.exit(1);
if (!checkOnly) console.log("✅ Wrote docs/collaboration-loop.svg and docs/collaboration-workbench.svg");
else console.log("✅ Documentation SVG assets are reproducible");
