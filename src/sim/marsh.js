// The Salt Marsh (ARCHITECTURE §5.17; docs/design/SALT_MARSH.md): its ground, its water, rule 8,
// and the herb beds.
//
// The layout (buildMarsh, cached per seed): pale salt flats cut by creeks that run edge to edge
// (mud at low water), boardwalks across each creek that never flood, peat islands, stumps, reed
// beds, a plank landing in the northwest with a deep pool beside it for the Ferryman's skiff, and
// in the far southeast a peat island in a deep moat with a stone causeway: the Drowned Causeway,
// the secret. Each tile has a flood height (floodAt): creeks 0 to 100 from their mouths, the
// causeway 50, the flats 110 to 250 (nearest the water first), 255 never. A tile is under the
// water while the water's level is above its height.
//
// The water (createMarsh, marshStep): high water 3:00 to 8:00 and 13:00 to 18:00, creeping in over
// `creep` seconds from the mouths and warned `warn` seconds ahead (both in seconds, never squeezed
// by a short run); in overtime it comes in and doesn't go out, rising over a share of the flats
// each minute after its own warning, with `keepDry` of the open ground never flooding. High water
// is a wall to everything but swimmers. Mud slows enemies (sim/enemies.js), never you.
//
// Rule 8, the flood never closes around you: a 0-1 search from the landing, once per water level,
// leaves on every tile a step toward the landing that crosses as few would-be-wet tiles as there
// can be. Each pass walks that chain from your tile and holds its would-be-wet tiles dry (mud),
// changing only the tiles whose hold changed; a pass is skipped when neither the level nor your
// tile changed. Glass pillars count as open in the search and never rise on your path; if the
// chain comes to run through one that stands (the water rose, or you moved), it falls at once. The ground
// itself (terrain.refresh, the flow fields) changes at most 4 times a second: every change waits
// for the next rebuild, and walkers caught by the water then move to the nearest bank.
//
// In overtime, when the water comes in and never goes out, rule 8 reaches the map's armed sites too
// (X4, the sweep's finding 2: by the Long Night the flood had taken 24 of the Marsh's 47 task and
// trade sites for good, and from the landing you could walk to none of them): the same search gives
// every site its own chain to the landing, and the pass holds them all. The chains follow one tree of
// steps, so yours meets a site's somewhere on the way to the landing (at the landing at the latest),
// and nothing armed is ever out of reach: an unlit lamp, a Fog Bell not yet rung, a cairn that is
// ready, an unused bog body or sunken crate, a find not yet found, the Ferryman's mooring while he
// is tied up, the open Salt Well, and a chest, Reliquary, or vault on the ground. (The Drowned
// Causeway keeps its own rule: above the water only at low water.)

import { DT, TPS, EF, PK, PK_STAYS, EEL } from './constants.js';
import { EV, SIGHT } from './events.js';
import { TILE, GROUND, kindSolid } from './terrain.js';
import { createRng } from '../lib/rng.js';
import { addMaterial } from './pickups.js';
import { sightThing } from './sight.js';
import { pillarsOffPath } from './storm.js';
import { polesWater, tradeSiteOpen } from './trades.js';
import { TASK, TASK_STATE } from './constants.js';

const NEVER = 255;
const HIGH = 101;          // the level of high water: every creek tile (0 to 100) is under it

// ---------------------------------------------------------------- the layout

/** A marsh layout's data, checked: a plain message for the first thing wrong, or null. */
export function checkMarsh(L, cols, rows) {
  const whole = (v, min = 0) => Number.isInteger(v) && v >= min;
  const pair = (v) => Array.isArray(v) && v.length === 2 && v.every(Number.isInteger) && v[1] >= v[0] && v[0] >= 1;
  const tile = (v) => Array.isArray(v) && v.length === 2 && v.every(Number.isInteger) && v[0] >= 0 && v[1] >= 0 && v[0] < cols && v[1] < rows;
  if (typeof L.seed !== 'string' || !L.seed) return 'needs a seed';
  if (!(cols >= 96 && rows >= 96)) return `needs a map at least 96 tiles on each side (this one is ${cols} x ${rows})`;
  const C = L.creeks;
  if (!C || !whole(C.count, 1) || !pair(C.width) || C.width[0] < 2 || !(C.apart > 0 && C.apart < 0.5) || !(C.alongside >= 0 && C.alongside < 1) || !pair(C.boardwalks)) {
    return 'creeks need a whole count, a width [min, max] of 2 or more, apart (a share of the map), alongside (a share), and boardwalks [min, max]';
  }
  if (!L.islands || !whole(L.islands.count) || !pair(L.islands.radius)) return 'islands need a whole count and a radius [min, max]';
  if (!whole(L.stumps) || !whole(L.reeds)) return 'stumps and reeds are whole counts';
  if (!L.landing || !tile(L.landing.at) || !whole(L.landing.pool, 2)) return 'the landing needs a tile `at` and a pool of 2 or more';
  if (L.secret !== undefined && !(L.secret && tile(L.secret.at) && whole(L.secret.island, 3) && whole(L.secret.moat, 2))) return 'the secret needs a tile `at`, an island radius of 3 or more, and a moat of 2 or more';
  return null;
}

const CACHE = new Map();
/** Forget the built marshes (tests, to build one from scratch). */
export function clearMarshCache() { CACHE.clear(); }

/**
 * The Salt Marsh's ground from its layout: { solid, kinds, floodAt, landing, creeks, island,
 * causeway, order, firstAt, flats, open, maxFlats }. Deterministic (its own seed), cached per seed
 * and size (a world copies what it changes: sim/terrain.js buildMap hands out copies).
 *   creeks:   { count, width: [min, max], apart (each creek's middle at least this share of the
 *             map from the others), alongside (at most this share of a creek near another),
 *             boardwalks: [min, max] across each }
 *   islands:  { count, radius: [min, max] } peat
 *   stumps, reeds: how many
 *   landing:  { at: [col, row], pool } the planks you land on, a deep pool east of them
 *   secret:   { at, island, moat } a peat island in a deep moat, a causeway to it
 */
export function buildMarsh(L, cols, rows) {
  const key = `${JSON.stringify(L)}|${cols}x${rows}`;
  let g = CACHE.get(key);
  if (g) return g;
  const bad = checkMarsh(L, cols, rows);
  if (bad) throw new Error(`Map layout "marsh": ${bad}`);
  g = build(L, cols, rows);
  CACHE.set(key, g);
  if (CACHE.size > 4) CACHE.delete(CACHE.keys().next().value);
  return g;
}

function build(L, cols, rows) {
  const K = GROUND, n = cols * rows;
  const rng = createRng(`layout:${L.seed}`);
  const kinds = new Uint8Array(n).fill(K.SALT);
  const floodAt = new Uint8Array(n).fill(NEVER);
  const at = (x, y) => y * cols + x;
  const inside = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows;
  const [lx, ly] = L.landing.at;
  const S = L.secret || null;
  const nearLanding = (x, y, m) => Math.abs(x - lx) <= m && Math.abs(y - ly) <= m;
  const secretR = S ? S.island + S.moat + 3 : 0;
  const nearSecret = (x, y, m) => S !== null && (x - S.at[0]) * (x - S.at[0]) + (y - S.at[1]) * (y - S.at[1]) <= (secretR + m) * (secretR + m);

  // Creeks, edge to edge: a meandering band from one side to the other (horizontal ones from the
  // west, vertical from the north: that end is the mouth). Kept apart: each one's middle at least
  // `apart` of the map from every other's, and at most `alongside` of its tiles near another.
  const C = L.creeks, creekId = new Int8Array(n).fill(-1), creeks = [];
  const nearCreek = new Uint8Array(n); // within 5 tiles of a creek made so far
  for (let c = 0; c < C.count; c++) {
    let made = null;
    for (let tries = 0; tries < 400 && !made; tries++) {
      const horiz = (c + (tries >> 3)) % 2 === 0;
      const len = horiz ? cols : rows, wide = horiz ? rows : cols;
      const w = C.width[0] + rng.int(C.width[1] - C.width[0] + 1);
      const pos = new Int32Array(len);
      let p = 16 + rng.int(wide - 32 - w), drift = 0;
      for (let a = 0; a < len; a++) {
        if (rng.chance(0.12)) drift = rng.int(3) - 1;
        if (a % 2 === 0) p += drift;
        if (p < 10) { p = 10; drift = 1; } else if (p > wide - 10 - w) { p = wide - 10 - w; drift = -1; }
        pos[a] = p;
      }
      const mid = horiz ? [len >> 1, pos[len >> 1] + (w >> 1)] : [pos[len >> 1] + (w >> 1), len >> 1];
      const apart = C.apart * Math.min(cols, rows);
      if (creeks.some((o) => (o.mid[0] - mid[0]) * (o.mid[0] - mid[0]) + (o.mid[1] - mid[1]) * (o.mid[1] - mid[1]) < apart * apart)) continue;
      const tiles = [];
      let along = 0, clash = false;
      for (let a = 0; a < len && !clash; a++) {
        for (let k = 0; k < w; k++) {
          const x = horiz ? a : pos[a] + k, y = horiz ? pos[a] + k : a;
          if (nearLanding(x, y, 7) || nearSecret(x, y, 2)) { clash = true; break; }
          tiles.push(at(x, y));
          if (nearCreek[at(x, y)]) along++;
        }
      }
      if (clash || along > C.alongside * tiles.length) continue;
      made = { horiz, w, pos, mid, tiles, len };
    }
    if (!made) throw new Error(`Map layout "marsh": only ${c} of ${C.count} creeks fit (fewer creeks, or less apart)`);
    for (const i of made.tiles) { kinds[i] = K.MUD; if (creekId[i] < 0) creekId[i] = c; }
    // Mark the ground within 5 tiles of it (the next creeks keep their distance).
    for (const i of made.tiles) {
      const x = i % cols, y = (i - x) / cols;
      for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) if (inside(x + dx, y + dy)) nearCreek[at(x + dx, y + dy)] = 1;
    }
    creeks.push(made);
  }

  // Boardwalks: 2 or 3 across each creek, 2 tiles thick, evenly along it, never where it meets
  // another creek. They never flood.
  for (const cr of creeks) {
    const want = C.boardwalks[0] + rng.int(C.boardwalks[1] - C.boardwalks[0] + 1);
    let placed = 0;
    for (let k = 0; k < want; k++) {
      const a0 = Math.floor((cr.len * (k + 1)) / (want + 1)) + rng.int(11) - 5;
      // Slide along until the strip crosses only this creek's own mud.
      for (let s = 0; s < 40; s++) {
        const a = a0 + (s % 2 === 0 ? s / 2 : -(s + 1) / 2);
        if (a < 4 || a + 1 >= cr.len - 4) continue;
        let ok = true;
        for (let da = 0; da < 2 && ok; da++) {
          for (let q = -1; q <= cr.w; q++) {
            const x = cr.horiz ? a + da : cr.pos[a + da] + q, y = cr.horiz ? cr.pos[a + da] + q : a + da;
            if (!inside(x, y)) { ok = false; break; }
            const i = at(x, y);
            const inMe = q >= 0 && q < cr.w;
            if (inMe ? kinds[i] !== K.MUD || creekId[i] !== creeks.indexOf(cr) : kinds[i] === K.MUD) { ok = false; break; }
          }
        }
        if (!ok) continue;
        for (let da = 0; da < 2; da++) for (let q = 0; q < cr.w; q++) {
          const x = cr.horiz ? a + da : cr.pos[a + da] + q, y = cr.horiz ? cr.pos[a + da] + q : a + da;
          kinds[at(x, y)] = K.BOARDWALK;
        }
        placed++;
        break;
      }
    }
    if (placed < C.boardwalks[0]) throw new Error('Map layout "marsh": a creek has too few boardwalks (fewer creeks, or narrower)');
  }

  // The landing: planks 4 x 3 at `at`, the deep pool east of them for the skiff.
  for (let y = ly - 1; y <= ly + 1; y++) for (let x = lx - 2; x <= lx + 1; x++) if (inside(x, y)) kinds[at(x, y)] = K.LANDING;
  const P = L.landing.pool;
  for (let y = ly - (P >> 1); y < ly - (P >> 1) + P; y++) for (let x = lx + 2; x < lx + 2 + P; x++) if (inside(x, y)) kinds[at(x, y)] = K.DEEP;

  // The secret: a peat island in a deep moat, a stone causeway 2 wide to the northwest bank.
  let island = null, causeway = [];
  if (S) {
    const [sx, sy] = S.at, r1 = S.island, r2 = S.island + S.moat;
    for (let y = sy - r2; y <= sy + r2; y++) for (let x = sx - r2; x <= sx + r2; x++) {
      if (!inside(x, y)) continue;
      const d2 = (x - sx) * (x - sx) + (y - sy) * (y - sy);
      if (d2 <= r1 * r1) kinds[at(x, y)] = K.PEAT;
      else if (d2 <= r2 * r2) kinds[at(x, y)] = K.DEEP;
    }
    // Northwest along the diagonal: a staircase 2 tiles wide across the moat.
    for (let k = 0; k <= r2 + 1; k++) {
      const x = sx - Math.round(k * 0.7071), y = sy - Math.round(k * 0.7071);
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const cx = x + dx, cy = y + dy;
        if (!inside(cx, cy)) continue;
        const i = at(cx, cy);
        if (kinds[i] === K.DEEP) { kinds[i] = K.CAUSEWAY; causeway.push(i); }
      }
    }
    island = { at: [sx, sy], radius: r1 };
  }

  // Peat islands on the flats, off the creeks.
  const salt = (x, y) => inside(x, y) && kinds[at(x, y)] === K.SALT && !nearCreek[at(x, y)];
  for (let k = 0; k < L.islands.count; k++) {
    for (let tries = 0; tries < 40; tries++) {
      const r = L.islands.radius[0] + rng.int(L.islands.radius[1] - L.islands.radius[0] + 1);
      const x0 = r + 2 + rng.int(cols - 2 * r - 4), y0 = r + 2 + rng.int(rows - 2 * r - 4);
      if (nearLanding(x0, y0, r + 8) || nearSecret(x0, y0, r + 4)) continue;
      let ok = true;
      for (let y = y0 - r; y <= y0 + r && ok; y++) for (let x = x0 - r; x <= x0 + r; x++) {
        if ((x - x0) * (x - x0) + (y - y0) * (y - y0) <= r * r && !salt(x, y)) { ok = false; break; }
      }
      if (!ok) continue;
      for (let y = y0 - r; y <= y0 + r; y++) for (let x = x0 - r; x <= x0 + r; x++) {
        // A ragged edge: the outer ring kept now and then.
        const d2 = (x - x0) * (x - x0) + (y - y0) * (y - y0);
        if (d2 <= (r - 1) * (r - 1) || (d2 <= r * r && rng.chance(0.5))) kinds[at(x, y)] = K.PEAT;
      }
      break;
    }
  }
  // Reed beds (open, drawn under the bodies), then stumps (solid), off the creeks' banks, the
  // boardwalks' ends, the landing, and the secret.
  for (let k = 0; k < L.reeds; k++) {
    const x0 = 2 + rng.int(cols - 6), y0 = 2 + rng.int(rows - 6);
    if (nearLanding(x0, y0, 4)) continue;
    const w = 2 + rng.int(3), h = 2 + rng.int(3);
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (inside(x, y) && kinds[at(x, y)] === K.SALT) kinds[at(x, y)] = K.REEDS;
  }
  const clearOf = (x, y, kind, m) => {
    for (let dy = -m; dy <= m; dy++) for (let dx = -m; dx <= m; dx++) if (inside(x + dx, y + dy) && kinds[at(x + dx, y + dy)] === kind) return false;
    return true;
  };
  for (let k = 0, placed = 0; placed < L.stumps && k < L.stumps * 20; k++) {
    const x = 2 + rng.int(cols - 4), y = 2 + rng.int(rows - 4);
    const kd = kinds[at(x, y)];
    if (kd !== K.SALT && kd !== K.REEDS && kd !== K.PEAT) continue;
    if (nearLanding(x, y, 6) || nearSecret(x, y, 0) || !clearOf(x, y, K.MUD, 1) || !clearOf(x, y, K.BOARDWALK, 2) || !clearOf(x, y, K.CAUSEWAY, 2)) continue;
    kinds[at(x, y)] = K.STUMP;
    placed++;
  }

  // Solid from the kinds; any open tile a walker can't reach from the landing at low water
  // becomes a stump (every open tile is reachable, so rule 8 always has a path).
  const solid = new Uint8Array(n);
  for (let i = 0; i < n; i++) solid[i] = kindSolid(kinds[i]) ? 1 : 0;
  const start = at(lx, ly);
  if (solid[start]) throw new Error('Map layout "marsh": the landing is blocked');
  const seen = new Uint8Array(n), queue = new Int32Array(n);
  let qh = 0, qt = 0;
  queue[qt++] = start; seen[start] = 1;
  while (qh < qt) {
    const i = queue[qh++], x = i % cols, y = (i - x) / cols;
    if (x + 1 < cols && !seen[i + 1] && !solid[i + 1]) { seen[i + 1] = 1; queue[qt++] = i + 1; }
    if (x > 0 && !seen[i - 1] && !solid[i - 1]) { seen[i - 1] = 1; queue[qt++] = i - 1; }
    if (y + 1 < rows && !seen[i + cols] && !solid[i + cols]) { seen[i + cols] = 1; queue[qt++] = i + cols; }
    if (y > 0 && !seen[i - cols] && !solid[i - cols]) { seen[i - cols] = 1; queue[qt++] = i - cols; }
  }
  for (let i = 0; i < n; i++) if (!solid[i] && !seen[i]) { solid[i] = 1; kinds[i] = K.STUMP; }

  // Flood heights. Creeks: 0 at the mouth to 100 at the far end, along each creek. The causeway
  // 50. The flats (salt and reeds): 110 to 250 by their distance from the water, nearest first.
  // Everything else never floods.
  const dist = new Int32Array(n), mine = new Int8Array(n);
  for (let c = 0; c < creeks.length; c++) {
    const cr = creeks[c];
    dist.fill(-1);
    // This creek's own tiles (where creeks cross, a tile is both's).
    mine.fill(0);
    for (const i of cr.tiles) mine[i] = 1;
    qh = 0; qt = 0;
    for (const i of cr.tiles) {
      const x = i % cols, y = (i - x) / cols;
      if ((cr.horiz ? x : y) === 0 && kinds[i] === K.MUD) { dist[i] = 0; queue[qt++] = i; }
    }
    let far = 1;
    while (qh < qt) {
      const i = queue[qh++], x = i % cols, y = (i - x) / cols, d = dist[i] + 1;
      for (let q = 0; q < 4; q++) {
        const nx = x + (q === 0 ? 1 : q === 1 ? -1 : 0), ny = y + (q === 2 ? 1 : q === 3 ? -1 : 0);
        if (!inside(nx, ny)) continue;
        const j = at(nx, ny);
        if (dist[j] >= 0 || mine[j] === 0 || (kinds[j] !== K.MUD && kinds[j] !== K.BOARDWALK)) continue;
        dist[j] = d; if (d > far) far = d; queue[qt++] = j;
      }
    }
    for (const i of cr.tiles) if (kinds[i] === K.MUD && dist[i] >= 0) {
      const h = Math.floor((100 * dist[i]) / far);
      if (h < floodAt[i]) floodAt[i] = h;
    }
  }
  for (const i of causeway) floodAt[i] = 50;
  // The flats: a search out from all the water.
  dist.fill(-1);
  qh = 0; qt = 0;
  for (let i = 0; i < n; i++) if (kinds[i] === K.MUD || kinds[i] === K.DEEP) { dist[i] = 0; queue[qt++] = i; }
  let farFlat = 1;
  while (qh < qt) {
    const i = queue[qh++], x = i % cols, y = (i - x) / cols, d = dist[i] + 1;
    for (let q = 0; q < 4; q++) {
      const nx = x + (q === 0 ? 1 : q === 1 ? -1 : 0), ny = y + (q === 2 ? 1 : q === 3 ? -1 : 0);
      if (!inside(nx, ny)) continue;
      const j = at(nx, ny);
      if (dist[j] >= 0 || solid[j]) continue;
      dist[j] = d; if (d > farFlat) farFlat = d; queue[qt++] = j;
    }
  }
  let flats = 0, open = 0;
  for (let i = 0; i < n; i++) {
    if (!solid[i]) open++;
    if ((kinds[i] === K.SALT || kinds[i] === K.REEDS) && !solid[i] && dist[i] >= 0) {
      floodAt[i] = 110 + Math.min(140, Math.floor((140 * dist[i]) / farFlat));
      flats++;
    }
  }
  // Floodable tiles in order of height (a level change touches one run of them), and where each
  // height starts in that order.
  const counts = new Int32Array(257);
  for (let i = 0; i < n; i++) if (floodAt[i] !== NEVER) counts[floodAt[i] + 1]++;
  const firstAt = new Int32Array(257);
  for (let h = 1; h < 257; h++) firstAt[h] = firstAt[h - 1] + counts[h];
  const order = new Int32Array(firstAt[256]);
  const fill = firstAt.slice();
  for (let i = 0; i < n; i++) if (floodAt[i] !== NEVER) order[fill[floodAt[i]]++] = i;
  // The most of the flats overtime may flood: `open` less what floods at high water stays at
  // least keepDry of the open ground (the map's water.overtime.keepDry decides; see flatsLevel).
  const highWet = firstAt[HIGH];
  return {
    solid, kinds, floodAt, order, firstAt, flats, open, highWet,
    landing: [lx, ly], creeks: creeks.map((cr) => ({ horiz: cr.horiz, width: cr.w, mid: cr.mid, tiles: cr.tiles.length })),
    island, causeway,
  };
}

/**
 * The water level that floods `share` of the flats (overtime), held so that at least `keepDry`
 * of the open ground stays dry: the lowest height above that many flats.
 */
export function flatsLevel(g, share, keepDry) {
  const most = Math.max(0, Math.floor(g.open * (1 - keepDry)) - g.highWet);
  const want = Math.min(Math.floor(g.flats * share), most);
  // firstAt[h] counts the floodable tiles below height h; the flats start at 110. The highest
  // level that floods no more than `want` of them.
  const base = g.firstAt[110];
  let h = 110;
  while (h < 251 && g.firstAt[h + 1] - base <= want) h++;
  return h;
}

// ---------------------------------------------------------------- the water in a run

/** The Marsh's state for a world on a marsh map (null on any other). */
export function createMarsh(world) {
  const map = world.map;
  if (!map.layout || map.layout.kind !== 'marsh') return null;
  const W = map.water;
  if (!W) throw new Error(`Map ${map.id}: a marsh needs its water ({ high, creep, warn, mudSlow, overtime })`);
  const bad = checkWater(W);
  if (bad) throw new Error(`Map ${map.id}: water ${bad}`);
  const t = world.terrain, cols = t.cols, rows = t.rows, n = cols * rows;
  const g = buildMarsh(map.layout, cols, rows);
  const scale = world.director.timeScale;
  // Herb beds: on the creek mud, placed from the run's loot stream, 1 or 2 each.
  const H = map.herbs || { beds: 0, amount: [1, 1] };
  const mud = [];
  for (let i = 0; i < n; i++) if (g.kinds[i] === GROUND.MUD) mud.push(i);
  const beds = Math.min(H.beds, mud.length);
  const herbTile = new Int32Array(beds), herbLeft = new Uint8Array(beds);
  const rng = world.rng.loot;
  for (let k = 0; k < beds; k++) {
    const j = k + rng.int(mud.length - k);
    const v = mud[j]; mud[j] = mud[k]; mud[k] = v;
    herbTile[k] = v;
    herbLeft[k] = H.amount[0] + rng.int(H.amount[1] - H.amount[0] + 1);
  }
  return {
    g, W, scale,
    windows: W.high.map(([a, b]) => [a * scale, b * scale]),
    level: 0,                     // the level applied to the ground
    searched: -1,                 // the level the last search was for (-1: none yet)
    phase: 5,                     // WATER now (low; an event on each change)
    otSteps: 0,                   // overtime steps warned so far
    otLevel: new Int16Array(256).fill(-1), // each overtime step's flood level (flatsLevel), worked out once
    rebuildTicks: Math.max(1, Math.round((W.rebuildEvery ?? 0.25) * TPS)),
    dirty: false,
    // Rule 8: the search's step toward the landing, its cost, the deque; the hold and its chain.
    step: new Int32Array(n).fill(-1), cost: new Int32Array(n), deque: new Int32Array(2 * n),
    held: new Uint8Array(n), heldList: new Int32Array(n), heldN: 0,
    chain: new Int32Array(n), pathMark: new Int32Array(n), passId: 0, ptile: -1, pillarOnPath: false,
    touched: new Int32Array(n), touchMark: new Int32Array(n), touchedN: 0, touchId: 1,
    // The armed sites' tiles (collectSites), a number that changes when they do, and the level
    // overtime's flood stops at (floodsEver).
    siteTile: new Int32Array(SITE_CAP), siteN: 0, siteSig: 0, otCap: -1,
    landing: g.landing[1] * cols + g.landing[0],
    herbTile, herbLeft, herbsPicked: 0,
    searches: 0, passes: 0, refreshes: 0,
  };
}

const SITE_CAP = 384;   // the most armed sites held at once (a run has about 60; the pickup pool holds 256)

/**
 * Would the water ever take tile i this run: a high water's creeks, or overtime's flood at its
 * highest (flatsLevel at every flat it may take; tiles above that stay dry however long you stay)?
 */
export function floodsEver(world, i) {
  const M = world.marsh;
  if (M === null) return false;
  if (M.otCap < 0) { const c = flatsLevel(M.g, 1, M.W.overtime.keepDry); M.otCap = c > HIGH ? c : HIGH; }
  return M.g.floodAt[i] < M.otCap;
}

function addSite(M, T, x, y) {
  const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
  if (tx < 0 || ty < 0 || tx >= T.cols || ty >= T.rows || M.siteN >= SITE_CAP) return;
  const i = ty * T.cols + tx;
  M.siteTile[M.siteN++] = i;
  M.sig = (Math.imul(M.sig, 31) + i + 1) | 0;
}

/**
 * The tiles of everything armed on the map now (see the top of the file), into M.siteTile. A cold
 * path: at most 4 times a second, and only while there is water. Returns true when they changed.
 */
function collectSites(world, M) {
  const T = world.terrain;
  M.siteN = 0; M.sig = 7;
  const tasks = world.tasks;
  if (tasks !== null) for (let k = 0; k < tasks.length; k++) {
    const t = tasks[k];
    if (t.kind === TASK.CAIRN || t.kind === TASK.CRANE ? t.state === TASK_STATE.IDLE : t.state !== TASK_STATE.DONE) addSite(M, T, t.x, t.y);
  }
  const tr = world.trade;
  if (tr) {
    for (let k = 0; k < tr.sites.length; k++) if (tradeSiteOpen(world, k)) addSite(M, T, tr.sites[k].x, tr.sites[k].y);
  }
  const act = world.acts ? world.acts.act : 1, S = world.secrets;
  for (let k = 0; k < S.length; k++) { const f = S[k]; if (f.gift && !f.open && act >= (f.from ?? 1)) addSite(M, T, f.x, f.y); }
  const F = world.ferry;
  if (F) {
    if (tr && tr.id === 'hook') { for (let k = 0; k < F.moorings.length; k++) addSite(M, T, F.moorings[k].x, F.moorings[k].y); }
    else if (F.moored) addSite(M, T, F.x, F.y);
  }
  const Wl = world.well;
  if (Wl && Wl.open) addSite(M, T, Wl.x, Wl.y);
  const P = world.pickups;
  for (let k = 0; k < P.count; k++) if (PK_STAYS.includes(P.kind[k])) addSite(M, T, P.x[k], P.y[k]);
  if (M.sig === M.siteSig) return false;
  M.siteSig = M.sig;
  return true;
}

/** A map's water data, checked: a plain message, or null. */
export function checkWater(W) {
  if (!Array.isArray(W.high) || !W.high.every((h) => Array.isArray(h) && h.length === 2 && h[1] > h[0] && h[0] > 0)) return 'high must be a list of [from, to] seconds';
  for (let k = 1; k < W.high.length; k++) if (!(W.high[k][0] > W.high[k - 1][1] + W.creep)) return 'high waters must not overlap (each starts after the last has gone out)';
  if (!(W.creep > 0 && W.warn > 0)) return 'creep and warn must be seconds above 0';
  if (!(W.mudSlow > 0 && W.mudSlow <= 1)) return 'mudSlow must be a share above 0, at most 1';
  const O = W.overtime;
  if (!O || !(O.perMin > 0 && O.perMin <= 1) || !(O.keepDry > 0 && O.keepDry < 1)) return 'overtime needs perMin (a share of the flats a minute) and keepDry (a share of the open ground)';
  return null;
}

/** Water phases (EV.WATER's a). */
export const WATER = Object.freeze({ WARN: 1, RISING: 2, HIGH: 3, EBBING: 4, LOW: 5 });

/**
 * The water's level at run time t (seconds), as a whole number 0 to 251, and the phase. High waters
 * come in over `creep` seconds (from the creek mouths: their heights) and go out the same way.
 * Overtime: in at its start (after its warning), then up a share of the flats every minute (each
 * after its own warning), never out.
 */
function levelAt(world, M, t, out) {
  const W = M.W, creep = W.creep, warn = W.warn;
  let lv = 0, phase = WATER.LOW;
  for (const [a, b] of M.windows) {
    if (t >= a - warn && t < a) phase = WATER.WARN;
    if (t < a || t >= b + creep) continue;
    if (t < a + creep) { lv = Math.max(lv, (HIGH * (t - a)) / creep); phase = WATER.RISING; }
    else if (t < b) { lv = HIGH; phase = WATER.HIGH; }
    else { lv = Math.max(lv, HIGH * (1 - (t - b) / creep)); phase = WATER.EBBING; }
  }
  const D = world.director;
  if (D.overtime) {
    const t0 = D.overtimeStartTick * DT;
    const O = W.overtime;
    let prev = 0, k = 0;
    for (;; k++) {
      const s = t0 + 60 * k + warn;              // step k comes in after its warning
      if (t < s - warn) break;
      if (t < s) { phase = WATER.WARN; break; }
      const target = k === 0 ? HIGH : otTarget(M, O, k);
      if (t < s + creep) { lv = Math.max(lv, prev + ((target - prev) * (t - s)) / creep); phase = WATER.RISING; break; }
      prev = target;
      lv = Math.max(lv, target);
      phase = WATER.HIGH;
    }
  }
  out[0] = Math.floor(lv);
  return phase;
}

/** Overtime step k's flood level, worked out once per step (past 255 minutes: the 255th's, the cap long since reached). */
function otTarget(M, O, k) {
  const j = k < M.otLevel.length ? k : M.otLevel.length - 1;
  if (M.otLevel[j] < 0) M.otLevel[j] = flatsLevel(M.g, O.perMin * j, O.keepDry);
  return M.otLevel[j];
}

/** Each tick, after you move: the water's clock and warnings, rule 8, the herbs, and (at most 4 times a second) the ground. */
export function marshStep(world) {
  const M = world.marsh;
  if (M === null) return;
  const t = world.tick * DT, out = world.scratch.v2;
  const phase = levelAt(world, M, t, out);
  const p = world.player, T = world.terrain;
  if (phase !== M.phase) {
    // A warning says how long until the water comes; the first time a run sees it, a notice.
    let secs = 0;
    if (phase === WATER.WARN) secs = M.W.warn;
    world.events.push(EV.WATER, p.x, p.y, phase, secs, world.director.overtime ? 1 : 0);
    if (phase === WATER.WARN || phase === WATER.RISING) sightThing(world, SIGHT.WATER);
    M.phase = phase;
  }
  // Rule 8 holds a dry way from your tile to the landing. The Punter (0.9.0, W2) poles across the
  // water, so it never traps him, and a held-dry chain under him would let walkers follow: while
  // he's on the water the chain is the landing's alone (it holds nothing for him). On land he has
  // his chain like anyone (X4: without it, overtime's flood left him dry ground no walker could
  // reach, and his punt now has an end).
  const here = Math.floor(p.y / TILE) * T.cols + Math.floor(p.x / TILE);
  const ptile = polesWater(world) && T.wet[here] === 1 ? M.landing : here;
  const rebuild = world.tick % M.rebuildTicks === 0;
  if (rebuild) {
    const L = out[0];
    // What's armed on the map now: in overtime only, when the water never goes out again. (A high
    // water cuts parts of the map off for five minutes, as it always has: crossing it then is the
    // boardwalks' and the Punter's.)
    const sitesChanged = world.director.overtime && (L > 0 || M.level > 0) && collectSites(world, M);
    if (L !== M.level) {
      const L0 = M.level;
      M.level = L;
      if (L > 0) { search(M, T, L); pass(M, T, ptile); }
      else releaseAll(M);
      touchLevelRange(M, L0, L);
    } else if ((ptile !== M.ptile || sitesChanged) && L > 0) pass(M, T, ptile);
    if (M.pillarOnPath) pillarsFall(world, M);
    applyGround(world, M);
  } else if (ptile !== M.ptile && M.level > 0) {
    pass(M, T, ptile);
    // A pillar on the new chain falls at once: the ground catches up now, not at the next rebuild.
    if (M.pillarOnPath) { pillarsFall(world, M); applyGround(world, M); }
  }
  if (world.tick % 6 === 0) herbsStep(world, M, p);
  // The Drowned Causeway, seen above the water from close by (the secret's layer only).
  // (X4: only while the causeway's own secret is in this run. The map's small finds made
  // `world.secrets.length` always true, so a character it is shut to, or a run without the secret
  // layer, got its first-sighting line.)
  if (world.tick % 30 === 0 && M.g.island !== null && (world.seenThings & (1 << SIGHT.CAUSEWAY)) === 0 && hasSecret(world, CAUSEWAY_SECRET)) {
    const c = M.g.causeway[0], cx = (c % T.cols + 0.5) * TILE, cy = (Math.floor(c / T.cols) + 0.5) * TILE;
    if (T.wet[c] === 0 && Math.abs(cx - p.x) < 320 && Math.abs(cy - p.y) < 180) sightThing(world, SIGHT.CAUSEWAY);
  }
}

const CAUSEWAY_SECRET = 'drowned_causeway';
/** Is the secret `id` in this run (its layer on, and not shut to this character: sim/trades.js secretShut)? */
function hasSecret(world, id) {
  const S = world.secrets;
  for (let k = 0; k < S.length; k++) if (S[k].id === id) return true;
  return false;
}

function pillarsFall(world, M) {
  M.pillarOnPath = false;
  pillarsOffPath(world);
}

/** Rule 8's parts, for tests and tools/marsh/rule8.mjs: the search at a level, a pass from a tile, the ground caught up. */
export const rule8 = Object.freeze({ search, pass, applyGround, touchLevelRange });

/** The 0-1 search from the landing at level L: every tile's step toward it over the fewest would-be-wet tiles. */
function search(M, T, L) {
  M.searches++;
  M.searched = L;
  const cols = T.cols, rows = T.rows, n = cols * rows;
  const base = T.base, flood = M.g.floodAt, cost = M.cost, step = M.step, dq = M.deque;
  const size = dq.length;
  cost.fill(0x3fffffff);
  step.fill(-1);
  let head = 0, tail = 0;
  const s = M.landing;
  cost[s] = 0; dq[tail] = s; tail = (tail + 1) % size;
  while (head !== tail) {
    const i = dq[head]; head = (head + 1) % size;
    const ci = cost[i], x = i % cols;
    for (let q = 0; q < 4; q++) {
      let j;
      if (q === 0) { if (x + 1 >= cols) continue; j = i + 1; }
      else if (q === 1) { if (x === 0) continue; j = i - 1; }
      else if (q === 2) { j = i + cols; if (j >= n) continue; }
      else { j = i - cols; if (j < 0) continue; }
      if (base[j] === 1) continue;          // pillars count as open: they fall again
      const w = flood[j] < L ? 1 : 0;
      const c = ci + w;
      if (c >= cost[j]) continue;
      cost[j] = c; step[j] = i;
      if (w === 0) { head = (head - 1 + size) % size; dq[head] = j; }
      else { dq[tail] = j; tail = (tail + 1) % size; }
    }
  }
}

function touch(M, i) {
  if (M.touchMark[i] === M.touchId) return;
  M.touchMark[i] = M.touchId;
  M.touched[M.touchedN++] = i;
}

/**
 * Walk the chain from your tile to the landing, and from every armed site's (M.siteTile: each
 * stops where it meets one already walked); hold their would-be-wet tiles, release the rest.
 */
function pass(M, T, ptile) {
  M.passes++;
  M.ptile = ptile;
  const flood = M.g.floodAt, L = M.level, step = M.step, held = M.held, mark = M.pathMark;
  const id = ++M.passId;
  const pillar = T.pillar, len = M.chain.length;
  let n = 0;
  if (step[ptile] >= 0 || ptile === M.landing) {
    for (let i = ptile, guard = 0; i >= 0 && guard < len; i = step[i], guard++) {
      mark[i] = id;
      if (pillar[i] === 1) M.pillarOnPath = true;
      if (flood[i] < L) M.chain[n++] = i;
    }
  }
  for (let k = 0; k < M.siteN; k++) {
    let i = M.siteTile[k];
    if (step[i] < 0 && i !== M.landing) continue;   // (a site on ground the search can't reach: none is, by the layout's own check)
    for (let guard = 0; i >= 0 && mark[i] !== id && guard < len; i = step[i], guard++) {
      mark[i] = id;
      if (pillar[i] === 1) M.pillarOnPath = true;
      if (flood[i] < L) M.chain[n++] = i;
    }
  }
  // Release what the old chain held and the new one doesn't, then hold the new chain.
  for (let k = 0; k < M.heldN; k++) {
    const i = M.heldList[k];
    if (mark[i] === id && flood[i] < L) continue;
    held[i] = 0; touch(M, i);
  }
  for (let k = 0; k < n; k++) {
    const i = M.chain[k];
    if (held[i] === 0) { held[i] = 1; touch(M, i); }
    M.heldList[k] = i;
  }
  M.heldN = n;
}

function releaseAll(M) {
  for (let k = 0; k < M.heldN; k++) { const i = M.heldList[k]; M.held[i] = 0; touch(M, i); }
  M.heldN = 0;
  M.ptile = -1;
  M.passId++;
}

/** Tiles whose height lies between the old level and the new: their water changes. */
function touchLevelRange(M, L0, L1) {
  const lo = Math.min(L0, L1), hi = Math.max(L0, L1);
  const o = M.g.order, f = M.g.firstAt;
  for (let k = f[lo]; k < f[hi]; k++) touch(M, o[k]);
}

/** Is tile i on the chain from your tile to the landing now? (A pillar never rises there.) */
export function onPath(world, i) {
  const M = world.marsh;
  return M !== null && M.level > 0 && M.pathMark[i] === M.passId;
}

/** The ground catches up: every touched tile takes the water it should have, then one refresh. */
function applyGround(world, M) {
  if (M.touchedN === 0 && !M.dirty) return;
  const T = world.terrain, wet = T.wet, flood = M.g.floodAt, held = M.held, L = M.level;
  let changed = M.dirty;
  for (let k = 0; k < M.touchedN; k++) {
    const i = M.touched[k];
    const want = flood[i] < L && held[i] === 0 ? 1 : 0;
    if (wet[i] !== want) { wet[i] = want; changed = true; }
  }
  M.touchedN = 0;
  M.touchId++;
  M.dirty = false;
  if (!changed) return;
  T.refresh();
  M.refreshes++;
  moveOffWater(world);
}

/** A glass pillar's tile changed (sim/storm.js): the ground takes it at the next rebuild. */
export function groundDirty(world) {
  if (world.marsh) world.marsh.dirty = true;
  else world.terrain.refresh(); // a map without water: at once (the Widow anywhere)
}

/**
 * After the ground changed: walkers on a tile that blocks them now move to the nearest bank; an
 * eel left on dry ground sinks into the mud (no kill); a chest, Reliquary, vault, or the open
 * Salt Well moves to dry ground.
 */
function moveOffWater(world) {
  const E = world.enemies, T = world.terrain, solid = T.solid, cols = T.cols, out = world.scratch.open;
  const swims = world.enemySwims;
  for (let i = 0; i < E.count; i++) {
    const f = E.flags[i];
    if ((f & (EF.DEAD | EF.SWARM)) !== 0) continue;
    const tx = Math.floor(E.x[i] / TILE), ty = Math.floor(E.y[i] / TILE);
    if (tx < 0 || ty < 0 || tx >= cols || ty >= T.rows) continue;
    const ti = ty * cols + tx, sw = swims[E.type[i]];
    if (sw === 2) {                                    // an eel: water only (mid-lunge it may be on the bank, while its creek holds water)
      if (T.dryWall[ti] === 1) {
        const st = E.aiState[i], out2 = (st === EEL.LUNGE || st === EEL.BACK) && T.waterAt(Math.floor(E.ax[i] / TILE), Math.floor(E.ay[i] / TILE));
        if (!out2) E.flags[i] = f | EF.DEAD | EF.VANISH | EF.RESOLVED;
      }
      continue;
    }
    const blocked = sw === 1 ? T.swimWall[ti] === 1 : solid[ti] === 1;
    if (!blocked || (f & EF.AIR) !== 0) continue;
    if (T.nearestOpen(tx, ty, out, 24)) { E.x[i] = E.px[i] = out[0]; E.y[i] = E.py[i] = out[1]; E.vx[i] = 0; E.vy[i] = 0; }
  }
  const P = world.pickups;
  for (let i = 0; i < P.count; i++) {
    if (!PK_STAYS.includes(P.kind[i]) || !T.blockedAt(P.x[i], P.y[i])) continue;
    if (T.nearestOpen(Math.floor(P.x[i] / TILE), Math.floor(P.y[i] / TILE), out, 24)) { P.x[i] = P.px[i] = out[0]; P.y[i] = P.py[i] = out[1]; }
  }
  if (world.allies) world.allies.offWater(world);
  // The Salt Well, like a chest: an open well the water reaches moves to dry ground.
  const Wl = world.well;
  if (Wl && Wl.open && T.blockedAt(Wl.x, Wl.y) && T.nearestOpen(Math.floor(Wl.x / TILE), Math.floor(Wl.y / TILE), out, 24)) { Wl.x = out[0]; Wl.y = out[1]; }
}

/** Herb beds you walk over at low water: Marsh Herbs, the bed emptied for the run. */
function herbsStep(world, M, p) {
  const T = world.terrain, cols = T.cols, wet = T.wet;
  const reach = TILE * 0.75 + world.tuning.player.pickupRadius;
  for (let k = 0; k < M.herbTile.length; k++) {
    if (M.herbLeft[k] === 0) continue;
    const i = M.herbTile[k];
    if (wet[i] === 1) continue;
    const x = (i % cols + 0.5) * TILE, y = (Math.floor(i / cols) + 0.5) * TILE;
    const dx = p.x - x, dy = p.y - y;
    if (dx * dx + dy * dy > reach * reach) continue;
    const amount = M.herbLeft[k];
    M.herbLeft[k] = 0;
    M.herbsPicked += amount;
    const mi = world.materialIndex.get('marsh_herbs');
    if (mi !== undefined) addMaterial(world, mi, amount);
    world.events.push(EV.PICKUP, x, y, PK.MATERIAL, mi ?? 0);
    world.events.push(EV.HERB, x, y, amount, k);
    sightThing(world, SIGHT.HERBS);
  }
}

/** The water now, for the HUD and the view: { level, phase, high (a share 0..1 of high water) }. */
export function waterNow(world) {
  const M = world.marsh;
  if (!M) return null;
  return { level: M.level, phase: M.phase, high: Math.min(1, M.level / HIGH) };
}

/** Hash the Marsh's state (world.js hashWorld). */
export function hashMarsh(M, h) {
  h.int(-11).int(M.level).int(M.phase).int(M.heldN).int(M.herbsPicked).int(M.siteSig);
  for (let k = 0; k < M.heldN; k++) h.int(M.heldList[k]);
  for (let k = 0; k < M.herbLeft.length; k++) h.int(M.herbLeft[k]);
}
