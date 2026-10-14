// Enemies: spawning, AI, movement, crowds, knockback, status effects, contact damage, deaths
// (ARCHITECTURE §5.6, §5.13).
//
// Everything here runs over the enemy pool's typed arrays. AI types: chase (walk at you),
// swarm (a wall crossing the screen in a straight line), charger (warns, then dashes),
// hazard (drops warned pools), splitter (bursts into smaller enemies), ranged_slow (slow,
// readable shots), boss (bosses.js drives its attacks).

import { DT, TPS, EF, AI, HIT_SLOTS } from './constants.js';
import { EV, TELE, STATUS } from './events.js';
import { hurtPlayer } from './player.js';
import { runHooks } from './hooks.js';
import { spawnGem, rollDrops } from './pickups.js';
import { dropChest } from './chests.js';
import { bossStep, bossDied, BOSS_STATE } from './bosses.js';
import { spawnHazard, spawnHostileShot } from './attacks.js';
import { sincosInto, fatan2, TAU } from '../lib/fmath.js';
import { TILE } from './terrain.js';

export const ENEMY_FIELDS = {
  x: Float32Array, y: Float32Array, px: Float32Array, py: Float32Array,
  vx: Float32Array, vy: Float32Array,       // knockback velocity (px/s), decays every tick
  dx: Float32Array, dy: Float32Array,       // locked direction (swarm, charge, aim)
  hp: Float32Array, maxHp: Float32Array,
  type: Uint16Array, flags: Uint8Array,
  radius: Float32Array, speed: Float32Array, mass: Float32Array, contact: Float32Array, xp: Float32Array,
  ai: Uint8Array, aiState: Uint8Array, aiTimer: Float32Array,
  flash: Uint8Array,                        // ticks of hit flash left (render reads it)
  burnT: Float32Array, burnDps: Float32Array, burnAcc: Float32Array, burnSlot: Uint8Array,
  slowT: Float32Array, slowPct: Float32Array, freezeT: Float32Array, rotT: Float32Array, rotAmp: Float32Array,
  dazeT: Float32Array,                      // seconds left dazed (reeled in by the Harpooner): no walking, no contact damage
  killer: Int8Array,                        // weapon slot of the killing blow (-1: not a weapon)
  anim: Float32Array,                       // render phase, fixed at spawn
  boss: Int8Array,                          // index into world.bosses, or -1
  nextHit: [Int32Array, HIT_SLOTS],         // tick each weapon slot may hit this enemy again
  waveHit: [Int32Array, HIT_SLOTS],         // per slot: the last wave that hit it (zone handle + 1)
};

export const KB_UNIT = 100; // knockback 1 = an impulse of 100 px/s against mass 1

/** Angles only ever go to render (in events); the sim never branches on them. */
function angleOf(y, x) { return x === 0 && y === 0 ? 0 : fatan2(y, x); }

/**
 * Spawn one enemy. opts: { elite, swarmDir: [dx, dy], minion, hpMul }.
 * Returns the dense index, or -1 if the pool is full.
 */
export function spawnEnemy(world, type, x, y, opts = null) {
  const E = world.enemies;
  const i = E.alloc();
  if (i < 0) return -1;
  const def = world.enemyDefs[type];
  const T = world.tuning.enemies;
  const elite = opts !== null && opts.elite === true;
  const isBoss = def.ai.type === 'boss';
  const hpMul = (opts !== null && opts.hpMul !== undefined) ? opts.hpMul : world.director.hpMul;
  E.x[i] = x; E.y[i] = y; E.px[i] = x; E.py[i] = y;
  E.type[i] = type;
  E.hp[i] = E.maxHp[i] = def.hp * (isBoss ? world.director.bossHpMul : hpMul) * (elite ? T.eliteHp : 1);
  E.radius[i] = def.radius * (elite ? T.eliteSize : 1);
  E.speed[i] = def.speed;
  E.mass[i] = def.mass * (elite ? T.eliteMass : 1);
  E.contact[i] = def.contact * world.director.contactMul * (elite ? T.eliteContact : 1);
  E.xp[i] = def.xp * (elite ? T.eliteXp : 1);
  E.ai[i] = AI[def.ai.type];
  E.killer[i] = -1;
  E.boss[i] = -1;
  E.anim[i] = world.rng.spawn.next();
  let f = 0;
  if (elite) f |= EF.ELITE;
  if (isBoss) f |= EF.BOSS;
  if (opts !== null && opts.minion) f |= EF.MINION;
  if (opts !== null && opts.swarmDir) { f |= EF.SWARM; E.dx[i] = opts.swarmDir[0]; E.dy[i] = opts.swarmDir[1]; }
  else if (E.ai[i] === AI.swarm) {
    // A swarmer from anywhere but a wall or ring (a roster, a split, a summon) flies straight
    // at where you are now, and on past.
    const p = world.player, dx = p.x - x, dy = p.y - y, d = Math.sqrt(dx * dx + dy * dy);
    f |= EF.SWARM;
    E.dx[i] = d > 1e-6 ? dx / d : 1; E.dy[i] = d > 1e-6 ? dy / d : 0;
  }
  E.flags[i] = f;
  // Hazard and ranged enemies start partway through their timer so a group doesn't act in unison.
  if (E.ai[i] === AI.hazard || E.ai[i] === AI.ranged_slow) E.aiTimer[i] = def.ai.every * (0.3 + 0.7 * world.rng.spawn.next());
  if (elite) world.events.push(EV.ELITE_SPAWN, x, y, type, E.handle(i));
  return i;
}

/** A knockback impulse (strength in weapon knockback units, direction a unit vector). */
export function impulse(world, e, dirX, dirY, strength) {
  const num = world.scratch.num;
  num[1] = dirX; num[2] = dirY; num[3] = strength;
  impulseR(world, e);
}

/** impulse() with its numbers in the num register: [1] dirX, [2] dirY, [3] strength (hot paths). */
export function impulseR(world, e) {
  const num = world.scratch.num;
  const dirX = num[1], dirY = num[2];
  let strength = num[3];
  const E = world.enemies;
  if ((E.flags[e] & EF.BOSS) !== 0) strength *= world.tuning.enemies.bossKnockback;
  const k = (strength * world.tuning.enemies.knockbackScale * KB_UNIT) / E.mass[e];
  let vx = E.vx[e] + dirX * k, vy = E.vy[e] + dirY * k;
  const max = world.tuning.enemies.knockbackMax;
  const s2 = vx * vx + vy * vy;
  if (s2 > max * max) { const s = max / Math.sqrt(s2); vx *= s; vy *= s; }
  E.vx[e] = vx; E.vy[e] = vy;
}

/** Push every enemy within radius of a point outward (a revival, a shockwave). */
export function pushAway(world, x, y, radius, strength) {
  // Its own buffer: this can run in the middle of the contact pass (a revival).
  const E = world.enemies, near = world.scratch.push;
  const m = world.enemyHash.query(x, y, radius, near, -1);
  for (let k = 0; k < m; k++) {
    const e = near[k];
    if ((E.flags[e] & EF.DEAD) !== 0) continue;
    const dx = E.x[e] - x, dy = E.y[e] - y, d = Math.sqrt(dx * dx + dy * dy);
    if (d > 0.001) impulse(world, e, dx / d, dy / d, strength);
  }
}

/** Damage to an enemy from a weapon slot (HIT_SLOTS or more: no weapon). Marks it dead at 0 HP. */
export function damageEnemy(world, e, amount, slot, crit = false) {
  world.scratch.num[0] = amount;
  return damageEnemyR(world, e, slot, crit);
}

/** damageEnemy() with the amount in num[0] (hot paths). Returns the damage dealt. */
export function damageEnemyR(world, e, slot, crit) {
  let amount = world.scratch.num[0];
  const E = world.enemies;
  if ((E.flags[e] & EF.DEAD) !== 0 || !(amount > 0)) return 0;
  if (E.rotT[e] > 0) amount *= 1 + E.rotAmp[e];
  E.hp[e] -= amount;
  E.flash[e] = world.tuning.enemies.flashTicks;
  if (slot < HIT_SLOTS) world.result.damageBySlot[slot] += amount;
  if (E.boss[e] >= 0 && slot < HIT_SLOTS) world.bosses[E.boss[e]].damageBySlot[slot] += amount;
  const ev = world.events;
  const k = ev.reserve(EV.HIT);
  if (k >= 0) { ev.x[k] = E.x[e]; ev.y[k] = E.y[e]; ev.a[k] = amount; ev.b[k] = E.handle(e); ev.c[k] = crit ? 1 : 0; ev.d[k] = slot; }
  if (E.hp[e] <= 0) {
    E.flags[e] |= EF.DEAD;
    E.killer[e] = slot < HIT_SLOTS ? slot : -1;
  }
  return amount;
}

const STATUS_CODE = { burn: STATUS.BURN, slow: STATUS.SLOW, freeze: STATUS.FREEZE, rot: STATUS.ROT };

/** Apply a status effect from an on-hit effect ({ status, dps, duration, pct, amp }). */
export function applyStatus(world, e, fx, slot) {
  const E = world.enemies;
  const d = fx.duration;
  switch (fx.status) {
    case 'burn':
      if (d > E.burnT[e]) E.burnT[e] = d;
      if (fx.dps > E.burnDps[e]) { E.burnDps[e] = fx.dps; E.burnSlot[e] = slot; }
      break;
    case 'slow': {
      const pct = fx.pct ?? 0.3;
      if (d > E.slowT[e]) E.slowT[e] = d;
      if (pct > E.slowPct[e]) E.slowPct[e] = pct;
      break;
    }
    case 'freeze': {
      if (midAttack(E, e, world.bosses)) break; // holding it would stop its attack's clock (see midAttack)
      const t = (E.flags[e] & EF.BOSS) !== 0 ? d * world.tuning.enemies.freezeBossFactor : d;
      if (t > E.freezeT[e]) E.freezeT[e] = t;
      break;
    }
    case 'rot': {
      const amp = fx.amp ?? 0.25;
      if (d > E.rotT[e]) E.rotT[e] = d;
      if (amp > E.rotAmp[e]) E.rotAmp[e] = amp;
      break;
    }
    default: return;
  }
  const ev = world.events;
  const k = ev.reserve(EV.STATUS);
  if (k >= 0) { ev.x[k] = E.x[e]; ev.y[k] = E.y[e]; ev.a[k] = STATUS_CODE[fx.status]; ev.b[k] = E.handle(e); }
}

/**
 * Step 7: every enemy acts. Status effects tick, the AI picks a direction, the enemy moves
 * (plus its knockback), crowds push apart, walls stop it, and stragglers jump ahead.
 * Counts regular enemies alive for the director.
 */
export function enemiesAct(world) {
  const E = world.enemies, n = E.count;
  const p = world.player, T = world.tuning.enemies;
  const flow = world.flow, bigFlow = world.bigFlow, terrain = world.terrain, hash = world.enemyHash;
  const bigBody = TILE / 2;
  // Positions and radii go to walls, the flow field, and the grid through `reg` (a typed-array
  // register), never as call arguments: every fractional argument to a call V8 doesn't inline
  // is a 16-byte allocation, and this loop runs for every enemy every tick (§17).
  const reg = world.scratch.reg;
  const v2 = world.scratch.v2, dir = world.scratch.dir, sep = world.scratch.sep;
  const decay = T.knockbackDecay;
  const sepK = T.separation, sepRange = T.separationRange;
  const sepK2 = Math.min(1, 2 * sepK), tickParity = world.tick & 1;
  const tp2 = T.teleportDistance * T.teleportDistance;
  const sepFar2 = T.separationFar * T.separationFar;
  const swarmGone2 = T.swarmDespawnDistance * T.swarmDespawnDistance;
  const burnTick = world.tuning.status.burnTick;
  let regular = 0;

  for (let i = 0; i < n; i++) {
    const f = E.flags[i];
    if ((f & EF.DEAD) !== 0) continue;
    E.px[i] = E.x[i]; E.py[i] = E.y[i];
    if (E.flash[i] > 0) E.flash[i]--;

    // Status effects.
    if (E.burnT[i] > 0) {
      E.burnT[i] -= DT;
      E.burnAcc[i] += DT;
      if (E.burnAcc[i] >= burnTick) {
        E.burnAcc[i] -= burnTick;
        world.scratch.num[0] = E.burnDps[i] * burnTick;
        damageEnemyR(world, i, E.burnSlot[i], false);
        if ((E.flags[i] & EF.DEAD) !== 0) continue;
      }
      if (E.burnT[i] <= 0) { E.burnT[i] = 0; E.burnDps[i] = 0; E.burnAcc[i] = 0; }
    }
    if (E.rotT[i] > 0) { E.rotT[i] -= DT; if (E.rotT[i] <= 0) { E.rotT[i] = 0; E.rotAmp[i] = 0; } }
    let speedMul = 1;
    if (E.slowT[i] > 0) { E.slowT[i] -= DT; speedMul = 1 - E.slowPct[i]; if (E.slowT[i] <= 0) { E.slowT[i] = 0; E.slowPct[i] = 0; } }
    // Frozen or dazed: it doesn't walk or act (knockback still moves it).
    let frozen = E.freezeT[i] > 0;
    if (frozen) { E.freezeT[i] -= DT; speedMul = 0; if (E.freezeT[i] < 0) E.freezeT[i] = 0; }
    if (E.dazeT[i] > 0) { E.dazeT[i] -= DT; speedMul = 0; frozen = true; if (E.dazeT[i] < 0) E.dazeT[i] = 0; }
    if ((f & (EF.SWARM | EF.BOSS | EF.MINION)) === 0) regular++;

    const x = E.x[i], y = E.y[i];
    const tx = p.x - x, ty = p.y - y;
    const d2 = tx * tx + ty * ty;
    const dist = Math.sqrt(d2);
    const ai = E.ai[i];
    let mvx = 0, mvy = 0;
    let sp = E.speed[i] * speedMul;

    // Walking toward you: follow the flow field only where it disagrees with the straight line
    // (a wall in the way), so movement in the open stays smooth.
    let walks = false;
    if (ai === AI.swarm) {
      mvx = E.dx[i]; mvy = E.dy[i];
      // Gone once far away and heading off, or off the map (never counted as a kill).
      if ((d2 > swarmGone2 && (tx * mvx + ty * mvy) < 0) || x < 0 || y < 0 || x > terrain.width || y > terrain.height) {
        E.flags[i] = f | EF.DEAD | EF.VANISH | EF.RESOLVED;
        continue;
      }
    } else if (ai === AI.boss && E.boss[i] >= 0) {
      bossStep(world, i, dist, tx, ty, speedMul, dir);
      mvx = dir[0]; mvy = dir[1]; sp = dir[2];
      walks = world.bosses[E.boss[i]].state === BOSS_STATE.WALK;
    } else if (!frozen) {
      // (A boss-type enemy that wasn't spawned by a boss event has no attack pattern: it
      // chases like anything else. The content test keeps bosses out of rosters and summons.)
      if (ai === AI.charger) {
        chargerStep(world, i, dir);
        mvx = dir[0]; mvy = dir[1]; sp *= dir[2];
        walks = E.aiState[i] === CHARGER.APPROACH || E.aiState[i] === CHARGER.RECOVER;
      } else {
        // chase, splitter, and the slow walkers: toward you, around walls when needed.
        if (dist > 0.0001) { mvx = tx / dist; mvy = ty / dist; }
        walks = true;
        if (ai === AI.hazard) hazardStep(world, i);
        else if (ai === AI.ranged_slow) {
          const r = world.enemyDefs[E.type[i]].ai.range;
          if (dist < r * T.rangedBackOff) { mvx = -mvx; mvy = -mvy; walks = false; } // too close: back off
          else if (dist < r) sp *= T.rangedDrift;                                    // in range: drift
          rangedStep(world, i);
        }
      }
    }
    const field = E.radius[i] > bigBody ? bigFlow : flow;
    if (walks && field.active) {
      reg[0] = x; reg[1] = y;
      // Take the field's way where it disagrees with the straight line by more than 45 degrees,
      // and wherever the straight step runs into a wall (otherwise a corner can hold an enemy
      // between the two rules). The probe reaches past the body, so big enemies see walls too.
      if (field.dirR(reg, v2)) {
        const ahead = E.radius[i] + 8;
        if (v2[0] * mvx + v2[1] * mvy < 0.7071 ||
          terrain.blocked(Math.floor((x + mvx * ahead) / TILE), Math.floor((y + mvy * ahead) / TILE))) { mvx = v2[0]; mvy = v2[1]; }
      }
    }

    // An enemy showing a warning stays exactly where the warning was drawn (no crowd pushes, no
    // knockback), so the attack comes from where the player saw it coming.
    const anchored = (ai === AI.charger && E.aiState[i] === CHARGER.WINDUP) || (ai === AI.ranged_slow && E.aiState[i] === RANGED.WARN) ||
      (ai === AI.boss && E.boss[i] >= 0 && world.bosses[E.boss[i]].state === BOSS_STATE.WARN);
    if (anchored) {
      E.vx[i] = 0; E.vy[i] = 0;
      if ((f & (EF.SWARM | EF.BOSS)) === 0 && d2 > tp2) teleportAhead(world, i);
      continue;
    }

    // Move: walking plus knockback.
    const kvx = E.vx[i], kvy = E.vy[i];
    let nx = x + (mvx * sp + kvx) * DT;
    let ny = y + (mvy * sp + kvy) * DT;
    let dvx = kvx * decay, dvy = kvy * decay;
    if (dvx * dvx + dvy * dvy < 1) { dvx = 0; dvy = 0; }
    E.vx[i] = dvx; E.vy[i] = dvy;

    // Crowds: a soft push from overlapping neighbors, so a horde reads as a mass. Enemies well
    // off screen skip it (nobody sees them; they sort themselves out as they close in).
    // Half the crowd each tick (by index and tick parity), at twice the strength: the same push
    // over two ticks for half the grid queries, which are most of a busy tick's cost.
    if (sepK > 0 && (f & EF.SWARM) === 0 && d2 < sepFar2 && ((i + tickParity) & 1) === 0) {
      const ri = E.radius[i];
      // Every overlapping neighbor counts (a capped subset would be the ones the grid scan meets
      // first, which would push whole crowds one way). The buffer holds 16: more overlap than
      // that only happens in a crush, and it still pushes outward.
      reg[0] = nx; reg[1] = ny; reg[2] = ri * sepRange;
      const m = hash.queryR(reg, sep, i);
      let px2 = 0, py2 = 0;
      for (let k = 0; k < m; k++) {
        const j = sep[k];
        if ((E.flags[j] & EF.DEAD) !== 0) continue;
        const ddx = nx - E.x[j], ddy = ny - E.y[j];
        const want = (ri + E.radius[j]) * sepRange;
        const dd2 = ddx * ddx + ddy * ddy;
        if (dd2 >= want * want) continue;
        const w = E.mass[j] / (E.mass[i] + E.mass[j]); // heavier neighbors push harder
        if (dd2 > 1e-6) {
          const dd = Math.sqrt(dd2), push = (want - dd) / dd;
          px2 += ddx * push * w; py2 += ddy * push * w;
        } else {
          // Exactly on top of each other: part along a fixed direction per pair.
          px2 += (i > j ? 0.5 : -0.5) * w; py2 += (i > j ? 0.25 : -0.25) * w;
        }
      }
      nx += px2 * sepK2; ny += py2 * sepK2;
    }

    // Walls and the map edge (swarms fly over walls, and vanish once they leave the map).
    if ((f & EF.SWARM) === 0) {
      reg[0] = nx; reg[1] = ny; reg[2] = E.radius[i];
      terrain.collideR(reg);
      nx = reg[0]; ny = reg[1];
    }
    E.x[i] = nx; E.y[i] = ny;

    // Teleport-ahead: a straggler far behind jumps to the spawn ring ahead of you.
    if ((f & (EF.SWARM | EF.BOSS)) === 0 && d2 > tp2) teleportAhead(world, i);
  }
  world.director.regularAlive = regular;
}

function teleportAhead(world, i) {
  const E = world.enemies, p = world.player, T = world.tuning.enemies, rng = world.rng.spawn;
  const sc = world.scratch.sc, terrain = world.terrain, r0 = E.radius[i];
  for (let tries = 0; tries < 4; tries++) {
    // Ahead: the way you're facing, give or take 60 degrees.
    sincosInto((rng.next() * 2 - 1) * 1.0471975511965976, sc, 0);
    const ax = p.fx * sc[1] - p.fy * sc[0];
    const ay = p.fx * sc[0] + p.fy * sc[1];
    const r = T.spawnRing + rng.next() * T.spawnJitter;
    const x = p.x + ax * r, y = p.y + ay * r;
    if (x < r0 || y < r0 || x > terrain.width - r0 || y > terrain.height - r0 || terrain.blockedAt(x, y)) continue;
    E.x[i] = x; E.y[i] = y; E.px[i] = x; E.py[i] = y;
    E.vx[i] = 0; E.vy[i] = 0;
    return;
  }
  // No room ahead (a map corner): try again next tick.
}

/** Charger states (E.aiState): walk in, wind up (the warning), dash, recover. */
export const CHARGER = Object.freeze({ APPROACH: 0, WINDUP: 1, DASH: 2, RECOVER: 3 });

/**
 * Is this enemy in the middle of an attack it warned of (a charger winding up or running its line,
 * a gunner aiming, and, given `bosses` (world.bosses), a boss warning or charging)? Such an enemy
 * can't be held (frozen or dazed): a hold stops its AI's clock, so the attack would land after its
 * warning had gone, or a charge would stop and then finish with no warning at all (§5.13: every
 * attack is warned; §16.4).
 */
export function midAttack(E, e, bosses = null) {
  const ai = E.ai[e], s = E.aiState[e];
  if (ai === AI.charger) return s === CHARGER.WINDUP || s === CHARGER.DASH;
  if (ai === AI.ranged_slow) return s === RANGED.WARN;
  if (ai === AI.boss && bosses !== null && E.boss[e] >= 0) {
    const st = bosses[E.boss[e]].state;
    return st === BOSS_STATE.WARN || st === BOSS_STATE.CHARGE;
  }
  return false;
}
/** Ranged states (E.aiState): waiting, then warning before a shot. */
export const RANGED = Object.freeze({ WAIT: 0, WARN: 1 });

function chargerStep(world, i, dir) {
  const E = world.enemies, def = world.enemyDefs[E.type[i]].ai, p = world.player;
  const tx = p.x - E.x[i], ty = p.y - E.y[i], dist = Math.sqrt(tx * tx + ty * ty);
  const st = E.aiState[i];
  dir[2] = 1;
  if (st === CHARGER.APPROACH) {
    // Approach; wind up once in range.
    if (dist > 0.0001) { dir[0] = tx / dist; dir[1] = ty / dist; } else { dir[0] = 0; dir[1] = 0; }
    if (dist < def.range) {
      const warn = Math.max(def.windup, world.tuning.enemies.telegraphMin);
      E.aiState[i] = CHARGER.WINDUP;
      E.aiTimer[i] = warn;
      E.dx[i] = dir[0]; E.dy[i] = dir[1];
      world.events.push(EV.TELEGRAPH, E.x[i], E.y[i], TELE.LINE, Math.round(warn * TPS), def.dashSpeed * def.dashTime, angleOf(dir[1], dir[0]));
      dir[2] = 0;
    }
    return;
  }
  if (st === CHARGER.WINDUP) {
    // Winding up: stand still (enemiesAct keeps it anchored where the warning shows).
    dir[0] = E.dx[i]; dir[1] = E.dy[i]; dir[2] = 0;
    E.aiTimer[i] -= DT;
    if (E.aiTimer[i] <= 0) { E.aiState[i] = CHARGER.DASH; E.aiTimer[i] = def.dashTime; }
    return;
  }
  if (st === CHARGER.DASH) {
    dir[0] = E.dx[i]; dir[1] = E.dy[i]; dir[2] = def.dashSpeed / Math.max(1, E.speed[i]);
    E.aiTimer[i] -= DT;
    if (E.aiTimer[i] <= 0) { E.aiState[i] = CHARGER.RECOVER; E.aiTimer[i] = def.recover; }
    return;
  }
  // Recovering: slow.
  if (dist > 0.0001) { dir[0] = tx / dist; dir[1] = ty / dist; } else { dir[0] = 0; dir[1] = 0; }
  dir[2] = world.tuning.enemies.chargerRecoverSpeed;
  E.aiTimer[i] -= DT;
  if (E.aiTimer[i] <= 0) E.aiState[i] = CHARGER.APPROACH;
}

function hazardStep(world, i) {
  const E = world.enemies, def = world.enemyDefs[E.type[i]].ai, p = world.player;
  E.aiTimer[i] -= DT;
  if (E.aiTimer[i] > 0) return;
  const tx = p.x - E.x[i], ty = p.y - E.y[i];
  if (tx * tx + ty * ty > def.range * def.range) return;
  E.aiTimer[i] = def.every;
  const warn = Math.max(def.warn, world.tuning.enemies.telegraphMin);
  spawnHazard(world, p.x, p.y, def.radius, warn, def.last, def.damage);
}

function rangedStep(world, i) {
  const E = world.enemies, def = world.enemyDefs[E.type[i]].ai;
  E.aiTimer[i] -= DT;
  if (E.aiState[i] === RANGED.WAIT) {
    if (E.aiTimer[i] > 0) return;
    const p0 = world.player, dx0 = p0.x - E.x[i], dy0 = p0.y - E.y[i], reach = def.range * (def.reach ?? 1.3);
    if (dx0 * dx0 + dy0 * dy0 > reach * reach) return;
    // Warn first, then fire at where you were when the warning started.
    const warn = Math.max(def.warn, world.tuning.enemies.telegraphMin);
    E.aiState[i] = RANGED.WARN;
    E.aiTimer[i] = warn;
    const p = world.player;
    const tx = p.x - E.x[i], ty = p.y - E.y[i], d = Math.sqrt(tx * tx + ty * ty) || 1;
    E.dx[i] = tx / d; E.dy[i] = ty / d;
    world.events.push(EV.TELEGRAPH, E.x[i], E.y[i], TELE.LINE, Math.round(warn * TPS), def.range, angleOf(E.dy[i], E.dx[i]));
    return;
  }
  if (E.aiTimer[i] > 0) return;
  E.aiState[i] = RANGED.WAIT;
  E.aiTimer[i] = def.every;
  spawnHostileShot(world, E.x[i], E.y[i], E.dx[i] * def.speed, E.dy[i] * def.speed, def.radius, def.damage, (def.range * (def.shotRange ?? 1.6)) / def.speed);
}

/**
 * Step 8: contact damage. The worst touching enemy hurts you (then brief invulnerability), and
 * touching enemies are pushed out of you, shoving you back a little in turn (not mid-dash).
 */
export function contactStep(world) {
  const E = world.enemies, p = world.player, T = world.tuning.player;
  const near = world.scratch.near;
  const m = world.enemyHash.query(p.x, p.y, T.radius, near, -1);
  let worst = 0, pushX = 0, pushY = 0, hardX = 0, hardY = 0;
  const reg = world.scratch.reg;
  for (let k = 0; k < m; k++) {
    const e = near[k];
    if ((E.flags[e] & EF.DEAD) !== 0) continue;
    // A dazed enemy can't hurt you (it's still pushed out of you below).
    if (E.dazeT[e] <= 0 && E.contact[e] > worst) worst = E.contact[e];
    const dx = E.x[e] - p.x, dy = E.y[e] - p.y;
    const want = E.radius[e] + T.radius;
    const d2 = dx * dx + dy * dy;
    if (d2 < want * want && d2 > 1e-6) {
      // Who gives way: a boss or an enemy showing a warning never moves, so you're pushed fully
      // out of it. Otherwise the overlap splits by weight (the player counts as mass 1), and the
      // crowd's shove on you is capped (tuning.player.shoveMax), so a crowd slows you and jostles
      // you, but no enemy can bulldoze a player across the map.
      const d = Math.sqrt(d2), over = (want - d) / d;
      const anchored = (E.ai[e] === AI.charger && E.aiState[e] === CHARGER.WINDUP) || (E.ai[e] === AI.ranged_slow && E.aiState[e] === RANGED.WARN);
      const fixed = anchored || E.boss[e] >= 0;
      const share = fixed ? 0 : 1 / (1 + E.mass[e]);
      if (!fixed) {
        reg[0] = E.x[e] + dx * over * share; reg[1] = E.y[e] + dy * over * share; reg[2] = E.radius[e];
        if ((E.flags[e] & EF.SWARM) === 0) world.terrain.collideR(reg);
        E.x[e] = reg[0]; E.y[e] = reg[1];
        pushX -= dx * over * (1 - share); pushY -= dy * over * (1 - share);
      } else { hardX -= dx * over; hardY -= dy * over; }
    }
  }
  if (worst > 0) hurtPlayer(world, worst, p.x, p.y);
  if (p.dashTicks !== 0) return;
  const block = world.tuning.enemies.playerBlock, cap = T.shoveMax;
  pushX *= block; pushY *= block;
  const l2 = pushX * pushX + pushY * pushY;
  if (l2 > cap * cap) { const k = cap / Math.sqrt(l2); pushX *= k; pushY *= k; }
  pushX += hardX; pushY += hardY;
  if (pushX !== 0 || pushY !== 0) {
    const out = world.scratch.v2;
    world.terrain.collide(p.x + pushX, p.y + pushY, T.radius, out);
    p.x = out[0]; p.y = out[1];
  }
}

/**
 * Step 9: resolve this tick's deaths: gems and drops, kill counts, hooks, splits, chests, and
 * boss results. Dead enemies stay in the pool (flagged) until removeDead() at the end of the tick.
 * Returns how many deaths it processed.
 */
export function resolveDeaths(world) {
  const E = world.enemies;
  const n = E.count;
  const sc = world.scratch.sc;
  let resolved = 0;
  for (let i = 0; i < n; i++) {
    const f = E.flags[i];
    if ((f & EF.DEAD) === 0 || (f & EF.RESOLVED) !== 0) continue;
    E.flags[i] = f | EF.RESOLVED;
    resolved++;
    const type = E.type[i];
    const def = world.enemyDefs[type];
    const x = E.x[i], y = E.y[i];
    world.killXpMul = 1;
    world.result.killsByType[type]++;
    world.result.totalKills++;
    if (world.player.dashTicks > 0) world.result.dashKills++;
    if ((f & EF.ELITE) !== 0) world.result.elitesKilled++;
    const ev = world.events, kk = ev.reserve(EV.KILL);
    if (kk >= 0) { ev.x[kk] = x; ev.y[kk] = y; ev.a[kk] = type; ev.b[kk] = ((f & EF.ELITE) !== 0 ? 1 : 0) | ((f & EF.BOSS) !== 0 ? 2 : 0); ev.c[kk] = E.killer[i]; ev.d[kk] = E.handle(i); }
    runHooks(world, 'onKill', i, type);
    const xp = E.xp[i] * world.killXpMul;
    if (xp > 0) spawnGem(world, x, y, xp);
    rollDrops(world, i, def, f);
    if (def.ai.type === 'splitter') {
      const into = world.enemyIndex.get(def.ai.into);
      const cnt = def.ai.count;
      for (let k = 0; k < cnt; k++) {
        sincosInto((k / cnt) * TAU + E.anim[i] * TAU, sc, 0);
        const r = E.radius[i];
        const c = spawnEnemy(world, into, x + sc[1] * r, y + sc[0] * r, null);
        if (c >= 0) impulse(world, c, sc[1], sc[0], def.ai.burst ?? 0.8);
      }
    }
    if ((f & EF.BOSS) !== 0) bossDied(world, i);
    else if ((f & EF.ELITE) !== 0) dropChest(world, x, y, 1);
  }
  return resolved;
}

/**
 * End of tick: remove dead enemies (swap-with-last, walking backward). Any death not yet
 * processed is processed first, so no kill is ever thrown away uncounted.
 */
export function removeDead(world) {
  // Resolving a death can cause another (a kill hook's blast): repeat until none are left.
  for (let guard = 0; guard < 64 && resolveDeaths(world) > 0; guard++);
  const E = world.enemies;
  for (let i = E.count - 1; i >= 0; i--) {
    if ((E.flags[i] & EF.DEAD) !== 0) E.remove(i);
  }
}

/** A spawn point on the ring just outside the view: out[0], out[1]; false if none was found. */
export function ringPosition(world, radius, out) {
  const p = world.player, rng = world.rng.spawn, terrain = world.terrain;
  const sc = world.scratch.sc;
  for (let tries = 0; tries < 8; tries++) {
    sincosInto(rng.next() * TAU, sc, 0);
    const r = radius + rng.next() * world.tuning.enemies.spawnJitter;
    const x = p.x + sc[1] * r, y = p.y + sc[0] * r;
    if (x < 8 || y < 8 || x > terrain.width - 8 || y > terrain.height - 8) continue;
    if (terrain.blockedAt(x, y)) continue;
    out[0] = x; out[1] = y;
    return true;
  }
  return false;
}
