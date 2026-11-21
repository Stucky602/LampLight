// The Salt Marsh's run view (0.8.0): its ground tiles picked from the real layout and the water
// (render/viewstate.js groundFrame), what its events leave on screen, things in the air drawn on
// their arc, the salt and tar looks, thralls, the minimap's water and well, and the run view's own
// wiring of each (source checks, as tests/view.test.js does for the rest).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DATA } from '../src/data/index.js';
import { createWorld, stepWorld } from '../src/sim/world.js';
import { buildMarsh } from '../src/sim/marsh.js';
import { createTerrain, GROUND } from '../src/sim/terrain.js';
import { createEventBuffer, EV, STRIKE_SRC } from '../src/sim/events.js';
import {
  groundFrame, GROUND_FRAMES, WALK_FRAME, airLift, airProgress, enemyLook, LOOK, LOOK_COLOR, MARSH_COLOR,
  createViewState, consumeEvents, PF_FRAME, FX_COLOR,
} from '../src/render/viewstate.js';
import { MARK, minimapMarks, createMarks, minimapWindow, minimapBox } from '../src/render/minimapmodel.js';
import { luminance, contrastRatio } from '../tools/atlas/color.mjs';
import { IDLE } from './helpers/simworld.js';

const atlas = JSON.parse(readFileSync(new URL('../src/assets/atlas.json', import.meta.url), 'utf8'));
const MAP = DATA.maps.find((m) => m.id === 'salt_marsh');
const [COLS, ROWS] = MAP.size;
const FEEL = DATA.tuning.feel;
let seq = 7;
const rand = () => ((seq = (seq * 1103515245 + 12345) >>> 0) / 2 ** 32);
const ctx = (over = {}) => ({ now: 1000, tick: 100, feel: FEEL, numbersOn: true, playerX: 0, playerY: 0, slotOf: (h) => h & 4095, ...over });

/** The Marsh's terrain from its layout, flooded to `level` (as the water does: tiles below the level). */
function marshTerrain(level = 0) {
  const g = buildMarsh(MAP.layout, COLS, ROWS);
  const t = createTerrain({ cols: COLS, rows: ROWS, solid: g.solid.slice(), kinds: g.kinds.slice() });
  for (let i = 0; i < COLS * ROWS; i++) if (g.floodAt[i] < level) t.wet[i] = 1;
  t.refresh();
  return { g, t };
}

test('marsh ground: every tile of the real map, low water and high, picks a frame that is on the atlas', () => {
  const listed = new Set(GROUND_FRAMES);
  for (const level of [0, 101, 200]) {
    const { t } = marshTerrain(level);
    const seen = new Set();
    for (let ty = 0; ty < ROWS; ty++) for (let tx = 0; tx < COLS; tx++) seen.add(groundFrame(t, tx, ty));
    for (const id of seen) {
      assert.ok(listed.has(id), `${id} is in GROUND_FRAMES (level ${level})`);
      assert.ok(atlas.frames[id], `${id} is on the atlas page`);
    }
    // No Marsh tile falls back to the Docks' boards.
    assert.ok(![...seen].some((id) => id.startsWith('tile_floor_')), `level ${level}: no boards on the Marsh`);
    if (level === 0) for (const k of ['salt', 'mud', 'reeds', 'peat', 'stump', 'deep', 'causeway', 'boardwalk', 'landing']) assert.ok([...seen].some((id) => id.startsWith(`tile_m_${k}`)), `${k} shows`);
    if (level === 101) assert.ok([...seen].some((id) => id.startsWith('tile_m_water_')), 'high water shows water');
  }
});

test('marsh ground: a wet tile is water with a bank on each dry side; the mud and boards follow the creek', () => {
  const { g, t } = marshTerrain(101);
  // Every flooded creek tile: water, its banks exactly the sides whose neighbor is dry ground.
  let checked = 0;
  for (let i = 0; i < COLS * ROWS && checked < 400; i++) {
    if (t.wet[i] !== 1) continue;
    const tx = i % COLS, ty = (i - tx) / COLS;
    if (tx === 0 || ty === 0 || tx === COLS - 1 || ty === ROWS - 1) continue;
    const water = (j) => t.wet[j] === 1 || t.kinds[j] === GROUND.DEEP;
    const want = (water(i - COLS) ? 0 : 1) | (water(i + 1) ? 0 : 2) | (water(i + COLS) ? 0 : 4) | (water(i - 1) ? 0 : 8);
    assert.match(groundFrame(t, tx, ty), new RegExp(`^tile_m_water_\\d_${want}$`));
    checked++;
  }
  assert.ok(checked > 100, `${checked} flooded tiles checked`);
  // At low water the same tiles are mud again, the ripples across the creek's flow.
  const low = marshTerrain(0).t;
  const horiz = g.creeks.find((c) => c.horiz);
  assert.ok(horiz, 'a creek running east to west');
  let crest = 0, mudTiles = 0;
  for (let i = 0; i < COLS * ROWS; i++) {
    if (low.kinds[i] !== GROUND.MUD) continue;
    const id = groundFrame(low, i % COLS, (i - (i % COLS)) / COLS);
    mudTiles++;
    if (/^tile_m_mud_[hv]_\d$/.test(id)) crest++;
  }
  assert.equal(crest, mudTiles, 'every mud tile is a mud frame');
});

test('marsh ground: the run view and the minimap redraw when the water changes the ground (terrain.version)', () => {
  const src = readFileSync(new URL('../src/render/runview.js', import.meta.url), 'utf8');
  assert.match(src, /key === groundKey && tr\.version === groundVersion/);
  const mm = readFileSync(new URL('../src/render/minimap.js', import.meta.url), 'utf8');
  assert.match(mm, /world\.terrain\.version !== groundVersion/);
  assert.match(mm, /T\.wet\[i\] === 1 \? WATER_RGB/, 'the minimap paints water from terrain.wet');
});

test('marsh art: the ground stays low in contrast, the water and stumps under every enemy, and the Marsh\'s actors read on its palest ground', async () => {
  const { decodePng } = await import('../tools/atlas/png.mjs');
  const page = decodePng(readFileSync(new URL('../src/assets/atlas.png', import.meta.url)));
  const stats = (id, tint = null) => {
    const [x0, y0, w, h] = atlas.frames[id];
    let rel = 0, n = 0, lo = 1, hi = 0, mean = 0;
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
      const o = (y * page.width + x) * 4;
      if (page.rgba[o + 3] < 128) continue;
      let r = page.rgba[o], g = page.rgba[o + 1], b = page.rgba[o + 2];
      if (r === 7 && g === 8 && b === 13) continue;   // the outline
      if (tint !== null) { r = (r * ((tint >> 16) & 255)) / 255; g = (g * ((tint >> 8) & 255)) / 255; b = (b * (tint & 255)) / 255; }
      const L = luminance(r, g, b);
      rel += L; n++; lo = Math.min(lo, L); hi = Math.max(hi, L); mean += 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }
    return { rel: rel / n, lo, hi, mean: mean / n };
  };
  const walk = GROUND_FRAMES.filter((id) => id.startsWith('tile_m_') && WALK_FRAME.test(id));
  const walls = GROUND_FRAMES.filter((id) => id.startsWith('tile_m_') && !WALK_FRAME.test(id));
  assert.ok(walk.length >= 20 && walls.length >= 40);
  for (const id of walk) { const s = stats(id); assert.ok(contrastRatio(s.hi, s.lo) < 1.5, `${id}: its own contrast ${contrastRatio(s.hi, s.lo).toFixed(2)}:1`); }
  const palest = Math.max(...walk.map((id) => stats(id).rel));
  const marsh = new Set();
  for (const b of MAP.timeline.bands) for (const id of Object.keys(b.roster)) marsh.add(id);
  for (const e of [...MAP.timeline.events, ...(MAP.timeline.overtime?.events || [])]) { if (e.enemy) marsh.add(e.enemy); if (e.escort) marsh.add(e.escort); }
  const enemies = [...marsh].map((id) => DATA.enemies.find((e) => e.id === id)).filter((e) => e && e.ai.type !== 'boss');
  assert.ok(enemies.length >= 8, `the Marsh's roster (${enemies.map((e) => e.id)})`);
  const dimmest = Math.min(...enemies.map((e) => stats(e.sprite).mean));
  for (const id of walls) assert.ok(stats(id).mean < dimmest, `${id} is dimmer than every Marsh enemy`);
  for (const e of enemies) assert.ok(contrastRatio(stats(e.sprite).rel, palest) >= 2, `${e.id}: ${contrastRatio(stats(e.sprite).rel, palest).toFixed(2)}:1 on the salt`);
  // The bosses' resting frames, and the props, read on it too.
  for (const id of ['boss_old_grey', 'boss_salt_widow', 'marsh_pillar', 'marsh_well', 'marsh_bog_body', 'marsh_herbs']) assert.ok(contrastRatio(stats(id).rel, palest) >= 2, `${id} on the salt`);
  // A thrall (an enemy's sprite in the thrall tint) is cool, a little darker, and still reads on the
  // salt (1.5:1 at least, for every enemy the Bog Warden can raise on either map).
  const t = MARSH_COLOR.thrall, tr = (t >> 16) & 255, tb = t & 255;
  assert.ok(tb >= tr && tr < 255, 'the thrall tint is cool and darkens');
  for (const e of DATA.enemies.filter((x) => x.ai.type !== 'boss')) assert.ok(contrastRatio(stats(e.sprite, t).rel, palest) >= 1.5, `${e.id} as a thrall`);
});

test('in the air: drawn along an arc over its flight, highest halfway, on the ground at both ends', () => {
  assert.equal(airLift(0, 12), 0);
  assert.ok(Math.abs(airLift(1, 12)) < 1e-9);
  assert.equal(airLift(0.5, 12), 12);
  assert.equal(airLift(-1, 12), 0, 'clamped');
  assert.ok(airLift(0.25, 36) > 20 && airLift(0.25, 36) < 36);
  assert.equal(airProgress(0, 0, 50, 0, 100, 0), 0.5);
  assert.equal(airProgress(0, 0, 0, 0, 0, 0), 1, 'a hop in place is over');
  assert.equal(airProgress(10, 10, 300, 10, 20, 10), 1, 'clamped past the landing');
  // A toad's hop in a real Marsh world: in the air, its progress runs 0 to 1 by the time it lands.
  const w = createWorld({ seed: 'air', character: 'lamplighter', map: 'salt_marsh', invulnerable: true }, DATA);
  const src = readFileSync(new URL('../src/render/runview.js', import.meta.url), 'utf8');
  assert.match(src, /lift = airLift\(airProgress\(boss \? boss\.sx : E\.dx\[i\], boss \? boss\.sy : E\.dy\[i\], x, y, ax, ay\), boss \? LEAP_PX : HOP_PX\)/);
  assert.match(src, /shadows\.add\(shadowTex, Math\.round\(gx\), Math\.round\(gy \+ r \* 0\.9\)/, 'the shadow on the landing spot');
  assert.ok(w.marsh, 'a Marsh world');
});

test('looks: salt is a pale still silhouette, tar keeps an enemy no darker than rot\'s tint', () => {
  const E = { saltT: [0], tarT: [0], freezeT: [0], burnT: [0], slowT: [0], rotT: [0], dazeT: [0] };
  const none = () => false;
  assert.equal(enemyLook(E, 0, 0, 1, none), LOOK.PLAIN);
  E.rotT[0] = 1; E.slowT[0] = 1; E.tarT[0] = 1;
  assert.equal(enemyLook(E, 0, 0, 1, none), LOOK.TAR, 'tar over slow and rot');
  E.freezeT[0] = 1; E.saltT[0] = 1;
  assert.equal(enemyLook(E, 0, 0, 1, none), LOOK.SALT, 'salt over frozen');
  E.dazeT[0] = 1;
  assert.equal(enemyLook(E, 0, 0, 1, none), LOOK.DAZED);
  const lum = (c) => luminance((c >> 16) & 255, (c >> 8) & 255, c & 255);
  assert.ok(lum(LOOK_COLOR[LOOK.TAR]) >= lum(LOOK_COLOR[LOOK.ROT]), 'tar no darker than rot');
  const salt = LOOK_COLOR[LOOK.SALT];
  assert.ok(Math.abs(((salt >> 16) & 255) - (salt & 255)) < 40, 'salt is a grey');
  const src = readFileSync(new URL('../src/render/runview.js', import.meta.url), 'utf8');
  assert.match(src, /if \(look === LOOK\.SALT\) \{[\s\S]{0,300}typeFlash\[type\]\[0\][^;]*C\.salt\)/, 'its flash silhouette, in the salt grey, unmoving');
});

test('events: a strike leaves its bolt, scorch, and a light (softer with Reduce flashing); landings, the well, and pillars show', () => {
  const st = createViewState({ slots: 4096, rand });
  const ev = createEventBuffer(64, 8);
  ev.push(EV.STRIKE, 100, 100, 28, STRIKE_SRC.STORM, 1, 0);
  consumeEvents(st, ev, ctx());
  assert.equal(st.bolts.n, 1);
  assert.equal(st.decals.n, 1, 'its scorch');
  assert.equal(st.lights.n, 1);
  const full = st.lights.r[0];
  const soft = createViewState({ slots: 4096, rand });
  consumeEvents(soft, ev, ctx({ reduced: true }));
  assert.ok(soft.lights.r[0] < full * 0.5, 'Reduce flashing: a smaller light');
  // No strike ever washes the screen (rule 2): its light is local.
  assert.ok(full <= 28 * 3);
  const st2 = createViewState({ slots: 4096, rand });
  ev.clear();
  ev.push(EV.LEAP, 50, 50, 0, 0, 1, 7);                 // the Old Grey lands on mud and sticks
  ev.push(EV.WELL, 80, 80, 1);                          // the well opens
  ev.push(EV.PILLAR, 20, 20, 1);                        // a pillar rises
  consumeEvents(st2, ev, ctx());
  assert.ok(st2.sparks.count > 20);
  assert.equal(st2.decals.n, 1, 'stuck in the mud leaves its mark');
  let ring = false;
  for (let i = 0; i < st2.sparks.count; i++) if (st2.sparks.frame[i] === PF_FRAME.RING && st2.sparks.color[i] === FX_COLOR.cool) ring = true;
  assert.ok(ring, 'the well opens with a ring');
});

test('the run view draws the Marsh: thralls, fever pips, leeches and peat over you, herbs, the well, pillars, the bog body', () => {
  const src = readFileSync(new URL('../src/render/runview.js', import.meta.url), 'utf8');
  assert.match(src, /playerLayer\.addChild\(peatG, latchLayer\.container\)/, 'latched leeches and the peat over the player');
  assert.match(src, /latches\[E\.type\[i\]\] === 1 && E\.aiState\[i\] === LEECH\.LATCHED/);
  assert.match(src, /if \(isSunk\(world\)\)/);
  assert.match(src, /enemies\.add\(typeTex\[type\]\[fr\], [^;]*C\.thrall\)/, 'a thrall in its own sprite, tinted');
  assert.match(src, /C\.thrallPip\)/);
  assert.match(src, /E\.feverT\[i\] > 0\) enemies\.add\(PIP/);
  assert.match(src, /M\.herbLeft\[k\] === 0\) continue;[\s\S]{0,120}T\.wet\[i\] === 1\) continue;/, 'herbs only where they are left, and not under the water');
  assert.match(src, /W\.open && inView\(W\.x, W\.y, 16\)\) pickups\.add\(WELL/);
  assert.match(src, /St\.pillarTile\[k\]/);
  assert.match(src, /world\.marsh \? BOGBODY : CACHE/);
  for (const id of ['marsh_pillar', 'marsh_herbs', 'marsh_well', 'marsh_bog_body']) assert.ok(atlas.frames[id], id);
});

test('minimap: the open well is marked, by its own shape', () => {
  const w = createWorld({ seed: 'mm', character: 'lamplighter', map: 'salt_marsh', invulnerable: true }, DATA);
  for (let k = 0; k < 3; k++) stepWorld(w, IDLE);
  const box = minimapBox('map', 'large'), win = { s: 1, ox: 0, oy: 0 }, marks = createMarks();
  minimapWindow(w, box, 'map', win);
  const kinds = () => [...marks.kind.slice(0, minimapMarks(w, marks, box, win))];
  assert.ok(!kinds().includes(MARK.WELL), 'closed: no mark');
  w.well.open = true; w.well.x = w.player.x + 40; w.well.y = w.player.y;
  assert.ok(kinds().includes(MARK.WELL), 'open: marked');
});
