// Draw each boss rig in a row of poses (walking, each attack's warning, charging, the Marsh's leap,
// stab, stuck, march, and kneel), from the committed atlas and src/render/rigs.js, so the rigs can
// be looked at without a run.
//   node tools/atlas/rig-preview.mjs [--out tools/out/rigs.png] [--scale 3] [--rig boss_old_grey] [--fresh]
// --fresh  the parts drawn from art/draw/ now (they need no packs) instead of the committed atlas
// Parts are turned with nearest-neighbor sampling, the way the game's pixel view draws them.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePng } from './png.mjs';
import { RIGS, createPose, rigPlace } from '../../src/render/rigs.js';
import { RIG_STATE, rigPose } from '../../src/render/rigpose.js';
import { SPRITES } from '../../art/manifest.js';
import { DATA } from '../../src/data/index.js';
import { buildFrames } from './atlas.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (name, d) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : d; };
const out = resolve(arg('out', join(ROOT, 'tools/out/rigs.png')));
const S = Number(arg('scale', 3));
if (!(Number.isInteger(S) && S >= 1 && S <= 8)) { console.error('--scale must be a whole number from 1 to 8'); process.exit(2); }
let page = decodePng(readFileSync(join(ROOT, 'src/assets/atlas.png')));
let table = JSON.parse(readFileSync(join(ROOT, 'src/assets/atlas.json'), 'utf8'));
if (process.argv.includes('--fresh')) {
  // The parts drawn now, laid in one strip as a page of their own.
  const parts = buildFrames({}, DATA, SPRITES.filter((e) => e.kind === 'part')).frames.filter((f) => !f.id.includes('#'));
  const w = parts.reduce((a, f) => a + f.w + 1, 0), h = Math.max(...parts.map((f) => f.h));
  const rgba = new Uint8ClampedArray(w * h * 4), frames = {};
  let x = 0;
  for (const f of parts) {
    for (let y = 0; y < f.h; y++) rgba.set(f.rgba.subarray(y * f.w * 4, (y + 1) * f.w * 4), (y * w + x) * 4);
    frames[f.id] = [x, 0, f.w, f.h];
    x += f.w + 1;
  }
  page = { width: w, height: h, rgba };
  table = { frames };
}
const only = arg('rig', null);
const missing = Object.values(RIGS).flatMap((r) => r.parts.map((p) => p.frame)).filter((f) => !table.frames[f]);
if (missing.length) { console.error(`The atlas has no ${missing.join(', ')}: rebuild it (node tools/atlas/build.mjs).`); process.exit(3); }

const POSES = [
  { label: 'walk', t: 0, state: RIG_STATE.WALK, attack: '', u: 0 },
  { label: 'walk later', t: 0.8, state: RIG_STATE.WALK, attack: '', u: 0 },
  { label: 'slam warning', t: 0.3, state: RIG_STATE.WARN, attack: 'slam_ring', u: 0.9 },
  { label: 'charge warning', t: 0.3, state: RIG_STATE.WARN, attack: 'charge_line', u: 0.8 },
  { label: 'summon / ring', t: 0.33, state: RIG_STATE.WARN, attack: 'summon_wave', u: 0.7 },
  { label: 'fan warning', t: 0.21, state: RIG_STATE.WARN, attack: 'projectile_fan', u: 0.9 },
  { label: 'pools warning', t: 0.5, state: RIG_STATE.WARN, attack: 'hazard_pools', u: 1 },
  { label: 'charging', t: 0.2, state: RIG_STATE.CHARGE, attack: 'charge_line', u: 0 },
  // The Salt Marsh's.
  { label: 'stab warning', t: 0.3, state: RIG_STATE.WARN, attack: 'stab_line', u: 0.9 },
  { label: 'stab', t: 0.3, state: RIG_STATE.RECOVER, attack: 'stab_line', u: 0 },
  { label: 'leap (in the air)', t: 0.05, state: RIG_STATE.WARN, attack: 'leap', u: 0.5 },
  { label: 'stuck in the mud', t: 0.3, state: RIG_STATE.WALK, attack: '', u: 0, stuck: 1 },
  { label: 'march warning', t: 0.3, state: RIG_STATE.WARN, attack: 'lightning_march', u: 0.9 },
  { label: 'kneeling (weak)', t: 0.3, state: RIG_STATE.RECOVER, attack: 'lightning_march', u: 0, weak: 1 },
];
const CELL = 96;
const RIG_LIST = Object.entries(RIGS).filter(([id]) => !only || id === only);
if (!RIG_LIST.length) { console.error(`No rig "${only}" (there are ${Object.keys(RIGS).join(', ')})`); process.exit(2); }
const W = CELL * POSES.length * S, H = CELL * RIG_LIST.length * S;
const rgba = new Uint8ClampedArray(W * H * 4);
for (let i = 0; i < W * H; i++) { rgba[i * 4] = 20; rgba[i * 4 + 1] = 25; rgba[i * 4 + 2] = 37; rgba[i * 4 + 3] = 255; }

function drawPart(frameId, cx, cy, px, py, rot, sx, sy) {
  if (sx === 0 || sy === 0) return;   // a part not shown in this pose (rigs.js `still: false`)
  const [fx, fy, fw, fh] = table.frames[frameId];
  const c = Math.cos(rot), s = Math.sin(rot);
  // For every output pixel near the part, find the source pixel (inverse transform).
  const R = Math.ceil(Math.hypot(fw, fh) * Math.max(Math.abs(sx), Math.abs(sy))) + 2;
  for (let oy = -R; oy <= R; oy++) for (let ox = -R; ox <= R; ox++) {
    const dx = ox + 0.5, dy = oy + 0.5;
    const ux = (dx * c + dy * s) / sx, uy = (-dx * s + dy * c) / sy;
    const tx = Math.floor(ux + px), ty = Math.floor(uy + py);
    if (tx < 0 || ty < 0 || tx >= fw || ty >= fh) continue;
    const si = ((fy + ty) * page.width + fx + tx) * 4;
    if (page.rgba[si + 3] < 128) continue;
    const X = Math.floor(cx + ox), Y = Math.floor(cy + oy);
    for (let yy = 0; yy < S; yy++) for (let xx = 0; xx < S; xx++) {
      const o = ((Y * S + yy) * W + X * S + xx) * 4;
      if (o < 0 || o >= rgba.length) continue;
      rgba[o] = page.rgba[si]; rgba[o + 1] = page.rgba[si + 1]; rgba[o + 2] = page.rgba[si + 2];
    }
  }
}

RIG_LIST.forEach(([id, rig], row) => {
  const pose = createPose(rig), at = new Float64Array(rig.parts.length * 2);
  POSES.forEach((P, col) => {
    rigPose(id, P, pose);
    rigPlace(id, pose, at);
    const ox = col * CELL + CELL / 2, oy = row * CELL + CELL / 2 + 8;
    rig.parts.forEach((p, k) => {
      const o = k * 5;
      drawPart(p.frame, ox + Math.round(at[k * 2]), oy + Math.round(at[k * 2 + 1]), p.px, p.py, pose[o + 2], (p.flip ? -1 : 1) * pose[o + 3], pose[o + 4]);
    });
  });
});
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, encodePng({ width: W, height: H, rgba }));
console.log(`rig preview: ${out} (${POSES.map((p) => p.label).join(', ')})`);
