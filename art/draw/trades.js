// The art of the characters' trades (0.9.0, W2, ruling 2): what the two new characters hold, the
// signature weapons' icons and shots. Style anchor: the Tiny Dungeon characters as remapped (a 1 px
// night-0 outline, light from the top left) and the Docks' icons (one thing, side on, 1 px lines
// and 2 px shafts, one color mask colored in its tag's ramp). Written references and the passes are
// in work/veteran/W2-shots/art/passes.txt.

import { setPx } from '../../src/render/pixels.js';
import { maskFromRows } from '../../tools/atlas/mask.mjs';

const rows = (r) => maskFromRows(r);

/**
 * The Drowned Man's weed: a strand of dark weed draped over his bald crown and hanging down past
 * his ear to the shoulder (a drowned man comes up with the bottom on him). `x`, `y`: where it lies
 * over the crown, in the padded frame.
 */
export function weedOver(body, x, y) {
  const f = body;
  // Over the crown, then down the left side of his head (the side away from the light), lank.
  const strand = [[0, 0], [1, 0], [2, 0], [-1, 1], [0, 1], [-2, 1], [-3, 2], [-3, 3], [-3, 4], [-4, 5], [-3, 6], [-4, 7]];
  for (const [dx, dy] of strand) setPx(f, x + dx, y + dy, 'moss-2');
  // Lit on top where it lies over the crown.
  setPx(f, x + 1, y, 'moss-3'); setPx(f, x + 2, y, 'moss-3');
  // His hair at the temples and round his mouth shares the coat's color in the pack's tile: on his
  // head (the rows above the shoulders) it's the beard's wet dark brown, not the coat's rust.
  const RUST = [220, 86, 56];   // rot-3
  for (let yy = y; yy <= y + 7; yy++) for (let xx = 0; xx < f.w; xx++) {
    const o = (yy * f.w + xx) * 4;
    if (f.rgba[o + 3] && Math.abs(f.rgba[o] - RUST[0]) + Math.abs(f.rgba[o + 1] - RUST[1]) + Math.abs(f.rgba[o + 2] - RUST[2]) < 6) setPx(f, xx, yy, 'wood-1');
  }
  return f;
}

/**
 * The Tide Priest (0.9.0, W2, the lead's notes on pass 41): the pack's hooded robe (tile 111, to the
 * ground), with her face painted into the cowl's dark opening (a brow, two eyes, a chin in shade),
 * and a wooden crook held high, a small brass bell hanging from its hook (her Fog Bells; the warm
 * accent). `ox`, `oy`: where the tile sits in the padded frame; `stole`: the color of the stole down
 * her front (and the robe's far side shaded); `hood`: a color for the cowl alone (tried in pass 44,
 * not used); `side`: the hand holding the crook (her left, so it isn't another pole on the right
 * beside the Harpooner's and the Punter's).
 */
export function priestCowl(body, ox = 3, oy = 3, stole = null, hood = null, side = 'right') {
  const f = body;
  // (pass 47) Which hand holds the crook: on the left, the frame mirrors the crook and the bell.
  const mx = (x) => (side === 'left' ? f.w - 1 - x : x);
  const P = (x, y, c) => setPx(f, ox + x, oy + y, c);
  const isRgb = (x, y, rgb) => { const o = ((oy + y) * f.w + ox + x) * 4; return f.rgba[o + 3] && f.rgba[o] === rgb[0] && f.rgba[o + 1] === rgb[1] && f.rgba[o + 2] === rgb[2]; };
  // (pass 44) The cowl in its own color: the robe's pixels above her shoulders (tile rows 0 to 9).
  if (hood) {
    const robe = [...f.rgba.slice(((oy + 13) * f.w + ox + 4) * 4, ((oy + 13) * f.w + ox + 4) * 4 + 3)];
    for (let y = 0; y <= 9; y++) for (let x = 0; x < 16; x++) if (isRgb(x, y, robe)) P(x, y, hood);
  }
  // (pass 44) The stole: two strips of it down her front from the neck, over the robe.
  if (stole) for (let y = 10; y <= 15; y++) { P(6, y, stole); P(10, y, stole); }
  // (pass 46) The robe's side away from the light a step darker (tile columns 11 and 12, below the
  // shoulders): the cloth turns.
  if (stole) {
    const robe = [...f.rgba.slice(((oy + 13) * f.w + ox + 4) * 4, ((oy + 13) * f.w + ox + 4) * 4 + 3)];
    for (let y = 10; y <= 15; y++) for (const x of [11, 12]) if (isRgb(x, y, robe)) P(x, y, 'lamp-5');
  }
  // Her face in the cowl's opening (tile columns 5 to 10, rows 6 to 10): the top row stays the
  // hood's shadow; the brow lit, the eyes, the chin a step darker (the cowl shades it).
  for (let x = 6; x <= 9; x++) P(x, 7, 'skin-3');
  P(6, 8, 'night-0'); P(7, 8, 'skin-3'); P(8, 8, 'skin-3'); P(9, 8, 'night-0');
  for (let x = 6; x <= 9; x++) P(x, 9, 'skin-2');
  // The crook: a 1 px shaft right of her hand, from the ground to above her cowl, its hook turned
  // back over her head; outlined 1 px in night-0 like the body.
  const wood = [];
  for (let y = 4; y <= 19; y++) wood.push([mx(19), y]);
  wood.push([mx(19), 3], [mx(19), 2], [mx(18), 1], [mx(17), 1], [mx(16), 2], [mx(16), 3]);
  for (const [x, y] of wood) setPx(f, x, y, 'wood-4');
  // The hook's side away from the light (the light is from the top left).
  if (side === 'left') { setPx(f, mx(16), 2, 'wood-3'); setPx(f, mx(16), 3, 'wood-3'); }
  else { setPx(f, 18, 1, 'wood-3'); setPx(f, 19, 2, 'wood-3'); }
  // The bell under the hook: brass, lit on the left.
  const bell = side === 'left'
    ? [[mx(16), 4, 'lamp-5'], [mx(16) - 1, 5, 'lamp-5'], [mx(16), 5, 'lamp-3']]
    : [[16, 4, 'lamp-5'], [15, 5, 'lamp-5'], [16, 5, 'lamp-3']];
  for (const [x, y, c] of bell) setPx(f, x, y, c);
  // Outline: every empty pixel beside the crook or the bell.
  const isEmpty = (x, y) => x >= 0 && y >= 0 && x < f.w && y < f.h && !f.rgba[(y * f.w + x) * 4 + 3];
  for (const [x, y] of [...wood, ...bell]) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    if (isEmpty(x + dx, y + dy)) setPx(f, x + dx, y + dy, 'night-0');
  }
  // Her hand round the shaft, from her sleeve.
  setPx(f, mx(18), 14, 'skin-3'); setPx(f, mx(18), 15, 'skin-2');
  return f;
}

// ---------------------------------------------------------------- the signature weapons' icons

/** Grapnel: a grapnel side on (a ring for the line at the top, a 2 px shank, flukes curving up and out at its foot), its line trailing off the ring. */
export function grapnelIcon() {
  return rows([
    '##..............',
    '..##............',
    '....##.###......',
    '......#...#.....',
    '......#...#.....',
    '.......###......',
    '........#.......',
    '........#.......',
    '...#....#....#..',
    '...##...#...##..',
    '....#...#...#...',
    '....##..#..##...',
    '.....#######....',
    '.......###......',
    '........#.......',
    '.......#........',
  ]);
}

/** Punt Pole: a punt's pole on the slant (a 2 px wooden shaft), its iron fork at the foot, and the water's line where it goes in. */
export function puntPoleIcon() {
  return rows([
    '..............##',
    '.............##.',
    '............##..',
    '...........##...',
    '..........##....',
    '.........##.....',
    '........##......',
    '.......##.......',
    '......##........',
    '.....##.........',
    '....##..........',
    '...##...........',
    '..##............',
    '.#.#............',
    '##..##..........',
    '......###.......',
  ]);
}

/** Bog Hands: a hand risen out of the mire (fingers spread, the palm, the wrist), the mud heaped round the wrist. */
export function bogHandsIcon() {
  return rows([
    '......#.........',
    '...#..#..#......',
    '...#..#..#......',
    '...#..#..#..#...',
    '...##.##.#..#...',
    '....#######.#...',
    '....#########...',
    '....########....',
    '.....######.....',
    '.....######.....',
    '......####......',
    '......####......',
    '...##########...',
    '.##############.',
    '################',
    '................',
  ]);
}

/** Grave Pennies: two pennies, one lying behind the other (a coin's rim, the head in its middle). */
export function gravePenniesIcon() {
  return rows([
    '................',
    '........####....',
    '......########..',
    '.....##########.',
    '....####....####',
    '..##########.###',
    '.############.##',
    '.##........##.#.',
    '###.######.####.',
    '###.##..##.###..',
    '###.##..##.###..',
    '###.######.###..',
    '.##........##...',
    '.############...',
    '..##########....',
    '....######......',
  ]);
}

/** King Tide: a breaking wave, its crest curling over to the right, the trough below it (the sea, side on). */
export function kingTideIcon() {
  return rows([
    '................',
    '.......#####....',
    '.....#########..',
    '....#####...###.',
    '...####.......#.',
    '..####.......#..',
    '..####..........',
    '.#####..........',
    '.######.........',
    '########........',
    '###########.....',
    '###############.',
    '################',
    '................',
    '..###.....###...',
    '#####...#######.',
  ]);
}
