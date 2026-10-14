// Color math for the atlas builder: sRGB to OKLab, and the nearest palette color in OKLab
// (ARCHITECTURE §16.3). OKLab distances track how different two colors look far better than RGB
// distances do, so an automatic remap picks the palette color a person would pick.

import { PALETTE } from '../../src/data/palette.js';

function lin(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** [L, a, b] for an sRGB color given as 0..255 channels. */
export function oklab(r, g, b) {
  const R = lin(r), G = lin(g), B = lin(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}

export function hexRgb(hex) {
  const n = parseInt(String(hex).slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Relative luminance (WCAG), 0..1. */
export function luminance(r, g, b) {
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two luminances (1 to 21). */
export function contrastRatio(l1, l2) {
  const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

const LAB = new Map(Object.entries(PALETTE).map(([name, hex]) => [name, oklab(...hexRgb(hex))]));

/**
 * The palette color nearest to (r, g, b) in OKLab.
 * @param {string[]} [among] palette names to choose from (default: the whole palette)
 */
export function nearestPalette(r, g, b, among = null) {
  const [L, A, B] = oklab(r, g, b);
  let best = null, bestD = Infinity;
  for (const name of among || LAB.keys()) {
    const c = LAB.get(name);
    if (!c) throw new Error(`nearestPalette: no palette color "${name}"`);
    const d = (c[0] - L) ** 2 + (c[1] - A) ** 2 + (c[2] - B) ** 2;
    if (d < bestD) { bestD = d; best = name; }
  }
  return best;
}
