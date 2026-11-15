import { describe, expect, it } from "vitest";
import { isSuspiciousEmptyWrite } from "../dist/board/store.js";

function board(items) {
  return {
    version: 1,
    id: "b",
    title: "t",
    revision: 1,
    updatedAt: "2026-11-15T00:00:00.000Z",
    items,
    notes: [],
  };
}

const note = {
  id: "a",
  type: "note",
  x: 0, y: 0, w: 160, h: 90,
  text: "x",
  color: "#ffffff",
  author: "human",
  createdAt: "2026-11-15T00:00:00.000Z",
  updatedAt: "2026-11-15T00:00:00.000Z",
};

describe("empty board write guard", () => {
  it("flags clearing a board that had objects", () => {
    expect(isSuspiciousEmptyWrite(board([note, { ...note, id: "b" }]), board([]))).toBe(true);
  });

  it("allows writing an empty board when it was already empty", () => {
    expect(isSuspiciousEmptyWrite(board([]), board([]))).toBe(false);
  });

  it("allows normal edits that keep content", () => {
    expect(isSuspiciousEmptyWrite(board([note]), board([note]))).toBe(false);
    expect(isSuspiciousEmptyWrite(board([note]), board([note, { ...note, id: "b" }]))).toBe(false);
  });

  it("allows deleting the last object when the caller means it", () => {
    expect(isSuspiciousEmptyWrite(board([note]), board([]), { allowEmpty: true })).toBe(false);
  });

  it("does not treat a first write as suspicious", () => {
    expect(isSuspiciousEmptyWrite(undefined, board([]))).toBe(false);
  });
});
