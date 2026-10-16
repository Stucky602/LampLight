// The map's walkable ground: a tile grid of solid and open tiles, plus circle collision.
//
// Maps are bounded (builder's call 9: about 256 x 256 tiles, with a fog wall at the edge). The
// edge is solid for everything; obstacles inside (crates, broken walls, water) come from the
// map's layout in data. Enemies path around obstacles with the flow field (flowfield.js).

import { createRng } from '../lib/rng.js';

export const TILE = 16;

/**
 * What each tile is, for the run view (terrain.kinds). The sim only knows solid or open; these
 * say how a tile looks. Solid: CRATE, WATER, SHED_ROOF, SHED_WALL, WRECK. Open: the rest.
 */
export const GROUND = Object.freeze({ FLOOR: 0, CRATE: 1, WATER: 2, SHED_ROOF: 3, SHED_WALL: 4, WRECK: 5, BRIDGE: 6, DECK: 7, SHED_DOOR: 8 });
/** Which kinds block, by name (every kind must say; a new kind left out fails at load). */
const SOLID_BY_NAME = Object.freeze({ FLOOR: 0, CRATE: 1, WATER: 1, SHED_ROOF: 1, SHED_WALL: 1, WRECK: 1, BRIDGE: 0, DECK: 0, SHED_DOOR: 1 });
const SOLID_KIND = new Uint8Array(Object.keys(GROUND).length);
for (const [name, k] of Object.entries(GROUND)) {
  if (SOLID_BY_NAME[name] === undefined) throw new Error(`terrain: GROUND.${name} doesn't say whether it blocks`);
  SOLID_KIND[k] = SOLID_BY_NAME[name];
}

/**
 * @param {object} o
 * @param {number} o.cols tiles across
 * @param {number} o.rows tiles down
 * @param {Uint8Array} [o.solid] 1 = blocked, row-major; all open if omitted
 * @param {Uint8Array} [o.kinds] GROUND per tile (how it looks); null draws solid as crates
 */
export function createTerrain({ cols, rows, solid = null, kinds = null }) {
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
    kinds,
    get solidCount() { return solidCount; },

    /** Solid tile, or outside the map (the fog wall). */
    blocked(tx, ty) {
      if (tx < 0 || ty < 0 || tx >= cols || ty >= rows) return true;
      return grid[ty * cols + tx] === 1;
    },

    blockedAt(px, py) {
      return t.blocked(Math.floor(px / TILE), Math.floor(py / TILE));
    },

    /**
     * The middle of the open tile nearest tile (tx, ty) (straight-line distance; the first in scan
     * order on a tie, so the same map always picks the same tile), written to out[0], out[1] in px.
     * Rings out from the tile; once one is found at ring r, nothing beyond ring r * 1.42 can be
     * nearer. Returns false when none is within `reach` rings.
     */
    nearestOpen(tx, ty, out, reach = 64) {
      let best = -1, bx = 0, by = 0, last = reach - 1;
      for (let r = 0; r <= last; r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || t.blocked(tx + dx, ty + dy)) continue;
            const d = dx * dx + dy * dy;
            if (best >= 0 && d >= best) continue;
            best = d; bx = tx + dx; by = ty + dy;
          }
        }
        if (best >= 0 && last > Math.ceil(r * 1.42)) last = Math.ceil(r * 1.42);
      }
      if (best < 0) return false;
      out[0] = (bx + 0.5) * TILE; out[1] = (by + 0.5) * TILE;
      return true;
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
 * Build a map's ground from its layout in data: { solid, kinds } (kinds is null for layouts
 * that are only crates). Deterministic: the same layout always gives the same ground (its own
 * seed, never the run's). Layout kinds:
 *   open:    no obstacles
 *   rects:   hand-placed blocks { rects: [[x, y, w, h], ...] } in tiles
 *   scatter: rectangular clusters (crates, rubble) placed at random, kept clear of the start
 *            area; { seed, clusters, size: [min, max] tiles, clearRadius: tiles }
 *   docks:   a harbor front (buildDocks below)
 */
export function buildMap(layout, cols, rows) {
  if (layout && layout.kind === 'docks') {
    // The docks take tens of milliseconds to build, and the same layout always builds the same
    // ground, so the last few are kept (copies handed out: a world owns its arrays).
    const key = `${JSON.stringify(layout)}|${cols}x${rows}`;
    let g = DOCKS_CACHE.get(key);
    if (!g) {
      g = buildDocks(layout, cols, rows);
      DOCKS_CACHE.set(key, g);
      if (DOCKS_CACHE.size > 4) DOCKS_CACHE.delete(DOCKS_CACHE.keys().next().value);
    }
    return { solid: g.solid.slice(), kinds: g.kinds.slice() };
  }
  return { solid: buildLayout(layout, cols, rows), kinds: null };
}
const DOCKS_CACHE = new Map();
/** Forget the built docks (tests, to build one from scratch). */
export function clearGroundCache() { DOCKS_CACHE.clear(); }

/** A layout's solid grid alone (1 = blocked). */
export function buildLayout(layout, cols, rows) {
  if (layout && layout.kind === 'docks') return buildMap(layout, cols, rows).solid;
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

/** A docks layout's data, checked: a plain message for the first thing wrong, or null. */
export function checkDocks(L, cols, rows) {
  const dims = (v) => Array.isArray(v) && v.length === 2 && v.every(Number.isInteger) && v[0] >= 1 && v[1] >= 1;
  const pair = (v) => dims(v) && v[1] >= v[0]; // a [min, max] range
  const whole = (v, min = 0) => Number.isInteger(v) && v >= min;
  if (typeof L.seed !== 'string' || !L.seed) return 'needs a seed';
  if (L.clearRadius !== undefined && !(Number.isFinite(L.clearRadius) && L.clearRadius >= 0)) return 'clearRadius must be a number of tiles, 0 or more';
  if (!(cols >= 64 && rows >= 64)) return `needs a map at least 64 tiles on each side (this one is ${cols} x ${rows})`;
  const S = L.slips, H = L.sheds, C = L.crates, W = L.wreck;
  if (!S || !whole(S.count) || !whole(S.width, 2) || !pair(S.length) || !whole(S.apart, 1) || !whole(S.bridgeOver, 1) || !whole(S.bridge, 1) || S.bridge >= S.length[0]) {
    return 'slips need a whole count, a width of 2 or more, a length [min, max], apart and bridgeOver of 1 or more, and a bridge shorter than the shortest slip';
  }
  if (!H || !whole(H.count) || !dims(H.size) || H.size[0] < 3 || H.size[1] < 2) return 'sheds need a whole count and a size [w, h] of at least 3 x 2';
  if (!C || !whole(C.count) || !pair(C.size)) return 'crates need a whole count and a size [min, max]';
  if (W !== undefined && !(W && Array.isArray(W.at) && W.at.length === 2 && W.at.every(Number.isInteger) && dims(W.size) && W.size[0] >= 8 && W.size[1] >= 5)) return 'the wreck needs a tile `at` and a size [w, h] of at least 8 x 5';
  return null;
}

/**
 * The Drowned Docks: a wharf cut by flooded slips, with sheds, crates, and a wreck.
 *   slips:  `count` basins of water running north to south, `width` tiles wide (2 or more) and
 *           `length` [min, max] tiles long, `apart` tiles of open wharf all round each; one
 *           longer than `bridgeOver` has a footbridge `bridge` tiles tall across its middle
 *   sheds:  `count` buildings of `size` [w, h] tiles (either way round), on the wharf, kept off
 *           the water's edge and each other; the bottom row is the wall (one door in it), the
 *           rest roof. Slips and sheds must all fit: a layout that can't place them all throws
 *   crates: up to `count` clusters of `size` [min, max] tiles, off every edge (lanes by the water and
 *           at the bridges stay open)
 *   wreck:  { at: [col, row], size: [w, h] } a hull beached on the wharf, bow to the east (its
 *           sides close in to a point over the last third), stern square, open to the south (a
 *           gap 2 tiles wide amidships), its deck open inside; the ground around it kept clear
 *   clearRadius: tiles around the start (the middle) kept free of sheds and crates
 * Any open pocket a walker can't reach from the start is filled with crates, so every open tile
 * is reachable (enemies spawn on open ground, and the player can reach anywhere they can).
 */
function buildDocks(L, cols, rows) {
  const bad = checkDocks(L, cols, rows);
  if (bad) throw new Error(`Map layout "docks": ${bad}`);
  const K = GROUND;
  const kinds = new Uint8Array(cols * rows);
  const rng = createRng(`layout:${L.seed}`);
  const midX = Math.floor(cols / 2), midY = Math.floor(rows / 2);
  const clear = L.clearRadius ?? 12;
  const at = (x, y) => y * cols + x;
  const inside = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows;
  // The wreck's ground: its hull and a margin around it stay off-limits to everything else.
  const W = L.wreck || null;
  let wx0 = -1, wy0 = -1, wx1 = -1, wy1 = -1;
  if (W) {
    const [w, h] = W.size;
    wx0 = W.at[0] - Math.floor(w / 2); wy0 = W.at[1] - Math.floor(h / 2);
    wx1 = wx0 + w - 1; wy1 = wy0 + h - 1;
    if (wx0 < 6 || wy0 < 6 || wx1 >= cols - 6 || wy1 >= rows - 6) throw new Error('Map layout "docks": the wreck must sit at least 6 tiles inside the map');
  }
  const M = 4;
  const nearWreck = (x, y) => W && x >= wx0 - M && x <= wx1 + M && y >= wy0 - M && y <= wy1 + M;

  const nearStart = (x, y, r) => (x - midX) * (x - midX) + (y - midY) * (y - midY) < r * r;
  // Is the rectangle (plus a margin) all plain wharf, away from the start and the wreck?
  const freeRect = (x0, y0, w, h, m, r) => {
    for (let y = y0 - m; y < y0 + h + m; y++) {
      for (let x = x0 - m; x < x0 + w + m; x++) {
        if (!inside(x, y) || x < 2 || y < 2 || x >= cols - 2 || y >= rows - 2) return false;
        if (kinds[at(x, y)] !== K.FLOOR || nearWreck(x, y)) return false;
      }
    }
    const cx = x0 + w / 2, cy = y0 + h / 2;
    return !nearStart(cx, cy, r);
  };

  // Slips: basins of harbor water running north to south, a footbridge across the middle of
  // the long ones. They sit apart (open wharf all round each), so the wharf stays one open
  // ground with water in it, never a set of lanes between channels.
  const S = L.slips;
  let slipsMade = 0;
  for (let tries = 0; slipsMade < S.count && tries < S.count * 30; tries++) {
    const len = S.length[0] + rng.int(S.length[1] - S.length[0] + 1);
    const x0 = 3 + rng.int(cols - S.width - 6), y0 = 3 + rng.int(rows - len - 6);
    if (!freeRect(x0, y0, S.width, len, S.apart, clear + 6)) continue;
    const mid = y0 + Math.floor(len / 2) - Math.floor(S.bridge / 2);
    const bridged = len > S.bridgeOver;
    for (let y = y0; y < y0 + len; y++) {
      const b = bridged && y >= mid && y < mid + S.bridge;
      for (let x = x0; x < x0 + S.width; x++) kinds[at(x, y)] = b ? K.BRIDGE : K.WATER;
    }
    slipsMade++;
  }
  if (slipsMade < S.count) throw new Error(`Map layout "docks": only ${slipsMade} of ${S.count} slips fit (fewer slips, or shorter)`);

  // Sheds.
  const H = L.sheds;
  let shedsMade = 0;
  for (let tries = 0; shedsMade < H.count && tries < H.count * 20; tries++) {
    const turn = rng.chance(0.5);
    const w = turn ? H.size[1] : H.size[0], h = turn ? H.size[0] : H.size[1];
    const x0 = 2 + rng.int(cols - w - 4), y0 = 2 + rng.int(rows - h - 4);
    if (!freeRect(x0, y0, w, h, 2, clear + 4)) continue;
    const door = x0 + 1 + rng.int(w - 2); // one door, off the corners
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) kinds[at(x, y)] = y < y0 + h - 1 ? K.SHED_ROOF : x === door ? K.SHED_DOOR : K.SHED_WALL;
    }
    shedsMade++;
  }
  if (shedsMade < H.count) throw new Error(`Map layout "docks": only ${shedsMade} of ${H.count} sheds fit (fewer sheds, or a smaller clear radius)`);

  // Crates.
  const C = L.crates;
  const [minS, maxS] = C.size;
  for (let k = 0; k < C.count; k++) {
    const w = minS + rng.int(maxS - minS + 1), h = minS + rng.int(maxS - minS + 1);
    const x0 = 2 + rng.int(cols - w - 4), y0 = 2 + rng.int(rows - h - 4);
    if (!freeRect(x0, y0, w, h, 1, clear)) continue;
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) kinds[at(x, y)] = K.CRATE;
  }

  // The wreck: a hull seen from above, bow to the east. Cells inside the shape are hull where
  // they touch the outside, deck within; then a gap 2 tiles wide amidships on the south side.
  // (A beached wreck from above: a long boat shape, its sides closing in to a point at the bow,
  // the stern square across, the deck planking inside.)
  if (W) {
    const w = wx1 - wx0 + 1, h = wy1 - wy0 + 1, cy = (wy0 + wy1) / 2, half = h / 2;
    const inHull = (x, y) => {
      if (x < wx0 || x > wx1 || y < wy0 || y > wy1) return false;
      const u = (x - wx0 + 0.5) / w, v = Math.abs(y - cy) / half;    // 0 stern to 1 bow; 0 keel line to 1 side
      return u <= 2 / 3 || v <= 1 - ((u - 2 / 3) * 3) * 0.8 + 1e-9;
    };
    for (let y = wy0; y <= wy1; y++) {
      for (let x = wx0; x <= wx1; x++) {
        if (!inHull(x, y)) continue;
        const edge = !inHull(x - 1, y) || !inHull(x + 1, y) || !inHull(x, y - 1) || !inHull(x, y + 1);
        kinds[at(x, y)] = edge ? K.WRECK : K.DECK;
      }
    }
    const door = wx0 + Math.floor(w * 0.4);
    kinds[at(door, wy1)] = K.DECK; kinds[at(door + 1, wy1)] = K.DECK;
  }

  // Solid from the kinds; then any open tile a walker can't reach from the start becomes a crate.
  const solid = new Uint8Array(cols * rows);
  for (let i = 0; i < solid.length; i++) solid[i] = SOLID_KIND[kinds[i]];
  const seen = new Uint8Array(cols * rows);
  const queue = new Int32Array(cols * rows);
  const start = at(midX, midY);
  if (solid[start]) throw new Error('Map layout "docks": the start is blocked');
  let qh = 0, qt = 0;
  queue[qt++] = start; seen[start] = 1;
  while (qh < qt) {
    const i = queue[qh++], x = i % cols, y = (i - x) / cols;
    // The four neighbors, inline (this visits every open tile of the map).
    if (x + 1 < cols && !seen[i + 1] && !solid[i + 1]) { seen[i + 1] = 1; queue[qt++] = i + 1; }
    if (x > 0 && !seen[i - 1] && !solid[i - 1]) { seen[i - 1] = 1; queue[qt++] = i - 1; }
    if (y + 1 < rows && !seen[i + cols] && !solid[i + cols]) { seen[i + cols] = 1; queue[qt++] = i + cols; }
    if (y > 0 && !seen[i - cols] && !solid[i - cols]) { seen[i - cols] = 1; queue[qt++] = i - cols; }
  }
  for (let i = 0; i < solid.length; i++) if (!solid[i] && !seen[i]) { solid[i] = 1; kinds[i] = K.CRATE; }
  return { solid, kinds };
}
