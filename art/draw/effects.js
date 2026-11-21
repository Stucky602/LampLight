// Code-drawn effects (ARCHITECTURE §16.1: code supplies every effect): shots, experience gems,
// particles, shadows, and the pixel font. These are full-color frames in palette colors (see
// LEGEND in src/render/pixels.js), not one-color masks: they glow, so they don't take the packs'
// three-tone shading. Shots point right; the renderer turns them to face where they fly.

import { fromText, outlined, blank, setPx, fillRect, fillEllipse } from '../../src/render/pixels.js';
import { FONT, FONT_H, DIGITS, DIGIT_W, DIGIT_H } from '../../src/render/font.js';

// Shots. Warm and light (§16.4), brightest at the head. C3 (ruling 18 P2): no player shot uses the
// lamp's orange (lamp-3), which sat beside the enemies' red-orange tells: a flare is an illumination
// flare (white head, yellow tail), shafts and handles are wood, coins are gold. Each note names what it was checked
// against, as §16.5 asks.
const SHOTS = {
  // A signal flare in flight: a white-hot burning head, and a short trail behind it that cools
  // from yellow to orange (a flare's trail is the burning compound falling away, so it trails).
  proj_flare: [
    '..yY...',
    'yyYWWW.',
    '..yY...',
  ],
  proj_flare_big: [
    '...yY....',
    '.yyYWW...',
    'yyYWWWWW.',
    '.yyYWW...',
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
    'lAAAAAAAAgYWWW',
  ],
  proj_harpoon_big: [
    '...........WW...',
    'lAAAAAAAAAggYWWW',
    'lAAAAAAAAAggYWW.',
  ],
  // Signal Mirror: the flash where the beam leaves the glass, a four-point glint (sunlight off a
  // mirror shows as a star of light, brightest in the middle).
  fx_glint: [
    '...Y...',
    '...W...',
    '.yYWYy.',
    'YWWWWWY',
    '.yYWYy.',
    '...W...',
    '...Y...',
  ],
  // Oil Flask in flight: a round glass flask (amber oil showing through), a cork, and the rag
  // wick burning at its neck (a fire bottle is lit before it's thrown).
  proj_oil_flask: [
    '..WY..',
    '..yb..',
    '.AllA.',
    'AlYYlA',
    'AlYyAA',
    '.AAAA.',
  ],
  // Lightning Rod: the bright spot where the bolt lands (the bolt itself is drawn as a line,
  // render/runview.js drawBolts): a white center in a yellow flare.
  fx_bolt: [
    '.y.y.',
    'yYWYy',
    '.WWW.',
    'yYWYy',
    '.y.y.',
  ],
  // Corpse Candles: a candle flame floating with no candle, a will-o'-the-wisp (a small flame,
  // narrow at the tip, a white core, a cooler violet base where it floats free).
  proj_candle_flame: [
    '..Y..',
    '.yWy.',
    '.YWY.',
    'yWWWy',
    '.YWY.',
    '.xVx.',
  ],
  // The Salt Marsh's (0.8.0). Ice Picks: a pick thrown point first (a short round handle, a ferrule,
  // a long steel spike), the steel catching the lamp.
  proj_ice_pick: [
    '.AA........',
    'AAAyWWWWWWW',
    '.AA........',
  ],
  // Fulgurite and Storm Glass: a shard of lightning glass flying point first (long, narrow, jagged,
  // white-hot along its spine).
  proj_glass_shard: [
    '....yW...',
    'yYWWWWWWW',
    '..yWy....',
  ],
  // Eel Pot and Conger Pot: an eel lunging, head first, its body still in its wave behind it, pale
  // with the lamp on it, one unbroken body through its wave (a stepped one read as pieces).
  proj_eel: [
    '......yYYWW.',
    'yyY..YY...WW',
    '..YYYY......',
  ],
  // Anchor Chain and Sea Anchor: the anchor itself (ring, stock, shank, arms up into the flukes), its
  // iron hot in the lamplight.
  proj_anchor: [
    '....Y....',
    '...Y.Y...',
    '....Y....',
    '.YYYYYYY.',
    '....Y....',
    '....Y....',
    'y...Y...y',
    '.yy.Y.yy.',
    '...yyy...',
  ],
  // Glass Caltrops: a caltrop of glass on the ground, one point up, three legs out.
  proj_caltrop: [
    '..W..',
    '..W..',
    '.YWY.',
    'Y.Y.Y',
  ],
  // 0.9.0 (W2): the signature weapons'. Grapnel in flight, claws first: the shank, its claws curving
  // back from the head, the line trailing off the ring behind (sprites point right and turn).
  proj_grapnel: [
    '.....FG...',
    '......G...',
    'lllllFgGGG',
    '......G...',
    '.....FG...',
  ],
  // Grave Pennies: a penny spinning (a round copper coin, lit on its top left, a dark rim).
  proj_penny: [
    '.yy.',
    'yWyy',
    'yyyy',
    '.yy.',
  ],
  // Bog Hands: a hand out of the mire where it grasps (peat-tanned, leathery brown as bog bodies are,
  // lit amber by the lamp; fingers spread, the palm, mud heaped round the wrist).
  fx_mire_hand: [
    '...y...',
    '.y.B.B.',
    '.B.B.B.',
    '.yBBBB.',
    'y.BBBB.',
    '.BBlB..',
    '..BB...',
    'llllll.',
    '.llll..',
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

/** The HUD's font, Jersey 10 on its own grid (plain and outlined), and the 3 x 5 digits for damage numbers (outlined). */
export function font() {
  const out = [];
  for (const [ch, rows] of Object.entries(FONT)) {
    const w = rows[0].length;
    const g = blank(`glyph:${ch}`, w, FONT_H);
    rows.forEach((r, y) => { for (let x = 0; x < w; x++) if (r[x] === '1') setPx(g, x, y, 'white'); });
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
