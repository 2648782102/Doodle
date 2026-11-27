import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "doodle-architecture-discussion-"));

afterAll(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function withServer(outputDir, callback) {
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/index.js"],
    env: {
      ...process.env,
      PREVIEW_PORT: String(await freePort()),
      LOG_LEVEL: "error",
      OUTPUT_DIR: outputDir,
    },
  });
  const client = new Client({ name: "doodle-architecture-discussion", version: "1.0.0" });
  try {
    await client.connect(transport);
    await callback(client);
  } finally {
    await client.close();
  }
}

function textOf(result) {
  return result.content.map((part) => part.text ?? "").join("\n");
}

describe("architecture discussion drawing loop", () => {
  it("describes architecture drawing without giving Doodle repository access", async () => {
    const example = await fs.readFile("examples/architecture-discussion.md", "utf8");
    expect(example).toContain("只负责共同绘画");
    expect(example).toContain("`get_board` → `draw_board.diagram`");
    expect(example).toContain("revision（通常是上次 `draw_board` 返回的 revision）");
    expect(example).toContain("get_board.since_revision");
    expect(example).not.toContain("Doodle 扫描");

    const pluginSkill = await fs.readFile("plugins/doodle/skills/doodle/SKILL.md", "utf8");
    expect(pluginSkill).toContain("two-way board shared by a person and an AI");
    expect(pluginSkill).toContain("only reads and writes board state");
    expect(pluginSkill).not.toContain("scan_project");

    for (const entry of ["examples/README.md", "README.md", "README.en.md", "docs/README.md"]) {
      expect(await fs.readFile(entry, "utf8"), entry).toContain("architecture-discussion.md");
    }
  });

  it("draws host-provided architecture and preserves human corrections on follow-up", async () => {
    const outputDir = path.join(tempDir, "board-state");
    const hostSuppliedArchitecture = {
      title: "Shared board architecture",
      nodes: [
        { id: "host", label: "Host agent", detail: "Repository knowledge from host tools", type: "rect", role: "step" },
        { id: "doodle", label: "Doodle canvas", detail: "Shared visual context", type: "rect", role: "step" },
      ],
      edges: [{ from: "host", to: "doodle", label: "draws into" }],
    };

    await withServer(outputDir, async (client) => {
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual([
        "draw_board", "get_board", "show_board",
      ]);
      const instructions = client.getInstructions();
      expect(instructions).toContain("Doodle only reads and writes visual board state");
      expect(instructions).not.toContain("inspect the repository");
      expect(instructions).not.toContain("project scanning");

      const initial = await client.callTool({ name: "get_board", arguments: {} });
      expect(textOf(initial)).toContain("never move human-positioned objects unless asked");
      const initialBoard = initial.structuredContent;
      const shown = await client.callTool({ name: "show_board", arguments: {} });
      expect(shown.isError).toBeFalsy();

      const drawn = await client.callTool({
        name: "draw_board",
        arguments: { author: "ai", diagram: hostSuppliedArchitecture },
      });
      expect(drawn.isError).toBeFalsy();
      const hostNode = drawn.structuredContent.items.find((item) => item.text === "Host agent");
      const doodleNode = drawn.structuredContent.items.find((item) => item.text === "Doodle canvas");
      const connector = drawn.structuredContent.items.find((item) => item.type === "line");
      expect(hostNode).toBeDefined();
      expect(doodleNode).toBeDefined();
      expect(connector).toMatchObject({ startItemId: hostNode.id, endItemId: doodleNode.id, text: "draws into" });

      const humanEdit = await client.callTool({
        name: "draw_board",
        arguments: {
          author: "human",
          updates: [{ id: doodleNode.id, patch: { text: "Doodle · drawing only" } }],
          remove_ids: [connector.id],
          items: [{ type: "note", x: 650, y: 200, w: 210, h: 100, text: "Host checked repository separately" }],
        },
      });
      expect(humanEdit.isError).toBeFalsy();

      const handoff = await client.callTool({
        name: "get_board",
        arguments: { since_revision: drawn.structuredContent.revision },
      });
      expect(textOf(handoff)).toContain("HANDOFF:");
      expect(handoff.structuredContent.handoff.needsAttention).toBe(true);
      expect(handoff.structuredContent.handoff.humanEdits).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: doodleNode.id, change: "edited", now: expect.objectContaining({ text: "Doodle · drawing only" }) }),
        expect.objectContaining({ id: connector.id, change: "removed" }),
        expect.objectContaining({ change: "added", now: expect.objectContaining({ text: "Host checked repository separately" }) }),
      ]));

      const humanNote = handoff.structuredContent.added.find((item) => item.author === "human");
      const continued = await client.callTool({
        name: "draw_board",
        arguments: {
          author: "ai",
          items: [{ type: "text", x: 650, y: 330, w: 240, h: 40, text: "Ready for joint discussion" }],
        },
      });
      expect(continued.isError).toBeFalsy();
      expect(textOf(continued)).toContain("CHANGE_JSON:");
      expect(continued.structuredContent.items.find((item) => item.id === doodleNode.id))
        .toMatchObject({ text: "Doodle · drawing only", author: "human" });
      expect(continued.structuredContent.items.some((item) => item.id === connector.id)).toBe(false);
      expect(continued.structuredContent.items.find((item) => item.id === humanNote.id).text)
        .toBe("Host checked repository separately");
      expect(continued.structuredContent.items.some((item) => item.text === "Ready for joint discussion")).toBe(true);
      expect(initialBoard.itemCount).toBe(0);
    });
  }, 60_000);
});
