// The Dash slot's eight items, each its own icon (C3, ruling 18 P2: they wore passives' and
// weapons' icons). One-color masks, ramped, outlined, and framed by the atlas like every icon, so
// they sit with the weapon and passive icons (the style anchor). Light from the top left (the
// ramp's). The image search returned captions only (no pictures to look at), so each was drawn from
// a written description of the real thing, named below, and judged against it pass by pass
// (work/cw/C3.md, the art log).
import { maskFromRows } from '../../tools/atlas/mask.mjs';

/**
 * Wick Step (its dash leaves a line of light that slows): a lit wick's flame at the head of the
 * line it leaves. Reference: a candle flame is a tongue narrow at its tip, round at its foot; the
 * line is the streak a flame leaves when it moves fast.
 */
export function dashWick() {
  return maskFromRows([
    '...............',
    '............#..',
    '...........##..',
    '...........###.',
    '..........####.',
    '..........#####',
    '.........######',
    '.........######',
    '.........######',
    '.#..#.##.######',
    '.........#####.',
    '..........###..',
  ]);
}

/**
 * Heavy Step (shorter, shoves what it passes): a heavy sea boot, side on. Reference: a tall shaft
 * to the calf, a heel at the back, a thick sole, the toe rounded and a little raised.
 */
export function dashHeavy() {
  return maskFromRows([
    '...######.....',
    '...######.....',
    '...######.....',
    '...######.....',
    '...######.....',
    '...######.....',
    '...#######....',
    '...#########..',
    '..###########.',
    '..############',
    '..############',
    '.#############',
    '.###....######',
  ]);
}

/**
 * Long Push (much farther): a punt pole thrust long. Reference: a punt pole is a long straight
 * pole with an iron shoe at its foot; the push is along its length.
 */
export function dashLong() {
  return maskFromRows([
    '.............###',
    '............####',
    '...........####.',
    '..........###...',
    '.........###....',
    '........###.....',
    '...#...###......',
    '..#...###.......',
    '.#...###........',
    '....###...#.....',
    '...###...#......',
    '..###...#.......',
    '.##.............',
    '.#..............',
  ]);
}

/**
 * Mire Step (where it ends, the ground slows): a footprint sunk in mud. Reference: a boot's print
 * is the sole's long oval and the heel's round apart from it, with mud pushed up round the edge.
 */
export function dashMire() {
  return maskFromRows([
    '........###....',
    '.......#####...',
    '......######...',
    '.....######....',
    '.....#####.....',
    '....#####......',
    '....####.......',
    '...............',
    '...###.........',
    '..#####........',
    '..####.........',
    '...##..........',
    '#.............#',
    '##...........##',
    '.###.......###.',
  ]);
}

/**
 * Sink (goes under, can't be hurt after): bubbles rising from below. Reference: bubbles rise and
 * swell as they go, so the biggest is highest; each a ring with a bright edge.
 */
export function dashSink() {
  return maskFromRows([
    '#.##..##..##..#',
    '.#..##..##..##.',
    '...............',
    '.....####......',
    '....#....#.....',
    '....#....#.....',
    '.....####......',
    '..........###..',
    '.........#...#.',
    '..........###..',
    '....##.........',
    '....##.........',
    '.........#.....',
  ]);
}

/**
 * Swell (where it ends, a ring of water throws back): a ring of water spreading, seen from above.
 * Reference: a ring wave is a round crest with calm water inside it and drops thrown off its rim.
 */
export function dashSwell() {
  return maskFromRows([
    '#.............#',
    '..#..#####..#..',
    '...##.....##...',
    '..#.........#..',
    '.#....###....#.',
    '.#...#...#...#.',
    '#....#...#....#',
    '.#...#...#...#.',
    '.#....###....#.',
    '..#.........#..',
    '...##.....##...',
    '..#..#####..#..',
    '#.............#',
  ]);
}

/**
 * Spare Oar (two charges): two oars crossed. Reference: an oar is a long round shaft with a grip at
 * one end and a flat blade at the other, the blade about a quarter of its length and widest near
 * its tip.
 */
export function dashOar() {
  return maskFromRows([
    '##............##',
    '###..........###',
    '####........####',
    '.###........###.',
    '..##........##..',
    '....#......#....',
    '.....#....#.....',
    '......#..#......',
    '.......##.......',
    '......#..#......',
    '.....#....#.....',
    '....#......#....',
    '...#........#...',
    '..##........##..',
  ]);
}

/**
 * Light Step (half the distance, recharges twice as fast): a feather. Reference: a feather is a
 * shaft tapering to its tip with vanes on both sides, one side wider, the whole a gentle curve, a
 * bare quill at its foot.
 */
export function dashLight() {
  return maskFromRows([
    '.............##',
    '...........####',
    '.........#####.',
    '........##.###.',
    '.......####.#..',
    '......#.##.##..',
    '.....####.##...',
    '....#.##.##....',
    '...####.##.....',
    '...##.###......',
    '..#####........',
    '..#............',
    '.#.............',
    '#..............',
  ]);
}
