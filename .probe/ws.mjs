import fs from "node:fs/promises";
const src = await fs.readFile("src/infra/templates/excalidraw-app.tsx", "utf8");
// What the canvas does when the socket closes.
const close = src.match(/socket\.addEventListener\("close"[\s\S]{0,160}/)?.[0] ?? "";
console.log("=== close handler ===");
console.log(close.trim());
console.log("\nwarns the person:", /showError|banner|toolErrorMessage/.test(close));
// What it does when a refresh fails during a broadcast.
const refresh = src.match(/const refreshed = await loadBoard\(\)[\s\S]{0,80}/)?.[0] ?? "";
console.log("\n=== broadcast refresh ===");
console.log(refresh.trim());
