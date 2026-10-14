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
