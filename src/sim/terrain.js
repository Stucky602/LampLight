// The map's walkable ground: a tile grid of solid and open tiles, plus circle collision.
//
// Maps are bounded (builder's call 9: about 256 x 256 tiles, with a fog wall at the edge). The
// edge is solid for everything; obstacles inside (crates, broken walls, water) come from the
// map's layout in data. Enemies path around obstacles with the flow field (flowfield.js).

import { createRng } from '../lib/rng.js';
import { buildMarsh } from './marsh.js';

export const TILE = 16;

/**
 * What each tile is, for the run view (terrain.kinds). The sim only knows solid or open; these
 * say how a tile looks. Solid: CRATE, WATER, SHED_ROOF, SHED_WALL, WRECK, and the Salt Marsh's
 * STUMP and DEEP. Open: the rest. The Marsh's kinds (9 to 17, sim/marsh.js): SALT the pale flats,
 * MUD a creek bed (open at low water, slow for enemies; water at high water), REEDS low reeds on
 * the flats, PEAT an island, STUMP a dead stump (solid), DEEP water that never drains (solid, open
 * to swimmers), CAUSEWAY the stone causeway to the secret's island (floods partway up the water),
 * BOARDWALK planks across a creek (never floods), LANDING the planks where a run starts.
 */
export const GROUND = Object.freeze({
  FLOOR: 0, CRATE: 1, WATER: 2, SHED_ROOF: 3, SHED_WALL: 4, WRECK: 5, BRIDGE: 6, DECK: 7, SHED_DOOR: 8,
  SALT: 9, MUD: 10, REEDS: 11, PEAT: 12, STUMP: 13, DEEP: 14, CAUSEWAY: 15, BOARDWALK: 16, LANDING: 17,
});
/** Which kinds block, by name (every kind must say; a new kind left out fails at load). */
const SOLID_BY_NAME = Object.freeze({
  FLOOR: 0, CRATE: 1, WATER: 1, SHED_ROOF: 1, SHED_WALL: 1, WRECK: 1, BRIDGE: 0, DECK: 0, SHED_DOOR: 1,
  SALT: 0, MUD: 0, REEDS: 0, PEAT: 0, STUMP: 1, DEEP: 1, CAUSEWAY: 0, BOARDWALK: 0, LANDING: 0,
});
const SOLID_KIND = new Uint8Array(Object.keys(GROUND).length);
for (const [name, k] of Object.entries(GROUND)) {
  if (SOLID_BY_NAME[name] === undefined) throw new Error(`terrain: GROUND.${name} doesn't say whether it blocks`);
  SOLID_KIND[k] = SOLID_BY_NAME[name];
}
/** Does a kind block walkers? (sim/marsh.js builds its solid grid from it.) */
export function kindSolid(k) { return SOLID_KIND[k] === 1; }

/** Fills a summed-area table of a 0/1 grid (cols + 1 by rows + 1). */
/**
 * refresh()'s tile pass: solid is base | wet | pillar; a swimmer's wall is a pillar, else the base
 * where there's no water; an eel's is anything but water without a pillar. The counts go to
 * out[0] (solid) and out[1] (swim walls). (0.9.0 release: its own function, so V8 optimizes it as
 * a whole; inside refresh() the loop was compiled on the stack each time and thrown away at the
 * call after it, 80 times in 12 minutes of the Marsh soak.)
 */
function rebuildGrids(n, base, wet, pillar, kinds, grid, swimWall, dryWall, out) {
  const DEEP = GROUND.DEEP;
  out[0] = 0; out[1] = 0;
  for (let i = 0; i < n; i++) {
    const p = pillar[i];
    const s = base[i] | wet[i] | p;
    grid[i] = s; out[0] += s;
    const water = kinds !== null && (kinds[i] === DEEP || wet[i] === 1);
    const sw = p === 1 ? 1 : water ? 0 : base[i];
    swimWall[i] = sw; out[1] += sw;
    dryWall[i] = water && p === 0 ? 0 : 1;
  }
  // (Nothing after the loop: V8 compiles the loop on the stack, and gave up at the first thing
  // after it, which that copy had never seen run, every call.)
}

function fillSat(sat, grid, cols, rows) {
  const W = cols + 1;
  for (let y = 0; y < rows; y++) {
    let rowSum = 0;
    for (let x = 0; x < cols; x++) {
      rowSum += grid[y * cols + x];
      sat[(y + 1) * W + (x + 1)] = sat[y * W + (x + 1)] + rowSum;
    }
  }
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
  const n = cols * rows;
  const tmp = new Float64Array(3);
  let solidCount = 0;
  for (let i = 0; i < grid.length; i++) if (grid[i]) solidCount++;
  // Summed-area table of solid tiles: "any obstacle in this rectangle?" in constant time.
  const sat = new Int32Array((cols + 1) * (rows + 1));
  fillSat(sat, grid, cols, rows);
  // Changing ground (the Salt Marsh, ARCHITECTURE §5.17): what blocks is base | wet | pillar, kept
  // in `solid` by refresh(). `base` never changes (stumps, deep water, the map's own walls); `wet`
  // is a tile under the water now; `pillar` a glass pillar standing. Swimmers go by their own
  // grids: `swimWall` (what stops a leech: stumps, pillars, never water) and `dryWall` (what stops
  // an eel: anything that isn't water). Every refresh bumps `version`, and the flow fields rebuild
  // on a new version. A map without water never refreshes: version stays 0.
  const base = grid.slice(), wet = new Uint8Array(n), pillar = new Uint8Array(n);
  const swimWall = grid.slice(), dryWall = new Uint8Array(n).fill(1);
  const swimSat = new Int32Array((cols + 1) * (rows + 1));
  let swimCount = solidCount;
  const DEEP = GROUND.DEEP;
  const counts = new Int32Array(2);   // (refresh: the solid and swim-wall counts rebuildGrids found)
  if (kinds !== null) {
    for (let i = 0; i < n; i++) if (kinds[i] === DEEP) { swimWall[i] = 0; dryWall[i] = 0; }
    swimCount = 0;
    for (let i = 0; i < n; i++) swimCount += swimWall[i];
  }
  fillSat(swimSat, swimWall, cols, rows);

  const t = {
    cols, rows, width, height, tile: TILE,
    solid: grid,
    kinds,
    base, wet, pillar, swimWall, dryWall,
    version: 0,
    get solidCount() { return solidCount; },

    /** Rebuild solid, the swimmers' grids, and both summed-area tables from base, wet, and pillar; bump the version. */
    refresh() {
      rebuildGrids(n, base, wet, pillar, kinds, grid, swimWall, dryWall, counts);
      solidCount = counts[0]; swimCount = counts[1];
      fillSat(sat, grid, cols, rows);
      fillSat(swimSat, swimWall, cols, rows);
      t.version++;
    },

    /** Water a swimmer can be in (deep water, or a tile under the water now, with no pillar). */
    waterAt(tx, ty) {
      if (tx < 0 || ty < 0 || tx >= cols || ty >= rows) return false;
      return dryWall[ty * cols + tx] === 0;
    },

    /** Swimmers' walls in a tile rectangle (the swim flow field's summed-area table). */
    swimWallIn(tx0, ty0, tx1, ty1) {
      const x0 = tx0 < 0 ? 0 : tx0, y0 = ty0 < 0 ? 0 : ty0;
      const x1 = tx1 >= cols ? cols - 1 : tx1, y1 = ty1 >= rows ? rows - 1 : ty1;
      if (x1 < x0 || y1 < y0) return 0;
      const W = cols + 1;
      return swimSat[(y1 + 1) * W + (x1 + 1)] - swimSat[y0 * W + (x1 + 1)] - swimSat[(y1 + 1) * W + x0] + swimSat[y0 * W + x0];
    },
    get swimCount() { return swimCount; },

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
      pushOut(reg, grid, solidCount);
      // A push out of one tile can land the circle in another it already checked (a narrow
      // gap between blocks): one more pass settles it.
      if ((reg[0] !== x || reg[1] !== y) && solidCount > 0) pushOut(reg, grid, solidCount);
      return reg[0] !== x || reg[1] !== y;
    },

    /**
     * collideR() against a swimmer's grid: `swimWall` (a leech: water is open) or `dryWall` (an
     * eel: only water is open). Same rules, another grid.
     */
    collideGridR(reg, g) {
      const x = reg[0], y = reg[1];
      pushOut(reg, g, 1);
      if (reg[0] !== x || reg[1] !== y) pushOut(reg, g, 1);
      return reg[0] !== x || reg[1] !== y;
    },
  };

  const blockedIn = (g, tx, ty) => tx < 0 || ty < 0 || tx >= cols || ty >= rows || g[ty * cols + tx] === 1;

  /** One pass of collideR: out of every tile of grid `g` it overlaps, and inside the map. */
  function pushOut(reg, g, any) {
      const x = reg[0], y = reg[1], r = reg[2];
      let nx = x, ny = y;
      // The fog wall at the map edge.
      if (nx < r) nx = r; else if (nx > width - r) nx = width - r;
      if (ny < r) ny = r; else if (ny > height - r) ny = height - r;
      if (any > 0) {
        const tx0 = Math.floor((nx - r) / TILE), tx1 = Math.floor((nx + r) / TILE);
        const ty0 = Math.floor((ny - r) / TILE), ty1 = Math.floor((ny + r) / TILE);
        for (let ty = ty0; ty <= ty1; ty++) {
          if (ty < 0 || ty >= rows) continue;
          for (let tx = tx0; tx <= tx1; tx++) {
            if (tx < 0 || tx >= cols || g[ty * cols + tx] !== 1) continue;
            const left = tx * TILE, top = ty * TILE, right = left + TILE, bottom = top + TILE;
            // Closest point on the tile to the circle's center.
            const qx = nx < left ? left : nx > right ? right : nx;
            const qy = ny < top ? top : ny > bottom ? bottom : ny;
            let dx = nx - qx, dy = ny - qy;
            // A corner shared with a solid neighbor is inside a flat wall, not a real corner:
            // push straight off the face instead, so things slide along walls without drifting.
            if (dx !== 0 && dy !== 0) {
              if (blockedIn(g, tx + (dx > 0 ? 1 : -1), ty)) dx = 0;
              else if (blockedIn(g, tx, ty + (dy > 0 ? 1 : -1))) dy = 0;
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
              if (outR < best && !blockedIn(g, tx + 1, ty)) { best = outR; dir = 1; }
              if (outT < best && !blockedIn(g, tx, ty - 1)) { best = outT; dir = 2; }
              if (outB < best && !blockedIn(g, tx, ty + 1)) { best = outB; dir = 3; }
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
 *   marsh:   the Salt Marsh (sim/marsh.js buildMarsh)
 */
export function buildMap(layout, cols, rows) {
  if (layout && layout.kind === 'marsh') {
    // The Salt Marsh (sim/marsh.js): cached per seed inside its builder; copies handed out.
    const g = buildMarsh(layout, cols, rows);
    return { solid: g.solid.slice(), kinds: g.kinds.slice() };
  }
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
  if (layout && (layout.kind === 'docks' || layout.kind === 'marsh')) return buildMap(layout, cols, rows).solid;
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
  if (L.districts !== undefined) {
    if (!Array.isArray(L.districts)) return 'districts must be a list';
    for (const d of L.districts) {
      if (!DISTRICT_KINDS.includes(d?.kind)) return `a district's kind must be one of ${DISTRICT_KINDS.join(', ')}`;
      const r = d.rect;
      if (!(Array.isArray(r) && r.length === 4 && r.every(Number.isInteger) && r[0] >= 2 && r[1] >= 2 && r[2] >= 8 && r[3] >= 3 && r[0] + r[2] <= cols - 2 && r[1] + r[3] <= rows - 2)) return `the ${d.kind}'s rect [x, y, w, h] must be whole tiles at least 8 x 3, 2 tiles inside the map`;
    }
  }
  return null;
}

/**
 * The Drowned Docks' districts (0.9.0, W4: the outer map has places to find your way by), each a
 * rect [x, y, w, h] in tiles that the slips, sheds, and crates keep out of, built from the ground
 * kinds there are:
 *   crane_yard   open hardstanding with container stacks in rows and wide aisles (the cranes
 *                stand on its open north strip: data/maps.js cranes)
 *   fish_market  a square of stalls in rows under two long halls on its north side
 *   breakwater   the harbor mouth: water across the rect, a stone arm (planks) out from its north
 *                edge and along it to a point at its west end
 *   ropewalk     one very long shed with a door every 20 tiles
 *   dry_dock     a basin of water open to the south, a ship's frame standing in it
 */
export const DISTRICT_KINDS = Object.freeze(['crane_yard', 'fish_market', 'breakwater', 'ropewalk', 'dry_dock']);

function buildDistrict(d, kinds, cols, rows) {
  const K = GROUND, [x0, y0, w, h] = d.rect;
  const set = (x, y, k) => { if (x >= 0 && y >= 0 && x < cols && y < rows) kinds[y * cols + x] = k; };
  const fill = (ax, ay, aw, ah, k) => { for (let y = ay; y < ay + ah; y++) for (let x = ax; x < ax + aw; x++) set(x, y, k); };
  switch (d.kind) {
    case 'crane_yard': {
      // The north strip (8 rows) stays open for the cranes; below it, stacks of containers 4 x 2
      // in rows with 3-tile aisles, every other row shifted half a stack.
      for (let y = y0 + 9, row = 0; y + 2 <= y0 + h - 1; y += 5, row++) {
        for (let x = x0 + 2 + (row % 2) * 3; x + 4 <= x0 + w - 2; x += 7) fill(x, y, 4, 2, K.CRATE);
      }
      break;
    }
    case 'fish_market': {
      // Two halls along the north side (roof, then a wall with doors), the stalls below them.
      const hw = (w - 6) >> 1;
      for (const hx of [x0 + 2, x0 + 4 + hw]) {
        fill(hx, y0 + 1, hw, 3, K.SHED_ROOF);
        for (let x = hx; x < hx + hw; x++) set(x, y0 + 4, (x - hx) % 6 === 3 ? K.SHED_DOOR : K.SHED_WALL);
      }
      for (let y = y0 + 8; y + 1 <= y0 + h - 2; y += 4) for (let x = x0 + 3; x + 2 <= x0 + w - 2; x += 5) fill(x, y, 2, 1, K.CRATE);
      break;
    }
    case 'breakwater': {
      fill(x0, y0, w, h, K.WATER);
      // The arm: 3 wide, south from the quay at 3/5 of the way across, then west to near the end.
      const ax = x0 + Math.floor((w * 3) / 5), ay = y0 + h - 7;
      fill(ax, y0, 3, ay - y0 + 3, K.BRIDGE);
      fill(x0 + 6, ay, ax - x0 - 6, 3, K.BRIDGE);
      // The point: a wider head at its west end (where the beacon stood).
      fill(x0 + 3, ay - 1, 5, 5, K.BRIDGE);
      break;
    }
    case 'ropewalk': {
      fill(x0, y0, w, h - 1, K.SHED_ROOF);
      for (let x = x0; x < x0 + w; x++) set(x, y0 + h - 1, (x - x0) % 20 === 10 ? K.SHED_DOOR : K.SHED_WALL);
      break;
    }
    case 'dry_dock': {
      // A basin open to the south (the sea runs in), a ship's frame in it: its keel down the middle
      // and ribs across every third row, standing clear of the walls.
      fill(x0, y0, w, h, K.WATER);
      const kx = x0 + (w >> 1);
      for (let y = y0 + 3; y < y0 + h - 4; y++) set(kx, y, K.WRECK);
      for (let y = y0 + 4; y < y0 + h - 5; y += 3) for (let x = x0 + 3; x < x0 + w - 3; x++) set(x, y, K.WRECK);
      break;
    }
    default: break;
  }
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
  // The districts (0.9.0, W4) first: their ground (and a margin of 2) is theirs alone.
  const reserved = new Uint8Array(cols * rows);
  for (const d of L.districts || []) {
    buildDistrict(d, kinds, cols, rows);
    const [dx, dy, dw, dh] = d.rect;
    for (let y = dy - 2; y < dy + dh + 2; y++) for (let x = dx - 2; x < dx + dw + 2; x++) if (inside(x, y)) reserved[at(x, y)] = 1;
  }
  // Is the rectangle (plus a margin) all plain wharf, away from the start, the wreck, and the districts?
  const freeRect = (x0, y0, w, h, m, r) => {
    for (let y = y0 - m; y < y0 + h + m; y++) {
      for (let x = x0 - m; x < x0 + w + m; x++) {
        if (!inside(x, y) || x < 2 || y < 2 || x >= cols - 2 || y >= rows - 2) return false;
        if (kinds[at(x, y)] !== K.FLOOR || nearWreck(x, y) || reserved[at(x, y)]) return false;
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
