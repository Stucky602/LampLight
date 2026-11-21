// Enemy attacks that outlive the enemy's own turn: slow hostile shots and warned hazard pools.
// Both warn before they can hurt (telegraphMin, 0.8 s): shots are fired only after a warning
// (enemies.js, bosses.js), and pools show their circle for the warning time before arming.
//
// 0.9.0 (W3): every warning goes out through `tell`, which follows its TELEGRAPH with a TELE_TIER:
// MAJOR for bosses, champions, and map strikes; FULL for an ordinary warning that threatens you,
// while fewer than tuning.enemies.tellFullMax are showing; DIM for the rest (the view draws a
// short tell). The tier is presentation only: nothing about the attack changes with it.
// A shot or pool remembers who made it (by its pool slot id), so a hit it lands says what hurt you
// (hurtSource: the death recap) without the weapons code knowing about enemies.

import { TPS, HOSTILE, PF, MOTION, ZONE, HIT_RING, CAP } from './constants.js';
import { NO_HANDLE } from './pools.js';
import { EV, TELE, TIER, HURT } from './events.js';

/** What a hostile pool zone looks like (hazardLook): black water, a Molten elite's fire, a champion's brine, a boss's pools. */
export const HAZARD_LOOK = Object.freeze({ POOL: 1, FIRE: 2, BRINE: 3, BOSS: 4 });

/**
 * The attack sources and the warning cap (sim/threat.js createCombatState puts them on the world).
 * src: the register a caller fills before a shot or pool (setSource), read and cleared by it.
 */
export function createAttackState() {
  return {
    src: { kind: 0, e: -1, attack: null, look: HAZARD_LOOK.POOL, major: false },
    // Per pool slot id: who made the shot or pool now in it.
    shotKind: new Uint8Array(CAP.projectiles), shotType: new Int16Array(CAP.projectiles).fill(-1), shotAttack: new Array(CAP.projectiles).fill(null),
    zoneKind: new Uint8Array(CAP.zones), zoneType: new Int16Array(CAP.zones).fill(-1), zoneAttack: new Array(CAP.zones).fill(null), zoneLook: new Uint8Array(CAP.zones),
    fullEnds: new Int32Array(16),   // the ticks the FULL ordinary warnings showing now end (0: a free place)
  };
}

/**
 * Who makes the next shot or pool: kind (HURT), the enemy's index (-1 none), the attack's data (its
 * `name` for the recap; null none), the pool's look, and whether its warning is MAJOR.
 */
export function setSource(world, kind, e, attack = null, look = HAZARD_LOOK.POOL, major = false) {
  const s = world.attack.src;
  s.kind = kind; s.e = e; s.attack = attack; s.look = look; s.major = major;
}

function clearSource(s) { s.kind = 0; s.e = -1; s.attack = null; s.look = HAZARD_LOOK.POOL; s.major = false; }

/**
 * The tier of a warning starting now: MAJOR if `major`, FULL if it threatens you and the cap has
 * room (it takes a place until it ends), else DIM.
 */
export function tellTier(world, major, threatens, ticks) {
  if (major) return TIER.MAJOR;
  if (!threatens) return TIER.DIM;
  const ends = world.attack.fullEnds, max = world.tuning.enemies.tellFullMax, now = world.tick;
  let showing = 0, free = -1;
  for (let k = 0; k < ends.length; k++) {
    if (ends[k] > now) showing++;
    else if (free < 0) free = k;
  }
  if (showing >= max || free < 0) return TIER.DIM;
  ends[free] = now + ticks;
  return TIER.FULL;
}

/**
 * A warning: its TELEGRAPH (shape, ticks, size, angle or width) and, at once, its TELE_TIER. e is
 * the enemy that makes it (-1 none: a map strike, which is MAJOR).
 */
export function tell(world, x, y, shape, ticks, size, angle, e, major, threatens) {
  const ev = world.events;
  ev.push(EV.TELEGRAPH, x, y, shape, ticks, size, angle);
  const tier = tellTier(world, major || e < 0, threatens, ticks);
  const E = world.enemies;
  ev.push(EV.TELE_TIER, x, y, tier, e >= 0 ? E.handle(e) : -1, ticks, e >= 0 ? E.type[e] : -1);
  return tier;
}

/** Does a line from (x, y) at unit (ux, uy), `length` long and `width` wide, pass over you now? */
export function lineCrossesPlayer(world, x, y, ux, uy, length, width) {
  const p = world.player, px = p.x - x, py = p.y - y;
  const along = px * ux + py * uy;
  if (along < -8 || along > length + 8) return false;
  const cx = px - ux * along, cy = py - uy * along, w = width * 0.5 + world.tuning.player.radius + 6;
  return cx * cx + cy * cy <= w * w;
}

/** Are you inside, or within a step of, a ring of `radius` at (x, y)? */
export function ringHoldsPlayer(world, x, y, radius) {
  const p = world.player, dx = p.x - x, dy = p.y - y, r = radius + world.tuning.player.radius + 12;
  return dx * dx + dy * dy <= r * r;
}

/** A slow, readable hostile shot. It only ever tests against the player. */
export function spawnHostileShot(world, x, y, vx, vy, radius, damage, life) {
  const P = world.projectiles;
  const i = P.alloc();
  const A = world.attack, s = A.src;
  if (i < 0) { clearSource(s); return -1; }
  P.x[i] = x; P.y[i] = y; P.px[i] = x; P.py[i] = y;
  P.vx[i] = vx; P.vy[i] = vy;
  P.life[i] = life;
  P.slot[i] = HOSTILE;
  P.flags[i] = PF.HOSTILE;
  P.damage[i] = damage;
  P.radius[i] = radius;
  P.pierce[i] = 1;
  P.motion[i] = MOTION.linear;
  P.target[i] = NO_HANDLE;
  P.hops[i] = -1;
  P.def[i] = 0xffff;
  P.hits.fill(NO_HANDLE, i * HIT_RING, i * HIT_RING + HIT_RING);
  const id = P.handle(i) & (CAP.projectiles - 1);
  A.shotKind[id] = s.kind || HURT.SHOT; A.shotType[id] = s.e >= 0 ? world.enemies.type[s.e] : -1; A.shotAttack[id] = s.attack;
  clearSource(s);
  world.events.push(EV.ENEMY_SHOT, x, y);
  return i;
}

/**
 * A hazard pool: its circle shows for `warn` seconds (a telegraph event), then it hurts the
 * player on contact for `last` seconds (at most once every half second). Who made it comes from
 * setSource (an enemy's pool by default).
 */
export function spawnHazard(world, x, y, radius, warn, last, damage) {
  const Z = world.zones;
  const i = Z.alloc();
  const A = world.attack, s = A.src;
  if (i < 0) { clearSource(s); return -1; }
  Z.x[i] = x; Z.y[i] = y;
  Z.kind[i] = ZONE.HAZARD;
  Z.slot[i] = HOSTILE;
  Z.radius[i] = radius;
  Z.maxRadius[i] = radius;
  Z.warn[i] = warn;
  Z.life[i] = warn + last;
  Z.damage[i] = damage;
  Z.def[i] = 0xffff;
  const id = Z.handle(i) & (CAP.zones - 1);
  A.zoneKind[id] = s.kind || HURT.HAZARD; A.zoneType[id] = s.e >= 0 ? world.enemies.type[s.e] : -1; A.zoneAttack[id] = s.attack; A.zoneLook[id] = s.look;
  const e = s.e, major = s.major;
  clearSource(s);
  tell(world, x, y, TELE.CIRCLE, Math.round(warn * TPS), radius, last, e, major, ringHoldsPlayer(world, x, y, radius));
  return i;
}

/**
 * A strike's warning and its source (sim/storm.js strikeAt, zone z): a map strike's (the storm, the
 * Eye) unless a caller set one (the Salt Widow's march: setSource). Always MAJOR.
 */
export function tellStrike(world, z, x, y, ticks, radius) {
  const A = world.attack, s = A.src, id = world.zones.handle(z) & (CAP.zones - 1);
  A.zoneKind[id] = s.kind || HURT.STRIKE; A.zoneType[id] = s.e >= 0 ? world.enemies.type[s.e] : -1; A.zoneAttack[id] = s.attack; A.zoneLook[id] = s.look;
  const e = s.e;
  clearSource(s);
  tell(world, x, y, TELE.RING, ticks, radius, 0, e, true, true);
}

/** What hostile pool zone z (dense index) looks like (HAZARD_LOOK; the view). */
export function hazardLook(world, z) {
  return world.attack.zoneLook[world.zones.handle(z) & (CAP.zones - 1)] || HAZARD_LOOK.POOL;
}

/**
 * What lands on you at (x, y) when the caller didn't say (a hostile shot or a pool, from the weapons
 * code): out[0] the HURT kind, out[1] the enemy type (-1), and the attack (or null) returned. A
 * cold path (a hit taken): it looks for the shot or pool standing exactly there.
 */
export function hurtSource(world, x, y, out) {
  const P = world.projectiles, A = world.attack;
  for (let i = 0; i < P.count; i++) {
    if ((P.flags[i] & PF.HOSTILE) === 0 || P.x[i] !== x || P.y[i] !== y) continue;
    const id = P.handle(i) & (CAP.projectiles - 1);
    out[0] = A.shotKind[id] || HURT.SHOT; out[1] = A.shotType[id];
    return A.shotAttack[id];
  }
  const Z = world.zones;
  for (let z = 0; z < Z.count; z++) {
    if ((Z.kind[z] !== ZONE.HAZARD && Z.kind[z] !== ZONE.STRIKE) || Z.x[z] !== x || Z.y[z] !== y) continue;
    const id = Z.handle(z) & (CAP.zones - 1);
    out[0] = A.zoneKind[id] || HURT.HAZARD; out[1] = A.zoneType[id];
    return A.zoneAttack[id];
  }
  out[0] = HURT.HAZARD; out[1] = -1;
  return null;
}
