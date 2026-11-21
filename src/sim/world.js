// The world: one run's whole state, and the fixed tick order (ARCHITECTURE §5.5).
//
//   1  read this tick's InputFrame         8  contact damage to the player
//   2  player movement and dash            9  deaths resolve (drops, hooks, kill counts)
//   3  weapons fire                        10 gems and pickups, then the run's tasks and the Ferryman
//   4  projectiles move                    11 level-up check (queues drafts)
//   5  projectile hits                     12 director spawns
//   6  zones tick                          13 events are in the buffer for render and audio
//   7  enemies act
//
// Same build + same RunConfig (seed included) + same input frames + same decisions = the same
// run, bit for bit, in any JavaScript engine (lib/fmath.js, lib/rng.js). Decisions are the
// choices the player makes while the sim is halted: draft cards, chest reels, Forms, relics, the
// Ferryman, the Salt Well, the Fog Bell's pick, staying for overtime, and leaving. They're logged with their tick for replays.

import { UP_INDEX } from './weaponups.js';
import { CAP, HIT_SLOTS, RELIC_SLOT, DEFAULT_WEAPON_SLOTS, MAX_WEAPON_SLOTS, HIT_RING, DEFAULT_PASSIVE_SLOTS, DEFAULT_RELIC_SLOTS, MAX_PASSIVE_SLOTS, MAX_RELIC_SLOTS } from './constants.js';
import { createPool, NO_HANDLE } from './pools.js';
import { createSpatialHash } from './spatial.js';
import { createTerrain, buildMap, TILE } from './terrain.js';
import { createFlowField } from './flowfield.js';
import { createEventBuffer } from './events.js';
import { createRng } from '../lib/rng.js';
import { createStateHash, fnv1a } from '../lib/hash.js';
import { createPlayer, playerStep, stanceStep, levelCheck, xpToNext, heal } from './player.js';
import { setDash, dashDefOf, dashGround, DASH_UPS } from './dash.js';
import { ENEMY_FIELDS, enemiesAct, contactStep, resolveDeaths, removeDead, impulse, impulseR, midAttack, damageEnemyR, throwLeeches, setExplode, setRotPatch } from './enemies.js';
import { PROJ_FIELDS, ZONE_FIELDS, weaponsFire, moveProjectiles, projectileHits, zonesTick, explodeAt, explodeR, groundAt, compileList } from './weapons.js';
import { SWIMS, EF_GONE, ZSTYLE } from './constants.js';
import { createMarsh, marshStep, hashMarsh } from './marsh.js';
import { createStorm, stormStep, hashStorm } from './storm.js';
import { createWell, wellStep, wellDecide, hashWell } from './well.js';
import { createAllies, hashAllies } from './allies.js';
import { LAYERS } from './director.js';
import { GEM_FIELDS, PICKUP_FIELDS, pickupsStep } from './pickups.js';
import { createDirector, directorStep, overtimeDecide, tideRulesFor } from './director.js';
import { makeOffer, draftDecide, draftIsDry, levelGift } from './draft.js';
import { evolveOne, bellPickDecide } from './chests.js';
import { createHookLists, runHooks, api as hookApi } from './hooks.js';
import { setupCharacter, rebuildStats, markStatsDirty, addRelic } from './build.js';
import { checkModifier } from './stats.js';
import { checkBossDef } from './bosses.js';
import { ascensionLines, ascendDecide, emberDecide, ascendLive, collectEmber, formsStep, giveUpgrade } from './ascend.js';
import { linesOpen } from './weaponups.js';
import { createResultState, buildRunResult, leaveRun } from './run-result.js';
import { tuneDecide, devDecide } from './dev.js';
import { createTasks, tasksStep, hashTasks } from './tasks.js';
import { createFerry, ferryStep, ferryDecide, prepareRelicPick, relicDecide, addGlass } from './relics.js';
import { addHook } from './hooks.js';
import { createCombatState, hashCombat } from './threat.js';

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
hookApi.collectEmber = collectEmber;
hookApi.markStatsDirty = markStatsDirty;
hookApi.impulse = impulse;
hookApi.impulseR = impulseR;
hookApi.queryEnemies = (world, x, y, r, out) => world.enemyHash.query(x, y, r, out, -1);
hookApi.midAttack = midAttack;
hookApi.heal = heal;
hookApi.damageEnemyR = damageEnemyR;
setExplode(explodeR);
setRotPatch((world, x, y) => {
  if (!world.rotList) world.rotList = compileList(world, [{ type: 'status', status: 'rot', duration: 1.5, amp: 0.25 }]);
  const g = groundAt(world, RELIC_SLOT, x, y, 20, 2, 0, 0.5, world.rotList);
  if (g >= 0) world.zones.style[g] = ZSTYLE.ROT;
});

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

const POOL_KINDS = ['weapons', 'passives', 'relics'];

/** Throws a plain message for a RunConfig the sim can't run. */
function checkConfig(cfg) {
  if (!MODES.has(cfg.mode)) throw new Error(`RunConfig: unknown mode "${cfg.mode}" (standard or short)`);
  if (cfg.weaponSlots !== undefined && !(Number.isInteger(cfg.weaponSlots) && cfg.weaponSlots >= 1 && cfg.weaponSlots <= MAX_WEAPON_SLOTS)) {
    throw new Error(`RunConfig: weaponSlots must be a whole number from 1 to ${MAX_WEAPON_SLOTS}`);
  }
  // 0.9.0 (rulings 3 and 4): passive and relic slots grow with the harbor (meta/state.js slotsFor).
  if (cfg.passiveSlots !== undefined && !(Number.isInteger(cfg.passiveSlots) && cfg.passiveSlots >= 1 && cfg.passiveSlots <= MAX_PASSIVE_SLOTS)) {
    throw new Error(`RunConfig: passiveSlots must be a whole number from 1 to ${MAX_PASSIVE_SLOTS}`);
  }
  if (cfg.relicSlots !== undefined && !(Number.isInteger(cfg.relicSlots) && cfg.relicSlots >= 1 && cfg.relicSlots <= MAX_RELIC_SLOTS)) {
    throw new Error(`RunConfig: relicSlots must be a whole number from 1 to ${MAX_RELIC_SLOTS}`);
  }
  // The capstone Forms the profile has opened (meta/state.js resolveContent); left out, all of them.
  if (cfg.forms !== undefined && !(Array.isArray(cfg.forms) && cfg.forms.every((id) => typeof id === 'string'))) throw new Error('RunConfig: forms must be a list of Form ids');
  if (cfg.legendaryEarly !== undefined && !(Array.isArray(cfg.legendaryEarly) && cfg.legendaryEarly.every((id) => typeof id === 'string'))) throw new Error('RunConfig: legendaryEarly must be a list of weapon ids');
  for (const [k, v] of Object.entries(cfg.charges || {})) {
    if (!['reroll', 'banish', 'skip'].includes(k) || !(Number.isInteger(v) && v >= 0)) throw new Error(`RunConfig: charges.${k} must be a whole number of reroll, banish, or skip charges`);
  }
  if (cfg.mods !== undefined && !Array.isArray(cfg.mods)) throw new Error('RunConfig: mods must be a list of stat modifiers');
  for (const m of cfg.mods || []) {
    const bad = checkModifier(m);
    if (bad) throw new Error(`RunConfig mods: ${bad} in ${JSON.stringify(m)}`);
  }
  if (cfg.pools !== undefined) {
    if (cfg.pools === null || typeof cfg.pools !== 'object' || Array.isArray(cfg.pools)) throw new Error('RunConfig: pools must be { weapons, passives, relics }, each a list of ids');
    for (const [k, v] of Object.entries(cfg.pools)) {
      if (k === 'runes') continue;   // (a config from before ruling 14: runes are gone, the list is passed over)
      if (!POOL_KINDS.includes(k)) throw new Error(`RunConfig pools: there is no "${k}" pool (${POOL_KINDS.join(', ')})`);
      if (!Array.isArray(v)) throw new Error(`RunConfig pools.${k} must be a list of ids`);
      // A duplicate would weigh that card double in the draft.
      const seen = new Set();
      for (const id of v) { if (seen.has(id)) throw new Error(`RunConfig pools.${k}: "${id}" is listed twice`); seen.add(id); }
    }
    // All three or none: a pool left out would quietly be everything, locked content included.
    const missing = POOL_KINDS.filter((k) => !(k in cfg.pools));
    if (missing.length) throw new Error(`RunConfig pools: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} missing (give all three lists, or no pools for everything)`);
  }
  for (const k of ['hpMul', 'densityMul', 'rewardMul', 'enemyDamageMul', 'enemySpeedMul']) {
    if (cfg[k] !== undefined && !(Number.isFinite(cfg[k]) && cfg[k] > 0)) throw new Error(`RunConfig: ${k} must be a number above 0`);
  }
  if (cfg.startGlass !== undefined && !(Number.isInteger(cfg.startGlass) && cfg.startGlass >= 0)) throw new Error('RunConfig: startGlass must be a whole number, 0 or more');
  if (cfg.harbor !== undefined) {
    if (!isObj(cfg.harbor)) throw new Error('RunConfig: harbor must be { ferry, lampSpeed, bellRing, tasksOnMap, secretsOnMap, findsOnMap, foodHeal }');
    for (const [k, v] of Object.entries(cfg.harbor)) {
      if (!['ferry', 'lampSpeed', 'bellRing', 'tasksOnMap', 'secretsOnMap', 'findsOnMap', 'foodHeal'].includes(k)) throw new Error(`RunConfig harbor: there is no "${k}" (ferry, lampSpeed, bellRing, tasksOnMap, secretsOnMap, findsOnMap, foodHeal)`);
      if (!(Number.isFinite(v) && v >= 0)) throw new Error(`RunConfig harbor.${k} must be a number, 0 or more`);
    }
  }
  if (cfg.startEmbers !== undefined && !(Number.isInteger(cfg.startEmbers) && cfg.startEmbers >= 0)) throw new Error('RunConfig: startEmbers must be a whole number, 0 or more');
  for (const k of ['heirloom', 'startWeapon', 'challenge', 'dash']) {
    if (cfg[k] !== undefined && cfg[k] !== null && typeof cfg[k] !== 'string') throw new Error(`RunConfig: ${k} must be an id`);
  }
  if (cfg.dashes !== undefined && !(Array.isArray(cfg.dashes) && cfg.dashes.every((id) => typeof id === 'string'))) throw new Error('RunConfig: dashes must be a list of dash item ids');
  if (cfg.bestiaryBonus !== undefined) {
    if (!isObj(cfg.bestiaryBonus)) throw new Error('RunConfig: bestiaryBonus must be { enemyId: share }');
    for (const [k, v] of Object.entries(cfg.bestiaryBonus)) if (!(Number.isFinite(v) && v >= 0 && v <= 1)) throw new Error(`RunConfig bestiaryBonus.${k} must be a share from 0 to 1`);
  }
  if (cfg.tide !== undefined && !(Number.isInteger(cfg.tide) && cfg.tide >= 0)) throw new Error('RunConfig: tide must be a whole number, 0 or more');
  if (cfg.curses !== undefined && !(Array.isArray(cfg.curses) && cfg.curses.every((c) => typeof c === 'string'))) throw new Error('RunConfig: curses must be a list of ids');
  if (cfg.noFood !== undefined && typeof cfg.noFood !== 'boolean') throw new Error('RunConfig: noFood must be true or false');
  if (cfg.noHeal !== undefined && typeof cfg.noHeal !== 'boolean') throw new Error('RunConfig: noHeal must be true or false');
  if (cfg.densityCap !== undefined && !(Number.isFinite(cfg.densityCap) && cfg.densityCap >= 0)) throw new Error('RunConfig: densityCap must be a number, 0 or more');
  if (cfg.draftCards !== undefined && !(Number.isInteger(cfg.draftCards) && cfg.draftCards >= 1 && cfg.draftCards <= 6)) throw new Error('RunConfig: draftCards must be a whole number from 1 to 6');
  if (cfg.gearHooks !== undefined) {
    if (!Array.isArray(cfg.gearHooks)) throw new Error('RunConfig: gearHooks must be a list of { hook, params, affix }');
    for (const g of cfg.gearHooks) {
      if (!isObj(g) || typeof g.hook !== 'string' || !isObj(g.params)) throw new Error('RunConfig gearHooks: each is { hook, params, affix }');
      for (const [k, v] of Object.entries(g.params)) if (!Number.isFinite(v)) throw new Error(`RunConfig gearHooks ${g.hook}.${k} must be a number`);
    }
  }
  if (cfg.skills !== undefined) {
    if (!isObj(cfg.skills)) throw new Error('RunConfig: skills must be { id: { name: number } }');
    for (const [id, p] of Object.entries(cfg.skills)) {
      if (!isObj(p)) throw new Error(`RunConfig skills.${id} must be { name: number }`);
      for (const [k, v] of Object.entries(p)) if (!Number.isFinite(v)) throw new Error(`RunConfig skills.${id}.${k} must be a number`);
    }
  }
  if (cfg.characterParams !== undefined) {
    if (!isObj(cfg.characterParams)) throw new Error('RunConfig: characterParams must be { name: number }');
    for (const [k, v] of Object.entries(cfg.characterParams)) if (!Number.isFinite(v)) throw new Error(`RunConfig characterParams.${k} must be a number`);
  }
  if (cfg.layers !== undefined) {
    // What the profile has opened on this map (B5): { storm, well, secret }; tools and tests leave it out (all on).
    if (!isObj(cfg.layers)) throw new Error(`RunConfig: layers must be { ${LAYERS.join(', ')} }, each true or false`);
    for (const [k, v] of Object.entries(cfg.layers)) {
      if (!LAYERS.includes(k)) throw new Error(`RunConfig layers: there is no "${k}" (${LAYERS.join(', ')})`);
      if (typeof v !== 'boolean') throw new Error(`RunConfig layers.${k} must be true or false`);
    }
  }
  if (cfg.evolutionPassiveReduction !== undefined && !(Number.isInteger(cfg.evolutionPassiveReduction) && cfg.evolutionPassiveReduction >= 0)) throw new Error('RunConfig: evolutionPassiveReduction must be a whole number, 0 or more');
  // The relics given to the Salt Well on earlier runs (meta, 0.8.0): the Ferryman's Well slot.
  if (cfg.wellRelics !== undefined && !(Array.isArray(cfg.wellRelics) && cfg.wellRelics.every((id) => typeof id === 'string'))) throw new Error('RunConfig: wellRelics must be a list of relic ids');
}

/**
 * With no pools in the RunConfig (tests, the bots, the soak), a run draws from all the content
 * there is; the game passes the player's own pools (meta/runconfig.js runConfigFor), which is
 * what research and the harbor's buildings add to.
 */
function fullPool(list) { return list.filter((x) => x.unlock !== 'evolution' && x.unlock !== 'innate' && !x.innate && !x.signature); }   // (W2: signature weapons come with their character)

/**
 * A new run.
 * @param {object} config RunConfig: seed, map, mode, character, and optionally pools (resolved
 *   content ids from meta), mods (hub, gear, Tide), relics (starting), charges, draftCards,
 *   weaponSlots, evolutionPassiveReduction (gear: evolutions need that many fewer partner
 *   levels), gearHooks ([{ hook, params, affix }]: worn gear's rules with their own code),
 *   tuning (overrides), densityMul, densityCap, hpMul, rewardMul, enemyDamageMul,
 *   enemySpeedMul, noFood (Tide and curses), harbor ({ ferry, lampSpeed, bellRing }: what the
 *   harbor's buildings add to a run's tasks and the Ferryman), startGlass, startEmbers, relics (carried from 0:00: the Heirloom), heirloom (its id, for the result), startWeapon (a character's other kit), bestiaryBonus
 *   ({ enemyId: share more damage }), tide, curses, challenge (recorded for the result),
 *   layers ({ storm, well, secret }: what of the map the profile has opened; all on when left out),
 *   wellRelics (relic ids given to the Salt Well on earlier runs: the Ferryman's Well slot),
 *   passiveSlots, relicSlots (0.9.0: from the harbor; 6 each when left out), forms (the capstone
 *   Form ids the profile has opened; all when left out),
 *   invulnerable (tests and the soak only).
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
  };

  const layers = { storm: true, well: true, secret: true, ...(cfg.layers || {}) };
  const world = {
    config: cfg, tuning, unknownTuning, data, map, character,
    tick: 0,
    rng: {
      root,
      spawn: root.fork('spawn'), combat: root.fork('combat'), draft: root.fork('draft'),
      loot: root.fork('loot'), boss: root.fork('boss'), storm: root.fork('storm'),
      trade: root.fork('trade'),   // the signature weapon's track and the characters' trades (sim/trades.js)
    },
    // The character's skills this run (ruling 15): { id: its numbers }; a hook asks world.sk.<id>.
    sk: cfg.skills ?? {},
    layers,
    terrain,
    flow: createFlowField(terrain),
    bigFlow: createFlowField(terrain, { dilate: 1 }), // for bodies wider than a tile
    swimFlow: createFlowField(terrain, { swim: true }), // for leeches (the Marsh: water is open to them)
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
    passiveDefs: data.passives, relicDefs: data.relics,
    dashDefs: data.dashes || [], dash: null,   // ruling 16: the Dash slot (sim/dash.js)
    materialDefs: data.materials, materialIndex: byId(data.materials),
    bossDefs: new Map(data.bosses.map((b) => [b.id, b])),
    pools,
    player: createPlayer((cols * TILE) / 2, (rows * TILE) / 2),
    slots: new Array(HIT_SLOTS).fill(null),
    build: {
      weaponSlots: DEFAULT_WEAPON_SLOTS,
      passiveSlots: cfg.passiveSlots ?? DEFAULT_PASSIVE_SLOTS,   // 0.9.0: from the harbor (RunConfig)
      relicSlots: cfg.relicSlots ?? DEFAULT_RELIC_SLOTS,
      returned: [],        // relics swapped out this run, waiting for the Ferryman's next stock (sim/relics.js)
      passives: [],
      relics: [],
      banished: new Set(),
      evolvedFrom: new Set(),
      embers: 0,           // Embers kept, not yet spent (sim/ascend.js)
      boundEmbers: [],     // (always empty since ruling 14: an Ember goes on any weapon)
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
    dryLevels: 0,          // level-ups paid without a screen (sim/draft.js levelGift)
    // Ruling 14 (C1): the rules the build carries (sim/build.js buildRules), the tick the next level-up
    // may come (tuning.xp.draftGap), the path you walked (a sample every 6 ticks: Glass Ring,
    // Procession, Spring Line), where enemies last died (Grave Lights), the deeds done this tick, and
    // whether the character's own track grows the signature (C2 sets it; else the interim clock does).
    rules: {}, draftAt: 0, levelNow: 0, rotPatchAt: 0, rotList: 0, sigTrack: false, deedsDone: [],
    path: { x: new Float32Array(64), y: new Float32Array(64), n: 0 },
    corpses: { x: new Float32Array(8), y: new Float32Array(8), t: new Int32Array(8).fill(-100000), n: 0 },
    knockbackPulls: false, // the Harpooner's weapons pull instead of push (set by her hook)
    god: false,            // dev god mode (a logged dev decision; tests and the soak use config.invulnerable)
    magnetAll: 0,
    glass: 0,              // Pearls held (sim/relics.js; spent with the Ferryman; Sea Glass before 0.8.2)
    pearlsOn: false,       // Pearls exist in this run: the Ferryman is in it (set below)
    tasks: null,           // the map's tasks (sim/tasks.js)
    wardNext: 0,           // the tick the lit lamps' wards next burn (sim/tasks.js)
    hitQuiet: 0,           // HIT_QUIET while a ward or Lantern Night burns, so the view shows no number per pulse
    dashedNow: false,      // a dash began this tick (it throws leeches off once the grid is built)
    // Lantern Night (until: the tick it ends, -1 when it isn't on; burn: each pulse's damage, set by
    // the minute it fell; sec: how long it lasts; banked: every lamp lit, waiting for the crowd;
    // count: nights this run; vaultTick: the tick its vault drops, -1 none).
    night: { until: -1, next: 0, burn: 0, sec: 0, banked: false, count: 0, vaultTick: -1 },
    ferry: null,           // the Ferryman, with the Docks (sim/relics.js)
    reliquary: { last: -1e9, kills: 0, wait: 0, out: false }, // the last Reliquary's tick, ordinary kills since, seconds the next waits at least, and whether the pool's end was said
    relicKeys: null,       // the relic pool's banish keys, made once (sim/relics.js relicPool)
    relicTierBonus: 0,     // relics offered this many tiers better (the Glassblower relic)
    emberEliteMul: 1, emberBossExtra: 0, // the Kindling relic
    enemyDamageMul: cfg.enemyDamageMul ?? 1,
    tideRules: tideRulesFor(data.tides, cfg.tide ?? 0), // what a Tide from 2 adds (data/tide.js)
    // The Cartographer's bestiary bonus: 1 + share, per enemy type (null without one).
    bestiaryMul: cfg.bestiaryBonus ? Float64Array.from(data.enemies, (e) => 1 + (cfg.bestiaryBonus[e.id] ?? 0)) : null,
    enemySpeedMul: cfg.enemySpeedMul ?? 1,
    zonePulse: 0,          // 1 while a ground zone's pulse is hitting (a kill it makes says so: enemies.js killedByZone)
    shardHit: 0,           // 1 while a Salt Pan shard is hitting (its kill never shatters again: enemies.js shardKill)
    mergeGem: NO_HANDLE,
    pull: { x: 0, y: 0, speed: 0, ticks: 0, boss: -1 }, // a boss's lure drawing the player in (bosses.js; boss = its handle)
    result: createResultState(data.enemies.length, data.materials.length),
    // The map's secret caches (map.secrets), in pixels; each opens once a run (one in a layer the
    // run hasn't opened isn't there).
    secrets: (map.secrets || []).filter((m) => m.layer === undefined || layers[m.layer] === true).map((m) => ({
      id: m.id, relic: m.relic, x: (m.at[0] + 0.5) * TILE, y: (m.at[1] + 0.5) * TILE, radius: m.radius, open: false,
    })),
    // Scratch buffers and typed-array registers. Hot loops pass fractional numbers through
    // registers instead of call arguments (a call V8 doesn't inline boxes each one: §17).
    // Each register array has one owner: reg (enemiesAct), qreg (shot and zone hit passes),
    // hit (applyHit's inputs), num (damageEnemyR [0], impulseR [1..3]), xreg (explodeR),
    // shot (spawnShot's position, direction, and speed), hold (the Marsh's on-hit pieces in
    // sim/holds.js: dazeEnemy [0] seconds, tarEnemy [0] damage, spikeAt [0] x [1] y [2] damage).
    // Pick lists have their own owners: the storm's (world.storm.picks) and each spout's (slot.picks).
    scratch: {
      v2: new Float64Array(2), sc: new Float64Array(2), dir: new Float64Array(3),
      reg: new Float64Array(4), qreg: new Float64Array(4), hit: new Float64Array(8),
      num: new Float64Array(4), xreg: new Float64Array(8), shot: new Float64Array(5), open: new Float64Array(2), hold: new Float64Array(4),
      near: new Int32Array(CAP.enemies), push: new Int32Array(CAP.enemies), blast: new Int32Array(CAP.enemies),
      hits: new Int32Array(1024), sep: new Int32Array(16),
      crowd: new Int32Array(24), lure: new Int32Array(512), link: new Int32Array(64), // Forms: Mortar's candidates, a wisp's lure, a Fuel Line
      pool: { found: 0, total: 0 },  // the relic pool's count (sim/relics.js maybeReliquary)
    },
    // The Salt Marsh (0.8.0, §5.17): the water (sim/marsh.js), the storm and the pillars
    // (sim/storm.js), the well (sim/well.js), thralls (sim/allies.js), first sightings
    // (sim/sight.js), and what the Marsh's relics set (sim/hooks.js; each undone by its relic's undo).
    marsh: null, storm: null, well: createWell(), allies: createAllies(),
    seen: new Uint8Array(data.enemies.length), seenThings: 0,
    enemySwims: Uint8Array.from(data.enemies, (e) => SWIMS[e.swims ?? 'land'] ?? 0),
    enemyLatch: Uint8Array.from(data.enemies, (e) => (e.latch ? 1 : 0)),
    enemyStormproof: Uint8Array.from(data.enemies, (e) => (e.stormproof ? 1 : 0)),
    slowStack: 0, saltAfter: 1, saltSec: 4,        // the Brine Vat
    quench: null, coldIron: null, tryPot: null, torc: null,
    torcSpent: false, tryPotArmed: false,   // kept past a swap: a relic given up and bought back comes back as it left (X4)
    latched: 0,            // leeches latched on now
    hurtBy: -1,            // the enemy whose touch is hurting you this moment (the Sea Urchin)
    crowd: { held: 0 },    // seconds among a crowd now (the result's crowdSec is the longest)
  };
  createCombatState(world);                       // W3 (0.9.0): attack sources, warning tiers, threat, champions, what hurt you
  world.director = createDirector(world);
  world.marsh = createMarsh(world);
  world.storm = createStorm(world);
  world.tasks = createTasks(world);
  world.ferry = createFerry(world);
  world.pearlsOn = world.ferry !== null;
  for (const id of cfg.wellRelics || []) if (!data.relics.some((r) => r.id === id)) throw new Error(`RunConfig wellRelics: unknown relic "${id}"`);
  if (cfg.startWeapon !== undefined && cfg.startWeapon !== null && !world.weaponIndex.has(cfg.startWeapon)) throw new Error(`RunConfig: unknown weapon "${cfg.startWeapon}"`);
  setupCharacter(world, cfg.startWeapon ?? null);
  // Gear's hooks (meta/workshop.js gearForRun), after the character's, before any relic's.
  for (const g of cfg.gearHooks || []) addHook(world, g.hook, g.params, `gear:${g.affix ?? g.hook}`);
  rebuildStats(world);
  // The Dash slot (ruling 16): the item the run starts with (RunConfig.dash, else the character's),
  // and what the draft can offer in its place (RunConfig.dashes, else every starter item).
  const dashIds = cfg.dashes ?? world.dashDefs.filter((d) => d.unlock === 'starter').map((d) => d.id);
  for (const id of [...dashIds, ...(cfg.dash ? [cfg.dash] : [])]) if (!world.dashDefs.some((d) => d.id === id)) throw new Error(`RunConfig: unknown dash item "${id}"`);
  world.dashPool = world.dashDefs.filter((d) => dashIds.includes(d.id));
  if (world.dashDefs.length) setDash(world, dashDefOf(world, cfg.dash ?? character.dash));
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
  // W5 (ruling 17): the signature isn't counted in the weapon slots; they are all for drafted weapons.
  if (character && character.signature) world.build.weaponSlots = Math.min(MAX_WEAPON_SLOTS, world.build.weaponSlots + 1);
  for (const id of cfg.relics || []) {
    const r = data.relics.find((x) => x.id === id);
    if (!r) throw new Error(`RunConfig relics: unknown relic "${id}"`);
    addRelic(world, r);
  }
  // Relics a run starts with never go past its slots: the slots stretch to hold them.
  if (world.build.relics.length > world.build.relicSlots) world.build.relicSlots = world.build.relics.length;
  rebuildStats(world);
  if (cfg.startGlass) addGlass(world, cfg.startGlass, p.x, p.y);
  // An Ember in hand at 0:00 (the Ember Tin): kept like any Ember, for the first weapon that can take a Form.
  if (cfg.startEmbers) world.build.embers += cfg.startEmbers;
  // Tempering (the Smithy's Lv 4, where rune stones were): the weapon you set out with starts with one of its Rare lines.
  if (cfg.tempered) temper(world);
  // A map that says where a run starts (the Salt Marsh's landing) starts there.
  if (map.start) { p.x = p.px = (map.start[0] + 0.5) * TILE; p.y = p.py = (map.start[1] + 0.5) * TILE; }
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

/** Tempering: the start weapon takes one of its Rare lines (the loot stream picks which). */
function temper(world) {
  for (let s = 0; s < world.build.weaponSlots; s++) {
    const slot = world.slots[s];
    if (!slot || !slot.def || slot.def.signature || slot.def.innate) continue;
    const ln = linesOpen(world, slot, 2);
    if (ln.length) { giveUpgrade(world, s, { up: 'line', rarity: 'rare', value: 0, line: ln[world.rng.loot.int(ln.length)].id }); rebuildStats(world); }
    return;
  }
}

function queueDraft(world) {
  if (!world.over) world.halts.push({ kind: 'draft', offer: null, level: world.player.level });
}

/** Get the current halt ready for the player (a draft's cards are drawn when it's shown). */
function prepareHalt(world) {
  // An Ember's choice queued behind another (two picked up on one tick) with nothing left to
  // take: the Ember stays kept, and no empty screen opens.
  while (world.halts[0]?.kind === 'ascend' && !ascendLive(world, world.halts[0])) world.halts.shift();
  // A relic pick with nothing left to find becomes Sea Glass, with no screen.
  while (world.halts[0]?.kind === 'relic' && !prepareRelicPick(world, world.halts[0])) world.halts.shift();
  // A level-up with nothing left to level is paid without a screen (sim/draft.js levelGift).
  while (world.halts[0]?.kind === 'draft' && world.halts[0].offer === null && draftIsDry(world)) levelGift(world, world.halts.shift().level);
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
  stanceStep(world.player);                       // seconds moving and standing (ruling 16: what replaced the dash's triggers)
  if (world.dash) dashGround(world);
  marshStep(world);                               // the water and rule 8 (the ground changes at most 4 times a second)
  world.flow.update(world.player.x, world.player.y);
  world.bigFlow.update(world.player.x, world.player.y);
  if (world.marsh !== null) world.swimFlow.update(world.player.x, world.player.y);
  buildHash(world);
  // A dash's hooks query the enemy grid, so they wait for this tick's (last tick's still holds
  // the enemies removed since). A dash throws off every leech.
  if (world.dashedNow) { world.dashedNow = false; throwLeeches(world); }   // (a dash throws leeches off, and does nothing else: ruling 16)
  runHooks(world, 'onTick');
  // The path you walked, a sample every 6 ticks (Glass Ring, Procession, Spring Line read it).
  if (world.tick % 6 === 0) { const P = world.path, k = P.n % P.x.length; P.x[k] = world.player.x; P.y[k] = world.player.y; P.n++; }
  formsStep(world);                               // deeds done open their capstone; the signature's interim clock
  weaponsFire(world);                             // 3
  moveProjectiles(world);                         // 4
  projectileHits(world);                          // 5
  zonesTick(world);                               // 6
  enemiesAct(world);                              // 7
  buildHash(world);
  contactStep(world);                             // 8
  resolveDeaths(world);                           // 9
  pickupsStep(world);                             // 10
  tasksStep(world);                               // 10: lamps, bells, Lantern Night's burn
  ferryStep(world);                               // 10: the Ferryman's stock, and his trade
  wellStep(world);                                // 10: the Salt Well
  crowdStep(world);                               // 10: how long you've stood among a crowd (the result)
  resolveDeaths(world);                           // 9 again: kills made in step 10 (a relic's gem blast, Lantern Night)
  levelCheck(world, queueDraft);                  // 11
  if (!world.over) directorStep(world);           // 12
  if (!world.over) stormStep(world);              // 12: the storm, the Eye, the pillars
  removeDead(world);
  world.tick++;                                   // 13: the tick's events are in world.events
  if (!world.over) prepareHalt(world);
  return true;
}

/** Every 0.1 s: enemies within the crowd radius; the longest run of seconds at the crowd count is the result's crowdSec. */
function crowdStep(world) {
  if (world.tick % 6 !== 0) return;
  const C = world.tuning.run.crowd, p = world.player, q = world.scratch.qreg, near = world.scratch.near, E = world.enemies;
  q[0] = p.x; q[1] = p.y; q[2] = C.radius;
  const m = world.enemyHash.queryR(q, near, -1);
  let n = 0;
  for (let k = 0; k < m; k++) if ((E.flags[near[k]] & EF_GONE) === 0) n++;
  if (n >= C.count) {
    world.crowd.held += 0.1;
    if (world.crowd.held > world.result.crowdSec) world.result.crowdSec = Math.round(world.crowd.held * 10) / 10;
  } else world.crowd.held = 0;
}

/** The decision the sim is waiting for, or null. */
export function currentHalt(world) {
  return world.over ? null : (world.halts[0] || null);
}

/**
 * Make a decision. For the current halt:
 *   draft:    { kind: 'pick', index } | { kind: 'reroll' } | { kind: 'banish', index } | { kind: 'skip' }
 *   chest:    { kind: 'ok' }
 *   overtime: { kind: 'stay' } | { kind: 'leave' }
 *   ascend:   { kind: 'ascend', slot, id } | { kind: 'keep' } (an Ember: sim/ascend.js)
 *   relic:    { kind: 'pick', index } | with the relic slots full { kind: 'pick', index, swap: id } or
 *             { kind: 'pass' } (a Reliquary, the vault, a secret cache: sim/relics.js)
 *   ferry:    { kind: 'buy', index, swap? } (stays open) | { kind: 'done' } (the Ferryman: sim/relics.js)
 *   well:     { kind: 'give', id } | { kind: 'keep' } (the Salt Well: sim/well.js)
 *   bellpick: { kind: 'pick', index } (a rung Fog Bell's chest: sim/chests.js)
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
    case 'overtime': done = overtimeDecide(world, d); break;
    case 'ascend': done = ascendDecide(world, d); break;
    case 'relic': done = relicDecide(world, h, d); break;
    case 'ferry': done = ferryDecide(world, d); break;
    case 'well': done = wellDecide(world, h, d); break;
    case 'bellpick': done = bellPickDecide(world, h, d); break;
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
  for (const v of [p.x, p.y, p.fx, p.fy, p.hp, p.shield, p.xp, p.xpNext, p.dashCd, p.dashSpeed, p.dashDx, p.dashDy, p.bonusArmor, p.moveT, p.stillT, p.speedMul]) h.float64(v);
  for (const v of [p.level, p.dashTicks, p.iframes, p.prevButtons, p.revivals, p.dashStart, p.dashEnd, p.dashCharges, p.ruleAt]) h.int(v);
  if (world.dash) { h.int(world.dash.index).int(world.dash.ups.length); for (const u of world.dash.ups) h.int(DASH_UPS.indexOf(u.up)).float64(u.value); }
  h.int(world.draftAt).int(world.levelNow).int(world.rotPatchAt).int(world.sigTrack ? 1 : 0).int(world.path.n).array(world.path.x).array(world.path.y);
  h.int(world.corpses.n).array(world.corpses.x).array(world.corpses.y).array(world.corpses.t);
  for (const k of ['root', 'spawn', 'combat', 'draft', 'loot', 'boss', 'storm', 'trade']) for (const v of world.rng[k].getState()) h.int(v);
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
    // Its rolled upgrades (ruling 10): each type and number (a bundle's two), and its Form progress.
    if (slot.ups) for (const u of slot.ups) {
      h.int(UP_INDEX.get(u.up) ?? -1).float64(u.value);
      if (u.line) h.int(fnv1a(u.line));
      if (u.special) h.int(fnv1a(u.special));
    }
    // Its open axes, its deed's count (and a 'multi' deed's window), the upgrade a Legendary was last offered at, its pots.
    h.int(slot.axes ?? 0).float64(slot.deed ?? 0).int(slot.deedA ?? 0).int(slot.deedB ?? 0).int(slot.legAt ?? 0);
    if (slot.pots) h.array(slot.pots);
  }
  // Boss state machines and every hook's own state.
  for (const b of world.bosses) {
    h.int(b.handle).int(b.alive ? 1 : 0).int(b.phase).int(b.next).int(b.state).int(b.hitPlayer ? 1 : 0);
    for (const v of [b.timer, b.ax, b.ay, b.adx, b.ady, b.chargeLeft, b.taken]) h.float64(v);
  }
  for (const e of world.hookEntries) {
    h.int(fnv1a(e.id));
    for (const k of Object.keys(e.state).sort()) h.int(fnv1a(k)).float64(e.state[k]);
  }
  for (const ps of world.build.passives) h.int(world.passiveDefs.indexOf(ps.def)).int(ps.level);
  for (const r of world.build.relics) h.int(world.relicDefs.indexOf(r));
  h.int(world.build.weaponSlots);
  h.int(-20).int(world.build.passiveSlots).int(world.build.relicSlots);
  for (const id of world.build.returned) h.int(-21).int(fnv1a(id));
  for (const k of [...world.build.banished].sort()) h.int(fnv1a(k));
  h.int(-2);
  for (const id of [...world.build.evolvedFrom].sort()) h.int(fnv1a(id));
  h.int(world.charges.reroll).int(world.charges.banish).int(world.charges.skip);
  const d = world.director;
  h.int(d.eventIdx).int(d.band).int(d.regularAlive).int(d.bossesAlive).int(d.overtimeMinutes);
  h.int(d.overtime ? 1 : 0).int(d.overtimeStartTick).int(d.finalBossDead ? 1 : 0);
  if (d.overtime) for (let j = 0; j < d.otNext.length; j++) h.float64(d.otNext[j]).int(d.otCount[j]).int(d.otWarned[j]);
  for (const v of [d.hpMul, d.contactMul, d.target, d.otDensity, d.otHp, d.otMaterialMul]) h.float64(v);
  h.array(world.result.killsByType).array(world.result.materialsRaw).array(world.result.damageBySlot);
  h.float64(world.magnetAll).int(world.mergeGem).int(world.halts.length).int(world.god ? 1 : 0);
  for (const s of world.secrets) h.int(s.open ? 1 : 0); // nothing on a map without secrets
  if (world.build.embers > 0) h.int(-3).int(world.build.embers);
  for (let s = 0; s < world.slots.length; s++) {
    const sl = world.slots[s];
    if (!sl || !sl.ascensions || !sl.fs || s === RELIC_SLOT) continue;
    h.int(-4).int(s);
    for (const a of sl.ascensions) h.int(fnv1a(a.id));
    // The Forms' running state (sim/forms.js createFormState): every number in it, in key order.
    for (const v of Object.values(sl.fs)) h.float64(v);
  }
  // Phase 7: Pearls, the tasks, Lantern Night, the Reliquary's count, the Ferryman.
  if (world.dryLevels > 0) h.int(-6).int(world.dryLevels);
  h.int(-5).int(world.glass).int(world.night.until).int(world.night.next).float64(world.night.burn).int(world.reliquary.kills).float64(world.reliquary.last).float64(world.reliquary.wait).int(world.reliquary.out ? 1 : 0);
  hashTasks(world, h);
  if (world.ferry) {
    const F = world.ferry;
    h.int(F.stock).int(F.armed ? 1 : 0).float64(F.touch).int(F.moored ? 1 : 0).int(F.mooring).int(F.calls).int(F.nextCall).int(F.tiedTick);
    for (const o of F.offers) h.int(fnv1a(o.id)).int(o.price).int(o.sold ? 1 : 0).int(o.gone ? 1 : 0);
  }
  for (const hl of world.halts) if (hl.offer && hl.kind === 'relic') for (const id of hl.offer) h.int(fnv1a(id));
  if (world.pull.ticks > 0) h.int(world.pull.ticks).int(world.pull.boss).float64(world.pull.x).float64(world.pull.y).float64(world.pull.speed);
  // The Salt Marsh: the water and its hold, the storm and pillars, the well, thralls, latches, the
  // Marsh's relics' rules, and the ground's version.
  if (world.marsh !== null) hashMarsh(world.marsh, h);
  hashStorm(world.storm, h);
  hashWell(world.well, h);
  hashAllies(world.allies, h);
  h.int(-15).int(world.terrain.version).int(world.latched).float64(world.slowStack).float64(world.crowd.held);
  if (world.tryPot !== null) h.int(world.tryPot.armed);
  if (world.torc !== null) h.int(world.torc.ready).int(world.torc.sinkUntil);
  if (world.torcSpent) h.int(-31);
  if (world.tryPotArmed) h.int(-32);
  for (const b of world.bosses) h.int(b.weakFrom).int(b.weakUntil).int(b.stuckUntil);
  hashCombat(world, h);                           // W3 (0.9.0): the threat, your slow, the champions, the bosses' gates
  return h.hex();
}

export { buildRunResult };
