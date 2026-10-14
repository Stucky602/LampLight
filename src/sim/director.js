// The spawn director (ARCHITECTURE §5.7).
//
// Keeps the number of regular enemies near the map timeline's density target, spawning on a
// ring just outside the view (never on screen), and fires the timeline's scripted events at
// their times: swarm walls, closing rings, elites, chests, and the bosses at 10:00 and 20:00.
// A map's timeline and overtime data are checked when the run starts, so a mistake in data
// fails at 0:00 with a plain message instead of in the middle of a run.
// Enemy HP and contact damage grow with time. After the last boss the player may stay in
// overtime, where density, HP, and material yield compound every minute. Short run mode
// compresses the whole timeline (bosses at 5:00 and 10:00).

import { DT } from './constants.js';
import { EV, END } from './events.js';
import { spawnEnemy, ringPosition } from './enemies.js';
import { dropChest, CHEST_ELITE } from './chests.js';
import { registerBoss } from './bosses.js';
import { fpow, sincosInto, TAU } from '../lib/fmath.js';
import { endRun } from './run-result.js';

const EVENT_TYPES = new Set(['elite', 'boss', 'wall', 'ring', 'chest']);
const VIEW_HALF_DIAGONAL = 368; // px: a ring any tighter than this would spawn on screen (640 x 360 view)

/** Check a map's timeline and overtime data; throws a plain message on the first problem. */
export function checkTimeline(map, enemyIndex, enemyDefs) {
  const at = (e) => `Map ${map.id}: the ${e.event} event at ${e.at} s`;
  if (!map.timeline || !Array.isArray(map.timeline.bands) || map.timeline.bands.length === 0) throw new Error(`Map ${map.id}: the timeline has no bands`);
  for (const b of map.timeline.bands) {
    for (const id of Object.keys(b.roster)) {
      const t = enemyIndex.get(id);
      if (t === undefined) throw new Error(`Map ${map.id}: unknown enemy "${id}" in the band from ${b.from} s`);
      // Swarmers fly through and away; as density filler they'd be spawned over and over.
      if (enemyDefs[t].ai.type === 'swarm' || enemyDefs[t].ai.type === 'boss') throw new Error(`Map ${map.id}: "${id}" can't be in a band roster (swarmers come in walls and rings, bosses from boss events)`);
    }
  }
  for (const e of map.timeline.events || []) {
    if (!EVENT_TYPES.has(e.event)) throw new Error(`${at(e)}: unknown event type (known: ${[...EVENT_TYPES].join(', ')})`);
    if (!(e.at >= 0)) throw new Error(`${at(e)}: needs a time`);
    if (e.event === 'chest') continue;
    const t = enemyIndex.get(e.enemy);
    if (t === undefined) throw new Error(`${at(e)}: unknown enemy "${e.enemy}"`);
    if ((enemyDefs[t].ai.type === 'boss') !== (e.event === 'boss')) throw new Error(`${at(e)}: bosses come only from boss events, and boss events only spawn bosses`);
    if ((e.event === 'wall' || e.event === 'ring') && !(Number.isInteger(e.count) && e.count > 0)) throw new Error(`${at(e)}: needs a whole-number count`);
    if (e.speed !== undefined && !(e.speed > 0)) throw new Error(`${at(e)}: speed must be above 0`);
    if (e.radius !== undefined && !(e.radius >= VIEW_HALF_DIAGONAL)) throw new Error(`${at(e)}: a ring radius under ${VIEW_HALF_DIAGONAL} px would spawn on screen`);
  }
  const ot = map.overtime;
  if (!ot || !(ot.densityPerMin > 0 && ot.hpPerMin > 0 && ot.materialsPerMin > 0)) throw new Error(`Map ${map.id}: overtime needs densityPerMin, hpPerMin, and materialsPerMin`);
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
    return { from: b.from * scale, to: b.to * scale, d0: b.density[0], d1: b.density[1], types, weights };
  });
  const events = (map.timeline.events || []).map((e) => ({ ...e, at: e.at * scale })).sort((a, b) => a.at - b.at);
  let lastBoss = -1;
  events.forEach((e, i) => { if (e.event === 'boss') lastBoss = i; });
  return {
    timeScale: scale,
    bands, events, eventIdx: 0, lastBossEvent: lastBoss,
    band: 0,
    hpMul: 1, contactMul: 1, bossHpMul: world.config.mode === 'short' ? world.tuning.run.shortBossHp : 1,
    materialMul: 1, otDensity: 1, otHp: 1,
    target: 0, regularAlive: 0, bossesAlive: 0,
    finalBossDead: false,
    overtime: false, overtimeStartTick: 0, overtimeMinutes: 0,
    spawnsRefused: 0,
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
    world.director.overtime = true;
    world.director.overtimeStartTick = world.tick;
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
    fireEvent(world, d.events[idx], idx === d.lastBossEvent);
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
      d.materialMul = fpow(ot.materialsPerMin, om);
      world.result.overtimeMinutes = om;
      world.events.push(EV.OVERTIME, world.player.x, world.player.y, om);
    }
  }
  d.hpMul = (1 + T.hpPerMinute * minutes) * d.otHp * (world.config.hpMul ?? 1);
  d.contactMul = 1 + T.contactPerMinute * minutes;
  // Density target from the current band.
  while (d.band < d.bands.length - 1 && t >= d.bands[d.band].to) d.band++;
  const b = d.bands[d.band];
  const span = b.to - b.from;
  const f = span > 0 ? Math.min(1, Math.max(0, (t - b.from) / span)) : 1;
  let target = b.d0 + (b.d1 - b.d0) * f;
  target *= T.densityMul * world.stats.density * d.otDensity * (world.config.densityMul ?? 1);
  if (d.bossesAlive > 0) target *= T.bossDensityMul;
  if (world.config.densityCap !== undefined && target > world.config.densityCap) target = world.config.densityCap;
  if (target > T.maxEnemies) target = T.maxEnemies;
  d.target = target;
  // Spawn toward it.
  let deficit = Math.floor(target) - d.regularAlive;
  if (deficit > T.maxSpawnPerTick) deficit = T.maxSpawnPerTick;
  const out = world.scratch.v2, rng = world.rng.spawn;
  for (let k = 0; k < deficit; k++) {
    const pick = rng.weighted(b.weights);
    if (pick < 0) break;
    if (!ringPosition(world, world.tuning.enemies.spawnRing, out)) { d.spawnsRefused++; continue; }
    if (spawnEnemy(world, b.types[pick], out[0], out[1], null) < 0) { d.spawnsRefused++; break; }
    d.regularAlive++;
  }
}

/**
 * A spot on the spawn ring for a scripted elite or boss: random first, then every direction in
 * turn, then a wider ring, so a player in a map corner still gets it (off screen, never on top
 * of them). Returns false only if the whole map around the player is blocked.
 */
function eventPosition(world, out) {
  const T = world.tuning.enemies;
  if (ringPosition(world, T.spawnRing, out)) return true;
  const p = world.player, terrain = world.terrain, sc = world.scratch.sc;
  for (const r of [T.spawnRing, T.spawnRing * 1.5]) {
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

function fireEvent(world, ev, isFinalBoss) {
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
  const type = world.enemyIndex.get(ev.enemy);
  const swarm = world.enemyDefs[type].ai.type === 'swarm';
  switch (ev.event) {
    case 'elite': {
      if (eventPosition(world, out)) spawnEnemy(world, type, out[0], out[1], { elite: true });
      break;
    }
    case 'boss': {
      if (!eventPosition(world, out)) { out[0] = p.x; out[1] = p.y; } // a map with no open ground at all
      const e = spawnEnemy(world, type, out[0], out[1], null);
      if (e >= 0) registerBoss(world, e, isFinalBoss);
      break;
    }
    case 'wall': {
      // A line from one side. Swarmers fly straight across and past you; anything else in a wall
      // walks at you from where the line stood.
      sincosInto(rng.next() * TAU, sc, 0);
      const ux = sc[1], uy = sc[0];
      const gap = 12, count = ev.count;
      const cx = p.x - ux * T.spawnRing, cy = p.y - uy * T.spawnRing;
      let made = 0;
      for (let k = 0; k < count; k++) {
        const off = (k - (count - 1) / 2) * gap;
        const x = cx - uy * off, y = cy + ux * off;
        if (x < 8 || y < 8 || x > world.terrain.width - 8 || y > world.terrain.height - 8) continue;
        if (!swarm && world.terrain.blockedAt(x, y)) continue;
        const e = spawnEnemy(world, type, x, y, swarm ? { swarmDir: [ux, uy] } : null);
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
      const count = ev.count;
      let made = 0;
      for (let k = 0; k < count; k++) {
        sincosInto((k / count) * TAU, sc, 0);
        const x = p.x + sc[1] * r, y = p.y + sc[0] * r;
        if (x < 8 || y < 8 || x > world.terrain.width - 8 || y > world.terrain.height - 8) continue;
        if (!swarm && world.terrain.blockedAt(x, y)) continue;
        const e = spawnEnemy(world, type, x, y, swarm ? { swarmDir: [-sc[1], -sc[0]] } : null);
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
