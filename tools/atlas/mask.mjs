// One-bit masks for sprites drawn in code (art/draw/). A mask is { w, h, a: Uint8Array of 0/1 };
// tint() in treat.mjs colors it the same way the 1-Bit Pack's sprites are colored, so code-drawn
// sprites share the packs' look (ARCHITECTURE §16.1, §16.5).

export function mask(w, h) {
  if (!(Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0)) throw new Error(`mask: bad size ${w}x${h}`);
  return { w, h, a: new Uint8Array(w * h) };
}

export function maskAt(m, x, y) {
  return x >= 0 && y >= 0 && x < m.w && y < m.h ? m.a[y * m.w + x] : 0;
}

/** Turn a pixel on (v = 1) or off (v = 0); outside the mask is ignored. */
export function put(m, x, y, v = 1) {
  x = Math.round(x); y = Math.round(y);
  if (x >= 0 && y >= 0 && x < m.w && y < m.h) m.a[y * m.w + x] = v;
}

/** A mask from text rows: '#' (or any letter) is on, '.' and ' ' are off. */
export function maskFromRows(rows) {
  const h = rows.length, w = rows[0].length;
  const m = mask(w, h);
  for (let y = 0; y < h; y++) {
    if (rows[y].length !== w) throw new Error(`maskFromRows: row ${y} is ${rows[y].length} wide, expected ${w}`);
    for (let x = 0; x < w; x++) { const c = rows[y][x]; if (c !== '.' && c !== ' ') m.a[y * w + x] = 1; }
  }
  return m;
}

/** A mask of the pixels in `rows` that are exactly `ch` (for multi-layer text art). */
export function maskOfChar(rows, ch) {
  const h = rows.length, w = rows[0].length;
  const m = mask(w, h);
  for (let y = 0; y < h; y++) {
    if (rows[y].length !== w) throw new Error(`maskOfChar: row ${y} is ${rows[y].length} wide, expected ${w}`);
    for (let x = 0; x < w; x++) if (rows[y][x] === ch) m.a[y * w + x] = 1;
  }
  return m;
}

export function rect(m, x0, y0, w, h, v = 1) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) put(m, x, y, v);
}

/** Fill the ellipse centered at (cx, cy) with radii rx, ry (pixel centers inside it). */
export function ellipse(m, cx, cy, rx, ry, v = 1) {
  for (let y = Math.floor(cy - ry) - 1; y <= Math.ceil(cy + ry) + 1; y++) {
    for (let x = Math.floor(cx - rx) - 1; x <= Math.ceil(cx + rx) + 1; x++) {
      const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1) put(m, x, y, v);
    }
  }
}

/** A one-pixel line (Bresenham). */
export function line(m, x0, y0, x1, y1, v = 1) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    put(m, x0, y0, v);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

/** Fill a polygon given as [x0, y0, x1, y1, ...] (pixel centers inside it, even-odd rule). */
export function poly(m, pts, v = 1) {
  const n = pts.length / 2;
  let minY = Infinity, maxY = -Infinity;
  for (let k = 0; k < n; k++) { minY = Math.min(minY, pts[2 * k + 1]); maxY = Math.max(maxY, pts[2 * k + 1]); }
  for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
    const cy = y + 0.5, xs = [];
    for (let k = 0; k < n; k++) {
      const ax = pts[2 * k], ay = pts[2 * k + 1], bx = pts[(2 * k + 2) % (2 * n)], by = pts[(2 * k + 3) % (2 * n)];
      if ((ay <= cy && by > cy) || (by <= cy && ay > cy)) xs.push(ax + ((cy - ay) / (by - ay)) * (bx - ax));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.ceil(xs[k] - 0.5); x <= Math.floor(xs[k + 1] - 0.5); x++) put(m, x, y, v);
  }
}

/** Every pixel on in `b` turns on in `a` (same size). */
export function union(a, b) {
  if (a.w !== b.w || a.h !== b.h) throw new Error('union: masks differ in size');
  for (let i = 0; i < a.a.length; i++) if (b.a[i]) a.a[i] = 1;
  return a;
}

/** Every pixel on in `b` turns off in `a`. */
export function subtract(a, b) {
  if (a.w !== b.w || a.h !== b.h) throw new Error('subtract: masks differ in size');
  for (let i = 0; i < a.a.length; i++) if (b.a[i]) a.a[i] = 0;
  return a;
}

/** A copy of `a` restricted to where `b` is on. */
export function intersect(a, b) {
  if (a.w !== b.w || a.h !== b.h) throw new Error('intersect: masks differ in size');
  const o = mask(a.w, a.h);
  for (let i = 0; i < a.a.length; i++) o.a[i] = a.a[i] && b.a[i] ? 1 : 0;
  return o;
}

export function copyMask(m) {
  const o = mask(m.w, m.h);
  o.a.set(m.a);
  return o;
}

/** Mirror left to right. */
export function flipMask(m) {
  const o = mask(m.w, m.h);
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) o.a[y * m.w + x] = m.a[y * m.w + (m.w - 1 - x)];
  return o;
}

/** Place `src` onto a (w x h) mask at (dx, dy). */
export function placed(src, w, h, dx, dy) {
  const o = mask(w, h);
  for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) if (src.a[y * src.w + x]) put(o, x + dx, y + dy);
  return o;
}

/** How many pixels are on. */
export function count(m) {
  let n = 0;
  for (let i = 0; i < m.a.length; i++) n += m.a[i];
  return n;
}
