// The Salt Marsh's enemies (0.8.0), drawn in code as one-color masks (or a pack tile with salt
// built onto it), so the atlas builder colors them like every 1-Bit Pack sprite: lit on the top and
// left, shaded bottom and right, holes dark, a one-pixel outline (§16.1, §16.5). One light (top
// left), 1 px lines, the pack's own figures as the style anchor. Each names what it was checked
// against (written references: image search gave nothing back).

import { mask, put, ellipse, line, rect, poly, maskFromRows, copyMask, subtract, count } from '../../tools/atlas/mask.mjs';
import { createRng } from '../../src/lib/rng.js';
import { setPx, rgbOf } from '../../src/render/pixels.js';

/**
 * The Midge Cloud, two frames of its drift. A swarm of biting midges at dusk is a loose ball of
 * single specks, thickest in the middle and thinning to strays at the edge, each speck shifting
 * on its own. (Not a solid shape: the pack's "bug" tiles read as one big insect.)
 */
export function midgeCloud() {
  const frames = [];
  for (let k = 0; k < 2; k++) {
    const m = mask(13, 12);
    const rng = createRng(`midges-${k}`);
    // Specks by distance from the middle: most within 3 px, some out to 6.
    for (let n = 0; n < 26; n++) {
      const a = rng.next() * Math.PI * 2, r = (rng.next() + rng.next() + rng.next()) / 3 * 6;
      put(m, 6 + Math.cos(a) * r, 6 + Math.sin(a) * r * 0.85);
    }
    frames.push(m);
  }
  return frames;
}

/**
 * Salt crust on a figure: lumps of salt built up on its top surfaces (the head, the shoulders, the
 * tops of the arms), the way salt crystallizes where brine dries and the rain doesn't reach: in
 * knobbly clusters that stand off the surface and change the outline. (Hanging drips read as
 * icicles: the first drawing had them and the figure read as a snowman.) Returns the crust as its own
 * mask (the figure stays as it is under it).
 */
export function saltCrust(body, seed, every = 4) {
  const { w, h } = body;
  const crust = mask(w, h);
  const rng = createRng(`salt-${seed}`);
  const on = (x, y) => x >= 0 && y >= 0 && x < w && y < h && body.a[y * w + x] === 1;
  let n = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!on(x, y) || on(x, y - 1)) continue;                 // a top surface
    if ((x + y * 7 + n) % every !== 0) continue;
    n++;
    // A lump: two or three crystals heaped on the surface, one standing proud of it.
    put(crust, x, y); put(crust, x, y - 1);
    if (rng.chance(0.6)) put(crust, x + 1, y - 1);
    if (rng.chance(0.4)) put(crust, x - 1, y);
  }
  return crust;
}

/** The Salted Dead: the pack's figure in a brimmed hat (tile 470), drowned in the marsh and crusted with salt. */
export function saltedDead(entry, { tile }) {
  const body = tile('onebit', 470);
  const crust = saltCrust(body, 'salted');
  return { layers: [{ mask: body, ramp: 'salted' }, { mask: crust, ramp: 'salt_crust' }] };
}

/** The Well Warden: the pack's heavy figure (tile 465), the old well's keeper, salt thick on him. */
export function wellWarden(entry, { tile }) {
  const body = tile('onebit', 465);
  const crust = saltCrust(body, 'warden', 3);
  return { layers: [{ mask: body, ramp: 'warden' }, { mask: crust, ramp: 'salt_crust' }] };
}

/**
 * The Mire Toad, from above. A toad sits wide and flat, wider than it is long, its eyes bulging up
 * from the top of its head, its front legs short and propped out to the sides, its long hind legs
 * folded in a Z beside its back end (thigh out, shin forward, foot back out). Warts are dark spots.
 */
export function mireToad() {
  // (The first drawing set the eyes high on a round head and drew the legs as 1 px lines: it read as
  // a cat's face on a spider. A toad's head runs straight into its body, the eyes are low bumps on
  // its front edge, and the thighs are thick.)
  return maskFromRows([
    '....###..###....',
    '....#.#..#.#....',
    '...##########...',
    '#.############.#',
    '################',
    '.####.#########.',
    '..#########.##..',
    '.##.##########.#',
    '##..#########.##',
    '#....######....#',
    '.##..........##.',
  ]);
}

/**
 * The Leech, two frames of its swim (head to the right; the view flips it). A leech is flattened,
 * tapering to the front sucker and broad at the back one, its body ringed: the rings show as
 * notches along its edges. It swims in waves along its length.
 */
export function leech() {
  // (The first drawing notched both edges and stepped the outline with its wave: it read as a key;
  // the next, worked out from a formula, rounded into steps and read as a blade. A leech's body is
  // smooth, a long flat teardrop, the back sucker round, the head end narrow; its rings fine: a
  // notch in the top edge. The second frame lifts the head a row, the wave it swims with.)
  return [
    maskFromRows([
      '..##.###.###....',
      '.#############..',
      '###############.',
      '################',
      '##############..',
      '.###########....',
      '..#######.......',
    ]),
    maskFromRows([
      '..##.###.###.##.',
      '.###############',
      '################',
      '##############..',
      '#############...',
      '.###########....',
      '..#######.......',
    ]),
  ];
}

// ---------------------------------------------------------------- the Marsh's characters (full color)


/**
 * The Punter's pole, held upright in his right hand: a punt pole is a long straight ash pole, much
 * taller than the man who pushes it, with an iron shoe at its foot forked in two prongs so it
 * grips the mud instead of sinking. (Drawn onto his padded frame: the shaft's x, its top and bottom.)
 */
export function poleInHand(body, x, top, bottom) {
  const f = body;
  for (let y = top; y <= bottom; y++) { setPx(f, x - 1, y, 'night-0'); setPx(f, x + 1, y, 'night-0'); }
  setPx(f, x, top - 1, 'night-0');
  for (let y = top; y <= bottom - 3; y++) setPx(f, x, y, y % 6 === 0 ? 'wood-3' : 'wood-4');
  // The iron shoe and its fork.
  setPx(f, x, bottom - 2, 'fog-3'); setPx(f, x, bottom - 1, 'fog-3');
  setPx(f, x - 1, bottom, 'fog-3'); setPx(f, x + 1, bottom, 'fog-3'); setPx(f, x, bottom, 'night-0');
  // (Outlined below and between the prongs only: a row five wide down there would stand as his feet.)
  setPx(f, x - 1, bottom + 1, 'night-0'); setPx(f, x + 1, bottom + 1, 'night-0');
  return f;
}

/**
 * The Bog Warden's hood: the pack's woman's long hair, recolored, already frames her face the way
 * a cowl does; this adds the hood's peak above her head (a hood's cloth stands in a soft point over
 * the crown) and the shadow just inside its opening, darker than anything on her but the outline.
 * `cx` the head's middle column in the padded frame, `top` its top row.
 */
export function hoodOver(body, cx, top) {
  const f = body;
  // The peak: two rows narrowing above the crown, outlined.
  for (let x = cx - 2; x <= cx + 1; x++) setPx(f, x, top - 1, 'wood-4');
  for (let x = cx - 1; x <= cx; x++) setPx(f, x, top - 2, 'wood-4');
  for (let x = cx - 3; x <= cx + 2; x++) setPx(f, x, top - 2 + (x < cx - 1 || x > cx ? 1 : 0) - 1, 'night-0');
  setPx(f, cx - 3, top - 1, 'night-0'); setPx(f, cx + 2, top - 1, 'night-0');
  // The opening's shadow: hood cloth touching her face goes a step darker, and the hood's cloth is
  // one color elsewhere (the pack's hair strands, recolored flat, read as hair; a hood doesn't streak).
  const HOOD = rgbKey('wood-4'), SKIN = [rgbKey('skin-2'), rgbKey('skin-3')];
  const at = (x, y) => { const o = (y * f.w + x) * 4; return f.rgba[o + 3] > 0 ? (f.rgba[o] << 16) | (f.rgba[o + 1] << 8) | f.rgba[o + 2] : -1; };
  const edge = [];
  for (let y = 1; y < f.h - 1; y++) for (let x = 1; x < f.w - 1; x++) {
    if (at(x, y) !== HOOD) continue;
    if ([at(x - 1, y), at(x + 1, y), at(x, y - 1), at(x, y + 1)].some((c) => SKIN.includes(c))) edge.push([x, y]);
  }
  for (const [x, y] of edge) setPx(f, x, y, 'wood-2');
  return f;
}

function rgbKey(name) { const [r, g, b] = rgbOf(name); return (r << 16) | (g << 8) | b; }

// ---------------------------------------------------------------- the Marsh's props

/**
 * A glass pillar (where the Salt Widow's lightning strikes salt): a fulgurite standing, a crooked
 * tube of fused glass, knobbly outside where sand stuck to it, hollow down its middle, branching
 * into roots at its foot.
 */
export function pillar() {
  const r = [
    '.....##.....',
    '....####....',
    '....#..#....',
    '...##..##...',
    '....#..#....',
    '....##..#...',
    '...##..##...',
    '....#..#....',
    '...##..#....',
    '....#..##...',
    '...#...#....',
    '...##..##...',
    '....#..#....',
    '...##..##...',
    '...#...#.#..',
    '..##..###...',
    '..#..#.#.#..',
    '.##.##.#..#.',
    '#..#..#.#..#',
  ];
  return { layers: [{ mask: maskFromRows(r.map((x) => x.replace(/\./g, '.'))), ramp: 'glass' }] };
}

/** A herb bed on the creek mud: samphire (glasswort), jointed fleshy stems branching up from the mud. */
export function herbs() {
  return maskFromRows([
    '..#....#..',
    '..#.#..#.#',
    '#.###..###',
    '#..#.#..#.',
    '##.#.##.#.',
    '.###..###.',
    '..#....#..',
    '.######...',
  ]);
}

/** The Salt Well: an old stone well-head, a ring of stones round dark water, salt dried on its rim. */
export function well() {
  const r = [
    '...ssssssss...',
    '.sssssssssssss',
    'ss##########ss',
    's#wwwwwwwwww#s',
    's#wwwwwwwwww#s',
    'ss##########ss',
    '.##.###.###.#.',
    '..##########..',
  ];
  return {
    layers: [
      { mask: maskOfCharLocal(r, '#'), ramp: 'iron' },
      { mask: maskOfCharLocal(r, 's'), ramp: 'salt_crust' },
      { mask: maskOfCharLocal(r, 'w'), ramp: 'well_water', shade: false },
    ],
  };
}

/**
 * The bog body on the Drowned Causeway's island (the secret), after the Tollund Man: found lying
 * curled on his side on the peat, knees drawn up, his head in a pointed leather cap, the skin
 * tanned dark by the bog.
 */
export function bogBody() {
  // (The first drawing laid him out straight and read as three lumps: he lies curled, his back
  // arched along the top, his knees up at his chest, his shins folded back under him.)
  return maskFromRows([
    '...##...............',
    '..####..............',
    '..#####.####........',
    '...###.#######......',
    '......#########.....',
    '....###########.....',
    '..#######.######....',
    '.#######...#####....',
    '..###...#######.....',
    '........######......',
  ]);
}

function maskOfCharLocal(rws, ch) {
  const m = mask(rws[0].length, rws.length);
  rws.forEach((row, y) => { for (let x = 0; x < row.length; x++) if (row[x] === ch) put(m, x, y); });
  return m;
}
