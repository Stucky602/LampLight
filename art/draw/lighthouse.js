// The Lighthouse as a tower (C3: it was the pack's stone house with a lantern on its roof; the
// sweep asked for a real tower). Drawn in code on the building's own plot (3 tiles by 4), its five
// stages as the other buildings have them; the lantern room on top is art/draw/harbor.js
// lanternRoom, as before.
//
// Reference (written: the image search gave captions only, no pictures to look at): a harbor light
// on a point, as the old British and New England ones stand. A round tower that tapers as it rises
// (about two thirds as wide at the top as at the foot), whitewashed smooth, with a dark band painted
// round its upper part as a daymark; a plinth of dressed stone at its foot a little wider than the
// tower; a door at the foot under a small arch; narrow slit windows up the stair, one each floor,
// on alternate sides; a gallery on corbels at the top, under the lantern room. Before it is
// whitewashed it is bare stone in courses. Light from the top left, as the rest of the harbor: the
// tower's left third lit, its right third in shade (a cylinder, not a box). One 1 px dark outline.
// Each pass and what it changed is logged in work/cw/C3.md (the art log).

import { blank, setPx, outlined, stamp } from '../../src/render/pixels.js';

const W = 48, H = 64;   // the plot: 3 tiles by 4

/** The tower's half width at row y (0 the top, under the gallery): 9 px at the top, 14 at the foot. */
const halfAt = (y) => 9 + (5 * y) / (H - 1);

/** Is (x, y) inside the round tower's outline? */
function inTower(x, y) { return Math.abs(x + 0.5 - W / 2) <= halfAt(y); }

/** Which side of the cylinder (x, y) is on: -1 lit, 0 body, 1 shade. */
function sideOf(x, y) {
  const u = (x + 0.5 - W / 2) / halfAt(y);
  return u < -0.42 ? -1 : u > 0.5 ? 1 : 0;
}

const LOOKS = {
  // Bare stone before it's whitewashed: in courses, dull.
  ruin: { lit: 'fog-2', body: 'fog-1', shade: 'night-5', course: 'night-5', windows: 'night-1' },
  roof: { lit: 'fog-3', body: 'fog-2', shade: 'fog-1', course: 'fog-1', windows: 'night-1' },
  // Whitewashed from the 'lit' stage on; the daymark band once it's alive.
  lit: { lit: 'fog-5', body: 'fog-4', shade: 'fog-2', windows: 'lit' },
  keeper: { lit: 'fog-5', body: 'fog-4', shade: 'fog-2', windows: 'lit' },
  alive: { lit: 'fog-5', body: 'fog-4', shade: 'fog-2', windows: 'lit', band: true },
};

/**
 * Rows of the ruin's broken top, by column: masonry breaks away in whole blocks, so the edge steps
 * in runs of two or three (pass 1 broke it a pixel at a time and it read as grass).
 */
const BREAK = [4, 4, 4, 1, 1, 6, 6, 6, 2, 2, 2, 5, 5, 0, 0, 0, 3, 3, 3, 7, 7, 1, 1, 1, 4, 4, 2, 2];

/**
 * The tower at one stage (`ruin`, `roof`, `lit`, `keeper`, `alive`), 48 x 64 on its plot, outlined.
 * `id` names the frame. The door sits at the foot of the middle column, where the plot's door is.
 */
export function lighthouseTower(id, stage, { sign = null, lantern = null } = {}) {
  const L = LOOKS[stage];
  if (!L) throw new Error(`${id}: no tower stage "${stage}"`);
  const g = blank(id, W, H);
  const ruin = stage === 'ruin';
  const top = (x) => (ruin ? 24 + BREAK[Math.max(0, Math.min(BREAK.length - 1, x - 10))] : 0);
  // The tower: lit on its left third, shaded on its right; bare stone shows its courses.
  for (let y = 0; y < H - 5; y++) for (let x = 0; x < W; x++) {
    if (!inTower(x, y) || y < top(x)) continue;
    const s = sideOf(x, y);
    let c = s < 0 ? L.lit : s > 0 ? L.shade : L.body;
    if (L.course && (y % 6 === 5 || (Math.floor(y / 6) % 2 === 0 ? x % 7 === 0 : x % 7 === 3) && y % 6 !== 0)) c = s > 0 ? L.shade : L.course;
    // The daymark: a band in red round its upper part.
    if (L.band && y >= 9 && y <= 15) c = s < 0 ? 'rot-4' : s > 0 ? 'rot-2' : 'rot-3';
    setPx(g, x, y, c);
  }
  // The gallery's corbels under the lantern room: a short dark course, a pixel wider than the top.
  if (!ruin) for (let x = Math.floor(W / 2 - halfAt(0)) - 1; x <= Math.ceil(W / 2 + halfAt(0)); x++) { setPx(g, x, 0, x < W / 2 ? 'fog-2' : 'fog-1'); setPx(g, x, 1, 'night-4'); }
  // The plinth: dressed stone a little wider than the tower's foot.
  for (let y = H - 5; y < H; y++) for (let x = 8; x < W - 8; x++) {
    const edge = x === 8 ? 'fog-3' : x === W - 9 ? 'fog-1' : y === H - 5 ? 'fog-3' : (x + (y % 2) * 3) % 6 === 0 ? 'fog-1' : 'fog-2';
    setPx(g, x, y, edge);
  }
  // The door: under a small arch at the foot of the middle column.
  const dx = W / 2 - 3, dy = H - 14;
  for (let y = dy; y < H - 3; y++) for (let x = dx; x < dx + 6; x++) {
    if (y === dy && (x === dx || x === dx + 5)) continue;   // the arch's shoulders
    let c;
    if (ruin) c = (y - dy) % 3 === 2 ? 'wood-2' : 'wood-3';            // boarded
    else if (stage === 'alive') c = y < dy + 2 ? 'lamp-3' : 'lamp-4';   // open, lamplight inside
    else c = x === dx + 4 && y === dy + 5 ? 'lamp-4' : (x === dx || y === dy) ? 'wood-2' : 'wood-3';
    setPx(g, x, y, c);
  }
  // The stair's slit windows, on alternate sides up the tower.
  const slits = [[W / 2 + 2, 18], [W / 2 - 4, 29]];
  for (const [sx, sy] of slits) {
    if (sy < top(sx) + 2) continue;
    for (let y = sy; y < sy + 4; y++) for (let x = sx; x < sx + 2; x++) setPx(g, x, y, L.windows === 'lit' ? (y === sy ? 'lamp-5' : 'lamp-4') : L.windows);
  }
  // The ruin's fallen stone at its foot.
  if (ruin) for (const [rx, ry, c] of [[5, 60, 'fog-2'], [6, 60, 'fog-1'], [6, 59, 'fog-2'], [40, 61, 'fog-2'], [41, 61, 'fog-1'], [39, 62, 'fog-1'], [42, 60, 'fog-2']]) setPx(g, rx, ry, c);
  const o = outlined(g, 'night-0', id);
  const f = blank(id, W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = ((y + 1) * o.w + (x + 1)) * 4, j = (y * W + x) * 4;
    for (let k = 0; k < 4; k++) f.rgba[j + k] = o.rgba[i + k];
  }
  // The keeper's sign over the door and the door's lantern (from the 'keeper' stage on).
  if (sign && (stage === 'keeper' || stage === 'alive')) stamp(f, sign, Math.floor(W / 2 - sign.w / 2), dy - sign.h - 1);
  if (lantern && (stage === 'keeper' || stage === 'alive')) stamp(f, lantern, dx + 7, dy);
  return f;
}
