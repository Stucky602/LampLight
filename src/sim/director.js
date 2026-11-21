// The spawn director (ARCHITECTURE §5.7).
//
// Keeps the number of regular enemies near the map timeline's density target, spawning on a
// ring just outside the view (never on screen), and fires the timeline's scripted events at
// their times: swarm walls, closing rings, elites, musters (an elite with its crew), chests, and
// the bosses at 10:00 and 20:00.
// A map's timeline and overtime data are checked when the run starts, so a mistake in data
// fails at 0:00 with a plain message instead of in the middle of a run.
// Enemy HP and contact damage grow with time. After the last boss the player may stay in
// overtime, where density, HP, and material yield compound every minute (the materials up to a
// cap), and the map's repeating events come round again (elites, rings, a muster announced
// ahead). Short run mode compresses the whole timeline (bosses at 5:00 and 10:00).
// From Tide 2 each Tide adds a rule (data/tide.js; tideRulesFor): elites in pairs, weaker
// healing, bigger walls and rings, and so on.
// The pace dials (tuning.pace, 0.8.1): `density` scales every band's target and every scripted
// crowd (a ring's, a wall's, a flock's, a muster's crew, overtime's repeats); `maxAlive` caps the
// enemies alive (the director spawns none past it); a band's `min` keeps that many alive whatever
// the dials say, so the screen never empties (a boss's thinning and a run's densityCap aside).
// 0.9.0 (W3): each band may carry its own `pace` (a share on top of pace.density: per-band
// density, so the early bands can be busier than the global dial makes them); the floors are
// higher from 0:00 to 5:00 and a Tide's densityMul raises them too (a Tide adds horde danger in
// every phase, not only density where the bands' targets are above their floors). Set pieces
// (walls, rings, flocks, a muster's crew) are sized by pace.events (ruling 7: 1, full size), may
// pass maxAlive while they run, and don't count against the band (EF.EVENT). A muster may have a
// champion (sim/champions.js). Once a second the threat that follows your power is set (sim/threat.js).

import { DT, TPS } from './constants.js';
import { EV, END } from './events.js';
import { spawnEnemy, ringPosition, MUSTER_CAPTAIN, NO_CHEST } from './enemies.js';
import { SWIMS } from './constants.js';
import { TILE } from './terrain.js';
import { startEye, eyeOpen } from './storm.js';
import { dropChest, CHEST_ELITE } from './chests.js';
import { registerBoss } from './bosses.js';
import { fpow, sincosInto, TAU } from '../lib/fmath.js';
import { endRun } from './run-result.js';
import { crowdArrives } from './tasks.js';
import { makeChampion, checkChampion } from './champions.js';
import { threatStep } from './threat.js';
import { checkActs, deckFired, placeCache, longNight, actsOnOvertime } from './acts.js';
import { spawnGem, spawnPickup } from './pickups.js';
import { strikeAt } from './storm.js';
import { crowdPoint } from './holds.js';
import { STRIKE_SRC } from './events.js';
import { PK } from './constants.js';

const EVENT_TYPES = new Set(['elite', 'boss', 'wall', 'ring', 'chest', 'muster', 'flock', 'eye', 'cache', 'trail', 'rising', 'fire', 'long_night']);
// 0.9.0 (W4): cache, trail, rising, and fire come from a map's deck (sim/acts.js); long_night and a
// returning boss from overtime's one-shot `events`.
/** The layers a map's events can belong to (RunConfig.layers: what the profile has opened). */
export const LAYERS = Object.freeze(['storm', 'well', 'secret']);
const VIEW_HALF_DIAGONAL = 368; // px: a ring any tighter than this would spawn on screen (640 x 360 view)

/** Check a map's timeline and overtime data; throws a plain message on the first problem. */
export function checkTimeline(map, enemyIndex, enemyDefs) {
  const at = (e) => `Map ${map.id}: the ${e.event} event at ${e.at} s`;
  if (!map.timeline || !Array.isArray(map.timeline.bands) || map.timeline.bands.length === 0) throw new Error(`Map ${map.id}: the timeline has no bands`);
  for (const b of map.timeline.bands) {
    if (b.min !== undefined && !(Number.isInteger(b.min) && b.min >= 0 && b.min <= b.density[1])) throw new Error(`Map ${map.id}: the band from ${b.from} s needs a min that's a whole number from 0 to its density's end`);
    if (b.pace !== undefined && !(Number.isFinite(b.pace) && b.pace > 0 && b.pace <= 4)) throw new Error(`Map ${map.id}: the band from ${b.from} s has a pace that isn't a share above 0, at most 4`);
    for (const id of Object.keys(b.roster)) {
      const t = enemyIndex.get(id);
      if (t === undefined) throw new Error(`Map ${map.id}: unknown enemy "${id}" in the band from ${b.from} s`);
      // Swarmers fly through and away; as density filler they'd be spawned over and over.
      if (enemyDefs[t].ai.type === 'swarm' || enemyDefs[t].ai.type === 'boss') throw new Error(`Map ${map.id}: "${id}" can't be in a band roster (swarmers come in walls and rings, bosses from boss events)`);
    }
  }
  for (const e of map.timeline.events || []) {
    if (!(e.at >= 0)) throw new Error(`${at(e)}: needs a time`);
    if (e.layer !== undefined && !LAYERS.includes(e.layer)) throw new Error(`${at(e)}: unknown layer "${e.layer}" (${LAYERS.join(', ')})`);
    checkEvent(e, at(e), enemyIndex, enemyDefs);
    if (e.otherwise !== undefined) {
      if (e.layer === undefined) throw new Error(`${at(e)}: only an event with a layer has an otherwise`);
      checkEvent(e.otherwise, `${at(e)} (otherwise)`, enemyIndex, enemyDefs);
    }
  }
  const ot = map.overtime;
  if (!ot || !(ot.densityPerMin > 0 && ot.hpPerMin > 0 && ot.materialsPerMin > 0)) throw new Error(`Map ${map.id}: overtime needs densityPerMin, hpPerMin, and materialsPerMin`);
  if (ot.materialsCap !== undefined && !(ot.materialsCap >= 1)) throw new Error(`Map ${map.id}: overtime's materialsCap must be 1 or more`);
  if (ot.eliteRare !== undefined && !(ot.eliteRare >= 0 && ot.eliteRare <= 1)) throw new Error(`Map ${map.id}: overtime's eliteRare must be from 0 to 1`);
  if (ot.dropMul !== undefined && !(ot.dropMul >= 0 && ot.dropMul <= 1)) throw new Error(`Map ${map.id}: overtime's dropMul must be from 0 to 1`);
  if (ot.repeat !== undefined && !Array.isArray(ot.repeat)) throw new Error(`Map ${map.id}: overtime's repeat must be a list of events`);
  if (ot.events !== undefined && !Array.isArray(ot.events)) throw new Error(`Map ${map.id}: overtime's events must be a list`);
  (ot.events || []).forEach((e, j) => {
    const here = `Map ${map.id}: overtime's ${e.event} (${j + 1})`;
    if (!(e.at >= 0)) throw new Error(`${here}: needs an at (seconds from overtime's start)`);
    if (e.event === 'long_night') {
      if (!(Array.isArray(e.enemies) && e.enemies.length >= 1)) throw new Error(`${here}: the Long Night needs its bosses`);
      for (const id of e.enemies) { const t = enemyIndex.get(id); if (t === undefined || enemyDefs[t].ai.type !== 'boss') throw new Error(`${here}: "${id}" isn't a boss`); }
      if (e.gap !== undefined && !(e.gap >= 0)) throw new Error(`${here}: gap is seconds, 0 or more`);
      if (e.hpMul !== undefined && !(e.hpMul > 0)) throw new Error(`${here}: hpMul must be above 0`);
    } else if (e.event === 'boss') checkEvent(e, here, enemyIndex, enemyDefs, map);
    else throw new Error(`${here}: overtime's events are a boss or the Long Night`);
  });
  const badActs = checkActs(map, (ev) => { try { checkEvent(ev, 'its event', enemyIndex, enemyDefs, map); return null; } catch (err) { return err.message; } });
  if (badActs) throw new Error(badActs);
  (ot.repeat || []).forEach((e, j) => {
    const here = `Map ${map.id}: overtime's repeating ${e.event} (${j + 1})`;
    if (!(e.every >= 10)) throw new Error(`${here}: needs an every of 10 s or more`);
    if (e.event === 'boss' || e.event === 'chest') throw new Error(`${here}: bosses and chests don't repeat in overtime`);
    if (e.pairs !== undefined) {
      // 0.9.0 (W4): elite pairings, a new pair each time in turn.
      if (!Array.isArray(e.pairs) || !e.pairs.length || e.event !== 'elite' || !e.pairs.every((pr) => Array.isArray(pr) && pr.length === 2)) throw new Error(`${here}: pairs (taken in turn) is a list of two-elite lists, for elites only`);
      for (const pr of e.pairs) for (const id of pr) checkEvent({ ...e, enemy: id }, here, enemyIndex, enemyDefs);
    } else if (e.enemies !== undefined) {
      if (!Array.isArray(e.enemies) || !e.enemies.length || e.event !== 'elite') throw new Error(`${here}: enemies (taken in turn) is a list, for elites only`);
      for (const id of e.enemies) checkEvent({ ...e, enemy: id }, here, enemyIndex, enemyDefs);
    } else checkEvent(e, here, enemyIndex, enemyDefs);
  });
}

/** One timeline or overtime event's data; throws a plain message (`at` says which). */
function checkEvent(e, at, enemyIndex, enemyDefs, map = null) {
  if (!EVENT_TYPES.has(e.event)) throw new Error(`${at}: unknown event type (known: ${[...EVENT_TYPES].join(', ')})`);
  if (e.event === 'chest') return;
  if (e.event === 'eye') { if (!(e.sec > 0)) throw new Error(`${at}: the Eye needs its seconds`); return; }
  if (e.event === 'long_night') throw new Error(`${at}: the Long Night comes only in overtime's events`);
  // The deck's kinds (0.9.0, W4).
  const chestOk = (c) => c === 'elite' || c === 'boss';
  const guardOk = (g) => g === undefined || (g && enemyIndex.has(g.enemy) && Number.isInteger(g.count) && g.count > 0 && (g.elite === undefined || enemyIndex.has(g.elite)));
  if (e.event === 'cache' || e.event === 'trail') {
    if (!(chestOk(e.chest) || (Array.isArray(e.chest) && e.chest.length === 3 && e.chest.every(chestOk)))) throw new Error(`${at}: a cache's chest is 'elite' or 'boss', or one for each act`);
    if (!guardOk(e.guard)) throw new Error(`${at}: a guard is { enemy, count, elite? } with known enemies`);
    if (e.event === 'trail' && !(Number.isInteger(e.gems) && e.gems > 0 && e.gems <= 64)) throw new Error(`${at}: a trail needs 1 to 64 gems`);
    if (e.pearls !== undefined && !(Number.isInteger(e.pearls) && e.pearls > 0)) throw new Error(`${at}: pearls is a whole number`);
    return;
  }
  if (e.event === 'rising') {
    if (map && !(map.places || []).some((pl) => pl.id === e.place)) throw new Error(`${at}: unknown place "${e.place}"`);
    if (!enemyIndex.has(e.enemy) || !(Number.isInteger(e.count) && e.count > 0)) throw new Error(`${at}: a rising needs a known enemy and a whole count`);
    const sp = e.spoils;
    if (sp !== undefined && !(Number.isInteger(sp.heal ?? 0) && (sp.material === undefined || Number.isInteger(sp.amount)))) throw new Error(`${at}: spoils are { heal, material, amount }`);
    return;
  }
  if (e.event === 'fire') {
    for (const k of ['count', 'step', 'radius', 'damage']) if (!(e[k] > 0)) throw new Error(`${at}: a fire's ${k} must be above 0`);
    if (!(e.warn >= 0.8)) throw new Error(`${at}: a fire's rings warn at least 0.8 s`);
    return;
  }
  const t = enemyIndex.get(e.enemy);
  if (t === undefined) throw new Error(`${at}: unknown enemy "${e.enemy}"`);
  if ((enemyDefs[t].ai.type === 'boss') !== (e.event === 'boss')) throw new Error(`${at}: bosses come only from boss events, and boss events only spawn bosses`);
  if ((e.event === 'wall' || e.event === 'ring') && !(Number.isInteger(e.count) && e.count > 0)) throw new Error(`${at}: needs a whole-number count`);
  // A flock (rule 2: never a wall across the screen): a few birds in a tight clump from one side.
  if (e.event === 'flock' && !(Number.isInteger(e.count) && e.count > 0 && e.count <= 8 && enemyDefs[t].ai.type === 'swarm')) throw new Error(`${at}: a flock is 1 to 8 swarmers`);
  if (e.speed !== undefined && !(e.speed > 0)) throw new Error(`${at}: speed must be above 0`);
  if (e.event === 'muster') {
    const t2 = enemyIndex.get(e.escort);
    if (t2 === undefined) throw new Error(`${at}: unknown escort "${e.escort}"`);
    if (enemyDefs[t2].ai.type === 'boss' || enemyDefs[t2].ai.type === 'swarm') throw new Error(`${at}: an escort walks with its elite (no bosses or swarmers)`);
    if (!(Number.isInteger(e.count) && e.count > 0)) throw new Error(`${at}: needs a whole-number count`);
    if (!(e.radius > 0 && e.radius < 120)) throw new Error(`${at}: the crew's radius must be above 0 and under 120 px`);
    if (typeof e.name !== 'string' || !e.name) throw new Error(`${at}: needs a name (the notice)`);
    if (e.champion !== undefined) { const bad = checkChampion(e.champion); if (bad) throw new Error(`${at}: ${bad}`); }
    return;
  }
  if (e.radius !== undefined && !(e.radius >= VIEW_HALF_DIAGONAL)) throw new Error(`${at}: a ring radius under ${VIEW_HALF_DIAGONAL} px would spawn on screen`);
}

/**
 * A scripted crowd's size under the set-piece dial (tuning.pace.events, ruling 7; 0.8.1 to 0.8.2
 * used pace.density) and a Tide's rule: never fewer than one, and at 1 exactly what the data says.
 */
export function crowdCount(world, count, ruleMul = 1) {
  const n = Math.round(count * ruleMul * world.tuning.pace.events);
  return n > 1 ? n : 1;
}

const NO_RULES = Object.freeze({ elitePack: 1, healMul: 1, swarmMul: 1, bossTempo: 1, musterMul: 1, eliteSpeed: 1, reliquaryGap: 1, nightMul: 1 });
const RULE_KEYS = Object.keys(NO_RULES);

/**
 * The rules a run at Tide `level` plays by (data/tide.js: each Tide's own `rule` and every one
 * below it): a pack size takes the largest, the rest multiply. Tide 0 or 1: none.
 */
export function tideRulesFor(tides, level) {
  const out = { ...NO_RULES };
  for (const t of tides || []) {
    if (!(t.level <= level) || !t.rule) continue;
    for (const k of RULE_KEYS) {
      const v = t.rule[k];
      if (v === undefined) continue;
      if (!(Number.isFinite(v) && v > 0)) throw new Error(`Tide ${t.level}: rule ${k} must be a number above 0`);
      if (k === 'elitePack') out[k] = Math.max(out[k], Math.round(v));
      else out[k] *= v;
    }
  }
  return Object.freeze(out);
}

/** Build the director for a world (its map, mode, and tuning). */
export function createDirector(world) {
  const map = world.map;
  checkTimeline(map, world.enemyIndex, world.enemyDefs);
  const scale = world.config.mode === 'short' ? world.tuning.run.shortTimeScale : 1;
  const bands = map.timeline.bands.map((b) => {
    const types = [], weights = [];
    for (const [id, w] of Object.entries(b.roster)) {
      const t = world.enemyIndex.get(id);
      if (t === undefined) throw new Error(`Map ${map.id}: unknown enemy "${id}" in a band`);
      types.push(t); weights.push(w);
    }
    return { from: b.from * scale, to: b.to * scale, d0: b.density[0], d1: b.density[1], min: b.min ?? 0, pace: b.pace ?? 1, types, weights };
  });
  // An event in a layer the run hasn't opened is its `otherwise` (the Well's muster: an elite), or nothing.
  const layers = world.layers;
  const events = (map.timeline.events || []).map((e, index) => {
    if (e.layer !== undefined && layers[e.layer] !== true) return e.otherwise ? { ...e.otherwise, at: e.at * scale, index } : null;
    return { ...e, at: e.at * scale, index };
  }).filter(Boolean).sort((a, b) => a.at - b.at);
  let lastBoss = -1;
  events.forEach((e, i) => { if (e.event === 'boss') lastBoss = i; });
  // The run's last boss is marked on its event (0.9.0: the acts insert the deck's events, so an index would move).
  if (lastBoss >= 0) events[lastBoss].final = true;
  return {
    timeScale: scale,
    bands, events, eventIdx: 0, lastBossEvent: lastBoss,
    band: 0,
    // A Tide's health reaches a boss as its power bossTideExp (0.9.0, 0.5: Tide 7's 2.25 is 1.5 on a
    // boss), so a Tide's danger is in the horde all run, not a wall at the last boss (V2).
    hpMul: 1, contactMul: 1, bossHpMul: (world.config.mode === 'short' ? world.tuning.run.shortBossHp : 1) * fpow(world.config.hpMul ?? 1, world.tuning.director.bossTideExp),
    otMaterialMul: 1, otDensity: 1, otHp: 1,
    target: 0, regularAlive: 0, eventAlive: 0, bossesAlive: 0,
    finalBossDead: false,
    overtime: false, overtimeStartTick: 0, overtimeMinutes: 0,
    // Overtime's repeating events (map.overtime.repeat): the tick each comes next, how many times
    // it has come (an elite list is taken in turn), and whether its muster has been announced.
    otNext: new Float64Array((map.overtime.repeat || []).length), otCount: new Int32Array((map.overtime.repeat || []).length),
    otWarned: new Uint8Array((map.overtime.repeat || []).length),
    spawnsRefused: 0,
    otOnce: [],            // overtime's one-shot events (W4): { ev, tick, fired }
    dawn: false,           // the dawn has come (W4): nothing more spawns
  };
}

/** Called when the final boss dies: the run offers the stay-or-leave choice (tuning.run). */
export function finalBossDown(world) {
  const d = world.director;
  d.finalBossDead = true;
  world.result.cleared = true;
  if (world.tuning.run.overtimeChoiceAfterBoss) world.halts.push({ kind: 'overtime' });
}

/** Resolve the overtime choice: { kind: 'stay' } or { kind: 'leave' }. */
export function overtimeDecide(world, d) {
  if (d.kind === 'stay') {
    const D = world.director;
    D.overtime = true;
    D.overtimeStartTick = world.tick;
    (world.map.overtime.repeat || []).forEach((r, j) => { D.otNext[j] = world.tick + Math.round(r.every * TPS * D.timeScale); D.otCount[j] = 0; D.otWarned[j] = 0; });
    // Overtime's one-shots (0.9.0, W4): a boss back, the Long Night.
    D.otOnce = (world.map.overtime.events || []).map((e) => ({ ev: e, tick: world.tick + Math.round(e.at * TPS * D.timeScale), fired: false }));
    actsOnOvertime(world);
    return true;
  }
  if (d.kind === 'leave') { endRun(world, END.CLEARED); return true; }
  throw new Error(`overtime: unknown decision "${d.kind}"`);
}

/** Step 12: scripted events, scaling, and spawns toward the density target. */
export function directorStep(world) {
  const d = world.director, T = world.tuning.director;
  const t = world.tick * DT;
  // Scripted events.
  while (d.eventIdx < d.events.length && d.events[d.eventIdx].at <= t) {
    const idx = d.eventIdx++;
    fireEvent(world, d.events[idx], d.events[idx].final === true, d.events[idx].index);
  }
  // Scaling with time (in timeline minutes, so short runs ramp at the same point of the run).
  const minutes = t / 60 / d.timeScale;
  if (d.overtime) {
    const om = Math.floor((world.tick - d.overtimeStartTick) / 3600);
    if (om > d.overtimeMinutes) {
      d.overtimeMinutes = om;
      const ot = world.map.overtime;
      d.otDensity = fpow(ot.densityPerMin, om);
      d.otHp = fpow(ot.hpPerMin, om);
      const mm = fpow(ot.materialsPerMin, om);
      d.otMaterialMul = ot.materialsCap !== undefined && mm > ot.materialsCap ? ot.materialsCap : mm;
      world.result.overtimeMinutes = om;
      world.events.push(EV.OVERTIME, world.player.x, world.player.y, om);
    }
    if (!d.dawn) { overtimeRepeats(world, d); overtimeOnce(world, d); }
  }
  d.hpMul = (1 + T.hpPerMinute * minutes) * d.otHp * (world.config.hpMul ?? 1);
  d.contactMul = 1 + T.contactPerMinute * minutes;
  threatStep(world, minutes);
  // Density target from the current band.
  while (d.band < d.bands.length - 1 && t >= d.bands[d.band].to) d.band++;
  const b = d.bands[d.band];
  const span = b.to - b.from;
  const f = span > 0 ? Math.min(1, Math.max(0, (t - b.from) / span)) : 1;
  let target = b.d0 + (b.d1 - b.d0) * f;
  const pace = world.tuning.pace;
  target *= T.densityMul * pace.density * b.pace * world.stats.density * d.otDensity * (world.config.densityMul ?? 1);
  // The band's floor (the screen never empties), raised by half a Tide's density step (and the
  // Swarm curse's): Tide 10's 1.5 makes it 1.25.
  const floor = b.min * (1 + ((world.config.densityMul ?? 1) - 1) * T.floorTide);
  if (d.bossesAlive > 0) target *= T.bossDensityMul;
  else if (target < floor) target = floor;
  if (world.config.densityCap !== undefined && target > world.config.densityCap) target = world.config.densityCap;
  if (target > pace.maxAlive) target = pace.maxAlive;
  d.target = target;
  // The Eye: spawns stop while it lasts (sim/storm.js); and after the dawn, for good.
  if ((world.storm !== null && eyeOpen(world)) || d.dawn) return;
  // Spawn toward it. A swimmer that lives in the water comes up in the water near the ring (or
  // not at all); a clump (midges) comes as several together.
  let deficit = Math.floor(target) - d.regularAlive;
  if (deficit > T.maxSpawnPerTick) deficit = T.maxSpawnPerTick;
  // The alive cap counts everyone but a set piece's crowd (a ring, a wall, a flock, a muster's crew:
  // they may pass it while they run, ruling 7): a boss's crew, a bell's, the band's own.
  const room = pace.maxAlive - (world.enemies.count - d.eventAlive);
  if (deficit > room) deficit = room;
  const out = world.scratch.v2, rng = world.rng.spawn, swims = world.enemySwims, defs = world.enemyDefs;
  for (let k = 0; k < deficit; k++) {
    const pick = rng.weighted(b.weights);
    if (pick < 0) break;
    const type = b.types[pick];
    if (swims[type] === SWIMS.water) {
      if (!waterPosition(world, out)) continue;
    } else if (!ringPosition(world, world.tuning.enemies.spawnRing, out)) { d.spawnsRefused++; continue; }
    if (spawnEnemy(world, type, out[0], out[1], null) < 0) { d.spawnsRefused++; break; }
    d.regularAlive++;
    const clump = defs[type].clump ?? 1;
    for (let c = 1; c < clump; c++) {
      const cx = out[0] + (c === 1 ? 7 : -5), cy = out[1] + (c === 1 ? 3 : 6);
      if (world.terrain.blockedAt(cx, cy)) continue;
      if (spawnEnemy(world, type, cx, cy, null) >= 0) d.regularAlive++;
    }
  }
}

/**
 * Where a creek eel comes up: water near the spawn ring (a few tries round it, then closer in, but
 * never on screen). False when there's no water near enough (low water: it doesn't come).
 */
export function waterPosition(world, out) {
  const p = world.player, rng = world.rng.spawn, T = world.terrain, sc = world.scratch.sc;
  const R = world.tuning.enemies.spawnRing;
  for (let tries = 0; tries < 8; tries++) {
    sincosInto(rng.next() * TAU, sc, 0);
    const r = R * (0.95 + 0.25 * rng.next());
    const x = p.x + sc[1] * r, y = p.y + sc[0] * r;
    if (Math.abs(x - p.x) < 330 && Math.abs(y - p.y) < 190) continue;
    if (T.waterAt(Math.floor(x / TILE), Math.floor(y / TILE))) { out[0] = x; out[1] = y; return true; }
  }
  return false;
}

/** Overtime's repeating events: each on its own clock from the start of overtime; a muster announced ahead. */
function overtimeRepeats(world, d) {
  const reps = world.map.overtime.repeat;
  if (!reps) return;
  const p = world.player;
  const warn = Math.round(world.tuning.director.musterWarn * TPS);
  for (let j = 0; j < reps.length; j++) {
    const r = reps[j];
    if (r.event === 'muster' && d.otWarned[j] === 0 && world.tick >= d.otNext[j] - warn) {
      d.otWarned[j] = 1;
      world.events.push(EV.MUSTER_SOON, p.x, p.y, Math.max(0, Math.round((d.otNext[j] - world.tick) / TPS)), j);
    }
    if (world.tick < d.otNext[j]) continue;
    d.otNext[j] += Math.round(r.every * TPS * d.timeScale);
    d.otWarned[j] = 0;
    if (r.pairs) {
      // An elite pairing (W4): this time's pair, in turn.
      const pr = r.pairs[d.otCount[j]++ % r.pairs.length];
      fireEvent(world, { ...r, enemy: pr[0] }, false, -1 - j);
      fireEvent(world, { ...r, enemy: pr[1] }, false, -1 - j);
      continue;
    }
    const ev = r.enemies ? { ...r, enemy: r.enemies[d.otCount[j] % r.enemies.length] } : r;
    d.otCount[j]++;
    fireEvent(world, ev, false, -1 - j);
  }
}

/** Overtime's one-shot events, each once at its time: a boss back, the Long Night (W4). */
function overtimeOnce(world, d) {
  for (const o of d.otOnce) {
    if (o.fired || world.tick < o.tick) continue;
    o.fired = true;
    if (o.ev.event === 'long_night') { longNight(world, o.ev); crowdArrives(world, false); }
    else { spawnBoss(world, o.ev.enemy, o.ev.hpMul ?? 1); crowdArrives(world, false); }
  }
}

/**
 * A dev jump to second `t` (sim/dev.js): the timeline's events before then are skipped, as a jump
 * always did, but a boss it passes still counts (X4: a jump past the first boss left the run in
 * act 1 with no boss, and one past 20:00 had no last boss, so no overtime). Every boss passed
 * begins what its arrival begins (the first: act 2), and the last one passed arrives now.
 */
export function skipEventsTo(world, t) {
  const d = world.director;
  let boss = null;
  while (d.eventIdx < d.events.length && d.events[d.eventIdx].at < t) {
    const ev = d.events[d.eventIdx++];
    if (ev.event !== 'boss') continue;
    boss = ev;
    crowdArrives(world, true);   // (the act's own deck events land after eventIdx; those before t are skipped by this loop too)
  }
  if (boss !== null) fireEvent(world, boss, boss.final === true, boss.index);
}

/**
 * A boss that isn't the run's last (W4: one back in overtime, the Long Night's): on the spawn ring
 * as any boss, its health times hpMul. Returns its boss record, or null.
 */
export function spawnBoss(world, enemyId, hpMul = 1) {
  const type = world.enemyIndex.get(enemyId), out = world.scratch.v2, p = world.player;
  if (type === undefined) return null;
  if (!eventPosition(world, out)) { out[0] = p.x; out[1] = p.y; }
  const e = spawnEnemy(world, type, out[0], out[1], null);
  if (e < 0) return null;
  const b = registerBoss(world, e, false);
  if (hpMul !== 1) { const E = world.enemies; E.maxHp[e] *= hpMul; E.hp[e] = E.maxHp[e]; b.budget = E.maxHp[e]; }
  world.events.push(EV.FINALE, out[0], out[1], 4, type);
  return b;
}

/**
 * A crowd of `count` (times pace.events) rising round (x, y) within `radius` px, walking in as a set
 * piece (EF.EVENT); an elite of `eliteId` among them when given (W4: a cache's guard, a rising).
 */
export function spawnCrowd(world, enemyId, count, x, y, radius, eliteId = null) {
  const type = world.enemyIndex.get(enemyId), sc = world.scratch.sc, T = world.terrain;
  const n = crowdCount(world, count);
  let made = 0;
  for (let k = 0; k < n; k++) {
    sincosInto((k / n) * TAU, sc, 0);
    const r = radius * (0.45 + 0.55 * ((k * 7) % 5) / 4);
    const ex = x + sc[1] * r, ey = y + sc[0] * r;
    if (ex < 8 || ey < 8 || ex > T.width - 8 || ey > T.height - 8 || T.blockedAt(ex, ey)) continue;
    if (spawnEnemy(world, type, ex, ey, EVENT_OPTS) >= 0) made++;
  }
  if (eliteId !== null) {
    const et = world.enemyIndex.get(eliteId);
    if (et !== undefined) spawnEnemy(world, et, T.blockedAt(x, y) ? x + radius * 0.3 : x, y, { elite: true });
  }
  return made;
}

/**
 * A spot on the spawn ring for a scripted elite or boss: random first, then every direction in
 * turn, then a wider ring, so a player in a map corner still gets it (off screen, never on top
 * of them). Returns false only if the whole map around the player is blocked.
 */
function eventPosition(world, out, beyond = 0) {
  const T = world.tuning.enemies;
  if (ringPosition(world, T.spawnRing + beyond, out)) return true;
  const p = world.player, terrain = world.terrain, sc = world.scratch.sc;
  for (const r of [T.spawnRing + beyond, T.spawnRing * 1.5 + beyond]) {
    for (let k = 0; k < 32; k++) {
      sincosInto((k / 32) * TAU, sc, 0);
      const x = p.x + sc[1] * r, y = p.y + sc[0] * r;
      if (x < 8 || y < 8 || x > terrain.width - 8 || y > terrain.height - 8 || terrain.blockedAt(x, y)) continue;
      out[0] = x; out[1] = y;
      return true;
    }
  }
  return false;
}

/** A set piece's walkers (EF.EVENT). */
const EVENT_OPTS = Object.freeze({ event: true });

const FIRE_PICKS = new Float64Array(2);

function fireEvent(world, ev, isFinalBoss, index) {
  if (ev.deck !== undefined && ev.event !== 'cache' && ev.event !== 'trail' && ev.event !== 'rising' && ev.event !== 'fire') deckFired(world, ev, world.player.x, world.player.y);
  const p = world.player, rng = world.rng.spawn, out = world.scratch.v2, sc = world.scratch.sc;
  const T = world.tuning.enemies;
  if (ev.event === 'chest') {
    // A chest on open ground in view, a short walk away.
    for (let k = 0; k < 16; k++) {
      sincosInto(rng.next() * TAU, sc, 0);
      const x = p.x + sc[1] * 120, y = p.y + sc[0] * 120;
      if (x < 16 || y < 16 || x > world.terrain.width - 16 || y > world.terrain.height - 16 || world.terrain.blockedAt(x, y)) continue;
      dropChest(world, x, y, CHEST_ELITE);
      return;
    }
    dropChest(world, p.x, p.y, CHEST_ELITE); // nowhere open nearby: at your feet
    return;
  }
  if (ev.event === 'eye') { startEye(world, ev); return; }
  // The deck's kinds (W4, sim/acts.js): a cache, a trail to one, a rising, a peat fire.
  if (ev.event === 'cache' || ev.event === 'trail') {
    const [cx, cy] = placeCache(world, ev);
    if (ev.event === 'trail') {
      const A = world.tuning.tasks.acts, dx = cx - p.x, dy = cy - p.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
      for (let k = 0; k < ev.gems; k++) {
        const s = A.trailFrom + (d - A.trailFrom - 40) * (k / Math.max(1, ev.gems - 1));
        const gx = p.x + (dx / d) * s, gy = p.y + (dy / d) * s;
        if (!world.terrain.blockedAt(gx, gy)) spawnGem(world, gx, gy, A.trailGem);
      }
    }
    if (ev.deck !== undefined) deckFired(world, ev, cx, cy);
    return;
  }
  if (ev.event === 'rising') {
    const pl = world.map.places.find((x) => x.id === ev.place), T = world.terrain, o = world.scratch.open;
    let rx = (pl.at[0] + 0.5) * TILE, ry = (pl.at[1] + 0.5) * TILE;
    const dx = rx - p.x, dy = ry - p.y, d = Math.sqrt(dx * dx + dy * dy);
    // Out of view: if the place is near you, its far side.
    if (d < 420) { const u = d > 1 ? 1 / d : 0; rx = p.x + (d > 1 ? dx * u : 1) * 440; ry = p.y + (d > 1 ? dy * u : 0) * 440; }
    if (T.nearestOpen(Math.floor(rx / TILE), Math.floor(ry / TILE), o, 24)) { rx = o[0]; ry = o[1]; }
    spawnCrowd(world, ev.enemy, ev.count, rx, ry, 56, null);
    const sp = ev.spoils;
    if (sp) {
      // (No food for a run that can't use it: the Hunger curse, or a character who can't heal.)
      if (!world.config.noFood) for (let k = 0; k < (sp.heal ?? 0); k++) spawnPickup(world, PK.HEAL, rx + (k - 1) * 14, ry + 10, world.map.pickups?.healAmount ?? 30, 0);
      const mi = sp.material ? world.materialIndex.get(sp.material) : undefined;
      if (mi !== undefined) spawnPickup(world, PK.MATERIAL, rx, ry - 12, mi, sp.amount);
    }
    if (ev.deck !== undefined) deckFired(world, ev, rx, ry);
    return;
  }
  if (ev.event === 'fire') {
    // A line of fire across the ground, through the thickest crowd near you: warned rings one after another.
    const out2 = world.scratch.v2;
    let fx = p.x, fy = p.y;
    if (crowdPoint(world, out2, 40, 24, FIRE_PICKS, 0, 0) >= 0) { fx = out2[0]; fy = out2[1]; }
    sincosInto(rng.next() * TAU, sc, 0);
    const ux = sc[1], uy = sc[0];
    for (let k = 0; k < ev.count; k++) {
      const off = (k - (ev.count - 1) / 2) * ev.step, x = fx + ux * off, y = fy + uy * off;
      if (x < 16 || y < 16 || x > world.terrain.width - 16 || y > world.terrain.height - 16) continue;
      strikeAt(world, x, y, ev.radius, ev.warn + Math.abs(k - (ev.count - 1) / 2) * (ev.stagger ?? 0.15), ev.damage, ev.playerDamage ?? 0, STRIKE_SRC.FIRE, 0);
    }
    if (ev.deck !== undefined) deckFired(world, ev, fx, fy);
    return;
  }
  const type = world.enemyIndex.get(ev.enemy);
  const swarm = world.enemyDefs[type].ai.type === 'swarm';
  switch (ev.event) {
    case 'flock': {
      // A few birds in a tight clump from one side, flying straight across (rule 2: never a wall).
      sincosInto(rng.next() * TAU, sc, 0);
      const ux = sc[1], uy = sc[0];
      const cx = p.x - ux * T.spawnRing, cy = p.y - uy * T.spawnRing;
      const count = crowdCount(world, ev.count);
      let made = 0;
      for (let k = 0; k < count; k++) {
        const a = (k / count) * TAU;
        sincosInto(a, sc, 0);
        const r = k === 0 ? 0 : 10 + (k % 3) * 4;
        const x = cx + sc[1] * r, y = cy + sc[0] * r;
        if (x < 8 || y < 8 || x > world.terrain.width - 8 || y > world.terrain.height - 8) continue;
        if (spawnEnemy(world, type, x, y, { swarmDir: [ux, uy], event: true }) >= 0) made++;
      }
      world.events.push(EV.SWARM, cx, cy, 3, made);
      break;
    }
    case 'elite': {
      // A Tide's pack (data/tide.js): the others walk in beside the first, without a chest.
      if (!eventPosition(world, out)) break;
      const x0 = out[0], y0 = out[1], pack = world.tideRules.elitePack;
      spawnEnemy(world, type, x0, y0, { elite: true });
      for (let k = 1; k < pack; k++) {
        sincosInto((k / pack) * TAU, sc, 0);
        let x = x0 + sc[1] * 28, y = y0 + sc[0] * 28;
        if (x < 8 || y < 8 || x > world.terrain.width - 8 || y > world.terrain.height - 8 || world.terrain.blockedAt(x, y)) { x = x0; y = y0; }
        const e = spawnEnemy(world, type, x, y, { elite: true });
        if (e >= 0) world.enemies.boss[e] = NO_CHEST;
      }
      break;
    }
    case 'muster': {
      // An elite captain off screen with its crew in a ring around it; they walk in together.
      // The captain stands out past the spawn ring by the crew's radius, so no one of them
      // appears on screen. He drops a boss chest (MUSTER_CAPTAIN). With no open ground anywhere
      // around you, he comes at your feet, as a boss would.
      if (!eventPosition(world, out, ev.radius)) { out[0] = p.x; out[1] = p.y; }
      const cx = out[0], cy = out[1];
      const e = spawnEnemy(world, type, cx, cy, { elite: true, affixes: 0 });
      if (e < 0) break;
      world.enemies.boss[e] = MUSTER_CAPTAIN;
      if (ev.champion !== undefined) makeChampion(world, e, ev, index);
      const esc = world.enemyIndex.get(ev.escort), terrain = world.terrain;
      const crew = crowdCount(world, ev.count, world.tideRules.musterMul);
      let made = 0;
      for (let k = 0; k < crew; k++) {
        sincosInto((k / crew) * TAU, sc, 0);
        const x = cx + sc[1] * ev.radius, y = cy + sc[0] * ev.radius;
        if (x < 8 || y < 8 || x > terrain.width - 8 || y > terrain.height - 8 || terrain.blockedAt(x, y)) continue;
        if (spawnEnemy(world, esc, x, y, EVENT_OPTS) >= 0) made++;
      }
      world.events.push(EV.MUSTER, cx, cy, made, world.enemies.handle(e), index);
      crowdArrives(world, false);   // a banked Lantern Night falls (sim/tasks.js)
      break;
    }
    case 'boss': {
      if (!eventPosition(world, out)) { out[0] = p.x; out[1] = p.y; } // a map with no open ground at all
      const e = spawnEnemy(world, type, out[0], out[1], null);
      if (e >= 0) registerBoss(world, e, isFinalBoss);
      crowdArrives(world, true);    // a banked Lantern Night falls, and the fog takes the lamps back (sim/tasks.js)
      break;
    }
    case 'wall': {
      // A line from one side. Swarmers fly straight across and past you; anything else in a wall
      // walks at you from where the line stood.
      sincosInto(rng.next() * TAU, sc, 0);
      const ux = sc[1], uy = sc[0];
      const gap = 12, count = crowdCount(world, ev.count, world.tideRules.swarmMul);
      const cx = p.x - ux * T.spawnRing, cy = p.y - uy * T.spawnRing;
      let made = 0;
      for (let k = 0; k < count; k++) {
        const off = (k - (count - 1) / 2) * gap;
        const x = cx - uy * off, y = cy + ux * off;
        if (x < 8 || y < 8 || x > world.terrain.width - 8 || y > world.terrain.height - 8) continue;
        if (!swarm && world.terrain.blockedAt(x, y)) continue;
        const e = spawnEnemy(world, type, x, y, swarm ? { swarmDir: [ux, uy], event: true } : EVENT_OPTS);
        if (e < 0) continue;
        if (ev.speed !== undefined) world.enemies.speed[e] = ev.speed;
        made++;
      }
      world.events.push(EV.SWARM, cx, cy, 1, made);
      break;
    }
    case 'ring': {
      // A ring closing in from just off screen (swarmers fly straight through the middle).
      const r = ev.radius ?? T.spawnRing;
      const count = crowdCount(world, ev.count, world.tideRules.swarmMul);
      let made = 0;
      for (let k = 0; k < count; k++) {
        sincosInto((k / count) * TAU, sc, 0);
        const x = p.x + sc[1] * r, y = p.y + sc[0] * r;
        if (x < 8 || y < 8 || x > world.terrain.width - 8 || y > world.terrain.height - 8) continue;
        if (!swarm && world.terrain.blockedAt(x, y)) continue;
        const e = spawnEnemy(world, type, x, y, swarm ? { swarmDir: [-sc[1], -sc[0]], event: true } : EVENT_OPTS);
        if (e < 0) continue;
        if (ev.speed !== undefined) world.enemies.speed[e] = ev.speed;
        made++;
      }
      world.events.push(EV.SWARM, p.x, p.y, 2, made);
      break;
    }
    default:
      throw new Error(`Map ${world.map.id}: unknown timeline event "${ev.event}"`);
  }
}
