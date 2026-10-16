// Small worlds for sim tests: an open test field with nothing spawning on its own, a test
// character with no weapons, and helpers to place enemies and give weapons.

import { DATA } from '../../src/data/index.js';
import { createWorld, stepWorld, decide, currentHalt } from '../../src/sim/world.js';
import { spawnEnemy } from '../../src/sim/enemies.js';
import { buildSlot } from '../../src/sim/weapons.js';
import { markStatsDirty, rebuildStats } from '../../src/sim/build.js';

export const IDLE = Object.freeze({ mx: 0, my: 0, buttons: 0 });

export function testData({ bands, events, layout, extraWeapons = [], extraEnemies = [], mapExtra = {} } = {}) {
  const map = {
    id: 'test_field', name: 'Test Field', desc: 'For tests.', size: [128, 128], ambient: 0.5,
    layout: layout ?? { kind: 'open' },
    materials: [], commonDrops: [], eliteDrops: [], pickups: null,
    timeline: {
      bands: bands ?? [{ from: 0, to: 60, roster: { fog_wisp: 1 }, density: [0, 0] }],
      events: events ?? [],
    },
    overtime: { densityPerMin: 1.12, hpPerMin: 1.15, materialsPerMin: 1.1 },
    secrets: [],
    ...mapExtra,
  };
  const tester = { id: 'tester', name: 'Tester', desc: 'For tests.', sprite: 'pc_lamplighter', start: null, innate: null, base: {}, mechanic: null, unlock: 'starter' };
  return {
    ...DATA,
    maps: [...DATA.maps, map],
    characters: [...DATA.characters, tester],
    weapons: [...DATA.weapons, ...extraWeapons],
    enemies: [...DATA.enemies, ...extraEnemies],
  };
}

/** A world on the test field with the test character (no weapons), unless told otherwise. */
export function makeWorld(config = {}, dataOpts = {}) {
  const data = testData(dataOpts);
  return createWorld({ seed: 1, map: 'test_field', character: 'tester', ...config }, data);
}

export function center(world) {
  return { x: world.player.x, y: world.player.y };
}

/** Spawn an enemy by id at an offset from the player. Returns its dense index. */
export function spawnAt(world, id, dx, dy, opts = null) {
  const t = world.enemyIndex.get(id);
  if (t === undefined) throw new Error(`no enemy ${id}`);
  return spawnEnemy(world, t, world.player.x + dx, world.player.y + dy, opts);
}

/** Put a weapon (by id) in a slot at a level, with runes (ids), and rebuild stats. */
export function give(world, id, { slot = null, level = 1, runes = [] } = {}) {
  const def = world.weaponDefs[world.weaponIndex.get(id)];
  if (!def) throw new Error(`no weapon ${id}`);
  let s = slot;
  if (s === null) { s = 0; while (world.slots[s]) s++; }
  const r = new Array(def.runeSlots || 0).fill(null);
  runes.forEach((rid, k) => { r[k] = world.runeDefs.find((x) => x.id === rid); });
  world.slots[s] = buildSlot(world, s, def, level, r);
  markStatsDirty(world);
  rebuildStats(world);
  return world.slots[s];
}

export function givePassive(world, id, level = 1) {
  const def = world.passiveDefs.find((p) => p.id === id);
  const owned = world.build.passives.find((p) => p.def.id === id);
  if (owned) owned.level = level; else world.build.passives.push({ def, level });
  markStatsDirty(world);
  rebuildStats(world);
}

/**
 * Step n ticks with a frame (default idle). Returns how many ran. Stops early if the run ends.
 * A halt (a level-up, a chest) throws unless the test says what to do: { halts: 'stop' } stops
 * there, { halts: 'pass' } answers it without changing the build (skips the draft, opens the
 * chest, discards the rune), so a test can never pass on a world that quietly stopped moving.
 */
/** Answer every pending halt, changing the build as little as can be: skip, ok, discard, the first relic, done, keep, stay. */
function passHalts(world) {
  while (currentHalt(world)) {
    const h = currentHalt(world);
    if (h.kind === 'draft') { world.charges.skip = Math.max(1, world.charges.skip); decide(world, { kind: 'skip' }); }
    else if (h.kind === 'chest') decide(world, { kind: 'ok' });
    else if (h.kind === 'rune') decide(world, { kind: 'discard' });
    else if (h.kind === 'relic') decide(world, { kind: 'pick', index: 0 });
    else if (h.kind === 'ferry') decide(world, { kind: 'done' });
    else if (h.kind === 'ascend') decide(world, { kind: 'keep' });
    else decide(world, { kind: 'stay' });
  }
}

export function run(world, n, frame = IDLE, { halts = 'throw' } = {}) {
  for (let k = 0; k < n; k++) {
    if (world.over) return k;
    if (halts === 'pass') passHalts(world);
    if (currentHalt(world)) {
      if (halts === 'stop') return k;
      throw new Error(`run(): the world is waiting on a "${currentHalt(world).kind}" decision at tick ${world.tick} (use autoDecide, or pass { halts: 'stop' })`);
    }
    stepWorld(world, frame);
  }
  return n;
}

/** Answer every pending halt with a simple policy: first card, ok, discard runes, leave. */
export function autoDecide(world) {
  let g = 0;
  while (currentHalt(world) && g++ < 100) {
    const h = currentHalt(world);
    if (h.kind === 'draft') decide(world, { kind: 'pick', index: 0 });
    else if (h.kind === 'chest') decide(world, { kind: 'ok' });
    else if (h.kind === 'rune') decide(world, { kind: 'discard' });
    else decide(world, { kind: 'leave' });
  }
}

/** Every event of a type from the buffer as objects (the buffer holds this tick's events). */
export function eventsOf(world, type) {
  const b = world.events, out = [];
  for (let i = 0; i < b.count; i++) if (b.type[i] === type) out.push({ x: b.x[i], y: b.y[i], a: b.a[i], b: b.b[i], c: b.c[i], d: b.d[i] });
  return out;
}

/**
 * Collect events across ticks (the world clears them each tick in headless mode). Like run(),
 * a pending decision throws unless { halts: 'stop' } or { halts: 'pass' } says what to do.
 */
export function runCollect(world, n, type, frame = IDLE, { halts = 'throw' } = {}) {
  const got = [];
  for (let k = 0; k < n; k++) {
    if (world.over) break;
    if (currentHalt(world)) {
      if (halts === 'stop') break;
      if (halts === 'pass') passHalts(world);
      else throw new Error(`runCollect(): the world is waiting on a "${currentHalt(world).kind}" decision at tick ${world.tick}`);
    }
    if (!stepWorld(world, frame)) break;
    for (const e of eventsOf(world, type)) got.push({ ...e, tick: world.tick - 1 });
  }
  return got;
}

export { DATA };
