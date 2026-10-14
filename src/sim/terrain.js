// The map's walkable ground: a tile grid of solid and open tiles, plus circle collision.
//
// Maps are bounded (builder's call 9: about 256 x 256 tiles, with a fog wall at the edge). The
// edge is solid for everything; obstacles inside (crates, broken walls, water) come from the
// map's layout in data. Enemies path around obstacles with the flow field (flowfield.js).

import { createRng } from '../lib/rng.js';

export const TILE = 16;

/**
 * @param {object} o
 * @param {number} o.cols tiles across
 * @param {number} o.rows tiles down
 * @param {Uint8Array} [o.solid] 1 = blocked, row-major; all open if omitted
 */
export function createTerrain({ cols, rows, solid = null }) {
  if (!(cols > 0 && rows > 0)) throw new Error('createTerrain: cols and rows must be positive');
  const grid = solid || new Uint8Array(cols * rows);
  if (grid.length !== cols * rows) throw new Error('createTerrain: solid grid size does not match cols x rows');
  const width = cols * TILE, height = rows * TILE;
  const tmp = new Float64Array(3);
  let solidCount = 0;
  for (let i = 0; i < grid.length; i++) if (grid[i]) solidCount++;
  // Summed-area table of solid tiles: "any obstacle in this rectangle?" in constant time.
  const sat = new Int32Array((cols + 1) * (rows + 1));
  for (let y = 0; y < rows; y++) {
    let rowSum = 0;
    for (let x = 0; x < cols; x++) {
      rowSum += grid[y * cols + x];
      sat[(y + 1) * (cols + 1) + (x + 1)] = sat[y * (cols + 1) + (x + 1)] + rowSum;
    }
  }

  const t = {
    cols, rows, width, height, tile: TILE,
    solid: grid,
    get solidCount() { return solidCount; },

    /** Solid tile, or outside the map (the fog wall). */
    blocked(tx, ty) {
      if (tx < 0 || ty < 0 || tx >= cols || ty >= rows) return true;
      return grid[ty * cols + tx] === 1;
    },

    blockedAt(px, py) {
      return t.blocked(Math.floor(px / TILE), Math.floor(py / TILE));
    },

    /** Number of solid tiles in the tile rectangle [tx0, tx1] x [ty0, ty1] (clipped to the map). */
    solidIn(tx0, ty0, tx1, ty1) {
      const x0 = tx0 < 0 ? 0 : tx0, y0 = ty0 < 0 ? 0 : ty0;
      const x1 = tx1 >= cols ? cols - 1 : tx1, y1 = ty1 >= rows ? rows - 1 : ty1;
      if (x1 < x0 || y1 < y0) return 0;
      const W = cols + 1;
      return sat[(y1 + 1) * W + (x1 + 1)] - sat[y0 * W + (x1 + 1)] - sat[(y1 + 1) * W + x0] + sat[y0 * W + x0];
    },

    /**
     * Push a circle out of solid tiles and inside the map. Writes the corrected center to
     * out[0], out[1] and returns true if it moved. Handles circles up to several tiles wide.
     * (Convenience; hot loops use collideR.)
     */
    collide(x, y, r, out) {
      tmp[0] = x; tmp[1] = y; tmp[2] = r;
      const moved = t.collideR(tmp);
      out[0] = tmp[0]; out[1] = tmp[1];
      return moved;
    },

    /** collide() in place on a register: reg[0], reg[1] = center (updated), reg[2] = radius. */
    collideR(reg) {
      const x = reg[0], y = reg[1];
      pushOut(reg);
      // A push out of one tile can land the circle in another it already checked (a narrow
      // gap between blocks): one more pass settles it.
      if ((reg[0] !== x || reg[1] !== y) && solidCount > 0) pushOut(reg);
      return reg[0] !== x || reg[1] !== y;
    },
  };

  /** One pass of collideR: out of every solid tile it overlaps, and inside the map. */
  function pushOut(reg) {
      const x = reg[0], y = reg[1], r = reg[2];
      let nx = x, ny = y;
      // The fog wall at the map edge.
      if (nx < r) nx = r; else if (nx > width - r) nx = width - r;
      if (ny < r) ny = r; else if (ny > height - r) ny = height - r;
      if (solidCount > 0) {
        const tx0 = Math.floor((nx - r) / TILE), tx1 = Math.floor((nx + r) / TILE);
        const ty0 = Math.floor((ny - r) / TILE), ty1 = Math.floor((ny + r) / TILE);
        for (let ty = ty0; ty <= ty1; ty++) {
          if (ty < 0 || ty >= rows) continue;
          for (let tx = tx0; tx <= tx1; tx++) {
            if (tx < 0 || tx >= cols || grid[ty * cols + tx] !== 1) continue;
            const left = tx * TILE, top = ty * TILE, right = left + TILE, bottom = top + TILE;
            // Closest point on the tile to the circle's center.
            const qx = nx < left ? left : nx > right ? right : nx;
            const qy = ny < top ? top : ny > bottom ? bottom : ny;
            let dx = nx - qx, dy = ny - qy;
            // A corner shared with a solid neighbor is inside a flat wall, not a real corner:
            // push straight off the face instead, so things slide along walls without drifting.
            if (dx !== 0 && dy !== 0) {
              if (t.blocked(tx + (dx > 0 ? 1 : -1), ty)) dx = 0;
              else if (t.blocked(tx, ty + (dy > 0 ? 1 : -1))) dy = 0;
            }
            const d2 = dx * dx + dy * dy;
            if (d2 >= r * r) continue;
            if (d2 > 0) {
              const d = Math.sqrt(d2), push = r - d;
              nx += (dx / d) * push;
              ny += (dy / d) * push;
            } else {
              // Center inside the tile: leave by the nearest open side.
              const outL = nx - left + r, outR = right - nx + r, outT = ny - top + r, outB = bottom - ny + r;
              let best = outL, dir = 0;
              if (outR < best && !t.blocked(tx + 1, ty)) { best = outR; dir = 1; }
              if (outT < best && !t.blocked(tx, ty - 1)) { best = outT; dir = 2; }
              if (outB < best && !t.blocked(tx, ty + 1)) { best = outB; dir = 3; }
              if (dir === 0) nx -= outL; else if (dir === 1) nx += outR; else if (dir === 2) ny -= outT; else ny += outB;
            }
          }
        }
        if (nx < r) nx = r; else if (nx > width - r) nx = width - r;
        if (ny < r) ny = r; else if (ny > height - r) ny = height - r;
      }
      reg[0] = nx; reg[1] = ny;
  }
  return t;
}

/**
 * Build a map's solid grid from its layout in data. Deterministic: the same layout always gives
 * the same grid (its own seed, never the run's).
 * Layout kinds:
 *   open:    no obstacles
 *   rects:   hand-placed blocks { rects: [[x, y, w, h], ...] } in tiles
 *   scatter: rectangular clusters (crates, rubble) placed at random, kept clear of the start
 *            area; { seed, clusters, size: [min, max] tiles, clearRadius: tiles }
 */
export function buildLayout(layout, cols, rows) {
  const solid = new Uint8Array(cols * rows);
  if (!layout || layout.kind === 'open') return solid;
  if (layout.kind === 'rects') {
    // Hand-placed blocks: [x, y, w, h] in tiles (authored maps, tests).
    for (const [x0, y0, w, h] of layout.rects || []) {
      for (let y = Math.max(0, y0); y < Math.min(rows, y0 + h); y++) {
        for (let x = Math.max(0, x0); x < Math.min(cols, x0 + w); x++) solid[y * cols + x] = 1;
      }
    }
    return solid;
  }
  if (layout.kind !== 'scatter') throw new Error(`Unknown map layout kind: ${layout.kind}`);
  const rng = createRng(`layout:${layout.seed}`);
  const [minS, maxS] = layout.size || [1, 3];
  if (cols < maxS + 6 || rows < maxS + 6) throw new Error(`Map layout "scatter" needs a map at least ${maxS + 6} tiles on each side (this one is ${cols} x ${rows})`);
  const clear = layout.clearRadius ?? 12;
  const midX = cols / 2, midY = rows / 2;
  for (let k = 0; k < (layout.clusters || 0); k++) {
    const w = minS + rng.int(maxS - minS + 1);
    const h = minS + rng.int(maxS - minS + 1);
    const x0 = 2 + rng.int(cols - w - 4);
    const y0 = 2 + rng.int(rows - h - 4);
    // Keep the start area open.
    const cxT = x0 + w / 2, cyT = y0 + h / 2;
    if ((cxT - midX) * (cxT - midX) + (cyT - midY) * (cyT - midY) < clear * clear) continue;
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) solid[y * cols + x] = 1;
  }
  return solid;
}
