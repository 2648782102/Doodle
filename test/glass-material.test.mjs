import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const template = await readFile(path.join(root, "src", "infra", "templates", "excalidraw.html"), "utf8");

function alphaOf(token) {
  const match = new RegExp(`--${token}:\\s*rgba\\(\\s*\\d+,\\s*\\d+,\\s*\\d+,\\s*([\\d.]+)\\s*\\)`).exec(template);
  return match ? Number(match[1]) : undefined;
}

describe("liquid glass material", () => {
  it("is translucent enough for the page to show through", () => {
    const alpha = alphaOf("glass-bg");
    expect(alpha).toBeDefined();
    // At >= 0.5 the pane measured indistinguishable from the light page.
    expect(alpha).toBeLessThanOrEqual(0.35);
  });

  it("blurs and saturates what is behind it", () => {
    expect(template).toMatch(/backdrop-filter:\s*blur\(var\(--glass-blur\)\)\s*saturate\(var\(--glass-saturate\)\)/);
    expect(template).toMatch(/--glass-blur:\s*\d+px/);
  });

  it("keeps a specular edge rather than a flat border", () => {
    expect(template).toContain("inset 0 1px 0 0 var(--glass-edge)");
    expect(template).toContain("--glass-edge: rgba(255, 255, 255");
  });

  it("degrades to an opaque pane when blur is unsupported", () => {
    expect(template).toContain("@supports not ((backdrop-filter: blur(1px))");
    expect(template).toContain("--glass-bg-strong");
  });

  it("gives the canvas a visible colour field so glass has something to refract", () => {
    // A flat page makes the material look like a white box.
    expect(template).toContain("--doodle-wash-a");
    expect(template).toContain("--doodle-wash-b");
    expect(template).toMatch(/radial-gradient\(ellipse[^)]*var\(--doodle-wash-a\)/);
  });

  it("does not apply page-tinted glass to native Excalidraw islands", () => {
    // Doodle pins Excalidraw to light, so a dark page tint hides its icons.
    expect(template).toContain("var(--island-bg-color)");
    expect(template).not.toMatch(/\.excalidraw \.Island \{/);
  });
});
