import { describe, expect, it } from "vitest";
import { projectDiagramDraft } from "../dist/board/project-diagram.js";

function snapshot(files) {
  return {
    version: 1,
    workspaceName: "demo",
    maxDepth: 3,
    maxFiles: 80,
    files,
  };
}

function file(path, depth = 1, kind = "file") {
  return { path, kind, depth };
}

describe("project diagram draft", () => {
  it("turns top-level directories into a compareable overview", () => {
    const draft = projectDiagramDraft(snapshot([
      file("src", 1, "directory"),
      file("test", 1, "directory"),
      file("docs", 1, "directory"),
      file("package.json", 1),
    ]));

    expect(draft.nodes.map((node) => node.label)).toEqual(["src", "test", "docs", "package.json"]);
    expect(draft.mode).toBe("compare");
    expect(draft.nodes[0]).toMatchObject({ id: "dir_src", column: 0 });
    expect(draft.nodes[1]).toMatchObject({ column: 1, row: 0 });
  });

  it("keeps ids stable and filesystem-safe", () => {
    const draft = projectDiagramDraft(snapshot([file("src/board", 2, "directory"), file("@scope/pkg", 1, "directory")]));

    for (const node of draft.nodes) {
      expect(node.id).toMatch(/^[A-Za-z0-9_-]+$/);
    }
    expect(new Set(draft.nodes.map((node) => node.id)).size).toBe(draft.nodes.length);
  });

  it("stays bounded on a wide tree", () => {
    const files = Array.from({ length: 200 }, (_, index) => file(`pkg${index}`, 1, "directory"));
    const draft = projectDiagramDraft(snapshot(files));

    expect(draft.nodes.length).toBeLessThanOrEqual(12);
    expect(draft.omitted).toBeGreaterThan(0);
  });

  it("is directly usable as draw_board.diagram input", () => {
    const draft = projectDiagramDraft(snapshot([file("src", 1, "directory"), file("test", 1, "directory")]));

    expect(draft).toMatchObject({ mode: "compare", title: expect.any(String) });
    expect(Array.isArray(draft.nodes)).toBe(true);
    expect(Array.isArray(draft.edges)).toBe(true);
    expect(draft.edges).toEqual([]);
  });

  it("returns an empty draft for an empty workspace instead of failing", () => {
    const draft = projectDiagramDraft(snapshot([]));

    expect(draft.nodes).toEqual([]);
    expect(draft.title).toBeTruthy();
  });
});
