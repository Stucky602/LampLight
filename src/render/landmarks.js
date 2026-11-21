// The maps' own task props, drawn in code (0.9.0, W4): the Drowned Docks' crane and the Salt
// Marsh's salt cairn. Pure: each is a list of rects [dx, dy, w, h, color name] round its foot (the
// ground point under it, y up negative), so render/signview.js draws them and a tool can render
// them to a picture. Side-on like the lamps and bells (the packs' props stand up the same way),
// lit from the top left (the light every prop in the game takes), a 1 px night-0 outline.
//
// The crane, after a level-luffing portal crane of an old harbor: a portal of two splayed legs
// over its rails, the machinery house on top, a lattice jib reaching up and out to the right, a
// short counter-jib and its weight behind, the rope and hook hanging from the jib's head. Scaled
// down as every landmark is (the player is 16 px; a 30 m crane would be 300): 56 px tall.
// The cairn, a waymark of field stones on the salt flats: five stones narrowing to a cap, the top
// ones crusted with salt. 16 px tall (a cairn stands about as high as a person's chest).

/** Rects a straight 1 px-wide stepped line from (x0, y0) to (x1, y1) covers, thickness t. */
function line(out, x0, y0, x1, y1, t, color) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let k = 0; k <= n; k++) {
    const x = Math.round(x0 + ((x1 - x0) * k) / n), y = Math.round(y0 + ((y1 - y0) * k) / n);
    out.push([x, y, 1, t, color]);
  }
}

function box(out, x, y, w, h, fill, light, shade) {
  out.push([x - 1, y - 1, w + 2, h + 2, 'night-0']);
  out.push([x, y, w, h, fill]);
  if (light) { out.push([x, y, w, 1, light]); out.push([x, y, 1, h, light]); }
  if (shade) out.push([x, y + h - 1, w, 1, shade]);
}

/** A stone: a box with its corners worn round. */
function stone(out, x, y, w, h, fill, light, shade) {
  out.push([x, y - 1, w, h + 2, 'night-0'], [x - 1, y, w + 2, h, 'night-0']);
  out.push([x, y, w, h, fill]);
  if (light) { out.push([x + 1, y, w - 2, 1, light]); out.push([x, y + 1, 1, h - 2, light]); }
  if (shade) out.push([x + 1, y + h - 1, w - 2, 1, shade]);
}

/** The crane's rects. ready: its lamp on the house lit (it can be used this act). */
export function craneRects(ready) {
  const r = [];
  // The rails it stands on.
  r.push([-14, -1, 29, 2, 'night-0'], [-13, -1, 27, 1, 'fog-1']);
  // The portal: two splayed legs (2 px, outlined), a beam across their tops.
  for (const s of [-1, 1]) {
    line(r, s * 12, 0, s * 5, -20, 3, 'night-0');
    line(r, s * 12 + (s < 0 ? 1 : 0), -1, s * 5 + (s < 0 ? 1 : 0), -20, 2, 'fog-2');
  }
  line(r, -9, -10, 9, -10, 1, 'fog-1');                    // the bracing between the legs
  box(r, -7, -22, 15, 3, 'fog-2', 'fog-3', 'fog-1');       // the portal's top beam
  // The counter-jib and its weight, behind (left).
  line(r, -2, -32, -13, -34, 2, 'night-0');
  line(r, -2, -33, -12, -34, 1, 'fog-2');
  box(r, -17, -37, 6, 6, 'night-4', 'night-5', 'night-2');
  // The machinery house.
  box(r, -6, -31, 12, 9, 'wood-3', 'wood-4', 'wood-2');
  r.push([2, -29, 2, 2, ready ? 'lamp-5' : 'night-2']);   // its window: lit while it's ready
  r.push([-6, -33, 12, 2, 'night-0'], [-5, -33, 10, 1, 'wood-2']);   // the roof
  // The jib: a lattice from the house up to its head (out to the right), drawn as two chords and
  // their diagonals.
  line(r, 4, -32, 34, -54, 1, 'night-0');
  line(r, 5, -30, 35, -52, 1, 'night-0');
  line(r, 4, -31, 34, -53, 2, 'fog-3');
  for (let x = 7; x < 33; x += 3) r.push([x, Math.round(-31 - ((x - 4) * 22) / 30), 1, 2, 'night-2']);   // the lattice's bays
  box(r, 34, -55, 3, 3, 'fog-2', 'fog-4', null);           // the jib's head
  // The rope and the hook.
  r.push([35, -51, 1, 28, 'fog-4']);
  r.push([34, -23, 3, 1, 'night-0'], [34, -22, 1, 2, 'fog-5'], [36, -22, 1, 2, 'fog-5'], [35, -21, 1, 1, 'fog-5']);
  return r;
}

/** The cairn's rects. ready: its top stone's salt glints (it can be used this act). */
export function cairnRects(ready) {
  const r = [];
  // Field stones, the widest at the foot, each set a little off the one under it, their corners
  // worn round (a rounded box: the outline pulled in a pixel at each corner).
  stone(r, -7, -4, 13, 4, 'fog-2', 'fog-3', 'fog-1');
  stone(r, -5, -8, 12, 4, 'fog-1', 'fog-2', 'night-5');
  stone(r, -6, -11, 8, 3, 'fog-2', 'fog-3', 'fog-1');
  stone(r, -2, -14, 6, 3, 'fog-1', 'fog-2', 'night-5');
  stone(r, -2, -16, 4, 2, 'fog-3', 'fog-4', null);
  // Salt crusted on the top stones (pale, never white: the flats' rule).
  r.push([-1, -16, 2, 1, 'fog-5'], [-5, -11, 2, 1, 'fog-4'], [1, -14, 2, 1, 'fog-4']);
  if (ready) r.push([0, -17, 1, 1, 'fog-5'], [-1, -18, 1, 1, 'fog-4']);
  return r;
}

/** How tall each stands (its foot at y 0), for what's drawn over it. */
export const LANDMARK_TOP = Object.freeze({ crane: 56, cairn: 18 });
