// The five elite affixes' icons (C3; data/enemies.js ELITE_AFFIXES names them: affix_<id>). Small
// one-color masks, ramped and outlined by the atlas like every item, so they sit with the pack's
// pickups (the style anchor: the Pearl and the Ember, art/draw/sprites.js). Light from the top left
// (the ramp's). Each names its reference. The image search returned captions only (no pictures to
// look at), so each was drawn from a written description and judged against it, pass by pass
// (work/cw/C3.md, the art log).
import { maskFromRows } from '../../tools/atlas/mask.mjs';

/**
 * Warded: a heater shield. Reference (written): a flat top edge, the sides straight down for about
 * half the height, then curving in to one point at the bottom; about four fifths as wide as tall.
 */
export function affixWarded() {
  return maskFromRows([
    '#########',
    '#########',
    '#########',
    '#########',
    '#########',
    '.#######.',
    '.#######.',
    '..#####..',
    '...###...',
    '....#....',
  ]);
}

/**
 * Herald: a herald's pennant (it comes with its own kind behind it). Reference (written): a
 * swallow-tailed flag flying from the top of a staff, the notch cut into its fly end. (Pass 1 was a
 * hunting horn from a written description of the Savernake Horn; at 9 px it read as a crescent moon.)
 */
export function affixHerald() {
  return maskFromRows([
    '##.......',
    '#######..',
    '#######..',
    '#####....',
    '######...',
    '#........',
    '#........',
    '#........',
    '#........',
    '#........',
  ]);
}

/**
 * Molten: a flame. Reference (written, as the ward's flame in art/draw/effects.js): a tongue narrow
 * at its tip, leaning, with a smaller tongue licking up beside it, and a broad flat foot (a fire on
 * the ground). Pass 1 was one teardrop and matched the Brine drop in shape: never color alone. Pass 2
 * had three even points and read as a crown; the side tongue is lower now, apart from the main one.
 */
export function affixMolten() {
  return maskFromRows([
    '....#....',
    '....##...',
    '...###...',
    '...####..',
    '.#.####..',
    '.##.####.',
    '.########',
    '#########',
    '.#######.',
  ]);
}

/**
 * Tethered: two chain links. Reference (written): oval links about one and a half times as long as
 * they are wide, open in the middle, each passed through the next; side by side, joined by the bar
 * where they pass. (Pass 1 had the second link edge on, and it read as a key; pass 2 had them side by
 * side with a bar between, and read as spectacles. Now they overlap on a slant, as a chain lies.)
 */
export function affixTethered() {
  return maskFromRows([
    '.#####.....',
    '#.....#....',
    '#....#####.',
    '.#####....#',
    '....#.....#',
    '.....#####.',
  ]);
}

/**
 * Brine: a drop of water. Reference (written): round at the bottom, drawing up to a point at the
 * top, the widest part low, about two thirds of the way down.
 */
export function affixBrine() {
  return maskFromRows([
    '....#....',
    '....#....',
    '...###...',
    '...###...',
    '..#####..',
    '.#######.',
    '#########',
    '#########',
    '.#######.',
    '..#####..',
  ]);
}
