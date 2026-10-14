// Build the sprite atlas (ARCHITECTURE §16.3). Workspace only: it needs the Kenney packs, which
// are never committed.
//
//   node tools/atlas/build.mjs [--packs <dir>] [--check] [--review <png>]
//
// --packs   the folder holding the unzipped packs (default: $LAMPLIGHT_PACKS, else ../packs next
//           to the repo)
// --check   build in memory and compare with the committed atlas; exit 1 if they differ
// --review  also write a 4x contact sheet of every frame (default tools/out/atlas-review.png)
//
// Writes src/assets/atlas.png and src/assets/atlas.json. Vite fingerprints the PNG's file name,
// so a new atlas can never be served with an old page (or the other way round).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PACKS, SPRITES } from '../../art/manifest.js';
import { DATA } from '../../src/data/index.js';
import { packSheet } from '../../src/render/sheet.js';
import { decodePng, encodePng } from './png.mjs';
import { buildFrames, iconKeysFor } from './atlas.mjs';
import { atlasSourceHash, packHash } from './sources.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const has = (name) => process.argv.includes(`--${name}`);
const packDir = resolve(arg('packs') || process.env.LAMPLIGHT_PACKS || join(ROOT, '..', 'packs'));
const OUT_PNG = join(ROOT, 'src/assets/atlas.png');
const OUT_JSON = join(ROOT, 'src/assets/atlas.json');

const used = [...new Set(SPRITES.filter((s) => s.pack).map((s) => s.pack))];
const packs = {};
for (const name of used) {
  const file = join(packDir, PACKS[name].file);
  if (!existsSync(file)) {
    console.error(`ATLAS CANNOT BUILD: the ${name} pack isn't at ${file}.\nAttach the Kenney pack zips (1-Bit Pack, Tiny Dungeon, Tiny Town) and unzip them into ${packDir}.`);
    process.exit(4);
  }
  packs[name] = { name, img: decodePng(readFileSync(file)) };
}

const { frames, anims, rigs } = buildFrames(packs, DATA);
// One page: the narrowest power-of-two width that keeps the page no taller than it is wide.
let sheet = null;
for (const width of [256, 512, 1024, 2048]) {
  const s = packSheet(frames, { width, pad: 1 });
  if (s.height <= width) { sheet = s; break; }
}
if (!sheet) throw new Error('the atlas doesn\'t fit on one 2048 page');
const json = {
  v: 1,
  source: atlasSourceHash(ROOT, iconKeysFor(DATA)),
  packs: packHash(packDir, used.map((n) => PACKS[n].file)),
  width: sheet.width,
  height: sheet.height,
  frames: Object.fromEntries([...sheet.rects.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([id, r]) => [id, [r.x, r.y, r.w, r.h]])),
  anims,
  rigs,
};
const png = encodePng({ width: sheet.width, height: sheet.height, rgba: sheet.rgba });
const text = `${JSON.stringify(json, null, 0).replace(/\],"/g, '],\n"')}\n`;

// Different pack files from the ones the committed atlas was built from (a re-download, a new
// pack version) can move sprites around: say so plainly rather than just "stale".
const committed = existsSync(OUT_JSON) ? JSON.parse(readFileSync(OUT_JSON, 'utf8')) : null;
const packsMoved = committed && committed.packs && committed.packs !== json.packs;
if (packsMoved) console.warn(`NOTE: these pack files differ from the ones the committed atlas was built from (${committed.packs} then, ${json.packs} now). Look at the review sheet before trusting a rebuild: tiles may have moved.`);

if (has('check')) {
  const same = existsSync(OUT_PNG) && committed && readFileSync(OUT_PNG).equals(png) && readFileSync(OUT_JSON, 'utf8') === text;
  console.log(same ? `atlas is up to date (${frames.length} frames, ${sheet.width}x${sheet.height})` : `ATLAS IS STALE${packsMoved ? ' (and the packs differ, see above)' : ''}: run node tools/atlas/build.mjs`);
  process.exit(same ? 0 : 1);
}

mkdirSync(dirname(OUT_PNG), { recursive: true });
writeFileSync(OUT_PNG, png);
writeFileSync(OUT_JSON, text);
console.log(`atlas: ${frames.length} frames on ${sheet.width}x${sheet.height}, ${png.length} bytes, source ${json.source}`);

// A contact sheet to look at: every frame at 4x on a checkerboard, in rows, with its index.
const review = resolve(arg('review') || join(ROOT, 'tools/out/atlas-review.png'));
{
  const S = 4, cell = 40 * S, cols = 16;
  const list = frames.filter((f) => !f.id.includes('#flash'));
  const rows = Math.ceil(list.length / cols);
  const W = cols * cell, H = rows * cell;
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4, c = ((x >> 3) + (y >> 3)) % 2 ? 58 : 50;
    rgba[o] = c; rgba[o + 1] = c + 4; rgba[o + 2] = c + 12; rgba[o + 3] = 255;
  }
  list.forEach((f, k) => {
    const cx = (k % cols) * cell, cy = Math.floor(k / cols) * cell;
    const sc = f.w > 38 || f.h > 38 ? 2 : S;
    for (let y = 0; y < f.h * sc && y < cell; y++) for (let x = 0; x < f.w * sc && x < cell; x++) {
      const i = (Math.floor(y / sc) * f.w + Math.floor(x / sc)) * 4, a = f.rgba[i + 3] / 255;
      if (a === 0) continue;
      const o = ((cy + y) * W + cx + x) * 4;
      for (let c = 0; c < 3; c++) rgba[o + c] = Math.round(f.rgba[i + c] * a + rgba[o + c] * (1 - a));
    }
  });
  mkdirSync(dirname(review), { recursive: true });
  writeFileSync(review, encodePng({ width: W, height: H, rgba }));
  writeFileSync(review.replace(/\.png$/, '.json'), JSON.stringify({ cols, cell, ids: list.map((f) => f.id) }));
  console.log(`review sheet: ${review}`);
}
