// Pixel frames in plain memory: the building blocks of the atlas (tools/atlas/, art/draw/) and of
// the textures made at boot (render/textures.js). No DOM and no Pixi, so the tests can check every
// frame in Node. A frame is { id, w, h, rgba: Uint8ClampedArray } with straight (not
// premultiplied) alpha.

import { PALETTE } from '../data/palette.js';

/** One letter per palette color, for sprites written as text. '.' and ' ' are transparent. */
export const LEGEND = Object.freeze({
  K: 'night-0', d: 'night-2', n: 'night-3', D: 'night-4', N: 'night-5', p: 'fog-1',
  f: 'fog-2', F: 'fog-3', g: 'fog-4', G: 'fog-5', w: 'white',
  b: 'lamp-1', l: 'lamp-2', L: 'lamp-3', y: 'lamp-4', Y: 'lamp-5', W: 'lamp-6',
  s: 'sea-2', S: 'sea-3', t: 'sea-4', T: 'sea-5', u: 'sea-6',
  r: 'rot-1', R: 'rot-2', o: 'rot-3', O: 'rot-4',
  c: 'gem-1', C: 'gem-2', e: 'gem-3', E: 'gem-4',
  m: 'moss-2', M: 'moss-3', h: 'moss-4',
  v: 'violet-2', V: 'violet-3', x: 'violet-4',
});

const RGB = new Map();
for (const [name, hex] of Object.entries(PALETTE)) {
  const n = parseInt(hex.slice(1), 16);
  RGB.set(name, [(n >> 16) & 255, (n >> 8) & 255, n & 255]);
}

/** [r, g, b] for a palette name. */
export function rgbOf(name) {
  const c = RGB.get(name);
  if (!c) throw new Error(`No palette color "${name}"`);
  return c;
}

export function blank(id, w, h) {
  if (!(Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0)) throw new Error(`frame ${id}: bad size ${w}x${h}`);
  return { id, w, h, rgba: new Uint8ClampedArray(w * h * 4) };
}

export function setPx(f, x, y, name, alpha = 255) {
  if (x < 0 || y < 0 || x >= f.w || y >= f.h) return;
  const [r, g, b] = rgbOf(name);
  const o = (y * f.w + x) * 4;
  f.rgba[o] = r; f.rgba[o + 1] = g; f.rgba[o + 2] = b; f.rgba[o + 3] = alpha;
}

export function alphaAt(f, x, y) {
  if (x < 0 || y < 0 || x >= f.w || y >= f.h) return 0;
  return f.rgba[(y * f.w + x) * 4 + 3];
}

/** A frame from rows of legend letters. Every row must be the same width. */
export function fromText(id, rows) {
  const h = rows.length, w = rows[0].length;
  const f = blank(id, w, h);
  for (let y = 0; y < h; y++) {
    if (rows[y].length !== w) throw new Error(`frame ${id}: row ${y} is ${rows[y].length} wide, expected ${w}`);
    for (let x = 0; x < w; x++) {
      const ch = rows[y][x];
      if (ch === '.' || ch === ' ') continue;
      const name = LEGEND[ch];
      if (!name) throw new Error(`frame ${id}: unknown letter "${ch}" at ${x},${y}`);
      setPx(f, x, y, name);
    }
  }
  return f;
}

/** A frame one pixel larger on every side, with an outline around every opaque pixel. */
export function outlined(f, name = 'night-0', id = f.id) {
  const o = blank(id, f.w + 2, f.h + 2);
  for (let y = 0; y < f.h; y++) {
    for (let x = 0; x < f.w; x++) {
      const i = (y * f.w + x) * 4, j = ((y + 1) * o.w + (x + 1)) * 4;
      for (let k = 0; k < 4; k++) o.rgba[j + k] = f.rgba[i + k];
    }
  }
  const [r, g, b] = rgbOf(name);
  for (let y = 0; y < o.h; y++) {
    for (let x = 0; x < o.w; x++) {
      if (alphaAt(o, x, y) > 0) continue;
      // Edge neighbors only (not diagonals): the classic single-pixel sprite outline. Output
      // pixel (x, y) is source pixel (x - 1, y - 1).
      const near = alphaAt(f, x - 2, y - 1) > 127 || alphaAt(f, x, y - 1) > 127 || alphaAt(f, x - 1, y - 2) > 127 || alphaAt(f, x - 1, y) > 127;
      if (!near) continue;
      const j = (y * o.w + x) * 4;
      o.rgba[j] = r; o.rgba[j + 1] = g; o.rgba[j + 2] = b; o.rgba[j + 3] = 255;
    }
  }
  return o;
}

/** Every opaque pixel in one color: the hit-flash silhouette. Same size, so swapping never jumps. */
export function silhouette(f, id, name = 'white') {
  const o = blank(id, f.w, f.h);
  const [r, g, b] = rgbOf(name);
  for (let i = 0; i < f.w * f.h; i++) {
    const a = f.rgba[i * 4 + 3];
    if (a === 0) continue;
    o.rgba[i * 4] = r; o.rgba[i * 4 + 1] = g; o.rgba[i * 4 + 2] = b; o.rgba[i * 4 + 3] = a;
  }
  return o;
}

/** Nearest-neighbor resize by a factor (the elite variant: bigger, still on the pixel grid). */
export function scaled(f, factor, id) {
  const w = Math.max(1, Math.round(f.w * factor)), h = Math.max(1, Math.round(f.h * factor));
  const o = blank(id, w, h);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(f.h - 1, Math.floor(y / factor));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(f.w - 1, Math.floor(x / factor));
      const i = (sy * f.w + sx) * 4, j = (y * w + x) * 4;
      for (let k = 0; k < 4; k++) o.rgba[j + k] = f.rgba[i + k];
    }
  }
  return o;
}

/** Copy `src` onto `dst` at (dx, dy), skipping transparent pixels. */
export function stamp(dst, src, dx, dy) {
  for (let y = 0; y < src.h; y++) {
    for (let x = 0; x < src.w; x++) {
      const i = (y * src.w + x) * 4;
      if (src.rgba[i + 3] === 0) continue;
      const tx = x + dx, ty = y + dy;
      if (tx < 0 || ty < 0 || tx >= dst.w || ty >= dst.h) continue;
      const j = (ty * dst.w + tx) * 4;
      for (let k = 0; k < 4; k++) dst.rgba[j + k] = src.rgba[i + k];
    }
  }
  return dst;
}

export function fillRect(f, x0, y0, w, h, name, alpha = 255) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) setPx(f, x, y, name, alpha);
}

/** Fill the ellipse centered at (cx, cy) with radii rx, ry (pixel centers inside it). */
export function fillEllipse(f, cx, cy, rx, ry, name, alpha = 255) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1) setPx(f, x, y, name, alpha);
    }
  }
}

/** Does the frame have at least one opaque pixel? */
export function isVisible(f) {
  for (let i = 3; i < f.rgba.length; i += 4) if (f.rgba[i] > 0) return true;
  return false;
}
