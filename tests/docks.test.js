// Phase 6 on the Drowned Docks: the wharf's layout, the secret cache in the wreck and what it
// unlocks, the Bosun's Muster, and the bosses' own attacks (the Maw's lure, the Tidecaller's
// tide lanes).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA } from '../src/data/index.js';
import { buildMap, buildLayout, checkDocks, clearGroundCache, GROUND, TILE } from '../src/sim/terrain.js';
import { checkTimeline } from '../src/sim/director.js';
import { currentHalt, decide, stepWorld, hashWorld, createWorld } from '../src/sim/world.js';
import { checkBossDef } from '../src/sim/bosses.js';
import { EV, TELE, PICK } from '../src/sim/events.js';
import { EF, ZONE, RELIC_SLOT } from '../src/sim/constants.js';
import { addRelic } from '../src/sim/build.js';
import { groundFrame, GROUND_FRAMES } from '../src/render/viewstate.js';
import { readFileSync } from 'node:fs';
import { noticeFor, haltView } from '../src/app/runlogic.js';
import { applyRunResult } from '../src/meta/apply.js';
import { resolveContent, parseUnlock, isUnlocked, codexKeys } from '../src/meta/state.js';
import { reconcileProfile } from '../src/meta/reconcile.js';
import { changeLines } from '../src/ui/hubtext.js';
import { defaultProfile } from '../src/save/schema.js';
import { makeWorld, run, runCollect, eventsOf, spawnAt, give, IDLE } from './helpers/simworld.js';

const DOCKS = DATA.maps.find((m) => m.id === 'drowned_docks');
const SECRET = DOCKS.secrets[0];
const [COLS, ROWS] = DOCKS.size;

/** Open tiles a walker reaches from the middle (4-way steps), as a Uint8Array. */
function reach(solid, cols, rows) {
  const seen = new Uint8Array(cols * rows), q = [];
  const s = Math.floor(rows / 2) * cols + Math.floor(cols / 2);
  seen[s] = 1; q.push(s);
  while (q.length) {
    const i = q.pop(), x = i % cols, y = (i - x) / cols;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, j = ny * cols + nx;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || seen[j] || solid[j]) continue;
      seen[j] = 1; q.push(j);
    }
  }
  return seen;
}

test('docks: the wharf is the same every time, every open tile is reachable, and the wreck holds the cache', () => {
  // Each built from scratch (the cache emptied between): the same ground every time.
  clearGroundCache();
  const a = buildMap(DOCKS.layout, COLS, ROWS);
  clearGroundCache();
  const b = buildMap(DOCKS.layout, COLS, ROWS);
  assert.deepEqual(a.solid, b.solid);
  assert.deepEqual(a.kinds, b.kinds);
  assert.deepEqual(buildLayout(DOCKS.layout, COLS, ROWS), a.solid, 'the sim and the view build the same ground');
  // Solid exactly where the kind is an obstacle.
  const solidKinds = new Set([GROUND.CRATE, GROUND.WATER, GROUND.SHED_ROOF, GROUND.SHED_WALL, GROUND.SHED_DOOR, GROUND.WRECK]);
  for (let i = 0; i < a.kinds.length; i++) assert.equal(a.solid[i], solidKinds.has(a.kinds[i]) ? 1 : 0, `tile ${i}`);
  // Every kind shows up, and the wharf is mostly open.
  const count = new Map();
  for (const k of a.kinds) count.set(k, (count.get(k) || 0) + 1);
  for (const k of Object.values(GROUND)) assert.ok(count.get(k) > 0, `kind ${k} appears`);
  const open = a.solid.length - a.solid.reduce((s, v) => s + v, 0);
  assert.ok(open / a.solid.length > 0.85 && open / a.solid.length < 0.95, `open share ${(open / a.solid.length).toFixed(2)}`);
  // No sealed pockets: every open tile is reachable from the start, the cache's tile among them.
  const seen = reach(a.solid, COLS, ROWS);
  for (let i = 0; i < a.solid.length; i++) if (!a.solid[i]) assert.equal(seen[i], 1, `open tile ${i % COLS},${Math.floor(i / COLS)} is reachable`);
  const [sx, sy] = SECRET.at;
  assert.equal(a.kinds[sy * COLS + sx], GROUND.DECK, 'the cache sits on the wreck\'s deck');
  // The wreck is closed but for its gap: its deck is reachable only through the south side.
  const deck = [];
  for (let i = 0; i < a.kinds.length; i++) if (a.kinds[i] === GROUND.DECK) deck.push(i);
  const doorTiles = deck.filter((i) => a.kinds[i - COLS] === GROUND.DECK && a.kinds[i + COLS] === GROUND.FLOOR);
  assert.equal(doorTiles.length, 2, 'one gap, two tiles wide');
  // The start area is clear, and no stretch of water runs longer than a short slip (a long one
  // has its footbridge).
  for (let y = 128 - 10; y <= 128 + 10; y++) for (let x = 128 - 10; x <= 128 + 10; x++) {
    if ((x - 128) ** 2 + (y - 128) ** 2 < 100) assert.notEqual(a.kinds[y * COLS + x], GROUND.CRATE);
  }
  for (let x = 0; x < COLS; x++) {
    let run = 0, longest = 0;
    for (let y = 0; y < ROWS; y++) { if (a.kinds[y * COLS + x] === GROUND.WATER) { run++; longest = Math.max(longest, run); } else run = 0; }
    assert.ok(longest <= DOCKS.layout.slips.bridgeOver, `column ${x}: water runs ${longest} tiles at most`);
  }
  assert.throws(() => buildMap({ ...DOCKS.layout, wreck: { at: [3, 3], size: [14, 8] } }, COLS, ROWS), /6 tiles inside/);
  // Every slip and shed asked for is there, each shed with one door in its front wall.
  const doors = count.get(GROUND.SHED_DOOR);
  assert.equal(doors, DOCKS.layout.sheds.count, 'one door a shed');
  for (let i = 0; i < a.kinds.length; i++) {
    if (a.kinds[i] !== GROUND.SHED_DOOR) continue;
    assert.equal(a.kinds[i - COLS], GROUND.SHED_ROOF, 'a door under the roof');
    assert.ok([GROUND.SHED_WALL].includes(a.kinds[i - 1]) && [GROUND.SHED_WALL].includes(a.kinds[i + 1]), 'off the corners');
  }
  // The hull narrows to its bow: the east end's column is shorter than the stern's.
  const colHull = (x) => [...Array(ROWS).keys()].filter((y) => [GROUND.WRECK, GROUND.DECK].includes(a.kinds[y * COLS + x])).length;
  const w0 = DOCKS.layout.wreck.at[0] - Math.floor(DOCKS.layout.wreck.size[0] / 2);
  assert.ok(colHull(w0 + DOCKS.layout.wreck.size[0] - 1) < colHull(w0) / 2, 'a pointed bow, a square stern');
});

test('docks: a layout that is wrong or can\'t fit says so plainly', () => {
  const L = DOCKS.layout;
  assert.equal(checkDocks(L, COLS, ROWS), null);
  const bad = [
    [{ ...L, slips: undefined }, /slips need/],
    [{ ...L, slips: { ...L.slips, width: 1 } }, /width of 2/],
    [{ ...L, slips: { ...L.slips, length: [20, 10] } }, /length \[min, max\]/],
    [{ ...L, slips: { ...L.slips, bridge: 12 } }, /bridge shorter/],
    [{ ...L, sheds: { count: 2, size: [2, 2] } }, /sheds need/],
    [{ ...L, crates: { count: -1, size: [1, 2] } }, /crates need/],
    [{ ...L, wreck: { at: [100], size: [14, 8] } }, /the wreck needs/],
    [{ ...L, seed: '' }, /seed/],
    [{ ...L, clearRadius: -5 }, /clearRadius/],
  ];
  for (const [layout, msg] of bad) assert.throws(() => buildMap(layout, COLS, ROWS), msg);
  assert.throws(() => buildMap(L, 40, 40), /at least 64 tiles/);
  assert.throws(() => buildMap({ ...L, sheds: { count: 900, size: [6, 4] } }, COLS, ROWS), /only \d+ of 900 sheds fit/);
  assert.throws(() => buildMap({ ...L, slips: { ...L.slips, count: 900 } }, COLS, ROWS), /only \d+ of 900 slips fit/);
});

test('docks: the run view picks each tile\'s frame by its kind and its neighbors', () => {
  const g = buildMap(DOCKS.layout, COLS, ROWS);
  const tr = { kinds: g.kinds, cols: COLS, rows: ROWS, blocked: (x, y) => g.solid[y * COLS + x] === 1 };
  const seen = new Set();
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    const f = groundFrame(tr, x, y), k = g.kinds[y * COLS + x];
    seen.add(f);
    if (k === GROUND.WATER) {
      const up = g.kinds[(y - 1) * COLS + x], left = g.kinds[y * COLS + x - 1];
      assert.equal(/^tile_water_n/.test(f), up !== GROUND.WATER, `water at ${x},${y} under ${up}`);
      assert.equal(/^tile_water_n?w/.test(f), left !== GROUND.WATER, `water at ${x},${y} beside ${left}`);
    }
    if (k === GROUND.BRIDGE && g.kinds[(y - 1) * COLS + x] === GROUND.WATER) assert.equal(f, 'tile_bridge_n');
  }
  for (const id of ['tile_water_0', 'tile_water_1', 'tile_water_n', 'tile_water_w', 'tile_water_e', 'tile_water_nw', 'tile_water_ne', 'tile_bridge_0', 'tile_bridge_n', 'tile_bridge_s', 'tile_roof_0', 'tile_roof_1',
    'tile_shed_wall_0', 'tile_shed_wall_1', 'tile_hull_0', 'tile_hull_1', 'tile_deck_0', 'tile_deck_1', 'tile_block_0', 'tile_floor_0']) assert.ok(seen.has(id), `${id} is used`);
  // Every frame it can name is one it knows, and each is on the atlas page; slips 2 wide (the
  // narrowest a layout allows) never meet both sides.
  for (const f of seen) assert.ok(GROUND_FRAMES.includes(f), `${f} is listed`);
  const atlas = JSON.parse(readFileSync(new URL('../src/assets/atlas.json', import.meta.url), 'utf8'));
  for (const f of GROUND_FRAMES) assert.ok(atlas.frames[f], `${f} is on the atlas page`);
  const narrow = buildMap({ ...DOCKS.layout, slips: { ...DOCKS.layout.slips, width: 2 } }, COLS, ROWS);
  const ntr = { kinds: narrow.kinds, cols: COLS, rows: ROWS, blocked: () => false };
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) assert.ok(GROUND_FRAMES.includes(groundFrame(ntr, x, y)));
  // A map with no kinds (a crate scatter) is boards and crates.
  const plain = { kinds: null, cols: 4, rows: 4, blocked: (x) => x === 0 };
  assert.match(groundFrame(plain, 0, 1), /^tile_block_/);
  assert.match(groundFrame(plain, 1, 1), /^tile_floor_/);
});

const CACHE_AT = [70, 64];
const cacheMap = () => ({ mapExtra: { secrets: [{ id: SECRET.id, name: SECRET.name, at: CACHE_AT, radius: 10, relic: SECRET.relic }] } });
const toCache = (w) => { w.player.x = w.player.px = (CACHE_AT[0] + 0.5) * TILE; w.player.y = w.player.py = (CACHE_AT[1] + 0.5) * TILE; };

test('secret: the cache opens once, when you reach it, and gives its relic', () => {
  const w = makeWorld({}, cacheMap());
  assert.equal(w.secrets.length, 1);
  run(w, 30);
  assert.equal(w.secrets[0].open, false, 'shut until you get there');
  toCache(w);
  stepWorld(w, IDLE);
  assert.equal(w.secrets[0].open, true);
  assert.equal(eventsOf(w, EV.SECRET).length, 1);
  assert.ok(w.build.relics.some((r) => r.id === 'wreck_lantern'), 'the relic is yours');
  assert.deepEqual(w.result.secrets, ['wreck_cache']);
  const h = currentHalt(w);
  assert.equal(h.kind, 'chest');
  assert.equal(h.chestKind, 3);
  assert.deepEqual(h.items, [{ kind: 'relic', id: 'wreck_lantern' }]);
  assert.equal(noticeFor(w.events, w.events.type.indexOf(EV.SECRET), w), 'Secret found: Wreck Cache');
  // The reel says it's the secret cache.
  const view = haltView(w, h, w.data);
  assert.equal(view.secret, true);
  assert.equal(view.boss, false);
  assert.match(readFileSync(new URL('../src/ui/menus.js', import.meta.url), 'utf8'), /secret \? 'Secret cache'/, 'the reel is titled Secret cache');
  assert.match(readFileSync(new URL('../src/app/scenes/run.js', import.meta.url), 'utf8'), /secret: v\.secret/, 'the run scene passes it on');
  decide(w, { kind: 'ok' });
  stepWorld(w, IDLE);
  assert.equal(eventsOf(w, EV.SECRET).length, 0, 'never again this run');
  assert.equal(w.build.relics.filter((r) => r.id === 'wreck_lantern').length, 1);
});

test('secret: a cache whose relic you already carry (or banished) gives one chest item instead', () => {
  const w = makeWorld({}, cacheMap());
  give(w, 'flare_gun');
  addRelic(w, w.relicDefs.find((r) => r.id === 'wreck_lantern'));
  toCache(w);
  stepWorld(w, IDLE);
  const h = currentHalt(w);
  assert.equal(h.items.length, 1);
  assert.notEqual(h.items[0].id, 'wreck_lantern');
  assert.deepEqual(w.result.secrets, ['wreck_cache'], 'still found');
  const w2 = makeWorld({}, cacheMap());
  w2.build.banished.add('relic:wreck_lantern');
  toCache(w2);
  stepWorld(w2, IDLE);
  assert.ok(!w2.build.relics.some((r) => r.id === 'wreck_lantern'));
});

test('secret: the state hash sees the cache open or shut', () => {
  const a = makeWorld({}, cacheMap()), b = makeWorld({}, cacheMap());
  toCache(a); toCache(b);
  stepWorld(a, IDLE); stepWorld(b, IDLE);
  assert.equal(hashWorld(a), hashWorld(b), 'the same moves, the same hash');
  b.secrets[0].open = false;
  assert.notEqual(hashWorld(a), hashWorld(b), 'only the cache differs, and the hash says so');
});

test('secret: the cache opens when you reach its edge, not from further off', () => {
  const r = 10 + DATA.tuning.player.radius;
  for (const [gap, opens] of [[r + 1, false], [r - 1, true]]) {
    const w = makeWorld({}, cacheMap());
    toCache(w);
    w.player.x = w.player.px = w.secrets[0].x + gap;
    stepWorld(w, IDLE);
    assert.equal(w.secrets[0].open, opens, `${gap} px off`);
  }
});

test('Wreck Lantern: every 5th kill leaves burning oil where it fell', () => {
  const w = makeWorld();
  addRelic(w, w.relicDefs.find((r) => r.id === 'wreck_lantern'));
  give(w, 'flare_gun', { level: 8 });
  const zones = () => [...Array(w.zones.count).keys()].filter((i) => w.zones.kind[i] === ZONE.GROUND).length;
  for (let k = 0; k < 4; k++) { const e = spawnAt(w, 'fog_wisp', 200 + k * 10, 200); w.enemies.hp[e] = 0.1; w.enemies.flags[e] |= EF.DEAD; }
  stepWorld(w, IDLE);
  assert.equal(zones(), 0, 'four kills: nothing yet');
  const e = spawnAt(w, 'fog_wisp', 220, 220); w.enemies.flags[e] |= EF.DEAD;
  stepWorld(w, IDLE);
  assert.equal(zones(), 1, 'the fifth leaves a pool');
  for (let k = 0; k < 4; k++) { const x = spawnAt(w, 'fog_wisp', -200, 200 + k * 10); w.enemies.flags[x] |= EF.DEAD; }
  stepWorld(w, IDLE);
  assert.equal(zones(), 1, 'kills 6 to 9: nothing more');
  const t = spawnAt(w, 'fog_wisp', -220, -220); w.enemies.flags[t] |= EF.DEAD;
  stepWorld(w, IDLE);
  assert.equal(zones(), 2, 'the tenth leaves the second');
  // The oil hurts what stands in it, once each interval.
  const P = DATA.relics.find((r) => r.id === 'wreck_lantern').params;
  const z = [...Array(w.zones.count).keys()].find((i) => w.zones.kind[i] === ZONE.GROUND);
  const crab = spawnAt(w, 'drowned_bosun', w.zones.x[z] - w.player.x, w.zones.y[z] - w.player.y);
  w.enemies.speed[crab] = 0;
  // (The relic slot's hits: the oil's pulses at its damage, and its burn's ticks, smaller.)
  const hits = runCollect(w, Math.round(P.interval * 60 * 3) + 1, EV.HIT).filter((x) => x.b === w.enemies.handle(crab) && x.d === RELIC_SLOT && Math.round(x.a) === P.damage);
  assert.ok(hits.length >= 3 && hits.length <= 4, `${hits.length} pulses in three intervals`);
});

test('muster: the Bosun comes with his crew, and pays a boss chest', () => {
  const ev = { at: 0, event: 'muster', name: "Bosun's Muster", enemy: 'drowned_bosun', escort: 'drowned_sailor', count: 12, radius: 36 };
  const w = makeWorld({ invulnerable: true }, { events: [ev] });
  const got = runCollect(w, 2, EV.MUSTER);
  assert.equal(got.length, 1);
  assert.equal(got[0].a, 12, 'the whole crew on open ground');
  const E = w.enemies;
  const captain = E.resolve(got[0].b);
  assert.ok((E.flags[captain] & EF.ELITE) !== 0);
  const crew = [...Array(E.count).keys()].filter((i) => E.type[i] === w.enemyIndex.get('drowned_sailor'));
  assert.equal(crew.length, 12);
  for (const i of crew) assert.ok(Math.abs(Math.hypot(E.x[i] - E.x[captain], E.y[i] - E.y[captain]) - 36) < 1, 'in a ring around him');
  // The notice names the muster.
  const w2 = makeWorld({ invulnerable: true }, { events: [ev] });
  stepWorld(w2, IDLE);
  const i = w2.events.type.indexOf(EV.MUSTER);
  assert.equal(noticeFor(w2.events, i, w2), "Bosun's Muster");
  // The captain drops a boss chest; an ordinary elite an elite chest.
  E.flags[captain] |= EF.DEAD;
  stepWorld(w, IDLE);
  const chests = [...Array(w.pickups.count).keys()].filter((k) => w.pickups.kind[k] === PICK.CHEST).map((k) => w.pickups.a[k]);
  assert.deepEqual(chests, [2]);
  const plain = spawnAt(w, 'drowned_bosun', 300, 0, { elite: true });
  E.flags[plain] |= EF.DEAD;
  stepWorld(w, IDLE);
  const after = [...Array(w.pickups.count).keys()].filter((k) => w.pickups.kind[k] === PICK.CHEST).map((k) => w.pickups.a[k]).sort();
  assert.deepEqual(after, [1, 2]);
});

test('muster: the timeline check names what a muster needs', () => {
  const map = (e) => ({ id: 'm', timeline: { bands: [{ from: 0, to: 60, roster: { fog_wisp: 1 }, density: [0, 0] }], events: [{ at: 1, event: 'muster', name: 'X', enemy: 'drowned_bosun', escort: 'drowned_sailor', count: 4, radius: 30, ...e }] }, overtime: { densityPerMin: 1, hpPerMin: 1, materialsPerMin: 1 } });
  const idx = new Map(DATA.enemies.map((x, i) => [x.id, i]));
  assert.doesNotThrow(() => checkTimeline(map({}), idx, DATA.enemies));
  assert.throws(() => checkTimeline(map({ escort: 'nobody' }), idx, DATA.enemies), /unknown escort/);
  assert.throws(() => checkTimeline(map({ escort: 'gull' }), idx, DATA.enemies), /walks with its elite/);
  assert.throws(() => checkTimeline(map({ count: 0 }), idx, DATA.enemies), /whole-number count/);
  assert.throws(() => checkTimeline(map({ radius: 400 }), idx, DATA.enemies), /under 120/);
  assert.throws(() => checkTimeline(map({ name: '' }), idx, DATA.enemies), /needs a name/);
  // The Drowned Docks has its muster at 15:00, in place of the old sailor ring.
  const m = DOCKS.timeline.events.find((e) => e.event === 'muster');
  assert.equal(m.at, 900);
});

/** A world with the Maw right there, about to use its `name` attack. */
function mawAbout(name, dx, config = {}) {
  const w = makeWorld({ invulnerable: false, ...config }, { events: [{ at: 0, event: 'boss', enemy: 'harbor_maw' }] });
  run(w, 1);
  const b = w.bosses[0], E = w.enemies, e = E.resolve(b.handle);
  E.x[e] = E.px[e] = w.player.x + dx; E.y[e] = E.py[e] = w.player.y;
  E.speed[e] = 0;
  b.next = b.def.phases[0].attacks.indexOf(name); b.timer = 0;
  return { w, b, e };
}

test('lure: the Maw draws you in while it warns, then bites inside its ring', () => {
  const lure = DATA.bosses.find((x) => x.id === 'harbor_maw').attacks.lure;
  assert.ok(lure.pull < DATA.tuning.player.speed * 0.6, 'slower than you walk');
  // Standing still 100 px off: drawn in (not into its body) and bitten.
  const { w } = mawAbout('lure', 100);
  const hp0 = w.player.hp, x0 = w.player.x;
  const tele = runCollect(w, 1, EV.TELEGRAPH);
  assert.equal(tele[0].a, TELE.RING);
  assert.equal(tele[0].c, lure.bite);
  run(w, Math.round(lure.warn * 60) - 2);
  assert.ok(w.player.x > x0 + 40, `drawn toward it (${(w.player.x - x0).toFixed(0)} px)`);
  assert.equal(w.player.hp, hp0, 'nothing until the bite');
  run(w, 4);
  assert.ok(w.player.hp < hp0, 'bitten');
  assert.equal(w.pull.ticks, 0, 'the pull ends with the bite');
  // Walking away gets you out.
  const away = mawAbout('lure', 100);
  const hpA = away.w.player.hp;
  run(away.w, Math.round(lure.warn * 60) + 4, { mx: -127, my: 0, buttons: 0 });
  assert.equal(away.w.player.hp, hpA, 'walked clear');
  assert.ok(away.w.enemies.x[away.e] - away.w.player.x > lure.bite);
});

test('tide lanes: rows of pools across where you stand, each warned, one after another', () => {
  const tide = DATA.bosses.find((x) => x.id === 'the_tidecaller').attacks.tide;
  const w = makeWorld({ invulnerable: true }, { events: [{ at: 0, event: 'boss', enemy: 'the_tidecaller' }] });
  run(w, 1);
  const b = w.bosses[0], E = w.enemies, e = E.resolve(b.handle);
  E.x[e] = w.player.x + 150; E.y[e] = w.player.y; E.speed[e] = 0;
  b.next = b.def.phases[0].attacks.indexOf('tide'); b.timer = 0;
  const px = w.player.x, py = w.player.y;
  const circles = runCollect(w, 1, EV.TELEGRAPH).filter((t) => t.a === TELE.CIRCLE);
  const per = Math.round(tide.length / tide.spacing);
  assert.equal(circles.length, tide.lanes * per);
  // Lanes: the pools share one coordinate per lane, `gap` apart, across your position.
  const across = new Set(circles.map((c) => Math.round(c.y))).size === tide.lanes;
  const lanes = [...new Set(circles.map((c) => Math.round(across ? c.y : c.x)))].sort((p, q) => p - q);
  assert.equal(lanes.length, tide.lanes);
  for (let k = 1; k < lanes.length; k++) assert.ok(Math.abs(lanes[k] - lanes[k - 1] - tide.gap) <= 1);
  const mid = across ? py : px;
  assert.ok(lanes[0] <= mid + tide.gap && lanes.at(-1) >= mid - tide.gap, 'over where you stand');
  // Each lane warns `stagger` s after the last, and never under the minimum.
  const warns = [...new Set(circles.map((c) => c.b))].sort((p, q) => p - q);
  assert.equal(warns.length, tide.lanes);
  assert.ok(warns[0] >= Math.round(DATA.tuning.enemies.telegraphMin * 60));
  for (let k = 1; k < warns.length; k++) assert.equal(warns[k] - warns[k - 1], Math.round(tide.stagger * 60));
});

test('secret meta: finding the cache records it, unlocks its relic, and the results say so once', () => {
  assert.deepEqual(parseUnlock('secret:wreck_cache'), { kind: 'secret', id: 'wreck_cache' });
  assert.deepEqual(parseUnlock('secret:'), { kind: 'unknown' });
  assert.ok(codexKeys(DATA).includes('secret:wreck_cache'));
  const doc = defaultProfile();
  assert.ok(!resolveContent(doc, DATA).relics.includes('wreck_lantern'), 'not in a fresh profile\'s pool');
  assert.equal(isUnlocked(doc, DATA, 'secret:wreck_cache'), false);
  const result = {
    v: 1, seed: 1, map: 'drowned_docks', mode: 'standard', character: 'lamplighter', end: 'died', timeSurvived: 700, ticks: 42000,
    level: 20, kills: {}, totalKills: 0, elitesKilled: 0, bossesKilled: [], cleared: false,
    weapons: [], weaponLevelMax: {}, maxWeaponLevel: 0, passives: [], relics: ['wreck_lantern'], runes: [], evolutions: [], tags: {},
    materials: {}, damageTaken: 0, dashKills: 0, revivalsUsed: 0, gems: 0, chests: 1,
    overtimeMinutes: 0, secretsFound: ['wreck_cache'], rerolls: 0, skips: 0, banished: [],
  };
  const { doc: after, changes } = applyRunResult(doc, result, DATA);
  assert.ok(after.profile.codex.includes('secret:wreck_cache'));
  assert.ok(resolveContent(after, DATA).relics.includes('wreck_lantern'), 'in the pool from now on');
  const texts = changeLines(DATA, changes).map((l) => l.text);
  assert.ok(texts.includes('Secret found: Wreck Cache'));
  assert.ok(texts.includes('New relic: Wreck Lantern'));
  assert.ok(!texts.includes('Discovered: Wreck Lantern'), 'said once, under the secret');
  assert.ok(texts.indexOf('Secret found: Wreck Cache') < texts.indexOf('New relic: Wreck Lantern'));
  // Found again: nothing new.
  const again = applyRunResult(after, result, DATA);
  assert.ok(!changeLines(DATA, again.changes).some((l) => /Secret/.test(l.text)));
  // A loaded profile keeps the secret (reconcile knows the key).
  const kept = reconcileProfile(structuredClone(after), DATA);
  assert.ok((kept.doc ?? kept).profile.codex.includes('secret:wreck_cache'));
});

test('dev warp: to open ground beside the secret, and a plain message on a map without one', () => {
  const w = makeWorld({}, cacheMap());
  decide(w, { kind: 'dev', cmd: 'warp', secret: 0 });
  const s = w.secrets[0];
  assert.ok(Math.abs(w.player.y - s.y - 6 * TILE) < 2 * TILE && Math.abs(w.player.x - s.x) < 2 * TILE);
  assert.ok(!w.terrain.blockedAt(w.player.x, w.player.y));
  assert.throws(() => decide(makeWorld(), { kind: 'dev', cmd: 'warp', secret: 0 }), /no secret 0/);
});

test('lure: never from off screen, a dash is free of it, and it ends with its own Maw only', () => {
  // The Maw 300 px off (its ring would be off screen): the lure waits its turn and the next attack starts.
  const far = mawAbout('lure', 300);
  const lure = far.b.def.attacks.lure;
  const tele = runCollect(far.w, 2, EV.TELEGRAPH);
  assert.ok(tele.length >= 1 && tele[0].c !== lure.bite, 'something else started');
  assert.equal(far.w.pull.ticks, 0, 'no pull');
  // A dash covers its whole distance while the lure pulls.
  const d = mawAbout('lure', 100);
  run(d.w, 2);
  assert.ok(d.w.pull.ticks > 0);
  const x0 = d.w.player.x, T = DATA.tuning.player.dash;
  const ticks = Math.max(1, Math.round(T.time * 60));
  run(d.w, 1, { mx: -127, my: 0, buttons: 1 });
  run(d.w, ticks - 1, { mx: -127, my: 0, buttons: 0 });
  assert.ok(Math.abs(x0 - d.w.player.x - T.distance) < 1, `dashed ${(x0 - d.w.player.x).toFixed(1)} px of ${T.distance}`);
  // Another boss dying leaves the pull be; the Maw dying ends it.
  const m = mawAbout('lure', 100);
  run(m.w, 2);
  m.w.pull.boss = m.b.handle + 1;            // as if another boss were luring
  m.w.enemies.flags[m.e] |= EF.DEAD;
  stepWorld(m.w, IDLE);
  assert.ok(m.w.pull.ticks > 0, 'not its lure: it goes on');
  const n = mawAbout('lure', 100);
  run(n.w, 2);
  n.w.enemies.flags[n.e] |= EF.DEAD;
  stepWorld(n.w, IDLE);
  assert.equal(n.w.pull.ticks, 0, 'the Maw is down: the pull ends');
});

/** A Tidecaller about to roll its tide, the player where `place` puts them once the rows are down. */
function tideAt(place) {
  const w = makeWorld({}, { events: [{ at: 0, event: 'boss', enemy: 'the_tidecaller' }] });
  run(w, 1);
  const b = w.bosses[0], E = w.enemies, e = E.resolve(b.handle);
  E.x[e] = E.px[e] = w.player.x + 160; E.y[e] = E.py[e] = w.player.y; E.speed[e] = 0;
  b.next = b.def.phases[0].attacks.indexOf('tide'); b.timer = 0;
  const circles = runCollect(w, 1, EV.TELEGRAPH).filter((t) => t.a === TELE.CIRCLE);
  const across = new Set(circles.map((c) => Math.round(c.y))).size === 3;
  const rows = [...new Set(circles.map((c) => (across ? c.y : c.x)))].sort((p, q) => p - q);
  const warns = rows.map((r) => circles.find((c) => (across ? c.y : c.x) === r).b);
  place(w, across, rows);
  return { w, rows, warns, hp: w.player.hp };
}

test('tide lanes: the band between two rows is safe, and a row hurts only once its own warning ends', () => {
  const tide = DATA.bosses.find((x) => x.id === 'the_tidecaller').attacks.tide;
  const go = (w, across, v) => { if (across) w.player.y = w.player.py = v; else w.player.x = w.player.px = v; };
  // Between the first two rows, for the whole tide.
  const safe = tideAt((w, across, rows) => go(w, across, (rows[0] + rows[1]) / 2));
  run(safe.w, Math.round((tide.warn + 2 * tide.stagger + tide.last) * 60));
  assert.equal(safe.w.player.hp, safe.hp, 'untouched between rows');
  // On the last row: nothing until its warning (the longest) ends, then it hurts.
  const on = tideAt((w, across, rows) => go(w, across, rows[2]));
  const last = Math.max(...on.warns);
  run(on.w, last - 3);
  assert.equal(on.w.player.hp, on.hp, 'nothing before its warning ends');
  run(on.w, 30);
  assert.ok(on.w.player.hp < on.hp, 'then the row hurts');
});

test('bosses: attack data is checked at 0:00, by type, in plain words', () => {
  const maw = DATA.bosses.find((x) => x.id === 'harbor_maw'), tc = DATA.bosses.find((x) => x.id === 'the_tidecaller');
  const T = DATA.tuning;
  assert.equal(checkBossDef(maw, T), null);
  assert.equal(checkBossDef(tc, T), null);
  const withAttack = (def, name, over) => ({ ...def, attacks: { ...def.attacks, [name]: { ...def.attacks[name], ...over } } });
  assert.match(checkBossDef(withAttack(maw, 'lure', { pull: undefined }), T), /pull must be above 0/);
  assert.match(checkBossDef(withAttack(maw, 'lure', { pull: 79 }), T), /well under your walking speed/);
  assert.match(checkBossDef(withAttack(maw, 'lure', { bite: 200 }), T), /fit on screen/);
  assert.match(checkBossDef(withAttack(tc, 'tide', { gap: 30 }), T), /stand between/);
  assert.match(checkBossDef(withAttack(tc, 'tide', { spacing: 60 }), T), /pools of a row must touch/);
  assert.match(checkBossDef(withAttack(maw, 'slam', { type: 'laser' }), T), /unknown type "laser"/);
  assert.match(checkBossDef({ ...maw, phases: [{ from: 1, every: 2, attacks: ['nope'] }] }, T), /unknown attack "nope"/);
  assert.match(checkBossDef({ ...maw, phases: [{ from: 1, attacks: ['slam'] }] }, T), /every must be above 0/);
  assert.match(checkBossDef({ ...maw, phases: [{ from: 0, every: 2, attacks: ['slam'] }] }, T), /share of HP/);
  assert.match(checkBossDef(withAttack(maw, 'summon', { enemy: 'nobody' }), T, new Set(DATA.enemies.map((x) => x.id))), /unknown enemy "nobody"/);
  const bad = { ...DATA, bosses: [withAttack(maw, 'lure', { pull: undefined }), tc] };
  assert.throws(() => createWorld({ seed: 1, map: 'drowned_docks', character: 'lamplighter' }, bad), /pull must be above 0/);
});

test('muster: the crew comes in from off screen, every one of them', () => {
  const ev = { at: 0, event: 'muster', name: "Bosun's Muster", enemy: 'drowned_bosun', escort: 'drowned_sailor', count: 16, radius: 36 };
  for (const seed of [1, 2, 3, 4, 5]) {
    const w = makeWorld({ seed }, { events: [ev] });
    stepWorld(w, IDLE);
    const E = w.enemies, p = w.player;
    for (let i = 0; i < E.count; i++) assert.ok(Math.hypot(E.x[i] - p.x, E.y[i] - p.y) >= 368, `seed ${seed}: one appeared on screen`);
  }
});

test('new weapons: the Oil Flask lands on its target near or far; a Signal Mirror volley takes a beam each', () => {
  for (const off of [40, 200]) {
    const w = makeWorld({ invulnerable: true });
    give(w, 'oil_flask');
    const e = spawnAt(w, 'drowned_bosun', off, 0);
    w.enemies.speed[e] = 0; w.enemies.hp[e] = w.enemies.maxHp[e] = 1e6;
    const hits = runCollect(w, 120, EV.HIT).filter((x) => x.b === w.enemies.handle(e) && x.d === 0);
    assert.ok(hits.length > 0, `a target ${off} px off is hit`);
  }
  // Two enemies apart: a two-beam volley reaches both.
  const w = makeWorld({ invulnerable: true });
  give(w, 'signal_mirror', { level: 3 }); // level 3 brings the second beam
  assert.equal(w.slots[0].stats.amount, 2);
  const a = spawnAt(w, 'drowned_bosun', 60, 0), b = spawnAt(w, 'drowned_bosun', 0, -90);
  for (const e of [a, b]) { w.enemies.speed[e] = 0; w.enemies.hp[e] = w.enemies.maxHp[e] = 1e6; }
  const got = new Set(runCollect(w, 40, EV.HIT).filter((x) => x.d === 0).map((x) => x.b));
  assert.ok(got.has(w.enemies.handle(a)) && got.has(w.enemies.handle(b)), 'each beam its own target');
});

test('new weapons: a lightning bolt only where a strike lands, not on its jumps or pools', () => {
  const w = makeWorld({ invulnerable: true });
  give(w, 'lightning_rod', { runes: ['burning_ground'] });
  for (let k = 0; k < 6; k++) { const e = spawnAt(w, 'drowned_bosun', 30 + k * 20, 0); w.enemies.speed[e] = 0; w.enemies.hp[e] = w.enemies.maxHp[e] = 1e6; }
  const hits = runCollect(w, 300, EV.HIT).filter((x) => x.d === 0);
  const own = hits.filter((x) => (x.c & 2) !== 0), rest = hits.filter((x) => (x.c & 2) === 0);
  assert.ok(own.length > 0 && rest.length > own.length, `${own.length} strikes, ${rest.length} jumps and pulses`);
  assert.ok(w.slots[0].stats.amount * Math.floor(300 / 60 / w.slots[0].stats.cooldown) >= own.length - w.slots[0].stats.amount, 'about one a strike');
});
