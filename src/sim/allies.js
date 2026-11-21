// Thralls (ARCHITECTURE §5.17): the Bog Warden's mechanic. An enemy that dies while rotting gets up
// and fights for her for `sec` seconds, at most `max` at once. A thrall walks to the nearest enemy
// and bites it every `every` s; enemies pay them no mind (they want you), and they never hurt you.
// They live in their own small pool (never the enemy pool: no weapon, search, or count meets them),
// drawn with their own sprite, darkened, with a pip in her color (the view, B5).
// 0.9.0 (W2, ruling 2): the dead she raises from the map (sim/trades.js raiseRisen: a bog body, a
// wreck crew) share the pool as `risen`: each with its own time and bite, and they don't count
// against her thralls' limit. A thrall's bite can rot (`A.rotSec`, her capstone).
// Ruling 14 (C2): her dead are a real share of her damage and show in the results. A thrall's bite
// is a share of a Bog Hands grasp (set when it rises), an elite rises as an elite thrall, what her
// dead deal is counted (`A.dealt`), a boss a thrall bites rots, and her skills reach in here: the
// pace of their bites (`A.rate`), gathering round her (`A.gather`), what a falling thrall does
// (`A.onFall`, her hook's), and the Barrow Wight (`risen` 2: one thrall that never falls to time).
// The pool holds 32 (Great Host doubles her limit).

import { DT, EF, EF_GONE, RELIC_SLOT } from './constants.js';
import { EV, SIGHT } from './events.js';
import { TILE } from './terrain.js';
import { damageEnemyR, midAttack } from './enemies.js';
import { sightThing } from './sight.js';

const CAP = 32;
/** A.risen: 0 a thrall, 1 one of the map's dead, 2 the Barrow Wight. */
export const ALLY = Object.freeze({ THRALL: 0, RISEN: 1, WIGHT: 2 });

export function createAllies() {
  return {
    n: 0, cap: CAP,
    x: new Float32Array(CAP), y: new Float32Array(CAP), px: new Float32Array(CAP), py: new Float32Array(CAP),
    type: new Uint16Array(CAP), life: new Float32Array(CAP), cd: new Float32Array(CAP), radius: new Float32Array(CAP),
    bite: new Float32Array(CAP), risen: new Uint8Array(CAP),
    raised: 0, thralls: 0,
    dealt: 0,               // health her dead have taken off enemies this run (the results' row)
    rate: 1, gather: 0, gatherR: 0,   // her skills: bites this many times as fast; 1: they keep round her, hunting within gatherR of her
    bossRot: 0, bossAmp: 0, // a bite on a boss rots it this long, this deep
    again: new Uint8Array(CAP),   // 1: it has risen a second time already (Second Burial)
    onFall: null,           // (world, k): a thrall's time is up (her hook's; before it is removed)
    rotSec: 0, rotAmp: 0,   // a bite's rot (the Bog Host capstone); 0 none
    guard: 0, guardR: 0,    // 1: her thralls go first for the enemy nearest her, within guardR px (C2b: her dead as a wall)
    hold: 0,                // s a bite holds an ordinary enemy (can't walk or hurt; never a boss, never mid-attack)
    offWater,
  };
}

/** Enemy e died rotting: it rises for you (params: the Bog Warden's sec, max, damage, every, speed). */
export function raiseThrall(world, e, P) {
  const E = world.enemies;
  return raiseThrallAt(world, E.type[e], E.x[e], E.y[e], P, false);
}

/** A thrall of enemy type `type` rises at (x, y). `past`: it may rise past her limit (an elite thrall with Fresh Graves). */
export function raiseThrallAt(world, type, x, y, P, past) {
  const A = world.allies;
  if ((A.thralls >= P.max && !past) || A.n >= A.cap) return -1;
  const k = A.n++;
  A.x[k] = A.px[k] = x; A.y[k] = A.py[k] = y;
  A.type[k] = type; A.life[k] = P.sec; A.cd[k] = P.every; A.radius[k] = world.enemyDefs[type].radius;
  A.bite[k] = P.damage; A.risen[k] = 0; A.again[k] = 0;
  A.raised++; A.thralls++;
  world.result.thralls++;
  world.events.push(EV.THRALL, x, y, 1, type, k);
  sightThing(world, SIGHT.THRALL);
  return k;
}

/**
 * One of the map's dead rises for her at (x, y) (sim/trades.js: a bog body, a wreck crew's man):
 * an enemy type's look, `sec` seconds, `bite` a bite. Outside her thralls' limit. Returns its index, or -1.
 */
export function raiseRisen(world, type, x, y, sec, bite) {
  const A = world.allies;
  if (A.n >= A.cap) return -1;
  const k = A.n++;
  A.x[k] = A.px[k] = x; A.y[k] = A.py[k] = y;
  A.type[k] = type; A.life[k] = sec; A.cd[k] = 0; A.radius[k] = world.enemyDefs[type].radius;
  A.bite[k] = bite; A.risen[k] = 1; A.again[k] = 0;
  A.raised++;
  world.events.push(EV.THRALL, x, y, 1, type, k);
  return k;
}

/** Each tick, from the Bog Warden's onTick hook (before the weapons fire): thralls hunt and bite, and crumble when their time is up. */
export function alliesStep(world, P) {
  const A = world.allies;
  if (A.n === 0) return;
  const E = world.enemies, reg = world.scratch.reg, p = world.player;
  for (let k = A.n - 1; k >= 0; k--) {
    A.px[k] = A.x[k]; A.py[k] = A.y[k];
    if (A.risen[k] !== ALLY.WIGHT) A.life[k] -= DT;
    if (A.life[k] <= 0) {
      if (A.onFall !== null && A.onFall(world, k) === true) continue;   // (it rose again: Second Burial)
      world.events.push(EV.THRALL, A.x[k], A.y[k], 0, A.type[k], k);
      if (A.risen[k] !== ALLY.RISEN) A.thralls--;
      remove(A, k);
      continue;
    }
    // Gathered round her (Warden's Rest, Dead March): it hunts what is near her, and keeps by her otherwise.
    const near = A.gather === 1 && A.risen[k] !== ALLY.RISEN;
    let t = near ? world.enemyHash.nearest(p.x, p.y, A.gatherR, E.flags, EF_GONE, -1) : -1;
    // Her dead as a wall (C2b): what comes for her first, then what is near them.
    if (t < 0 && A.guard === 1 && A.risen[k] !== ALLY.RISEN) t = world.enemyHash.nearest(p.x, p.y, A.guardR, E.flags, EF_GONE, -1);
    if (t < 0 && !near) t = world.enemyHash.nearest(A.x[k], A.y[k], P.reach, E.flags, EF_GONE, -1);
    A.cd[k] -= DT * A.rate;
    let tx, ty, touch;
    if (t >= 0) { tx = E.x[t]; ty = E.y[t]; touch = A.radius[k] + E.radius[t] + 1; }
    else if (near) { const q = k & 7; tx = p.x + RING_X[q] * 22; ty = p.y + RING_Y[q] * 22; touch = 1; }
    else continue;
    const dx = tx - A.x[k], dy = ty - A.y[k], d = Math.sqrt(dx * dx + dy * dy) || 1;
    if (d > touch + 1) {   // (a pixel of reach: Float32 positions never quite close the last of it)
      const step = P.speed * DT, m = step < d - touch ? step : d - touch;
      reg[0] = A.x[k] + (dx / d) * m; reg[1] = A.y[k] + (dy / d) * m; reg[2] = A.radius[k];
      world.terrain.collideR(reg);
      A.x[k] = reg[0]; A.y[k] = reg[1];
    } else if (t >= 0 && A.cd[k] <= 0) {
      A.cd[k] = P.every;
      biteAt(world, A, k, t);
    }
  }
}

/**
 * Her dead's damage: counted as theirs (A.dealt) and in Bog Hands' row too (ruling 18 KF), so the
 * stats screen and the results show the signature with its dead. (Not the threat: slot 9 stays out.)
 */
export function creditDead(world, A, got, had = Infinity) {
  A.dealt += got;
  const k = world.trade && world.trade.s ? world.trade.s.sig : -1;
  // (Only the health it took, as a weapon's row counts it: `had` is the enemy's health before the bite.)
  const real = got < had ? got : had > 0 ? had : 0;
  if (k >= 0 && real > 0) { world.result.realBySlot[k] += real; world.result.damageBySlot[k] += real; }
}

/** Ally k bites enemy t: its damage (counted as her dead's), its rot (Bog Kin), and a boss rots. */
export function biteAt(world, A, k, t) {
  const E = world.enemies;
  world.scratch.num[0] = A.bite[k];
  const had = E.hp[t];
  creditDead(world, A, damageEnemyR(world, t, RELIC_SLOT, false), had);
  if ((E.flags[t] & EF_GONE) !== 0) return;
  // The dead's grip (C2b): a bitten ordinary enemy is held a moment.
  if (A.hold > 0 && (E.flags[t] & EF.BOSS) === 0 && !midAttack(E, t) && E.dazeT[t] < A.hold) E.dazeT[t] = A.hold;
  let sec = A.rotSec, amp = A.rotAmp;
  if ((E.flags[t] & EF.BOSS) !== 0 && A.bossRot > sec) { sec = A.bossRot; if (A.bossAmp > amp) amp = A.bossAmp; }
  if (sec > 0) {
    if (E.rotT[t] < sec) E.rotT[t] = sec;
    if (E.rotAmp[t] < amp) E.rotAmp[t] = amp;
  }
}

/** Eight places round a point, an eighth of a turn apart (a fixed table: no engine trig in the sim). */
export const RING_X = Object.freeze([1, 0.7071, 0, -0.7071, -1, -0.7071, 0, 0.7071]);
export const RING_Y = Object.freeze([0, 0.7071, 1, 0.7071, 0, -0.7071, -1, -0.7071]);

/** Take ally k out of the pool (her hook: the wight fed away, a thrall spent). */
export function removeAlly(world, k) {
  const A = world.allies;
  world.events.push(EV.THRALL, A.x[k], A.y[k], 0, A.type[k], k);
  if (A.risen[k] !== ALLY.RISEN) A.thralls--;
  remove(A, k);
}

function remove(A, k) {
  const last = --A.n;
  if (k === last) return;
  A.x[k] = A.x[last]; A.y[k] = A.y[last]; A.px[k] = A.px[last]; A.py[k] = A.py[last];
  A.type[k] = A.type[last]; A.life[k] = A.life[last]; A.cd[k] = A.cd[last]; A.radius[k] = A.radius[last];
  A.bite[k] = A.bite[last]; A.risen[k] = A.risen[last]; A.again[k] = A.again[last];
}

/** The ground changed (sim/marsh.js): a thrall on a tile that blocks now moves to the bank. */
function offWater(world) {
  const A = world.allies, T = world.terrain, o = world.scratch.open;
  for (let k = 0; k < A.n; k++) {
    if (!T.blockedAt(A.x[k], A.y[k])) continue;
    if (T.nearestOpen(Math.floor(A.x[k] / TILE), Math.floor(A.y[k] / TILE), o, 24)) { A.x[k] = A.px[k] = o[0]; A.y[k] = A.py[k] = o[1]; }
  }
}

export function hashAllies(A, h) {
  h.int(-14).int(A.n).int(A.raised).float64(A.dealt).float64(A.rate).int(A.gather);
  for (let k = 0; k < A.n; k++) h.float64(A.x[k]).float64(A.y[k]).float64(A.life[k]).float64(A.cd[k]).int(A.type[k]).float64(A.bite[k]).int(A.risen[k]).int(A.again[k]).float64(A.radius[k]);
  if (A.rotSec > 0) h.int(-15).float64(A.rotSec).float64(A.rotAmp);
}
