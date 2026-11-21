// Small worlds for sim tests: an open test field with nothing spawning on its own, a test
// character with no weapons, and helpers to place enemies and give weapons.

import { DATA } from '../../src/data/index.js';
import { createWorld, stepWorld, decide, currentHalt } from '../../src/sim/world.js';
import { spawnEnemy } from '../../src/sim/enemies.js';
import { buildSlot } from '../../src/sim/weapons.js';
import { markStatsDirty, rebuildStats } from '../../src/sim/build.js';

export const IDLE = Object.freeze({ mx: 0, my: 0, buttons: 0 });

/**
 * A test bolt: the Fulgurite's numbers as they were (a glass bolt at the nearest enemy that hops to 3
 * more), kept for the chain and burning-ground tests after the Fulgurite folded into the Lightning
 * Rod (ruling 18 WD). Give it with makeWorld(config, { extraWeapons: [TEST_BOLT] }).
 */
export const TEST_BOLT = {
  id: 'test_bolt', name: 'Test Bolt', desc: 'For tests.', tags: ['light'], sprite: 'proj_glass_shard', icon: 'icon_lightning_rod', unlock: 'starter', weight: 0,
  base: { damage: 16, cooldown: 1.6, amount: 1, duration: 1, pierce: 1, knockback: 0.2, radius: 4, interval: 0.15 },
  numbers: ['damage', 'cooldown', 'amount', 'crit'],
  lines: [{ id: 'hot_sand', name: 'Burning Ground', shared: 'burning_ground', rarity: 'rare', desc: 'Hits leave burning ground.', boost: { onHit: [{ type: 'zone', radius: 14, duration: 2.5, damageMul: 0.15, interval: 0.4, every: 0.3, status: { status: 'burn', dpsMul: 1, duration: 1.2 } }] } }],
  specials: [],
  pipeline: { emit: { type: 'nearest', range: 320 }, motion: { type: 'linear', speed: 420 }, onHit: [{ type: 'damage' }, { type: 'chain', hops: 3, range: 90, damageMul: 0.75 }, { type: 'light', radius: 20, ms: 120 }] },
};

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

/**
 * Every pace dial (data/tuning.js pace) where it was before the dials (0.8.0): a test of a
 * mechanic reads its numbers as the data gives them. tests/pace.test.js checks the dials.
 */
export const NEUTRAL_PACE = Object.freeze({ density: 1, maxAlive: 3000, speed: 1, hp: 1, contact: 1, xp: 1, drops: 1, events: 1 });

/**
 * 0.9.0 (W3): the test field's elites come plain (no affixes, sim/affixes.js) and the threat that
 * follows your power stays at 1 (sim/threat.js), so a mechanic's test reads its own numbers; a test
 * of those turns them back on in its config's tuning.
 */
export const NEUTRAL_COMBAT = Object.freeze({ affixes: Object.freeze({ perElite: 0, twoFromTide: 99 }), threat: Object.freeze({ max: 1 }) });

/**
 * A boss (a world.bosses record) past its 15 s floor and every phase gate (0.9.0, ruling 5), for a
 * test that needs one hit to kill it: its last phase, with that phase's signature thrown. (The
 * boss's next turn puts its phase back where its health says.)
 */
export function pastGates(b) {
  b.spawnTick -= b.minFightTicks;
  b.phase = b.def.phases.length - 1;
  b.sigDone = true;
}

/** A config's tuning with the pace dials neutral (and NEUTRAL_COMBAT), under whatever the config itself sets. */
export function neutralPace(config = {}) {
  const t = config.tuning || {};
  return {
    ...config,
    tuning: {
      ...t,
      pace: { ...NEUTRAL_PACE, ...(t.pace || {}) },
      affixes: { ...NEUTRAL_COMBAT.affixes, ...(t.affixes || {}) },
      threat: { ...NEUTRAL_COMBAT.threat, ...(t.threat || {}) },
    },
  };
}

/**
 * A world on the test field with the test character (no weapons), unless told otherwise. The
 * test field plays at the neutral pace (NEUTRAL_PACE) unless the config's tuning says otherwise.
 */
export function makeWorld(config = {}, dataOpts = {}) {
  const data = testData(dataOpts);
  return createWorld(neutralPace({ seed: 1, map: 'test_field', character: 'tester', ...config }), data);
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

/** The level the old weapon tables topped out at (8): what a test means by a well-levelled weapon (ruling 10: no max now). */
export const TOP = 8;

/** A test's level-ups, in order (no roll): about what the old level tables gave, each skipped where the weapon's pool lacks it. */
const LADDER = ['amount', 'damage', 'cooldown', 'damage', 'amount', 'pierce', 'damage', 'area'];

/** The first n upgrades of the ladder a weapon can take (Common values; a count or pierce +1, Rare). Ruling 14: no early boost. */
export function ladderUps(world, def, n) {
  const T = world.tuning.weaponUps, out = [];
  const pool = LADDER.filter((u) => (def.numbers || []).includes(u));
  for (let k = 0; k < n && pool.length; k++) {
    const up = pool[k % pool.length];
    const whole = up === 'amount' || up === 'pierce';
    out.push({ up, rarity: whole ? 'rare' : 'common', value: T.value[up] });
  }
  return out;
}

/**
 * Put a weapon (by id) in a slot at a level and rebuild stats. Ruling 14 (C1): level N is N - 1
 * upgrades; without `ups` they are the ladder above (deterministic, no roll), else `ups`
 * ([{ up, rarity, value }], the level from their count). `forms`: Form option ids it holds (one
 * an axis), `lines` and `specials`: ids of its own it holds. A retired evolution's id gives its
 * base weapon at TOP with its capstone.
 */
export function give(world, id, { slot = null, level = 1, ups = null, forms = [], lines = [], specials = [] } = {}) {
  // A retired evolution (0.9.0) is its base weapon at level 8 with its capstone Form.
  const old = world.data.retiredWeapons?.[id];
  const def = world.weaponDefs[world.weaponIndex.get(old ? old.weapon : id)];
  if (!def) throw new Error(`no weapon ${id}`);
  let s = slot;
  if (s === null) { s = 0; while (world.slots[s]) s++; }
  const line = world.ascensionLines.get(def.id);
  const opts = [...(old ? [old.form] : []), ...forms].map((fid) => { const o = line?.options.find((x) => x.id === fid); if (!o) throw new Error(`${def.id} has no option ${fid}`); return o; });
  const n = Math.max(0, (old ? TOP : (Number.isFinite(level) ? level : TOP)) - 1);
  const list = def.innate || !(def.numbers || []).length ? [] : ups ?? ladderUps(world, def, n);
  const fresh = buildSlot(world, s, def, 1, null);
  const bits = opts.reduce((m, o) => m | ({ delivery: 1, flight: 2, payoff: 4 }[o.axis] ?? 0), 0);
  world.slots[s] = buildSlot(world, s, def, 1 + list.length, null, { ...fresh, ups: list, ascensions: opts, axes: (fresh.axes ?? 0) | bits, lines: [...lines], specials: [...specials] });
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
 * chest, keeps the Form choice), so a test can never pass on a world that quietly stopped moving.
 */
/** Answer every pending halt, changing the build as little as can be: skip, ok, discard, the first relic, done, keep, the bell's first pick, stay. */
function passHalts(world) {
  while (currentHalt(world)) {
    const h = currentHalt(world);
    if (h.kind === 'draft') { world.charges.skip = Math.max(1, world.charges.skip); decide(world, { kind: 'skip' }); }
    else if (h.kind === 'chest') decide(world, { kind: 'ok' });
    else if (h.kind === 'relic') decide(world, { kind: 'pick', index: 0 });
    else if (h.kind === 'ferry') decide(world, { kind: 'done' });
    else if (h.kind === 'ascend') decide(world, { kind: 'keep' });
    else if (h.kind === 'well') decide(world, { kind: 'keep' });
    else if (h.kind === 'bellpick') decide(world, { kind: 'pick', index: 0 });
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

/** Answer every pending halt with a simple policy: first card, ok, keep, leave. */
export function autoDecide(world) {
  let g = 0;
  while (currentHalt(world) && g++ < 100) {
    const h = currentHalt(world);
    if (h.kind === 'draft') decide(world, { kind: 'pick', index: 0 });
    else if (h.kind === 'chest') decide(world, { kind: 'ok' });
    else if (h.kind === 'ascend') decide(world, { kind: 'keep' });
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
