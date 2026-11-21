// A picture of the Salt Marsh's ground, the way the run view picks its tiles (render/viewstate.js
// groundFrame) over the real layout (sim/marsh.js buildMarsh), at any water level, by day or by
// night, with the Marsh's actors stood on it to see that they read. Workspace only, for looking at
// the art without a browser.
//
//   node tools/atlas/marsh-preview.mjs [--crop x,y,w,h] [--at landing|secret|creek] [--level 0..255]
//                                      [--night] [--actors] [--fresh] [--scale 3] [--out file.png]
//
// --crop    the tiles to draw (default 40 x 23 tiles round the landing: about a screen)
// --at      a named spot instead: the landing, the secret's island, or the first creek's crossing
// --level   the water's level (0 low water; 101 high water; higher floods the flats as overtime does)
// --night   the map's ambient light and the player's lamp at the middle (as the light map does)
// --actors  every Marsh enemy, both Marsh characters, and the Marsh's props stood in a row mid-picture
// --fresh   draw the ground tiles from art/draw/ now instead of the committed atlas (they need no
//           packs), to look at a change before rebuilding the atlas

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePng } from './png.mjs';
import { DATA } from '../../src/data/index.js';
import { buildMarsh } from '../../src/sim/marsh.js';
import { createTerrain, GROUND } from '../../src/sim/terrain.js';
import { groundFrame } from '../../src/render/viewstate.js';
import { SPRITES } from '../../art/manifest.js';
import { buildFrames } from './atlas.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
function usage(why) {
  console.error(`marsh-preview: ${why}\n  node tools/atlas/marsh-preview.mjs [--crop x,y,w,h | --at landing|secret|creek] [--level n] [--night] [--actors] [--fresh] [--scale 3] [--out file.png]`);
  process.exit(2);
}
const arg = (name, d) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return d;
  const v = process.argv[i + 1];
  if (v === undefined || v.startsWith('--')) usage(`--${name} needs a value`);
  return v;
};
const has = (name) => process.argv.includes(`--${name}`);
const map = DATA.maps.find((m) => m.id === 'salt_marsh');
const [cols, rows] = map.size;
const g = buildMarsh(map.layout, cols, rows);
const t = createTerrain({ cols, rows, solid: g.solid.slice(), kinds: g.kinds.slice() });
const level = Number(arg('level', 0));
if (!(Number.isInteger(level) && level >= 0 && level <= 255)) usage('--level is a whole number from 0 to 255');
for (let i = 0; i < cols * rows; i++) if (g.floodAt[i] < level) t.wet[i] = 1;
t.refresh();

let crop = [g.landing[0] - 6, g.landing[1] - 6, 40, 23];
const at = arg('at', '');
if (at === 'landing') crop = [Math.max(0, g.landing[0] - 8), Math.max(0, g.landing[1] - 6), 24, 14];
else if (at === 'secret') crop = [g.island.at[0] - 20, g.island.at[1] - 12, 40, 23];
else if (at === 'creek') {
  // The first boardwalk found: the creek round it.
  const b = g.kinds.indexOf(GROUND.BOARDWALK);
  crop = [Math.max(0, (b % cols) - 12), Math.max(0, Math.floor(b / cols) - 8), 28, 16];
} else if (at) usage(`--at is landing, secret, or creek, not "${at}"`);
if (arg('crop', null)) crop = arg('crop').split(',').map(Number);
const [cx, cy, cw, ch] = crop;
if (![cx, cy, cw, ch].every(Number.isInteger) || cw < 1 || ch < 1 || cx < 0 || cy < 0 || cx + cw > cols || cy + ch > rows) usage(`--crop must be whole tiles inside the map (${cols} x ${rows})`);
const S = Number(arg('scale', 3));
if (!(Number.isInteger(S) && S >= 1 && S <= 8)) usage('--scale is a whole number from 1 to 8');

// The frames: the committed atlas's, or (--fresh) the ground drawn now, the rest from the atlas.
const page = decodePng(readFileSync(join(ROOT, 'src/assets/atlas.png')));
const table = JSON.parse(readFileSync(join(ROOT, 'src/assets/atlas.json'), 'utf8'));
const fresh = new Map();
if (has('fresh')) for (const f of buildFrames({}, DATA, SPRITES.filter((e) => e.kind === 'ground')).frames) fresh.set(f.id, f);
function frame(id) {
  if (fresh.has(id)) return fresh.get(id);
  const r = table.frames[id];
  if (!r) throw new Error(`no frame "${id}" (rebuild the atlas, or use --fresh for ground tiles)`);
  const [x0, y0, w, h] = r, rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) rgba.set(page.rgba.subarray(((y0 + y) * page.width + x0) * 4, ((y0 + y) * page.width + x0 + w) * 4), y * w * 4);
  return { id, w, h, rgba };
}

const W = cw * 16, H = ch * 16;
const img = new Float32Array(W * H * 3);
function stampAt(f, x0, y0) {
  for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
    const i = (y * f.w + x) * 4, a = f.rgba[i + 3] / 255;
    if (a === 0) continue;
    const X = x0 + x, Y = y0 + y;
    if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
    const o = (Y * W + X) * 3;
    for (let c = 0; c < 3; c++) img[o + c] = f.rgba[i + c] * a + img[o + c] * (1 - a);
  }
}
for (let ty = 0; ty < ch; ty++) for (let tx = 0; tx < cw; tx++) stampAt(frame(groundFrame(t, cx + tx, cy + ty)), tx * 16, ty * 16);

if (has('actors')) {
  const marsh = new Set();
  const tl = map.timeline;
  for (const b of tl.bands) for (const id of Object.keys(b.roster)) marsh.add(id);
  for (const e of tl.events || []) { if (e.enemy) marsh.add(e.enemy); if (e.escort) marsh.add(e.escort); }
  const ids = [...marsh].map((id) => DATA.enemies.find((e) => e.id === id)).filter((e) => e && e.ai.type !== 'boss').map((e) => e.sprite);
  const chars = DATA.characters.filter((c) => c.map === 'salt_marsh' || ['punter', 'bog_warden'].includes(c.id)).map((c) => c.sprite);
  const props = ['marsh_pillar', 'marsh_well', 'marsh_herbs', 'marsh_bog_body'].filter((id) => table.frames[id] || fresh.has(id));
  const row = [...new Set([...ids, ...chars, ...props])];
  let x = 12;
  const y = Math.floor(H / 2);
  for (const id of row) {
    const f = frame(id);
    stampAt(f, x, y - f.h);
    x += f.w + 6;
  }
}

// Night: the map's ambient light, and the player's lamp at the middle (the light map's falloff).
if (has('night')) {
  const amb = map.ambient + DATA.tuning.feel.light.ambientBoost, lamp = DATA.tuning.feel.light.player;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = Math.hypot(x - W / 2, y - H / 2) / (lamp / 2);
    const lit = Math.min(1, amb + (d < 1 ? (1 - d * d) * (1 - d * d) : 0));
    const o = (y * W + x) * 3;
    img[o] *= lit; img[o + 1] *= lit; img[o + 2] *= Math.min(1, lit * 1.08);
  }
}

const out = resolve(arg('out', join(ROOT, 'tools/out/marsh.png')));
const rgba = new Uint8ClampedArray(W * S * H * S * 4);
for (let y = 0; y < H * S; y++) for (let x = 0; x < W * S; x++) {
  const i = (Math.floor(y / S) * W + Math.floor(x / S)) * 3, o = (y * W * S + x) * 4;
  rgba[o] = img[i]; rgba[o + 1] = img[i + 1]; rgba[o + 2] = img[i + 2]; rgba[o + 3] = 255;
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, encodePng({ width: W * S, height: H * S, rgba }));
console.log(`marsh preview: ${out} (tiles ${cx},${cy} ${cw}x${ch}, water level ${level}${has('night') ? ', night' : ''})`);
