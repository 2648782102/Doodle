/**
 * Every Excalidraw internal Doodle's CSS reaches into, and why.
 *
 * `excalidraw.html` styles Excalidraw's own DOM: there is no public API for
 * "make the toolbar match the board", so the chrome is themed by selector. That
 * is a real dependency on another project's internals — the price of not
 * maintaining a canvas engine — and the risk is that an upgrade renames a class
 * and the chrome silently loses its styling.
 *
 * This table makes the dependency auditable in one place: each entry records
 * what Doodle does to that element, so a failed upgrade can be triaged without
 * reading 110 KB of CSS. `scripts/repo-check.mjs` fails when `excalidraw.html`
 * starts using an `App-*` / `ToolIcon*` / `Island*` selector that is not listed
 * here — a new dependency must be a deliberate, documented one.
 *
 * The browser contract suite (`npm run test:browser`) is the other half: this
 * says what is used, that suite says it still exists.
 */

export interface UpstreamDependency {
  /** The class or selector fragment Doodle targets. */
  selector: string;
  /** What breaks if it disappears. */
  usedFor: string;
  /**
   * `required` — Doodle's chrome does not work without it.
   * `cosmetic` — a nicety; losing it degrades polish, not function.
   */
  weight: "required" | "cosmetic";
}

export const UPSTREAM_DEPENDENCIES: UpstreamDependency[] = [
  { selector: ".App-toolbar", usedFor: "Shape toolbar: glass pane, centring, mobile variant", weight: "required" },
  { selector: ".App-menu_top", usedFor: "Top menu row Doodle leaves empty so the toolbar stays centred", weight: "required" },
  { selector: ".App-bottom-bar", usedFor: "Mobile bottom bar: material, anchoring, the property sheet", weight: "required" },
  { selector: ".App-mobile-menu", usedFor: "Expanded mobile property sheet: solid surface, 62vh cap, two-column grid", weight: "required" },
  { selector: ".Island", usedFor: "Every floating chrome group: lens material and rim", weight: "required" },
  { selector: ".ToolIcon", usedFor: "Tool buttons: hover and selected fill inside the lens", weight: "required" },
  { selector: ".ToolIcon__icon", usedFor: "Tool glyph: hover tint, selected accent ring", weight: "required" },
  { selector: ".layer-ui__wrapper", usedFor: "Stacking context the glass panes sit above", weight: "required" },
  { selector: ".zoom-actions", usedFor: "Zoom cluster: glass container, cleared inner button fills", weight: "required" },
  { selector: ".undo-redo-buttons", usedFor: "Undo/redo cluster: same treatment as the zoom group", weight: "required" },
  { selector: ".mobile-misc-tools-container", usedFor: "Right-hand mobile tool strip", weight: "cosmetic" },
  { selector: ".dropdown-menu", usedFor: "Dropdown panels: surface and border", weight: "cosmetic" },
  { selector: ".ExcTextField__input", usedFor: "Inline text input: colour and caret", weight: "cosmetic" },
  { selector: ".HintViewer", usedFor: "Upstream tutorial strip, hidden at every width", weight: "cosmetic" },
  { selector: ".Modal", usedFor: "Upstream modals: kept above the glass", weight: "cosmetic" },
  { selector: ".HelpDialog__header", usedFor: "Help dialog header, hidden because Doodle ships its own help", weight: "cosmetic" },
  { selector: ".panelColumn", usedFor: "Right-hand property panel column", weight: "cosmetic" },
  { selector: ".library-menu", usedFor: "Upstream materials menu: width and offset beside the drawer", weight: "cosmetic" },
  { selector: ".App-menu__left", usedFor: "Left menu cell Doodle keeps empty so the toolbar stays centred", weight: "required" },
  { selector: ".App-menu_bottom", usedFor: "Bottom menu row: the zoom/undo islands' container", weight: "required" },
  { selector: ".App-menu_top__left", usedFor: "Top-left cell emptied on purpose (wordmark menu removed)", weight: "required" },
  { selector: ".ToolIcon--selected", usedFor: "Selected tool: accent ring inside the lens", weight: "required" },
  { selector: ".ToolIcon_type_checkbox", usedFor: "Checkbox-style tools (keep-selected): hit area and sizing", weight: "cosmetic" },
  { selector: ".ToolIcon_type_radio", usedFor: "Radio-style tools (the shape palette): hit area and sizing", weight: "cosmetic" },
];

/**
 * Selectors the repo guard scans for in `excalidraw.html`.
 *
 * `.excalidraw` itself is not matched: it is the scope wrapper every rule uses,
 * not an internal Doodle reaches into, and counting it would drown the signal.
 * `.Modal` and `.HelpDialog__header` are matched because Doodle hides them.
 */
export const UPSTREAM_SELECTOR_PATTERN = /\.(App-[A-Za-z_-]+|ToolIcon[A-Za-z_-]*|Island[A-Za-z_-]*|layer-ui__wrapper|zoom-actions|undo-redo-buttons|mobile-misc-tools-container|dropdown-menu|ExcTextField__[A-Za-z_-]+|HintViewer|panelColumn|library-menu|HelpDialog__[A-Za-z_-]+|Modal)/g;

/** Distinct selector fragments a stylesheet references. */
export function upstreamSelectorsUsed(css: string): string[] {
  const found = new Set<string>();
  for (const match of css.matchAll(UPSTREAM_SELECTOR_PATTERN)) found.add(`.${match[1]}`);
  return [...found].sort();
}
