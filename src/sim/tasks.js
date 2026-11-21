// Run tasks (ARCHITECTURE §5.18, §5.20; the map's: data/maps.js `sites` and `acts`, or a test map's
// fixed `tasks`; the numbers: tuning.tasks). Places on the map with something to do there, and no
// timer: a task only moves while you're doing it, and waits for you when you leave. What one asks
// and what it gives grow with the minute you start it, so one put off until late costs more and
// pays more. 0.9.0 (W4, ruling 6): the run comes in three acts (sim/acts.js), each bringing its own
// lamps and bells at sites drawn for the run; lit lamps stay lit for the rest of the run.
//
//   Wayside Lamp  stay inside its ring until it's lit (moving is fine). A lit lamp is a ward: a
//                 pool of light that burns every enemy standing in it (an ordinary one in about
//                 tuning.tasks.ward.killSec), and it watches the ground (what drops in it is
//                 marked: sim/pickups.js). It pays Pearls. Every lamp lit at once banks Lantern
//                 Night, which falls when the crowd closes in round you or a muster or boss
//                 arrives: the fog lifts, your light burns what stands in it, and when it ends a
//                 vault drops ahead of you (one relic of three, a tier better). A held lamp (an
//                 act's twist) takes longer, a crowd gathers round it and walks in every few
//                 seconds while you light it, and it pays a chest.
//   Fog Bell      its small ring tolls it (filling while you're inside, moving allowed). A crew as
//                 big as the kills it needs gathers in the fog round it and walks in; kills inside
//                 its ring count down, and so does each of its crew wherever it falls. At none
//                 left it rings: what's inside is dazed, Pearls, and a chest at the bell whose
//                 reward is a pick: a weapon or passive gains 2 levels. An elite may lead its crew.
//   Crane         (the Drowned Docks) its ring fills while you're inside; then its loads drop on
//                 the thickest crowd near it. Ready again each act.
//   Salt Cairn    (the Salt Marsh) its ring fills; then the storm works the ground round it a while.
//                 Ready again each act.

import { DT, TPS, PK, TASK, TASK_STATE, RELIC_SLOT, EF, EF_GONE, SWIMS, BELL_CREW_MAX } from './constants.js';
import { EV, SIGHT, HIT_QUIET, TWIST, TELE, TIER } from './events.js';
import { runMinute, addGlass, relicPool } from './relics.js';
import { spawnPickup } from './pickups.js';
import { damageEnemyR, spawnEnemy } from './enemies.js';
import { dazeEnemy } from './holds.js';
import { sightThing } from './sight.js';
import { CHEST_BELL, CHEST_ELITE } from './chests.js';
import { sincosInto, TAU } from '../lib/fmath.js';
import { createActs, makeTask, placeAt, actsOnBoss, actsStep, workDone, workStep, hashActs } from './acts.js';
// 0.9.0 (W2, ruling 2): the characters' trades reach the lamps, Lantern Night, and the bells.
import { lampRate, wardMul, nightsBank, nightAgain, nightCrowd, nightLight, bellAgain, bellCrewMul } from './trades.js';

const KINDS = Object.freeze({ lamp: TASK.LAMP, bell: TASK.BELL });

/**
 * The run's tasks, each on open ground: { kind, x, y, state, progress, need, glass, touch, crewN,
 * crewX, crewY, crewTick, outTick, act, place, twist, wave, uses, next }. touch: a bell's, crane's,
 * or cairn's start ring, filled (s). crew*: where a tolled bell's crew (or a held lamp's crowd)
 * gathers, and the tick it walks in (-1 none); for a crane or cairn, crewTick is its next load.
 * outTick: always -1 since 0.9.0 (the fog no longer takes lamps back; kept for the record's shape).
 * A map's fixed `tasks` (test maps) come first; then its acts add theirs (sim/acts.js).
 */
export function createTasks(world) {
  const list = (world.map.tasks || []).map((t) => {
    const kind = KINDS[t.kind];
    if (!kind) throw new Error(`Map ${world.map.id}: unknown task "${t.kind}" (lamp or bell)`);
    if (!Array.isArray(t.at)) throw new Error(`Map ${world.map.id}: a task or the skiff needs \`at: [col, row]\` in whole tiles`);
    return makeTask(world, kind, t.at[0], t.at[1], 1, placeAt(world.map, t.at[0], t.at[1]), 0);
  });
  world.tasks = list;
  createActs(world);
  return list;
}

/** What a map holds, for the gate's map card (plain data from the map's own data). */
export function mapHolds(map) {
  const tasks = map.tasks || [], acts = map.acts || null;
  return {
    lamps: acts ? acts[0].lamps : tasks.filter((t) => t.kind === 'lamp').length,
    bells: acts ? acts[0].bells : tasks.filter((t) => t.kind === 'bell').length,
    acts: acts ? acts.length : 1,
    cranes: (map.cranes || []).length, cairns: (map.cairns || []).length,
    places: (map.places || []).length,
    longNight: (map.overtime?.events || []).some((e) => e.event === 'long_night'),
    ferry: (map.ferry?.moorings?.length ?? 0) > 0,
    secrets: (map.secrets || []).filter((s) => !s.gift).map((s) => ({ id: s.id, name: s.name })),
    finds: (map.secrets || []).filter((s) => s.gift).length,
  };
}

/** How far a task's ring reaches, in px (a Fog Bell's kill ring grows with the Chapel). */
export function taskRadius(world, t) {
  const T = world.tuning.tasks;
  if (t.kind === TASK.LAMP) return T.lamp.radius;
  if (t.kind === TASK.CRANE) return T.crane.ring;
  if (t.kind === TASK.CAIRN) return T.cairn.ring;
  return T.bell.radius * (1 + (world.config.harbor?.bellRing ?? 0));
}

/** A lit lamp's ward now, px: its full reach; 0 unlit. (0.9.0: lamps stay lit.) */
export function ward(world, i) {
  const t = world.tasks[i];
  if (t.kind !== TASK.LAMP || t.state !== TASK_STATE.DONE) return 0;
  return world.tuning.tasks.ward.radius * wardMul(world);   // (the Lamplighter's reach twice as far)
}

/** The lamp whose ward (x, y) lies in, plus one; 0 for none (sim/pickups.js marks drops there). */
export function wardAt(world, x, y) {
  const tasks = world.tasks;
  if (tasks === null) return 0;
  const r = world.tuning.tasks.ward.radius * wardMul(world), r2 = r * r;
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    if (t.kind !== TASK.LAMP || t.state !== TASK_STATE.DONE) continue;
    const dx = x - t.x, dy = y - t.y;
    if (dx * dx + dy * dy <= r2) return i + 1;
  }
  return 0;
}

/** A task starts: what it asks and gives is set by the minute. */
function start(world, t, i) {
  const T = world.tuning.tasks, m = runMinute(world);
  const own = t.kind === TASK.LAMP ? T.lamp : T.bell;
  t.state = TASK_STATE.ACTIVE;
  t.progress = 0;
  if (t.kind === TASK.LAMP) {
    t.need = (own.baseSec + own.perMinSec * m) * (t.twist === TWIST.HELD ? T.held.mul : 1);
    t.next = world.tick;     // a held lamp's first crowd gathers at once
  } else t.need = Math.min(BELL_CREW_MAX, Math.round((own.baseKills + own.perMinKills * m) * bellCrewMul(world, i)));   // (a bell's second ring for the Tide Priest: a bigger crew)
  t.glass = world.pearlsOn ? Math.round((own.glass[0] + own.glass[1] * m) * (t.twist === TWIST.HELD ? T.held.pearlsMul : 1)) : 0;
  if (t.kind === TASK.BELL) planCrew(world, t, t.need, T.bell.crewRadius);
  world.events.push(EV.TASK, t.x, t.y, t.kind, 1, i, 0);
}

/**
 * A crew gathers round a task (a tolled bell's, idea 2; a held lamp's crowd, 0.9.0): n places in
 * the fog `radius` px out (falling back closer or farther on blocked ground), walking in after gatherSec.
 */
function planCrew(world, t, n, radius) {
  const B = world.tuning.tasks.bell, sc = world.scratch.sc, rng = world.rng.spawn, terrain = world.terrain;
  const phase = rng.next();
  let made = 0;
  for (let k = 0; k < n; k++) {
    for (const f of [1, 0.8, 1.2, 0.6]) {
      sincosInto(((k + phase) / n) * TAU, sc, 0);
      const x = t.x + sc[1] * radius * f, y = t.y + sc[0] * radius * f;
      if (x < 8 || y < 8 || x > terrain.width - 8 || y > terrain.height - 8 || terrain.blockedAt(x, y)) continue;
      t.crewX[made] = x; t.crewY[made] = y; made++;
      break;
    }
  }
  t.crewN = made;
  t.crewTick = world.tick + Math.max(1, Math.round(B.gatherSec * TPS));
}

/** The gathered crew walks in (a bell's counts for it; an elite may lead it: the act's twist). */
function crewIn(world, t, i) {
  const d = world.director, b = d.bands[d.band], rng = world.rng.spawn, swims = world.enemySwims;
  const bell = t.kind === TASK.BELL;
  t.crewTick = -1;
  for (let k = 0; k < t.crewN; k++) {
    let type = b.types[rng.weighted(b.weights)];
    if (swims[type] === SWIMS.water) type = b.types.find((x) => swims[x] !== SWIMS.water) ?? -1;
    if (type < 0) break;
    const elite = bell && k === 0 && t.twist === TWIST.ELITE_CREW;
    const e = spawnEnemy(world, type, t.crewX[k], t.crewY[k], elite ? ELITE_OPTS : bell ? null : HELD_OPTS);
    if (e < 0) break;
    if (bell) world.enemies.crew[e] = i + 1;   // its kill counts for this bell wherever it falls
  }
  world.events.push(EV.TASK, t.x, t.y, t.kind, 4, i, t.crewN);
}
const ELITE_OPTS = Object.freeze({ elite: true });
const HELD_OPTS = Object.freeze({ event: true });   // a held lamp's crowd is a set piece (it may pass maxAlive)

function done(world, t, i) {
  t.state = TASK_STATE.DONE;
  addGlass(world, t.glass, t.x, t.y);
  world.events.push(EV.TASK, t.x, t.y, t.kind, 2, i, t.glass);
  const r = world.result;
  if (t.kind === TASK.LAMP) {
    t.crewTick = -1;
    r.lampsLit++;
    if (t.twist === TWIST.HELD) { r.heldLamps++; spawnPickup(world, PK.CHEST, t.x, t.y + 14, CHEST_ELITE, 0); }
    let lit = 0, all = 0;
    for (const x of world.tasks) if (x.kind === TASK.LAMP) { all++; if (x.state === TASK_STATE.DONE) lit++; }
    if (lit > r.lampsMost) r.lampsMost = lit;
    if (lit === all) bankNight(world, t);
  } else {
    r.bellsRung++;      // every ring (what the orders and the profile count: her second rings are rings)
    t.uses++;           // this bell's rings (the ledger counts a bell once: runLedger)
    // The wave: everything inside the ring is dazed for a moment.
    const q = world.scratch.qreg, near = world.scratch.near, E = world.enemies;
    q[0] = t.x; q[1] = t.y; q[2] = taskRadius(world, t);
    const m = world.enemyHash.queryR(q, near, -1);
    world.scratch.hold[0] = world.tuning.tasks.bell.dazeSec;
    for (let k = 0; k < m; k++) if ((E.flags[near[k]] & EF_GONE) === 0) dazeEnemy(world, near[k]);
    spawnPickup(world, PK.CHEST, t.x, t.y + 12, CHEST_BELL, 0);
    // The Tide Priest (W2): a bell rings twice for her; once rung, it can be tolled again.
    if (bellAgain(world, i)) { t.state = TASK_STATE.IDLE; t.progress = 0; t.touch = 0; t.crewTick = -1; t.crewN = 0; }
  }
}

/** A crane's or cairn's ring filled: it works (sim/acts.js), and pays Pearls. */
function workBegins(world, t, i) {
  const own = t.kind === TASK.CRANE ? world.tuning.tasks.crane : world.tuning.tasks.cairn, m = runMinute(world);
  t.state = TASK_STATE.DONE;
  t.glass = world.pearlsOn ? Math.round(own.glass[0] + own.glass[1] * m) : 0;
  addGlass(world, t.glass, t.x, t.y);
  workDone(world, t);
  world.events.push(EV.TASK, t.x, t.y, t.kind, 2, i, t.glass);
}

// ---------------------------------------------------------------- Lantern Night

/** Every lamp lit at once: Lantern Night is banked, to fall when the crowd closes in (idea 4). */
function bankNight(world, last) {
  const n = world.night;
  n.banked = true;
  nightsBank(world);   // (the Lamplighter banks two: sim/trades.js)
  world.events.push(EV.NIGHT, last.x, last.y, 2, 0, n.count);
}

/**
 * Lantern Night falls (cause 1 the crowd, 2 a muster or boss arriving). Its burn is the tuning's
 * times the pace dial's health and grows with the minute (as enemy health does), so it can't fall
 * behind the crowd it burns.
 */
function fallNight(world, cause) {
  const N = world.tuning.tasks.night, n = world.night, p = world.player;
  n.banked = false;
  n.burn = N.burn * world.tuning.pace.hp * (1 + N.burnPerMin * runMinute(world));
  n.sec = N.sec * world.tideRules.nightMul;                                // a Tide's shorter night (the notice reads it)
  n.until = world.tick + Math.round(n.sec * TPS);
  n.next = world.tick;
  n.count++;
  world.result.lanternNight = true;
  world.result.nights = n.count;
  world.events.push(EV.NIGHT, p.x, p.y, 1, cause, n.count);
}

/**
 * A muster or a boss arrives (sim/director.js): a banked Lantern Night falls. 0.9.0 (ruling 6): the
 * lamps stay lit; the first boss's arrival begins act 2 instead (sim/acts.js).
 */
export function crowdArrives(world, boss) {
  const n = world.night;
  if (n.banked && n.until < 0) fallNight(world, 2);
  if (boss) actsOnBoss(world);
}

/** Lantern Night's pulses, its end, the vault a moment later, and a banked night watching for the crowd. */
function nightStep(world) {
  const n = world.night, N = world.tuning.tasks.night, p = world.player;
  if (n.vaultTick >= 0 && world.tick >= n.vaultTick) {
    n.vaultTick = -1;
    // Ahead of you, where you're walking (or facing), on ground you can stand on.
    const x = p.x + p.fx * N.vaultAhead, y = p.y + p.fy * N.vaultAhead;
    const T = world.terrain;
    const inMap = x > 8 && y > 8 && x < T.width - 8 && y < T.height - 8;
    spawnPickup(world, PK.VAULT, inMap ? x : p.x, inMap ? y : p.y + N.vaultAhead, 0, 0);
  }
  if (n.until < 0) {
    if (n.banked && world.tick % 6 === 0) {
      const q = world.scratch.qreg, near = world.scratch.near, E = world.enemies;
      q[0] = p.x; q[1] = p.y; q[2] = N.crowdRadius;
      const m = world.enemyHash.queryR(q, near, -1);
      let c = 0;
      for (let k = 0; k < m; k++) if ((E.flags[near[k]] & EF_GONE) === 0) c++;
      if (c >= nightCrowd(world)) fallNight(world, 1);
    }
    return;
  }
  if (world.tick >= n.until) {
    n.until = -1;
    n.vaultTick = world.tick + Math.max(1, Math.round(N.vaultDelay * TPS));
    world.events.push(EV.NIGHT, p.x, p.y, 0, 0, n.count);
    if (nightAgain(world)) { n.banked = true; world.events.push(EV.NIGHT, p.x, p.y, 2, 0, n.count); }   // her second night, banked again
    return;
  }
  if (world.tick < n.next) return;
  n.next = world.tick + Math.max(1, Math.round(N.every * TPS));
  const near = world.scratch.near, q = world.scratch.qreg;
  q[0] = p.x; q[1] = p.y; q[2] = N.light * nightLight(world);
  const m = world.enemyHash.queryR(q, near, -1);
  const E = world.enemies;
  for (let k = 0; k < m; k++) {
    const e = near[k];
    if ((E.flags[e] & EF.DEAD) !== 0) continue;
    world.scratch.num[0] = n.burn;
    world.hitQuiet = HIT_QUIET;
    damageEnemyR(world, e, RELIC_SLOT, false);
    world.hitQuiet = 0;
  }
}

// ---------------------------------------------------------------- the wards

/** Each pulse, every lit lamp burns what stands in its light: a share of each enemy's own health. */
function wardStep(world) {
  const W = world.tuning.tasks.ward, tasks = world.tasks;
  if (world.tick < world.wardNext) return;
  world.wardNext = world.tick + Math.max(1, Math.round(W.every * TPS));
  const share = W.every / W.killSec, p = world.player, q = world.scratch.qreg, near = world.scratch.near, E = world.enemies, num = world.scratch.num;
  const r = W.radius * wardMul(world);
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    if (t.kind !== TASK.LAMP || t.state !== TASK_STATE.DONE) continue;
    // Past the spawn ring's reach nothing stands near a lamp (stragglers jump ahead of you).
    const dx = t.x - p.x, dy = t.y - p.y;
    if (dx * dx + dy * dy > 1000 * 1000) continue;
    q[0] = t.x; q[1] = t.y; q[2] = r;
    const m = world.enemyHash.queryR(q, near, -1);
    for (let k = 0; k < m; k++) {
      const e = near[k];
      if ((E.flags[e] & EF_GONE) !== 0) continue;
      num[0] = E.maxHp[e] * share * ((E.flags[e] & (EF.ELITE | EF.BOSS)) !== 0 ? W.eliteShare : 1);
      world.hitQuiet = HIT_QUIET;
      damageEnemyR(world, e, RELIC_SLOT, false);
      world.hitQuiet = 0;
    }
  }
}

// ---------------------------------------------------------------- each tick

/** A held lamp under way: while you light it, a crowd gathers round it every few seconds. */
function heldStep(world, t, i, inside) {
  const H = world.tuning.tasks.held;
  if (t.crewTick >= 0 && world.tick >= t.crewTick) { crewIn(world, t, i); return; }
  if (!inside || t.crewTick >= 0 || world.tick < t.next) return;
  t.next = world.tick + Math.max(1, Math.round(H.every * TPS));
  t.wave++;
  planCrew(world, t, Math.min(BELL_CREW_MAX, Math.max(1, Math.round(H.count * world.tuning.pace.events))), H.radius);
  // The fog closing in round it: an ordinary dim tell (never one of the full ones).
  world.events.push(EV.TELEGRAPH, t.x, t.y, TELE.RING, Math.max(1, Math.round(world.tuning.tasks.bell.gatherSec * TPS)), H.radius, 0);
  world.events.push(EV.TELE_TIER, t.x, t.y, TIER.DIM, -1, Math.max(1, Math.round(world.tuning.tasks.bell.gatherSec * TPS)), -1);
}

/** Each tick, after you move: the tasks you're at, the wards, Lantern Night, the acts. */
export function tasksStep(world) {
  const tasks = world.tasks;
  const p = world.player, B = world.tuning.tasks.bell;
  const speed = 1 + (world.config.harbor?.lampSpeed ?? 0);
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    if (t.kind === TASK.LAMP) {
      if (t.state === TASK_STATE.DONE) continue;
      const r = taskRadius(world, t), dx = p.x - t.x, dy = p.y - t.y;
      const inside = dx * dx + dy * dy <= r * r;
      if (t.twist === TWIST.HELD && t.state === TASK_STATE.ACTIVE) heldStep(world, t, i, inside);
      if (!inside) continue;
      if (t.state === TASK_STATE.IDLE) start(world, t, i);
      t.progress += DT * speed * lampRate(world, t);   // (the Lamplighter's at a touch)
      if (t.progress >= t.need) done(world, t, i);
    } else if (t.kind === TASK.BELL) {
      if (t.state === TASK_STATE.IDLE) {
        // The bell's start ring: fills while you're inside, empties when you leave.
        const dx = p.x - t.x, dy = p.y - t.y;
        if (dx * dx + dy * dy > B.startRadius * B.startRadius) { t.touch = 0; continue; }
        t.touch += DT;
        if (t.touch + 1e-9 >= B.openSec) { t.touch = 0; start(world, t, i); }
      } else if (t.state === TASK_STATE.ACTIVE && t.crewTick >= 0 && world.tick >= t.crewTick) crewIn(world, t, i);
    } else {
      // A crane or a cairn: its ring fills while you're inside; then it works a while.
      if (t.state === TASK_STATE.DONE) { workStep(world, t, i); continue; }
      const own = t.kind === TASK.CRANE ? world.tuning.tasks.crane : world.tuning.tasks.cairn;
      const dx = p.x - t.x, dy = p.y - t.y;
      if (dx * dx + dy * dy > own.ring * own.ring) { t.touch = 0; continue; }
      t.touch += DT;
      if (t.touch + 1e-9 >= own.openSec) { t.touch = 0; workBegins(world, t, i); }
    }
  }
  wardStep(world);
  nightStep(world);
  actsStep(world);
  // First sightings: a lamp or bell within the view (the field guide).
  if (world.tick % 30 === 0 && (world.seenThings & ((1 << SIGHT.LAMP) | (1 << SIGHT.BELL))) !== ((1 << SIGHT.LAMP) | (1 << SIGHT.BELL))) {
    for (const t of tasks) {
      if (t.kind !== TASK.LAMP && t.kind !== TASK.BELL) continue;
      if (Math.abs(t.x - p.x) < 320 && Math.abs(t.y - p.y) < 180) sightThing(world, t.kind === TASK.LAMP ? SIGHT.LAMP : SIGHT.BELL);
    }
  }
}

/**
 * A kill at (x, y) (sim/enemies.js resolveDeaths): it counts for every tolled bell whose ring it's
 * in, and a bell's own crew (crew: its task index + 1) counts for it wherever it falls (your
 * weapons reach past the ring, and the crew you called is the fight you chose).
 */
export function bellKill(world, x, y, crew) {
  const tasks = world.tasks;
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    if (t.kind !== TASK.BELL || t.state !== TASK_STATE.ACTIVE) continue;
    const r = taskRadius(world, t), dx = x - t.x, dy = y - t.y;
    if (crew !== i + 1 && dx * dx + dy * dy > r * r) continue;
    t.progress++;
    world.events.push(EV.BELL_COUNT, t.x, t.y, t.need - t.progress, i, t.need);
    if (t.progress >= t.need) done(world, t, i);
  }
}

/** Is Lantern Night on? (the view lifts the fog) */
export function isNight(world) { return world.night.until >= 0; }
/** Is Lantern Night banked, waiting for the crowd? (the lamp row glows) */
export function nightBanked(world) { return world.night.banked === true; }

/**
 * The run against the map (idea 10; a cold path: the pause menu; the result keeps it at the end):
 * { lamps: { lit, most, total }, bells: { rung, total }, ferry: { calls, trades, bought } | null,
 *   relics: { found, total }, secrets: { found: [ids], total }, nights, act, works, events }.
 * 0.9.0: lamps and bells count those the acts have brought so far.
 */
export function runLedger(world) {
  const r = world.result, tasks = world.tasks || [], pool = { found: 0, total: 0 };
  relicPool(world, pool);
  return {
    lamps: { lit: r.lampsLit, most: r.lampsMost, total: tasks.filter((t) => t.kind === TASK.LAMP).length },
    // (X4: bells rung at least once, never more than there are: the Tide Priest's second rings
    // made it "6 of 3 rung". The result's bellsRung still counts every ring.)
    bells: { rung: tasks.filter((t) => t.kind === TASK.BELL && t.uses > 0).length, total: tasks.filter((t) => t.kind === TASK.BELL).length },
    ferry: world.ferry ? { calls: world.ferry.calls, trades: r.ferryTrades, bought: r.ferryBought } : null,
    relics: { found: pool.found, total: pool.total },
    secrets: { found: r.secrets.slice(), total: world.secrets.length },
    nights: world.night.count,
    act: world.acts ? world.acts.act : 1,
    works: r.works,
    events: r.mapEvents.length,
  };
}

/** The tasks' part of the state hash. */
export function hashTasks(world, h) {
  const n = world.night;
  h.int(-21).int(n.banked ? 1 : 0).int(n.count).int(n.vaultTick).int(world.wardNext);
  for (const t of world.tasks) {
    h.int(t.state).float64(t.progress).float64(t.need).int(t.glass).float64(t.touch).int(t.crewTick).int(t.outTick).int(t.crewN);
    h.int(t.kind).float64(t.x).float64(t.y).int(t.twist).int(t.wave).int(t.uses).int(t.next ?? 0);
    for (let k = 0; k < t.crewN; k++) h.float64(t.crewX[k]).float64(t.crewY[k]);
  }
  hashActs(world, h);
}
