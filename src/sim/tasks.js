// Run tasks (ARCHITECTURE §10.8; the map's: data/maps.js `tasks`, the numbers: tuning.tasks).
// Small places on the map with something to do there for a reward, and no timer: a task only
// moves while you're doing it, and waits for you when you leave. What one asks and what it gives
// grow with the minute you start it, so one put off until late costs more and pays more.
//
//   Wayside Lamp  stand by it until it's lit. Each lit lamp adds a stack of Kindled (+XP and +Area
//                 for the rest of the run), uncovers the minimap around it, and gives Sea Glass.
//                 Light every lamp on the map and Lantern Night falls: the fog lifts, your light
//                 burns what stands in it, and a vault opens where the last lamp was (a relic,
//                 one of three, a tier better).
//   Fog Bell      walk into its ring to wake it; then every kill inside the ring counts, wherever
//                 you are. Enough kills ring it: Sea Glass and a chest.

import { DT, TPS, PK, TASK, TASK_STATE, RELIC_SLOT, EF } from './constants.js';
import { snapOpen } from './places.js';
import { EV } from './events.js';
import { runMinute, addGlass } from './relics.js';
import { spawnPickup } from './pickups.js';
import { markStatsDirty } from './build.js';
import { damageEnemyR } from './enemies.js';
import { CHEST_ELITE } from './chests.js';

const KINDS = Object.freeze({ lamp: TASK.LAMP, bell: TASK.BELL });

/** The map's tasks for a run, each on open ground: [{ kind, x, y, state, progress, need, minute, glass }]. */
export function createTasks(world) {
  return (world.map.tasks || []).map((t) => {
    const kind = KINDS[t.kind];
    if (!kind) throw new Error(`Map ${world.map.id}: unknown task "${t.kind}" (lamp or bell)`);
    const [x, y] = snapOpen(world, t.at?.[0], t.at?.[1]);
    return { kind, x, y, state: TASK_STATE.IDLE, progress: 0, need: 0, glass: 0 };
  });
}

/** How far a task's ring reaches, in px (a Fog Bell's grows with the Chapel). */
export function taskRadius(world, t) {
  const T = world.tuning.tasks;
  return t.kind === TASK.LAMP ? T.lamp.radius : T.bell.radius * (1 + (world.config.harbor?.bellRing ?? 0));
}

/** A task starts: what it asks and gives is set by the minute. */
function start(world, t, i) {
  const T = world.tuning.tasks, m = runMinute(world);
  const own = t.kind === TASK.LAMP ? T.lamp : T.bell;
  t.state = TASK_STATE.ACTIVE;
  t.need = t.kind === TASK.LAMP ? own.baseSec + own.perMinSec * m : Math.round(own.baseKills + own.perMinKills * m);
  t.glass = Math.round(own.glass[0] + own.glass[1] * m);
  world.events.push(EV.TASK, t.x, t.y, t.kind, 1, i, 0);
}

function done(world, t, i) {
  t.state = TASK_STATE.DONE;
  addGlass(world, t.glass, t.x, t.y);
  world.events.push(EV.TASK, t.x, t.y, t.kind, 2, i, t.glass);
  if (t.kind === TASK.LAMP) {
    world.kindled++;
    world.result.lampsLit++;
    markStatsDirty(world);
    if (world.tasks.every((x) => x.kind !== TASK.LAMP || x.state === TASK_STATE.DONE)) lanternNight(world, t);
  } else {
    world.result.bellsRung++;
    spawnPickup(world, PK.CHEST, t.x, t.y + 12, CHEST_ELITE, 0);
  }
}

/** Every lamp lit: Lantern Night, and the vault where the last one stands. */
function lanternNight(world, last) {
  const N = world.tuning.tasks.night;
  world.night.until = world.tick + Math.round(N.sec * TPS);
  world.night.next = world.tick;
  world.result.lanternNight = true;
  world.events.push(EV.NIGHT, last.x, last.y, 1);
  spawnPickup(world, PK.VAULT, last.x, last.y + 14, 0, 0);
}

/** Each tick, after you move: the lamps you stand by, the bells you walk into, Lantern Night's burn. */
export function tasksStep(world) {
  const tasks = world.tasks;
  const p = world.player;
  const speed = 1 + (world.config.harbor?.lampSpeed ?? 0);
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    if (t.state === TASK_STATE.DONE) continue;
    const r = taskRadius(world, t), dx = p.x - t.x, dy = p.y - t.y;
    const inside = dx * dx + dy * dy <= r * r;
    if (t.kind === TASK.LAMP) {
      if (!inside) continue;
      if (t.state === TASK_STATE.IDLE) start(world, t, i);
      t.progress += DT * speed;
      if (t.progress >= t.need) done(world, t, i);
    } else if (inside && t.state === TASK_STATE.IDLE) start(world, t, i);
  }
  nightStep(world);
}

/** A kill at (x, y) (sim/enemies.js resolveDeaths): it counts for every waking bell whose ring it's in. */
export function bellKill(world, x, y) {
  const tasks = world.tasks;
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    if (t.kind !== TASK.BELL || t.state !== TASK_STATE.ACTIVE) continue;
    const r = taskRadius(world, t), dx = x - t.x, dy = y - t.y;
    if (dx * dx + dy * dy > r * r) continue;
    t.progress++;
    if (t.progress >= t.need) done(world, t, i);
  }
}

/** Lantern Night: every pulse, your light burns each enemy in it; then it ends. */
function nightStep(world) {
  const n = world.night;
  if (n.until < 0) return;
  if (world.tick >= n.until) {
    n.until = -1;
    world.events.push(EV.NIGHT, world.player.x, world.player.y, 0);
    return;
  }
  if (world.tick < n.next) return;
  const N = world.tuning.tasks.night;
  n.next = world.tick + Math.max(1, Math.round(N.every * TPS));
  const p = world.player, near = world.scratch.near, q = world.scratch.qreg;
  q[0] = p.x; q[1] = p.y; q[2] = N.light;
  const m = world.enemyHash.queryR(q, near, -1);
  const E = world.enemies;
  for (let k = 0; k < m; k++) {
    const e = near[k];
    if ((E.flags[e] & EF.DEAD) !== 0) continue;
    world.scratch.num[0] = N.burn;
    damageEnemyR(world, e, RELIC_SLOT, false);
  }
}

/** Kindled's bonuses for the lamps lit this run (sim/build.js collectMods). */
export function kindledMods(world, mods) {
  if (world.kindled <= 0) return;
  const L = world.tuning.tasks.lamp;
  mods.push({ stat: 'growth', op: 'pct', value: L.kindledXp * world.kindled });
  mods.push({ stat: 'area', op: 'pct', value: L.kindledArea * world.kindled });
}

/** Is Lantern Night on? (the view lifts the fog) */
export function isNight(world) { return world.night.until >= 0; }
