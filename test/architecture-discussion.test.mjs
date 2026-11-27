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

async function withServer(workspaceRoot, outputDir, callback) {
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/index.js"],
    env: {
      ...process.env,
      PREVIEW_PORT: String(await freePort()),
      LOG_LEVEL: "error",
      OUTPUT_DIR: outputDir,
      DOODLE_WORKSPACE_ROOT: workspaceRoot,
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

describe("architecture discussion MCP loop", () => {
  it("ships a copyable bilingual first-session prompt and host-neutral handoff guidance", async () => {
    const example = await fs.readFile("examples/architecture-discussion.md", "utf8");

    expect(example).toContain("帮我看一下这个仓库的架构，先画出主要模块和有依据的调用关系，我们一起在图上修正。");
    expect(example).toContain("Help me understand this repository's architecture");
    expect(example).toContain("`get_board` → `scan_project` → `draw_board.diagram`");
    expect(example).toContain("revision（通常是上次 `draw_board` 返回的 revision）");
    expect(example).toContain("import 证据只确认 import 关系");
    expect(example).toContain("get_board.since_revision");
    expect(example).toContain("never writes or changes project files");

    const pluginSkill = await fs.readFile("plugins/doodle/skills/doodle/SKILL.md", "utf8");
    expect(pluginSkill).toContain("repository architecture discussion");
    expect(pluginSkill).toContain("DIAGRAM_DRAFT_JSON` is only a directory overview");
    expect(pluginSkill).toContain("preserve the person's labels, positions, and deletions");
    expect(pluginSkill).toContain("revision from the board state you presented, usually the revision returned by your latest `draw_board`");
    expect(pluginSkill).toContain("Do not reflow a collaboratively positioned board unless asked");

    for (const entry of ["examples/README.md", "README.md", "README.en.md", "docs/README.md"]) {
      expect(await fs.readFile(entry, "utf8"), entry).toContain("architecture-discussion.md");
    }

    const goals = await fs.readFile("docs/GOALS.md", "utf8");
    expect(goals).toContain("首轮架构讨论");
    expect(goals).toContain("新仓库理解、纠正错误依赖、补充缺失模块或约束");
    expect(goals).toContain("用户试点：待完成");

    const audit = await fs.readFile("docs/EXPERIENCE_AUDIT.md", "utf8");
    expect(audit).toContain("architecture discussion MCP integration test");
    expect(audit).toContain("Real developer pilot: pending");

    const roadmap = await fs.readFile("ROADMAP.md", "utf8");
    expect(roadmap).toContain("Run a small developer pilot");
    expect(roadmap).toContain("architecture-discussion.md");

    expect(await fs.readFile("CHANGELOG.md", "utf8")).toContain("Evidence-grounded architecture discussion");
  });

  it("grounds a shared architecture map in imports and preserves human corrections on follow-up", async () => {
    const workspace = path.join(tempDir, "fixture-repo");
    const sourceDir = path.join(workspace, "src");
    const boardDir = path.join(sourceDir, "board");
    const outputDir = path.join(tempDir, "board-state");
    await fs.mkdir(boardDir, { recursive: true });
    const fixtureSources = new Map([
      [path.join(sourceDir, "server.ts"), 'import { createBoard } from "./board/index.js";\n\nexport function start() { return createBoard(); }\n'],
      [path.join(boardDir, "index.ts"), "export function createBoard() { return []; }\n"],
      [path.join(sourceDir, "ui.ts"), "export function renderBoard() { return null; }\n"],
    ]);
    for (const [filePath, contents] of fixtureSources) await fs.writeFile(filePath, contents, "utf8");
    const sourceBefore = new Map(await Promise.all(
      [...fixtureSources.keys()].map(async (filePath) => [filePath, await fs.readFile(filePath, "utf8")]),
    ));

    await withServer(workspace, outputDir, async (client) => {
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual([
        "draw_board", "get_board", "scan_project", "show_board",
      ]);
      const instructions = client.getInstructions();
      expect(instructions).toContain("DIAGRAM_DRAFT_JSON is only a directory overview");
      expect(instructions).toContain("Draw dependency arrows only when import or other explicit evidence supports them");
      expect(instructions).toContain("Do not describe an import as a runtime call unless call-site evidence supports it");
      expect(instructions).toContain("scope architecture reflow to explicitly selected non-human-positioned objects");
      expect(instructions).toContain("the revision from the board state you presented, usually the revision returned by your latest draw_board");
      expect(instructions).toContain("preserve the person's labels, positions, and deletions");
      expect(instructions).toContain("get_board.since_revision");

      const initial = await client.callTool({ name: "get_board", arguments: {} });
      expect(textOf(initial)).toContain("never move human-positioned objects unless asked");
      const initialBoard = initial.structuredContent;
      const scan = await client.callTool({
        name: "scan_project",
        arguments: { max_depth: 3, max_files: 20, include_evidence: true },
      });
      expect(scan.isError).toBeFalsy();
      expect(scan.structuredContent.files.map((file) => file.path)).toEqual(expect.arrayContaining([
        "src/server.ts", "src/board/index.ts", "src/ui.ts",
      ]));
      expect(scan.structuredContent.evidence).toContainEqual(expect.objectContaining({
        path: "src/server.ts",
        kind: "import",
        excerpt: 'import { createBoard } from "./board/index.js";',
      }));

      const shown = await client.callTool({ name: "show_board", arguments: {} });
      expect(shown.isError).toBeFalsy();

      const drawn = await client.callTool({
        name: "draw_board",
        arguments: {
          author: "ai",
          diagram: {
            title: "仓库架构（由 import 证据确认）",
            mode: "flow",
            nodes: [
              { id: "server", label: "Server", detail: "src/server.ts:1", type: "rect", role: "step" },
              { id: "board", label: "Board module", detail: "src/board/index.ts:1", type: "rect", role: "step" },
            ],
            edges: [{ from: "server", to: "board", label: "imports" }],
          },
        },
      });
      expect(drawn.isError).toBeFalsy();
      const serverNode = drawn.structuredContent.items.find((item) => item.text === "Server");
      const boardNode = drawn.structuredContent.items.find((item) => item.text === "Board module");
      const drawnLines = drawn.structuredContent.items.filter((item) => item.type === "line");
      expect(serverNode).toBeDefined();
      expect(boardNode).toBeDefined();
      expect(drawnLines).toHaveLength(1);
      const importArrow = drawnLines[0];
      expect(importArrow).toMatchObject({ startItemId: serverNode.id, endItemId: boardNode.id, text: "imports" });

      const humanEdit = await client.callTool({
        name: "draw_board",
        arguments: {
          author: "human",
          updates: [
            { id: serverNode.id, patch: { text: "API server" } },
            { id: boardNode.id, patch: { x: boardNode.x + 80, y: boardNode.y + 40 } },
          ],
          remove_ids: [importArrow.id],
          items: [{ type: "note", x: 640, y: 180, w: 200, h: 100, text: "还需要缓存模块，关系先待确认" }],
        },
      });
      expect(humanEdit.isError).toBeFalsy();

      const handoff = await client.callTool({
        name: "get_board",
        arguments: { since_revision: drawn.structuredContent.revision },
      });
      expect(textOf(handoff)).toContain("HANDOFF:");
      expect(textOf(handoff)).toContain("HANDOFF_READINGS:");
      expect(handoff.structuredContent.handoff.baseRevision).toBe(drawn.structuredContent.revision);
      expect(handoff.structuredContent.handoff.needsAttention).toBe(true);
      expect(handoff.structuredContent.handoff.humanEdits).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: serverNode.id, change: "edited", now: expect.objectContaining({ text: "API server" }) }),
        expect.objectContaining({ id: boardNode.id, change: "edited", now: expect.objectContaining({ x: boardNode.x + 80, y: boardNode.y + 40 }) }),
        expect.objectContaining({ id: importArrow.id, change: "removed" }),
        expect.objectContaining({ change: "added", now: expect.objectContaining({ text: "还需要缓存模块，关系先待确认" }) }),
      ]));
      expect(handoff.structuredContent.handoff.readings.map((reading) => reading.kind)).toEqual(
        expect.arrayContaining(["relabel", "move", "remove", "add-note"]),
      );

      const humanNote = handoff.structuredContent.added.find((item) => item.author === "human");
      const continued = await client.callTool({
        name: "draw_board",
        arguments: {
          author: "ai",
          items: [{
            type: "rect",
            x: 640,
            y: 320,
            w: 220,
            h: 90,
            text: "Cache · relationship TBD",
            role: "question",
          }],
        },
      });
      expect(continued.isError).toBeFalsy();
      expect(textOf(continued)).toContain("CHANGE_JSON:");
      expect(continued.structuredContent.change.added).toHaveLength(1);

      const finalBoard = continued.structuredContent.items;
      expect(finalBoard.find((item) => item.id === serverNode.id)).toMatchObject({ text: "API server", author: "human" });
      expect(finalBoard.find((item) => item.id === boardNode.id)).toMatchObject({
        x: boardNode.x + 80,
        y: boardNode.y + 40,
        author: "human",
      });
      expect(finalBoard.some((item) => item.id === importArrow.id)).toBe(false);
      expect(finalBoard.filter((item) => item.type === "line")).toHaveLength(0);
      expect(finalBoard.find((item) => item.id === humanNote.id).text).toBe("还需要缓存模块，关系先待确认");
      expect(finalBoard.some((item) => item.text === "Cache · relationship TBD" && item.author === "ai")).toBe(true);
      expect(initialBoard.itemCount).toBe(0);
    });

    for (const [filePath, before] of sourceBefore) {
      expect(await fs.readFile(filePath, "utf8")).toBe(before);
    }
  }, 60_000);
});
