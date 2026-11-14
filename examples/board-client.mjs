import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/index.js"],
  env: { ...process.env, PREVIEW_PORT: "3433", LOG_LEVEL: "error" },
});
const client = new Client({ name: "doodle-board-example", version: "1.0.0" });

try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  console.log(`Registered board tools: ${tools.map((tool) => tool.name).join(", ")}`);
  console.log(`Tool annotations: ${JSON.stringify(Object.fromEntries(tools.map((tool) => [tool.name, tool.annotations])))}`);
  const board = await client.callTool({ name: "get_board", arguments: {} });
  console.log(board.content.map((item) => item.text ?? "").join("\n").slice(0, 400));
  console.log(`Board library entries: ${board.structuredContent?.library?.boards?.length ?? 0}`);
  console.log(`Capabilities: ${board.structuredContent?.capabilities?.layouts?.join(", ") ?? "n/a"}`);
  console.log(`Visual digest: ${board.structuredContent?.visualDigest?.itemCount ?? 0} objects`);
  const view = await client.callTool({ name: "show_board", arguments: {} });
  console.log(view.content.map((item) => item.text ?? "").join("\n"));
  console.log("Embedded hosts may publish final-state board context to the current session; standalone PANEL_URL edits require get_board rereading.");
  const drawn = await client.callTool({
    name: "draw_board",
    arguments: {
      author: "ai",
      items: [{ type: "note", x: 40, y: 40, w: 220, h: 120, text: "和 AI 一起画", color: "#f6d365" }],
    },
  });
  console.log(drawn.content.map((item) => item.text ?? "").join("\n"));
} finally {
  await client.close();
}
