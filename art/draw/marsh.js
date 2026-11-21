// The Salt Marsh's ground (0.8.0), drawn in code: the 1-Bit Pack has no salt crust, creek mud,
// club-rush, or jetty. The ground is always darker and lower in contrast than every actor (§16.4),
// so every walkable tile keeps its own lightest and darkest pixels under 1.5:1 apart, in night-1
// to night-4 (the salt the palest ground on the map, a grey, never white). One light, from the top
// left like the rest of the art: what stands up is lit on that side and shadowed on the far side.
// Line weights: 1 px for every crack, ridge, seam, stem, and shadow; nothing thicker.
//
// What each was checked against (written references; image search gave nothing back):
//   Salt crust: a salt pan's crust breaks into rough pentagons and hexagons, Voronoi-like; the
//     cracks' junctions open toward 120 degrees as the pattern matures; salt builds up along each
//     crack into a low ridge, which catches the light on one side and shades the other.
//   Creek mud: a tidal creek's bed at low water is ripple-marked, the crests running across the
//     flow and broken, with water left standing in the troughs; birds' tracks cross it. A heron's
//     print: three long toes forward, spread, and a short hind toe behind (herons print all four).
//   Club-rush (sea club-rush): stiff, three-sided stems in clumps from a rhizome, up to about
//     1.5 m, a tight round head of brown spikelets at the top of the tall ones.
//   Jetty: deck boards laid across the jetty over joists that run along it, a gap between boards,
//     nails in pairs over each joist, the sawn ends lit where they stand out, its shadow below.
//   Peat: dark, fibrous, roots and moss through it. Causeway: big flat stones laid close, the
//     joints dark. Water at night: nearly black, short broken crests; a bank's lip along its edge
//     and, under the north and west banks, the bank's own shadow on the water.

import { blank, setPx, fillRect } from '../../src/render/pixels.js';
import { createRng } from '../../src/lib/rng.js';

const T = 16;
const PLATE = 'night-3', RIDGE = 'night-4', SHADE = 'night-2';

/** A 1 px line, Bresenham, calling fn(x, y) on each pixel. */
function walk(x0, y0, x1, y1, fn) {
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    fn(x0, y0);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

// ---------------------------------------------------------------- salt

/**
 * Where the crust's cracks cross a tile's edges: the same points on every tile (the top's 5 meets
 * the bottom's 5 of the tile above, the left's 10 the right's 10), so the network runs on across
 * tiles; inside, each variant joins them through its own two junctions, so the plates never line
 * up into the grid.
 */
const EDGE = Object.freeze({ T: [5, 0], B: [5, 15], L: [0, 10], R: [15, 10] });
const SALT_NETS = [
  // [junction 1, junction 2, segments as pairs of point names]
  { J1: [4, 5], J2: [10, 11], seg: [['T', 'J1'], ['L', 'J1'], ['J1', 'J2'], ['J2', 'R'], ['J2', 'B']] },
  { J1: [9, 4], J2: [5, 11], seg: [['T', 'J1'], ['J1', 'R'], ['J1', 'J2'], ['L', 'J2'], ['J2', 'B']] },
  { J1: [11, 6], J2: [3, 7], seg: [['T', 'J2'], ['J2', 'J1'], ['J1', 'R'], ['L', 'J2'], ['J1', 'B']] },
  { J1: [8, 5], J2: [6, 12], seg: [['T', 'J1'], ['J1', 'R'], ['J1', 'J2'], ['L', 'J2'], ['J2', 'B']] },
];
export const SALT_VARIANTS = SALT_NETS.length;

/** The salt crust's plates and ridges on a frame (other tiles draw salt under what they add). */
function crust(f, variant) {
  const net = SALT_NETS[variant % SALT_NETS.length];
  const P = { ...EDGE, J1: net.J1, J2: net.J2 };
  fillRect(f, 0, 0, T, T, PLATE);
  const ridge = new Uint8Array(T * T);
  const shade = [];
  for (const [a, b] of net.seg) {
    const [x0, y0] = P[a], [x1, y1] = P[b];
    const flat = Math.abs(x1 - x0) >= Math.abs(y1 - y0);
    walk(x0, y0, x1, y1, (x, y) => { ridge[y * T + x] = 1; shade.push(flat ? [x, y + 1] : [x + 1, y]); });
  }
  // The shadow first (on the far side from the light), then the ridge over it.
  for (const [x, y] of shade) if (x < T && y < T && !ridge[y * T + x]) setPx(f, x, y, SHADE);
  for (let i = 0; i < T * T; i++) if (ridge[i]) setPx(f, i % T, (i / T) | 0, RIDGE);
  // A few crystals catching the light on the plates.
  const rng = createRng(`marsh-salt-${variant}`);
  for (let k = 0; k < 3; k++) {
    const x = 1 + rng.int(T - 2), y = 1 + rng.int(T - 2);
    if (!ridge[y * T + x]) setPx(f, x, y, RIDGE);
  }
  return f;
}

/** Salt flats: the crust in plates, the cracks pushed up into ridges. */
export function salt(variant = 0) {
  return crust(blank('m_salt', T, T), variant);
}

// ---------------------------------------------------------------- mud

/**
 * A creek bed at low water: broken ripple crests across the flow, water standing in the troughs.
 * `across` 'h' lays the crests left to right (a creek running north to south), 'v' top to bottom.
 * `variant` 3 and 4 carry a heron's print, each in its own spot.
 */
export function mud(variant = 0, across = 'h') {
  const f = blank('m_mud', T, T);
  fillRect(f, 0, 0, T, T, 'night-2');
  const rng = createRng(`marsh-mud-${variant}`);
  const put = (a, b, c) => (across === 'h' ? setPx(f, a, b, c) : setPx(f, b, a, c));
  // Crests every 4 px, each broken into two or three pieces, wavering a pixel; the trough below
  // each crest holds a little water.
  for (let row = 0; row < 4; row++) {
    const b0 = row * 4 + 1 + (variant % 2);
    let a = rng.int(4);
    while (a < T) {
      // A crest piece, then a gap; one piece in three has water pooled in the trough below it.
      const len = 2 + rng.int(4), lift = rng.chance(0.4) ? -1 : 0, pool = rng.chance(0.33);
      for (let k = 0; k < len && a + k < T; k++) {
        const b = (b0 + (k === len - 1 ? lift : 0) + T) % T;
        put(a + k, b, 'night-3');
        if (pool && k > 0 && k < len - 1) put(a + k, (b + 2) % T, 'sea-1');
      }
      a += len + 2 + rng.int(4);
    }
  }
  // Prints on two frames only, each in its own spot, so a creek never shows them in a row.
  if (variant === 3) heronPrint(f, 5, 10);
  if (variant === 4) heronPrint(f, 11, 6);
  return f;
}

/** A heron's print pressed into the mud at (x, y) (the heel): three toes forward, the hind toe back. */
function heronPrint(f, x, y) {
  const c = 'night-1';
  for (const [dx, dy] of [[0, -1], [0, -2], [0, -3], [0, -4], [-1, -1], [-2, -2], [-3, -3], [1, -1], [2, -2], [3, -3], [0, 1]]) setPx(f, x + dx, y + dy, c);
}

// ---------------------------------------------------------------- reeds

/**
 * Club-rush on the flats: clumps of stiff stems fanning from one root, a pale head on the tall
 * ones. Darker than the salt they stand in (they're plants at night, not salt). Each variant puts
 * its clumps somewhere else in the tile, so a bed never reads as a tuft a tile.
 */
const REED_CLUMPS = [
  // [root x, root y, stems]: each tile roots one clump low and one or two higher up, so a bed's
  // stems fill it evenly instead of banding into a strip a tile row.
  [[4, 15, 4], [11, 8, 3]],
  [[9, 15, 5], [3, 7, 3]],
  [[3, 15, 4], [12, 11, 3], [7, 6, 2]],
  [[12, 15, 4], [5, 10, 4]],
];
export const REED_VARIANTS = REED_CLUMPS.length;

export function reeds(variant = 0) {
  const f = crust(blank('m_reeds', T, T), variant);
  const rng = createRng(`marsh-reeds-${variant}`);
  for (const [rx, ry, n] of REED_CLUMPS[variant % REED_CLUMPS.length]) {
    // Stems lean out from the root by how far from the middle they stand, the tallest in the middle.
    for (let k = 0; k < n; k++) {
      const lean = k - (n - 1) / 2;
      // Each stem its own height, kept inside the tile by its root (never cut flat at the tile's top).
      const room = ry - 2 - rng.int(3);
      const tall = Math.min(room, 7 + Math.round((1 - Math.abs(lean) / n) * 5) + rng.int(2));
      const tx = Math.round(rx + lean * 2.4), ty = ry - tall;
      walk(rx, ry, tx, ty, (x, y) => setPx(f, x, y, 'night-1'));
      if (tall >= 9) { setPx(f, tx, ty, 'night-4'); setPx(f, tx, ty + 1, 'night-4'); setPx(f, tx + 1, ty + 1, 'night-4'); }
    }
    setPx(f, rx - 1, ry + 1, 'night-2'); setPx(f, rx, ry + 1, 'night-2'); setPx(f, rx + 1, ry + 1, 'night-2'); // the root's shadow
  }
  return f;
}

// ---------------------------------------------------------------- peat, stumps, causeway

/** A peat island: dark and fibrous, roots and moss through it. */
export function peat(variant = 0) {
  const f = blank('m_peat', T, T);
  fillRect(f, 0, 0, T, T, 'night-2');
  const rng = createRng(`marsh-peat-${variant}`);
  for (let k = 0; k < 9; k++) {
    const x = rng.int(T), y = rng.int(T), len = 2 + rng.int(3), d = rng.chance(0.5) ? 1 : -1;
    for (let j = 0; j < len; j++) setPx(f, (x + j * d + T) % T, (y + (j >> 1)) % T, 'wood-1');
  }
  for (let k = 0; k < 4; k++) setPx(f, rng.int(T), rng.int(T), 'moss-1');
  for (let k = 0; k < 2; k++) { const x = rng.int(T - 1), y = rng.int(T); setPx(f, x, y, 'night-1'); setPx(f, x + 1, y, 'night-1'); }
  return f;
}

/**
 * A dead stump standing on the salt (solid). A tree dead in a salt marsh weathers silver-grey and
 * snaps rather than being sawn: a ragged top, the broken wood paler inside the bark, the trunk
 * flaring into roots at the foot. Seen from in front and a little above, lit from the top left.
 */
export function stump(variant = 0) {
  const f = variant === 1 ? peat(0) : salt(variant);
  f.id = 'm_stump';
  // Rows of the stump, top to bottom: x from, x to (inclusive). It fills the tile it blocks.
  const rows = [[5, 9], [4, 11], [3, 11], [3, 11], [3, 11], [3, 12], [3, 12], [2, 12], [2, 13], [1, 14], [0, 15]];
  const top = 3;
  rows.forEach(([a, b], k) => {
    for (let x = a; x <= b; x++) setPx(f, x, top + k, 'night-4');
    setPx(f, a, top + k, 'night-5');                        // lit edge (left)
    setPx(f, b, top + k, 'night-2');                        // shaded edge (right)
  });
  // The broken top: splinters standing up, the wood inside paler than the bark.
  for (const [x, y] of [[5, -1], [6, -2], [7, -1], [9, -2], [10, -1], [8, -1]]) setPx(f, x, top + y, 'night-5');
  for (let x = 5; x <= 10; x++) setPx(f, x, top + 1, 'night-5');
  for (let x = 6; x <= 9; x++) setPx(f, x, top + 2, 'night-5');
  // Bark furrows running down, and the gaps between the roots at the foot.
  for (const x of [5, 8, 10]) for (let y = 4; y <= 8; y++) setPx(f, x, top + y, 'night-2');
  for (const x of [3, 7, 12]) { setPx(f, x, top + 9, 'night-2'); setPx(f, x, top + 10, 'night-2'); }
  // Its shadow on the ground below.
  for (let x = 1; x <= 15; x++) setPx(f, x, top + 11, 'night-1');
  return f;
}

/** The Drowned Causeway: big flat stones laid close, the joints dark, each stone lit top left. */
export function causeway(variant = 0) {
  const f = blank('m_causeway', T, T);
  fillRect(f, 0, 0, T, T, 'night-1');
  const stones = variant === 1
    ? [[0, 0, 6, 5], [7, 0, 9, 6], [0, 6, 4, 5], [5, 7, 6, 4], [12, 7, 4, 5], [0, 12, 8, 4], [9, 12, 7, 4]]
    : [[0, 0, 8, 4], [9, 0, 7, 6], [0, 5, 5, 6], [6, 5, 5, 5], [12, 7, 4, 5], [0, 12, 6, 4], [7, 11, 9, 5]];
  for (const [x, y, w, h] of stones) {
    fillRect(f, x, y, w - 1, h - 1, 'night-3');
    fillRect(f, x, y, w - 1, 1, 'night-4');
    fillRect(f, x, y, 1, h - 1, 'night-4');
  }
  return f;
}

// ---------------------------------------------------------------- boardwalks and the landing

/**
 * Boards laid across a walkway: `dir` 'h' boards running left to right (a walkway crossing north
 * to south), 'v' boards running top to bottom. Four boards a tile, a gap between them, nails in
 * pairs over the two joists; `end` lights the sawn ends on one side ('e' or 's', where the boards
 * stop over open water) with the jetty's shadow on the far edge.
 */
export function boards(dir = 'h', end = '', id = 'm_boards') {
  const f = blank(id, T, T);
  const put = (a, b, c) => (dir === 'h' ? setPx(f, a, b, c) : setPx(f, b, a, c));
  for (let b = 0; b < T; b++) for (let a = 0; a < T; a++) {
    const k = b % 4;
    put(a, b, k === 3 ? 'night-2' : 'night-3');
  }
  // A nail a board over each joist (the nails' pairs are a pixel apart: one shows at this size).
  for (const a of [3, 12]) for (let row = 0; row < 4; row++) put(a, row * 4 + 1, 'night-2');
  if (end === 'e') { for (let y = 0; y < T; y++) if (y % 4 !== 3) setPx(f, T - 1, y, 'night-4'); }
  if (end === 's') { for (let x = 0; x < T; x++) if (x % 4 !== 3) setPx(f, x, T - 1, 'night-4'); }
  return f;
}

export function boardwalk(dir = 'h') { return boards(dir, '', 'm_boardwalk'); }
export function landing(end = '') { return boards('v', end, 'm_landing'); }

// ---------------------------------------------------------------- water

/**
 * Water over the creek (high water) or a deep pool: nearly black, a few short broken crests.
 * `banks` is a 4-bit mask of the dry sides it meets (1 north, 2 east, 4 south, 8 west): each has
 * its lip, and under the north and west banks (the lit side) the bank's shadow lies on the water.
 */
export function water(variant = 0, banks = 0, deep = false) {
  const f = blank(deep ? 'm_deep' : 'm_water', T, T);
  fillRect(f, 0, 0, T, T, deep ? 'night-0' : 'night-1');
  const rng = createRng(`marsh-water-${variant}-${deep ? 1 : 0}`);
  // One to three crests, each in its own band of the tile (so no two frames line theirs up).
  const n = deep ? 1 + (variant % 2) : 1 + (variant % 3);
  for (let k = 0; k < n; k++) {
    const x = rng.int(T), y = 2 + Math.floor(((k + variant * 0.37) % n) * ((T - 4) / n)) + rng.int(3), len = 2 + rng.int(3);
    for (let j = 0; j < len; j++) setPx(f, (x + j) % T, y + (j === len - 1 && rng.chance(0.5) ? 1 : 0), deep ? 'night-2' : 'sea-1');
  }
  if (deep) return deepShore(f, banks, rng);
  if (banks & 1) { fillRect(f, 0, 1, T, 1, 'night-0'); fillRect(f, 0, 0, T, 1, 'night-3'); }
  if (banks & 8) { fillRect(f, 1, 0, 1, T, 'night-0'); fillRect(f, 0, 0, 1, T, 'night-3'); }
  if (banks & 2) fillRect(f, T - 1, 0, 1, T, 'night-3');
  if (banks & 4) fillRect(f, 0, T - 1, T, 1, 'night-3');
  return f;
}

/**
 * A deep pool's shore (0.9.0, the veteran round: the landing's pool read as a flat black square,
 * a missing texture). A peat pool's margin is soft, wet mud running down into the water, never a
 * ruled line: on each dry side a band of mud 2 or 3 px deep (its depth wanders along the edge),
 * dark and wet where it meets the water, and a pale glint on the water's skin just off the lit
 * north and west banks. No picture came back from the image search; this goes by that written
 * description.
 */
function deepShore(f, banks, rng) {
  // How far the bank reaches into the tile along each side: 2 to 4 px, wandering a pixel at a time.
  const depth = new Uint8Array(T);
  let d = 2 + rng.int(2);
  for (let i = 0; i < T; i++) { d = Math.max(2, Math.min(4, d + rng.int(3) - 1)); depth[i] = d; }
  const dry = new Uint8Array(T * T);   // 1 where the bank's mud lies
  const reach = (x, y) => {
    let r = 0;
    if (banks & 1) r = Math.max(r, depth[x] - y);
    if (banks & 4) r = Math.max(r, depth[x] - (T - 1 - y));
    if (banks & 8) r = Math.max(r, depth[y] - x);
    if (banks & 2) r = Math.max(r, depth[y] - (T - 1 - x));
    // Where two banks meet, the corner rounds off (a pool has no square corners).
    const cx = banks & 8 ? x : banks & 2 ? T - 1 - x : -1, cy = banks & 1 ? y : banks & 4 ? T - 1 - y : -1;
    const R = 10;
    if (cx >= 0 && cy >= 0 && cx < R && cy < R && Math.hypot(R - cx, R - cy) > R - 2) r = Math.max(r, 1);
    return r;
  };
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) if (reach(x, y) > 0) dry[y * T + x] = 1;
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const i = y * T + x;
      if (dry[i]) {
        // The mud: drier (lighter) away from the water, wet and dark at its edge.
        const edge = (x > 0 && !dry[i - 1]) || (x < T - 1 && !dry[i + 1]) || (y > 0 && !dry[i - T]) || (y < T - 1 && !dry[i + T]);
        setPx(f, x, y, edge ? 'night-2' : 'night-3');
        continue;
      }
      // Shallows: the water off the bank is a step less black, and on the lit sides (north and
      // west) its skin catches a glint here and there.
      const nearN = y > 0 && dry[i - T], nearW = x > 0 && dry[i - 1];
      const near = nearN || nearW || (y < T - 1 && dry[i + T]) || (x < T - 1 && dry[i + 1]);
      if (near) setPx(f, x, y, (nearN || nearW) && (x * 7 + y * 3) % 4 !== 0 ? 'sea-1' : 'night-1');
    }
  }
  return f;
}
