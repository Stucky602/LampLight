// The harbor's pieces that Tiny Town doesn't have, drawn in code in its style (ARCHITECTURE §16.1,
// §16.5): full color, flat fills lit from the top left, a dark night-0 edge where a thing meets
// what's behind it. Also the stages a building goes through (a ruin, boarded windows, lit ones),
// done to the pack's own building tiles, and the scaffold that goes up on the way. Each drawing
// names the real thing it was checked against.
//
// Everything here returns frames ({ id, w, h, rgba }, src/render/pixels.js) in palette colors.

import { blank, setPx, fillRect, stamp, outlined } from '../../src/render/pixels.js';
import { createRng } from '../../src/lib/rng.js';

const TILE = 16;

/** Letters for the drawings written as text rows. */
const LEGEND = Object.freeze({
  K: 'night-0', k: 'night-1', d: 'night-2', n: 'night-3', D: 'night-4', N: 'night-5',
  p: 'fog-1', f: 'fog-2', F: 'fog-3', g: 'fog-4', G: 'fog-5',
  1: 'wood-1', 2: 'wood-2', 3: 'wood-3', 4: 'wood-4',
  l: 'lamp-2', L: 'lamp-3', y: 'lamp-4', Y: 'lamp-5', W: 'lamp-6',
  r: 'rot-1', R: 'rot-2', o: 'rot-3', O: 'rot-4',
  m: 'moss-2', M: 'moss-3', h: 'moss-4', s: 'sea-1', S: 'sea-2', t: 'sea-3', T: 'sea-4',
});

/** A frame from rows of LEGEND letters ('.' is empty). */
export function paint(id, rows) {
  const w = rows[0].length;
  const f = blank(id, w, rows.length);
  rows.forEach((row, y) => {
    if (row.length !== w) throw new Error(`${id}: row ${y} is ${row.length} wide, not ${w}`);
    for (let x = 0; x < w; x++) {
      const c = row[x];
      if (c === '.') continue;
      const name = LEGEND[c];
      if (!name) throw new Error(`${id}: no color for "${c}" at ${x}, ${y}`);
      setPx(f, x, y, name);
    }
  });
  return f;
}

function line(f, x0, y0, x1, y1, c) {
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    setPx(f, x0, y0, c);
    if (x0 === x1 && y0 === y1) return;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

/** Fill a triangle (pixel centers inside it). */
function tri(f, [ax, ay], [bx, by], [cx, cy], c) {
  const x0 = Math.floor(Math.min(ax, bx, cx)), x1 = Math.ceil(Math.max(ax, bx, cx));
  const y0 = Math.floor(Math.min(ay, by, cy)), y1 = Math.ceil(Math.max(ay, by, cy));
  const side = (px, py, qx, qy, rx, ry) => (qx - px) * (ry - py) - (qy - py) * (rx - px);
  const area = side(ax, ay, bx, by, cx, cy);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const px = x + 0.5, py = y + 0.5;
    const w0 = side(bx, by, cx, cy, px, py), w1 = side(cx, cy, ax, ay, px, py), w2 = side(ax, ay, bx, by, px, py);
    if (area > 0 ? (w0 >= 0 && w1 >= 0 && w2 >= 0) : (w0 <= 0 && w1 <= 0 && w2 <= 0)) setPx(f, x, y, c);
  }
}

// ---------------------------------------------------------------- the sea, the pier, the quay

/**
 * The harbor's water at night, three frames of a slow swell. Checked against harbor water seen
 * from above after dark: nearly black, with short broken crests that catch what light there is,
 * spaced unevenly and drifting; never a regular pattern of stripes. Tiles seamlessly.
 */
export function water(k) {
  const f = blank(`hub_water_${k}`, TILE, TILE);
  fillRect(f, 0, 0, TILE, TILE, 'sea-1');
  const crests = [[1, 2, 4], [9, 4, 3], [5, 8, 5], [12, 11, 3], [0, 14, 3]];
  crests.forEach(([x, y, len], i) => {
    const shift = k * 2 + (i % 2);                          // each frame the crests drift east
    const n = len - ((k + i) % 3 === 2 ? 1 : 0);            // and breathe a little
    for (let j = 0; j < n; j++) setPx(f, (x + j + shift) % TILE, y, 'sea-2');
    if ((i + k) % 2 === 0) setPx(f, (x + shift + 1) % TILE, y, 'sea-3');   // a glint on some
  });
  return f;
}

/**
 * The pier's deck, `side` 'l' or 'r' (its west and east halves), with a piling at the edge when
 * `post`. Checked against a timber pier from above: the deck boards run ACROSS the pier (they
 * sit on stringers that run along it), a board spans the whole width, the seams between boards
 * show dark, nails come in rows over the stringers, and the pilings stand up along the outside
 * edges with their round tops showing.
 */
export function pier(side, post) {
  const f = blank(`hub_pier_${side}${post ? '_post' : ''}`, TILE, TILE);
  for (let row = 0; row < 4; row++) {
    const y = row * 4;
    fillRect(f, 0, y, TILE, 3, 'wood-3');
    fillRect(f, 0, y, TILE, 1, 'wood-4');                     // the board's lit edge
    fillRect(f, 0, y + 3, TILE, 1, 'wood-1');                 // the seam
    const nx = side === 'l' ? 3 : 12;                           // nails over the stringer
    setPx(f, nx, y + 1, 'wood-1');
  }
  const edge = side === 'l' ? 0 : TILE - 1;
  const inner = side === 'l' ? 1 : TILE - 2;
  fillRect(f, edge, 0, 1, TILE, 'night-0');                   // the deck's edge against the water
  fillRect(f, inner, 0, 1, TILE, 'wood-2');                    // the edge beam
  if (post) {
    const px = side === 'l' ? 0 : TILE - 4;
    const top = paint('post', ['.KK.', 'K43K', 'K32K', '.KK.']);
    stamp(f, top, px, 6);
  }
  return f;
}

/**
 * The quay's paving, two variants. Checked against a harbor quay: big rectangular granite setts in
 * courses, the joints staggered from one course to the next, worn smooth and lighter on their top
 * edges.
 */
export function quay(variant) {
  const f = blank(`hub_quay_${variant}`, TILE, TILE);
  fillRect(f, 0, 0, TILE, TILE, 'night-5');
  const joints = variant === 0 ? [[5, 13], [9]] : [[2, 10], [6, 14]];
  for (let course = 0; course < 2; course++) {
    const y = course * 8;
    fillRect(f, 0, y + 7, TILE, 1, 'night-3');                 // the course joint
    fillRect(f, 0, y, TILE, 1, 'fog-1');                       // worn top edges
    for (const x of joints[course]) { fillRect(f, x, y, 1, 7, 'night-3'); setPx(f, x + 1, y, 'fog-1'); }
  }
  if (variant === 1) { setPx(f, 11, 3, 'night-4'); setPx(f, 12, 4, 'night-4'); }   // a chip
  return f;
}

/**
 * The square's paving, two variants. Checked against an old cobbled square: small granite setts
 * laid in rows, each row's joints offset from the last (running bond), the stones' tops worn pale
 * at one edge, one stone in a few darker, and moss in the joints where feet don't go. Granite is
 * pale: the stones are the lightest ground in the town, so the lamp's pool shows on them (the
 * light map darkens everything past its reach). Tiles seamlessly both ways.
 */
export function setts(variant) {
  const f = blank(`hub_setts_${variant}`, TILE, TILE);
  fillRect(f, 0, 0, TILE, TILE, 'night-4');                   // the joints
  const rng = createRng(`setts-${variant}`);
  for (let row = 0; row < 4; row++) {
    const y = row * 4, off = (row % 2) * 2;
    for (let k = 0; k < 4; k++) {
      const x = k * 4 + off;
      const body = rng.int(5) === 0 ? 'night-5' : 'fog-1';
      for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) setPx(f, (x + dx) % TILE, y + dy, body);
      setPx(f, x % TILE, y, 'fog-2');
      if (rng.int(3) === 0) setPx(f, (x + 1) % TILE, y, 'fog-2');
    }
    if (rng.int(2) === 0) setPx(f, rng.int(TILE), y + 3, 'moss-2');
  }
  return f;
}

/**
 * The rocks of the headland past the quay, four variants. Checked against a rocky shore from
 * above: rounded boulders of every size packed together (never a grid), each lit on its upper
 * left and shadowed underneath with a dark rim where it curves away, dark cracks between them, a
 * little weed in the cracks. The boulders cross the tile's edges and wrap round, so the tiles
 * join into one field of rock.
 */
export function rock(variant) {
  const f = blank(`hub_rock_${variant}`, TILE, TILE);
  const rng = createRng(`rock-${variant}`);
  const stones = [];
  for (let i = 0; i < 5; i++) stones.push({ x: rng.int(TILE), y: rng.int(TILE), rx: 3 + rng.int(5), ry: 2.5 + rng.int(4) });
  const wrap = (d) => ((((d + TILE / 2) % TILE) + TILE) % TILE) - TILE / 2;
  const L = [-0.55, -0.55, 0.63];   // the light: from the upper left, above
  const cracks = [];
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
    // The boulder standing highest here owns the pixel; where two meet (or none reaches), a crack.
    let best = 0, second = 0, ux = 0, uy = 0;
    for (const st of stones) {
      const ax = wrap(x + 0.5 - st.x) / st.rx, ay = wrap(y + 0.5 - st.y) / st.ry;
      const hgt = 1 - (ax * ax + ay * ay);
      if (hgt > best) { second = best; best = hgt; ux = ax; uy = ay; } else if (hgt > second) second = hgt;
    }
    if (best <= 0.04 || best - second < 0.08) { setPx(f, x, y, 'night-2'); cracks.push([x, y]); continue; }
    if (best < 0.2) { setPx(f, x, y, 'night-3'); continue; }        // the rim, curving away
    const z = Math.sqrt(Math.max(0, 1 - ux * ux - uy * uy));
    const shade = (ux * L[0] + uy * L[1] + z * L[2]) / Math.hypot(ux, uy, z);
    setPx(f, x, y, shade > 0.85 ? 'fog-2' : shade > 0.55 ? 'fog-1' : shade > 0.2 ? 'night-5' : 'night-4');
  }
  for (let i = 0; i < 2 && cracks.length; i++) { const [x, y] = cracks[rng.int(cracks.length)]; setPx(f, x, y, i ? 'moss-1' : 'moss-2'); }
  return f;
}

/**
 * The town's lamp on the square, the one still lit when the game starts; `lit` false draws the
 * glass barely glowing (the Lamp Post before its first level). Checked against a cast-iron street
 * lamp: a four-sided lantern with a domed cap and a finial, glazing bars between the panes, a cone
 * under the lantern, the ladder bar a lamplighter leans a ladder on, a tall column with a collar,
 * and a stepped plinth at the foot, wider than the column. (The title's lamp is the same design,
 * smaller.)
 */
export function townLamp(lit) {
  const rows = [
    '......K......',
    '.....KfK.....',
    '....KNfNK....',
    '...KNNfNNK...',
    '..KKKKKKKKK..',
    '..KaKaaaKaK..',
    '..KaKaaaKaK..',
    '..KbKbabKbK..',
    '..KbKbbbKbK..',
    '..KcKcbcKcK..',
    '..KcKcccKcK..',
    '..KKKKKKKKK..',
    '...KNNfNNK...',
    '....KNfNK....',
    '.....KfK.....',
    'KKKKKKfKKKKKK',
    'KNNNNNfNNNNNK',
    'KKKKKKfKKKKKK',
  ];
  for (let i = 0; i < 18; i++) rows.push('....KfNNK....');
  rows.push('...KKfNNKK...', '...KNfNNNK...', '..KKKKKKKKK..', '..KNNfNNNNK..', '.KNNNfNNNNNK.', '.KKKKKKKKKKK.');
  const glass = lit ? { a: 'W', b: 'Y', c: 'y' } : { a: 'L', b: 'l', c: 'l' };
  return paint(lit ? 'hub_lamp' : 'hub_lamp_dim', rows.map((r) => r.replace(/[abc]/g, (m) => glass[m])));
}

/**
 * The sea wall: the quay's edge seen from above the water. Checked against a stone harbor wall:
 * a course of long coping stones on top, then the face in rough courses, darker and wet toward
 * the waterline, with a line of weed where the tide sits.
 */
export function seaWall(variant) {
  const f = blank(`hub_wall_${variant}`, TILE, TILE);
  fillRect(f, 0, 0, TILE, 4, 'fog-1');                         // the coping
  fillRect(f, 0, 0, TILE, 1, 'fog-2');
  fillRect(f, 0, 3, TILE, 1, 'night-3');
  setPx(f, variant ? 10 : 4, 1, 'night-3'); setPx(f, variant ? 10 : 4, 2, 'night-3');
  fillRect(f, 0, 4, TILE, 12, 'night-4');                      // the face
  const offs = variant ? [3, 11] : [7, 15];
  for (let c = 0; c < 3; c++) {
    const y = 4 + c * 4;
    fillRect(f, 0, y + 3, TILE, 1, 'night-3');
    const x = (offs[c % 2] + c * 3) % TILE;
    fillRect(f, x, y, 1, 3, 'night-3');
  }
  fillRect(f, 0, 13, TILE, 3, 'night-3');                      // wet near the water
  for (let x = variant; x < TILE; x += 3) setPx(f, x, 14, 'moss-1');
  return f;
}

// ---------------------------------------------------------------- the boat

/**
 * The boat newcomers arrive in, sailing east (the bow is on the right). Checked against a small
 * gaff-less fishing boat under sail: a hull whose top edge (the sheer) sweeps up toward the bow
 * and the stern, a single mast about as tall as the hull is long, a triangular mainsail aft of
 * the mast along a boom, a smaller jib forward, a lantern at the stern, and the hull dark at the
 * waterline.
 */
export function boat() {
  const W = 34, H = 26;
  const f = blank('hub_boat', W, H);
  const mast = 16;
  // Sails first (the mast and the hull go over them).
  tri(f, [mast - 1, 2], [mast - 1, 17], [4, 17], 'fog-4');       // mainsail
  tri(f, [mast + 1, 5], [mast + 1, 17], [26, 17], 'fog-3');      // jib
  line(f, mast - 2, 4, 6, 16, 'fog-3');                          // the mainsail's trailing edge in shade
  for (let y = 8; y <= 16; y += 4) line(f, mast - 2, y, mast - 2 - Math.round((y - 2) * 0.72), y, 'fog-3'); // seams
  fillRect(f, mast, 1, 1, 18, 'wood-2');                         // the mast
  fillRect(f, 4, 17, mast - 3, 1, 'wood-2');                     // the boom
  fillRect(f, mast + 1, 1, 3, 1, 'rot-3');                       // the flag, streaming forward
  setPx(f, mast + 1, 2, 'rot-2');
  // The hull.
  const sheer = (x) => 19 - (x < 4 ? 4 - x : 0) * 0.5 - (x > 26 ? (x - 26) * 0.9 : 0);
  for (let x = 1; x <= 31; x++) {
    const top = Math.round(sheer(x));
    const bottom = 24 - (x < 3 ? 3 - x : 0) - (x > 24 ? Math.round((x - 24) * 0.7) : 0);
    for (let y = top; y <= bottom; y++) setPx(f, x, y, y === top ? 'wood-4' : y >= bottom - 1 ? 'wood-1' : y === top + 2 ? 'wood-2' : 'wood-3');
  }
  // The stern lantern on its post.
  fillRect(f, 3, 13, 1, 5, 'night-0');
  const lamp = paint('l', ['KKK', 'KYK', 'KWK', 'KKK']);
  stamp(f, lamp, 2, 10);
  return outlined(f, 'night-0', 'hub_boat');
}

// ---------------------------------------------------------------- buildings and their stages

/**
 * Where a building's windows, doors, and open doorways are: from its layout (the pack's window
 * tiles 84 and 88, door tiles 85 and 89, and open doorways 74 and 78, cut through to what's behind).
 */
export function openings(layout) {
  const windows = [], doors = [], open = [];
  layout.forEach((row, ty) => row.forEach((cell, tx) => {
    const t = typeof cell === 'object' && cell ? cell.t : cell;
    if (t === 84 || t === 88) windows.push([tx, ty]);
    if (t === 85 || t === 89) doors.push([tx, ty]);
    if (t === 74 || t === 78) open.push([tx, ty]);
  }));
  return { windows, doors, open };
}

/**
 * The pack's open doorways (tiles 74 and 78) are cut through to whatever is behind them: in a
 * building, the dark inside. Fills their see-through pixels with night-1 (the sill a step lighter).
 */
export function fillDoorways(f, layout) {
  for (const [tx, ty] of openings(layout).open) {
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
      const px = tx * TILE + x, py = ty * TILE + y;
      if (f.rgba[(py * f.w + px) * 4 + 3] === 0) setPx(f, px, py, y === TILE - 1 ? 'night-2' : 'night-1');
    }
  }
  return f;
}

// The glass in the pack's window tiles (84, 88): two panes, x 5-6 and 9-10, y 5 to 10.
const PANES = [[5, 5], [6, 5], [9, 5], [10, 5]];
function eachPane(f, [tx, ty], fn) {
  for (const [x0] of PANES) for (let y = 5; y <= 10; y++) fn(tx * TILE + x0, ty * TILE + y, y);
}

/** Windows lit from inside: the upper panes brightest, as a lamp on a table lights them. */
export function lightWindows(f, windows) {
  for (const w of windows) eachPane(f, w, (x, y, py) => setPx(f, x, y, py <= 7 ? 'lamp-5' : 'lamp-4'));
  return f;
}

/** Windows dark, each with a plank nailed across. */
export function boardWindows(f, windows) {
  for (const [tx, ty] of windows) {
    eachPane(f, [tx, ty], (x, y) => setPx(f, x, y, 'night-1'));
    const x0 = tx * TILE + 3, y0 = ty * TILE + 6;
    // One plank, nailed at both ends, a little skewed: a lit top edge, a dark underside.
    for (let i = 0; i < 10; i++) {
      const yy = y0 + (i >= 5 ? 1 : 0);
      setPx(f, x0 + i, yy, 'wood-4'); setPx(f, x0 + i, yy + 1, 'wood-3'); setPx(f, x0 + i, yy + 2, 'night-0');
    }
    setPx(f, x0 + 1, y0 + 1, 'night-0'); setPx(f, x0 + 8, y0 + 2, 'night-0');
  }
  return f;
}

/** Planks across a door: two, crossed low. */
function boardDoor(f, [tx, ty]) {
  const x0 = tx * TILE + 4, y0 = ty * TILE + 7;
  for (let i = 0; i < 8; i++) {
    setPx(f, x0 + i, y0 + Math.floor(i / 3), 'wood-4'); setPx(f, x0 + i, y0 + 1 + Math.floor(i / 3), 'wood-3');
    setPx(f, x0 + i, y0 + 6 - Math.floor(i / 3), 'wood-4'); setPx(f, x0 + i, y0 + 7 - Math.floor(i / 3), 'wood-3');
  }
}

/**
 * A building as a ruin, from its whole frame. Checked against a roofless ruined house seen from
 * above and in front: with the roof gone you look down into it, so the roof's place shows the dark
 * inside with the tops of the side and back walls around it (broken low in places), fallen
 * timbers and stones on the floor; the front wall stands with a ragged top, its windows empty
 * holes, its doors and doorways boarded up; weeds at its foot.
 */
export function ruin(whole, layout, seed) {
  const { windows, doors, open } = openings(layout);
  const rng = createRng(`ruin-${seed}`);
  const f = blank(whole.id, whole.w, whole.h);
  stamp(f, whole, 0, 0);
  const roofH = 2 * TILE, W = f.w;
  // What the walls are made of (the pack's timber walls are tiles 72 to 75), for their broken tops.
  const timber = layout.some((row) => row.some((c) => { const t = typeof c === 'object' && c ? c.t : c; return t >= 72 && t <= 75; }));
  const [topLit, topShade] = timber ? ['wood-3', 'wood-2'] : ['fog-2', 'fog-1'];
  // The inside, where the roof was: a floor of boards, some gone, weeds coming up through it.
  fillRect(f, 0, 0, W, roofH, 'night-2');
  for (let y = 6; y < roofH; y += 4) {
    for (let x = 4; x < W - 4; x++) setPx(f, x, y, 'night-3');
    const gone = 4 + rng.int(W - 16), len = 3 + rng.int(6);
    fillRect(f, gone, y - 3, len, 3, 'night-1');                 // a missing board: the dark below
  }
  for (let i = 0; i < 6; i++) {
    const x = 6 + rng.int(W - 12), y = 8 + rng.int(roofH - 12);
    setPx(f, x, y, 'moss-2'); setPx(f, x - 1, y + 1, 'moss-1'); setPx(f, x + 1, y + 1, 'moss-1');
  }
  // Wall tops: the back wall along the top, the side walls down each edge, broken low in places.
  for (let x = 0; x < W; x++) {
    const gone = (x > W * 0.35 && x < W * 0.55) || rng.int(9) === 0;
    if (!gone) { setPx(f, x, 1, topLit); setPx(f, x, 2, topShade); setPx(f, x, 3, 'night-0'); }
    setPx(f, x, 0, gone ? 'night-2' : 'night-0');
  }
  for (let y = 1; y < roofH; y++) {
    if (y < roofH - 10 || rng.int(5) > 0) { setPx(f, 0, y, 'night-0'); setPx(f, 1, y, topLit); setPx(f, 2, y, topShade); setPx(f, 3, y, 'night-0'); }
    if (y > 8 || rng.int(3) > 0) { setPx(f, W - 1, y, 'night-0'); setPx(f, W - 2, y, topShade); setPx(f, W - 3, y, topShade); setPx(f, W - 4, y, 'night-0'); }
  }
  // Fallen timbers across the floor (how many, where, and which way each fell is the ruin's
  // own), and stones.
  const beam = (x0, y0, x1, y1) => { line(f, x0, y0, x1, y1, 'wood-2'); line(f, x0, y0 - 1, x1, y1 - 1, 'wood-3'); line(f, x0, y0 + 1, x1, y1 + 1, 'night-0'); };
  const beams = 1 + rng.int(2);
  for (let i = 0; i < beams; i++) {
    const len = Math.round(W * (0.35 + rng.int(20) / 100));
    const x0 = 5 + rng.int(Math.max(1, W - 12 - len));
    const low = 20 + rng.int(8), high = 8 + rng.int(8);
    if (rng.int(2) === 0) beam(x0, low, x0 + len, high); else beam(x0, high, x0 + len, low);
  }
  for (let i = 0; i < 9; i++) {
    const x = 5 + rng.int(W - 10), y = 6 + rng.int(roofH - 9);
    setPx(f, x, y, 'fog-1'); setPx(f, x + 1, y, 'night-5'); setPx(f, x, y + 1, 'night-4');
  }
  // The front wall's ragged top: knocked down a few pixels, deeper in a notch; the inside shows.
  let drop = 2;
  for (let x = 0; x < W; x++) {
    drop = Math.max(0, Math.min(7, drop + rng.int(3) - 1));
    const d = drop + (x > W * 0.3 && x < W * 0.5 ? 3 : 0);
    for (let y = roofH; y < roofH + d; y++) setPx(f, x, y, 'night-2');
    setPx(f, x, roofH + d, 'night-0');
  }
  // Cracks.
  for (let c = 0; c < 3; c++) {
    let x = 6 + rng.int(W - 12), y = roofH + 8 + rng.int(8);
    for (let k = 0; k < 7; k++) { setPx(f, x, y, 'night-0'); x += rng.int(3) - 1; y += 1; }
  }
  // Empty windows, some boarded; every door and doorway boarded.
  for (const [tx, ty] of windows) eachPane(f, [tx, ty], (x, y) => setPx(f, x, y, 'night-0'));
  boardWindows(f, windows.filter((_, i) => i % 2 === 1));
  for (const d of [...doors, ...open]) boardDoor(f, d);
  // Weeds at the foot of the wall.
  for (let x = 1; x < W - 1; x += 2 + rng.int(3)) { setPx(f, x, f.h - 1, 'moss-2'); if (rng.int(2)) setPx(f, x, f.h - 2, 'moss-3'); }
  return f;
}

/**
 * A timber scaffold for a plot `w` x `h` tiles, drawn over the ruin at a building's first level.
 * Checked against scaffolding on a house under repair: upright standards every couple of meters,
 * ledgers across them at each working height with planks laid on, diagonal braces in the bays,
 * and a ladder up to the first lift.
 */
export function scaffold(w, h) {
  const W = w * TILE, H = h * TILE;
  const f = blank(`hub_scaffold_${w}x${h}`, W, H);
  const xs = [];
  for (let x = 2; x < W - 2; x += Math.floor((W - 6) / Math.max(1, w - 2))) xs.push(x);
  if (xs[xs.length - 1] < W - 6) xs.push(W - 4);
  const lifts = [Math.round(H * 0.18), Math.round(H * 0.55)];
  // Braces first, behind the rest.
  for (let i = 0; i + 1 < xs.length; i++) {
    if (i % 2 === 0) line(f, xs[i] + 1, lifts[1], xs[i + 1], H - 2, 'wood-2');
    else line(f, xs[i] + 1, H - 2, xs[i + 1], lifts[1], 'wood-2');
    line(f, xs[i] + 1, lifts[0] + 3, xs[i + 1], lifts[1] - 1, 'wood-2');
  }
  for (const x of xs) { fillRect(f, x, lifts[0] - 4, 2, H - lifts[0] + 4, 'wood-3'); fillRect(f, x, lifts[0] - 4, 1, H - lifts[0] + 4, 'wood-4'); }
  for (const y of lifts) {
    fillRect(f, xs[0] - 1, y, xs[xs.length - 1] - xs[0] + 4, 2, 'wood-4');
    fillRect(f, xs[0] - 1, y + 2, xs[xs.length - 1] - xs[0] + 4, 1, 'wood-2');
  }
  // The ladder, up to the lower lift.
  const lx = xs[xs.length - 2] + 6;
  fillRect(f, lx, lifts[1] - 4, 1, H - lifts[1] + 4, 'wood-3');
  fillRect(f, lx + 4, lifts[1] - 4, 1, H - lifts[1] + 4, 'wood-3');
  for (let y = lifts[1] - 2; y < H; y += 3) fillRect(f, lx + 1, y, 3, 1, 'wood-4');
  return outlined(f, 'night-0', f.id);
}

/**
 * A window box of flowers, for under an upper window once a building is fully alive. Checked
 * against window boxes in a harbor town: a plank trough on brackets, the flowers heaped above its
 * rim and hanging over the front.
 */
export function flowerBox() {
  return paint('hub_flowerbox', [
    '.oMYMGMoMYM.',
    'MhMoMhMhMoMh',
    'K4444444444K',
    'K3333333333K',
    '.KMK....KMK.',
  ]);
}

/**
 * A lantern on the wall beside a door. Checked against an old wall lantern seen from in front: a
 * dark cap, glass on three sides lit from inside (brightest at the top, where the flame is), a
 * frame around the panes, and a finial underneath. (The first one was a one-pixel sliver of
 * glass and read as an exclamation mark.)
 */
export function wallLantern() {
  return paint('hub_wall_lantern', [
    '.KKK.',
    'KKKKK',
    'KWWWK',
    'KYYYK',
    'KYYYK',
    'KKKKK',
    '..K..',
  ]);
}

/**
 * The Tavern's sign: a board with a tankard on it, hung on the wall above the door. Checked
 * against a pub sign: a painted wooden board in a dark frame, the picture simple enough to read
 * from across the street, the tankard with its handle to one side and a head of foam.
 */
export function tavernSign() {
  return paint('hub_sign_tavern', [
    'KKKKKKKKKKKKKK',
    'K222222222222K',
    'K22222GGG2222K',
    'K2222GGGGG222K',
    'K2222yyyyyKK2K',
    'K2222yLyyy2K2K',
    'K2222yLyyy2K2K',
    'K2222yyyyyKK2K',
    'K22222LLL2222K',
    'K222222222222K',
    'KKKKKKKKKKKKKK',
  ]);
}

/**
 * The Library's sign: an open book. Checked against a book lying open: the two pages dipping to
 * the gutter at the middle, lines of text across each page at their own heights (the first
 * version set them in matching pairs, and the book read as a face), the cover showing as a line
 * underneath.
 */
export function librarySign() {
  return paint('hub_sign_library', [
    'KKKKKKKKKKKKKK',
    'K222222222222K',
    'K2GGGG22GGGG2K',
    'K2GfffFFGGGG2K',
    'K2GGGGFFGffG2K',
    'K2GffGFFGGGG2K',
    'K2GGGGFFGfGG2K',
    'K2RRRRRRRRRR2K',
    'K222222222222K',
    'KKKKKKKKKKKKKK',
  ]);
}
