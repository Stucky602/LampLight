// The bosses' parts, drawn in code (ARCHITECTURE §5.13: big bosses are code rigs, several sprites
// animated by code). Each part is a set of one-color layers; the builder colors every layer with
// its ramp and outlines the part as one shape, so the bosses match the packs' look. How the parts
// fit together and move is src/render/rigs.js.

import { mask, ellipse, rect, line, poly, put, subtract, maskFromRows } from '../../tools/atlas/mask.mjs';

// ---------------------------------------------------------------- the Harbor Maw

/**
 * "The thing under the pier": an anglerfish head. Checked against a real anglerfish: the lower
 * jaw juts past the upper (an underbite); the teeth are long, thin needles that slant inward;
 * the eyes are small and set high; the lure is a spine on the forehead with a glowing bulb at
 * its tip. The bulb here glows like a lamp, which is the point: it lures lamplighters.
 */
export function mawBody() {
  const W = 48, H = 34;
  const hide = mask(W, H);
  ellipse(hide, 24, 17, 23.5, 17);
  rect(hide, 0, 27, W, H - 27, 0);                 // flat underside: the upper jaw's line
  // Gill slits, carved (they read as dark lines).
  for (const [x0, y0, x1, y1] of [[5, 14, 7, 20], [8, 13, 10, 20], [43, 14, 41, 20], [40, 13, 38, 20]]) line(hide, x0, y0, x1, y1, 0);
  const lip = mask(W, H);
  ellipse(lip, 24, 17, 23.5, 17);
  rect(lip, 0, 0, W, 23, 0);
  rect(lip, 0, 27, W, H - 27, 0);
  // Upper teeth: needles hanging from the lip, longer toward the front, slanting inward.
  const teeth = mask(W, H);
  const upper = [[7, 3], [10, 4], [13, 5], [17, 6], [21, 6], [26, 6], [30, 6], [34, 5], [37, 4], [40, 3]];
  for (const [x, len] of upper) {
    const lean = x < 24 ? 1 : -1;
    for (let k = 0; k < len; k++) put(teeth, x + (k >= len - 2 ? lean : 0), 26 + k);
  }
  const eyes = mask(W, H);
  ellipse(eyes, 13, 10, 3, 2.6); ellipse(eyes, 35, 10, 3, 2.6);
  const pupils = mask(W, H);
  put(pupils, 13, 10); put(pupils, 14, 10); put(pupils, 35, 10); put(pupils, 34, 10);
  const barnacles = mask(W, H);
  for (const [x, y] of [[20, 3], [28, 4], [24, 7], [6, 22], [42, 21], [17, 19], [31, 18], [9, 8], [39, 8]]) { put(barnacles, x, y); put(barnacles, x + 1, y); }
  return {
    layers: [
      { mask: hide, ramp: 'maw_hide' },
      { mask: lip, ramp: 'maw_lip' },
      { mask: barnacles, ramp: 'maw_barnacle', shade: false },
      { mask: eyes, ramp: 'maw_eye', shade: false },
      { mask: pupils, ramp: 'dark', shade: false },
      { mask: teeth, ramp: 'teeth' },
    ],
  };
}

/** The lower jaw: heavy, jutting, with needle teeth pointing up and in. */
export function mawJaw() {
  const W = 44, H = 15;
  const bone = mask(W, H);
  poly(bone, [0, 3, 44, 3, 41, 11, 33, 15, 11, 15, 3, 11]);
  rect(bone, 3, 3, 38, 3, 0);                      // the inside of the jaw (open at the top)
  const gum = mask(W, H);
  rect(gum, 3, 5, 38, 2);
  const teeth = mask(W, H);
  const lower = [[5, 3], [9, 4], [13, 5], [18, 5], [22, 4], [26, 5], [31, 5], [35, 4], [39, 3]];
  for (const [x, len] of lower) {
    const lean = x < 22 ? 1 : -1;
    for (let k = 0; k < len; k++) put(teeth, x + (k >= len - 2 ? lean : 0), 5 - k);
  }
  return {
    layers: [
      { mask: bone, ramp: 'maw_hide' },
      { mask: gum, ramp: 'maw_gum', shade: false },
      { mask: teeth, ramp: 'teeth' },
    ],
  };
}

/** The dark of the mouth, seen when the jaw drops. */
export function mawMouth() {
  const W = 40, H = 14;
  const dark = mask(W, H);
  ellipse(dark, 20, 5, 19.5, 9);
  rect(dark, 0, 0, W, 2, 0);
  const throat = mask(W, H);
  ellipse(throat, 20, 6, 9, 4);
  return { layers: [{ mask: dark, ramp: 'mouth', shade: false }, { mask: throat, ramp: 'throat', shade: false }], outline: null };
}

/** The lure's spine: rises from the forehead and arcs forward (drawn from its base, bottom left). */
export function mawStalk() {
  const m = mask(12, 16);
  line(m, 1, 15, 1, 9); line(m, 1, 9, 2, 5); line(m, 2, 5, 4, 2); line(m, 4, 2, 7, 0); line(m, 7, 0, 10, 1); line(m, 10, 1, 11, 3);
  put(m, 2, 15); put(m, 2, 14);
  return m;
}

/** The lure's bulb. */
export function mawBulb() {
  return maskFromRows(['.###.', '#####', '#####', '#####', '.###.']);
}

/** A pectoral fin, fanned out with rays (the right one; the rig mirrors it). A fish's pectoral fin is a fan of bony rays joined by thin skin, rooted at a narrow base behind the gills. */
export function mawFin() {
  const W = 12, H = 12;
  const m = mask(W, H);
  poly(m, [0, 5, 6, 0, 12, 1, 11, 7, 7, 12, 1, 9]);
  // Rays: carved lines from the root out to the edge.
  for (const [x1, y1] of [[6, 2], [9, 3], [9, 7], [6, 9]]) line(m, 1, 6, x1, y1, 0);
  return m;
}

// ---------------------------------------------------------------- the Tidecaller

/**
 * "It rings the tide in": a hooded figure in a long robe, eyes glowing in the dark of the hood.
 * Checked against a monk's cowl: the hood is a separate, pointed shape resting on the shoulders
 * and falls in a point at the back; the opening is darker than anything else on the figure.
 */
export function tidecallerRobe() {
  const W = 36, H = 46;
  const cloth = mask(W, H);
  // Hood: a rounded point on top.
  poly(cloth, [18, 0, 26, 5, 28, 12, 26, 17, 10, 17, 8, 12, 10, 5]);
  // Shoulders and robe, flaring to the hem.
  poly(cloth, [8, 13, 28, 13, 31, 19, 32, 30, 35, 42, 1, 42, 4, 30, 5, 19]);
  // A ragged hem: teeth cut into the bottom edge.
  for (let x = 1; x < 35; x += 4) { put(cloth, x + 1, 41, 0); put(cloth, x + 2, 41, 0); put(cloth, x + 2, 40, 0); }
  // Sleeves: folds carved down the front.
  line(cloth, 12, 21, 10, 38, 0); line(cloth, 24, 21, 26, 38, 0);
  const trim = mask(W, H);
  // The hood's rim and a sash, in the sea-green of old bronze.
  poly(trim, [18, 3, 24, 7, 25, 13, 23, 16, 13, 16, 11, 13, 12, 7]);
  subtract(trim, (() => { const t = mask(W, H); poly(t, [18, 5, 23, 8, 24, 13, 22, 15, 14, 15, 12, 13, 13, 8]); return t; })());
  rect(trim, 6, 24, 24, 2);
  const face = mask(W, H);
  poly(face, [18, 5, 23, 8, 24, 13, 22, 15, 14, 15, 12, 13, 13, 8]);
  const eyes = mask(W, H);
  put(eyes, 15, 11); put(eyes, 16, 11); put(eyes, 20, 11); put(eyes, 21, 11);
  // The right sleeve reaches out to the staff (the hand that grips it is its own part, drawn over
  // the staff so the grip shows).
  poly(cloth, [27, 19, 33, 21, 34, 25, 29, 26]);
  return {
    layers: [
      { mask: cloth, ramp: 'robe' },
      { mask: trim, ramp: 'bronze', shade: false },
      { mask: face, ramp: 'dark', shade: false },
      { mask: eyes, ramp: 'maw_eye', shade: false },
    ],
  };
}

/** The staff: a pole with a crook at the top that the bell hangs from (drawn crook to the right). A shepherd's crook curls out and down at the top, far enough to hang something from its tip. */
export function tidecallerStaff() {
  const W = 9, H = 56;
  const m = mask(W, H);
  rect(m, 1, 6, 2, 50);                 // the pole
  line(m, 1, 6, 1, 3); line(m, 2, 6, 2, 3);
  line(m, 2, 2, 4, 0); line(m, 3, 2, 5, 0);
  line(m, 5, 0, 7, 1); line(m, 6, 1, 8, 3); line(m, 7, 2, 8, 4);
  put(m, 8, 5); put(m, 8, 6);           // the hook's end, where the bell's rope ties on
  return m;
}

/** The bell, bronze gone green: the same ship's bell as the Tide Bell's icon, with its crown loop a little taller to hang from the crook. */
export function tidecallerBell() {
  return maskFromRows([
    '......##......',
    '.....#..#.....',
    '.....####.....',
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
  ]);
}

/**
 * A tentacle reaching out from under the hem (hanging down; the rig turns it). An octopus arm
 * tapers steadily from a thick root to a fine tip that curls over, with suckers along its
 * underside; the first drawing was a short stub with a hook and read as a claw.
 */
export function tidecallerTentacle() {
  return maskFromRows([
    '####.',
    '####.',
    '.###.',
    '.###.',
    '.##..',
    '.##..',
    '..#..',
    '..##.',
    '...#.',
    '...#.',
    '..##.',
    '..#..',
  ]);
}

/** The hand that grips the staff: grey and bony, fingers wrapped round the pole (a fist on a pole shows the knuckles in a row across it). */
export function tidecallerHand() {
  return maskFromRows([
    '.###.',
    '#####',
    '#####',
    '.##..',
  ]);
}

