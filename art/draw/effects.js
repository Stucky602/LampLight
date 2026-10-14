// Code-drawn effects (ARCHITECTURE §16.1: code supplies every effect): shots, experience gems,
// particles, shadows, and the pixel font. These are full-color frames in palette colors (see
// LEGEND in src/render/pixels.js), not one-color masks: they glow, so they don't take the packs'
// three-tone shading. Shots point right; the renderer turns them to face where they fly.

import { fromText, outlined, blank, setPx, fillRect, fillEllipse } from '../../src/render/pixels.js';
import { FONT, FONT_W, FONT_H, DIGITS, DIGIT_W, DIGIT_H } from '../../src/render/font.js';

// Shots. Warm and light (§16.4), brightest at the head. Each note names what it was checked
// against, as §16.5 asks.
const SHOTS = {
  // A signal flare in flight: a white-hot burning head, and a short trail behind it that cools
  // from yellow to orange (a flare's trail is the burning compound falling away, so it trails).
  proj_flare: [
    '..yY...',
    'LyYWWW.',
    '..yY...',
  ],
  proj_flare_big: [
    '...yY....',
    '.LyYWW...',
    'LyYWWWWW.',
    '.LyYWW...',
    '...yY....',
  ],
  // A lamp flame seen through its glass: round, a white core inside a yellow halo, no trail
  // (it circles you rather than flying).
  proj_lantern_orb: [
    '..YYY..',
    '.YWWWY.',
    'YWWwWWY',
    'YWwwwWY',
    'YWWwWWY',
    '.YWWWY.',
    '..YYY..',
  ],
  // A lighthouse lens seen head on: a Fresnel lens is rings of glass around a bright center, so
  // the beam reads as rings of yellow around a white-hot middle.
  proj_lens: [
    '...YYY...',
    '..YWWWY..',
    '.YWWwWWY.',
    'YWWwwwWWY',
    'YWwwwwwWY',
    'YWWwwwWWY',
    '.YWWwWWY.',
    '..YWWWY..',
    '...YYY...',
  ],
  // A whaling harpoon: a wooden shaft, an iron shank, and a head with one barb swept back.
  // (A real toggling harpoon's head has a single barb on one side; the placeholder had two, an
  // arrowhead, which is what an arrow looks like, not a harpoon.)
  proj_harpoon: [
    '..........W...',
    'lLLLLLLLLgYWWW',
  ],
  proj_harpoon_big: [
    '...........WW...',
    'lLLLLLLLLLggYWWW',
    'lLLLLLLLLLggYWW.',
  ],
  // Enemy shot: red-orange, the hazard color, with a hot middle.
  proj_hostile: [
    '.oOo.',
    'oOWOo',
    'OWWWO',
    'oOWOo',
    '.oOo.',
  ],
};

// Experience gems: bright cyan diamonds (§16.4), bigger and brighter as they're worth more. (A cut
// gem seen from the side: the flat facets of the crown catch the light at the top, and the
// pavilion narrows to a darker point below.)
const GEMS = {
  gem_1: ['.e.', 'eEe', 'eEe', 'CeC', '.C.'],
  gem_2: ['..e..', '.eEe.', 'eEwEe', 'eEEEe', 'CeEeC', '.CeC.', '..C..'],
  gem_3: ['...e...', '..eEe..', '.eEwEe.', 'eEwwwEe', 'eEEwEEe', 'CeEEEeC', '.CeEeC.', '..CeC..', '...C...'],
  gem_big: [
    '....e....', '...eEe...', '..eEEEe..', '.eEEwEEe.', 'eEEwwwEEe', 'eeEEwEEee',
    'CeeEEEeeC', '.CeeEeeC.', '..CeeeC..', '...CeC...', '....C....',
  ],
};

export function shots() {
  return Object.entries(SHOTS).map(([id, rows]) => fromText(id, rows));
}

export function gems() {
  return Object.entries(GEMS).map(([id, rows]) => outlined(fromText(id, rows)));
}

/** White particles (tinted when drawn) and the blob shadows. */
export function particles() {
  const out = [];
  const p1 = blank('p1', 1, 1); setPx(p1, 0, 0, 'white'); out.push(p1);
  const p2 = blank('p2', 2, 2); fillRect(p2, 0, 0, 2, 2, 'white'); out.push(p2);
  out.push(fromText('p3', ['.w.', 'www', '.w.']));
  out.push(fromText('p4', ['.ww.', 'wwww', 'wwww', '.ww.']));
  out.push(fromText('ring', ['..www..', '.w...w.', 'w.....w', 'w.....w', 'w.....w', '.w...w.', '..www..']));
  for (const [id, w, h] of [['shadow_s', 9, 3], ['shadow_m', 13, 4], ['shadow_l', 30, 8]]) {
    const s = blank(id, w, h);
    fillEllipse(s, w / 2, h / 2, w / 2, h / 2, 'night-0', 120);
    out.push(s);
  }
  return out;
}

/** The 5 x 7 font (plain and outlined) and the 3 x 5 digits for damage numbers (outlined). */
export function font() {
  const out = [];
  for (const [ch, rows] of Object.entries(FONT)) {
    const g = blank(`glyph:${ch}`, FONT_W, FONT_H);
    rows.forEach((r, y) => { for (let x = 0; x < FONT_W; x++) if (r[x] === '1') setPx(g, x, y, 'white'); });
    out.push(g);
    out.push(outlined(g, 'night-0', `glyph_o:${ch}`));
  }
  DIGITS.forEach((rows, n) => {
    const g = blank(`digit:${n}`, DIGIT_W, DIGIT_H);
    rows.forEach((r, y) => { for (let x = 0; x < DIGIT_W; x++) if (r[x] === '1') setPx(g, x, y, 'white'); });
    out.push(outlined(g, 'night-0', `digit:${n}`));
  });
  return out;
}
