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
 *
 * Both ends must reach zero. The bevel is a closed band: if the amplitude is
 * still high where the band stops, the map jumps from "displace by N pixels" to
 * "don't displace" on one pixel row, and the backdrop is sampled from two
 * different places on either side of that line. Visually that is a hard seam
 * running across the inside of the pane, which reads as a second rectangle
 * layered under the glass.
 *
 * The curve rises quickly from the rim (that is where the lens bends hardest),
 * peaks around a third of the way in, then eases back to zero at the inner
 * edge so the transition into the flat centre is continuous.
 */
function bevelAmplitude(t: number): number {
  const clamped = Math.min(Math.max(t, 0), 1);
  const rise = Math.pow(Math.sin(clamped * Math.PI * 0.5), 1.4);
  const fall = 1 - Math.pow(clamped, 3);
  return rise * fall;
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

/**
 * Rim highlight lit from the upper left, fading inward across the bevel.
 *
 * `edgeField` reports **outward** normals, so the top edge has a negative
 * `ny`. The light vector points from the surface toward the light, which sits
 * above the pane, so it also has a negative `y`. The lit side is therefore the
 * one whose normal agrees with the light vector: a plain dot product.
 *
 * Negating `ny` here (as an earlier revision did) flips the material upside
 * down: the bright band lands on the bottom edge and the dark one on the top.
 * At 44px tall that reads as a slab shifted toward the lower left instead of a
 * lit rim, which is the "rectangle inside the glass" people report.
 */
function specularMap(width: number, height: number, radius: number, bezel: number): string {
  const lightX = 0.42;
  const lightY = -0.91;
  return paintEdgeMap(width, height, radius, bezel, (data, offset, nx, ny, t) => {
    const facing = Math.max(0, nx * lightX + ny * lightY);
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
    // The shaded side is the rim facing away from the light: the negation of
    // the same dot product `specularMap` uses, so the two always complement
    // each other instead of stacking on the same edge.
    const facing = Math.max(0, -(nx * lightX + ny * lightY));
    const value = Math.pow(facing, 1.5) * Math.pow(1 - t, 0.9);
    if (value <= 0.006) return;
    // The shade is a dark veil composited with `operator="in"` against this
    // map, so all four channels have to stay near-black; only alpha carries
    // the shape. Leaving RGB at its cleared value of 0 already does that.
    data[offset + 3] = Math.round(clamp(value * 130, 0, 130));
  });
}

/**
 * The flat middle of a pane, as an opaque mask.
 *
 * This is the complement of the bevel band: fully opaque once a pixel is
 * further from the rim than `bezel`, fully transparent inside the band. It
 * exists so the frost pass can be confined to the centre while the rim keeps
 * its sharp refraction — one blur cannot serve both, so the filter splits the
 * pane along this edge.
 */
function coreMap(width: number, height: number, radius: number, bezel: number): string {
  return canvasUrl(width, height, (data, scale) => {
    const columns = Math.round(width * scale);
    const rows = Math.round(height * scale);
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const field = edgeField((column + 0.5) / scale, (row + 0.5) / scale, width, height, radius);
        /*
         * `edgeField` returns null outside the rounded rect, so those pixels
         * must stay transparent — the clamp to the border-radius is what makes
         * the frost follow the pane's shape rather than its bounding box.
         * Inside the shape, only the bevel band is excluded.
         */
        if (field === null) continue;
        if (field.distance > 0 && field.distance < bezel) continue;
        const offset = (row * columns + column) * 4;
        data[offset] = 255;
        data[offset + 1] = 255;
        data[offset + 2] = 255;
        data[offset + 3] = 255;
      }
    }
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

type LensTuning = { blur: number; scale: number; shade: string; frost: number };

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
  const coreMask = coreMap(width, height, radius, bezel);
  if (!displacement || !specular || !coreMask) return "";

  /*
   * Every map is declared in **user space CSS pixels**, not `100%`.
   *
   * `width="100%"` on an `feImage` resolves against the filter region, while
   * `feDisplacementMap` reads its offsets in user space. On a pane whose box
   * is not an integer number of device pixels those two grids drift apart and
   * the edge band gets smeared into a hard-edged slab offset up and to the
   * left — the "rectangle inside the glass" report. Pinning the primitives to
   * the element's own CSS size keeps the displacement map and the sample grid
   * in the same coordinate system at any DPR.
   */
  const w = width;
  const h = height;
  const map = (href: string, result: string) =>
    `<feImage href="${href}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none" result="${result}" />`;

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
    `<filter id="${id}" x="0" y="0" width="${w}" height="${h}" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">`,
    `<feGaussianBlur in="SourceGraphic" stdDeviation="${tuning.blur}" result="soft" />`,
    map(displacement, "lens"),
    `<feDisplacementMap in="soft" in2="lens" scale="${tuning.scale}" xChannelSelector="R" yChannelSelector="G" result="refracted" />`,
    `<feColorMatrix in="refracted" type="saturate" values="1.55" result="tinted" />`,
    `<feDisplacementMap in="soft" in2="lens" scale="${fringe}" xChannelSelector="R" yChannelSelector="G" result="fringeBase" />`,
    `<feColorMatrix in="fringeBase" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="fringeRed" />`,
    `<feDisplacementMap in="soft" in2="lens" scale="-${fringe}" xChannelSelector="R" yChannelSelector="G" result="fringeBase2" />`,
    `<feColorMatrix in="fringeBase2" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="fringeBlue" />`,
    `<feBlend in="fringeRed" in2="fringeBlue" mode="screen" result="fringes" />`,
    map(rimShade, "fringeMask"),
    `<feComposite in="fringes" in2="fringeMask" operator="in" result="fringesMasked" />`,
    `<feComponentTransfer in="fringesMasked" result="fringesFaded"><feFuncA type="linear" slope="0.32" /></feComponentTransfer>`,
    `<feBlend in="fringesFaded" in2="tinted" mode="screen" result="dispersed" />`,
    map(rimShade, "shade"),
    `<feFlood flood-color="${tuning.shade}" result="shadeColor" />`,
    `<feComposite in="shadeColor" in2="shade" operator="in" result="shadeMasked" />`,
    `<feBlend in="shadeMasked" in2="dispersed" mode="normal" result="shaded" />`,
    map(specular, "gloss"),
    `<feComponentTransfer in="gloss" result="glossFaded"><feFuncA type="linear" slope="0.72" /></feComponentTransfer>`,
    `<feBlend in="glossFaded" in2="shaded" mode="screen" result="lit" />`,
    /*
     * Frost layer.
     *
     * The rim has to stay sharp or the bevel stops reading as a lens, and the
     * centre has to be soft or the pane reads as clear acetate instead of
     * glass. One gaussian cannot do both, so this second, much wider blur runs
     * on a fresh copy of the backdrop and is masked to the *flat middle* —
     * exactly the complement of the bevel band. `feComposite operator="out"`
     * against the same rim-shade silhouette punches the rim out of the frost,
     * so the two treatments split at the bevel's inner edge instead of
     * cross-fading through the middle of the band.
     */
    `<feGaussianBlur in="SourceGraphic" stdDeviation="${tuning.frost}" result="frost" />`,
    `<feColorMatrix in="SourceGraphic" type="saturate" values="1.25" result="frostTinted" />`,
    `<feComposite in="frostTinted" in2="frost" operator="arithmetic" k1="0.55" k2="0.45" k3="0" k4="0" result="frostMix" />`,
    map(coreMask, "core"),
    `<feComposite in="frostMix" in2="core" operator="in" result="frostCore" />`,
    `<feComponentTransfer in="frostCore" result="frostSoft"><feFuncA type="linear" slope="0.42" /></feComponentTransfer>
    <feBlend in="frostSoft" in2="lit" mode="normal" />`,
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
    const token = (name: string, fallback: number) => Number.parseFloat(style.getPropertyValue(name)) || fallback;
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
      blur: Math.round(clamp(bezel * token("--glass-lens-blur", 0.05), 0.5, 1.4) * 10) / 10,
      frost: Math.round(clamp(bezel * token("--glass-frost", 0.12), 1.2, 3.5)),
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
      scale: Math.round(clamp(bezel * token("--glass-lens-scale", 0.9), 4, 16)),
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
