// The Marsh's hold statuses and on-hit pieces (ARCHITECTURE §5.17; docs/design/SALT_MARSH.md,
// "New sim parts"): the brine spout and its puddles (two puddles freeze, a thaw after), shatters
// (Salt Pan's frozen kills, Cold Iron's held Steel kills), the quench (a Sea or Frost hit on a
// burning enemy), Tarred's tar going off, Spillway's spill, the daze, Storm Glass's spikes, and the
// crowd the spout and the storm aim at, sampled across the whole screen.
//
// Hot paths pass numbers through the world's registers (§17): the spout's crowd pick writes its
// point to world.scratch.v2 and keeps its picks in the slot's own buffer (slot.picks); the daze,
// tar, and spike take theirs in world.scratch.hold (owned by this file's on-hit entry points);
// shards go through spawnShot's register.

import { DT, TPS, EF, EF_GONE, MOTION, PF, HIT_SLOTS, RELIC_SLOT, ZONE } from './constants.js';
import { EV, STATUS } from './events.js';
import { shotOpts, shotAt, spawnShot, explodeR } from './weapons.js';
import { damageEnemyR, applyStatus, midAttack } from './enemies.js';
import { openWell } from './well.js';
import { sincosInto, TAU } from '../lib/fmath.js';

const VIEW_HALF_W = 320, VIEW_HALF_H = 180;

/**
 * The thickest crowd on screen (the brine spout, the storm): up to `samples` enemies spread evenly
 * over the whole pool (never the first few a grid scan meets, which would favor the top of the
 * screen), each scored by how many enemies stand within `r` of it; ties go to the one nearer you.
 * `filter(world, e)` rules candidates out before the sampling (the storm: only enemies on salt),
 * so a few on salt among many off it are still found. Picks already made this volley (`picks`, x
 * and y pairs, `nPicks` of them) are kept `apart` px away. Writes the point to out[0], out[1];
 * returns the enemy picked, or -1.
 */
export function crowdPoint(world, out, r, samples, picks, nPicks, apart, filter = null) {
  const E = world.enemies, p = world.player, n = E.count;
  const reg = world.scratch.reg, blast = world.scratch.blast;
  let inView = 0;
  for (let i = 0; i < n; i++) {
    if ((E.flags[i] & EF_GONE) !== 0) continue;
    if (Math.abs(E.x[i] - p.x) > VIEW_HALF_W || Math.abs(E.y[i] - p.y) > VIEW_HALF_H) continue;
    if (filter !== null && !filter(world, i)) continue;
    inView++;
  }
  if (inView === 0) return -1;
  const stride = inView > samples ? inView / samples : 1;
  let best = -1, bestN = -1, bestD = Infinity, seen = 0, next = 0;
  for (let i = 0; i < n; i++) {
    if ((E.flags[i] & EF_GONE) !== 0) continue;
    const dx = E.x[i] - p.x, dy = E.y[i] - p.y;
    if (Math.abs(dx) > VIEW_HALF_W || Math.abs(dy) > VIEW_HALF_H) continue;
    if (filter !== null && !filter(world, i)) continue;
    const k = seen++;
    if (k < next) continue;
    next += stride;
    let far = true;
    for (let q = 0; q < nPicks && far; q++) { const ax = E.x[i] - picks[2 * q], ay = E.y[i] - picks[2 * q + 1]; if (ax * ax + ay * ay < apart * apart) far = false; }
    if (!far) continue;
    reg[0] = E.x[i]; reg[1] = E.y[i]; reg[2] = r;
    const c = world.enemyHash.queryR(reg, blast, -1);
    const d = dx * dx + dy * dy;
    if (c > bestN || (c === bestN && d < bestD)) { best = i; bestN = c; bestD = d; }
  }
  if (best < 0) return -1;
  out[0] = E.x[best]; out[1] = E.y[best];
  return best;
}

/**
 * The spout emitter (Brine Spring, Salt Pan): each shot is a burst under the thickest crowd on
 * screen (a stationary hit of the spout's size, its on-hit list freezing what it hits), and one
 * puddle where it burst. The picks go in the slot's own buffer (slot.picks, sized in buildSlot for
 * the most Amount the weapon can reach), so every shot of the volley spouts. Returns how many spouted.
 */
export function spoutVolley(world, slot, amount) {
  const s = slot.stats, picks = slot.picks, out = world.scratch.v2;
  const r = s.radius * s.area;
  const most = picks.length >> 1;
  let made = 0;
  const aim = slot.emit.aim, p = world.player, path = world.path, tp = slot.fx.tidepool;
  for (let k = 0; k < amount && k < most; k++) {
    if (aim === 'self') {
      // Artesian: under your own feet (more spouts ring you).
      const sc = world.scratch.sc;
      sincosInto((k / Math.max(1, amount)) * TAU, sc, 0);
      out[0] = p.x + (k === 0 ? 0 : sc[1] * r * 0.9); out[1] = p.y + (k === 0 ? 0 : sc[0] * r * 0.9);
    } else if (aim === 'path' && path.n > 0) {
      // Spring Line: along the path you walked 2s ago (a sample every 6 ticks), each spout half a second on.
      const N = path.x.length, back = Math.min(path.n - 1, N - 1, 20 + 5 * k), j = (path.n - 1 - back + 16 * N) % N;
      out[0] = path.x[j]; out[1] = path.y[j];
    } else if (crowdPoint(world, out, 40, 32, picks, made, r * 2, null) < 0) break;
    const x = out[0], y = out[1];
    picks[2 * made] = x; picks[2 * made + 1] = y;
    made++;
    const o = shotOpts();
    o.motion = MOTION.stationary; o.life = DT * 1.5; o.pierce = -1; o.radius = r;
    shotAt(world, x, y, 0, 0, 0);
    spawnShot(world, slot, o);
    // One puddle per spout, never one per enemy hit.
    const P = slot.emit.puddle, Z = world.zones;
    world.events.push(EV.EXPLODE, x, y, r, slot.index);
    const pr = P.radius * s.area;
    if (tp) {
      // Tide Pools: a puddle that touches another of its own joins it: one pool, as big and as long as both.
      let joined = false;
      for (let q = 0; q < Z.count && !joined; q++) {
        if (Z.kind[q] !== ZONE.PUDDLE || Z.slot[q] !== slot.index || Z.life[q] <= 0) continue;
        const dx = Z.x[q] - x, dy = Z.y[q] - y, rr = Z.radius[q] + pr;
        if (dx * dx + dy * dy > rr * rr) continue;
        const nr = Math.min(tp.maxRadius * s.area, Math.sqrt(Z.radius[q] * Z.radius[q] + pr * pr));
        Z.x[q] = (Z.x[q] + x) * 0.5; Z.y[q] = (Z.y[q] + y) * 0.5;
        Z.radius[q] = Z.maxRadius[q] = nr;
        Z.life[q] = Math.min(Z.life[q] + s.duration, s.duration * tp.maxLife);
        joined = true;
      }
      if (joined) continue;
    }
    const z = Z.alloc();
    if (z < 0) continue;
    Z.x[z] = x; Z.y[z] = y; Z.kind[z] = ZONE.PUDDLE; Z.slot[z] = slot.index; Z.list[z] = slot.list;
    Z.radius[z] = Z.maxRadius[z] = pr;
    Z.life[z] = s.duration; Z.damage[z] = 0; Z.knockback[z] = 0;
    Z.interval[z] = Math.max(1, Math.round(world.tuning.status.puddleEvery * TPS));
    Z.def[z] = slot.defIndex ?? 0xffff;
  }
  return made;
}

/** Seep: a puddle bursts again where it lies (zonesTick), a hit of the spout's own, its size. */
export function seepPulse(world, slot, z) {
  const Z = world.zones, s = slot.stats;
  const o = shotOpts();
  o.motion = MOTION.stationary; o.life = DT * 1.5; o.pierce = -1; o.radius = Z.radius[z] * 0.85; o.flags = PF.CHILD; o.list = slot.childList;
  o.damage = s.damage * slot.fx.seep.damageMul;
  shotAt(world, Z.x[z], Z.y[z], 0, 0, 0);
  spawnShot(world, slot, o);
  world.events.push(EV.EXPLODE, Z.x[z], Z.y[z], Z.radius[z] * 0.85, slot.index);
}

const SLOW = { status: 'slow', pct: 0, duration: 0 };       // reused: applyStatus copies what it keeps
const FREEZE = { status: 'freeze', duration: 0 };

/**
 * A puddle's pulse (zonesTick, every puddleEvery s on the world's clock, so every puddle pulses on
 * the same tick): it slows what stands in it, and an enemy that two puddles reach on one pulse
 * freezes (unless it thawed a moment ago).
 */
export function puddlePulse(world, z) {
  const Z = world.zones, E = world.enemies, slot = world.slots[Z.slot[z]];
  if (!slot || !slot.emit.puddle) return;
  const P = slot.emit.puddle, tick = world.tick, q = world.scratch.qreg, near = world.scratch.hits;
  SLOW.pct = P.slow; SLOW.duration = world.tuning.status.puddleEvery * 1.5;
  const big = !!slot.fx.tidepool && Z.radius[z] > P.radius * slot.stats.area * 1.2;
  FREEZE.duration = P.freeze;
  q[0] = Z.x[z]; q[1] = Z.y[z]; q[2] = Z.radius[z];
  const m = world.enemyHash.queryR(q, near, -1);
  for (let k = 0; k < m; k++) {
    const e = near[k];
    if ((E.flags[e] & EF_GONE) !== 0) continue;
    if (E.pudTick[e] !== tick) {
      // Soaked: newly in the brine (the view shows it; a second puddle on the same pulse freezes).
      if (E.pudTick[e] < tick - Z.interval[z]) { const ev = world.events, k = ev.reserve(EV.STATUS); if (k >= 0) { ev.x[k] = E.x[e]; ev.y[k] = E.y[e]; ev.a[k] = STATUS.SOAK; ev.b[k] = E.handle(e); } }
      E.pudTick[e] = tick; E.pudN[e] = 1;
    }
    else if (++E.pudN[e] === 2 && E.freezeT[e] <= 0) applyStatus(world, e, FREEZE, slot.index); // (a freeze runs out, then the thaw)
    // (Tide Pools: a pool that two puddles made freezes as two would.)
    if (big && E.pudN[e] === 1 && E.freezeT[e] <= 0) { E.pudN[e] = 2; applyStatus(world, e, FREEZE, slot.index); }
    applyStatus(world, e, SLOW, slot.index);
  }
}

/**
 * A kill that shatters (resolveDeaths): Salt Pan's spouts killing an enemy that was frozen before
 * the hit (the spout's own hit: a shard's kill never shatters again, so frozen crowds don't burst
 * in a chain), or (with Cold Iron) a Steel weapon killing one that was slowed or frozen. Shards fly
 * out evenly and slow what they hit.
 */
export function shatterAt(world, i, x, y) {
  const E = world.enemies, ks = E.killer[i];
  const slot = ks >= 0 ? world.slots[ks] : null;
  if (slot && slot.shatter && (E.held[i] & 1) !== 0) {
    if (E.shardKill[i] === 1) return;
    shards(world, slot, x, y, slot.shatter.count, slot.shatter.damage, slot.shardList, i);
    return;
  }
  const C = world.coldIron;
  if (C !== null && slot && slot.steel && E.held[i] !== 0) shards(world, world.slots[RELIC_SLOT], x, y, C.count, C.damage, C.list, i);
}

function shards(world, slot, x, y, count, damage, list, e) {
  const sc = world.scratch.sc, phase = world.enemies.anim[e] * TAU;
  for (let k = 0; k < count; k++) {
    sincosInto(phase + (k / count) * TAU, sc, 0);
    const o = shotOpts();
    o.motion = MOTION.linear; o.flags = PF.CHILD; o.damage = damage; o.pierce = 1; o.life = 0.45; o.list = list; o.radius = 3;
    shotAt(world, x, y, sc[1], sc[0], 210);
    spawnShot(world, slot, o);
  }
  world.events.push(EV.SHATTER, x, y, count, slot.index);
}

/**
 * A Sea or Frost hit on a burning enemy (applyHit, before its damage): counted for the run (the
 * Quencher feat, once each burn); with the Quench Bucket the fire goes out, and all the burn it had
 * left lands at once, on it and on everything touching it.
 */
export function quench(world, e) {
  const E = world.enemies;
  if (E.quenched[e] === 0) { E.quenched[e] = 1; world.result.quenched++; }
  const Q = world.quench;
  if (Q === null) return;
  const dmg = E.burnDps[e] * E.burnT[e] * Q.mul, bs = E.burnSlot[e];
  E.burnT[e] = 0; E.burnDps[e] = 0; E.burnAcc[e] = 0;
  const xr = world.scratch.xreg;
  xr[0] = E.x[e]; xr[1] = E.y[e]; xr[2] = E.radius[e] + Q.reach; xr[3] = dmg; xr[4] = 0;
  explodeR(world, bs, -1);
}

/**
 * A daze (the Conger Pot's bites): it can't walk, act, or hurt you; never a boss, never mid-attack;
 * it never adds up. Its seconds come in world.scratch.hold[0] (a hot path: §17).
 */
export function dazeEnemy(world, e) {
  const E = world.enemies, sec = world.scratch.hold[0];
  if ((E.flags[e] & (EF.BOSS | EF_GONE)) !== 0 || midAttack(E, e, world.bosses) || E.dazeT[e] >= sec) return;
  E.dazeT[e] = sec;
  const ev = world.events, k = ev.reserve(EV.STATUS);
  if (k >= 0) { ev.x[k] = E.x[e]; ev.y[k] = E.y[e]; ev.a[k] = STATUS.DAZE; ev.b[k] = E.handle(e); }
}

/** Tarred: a hit coats the enemy for `duration` s, holding `damageMul` of the hit (world.scratch.hold[0]) to set off. */
export function tarEnemy(world, slot, e, fx) {
  const E = world.enemies;
  const v = world.scratch.hold[0] * (fx.damageMul ?? 1);
  if (v > E.tarDmg[e] || E.tarT[e] <= 0 || E.tarSlot[e] !== slot.index) E.tarDmg[e] = v;
  E.tarT[e] = fx.duration; E.tarSlot[e] = slot.index;
  const ev = world.events, k = ev.reserve(EV.STATUS);
  if (k >= 0) { ev.x[k] = E.x[e]; ev.y[k] = E.y[e]; ev.a[k] = STATUS.TAR; ev.b[k] = E.handle(e); }
}

/** Marsh Fever: the hit gives `duration` s of fever (it takes more damage, and spreads what it carries once). */
export function feverEnemy(world, e, fx) {
  const E = world.enemies;
  if ((E.flags[e] & EF.BOSS) !== 0) return;
  if (fx.duration > E.feverT[e]) { E.feverT[e] = fx.duration; E.feverDone[e] = 0; }
  const ev = world.events, k = ev.reserve(EV.STATUS);
  if (k >= 0) { ev.x[k] = E.x[e]; ev.y[k] = E.y[e]; ev.a[k] = STATUS.FEVER; ev.b[k] = E.handle(e); }
}

/**
 * Spillway: damage left over when a hit kills carries on to the nearest enemy, and on again until
 * it runs out (at most `hops` times, each within `range`).
 */
export function spill(world, slot, e, fx, hit = 0) {
  const E = world.enemies, num = world.scratch.num;
  if ((E.flags[e] & EF.DEAD) === 0 || !(E.hp[e] < 0)) return;
  const mul = fx.mul ?? 1;   // the first carry, times this (only the first: the hops after carry what is left, so it never compounds)
  // The first carry is the leftover times `mul`, and never less than `least` of the killing hit.
  let left = Math.max(-E.hp[e] * mul, hit * (fx.least ?? 0)), x = E.x[e], y = E.y[e];
  const range = fx.range ?? 80;
  for (let h = 0; h < (fx.hops ?? 8) && left > 0.5; h++) {
    const t = world.enemyHash.nearest(x, y, range, E.flags, EF_GONE, -1);
    if (t < 0) break;
    num[0] = left;
    damageEnemyR(world, t, slot.index, false);
    const ev = world.events, k = ev.reserve(EV.ZAP);
    if (k >= 0) { ev.x[k] = x; ev.y[k] = y; ev.a[k] = E.x[t]; ev.b[k] = E.y[t]; }
    if ((E.flags[t] & EF.DEAD) === 0 || !(E.hp[t] < 0)) break;
    left = -E.hp[t]; x = E.x[t]; y = E.y[t];
  }
}

/**
 * Storm Glass: a chain's hop leaves a glass spike that beams the nearest enemy every `every` s for
 * `life` s. Its numbers come in world.scratch.hold: [0] x, [1] y, [2] the hop's damage (§17).
 */
export function spikeAt(world, slot, fx) {
  const hold = world.scratch.hold, x = hold[0], y = hold[1], damage = hold[2];
  if (slot.spikes >= (fx.max ?? 10)) return;
  const Z = world.zones, z = Z.alloc();
  if (z < 0) return;
  slot.spikes++;
  Z.x[z] = x; Z.y[z] = y; Z.kind[z] = ZONE.SPIKE; Z.slot[z] = slot.index; Z.list[z] = slot.childList;
  Z.radius[z] = Z.maxRadius[z] = 4; Z.length[z] = fx.range ?? 90;
  Z.life[z] = fx.life ?? 4; Z.damage[z] = damage * (fx.damageMul ?? 0.5); Z.knockback[z] = 0;
  Z.interval[z] = Math.max(1, Math.round((fx.every ?? 1) * TPS)); Z.nextTick[z] = world.tick + Z.interval[z];
  Z.def[z] = slot.defIndex ?? 0xffff;
}

/** A spike's beam (zonesTick): the nearest live enemy in reach takes its damage. */
export function spikeTick(world, z) {
  const Z = world.zones, E = world.enemies;
  if (world.tick < Z.nextTick[z]) return;
  Z.nextTick[z] = world.tick + Z.interval[z];
  const t = world.enemyHash.nearest(Z.x[z], Z.y[z], Z.length[z], E.flags, EF_GONE, -1);
  if (t < 0) return;
  world.scratch.num[0] = Z.damage[z];
  damageEnemyR(world, t, Z.slot[z], false);
  const ev = world.events, k = ev.reserve(EV.ZAP);
  if (k >= 0) { ev.x[k] = Z.x[z]; ev.y[k] = Z.y[z]; ev.a[k] = E.x[t]; ev.b[k] = E.y[t]; }
}

/** The Well Warden fell (resolveDeaths): his well opens where he fell (sim/well.js). */
export function openWellAt(world, x, y) { openWell(world, x, y); }

