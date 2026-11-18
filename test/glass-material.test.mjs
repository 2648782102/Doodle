import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const template = await readFile(path.join(root, "src", "infra", "templates", "excalidraw.html"), "utf8");
/*
 * The material spans two modules: `liquid-glass.ts` owns the per-pane lifecycle
 * and `liquid-glass-maps.ts` owns the geometry, the maps, and the filter graph.
 * Assertions are about behaviour, so they read both rather than assuming one
 * file, which is what broke when the material was split.
 */
const glassSource = [
  await readFile(path.join(root, "src", "infra", "templates", "liquid-glass.ts"), "utf8"),
  await readFile(path.join(root, "src", "infra", "templates", "liquid-glass-maps.ts"), "utf8"),
].join("\n");
const appSource = await readFile(path.join(root, "src", "infra", "templates", "excalidraw-app.tsx"), "utf8");

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
    // The rim blur must stay tight or the bevel stops reading as a lens. The
    // softer centre is a separate pass (`frost`) that is masked away from the
    // band, so this cap only governs the edge.
    expect(glassSource).toMatch(/clamp\(bezel \* requested, 0\.5, 1\.4\)/);
  });

  it("tapers the displacement to zero at the inner bevel edge", () => {
    // A bevel band that stops with displacement still applied leaves a one-pixel
    // jump between two sampled places, which reads as a second rectangle under
    // the glass. Both ends of the band must reach zero.
    expect(glassSource).toContain("const fall = 1 - Math.pow(clamped, 3);");
    expect(glassSource).toMatch(/return rise \* fall;/);
  });

  it("avoids negative-spread inner glows that paint an inset box", () => {
    // `inset 0 0 22px -14px` shrinks the shadow into a smaller rounded rect
    // inside the pane instead of lighting its edge.
    expect(template).not.toMatch(/inset 0 0 \d+px -\d+px var\(--glass/);
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

  it("lights the top rim, not the bottom", () => {
    // `edgeField` reports outward normals, so the top edge has a negative ny.
    // The light sits above the pane, so the dot product must NOT negate ny.
    // Negating it flipped the material upside down and painted a slab offset
    // toward the lower left, which is the "rectangle inside the glass" report.
    expect(glassSource).toMatch(/const facing = Math\.max\(0, nx \* lightX \+ ny \* lightY\);/);
    expect(glassSource).not.toMatch(/nx \* lightX \+ -ny \* lightY/);
  });

  it("complements the specular and shaded rims instead of stacking them", () => {
    // The shade must be the negation of the gloss dot product. If both use the
    // same sign, the highlight and the dark band land on the same edge.
    expect(glassSource).toMatch(/const facing = Math\.max\(0, -\(nx \* lightX \+ ny \* lightY\)\);/);
  });

  it("declares filter primitives in user space rather than percentages", () => {
    // `feImage` sized `100%` resolves against the filter region, while
    // `feDisplacementMap` reads offsets in user space. On a pane whose box is
    // not an integer number of device pixels the two grids drift apart and the
    // bevel smears into a hard-edged slab offset up and to the left.
    expect(glassSource).toContain('filterUnits="userSpaceOnUse"');
    expect(glassSource).not.toMatch(/feImage href="\$\{[a-zA-Z]+\}" x="0" y="0" width="100%" height="100%"/);
    expect(glassSource).toMatch(/const map = \(href: string, result: string\) =>/);
  });

  it("keeps displacement below the bevel width", () => {
    // Displacement larger than the band it fades out over drags the edge's own
    // surroundings into the pane, which reads as a plastic strip.
    expect(glassSource).toMatch(/clamp\(bezel \* requested, 4, 16\)/);
    const declared = Number(/--glass-lens-scale:\s*([\d.]+)/.exec(template)?.[1]);
    // The profile is a smooth bump whose mean is about half its peak, so a 0.9
    // peak already averages ~0.45 bezel of displacement.
    expect(declared).toBeLessThanOrEqual(1);
  });

  it("lights controls with the material instead of an opaque chip", () => {
    // Upstream paints `--button-hover-bg` (a near-opaque surface) on the icon
    // box. Over a lens that reads as a sticker floating on the glass, and it
    // hides the refraction exactly where the pointer is. Interaction must stay
    // translucent so the dot grid keeps showing through the button.
    expect(template).toContain(".excalidraw .App-toolbar .ToolIcon__icon:hover");
    expect(template).toMatch(/background:\s*var\(--glass-hover-fill\)\s*!important/);
    for (const token of ["--glass-hover-fill", "--glass-active-fill", "--glass-selected-fill"]) {
      const match = new RegExp(`${token}:\\s*rgba\\(\\s*\\d+,\\s*\\d+,\\s*\\d+,\\s*([\\d.]+)\\s*\\)`).exec(template);
      expect(match, `${token} is missing`).not.toBeNull();
      expect(Number(match[1]), `${token} is too opaque for a lens`).toBeLessThanOrEqual(0.55);
    }
  });

  it("gives the zoom and undo groups a hover state again", () => {
    // Their fills were cleared to `transparent !important` so the glass could
    // show through, which also erased upstream's hover feedback: the controls
    // looked dead on hover.
    expect(template).toMatch(/\.excalidraw \.zoom-actions \.zoom-button:hover \.ToolIcon__icon/);
    expect(template).toMatch(/\.excalidraw \.undo-redo-buttons button:hover \.ToolIcon__icon/);
    // Disabled buttons must not light up; they fade the glyph instead of the
    // whole box, which previously left an empty-looking capsule.
    expect(template).toMatch(/\.excalidraw \.undo-redo-buttons button:disabled \.ToolIcon__icon\s*\{[^}]*box-shadow:\s*none !important/);
    expect(template).toMatch(/\.excalidraw \.undo-redo-buttons button:disabled svg/);
  });

  it("expresses pane fill as one token family rather than scattered percentages", () => {
    // Three inline `color-mix(... 16/34/42%, transparent)` literals had drifted
    // apart, so some panes read as glass and others as white cards.
    for (const token of ["--glass-surface-float", "--glass-surface-panel", "--glass-surface-solid"]) {
      expect(template, `${token} is missing`).toContain(`${token}: color-mix(`);
    }
    // Single-use, state-specific mixes (help hover/active) may stay inline; the
    // three surface tiers must not be re-inlined as scattered numbers.
    expect(template).not.toMatch(/background-color:\s*color-mix\(in srgb, var\(--island-bg-color\) 16%, transparent\)/);
  });

  it("paints both a specular layer and a convexity layer", () => {
    // `::before` is the highlight; `::after` is the hairline-under-the-rim plus
    // the soft shade along the bottom, which is what makes the pane look like
    // it bulges toward the viewer instead of lying flat.
    expect(template).toMatch(/\.doodle-glass::before\s*\{[^}]*mix-blend-mode:\s*screen/);
    expect(template).toMatch(/\.doodle-glass::after\s*\{/);
    expect(template).toMatch(/\.doodle-glass::after\s*\{[^}]*linear-gradient\(/);
  });

  it("does not let the refraction filter leak into descendants", () => {
    // Custom properties inherit. Without a reset every icon, 13px radio input,
    // and 1×1 visually-hidden anchor inside a pane inherits the parent's filter
    // and samples the backdrop through a bevel sized for the parent's box.
    expect(glassSource).toContain('element.dataset.glass = ""');
    expect(template).toMatch(/\[data-glass\]\s+\*\s*\{\s*--glass-refraction:\s*none;/);
  });

  it("does not give the mobile strip's rows their own bevel", () => {
    // A 12px radius on a 40px row spends 60% of the height on the band, so the
    // "rim" becomes a bowl. Rows inherit the strip's material instead.
    expect(glassSource).toContain('element.closest(".excalidraw .mobile-misc-tools-container")');
    expect(glassSource).toMatch(/if \(strip && strip !== element\) return;/);
  });

  it("anchors the mobile bottom bar to the content instead of the viewport", () => {
    // Upstream stretches this bar with `inset: 0`; opening the property sheet
    // then resizes the flex container and re-lays-out the palette, which is the
    // jitter on every open/close.
    expect(template).toMatch(/\.excalidraw \.App-bottom-bar \{[^}]*top:\s*auto;/);
    expect(template).toMatch(/\.excalidraw \.App-bottom-bar \{[^}]*bottom:\s*0;/);
    // Upstream's own `margin: 0 14px 14px` stacks with our 12px padding.
    expect(template).toMatch(/\.excalidraw \.App-bottom-bar \{[^}]*margin:\s*0 !important;/);
  });

  it("defines the surface tokens next to the colour they mix", () => {
    // `--glass-surface-*` mixes `--island-bg-color`, which only exists on
    // `.excalidraw`. Declaring them on `:root` left the whole family resolving
    // to an empty value, so every pane that used it painted nothing.
    for (const token of ["--glass-surface-float", "--glass-surface-panel", "--glass-surface-solid"]) {
      expect(template, `${token} is missing`).toContain(`${token}: color-mix(`);
    }
    // Every block that mixes glass surfaces must declare its island colour
    // first. The blocks moved when paper became the default theme, so pinning
    // one literal island colour and one global index only tested the old order.
    const blocks = [...template.matchAll(/\{\s*--color-primary[\s\S]*?\n\s*\}/g)].map((match) => match[0]);
    expect(blocks.length).toBeGreaterThanOrEqual(3);
    for (const block of blocks) {
      if (!block.includes("--glass-surface-float: color-mix(")) continue;
      const islandDecl = block.indexOf("--island-bg-color:");
      const floatDecl = block.indexOf("--glass-surface-float: color-mix(");
      expect(islandDecl, "a glass surface block is missing its island colour").toBeGreaterThanOrEqual(0);
      expect(floatDecl).toBeGreaterThan(islandDecl);
    }
  });

  it("frosts the centre without erasing the dot grid", () => {
    // The rim keeps its sharp refraction; only the flat middle is blurred, and
    // even there the frost is a partial blend so the 1px dots stay legible.
    expect(glassSource).toContain("coreMap");
    expect(glassSource).toMatch(/stdDeviation="\$\{tuning\.frost\}"/);
    expect(glassSource).toMatch(/token\("--glass-frost", 0\.12\)/);
    expect(glassSource).toMatch(/<feFuncA type="linear" slope="0\.42"/);
  });

  it("only rasterises the bevel band, not the whole pane", () => {
    // The band is a few pixels along each edge; the flat middle has no bevel
    // pixels at all. Looping every pixel ran `edgeField` tens of thousands of
    // times per map for results that were immediately discarded.
    expect(glassSource).toContain("const band = Math.ceil(bezel * scale) + 1;");
    expect(glassSource).toMatch(/scan\(top, bottomLimit, 0, columns\)/);
    expect(glassSource).toMatch(/scan\(bottomLimit, innerTop, 0, leftLimit\)/);
  });

  it("caps map resolution so 3x displays do not pay for invisible detail", () => {
    // Four primitives per pane, each a PNG re-rasterised on every rebuild.
    expect(glassSource).toMatch(/Math\.min\(Math\.max\(window\.devicePixelRatio \|\| 1, 1\), 2\)/);
  });

  it("does not wake on class churn", () => {
    // Excalidraw rewrites `class` on every hover and selection change; watching
    // it re-ran the document scan dozens of times a second for nothing.
    expect(glassSource).toMatch(/attributeFilter: \["hidden"\]/);
    expect(glassSource).not.toMatch(/attributeFilter: \["hidden", "class"\]/);
  });

  it("lets a theme turn the lens off completely", () => {
    // The paper theme sets scale, blur, and frost to zero. Building a filter
    // anyway costs a GPU pass per pane per composite for an identity map, so
    // the engine must skip it — and it must not clamp a deliberate zero back up
    // to the minimum, which is what a `|| fallback` numeric read used to do.
    expect(glassSource).toContain("if (tuning.scale === 0 && tuning.blur === 0 && tuning.frost === 0)");
    expect(glassSource).toMatch(/const raw = style\.getPropertyValue\(name\)\.trim\(\);/);
    expect(glassSource).not.toMatch(/Number\.parseFloat\(style\.getPropertyValue\(name\)\) \|\| fallback/);
  });

  it("declares the paper material for the paper appearances", () => {
    // A material switch, not another palette: the sheet is opaque and the
    // refraction is gone, which is what "paper" has to mean visually.
    expect(template).toContain(':root[data-doodle-material="paper"]');
    // The light paper block is the :root that declares the cream sheet; an
    // earlier unconditional :root now holds only theme-independent metrics.
    const creamSheet = template.indexOf("--paper-sheet: #fdfbf5");
    expect(creamSheet).toBeGreaterThan(0);
    expect(template.slice(creamSheet, creamSheet + 6000)).toContain("--glass-lens-scale: 0;");
    // Dark is now a dark sheet, not the old tinted lens. It shares the paper
    // material and must zero the lens exactly like the light appearance.
    const darkPaper = template.slice(template.indexOf(':root[data-doodle-theme="dark"] {'));
    expect(darkPaper.slice(0, 6000)).toContain("--glass-lens-scale: 0;");
    expect(darkPaper.slice(0, 6000)).toContain("--paper-sheet:");
    // Paper panes must not keep a backdrop filter — you cannot read through card.
    const paperBlock = template.slice(template.indexOf(':root[data-doodle-material="paper"] .doodle-glass {'));
    expect(paperBlock.slice(0, 600)).toContain("backdrop-filter: none");
  });

  it("gives paper an isotropic fibre, not a machined grain", () => {
    /*
     * An anisotropic baseFrequency (e.g. `0.06 0.9`) renders as wood grain at
     * 6x: paper has no direction. Both fields must be isotropic, and both must
     * be generated (`feTurbulence`) rather than shipped as an image asset.
     */
    expect(template).toContain("feTurbulence");
    expect(template).toContain("--paper-fibre:");
    expect(template).toContain("--paper-tooth:");
    // One number per baseFrequency means isotropic; two would be directional.
    const baseFreqs = [...template.matchAll(/baseFrequency='([^']+)'/g)].map((m) => m[1]);
    expect(baseFreqs.length).toBeGreaterThanOrEqual(2);
    for (const value of baseFreqs) {
      expect(value.trim().split(/\s+/), `baseFrequency "${value}" is anisotropic`).toHaveLength(1);
    }
  });

  it("keeps paper layers at distinct heights", () => {
    // Paper is a physical desk: the toolbar rests, the drawer is held above it.
    // One shared shadow would flatten that relationship.
    expect(template).toContain("--paper-shadow-card:");
    expect(template).toContain("--paper-shadow-lifted:");
    // Both inner bevels exist, so the light comes from one direction on every edge.
    expect(template).toMatch(/inset 1px 1px 0 0 var\(--paper-bevel-light\)/);
  });

  it("covers every glass surface with the paper material", () => {
    /*
     * The material has to be restated for each component, and a missed
     * component keeps its refraction while everything around it turns to paper.
     * That already happened once: the collapsed left toolbar is `.Island.sidebar`
     * and only appears after a tool opens its panel, so a screenshot of the
     * resting canvas never showed it.
     *
     * This walks the selectors the glass stylesheet actually applies a backdrop
     * filter to and requires a paper counterpart for each. It reads the
     * stylesheet, not a rendered page, so a component that is hidden at any
     * given moment still has to be covered.
     */
    const paperSection = template.slice(template.indexOf(':root[data-doodle-material="paper"] .doodle-glass'));
    const required = [
      ".doodle-glass",
      ".doodle-library-panel",
      ".excalidraw .App-toolbar",
      ".excalidraw .App-menu_bottom .Island",
      ".excalidraw .layer-ui__wrapper__top-right .Island",
      ".excalidraw .FixedSideContainer_side_top > .Island",
      ".excalidraw .Island.sidebar",
      ".excalidraw .Island.App-menu__left",
      ".excalidraw .dropdown-menu .dropdown-menu-container",
      ".excalidraw .dropdown-menu--mobile .dropdown-menu-container",
      ".excalidraw .zoom-actions",
      ".excalidraw .undo-redo-buttons",
      ".excalidraw .help-icon",
      ".excalidraw .sidebar-trigger",
      ".excalidraw .default-sidebar-trigger",
      ".excalidraw .scroll-back-to-content",
      ".excalidraw .mobile-misc-tools-container",
      ".excalidraw .App-bottom-bar > .Island",
    ];
    for (const selector of required) {
      expect(paperSection, `${selector} has no paper material`).toContain(selector);
    }
  });

  it("neutralises Excalidraw's hard-coded white inside paper panes", () => {
    /*
     * Excalidraw paints some interior containers and pressed tabs with a literal
     * `#fff`. On a cream sheet those read as holes punched through the paper —
     * the sidebar's trigger row was the visible one. They must be overridden
     * under the paper material, scoped so the glass themes stay untouched.
     */
    for (const target of [".sidebar-triggers", ".sidebar-tabs", ".sidebar__header"]) {
      expect(template, `${target} keeps its white fill`).toContain(
        `:root[data-doodle-material="paper"] .excalidraw .Island.sidebar ${target}`,
      );
    }
  });

  it("keeps the native library empty state clear of its open menu", () => {
    /*
     * Excalidraw positions the library's "..." menu with fixed negative
     * offsets. Its empty state used to sit in the middle of the sidebar, so
     * the "打开" menu painted across the explanatory copy and off the panel.
     * The copy now sits higher, the bare button is labelled "打开本地素材",
     * the menu is clamped inside the sidebar, and the copy fades while the
     * menu is open so the row never overlaps text.
     */
    expect(template).toMatch(/\.excalidraw \.library-menu-items-container__items\s*\{[^}]*justify-content:\s*flex-start\s*!important/);
    expect(template).toMatch(/\.excalidraw \.library-menu-control-buttons\s*\{[^}]*padding:\s*14px 16px 78px\s*!important/);
    expect(template).toContain('content: "打开本地素材"');
    expect(template).toMatch(/\.excalidraw \.library-menu\s*\{[^}]*left:\s*-100px\s*!important/);
    expect(template).toMatch(/\.excalidraw \.library-menu\s*\{[^}]*width:\s*min\(220px, calc\(100vw - 68px\)\)\s*!important/);
    expect(template).toContain("body:has(.excalidraw .library-menu) .excalidraw .library-menu-items__no-items");
  });

  it("keeps the canvas full width when the sidebar switches to search", () => {
    /*
     * Excalidraw docks the sidebar in Search mode by writing `right: 302px`
     * on `.layer-ui__wrapper`, shrinking the canvas and sliding the centred
     * toolbar ~150px left. Doodle's sidebar is always an inset overlay, so
     * the wrapper must stay full width with no animated width change.
     */
    expect(template).toMatch(/\.excalidraw \.layer-ui__wrapper\s*\{[^}]*width:\s*100%\s*!important[^}]*right:\s*0\s*!important/);
    expect(template).toMatch(/\.excalidraw \.layer-ui__wrapper\.animate\s*\{[^}]*transition:\s*none\s*!important/);
  });

  it("themes the search field from the palette, not upstream's hardcoded white", () => {
    /*
     * Upstream pins `.ExcTextField__input` to #f5f5f9 / #31303b by its own
     * theme class. Doodle pins Excalidraw to light, so the box was always
     * white even on the dark page. It must follow the theme's input token.
     */
    expect(template).toMatch(/\.excalidraw \.layer-ui__search-header \.ExcTextField__input\s*\{[^}]*background-color:\s*var\(--input-bg-color\)\s*!important/);
    expect(template).toMatch(/\.excalidraw \.layer-ui__search-header \.ExcTextField__input input\s*\{[^}]*color:\s*var\(--doodle-ink\)/);
    expect(template).toMatch(/\.excalidraw \.layer-ui__search-header \.ExcTextField__input input::placeholder\s*\{[^}]*color:\s*var\(--doodle-muted\)/);
  });

  it("keeps the dark paper's bevel and fibre visible on charcoal", () => {
    /*
     * On the night sheet the multiply-strength cream grain screens back to
     * almost nothing and a 0.09 bevel highlight is invisible. The dark
     * appearance raises both so the card still reads as stock, and keeps its
     * own higher-alpha noise fields.
     */
    const dark = template.slice(template.indexOf(':root[data-doodle-theme="dark"] {'));
    const bevel = /--paper-bevel-light:\s*rgba\(255,\s*255,\s*255,\s*([\d.]+)\)/.exec(dark.slice(0, 6000));
    expect(bevel).not.toBeNull();
    expect(Number(bevel[1])).toBeGreaterThan(0.12);
    const darkFibre = template.slice(template.indexOf(':root[data-doodle-material="paper"][data-doodle-theme="dark"] {'));
    const slopes = [...darkFibre.slice(0, 1500).matchAll(/feFuncA type='linear' slope='([\d.]+)'/g)].map((m) => Number(m[1]));
    expect(slopes.length).toBeGreaterThanOrEqual(2);
    expect(Math.min(...slopes)).toBeGreaterThan(0.05);
  });

  it("defines theme-independent metrics on every appearance", () => {
    /*
     * Radius, drawer width, font, easing and --doodle-duration used to live
     * only in the glass token block, so both paper appearances resolved them
     * to nothing: no drawer width, no font, and every transition at 0s.
     * They must come from an unconditional :root before the palette blocks.
     */
    const shared = template.slice(template.indexOf("Theme-independent metrics"), template.indexOf(':root[data-doodle-theme="glass"] {'));
    for (const name of ["--doodle-radius", "--doodle-radius-sm", "--doodle-space", "--doodle-ease", "--doodle-duration", "--doodle-drawer-width", "--doodle-font"]) {
      expect(shared, `${name} is not defined for all themes`).toContain(name);
    }
    expect(shared).toContain(":root {");
  });

  it("eases paint on an explicit theme switch but not on first paint", () => {
    /*
     * A palette flip should cross-fade backgrounds, borders, ink and shadow,
     * never geometry. The class is added only for the click path; the initial
     * applyTheme(readTheme()) must stay synchronous so a reload cannot flash.
     */
    expect(appSource).toMatch(/function applyTheme\(theme: DoodleTheme, animate = false\)/);
    expect(appSource).toContain('classList.add("theme-switching")');
    expect(appSource).toMatch(/applyTheme\(button\.dataset\.themeOption, true\)/);
    expect(appSource).toMatch(/applyTheme\(readTheme\(\)\);/);
    const easeRule = template.slice(template.indexOf(".theme-switching body,"));
    const transition = easeRule.slice(0, easeRule.indexOf("}"));
    for (const prop of ["background-color", "border-color", "color", "box-shadow"]) {
      expect(transition).toContain(prop);
    }
    for (const geometry of ["width", "height", "transform", "margin", "padding", "inset"]) {
      expect(transition.replace(/background-color|border-color|box-shadow/g, ""), `${geometry} must not animate`).not.toContain(geometry);
    }
  });

  it("moves the capsule below the toolbar across the tablet band", () => {
    /*
     * Excalidraw's centred toolbar slides left below ~880px and collides with
     * the Doodle capsule from 860px down. The phone layout only moved the
     * capsule below 640px, so 641–860 overlapped. A dedicated 641–900 band
     * drops the capsule a row while keeping the drawer a floating card.
     */
    expect(template).toMatch(/@media \(min-width: 641px\) and \(max-width: 900px\)\s*\{\s*\.doodle-topbar \{ top: 72px/);
    // The band rule must come after the base capsule rule to win at equal
    // specificity; a rule placed before it is silently overridden.
    const band = template.indexOf("@media (min-width: 641px)");
    const base = template.indexOf(".doodle-topbar { position: fixed");
    expect(band).toBeGreaterThan(base);
    // The phone band keeps its own full-screen drawer behaviour.
    expect(template).toContain("@media (max-width: 640px)");
  });

  it("gives paper chrome a raised layer above the desk", () => {
    /*
     * All three --glass-surface-* used to equal --paper-sheet, so the desk,
     * toolbar, drawer and menu were one flat colour. A second stock tint lets
     * lifted surfaces (drawer, dropdown) sit visibly above resting chrome.
     */
    // Light paper is located by its cream sheet token (an earlier :root holds
    // only theme-independent metrics); dark by its theme selector.
    const from = (at) => template.slice(at, at + 6500);
    for (const [name, at] of [
      ["light", template.indexOf("--paper-sheet: #fdfbf5")],
      ["dark", template.indexOf('--paper-sheet: #22262a')],
    ]) {
      const block = from(at);
      expect(block, `${name} lacks the card/well steps`).toContain("--paper-card:");
      expect(block).toContain("--paper-well:");
      expect(block).toMatch(/--glass-surface-panel:\s*var\(--paper-card\)/);
      expect(block).toMatch(/--glass-surface-float:\s*var\(--paper-sheet\)/);
    }
    // The library drawer is the lifted layer, not the resting one.
    expect(template).toMatch(/:root\[data-doodle-material="paper"\] \.doodle-library-panel\s*\{\s*background-color:\s*var\(--paper-card\)/);
  });

  it("marks the active appearance with a hand-drawn cue, not a straight rule", () => {
    /*
     * The doodle signature lives in one spot: the pressed theme segment gets
     * a slightly wobbly SVG underline. It uses currentColor via a mask so it
     * follows each palette's accent, with no font or image dependency.
     */
    expect(template).toMatch(/\.doodle-theme-option\[aria-pressed="true"\]::after/);
    const rule = template.slice(template.indexOf('.doodle-theme-option[aria-pressed="true"]::after'));
    const body = rule.slice(0, rule.indexOf("}"));
    expect(body).toContain("background: currentColor");
    expect(body).toContain("mask:");
    expect(body).toMatch(/%3Cpath d='M0 2 C/); // curved, not a straight rule
    expect(template).toMatch(/\.doodle-theme-option \{\s*position: relative/);
  });
});
