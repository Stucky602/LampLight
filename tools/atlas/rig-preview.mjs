// Draw each boss rig in a row of poses (walking, each attack's warning, charging), from the
// committed atlas and src/render/rigs.js, so the rigs can be looked at without a run.
//   node tools/atlas/rig-preview.mjs [--out tools/out/rigs.png] [--scale 3]
// Parts are turned with nearest-neighbor sampling, the way the game's pixel view draws them.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePng } from './png.mjs';
import { RIGS, createPose, rigPlace } from '../../src/render/rigs.js';
import { RIG_STATE, rigPose } from '../../src/render/rigpose.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (name, d) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : d; };
const out = resolve(arg('out', join(ROOT, 'tools/out/rigs.png')));
const S = Number(arg('scale', 3));
if (!(Number.isInteger(S) && S >= 1 && S <= 8)) { console.error('--scale must be a whole number from 1 to 8'); process.exit(2); }
const page = decodePng(readFileSync(join(ROOT, 'src/assets/atlas.png')));
const table = JSON.parse(readFileSync(join(ROOT, 'src/assets/atlas.json'), 'utf8'));
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
];
const CELL = 96;
const W = CELL * POSES.length * S, H = CELL * Object.keys(RIGS).length * S;
const rgba = new Uint8ClampedArray(W * H * 4);
for (let i = 0; i < W * H; i++) { rgba[i * 4] = 20; rgba[i * 4 + 1] = 25; rgba[i * 4 + 2] = 37; rgba[i * 4 + 3] = 255; }

function drawPart(frameId, cx, cy, px, py, rot, sx, sy) {
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

Object.entries(RIGS).forEach(([id, rig], row) => {
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
