// The Salt Marsh's icons (0.8.0): its weapons, evolutions, passives, relics, and runes, as 16 x 16
// (or smaller) one-color masks, a few in layers. The builder colors each in its tag's ramp (relics
// violet, runes their stone) and frames it like every icon (§16.3). The Docks' icons are the style
// anchor: one thing, side on, lit from the top left, 1 px lines and 2 px shafts. Each names the
// real thing it was checked against (written references).

import { mask, maskFromRows, maskOfChar, ellipse, line, put, rect, subtract } from '../../tools/atlas/mask.mjs';

const rows = (r) => maskFromRows(r);

// ---------------------------------------------------------------- weapons

/** Brine Spring: brine bursting up out of the ground (a spring's spout: a column of water breaking into drops at its top, a pool at its foot). */
export function brineSpring() {
  // (The first drawing was a beaded column on a disc and read as a candlestick: a jet widens as it
  // rises and breaks into a crown, its drops arcing out and down.)
  return rows([
    '.....#.##.#.....',
    '...##.####.##...',
    '..#..######..#..',
    '.#...######...#.',
    '.#....####....#.',
    '#.....####.....#',
    '#......##......#',
    '.......##.......',
    '.......##.......',
    '#......##......#',
    '.......##.......',
    '...#..####..#...',
    '..############..',
    '...##########...',
  ]);
}

/** Ice Picks: two crossed (an ice pick is a short round wooden handle and a long thin steel spike to a point). */
export function icePicks() {
  const r = [
    's..............s',
    '.s............s.',
    '..s..........s..',
    '...s........s...',
    '....s......s....',
    '.....s....s.....',
    '......s..s......',
    '.......ss.......',
    '.......ss.......',
    '......h..h......',
    '....hhh..hhh....',
    '...hhhh..hhhh...',
    '..hhhh....hhhh..',
    '.hhhh......hhhh.',
    '.hhh........hhh.',
  ];
  return { layers: [{ mask: maskOfChar(r, 's'), ramp: 'steel' }, { mask: maskOfChar(r, 'h'), ramp: 'wood' }] };
}

/**
 * Fulgurite: the glass a bolt leaves in sand: a crooked, knobbly tube, hollow down its middle,
 * branching into roots below, the bolt above it.
 */
export function fulgurite() {
  // (The first drawing was 1 px lines and read as a crack. The tube is thick, its outside knobbly
  // with fused sand, its hollow a dark core down the middle.)
  return rows([
    '.......#........',
    '......##........',
    '.......#........',
    '......####......',
    '.....######.....',
    '......#..##.....',
    '.....##.###.....',
    '......##.##.....',
    '.....###.#.#....',
    '......##.###....',
    '.....###.##.....',
    '....####.###....',
    '...##.##.#.##...',
    '..##..#####.##..',
    '..#...##.##..#..',
    '.....##...##....',
  ]);
}

/**
 * Fog Horn (ruling 18 WD, in the Fulgurite's place): a ship's hand fog horn, side on (written
 * references, the image search showed no pictures here: the Swedish Tyfon and New England brass
 * hand horns of about 1900 are a straight brass cone about three times as long as its bell is wide,
 * flaring hard only in its last quarter, blown by a pump: a brass cylinder behind the cone's narrow
 * end with a plunger rod and a T-handle out of its back). Lit from the top left like the rest.
 */
export function fogHorn() {
  return rows([
    '................',
    '................',
    '..............##',
    '.............###',
    '#............###',
    '#..#####....####',
    '#..#####...#####',
    '################',
    '################',
    '#..#####...#####',
    '#..#####....####',
    '#............###',
    '.............###',
    '..............##',
    '................',
    '................',
  ]);
}

/**
 * Eel Pot: a wicker eel trap (a long basket with a funnel mouth the eel can get into and not out
 * of, its weave showing), an eel's body curving up out of its mouth, its head turned (the
 * first drawing put a small head on the lid, and it read as a cross).
 */
export function eelPot() {
  return rows([
    '..........####..',
    '.........######.',
    '........###..##.',
    '.......###......',
    '.....#####......',
    '....#.###..#....',
    '.....######.....',
    '...##########...',
    '..##.#.#.#.###..',
    '..############..',
    '..###.#.#.#.##..',
    '..############..',
    '..##.#.#.#.###..',
    '...##########...',
    '....########....',
  ]);
}

/** Anchor Chain: a heavy anchor swung on its chain (the links in a run, each a ring, the anchor at the end). */
export function anchorChain() {
  return rows([
    '##..............',
    '#.#.............',
    '.##.............',
    '...##...........',
    '...#.#..........',
    '....##..........',
    '......##........',
    '......#.#.......',
    '.......##.......',
    '.........#......',
    '.......#####....',
    '.........#......',
    '....#....#....#.',
    '....##...#...##.',
    '.....###.#.###..',
    '.......#####....',
  ]);
}

/** Glass Caltrops: two caltrops of glass (four points, so however one falls a point stands up). */
export function glassCaltrops() {
  // (The first drawing was two thin peaks and read as mountains. A caltrop stands on three legs
  // splayed from a heavy middle, the fourth point straight up, thick at the root, sharp at the tip.)
  return rows([
    '.....#..........',
    '.....#..........',
    '....###.........',
    '....###.........',
    '....###.........',
    '...#####....#...',
    '..##.#.##..###..',
    '.##..#..##.###..',
    '##...#...####.#.',
    '#....##.....#..#',
    '.....##.........',
    '......#.........',
  ]);
}

// ---------------------------------------------------------------- evolutions

/** Salt Pan: a shallow pan of brine dried to a crust (the crust cracked into plates), a heap of salt raked up on it. */
export function saltPan() {
  return rows([
    '.......##.......',
    '......####......',
    '.....######.....',
    '....########....',
    '################',
    '###.#####.######',
    '####.###.####.##',
    '#####.#.####.###',
    '####.###.##.####',
    '################',
    '.##..........##.',
  ]);
}

/**
 * Storm Glass: a sealed glass teardrop with feathery crystals grown in it (a sailor's storm glass,
 * said to foretell storms); the crystals a fern of fronds off a stem (a solid one read as a flame).
 */
export function stormGlass() {
  return rows([
    '.......##.......',
    '.......##.......',
    '......####......',
    '.....#....#.....',
    '....#......#....',
    '....#......#....',
    '....#......#....',
    '....#.#.#..#....',
    '....#..#...#....',
    '....#.#.#.##....',
    '....#..#...#....',
    '....##.#.#.#....',
    '....########....',
    '.....######.....',
    '....########....',
  ]);
}

/** Conger Pot: a conger's head out of the pot (a conger: a big eel, a wide mouth, teeth in rows). */
export function congerPot() {
  return rows([
    '....#######.....',
    '...##.#######...',
    '..############..',
    '.###########....',
    '.#.#.#.#........',
    '................',
    '.#.#.#.#........',
    '.##########.....',
    '..#########.....',
    '....######......',
    '...########.....',
    '..##########....',
    '..#.#.#.#.###...',
    '..##########....',
  ]);
}

/** Sea Anchor: a drogue (a canvas cone on bridles to one line, streamed behind a boat to hold it). */
export function seaAnchor() {
  return rows([
    '#...............',
    '.#..............',
    '..#.............',
    '...#............',
    '....#...........',
    '.....###........',
    '....#.#.#.......',
    '...#..#..#......',
    '..#...#...#.....',
    '.##########.....',
    '..########......',
    '...######.......',
    '....####........',
    '.....##.........',
  ]);
}

// ---------------------------------------------------------------- passives

/** Hoarfrost: a twig furred with frost (hoarfrost grows as needles off the windward side of a twig). */
export function hoarfrost() {
  // (The first drawing put short needles close on both sides and read as a braid: they grow long,
  // spaced, off the side the wind came from.)
  const m = mask(16, 16);
  line(m, 1, 15, 14, 2);
  for (let k = 2; k <= 12; k += 3) {
    const x = 1 + k, y = 15 - k;
    line(m, x, y, x - 3, y - 4);
    line(m, x + 1, y - 1, x + 1, y - 4);
  }
  return m;
}

/**
 * Copper Wire: a coil of wire seen end on, its turns a spiral, the loose end running off. (Side on,
 * the first drawing's last loop filled dark and read as a barrel.)
 */
export function copperWire() {
  const m = mask(16, 16);
  let px = 8, py = 8;
  for (let a = 0; a < Math.PI * 2 * 3.1; a += 0.08) {
    const r = 0.6 + a * 0.36;
    const x = 7.5 + Math.cos(a) * r, y = 8 + Math.sin(a) * r;
    line(m, px, py, x, y); px = x; py = y;
  }
  line(m, px, py, 15, 1);
  return m;
}

/** Grave Moss: a headstone with moss creeping over its top and down its side, lettering cut across its face (scattered marks read as a face). */
export function graveMoss() {
  const r = [
    '...mmmmmm.....',
    '..mmmmmmmm....',
    '.mmssssssmm...',
    '.mssssssssm...',
    '.mssss.sssm...',
    '.msss...ssm...',
    '.mssss.sssm...',
    '.mss...sssm...',
    '.mssssssssm...',
    '.mssssssss....',
    '.mmssssssss...',
    'mmmmmmmmmmmm..',
  ];
  return { layers: [{ mask: maskOfChar(r, 's'), ramp: 'iron' }, { mask: maskOfChar(r, 'm'), ramp: 'rot' }] };
}

/**
 * Bittern's Call: a bittern booming. A bittern is a stocky heron; alarmed it freezes with its bill
 * pointing straight up among the reeds; it calls with a deep boom. Sound rings off to its side.
 */
export function bitternsCall() {
  return rows([
    '...#............',
    '...#............',
    '...#.......#....',
    '..###...#...#...',
    '..###....#...#..',
    '..###....#...#..',
    '..####...#...#..',
    '.#####..#...#...',
    '.#####.....#....',
    '.######.........',
    '.######.........',
    '..#####.........',
    '...###..........',
    '...#.#..........',
    '..##.##.........',
  ]);
}

/** Waders: thigh-high rubber boots (a wader's leg runs up to the thigh, a strap at its top, a heavy sole). */
export function waders() {
  return rows([
    '.####...####....',
    '.#..#...#..#....',
    '.####...####....',
    '.####...####....',
    '.####...####....',
    '.####...####....',
    '.####...####....',
    '.####...####....',
    '.####...####....',
    '.#####..#####...',
    '.######.######..',
    '.######.######..',
  ]);
}

// ---------------------------------------------------------------- relics

/** Sea Urchin: its round shell bristling with spines in every direction. */
export function seaUrchin() {
  const m = mask(16, 16);
  ellipse(m, 8, 8, 4, 4);
  // The spines grow out of the shell, packed (standing off it, the first drawing's read as a sun's rays).
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2, len = k % 2 ? 6.4 : 7.6;
    line(m, 8 + Math.cos(a) * 3, 8 + Math.sin(a) * 3, 8 + Math.cos(a) * len, 8 + Math.sin(a) * len);
  }
  return m;
}

/**
 * Quench Bucket: a wooden bucket of water (staves, two hoops), the water slopping up out of it.
 * (Its rope handle, drawn, closed a dark dome over the rim and the bucket read as a bowler hat.)
 */
export function quenchBucket() {
  const r = [
    '...w....w.....',
    '.w...ww...w...',
    '....wwww.w....',
    '..w.wwww......',
    '.############.',
    '.#wwwwwwwwww#.',
    '..##########..',
    '..##########..',
    '..#.######.#..',
    '...########...',
    '...########...',
    '...#.####.#...',
    '....######....',
  ];
  return { layers: [{ mask: maskOfChar(r, '#'), ramp: 'wood' }, { mask: maskOfChar(r, 'w'), ramp: 'tide' }] };
}

/** Cold Iron: a forged iron nail (square shank, a hammered head, tapering to its point), frost off it. */
export function coldIron() {
  return rows([
    '####.......#..',
    '####......#.#.',
    '.###.......#..',
    '..##..........',
    '...##.........',
    '....##........',
    '.....##.......',
    '......##......',
    '.......##.....',
    '........##....',
    '.........##...',
    '..........#...',
  ]);
}

/** Watchman's Rattle: a ratchet rattle (a handle, a cog at its top, a wooden frame and tongue that clatters round it). */
export function watchmansRattle() {
  // (The frame square on top of the handle read as a signboard: it swings out to one side of the cog.)
  return rows([
    '................',
    '....##########..',
    '...##........#..',
    '..#.#.######.#..',
    '.#####.......#..',
    '..###.########..',
    '.#.#.#..........',
    '...#............',
    '...#............',
    '...#............',
    '...#............',
    '..###...........',
  ]);
}

/** Try-Pot: a whaler's try-pot (a great iron cauldron, rim rolled, its belly bulging, on short legs). */
export function tryPot() {
  return rows([
    '..############..',
    '.##############.',
    '..############..',
    '.##############.',
    '################',
    '################',
    '################',
    '.##############.',
    '..############..',
    '...##########...',
    '...#........#...',
    '..##........##..',
  ]);
}

/**
 * Brine Vat: a low wooden vat (upright staves bound by hoops), brine dark inside its rim, salt
 * crusted white over the edge. (The first drawing's staves were rows of holes and its salt the
 * wood's own color: it read as a crate.)
 */
export function brineVat() {
  const r = [
    '.s.ss.s..s.ss.s.',
    'ssssssssssssssss',
    '#..............#',
    '################',
    '.#.#.#.#.#.#.##.',
    '.##############.',
    '.#.#.#.#.#.#.##.',
    '.#.#.#.#.#.#.##.',
    '.##############.',
    '..#.#.#.#.#.##..',
  ];
  return { layers: [{ mask: maskOfChar(r, '#'), ramp: 'wood' }, { mask: maskOfChar(r, 's'), ramp: 'glass' }] };
}

/**
 * Bog Torc: an Iron Age torc (an open neck-ring, twisted strands, its two ends heavy knobs facing
 * each other across the gap), as the bog keeps them.
 */
export function bogTorc() {
  const m = mask(16, 14);
  ellipse(m, 8, 7.5, 7, 6);
  ellipse(m, 8, 7.5, 5, 4, 0);
  // The gap at the front, open (closed, the middle filled in and it read as a pie), and the two
  // knobbed ends facing each other across it.
  rect(m, 5, 0, 6, 5, 0);
  ellipse(m, 4, 3, 1.4, 1.4); ellipse(m, 12, 3, 1.4, 1.4);
  for (const [x, y] of [[3, 6], [2, 9], [4, 11], [7, 12], [10, 12], [12, 11], [14, 8], [13, 5]]) put(m, x, y, 0); // the twist
  return m;
}

// ---------------------------------------------------------------- runes (sigils, carved into the stone)

export const MARSH_SIGILS = {
  // Familiar: a small spirit, two eyes and a trailing tail.
  rune_familiar: ['..####..', '.#....#.', '.#.#.#.#', '.#....#.', '..#...#.', '...#..#.', '....#.#.', '.....##.'],
  // Spillway: water spilling down the steps of a weir.
  rune_spillway: ['##......', '.#......', '.###....', '...#....', '...###..', '.....#..', '.....###', '........'],
  // Marsh Fever: the haze off a fever (wavy lines rising).
  rune_marsh_fever: ['.#...#..', '#.#.#.#.', '...#...#', '........', '.#...#..', '#.#.#.#.', '...#...#', '........'],
  // Tarred: a drop of tar, a second drip below it.
  rune_tarred: ['...#....', '...#....', '..###...', '.#####..', '.#####..', '..###...', '........', '...#....'],
};
