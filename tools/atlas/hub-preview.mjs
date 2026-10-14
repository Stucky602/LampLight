// A picture of the harbor from the committed atlas, the way the hub view builds it: the same tile
// picks, building stages, lights, props, people (facing as they do in the harbor), fog, and a
// boat's stand, tint, and halo (render/hubtiles.js, meta/state.js, hub/map.js, hub/world.js), and
// the same look (data/tuning.js HUB_TUNING.look), with the night (lightAt) and the fog (each
// tile's density times its thickness) worked out per pixel instead of on the GPU. The fog's
// drifting wisps aren't drawn (they move). Workspace only, for looking at the art without a browser.
//
//   node tools/atlas/hub-preview.mjs [--levels lamp_post=2,library=1] [--day] [--boat] [--scale 2] [--out file.png]
//
// --day    no night and no fog (the art as it is)
// --boat   a boat tied up at the pier, its newcomer stepping off (the first tick of her walk up)

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePng } from './png.mjs';
import { DATA } from '../../src/data/index.js';
import { HUB_TERRAIN } from '../../src/data/hub.js';
import {
  groundFrame, objectFrame, buildingDraw, harborLights, fogDensity, fogAtPoint, lookColor, arrivalLook, lightAt, newcomerTint, boatTint, ANCHORS, scaffoldAt,
} from '../../src/render/hubtiles.js';
import { createHubWorld, setPeople } from '../../src/hub/world.js';
import { glowAt } from '../../src/render/textures.js';
import { revealedFog, hubPeople, shownProps } from '../../src/meta/state.js';
import { buildHubMap } from '../../src/hub/map.js';
import { defaultProfile } from '../../src/save/schema.js';
import { PLAYER_FEET_ROOM } from '../../src/render/playerframe.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
/** A plain message and out, for a mistake in how it was called. */
function usage(why) {
  console.error(`hub-preview: ${why}\n  node tools/atlas/hub-preview.mjs [--levels lamp_post=2,library=1] [--day] [--boat] [--scale 2] [--out file.png]`);
  process.exit(2);
}
const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return dflt;
  const v = process.argv[i + 1];
  if (v === undefined || v.startsWith('--')) usage(`--${name} needs a value`);
  return v;
};
const page = decodePng(readFileSync(join(ROOT, 'src/assets/atlas.png')));
const table = JSON.parse(readFileSync(join(ROOT, 'src/assets/atlas.json'), 'utf8'));
const hub = DATA.hub;
const LOOK = DATA.hubTuning.look;
const doc = defaultProfile();
for (const kv of String(arg('levels', '')).split(',').filter(Boolean)) {
  const [k, v] = kv.split('=');
  const b = DATA.buildings.find((x) => x.id === k);
  if (!b) usage(`there is no building called "${k}" (${DATA.buildings.map((x) => x.id).join(', ')})`);
  const n = Number(v);
  if (!(Number.isInteger(n) && n >= 0 && n <= b.levels.length)) usage(`${k}'s level must be a whole number from 0 to ${b.levels.length}, not "${v}"`);
  doc.profile.buildings[k] = n;
}
const levels = Object.fromEntries(DATA.buildings.map((b) => [b.id, doc.profile.buildings[b.id] ?? 0]));
const levelOf = (id) => levels[id] ?? 0;
const S = Number(arg('scale', 2));
if (!(Number.isInteger(S) && S >= 1 && S <= 8)) usage(`--scale must be a whole number from 1 to 8, not "${arg('scale')}"`);
const cols = hub.map[0].length, rows = hub.map.length;
const W = cols * 16, H = rows * 16;
const img = new Float64Array(W * H * 3);
const frame = (id) => { const r = table.frames[id]; if (!r) throw new Error(`no frame ${id}`); return r; };

function blit(id, dx, dy, flip = false) {
  const [x0, y0, w, h] = frame(id);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = flip ? x0 + w - 1 - x : x0 + x;
    const o = ((y0 + y) * page.width + sx) * 4;
    if (page.rgba[o + 3] < 128) continue;
    const tx = dx + x, ty = dy + y;
    if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
    const j = (ty * W + tx) * 3;
    img[j] = page.rgba[o]; img[j + 1] = page.rgba[o + 1]; img[j + 2] = page.rgba[o + 2];
  }
}

// Ground and water.
for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) blit(groundFrame(hub, x, y) ?? 'hub_water_0', x * 16, y * 16);

// Things that stand up, sorted by their feet: objects, buildings, the lamps, props, and people.
const draw = [];
const standing = (id, px, footY, foot = footY, flip = false) => { const r = frame(id); draw.push({ id, x: Math.round(px - r[2] / 2), y: footY - r[3], foot, flip }); };
for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
  const o = objectFrame(hub, x, y);
  if (o) draw.push({ id: o, x: x * 16, y: y * 16, foot: y * 16 + 16 });
}
for (const p of hub.plots) {
  const d = buildingDraw(p.building, levelOf(p.building));
  if (p.building === 'lamp_post') { standing(d.upper, p.x * 16 + 8, (p.y + 1) * 16); continue; }
  draw.push({ id: d.upper, x: p.x * 16, y: p.y * 16, foot: (p.y + p.h) * 16 });
  if (d.scaffold) {
    const r = frame('hub_scaffold_5x4'), [x, y] = scaffoldAt(p, { w: r[2], h: r[3] }, d.scaffold.drop);
    draw.push({ id: 'hub_scaffold_5x4', x, y, foot: (p.y + p.h) * 16 + 0.5 });
  }
}
for (const r of hub.ruins) draw.push({ id: `bld_${r.id}_ruin`, x: r.x * 16, y: r.y * 16, foot: (r.y + r.h) * 16 });
const smallLamps = [hub.gate.lamp, hub.harbor.lamp].filter(Boolean);
for (const [x, y] of smallLamps) standing('prop_lamppost', x * 16 + 8, (y + 1) * 16 - ANCHORS.smallLampLift, (y + 1) * 16);
for (const pr of shownProps(doc, DATA)) standing(pr.sprite, pr.at[0] * 16 + 8, (pr.at[1] + 1) * 16);
// People stand on their tile's middle (the view's anchor), their frame's feet room below it,
// facing the way the harbor's world turns them (the ones waiting face the square).
const world = createHubWorld({ hub, terrain: HUB_TERRAIN, tuning: DATA.tuning, revealed: revealedFog(doc, DATA), props: shownProps(doc, DATA) });
setPeople(world, hubPeople(doc, DATA));
const person = (id, [tx, ty], facing = 1) => standing(id, tx * 16 + 8, ty * 16 + 8 + PLAYER_FEET_ROOM, ty * 16 + 8, facing < 0);
for (const p of world.people) person(p.sprite, p.post, p.facing);
const avatar = DATA.characters.find((c) => c.id === hub.avatar).sprite;
person(avatar, hub.spawn);
draw.sort((a, b) => a.foot - b.foot);
for (const d of draw) blit(d.id, d.x, d.y, d.flip);

// The boat, tied up where an arrival ends, the newcomer stepping off its deck (drawn over the
// night and the fog, as the view does): where it stands, its tint, and its halo, from arrivalLook;
// her shade from newcomerTint, as the light map would light her.
const route = hub.harbor.boatRoute, tie = route[route.length - 1];
const boatAt = [tie[0] * 16 + 8, tie[1] * 16 + 8];
const withBoat = process.argv.includes('--boat');
const fogMap = fogDensity(buildHubMap(hub, HUB_TERRAIN), revealedFog(doc, DATA), new Map());
const fogAt = (x, y) => fogAtPoint(fogMap, cols, rows, x, y);
const still = { px: boatAt[0], x: boatAt[0], py: boatAt[1], y: boatAt[1] };
const deck = { px: boatAt[0] + hub.harbor.aboard, x: boatAt[0] + hub.harbor.aboard, py: boatAt[1] + hub.harbor.deck, y: boatAt[1] + hub.harbor.deck, facing: 1 };
const arrival = withBoat ? arrivalLook({ phase: 'walk', boat: still, walker: deck }, 1, fogAt, hub.harbor, LOOK) : null;
const lights = harborLights({ hub, levels, look: LOOK, you: { x: hub.spawn[0] * 16 + 8, y: hub.spawn[1] * 16 + 8 }, arrival });
const night = !process.argv.includes('--day');

if (night) {
  // Night: the light map at every pixel (hubtiles.js lightAt: the ambient and the game's own
  // lights, each falling off the way the light map's glow does), multiplied in.
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const [r, g, b] = lightAt(x, y, lights, LOOK);
    const j = (y * W + x) * 3;
    img[j] *= r; img[j + 1] *= g; img[j + 2] *= b;
  }
  // The fog: the game's density per tile, smoothed between tile centers (a soft edge a tile
  // wide; hubtiles.js fogAtPoint), each pixel showing its density times the fog's thickness.
  const hex = (n) => [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  const fog = hex(lookColor(LOOK.fogColor)).map((c) => c * 255);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const a = Math.min(1, fogAtPoint(fogMap, cols, rows, x, y)) * LOOK.fogDensity;
    const j = (y * W + x) * 3;
    for (let c = 0; c < 3; c++) img[j + c] = img[j + c] * (1 - a) + fog[c] * a;
  }
}
/** A frame over the night and the fog (the boat layer), each pixel times `tint`'s channels. */
function over(id, x0, y0, tint, flip = false) {
  const [sx, sy, w, h] = frame(id);
  const k = [(tint >> 16) & 255, (tint >> 8) & 255, tint & 255].map((c) => c / 255);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = ((sy + y) * page.width + sx + (flip ? w - 1 - x : x)) * 4, tx = x0 + x, ty = y0 + y;
    if (page.rgba[o + 3] < 128 || tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
    const j = (ty * W + tx) * 3;
    for (let c = 0; c < 3; c++) img[j + c] = page.rgba[o + c] * k[c];
  }
}
if (withBoat) {
  // The view's boat: stood by its bottom middle (arrivalLook's draw), by night lit as the light
  // map lights the water at its middle (in its shade in the fog: boatTint).
  const [, , bw, bh] = frame('hub_boat');
  const boatShown = night ? boatTint(arrival, lights, fogAt, LOOK) : 0xffffff;
  over('hub_boat', Math.round(arrival.draw.x - bw / 2), arrival.draw.y - bh, boatShown);
  // Her, on the deck, stood by her feet as the view stands a person, in her shade by night.
  const who = DATA.characters.find((c) => c.id !== hub.avatar && c.sprite)?.sprite ?? DATA.characters[0].sprite;
  const [, , pw, ph] = frame(who);
  over(who, Math.round(arrival.walker.x - pw / 2), Math.round(arrival.walker.y) + PLAYER_FEET_ROOM - ph, night ? newcomerTint(arrival, lights, fogAt, LOOK) : 0xffffff);
  // ...and the hull from its gunwale down over her feet, as the view draws it.
  const [hx, hy, hw, hh] = frame('hub_boat');
  const top = hh - ANCHORS.gunwale, k = [(boatShown >> 16) & 255, (boatShown >> 8) & 255, boatShown & 255].map((c) => c / 255);
  for (let y = top; y < hh; y++) for (let x = 0; x < hw; x++) {
    const o = ((hy + y) * page.width + hx + x) * 4, tx = Math.round(arrival.draw.x - hw / 2) + x, ty = arrival.draw.y - hh + y;
    if (page.rgba[o + 3] < 128 || tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
    const j = (ty * W + tx) * 3;
    for (let c = 0; c < 3; c++) img[j + c] = page.rgba[o + c] * k[c];
  }
  // Its halo by night: the lantern's glow added over everything (the view's glow sprite, out to boatHaloReach).
  if (night && arrival.glow > 0) {
    const col = lookColor(LOOK.lampColor), rgb = [(col >> 16) & 255, (col >> 8) & 255, col & 255];
    const R = LOOK.boatHaloReach;
    for (let y = Math.floor(arrival.halo.y - R); y <= arrival.halo.y + R; y++) for (let x = Math.floor(arrival.halo.x - R); x <= arrival.halo.x + R; x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const g = glowAt(Math.hypot(x + 0.5 - arrival.halo.x, y + 0.5 - arrival.halo.y) / R) * arrival.glow;
      if (g <= 0) continue;
      const j = (y * W + x) * 3;
      for (let c = 0; c < 3; c++) img[j + c] = Math.min(255, img[j + c] + rgb[c] * g);
    }
  }
}

const out = new Uint8ClampedArray(W * S * H * S * 4);
for (let y = 0; y < H * S; y++) for (let x = 0; x < W * S; x++) {
  const j = (Math.floor(y / S) * W + Math.floor(x / S)) * 3, o = (y * W * S + x) * 4;
  out[o] = img[j]; out[o + 1] = img[j + 1]; out[o + 2] = img[j + 2]; out[o + 3] = 255;
}
const file = resolve(arg('out', join(ROOT, 'tools/out/hub-preview.png')));
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, encodePng({ width: W * S, height: H * S, rgba: out }));
console.log(`hub preview: ${file}`);
