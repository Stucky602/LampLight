// What the map's things show before you reach them (0.8.2; ARCHITECTURE §5.18,
// work/interact/I1-CONTRACT.md): the rings on the ground, the edge arrows, and what a task pays.
// Pure reads of the world for the view: nothing here changes the run. Each fills records the
// caller made (makeRing, makeArrow) and keeps from frame to frame, so a frame allocates nothing
// once its arrays are long enough.
//
// The ring rule (the lead's decision 2): a solid ring in the warning color means something lands
// there (the warnings: EV.TELEGRAPH, ZONE.STRIKE, a landing shadow, the Maw's lure); a dashed ring
// in the thing's own color is a task area. Every ring here is a task area.

import { PK, TASK, TASK_STATE } from './constants.js';
import { TWIST } from './events.js';
import { taskRadius, ward } from './tasks.js';
import { runMinute } from './relics.js';
import { tradeRingsInto } from './trades.js';

/** Ring kinds. */
export const RING = Object.freeze({ LAMP: 1, WARD: 2, BELL: 3, BELL_START: 4, FERRY: 5, WELL: 6, CRANE: 7, CAIRN: 8, TRADE: 9 });   // TRADE: a character's (sim/trades.js; `task` says which)
/** Arrow kinds (one per kind, the nearest). */
export const ARROW = Object.freeze({ LAMP: 1, BELL: 2, FERRY: 3, RELIQUARY: 4, CHEST: 5, VAULT: 6, WELL: 7, CRANE: 8, CAIRN: 9 });
/** What a task pays (rewardOf's kind). */
export const REWARD = Object.freeze({ WARD: 1, PICK: 2, WORK: 3 });

/** A ring record for collectRings. */
export function makeRing() { return { kind: 0, x: 0, y: 0, r: 0, style: 'dashed', color: 'lamp', fill: -1, count: -1, task: -1 }; }
/** An arrow record for collectArrows. */
export function makeArrow() { return { kind: 0, x: 0, y: 0, task: -1 }; }

function ring(out, n, kind, x, y, r, color, fill, count, task) {
  if (n >= out.length) out.push(makeRing());
  const o = out[n];
  o.kind = kind; o.x = x; o.y = y; o.r = r; o.style = 'dashed'; o.color = color; o.fill = fill; o.count = count; o.task = task;
  return n + 1;
}

/** Every task ring now (see the contract's table). Returns how many of `out` it filled. */
export function collectRings(world, out) {
  let n = 0;
  const tasks = world.tasks || [], T = world.tuning;
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    if (t.kind === TASK.LAMP) {
      if (t.state === TASK_STATE.DONE) { const r = ward(world, i); if (r > 0) n = ring(out, n, RING.WARD, t.x, t.y, r, 'lamp', -1, -1, i); }
      else n = ring(out, n, RING.LAMP, t.x, t.y, taskRadius(world, t), 'lamp', t.state === TASK_STATE.ACTIVE && t.need > 0 ? Math.min(1, t.progress / t.need) : 0, -1, i);
    } else if (t.kind === TASK.CRANE || t.kind === TASK.CAIRN) {
      // 0.9.0 (W4): a crane's or cairn's ring while it's ready (it fills while you're in it).
      if (t.state !== TASK_STATE.IDLE) continue;
      const crane = t.kind === TASK.CRANE, own = crane ? T.tasks.crane : T.tasks.cairn;
      n = ring(out, n, crane ? RING.CRANE : RING.CAIRN, t.x, t.y, own.ring, crane ? 'crane' : 'cairn', Math.min(1, t.touch / own.openSec), -1, i);
    } else if (t.state === TASK_STATE.IDLE) {
      n = ring(out, n, RING.BELL_START, t.x, t.y, T.tasks.bell.startRadius, 'bell', Math.min(1, t.touch / T.tasks.bell.openSec), -1, i);
    } else if (t.state === TASK_STATE.ACTIVE) {
      n = ring(out, n, RING.BELL, t.x, t.y, taskRadius(world, t), 'bell', -1, t.need - t.progress, i);
    }
  }
  const F = world.ferry;
  if (F && F.moored && world.tick >= F.tiedTick) n = ring(out, n, RING.FERRY, F.x, F.y, T.ferry.radius, 'ferry', Math.min(1, F.touch / T.ferry.openSec), -1, F.mooring);
  const W = world.well;
  if (W && W.open && W.given === null) n = ring(out, n, RING.WELL, W.x, W.y, T.well.radius, 'well', Math.min(1, W.touch / T.well.openSec), -1, -1);
  // 0.9.0 (W2): the character's own (a mooring post, a bog body, a wreck crew, a sunken crate, a punt cache).
  if (world.trade) n = tradeRingsInto(world, out, n, ring, RING.TRADE);
  return n;
}

/**
 * The edge arrows: for each kind, the nearest one to you, left out when it's inside the view
 * (cx ± halfW, cy ± halfH, px). Returns how many of `out` it filled.
 */
export function collectArrows(world, out, cx, cy, halfW, halfH) {
  let n = 0;
  const p = world.player;
  const offer = (kind, x, y, task) => {
    if (Math.abs(x - cx) <= halfW && Math.abs(y - cy) <= halfH) return;
    if (n >= out.length) out.push(makeArrow());
    const o = out[n++];
    o.kind = kind; o.x = x; o.y = y; o.task = task;
  };
  // The nearest task of each kind still to do.
  let lamp = -1, lampD = Infinity, bell = -1, bellD = Infinity, work = -1, workD = Infinity;
  const tasks = world.tasks || [];
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    if (t.state === TASK_STATE.DONE) continue;
    const dx = t.x - p.x, dy = t.y - p.y, d = dx * dx + dy * dy;
    if (t.kind === TASK.LAMP) { if (d < lampD) { lampD = d; lamp = i; } } else if (t.kind === TASK.BELL) { if (d < bellD) { bellD = d; bell = i; } } else if (d < workD) { workD = d; work = i; }
  }
  if (lamp >= 0) offer(ARROW.LAMP, tasks[lamp].x, tasks[lamp].y, lamp);
  if (bell >= 0) offer(ARROW.BELL, tasks[bell].x, tasks[bell].y, bell);
  if (work >= 0) offer(tasks[work].kind === TASK.CRANE ? ARROW.CRANE : ARROW.CAIRN, tasks[work].x, tasks[work].y, work);
  const F = world.ferry;
  if (F && F.moored) offer(ARROW.FERRY, F.x, F.y, F.mooring);
  // What waits on the ground.
  const P = world.pickups;
  let rq = -1, rqD = Infinity, ch = -1, chD = Infinity, va = -1, vaD = Infinity;
  for (let i = 0; i < P.count; i++) {
    const k = P.kind[i];
    if (k !== PK.RELIQUARY && k !== PK.CHEST && k !== PK.VAULT) continue;
    const dx = P.x[i] - p.x, dy = P.y[i] - p.y, d = dx * dx + dy * dy;
    if (k === PK.RELIQUARY) { if (d < rqD) { rqD = d; rq = i; } } else if (k === PK.CHEST) { if (d < chD) { chD = d; ch = i; } } else if (d < vaD) { vaD = d; va = i; }
  }
  if (rq >= 0) offer(ARROW.RELIQUARY, P.x[rq], P.y[rq], -1);
  if (ch >= 0) offer(ARROW.CHEST, P.x[ch], P.y[ch], -1);
  if (va >= 0) offer(ARROW.VAULT, P.x[va], P.y[va], -1);
  const W = world.well;
  if (W && W.open && W.given === null && world.build.relics.length > 0) offer(ARROW.WELL, W.x, W.y, -1);
  return n;
}

/**
 * What task i pays if you do it now, for the icon over an unlit lamp, an idle bell, or a ready
 * crane or cairn: fills out = { kind: REWARD.WARD | REWARD.PICK | REWARD.WORK, pearls, chest (a
 * held lamp's chest, 0.9.0) } and returns true; false for one that's done or under way (a bell
 * tolled: it already says).
 */
export function rewardOf(world, i, out) {
  const t = world.tasks[i];
  if (!t || t.state === TASK_STATE.DONE || (t.kind === TASK.BELL && t.state === TASK_STATE.ACTIVE)) return false;
  const T = world.tuning.tasks, m = runMinute(world);
  const own = t.kind === TASK.LAMP ? T.lamp : t.kind === TASK.BELL ? T.bell : t.kind === TASK.CRANE ? T.crane : T.cairn;
  const held = t.twist === TWIST.HELD;
  out.kind = t.kind === TASK.LAMP ? REWARD.WARD : t.kind === TASK.BELL ? REWARD.PICK : REWARD.WORK;
  out.pearls = !world.pearlsOn ? 0 : t.state === TASK_STATE.ACTIVE ? t.glass : Math.round((own.glass[0] + own.glass[1] * m) * (held ? T.held.pearlsMul : 1));
  out.chest = held;
  return true;
}

export { relicPool } from './relics.js';
