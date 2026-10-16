// Forms (ARCHITECTURE §5.16; the numbers: data/ascensions.js): what an Ember does to a weapon.
//
// A weapon can hold all three of its line's Forms at once, one for each part of how it works:
// delivery (when and from where it fires), flight (how its shots travel), and payoff (what a hit
// or a kill leaves behind). Each Form is built here in up to four places, and no two Forms of a
// line touch the same one, so they combine in any order:
//   build    the pipeline as the slot is built (sim/weapons.js buildSlot): a motion, an on-hit
//            effect, a flag the emitter reads
//   stats    the slot's numbers after its level and your bonuses (an Eclipse's one big orb)
//   fire     when and where it fires (sim/weapons.js weaponsFire, startVolley, fireOne)
//   kill     a kill by the weapon (sim/enemies.js resolveDeaths)
// A slot keeps its Forms (`ascensions`, the data entries, in the order taken), a map of them by
// mechanic (`fx`), and their running state (`fs`, kept through level-ups and an evolution; numbers
// only, every one of them in the world's state hash).

import { DT, TPS, EF, PF, MOTION, ZONE, ZF, ZSTYLE, MARKS, HIT_RING } from './constants.js';
import { NO_HANDLE } from './pools.js';
import { EV } from './events.js';
import { impulseR, damageEnemyR, applyStatus } from './enemies.js';
import { sincosInto, fatan2, TAU } from '../lib/fmath.js';
import {
  addEffect, spawnShot, shotOpts, shotAt, fireAlong, explodeAt, groundAt,
} from './weapons.js';

/** A slot's Form state, made once and kept through rebuilds (level-ups, an evolution). */
export function createFormState() {
  return {
    shots: 0, rings: 0,      // Salvo: shots toward the next ring, and rings fired (each turned a little)
    growth: 0,               // Eclipse: 0..1, from kills
    rodX: 0, rodY: 0, rodUntil: -1,   // Planted Rod: where, and the tick it's pulled up (-1: none)
    pyre: 0,                 // Pyre: flames gathered
    trailAt: 0,              // Slick Trail: the tick of the next pool
    hangAt: 0,               // Hanging Flare: the tick the next one may hang
    wardAt: 0, vigilAt: 0,   // Wards, Vigil: the tick the next may appear
    marks: 0,                // Riptide, Static: marks out now
    wards: 0,                // Wards: wards out now
    tollCut: 0,              // Great Toll: seconds its kills have taken off the next ring
  };
}

// ---------------------------------------------------------------- build

/**
 * Patch a slot's pipeline for its Forms (before its runes): `pipe` is { emit, motion, onHit }
 * (copies, changed in place). Returns the Forms by mechanic.
 */
export function buildForms(pipe, ascensions) {
  const fx = {};
  for (const a of ascensions) {
    fx[a.form] = a;
    switch (a.form) {
      case 'mortar':
        pipe.motion = { type: 'arc', range: a.range, flight: a.flight };
        pipe.emit = { ...pipe.emit, aim: 'crowd', range: Math.max(pipe.emit.range ?? 0, a.range) };
        break; // its burst is once, where it lands (sim/weapons.js projectileHits)
      case 'hang': pipe.onHit.push({ type: 'hang', radius: a.radius, duration: a.duration, damageMul: a.damageMul, interval: a.interval, every: a.every }); break;
      // Burning Glass: the beam's own hits (not a chain's hops or a pool's pulses: it's the parent
      // list's alone, constants.js PARENT_ONLY_FX) set fire, hotter each time it finds them again.
      case 'focus': pipe.onHit.push({ type: 'focus', per: a.per, max: a.max, hold: a.hold, burn: a.burn, duration: a.duration }); break;
      case 'hunting': pipe.motion = { type: 'homing', speed: a.speed, turn: a.turn, range: a.range }; break;
      case 'toll': addEffect(pipe.onHit, { type: 'status', status: 'freeze', duration: a.freeze }); break;
      case 'riptide': pipe.onHit.push({ type: 'mark', mark: 'riptide', duration: a.delay, radius: a.radius, damageMul: a.damageMul, max: a.max }); break;
      case 'relay': addEffect(pipe.onHit, { type: 'chain', hops: a.hops, range: a.range, damageMul: a.damageMul }); break;
      case 'march': pipe.onHit.push({ type: 'march', reach: a.reach, speed: a.speed, damageMul: a.damageMul }); break;
      case 'static': pipe.onHit.push({ type: 'mark', mark: 'static', duration: a.duration, every: a.every, range: a.range, damageMul: a.damageMul, max: a.max }); break;
      default: break; // the rest are read where the weapon fires, moves, or kills
    }
  }
  return fx;
}

/** The slot's numbers for its Forms, after its level and bonuses (`stats` is the slot's own copy). */
export function formStats(stats, fx, def) {
  if (fx.mortar) stats.cooldown *= fx.mortar.cooldownMul;
  if (fx.eclipse) {
    const n = Math.max(1, stats.amount);
    stats.amount = 1;
    stats.radius *= 1 + fx.eclipse.sizePer * (n - 1);
    stats.damage *= Math.max(1, fx.eclipse.damagePer * n);
  }
  if (fx.toll) {
    stats.cooldown *= fx.toll.cooldown / (def.base.cooldown || 1);
    stats.amount = 1;
    stats.radius *= fx.toll.areaMul;
    stats.damage *= fx.toll.damageMul;
  }
  if (fx.riptide) stats.knockback *= fx.riptide.knockMul;
  if (fx.sweep) stats.duration = fx.sweep.duration;
  if (fx.rod) stats.amount += fx.rod.extra;
}

// ---------------------------------------------------------------- fire

/** Every tick, before the cooldowns (sim/weapons.js weaponsFire): Lunge and Slick Trail. */
export function formsTick(world, slot) {
  const fx = slot.fx, p = world.player;
  if (fx.lunge && p.dashStart === world.tick) {
    // Four harpoons, square to the way you dash.
    const n = fx.lunge.count, sc = world.scratch.sc;
    const base = fatan2(p.dashDy, p.dashDx);
    for (let k = 0; k < n; k++) {
      sincosInto(base + (k / n) * TAU, sc, 0);
      fireAlong(world, slot, p.x, p.y, sc[1], sc[0], NO_HANDLE);
    }
    firedEvent(world, slot, n);
  }
  if (fx.trail && p.moving && world.tick >= slot.fs.trailAt) {
    slot.fs.trailAt = world.tick + Math.max(1, Math.round(fx.trail.every * TPS));
    const z = slotZone(world, slot);
    if (z) {
      const s = slot.stats;
      const g = groundAt(world, slot.index, p.x, p.y, z.radius * fx.trail.radiusMul * s.area, z.duration, z.damage, z.interval, z.zoneList);
      if (g >= 0) { world.zones.def[g] = slot.defIndex; if (slot.fx.fuel) fuelLink(world, slot, g); }
    }
  }
}

/**
 * After a volley of `shots` shots (sim/weapons.js weaponsFire): Salvo's ring every Nth shot. Each
 * ring is turned half a gap from the last, so the rings between them cover every way out.
 */
export function formsAfterVolley(world, slot, shots) {
  const fx = slot.fx, fs = slot.fs;
  if (fx.toll) fs.tollCut = 0; // a new ring: its kills cut the next one afresh
  if (fx.salvo) {
    fs.shots += shots;
    if (fs.shots >= fx.salvo.every) {
      fs.shots %= fx.salvo.every;
      const p = world.player, n = fx.salvo.count, sc = world.scratch.sc;
      const turn = (fs.rings % 2) * (TAU / (2 * n));
      fs.rings++;
      for (let k = 0; k < n; k++) {
        sincosInto(turn + (k / n) * TAU, sc, 0);
        // A lobbed ring lands the throw's reach out, all round.
        fireAlong(world, slot, p.x, p.y, sc[1], sc[0], NO_HANDLE);
      }
      firedEvent(world, slot, n);
    }
  }
}

/**
 * Where a Mortar lobs: the live enemy in range with the most others within 40 px of it, from the
 * first 24 live ones the spatial hash gives (a cap that keeps it cheap in a packed screen; ties go
 * to the nearer). Returns an enemy index, or -1.
 */
export function crowdTarget(world, range) {
  const E = world.enemies, p = world.player, q = world.scratch.qreg, near = world.scratch.near;
  q[0] = p.x; q[1] = p.y; q[2] = range;
  const m = world.enemyHash.queryR(q, near, -1);
  const cand = world.scratch.crowd;
  let c = 0;
  for (let k = 0; k < m && c < cand.length; k++) {
    const e = near[k];
    if ((E.flags[e] & EF.DEAD) === 0) cand[c++] = e;
  }
  let best = -1, bestN = -1, bestD = Infinity;
  const blast = world.scratch.blast, r = world.scratch.reg;
  for (let k = 0; k < c; k++) {
    const e = cand[k];
    r[0] = E.x[e]; r[1] = E.y[e]; r[2] = 40;
    const n = world.enemyHash.queryR(r, blast, -1);
    const dx = E.x[e] - p.x, dy = E.y[e] - p.y, d = dx * dx + dy * dy;
    if (n > bestN || (n === bestN && d < bestD)) { best = e; bestN = n; bestD = d; }
  }
  return best;
}

/**
 * Planted Rod: the rod is planted where you stand when there is none, it has stood its time, or
 * you've walked `replantAt` px from it. Returns true when strikes should fall around it.
 */
export function plantRod(world, slot) {
  const f = slot.fx.rod, fs = slot.fs, p = world.player;
  const dx = p.x - fs.rodX, dy = p.y - fs.rodY;
  if (fs.rodUntil < world.tick || dx * dx + dy * dy > f.replantAt * f.replantAt) {
    fs.rodX = p.x; fs.rodY = p.y; fs.rodUntil = world.tick + Math.round(f.life * TPS);
  }
  return true;
}

/** Pyre: a volley's flames go into the pyre; once it holds `hold`, it erupts every one. Returns how many flew (0: gathering). */
export function stokePyre(world, slot, amount) {
  const f = slot.fx.pyre, fs = slot.fs;
  fs.pyre += amount;
  if (fs.pyre < f.hold) return 0;
  const n = fs.pyre;
  fs.pyre = 0;
  const p = world.player, s = slot.stats, sc = world.scratch.sc;
  const ox = p.x + 12, oy = p.y - 4; // the pyre stands at your side
  for (let k = 0; k < n; k++) {
    sincosInto((k / n) * TAU, sc, 0);
    const o = shotOpts();
    o.motion = MOTION.homing; o.m0 = slot.motion.turn ?? 5; o.m1 = slot.motion.range ?? 260; o.pierce = -1;
    o.damage = s.damage * f.damageMul;
    shotAt(world, ox + sc[1] * 6, oy + sc[0] * 6, sc[1], sc[0], (slot.motion.speed ?? 90) * s.speed * 1.4);
    spawnShot(world, slot, o);
  }
  return n;
}

/** Eclipse: how much bigger the orb is now (1 to 2), from its kills. */
export function eclipseScale(slot) {
  return slot.fx.eclipse ? 1 + slot.fs.growth : 1;
}

function firedEvent(world, slot, n) {
  slot.fired += n;
  const ev = world.events, i = ev.reserve(EV.FIRE);
  if (i >= 0) { ev.x[i] = world.player.x; ev.y[i] = world.player.y; ev.a[i] = slot.index; ev.b[i] = n; }
}

/** The slot's own ground (the Oil Flask's burning oil): its first zone effect, or null. */
function slotZone(world, slot) {
  const list = world.fxLists[slot.list];
  for (let k = 0; k < list.length; k++) if (list[k].type === 'zone') return list[k];
  return null;
}

// ---------------------------------------------------------------- move

/**
 * Per shot, as it moves (sim/weapons.js moveProjectiles): a Skewer's carried enemy rides it, a
 * wisp lures, an Eclipse orb grows. Called only for slots with one of those Forms.
 */
export function formsMove(world, slot, i) {
  const P = world.projectiles, E = world.enemies, fx = slot.fx;
  if (P.carry[i] !== NO_HANDLE) {
    const e = E.resolve(P.carry[i]);
    if (e < 0 || (E.flags[e] & EF.DEAD) !== 0) P.carry[i] = NO_HANDLE;
    else {
      // Pinned to the harpoon's point: no walking, no knockback of its own.
      E.x[e] = P.x[i]; E.y[e] = P.y[i]; E.vx[e] = 0; E.vy[e] = 0;
      if (E.dazeT[e] < 0.1) E.dazeT[e] = 0.1;
    }
  }
  if (fx.wisps && (P.flags[i] & PF.CHILD) === 0) {
    const every = Math.max(1, Math.round(fx.wisps.every * TPS));
    if ((Math.round(P.age[i] * TPS) % every) === 0) {
      const q = world.scratch.reg, near = world.scratch.lure, num = world.scratch.num;
      q[0] = P.x[i]; q[1] = P.y[i]; q[2] = fx.wisps.range;
      const m = world.enemyHash.queryR(q, near, -1);
      for (let k = 0; k < m; k++) {
        const e = near[k];
        if ((E.flags[e] & (EF.DEAD | EF.BOSS)) !== 0) continue;
        const dx = P.x[i] - E.x[e], dy = P.y[i] - E.y[e], d = Math.sqrt(dx * dx + dy * dy);
        if (d < 6) continue;
        num[1] = dx / d; num[2] = dy / d; num[3] = fx.wisps.strength; impulseR(world, e);
      }
    }
  }
  if (fx.eclipse && P.motion[i] === MOTION.orbit) {
    const g = eclipseScale(slot);
    P.radius[i] = P.m3[i] * g;
    P.scale[i] = g >= 1.75 ? 3 : 2;
  }
}

// ---------------------------------------------------------------- hits

/** Skewer: the first enemy a harpoon hits (not an elite or a boss) is carried from then on. */
export function skewerCatch(world, i, e) {
  const P = world.projectiles, E = world.enemies;
  if (P.carry[i] !== NO_HANDLE || (P.flags[i] & PF.CHILD) !== 0) return;
  if ((E.flags[e] & (EF.ELITE | EF.BOSS)) !== 0) return;
  P.carry[i] = E.handle(e);
}

/** Burning Glass: how hot enemy e burns from this hit (each within `hold` s of the last adds a step, up to 1 + max). */
export function focusMul(world, f, e) {
  const E = world.enemies, tick = world.tick;
  const hold = Math.round(f.hold * TPS); // a gap longer than this starts it over
  if (tick - E.focusT[e] > hold) E.focusN[e] = 0;
  const n = Math.min(Math.round(f.max / f.per), E.focusN[e]);
  if (E.focusN[e] < 250) E.focusN[e]++;
  E.focusT[e] = tick;
  return 1 + n * f.per;
}

const BURN = { status: 'burn', dps: 0, duration: 0 }; // reused: applyStatus copies what it keeps

/** Burning Glass: a beam hit sets enemy e burning, hotter each time it's found again in time. */
export function focusBurn(world, slot, fx, e, damage) {
  BURN.dps = damage * fx.burn * focusMul(world, fx, e);
  BURN.duration = fx.duration;
  applyStatus(world, e, BURN, slot.index);
}

/** Hanging Flare: where it hits, a flare hangs and rains sparks (a ground of its own look). */
export function hangFlare(world, slot, fx, x, y, damage) {
  if (world.tick < slot.fs.hangAt) return;
  slot.fs.hangAt = world.tick + Math.max(1, Math.round(fx.every * TPS));
  const g = groundAt(world, slot.index, x, y, fx.radius * slot.stats.area, fx.duration, damage * fx.damageMul, fx.interval, slot.childList);
  if (g >= 0) { world.zones.style[g] = ZSTYLE.FLARE; world.zones.def[g] = slot.defIndex; }
}

/** Riptide and Static: a mark that rides enemy e (at most `max` out at once for the slot). */
export function markEnemy(world, slot, fx, e, damage) {
  if (slot.fs.marks >= fx.max) return;
  const Z = world.zones, E = world.enemies;
  const z = Z.alloc();
  if (z < 0) return;
  slot.fs.marks++;
  Z.kind[z] = ZONE.MARK; Z.slot[z] = slot.index; Z.list[z] = slot.childList;
  Z.style[z] = fx.mark === 'riptide' ? MARKS.RIPTIDE : MARKS.STATIC;
  Z.target[z] = E.handle(e);
  Z.x[z] = E.x[e]; Z.y[z] = E.y[e];
  Z.radius[z] = Z.maxRadius[z] = (fx.radius ?? fx.range) * (fx.mark === 'riptide' ? slot.stats.area : 1);
  Z.life[z] = fx.duration;
  Z.damage[z] = damage * fx.damageMul;
  Z.interval[z] = Math.max(1, Math.round((fx.every ?? fx.duration) * TPS));
  Z.nextTick[z] = world.tick + Z.interval[z];
  Z.def[z] = slot.defIndex;
}

/** Firebomb: a flask that lands bursts into small ones, thrown out around it. */
export function clusterFlasks(world, slot, fx, hx, hy, damage, radius) { // fx: the Firebomb's data
  const n = fx.count, sc = world.scratch.sc;
  const turn = world.rng.combat.next() * TAU;
  for (let k = 0; k < n; k++) {
    sincosInto(turn + (k / n) * TAU, sc, 0);
    const o = shotOpts();
    o.motion = MOTION.arc; o.flags = PF.CHILD; o.list = slot.childList;
    o.damage = damage * fx.damageMul; o.radius = radius * fx.radiusMul; o.pierce = -1;
    o.m0 = hx + sc[1] * fx.spread; o.m1 = hy + sc[0] * fx.spread; o.m2 = 0.35; o.life = 0.35 + DT;
    shotAt(world, hx, hy, sc[1], sc[0], 0);
    spawnShot(world, slot, o);
  }
}

/** Storm Front: a strike marches on, away from you, hitting everything on its line. */
export function marchStrike(world, slot, fx, hx, hy, damage, radius) {
  const p = world.player;
  let dx = hx - p.x, dy = hy - p.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d > 1) { dx /= d; dy /= d; } else { dx = p.fx; dy = p.fy; }
  const o = shotOpts();
  o.motion = MOTION.linear; o.flags = PF.CHILD | PF.MARCH; o.list = slot.childList;
  o.damage = damage * fx.damageMul; o.radius = radius; o.pierce = -1;
  o.life = fx.reach / fx.speed;
  shotAt(world, hx, hy, dx, dy, fx.speed);
  spawnShot(world, slot, o);
}

/**
 * Fuel Line: a new pool (zone g) that touches the slot's other pools links up with them, and
 * every pool linked to it flares at once: a pulse now at `flareMul` damage, and its time renewed.
 */
export function fuelLink(world, slot, g) {
  const Z = world.zones, f = slot.fx.fuel;
  const seen = world.scratch.link;
  let n = 0, head = 0;
  seen[n++] = g;
  // Grow the linked set from the new pool, through pools that touch.
  while (head < n && n < seen.length) {
    const a = seen[head++];
    for (let z = 0; z < Z.count && n < seen.length; z++) {
      if (Z.kind[z] !== ZONE.GROUND || Z.slot[z] !== slot.index || Z.life[z] <= 0) continue;
      let known = false;
      for (let k = 0; k < n; k++) if (seen[k] === z) { known = true; break; }
      if (known) continue;
      const dx = Z.x[z] - Z.x[a], dy = Z.y[z] - Z.y[a], r = Z.radius[z] + Z.radius[a];
      if (dx * dx + dy * dy <= r * r) seen[n++] = z;
    }
  }
  if (n < 2) return 0;
  for (let k = 0; k < n; k++) {
    const z = seen[k];
    Z.nextTick[z] = world.tick;            // pulses this tick...
    Z.flags[z] |= ZF.FLARE;                // ...at flareMul damage, once (sim/weapons.js zonesTick)
    if (Z.life[z] < Z.life[g]) Z.life[z] = Z.life[g];
  }
  const ev = world.events, i = ev.reserve(EV.EXPLODE);
  if (i >= 0) { ev.x[i] = Z.x[g]; ev.y[i] = Z.y[g]; ev.a[i] = Z.radius[g] * 2; ev.b[i] = slot.index; }
  return n;
}

/**
 * A shot is spent (sim/weapons.js, just before it's removed): a Skewer's carried enemy bursts,
 * and a Tether sticks in the last enemy the harpoon hit.
 */
export function shotEnded(world, slot, i) {
  const P = world.projectiles, E = world.enemies, fx = slot.fx;
  if (P.carry[i] !== NO_HANDLE) {
    const e = E.resolve(P.carry[i]);
    P.carry[i] = NO_HANDLE;
    if (e >= 0 && (E.flags[e] & EF.DEAD) === 0) {
      const s = slot.stats;
      explodeAt(world, slot.index, E.x[e], E.y[e], fx.skewer.burstRadius * s.area, P.damage[i] * fx.skewer.burstMul, s.knockback, -1);
    }
  }
  if (fx.tether && (P.flags[i] & PF.CHILD) === 0) {
    const last = P.hits[i * HIT_RING + ((P.hitPos[i] + HIT_RING - 1) % HIT_RING)];
    if (last === NO_HANDLE) return; // it hit nothing
    // Stuck in that enemy; if the hit killed it, stuck where it fell (the shot's point), and the
    // chain holds there (sim/weapons.js zonesTick).
    const e = E.resolve(last), alive = e >= 0 && (E.flags[e] & EF.DEAD) === 0;
    const Z = world.zones, z = Z.alloc();
    if (z < 0) return;
    Z.kind[z] = ZONE.TETHER; Z.slot[z] = slot.index; Z.list[z] = slot.childList;
    Z.target[z] = last;
    Z.x[z] = alive ? E.x[e] : P.x[i]; Z.y[z] = alive ? E.y[e] : P.y[i];
    Z.life[z] = fx.tether.duration;
    Z.thickness[z] = fx.tether.width * slot.stats.area;
    Z.damage[z] = slot.stats.damage * fx.tether.damageMul;
    Z.def[z] = slot.defIndex;
  }
}

// ---------------------------------------------------------------- kills

/**
 * A kill by a weapon with a kill Form (sim/enemies.js resolveDeaths). `byZone`: the blow was one
 * of its zones' pulses (a pool, a ward), not its own hit.
 */
export function formKill(world, slot, x, y, byZone) {
  const fx = slot.fx, fs = slot.fs, tick = world.tick, s = slot.stats;
  if (fx.toll) {
    // Each kill brings the next ring sooner, by at most `maxCut` of the wait in all.
    const cut = Math.min(fx.toll.cutPerKill, s.cooldown * fx.toll.maxCut - fs.tollCut);
    if (cut > 0) { slot.cd -= cut; fs.tollCut += cut; }
  }
  if (fx.eclipse) {
    fs.growth = Math.min(1, fs.growth + fx.eclipse.growPerKill);
    if (fs.growth >= 1) {
      // Full: every orb bursts, and the orb starts small again.
      fs.growth = 0;
      const P = world.projectiles;
      for (let i = 0; i < P.count; i++) {
        if (P.slot[i] !== slot.index || (P.flags[i] & (PF.DEAD | PF.CHILD)) !== 0) continue;
        explodeAt(world, slot.index, P.x[i], P.y[i], fx.eclipse.burstRadius * s.area, s.damage * fx.eclipse.burstMul, s.knockback * 2, -1);
      }
    }
  }
  if (fx.wards && !byZone && tick >= fs.wardAt && fs.wards < fx.wards.max) {
    fs.wardAt = tick + Math.max(1, Math.round(fx.wards.every * TPS));
    const g = groundAt(world, slot.index, x, y, fx.wards.radius * s.area, fx.wards.duration, s.damage * fx.wards.damageMul, fx.wards.interval, slot.childList);
    if (g >= 0) { world.zones.style[g] = ZSTYLE.WARD; world.zones.def[g] = slot.defIndex; fs.wards++; }
  }
  if (fx.vigil && tick >= fs.vigilAt) {
    fs.vigilAt = tick + Math.max(1, Math.round(fx.vigil.every * TPS));
    const o = shotOpts();
    o.motion = MOTION.homing; o.m0 = slot.motion.turn ?? 5; o.m1 = slot.motion.range ?? 260; o.pierce = -1;
    o.life = fx.vigil.life;
    shotAt(world, x, y, 0, -1, (slot.motion.speed ?? 90) * s.speed);
    spawnShot(world, slot, o);
  }
}

/** Does this slot have a Form that acts on its kills? */
export function hasKillForm(fx) {
  return !!(fx.toll || fx.eclipse || fx.wards || fx.vigil);
}

/** Does this slot have a Form that acts on its shots as they move or end? */
export function hasShotForm(fx) {
  return !!(fx.skewer || fx.wisps || fx.eclipse || fx.tether);
}

/** A zone is removed (sim/weapons.js zonesTick): a mark or a ward frees its place. */
export function zoneGone(world, slot, z) {
  const Z = world.zones;
  if (Z.kind[z] === ZONE.MARK) slot.fs.marks = Math.max(0, slot.fs.marks - 1);
  else if (Z.kind[z] === ZONE.GROUND && Z.style[z] === ZSTYLE.WARD) slot.fs.wards = Math.max(0, slot.fs.wards - 1);
}

/**
 * A mark this tick (sim/weapons.js zonesTick): it rides its enemy; Static zaps the nearest
 * neighbor in pulses; Riptide bursts where the thrown enemy lands, when its time is up.
 */
export function markTick(world, slot, z) {
  const Z = world.zones, E = world.enemies;
  const e = E.resolve(Z.target[z]);
  if (e >= 0 && (E.flags[e] & EF.DEAD) === 0) { Z.x[z] = E.x[e]; Z.y[z] = E.y[e]; }
  else if (Z.style[z] === MARKS.STATIC) { Z.life[z] = 0; return; } // a charge dies with its enemy
  if (Z.style[z] === MARKS.RIPTIDE) {
    if (Z.life[z] <= 0) explodeAt(world, slot.index, Z.x[z], Z.y[z], Z.radius[z], Z.damage[z], 0.4, e);
    return;
  }
  if (world.tick < Z.nextTick[z]) return;
  Z.nextTick[z] = world.tick + Z.interval[z];
  const self = e;
  if (self >= 0) E.flags[self] |= EF.MARK;
  const t = world.enemyHash.nearest(Z.x[z], Z.y[z], Z.radius[z], E.flags, EF.DEAD | EF.MARK, -1);
  if (self >= 0) E.flags[self] &= ~EF.MARK;
  if (t < 0) return;
  world.scratch.num[0] = Z.damage[z];
  damageEnemyR(world, t, slot.index, false);
  const ev = world.events, i = ev.reserve(EV.ZAP);
  if (i >= 0) { ev.x[i] = Z.x[z]; ev.y[i] = Z.y[z]; ev.a[i] = E.x[t]; ev.b[i] = E.y[t]; }
}
