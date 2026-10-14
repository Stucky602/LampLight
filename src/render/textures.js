// The two textures made at boot rather than taken from the atlas: the soft round light the light
// map is drawn with, and the tileable noise the fog drifts with. Both are smooth gradients (the
// atlas is crisp pixel art), and both are small. Pure: frames in memory, tested in Node.

import { blank } from './pixels.js';
import { createRng } from '../lib/rng.js';

/** How bright a soft light is at `d` of its radius (0 the middle, 1 the rim): bright middle, soft edge, 0 at the rim. */
export function glowAt(d) {
  return d >= 1 ? 0 : (1 - d * d) * (1 - d * d);
}

/** A soft round light: white, alpha falling off from the middle (for the light map). */
export function glowFrame(size = 64) {
  const f = blank('glow', size, size);
  const r = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.sqrt((x + 0.5 - r) ** 2 + (y + 0.5 - r) ** 2) / r;
      if (d >= 1) continue;
      const a = glowAt(d);
      const o = (y * size + x) * 4;
      f.rgba[o] = 255; f.rgba[o + 1] = 255; f.rgba[o + 2] = 255; f.rgba[o + 3] = Math.round(255 * a);
    }
  }
  return f;
}

/** Tileable value noise for the fog (white, the noise in alpha). */
export function fogFrame(size = 128, seed = 'fog') {
  const rng = createRng(seed);
  const cells = 8, lattice = [];
  for (let i = 0; i < cells * cells; i++) lattice.push(rng.next());
  const at = (x, y) => lattice[((y % cells + cells) % cells) * cells + ((x % cells + cells) % cells)];
  const smooth = (t) => t * t * (3 - 2 * t);
  const octave = (x, y, scale) => {
    const fx = (x / size) * cells * scale, fy = (y / size) * cells * scale;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = smooth(fx - x0), ty = smooth(fy - y0);
    // The lattice wraps every `cells` points, so both octaves repeat exactly across the texture.
    const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx;
    const bot = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
    return top + (bot - top) * ty;
  };
  const f = blank('fog', size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = octave(x, y, 1) * 0.65 + octave(x, y, 2) * 0.35;
      const o = (y * size + x) * 4;
      f.rgba[o] = 255; f.rgba[o + 1] = 255; f.rgba[o + 2] = 255; f.rgba[o + 3] = Math.round(255 * Math.min(1, Math.max(0, v)));
    }
  }
  return f;
}
