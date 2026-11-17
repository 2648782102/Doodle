/**
 * Bevel map generation and SVG filter assembly for the liquid-glass material.
 *
 * Split from liquid-glass.ts to keep the browser client under the module size
 * budget. Pure geometry: rasterise the bevel maps from CSS dimensions and
 * assemble the SVG filter. DOM observation and lifecycle stay in the caller.
 */

export const PROFILE_SAMPLES = 96;
export const MIN_BEZEL = 7;
export const MAX_BEZEL = 26;

/** Bevel cross-section: a squircle, flat at the rim and level in the middle. */
export function bevelHeight(t: number): number {
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
export function bevelAmplitude(t: number): number {
  const clamped = Math.min(Math.max(t, 0), 1);
  const rise = Math.pow(Math.sin(clamped * Math.PI * 0.5), 1.4);
  const fall = 1 - Math.pow(clamped, 3);
  return rise * fall;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function readRadius(element: HTMLElement, width: number, height: number): number {
  const declared = Number.parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0;
  return Math.round(clamp(declared || Math.min(width, height) / 2, 0, Math.min(width, height) / 2));
}

/**
 * Distance from a pixel to the nearest edge measured *inside* the rounded
 * rect, plus the outward normal. Points outside the shape report Infinity.
 */
export function edgeField(
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

/**
 * Map resolution multiplier.
 *
 * A 1x map shows hard stair-steps at the rim on Retina, so this follows the
 * device pixel ratio — but the map is regenerated as a PNG and re-rasterised
 * by the compositor on every rebuild, so the top of that range is expensive
 * for very little visible gain on small chrome. Doodle's panes are 36–550px
 * wide; at DPR 3 a 550x44 toolbar produced a 1650x132 map per primitive and
 * there are four primitives. Capping at 2 keeps the bevel smooth (the band is
 * only ~13px) while halving the raster cost on 3x displays.
 */
export function mapScale(): number {
  return Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
}

export function canvasUrl(width: number, height: number, paint: (data: Uint8ClampedArray, scale: number) => void): string {
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
export function paintEdgeMap(
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
    /*
     * Only the frames can hold bevel pixels.
     *
     * The band is `bezel` wide along each edge, so a pane that is 550x44 with
     * an 8px bezel has ~5% of its area in play; looping every pixel of the flat
     * middle ran `edgeField` tens of thousands of times per map for results
     * that were discarded. Two horizontal strips plus two vertical strips cover
     * the whole band, including the rounded corners, with no per-pixel cost in
     * the centre.
     */
    /*
     * The band is measured from the rim inward, and `edgeField` reports the
     * distance of a pixel *centre*. A pixel whose centre sits exactly at
     * `bezel` is excluded, so the scan window has to reach one pixel further
     * than `bezel * scale` or the outermost corner pixel of each band is
     * dropped — a four-pixel hole in the map that shows as a nick in the rim.
     */
    const band = Math.ceil(bezel * scale) + 1;
    const top = 0;
    const bottomLimit = Math.min(rows, band);
    const innerTop = Math.max(top, rows - band);
    const scan = (rowStart: number, rowEnd: number, columnStart: number, columnEnd: number) => {
      for (let row = rowStart; row < rowEnd; row += 1) {
        for (let column = columnStart; column < columnEnd; column += 1) {
          const field = edgeField((column + 0.5) / scale, (row + 0.5) / scale, width, height, radius);
          if (!field || field.distance <= 0 || field.distance >= bezel) continue;
          if (field.nx === 0 && field.ny === 0) continue;
          paint(data, (row * columns + column) * 4, field.nx, field.ny, field.distance / bezel);
        }
      }
    };
    // Top and bottom bands span the full width (corners included).
    scan(top, bottomLimit, 0, columns);
    scan(innerTop, rows, 0, columns);
    // Left and right bands cover the middle rows the corners do not reach.
    const leftLimit = Math.min(columns, band);
    const innerLeft = Math.max(0, columns - band);
    scan(bottomLimit, innerTop, 0, leftLimit);
    scan(bottomLimit, innerTop, innerLeft, columns);
  });
}

/** Red/green channel displacement map consumed by `feDisplacementMap`. */
export function displacementMap(width: number, height: number, radius: number, bezel: number): string {
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
export function specularMap(width: number, height: number, radius: number, bezel: number): string {
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
export function rimShadeMap(width: number, height: number, radius: number, bezel: number): string {
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
export function coreMap(width: number, height: number, radius: number, bezel: number): string {
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


export type LensTuning = { blur: number; scale: number; shade: string; frost: number };

export function filterMarkup(
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

