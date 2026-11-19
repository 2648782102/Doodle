import net from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const cwd = process.cwd(), outDir = process.argv[2];
const freePort = () => new Promise((r) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => r(port)); }); });
const t = new StdioClientTransport({ command: "node", args: ["dist/index.js"], env: { ...process.env, PREVIEW_PORT: String(await freePort()), LOG_LEVEL: "error", OUTPUT_DIR: outDir, DOODLE_WORKSPACE_ROOT: cwd } });
const c = new Client({ name: "o", version: "1.0.0" });
await c.connect(t);
const txt = (r) => (r.content ?? []).map((x) => x.text ?? "").join("");
const panel = txt(await c.callTool({ name: "get_board", arguments: {} })).match(/PANEL_URL: (http:\/\/127\.0\.0\.1:\d+\/)/)?.[1];
const token = (await fetch(panel).then((r) => r.text())).match(/const PANEL_TOKEN = "([^"]+)"/)?.[1];
// How long does a write take when the server is unreachable? (simulate by bad port)
const started = Date.now();
try {
  await fetch(`http://127.0.0.1:1/api/board/batch`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}", signal: AbortSignal.timeout(3000) });
} catch (e) {
  console.log("write to dead port fails in", Date.now() - started, "ms |", e.name);
}
// Normal write latency, for comparison.
const snap = (await c.callTool({ name: "get_board", arguments: {} })).structuredContent;
const t0 = Date.now();
await fetch(`${panel}api/board/batch`, { method: "POST", headers: { "content-type": "application/json", "x-ai-draw-token": token, "If-Match-Revision": String(snap.revision) }, body: JSON.stringify({ confirmedBy: "human", items: [{ type: "note", x: 0, y: 0, w: 160, h: 90, text: "x" }] }) });
console.log("normal write:", Date.now() - t0, "ms");
await c.close();
