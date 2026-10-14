// Bosses (ARCHITECTURE §5.13): phases and attacks from a small pattern library, each attack
// telegraphed for at least telegraphMin (0.8 s) with a clear shape.
//
// A boss walks at you (faster when far away) and, every `every` seconds, starts the next attack
// in its current phase's list. An attack: WARN (the boss stops; the shape shows), then EXECUTE.
// A charge also has a CHARGE state where the boss runs along the warned line.

import { DT, TPS, EF, HIT_SLOTS } from './constants.js';
import { EV, TELE } from './events.js';
import { hurtPlayer } from './player.js';
import { spawnEnemy } from './enemies.js';
import { spawnHazard, spawnHostileShot } from './attacks.js';
import { dropChest, openChest, CHEST_BOSS } from './chests.js';
import { finalBossDown } from './director.js';
import { runHooks } from './hooks.js';
import { sincosInto, fatan2, TAU, PI } from '../lib/fmath.js';

/** Boss states (bosses[k].state): walk at you, warn (the shape shows), charge, recover. */
export const BOSS_STATE = Object.freeze({ WALK: 0, WARN: 1, CHARGE: 2, RECOVER: 3 });
const { WALK, WARN, CHARGE, RECOVER } = BOSS_STATE;
const ATTACK_CODE = { slam_ring: 1, charge_line: 2, summon_wave: 3, projectile_fan: 4, hazard_pools: 5 };

function angleOf(y, x) { return x === 0 && y === 0 ? 0 : fatan2(y, x); }

/** Register a spawned boss enemy (index e) so it gets phases and attacks. */
export function registerBoss(world, e, final) {
  const E = world.enemies;
  const def = world.enemyDefs[E.type[e]];
  const bossDef = world.bossDefs.get(def.boss);
  if (!bossDef) throw new Error(`Enemy ${def.id} names unknown boss pattern "${def.boss}"`);
  const b = {
    handle: E.handle(e), type: E.type[e], id: def.id, def: bossDef, final,
    phase: 0, next: 0, state: WALK, timer: bossDef.phases[0].every, attack: null,
    ax: 0, ay: 0, adx: 0, ady: 0, chargeLeft: 0, hitPlayer: false,
    damageBySlot: new Float64Array(HIT_SLOTS), spawnTick: world.tick, alive: true,
  };
  world.bosses.push(b);
  E.boss[e] = world.bosses.length - 1;
  world.director.bossesAlive++;
  world.events.push(EV.BOSS_SPAWN, E.x[e], E.y[e], E.type[e], b.handle);
  return b;
}

function phaseFor(b, hpFrac) {
  let idx = 0;
  const ph = b.def.phases;
  for (let k = 0; k < ph.length; k++) if (hpFrac <= ph[k].from) idx = k;
  return idx;
}

/**
 * The boss's turn (called from enemiesAct). Writes its move direction and speed to
 * dir[0], dir[1], dir[2].
 */
export function bossStep(world, e, dist, tx, ty, speedMul, dir) {
  const E = world.enemies, T = world.tuning.enemies;
  const b = world.bosses[E.boss[e]];
  const p = world.player;
  const hpFrac = E.hp[e] / E.maxHp[e];
  const ph = phaseFor(b, hpFrac);
  if (ph !== b.phase) { b.phase = ph; b.next = 0; }
  const phase = b.def.phases[b.phase];
  const toX = dist > 0.0001 ? tx / dist : 0, toY = dist > 0.0001 ? ty / dist : 0;
  dir[0] = toX; dir[1] = toY;
  dir[2] = E.speed[e] * speedMul * (dist > T.bossCatchupDistance ? T.bossCatchupSpeed : 1);

  if (b.state === WALK) {
    b.timer -= DT;
    if (b.timer <= 0 && dist < world.tuning.bosses.attackRange) startAttack(world, e, b, phase);
    return;
  }
  if (b.state === WARN) {
    dir[2] = 0;
    b.timer -= DT;
    if (b.timer <= 0) execute(world, e, b);
    return;
  }
  if (b.state === CHARGE) {
    // A warned charge runs its course: nothing slows or holds it midway (a boss frozen before
    // it began still charges on time; see enemies.js midAttack).
    dir[0] = b.adx; dir[1] = b.ady;
    const sp = b.attack.speed;
    dir[2] = sp;
    b.chargeLeft -= sp * DT;
    // The charge hurts on contact (once per charge), on top of ordinary contact damage.
    const dx = p.x - E.x[e], dy = p.y - E.y[e];
    const rr = E.radius[e] + world.tuning.player.radius + b.attack.width * 0.25;
    if (!b.hitPlayer && dx * dx + dy * dy <= rr * rr && hurtPlayer(world, b.attack.damage, E.x[e], E.y[e]) > 0) b.hitPlayer = true;
    if (b.chargeLeft <= 0) { b.state = RECOVER; b.timer = world.tuning.bosses.recover; }
    return;
  }
  // RECOVER
  dir[2] = 0;
  b.timer -= DT;
  if (b.timer <= 0) { b.state = WALK; b.timer = phase.every; }
}

/** How long an attack warns: its own `warn`, but never under tuning.enemies.telegraphMin (§5.13). */
export function warnTime(world, a) {
  return Math.max(a.warn ?? 0, world.tuning.enemies.telegraphMin);
}

function startAttack(world, e, b, phase) {
  const E = world.enemies, p = world.player;
  const name = phase.attacks[b.next % phase.attacks.length];
  b.next++;
  const a = b.def.attacks[name];
  b.attack = a;
  const warn = warnTime(world, a);
  const ticks = Math.round(warn * TPS);
  b.state = WARN;
  b.timer = warn;
  b.hitPlayer = false;
  const x = E.x[e], y = E.y[e];
  const dx = p.x - x, dy = p.y - y, d = Math.sqrt(dx * dx + dy * dy) || 1;
  b.adx = dx / d; b.ady = dy / d;
  b.ax = p.x; b.ay = p.y;
  switch (a.type) {
    case 'slam_ring':
      world.events.push(EV.TELEGRAPH, x, y, TELE.RING, ticks, a.radius, 0);
      break;
    case 'charge_line':
      world.events.push(EV.TELEGRAPH, x, y, TELE.LINE, ticks, a.length, angleOf(b.ady, b.adx));
      break;
    case 'summon_wave':
      world.events.push(EV.TELEGRAPH, x, y, TELE.SUMMON, ticks, a.radius, a.count);
      break;
    case 'projectile_fan':
      world.events.push(EV.TELEGRAPH, x, y, TELE.FAN, ticks, a.spread, angleOf(b.ady, b.adx));
      break;
    case 'hazard_pools': {
      // The pools are their own warning: each shows its circle for `warn`, then arms.
      const rng = world.rng.boss, sc = world.scratch.sc;
      for (let k = 0; k < a.count; k++) {
        sincosInto(rng.next() * TAU, sc, 0);
        const r = k === 0 ? 0 : rng.next() * a.scatter;
        spawnHazard(world, p.x + sc[1] * r, p.y + sc[0] * r, a.radius, warn, a.last, a.damage);
      }
      break;
    }
    default:
      throw new Error(`Unknown boss attack type "${a.type}"`);
  }
  world.events.push(EV.BOSS_ATTACK, x, y, ATTACK_CODE[a.type], b.handle);
}

function execute(world, e, b) {
  const E = world.enemies, p = world.player, a = b.attack;
  const x = E.x[e], y = E.y[e];
  switch (a.type) {
    case 'slam_ring': {
      const dx = p.x - x, dy = p.y - y, rr = a.radius + world.tuning.player.radius;
      if (dx * dx + dy * dy <= rr * rr) hurtPlayer(world, a.damage, x, y);
      world.events.push(EV.EXPLODE, x, y, a.radius, -1);
      break;
    }
    case 'charge_line':
      b.state = CHARGE;
      b.chargeLeft = a.length;
      return;
    case 'summon_wave': {
      const type = world.enemyIndex.get(a.enemy);
      const cap = world.tuning.bosses.minionCap;
      const sc = world.scratch.sc;
      let alive = 0;
      for (let i = 0; i < E.count; i++) if ((E.flags[i] & (EF.MINION | EF.DEAD)) === EF.MINION) alive++;
      for (let k = 0; k < a.count && alive < cap; k++, alive++) {
        sincosInto((k / a.count) * TAU, sc, 0);
        spawnEnemy(world, type, x + sc[1] * a.radius, y + sc[0] * a.radius, { minion: true });
      }
      break;
    }
    case 'projectile_fan': {
      const spread = (a.spread * PI) / 180;
      const sc = world.scratch.sc;
      for (let k = 0; k < a.count; k++) {
        const off = a.count === 1 ? 0 : (k / (a.count - 1) - 0.5) * spread;
        sincosInto(off, sc, 0);
        const dx = b.adx * sc[1] - b.ady * sc[0], dy = b.adx * sc[0] + b.ady * sc[1];
        spawnHostileShot(world, x, y, dx * a.speed, dy * a.speed, a.radius, a.damage, a.life ?? 5);
      }
      break;
    }
    case 'hazard_pools':
      break; // already placed at the start
    default:
      break;
  }
  b.state = RECOVER;
  b.timer = world.tuning.bosses.recover;
}

/** A boss died: record it, drop the boss chest, and after the last boss offer overtime. */
export function bossDied(world, e) {
  const E = world.enemies;
  const b = world.bosses[E.boss[e]];
  if (!b || !b.alive) return;
  b.alive = false;
  world.director.bossesAlive--;
  // Which weapons did the damage, most first.
  const used = [];
  for (let s = 0; s < HIT_SLOTS; s++) if (b.damageBySlot[s] > 0) used.push(s);
  used.sort((i, j) => b.damageBySlot[j] - b.damageBySlot[i] || i - j);
  const weapons = used.map((s) => (world.slots[s] && world.slots[s].def ? world.slots[s].def.id : 'relic'));
  world.result.bossesKilled.push({ id: b.id, tick: world.tick, weapons });
  runHooks(world, 'onBossKill', e, b.id);
  if (b.final) {
    // The last boss's chest opens on the spot, before the stay-or-leave choice, so leaving can
    // never skip it.
    openChest(world, CHEST_BOSS, E.x[e], E.y[e]);
    finalBossDown(world);
  } else {
    dropChest(world, E.x[e], E.y[e], CHEST_BOSS);
  }
}
