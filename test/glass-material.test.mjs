import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const template = await readFile(path.join(root, "src", "infra", "templates", "excalidraw.html"), "utf8");
const glassSource = await readFile(path.join(root, "src", "infra", "templates", "liquid-glass.ts"), "utf8");

function alphaOf(token) {
  const match = new RegExp(`--${token}:\\s*rgba\\(\\s*\\d+,\\s*\\d+,\\s*\\d+,\\s*([\\d.]+)\\s*\\)`).exec(template);
  return match ? Number(match[1]) : undefined;
}

describe("liquid glass material", () => {
  it("is translucent enough for the page to show through", () => {
    const alpha = alphaOf("glass-bg");
    expect(alpha).toBeDefined();
    // Measured: above ~0.16 the fill hides the dot grid behind the pane, which
    // is the only signal that the surface is a lens rather than a grey card.
    expect(alpha).toBeLessThanOrEqual(0.16);
  });

  it("falls back to blur and saturation where an SVG backdrop filter is unavailable", () => {
    expect(template).toContain("var(--glass-refraction, blur(var(--glass-blur)) saturate(var(--glass-saturate)))");
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
    // A near-white page makes the lens invisible: there is nothing to bend.
    expect(template).toContain("--doodle-wash-a");
    expect(template).toContain("--doodle-wash-b");
    expect(template).toContain("--doodle-wash-c");
    expect(template).toMatch(/radial-gradient\(ellipse[^)]*var\(--doodle-wash-a\)/);
  });

  it("does not apply page-tinted glass to native Excalidraw islands", () => {
    // Doodle pins Excalidraw to light, so a dark page tint hides its icons.
    expect(template).toContain("var(--island-bg-color)");
    expect(template).not.toMatch(/\.excalidraw \.Island \{/);
  });

  it("refracts the backdrop through a bevelled displacement map", () => {
    // A blur alone is frost. The lens is a displacement map whose amplitude
    // follows the pane's bevel, so the page bends near the rim only.
    expect(glassSource).toContain("feDisplacementMap");
    expect(glassSource).toContain("xChannelSelector");
    expect(glassSource).toContain("bevelAmplitude");
    expect(glassSource).toContain("edgeField");
    expect(template).toContain("--glass-refraction");
    expect(template).toContain(".doodle-glass");
  });

  it("keeps the bevel blur small enough for the dot grid to survive", () => {
    // 1px dots vanish under a 3px gaussian; the pane then reads as fog.
    expect(glassSource).toMatch(/Math\.round\(clamp\(bezel \* token\("--glass-lens-blur", 0\.05\), 0\.5, 1\.2\)/);
  });

  it("separates the pane from a near-white page with a lit rim and a shaded one", () => {
    // Pure-white fill on a white page measures as no surface at all; the rim
    // highlight and its shadow side are what make the curvature visible.
    expect(glassSource).toContain("specularMap");
    expect(glassSource).toContain("rimShadeMap");
    expect(glassSource).toContain("feBlend");
    expect(template).toContain("--glass-shade");
  });

  it("rebuilds the maps at device resolution so the bevel does not stair-step", () => {
    expect(glassSource).toContain("devicePixelRatio");
    expect(glassSource).toContain("paintEdgeMap");
  });

  it("disposes its observer and generated filters", () => {
    expect(glassSource).toContain("ResizeObserver");
    expect(glassSource).toContain("dispose()");
    expect(glassSource).toContain("MutationObserver");
  });
});
