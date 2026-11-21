// Forms, lines, and specials (ARCHITECTURE §5.16; ruling 14, C1: work/cw/C1-CONTRACT.md; the numbers:
// data/weapons.js and data/ascensions.js): everything that changes what a weapon does.
//
// A weapon holds one Form option per axis (how it fires, how its shots travel, the capstone), the
// Rare and Epic lines it rolled, and its Legendary specials. Each is a `boost`: { stats, onHit,
// emit, motion, fx }. buildForms folds them all into the slot's pipeline as it is built
// (sim/weapons.js buildSlot); `fx` is the mechanics by key, built here in up to four places:
//   build    the pipeline (a motion, an on-hit effect, a field the emitter reads)
//   stats    the slot's numbers after its upgrades and your bonuses
//   fire     when and where it fires (formsTick, formsAfterVolley, the emitters)
//   kill     a kill by the weapon (sim/enemies.js resolveDeaths)
// Only a fire option replaces an emitter's type and only a travel option a motion's, so nothing a
// weapon holds cancels another thing it holds. A slot keeps its options (`ascensions`), the
// mechanics by key (`fx`), and their running state (`fs`: numbers only, every one in the world's
// state hash; `pots`: a typed array, hashed too).

import { DT, TPS, EF, EF_GONE, PF, MOTION, ZONE, ZF, ZSTYLE, MARKS, HIT_RING, RELIC_SLOT } from './constants.js';
import { NO_HANDLE } from './pools.js';
import { EV } from './events.js';
import { impulseR, damageEnemyR, applyStatus } from './enemies.js';
import { dazeEnemy } from './holds.js';
import { sincosInto, fatan2, TAU, PI } from '../lib/fmath.js';
import {
  addEffect, spawnShot, shotOpts, shotAt, fireAlong, fireFrom, explodeAt, groundAt, compileList,
} from './weapons.js';

/** Every mechanic key a boost's `fx` (or a signature Form's `form`) may name here; a character's hook may read others (data/signature-forms.js SIGNATURE_MECHANICS). */
export const FORM_KEYS = Object.freeze([
  'salvo', 'mortar', 'hang', 'eclipse', 'hunting', 'wards', 'lunge', 'skewer', 'tether', 'toll', 'breakers', 'riptide', 'sweep',
  'relay', 'focus', 'trail', 'cluster', 'fuel', 'march', 'static', 'pyre', 'wisps', 'vigil', 'drift', 'ricochet', 'capstone',
  'muzzle', 'stance', 'reach', 'origin', 'cue', 'killburst', 'loop', 'twin', 'breathe', 'sides', 'yank', 'crowd', 'swell',
  'stand', 'knell', 'echo', 'fork', 'bonus', 'skip', 'strikeback', 'corpse', 'ramp', 'merge', 'pincer', 'stick', 'returnMul',
  'rethrow', 'mine', 'recoil', 'latch', 'frenzy', 'guard', 'dredge', 'rearm', 'hoard', 'kick', 'toss', 'tidepool', 'seep',
  'wade', 'leash', 'pitch', 'returnFreeze', 'wreck', 'endGround', 'poolGrow', 'crest',
]);

/** A slot's running state, made once and kept through rebuilds. Numbers only (the world hash walks it). */
export function createFormState() {
  return {
    shots: 0, rings: 0,      // Salvo: shots toward the next ring, and rings fired (each turned a little)
    growth: 0,               // Eclipse: 0..1, from kills
    rodX: 0, rodY: 0, rodUntil: -1,   // the Lightning Rod's rod: where, and the tick it's pulled up (-1: none)
    pyre: 0,                 // Pyre: flames gathered
    egAt: 0,                 // a shot-end ground with a clock (Signal Flare): the tick the next may be left
    trailAt: 0,              // Slick Trail: the tick of the next pool
    hangAt: 0,               // Hanging Flare: the tick the next one may hang
    wardAt: 0, vigilAt: 0,   // Wards, Vigil: the tick the next may appear
    marks: 0,                // Riptide, Static: marks out now
    wards: 0,                // Wards: wards out now
    critAt: -9999,           // Sea Legs' rule: the tick this weapon's last free crit landed
    cueAt: 0,                // the tick a walk-, stand-, or clock-fired piece may fire again (ruling 16)
    stillT: 0, moveT: 0,     // seconds standing still, and moving, without a break
    live: 0, liveDmg: 1, liveRate: 1, liveArea: 1,   // what a stance, a frenzy, a hoard, a ramp, or an echo is worth right now
    ox: 0, oy: 0, oUntil: -1,   // a planted thing (a buoy, the newest pot): where, and the tick it goes
    potAt: 0, potN: 0,       // the Eel Pot: the tick the next pot is set, and how many have been
    echoOn: 0,               // an echo: 0 none, 2 waiting to repeat, 1 the repeat is flying
    kbAt: 0, sbAt: 0, loopAt: 0, guardAt: 0,   // throttles: a kill's burst, a strike back, a closed loop, the pot's own bite
    frenzy: 0, frenzyUntil: 0,   // Feeding Frenzy: bites stacked, and the tick they lapse
    hoard: 0, souls: 0,      // Field of Glass: pieces lying; Soul Lantern: kills banked
    bittern: 0,              // Bittern's Call's rule: volleys toward the next double
  };
}

// ---------------------------------------------------------------- build

/** Fold one boost into a pipeline: its emitter and motion fields, its on-hit effects, its mechanics, its numbers. */
function applyBoost(pipe, fx, stats, b) {
  if (!b) return;
  if (b.emit) pipe.emit = { ...pipe.emit, ...JSON.parse(JSON.stringify(b.emit)) };
  if (b.motion) pipe.motion = { ...pipe.motion, ...b.motion };
  for (const e of b.onHit || []) addEffect(pipe.onHit, e);
  // (Two boosts that each name a status bonus keep both: `bonus` becomes a list.)
  if (b.fx) for (const k of Object.keys(b.fx)) fx[k] = k === 'bonus' && fx.bonus ? [].concat(fx.bonus, b.fx.bonus) : b.fx[k];
  if (b.stats) stats.push(b.stats);
}

/**
 * Patch a slot's pipeline for everything it holds: `pipe` is { emit, motion, onHit } (copies,
 * changed in place); `ascensions` its Form options, `boosts` its lines' and specials' boosts.
 * Returns { fx, stats }: the mechanics by key, and the number boosts in order.
 */
export function buildForms(pipe, ascensions, boosts = []) {
  const fx = {}, stats = [];
  for (const a of ascensions) {
    // A signature Form's own shape: its key is `form`, its numbers are on the option (the character's hook reads slot.fx[form]).
    if (a.form) fx[a.form] = a;
    applyBoost(pipe, fx, stats, a.boost);
  }
  for (const b of boosts) applyBoost(pipe, fx, stats, b);
  // Burning Glass on a Full Circle: the sweep finds every enemy round you each time, so its focus
  // would stack on all of them; on a sweep it stacks to 2x, not 3x (ruling 18 WA).
  if (fx.sweep && fx.focus) fx.focus = { ...fx.focus, max: fx.focus.max * 0.5 };
  for (const k of Object.keys(fx)) {
    const a = fx[k];
    switch (k) {
      case 'mortar':
        pipe.motion = { type: 'arc', range: a.range, flight: a.flight };
        pipe.emit = { ...pipe.emit, aim: pipe.emit.aim ?? 'crowd', range: Math.max(pipe.emit.range ?? 0, a.range) };
        break; // its burst is once, where it lands (sim/weapons.js projectileHits)
      case 'hang': pipe.onHit.push({ type: 'hang', radius: a.radius, duration: a.duration, damageMul: a.damageMul, interval: a.interval, every: a.every }); break;
      case 'focus': pipe.onHit.push({ type: 'focus', per: a.per, max: a.max, hold: a.hold, burn: a.burn, duration: a.duration }); break;
      case 'hunting': pipe.motion = { type: 'homing', speed: a.speed, turn: a.turn, range: a.range }; break;
      case 'toll': addEffect(pipe.onHit, { type: 'status', status: 'freeze', duration: a.freeze }); break;
      case 'riptide': pipe.onHit.push({ type: 'mark', mark: 'riptide', duration: a.delay, radius: a.radius, damageMul: a.damageMul, max: a.max }); break;
      case 'relay': addEffect(pipe.onHit, { type: 'chain', hops: fx.sweep ? (a.sweepHops ?? a.hops) : a.hops, range: a.range, damageMul: a.damageMul }); break; // a sweep already finds the crowd
      case 'march': pipe.onHit.push({ type: 'march', reach: a.reach, speed: a.speed, damageMul: a.damageMul }); break;
      case 'static': pipe.onHit.push({ type: 'mark', mark: 'static', duration: a.duration, every: a.every, range: a.range, damageMul: a.damageMul, max: a.max }); break;
      case 'ricochet': pipe.motion = { ...pipe.motion, type: 'bounce', bounces: a.bounces }; break;
      default: break; // the rest are read where the weapon fires, moves, hits, or kills
    }
  }
  return { fx, stats };
}

/** One number boost on the slot (`stats` its own copy). */
function boostStats(stats, b) {
  if (b.set) {
    if (b.set.pierce !== undefined) stats.pierce = b.set.pierce;
    if (b.set.hitCooldown !== undefined) stats.hitCooldown = b.set.hitCooldown;
    if (b.set.amount !== undefined) stats.amount = b.set.amount;
  }
  if (b.damageMul) stats.damage *= b.damageMul;
  if (b.amount) stats.amount += b.amount;
  if (b.areaMul) stats.area *= b.areaMul;
  if (b.cooldownMul) stats.cooldown *= b.cooldownMul;
  if (b.speedMul) stats.speed *= b.speedMul;
  if (b.durationMul) stats.duration *= b.durationMul;
  if (b.durationAdd) stats.duration += b.durationAdd;
  if (b.knockbackMul) stats.knockback *= b.knockbackMul;
  if (b.radiusMul) stats.radius *= b.radiusMul;
  if (b.hitCooldownMul) stats.hitCooldown *= b.hitCooldownMul;
  if (b.orbitMul) stats.orbitMul = (stats.orbitMul ?? 1) * b.orbitMul;
  if (b.pierce && stats.pierce >= 0) stats.pierce = Math.max(1, stats.pierce + b.pierce);
}

/** The slot's numbers for everything it holds, after its upgrades and bonuses (`stats` is the slot's own copy). */
export function formStats(stats, fx, def, boosts = []) {
  stats.orbitMul = 1;
  for (const b of boosts) boostStats(stats, b);
  for (const k in fx) if (fx[k] && fx[k].form && fx[k].boost && fx[k].boost.stats) boostStats(stats, fx[k].boost.stats);   // a signature Form's own
  if (fx.ricochet) stats.duration *= fx.ricochet.lifeMul;
  if (fx.eclipse) {
    const n = Math.max(1, stats.amount);
    stats.amount = 1;
    stats.radius *= 1 + fx.eclipse.sizePer * (n - 1);
    stats.damage *= Math.max(1, fx.eclipse.damagePer * n);
  }
  if (fx.merge) {
    const n = Math.max(1, stats.amount);
    stats.amount = 1;
    stats.radius *= fx.merge.size * (1 + fx.merge.sizePer * (n - 1));
    stats.damage *= fx.merge.damageBase + fx.merge.damagePer * (n - 1);
  }
  if (fx.toll) {
    stats.cooldown *= fx.toll.cooldown / (def.base.cooldown || 1);
    if (fx.toll.minCooldown) stats.cooldown = Math.max(stats.cooldown, fx.toll.minCooldown);   // (Cooldown cards bring the ring on, never past this: C1 Nov 17)
    stats.amount = 1;
    stats.radius *= fx.toll.areaMul;
    stats.damage *= fx.toll.damageMul;
  }
  if (fx.riptide) stats.knockback *= fx.riptide.knockMul;
  if (fx.sweep) { stats.duration = fx.sweep.duration; stats.damage *= fx.sweep.damageMul ?? 1; }
  if (fx.breakers) stats.damage *= fx.breakers.damageMul ?? 1;
  if (fx.mine) stats.damage *= fx.mine.damageMul ?? 1;
}

/** Does this slot have anything that runs every tick? */
export function hasTickForm(fx, emit) {
  return !!(fx.eclipse || fx.wards || fx.vigil || fx.strikeback || fx.stance || fx.frenzy || fx.hoard || fx.ramp || fx.echo || fx.origin || emit.pot || fx.cue || fx.lunge || fx.trail || fx.kick || emit.rodStill || fx.rearm || fx.loop || fx.guard);
}

// ---------------------------------------------------------------- fire

/** Where the weapon in this slot fires from for shot k of a volley: out[0], out[1]. You, unless it has a pot, a buoy, or a point ahead. */
export function originOf(world, slot, k, out) {
  const p = world.player, tick = world.tick;
  out[0] = p.x; out[1] = p.y;
  if (slot.pots !== null && slot.emit.pot) {
    const P = slot.pots, max = Math.min(3, slot.emit.pot.max ?? 1);
    let live = 0;
    for (let j = 0; j < max; j++) if (P[3 * j + 2] >= tick) live++;
    if (live === 0) return false;
    let want = k % live;
    for (let j = 0; j < max; j++) {
      if (P[3 * j + 2] < tick) continue;
      if (want-- === 0) { out[0] = P[3 * j]; out[1] = P[3 * j + 1]; return true; }
    }
    return false;
  }
  const o = slot.fx.origin;
  if (!o) return false;
  if (o.mode === 'ahead') { out[0] = p.x + p.fx * o.dist; out[1] = p.y + p.fy * o.dist; return true; }
  if (slot.fs.oUntil >= tick) { out[0] = slot.fs.ox; out[1] = slot.fs.oy; return true; }
  return false;
}

/** How many of the slot's pots stand now (at least 1: with none, it lunges from you). */
export function potsLive(world, slot) {
  if (slot.pots === null || !slot.emit.pot) return 1;
  let live = 0;
  const max = Math.min(3, slot.emit.pot.max ?? 1);
  for (let j = 0; j < max; j++) if (slot.pots[3 * j + 2] >= world.tick) live++;
  return live > 0 ? live : 1;
}

function plantEvent(world, slot, x, y, kind, sec) {
  const ev = world.events, i = ev.reserve(EV.PLANT);
  if (i >= 0) { ev.x[i] = x; ev.y[i] = y; ev.a[i] = slot.index; ev.b[i] = kind; ev.c[i] = sec; }
}

/** Set a pot at (x, y): the oldest place of the weapon's pots takes it. */
function setPot(world, slot, x, y) {
  const P = slot.pots, d = slot.emit.pot, fs = slot.fs;
  const max = Math.min(3, d.max ?? 1), j = fs.potN % max;
  P[3 * j] = x; P[3 * j + 1] = y; P[3 * j + 2] = world.tick + Math.round(d.life * TPS);
  fs.potN++;
  fs.ox = x; fs.oy = y; fs.oUntil = P[3 * j + 2];
  plantEvent(world, slot, x, y, 1, d.life);
}

/** A burst that hurts nothing by itself but lays a status on everything in reach (and can daze). */
function statusBurst(world, slot, x, y, radius, status, sec, amount, exclude) {
  const E = world.enemies, q = world.scratch.reg, near = world.scratch.lure;
  q[0] = x; q[1] = y; q[2] = radius;
  const m = world.enemyHash.queryR(q, near, -1);
  for (let k = 0; k < m; k++) {
    const e = near[k];
    if (e === exclude || (E.flags[e] & EF_GONE) !== 0) continue;
    if (status === 'daze') { world.scratch.hold[0] = sec; dazeEnemy(world, e); continue; }
    ST.status = status; ST.duration = sec; ST.dps = amount; ST.pct = amount; ST.amp = amount;
    applyStatus(world, e, ST, slot.index);
  }
}
const ST = { status: 'burn', dps: 0, duration: 0, pct: 0, amp: 0 }; // reused: applyStatus copies what it keeps

/** Daze everything within `radius` of a point for `sec` s (Waders' rule: standing still). */
export function dazeAround(world, x, y, radius, sec) {
  statusBurst(world, world.slots[RELIC_SLOT], x, y, radius, 'daze', sec, 0, -1);
}

/** The slot's own shots lying still on the ground (glass), counted. */
function lyingShots(world, slot) {
  const P = world.projectiles;
  let n = 0;
  for (let i = 0; i < P.count; i++) if (P.slot[i] === slot.index && P.motion[i] === MOTION.stationary && (P.flags[i] & (PF.DEAD | PF.CHILD)) === 0) n++;
  return n;
}

/** Every tick, before the cooldowns (sim/weapons.js weaponsFire), for a slot with anything that runs by the tick. */
export function formsTick(world, slot) {
  const fx = slot.fx, fs = slot.fs, p = world.player, tick = world.tick, s = slot.stats;
  // Standing and moving, and what they are worth now.
  if (p.moving || p.dashTicks > 0) { fs.stillT = 0; fs.moveT += DT; } else { fs.moveT = 0; fs.stillT += DT; }
  let dmg = 1, rate = 1, area = 1, live = 0;
  const st = fx.stance;
  if (st) {
    if (st.still && fs.stillT >= st.still.after) { dmg *= st.still.damageMul ?? 1; rate *= st.still.rateMul ?? 1; area *= st.still.areaMul ?? 1; live = 1; }
    else if (st.elseAreaMul) area *= st.elseAreaMul;
    if (st.moving) {
      const u = Math.min(1, fs.moveT / (st.moving.ramp || 0.01));
      dmg *= 1 + ((st.moving.damageMul ?? 1) - 1) * u; rate *= 1 + ((st.moving.rateMul ?? 1) - 1) * u; area *= 1 + ((st.moving.areaMul ?? 1) - 1) * u;
      if (u > 0) live = 1;
    }
  }
  if (fx.frenzy) { if (tick > fs.frenzyUntil) fs.frenzy = 0; rate *= 1 + fx.frenzy.per * fs.frenzy; }
  if (fx.hoard) { if (tick % 30 === 0) fs.hoard = lyingShots(world, slot); dmg *= 1 + Math.min(fx.hoard.max, fx.hoard.per * fs.hoard); }
  // Soul Lantern (W4, Nov 17): it grows by the minute it is held, not by its kills.
  if (fx.ramp) { fs.souls += DT / 60; dmg *= 1 + Math.min(fx.ramp.max, (fx.ramp.perMin ?? 0) * fs.souls); }
  if (fx.echo && fs.echoOn === 1) dmg *= fx.echo.mul;
  fs.live = live; fs.liveDmg = dmg; fs.liveRate = rate; fs.liveArea = area;
  // W4 (Nov 17): what grew from kills runs on a clock of its own.
  if (fx.eclipse) {
    fs.growth += DT / (fx.eclipse.growSec || 4);
    if (fs.growth >= 1) { fs.growth = 0; eclipseBurst(world, slot); }
  }
  if (fx.wards && tick >= fs.wardAt && fs.wards < fx.wards.max) {
    const P = world.projectiles;
    for (let i = 0; i < P.count; i++) {
      if (P.slot[i] !== slot.index || (P.flags[i] & (PF.DEAD | PF.CHILD)) !== 0) continue;
      fs.wardAt = tick + Math.max(1, Math.round(fx.wards.every * TPS));
      const g = groundAt(world, slot.index, P.x[i], P.y[i], fx.wards.radius * s.area, fx.wards.duration, s.damage * fx.wards.damageMul, fx.wards.interval, slot.childList);
      if (g >= 0) { world.zones.style[g] = ZSTYLE.WARD; world.zones.def[g] = slot.defIndex; fs.wards++; }
      break;
    }
  }
  if (fx.vigil && tick >= fs.vigilAt) {
    fs.vigilAt = tick + Math.max(1, Math.round(fx.vigil.every * TPS));
    const C = world.corpses;
    let x = p.x, y = p.y - 10, best = -1;
    for (let k = 0; k < C.x.length; k++) if (C.t[k] > (best < 0 ? -1 : C.t[best]) && tick - C.t[k] < 10 * TPS) best = k;
    if (best >= 0) { x = C.x[best]; y = C.y[best]; }
    const o = shotOpts();
    o.motion = MOTION.homing; o.m0 = slot.motion.turn ?? 5; o.m1 = slot.motion.range ?? 260; o.pierce = -1;
    o.life = fx.vigil.life;
    if (fx.vigil.plain) o.flags = PF.VIGIL;   // (C1b, Nov 20: a flame a second that lured and left mist made the set run away at Tide 5)
    shotAt(world, x, y, 0, -1, (slot.motion.speed ?? 126) * s.speed);
    spawnShot(world, slot, o);
  }
  if (fx.strikeback && tick >= fs.sbAt) {
    // Chain Reaction: every `every` s, one more strike on the nearest enemy.
    const E = world.enemies, t = world.enemyHash.nearest(p.x, p.y, (slot.emit.range ?? 300), E.flags, EF_GONE, -1);
    if (t >= 0) {
      fs.sbAt = tick + Math.max(1, Math.round(fx.strikeback.every * TPS));
      const o = shotOpts();
      o.motion = MOTION.stationary; o.life = DT * 1.5; o.pierce = -1; o.radius = s.radius * s.area;
      shotAt(world, E.x[t], E.y[t], 0, 0, 0);
      spawnShot(world, slot, o);
    }
  }

  // A buoy: moored where you stand still (Bell Buoy).
  const o = fx.origin;
  if (o && o.mode === 'plant' && fs.stillT >= o.after) {
    const dx = p.x - fs.ox, dy = p.y - fs.oy;
    if (fs.oUntil < tick || dx * dx + dy * dy > 576) {
      fs.ox = p.x; fs.oy = p.y; fs.oUntil = tick + Math.round(o.life * TPS);
      plantEvent(world, slot, p.x, p.y, 2, o.life);
    }
  }
  // The Eel Pot's pot: set where you stand, every so often.
  if (slot.emit.pot && tick >= fs.potAt) {
    fs.potAt = tick + Math.round(slot.emit.pot.every * TPS);
    setPot(world, slot, p.x, p.y);
  }
  // Old Conger: the pot itself bites what comes right up to it.
  if (fx.guard && slot.emit.pot && tick >= fs.guardAt) {
    fs.guardAt = tick + Math.max(1, Math.round(fx.guard.every * TPS));
    const max = Math.min(3, slot.emit.pot.max ?? 1), P = slot.pots;
    for (let j = 0; j < max; j++) {
      if (P[3 * j + 2] < tick) continue;
      explodeAt(world, slot.index, P[3 * j], P[3 * j + 1], fx.guard.radius, s.damage * fx.guard.damageMul * dmg, 0.6, -1);
      statusBurst(world, slot, P[3 * j], P[3 * j + 1], fx.guard.radius, 'daze', fx.guard.daze, 0, -1);
    }
  }

  // Ruling 16: nothing fires from the dash. What did (Lunge, Parting Shot, Wake of Fire, Cast
  // Anchor, Chum the Water, Cold Snap, Kicked Glass, Ground Rod) fires from walking, standing
  // still, or its own clock, each at most once every `every` seconds (fs.cueAt), so no kill
  // rate can make it fire faster.
  const cue = tick >= fs.cueAt;
  // Lunge: every `every` s while you keep moving, `count` harpoons evenly around you.
  if (fx.lunge && cue && p.moveT >= (fx.lunge.after ?? 0.5)) {
    fs.cueAt = tick + Math.round(fx.lunge.every * TPS);
    const n = fx.lunge.count, sc = world.scratch.sc;
    const base = fatan2(p.fy, p.fx);
    for (let k = 0; k < n; k++) {
      sincosInto(base + (k / n) * TAU, sc, 0);
      fireAlong(world, slot, p.x, p.y, sc[1], sc[0], NO_HANDLE);
    }
    firedEvent(world, slot, n);
  }
  const df = fx.cue;   // (was `dashfire` before ruling 16)
  if (df && cue) {
    if (df.fan && p.moveT >= 0.5) {
      // Parting Shot: a fan back the way you came, while you keep moving.
      fs.cueAt = tick + Math.round(df.every * TPS);
      const n = df.fan, sc = world.scratch.sc, spread = ((df.spread ?? 60) * PI) / 180;
      const base = fatan2(p.fy, p.fx) + (df.back ? PI : 0);
      for (let k = 0; k < n; k++) {
        sincosInto(base + (n === 1 ? 0 : (k / (n - 1) - 0.5) * spread), sc, 0);
        fireFrom(world, slot, p.x, p.y, sc[1], sc[0], NO_HANDLE, s.damage * (df.damageMul ?? 1) * dmg);
      }
      firedEvent(world, slot, n);
    } else if (df.trail && p.moveT >= 0.5) {
      // Wake of Fire: a line of burning oil spills behind you, the way you came.
      fs.cueAt = tick + Math.round(df.every * TPS);
      const z = slotZone(world, slot);
      if (z) {
        const zd = (z.damageMul ? s.damage * z.damageMul : z.damage) * (df.damageMul ?? 1) * dmg;
        const r = z.radius * (df.radiusMul ?? 1) * s.area, n = df.pools ?? 4;
        for (let k = 0; k < n; k++) {
          const gx = p.x - p.fx * r * 1.6 * k, gy = p.y - p.fy * r * 1.6 * k;
          const g = groundAt(world, slot.index, gx, gy, r, z.duration, zd, z.interval, z.zoneList);
          if (g >= 0) { world.zones.def[g] = slot.defIndex; if (fx.fuel) fuelLink(world, slot, g); }
        }
      }
    } else if (df.cast && p.moveT >= 0.3) {
      // Cast Anchor: thrown the way you walk, hauled back through everything.
      fs.cueAt = tick + Math.round(df.every * TPS);
      const c = df.cast, op = shotOpts();
      op.motion = MOTION.boomerang; op.m0 = c.life; op.m1 = p.fx; op.m2 = p.fy; op.pierce = -1;
      op.damage = s.damage * c.damageMul * dmg; op.life = c.life + 0.6;
      shotAt(world, p.x, p.y, p.fx, p.fy, c.speed);
      spawnShot(world, slot, op);
      firedEvent(world, slot, 1);
    } else if (df.pot && slot.emit.pot && p.stillT >= 0.25 && p.stillT < 0.25 + DT * 1.5) {
      // Chum the Water: when you stop, a pot is set where you stopped and every pot lunges at once.
      fs.cueAt = tick + Math.round(df.every * TPS);
      setPot(world, slot, p.x, p.y);
      if (df.volley) slot.cd = 0;
    } else if (df.burst && p.stillT >= (df.after ?? 1)) {
      // Cold Snap: standing still, everything close is hurt and frozen, and a pick flies at each.
      fs.cueAt = tick + Math.round(df.every * TPS);
      const b = df.burst, r = b.radius * s.area;
      explodeAt(world, slot.index, p.x, p.y, r, s.damage * b.damageMul * dmg, 0, -1);
      if (b.freeze) statusBurst(world, slot, p.x, p.y, r, 'freeze', b.freeze, 0, -1);
      if (b.picks) {
        const E = world.enemies, q = world.scratch.reg, near = world.scratch.crowd;
        q[0] = p.x; q[1] = p.y; q[2] = r;
        const m = Math.min(world.enemyHash.queryR(q, world.scratch.lure, -1), 512);
        let c = 0;
        for (let k = 0; k < m && c < b.picks && c < near.length; k++) { const e = world.scratch.lure[k]; if ((E.flags[e] & EF_GONE) === 0) near[c++] = e; }
        for (let k = 0; k < c; k++) {
          const e = near[k], dx = E.x[e] - p.x, dy = E.y[e] - p.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
          fireAlong(world, slot, p.x, p.y, dx / d, dy / d, E.handle(e));
        }
        if (c > 0) firedEvent(world, slot, c);
      }
    }
  }
  // Kicked Glass: every `every` s while you keep moving, the glass near you is kicked the way you walk.
  if (fx.kick && cue && p.moveT >= 0.4) {
    fs.cueAt = tick + Math.round(fx.kick.every * TPS);
    const P = world.projectiles, k = fx.kick, r2 = k.radius * k.radius;
    // (At the nearest enemy, ruling 19 RD: kicked ahead, it went away from the crowd a moving player
    // leaves behind. With nothing near, the way you face.)
    let kx = p.fx, ky = p.fy;
    { const E = world.enemies, q = world.scratch.qreg; q[0] = p.x; q[1] = p.y; q[2] = 220;
      const m = world.enemyHash.queryR(q, world.scratch.near, -1);
      let best = 1e18;
      for (let j = 0; j < m; j++) { const e = world.scratch.near[j]; if ((E.flags[e] & EF_GONE) !== 0) continue; const dx = E.x[e] - p.x, dy = E.y[e] - p.y, d = dx * dx + dy * dy; if (d < best && d > 1) { best = d; const r = Math.sqrt(d); kx = dx / r; ky = dy / r; } } }
    for (let i = 0; i < P.count; i++) {
      if (P.slot[i] !== slot.index || P.motion[i] !== MOTION.stationary || (P.flags[i] & (PF.DEAD | PF.CHILD)) !== 0) continue;
      const dx = P.x[i] - p.x, dy = P.y[i] - p.y;
      if (dx * dx + dy * dy > r2) continue;
      P.motion[i] = MOTION.linear; P.vx[i] = kx * k.speed; P.vy[i] = ky * k.speed;
      P.life[i] = k.sec; P.damage[i] *= k.damageMul; P.pierce[i] = -1;
      P.hits.fill(NO_HANDLE, i * HIT_RING, i * HIT_RING + HIT_RING);
    }
  }
  // Ground Rod: stand still a moment and the rod is planted where you stand (it stays there).
  if (slot.emit.rodStill && slot.emit.rod && p.stillT >= slot.emit.rodStill) {
    const dx = p.x - fs.rodX, dy = p.y - fs.rodY;
    if (fs.rodUntil < 0 || dx * dx + dy * dy > 576) {
      fs.rodX = p.x; fs.rodY = p.y; fs.rodUntil = tick + Math.round(600 * TPS);
      plantEvent(world, slot, p.x, p.y, 3, 0);
    }
  }
  // Slick Trail: burning oil where you walk.
  if (fx.trail && p.moving && tick >= fs.trailAt) {
    fs.trailAt = tick + Math.max(1, Math.round(fx.trail.every * TPS));
    const z = slotZone(world, slot);
    if (z) {
      const zd = (z.damageMul ? s.damage * z.damageMul : z.damage) * dmg;
      const g = groundAt(world, slot.index, p.x, p.y, z.radius * fx.trail.radiusMul * s.area, z.duration, zd, z.interval, z.zoneList);
      if (g >= 0) { world.zones.def[g] = slot.defIndex; if (fx.fuel) fuelLink(world, slot, g); }
    }
  }
  // Well-Trodden: glass you walk back over is fresh again, and sharper.
  if (fx.rearm && tick % 6 === 0) {
    const P = world.projectiles, f = fx.rearm, r2 = f.within * f.within;
    for (let i = 0; i < P.count; i++) {
      if (P.slot[i] !== slot.index || P.motion[i] !== MOTION.stationary || (P.flags[i] & (PF.DEAD | PF.CHILD)) !== 0 || P.age[i] < 0.8) continue;
      const dx = P.x[i] - p.x, dy = P.y[i] - p.y;
      if (dx * dx + dy * dy > r2) continue;
      const n = P.hops[i] <= -1 ? -1 - P.hops[i] : 0;   // (kept below -1: a hops of 0 or more is a chain's count)
      P.life[i] = s.duration; P.age[i] = 0; P.pierce[i] = s.pierce;
      if (n < f.max) { P.damage[i] *= 1 + f.per; P.hops[i] = -2 - n; }
    }
  }
  // Glass Ring: crossing your own trail closes a loop, and everything inside is cut.
  if (fx.loop && tick % 6 === 0 && tick >= fs.loopAt && p.moving) closeLoop(world, slot);
}

/** Glass Ring: has the path you walked (world.path, a sample every 6 ticks) just crossed itself? Then cut what the loop holds. */
function closeLoop(world, slot) {
  const f = slot.fx.loop, path = world.path, p = world.player, s = slot.stats;
  const N = path.x.length, have = Math.min(path.n, N);
  const oldest = Math.min(have - 1, Math.floor(s.duration * 10));   // only as far back as the glass still lies
  const from = Math.max(8, Math.round(f.minAge * 10));
  let hit = -1;
  for (let j = from; j <= oldest; j++) {
    const k = (path.n - 1 - j + 16 * N) % N;
    const dx = path.x[k] - p.x, dy = path.y[k] - p.y;
    if (dx * dx + dy * dy <= f.near * f.near) { hit = j; break; }
  }
  if (hit < 0) return;
  // The loop: samples 0..hit. Its middle and its reach.
  let cx = 0, cy = 0;
  for (let j = 0; j <= hit; j++) { const k = (path.n - 1 - j + 16 * N) % N; cx += path.x[k]; cy += path.y[k]; }
  cx /= hit + 1; cy /= hit + 1;
  let r2 = 0;
  for (let j = 0; j <= hit; j++) { const k = (path.n - 1 - j + 16 * N) % N; const dx = path.x[k] - cx, dy = path.y[k] - cy; if (dx * dx + dy * dy > r2) r2 = dx * dx + dy * dy; }
  if (r2 < 196) return;   // too small to hold anything
  slot.fs.loopAt = world.tick + Math.max(1, Math.round(f.every * TPS));
  const E = world.enemies, q = world.scratch.reg, near = world.scratch.lure, num = world.scratch.num;
  const R = Math.sqrt(r2);
  q[0] = cx; q[1] = cy; q[2] = R;
  const m = world.enemyHash.queryR(q, near, -1);
  for (let a = 0; a < m; a++) {
    const e = near[a];
    if ((E.flags[e] & EF_GONE) !== 0) continue;
    // Inside the polygon? (A ray to the right, counting crossings.)
    const ex = E.x[e], ey = E.y[e];
    let inside = false;
    for (let j = 0; j <= hit; j++) {
      const k1 = (path.n - 1 - j + 16 * N) % N, k2 = (path.n - 1 - (j === hit ? 0 : j + 1) + 16 * N) % N;
      const y1 = path.y[k1], y2 = path.y[k2];
      if ((y1 > ey) !== (y2 > ey) && ex < path.x[k1] + ((ey - y1) / (y2 - y1)) * (path.x[k2] - path.x[k1])) inside = !inside;
    }
    if (!inside) continue;
    num[0] = s.damage * f.mul * slot.fs.liveDmg;
    damageEnemyR(world, e, slot.index, false);
  }
  const ev = world.events, i = ev.reserve(EV.LOOP);
  if (i >= 0) { ev.x[i] = cx; ev.y[i] = cy; ev.a[i] = slot.index; ev.b[i] = R; }
}

/**
 * After a volley of `shots` shots (sim/weapons.js weaponsFire): Salvo's ring every Nth shot. Each
 * ring is turned half a gap from the last, so the rings between them cover every way out.
 */
export function formsAfterVolley(world, slot, shots) {
  const fx = slot.fx, fs = slot.fs;
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
 * The Lightning Rod's rod (its emitter's `rod`): planted where you stand when there is none, it has
 * stood its time, or you've walked `replantAt` px from it; with Ground Rod (`rodStill`) only
 * standing still moves it (formsTick); with Conductor (`rodSelf`) you are the rod. Returns the strikes' reach round it, or 0
 * for none (Storm Kite: anywhere on screen).
 */
export function plantRod(world, slot) {
  const e = slot.emit, fs = slot.fs, p = world.player;
  if (e.rodSelf > 0) { fs.rodX = p.x; fs.rodY = p.y; fs.rodUntil = world.tick + 30; return e.rodSelf; }
  const f = e.rod;
  if (!f) return 0;
  const dx = p.x - fs.rodX, dy = p.y - fs.rodY;
  if (fs.rodUntil < 0 || (!e.rodStill && (fs.rodUntil < world.tick || dx * dx + dy * dy > f.replantAt * f.replantAt))) {
    fs.rodX = p.x; fs.rodY = p.y; fs.rodUntil = world.tick + Math.round((e.rodStill ? 600 : f.life) * TPS);
    plantEvent(world, slot, p.x, p.y, 3, e.rodStill ? 0 : f.life);
  }
  return f.radius * (e.rodReachMul ?? 1);   // (Tall Rod, a line: rodReachMul)
}

/** A summoned flame's options: it hunts, or (Procession) follows behind you, the k-th in line. */
export function summonOpts(slot, k) {
  const o = shotOpts();
  o.pierce = -1;
  if (slot.motionType === MOTION.follow) { o.motion = MOTION.follow; o.m0 = (k + 1) * (slot.motion.gap ?? 4); }
  else { o.motion = MOTION.homing; o.m0 = slot.motion.turn ?? 5; o.m1 = slot.motion.range ?? 260; }
  return o;
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
    const o = summonOpts(slot, k);
    // (C1b, Nov 20: past `full` Flames a volley, the bonus is shared out: with 6 or more Flames every volley
    // filled the pyre, so its wait cost nothing and its +80% was free; Tide 5 runs went to 7x the next weapon.)
    o.damage = s.damage * (f.full ? 1 + (f.damageMul - 1) * Math.min(1, f.full / Math.max(1, s.amount)) : f.damageMul) * fs.liveDmg;
    shotAt(world, ox + sc[1] * 6, oy + sc[0] * 6, sc[1], sc[0], (slot.motion.speed ?? 90) * s.speed * 1.4);
    spawnShot(world, slot, o);
  }
  return n;
}

/** Eclipse: how much bigger the orb is now (1 to 2), from its kills. */
/** Eclipse: every orb bursts, and the orb starts small again. */
function eclipseBurst(world, slot) {
  const P = world.projectiles, fx = slot.fx, s = slot.stats;
  for (let i = 0; i < P.count; i++) {
    if (P.slot[i] !== slot.index || (P.flags[i] & (PF.DEAD | PF.CHILD)) !== 0) continue;
    explodeAt(world, slot.index, P.x[i], P.y[i], fx.eclipse.burstRadius * s.area, s.damage * fx.eclipse.burstMul, s.knockback * 2, -1);
  }
}

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
 * wisp lures, an orbit body swells, grows, or drifts wide, a buried bolt waits, a lamprey holds on,
 * a flame keeps close. Called only for slots with one of those (slot.shotForms).
 */
export function formsMove(world, slot, i) {
  const P = world.projectiles, E = world.enemies, fx = slot.fx, f = P.flags[i];
  if ((f & PF.MINE) !== 0) {
    // Buried Glass: it fires when an enemy comes near (looked for every 4th tick).
    if (((world.tick + i) & 3) !== 0) return;
    const e = world.enemyHash.nearest(P.x[i], P.y[i], fx.mine.trigger, E.flags, EF_GONE, -1);
    if (e < 0) return;
    const dx = E.x[e] - P.x[i], dy = E.y[e] - P.y[i], d = Math.sqrt(dx * dx + dy * dy) || 1;
    fireFrom(world, slot, P.x[i], P.y[i], dx / d, dy / d, E.handle(e), P.damage[i]);
    P.flags[i] |= PF.DEAD;
    return;
  }
  if ((f & PF.LATCH) !== 0) {
    // Lamprey: it rides the enemy it bit, and bites again every so often.
    const e = E.resolve(P.target[i]);
    if (e < 0 || (E.flags[e] & EF_GONE) !== 0) { P.flags[i] |= PF.DEAD; return; }
    P.x[i] = E.x[e]; P.y[i] = E.y[e]; P.vx[i] = 0; P.vy[i] = 0;
    const every = Math.max(1, Math.round(fx.latch.every * TPS));
    if ((Math.round(P.age[i] * TPS) % every) === 0) P.hits.fill(NO_HANDLE, i * HIT_RING, i * HIT_RING + HIT_RING);
    return;
  }
  if (P.carry[i] !== NO_HANDLE) {
    const e = E.resolve(P.carry[i]);
    if (e < 0 || (E.flags[e] & EF.DEAD) !== 0) P.carry[i] = NO_HANDLE;
    else {
      // Pinned to the harpoon's point: no walking, no knockback of its own.
      E.x[e] = P.x[i]; E.y[e] = P.y[i]; E.vx[e] = 0; E.vy[e] = 0;
      if (E.dazeT[e] < 0.1) E.dazeT[e] = 0.1;
    }
  }
  if (fx.wisps && (f & (PF.CHILD | PF.VIGIL)) === 0) {
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
  if (fx.leash && P.motion[i] === MOTION.homing) {
    // Graveside: a flame that strays turns back to you.
    const p = world.player, dx = p.x - P.x[i], dy = p.y - P.y[i], d2 = dx * dx + dy * dy, r = fx.leash.range;
    if (d2 > r * r) {
      const d = Math.sqrt(d2), sp = Math.sqrt(P.vx[i] * P.vx[i] + P.vy[i] * P.vy[i]) || 100;
      P.vx[i] = dx / d * sp; P.vy[i] = dy / d * sp; P.target[i] = NO_HANDLE;
      P.x[i] += P.vx[i] * DT; P.y[i] += P.vy[i] * DT;
    }
  }
  if (P.motion[i] === MOTION.orbit) {
    const s = slot.stats, fs = slot.fs;
    // The ring's reach now: its own, a second ring's (Twin Rings), a Swell's, a stance's.
    let r = (slot.emit.radius ?? 36) * s.area * (s.orbitMul ?? 1) * fs.liveArea;
    const outer = P.hops[i] === -2 && fx.twin;
    if (outer) r *= fx.twin.mul;
    // (Twin Rings' outer ring keeps its reach: breathing it out too swept the whole screen, ruling 18 WB.)
    if (fx.breathe && !outer) {
      const u = (world.tick % Math.round(fx.breathe.period * TPS)) / Math.round(fx.breathe.period * TPS);
      r *= 1 + (fx.breathe.mul - 1) * (u < 0.5 ? 2 * u : 2 - 2 * u);
    }
    P.m2[i] = r;
    if (fs.liveRate !== 1) P.m0[i] += P.m1[i] * DT * (fs.liveRate - 1);
    let size = P.m3[i] * (fs.liveArea > 1 ? fs.liveArea : 1);
    if (fx.eclipse) { const g = eclipseScale(slot); size *= g; P.scale[i] = g >= 1.75 ? 3 : 2; }
    P.radius[i] = size;
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
  // Grow the linked set from the new pool, through pools that touch: the nearest links first, at
  // most `max` of them (ruling 18 WB: a field of linked pools renewing each other grew x5.8 late).
  const cap = Math.min(seen.length, 1 + (f.max ?? seen.length));
  while (head < n && n < cap) {
    const a = seen[head++];
    for (let z = 0; z < Z.count && n < cap; z++) {
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
 * A shot is spent (sim/weapons.js, just before it's removed): a Skewer's carried enemy bursts, a
 * Tether sticks in the last enemy the harpoon hit, a harpoon's chain hauls back what it hit, and a
 * pick that came back flies out once more (Hail).
 */
export function shotEnded(world, slot, i) {
  const P = world.projectiles, E = world.enemies, fx = slot.fx;
  const child = (P.flags[i] & PF.CHILD) !== 0;
  // A shot that ends leaves ground where it is (fx.endGround: Signal Flare, only one that hit nothing;
  // Grave Mist, a flame burnt out; Glass Dust, a piece broken): `effects` is what the ground does.
  const eg = fx.endGround;
  if (eg && !child && (P.flags[i] & PF.VIGIL) === 0 && (!eg.miss || P.hits[i * HIT_RING] === NO_HANDLE) && (!eg.every || world.tick >= slot.fs.egAt)) {
    if (eg.every) slot.fs.egAt = world.tick + Math.max(1, Math.round(eg.every * TPS));   // (C1b, Nov 20: its own clock, as Hanging Flare has)
    const s = slot.stats;
    const g = groundAt(world, slot.index, P.x[i], P.y[i], eg.radius * s.area, eg.life, s.damage * (eg.damageMul ?? 0), eg.interval ?? 0.4, compileList(world, [{ type: 'damage' }, ...(eg.effects || [])]));
    if (g >= 0 && eg.style) { world.zones.style[g] = ZSTYLE[eg.style]; world.zones.def[g] = slot.defIndex; }
  }
  const carried = P.carry[i] !== NO_HANDLE;   // (W1: a harpoon carrying a skewered enemy doesn't tether: Skewer and Tether pull against each other)
  if (P.carry[i] !== NO_HANDLE) {
    const e = E.resolve(P.carry[i]);
    P.carry[i] = NO_HANDLE;
    if (e >= 0 && (E.flags[e] & EF.DEAD) === 0) {
      const s = slot.stats;
      explodeAt(world, slot.index, E.x[e], E.y[e], fx.skewer.burstRadius * s.area, P.damage[i] * fx.skewer.burstMul, s.knockback, -1);
    }
  }
  const y = fx.yank || slot.emit.yank;
  if (y && !child) {
    // The chain: the last enemy it hit (or, with Reel In, every one) is hauled toward you.
    const p = world.player, num = world.scratch.num, o = i * HIT_RING;
    for (let k = 1; k <= HIT_RING; k++) {
      const h = P.hits[o + ((P.hitPos[i] + HIT_RING - k) % HIT_RING)];
      if (h === NO_HANDLE) break;
      const e = E.resolve(h);
      if (e >= 0 && (E.flags[e] & (EF_GONE | EF.BOSS)) === 0) {
        const dx = p.x - E.x[e], dy = p.y - E.y[e], d = Math.sqrt(dx * dx + dy * dy);
        if (d > 12) { num[1] = dx / d; num[2] = dy / d; num[3] = y.strength; impulseR(world, e); }
        if (y.daze) { world.scratch.hold[0] = y.daze; dazeEnemy(world, e); }
      }
      if (!y.all) break;
    }
  }
  if (fx.tether && !child && !carried) {
    const last = P.hits[i * HIT_RING + ((P.hitPos[i] + HIT_RING - 1) % HIT_RING)];
    if (last !== NO_HANDLE) {
      // Stuck in that enemy; if the hit killed it, stuck where it fell (the shot's point), and the
      // chain holds there (sim/weapons.js zonesTick).
      const e = E.resolve(last), alive = e >= 0 && (E.flags[e] & EF.DEAD) === 0;
      const Z = world.zones, z = Z.alloc();
      if (z >= 0) {
        Z.kind[z] = ZONE.TETHER; Z.slot[z] = slot.index; Z.list[z] = slot.childList;
        Z.target[z] = last;
        Z.x[z] = alive ? E.x[e] : P.x[i]; Z.y[z] = alive ? E.y[e] : P.y[i];
        Z.life[z] = fx.tether.duration;
        Z.thickness[z] = fx.tether.width * slot.stats.area;
        Z.damage[z] = slot.stats.damage * fx.tether.damageMul;
        Z.def[z] = slot.defIndex;
      }
    }
  }
  if (fx.rethrow && !child && (P.flags[i] & PF.RETURNING) !== 0 && P.motion[i] === MOTION.boomerang) {
    const p = world.player;
    const e = world.enemyHash.nearest(p.x, p.y, slot.emit.range ?? 260, E.flags, EF_GONE, -1);
    if (e >= 0) {
      const dx = E.x[e] - p.x, dy = E.y[e] - p.y, d = Math.sqrt(dx * dx + dy * dy) || 1, s = slot.stats;
      const o = shotOpts();
      o.motion = MOTION.boomerang; o.m0 = s.duration; o.m1 = dx / d; o.m2 = dy / d; o.flags = PF.CHILD; o.list = slot.childList;
      o.damage = P.damage[i] * fx.rethrow.mul; o.pierce = -1; o.radius = P.radius[i];
      shotAt(world, p.x, p.y, dx / d, dy / d, (slot.motion.speed ?? 240) * s.speed);
      spawnShot(world, slot, o);
    }
  }
}

/** Ice Wall: the first enemy a pick hits holds it: frozen, and everything near it slowed. The pick is spent. */
export function stickHit(world, slot, i, e) {
  const P = world.projectiles, E = world.enemies, f = slot.fx.stick;
  if ((P.flags[i] & PF.CHILD) !== 0) return;
  ST.status = 'freeze'; ST.duration = f.freeze;
  applyStatus(world, e, ST, slot.index);
  statusBurst(world, slot, E.x[e], E.y[e], f.radius * slot.stats.area, 'slow', f.slowSec, f.slow, e);
  if (f.burstMul) explodeAt(world, slot.index, E.x[e], E.y[e], f.radius * slot.stats.area, P.damage[i] * f.burstMul, 0, e);   // (Ice Wall's ice bursts on enemies near it)
  P.flags[i] |= PF.DEAD;
}

/** Lamprey: the eel stays on the first enemy it bites. */
export function latchOn(world, slot, i, e) {
  const P = world.projectiles;
  if ((P.flags[i] & (PF.CHILD | PF.LATCH)) !== 0) return;
  P.flags[i] |= PF.LATCH;
  P.target[i] = world.enemies.handle(e);
  P.pierce[i] = -1; P.life[i] = slot.fx.latch.life; P.age[i] = DT;
}

/** Closed Circuit: a bolt out of hops hits every enemy it touched again. */
export function recoilRing(world, slot, proj, damage) {
  const P = world.projectiles, E = world.enemies, num = world.scratch.num, o = proj * HIT_RING;
  for (let k = 0; k < HIT_RING; k++) {
    const e = E.resolve(P.hits[o + k]);
    if (e < 0 || (E.flags[e] & EF_GONE) !== 0) continue;
    num[0] = damage * slot.fx.recoil.mul;
    damageEnemyR(world, e, slot.index, false);
  }
}

// ---------------------------------------------------------------- kills

/**
 * A kill by a weapon with something that acts on its kills (sim/enemies.js resolveDeaths). `e`: the
 * dead enemy (still in its place); `byZone`: the blow was one of its zones' pulses, not its own hit.
 */
export function formKill(world, slot, x, y, byZone, e = -1) {
  const fx = slot.fx, fs = slot.fs, tick = world.tick, s = slot.stats, E = world.enemies;
  // (W4, Nov 17: nothing grows, fires, or speeds up from a kill any more; what did runs on a clock
  // in formsTick. A kill's burst passes the weapon's status on, at most every forms.killburstEvery s.)
  const kb = fx.killburst;
  if (kb && tick >= fs.kbAt && (!kb.byZone || byZone)) {
    // What it kills bursts; with `ifStatus`, only what died burning, rotting, or frozen; with
    // `spread`, the burst lays that status on what is near.
    const held = e >= 0 ? E.held[e] : 0;
    const had = !kb.ifStatus || (e >= 0 && (kb.ifStatus === 'burn' ? E.burnT[e] > 0 : kb.ifStatus === 'rot' ? E.rotT[e] > 0 : kb.ifStatus === 'freeze' ? (held & 1) !== 0 || E.freezeT[e] > 0 : (held & 2) !== 0 || E.slowT[e] > 0));
    if (had) {
      fs.kbAt = tick + Math.max(1, Math.round((world.tuning.forms.killburstEvery ?? 0.05) * TPS));   // (ruling 18 WB: Sunfire's bursts setting off bursts carried an Orb to 7M a minute)
      const r = kb.radius * s.area;
      if (kb.damageMul > 0) explodeAt(world, slot.index, x, y, r, s.damage * kb.damageMul, 0.3, e);
      if (kb.spread) {
        // (A spread burn is 60% of the one it came from, so a crowd burning down from one kill fades
        // instead of carrying itself on for ever: the Flare Gun's Phosphor trio at x31.6, ruling 18 WA.)
        const amount = kb.spread === 'burn' ? (e >= 0 && E.burnDps[e] > 0 ? E.burnDps[e] * 0.6 : s.damage * 0.4) : kb.spread === 'rot' ? (e >= 0 && E.rotAmp[e] > 0 ? E.rotAmp[e] : 0.25) : kb.spread === 'slow' ? 0.4 : 0;
        statusBurst(world, slot, x, y, r, kb.spread, kb.spreadSec ?? 2, amount, e);
      }
    }
  }
}

/** Does this slot have something that acts on its kills? */
export function hasKillForm(fx) {
  return !!fx.killburst;
}

/** Does this slot have something that acts on its shots as they move? */
export function hasShotForm(fx, emit) {
  return !!(fx.skewer || fx.wisps || fx.eclipse || fx.tether || fx.mine || fx.latch || fx.leash || fx.twin || fx.breathe || fx.stance || (emit && emit.type === 'orbit'));
}

/** Does this slot have something that acts as a shot ends? */
export function hasEndForm(fx, emit) {
  return !!(fx.skewer || fx.tether || fx.yank || fx.rethrow || fx.endGround || (emit && emit.yank));
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
