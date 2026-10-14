// Enemy attacks that outlive the enemy's own turn: slow hostile shots and warned hazard pools.
// Both warn before they can hurt (telegraphMin, 0.8 s): shots are fired only after a warning
// (enemies.js, bosses.js), and pools show their circle for the warning time before arming.

import { TPS, HOSTILE, PF, MOTION, ZONE, HIT_RING } from './constants.js';
import { NO_HANDLE } from './pools.js';
import { EV, TELE } from './events.js';

/** A slow, readable hostile shot. It only ever tests against the player. */
export function spawnHostileShot(world, x, y, vx, vy, radius, damage, life) {
  const P = world.projectiles;
  const i = P.alloc();
  if (i < 0) return -1;
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
  world.events.push(EV.ENEMY_SHOT, x, y);
  return i;
}

/**
 * A hazard pool: its circle shows for `warn` seconds (a telegraph event), then it hurts the
 * player on contact for `last` seconds (at most once every half second).
 */
export function spawnHazard(world, x, y, radius, warn, last, damage) {
  const Z = world.zones;
  const i = Z.alloc();
  if (i < 0) return -1;
  Z.x[i] = x; Z.y[i] = y;
  Z.kind[i] = ZONE.HAZARD;
  Z.slot[i] = HOSTILE;
  Z.radius[i] = radius;
  Z.maxRadius[i] = radius;
  Z.warn[i] = warn;
  Z.life[i] = warn + last;
  Z.damage[i] = damage;
  Z.def[i] = 0xffff;
  world.events.push(EV.TELEGRAPH, x, y, TELE.CIRCLE, Math.round(warn * TPS), radius, last);
  return i;
}

