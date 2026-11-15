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

const FILTER_ID = "doodle-liquid-glass";
const DEFS_ID = "doodleLiquidGlassDefs";
const PROFILE_SAMPLES = 96;
const MIN_BEZEL = 7;
const MAX_BEZEL = 26;
const REBUILD_DELAY = 120;

/** Bevel cross-section: a squircle, flat at the rim and level in the middle. */
function bevelHeight(t: number): number {
  return Math.pow(1 - Math.pow(1 - Math.min(Math.max(t, 0), 1), 4), 0.25);
}

/**
 * Displacement amplitude from the rim (t=0) to the inner bevel edge (t=1).
 * Zero exactly at the rim keeps the pane's outline from tearing, peaks just
 * inside it, and fades out before the flat centre.
 */
function bevelAmplitude(t: number): number {
  const rise = Math.pow(Math.sin(Math.min(t, 1) * Math.PI * 0.5), 1.4);
  return rise * (1 - 0.32 * t);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function readRadius(element: HTMLElement, width: number, height: number): number {
  const declared = Number.parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0;
  return Math.round(clamp(declared || Math.min(width, height) / 2, 0, Math.min(width, height) / 2));
}

/**
 * Distance from a pixel to the nearest edge measured *inside* the rounded
 * rect, plus the outward normal. Points outside the shape report Infinity.
 */
function edgeField(
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): { distance: number; nx: number; ny: number } | null {
  const innerWidth = width - radius * 2;
  const innerHeight = height - radius * 2;
  const cx = x < radius ? x - radius : x >= width - radius ? x - radius - innerWidth : 0;
  const cy = y < radius ? y - radius : y >= height - radius ? y - radius - innerHeight : 0;
  const distance = Math.hypot(cx, cy);
  if (distance > radius) return null;
  if (distance === 0) return { distance: radius, nx: 0, ny: 0 };
  return { distance: radius - distance, nx: cx / distance, ny: cy / distance };
}

/** Map resolution multiplier: a 1x map shows hard stair-steps at the rim on Retina. */
function mapScale(): number {
  return Math.min(Math.max(window.devicePixelRatio || 1, 1), 3);
}

function canvasUrl(width: number, height: number, paint: (data: Uint8ClampedArray, scale: number) => void): string {
  const scale = mapScale();
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (!context) return "";
  const image = context.createImageData(canvas.width, canvas.height);
  paint(image.data, scale);
  context.putImageData(image, 0, 0);
  return canvas.toDataURL();
}

/**
 * Walk the map at device resolution while measuring in CSS pixels, so the map
 * matches the element's raster grid and the bevel is smooth on Retina.
 */
function paintEdgeMap(
  width: number,
  height: number,
  radius: number,
  bezel: number,
  paint: (data: Uint8ClampedArray, offset: number, nx: number, ny: number, t: number) => void,
  clear: (data: Uint8ClampedArray) => void = (data) => data.fill(0),
): string {
  return canvasUrl(width, height, (data, scale) => {
    clear(data);
    const columns = Math.round(width * scale);
    const rows = Math.round(height * scale);
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const field = edgeField((column + 0.5) / scale, (row + 0.5) / scale, width, height, radius);
        if (!field || field.distance <= 0 || field.distance >= bezel) continue;
        if (field.nx === 0 && field.ny === 0) continue;
        paint(data, (row * columns + column) * 4, field.nx, field.ny, field.distance / bezel);
      }
    }
  });
}

/** Red/green channel displacement map consumed by `feDisplacementMap`. */
function displacementMap(width: number, height: number, radius: number, bezel: number): string {
  return paintEdgeMap(width, height, radius, bezel, (data, offset, nx, ny, t) => {
    const amplitude = bevelAmplitude(t);
    data[offset] = Math.round(clamp(128 + nx * amplitude * 127, 0, 255));
    data[offset + 1] = Math.round(clamp(128 + ny * amplitude * 127, 0, 255));
    data[offset + 2] = 0;
    data[offset + 3] = 255;
  }, (data) => {
    // Neutral 128,128 means "no displacement". Transparent defaults would read
    // as 0 and pull the whole pane by half a filter unit.
    for (let index = 0; index < data.length; index += 4) {
      data[index] = 128;
      data[index + 1] = 128;
      data[index + 3] = 255;
    }
  });
}

/** Rim highlight lit from the upper left, fading inward across the bevel. */
function specularMap(width: number, height: number, radius: number, bezel: number): string {
  const lightX = 0.42;
  const lightY = -0.91;
  return paintEdgeMap(width, height, radius, bezel, (data, offset, nx, ny, t) => {
    const facing = Math.max(0, nx * lightX + -ny * lightY);
    const value = Math.pow(facing, 2.2) * Math.pow(1 - t, 1.4);
    if (value <= 0.004) return;
    const channel = Math.round(clamp(value * 255 * 1.5, 0, 255));
    data[offset] = channel;
    data[offset + 1] = channel;
    data[offset + 2] = channel;
    data[offset + 3] = channel;
  });
}

/**
 * The shadow side of the bevel.
 *
 * Without this the pane looks flat on a plain page: the highlight is only
 * visible where light lands, and a near-white canvas gives the lens nothing to
 * bend. A real glass edge is a tube, so opposite the highlight it goes *darker*
 * than the backdrop. That dark band is what makes the curvature legible even
 * when there is no texture behind the pane.
 */
function rimShadeMap(width: number, height: number, radius: number, bezel: number): string {
  const lightX = 0.42;
  const lightY = -0.91;
  return paintEdgeMap(width, height, radius, bezel, (data, offset, nx, ny, t) => {
    const facing = Math.max(0, -(nx * lightX + -ny * lightY));
    const value = Math.pow(facing, 1.5) * Math.pow(1 - t, 0.9);
    if (value <= 0.006) return;
    data[offset + 3] = Math.round(clamp(value * 130, 0, 130));
  });
}

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

type LensTuning = { blur: number; scale: number; shade: string };

function filterMarkup(
  id: string,
  width: number,
  height: number,
  radius: number,
  bezel: number,
  tuning: LensTuning,
): string {
  const displacement = displacementMap(width, height, radius, bezel);
  const specular = specularMap(width, height, radius, bezel);
  const rimShade = rimShadeMap(width, height, radius, bezel);
  if (!displacement || !specular) return "";

  /*
   * Chromatic dispersion. Glass has a different refractive index per
   * wavelength, so a bevelled edge fringes with colour: the rim separates
   * slightly into cyan and amber. This is the single most recognisable cue of
   * the Apple material at small sizes, where there is too little bevel for
   * displacement alone to be obvious. Two extra displacement passes at a
   * fraction of the main scale, isolated into the red and blue channels, then
   * screened back over the refracted backdrop.
   */
  const fringe = Math.max(2, Math.round(tuning.scale * 0.22));
  return [
    `<filter id="${id}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">`,
    `<feGaussianBlur in="SourceGraphic" stdDeviation="${tuning.blur}" result="soft" />`,
    `<feImage href="${displacement}" x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="lens" />`,
    `<feDisplacementMap in="soft" in2="lens" scale="${tuning.scale}" xChannelSelector="R" yChannelSelector="G" result="refracted" />`,
    `<feColorMatrix in="refracted" type="saturate" values="1.55" result="tinted" />`,
    `<feDisplacementMap in="soft" in2="lens" scale="${fringe}" xChannelSelector="R" yChannelSelector="G" result="fringeBase" />`,
    `<feColorMatrix in="fringeBase" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="fringeRed" />`,
    `<feDisplacementMap in="soft" in2="lens" scale="-${fringe}" xChannelSelector="R" yChannelSelector="G" result="fringeBase2" />`,
    `<feColorMatrix in="fringeBase2" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="fringeBlue" />`,
    `<feBlend in="fringeRed" in2="fringeBlue" mode="screen" result="fringes" />`,
    `<feImage href="${rimShade}" x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="fringeMask" />`,
    `<feComposite in="fringes" in2="fringeMask" operator="in" result="fringesMasked" />`,
    `<feComponentTransfer in="fringesMasked" result="fringesFaded"><feFuncA type="linear" slope="0.32" /></feComponentTransfer>`,
    `<feBlend in="fringesFaded" in2="tinted" mode="screen" result="dispersed" />`,
    `<feImage href="${rimShade}" x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="shade" />`,
    `<feFlood flood-color="${tuning.shade}" result="shadeColor" />`,
    `<feComposite in="shadeColor" in2="shade" operator="in" result="shadeMasked" />`,
    `<feBlend in="shadeMasked" in2="dispersed" mode="normal" result="shaded" />`,
    `<feImage href="${specular}" x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="gloss" />`,
    `<feComponentTransfer in="gloss" result="glossFaded"><feFuncA type="linear" slope="0.72" /></feComponentTransfer>`,
    `<feBlend in="glossFaded" in2="shaded" mode="screen" />`,
    `</filter>`,
  ].join("");
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
  // Menus and the mobile extra-tools sheet float over board content; they get
  // the same material as the shell rather than a flat white card.
  ".excalidraw .dropdown-menu .dropdown-menu-container",
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
    const token = (name: string, fallback: number) => Number.parseFloat(style.getPropertyValue(name)) || fallback;
    const tuning: LensTuning = {
      blur: Math.round(clamp(bezel * token("--glass-lens-blur", 0.05), 0.5, 1.2) * 10) / 10,
      scale: Math.round(clamp(bezel * token("--glass-lens-scale", 2.1), 12, 34)),
      shade:
        style.getPropertyValue("--glass-shade").trim() ||
        (document.documentElement.dataset.doodleTheme === "dark" ? "rgba(0,0,0,0.55)" : "rgba(16,30,24,0.5)"),
    };
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
  tree.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "class"] });

  return {
    refresh() {
      // The rim shade colour is theme-dependent, so a theme switch has to
      // rebuild the filter rather than only re-measure the box.
      for (const element of targets.keys()) recompute(element, true);
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
