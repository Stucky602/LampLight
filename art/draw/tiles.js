// The Drowned Docks' boards, drawn in code (the 1-Bit Pack has no plank floor). The ground is
// always darker and lower in contrast than every actor (ARCHITECTURE §16.4), so the whole tile
// stays inside night-1 to night-3: the boards read, the crowd reads over them.
//
// Checked against a real pier deck: long boards all running one way, about four to a tile here;
// a board runs for several feet before it ends, so a tile shows one board end at most, and half
// the floor none (the first version put an end in every board of every tile, and the deck read
// as a brick wall); where boards do end, the ends are staggered, never lined up; nails come in
// pairs over a joist; wet boards darken along the seams first. (Which tile goes where is the run
// view's: viewstate.js tileHash and FLOOR_PICK.)

import { blank, setPx, fillRect } from '../../src/render/pixels.js';
import { createRng } from '../../src/lib/rng.js';

/** One 16 x 16 floor tile; `variant` 0 to 3 changes the board ends, nails, and wear. */
export function planks(variant = 0) {
  const f = blank('planks', 16, 16);
  const rng = createRng(`docks-planks-${variant}`);
  fillRect(f, 0, 0, 16, 16, 'night-2');
  for (let row = 0; row < 4; row++) {
    const y = row * 4;
    fillRect(f, 0, y + 3, 16, 1, 'night-1');                  // the seam under each board
    // Grain: one faint lighter streak along the board, somewhere.
    const g = rng.int(16), len = 3 + rng.int(4);
    for (let k = 0; k < len; k++) setPx(f, (g + k) % 16, y + 1, 'night-3');
  }
  // A board end on some tiles only, one board each, with its pair of nails.
  const end = { 1: [1, 11], 2: [3, 5], 3: [0, 8] }[variant];
  if (end) {
    const [row, x] = end, y = row * 4;
    setPx(f, x, y, 'night-1'); setPx(f, x, y + 1, 'night-1'); setPx(f, x, y + 2, 'night-1');
    setPx(f, x - 1, y, 'night-3'); setPx(f, x - 1, y + 2, 'night-3');
    setPx(f, x + 1, y, 'night-3'); setPx(f, x + 1, y + 2, 'night-3');
  }
  // Water standing in a seam.
  if (variant === 2) for (let x = 9; x < 15; x++) setPx(f, x, 11, 'sea-1');
  return f;
}

// The rest of the wharf (the docks layout, src/sim/terrain.js buildDocks). Everything stays as
// dark as the boards or darker, so the crowd reads over the water and the bridges as it does
// over the deck; only the sheds' roofs sit a step lighter (an obstacle reads as one).

/**
 * Black harbor water in a slip: `variant` 0 and 1 are open water (a few dull crests, never
 * bright: the lamp is what lights water at night). `edges` names the wharf's sides it meets:
 * 'n' (the quay's lip, and its shadow falling on the water below it), 'w' and 'e' (the slip's
 * stone side, a lit lip and a shadow line).
 */
export function water(variant = 0, edges = '') {
  const f = blank('water', 16, 16);
  fillRect(f, 0, 0, 16, 16, 'night-1');
  const crests = variant === 1 ? [[2, 4, 3], [10, 9, 4], [5, 13, 3]] : [[8, 3, 4], [1, 8, 3], [11, 13, 3]];
  for (const [x, y, len] of crests) for (let j = 0; j < len; j++) setPx(f, (x + j) % 16, y, 'sea-1');
  if (edges.includes('w')) { fillRect(f, 0, 0, 1, 16, 'night-3'); fillRect(f, 1, 0, 1, 16, 'night-0'); }
  if (edges.includes('e')) { fillRect(f, 15, 0, 1, 16, 'night-3'); fillRect(f, 14, 0, 1, 16, 'night-0'); }
  if (edges.includes('n')) {
    fillRect(f, 0, 0, 16, 1, 'night-3');                          // the quay's lip
    fillRect(f, 0, 1, 16, 3, 'night-0');                          // its shadow on the water
  }
  return f;
}

/**
 * A bridge over a slip: the deck boards run north to south, across the way you walk (they sit
 * on stringers that run along the bridge), seams dark. `variant` 1 has the rail along its north
 * edge, 2 along its south (the side over open water).
 */
export function bridge(variant = 0) {
  const f = blank('bridge', 16, 16);
  fillRect(f, 0, 0, 16, 16, 'night-2');
  for (let col = 0; col < 4; col++) fillRect(f, col * 4 + 3, 0, 1, 16, 'night-1');
  for (const x of [1, 9]) { setPx(f, x, 5, 'night-3'); setPx(f, x, 11, 'night-3'); } // nails over the stringers
  // The rail: a low dark beam with one lit edge, kept inside the ground's own contrast (§16.4).
  if (variant === 1) { fillRect(f, 0, 0, 16, 2, 'night-1'); fillRect(f, 0, 0, 16, 1, 'night-3'); }
  if (variant === 2) { fillRect(f, 0, 14, 16, 2, 'night-1'); fillRect(f, 0, 14, 16, 1, 'night-3'); }
  return f;
}

/** The wreck's deck: boards gone soft and black, a plank missing here and there. */
export function deck(variant = 0) {
  const f = blank('deck', 16, 16);
  fillRect(f, 0, 0, 16, 16, 'night-1');
  for (let row = 0; row < 4; row++) fillRect(f, 0, row * 4 + 3, 16, 1, 'night-0');
  if (variant === 1) fillRect(f, 5, 4, 7, 3, 'night-0');          // a missing board
  setPx(f, 3, 9, 'wood-1'); setPx(f, 12, 1, 'wood-1');
  return f;
}

/**
 * A shed's roof seen from above: rows of tarred shingles, each row overlapping the one below
 * (a lit lower edge, a dark gap under it), the joins staggered row to row. `variant` 1 has a
 * shingle gone.
 */
export function roof(variant = 0) {
  const f = blank('roof', 16, 16);
  fillRect(f, 0, 0, 16, 16, 'night-4');
  for (let row = 0; row < 4; row++) {
    const y = row * 4;
    fillRect(f, 0, y + 2, 16, 1, 'night-5');                      // the shingle's lit edge
    fillRect(f, 0, y + 3, 16, 1, 'night-2');                      // the gap under it
    for (let x = (row % 2) * 3; x < 16; x += 6) setPx(f, x, y, 'night-3');   // the joins, staggered
    setPx(f, (row * 5 + 1) % 16, y + 1, 'night-3');                          // one worn spot a row
  }
  if (variant === 1) fillRect(f, 6, 4, 4, 3, 'night-2');
  return f;
}

/** A shed's front wall (the row of the shed nearest you): vertical boards under the eave. */
export function shedWall(variant = 0) {
  const f = blank('shed_wall', 16, 16);
  fillRect(f, 0, 0, 16, 16, 'wood-1');
  fillRect(f, 0, 0, 16, 2, 'night-2');                            // the eave's shadow
  for (let x = 3; x < 16; x += 4) fillRect(f, x, 2, 1, 14, 'night-1');
  if (variant === 1) { fillRect(f, 5, 5, 6, 11, 'night-0'); fillRect(f, 5, 5, 6, 1, 'wood-2'); } // a door
  return f;
}

/**
 * The wreck's hull: heavy planking, the ribs showing through where it has rotted (dark gaps
 * between lighter ribs), weed at the waterline. `variant` 1 is broken through further.
 */
export function hull(variant = 0) {
  const f = blank('hull', 16, 16);
  fillRect(f, 0, 0, 16, 16, 'wood-2');
  for (let x = 1; x < 16; x += 5) { fillRect(f, x, 0, 2, 16, 'wood-3'); fillRect(f, x + 2, 0, 1, 16, 'wood-1'); } // ribs, each with its shadow
  fillRect(f, 0, 7, 16, 1, 'night-1');
  if (variant === 1) fillRect(f, 4, 2, 5, 4, 'night-0');
  for (const x of [0, 6, 11]) setPx(f, x, 15, 'moss-2');             // weed
  return f;
}
