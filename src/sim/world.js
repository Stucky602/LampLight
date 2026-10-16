// The world: one run's whole state, and the fixed tick order (ARCHITECTURE §5.5).
//
//   1  read this tick's InputFrame         8  contact damage to the player
//   2  player movement and dash            9  deaths resolve (drops, hooks, kill counts)
//   3  weapons fire                        10 gems and pickups
//   4  projectiles move                    11 level-up check (queues drafts)
//   5  projectile hits                     12 director spawns
//   6  zones tick                          13 events are in the buffer for render and audio
//   7  enemies act
//
// Same build + same RunConfig (seed included) + same input frames + same decisions = the same
// run, bit for bit, in any JavaScript engine (lib/fmath.js, lib/rng.js). Decisions are the
// choices the player makes while the sim is halted: draft cards, chest reels, rune sockets,
// staying for overtime, and leaving. They're logged with their tick for replays.

import { CAP, HIT_SLOTS, RELIC_SLOT, DEFAULT_WEAPON_SLOTS, MAX_WEAPON_SLOTS, HIT_RING } from './constants.js';
import { createPool, NO_HANDLE } from './pools.js';
import { createSpatialHash } from './spatial.js';
import { createTerrain, buildMap, TILE } from './terrain.js';
import { createFlowField } from './flowfield.js';
import { createEventBuffer } from './events.js';
import { createRng } from '../lib/rng.js';
import { createStateHash, fnv1a } from '../lib/hash.js';
import { createPlayer, playerStep, levelCheck, xpToNext } from './player.js';
import { ENEMY_FIELDS, enemiesAct, contactStep, resolveDeaths, removeDead, impulse, impulseR, midAttack } from './enemies.js';
import { PROJ_FIELDS, ZONE_FIELDS, weaponsFire, moveProjectiles, projectileHits, zonesTick, explodeAt, groundAt, compileList } from './weapons.js';
import { GEM_FIELDS, PICKUP_FIELDS, pickupsStep } from './pickups.js';
import { createDirector, directorStep, overtimeDecide } from './director.js';
import { makeOffer, draftDecide } from './draft.js';
import { runeDecide, evolveOne } from './chests.js';
import { createHookLists, runHooks, api as hookApi } from './hooks.js';
import { setupCharacter, rebuildStats, markStatsDirty, addRelic } from './build.js';
import { checkModifier } from './stats.js';
import { checkBossDef } from './bosses.js';
import { ascensionLines, ascendDecide, emberDecide, canAscend } from './ascend.js';
import { createResultState, buildRunResult, leaveRun } from './run-result.js';
import { tuneDecide, devDecide } from './dev.js';

export const DEFAULT_CONFIG = Object.freeze({
  seed: 1,
  map: 'drowned_docks',
  mode: 'standard',        // 'standard' | 'short'
  character: 'lamplighter',
});

// Hooks reach the sim through these (set once; the functions are pure over the world).
hookApi.explodeAt = explodeAt;
hookApi.groundAt = groundAt;
hookApi.compileList = compileList;
hookApi.evolveOne = evolveOne;
hookApi.markStatsDirty = markStatsDirty;
hookApi.impulse = impulse;
hookApi.impulseR = impulseR;
hookApi.queryEnemies = (world, x, y, r, out) => world.enemyHash.query(x, y, r, out, -1);
hookApi.midAttack = midAttack;

function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

/**
 * Tuning with overrides applied (deep, by name). A name the tuning doesn't have, a value of the
 * wrong shape, or a number that isn't finite is reported in `unknown`, never silently added.
 */
export function mergeTuning(base, overrides, path = '', unknown = []) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  if (!overrides) return out;
  for (const [k, v] of Object.entries(overrides)) {
    const here = path ? `${path}.${k}` : k;
    const b = base[k];
    if (!(k in base)) { unknown.push(here); continue; }
    if (isObj(b)) {
      if (isObj(v)) out[k] = mergeTuning(b, v, here, unknown);
      else unknown.push(`${here} (should be a group of values)`);
    } else if (Array.isArray(b)) {
      if (Array.isArray(v) && v.flat(2).every(Number.isFinite)) out[k] = v;
      else unknown.push(`${here} (should be a list of numbers)`);
    } else if (typeof b === 'number') {
      if (Number.isFinite(v)) out[k] = v;
      else unknown.push(`${here} (should be a number)`);
    } else if (typeof v === typeof b) out[k] = v;
    else unknown.push(`${here} (wrong type)`);
  }
  return out;
}

const MODES = new Set(['standard', 'short']);
const NO_INPUT = Object.freeze({ mx: 0, my: 0, buttons: 0 });

const POOL_KINDS = ['weapons', 'passives', 'relics', 'runes'];

/** Throws a plain message for a RunConfig the sim can't run. */
function checkConfig(cfg) {
  if (!MODES.has(cfg.mode)) throw new Error(`RunConfig: unknown mode "${cfg.mode}" (standard or short)`);
  if (cfg.weaponSlots !== undefined && !(Number.isInteger(cfg.weaponSlots) && cfg.weaponSlots >= 1 && cfg.weaponSlots <= MAX_WEAPON_SLOTS)) {
    throw new Error(`RunConfig: weaponSlots must be a whole number from 1 to ${MAX_WEAPON_SLOTS}`);
  }
  for (const [k, v] of Object.entries(cfg.charges || {})) {
    if (!['reroll', 'banish', 'skip'].includes(k) || !(Number.isInteger(v) && v >= 0)) throw new Error(`RunConfig: charges.${k} must be a whole number of reroll, banish, or skip charges`);
  }
  if (cfg.mods !== undefined && !Array.isArray(cfg.mods)) throw new Error('RunConfig: mods must be a list of stat modifiers');
  for (const m of cfg.mods || []) {
    const bad = checkModifier(m);
    if (bad) throw new Error(`RunConfig mods: ${bad} in ${JSON.stringify(m)}`);
  }
  if (cfg.pools !== undefined) {
    if (cfg.pools === null || typeof cfg.pools !== 'object' || Array.isArray(cfg.pools)) throw new Error('RunConfig: pools must be { weapons, passives, relics, runes }, each a list of ids');
    for (const [k, v] of Object.entries(cfg.pools)) {
      if (!POOL_KINDS.includes(k)) throw new Error(`RunConfig pools: there is no "${k}" pool (${POOL_KINDS.join(', ')})`);
      if (!Array.isArray(v)) throw new Error(`RunConfig pools.${k} must be a list of ids`);
      // A duplicate would weigh that card double in the draft.
      const seen = new Set();
      for (const id of v) { if (seen.has(id)) throw new Error(`RunConfig pools.${k}: "${id}" is listed twice`); seen.add(id); }
    }
    // All four or none: a pool left out would quietly be everything, locked content included.
    const missing = POOL_KINDS.filter((k) => !(k in cfg.pools));
    if (missing.length) throw new Error(`RunConfig pools: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} missing (give all four lists, or no pools for everything)`);
  }
  for (const k of ['hpMul', 'densityMul', 'rewardMul']) {
    if (cfg[k] !== undefined && !(Number.isFinite(cfg[k]) && cfg[k] > 0)) throw new Error(`RunConfig: ${k} must be a number above 0`);
  }
  if (cfg.densityCap !== undefined && !(Number.isFinite(cfg.densityCap) && cfg.densityCap >= 0)) throw new Error('RunConfig: densityCap must be a number, 0 or more');
  if (cfg.draftCards !== undefined && !(Number.isInteger(cfg.draftCards) && cfg.draftCards >= 1 && cfg.draftCards <= 6)) throw new Error('RunConfig: draftCards must be a whole number from 1 to 6');
  if (cfg.evolutionPassiveReduction !== undefined && !(Number.isInteger(cfg.evolutionPassiveReduction) && cfg.evolutionPassiveReduction >= 0)) throw new Error('RunConfig: evolutionPassiveReduction must be a whole number, 0 or more');
}

/**
 * With no pools in the RunConfig (tests, the bots, the soak), a run draws from all the content
 * there is; the game passes the player's own pools (meta/runconfig.js runConfigFor), which is
 * what research and the harbor's buildings add to.
 */
function fullPool(list) { return list.filter((x) => x.unlock !== 'evolution' && x.unlock !== 'innate' && !x.innate); }

/**
 * A new run.
 * @param {object} config RunConfig: seed, map, mode, character, and optionally pools (resolved
 *   content ids from meta), mods (hub, gear, Tide), relics (starting), charges, draftCards,
 *   weaponSlots, evolutionPassiveReduction (gear: evolutions need that many fewer partner
 *   levels), tuning (overrides), densityMul, densityCap, hpMul, rewardMul, invulnerable (tests
 *   and the soak only).
 * @param {object} data the content bundle from src/data/index.js
 */
export function createWorld(config, data) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  // A RunConfig comes from meta and the hub, outside the content test: check it here.
  checkConfig(cfg);
  const unknownTuning = [];
  const tuning = mergeTuning(data.tuning, cfg.tuning, '', unknownTuning);
  if (!(tuning.caps.weapon.maxPierce <= HIT_RING)) unknownTuning.push(`caps.weapon.maxPierce (at most ${HIT_RING}, what a shot can remember)`);
  if (unknownTuning.length) throw new Error(`RunConfig tuning: ${unknownTuning.join(', ')}`);
  const map = data.maps.find((m) => m.id === cfg.map);
  if (!map) throw new Error(`Unknown map "${cfg.map}"`);
  const character = data.characters.find((c) => c.id === cfg.character);
  if (!character) throw new Error(`Unknown character "${cfg.character}"`);

  // Boss attack data is checked here, at 0:00, not when a boss first attacks at 10:00.
  const enemyIds = new Set(data.enemies.map((x) => x.id));
  for (const b of data.bosses) { const bad = checkBossDef(b, tuning, enemyIds); if (bad) throw new Error(bad); }
  const root = createRng(cfg.seed);
  const [cols, rows] = map.size;
  const ground = buildMap(map.layout, cols, rows);
  const terrain = createTerrain({ cols, rows, solid: ground.solid, kinds: ground.kinds });

  const byId = (list) => new Map(list.map((x, i) => [x.id, i]));
  const pick = (ids, list, kind) => ids.map((id) => {
    const d = list.find((x) => x.id === id);
    if (!d) throw new Error(`RunConfig pools: unknown ${kind} "${id}"`);
    // An evolution comes from evolving, and a character's own weapon comes with the character.
    if (!fullPool([d]).length) throw new Error(`RunConfig pools: the ${kind} "${id}" is never drawn (it comes from ${d.unlock === 'evolution' ? 'an evolution' : 'its character'})`);
    return d;
  });
  const pools = {
    weapons: cfg.pools?.weapons ? pick(cfg.pools.weapons, data.weapons, 'weapon') : fullPool(data.weapons),
    passives: cfg.pools?.passives ? pick(cfg.pools.passives, data.passives, 'passive') : fullPool(data.passives),
    relics: cfg.pools?.relics ? pick(cfg.pools.relics, data.relics, 'relic') : fullPool(data.relics),
    runes: cfg.pools?.runes ? pick(cfg.pools.runes, data.runes, 'rune') : fullPool(data.runes),
  };

  const world = {
    config: cfg, tuning, unknownTuning, data, map, character,
    tick: 0,
    rng: {
      root,
      spawn: root.fork('spawn'), combat: root.fork('combat'), draft: root.fork('draft'),
      loot: root.fork('loot'), boss: root.fork('boss'),
    },
    terrain,
    flow: createFlowField(terrain),
    bigFlow: createFlowField(terrain, { dilate: 1 }), // for bodies wider than a tile
    enemies: createPool(CAP.enemies, ENEMY_FIELDS),
    projectiles: createPool(CAP.projectiles, PROJ_FIELDS),
    gems: createPool(CAP.gems, GEM_FIELDS),
    zones: createPool(CAP.zones, ZONE_FIELDS),
    pickups: createPool(CAP.pickups, PICKUP_FIELDS),
    enemyHash: createSpatialHash({ capacity: CAP.enemies, cell: 16, cols: 128, rows: 128 }),
    events: createEventBuffer(8192, 1024),
    eventsPerTick: true,   // headless: clear each tick. The game sets false and drains per frame.
    enemyDefs: data.enemies, enemyIndex: byId(data.enemies),
    weaponDefs: data.weapons, weaponIndex: byId(data.weapons),
    passiveDefs: data.passives, relicDefs: data.relics, runeDefs: data.runes,
    materialDefs: data.materials, materialIndex: byId(data.materials),
    bossDefs: new Map(data.bosses.map((b) => [b.id, b])),
    pools,
    player: createPlayer((cols * TILE) / 2, (rows * TILE) / 2),
    slots: new Array(HIT_SLOTS).fill(null),
    build: {
      weaponSlots: DEFAULT_WEAPON_SLOTS,
      passives: [],
      relics: [],
      banished: new Set(),
      evolvedFrom: new Set(),
      embers: 0,           // Embers kept, not yet spent (sim/ascend.js)
    },
    ascensionLines: ascensionLines(data),
    mods: [],
    stats: null,
    statsDirty: true,
    charges: { reroll: 0, banish: 0, skip: 0 },
    hooks: createHookLists(),
    hookEntries: [],       // every hook added, in order (the state hash walks their state)
    fxLists: [], fxListIndex: new Map(),
    bosses: [],
    director: null,
    halts: [],
    decisions: [],
    over: null,
    killXpMul: 1,
    knockbackPulls: false, // the Harpooner's weapons pull instead of push (set by her hook)
    god: false,            // dev god mode (a logged dev decision; tests and the soak use config.invulnerable)
    magnetAll: 0,
    mergeGem: NO_HANDLE,
    pull: { x: 0, y: 0, speed: 0, ticks: 0, boss: -1 }, // a boss's lure drawing the player in (bosses.js; boss = its handle)
    result: createResultState(data.enemies.length, data.materials.length),
    // The map's secret caches (map.secrets), in pixels; each opens once a run.
    secrets: (map.secrets || []).map((m) => ({
      id: m.id, relic: m.relic, x: (m.at[0] + 0.5) * TILE, y: (m.at[1] + 0.5) * TILE, radius: m.radius, open: false,
    })),
    // Scratch buffers and typed-array registers. Hot loops pass fractional numbers through
    // registers instead of call arguments (a call V8 doesn't inline boxes each one: §17).
    // Each register array has one owner: reg (enemiesAct), qreg (shot and zone hit passes),
    // hit (applyHit's inputs), num (damageEnemyR [0], impulseR [1..3]), xreg (explodeR),
    // shot (spawnShot's position, direction, and speed).
    scratch: {
      v2: new Float64Array(2), sc: new Float64Array(2), dir: new Float64Array(3),
      reg: new Float64Array(4), qreg: new Float64Array(4), hit: new Float64Array(8),
      num: new Float64Array(4), xreg: new Float64Array(8), shot: new Float64Array(5),
      near: new Int32Array(CAP.enemies), push: new Int32Array(CAP.enemies), blast: new Int32Array(CAP.enemies),
      hits: new Int32Array(1024), sep: new Int32Array(16),
    },
  };
  world.director = createDirector(world);
  setupCharacter(world);
  rebuildStats(world);
  const p = world.player;
  p.hp = world.stats.maxHp;
  p.revivals = world.stats.revival;
  p.xpNext = xpToNext(tuning, 1);
  world.charges = {
    reroll: world.stats.reroll + (cfg.charges?.reroll ?? 0),
    banish: world.stats.banish + (cfg.charges?.banish ?? 0),
    skip: world.stats.skip + (cfg.charges?.skip ?? 0),
  };
  if (cfg.weaponSlots) world.build.weaponSlots = cfg.weaponSlots;
  for (const id of cfg.relics || []) {
    const r = data.relics.find((x) => x.id === id);
    if (!r) throw new Error(`RunConfig relics: unknown relic "${id}"`);
    addRelic(world, r);
  }
  rebuildStats(world);
  // Start on open ground: the nearest open tile to the middle of the map.
  if (terrain.blockedAt(p.x, p.y)) {
    const t0x = Math.floor(p.x / TILE), t0y = Math.floor(p.y / TILE);
    let found = false;
    for (let r = 1; r < Math.max(cols, rows) && !found; r++) {
      for (let dy = -r; dy <= r && !found; dy++) {
        for (let dx = -r; dx <= r && !found; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || terrain.blocked(t0x + dx, t0y + dy)) continue;
          p.x = p.px = (t0x + dx + 0.5) * TILE; p.y = p.py = (t0y + dy + 0.5) * TILE;
          found = true;
        }
      }
    }
    if (!found) throw new Error(`Map ${map.id}: no open ground to start on`);
  }
  world.enemyHash.build(0, world.enemies.x, world.enemies.y, world.enemies.radius, 0, 0);
  return world;
}

function buildHash(world) {
  const E = world.enemies, h = world.enemyHash, p = world.player;
  const ox = Math.floor((p.x - (h.cols * h.cell) / 2) / h.cell) * h.cell;
  const oy = Math.floor((p.y - (h.rows * h.cell) / 2) / h.cell) * h.cell;
  h.build(E.count, E.x, E.y, E.radius, ox, oy);
}

function queueDraft(world) {
  if (!world.over) world.halts.push({ kind: 'draft', offer: null });
}

/** Get the current halt ready for the player (a draft's cards are drawn when it's shown). */
function prepareHalt(world) {
  // An Ember's choice queued behind another (two picked up on one tick) with nothing left to
  // take: the Ember stays kept, and no empty screen opens.
  while (world.halts[0]?.kind === 'ascend' && !canAscend(world)) world.halts.shift();
  const h = world.halts[0];
  if (h && h.kind === 'draft' && h.offer === null) h.offer = makeOffer(world);
}

/**
 * Advance one tick with this tick's InputFrame ({ mx, my, buttons }). Does nothing (returns
 * false) while the run is over or halted for a decision.
 */
export function stepWorld(world, frame) {
  if (world.over || world.halts.length > 0) return false;
  if (frame === null || typeof frame !== 'object') frame = NO_INPUT; // a missing frame is no input
  if (world.eventsPerTick) world.events.clear();
  rebuildStats(world);
  playerStep(world, frame);                       // 1-2
  world.flow.update(world.player.x, world.player.y);
  world.bigFlow.update(world.player.x, world.player.y);
  buildHash(world);
  runHooks(world, 'onTick');
  weaponsFire(world);                             // 3
  moveProjectiles(world);                         // 4
  projectileHits(world);                          // 5
  zonesTick(world);                               // 6
  enemiesAct(world);                              // 7
  buildHash(world);
  contactStep(world);                             // 8
  resolveDeaths(world);                           // 9
  pickupsStep(world);                             // 10
  resolveDeaths(world);                           // 9 again: kills made in step 10 (a relic's gem blast)
  levelCheck(world, queueDraft);                  // 11
  if (!world.over) directorStep(world);           // 12
  removeDead(world);
  world.tick++;                                   // 13: the tick's events are in world.events
  if (!world.over) prepareHalt(world);
  return true;
}

/** The decision the sim is waiting for, or null. */
export function currentHalt(world) {
  return world.over ? null : (world.halts[0] || null);
}

/**
 * Make a decision. For the current halt:
 *   draft:    { kind: 'pick', index } | { kind: 'reroll' } | { kind: 'banish', index } | { kind: 'skip' }
 *   chest:    { kind: 'ok' }
 *   rune:     { kind: 'place', slot } | { kind: 'discard' }
 *   overtime: { kind: 'stay' } | { kind: 'leave' }
 *   ascend:   { kind: 'ascend', slot, id } | { kind: 'keep' } (an Ember: sim/ascend.js)
 * With nothing waiting: { kind: 'ember' } spends a kept Ember (the pause menu's Ascend: the run
 * stops for the choice).
 * At any time: { kind: 'leave' } (the pause menu), { kind: 'tune', path, value } (the tuning
 * panel), and { kind: 'dev', cmd, ... } (dev commands; sim/dev.js). Every decision is logged
 * for replays. A tune or dev decision returns what it did (dev: a count); the others return
 * nothing.
 */
export function decide(world, d) {
  if (world.over) throw new Error('The run is over.');
  if (d === null || typeof d !== 'object') throw new Error('decide needs a decision object');
  const h = world.halts[0] || null;
  const entry = { tick: world.tick, halt: h ? h.kind : null, ...d };
  if (d.kind === 'tune' || d.kind === 'dev') {
    // Checked before logging: a refused change leaves no trace for a replay to trip on.
    const out = d.kind === 'tune' ? tuneDecide(world, d) : devDecide(world, d);
    world.decisions.push(entry);
    rebuildStats(world);
    if (!world.over) prepareHalt(world);
    return out;
  }
  if (d.kind === 'ember') {
    if (h) throw new Error(`ember: a kept Ember is spent with nothing else waiting (the ${h.kind} is open)`);
    emberDecide(world);   // checked first: a refused one leaves no trace
    world.decisions.push(entry);
    return;
  }
  if (d.kind === 'leave' && (!h || h.kind !== 'overtime')) {
    world.decisions.push(entry);
    leaveRun(world);
    return;
  }
  if (!h) throw new Error(`Nothing to decide right now (got "${d.kind}").`);
  let done;
  switch (h.kind) {
    case 'draft': done = draftDecide(world, h, d); break;
    case 'chest':
      if (d.kind !== 'ok') throw new Error(`chest: expected "ok", got "${d.kind}"`);
      done = true;
      break;
    case 'rune': done = runeDecide(world, h, d); break;
    case 'overtime': done = overtimeDecide(world, d); break;
    case 'ascend': done = ascendDecide(world, d); break;
    default: throw new Error(`Unknown halt "${h.kind}"`);
  }
  world.decisions.push(entry);
  if (world.over) return;
  if (done) world.halts.shift();
  rebuildStats(world);
  prepareHalt(world);
}

/** A hash of everything that decides the future of the run (determinism tests and replays). */
export function hashWorld(world) {
  const h = createStateHash();
  const p = world.player;
  h.int(world.tick);
  for (const v of [p.x, p.y, p.fx, p.fy, p.hp, p.shield, p.xp, p.xpNext, p.dashCd, p.dashSpeed, p.dashDx, p.dashDy, p.bonusArmor]) h.float64(v);
  for (const v of [p.level, p.dashTicks, p.iframes, p.prevButtons, p.revivals]) h.int(v);
  for (const k of ['root', 'spawn', 'combat', 'draft', 'loot', 'boss']) for (const v of world.rng[k].getState()) h.int(v);
  world.enemies.hashInto(h);
  world.projectiles.hashInto(h);
  world.gems.hashInto(h);
  world.zones.hashInto(h);
  world.pickups.hashInto(h);
  for (let s = 0; s < world.slots.length; s++) {
    const slot = world.slots[s];
    if (!slot || s === RELIC_SLOT) { h.int(-1); continue; }
    h.int(slot.defIndex ?? -1).int(slot.level).int(slot.burst).int(slot.volley).int(slot.fired).int(slot.lastZoneTicks[0]);
    for (let z = 1; z < slot.lastZoneTicks.length; z++) if (slot.lastZoneTicks[z] !== -1e9) h.int(slot.lastZoneTicks[z]); // a second ground's pace, when there is one
    h.float64(slot.cd).float64(slot.burstT).float64(slot.angle).float64(slot.aimX).float64(slot.aimY).int(slot.auraHandle);
    h.array(slot.volleyTargets);
    for (const r of slot.runes) h.int(r ? world.runeDefs.indexOf(r) : -1);
  }
  // Boss state machines and every hook's own state.
  for (const b of world.bosses) {
    h.int(b.handle).int(b.alive ? 1 : 0).int(b.phase).int(b.next).int(b.state).int(b.hitPlayer ? 1 : 0);
    for (const v of [b.timer, b.ax, b.ay, b.adx, b.ady, b.chargeLeft]) h.float64(v);
  }
  for (const e of world.hookEntries) {
    h.int(fnv1a(e.id));
    for (const k of Object.keys(e.state).sort()) h.int(fnv1a(k)).float64(e.state[k]);
  }
  for (const ps of world.build.passives) h.int(world.passiveDefs.indexOf(ps.def)).int(ps.level);
  for (const r of world.build.relics) h.int(world.relicDefs.indexOf(r));
  h.int(world.build.weaponSlots);
  for (const k of [...world.build.banished].sort()) h.int(fnv1a(k));
  h.int(-2);
  for (const id of [...world.build.evolvedFrom].sort()) h.int(fnv1a(id));
  h.int(world.charges.reroll).int(world.charges.banish).int(world.charges.skip);
  const d = world.director;
  h.int(d.eventIdx).int(d.band).int(d.regularAlive).int(d.bossesAlive).int(d.overtimeMinutes);
  h.int(d.overtime ? 1 : 0).int(d.overtimeStartTick).int(d.finalBossDead ? 1 : 0);
  for (const v of [d.hpMul, d.contactMul, d.target, d.otDensity, d.otHp, d.materialMul]) h.float64(v);
  h.array(world.result.killsByType).array(world.result.materialsRaw).array(world.result.damageBySlot);
  h.float64(world.magnetAll).int(world.mergeGem).int(world.halts.length).int(world.god ? 1 : 0);
  for (const s of world.secrets) h.int(s.open ? 1 : 0); // nothing on a map without secrets
  if (world.build.embers > 0) h.int(-3).int(world.build.embers);
  for (let s = 0; s < world.slots.length; s++) { const sl = world.slots[s]; if (sl && sl.ascensions && sl.ascensions.length) { h.int(-4).int(s); for (const a of sl.ascensions) h.int(fnv1a(a.id)); } }
  if (world.pull.ticks > 0) h.int(world.pull.ticks).int(world.pull.boss).float64(world.pull.x).float64(world.pull.y).float64(world.pull.speed);
  return h.hex();
}

export { buildRunResult };
