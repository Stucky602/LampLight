// The Salt Marsh's bosses (0.8.0): their rig parts, drawn in code as one-color layers the builder
// colors and outlines like every pack sprite (§5.13, §16.5). How they fit and move is
// src/render/rigs.js and rigpose.js. Drawn facing right; the rig mirrors to face the way it walks.
// One light (top left), 1 px lines and 2 px limbs, the Harbor Maw and the Tidecaller as the anchor.

import { mask, ellipse, line, poly, put, rect, subtract, copyMask, maskFromRows } from '../../tools/atlas/mask.mjs';

// ---------------------------------------------------------------- the Old Grey (a grey heron)
//
// Checked against the grey heron (written descriptions): body 84 to 102 cm, standing about 1 m; the
// back and folded wings ash-grey, the underparts greyish-white with black on the flanks; the head and
// neck white, a broad black stripe from the eye back to a slender dangling black crest, bluish-black
// streaks down the front of the neck; the bill long, straight, and dagger-like, yellow; the legs very
// long, the joint that shows (the ankle) bending back; it stands with the neck in an S, and flies
// with the neck folded back and the legs trailing. The wings show only in action (still: false).

/** The body: the back's folded wings ash-grey, the underparts pale, a black flank stripe, plumes over the tail. */
export function greyBody() {
  const W = 34, H = 18;
  const whole = mask(W, H);
  // Held at a slant: the breast high at the front (right), the tail low at the back (left).
  poly(whole, [31, 5, 25, 1, 13, 2, 3, 10, 0, 14, 6, 16, 19, 15, 29, 12, 33, 8]);
  const back = mask(W, H);
  poly(back, [26, 1, 13, 2, 3, 10, 0, 14, 4, 14, 12, 9, 22, 6, 30, 5]);
  // The scapular plumes: long grey feathers hanging over the folded wings past the tail.
  line(back, 12, 6, 1, 15); line(back, 15, 6, 4, 16);
  const flank = mask(W, H);
  line(flank, 27, 10, 14, 13); line(flank, 27, 11, 15, 14);
  const pale = copyMask(whole);
  subtract(pale, back);
  return {
    layers: [
      { mask: whole, ramp: 'heron_pale' },
      { mask: back, ramp: 'heron_back' },
      { mask: flank, ramp: 'heron_dark', shade: false },
    ],
  };
}

/** The neck, in an S: white, bluish-black streaks down its front. Drawn from its base (bottom left). */
export function greyNeck() {
  const W = 12, H = 24;
  const m = mask(W, H);
  const path = [[3, 23], [5, 19], [7, 15], [7, 12], [5, 9], [4, 6], [5, 3], [7, 1]];
  for (let k = 0; k + 1 < path.length; k++) {
    const [x0, y0] = path[k], [x1, y1] = path[k + 1];
    line(m, x0, y0, x1, y1); line(m, x0 + 1, y0, x1 + 1, y1); line(m, x0 + 2, y0, x1 + 2, y1);
  }
  const streaks = mask(W, H);
  for (const [x, y] of [[9, 16], [9, 14], [8, 10], [7, 8], [8, 19], [7, 21]]) put(streaks, x, y);
  return { layers: [{ mask: m, ramp: 'heron_pale' }, { mask: streaks, ramp: 'heron_dark', shade: false }] };
}

/**
 * The head and its bill: a white head, the black stripe from the eye back into the slender crest
 * that hangs behind, a yellow eye, and the bill: long, straight, a dagger (as long again as the head
 * and more). Its pivot is where the neck meets it.
 */
export function greyHead() {
  const W = 27, H = 9;
  const head = mask(W, H);
  ellipse(head, 9.5, 4.5, 3.6, 3);
  const bill = mask(W, H);
  poly(bill, [12, 3, 26, 5, 12, 6]);
  const crest = mask(W, H);
  line(crest, 9, 3, 6, 2); line(crest, 6, 2, 3, 3); line(crest, 3, 3, 0, 5);   // the stripe into the crest
  line(crest, 5, 3, 1, 6);
  const eye = mask(W, H);
  put(eye, 10, 3);
  return {
    layers: [
      { mask: head, ramp: 'heron_pale' },
      { mask: bill, ramp: 'heron_bill' },
      { mask: crest, ramp: 'heron_dark', shade: false },
      { mask: eye, ramp: 'lure', shade: false },
    ],
  };
}

/**
 * A leg: from the hip down, the feathered top of the thigh, then the long bare leg, the joint that
 * shows bending back (a heron's "knee" is its ankle), the lower leg down to the foot, three long
 * toes forward and a short hind toe. Drawn from the hip (its pivot, top middle).
 */
export function greyLeg() {
  const W = 11, H = 28;
  const bare = mask(W, H);
  line(bare, 5, 3, 3, 13); line(bare, 6, 3, 4, 13);         // the upper leg, down and back
  line(bare, 3, 13, 5, 24); line(bare, 4, 13, 6, 24);       // the joint bends back; the lower leg down and forward
  line(bare, 5, 25, 10, 27); line(bare, 5, 25, 9, 26); line(bare, 5, 25, 7, 27);   // three toes forward
  line(bare, 5, 25, 2, 26);                                                         // the hind toe
  const thigh = mask(W, H);
  rect(thigh, 4, 0, 3, 4);
  return { layers: [{ mask: bare, ramp: 'heron_leg' }, { mask: thigh, ramp: 'heron_back' }] };
}

/**
 * A wing, spread, raised for the leap: broad and rounded (a heron's wings are long and broad, the
 * flight feathers dark, the coverts grey), drawn from the shoulder (bottom left). Only in action.
 */
export function greyWing() {
  const W = 30, H = 15;
  const whole = mask(W, H);
  poly(whole, [1, 14, 9, 5, 16, 1, 29, 0, 28, 3, 24, 5, 27, 6, 21, 9, 24, 10, 17, 12, 19, 13, 9, 14]);
  const coverts = mask(W, H);
  poly(coverts, [1, 14, 9, 5, 16, 1, 18, 1, 15, 8, 10, 14]);
  return { layers: [{ mask: whole, ramp: 'heron_dark_wing' }, { mask: coverts, ramp: 'heron_back' }] };
}

// ---------------------------------------------------------------- the Salt Widow
//
// "A tall figure crusted in salt who brings the storm": an open hooded cloak (a cloak hanging open
// shows its dark inside down the front, between its two edges), a dark face in the hood with pale
// eyes, salt dried on its hems (brine dries along the edge that dragged in it: the hem white and
// knobbly), and a crown of uneven salt spires (salt crystals grow as needles and blades, each its
// own height).

/** The cloak and hood: open down the front, dark inside, the face dark with pale eyes, salt dried on the hem. */
export function widowCloak() {
  const W = 36, H = 48;
  const cloth = mask(W, H);
  // The hood: a soft point on the crown, resting on the shoulders.
  poly(cloth, [18, 0, 25, 4, 27, 11, 26, 16, 10, 16, 9, 11, 11, 4]);
  // The cloak from the shoulders, flaring to a wide hem.
  poly(cloth, [9, 13, 27, 13, 30, 22, 32, 34, 35, 46, 1, 46, 4, 34, 6, 22]);
  // A ragged hem: teeth cut into the bottom edge.
  for (let x = 2; x < 34; x += 5) { put(cloth, x + 1, 45, 0); put(cloth, x + 2, 45, 0); put(cloth, x + 2, 44, 0); }
  const inside = mask(W, H);
  // Open down the front: the gap between its edges widens from the collar to the hem.
  poly(inside, [17, 17, 20, 17, 24, 44, 12, 44]);
  const face = mask(W, H);
  poly(face, [18, 5, 23, 8, 24, 13, 22, 15, 14, 15, 12, 13, 13, 8]);
  const eyes = mask(W, H);
  put(eyes, 15, 11); put(eyes, 16, 11); put(eyes, 20, 11); put(eyes, 21, 11);
  // Salt dried on the hem: knobbly, standing off the cloth.
  const salt = mask(W, H);
  for (let x = 1; x < 35; x++) if ((x * 7) % 5 < 3) { put(salt, x, 44 - ((x * 3) % 2)); put(salt, x, 43 - ((x * 5) % 3 === 0 ? 1 : 0)); }
  // (Salt up the front edges too, in the first drawing, read as two rows of buttons: the hem only.)
  return {
    layers: [
      { mask: cloth, ramp: 'widow_cloak' },
      { mask: inside, ramp: 'dark', shade: false },
      { mask: face, ramp: 'dark', shade: false },
      { mask: eyes, ramp: 'widow_eye', shade: false },
      { mask: salt, ramp: 'salt_crust' },
    ],
  };
}

/** Her crown: uneven salt spires on a band, each its own height, pointed. Drawn from the band's middle. */
export function widowCrown() {
  return maskFromRows([
    '.....#..........',
    '.....#....#.....',
    '..#..#....#.....',
    '..#.###...#..#..',
    '..#.###..###.#..',
    '.###.#...###.#..',
    '.###.#.#.###.##.',
    '################',
    '################',
  ]);
}

/** An arm: the cloak's sleeve hanging from the shoulder, a bony pale hand at its end. Drawn from the shoulder. */
export function widowArm() {
  const W = 8, H = 17;
  const sleeve = mask(W, H);
  poly(sleeve, [2, 0, 6, 0, 7, 12, 1, 12]);
  const hand = mask(W, H);
  rect(hand, 2, 12, 4, 3); put(hand, 2, 15); put(hand, 4, 15); put(hand, 5, 16);
  return { layers: [{ mask: sleeve, ramp: 'widow_cloak' }, { mask: hand, ramp: 'teeth' }] };
}
