// What the atlas builder does to a sprite (ARCHITECTURE §16.3). Pure functions on pixel frames
// ({ id, w, h, rgba }, see src/render/pixels.js) and masks ({ w, h, a: Uint8Array of 0/1}), so
// the gate can test them without the art packs.
//
//   tint      a one-color sprite (the 1-Bit Pack, or a mask drawn in code) in a palette ramp:
//             light on the top and left edges, shade on the bottom and right, enclosed holes
//             (eyes, mouths) filled dark so they read as features, then a one-pixel outline
//   remap     a full-color sprite (Tiny Dungeon, Tiny Town) into the palette: listed colors go
//             where the entry says, anything else to the nearest palette color in OKLab
//   flash     the white silhouette for the hit flash, same size so swapping never jumps
//   elite     twice the size on the pixel grid, with a dark line and a gold one around it
//   framed    an icon: the picture on a dark square with a border in its tag's color

import { blank, setPx, alphaAt, outlined, silhouette, scaled, stamp } from '../../src/render/pixels.js';
import { nearestPalette } from './color.mjs';
import { mask, maskAt } from './mask.mjs';

// ---------------------------------------------------------------- masks

/** A mask from a frame's opaque pixels. */
export function maskOf(f) {
  const m = mask(f.w, f.h);
  for (let i = 0; i < f.w * f.h; i++) m.a[i] = f.rgba[i * 4 + 3] > 127 ? 1 : 0;
  return m;
}

/**
 * Transparent pixels that can't reach the edge of the mask through other transparent pixels
 * (four-way): the holes inside a silhouette, like eyes and mouths.
 */
export function enclosedHoles(m) {
  const out = new Uint8Array(m.w * m.h);
  const seen = new Uint8Array(m.w * m.h);
  const stack = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= m.w || y >= m.h) return;
    const i = y * m.w + x;
    if (seen[i] || m.a[i]) return;
    seen[i] = 1; stack.push(i);
  };
  for (let x = 0; x < m.w; x++) { push(x, 0); push(x, m.h - 1); }
  for (let y = 0; y < m.h; y++) { push(0, y); push(m.w - 1, y); }
  while (stack.length) {
    const i = stack.pop(), x = i % m.w, y = (i / m.w) | 0;
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }
  for (let i = 0; i < out.length; i++) out[i] = !m.a[i] && !seen[i] ? 1 : 0;
  return out;
}

/** Trim empty rows and columns: a new mask just big enough for the pixels that are on. */
export function cropMask(m) {
  let x0 = m.w, y0 = m.h, x1 = -1, y1 = -1;
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (m.a[y * m.w + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) throw new Error('cropMask: the mask is empty');
  const o = mask(x1 - x0 + 1, y1 - y0 + 1);
  for (let y = 0; y < o.h; y++) for (let x = 0; x < o.w; x++) o.a[y * o.w + x] = m.a[(y + y0) * m.w + (x + x0)];
  return o;
}

// ---------------------------------------------------------------- tint (one-color sprites)

/**
 * @typedef {object} Ramp
 * @property {string} body   most of the sprite
 * @property {string} light  top and left edges
 * @property {string} shade  bottom and right edges
 * @property {string} [hole] enclosed holes (default: 'night-1'; null leaves them see-through)
 * @property {string} [outline] default 'night-0'; null for none
 */

/**
 * Color a one-color sprite with a ramp. Lit from the top left, like the rest of the art.
 * @param {{w,h,a}} m the mask
 * @param {Ramp} ramp
 * @param {string} id the frame id
 * @param {{ shade?: boolean }} [o] shade: false paints the whole body one color
 */
export function tint(m, ramp, id, { shade = true } = {}) {
  for (const k of ['body', 'light', 'shade']) if (!ramp[k]) throw new Error(`tint ${id}: the ramp needs "${k}"`);
  const holes = ramp.hole === null ? null : enclosedHoles(m);
  const f = blank(id, m.w, m.h);
  const empty = (x, y) => !maskAt(m, x, y);
  for (let y = 0; y < m.h; y++) {
    for (let x = 0; x < m.w; x++) {
      const i = y * m.w + x;
      if (m.a[i]) {
        let c = ramp.body;
        if (shade) {
          if (empty(x, y - 1) || empty(x - 1, y)) c = ramp.light;
          else if (empty(x, y + 1) || empty(x + 1, y)) c = ramp.shade;
        }
        setPx(f, x, y, c);
      } else if (holes && holes[i]) setPx(f, x, y, ramp.hole || 'night-1');
    }
  }
  const outline = ramp.outline === undefined ? 'night-0' : ramp.outline;
  return outline ? outlined(f, outline, id) : f;
}

/**
 * Several masks, each in its own ramp, painted in order onto one frame of the first mask's size,
 * then outlined as one shape (the bosses' parts: hide, teeth, eyes).
 */
export function tintLayers(layers, id, { outline = 'night-0' } = {}) {
  if (!layers.length) throw new Error(`tintLayers ${id}: no layers`);
  const { w, h } = layers[0].mask;
  const f = blank(id, w, h);
  for (const L of layers) {
    if (L.mask.w !== w || L.mask.h !== h) throw new Error(`tintLayers ${id}: every layer must be ${w}x${h}`);
    const t = tint(L.mask, { ...L.ramp, outline: null, hole: L.ramp.hole === undefined ? null : L.ramp.hole }, id, { shade: L.shade !== false });
    stamp(f, t, 0, 0);
  }
  return outline ? outlined(f, outline, id) : f;
}

// ---------------------------------------------------------------- remap (full-color sprites)

function hex2(r, g, b) {
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

/**
 * Remap a full-color sprite into the palette.
 * @param {{w,h,rgba}} src
 * @param {Record<string,string>} colors '#rrggbb' (lowercase) -> palette name; others go to the
 *   nearest palette color
 * @param {string} id
 * @param {{ among?: string[], strict?: boolean }} [o] among: the palette names the automatic
 *   match may use; strict: every source color must be listed (throws on a surprise)
 * @returns {{ frame, used: Map<string,string> }} used: which palette name each source color got
 */
export function remap(src, colors, id, { among = null, strict = false } = {}) {
  const f = blank(id, src.w, src.h);
  const used = new Map();
  for (let i = 0; i < src.w * src.h; i++) {
    const o = i * 4;
    if (src.rgba[o + 3] < 128) continue;
    const key = hex2(src.rgba[o], src.rgba[o + 1], src.rgba[o + 2]);
    let name = colors[key];
    if (!name) {
      if (strict) throw new Error(`remap ${id}: color ${key} has no entry (strict)`);
      name = nearestPalette(src.rgba[o], src.rgba[o + 1], src.rgba[o + 2], among);
    }
    used.set(key, name);
    setPx(f, i % src.w, (i / src.w) | 0, name);
  }
  return { frame: f, used };
}

// ---------------------------------------------------------------- variants

export function flash(f) {
  return silhouette(f, `${f.id}#flash`);
}

/**
 * The elite version: the sprite without its outline, doubled (pixels stay square), then a dark
 * line and a gold one around it. `inner` is the un-outlined frame.
 */
export function elite(inner, id, { scale = 2, line = 'night-0', gold = 'lamp-4' } = {}) {
  const big = scaled(inner, scale, id);
  return outlined(outlined(big, line, id), gold, id);
}

/** Remove a one-pixel outline added by tint(): the inner frame (w - 2, h - 2). */
export function unoutline(f, id = f.id) {
  const o = blank(id, f.w - 2, f.h - 2);
  for (let y = 0; y < o.h; y++) for (let x = 0; x < o.w; x++) {
    const i = ((y + 1) * f.w + (x + 1)) * 4, j = (y * o.w + x) * 4;
    for (let k = 0; k < 4; k++) o.rgba[j + k] = f.rgba[i + k];
  }
  return o;
}

/** An icon: `pic` centered on a (size x size) dark square with a one-pixel border. */
export function framed(pic, id, border, { size = 18, fill = 'night-2' } = {}) {
  if (pic.w > size - 2 || pic.h > size - 2) throw new Error(`framed ${id}: the picture (${pic.w}x${pic.h}) doesn't fit inside ${size - 2}x${size - 2}`);
  const f = blank(id, size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) setPx(f, x, y, x === 0 || y === 0 || x === size - 1 || y === size - 1 ? border : fill);
  stamp(f, pic, 1 + Math.floor((size - 2 - pic.w) / 2), 1 + Math.floor((size - 2 - pic.h) / 2));
  return f;
}

/** Pad a frame to (w, h), keeping it centered (odd leftovers go right and down). */
export function padTo(f, w, h, id = f.id) {
  if (w < f.w || h < f.h) throw new Error(`padTo ${id}: ${f.w}x${f.h} doesn't fit in ${w}x${h}`);
  const o = blank(id, w, h);
  stamp(o, f, Math.floor((w - f.w) / 2), Math.floor((h - f.h) / 2));
  return o;
}

/** A frame's opaque pixels as a mask, trimmed; plus the offset of the trimmed box. */
export function opaqueBox(f) {
  let x0 = f.w, y0 = f.h, x1 = -1, y1 = -1;
  for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) if (alphaAt(f, x, y) > 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Copy a sub-rectangle of a frame. */
export function cropFrame(f, box, id = f.id) {
  const o = blank(id, box.w, box.h);
  for (let y = 0; y < box.h; y++) for (let x = 0; x < box.w; x++) {
    const i = ((y + box.y) * f.w + (x + box.x)) * 4, j = (y * box.w + x) * 4;
    for (let k = 0; k < 4; k++) o.rgba[j + k] = f.rgba[i + k];
  }
  return o;
}

