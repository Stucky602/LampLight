// Pack pixel frames into one sheet (pure; the tests check it). Every frame a ParticleContainer
// draws must share one texture source (ARCHITECTURE §6.2), so the whole atlas goes on one page
// (tools/atlas/build.mjs). A shelf packer is plenty for a few hundred small frames.

/**
 * @param {Array<{id,w,h,rgba}>} frames
 * @param {object} [o]
 * @param {number} [o.width] sheet width in pixels
 * @param {number} [o.pad] transparent pixels between frames (rotated sprites sample their edges)
 * @returns {{ width, height, rects: Map<string,{x,y,w,h}>, rgba: Uint8ClampedArray }}
 */
export function packSheet(frames, { width = 1024, pad = 1 } = {}) {
  const seen = new Set();
  for (const f of frames) {
    if (seen.has(f.id)) throw new Error(`packSheet: two frames are called "${f.id}"`);
    seen.add(f.id);
    if (f.w + pad * 2 > width) throw new Error(`packSheet: frame "${f.id}" (${f.w} px) is wider than the sheet`);
  }
  // Tallest first keeps shelves tight.
  const order = frames.map((f, i) => i).sort((a, b) => frames[b].h - frames[a].h || frames[b].w - frames[a].w || a - b);
  const rects = new Map();
  let x = pad, y = pad, shelf = 0;
  for (const i of order) {
    const f = frames[i];
    if (x + f.w + pad > width) { x = pad; y += shelf + pad; shelf = 0; }
    rects.set(f.id, { x, y, w: f.w, h: f.h });
    x += f.w + pad;
    if (f.h > shelf) shelf = f.h;
  }
  // Height rounded up to a power of two (friendlier to every GPU).
  let height = 1;
  while (height < y + shelf + pad) height *= 2;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (const f of frames) {
    const r = rects.get(f.id);
    for (let row = 0; row < f.h; row++) {
      rgba.set(f.rgba.subarray(row * f.w * 4, (row + 1) * f.w * 4), ((r.y + row) * width + r.x) * 4);
    }
  }
  return { width, height, rects, rgba };
}
