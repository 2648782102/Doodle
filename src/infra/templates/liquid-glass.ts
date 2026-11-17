/**
 * Apple "Liquid Glass" material for the Doodle chrome.
 *
 * A gaussian backdrop blur alone reads as frost, not glass: it averages the
 * page but never bends it. Real glass has a bevel. Light entering that bevel
 * is refracted, so whatever sits behind the pane is displaced along the
 * surface normal, strongest just inside the rim and gone in the middle. That
 * edge displacement is the visual signal people recognise from iOS/macOS.
 *
 * Chromium can do this with `backdrop-filter: url(#filter)`:
 *
 *   1. a per-element displacement map (R/G encode an offset from 128,128)
 *      whose amplitude follows a rounded-rect bevel profile;
 *   2. a specular map lit from the upper left, so the rim catches light;
 *   3. one filter chaining blur → displacement → saturation → specular.
 *
 * The maps are canvases rasterised at the element's own pixel size, so a
 * filter has to be rebuilt whenever the element resizes. Everything degrades
 * to a plain blur in engines without SVG backdrop filters (Firefox, Safari).
 *
 * Technique inspired by https://github.com/archisvaze/liquid-glass (MIT).
 * The easing, specular model, and filter graph here are Doodle's own.
 */

import {
  MIN_BEZEL, MAX_BEZEL, clamp, readRadius, filterMarkup,
  type LensTuning,
} from "./liquid-glass-maps.js";

const FILTER_ID = "doodle-liquid-glass";
const DEFS_ID = "doodleLiquidGlassDefs";
const REBUILD_DELAY = 120;

function defsElement(): SVGDefsElement | null {
  let defs = document.getElementById(DEFS_ID) as SVGDefsElement | null;
  if (defs) return defs;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.setAttribute("aria-hidden", "true");
  svg.style.position = "absolute";
  svg.style.overflow = "hidden";
  svg.style.pointerEvents = "none";
  defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  defs.id = DEFS_ID;
  svg.append(defs);
  document.body.append(svg);
  return defs;
}


/**
 * Chromium is the only engine that accepts an SVG filter in `backdrop-filter`.
 * Probing the parsed value is more reliable than `CSS.supports`, which reports
 * true for any url() even when the engine silently ignores it.
 */
function supportsSvgBackdropFilter(): boolean {
  const probe = document.createElement("div");
  probe.style.backdropFilter = `url(#${FILTER_ID}-probe)`;
  if (!probe.style.backdropFilter) {
    probe.style.setProperty("-webkit-backdrop-filter", `url(#${FILTER_ID}-probe)`);
  }
  return probe.style.backdropFilter.includes("url(") || probe.style.getPropertyValue("-webkit-backdrop-filter").includes("url(");
}

type GlassTarget = {
  element: HTMLElement;
  id: string;
  width: number;
  height: number;
  radius: number;
};

export type LiquidGlassController = {
  /** Rebuild every registered pane, e.g. after a theme or layout change. */
  refresh: () => void;
  /** Stop observing and drop the generated filters. */
  dispose: () => void;
};

/**
 * Attach the material to every Doodle surface and keep the maps in sync with
 * their box. Resizing is debounced because rasterising a map is the only
 * expensive step; a idle board never pays for it.
 */
const GLASS_SELECTOR = [
  ".doodle-glass",
  ".doodle-library-panel",
  // Native Excalidraw chrome islands are translucent too; refracting them makes
  // the whole shell read as one material instead of only the Doodle widgets.
  ".excalidraw .App-toolbar",
  ".excalidraw .App-menu_bottom .Island",
  ".excalidraw .layer-ui__wrapper__top-right .Island",
  ".excalidraw .FixedSideContainer_side_top > .Island",
  // Below Excalidraw's mobile breakpoint the chrome is a different tree: the
  // toolbar moves to the top, the library trigger becomes a vertical strip on
  // the right edge, and the bottom bar becomes one full-width sheet.
  ".excalidraw .App-toolbar--mobile",
  ".excalidraw .mobile-misc-tools-container",
  ".excalidraw .App-bottom-bar > .Island",
  ".excalidraw .Island.App-menu__left",
  // Menus float over board content and get the same material as the shell.
  // The expanded property sheet is deliberately excluded: it is a control
  // panel, and refraction behind swatch labels made it unreadable.
  ".excalidraw .dropdown-menu .dropdown-menu-container",
  // Bottom-left zoom/undo and the top-right library trigger are plain buttons
  // rather than islands; CSS gives them the material, so they need maps too.
  ".excalidraw .zoom-actions",
  ".excalidraw .undo-redo-buttons",
  ".excalidraw .help-icon",
  /*
   * The library trigger is only a pane when it stands alone. Inside the mobile
   * strip it is a 40px row of a pane that already has the material, and a
   * 12px bevel on a 40px box is 60% of its height: it stops reading as a rim
   * and turns into a bowl. `:not(.mobile-misc-tools-container *)` keeps the
   * standalone desktop trigger refracting while letting the mobile strip own
   * the material for its rows.
   */
  ".excalidraw .sidebar-trigger",
  ".excalidraw .default-sidebar-trigger",
].join(", ");

export function initLiquidGlass(selector = GLASS_SELECTOR): LiquidGlassController | null {
  if (typeof window === "undefined" || !supportsSvgBackdropFilter()) return null;
  const defs = defsElement();
  if (!defs) return null;
  const container: SVGDefsElement = defs;

  const targets = new Map<HTMLElement, GlassTarget>();
  const observer = new ResizeObserver((entries) => {
    // Rasterising two maps is the only expensive step here, and a drawer
    // sliding open fires the observer on every frame. Coalesce them.
    for (const entry of entries) schedule(entry.target as HTMLElement);
  });
  const timers = new WeakMap<HTMLElement, number>();
  let counter = 0;

  function recompute(element: HTMLElement, force = false): void {
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    if (width < 12 || height < 12) return;
    const radius = readRadius(element, width, height);
    const bezel = Math.round(clamp(Math.min(width, height) * 0.3, MIN_BEZEL, Math.max(MIN_BEZEL, Math.min(MAX_BEZEL, radius * 1.6))));
    const existing = targets.get(element);
    // A target registered while hidden has no id yet; never reuse that as a
    // filter name or the pane would point at `url(#)`.
    const reusable = existing?.id ? existing : undefined;
    if (!force && reusable && reusable.width === width && reusable.height === height && reusable.radius === radius) return;
    const id = reusable?.id ?? `${FILTER_ID}-${(counter += 1)}`;
    const previous = reusable ? document.getElementById(id) : null;
    // iOS glass is a lens, not a frosted panel. The board's backdrop is a dot
    // grid rather than a photo, and a blur of even 1.5px erases a 1px dot, so
    // blur stays under ~1.2px: the displacement does the work and the grid
    // stays legible through the pane.
    const style = getComputedStyle(element);
    /*
     * Read a numeric token, treating an explicit `0` as a value.
     *
     * `Number.parseFloat(...) || fallback` looks harmless and is wrong: `0` is
     * falsy, so a theme that sets `--glass-lens-blur: 0` to turn blur off got
     * the default instead. The paper theme uses zero for scale, blur, and frost
     * together, and all three were silently replaced — which is why it still
     * built a full refraction filter after being told to build none.
     */
    const token = (name: string, fallback: number) => {
      const raw = style.getPropertyValue(name).trim();
      if (!raw) return fallback;
      const parsed = Number.parseFloat(raw);
      return Number.isFinite(parsed) ? parsed : fallback;
    };
    const tuning: LensTuning = {
      /*
       * Frost without losing the lens.
       *
       * A single blur has to serve two jobs that want opposite values: the rim
       * must stay sharp enough to show the bevel bending the backdrop, while
       * the centre should be soft enough to read as frosted rather than as
       * clear acetate. Multiplying the same gaussian across the pane can only
       * satisfy one of them, which is why the earlier cap was 1.2px: anything
       * more erased the 1px dot grid and the pane turned to fog.
       *
       * `blur` here drives the outer band only (the filter chains it *before*
       * displacement). A second, much softer pass is composited over the flat
       * centre by `frostVeil` below, so the rim keeps its refraction and the
       * middle gets the diffuse haze.
       */
      /*
       * Same rule as `scale` below: an explicit zero means "this theme wants no
       * blur here", and the paper theme relies on that for the frost pass.
       */
      blur: (() => {
        const requested = token("--glass-lens-blur", 0.05);
        return requested <= 0 ? 0 : Math.round(clamp(bezel * requested, 0.5, 1.4) * 10) / 10;
      })(),
      frost: (() => {
        const requested = token("--glass-frost", 0.12);
        return requested <= 0 ? 0 : Math.round(clamp(bezel * requested, 1.2, 3.5));
      })(),
      /*
       * Displacement is measured in CSS pixels and must stay *below* the
       * bevel band's own width. When it exceeded the band, the map pushed the
       * backdrop by more than the distance it had to fade out over, so the
       * edge band sampled pixels from far outside itself and smeared into the
       * plastic-looking strips. Roughly half the bezel reads as a lens; twice
       * the bezel reads as a smear.
       *
       * The profile is a smooth bump, so the *mean* push across the band is
       * only about half the peak. At a 0.9 peak-to-bezel ratio the average
       * bend is therefore ~0.45 bezel, which is the range where a rim visibly
       * magnifies what is behind it without tearing.
       */
      /*
       * `0` is meaningful and must survive the clamp.
       *
       * The paper theme sets `--glass-lens-scale: 0` because an opaque sheet
       * has no refraction to speak of. Clamping a zero up to the 4px floor
       * would leave a small but visible bend in every card, which reads as a
       * warped sticker rather than paper.
       */
      scale: (() => {
        const requested = token("--glass-lens-scale", 0.9);
        if (requested <= 0) return 0;
        return Math.round(clamp(bezel * requested, 4, 16));
      })(),
      shade:
        style.getPropertyValue("--glass-shade").trim() ||
        (document.documentElement.dataset.doodleTheme === "dark" ? "rgba(0,0,0,0.55)" : "rgba(16,30,24,0.5)"),
    };
    /*
     * A theme may ask for no lens at all.
     *
     * The paper appearance sets scale, blur, and frost to zero: an opaque sheet
     * has nothing to refract and nothing to frost, and its material comes from
     * borders and shadows instead. Building a filter that would be the identity
     * map wastes a GPU pass per pane per composite, so skip it and leave
     * `--glass-refraction` unset — the CSS fallback then resolves to plain
     * `blur(0) saturate(100%)`, which is also the identity.
     */
    if (tuning.scale === 0 && tuning.blur === 0 && tuning.frost === 0) {
      targets.set(element, { element, id: "", width, height, radius });
      element.style.removeProperty("--glass-refraction");
      element.dataset.glass = "";
      // Drop every filter this pane owned. A theme switch rebuilds each pane in
      // turn, so the earlier ones leave orphans in `<defs>` unless they are
      // removed here; on a board with six panes that is six dead filters whose
      // maps are still referenced by nothing but still cost memory.
      previous?.remove();
      return;
    }
    const markup = filterMarkup(id, width, height, radius, bezel, tuning);
    if (!markup) return;
    // The markup must be parsed in the SVG namespace: a `<filter>` created by
    // the HTML parser is an inert unknown element and `url(#id)` never
    // resolves, which silently leaves the pane without any effect.
    const holder = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    holder.innerHTML = markup;
    const node = holder.firstElementChild;
    if (!node) return;
    previous?.replaceWith(node);
    if (!previous) container.append(node);
    targets.set(element, { element, id, width, height, radius });
    element.style.setProperty("--glass-refraction", `url(#${id})`);
    /*
     * Mark the element so CSS can scope the reset. See the `:where([data-glass])`
     * rule in `excalidraw.html`: every descendant of a pane clears the custom
     * property, and only elements carrying this attribute keep their own
     * filter. Custom properties inherit, so without that reset every icon and
     * hidden anchor inside a pane samples the backdrop through a bevel sized
     * for the parent's box.
     */
    element.dataset.glass = "";
  }

  function schedule(element: HTMLElement): void {
    const pending = timers.get(element);
    if (pending) window.clearTimeout(pending);
    timers.set(
      element,
      window.setTimeout(() => {
        timers.delete(element);
        recompute(element);
      }, REBUILD_DELAY),
    );
  }

  function watch(element: HTMLElement): void {
    if (targets.has(element)) return;
    /*
     * A bevel needs room to be a bevel.
     *
     * The mobile library trigger is a 40px row inside the mobile tool strip.
     * Its radius is 12px, and the band is allowed to grow to
     * `min(width, height) * 0.3`, so the rim ends up covering 60% of the box
     * and there is no flat centre left: it reads as a bowl rather than a lens,
     * which is the "tray inside the strip" that survived the light fix. Rows
     * inside the strip inherit the strip's material instead of getting their
     * own filter.
     */
    const strip = element.closest(".excalidraw .mobile-misc-tools-container");
    if (strip && strip !== element) return;
    targets.set(element, { element, id: "", width: 0, height: 0, radius: -1 });
    observer.observe(element);
    recompute(element);
  }

  /**
   * Elements that live in a hidden container (the library drawer, the notify
   * button) measure zero while closed, so their filter is built the first time
   * they become visible. Re-measuring here is cheap: `recompute` returns early
   * when the box has not changed.
   */
  function scan(): void {
    document.querySelectorAll<HTMLElement>(selector).forEach((element) => {
      if (targets.has(element)) recompute(element);
      else watch(element);
    });
  }

  scan();
  // The welcome card, drawer, and notify button appear on demand.
  // Class changes fire constantly inside Excalidraw (hover, selection), so the
  // rescan is coalesced into one frame instead of running per mutation.
  let scanTimer = 0;
  const tree = new MutationObserver(() => {
    if (scanTimer) return;
    scanTimer = window.setTimeout(() => {
      scanTimer = 0;
      scan();
    }, 120);
  });
  /*
   * Watch structure and `hidden`, not `class`.
   *
   * Excalidraw rewrites `class` constantly — hover, selection, every pointer
   * move over the toolbar — so observing it woke the observer dozens of times
   * a second and re-ran `scan()` over the whole document. `scan()` itself is
   * cheap (it only touches elements matching the selector), but the callback
   * and the query were pure overhead on a board that is supposed to feel like
   * paper. Panes appear through element insertion and `hidden` flips, which is
   * all this needs; a pane that merely changes class keeps its maps.
   */
  tree.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });

  return {
    refresh() {
      // The rim shade colour is theme-dependent, so a theme switch has to
      // rebuild the filter rather than only re-measure the box.
      for (const element of targets.keys()) recompute(element, true);
      /*
       * Sweep filters no pane points at any more.
       *
       * A material switch (glass → paper) makes every pane take the no-lens
       * path, which removes its own filter but leaves the `<filter>` nodes a
       * *previous* theme created. Those nodes hold three rasterised maps each
       * and nothing references them, so they are pure leakage. Anything still
       * unreferenced here is dead.
       */
      const live = new Set(
        [...targets.values()].map((target) => target.id).filter(Boolean),
      );
      for (const node of [...container.querySelectorAll("filter")]) {
        if (!live.has(node.id)) node.remove();
      }
    },
    dispose() {
      tree.disconnect();
      if (scanTimer) window.clearTimeout(scanTimer);
      observer.disconnect();
      for (const { element } of targets.values()) {
        element.style.removeProperty("--glass-refraction");
      }
      targets.clear();
      defs.replaceChildren();
    },
  };
}
