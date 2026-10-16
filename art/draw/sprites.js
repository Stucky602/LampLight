// Sprites the packs don't have, drawn in code as one-color masks, so the atlas builder colors
// them exactly like the 1-Bit Pack's sprites (ARCHITECTURE §16.1, §16.5). Each note names the
// real thing it was checked against.

import { maskFromRows, mask, put, ellipse } from '../../tools/atlas/mask.mjs';
import { setPx } from '../../src/render/pixels.js';

// ---------------------------------------------------------------- creatures

/**
 * The gull, two wingbeats. A herring gull seen from below in flight: long narrow wings bent at
 * the wrist (the "gull wing": the inner wing rises from the body, the outer wing drops to a
 * pointed tip), a small body, a short square tail. Frame 0 is the upstroke (a V), frame 1 the
 * glide (the M).
 */
export function gull() {
  return [
    maskFromRows([
      '#..............#',
      '##............##',
      '.##..........##.',
      '..###......###..',
      '...####..####...',
      '.....######.....',
      '......####......',
      '.......##.......',
    ]),
    maskFromRows([
      '................',
      '....##....##....',
      '..###.#..#.###..',
      '.##...####...##.',
      '##....####....##',
      '#......##......#',
      '.......##.......',
      '................',
    ]),
  ];
}

/**
 * The mud crab, two steps of a scuttle. A shore crab from above: a shell wider than it is long,
 * two claws held forward with the pincers open (the gap between the two fingers shows), and
 * walking legs out to the sides, jointed, their pairs moving alternately. (The pack's nearest
 * creature stood upright like a bear with its arms raised, which read as anything but a crab.
 * The first drawing closed each claw into a ring, and the claws read as eyes.)
 */
export function crab() {
  const claws = [
    '.#.#........#.#.',
    '.###........###.',
    '..##........##..',
    '...##.####.##...',
    '....########....',
  ];
  const body = (legs) => maskFromRows([...claws, ...legs, '....#......#....']);
  return [
    body([
      '##.##########.##',
      '..############..',
      '##.##########.##',
      '...##########...',
    ]),
    body([
      '..############..',
      '##.##########.##',
      '..############..',
      '.##.########.##.',
    ]),
  ];
}

/**
 * The Glass Lantern: a hurricane lamp. (A hurricane lamp has a wire bail handle over a vented
 * cap, a bulging glass globe between vertical guards, and a squat fuel tank for a base.) The
 * handle is its own layer: the builder lights enclosed holes (that's what makes the globe glow),
 * and a wire loop is empty inside, not lit.
 */
export function hurricaneLamp() {
  const rows = [
    '....####....',
    '...#....#...',
    '...#....#...',
    '..########..',
    '...#.##.#...',
    '..#.#..#.#..',
    '.##......##.',
    '.#.#....#.#.',
    '.#.#....#.#.',
    '.##......##.',
    '..#.#..#.#..',
    '..########..',
    '.##########.',
    '.##########.',
  ];
  const only = (keep) => maskFromRows(rows.map((row, y) => (keep(y) ? row : '.'.repeat(row.length))));
  return { layers: [{ mask: only((y) => y >= 3), ramp: 'relic_lit' }, { mask: only((y) => y < 3), ramp: 'relic' }] };
}

// ---------------------------------------------------------------- icons (16 x 16 pictures)

/**
 * A ship's bell: a loop on the crown, rounded shoulders, a waist that flares to a heavy lip, and
 * the clapper hanging below. (Checked against a ship's bell: the lip is the widest, thickest
 * part, and the flare starts two thirds of the way down, not at the top like a cup.)
 */
const BELL = [
  '.....####.....',
  '.....#..#.....',
  '....######....',
  '...########...',
  '...########...',
  '...########...',
  '...########...',
  '..##########..',
  '..##########..',
  '.############.',
  '##############',
  '##############',
  '......##......',
  '......##......',
];

export function bell() { return maskFromRows(BELL); }

/** The Storm Bell: the bell with a lightning bolt beside it (a bolt zigzags down in sharp, uneven steps, never a smooth curve). */
export function stormBell() {
  const m = mask(16, 16);
  const b = maskFromRows(BELL.map((r) => r.slice(1, 13)));   // a slimmer bell, 12 wide
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) if (b.a[y * b.w + x]) put(m, x, y + 1);
  // The bolt: a zigzag down the right side.
  for (const [x, y] of [[15, 0], [14, 1], [15, 1], [13, 2], [14, 2], [13, 3], [12, 4], [13, 4], [14, 4], [15, 4], [14, 5], [15, 5], [13, 6], [14, 6], [13, 7], [12, 8]]) put(m, x, y);
  return m;
}

/**
 * Ballast: an anchor. (A fisherman's anchor: a ring at the top, a crossbar (the stock) below it,
 * a straight shank, and two curved arms ending in flukes that point up.)
 */
export function anchor() {
  return maskFromRows([
    '......##......',
    '.....#..#.....',
    '......##......',
    '..##########..',
    '......##......',
    '......##......',
    '......##......',
    '......##......',
    '......##......',
    '#.....##.....#',
    '##....##....##',
    '.##...##...##.',
    '..###.##.###..',
    '....######....',
  ]);
}

/** Undertow: a wave curling over. (A breaking wave: the crest curls forward and down over the hollow.) */
export function wave() {
  return maskFromRows([
    '.......#####....',
    '.....###...###..',
    '....##.......##.',
    '...##...###...##',
    '..##...##.##...#',
    '..#....#...#....',
    '.##....##.......',
    '.#......###.....',
    '##........##....',
    '#..........###..',
    '##...........###',
    '################',
  ]);
}

/**
 * A horseshoe magnet: the red body and the two pale poles. (A horseshoe magnet's poles are the
 * two bare ends of the U, usually painted silver or white against the red.) Two layers.
 */
export function magnet() {
  // A horseshoe magnet is a U: two straight, parallel arms and a round bottom as wide as the arms
  // are apart, the bare poles at the arms' tops. (Kevin, 0.6.0: it should look more U shaped; the
  // first one's arms leaned in to a narrow bottom. Now they run straight down to a round bend.)
  const rows = [
    '###......###',
    '###......###',
    '###......###',
    '###......###',
    '###......###',
    '###......###',
    '###......###',
    '###......###',
    '####....####',
    '############',
    '.##########.',
    '...######...',
  ];
  const body = maskFromRows(rows);
  const poles = maskFromRows(rows.map((r, y) => (y < 3 ? r : '.'.repeat(r.length))));
  return { layers: [{ mask: body, ramp: 'magnet' }, { mask: poles, ramp: 'steel' }] };
}

/** The Lantern Orb's icon: a ball of light with rays, the way a lamp flame looks through wet eyes (short rays on the diagonals, long ones straight out). */
export function orb() {
  const m = mask(15, 15);
  ellipse(m, 7.5, 7.5, 4.6, 4.6);
  for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) { put(m, 7 + dx * 6, 7 + dy * 6); put(m, 7 + dx * 7, 7 + dy * 7); }
  for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) put(m, 7 + dx * 5, 7 + dy * 5);
  return m;
}

/**
 * Salt-glass: a shard of glass. (Fulgurite-like salt glass breaks into long, narrow, pointed
 * pieces, not gem-cut diamonds; the first drawing had a dark hole in the middle and read as an
 * eye.)
 */
export function crystal() {
  return maskFromRows([
    '....#',
    '...##',
    '..###',
    '..##.',
    '.###.',
    '.##..',
    '###..',
    '##...',
  ]);
}

/** Volatile Gems: a gem with sparks flying off it (sparks leave a bursting thing on straight lines, so they sit on lines out from the middle). */
export function burstGem() {
  return maskFromRows([
    '#.............#.',
    '.#....#......#..',
    '......#.........',
    '.....###........',
    '....#####...#...',
    '...###.###......',
    '..###...###.....',
    '..#########.....',
    '...#######...#..',
    '....#####.......',
    '.....###........',
    '#.....#.......#.',
    '..............#.',
  ]);
}

/**
 * A street lamp for the lampyard (and, later, the hub's streets). Checked against a Victorian gas
 * lamp: a four-sided glass lantern under a peaked cap with a finial, a short crossbar below it
 * (the lamplighter leans a ladder on it), a tall thin post, and a heavier flared base.
 */
export function lampPost() {
  const rows = [
    '....#....',
    '...###...',
    '..#####..',
    '..#ggg#..',
    '..#ggg#..',
    '..#ggg#..',
    '..#####..',
    '....#....',
    '..#####..',
    '....#....',
    '....#....',
    '....#....',
    '....#....',
    '....#....',
    '....#....',
    '....#....',
    '....#....',
    '....#....',
    '....#....',
    '...###...',
    '...###...',
    '..#####..',
    '.#######.',
  ];
  const iron = maskFromRows(rows.map((r) => r.replace(/g/g, '.')));
  const glass = maskFromRows(rows.map((r) => r.replace(/#/g, '.')));
  return { layers: [{ mask: iron, ramp: 'staff' }, { mask: glass, ramp: 'lure', shade: false }] };
}

// ---------------------------------------------------------------- runes

// A rune is a stone with a sigil carved through it, the way runestones are cut: a flat slab with
// rounded corners, the sigil a groove in its face. The carving is left as holes, so the builder's
// hole fill makes it glow (the ramp's `hole` color).
function stone(sigil) {
  const rows = [
    '.##########.',
    '############',
    '############',
    '############',
    '############',
    '############',
    '############',
    '############',
    '############',
    '############',
    '############',
    '.##########.',
  ].map((r) => r.split(''));
  sigil.forEach((r, y) => { for (let x = 0; x < r.length; x++) if (r[x] === '#') rows[y + 2][x + 2] = '.'; });
  return maskFromRows(rows.map((r) => r.join('')));
}

export const RUNE_SIGILS = {
  // Splitting: one line that forks in two.
  rune_splitting: ['#......#', '.#....#.', '..#..#..', '...##...', '...##...', '...##...', '...##...', '........'],
  // Burning Ground: a flame.
  rune_burning: ['....#...', '...##...', '..###.#.', '..#####.', '.##.###.', '.#...##.', '.##.##..', '..###...'],
  // Orbiting: a ring with a dot riding it.
  rune_orbiting: ['..####..', '.#....#.', '#......#', '#..##..#', '#..##..#', '#......#', '.#....##', '..####.#'],
  // Backfire: a double-headed arrow.
  rune_backfire: ['........', '.#....#.', '##....##', '########', '##....##', '.#....#.', '........', '........'],
  // Chain Link: two links.
  rune_chain: ['###.....', '#.#.....', '#.####..', '###..#..', '..#..###', '..####.#', '.....#.#', '.....###'],
};

export function rune(id) {
  const s = RUNE_SIGILS[id];
  if (!s) throw new Error(`rune: no sigil for "${id}"`);
  return stone(s);
}

// ---------------------------------------------------------------- held things (full color)

/**
 * The Lamplighter's lantern, held out in her right hand: a loop handle, a cap, and the lit glass.
 * Drawn onto her (padded) sprite at the hand. (A hand lantern's glass is the widest, brightest
 * part; the cap and base are dark metal.)
 */
export function lanternInHand(body, handX, handY) {
  const f = body;
  const px = (x, y, c) => setPx(f, handX + x, handY + y, c);
  // The loop handle (open in the middle), the cap, the glass (three across: the widest and
  // brightest part), and the base; then a dark outline around the lot.
  const shape = [
    '..###..',
    '.#...#.',
    '.#####.',
    '#GGGGG#',
    '#GWWWG#',
    '#GGGGG#',
    '.#####.',
  ];
  const oy = -4, ox = -1;
  shape.forEach((row, y) => { for (let x = 0; x < row.length; x++) {
    const c = row[x];
    if (c === '#') px(x + ox, y + oy, 'night-0');
    else if (c === 'G') px(x + ox, y + oy, 'lamp-5');
    else if (c === 'W') px(x + ox, y + oy, 'lamp-6');
  } });
  px(ox + 3, oy + 2, 'lamp-2');                 // the cap's vent, brass
  px(ox + 3, oy + 6, 'lamp-2');                 // the base, brass
  return f;
}

/**
 * The Harpooner's harpoon, held upright in her right hand: an iron head with one barb, a short
 * iron shank, and a long wooden shaft. (Checked against a whaling harpoon: one barb, swept back;
 * the shaft is much longer than the iron.)
 */
export function harpoonInHand(body, x, top, bottom) {
  const f = body;
  // Outline down both sides of the shaft, then the shaft, then the iron.
  for (let y = top; y <= bottom + 1; y++) { setPx(f, x - 1, y, 'night-0'); setPx(f, x + 1, y, 'night-0'); }
  setPx(f, x, top - 1, 'night-0');
  setPx(f, x, bottom + 1, 'night-0');
  for (let y = top + 4; y <= bottom; y++) setPx(f, x, y, y % 5 === 0 ? 'wood-3' : 'wood-4');
  setPx(f, x, top, 'fog-5');          // the point
  setPx(f, x, top + 1, 'fog-4');
  setPx(f, x, top + 2, 'fog-3');      // the shank
  setPx(f, x, top + 3, 'fog-3');
  // The barb: one pixel out and back from the head, on the left.
  setPx(f, x - 1, top + 2, 'fog-4');
  setPx(f, x - 2, top + 3, 'fog-3');
  setPx(f, x - 2, top + 2, 'night-0'); setPx(f, x - 3, top + 3, 'night-0'); setPx(f, x - 2, top + 4, 'night-0'); setPx(f, x - 1, top + 1, 'night-0');
  return f;
}


/**
 * Signal Mirror: a round signaling mirror with a sighting hole in the middle and a short grip,
 * flashing (a heliograph mirror is round, with a hole to aim it through).
 */
export function signalMirror() {
  return maskFromRows([
    '#......#.....#..',
    '.#..........#...',
    '.....#####......',
    '...##.....##....',
    '..#.........#...',
    '..#....#....#...',
    '..#...#.#...#...',
    '..#....#....#...',
    '..#.........#...',
    '...##.....##....',
    '.....#####......',
    '.......#........',
    '.......#........',
    '......###.......',
  ]);
}

/** Oil Flask: a round-bellied flask, a cork, and a rag tied at the neck. */
export function oilFlask() {
  return maskFromRows([
    '.....##.....',
    '.....##..#..',
    '....####.#..',
    '.....##.#...',
    '.....##.....',
    '....#..#....',
    '..##....##..',
    '.#........#.',
    '#..######..#',
    '#.########.#',
    '#.########.#',
    '.#.######.#.',
    '..##....##..',
    '....####....',
  ]);
}

/** Lightning Rod: an iron rod with its pointed tip, the bolt coming down onto it. */
export function lightningRod() {
  return maskFromRows([
    '.........##.',
    '........##..',
    '.......##...',
    '......######',
    '.........##.',
    '....#...##..',
    '...###.##...',
    '...###......',
    '....#.......',
    '....#.......',
    '....#.......',
    '...###......',
    '....#.......',
    '....#.......',
    '..#####.....',
  ]);
}

/** Corpse Candles: three candle stubs on a skull's crown, their flames loose above them. */
export function corpseCandles() {
  return maskFromRows([
    '.#.....#.....#..',
    '###...###...###.',
    '.#.....#.....#..',
    '................',
    '.#.....#.....#..',
    '.#.....#.....#..',
    '.#.....#.....#..',
    '.##...###...##..',
    '..#########.....',
    '.###########....',
    '.##..###..##....',
    '.##..###..##....',
    '..####.####.....',
    '...#.#.#.#......',
  ].map((r) => r.padEnd(16, '.')));
}

/**
 * Wreck Lantern: a ship's lantern, its glass cracked and one pane gone, still burning (a ship's
 * lantern: a ring on top, a cage of bars around the glass, a heavy base).
 */
export function wreckLantern() {
  return maskFromRows([
    '.....##.....',
    '....#..#....',
    '.....##.....',
    '...######...',
    '..#..#...#..',
    '..#.#.#..#..',
    '..#..##..#..',
    '..#.####.#..',
    '..#.####....',
    '..#..##..#..',
    '..#......#..',
    '..########..',
    '.##########.',
  ]);
}

/**
 * An Ember (the drop that ascends a weapon): a live coal, a rough rounded lump with a flame
 * licking up from it. (A coal from a fire is a broken, blocky lump, not a gem; the flame narrows
 * to a tip and leans.)
 */
export function ember() {
  return maskFromRows([
    '....#....',
    '...##....',
    '...###...',
    '..####...',
    '..#####..',
    '.#######.',
    '#########',
    '####.####',
    '#########',
    '.#######.',
    '..#####..',
  ]);
}
