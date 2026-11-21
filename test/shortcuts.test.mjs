import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(path.join(root, relative), "utf8");
const template = read("src/infra/templates/excalidraw.html");
const module = read("src/infra/templates/client/shortcuts.ts");
const app = read("src/infra/templates/excalidraw-app.tsx");

describe("keyboard shortcut panel", () => {
  /*
   * The panel exists because the shortcuts were only ever in the first-use card,
   * which dismisses itself forever. AGENTS.md already claimed a dismissible `?`
   * popover existed; this is that panel, actually shipped.
   */
  it("is reachable from the capsule and from the ? key", () => {
    expect(template).toContain('id="doodleShortcutToggle"');
    expect(template).toContain('id="doodleShortcuts"');
    expect(module).toMatch(/event\.key !== "\?"/);
    expect(app).toContain("initShortcutPanel");
  });

  it("does not steal ? while the person is typing", () => {
    /*
     * `?` is Shift+/ on most layouts. Opening a panel instead of inserting the
     * character in a note, a board name, or the library search would be a data
     * loss, not a shortcut.
     */
    expect(module).toContain("isContentEditable");
    expect(module).toContain("INPUT");
    expect(module).toContain("TEXTAREA");
    expect(module).toContain("isComposing");
  });

  it("closes before the canvas consumes Escape", () => {
    // Escape must not also clear the selection underneath an open panel.
    const handler = module.slice(module.indexOf('event.key === "Escape"'));
    expect(handler).toContain("event.stopPropagation()");
    expect(handler).toContain("event.preventDefault()");
  });

  it("stays out of the way of a board that already has content", () => {
    /*
     * The welcome card answers the same question on a genuinely empty board, so
     * opening both on a first visit stacks two panels. Auto-open only when the
     * person has dismissed the card already.
     */
    expect(module).toContain("WELCOME_STORAGE_KEY");
    expect(module).toContain("welcomeDismissed");
  });

  it("documents the shortcuts the toolbar actually binds", () => {
    /*
     * A help panel that lists a key the canvas does not accept is worse than
     * none: it teaches a wrong action. These are the labels Excalidraw renders
     * on its own tool buttons.
     */
    for (const key of ["V", "H", "R", "D", "O", "A", "L", "P", "T", "E"]) {
      expect(template, `the panel does not list the ${key} tool`).toContain(`<dt>${key}</dt>`);
    }
    expect(template).toContain("⇧1");
  });

  it("keeps key chips and descriptions on one line", () => {
    /*
     * `auto` let the key column and the description fight for width at 560px, and
     * the description wrapped to one character per line. The key column must
     * size to its widest label and rows must not stretch.
     */
    expect(template).toMatch(/\.doodle-shortcuts-group dl \{[^}]*grid-template-columns: max-content minmax\(0, 1fr\)/);
    expect(template).toMatch(/\.doodle-shortcuts-group dl \{[^}]*align-items: start/);
    expect(template).toMatch(/\.doodle-shortcuts-body \{[^}]*grid-template-columns: repeat\(3, max-content\)/);
  });

  it("does not cover the phone screen unprompted", () => {
    /*
     * Anchored under the capsule, the panel was 366 × 560 on a 390 × 780 screen
     * — 67% of the viewport, painted over the capsule that opened it and over the
     * empty board the shortcuts exist to explain. Phones get a bottom sheet above
     * the toolbar, and it opens only when asked: no hover, and no room for a
     * second pane next to the canvas.
     */
    const phone = template.slice(template.indexOf("  .doodle-shortcuts {\n        top: auto;"));
    const rule = phone.slice(0, phone.indexOf("}"));
    expect(rule, "the phone panel is not anchored to the bottom").toContain("bottom: 84px");
    expect(rule).toContain("top: auto");
    // Above the 64px bottom bar plus its own margin, and never over it.
    expect(84).toBeGreaterThan(64);

    const autoOpen = module.slice(module.indexOf("if (!welcomeDismissed()"));
    expect(autoOpen, "the panel still opens itself on a phone").toContain('matchMedia("(min-width: 641px)")');
  });
});
