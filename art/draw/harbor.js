// The harbor coming alive (0.7.3): the props each building and the gate gain by level, the town's
// life (animals, boats), and the bunting at the gate, drawn in code in Tiny Town's style (§16.1,
// §16.5). The style anchor is the pack's own barrel and signpost as the atlas has them: full color
// from the town's middle values, flat fills, one light from the top left (the lit edge on the top
// and left, the shade on the bottom and right), and one line weight: a 1 px night-0 outline where a
// thing meets what's behind it, 1 px inner lines in the thing's own shade. Each drawing names the
// real thing it was checked against (written descriptions: the image search here shows pictures to
// Kevin but returns no pixels to look at).
//
// Everything here returns frames ({ id, w, h, rgba }, src/render/pixels.js) in palette colors.

import { blank, setPx, outlined, alphaAt } from '../../src/render/pixels.js';

/** Letters for the drawings written as text rows (a superset of art/draw/hub.js's). */
const LEGEND = Object.freeze({
  K: 'night-0', k: 'night-1', d: 'night-2', n: 'night-3', D: 'night-4', N: 'night-5',
  p: 'fog-1', f: 'fog-2', F: 'fog-3', g: 'fog-4', G: 'fog-5',
  1: 'wood-1', 2: 'wood-2', 3: 'wood-3', 4: 'wood-4',
  e: 'lamp-1', l: 'lamp-2', L: 'lamp-3', y: 'lamp-4', Y: 'lamp-5', W: 'lamp-6',
  r: 'rot-1', R: 'rot-2', o: 'rot-3', O: 'rot-4',
  b: 'moss-1', m: 'moss-2', M: 'moss-3', h: 'moss-4',
  s: 'sea-1', S: 'sea-2', t: 'sea-3', T: 'sea-4', u: 'sea-5', U: 'sea-6',
  i: 'skin-1', j: 'skin-2', J: 'skin-3', w: 'white',
});

/** A frame from rows of LEGEND letters ('.' is empty). */
export function draw(id, rows) {
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

/**
 * A mooring bollard at the quay's edge. Checked against a cast-iron quay bollard: a short thick
 * post, its head flared out wider than the barrel and rounded over the top so a rope can't ride
 * off it, a waist under the head where the rope sits, a flared foot bolted to the stone; painted
 * black, its top worn pale where ropes and boots rub it. Seen from the town's angle: the top of
 * the head shows as a flat oval, lit on its left.
 */
export function bollard() {
  return draw('hub_bollard', [
    '..KKKKKK..',
    '.KgFFffNK.',
    'KFFffpNNDK',
    'KfpNNNDDnK',
    '.KKNDnnKK.',
    '..KpDnnK..',
    '..KpDnnK..',
    '..KpDnnK..',
    '.KppNDnnK.',
    'KfpNDDnndK',
    '.KKKKKKKK.',
  ]);
}

/**
 * A coil of mooring rope lying on the quay by the bollard. Checked against a hawser flaked down in
 * a flat coil on a dock, seen from above at an angle: round turns one inside the next (an oval
 * here, the way the town's angle squashes a circle), a dark groove between each turn and the
 * next, the hole in the middle, natural hemp tan lit on its upper left; the end that runs out to
 * the bollard leaves the outside turn and trails off.
 */
export function ropeCoil() {
  const W = 19, H = 10, cx = 11.5, cy = 5, rx = 7.4, ry = 4.9;   // room on the left for the end
  const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H && ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1;
  // How deep each pixel is in the oval: 0 on its edge, 1 the ring inside that, and so on.
  const depth = new Int8Array(W * H).fill(-1);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (inside(x, y)) depth[y * W + x] = 99;
  for (let d = 0; d < 8; d++) {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (depth[i] !== 99) continue;
      const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([ax, ay]) => { const j = (y + ay) * W + x + ax; return !inside(x + ax, y + ay) || (depth[j] >= 0 && depth[j] < d); });
      if (edge) depth[i] = d;
    }
  }
  const f = blank('hub_rope_coil', W, H);
  // Two turns of rope, each a ring two pixels deep, a groove between, and the hole in the middle.
  const ROLE = ['rope', 'rope', 'groove', 'rope', 'groove'];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = depth[y * W + x];
    if (d < 0) continue;
    const role = ROLE[d] ?? 'hole';
    if (role === 'hole') { setPx(f, x, y, 'night-2'); continue; }
    if (role === 'groove') { setPx(f, x, y, 'wood-1'); continue; }
    // The rope: lit where it faces the upper left, in shade toward the lower right.
    const lx = (x + 0.5 - cx) / rx, ly = (y + 0.5 - cy) / ry;
    setPx(f, x, y, lx + ly < -0.4 ? 'wood-4' : lx + ly > 0.5 ? 'wood-2' : 'wood-3');
  }
  // The end, off the outside turn's lower left and away along the stone toward the bollard: the
  // rope two pixels thick, its top lit.
  for (let x = 0; x < 6; x++) { const y = x < 3 ? 7 : 6; setPx(f, x, y, 'wood-4'); setPx(f, x, y + 1, 'wood-2'); }
  return outlined(f, 'night-0', 'hub_rope_coil');
}

/**
 * The Chapel's notice board by the gate. Checked against a village notice board: a wide board in a
 * frame, a little pitched roof over it to keep the rain off, standing on two posts; papers pinned
 * to it, each a different size, one yellowed with age, one with a line of writing on it.
 */
export function noticeBoard() {
  return draw('hub_notice_board', [
    '......KKK......',
    '....KK444KK....',
    '..KK4444433KK..',
    'KK44444333333KK',
    'K2222222222222K',
    '.K11111111111K.',
    '.K3GGGg33JJJ3K.',
    '.K3nnng33iiJ3K.',
    '.K3GGGg33JJJ3K.',
    '.K3nngg3GGGg3K.',
    '.K3GGGg3nnng3K.',
    '.K333333GGgg3K.',
    '.KKKKKKKKKKKKK.',
    '..K2K.....K2K..',
    '..K3K.....K3K..',
    '..KKK.....KKK..',
  ]);
}

/** Fill an oval (pixel centers inside it), each pixel's color from `pick(nx, ny)` (-1..1 across it). */
function oval(f, cx, cy, rx, ry, pick) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
    const nx = (x + 0.5 - cx) / rx, ny = (y + 0.5 - cy) / ry;
    if (nx * nx + ny * ny <= 1) setPx(f, x, y, pick(nx, ny));
  }
}
/** Lit on the upper left, in shade on the lower right: one of three colors for a point (-1..1). */
const lit3 = (light, body, shade, k = 0.45) => (nx, ny) => (nx + ny < -k ? light : nx + ny > k ? shade : body);

/** A wooden crate's front and lid (x, y its top left, w by h), planked across, lit on its lid. */
function crate(f, x, y, w, h) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const lid = j < 2, seam = !lid && (j - 2) % 3 === 2, edge = i === 0 || i === w - 1;
    setPx(f, x + i, y + j, lid ? (j === 0 ? 'wood-4' : 'wood-3') : edge ? 'wood-2' : seam ? 'wood-2' : 'wood-3');
  }
  for (let j = 2; j < h; j++) setPx(f, x + 1, y + j, 'wood-4');   // the lit corner post
  for (let i = 0; i < w; i++) setPx(f, x + i, y + 1, 'wood-1');   // the lid's edge in shadow
}

/**
 * The Apothecary's supplies for the road, by the gate. Checked against a traveller's stores
 * set down at a roadside: a wooden crate, planked, its lid lit; a canvas sack of provisions
 * leaning on it, round at the bottom where it slumps, gathered at the neck and tied with cord, the
 * cloth pale and lit from the left.
 */
export function supplies() {
  const f = blank('hub_supplies', 17, 14);
  crate(f, 0, 5, 10, 9);
  // The sack in front of the crate's right side: its body, the neck gathered above, the cord.
  oval(f, 12.5, 9.5, 4, 4.3, lit3('skin-3', 'skin-2', 'skin-1'));
  for (let y = 3; y <= 5; y++) for (let x = 11; x <= 13; x++) setPx(f, x, y, x === 11 ? 'skin-3' : 'skin-2');
  setPx(f, 10, 2, 'skin-3'); setPx(f, 12, 2, 'skin-2'); setPx(f, 14, 3, 'skin-1');   // the cloth fanning out above the cord
  for (let x = 10; x <= 14; x++) setPx(f, x, 4, 'wood-1');                        // the cord, pulled tight round the neck
  for (let y = 8; y <= 12; y++) setPx(f, 14, y, 'skin-1');                         // a fold down its front
  return outlined(f, 'night-0', 'hub_supplies');
}

/**
 * The ship's bell the Docks hang by the gate. Checked against a ship's bell on a harbor
 * bell-frame: two posts and a beam across, the bell hung from the beam's middle by its crown; a
 * ship's bell is polished brass, its lip the widest and thickest part with the flare starting low
 * (not at the top, like a cup: the Tide Bell's own check, §16.5), and a short plaited lanyard
 * hanging from the clapper to ring it by.
 */
export function shipBell() {
  const f = blank('hub_ship_bell', 15, 18);
  // The frame: the beam across, its top lit; two posts down to the ground, lit on their left.
  for (let x = 0; x < 15; x++) { setPx(f, x, 0, 'wood-4'); setPx(f, x, 1, 'wood-3'); setPx(f, x, 2, 'wood-2'); }
  for (let y = 3; y < 18; y++) for (const x0 of [1, 12]) { setPx(f, x0, y, 'wood-4'); setPx(f, x0 + 1, y, 'wood-2'); }
  // The bell, row by row: [left, right] of each row from its crown down to its lip.
  const rows = [[7, 7], [6, 8], [6, 8], [5, 9], [5, 9], [5, 9], [5, 9], [4, 10], [3, 11], [3, 11]];
  rows.forEach(([a, b], k) => {
    const y = 3 + k;
    for (let x = a; x <= b; x++) {
      const lip = k >= 8;
      setPx(f, x, y, x === a ? 'lamp-5' : x === b ? 'lamp-2' : lip ? (k === 9 ? 'lamp-3' : 'lamp-4') : x <= a + 1 ? 'lamp-5' : 'lamp-4');
    }
  });
  setPx(f, 7, 13, 'lamp-2');                                                   // the clapper under the lip
  for (let y = 14; y <= 16; y++) setPx(f, 7, y, y % 2 ? 'fog-4' : 'fog-3');  // the lanyard, plaited
  return outlined(f, 'night-0', 'hub_ship_bell');
}

/** How far the bunting's cord sags below the straight line at its middle, and its pennants' length (px). */
export const BUNTING_SAG = 6;
export const BUNTING_PENNANT = 5;
/**
 * Bunting strung between two lamp posts, `w` px across, its right end `dy` px below its left (up
 * when negative). Checked against harbor-festival bunting: a cord sagging between the posts in one
 * shallow curve, small triangular pennants hung point-down along it close together, the colors
 * repeating in order, each pennant lit on its left. The frame's top left is where the higher end
 * is tied, level with it (render/hubtiles.js buntingAt puts it there).
 */
export function bunting([w, dy]) {
  const top = Math.max(0, -dy), h = Math.abs(dy) + BUNTING_SAG + BUNTING_PENNANT + 1;
  const f = blank('hub_bunting', w, h);
  // The cord: the straight line between the ties, sagging in a parabola, deepest in the middle.
  const cordY = (x) => Math.round(top + (dy * x) / (w - 1) + (4 * BUNTING_SAG * x * (w - 1 - x)) / ((w - 1) * (w - 1)));
  const COLORS = [['rot-4', 'rot-3'], ['lamp-5', 'lamp-4'], ['sea-5', 'sea-4'], ['fog-5', 'fog-4']];
  let k = 0;
  for (let x = 4; x + 4 < w - 3; x += 7, k++) {
    // A pennant 5 wide at the cord, narrowing to its point below.
    const [lite, body] = COLORS[k % COLORS.length], y0 = cordY(x + 2) + 1;
    for (let j = 0; j < BUNTING_PENNANT; j++) for (let i = j >> 1; i <= 4 - (j >> 1); i++) setPx(f, x + i, y0 + j, i === (j >> 1) ? lite : body);
  }
  for (let x = 0; x < w; x++) setPx(f, x, cordY(x), 'wood-2');
  return f;
}

/**
 * A townswoman waving you off at the gate (from the tenth run): the pack's woman (Tiny Dungeon),
 * in her own colors, with her right arm drawn in code, raised. Checked against someone waving
 * goodbye from a roadside: the upper arm lifted out from the shoulder, the elbow bent, the forearm
 * up with the open hand above the head, swinging side to side from the elbow (the two frames:
 * the hand out, then over). `f` is her 22 x 22 frame (the pack's tile padded 3 px a side), changed
 * in place; `k` the frame of the wave.
 */
export function waveArm(f, k) {
  const O = 3;   // the pack tile's place in the frame
  // Her right hand at her side goes: the dress there (her arm is up).
  for (const [x, y] of [[12, 11], [11, 12], [12, 12], [13, 12], [12, 13], [13, 13]]) setPx(f, O + x, O + y, 'sea-3');
  // The upper arm out and up from the shoulder, the forearm up from the elbow, the hand open.
  const sleeve = [[14, 11], [15, 10], [15, 9]];
  const fore = k === 0 ? [[15, 8], [15, 7], [15, 6]] : [[16, 8], [16, 7], [17, 6]];
  const hand = k === 0 ? [[15, 3], [16, 3], [15, 4], [16, 4], [15, 5], [16, 5]] : [[17, 3], [18, 3], [17, 4], [18, 4], [17, 5], [18, 5]];
  const arm = [...sleeve.map((p) => [...p, 'sea-4']), ...fore.map((p) => [...p, 'skin-2']), ...hand.map((p) => [...p, 'skin-3'])];
  for (const [x, y, c] of arm) setPx(f, O + x, O + y, c);
  // Its outline: every empty pixel beside the arm, as the pack's figures are outlined.
  const drawn = new Set(arm.map(([x, y]) => `${O + x},${O + y}`));
  for (const [x, y] of arm) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const px = O + x + dx, py = O + y + dy;
    if (!drawn.has(`${px},${py}`) && alphaAt(f, px, py) === 0) setPx(f, px, py, 'night-0');
  }
  return f;
}

/** A heap of round things (apples, cabbages) `w` wide on a crate's top at (x, y), each lit on its upper left. */
function heap(f, x, y, w, [lite, body, shade], step = 3) {
  for (let i = 0; i < w; i += step) {
    const top = y - (i > 0 && i < w - step ? 1 : 0);
    oval(f, x + i + 1.5, top + 1.5, 1.6, 1.5, lit3(lite, body, shade, 0.3));
  }
  for (let i = 1; i < w - 1; i += step) oval(f, x + i + 1.5, y - 1.5, 1.6, 1.5, lit3(lite, body, shade, 0.3));
}

/**
 * The Market's stall crates at the square's edge. Checked against a greengrocer's crates set out
 * at a market: shallow slatted wooden crates side by side on the ground, each heaped above its rim
 * with one thing, red apples in one and green cabbages in the other, the heap round on top.
 */
export function marketCrates() {
  const f = blank('hub_market_crates', 17, 13);
  crate(f, 0, 6, 8, 7);
  crate(f, 9, 6, 8, 7);
  heap(f, 0, 4, 8, ['rot-4', 'rot-3', 'rot-2']);
  heap(f, 9, 4, 8, ['moss-4', 'moss-3', 'moss-2']);
  return outlined(f, 'night-0', 'hub_market_crates');
}

/** A 1 px line from (x0, y0) to (x1, y1). */
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

/**
 * The Market's barrow: a wheelbarrow (the square already has a cart). Checked against a wooden
 * wheelbarrow seen from the side: one wheel at the front, under the nose of the tray; the tray
 * deepest at the front and sloping up and back, its sides planked; two long handles reaching back
 * from it; a leg under the back of the tray so it stands level when it's set down.
 */
export function wheelbarrow() {
  const f = blank('hub_wheelbarrow', 19, 12);
  // The handles, back and up from the tray (behind it, so first): lit along their top.
  line(f, 11, 3, 18, 1, 'wood-4'); line(f, 11, 4, 18, 2, 'wood-2');
  // The leg under the tray's back.
  line(f, 12, 7, 13, 10, 'wood-2'); setPx(f, 13, 11, 'wood-1');
  // The tray: its side a trapezoid, deep at the front (left) and shallower at the back.
  for (let x = 2; x <= 13; x++) {
    const top = 2 + (x < 4 ? 4 - x : 0), bottom = x < 7 ? 8 : 8 - Math.floor((x - 6) / 3);
    for (let y = top; y <= bottom; y++) setPx(f, x, y, y === top ? 'wood-4' : y === bottom ? 'wood-2' : (y - top) === 3 ? 'wood-2' : 'wood-3');
  }
  // The wheel at the front: an iron tyre round a wooden hub, under the tray's nose.
  oval(f, 4.5, 8.5, 3.1, 3.1, (nx, ny) => (nx * nx + ny * ny > 0.45 ? (nx + ny < 0 ? 'fog-2' : 'fog-1') : 'wood-3'));
  setPx(f, 4, 8, 'wood-1');
  return outlined(f, 'night-0', 'hub_wheelbarrow');
}

/** A lobster pot (x, y its base's left end, w wide): a hooped dome of bent wood over a flat base, net between the hoops. */
function creel(f, x, y, w) {
  const h = Math.ceil(w / 2);
  for (let i = 0; i < w; i++) {
    const u = (i + 0.5) / w * 2 - 1, top = Math.round(y - h * Math.sqrt(1 - u * u));
    for (let j = top; j < y; j++) {
      const hoop = i === 0 || i === w - 1 || i % 3 === 0, rim = j === top;
      setPx(f, x + i, j, rim ? 'wood-4' : hoop ? 'wood-3' : (i + j) % 2 === 0 ? 'fog-2' : 'night-3');
    }
  }
  for (let i = -1; i <= w; i++) setPx(f, x + i, y, 'wood-2');   // the base
}

/**
 * The Docks' lobster pots, stacked on the quay. Checked against the old creels fishermen stack on
 * a harbor wall: a flat wooden base, a dome of bent wooden hoops over it, the netting stretched
 * between the hoops (you see through it to the dark inside), stacked two high and a little askew.
 */
export function lobsterPots() {
  const f = blank('hub_lobster_pots', 19, 14);
  creel(f, 1, 13, 8);
  creel(f, 10, 13, 8);
  creel(f, 5, 8, 8);
  return outlined(f, 'night-0', 'hub_lobster_pots');
}

/**
 * The Smithy's anvil out by its door, on its stump. Checked against a blacksmith's anvil (the
 * Smithy's sign, §16.5): the flat face on top, lit; the horn tapering to a point on the left; the
 * narrow waist; the wide foot; set on a thick wooden stump (a round of elm), its cut top lit, its
 * bark dark.
 */
export function anvil() {
  return draw('hub_anvil', [
    '.KKKKKKKKKKKKK..',
    'KGGgggggggggFFK.',
    '.KKFFffffffffpK.',
    '...KKffffffpKK..',
    '.....KfffppK....',
    '.....KfffppK....',
    '....KfffffppK...',
    '...KfffffffppK..',
    '...KK4444444KK..',
    '...K2333333332K.',
    '...K2333333332K.',
    '...K2333333322K.',
    '...KKKKKKKKKKK..',
  ]);
}

/**
 * The Smithy's grindstone. Checked against an old hand-cranked grindstone: a round sandstone
 * wheel standing on its edge, its rim worn smooth and lit on its upper left, an iron axle through
 * its middle with the crank handle sticking out, held in a wooden frame on splayed legs, a trough
 * of water under the wheel's bottom to keep the stone wet.
 */
export function grindstone() {
  const f = blank('hub_grindstone', 16, 15);
  // The frame's legs, splayed, behind the wheel.
  line(f, 3, 7, 1, 14, 'wood-3'); line(f, 12, 7, 14, 14, 'wood-2');
  // The trough under it.
  for (let x = 3; x <= 12; x++) { setPx(f, x, 12, 'wood-4'); setPx(f, x, 13, 'wood-2'); setPx(f, x, 11, x > 4 && x < 11 ? 'sea-3' : 'wood-3'); }
  // The wheel, on its edge: sandstone, lit upper left, the worn rim a ring.
  // (The first wheel had its axle off its middle as a single dark dot, and with the crank beside
  // it read as a bird's eye and beak; now the rim is its own ring and the axle a boss in the middle.)
  oval(f, 7.5, 6.5, 5.5, 5.5, (nx, ny) => { const r = nx * nx + ny * ny; return r > 0.66 ? (nx + ny < -0.2 ? 'fog-3' : 'night-5') : r > 0.5 ? 'fog-1' : nx + ny < -0.4 ? 'fog-3' : 'fog-2'; });
  // The axle's boss in the middle, and the crank out to the right with its handle.
  setPx(f, 7, 6, 'fog-3'); setPx(f, 8, 6, 'night-3'); setPx(f, 7, 7, 'night-3'); setPx(f, 8, 7, 'night-4');
  line(f, 9, 7, 14, 7, 'fog-1'); setPx(f, 14, 8, 'wood-3'); setPx(f, 14, 9, 'wood-3'); setPx(f, 15, 9, 'wood-2');
  return outlined(f, 'night-0', 'hub_grindstone');
}

/**
 * The Chapel's bench by its path. Checked against a plain wooden churchyard bench seen from the
 * front at the town's angle: one long plank seat (its top lit, its front edge in shade), a back
 * rail of one plank above it on two uprights, and two pairs of square legs under it.
 */
export function bench() {
  return draw('hub_bench', [
    '.KKKKKKKKKKKKKK.',
    'K44444444444443K',
    'K22222222222222K',
    '.K3K........K3K.',
    'KKKKKKKKKKKKKKKK',
    'K44444444444444K',
    'K33333333333333K',
    'K22222222222222K',
    'KK3KKKKKKKKKK3KK',
    '.K2K........K2K.',
    '.KKK........KKK.',
  ]);
}

/**
 * Two old headstones by the Chapel (seamen's graves). Checked against weathered churchyard
 * headstones: upright slabs with rounded tops, grey stone lit on the left, the carving a few short
 * dark lines, lichen in a patch near the foot; one smaller and leaning a little, sunk with age;
 * grass growing up round their feet.
 */
export function graves() {
  return draw('hub_graves', [
    '..KKKK.........',
    '.KGgFFK........',
    'KGgFFfpK..KKK..',
    'KgnnnfpK.KgFfK.',
    'KgFFFfpKKgFFfpK',
    'KgnnffpKKgnnfpK',
    'KgFFFfpKKgFFfpK',
    'KgnFffpKKFnffpK',
    'KgFFffpKKFFMfpK',
    'KFFMmfpKKFMmfpK',
    'KmMmMmMKKmMmMmK',
    '.KKKKKK..KKKKK.',
  ]);
}

/** A terracotta pot (x its left, y its rim's top, w wide at the rim, h tall), narrowing to its foot, with a darker rim band. */
function pot(f, x, y, w, h) {
  for (let j = 0; j < h; j++) {
    const inset = j < 2 ? 0 : Math.floor((j - 1) / 2);
    for (let i = inset; i < w - inset; i++) setPx(f, x + i, y + j, j < 2 ? (j === 0 ? 'rot-4' : 'rot-2') : i === inset ? 'rot-4' : i === w - 1 - inset ? 'rot-2' : 'rot-3');
  }
}

/**
 * The Apothecary's herbs, potted by the road. Checked against an herb garden in pots: terracotta
 * pots, wider at the rim and tapering to the foot, a band at the rim; in one rosemary (upright
 * thin spikes), in the other a broad-leaved plant (sage) spilling over the rim; the pots of
 * different sizes, set close together. (A third, smaller pot in front merged into these two at
 * this size, and went.)
 */
export function herbPots() {
  const f = blank('hub_herb_pots', 17, 15);
  // Rosemary: upright spikes, dark and light greens.
  for (const [x, top] of [[2, 1], [3, 3], [4, 0], [5, 2], [6, 4]]) for (let y = top; y < 8; y++) setPx(f, x, y, y === top ? 'moss-4' : (x + y) % 3 === 0 ? 'moss-3' : 'moss-2');
  pot(f, 1, 8, 7, 7);
  // Sage: broad leaves spilling over a big pot's rim, behind and right.
  oval(f, 12.5, 6.5, 3.8, 3, lit3('moss-4', 'moss-3', 'moss-2', 0.35));
  pot(f, 9, 8, 8, 7);
  return outlined(f, 'night-0', 'hub_herb_pots');
}

/**
 * The Cartographer's telescope, set up looking out to sea. Checked against a brass refracting
 * telescope on a wooden tripod: the tube angled up, widest at the far (objective) end with a
 * darker ring round the lens, narrowing in drawn sections to the eyepiece at the near end; the
 * tube held at its middle on the tripod's head, three legs splayed down to the ground.
 */
export function telescope() {
  const f = blank('hub_telescope', 17, 16);
  // The tripod's three legs, from the head down to the ground, splayed.
  line(f, 8, 8, 3, 15, 'wood-3'); line(f, 8, 8, 13, 15, 'wood-2'); line(f, 8, 8, 8, 15, 'wood-3');
  // The tube, in drawn sections: the wide objective end up and to the right, the eyepiece low left.
  const along = (t) => [Math.round(2 + t * 13), Math.round(10 - t * 9)];
  for (let k = 0; k <= 40; k++) {
    const t = k / 40, [x, y] = along(t), r = t < 0.3 ? 0 : t < 0.7 ? 1 : 1;
    for (let d = -r; d <= r + (t >= 0.7 ? 1 : 0); d++) setPx(f, x + (d > 0 ? 1 : 0) * 0, y + d, d === -r ? 'lamp-5' : d === r + (t >= 0.7 ? 1 : 0) ? 'lamp-2' : 'lamp-4');
  }
  // The objective end's ring, dark round the lens; the eyepiece's cap.
  setPx(f, 15, 0, 'wood-1'); setPx(f, 15, 1, 'wood-1'); setPx(f, 15, 2, 'wood-1'); setPx(f, 16, 1, 'sea-5');
  setPx(f, 1, 10, 'wood-1');
  // The tripod's head under the tube's middle.
  setPx(f, 8, 7, 'wood-2'); setPx(f, 9, 7, 'wood-2');
  return outlined(f, 'night-0', 'hub_telescope');
}

/**
 * The Tavern's table outside its door. Checked against a trestle table outside an inn: a top of
 * planks (lit, the gaps between them dark lines), standing on two trestles whose legs cross in an
 * X under each end; a pewter tankard on it, its handle to one side, a head of foam.
 */
export function tavernTable() {
  return draw('hub_tavern_table', [
    '.........KKK....',
    '........KGGGK...',
    '........KFffKKK.',
    '........KFffKfK.',
    '.KKKKKKKKFfpKKK.',
    'K44434444344443K',
    'K44434444344443K',
    'K22222222222222K',
    '.K3KK3K..K3KK3K.',
    '..K33K....K33K..',
    '.K3KK3K..K3KK3K.',
    '.KK..KK..KK..KK.',
  ]);
}

/**
 * The Docks' oars, stood in their rack. Checked against oars stored upright at a boathouse: long
 * round looms (shafts) with a flat blade, wider than the loom, at one end, stood blade-up in a row
 * and leaning in a rack, the wood lit on its left. (The first drawing had the blades at the foot
 * inside a frame of posts and read as a little gate; blade-up, the oars' tell is where it's seen.)
 */
export function oarRack() {
  const f = blank('hub_oar_rack', 17, 18);
  // The oars: the blade on top, the loom down to the ground, each its own lean, apart enough that
  // each blade shows on its own.
  for (const [x, lean] of [[2, 0], [8, 1], [14, 0]]) {
    for (let y = 0; y < 7; y++) { const xx = x + lean; setPx(f, xx - 1, y, y === 0 ? 'wood-3' : 'wood-4'); setPx(f, xx, y, 'wood-3'); setPx(f, xx + 1, y, 'wood-2'); }
    for (let y = 7; y < 18; y++) setPx(f, x + (y < 10 ? lean : 0), y, y > 15 ? 'wood-2' : 'wood-3');
  }
  // The rack's rail across them, low, and its two short posts.
  for (let x = 0; x < 17; x++) { setPx(f, x, 11, 'wood-4'); setPx(f, x, 12, 'wood-2'); }
  for (const x of [0, 16]) for (let y = 11; y < 18; y++) setPx(f, x, y, x ? 'wood-2' : 'wood-3');
  return outlined(f, 'night-0', 'hub_oar_rack');
}

/**
 * A herring gull perched on the sea wall, facing east (the view mirrors it). Checked against a
 * herring gull standing at rest, seen from the side: a white head and breast, the back and folded
 * wings pale grey, the wingtips black with white spots, reaching past the short white tail; a
 * yellow bill with a red spot near its tip; pink legs; the body held level, the head up.
 */
export function gullPerched() {
  return draw('hub_gull_perched', [
    '......KKK...',
    '.....KGGGK..',
    '.....KGKGyyK',
    '.....KGGGoK.',
    '.KKKKKgGGK..',
    'KKwKffFFGGK.',
    '.KKKffFFgGK.',
    '..KKKffgggK.',
    '....KKKKKK..',
    '.....KOKOK..',
    '.....KOKOK..',
  ]);
}

/**
 * A rowing boat at its mooring, bow to the east (like the harbor's sailing boat, art/draw/hub.js
 * boat, which is the town's other boat). Checked against a clinker-built rowing boat afloat, seen
 * from the side: the sheer sweeping up to a raked, pointed bow, a square transom at the stern, the
 * planks (strakes) overlapping in lines along the hull, the oars shipped across the thwarts with a
 * blade sticking out past the side, the hull dark where it meets the water.
 */
export function rowboat() {
  const W = 24, H = 10;
  const f = blank('hub_rowboat', W, H);
  // The oars shipped across the thwarts, lying on them above the gunwale: their looms along the
  // boat, a blade out past the stern.
  line(f, 3, 1, 16, 1, 'wood-4'); line(f, 4, 2, 15, 2, 'wood-2');
  for (let y = 0; y <= 2; y++) { setPx(f, 0, y, 'wood-4'); setPx(f, 1, y, 'wood-3'); setPx(f, 2, y + 1, 'wood-3'); }
  // The hull: the sheer rising toward the bow (east), a strake line, dark at the waterline.
  for (let x = 2; x < W - 1; x++) {
    const top = 4 - (x > 17 ? Math.round((x - 17) * 0.6) : 0), bottom = 9 - (x > 18 ? x - 18 : 0) - (x < 3 ? 1 : 0);
    for (let y = top; y <= bottom; y++) setPx(f, x, y, y === top ? 'wood-4' : y >= bottom - 1 ? 'wood-1' : y === top + 2 ? 'wood-2' : 'wood-3');
  }
  for (let y = 4; y <= 8; y++) setPx(f, 2, y, 'wood-2');   // the transom, square, in shade
  return outlined(f, 'night-0', 'hub_rowboat');
}

/**
 * A harbor dog trotting along the quay, facing east (the view mirrors it). Checked against a
 * mid-sized mongrel trotting, seen from the side: the body level, the head held up at the front
 * with a pointed muzzle and an ear folded over, the chest deeper than the belly, the tail carried
 * up in a curve, four legs mid-stride (a near leg forward, a far one back), brown with a paler
 * muzzle and chest.
 */
export function dog() {
  return draw('hub_dog', [
    '.........KK..',
    '.KK.....K32K.',
    'K3K....K3J3K.',
    'K3K...K33JjJK',
    '.K3KKKK33jJjK',
    '.K3333333jKKK',
    '.K233333jjK..',
    '.K22222jjJK..',
    '..K2KK2KKjK..',
    '..K2K.K2KK2K.',
    '..KK...KK.KK.',
  ]);
}

/**
 * The Tavern's cat, sitting on the path by its door, facing east (the view mirrors it). Checked
 * against a cat sitting upright, seen from the side and a little in front: two pointed ears up,
 * the head round, the front legs straight down to the ground, the haunches round and low at the
 * back, the tail curled round in front of its feet; a ginger tabby, darker stripes across its back.
 * (The first drawing put the head on a narrow neck with the stripes as spots, and read as a
 * giraffe; the head now sits right on the shoulders, the stripes run across.)
 */
export function cat() {
  return draw('hub_cat', [
    '....K..K..',
    '...KLKKLK.',
    '...KyLLyK.',
    '..KyKyyyyK',
    '..KyyyyJK.',
    '..KlLyyK..',
    '.KyllyyK..',
    'KLyyyyyK..',
    'KlllyyyK..',
    'KyyyKyyK..',
    'KyyKKyyyyK',
    '.KK..KKKK.',
  ]);
}

// ---------------------------------------------------------------- level 5: the door stands open

/**
 * A door at its building's last level, standing open (the pack's door tiles 85 and 89: the leaf
 * fills x 4 to 11, y 5 to 15 of the tile, inside a dark frame). Checked against a lit room seen
 * through an open door at night: the opening a warm rectangle, warmest low, where the lamp's light
 * runs across the floorboards to the threshold, darker toward the unlit ceiling; the door leaf
 * swung in against the inside wall, seen edge-on along its hinge jamb as a narrow strip, its edge
 * catching the light; the threshold bright where the light goes out over it. (tile: [tx, ty] in
 * the building's frame.)
 */
export function openDoor(f, [tx, ty]) {
  const X = tx * 16, Y = ty * 16;
  const INSIDE = ['lamp-1', 'lamp-1', 'lamp-2', 'lamp-2', 'lamp-2', 'lamp-3', 'lamp-3', 'lamp-3', 'lamp-4', 'lamp-4', 'lamp-5'];   // y 5 to 15
  for (let y = 5; y <= 15; y++) for (let x = 4; x <= 11; x++) setPx(f, X + x, Y + y, INSIDE[y - 5]);
  // A floorboard joint across the lit floor, and the back wall's foot.
  for (let x = 6; x <= 11; x++) { setPx(f, X + x, Y + 12, 'lamp-3'); setPx(f, X + x, Y + 9, 'lamp-1'); }
  for (let x = 6; x <= 11; x += 3) setPx(f, X + x, Y + 14, 'lamp-3');
  // The leaf, edge-on against the hinge jamb (the left): its edge lit by the room, its face in shade.
  for (let y = 5; y <= 15; y++) { setPx(f, X + 4, Y + y, 'wood-2'); setPx(f, X + 5, Y + y, y > 10 ? 'wood-4' : 'wood-3'); }
  setPx(f, X + 4, Y + 7, 'fog-2'); setPx(f, X + 4, Y + 13, 'fog-2');   // its hinges
  return f;
}

/** An open doorway (the pack's tiles 74 and 78, with no door) at the last level: lit inside the same way. */
export function litDoorway(f, [tx, ty]) {
  const X = tx * 16, Y = ty * 16;
  const INSIDE = ['lamp-1', 'lamp-1', 'lamp-2', 'lamp-2', 'lamp-2', 'lamp-3', 'lamp-3', 'lamp-3', 'lamp-4', 'lamp-4', 'lamp-5'];
  for (let y = 5; y <= 15; y++) for (let x = 4; x <= 11; x++) setPx(f, X + x, Y + y, INSIDE[y - 5]);
  for (let x = 4; x <= 11; x++) setPx(f, X + x, Y + 12, 'lamp-3');
  return f;
}

/**
 * The Smithy's forge, seen through its open doorway (the pack's tile 78), once its windows are lit;
 * `bright` at its last level. Checked against a blacksmith's forge at night seen from the street:
 * the hearth low at the back, the fire's heart white-yellow, orange round it, red coals at its
 * edge; its glow lighting the floor and the walls nearest it, darker toward the ceiling. Banked
 * low before the Smithy is fully alive, burning hot when it is.
 */
export function forgeGlow(f, [tx, ty], bright) {
  const X = tx * 16, Y = ty * 16;
  // The room, dark above and lit low by the fire.
  const ROOM = bright
    ? ['night-1', 'lamp-1', 'lamp-1', 'lamp-2', 'lamp-2', 'lamp-2', 'lamp-3', 'lamp-3', 'lamp-3', 'lamp-3', 'lamp-4']
    : ['night-1', 'night-1', 'night-1', 'lamp-1', 'lamp-1', 'lamp-1', 'lamp-1', 'lamp-2', 'lamp-2', 'lamp-2', 'lamp-2'];
  for (let y = 5; y <= 15; y++) for (let x = 4; x <= 11; x++) setPx(f, X + x, Y + y, ROOM[y - 5]);
  // The hearth: a stone lip, the fire on it.
  for (let x = 5; x <= 10; x++) setPx(f, X + x, Y + 13, 'night-3');
  const fire = bright
    ? [[7, 9, 'lamp-5'], [8, 9, 'lamp-5'], [7, 10, 'lamp-6'], [8, 10, 'lamp-6'], [6, 11, 'lamp-4'], [7, 11, 'lamp-6'], [8, 11, 'lamp-5'], [9, 11, 'lamp-4'], [5, 12, 'rot-3'], [6, 12, 'lamp-4'], [7, 12, 'lamp-5'], [8, 12, 'lamp-5'], [9, 12, 'lamp-4'], [10, 12, 'rot-3'], [6, 10, 'lamp-4'], [9, 10, 'lamp-3']]
    : [[7, 11, 'lamp-3'], [8, 11, 'rot-3'], [6, 12, 'rot-2'], [7, 12, 'lamp-3'], [8, 12, 'lamp-4'], [9, 12, 'rot-2']];
  for (const [x, y, c] of fire) setPx(f, X + x, Y + y, c);
  return f;
}

// ---------------------------------------------------------------- each building its own outline

/** Stamp an outlined feature (drawn by `paintIt` on a frame the size of `f`) onto a building's frame. */
function rooftop(f, id, paintIt) {
  const g = blank(id, f.w, f.h);
  paintIt(g);
  const o = outlined(g, 'night-0', id);
  // outlined() grows the frame a pixel a side: put it back where it was drawn.
  for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
    const i = ((y + 1) * o.w + (x + 1)) * 4;
    if (o.rgba[i + 3] === 0) continue;
    const j = (y * f.w + x) * 4;
    for (let k = 0; k < 4; k++) f.rgba[j + k] = o.rgba[i + k];
  }
  return f;
}

/**
 * The Chapel's bell-cote on its ridge. Checked against a small chapel's bell-cote: two stone piers
 * standing up from the ridge, a little gabled cap across them, the bell hung in the arched opening
 * between (its lip the widest part), the stone lit on its left.
 */
export function bellcote(f, top) {
  const cx = Math.floor(f.w / 2);
  return rooftop(f, `${f.id}#bellcote`, (g) => {
    // The cap: a little gable in slate.
    for (let y = 0; y < 6; y++) for (let x = cx - 1 - y; x <= cx + y; x++) setPx(g, x, top - 15 + y, x <= cx - 1 ? 'fog-1' : 'night-5');
    // The piers and the opening between them, down to the ridge.
    for (let y = top - 9; y <= top + 1; y++) {
      for (const x of [cx - 5, cx - 4]) setPx(g, x, y, x === cx - 5 ? 'fog-3' : 'fog-2');
      for (const x of [cx + 3, cx + 4]) setPx(g, x, y, x === cx + 3 ? 'fog-2' : 'fog-1');
      for (let x = cx - 3; x <= cx + 2; x++) setPx(g, x, y, y === top - 9 ? 'fog-2' : 'night-1');
    }
    // The bell in the opening: crown, waist, and the flared lip.
    for (const [a, b, y] of [[cx - 1, cx, top - 8], [cx - 1, cx, top - 7], [cx - 2, cx + 1, top - 6], [cx - 2, cx + 1, top - 5], [cx - 3, cx + 2, top - 4]]) {
      for (let x = a; x <= b; x++) setPx(g, x, y, x === a ? 'lamp-5' : x === b ? 'lamp-3' : 'lamp-4');
    }
  });
}

/**
 * The Smithy's forge stack. Checked against a smithy's chimney: a square brick stack at the forge's
 * end of the ridge, taller than a house's chimney (it has to draw the forge), its bricks in courses
 * with the joints staggered, a projecting cap of a course of stone, black with soot at the top.
 */
export function forgeStack(f, top) {
  const x0 = f.w - 22, w = 7;
  return rooftop(f, `${f.id}#stack`, (g) => {
    for (let y = top - 13; y <= top + 3; y++) for (let x = x0; x < x0 + w; x++) {
      const course = (y - top) & 1, joint = (x - x0 + (course ? 2 : 0)) % 4 === 3;
      const c = y < top - 10 ? 'night-3' : joint ? 'rot-1' : x === x0 ? 'rot-3' : x === x0 + w - 1 ? 'rot-1' : 'rot-2';
      setPx(g, x, y, (y - top) % 3 === 0 && y >= top - 10 ? 'rot-1' : c);
    }
    for (let x = x0 - 1; x <= x0 + w; x++) { setPx(g, x, top - 11, x === x0 - 1 ? 'fog-3' : 'fog-2'); setPx(g, x, top - 10, 'fog-1'); }   // the cap
  });
}

/**
 * The Docks' flagstaff. Checked against a harbor office's flagstaff: a thin white pole standing up
 * from the gable end of the ridge, a ball at its top, a swallowtail pennant flying out from the
 * top of the halyard, its tail split in two.
 */
export function flagstaff(f, top) {
  const x = 9;
  return rooftop(f, `${f.id}#flag`, (g) => {
    for (let y = top - 15; y <= top + 1; y++) setPx(g, x, y, 'fog-4');
    setPx(g, x, top - 15, 'fog-5');
    // The pennant, out to the east (the wind off the sea), its tail split.
    const rows = [[1, 9], [1, 8], [1, 5], [1, 4]];
    rows.forEach(([a, b], k) => { for (let i = a; i <= b; i++) setPx(g, x + i, top - 14 + k, k < 2 ? (i === a ? 'rot-4' : 'rot-3') : 'rot-2'); });
    setPx(g, x + 8, top - 12, 'rot-2'); setPx(g, x + 9, top - 11, 'rot-2');
  });
}

/**
 * The Market's weathervane. Checked against a market hall's weathervane: an iron rod from the
 * ridge's middle, the compass arms crossing it partway up, and on top a gilded figure that turns
 * with the wind (in a fishing town, a fish), side on.
 */
export function weathervane(f, top) {
  const cx = Math.floor(f.w / 2);
  return rooftop(f, `${f.id}#vane`, (g) => {
    for (let y = top - 11; y <= top + 1; y++) setPx(g, cx, y, 'night-4');
    for (let x = cx - 3; x <= cx + 3; x++) setPx(g, x, top - 5, 'night-4');   // the arms
    setPx(g, cx, top - 6, 'night-4');
    // The fish: a body with its tail split, gilded, lit along its back.
    const fish = [[-3, 0, 'lamp-4'], [-2, 0, 'lamp-5'], [-1, 0, 'lamp-5'], [0, 0, 'lamp-5'], [1, 0, 'lamp-4'], [-2, 1, 'lamp-3'], [-1, 1, 'lamp-4'], [0, 1, 'lamp-4'], [1, 1, 'lamp-3'], [2, -1, 'lamp-4'], [2, 2, 'lamp-3'], [3, -1, 'lamp-4'], [3, 2, 'lamp-3'], [-3, 1, 'lamp-3']];
    for (const [dx, dy, c] of fish) setPx(g, cx + dx, top - 13 + dy, c);
  });
}

/**
 * The Apothecary's chimney pots. Checked against chimney pots on an old town house: a low brick
 * stack at the gable end of the ridge carrying two tall round terracotta pots of different
 * heights, each a little wider at its mouth with a rim, lit on its left (its stills and its drying
 * fire need their flues).
 */
export function chimneyPots(f, top) {
  const x0 = 12;
  return rooftop(f, `${f.id}#pots`, (g) => {
    for (let y = top - 3; y <= top + 2; y++) for (let x = x0; x < x0 + 11; x++) setPx(g, x, y, (y - top) % 2 === 0 && x % 3 === 0 ? 'rot-1' : x === x0 ? 'rot-3' : 'rot-2');
    for (const [px, h] of [[x0 + 1, 9], [x0 + 7, 7]]) {
      for (let y = top - 3 - h; y < top - 3; y++) for (let x = px; x < px + 3; x++) setPx(g, x, y, x === px ? 'rot-4' : x === px + 2 ? 'rot-2' : 'rot-3');
      for (let x = px - 1; x <= px + 3; x++) setPx(g, x, top - 3 - h, x === px - 1 ? 'rot-4' : 'rot-3');   // the rim
      setPx(g, px + 1, top - 3 - h + 1, 'night-2');                                                          // its dark mouth
    }
  });
}

/**
 * The Cartographer's lookout. Checked against a widow's walk on a harbor house: a small flat deck
 * along the ridge with a railing round it, the posts at its corners taller with a cap, a top rail
 * and thin balusters between; somewhere to stand and watch the sea and the charts' coast.
 */
export function lookout(f, top) {
  const cx = Math.floor(f.w / 2), a = cx - 12, b = cx + 11;
  return rooftop(f, `${f.id}#lookout`, (g) => {
    for (let x = a; x <= b; x++) { setPx(g, x, top, 'wood-3'); setPx(g, x, top + 1, 'wood-1'); setPx(g, x, top - 6, 'wood-4'); }   // the deck, the top rail
    for (let x = a + 2; x < b; x += 3) for (let y = top - 5; y < top; y++) setPx(g, x, y, 'wood-2');                         // balusters
    for (const x of [a, b]) for (let y = top - 8; y <= top; y++) setPx(g, x, y, y === top - 8 ? 'wood-4' : 'wood-3');      // the corner posts, capped
  });
}

/**
 * The Library's roof lantern. Checked against a library's cupola: a small square turret standing on
 * the ridge, an arched window in its face lit from inside (it lights the reading room below), a
 * pointed lead cap on it and a finial at the top; the stone lit on its left.
 */
export function cupola(f, top) {
  const x0 = f.w - 22, w = 9;
  return rooftop(f, `${f.id}#cupola`, (g) => {
    for (let y = top - 8; y <= top + 1; y++) for (let x = x0; x < x0 + w; x++) setPx(g, x, y, x === x0 ? 'fog-3' : x === x0 + w - 1 ? 'fog-1' : 'fog-2');
    for (let y = top - 6; y <= top - 1; y++) for (let x = x0 + 3; x <= x0 + 5; x++) setPx(g, x, y, y === top - 6 && x !== x0 + 4 ? 'fog-2' : y < top - 3 ? 'lamp-5' : 'lamp-4');   // the arched window, lit
    for (let k = 0; k < 5; k++) for (let x = x0 - 1 + k; x <= x0 + w - k; x++) setPx(g, x, top - 9 - k, x < x0 + 4 ? 'night-5' : 'night-4');   // the lead cap
    setPx(g, x0 + 4, top - 14, 'fog-3'); setPx(g, x0 + 4, top - 15, 'fog-3');                                                            // the finial
  });
}

/**
 * The Tavern's great chimney. Checked against an old inn's chimney: a broad stone stack carrying
 * several flues (its kitchen and its hearths), three short pots in a row on top, a projecting
 * course under them, the stone blackened toward the top; broader and squatter than a house's.
 */
export function innChimney(f, top) {
  const x0 = 8, w = 14;
  return rooftop(f, `${f.id}#chimney`, (g) => {
    for (let y = top - 6; y <= top + 2; y++) for (let x = x0; x < x0 + w; x++) {
      const joint = (y - top) % 3 === 0 || (x - x0 + ((y - top) % 6 < 3 ? 0 : 2)) % 5 === 4;
      setPx(g, x, y, y < top - 4 ? 'night-4' : joint ? 'night-5' : x === x0 ? 'fog-3' : x === x0 + w - 1 ? 'fog-1' : 'fog-2');
    }
    for (let x = x0 - 1; x <= x0 + w; x++) setPx(g, x, top - 7, x === x0 - 1 ? 'fog-3' : 'fog-2');                     // the course
    for (const px of [x0 + 1, x0 + 6, x0 + 11]) for (let y = top - 10; y < top - 7; y++) for (let x = px; x < px + 2; x++) setPx(g, x, y, x === px ? 'rot-3' : 'rot-2');
  });
}

/**
 * The Lighthouse's lantern room (0.9.0). Checked against a small harbor light's top (written
 * descriptions: the image search gave captions only): a glazed room on the tower, its glass split
 * by upright glazing bars, a gallery round it a little wider than the room with an iron railing on
 * posts, and a conical cap with a ball vent at its peak. Light from the top left like the rest of
 * the harbor: the cap and the left posts lit, the right side shaded. Dark glass before the lamp is
 * relit (the roof's stage), lit from the 'lit' stage, brightest when the building is alive.
 */
export function lanternRoom(f, top, stage) {
  const cx = Math.floor(f.w / 2);
  const lit = stage === 'lit' || stage === 'keeper' || stage === 'alive';
  const bright = stage === 'alive';
  return rooftop(f, `${f.id}#lantern`, (g) => {
    // The gallery deck, a rail on posts, across the roof's ridge.
    for (let x = cx - 11; x <= cx + 10; x++) { setPx(g, x, top, 'fog-2'); setPx(g, x, top + 1, 'night-2'); setPx(g, x, top - 3, x < cx ? 'fog-3' : 'fog-2'); }
    for (let x = cx - 11; x <= cx + 10; x += 3) for (let y = top - 2; y < top; y++) setPx(g, x, y, x < cx ? 'fog-2' : 'fog-1');
    // The glass, from the deck up, split by its bars.
    for (let y = top - 10; y <= top - 1; y++) for (let x = cx - 6; x <= cx + 5; x++) {
      const bar = (x - (cx - 6)) % 4 === 0 || x === cx + 5;
      const glass = !lit ? 'night-1' : bright ? (y < top - 6 ? 'lamp-6' : 'lamp-5') : (y < top - 6 ? 'lamp-5' : 'lamp-4');
      setPx(g, x, y, bar ? 'night-2' : glass);
    }
    // The cap: a cone in dark iron, lit on its left, and the ball vent on top.
    for (let k = 0; k < 4; k++) for (let x = cx - 7 + k; x <= cx + 6 - k; x++) setPx(g, x, top - 11 - k, x < cx ? 'night-5' : 'night-4');
    setPx(g, cx - 1, top - 15, 'fog-3'); setPx(g, cx, top - 15, 'fog-2');
  });
}
