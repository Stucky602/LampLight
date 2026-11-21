// The Salt Marsh's systems (ARCHITECTURE §5.17; docs/design/SALT_MARSH.md; docs/design/SALT_MARSH_BUILD.md):
// the layout, the water's clock, rule 8 (its hardest cases and an overtime walk among pillars),
// mud, the herbs, the storm and the Eye, the pillars, the layers, the director's Marsh events, the
// Salt Well, first sightings, the run's new result fields, the feats, and the Tide tag renamed Sea.
// (The fight: tests/marsh-fight.test.js. The exhaustive rule 8 sweep: tools/marsh/rule8.mjs.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { DATA, testData, makeWorld, spawnAt, run, IDLE, neutralPace } from './helpers/simworld.js';
import { createWorld, stepWorld, decide, currentHalt, hashWorld } from '../src/sim/world.js';
import { buildMarsh, clearMarshCache, flatsLevel, checkWater, rule8 } from '../src/sim/marsh.js';
import { raisePillar, startEye } from '../src/sim/storm.js';
import { GROUND, TILE, buildMap } from '../src/sim/terrain.js';
import { EV, SIGHT, STRIKE_SRC } from '../src/sim/events.js';
import { EF, ZONE, PK, TPS } from '../src/sim/constants.js';
import { featMet } from '../src/meta/feats.js';
import { buildRunResult } from '../src/sim/run-result.js';

const MAP = DATA.maps.find((m) => m.id === 'salt_marsh');
const COLS = 256, ROWS = 256;
const DATA_T = testData();

/** A Marsh run with nothing spawning, the tester (no weapons), unhurt. */
function marsh(cfg = {}, { events = false } = {}) {
  // (At the neutral pace, as on the test field: these test the Marsh's mechanics. tests/pace.test.js checks the dials.)
  const w = createWorld(neutralPace({ seed: 5, map: 'salt_marsh', character: 'tester', densityCap: 0, invulnerable: true, ...cfg }), DATA_T);
  if (!events) w.director.eventIdx = w.director.events.length;   // (no elites or rings walking in)
  return w;
}
const tileOf = (w) => Math.floor(w.player.y / TILE) * COLS + Math.floor(w.player.x / TILE);
function place(w, i) { w.player.x = w.player.px = (i % COLS + 0.5) * TILE; w.player.y = w.player.py = (Math.floor(i / COLS) + 0.5) * TILE; }

/** Can you walk from your tile to the landing on the ground as it stands (4-connected, on what isn't solid)? */
const SEEN = new Uint8Array(COLS * ROWS), Q = new Int32Array(COLS * ROWS);
function pathHome(w) {
  const T = w.terrain, s = tileOf(w), goal = w.marsh.landing;
  if (T.solid[s]) return false;
  SEEN.fill(0);
  let h = 0, t = 0;
  Q[t++] = s; SEEN[s] = 1;
  while (h < t) {
    const i = Q[h++];
    if (i === goal) return true;
    const x = i % COLS;
    if (x + 1 < COLS && !SEEN[i + 1] && !T.solid[i + 1]) { SEEN[i + 1] = 1; Q[t++] = i + 1; }
    if (x > 0 && !SEEN[i - 1] && !T.solid[i - 1]) { SEEN[i - 1] = 1; Q[t++] = i - 1; }
    if (i + COLS < COLS * ROWS && !SEEN[i + COLS] && !T.solid[i + COLS]) { SEEN[i + COLS] = 1; Q[t++] = i + COLS; }
    if (i >= COLS && !SEEN[i - COLS] && !T.solid[i - COLS]) { SEEN[i - COLS] = 1; Q[t++] = i - COLS; }
  }
  return false;
}
const count = (a) => { let n = 0; for (let i = 0; i < a.length; i++) n += a[i]; return n; };
/** One tick, answering anything the run stops for (a chest, a cache, the well) without changing the build. */
function tick(w, frame = IDLE) {
  while (currentHalt(w)) {
    const h = currentHalt(w);
    decide(w, h.kind === 'draft' ? (w.charges.skip = Math.max(1, w.charges.skip), { kind: 'skip' }) : h.kind === 'rune' ? { kind: 'discard' } : h.kind === 'well' || h.kind === 'ascend' ? { kind: 'keep' } : h.kind === 'relic' ? { kind: 'pick', index: 0 } : h.kind === 'ferry' ? { kind: 'done' } : { kind: 'ok' });
  }
  stepWorld(w, frame);
}
const ticks = (w, n, frame = IDLE) => { for (let k = 0; k < n; k++) tick(w, frame); };

// ---------------------------------------------------------------- the layout

test('marsh layout: the same every time; kinds 9 to 17; solid only where a stump or deep water is; every open tile reachable from the landing', () => {
  const a = buildMarsh(MAP.layout, COLS, ROWS);
  clearMarshCache();
  const b = buildMarsh(MAP.layout, COLS, ROWS);
  assert.notEqual(a, b, 'built again from scratch');
  assert.deepEqual(a.kinds, b.kinds);
  assert.deepEqual(a.floodAt, b.floodAt);
  assert.deepEqual(buildMap(MAP.layout, COLS, ROWS).kinds, b.kinds, 'the sim and the view build the same ground');
  const seen = new Set(a.kinds);
  for (const k of [GROUND.SALT, GROUND.MUD, GROUND.REEDS, GROUND.PEAT, GROUND.STUMP, GROUND.DEEP, GROUND.CAUSEWAY, GROUND.BOARDWALK, GROUND.LANDING]) assert.ok(seen.has(k), `kind ${k}`);
  for (let i = 0; i < a.kinds.length; i++) assert.equal(a.solid[i], a.kinds[i] === GROUND.STUMP || a.kinds[i] === GROUND.DEEP ? 1 : 0);
  assert.equal(a.kinds[8 * COLS + 10], GROUND.LANDING, 'the landing at [10, 8]');
  for (let y = 7; y <= 9; y++) for (let x = 12; x <= 14; x++) assert.equal(a.kinds[y * COLS + x], GROUND.DEEP, 'a 3 x 3 deep pool east of it');
  assert.equal(a.kinds[222 * COLS + 222], GROUND.PEAT, 'the bog body\'s island');
  assert.equal(a.kinds[222 * COLS + 232], GROUND.DEEP, 'in its moat');
  assert.ok(a.causeway.length >= 4 && a.causeway.every((i) => a.kinds[i] === GROUND.CAUSEWAY && a.floodAt[i] === 50), 'a stone causeway, at height 50');
  // Every open tile reachable from the landing at low water.
  const w = marsh();
  place(w, w.marsh.landing);
  const T = w.terrain, reach = new Uint8Array(COLS * ROWS);
  const q = [w.marsh.landing]; reach[q[0]] = 1;
  while (q.length) {
    const i = q.pop(), x = i % COLS;
    for (const j of [x + 1 < COLS ? i + 1 : -1, x > 0 ? i - 1 : -1, i + COLS < COLS * ROWS ? i + COLS : -1, i - COLS]) if (j >= 0 && !reach[j] && !T.solid[j]) { reach[j] = 1; q.push(j); }
  }
  for (let i = 0; i < reach.length; i++) if (!T.solid[i]) assert.equal(reach[i], 1, `tile ${i % COLS}, ${Math.floor(i / COLS)} reachable`);
});

test('marsh layout: 5 creeks edge to edge, 3 to 4 wide and kept apart, boardwalks across each; flood heights by kind', () => {
  const g = buildMarsh(MAP.layout, COLS, ROWS);
  assert.equal(g.creeks.length, 5);
  for (const c of g.creeks) assert.ok(c.width >= 3 && c.width <= 4 && c.tiles === c.width * 256, `edge to edge, ${c.width} wide`);
  for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) assert.ok(Math.hypot(g.creeks[i].mid[0] - g.creeks[j].mid[0], g.creeks[i].mid[1] - g.creeks[j].mid[1]) >= 0.2 * 256, `creeks ${i} and ${j} apart`);
  let boardwalk = 0, mudLo = 255, mudHi = 0;
  for (let i = 0; i < g.kinds.length; i++) {
    const k = g.kinds[i], h = g.floodAt[i];
    if (k === GROUND.MUD) { mudLo = Math.min(mudLo, h); mudHi = Math.max(mudHi, h); assert.ok(h <= 100); }
    else if (k === GROUND.SALT || k === GROUND.REEDS) assert.ok(h >= 110 && h <= 250, 'flats 110 to 250');
    else if (k !== GROUND.CAUSEWAY) assert.equal(h, 255, `kind ${k} never floods`);
    if (k === GROUND.BOARDWALK) boardwalk++;
  }
  assert.deepEqual([mudLo, mudHi], [0, 100], 'creeks 0 at the mouth to 100');
  assert.ok(boardwalk >= 5 * 2 * 2 * 3 && boardwalk <= 5 * 3 * 2 * 4, `2 or 3 boardwalks a creek, 2 tiles thick (${boardwalk} tiles)`);
  assert.equal(g.highWet, g.firstAt[101], 'what high water covers: every creek and the causeway');
  assert.match(checkWater({ ...MAP.water, high: [[180, 480], [485, 900]] }), /must not overlap/);
});

// ---------------------------------------------------------------- the water

test('the water: warned 15s ahead, in over 10s from the mouths, high 3:00 to 8:00, out again; the ground rebuilt at most 4 times a second', () => {
  const w = marsh();
  const seen = [];
  let lastVersion = 0, rebuildTicks = 0;
  for (let k = 0; k < 8 * 60 * 60 + 15 * 60; k++) {
    tick(w);
    for (let i = 0; i < w.events.count; i++) if (w.events.type[i] === EV.WATER) seen.push([w.tick - 1, w.events.a[i], w.events.b[i]]);
    if (w.terrain.version !== lastVersion) { lastVersion = w.terrain.version; rebuildTicks++; assert.equal((w.tick - 1) % 15, 0, 'only on a rebuild tick'); }
    if (w.tick === 185 * 60 + 1) assert.ok(w.marsh.level > 30 && w.marsh.level < 70, `halfway in at 3:05 (${w.marsh.level})`);
  }
  assert.deepEqual(seen.map(([t, a, b]) => [t / 60, a, b]), [[165, 1, 15], [180, 2, 0], [190, 3, 0], [480, 4, 0], [490, 5, 0]]);
  assert.equal(w.marsh.level, 0);
  assert.equal(count(w.terrain.wet), 0, 'all out at 8:10');
  assert.ok(rebuildTicks <= 2 * 10 * 4 + 2, `${rebuildTicks} rebuilds over two creeps`);
  assert.ok(w.result.sighted.includes('water'));
});

test('the water: a short run keeps both high waters on the halved clock, warned and creeping in seconds', () => {
  const w = marsh({ mode: 'short' });
  assert.deepEqual(w.marsh.windows, [[90, 240], [390, 540]]);
  const at = [];
  for (let k = 0; k < 110 * 60; k++) { tick(w); for (let i = 0; i < w.events.count; i++) if (w.events.type[i] === EV.WATER) at.push([(w.tick - 1) / 60, w.events.a[i]]); }
  assert.deepEqual(at, [[75, 1], [90, 2], [100, 3]], 'warned 15s ahead, in over 10s: never squeezed');
  assert.equal(w.marsh.level, 101);
});

test('the water in overtime comes in and never goes out: a share of the flats each minute, at least 35% of the open ground dry', () => {
  const g = buildMarsh(MAP.layout, COLS, ROWS);
  const O = MAP.water.overtime;
  const levels = [1, 2, 4, 8, 20].map((k) => flatsLevel(g, O.perMin * k, O.keepDry));
  for (let k = 1; k < levels.length; k++) assert.ok(levels[k] >= levels[k - 1]);
  const top = levels[levels.length - 1];
  const wetAtTop = g.firstAt[top];
  assert.ok(g.open - wetAtTop >= 0.35 * g.open - 1, `${g.open - wetAtTop} of ${g.open} stay dry`);
  assert.ok(flatsLevel(g, 1, O.keepDry) === top, 'the cap holds however long you stay');
  // In a run: in after its 15s warning, up again each minute, never out.
  const w = marsh();
  w.director.overtime = true; w.director.overtimeStartTick = 0;
  const L = [];
  for (let k = 0; k < 3 * 3600 + 30 * 60; k++) { tick(w); if (w.tick % 1800 === 0) L.push(w.marsh.level); }
  assert.deepEqual(L.slice(0, 2), [101, 101], 'in at 0:25 (its warning, then 10s)');
  assert.ok(L[3] > 101 && L[5] > L[3] && L[6] >= L[5], `up each minute: ${L}`);
  assert.ok(L.every((v, k) => k === 0 || v >= L[k - 1]), 'never out');
});

// ---------------------------------------------------------------- rule 8

test('rule 8: standing in the deepest creek as the water comes in, the tiles you need stay mud; walk out and they flood', () => {
  const w = marsh();
  const T = w.terrain, M = w.marsh, g = M.g;
  // A creek tile far from its mouth with mud on all four sides.
  let deep = -1;
  for (let i = COLS; i < g.kinds.length - COLS && deep < 0; i++) {
    if (g.kinds[i] === GROUND.MUD && g.floodAt[i] >= 80 && [1, -1, COLS, -COLS].every((d) => g.kinds[i + d] === GROUND.MUD)) deep = i;
  }
  assert.ok(deep >= 0);
  place(w, deep);
  w.tick = 179 * 60;
  for (let k = 0; k < 20 * 60; k++) {
    tick(w);
    if (w.tick % 15 === 1) assert.equal(pathHome(w), true, `a way home at ${w.tick}`);
  }
  assert.equal(M.level, 101);
  assert.equal(T.wet[deep], 0, 'your tile is mud');
  assert.ok(M.heldN >= 1 && M.heldN <= 3, `held: ${M.heldN}`);
  for (let k = 0; k < M.heldN; k++) assert.equal(g.kinds[M.heldList[k]], GROUND.MUD);
  assert.equal(count(T.wet), g.highWet - M.heldN, 'everything else under the water');
  // Walk the chain home: once you're off the creek its tiles flood.
  for (let guard = 0; guard < 400 && g.floodAt[tileOf(w)] < 101; guard++) { place(w, M.step[tileOf(w)]); tick(w); }
  for (let k = 0; k < 16; k++) tick(w);
  assert.equal(M.heldN, 0);
  assert.equal(T.wet[deep], 1, 'and it floods behind you');
  assert.equal(count(T.wet), g.highWet);
});

test('rule 8: on the secret\'s island when the water comes, the causeway stays mud under you until you\'re back, for the horde too', () => {
  const w = marsh();
  const T = w.terrain, M = w.marsh, g = M.g;
  place(w, 222 * COLS + 222);
  w.tick = 179 * 60;
  ticks(w, 15 * 60);
  assert.equal(M.level, 101);
  assert.equal(pathHome(w), true);
  const held = Array.from(M.heldList.subarray(0, M.heldN));
  const way = held.filter((i) => g.kinds[i] === GROUND.CAUSEWAY);
  assert.ok(way.length >= 4 && held.every((i) => g.kinds[i] === GROUND.CAUSEWAY || g.kinds[i] === GROUND.MUD), 'the causeway held (and a creek\'s mud where no boardwalk crosses)');
  for (const i of g.causeway) if (!way.includes(i)) assert.equal(T.wet[i], 1, 'the causeway\'s other lane floods');
  // A sailor on the held causeway isn't moved: it can follow you across.
  const c = way[0];
  const e = spawnAt(w, 'drowned_sailor', (c % COLS + 0.5) * TILE - w.player.x, (Math.floor(c / COLS) + 0.5) * TILE - w.player.y);
  run(w, 30);
  assert.ok(Math.abs(w.enemies.x[e] - (c % COLS + 0.5) * TILE) < 16, 'still on the causeway');
  // Back on the mainland (along the chain past the causeway), it floods.
  while (g.kinds[tileOf(w)] !== GROUND.CAUSEWAY) place(w, M.step[tileOf(w)]);
  while (g.kinds[tileOf(w)] === GROUND.CAUSEWAY || g.kinds[tileOf(w)] === GROUND.DEEP) place(w, M.step[tileOf(w)]);
  run(w, 16);
  for (const i of g.causeway) assert.equal(T.wet[i], 1, 'the causeway under the water');
  assert.equal(pathHome(w), true);
});

test('rule 8: a walk through 4 minutes of overtime flood among glass pillars never loses the way home, and no pillar rises on it', () => {
  const w = marsh();
  const M = w.marsh, T = w.terrain;
  w.director.overtime = true; w.director.overtimeStartTick = 0;
  const route = [[60, 40], [120, 70], [90, 130], [170, 160], [210, 120], [140, 30]];
  let leg = 0, pillars = 0, checks = 0, lastLevel = -1;
  for (let k = 0; k < 4 * 3600; k++) {
    const [tx, ty] = route[leg % route.length];
    const dx = (tx + 0.5) * TILE - w.player.x, dy = (ty + 0.5) * TILE - w.player.y, d = Math.hypot(dx, dy);
    if (d < 24 || k % 900 === 899) leg++;
    tick(w, { mx: Math.round((dx / (d || 1)) * 127), my: Math.round((dy / (d || 1)) * 127), buttons: 0 });
    if (k % 120 === 0) {
      // A pillar a few tiles off, as the Salt Widow's lightning would raise one.
      const p = tileOf(w), ox = (k / 120) % 2 ? 4 : -5, oy = (k / 240) % 2 ? 3 : -4;
      if (raisePillar(w, (p % COLS) + ox, Math.floor(p / COLS) + oy)) pillars++;
    }
    if (w.tick % 15 === 1 && (M.level !== lastLevel || k % 300 === 1)) {
      lastLevel = M.level; checks++;
      assert.equal(pathHome(w), true, `a way home at ${w.tick} (level ${M.level})`);
      for (let s = 0; s < w.storm.pillarTile.length; s++) { const i = w.storm.pillarTile[s]; if (i >= 0) assert.equal(T.pillar[i], 1); }
    }
  }
  assert.ok(M.level > 101, `the flats are flooding (${M.level})`);
  assert.ok(pillars >= 6 && checks > 40, `${pillars} pillars, ${checks} checks`);
  assert.ok(w.storm.pillars <= DATA.tuning.storm.pillar.max);
});

test('rule 8: when the held chain home comes to run through a standing pillar, the pillar falls at once (the judge\'s seed-1 case)', () => {
  const w = marsh({ seed: 1 });
  const g = w.marsh.g, T = w.terrain, P = 7 * COLS + 5;
  place(w, 0);
  w.director.overtime = true; w.director.overtimeStartTick = 0; w.tick = 240 * 60 - 30;
  let raised = -1, fell = -1, cut = 0;
  for (let k = 0; k < 3600 && (raised < 0 || w.tick < raised + 20 * 60); k++) {
    tick(w);
    if (raised < 0 && w.tick > 250 * 60 && w.marsh.level >= g.floodAt[P] - 1 && w.marsh.level <= g.floodAt[P]) {
      assert.equal(raisePillar(w, 5, 7), true, 'a legal pillar: dry salt, 3 tiles off, not on the way home yet');
      raised = w.tick;
    }
    if (raised >= 0) {
      if (fell < 0 && T.pillar[P] === 0) fell = w.tick;
      if (w.tick % 15 === 1 && !pathHome(w)) cut++;
      for (let s = 0; s < w.storm.pillarTile.length; s++) { const i = w.storm.pillarTile[s]; if (i >= 0) assert.equal(w.marsh.pathMark[i] === w.marsh.passId && w.marsh.level > 0, false, 'no pillar on the way home'); }
    }
  }
  assert.ok(raised > 0);
  assert.ok(fell > raised && fell - raised < 8 * TPS, `it fell early (${fell - raised} ticks after it rose)`);
  assert.equal(cut, 0, 'the way home never closed');
});

test('rule 8 at the overtime flood\'s cap: from dry tiles across the map there\'s a way home', () => {
  const w = marsh();
  const g = w.marsh.g, O = MAP.water.overtime, cap = flatsLevel(g, 1, O.keepDry);
  w.director.overtime = true; w.director.overtimeStartTick = 0; w.tick = 40 * 60 * 60;
  ticks(w, 16);
  assert.equal(w.marsh.level, cap);
  const dry = [];
  for (let i = 0; i < g.kinds.length; i += 997) if (!w.terrain.base[i] && g.floodAt[i] >= cap) dry.push(i);
  assert.ok(dry.length >= 20, `${dry.length} tiles`);
  for (const i of dry) {
    place(w, i);
    ticks(w, 16);
    assert.equal(pathHome(w), true, `a way home from ${i % COLS}, ${Math.floor(i / COLS)} at level ${cap}`);
  }
});

test('the flow fields at high water: a walker goes round by a boardwalk and never onto the water; a leech swims straight across', () => {
  const w = marsh();
  const g = w.marsh.g;
  let found = null;
  for (let y = 20; y < 236 && !found; y++) for (let x = 30; x < 226 && !found; x++) {
    const i = y * COLS + x;
    if (g.kinds[i - COLS] !== GROUND.SALT || g.kinds[i] !== GROUND.MUD) continue;
    let wd = 0; while (g.kinds[i + wd * COLS] === GROUND.MUD) wd++;
    if (wd < 3 || g.kinds[i + wd * COLS] !== GROUND.SALT) continue;
    let bw = -1;
    for (let dx = -30; dx <= 30 && bw < 0; dx++) if (g.kinds[i + dx + COLS] === GROUND.BOARDWALK) bw = dx;
    if (bw === -1 || Math.abs(bw) < 8) continue;
    found = { i, wd };
  }
  const { i, wd } = found;
  const px = (i % COLS + 0.5) * TILE, py = (Math.floor(i / COLS) - 2 + 0.5) * TILE;
  const ex = px, ey = (Math.floor(i / COLS) + wd + 2 + 0.5) * TILE;
  place(w, (Math.floor(i / COLS) - 2) * COLS + (i % COLS));
  run(w, 2);
  const low = { walk: w.flow.stepsAt(ex, ey), swim: w.swimFlow.stepsAt(ex, ey) };
  w.tick = 195 * 60; run(w, 20);
  const high = { walk: w.flow.stepsAt(ex, ey), swim: w.swimFlow.stepsAt(ex, ey) };
  assert.ok(high.walk > low.walk + 20, `the walk home grows: ${low.walk} to ${high.walk} steps`);
  assert.equal(high.swim, low.swim, 'the swim doesn\'t');
  const s = spawnAt(w, 'drowned_sailor', ex - w.player.x, ey - w.player.y);
  const l = spawnAt(w, 'leech', ex - w.player.x + 6, ey - w.player.y);
  let sailorIn = -1, leechIn = -1;
  for (let k = 0; k < 40 * 60 && sailorIn < 0; k++) {
    tick(w);
    w.player.x = w.player.px = px; w.player.y = w.player.py = py;
    const d = (e) => Math.hypot(w.enemies.x[e] - px, w.enemies.y[e] - py);
    if (sailorIn < 0 && d(s) < 20) sailorIn = k;
    if (leechIn < 0 && (d(l) < 20 || w.latched > 0)) leechIn = k;
    assert.equal(w.terrain.wet[Math.floor(w.enemies.y[s] / TILE) * COLS + Math.floor(w.enemies.x[s] / TILE)], 0, 'never on the water');
  }
  assert.ok(leechIn >= 0 && leechIn < 5 * 60, `the leech crossed in ${leechIn / 60}s`);
  assert.ok(sailorIn > leechIn + 10 * 60, `the sailor came round in ${sailorIn / 60}s`);
});

// ---------------------------------------------------------------- mud, walkers, herbs

test('mud slows enemies to 60%, never you; walkers caught by the water move to the bank', () => {
  const w = marsh();
  const g = w.marsh.g;
  let mud = -1, salt = -1;
  for (let i = 40 * COLS; i < g.kinds.length && (mud < 0 || salt < 0); i++) {
    const ok = (k) => [1, 2, 3].every((d) => g.kinds[i + d] === k && g.kinds[i + d + COLS] === k);
    if (mud < 0 && g.kinds[i] === GROUND.MUD && ok(GROUND.MUD) && g.kinds[i + 4] === GROUND.MUD) mud = i;
    if (salt < 0 && g.kinds[i] === GROUND.SALT && ok(GROUND.SALT)) salt = i;
  }
  const walk = (i) => {
    const x = (i % COLS + 0.5) * TILE, y = (Math.floor(i / COLS) + 0.5) * TILE;
    w.player.x = w.player.px = x + 300; w.player.y = w.player.py = y;
    const e = spawnAt(w, 'drowned_sailor', -300, 0);
    tick(w);
    const v = (w.enemies.x[e] - w.enemies.px[e]) * TPS;
    w.enemies.flags[e] |= EF.DEAD; tick(w);
    return v;
  };
  const onSalt = walk(salt), onMud = walk(mud);
  assert.ok(Math.abs(onMud / onSalt - 0.6) < 0.02, `${onMud} on mud, ${onSalt} on salt`);
  // You walk the mud at full speed.
  place(w, mud);
  const x0 = w.player.x;
  stepWorld(w, { mx: 127, my: 0, buttons: 0 });
  assert.ok(Math.abs((w.player.x - x0) * TPS - DATA.tuning.player.speed) < 1e-6);
  // The water comes in under a sailor standing in a creek: it ends up on the bank.
  w.player.x = w.player.px = 20 * TILE; w.player.y = w.player.py = 8.5 * TILE;
  const e = spawnAt(w, 'drowned_sailor', (mud % COLS + 0.5) * TILE - w.player.x, (Math.floor(mud / COLS) + 0.5) * TILE - w.player.y);
  w.tick = 179 * 60;
  run(w, 12 * 60);
  const ex = Math.floor(w.enemies.x[e] / TILE), ey = Math.floor(w.enemies.y[e] / TILE);
  assert.equal(w.terrain.solid[ey * COLS + ex], 0, 'on dry ground');
});

test('herbs: 80 beds on the creek mud from the run\'s loot stream; picked by walking over at low water, under the water at high, still there after', () => {
  const a = marsh(), b = marsh(), c = marsh({ seed: 6 });
  assert.equal(a.marsh.herbTile.length, 80);
  assert.deepEqual(a.marsh.herbTile, b.marsh.herbTile);
  assert.notDeepEqual(a.marsh.herbTile, c.marsh.herbTile);
  for (let k = 0; k < 80; k++) {
    assert.equal(a.marsh.g.kinds[a.marsh.herbTile[k]], GROUND.MUD);
    assert.ok(a.marsh.herbLeft[k] >= 1 && a.marsh.herbLeft[k] <= 2);
  }
  // At high water a bed can't be picked from the bank beside it; at the next low water it can.
  const w = marsh();
  const g = w.marsh.g, bank = (i) => [1, -1, COLS, -COLS].map((d) => i + d).find((j) => g.kinds[j] === GROUND.SALT || g.kinds[j] === GROUND.REEDS);
  let k = 0;
  while (bank(w.marsh.herbTile[k]) === undefined) k++;
  const i = w.marsh.herbTile[k], left = w.marsh.herbLeft[k];
  w.tick = 200 * 60;
  run(w, 30);
  place(w, bank(i));
  run(w, 12);
  assert.equal(w.marsh.herbLeft[k], left, 'under the water');
  w.tick = 495 * 60;
  run(w, 30);
  assert.equal(w.marsh.herbLeft[k], 0);
  assert.equal(w.marsh.herbsPicked, left);
  const mi = DATA.materialIndex ?? w.materialIndex.get('marsh_herbs');
  assert.ok(w.result.materialsRaw[w.materialIndex.get('marsh_herbs')] >= left);
  assert.ok(w.result.sighted.includes('herbs'));
  void mi;
});

// ---------------------------------------------------------------- the storm, the Eye, pillars

/** A crowd standing on salt in view, held still. */
function saltCrowd(w, n = 30) {
  const g = w.marsh.g, p = w.player;
  const out = [];
  for (let k = 0; out.length < n && k < 4000; k++) {
    const x = p.x + ((k * 37) % 200) - 100, y = p.y + ((k * 53) % 120) - 60;
    const i = Math.floor(y / TILE) * COLS + Math.floor(x / TILE);
    if (g.kinds[i] !== GROUND.SALT) continue;
    const e = spawnAt(w, 'drowned_sailor', x - p.x, y - p.y);
    w.enemies.hp[e] = w.enemies.maxHp[e] = 1e6; w.enemies.speed[e] = 0;
    out.push(e);
  }
  return out;
}

test('the storm: in its windows, warned rings on the crowd on salt (1.2s), hard on enemies, light on you, Salt Glass every 8th; none without its layer', () => {
  const go = (layers) => {
    const w = marsh({ invulnerable: false, layers });
    place(w, 120 * COLS + 60);
    while (w.marsh.g.kinds[tileOf(w)] !== GROUND.SALT) w.player.x += TILE;
    saltCrowd(w);
    w.tick = 330 * 60 - 1;
    const tele = [], strikes = [];
    for (let k = 0; k < 125 * 60; k++) {
      tick(w);
      for (let i = 0; i < w.events.count; i++) {
        if (w.events.type[i] === EV.TELEGRAPH && w.events.a[i] === 1 && w.events.c[i] === MAP.storm.radius) tele.push(w.events.b[i]);
        if (w.events.type[i] === EV.STRIKE) strikes.push({ src: w.events.b[i], glass: w.events.c[i] });
      }
      w.player.hp = 100;
    }
    return { w, tele, strikes };
  };
  const on = go(undefined);
  assert.ok(on.strikes.length >= 3 * 3 && on.strikes.every((s) => s.src === STRIKE_SRC.STORM), `${on.strikes.length} strikes`);
  assert.ok(on.tele.every((t) => t >= 72), 'each warned at least 1.2s');
  assert.equal(on.strikes.length, on.w.storm.strikes, 'every ring counted');
  assert.equal(on.strikes.filter((s) => s.glass).length, Math.floor(on.strikes.length / 8), 'Salt Glass every 8th strike');
  assert.ok(on.w.result.damageBySlot[9] > 0, 'it hit the crowd');
  assert.ok(on.w.result.sighted.includes('storm'));
  const off = go({ storm: false, well: true, secret: true });
  assert.equal(off.strikes.length, 0);
  // Its own random stream: the storm drew from it, and the spawn, combat, and loot streams are where
  // they'd be without any storm.
  assert.notDeepEqual(on.w.rng.storm.getState(), off.w.rng.storm.getState(), 'the storm drew from its stream');
  for (const k of ['spawn', 'combat', 'loot']) assert.deepEqual(on.w.rng[k].getState(), off.w.rng[k].getState(), `the ${k} stream untouched`);
});

test('the storm: a burst of 7 over 8 crowds on salt hits the thickest seven, whatever stands off the salt; each ring counts toward its Salt Glass', () => {
  const w = marsh();
  place(w, 20 * COLS + 21);
  const g = w.marsh.g, p = w.player;
  const salt = (x, y) => g.kinds[Math.floor(y / TILE) * COLS + Math.floor(x / TILE)] === GROUND.SALT;
  // Eight sites 90 px apart, all on salt; crowds of 3 to 10, tight; and 60 enemies off the salt.
  const sites = [[-240, -110], [-150, -110], [-60, -110], [30, -110], [120, -110], [210, -110], [-240, 110], [210, 110]];
  for (const [dx, dy] of sites) for (const ox of [-8, 0, 8]) for (const oy of [-8, 0, 8]) assert.ok(salt(p.x + dx + ox, p.y + dy + oy), 'the sites are salt');
  const hold = (e) => { w.enemies.speed[e] = 0; w.enemies.hp[e] = w.enemies.maxHp[e] = 1e6; };
  sites.forEach(([dx, dy], c) => { for (let k = 0; k < 3 + c; k++) hold(spawnAt(w, 'drowned_sailor', dx + (k % 4) * 3, dy + ((k / 4) | 0) * 3)); });
  let off = 0;
  for (let k = 0; k < 4000 && off < 60; k++) {
    const dx = -300 + (k * 37) % 600, dy = -170 + (k * 53) % 340;
    if (salt(p.x + dx, p.y + dy) || w.terrain.blockedAt(p.x + dx, p.y + dy) || sites.some(([sx, sy]) => Math.hypot(sx - dx, sy - dy) < 70)) continue;
    hold(spawnAt(w, 'drowned_sailor', dx, dy)); off++;
  }
  assert.equal(off, 60);
  run(w, 1);
  const St = w.storm;
  St.windows = [{ from: 0, to: 1e9, every: 30, burst: [7, 7] }];
  St.strikes = 5; St.next = w.tick;
  const z0 = w.zones.count;
  run(w, 1);
  const rings = [];
  for (let z = z0; z < w.zones.count; z++) if (w.zones.kind[z] === ZONE.STRIKE) rings.push({ x: w.zones.x[z] - p.x, y: w.zones.y[z] - p.y, gift: w.zones.gift[z] });
  assert.equal(rings.length, 7);
  const hit = rings.map((r) => sites.findIndex(([sx, sy]) => Math.hypot(sx - r.x, sy - r.y) < 24));
  assert.deepEqual(hit, [7, 6, 5, 4, 3, 2, 1], 'the thickest first, every ring on a crowd on salt');
  assert.equal(St.strikes, 12, 'all 7 counted');
  assert.deepEqual(rings.map((r) => r.gift & 1), [0, 0, 1, 0, 0, 0, 0], 'the 8th strike of the run leaves Salt Glass');
  const glass = [];
  for (let k = 0; k < 3 * 60; k++) { run(w, 1); for (let i = 0; i < w.events.count; i++) if (w.events.type[i] === EV.STRIKE) glass.push(w.events.c[i]); }
  assert.deepEqual(glass, [0, 0, 1, 0, 0, 0, 0]);
});

test('a short run: the storm\'s windows and the Eye on the halved clock, the Eye over before the last boss', () => {
  const w = marsh({ mode: 'short' });
  assert.deepEqual(w.storm.windows.map((x) => [x.from, x.to]), MAP.storm.windows.map((x) => [x.from / 2, x.to / 2]));
  assert.deepEqual(w.storm.windows.map((x) => x.every), MAP.storm.windows.map((x) => x.every), 'the rings\' pace in seconds');
  const all = marsh({ mode: 'short' }, { events: true });
  const eye = all.director.events.find((e) => e.event === 'eye'), boss = all.director.events.filter((e) => e.event === 'boss').pop();
  assert.equal(eye.at, 570);
  startEye(w, eye);
  assert.equal(w.storm.eyeUntil - w.tick, Math.round(22.5 * TPS), 'half as long');
  assert.ok(eye.at + 22.5 <= boss.at, 'over before the Salt Widow');
});

test('the Eye (19:00, the storm\'s layer): spawns stop, warned rings every 2.5s on the leftover horde, 30 gems and 4 Salt Glass', () => {
  const w = marsh({ densityCap: undefined });
  run(w, 1);
  const ev = MAP.timeline.events.find((e) => e.event === 'eye');
  assert.deepEqual([ev.at, ev.sec], [1140, 45]);
  for (let k = 0; k < 12; k++) spawnAt(w, 'salted_dead', -150 + (k % 4) * 100, -60 + (k >> 2) * 60);
  tick(w);
  const gems0 = w.gems.count, picks0 = w.pickups.count;
  startEye(w, ev);
  assert.equal(w.gems.count - gems0, 30);
  assert.equal(w.pickups.count - picks0, 4);
  const regular = w.director.regularAlive;
  const strikes = [];
  for (let k = 0; k < 6 * 60; k++) {
    tick(w);
    for (let i = 0; i < w.events.count; i++) if (w.events.type[i] === EV.STRIKE) strikes.push(w.tick);
  }
  assert.ok(w.director.regularAlive <= regular, 'nothing new spawns');
  assert.ok(strikes.length >= 4, `${strikes.length} rings in 6s`);
  run(w, 45 * 60, IDLE, { halts: 'pass' });   // (the band's crowd keeps coming outside the Eye: its levels' drafts pass)
  assert.equal(w.storm.eyeUntil, -1, 'over after 45s');
  assert.ok(w.result.sighted.includes('eye'));
  const no = marsh({ layers: { storm: false, well: true, secret: true } });
  assert.equal(startEye(no, ev), false, 'not without the storm\'s layer');
});

test('glass pillars: only on dry salt, never within 3 tiles of you, never on your way home, at most 6, gone after 8s (with no storm too)', () => {
  const w = marsh({ layers: { storm: false, well: false, secret: false } });
  place(w, 100 * COLS + 100);
  while (w.marsh.g.kinds[tileOf(w)] !== GROUND.SALT) w.player.x += TILE;
  const p = tileOf(w), px = p % COLS, py = Math.floor(p / COLS);
  assert.equal(raisePillar(w, px + 2, py), false, 'too near');
  let up = 0;
  for (let dx = -12; dx <= 12; dx += 4) for (let dy = -12; dy <= 12; dy += 6) if (Math.max(Math.abs(dx), Math.abs(dy)) >= 3 && raisePillar(w, px + dx, py + dy)) up++;
  assert.equal(up, 6, 'six at most');
  for (let s = 0; s < w.storm.pillarTile.length; s++) { const i = w.storm.pillarTile[s]; if (i >= 0) assert.equal(w.marsh.g.kinds[i], GROUND.SALT); }
  run(w, 16);
  assert.equal(count(w.terrain.pillar), 6);
  assert.equal(count(w.terrain.solid) - count(w.terrain.base), 6, 'they block');
  run(w, 8 * 60);
  assert.equal(count(w.terrain.pillar), 0, 'and fall');
  assert.equal(w.storm.pillars, 0);
  // At high water, never on the path the water is held back for.
  const v = marsh();
  const creek = v.marsh.g.order[v.marsh.g.firstAt[95]];
  place(v, creek);
  v.tick = 191 * 60 - 2;
  run(v, 20);
  let refused = 0;
  for (let i = v.marsh.step[tileOf(v)], n = 0; i >= 0 && n < 40; i = v.marsh.step[i], n++) {
    const x = i % COLS, y = Math.floor(i / COLS);
    if (Math.max(Math.abs(x - creek % COLS), Math.abs(y - Math.floor(creek / COLS))) >= 3 && v.marsh.g.kinds[i] === GROUND.SALT) { assert.equal(raisePillar(v, x, y), false); refused++; }
  }
  assert.ok(refused >= 1, 'some of the way home is salt');
});

// ---------------------------------------------------------------- layers, the director, the well

test('layers: without the well the 15:00 muster is an elite; without the secret, no cache; the Marsh has no wall events, its gulls come in flocks of 8 or fewer', () => {
  assert.equal(MAP.timeline.events.filter((e) => e.event === 'wall').length, 0, 'rule 2: no walls');
  assert.equal((MAP.overtime.repeat || []).filter((e) => e.event === 'wall').length, 0);
  const flocks = MAP.timeline.events.filter((e) => e.event === 'flock');
  assert.deepEqual(flocks.map((e) => e.at), [390, 690, 990]);
  assert.ok(flocks.every((e) => e.count <= 8));
  const all = marsh({}, { events: true });
  const none = marsh({ layers: { storm: false, well: false, secret: false } }, { events: true });
  const at15 = (w) => w.director.events.find((e) => e.at === 900);
  assert.deepEqual([at15(all).event, at15(all).enemy, at15(all).escort], ['muster', 'well_warden', 'salted_dead']);
  assert.deepEqual([at15(none).event, at15(none).enemy], ['elite', 'salted_dead']);
  assert.equal(none.director.events.some((e) => e.event === 'eye'), false, 'no Eye without the storm');
  // (0.9.0, W4: the small finds are always there; only the big secret has the layer.)
  const finds = DATA.maps.find((m) => m.id === 'salt_marsh').secrets.filter((x) => x.gift).map((x) => x.id);
  assert.deepEqual(all.secrets.map((s) => s.id), ['drowned_causeway', ...finds]);
  assert.deepEqual(none.secrets.map((s) => s.id), finds);
  assert.throws(() => marsh({ layers: { storm: true, fog: true } }), /there is no "fog"/);
  assert.throws(() => marsh({ layers: { storm: 1 } }), /layers\.storm must be true or false/);
  // A flock: a tight clump from one side, flying straight.
  const w = marsh();
  place(w, 128 * COLS + 128);
  w.director.events = [{ at: 0, event: 'flock', enemy: 'gull', count: 8, index: 99 }]; w.director.eventIdx = 0;
  run(w, 2);
  const gulls = [];
  for (let i = 0; i < w.enemies.count; i++) if (w.enemyDefs[w.enemies.type[i]].id === 'gull') gulls.push(i);
  assert.equal(gulls.length, 8);
  let spread = 0;
  for (const i of gulls) for (const j of gulls) spread = Math.max(spread, Math.hypot(w.enemies.x[i] - w.enemies.x[j], w.enemies.y[i] - w.enemies.y[j]));
  assert.ok(spread <= 40, `a clump ${spread.toFixed(0)} px across`);
});

test('the director on the Marsh: eels come up only in water, midges come in threes', () => {
  const w = createWorld(neutralPace({ seed: 9, map: 'salt_marsh', character: 'tester', invulnerable: true }), DATA_T);
  w.tick = 200 * 60;   // high water, the eels' band
  w.director.band = 2;
  let eels = 0;
  for (let k = 0; k < 400; k++) {
    tick(w);
    for (let i = 0; i < w.enemies.count; i++) {
      if (w.enemyDefs[w.enemies.type[i]].id !== 'creek_eel' || (w.enemies.flags[i] & EF.DEAD)) continue;
      eels++;
      assert.equal(w.terrain.waterAt(Math.floor(w.enemies.x[i] / TILE), Math.floor(w.enemies.y[i] / TILE)), true, 'an eel in the water');
    }
  }
  assert.ok(eels > 0);
  const m = marsh();
  m.config.densityCap = 3;
  m.director.band = 0;
  run(m, 2);
  const midges = [];
  for (let i = 0; i < m.enemies.count; i++) if (m.enemyDefs[m.enemies.type[i]].id === 'midge_cloud') midges.push(i);
  assert.ok(midges.length >= 3);
  assert.ok(Math.hypot(m.enemies.x[midges[0]] - m.enemies.x[midges[1]], m.enemies.y[midges[0]] - m.enemies.y[midges[1]]) < 12, 'together');
});

test('the Salt Well: the Warden\'s fall opens it; stand still 0.6s within 18px to give one relic (gone for the run, kept out of the pools); it asks once on its own, then only when you stand still in its ring again (ruling 16: never on a dash)', () => {
  const w = marsh({ relics: ['brass_button', 'spark_flint'] });
  const e = spawnAt(w, 'well_warden', 40, 0, { elite: true });
  w.enemies.boss[e] = -2; // a muster's captain
  w.enemies.hp[e] = 1; w.scratch.num[0] = 5;
  w.enemies.flags[e] |= EF.DEAD; w.enemies.killer[e] = -1;
  const events = [];
  tick(w);
  for (let i = 0; i < w.events.count; i++) if (w.events.type[i] === EV.WELL) events.push(w.events.a[i]);
  assert.deepEqual(events, [1]);
  assert.equal(w.well.open, true);
  assert.ok(Array.from(w.pickups.kind.subarray(0, w.pickups.count)).includes(PK.CHEST), 'and his chest, as a muster captain\'s');
  w.player.x = w.player.px = w.well.x + 10; w.player.y = w.player.py = w.well.y;
  let waited = 0;
  for (; waited < 60 && currentHalt(w)?.kind !== 'well'; waited++) { const h = currentHalt(w); if (h) decide(w, h.kind === 'draft' ? { kind: 'pick', index: 0 } : { kind: 'ok' }); else stepWorld(w, IDLE); }   // (a level-up from the gems the wider pickup reach brings in: ruling 20 R20a)
  assert.ok(waited >= 36 && waited <= 40, `after 0.6s standing still (${waited} ticks)`);
  assert.equal(currentHalt(w)?.kind, 'well', 'asked after 0.6s standing still');
  assert.deepEqual(currentHalt(w).relics, ['brass_button', 'spark_flint']);
  decide(w, { kind: 'keep' });
  run(w, 60);
  assert.equal(currentHalt(w), null, 'not again while you stand there');
  w.player.x += 40; run(w, 2);
  w.player.dashCd = 0;
  for (let k = 0; k < 30 && !currentHalt(w); k++) stepWorld(w, { mx: -127, my: 0, buttons: k === 0 ? 1 : 0 });
  assert.equal(currentHalt(w), null, 'a dash into its ring asks nothing (ruling 16)');
  w.player.x = w.player.px = w.well.x + 4; w.player.y = w.player.py = w.well.y;
  for (let k = 0; k < 40 && !currentHalt(w); k++) stepWorld(w, { mx: k % 10 < 5 ? 127 : -127, my: 0, buttons: 0 });
  assert.equal(currentHalt(w), null, 'walking about in it asks nothing after the first time');
  let still = 0;
  for (; still < 60 && !currentHalt(w); still++) stepWorld(w, IDLE);
  assert.equal(currentHalt(w)?.kind, 'well', 'standing still in its ring asks again');
  assert.ok(Math.abs(still - DATA.tuning.well.openSec * 60) <= 2, `after the ring's fill (${still} ticks)`);
  assert.throws(() => decide(w, { kind: 'give', id: 'gull_feather' }), /isn't carried/);
  const might = w.stats.might ?? null;
  decide(w, { kind: 'give', id: 'brass_button' });
  assert.deepEqual(w.build.relics.map((r) => r.id), ['spark_flint']);
  assert.equal(w.result.wellGiven, 'brass_button');
  assert.ok(w.build.banished.has('relic:brass_button'), 'kept out of every pool for the run');
  assert.equal(buildRunResult(w).wellGiven, 'brass_button');
  run(w, 120);
  assert.equal(currentHalt(w), null, 'one relic a run');
  void might;
});

test('the Salt Well: without its layer no captain opens it (the overtime Salt Watch included); the water moves an open well to dry ground', () => {
  const w = marsh({ layers: { storm: true, well: false, secret: true } });
  const D = w.director, reps = w.map.overtime.repeat, j = reps.findIndex((r) => r.event === 'muster');
  D.overtime = true; D.overtimeStartTick = w.tick;
  for (let k = 0; k < reps.length; k++) D.otNext[k] = k === j ? w.tick + 1 : 1e12;
  ticks(w, 3);
  let cap = -1;
  for (let i = 0; i < w.enemies.count; i++) if (w.enemyDefs[w.enemies.type[i]].id === 'well_warden') cap = i;
  assert.ok(cap >= 0, 'the Salt Watch came');
  w.enemies.flags[cap] |= EF.DEAD; w.enemies.killer[cap] = -1;
  tick(w);
  assert.equal(w.well.open, false, 'no well without its layer');
  // With it: a well on a creek tile, then high water.
  const v = marsh();
  const g = v.marsh.g;
  let mud = -1;
  for (let i = 40 * COLS; i < g.kinds.length && mud < 0; i++) if (g.kinds[i] === GROUND.MUD && g.floodAt[i] < 50 && [1, -1, COLS, -COLS].every((d) => g.kinds[i + d] === GROUND.MUD)) mud = i;
  const e = spawnAt(v, 'well_warden', (mud % COLS + 0.5) * TILE - v.player.x, (Math.floor(mud / COLS) + 0.5) * TILE - v.player.y, { elite: true });
  v.enemies.boss[e] = -2; v.enemies.flags[e] |= EF.DEAD; v.enemies.killer[e] = -1;
  tick(v);
  assert.equal(v.well.open, true);
  v.tick = 195 * 60;
  ticks(v, 20);
  assert.equal(v.terrain.blockedAt(v.well.x, v.well.y), false, 'the well moved to dry ground');
});

// ---------------------------------------------------------------- the result, sightings, feats, the tag

test('first sightings: one FIRST_SIGHT each, the first time a run meets it; the result lists them', () => {
  const w = marsh();
  const seen = [];
  const keep = () => { for (let i = 0; i < w.events.count; i++) if (w.events.type[i] === EV.FIRST_SIGHT) seen.push([w.events.a[i], w.events.b[i]]); };
  spawnAt(w, 'leech', 100, 0); keep(); tick(w);
  spawnAt(w, 'leech', 100, 20); keep(); tick(w);
  spawnAt(w, 'mire_toad', 100, 40); keep(); tick(w);
  const leech = w.enemyIndex.get('leech'), toad = w.enemyIndex.get('mire_toad');
  assert.deepEqual(seen, [[SIGHT.ENEMY, leech], [SIGHT.ENEMY, toad]]);
  assert.deepEqual(w.result.sighted, ['enemy:leech', 'enemy:mire_toad']);
  assert.deepEqual(buildRunResult(w).sighted, ['enemy:leech', 'enemy:mire_toad']);
  const r = buildRunResult(w);
  for (const k of ['quenched', 'crowdSec', 'wellGiven', 'sighted', 'thralls', 'tryPotLevels', 'herbsPicked', 'layers']) assert.ok(k in r, k);
  assert.deepEqual(r.layers, { storm: true, well: true, secret: true });
});

test('crowdSec: the longest run of seconds with the Watchman\'s crowd close by (tuning.run.crowd.count; one fewer counts nothing)', () => {
  const N = DATA.tuning.run.crowd.count;
  const short = makeWorld({ invulnerable: true });
  for (let k = 0; k < N - 1; k++) { const e = spawnAt(short, 'drowned_sailor', 20 * Math.cos(k), 20 * Math.sin(k)); short.enemies.speed[e] = 0; }
  run(short, 3 * 60 + 1);
  assert.equal(short.result.crowdSec, 0, `${N - 1} close: no crowd`);
  const w = makeWorld({ invulnerable: true });
  const crowd = [];
  for (let k = 0; k < N; k++) { const e = spawnAt(w, 'drowned_sailor', 20 * Math.cos(k), 20 * Math.sin(k)); w.enemies.speed[e] = 0; crowd.push(e); }
  run(w, 3 * 60 + 1);
  assert.ok(Math.abs(w.result.crowdSec - 3) <= 0.11, `${w.result.crowdSec}`);
  w.player.x += 400; run(w, 60);
  assert.ok(Math.abs(w.result.crowdSec - 3) <= 0.11, 'the longest, kept');
});

test('the Marsh\'s feats are judged from the run: the first crossing, the Quencher, the Watchman, Marsh Dawn, Eel Season', () => {
  const F = Object.fromEntries(DATA.feats.map((f) => [f.id, f.when]));
  assert.equal(featMet(F.first_crossing, { map: 'salt_marsh', timeSurvived: 300 }), true);
  assert.equal(featMet(F.first_crossing, { map: 'drowned_docks', timeSurvived: 900 }), false, 'on the Marsh');
  assert.equal(featMet(F.first_crossing, { map: 'salt_marsh', timeSurvived: 299 }), false);
  assert.equal(featMet(F.quencher, { quenched: 15 }), true);
  assert.equal(featMet(F.quencher, { quenched: 14 }), false);
  assert.equal(featMet(F.watchman, { map: 'salt_marsh', crowdSec: 10 }), true);
  assert.equal(featMet(F.watchman, { map: 'salt_marsh', crowdSec: 9.9 }), false);
  assert.equal(featMet(F.marsh_dawn, { map: 'salt_marsh', end: 'cleared' }), true);
  assert.equal(featMet(F.dawn, { map: 'salt_marsh', end: 'cleared' }), false, 'Dawn is the Docks\'');
  const eel = (weapons, lv) => ({ bossesKilled: [{ id: 'the_tidecaller', weapons }], weaponLevelMax: { eel_pot: lv } });
  assert.equal(featMet(F.eel_season, eel(['eel_pot', 'flare_gun'], 8)), true);
  assert.equal(featMet(F.eel_season, eel(['flare_gun', 'eel_pot'], 8)), false, 'the Eel Pot did the most');
  assert.equal(featMet(F.eel_season, eel(['eel_pot'], 7)), false, 'at Lv 8');
});

test('the Tide tag is Sea everywhere: tags, a passive\'s scope, gear, the Sea Rite relic (Kevin\'s decision 8)', () => {
  const lists = [DATA.weapons, DATA.passives];
  for (const x of lists.flat()) assert.ok(!(x.tags || []).includes('tide'), `${x.id}: no Tide tag`);
  for (const p of DATA.passives) for (const l of p.levels) for (const m of l) assert.ok(!(m.tags || []).includes('tide'), p.id);
  for (const a of DATA.affixes) assert.ok(!(a.mod?.tags || []).includes('tide') && !/\(Tide\)/.test(a.name), a.id);
  assert.deepEqual(DATA.weapons.filter((w) => w.tags.includes('sea')).map((w) => w.id).sort(), ['anchor_chain', 'brine_spring', 'eel_pot', 'fog_horn', 'grapnel', 'harpoon_chain', 'king_tide', 'punt_pole', 'tide_bell']);   // (ruling 18 WD: the Fog Horn's a sea horn; 0.9.0, W2: three signature weapons; ruling 17 K2: Bog Hands shares the Eel Pot's Sea)
  assert.equal(DATA.relics.find((a) => a.id === 'brine').hook, 'sea_heal');
  assert.match(DATA.relics.find((a) => a.id === 'brine').desc, /Sea weapons/);
  assert.ok(DATA.palette && DATA.tides.length === 10, 'the difficulty keeps the name Tide');
});

test('a Marsh run replays the same: the same seed and frames give the same hash, twice', () => {
  const go = () => {
    const w = createWorld({ seed: 11, map: 'salt_marsh', character: 'lamplighter', invulnerable: true }, DATA);
    w.tick = 178 * 60;
    for (let k = 0; k < 900; k++) {
      while (currentHalt(w)) { const h = currentHalt(w); decide(w, h.kind === 'draft' ? { kind: 'pick', index: 0 } : h.kind === 'rune' ? { kind: 'discard' } : h.kind === 'well' ? { kind: 'keep' } : h.kind === 'relic' ? { kind: 'pick', index: 0 } : { kind: 'ok' }); }
      stepWorld(w, { mx: (k % 120) < 60 ? 90 : -60, my: 40, buttons: k % 200 === 0 ? 4 : 0 });
    }
    return hashWorld(w);
  };
  assert.equal(go(), go());
});
