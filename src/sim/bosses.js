// Bosses (ARCHITECTURE §5.13): phases and attacks from a small pattern library, each attack
// telegraphed for at least telegraphMin (0.8 s) with a clear shape.
//
// A boss walks at you (faster when far away) and, every `every` seconds, starts the next attack
// in its current phase's list. An attack: WARN (the boss stops; the shape shows), then EXECUTE.
// A charge also has a CHARGE state where the boss runs along the warned line. The Maw's lure
// draws you toward it while it warns (world.pull, read by playerStep).
//
// Phase gates (0.9.0, ruling 5; they replace minFight's time cap): each phase names its
// `signature` attack. A boss can't lose health past the notch below its phase (the next phase's
// `from`; for the last phase, its death) until it has thrown that phase's signature once; a boss
// held at a notch throws its signature next. Weak windows (stuck in mud, kneeling) multiply what
// lands and skip the time floor; minFight is a 15 s safety floor (a share of its health a second at
// most), and a gate never holds longer than tuning.bosses.gateMaxHold.

import { DT, TPS, EF, HIT_SLOTS, PK } from './constants.js';
import { TILE, GROUND } from './terrain.js';
import { strikeAt, GIFT_PILLAR } from './storm.js';
import { EV, TELE, STRIKE_SRC, HURT, HIT_CAPPED, HIT_GATED } from './events.js';
import { hurtPlayer } from './player.js';
import { spawnEnemy } from './enemies.js';
import { spawnHazard, spawnHostileShot, setSource, tell, HAZARD_LOOK } from './attacks.js';
import { dropChest, openChest, CHEST_BOSS } from './chests.js';
import { spawnPickup } from './pickups.js';
import { finalBossDown } from './director.js';
import { runHooks } from './hooks.js';
import { sincosInto, fatan2, TAU, PI } from '../lib/fmath.js';

/** Boss states (bosses[k].state): walk at you, warn (the shape shows), charge, recover. */
export const BOSS_STATE = Object.freeze({ WALK: 0, WARN: 1, CHARGE: 2, RECOVER: 3 });
const { WALK, WARN, CHARGE, RECOVER } = BOSS_STATE;
const VIEW_HALF_W = 320, VIEW_HALF_H = 180; // the 640 x 360 view around you (§6.1)

/**
 * A boss's attack data, checked when a run starts: a plain message for the first thing wrong,
 * or null. Each type's numbers must be there and make sense (a lure slower than you walk, tide
 * rows far enough apart to stand between).
 */
export function checkBossDef(def, tuning, enemyIds = null) {
  const pos = (v) => Number.isFinite(v) && v > 0;
  const pr = tuning.player.radius;
  for (const [name, a] of Object.entries(def.attacks)) {
    const at = `Boss ${def.id}: attack "${name}"`;
    if (ATTACK_CODE[a.type] === undefined) return `${at}: unknown type "${a.type}" (known: ${Object.keys(ATTACK_CODE).join(', ')})`;
    if (!(a.warn >= 0)) return `${at}: needs a warning time`;
    if (typeof a.name !== 'string' || !a.name) return `${at}: needs a name (said in a sentence: "the Tidecaller's tide line")`;
    const need = {
      slam_ring: ['radius', 'damage'], charge_line: ['length', 'width', 'speed', 'damage'], summon_wave: ['count', 'radius'],
      projectile_fan: ['count', 'spread', 'speed', 'damage', 'radius'], hazard_pools: ['count', 'radius', 'scatter', 'last', 'damage'],
      lure: ['bite', 'pull', 'damage'], tide_lanes: ['lanes', 'gap', 'length', 'spacing', 'radius', 'last', 'damage'],
      // The Salt Marsh's (0.8.0): the Old Grey's stab and leap, the Salt Widow's march.
      stab_line: ['length', 'width', 'damage'], leap: ['radius', 'damage', 'stuck', 'weak'],
      lightning_march: ['count', 'step', 'radius', 'stagger', 'damage', 'enemyDamage', 'kneel', 'weak'],
    }[a.type];
    for (const k of need) if (!pos(a[k])) return `${at}: ${k} must be above 0`;
    if (a.type === 'summon_wave' && enemyIds && !enemyIds.has(a.enemy)) return `${at}: unknown enemy "${a.enemy}"`;
    if (a.type === 'lure' && !(a.pull < tuning.player.speed * 0.75)) return `${at}: the pull must stay well under your walking speed`;
    if (a.type === 'lure' && !(a.bite < VIEW_HALF_H - 20)) return `${at}: the bite's ring must fit on screen`;
    if (a.type === 'tide_lanes' && !(a.gap > 2 * (a.radius + pr) + 2 * pr)) return `${at}: the rows must be far enough apart to stand between`;
    if (a.type === 'tide_lanes' && !(a.spacing <= 2 * a.radius)) return `${at}: the pools of a row must touch (spacing at most twice the radius)`;
    if (a.type === 'tide_lanes' && !(a.stagger >= 0)) return `${at}: needs a stagger of 0 or more`;
  }
  if (!(Number.isInteger(def.level) && def.level >= 1)) return `Boss ${def.id}: needs a level (the player's level its listed health is for), a whole number from 1`;
  if (!(def.minFight > 0)) return `Boss ${def.id}: needs a minFight (the fight's shortest length) above 0 s`;
  if (!Array.isArray(def.phases) || def.phases.length === 0) return `Boss ${def.id}: needs at least one phase`;
  for (const ph of def.phases) {
    if (!(ph.from > 0 && ph.from <= 1)) return `Boss ${def.id}: a phase's from must be a share of HP above 0, at most 1`;
    if (!(ph.every > 0)) return `Boss ${def.id}: a phase's every must be above 0 s`;
    if (!Array.isArray(ph.attacks) || ph.attacks.length === 0) return `Boss ${def.id}: a phase needs attacks`;
    for (const n of ph.attacks) if (!def.attacks[n]) return `Boss ${def.id}: a phase names unknown attack "${n}"`;
    if (!ph.attacks.includes(ph.signature)) return `Boss ${def.id}: each phase needs a signature, one of its own attacks (its gate opens when it's thrown)`;
  }
  return null;
}

const ATTACK_CODE = { slam_ring: 1, charge_line: 2, summon_wave: 3, projectile_fan: 4, hazard_pools: 5, lure: 6, tide_lanes: 7, stab_line: 8, leap: 9, lightning_march: 10 };
export { ATTACK_CODE };

function angleOf(y, x) { return x === 0 && y === 0 ? 0 : fatan2(y, x); }

/**
 * What a boss's health is multiplied by for the player's level when it arrives (0.7.3): its
 * listed health is for bossDef.level, and each level above or below adds or takes
 * tuning.bosses.hpPerLevel of it, held between hpLevelMin and hpLevelMax.
 */
export function bossLevelMul(world, bossDef) {
  const T = world.tuning.bosses;
  const m = 1 + T.hpPerLevel * (world.player.level - bossDef.level);
  return m < T.hpLevelMin ? T.hpLevelMin : m > T.hpLevelMax ? T.hpLevelMax : m;
}

/**
 * Register a spawned boss enemy (index e) so it gets phases and attacks. Its health is set from
 * the player's level now (bossLevelMul), and its fight-length budget starts: it can lose at most
 * its health times the seconds since now over its minFight (enemies.js damageEnemyR).
 */
export function registerBoss(world, e, final) {
  const E = world.enemies;
  const def = world.enemyDefs[E.type[e]];
  const bossDef = world.bossDefs.get(def.boss);
  if (!bossDef) throw new Error(`Enemy ${def.id} names unknown boss pattern "${def.boss}"`);
  const hp = E.maxHp[e] * bossLevelMul(world, bossDef);
  E.hp[e] = E.maxHp[e] = hp;
  // Each attack as what hurt you reads it (the death recap): its key and its name.
  const info = {};
  for (const [key, a] of Object.entries(bossDef.attacks)) info[key] = Object.freeze({ key, name: a.name });
  const b = {
    handle: E.handle(e), type: E.type[e], id: def.id, def: bossDef, final,
    phase: 0, next: 0, state: WALK, timer: bossDef.phases[0].every * world.tideRules.bossTempo, attack: null,
    ax: 0, ay: 0, adx: 0, ady: 0, chargeLeft: 0, hitPlayer: false,
    damageBySlot: new Float64Array(HIT_SLOTS), spawnTick: world.tick, alive: true,
    // The fight-length budget: health to lose over minFight seconds, and what it has lost.
    budget: hp, taken: 0, minFightTicks: Math.max(1, Math.round(bossDef.minFight * TPS)),
    // A weak window (stuck in the mud, kneeling): from and until which tick, and what hits are
    // multiplied by inside it (inside the fight-length budget all the same). Stuck: it can't move or attack.
    weakFrom: -1, weakUntil: -1, weakMul: 1, stuckUntil: -1, sx: 0, sy: 0,
    // Phase gates (ruling 5): the bar's notches, whether this phase's signature has been thrown,
    // whether a gate is holding damage now (and since when), what's been held back, and the bits
    // the last hit carries (HIT_CAPPED, HIT_GATED).
    notches: Object.freeze(bossDef.phases.slice(1).map((ph) => ph.from)), sigDone: false, held: false, heldTick: -1, eaten: 0, hitBits: 0,
    info, attackKey: null, weakSaid: false,
  };
  world.bosses.push(b);
  E.boss[e] = world.bosses.length - 1;
  world.director.bossesAlive++;
  world.events.push(EV.BOSS_SPAWN, E.x[e], E.y[e], E.type[e], b.handle);
  return b;
}

/**
 * How low a boss's health may go now (ruling 5): above the notch below its phase while its
 * signature waits (a hair above, so it stays in its phase), above the next notch once it's thrown;
 * at its last phase, 1 until its signature is thrown, then nothing.
 */
function gateFloor(b, maxHp) {
  const n = b.notches.length, idx = b.sigDone ? b.phase + 1 : b.phase;
  if (idx < n) return b.notches[idx] * maxHp + 1;
  return idx === n ? 1 : -1;
}

/**
 * What of a hit's `amount` a boss takes (enemies.js damageEnemyR): a weak window multiplies it and
 * skips the floor; the 15 s floor (minFight) holds what runs ahead of its pace; a gate holds what
 * would pass its notch. b.hitBits says what was held.
 */
export function bossAllow(world, b, e, amount) {
  const E = world.enemies;
  let bits = 0;
  const weak = world.tick >= b.weakFrom && world.tick < b.weakUntil;
  if (weak) amount *= b.weakMul;
  else {
    const t = world.tick - b.spawnTick + 1;
    if (t < b.minFightTicks) {
      const room = (b.budget * t) / b.minFightTicks - b.taken;
      if (amount > room) { const keep = room > 0 ? room : 0; b.eaten += amount - keep; amount = keep; bits |= HIT_CAPPED; }
    }
  }
  const floor = gateFloor(b, E.maxHp[e]);
  if (floor > 0 && E.hp[e] - amount < floor) {
    const keep = E.hp[e] - floor > 0 ? E.hp[e] - floor : 0;
    b.eaten += amount - keep; amount = keep; bits |= HIT_GATED;
    if (!b.held) {
      b.held = true; b.heldTick = world.tick;
      world.events.push(EV.BOSS_GATE, E.x[e], E.y[e], 1, b.handle, b.sigDone ? b.phase + 1 : b.phase);
    }
  }
  if (!weak) b.taken += amount;
  b.hitBits = bits;
  return amount;
}

/** The phase's signature was thrown (or a gate held too long): its gate opens. */
function openGate(world, e, b) {
  b.sigDone = true;
  if (b.held) {
    b.held = false;
    world.events.push(EV.BOSS_GATE, world.enemies.x[e], world.enemies.y[e], 2, b.handle, b.phase);
  }
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
  if (ph !== b.phase) {
    b.phase = ph; b.next = 0; b.sigDone = false; b.held = false;
    world.events.push(EV.BOSS_PHASE, E.x[e], E.y[e], ph, b.handle);
  }
  const phase = b.def.phases[b.phase];
  // A gate that has held too long opens anyway (a safety: a signature that can't find its moment).
  if (b.held && world.tick - b.heldTick > world.tuning.bosses.gateMaxHold * TPS) openGate(world, e, b);
  // A weak window's start and end, said once each.
  const weakNow = world.tick >= b.weakFrom && world.tick < b.weakUntil;
  if (weakNow !== b.weakSaid) {
    b.weakSaid = weakNow;
    world.events.push(EV.BOSS_WEAK, E.x[e], E.y[e], weakNow ? 1 : 0, b.handle, weakNow ? (b.weakUntil - world.tick) / TPS : 0);
  }
  const toX = dist > 0.0001 ? tx / dist : 0, toY = dist > 0.0001 ? ty / dist : 0;
  dir[0] = toX; dir[1] = toY;
  dir[2] = E.speed[e] * speedMul * (dist > T.bossCatchupDistance ? T.bossCatchupSpeed : 1);

  // Stuck in the mud (the Old Grey's leap onto mud): still, weak, attacking nothing.
  if (world.tick < b.stuckUntil) { dir[2] = 0; return; }
  if (b.state === WARN && b.attack.type === 'leap') {
    // In the air: it flies to the ring it warned of, landing as the warning ends.
    b.timer -= DT;
    const dx = b.ax - E.x[e], dy = b.ay - E.y[e], d = Math.sqrt(dx * dx + dy * dy);
    dir[0] = d > 1e-6 ? dx / d : 0; dir[1] = d > 1e-6 ? dy / d : 0;
    dir[2] = d / (b.timer > DT ? b.timer : DT);
    if (b.timer <= 0) { execute(world, e, b); dir[2] = 0; }
    return;
  }
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
    if (!b.hitPlayer && dx * dx + dy * dy <= rr * rr && hurtPlayer(world, b.attack.damage, E.x[e], E.y[e], HURT.BOSS, b.type, b.info[b.attackKey]) > 0) b.hitPlayer = true;
    if (b.chargeLeft <= 0) { b.state = RECOVER; b.timer = world.tuning.bosses.recover; }
    return;
  }
  // RECOVER
  dir[2] = 0;
  b.timer -= DT;
  if (b.timer <= 0) { b.state = WALK; b.timer = phase.every * world.tideRules.bossTempo; } // a Tide's quicker bosses
}

/** How long an attack warns: its own `warn`, but never under tuning.enemies.telegraphMin (§5.13). */
export function warnTime(world, a) {
  return Math.max(a.warn ?? 0, world.tuning.enemies.telegraphMin);
}

/** Can this attack start now? A lure only while its whole ring is on screen (it pulls you toward it). */
function canStart(world, e, a) {
  if (a.type !== 'lure') return true;
  const E = world.enemies, p = world.player;
  return Math.abs(E.x[e] - p.x) < VIEW_HALF_W - a.bite && Math.abs(E.y[e] - p.y) < VIEW_HALF_H - a.bite;
}

function startAttack(world, e, b, phase) {
  const E = world.enemies, p = world.player;
  // The next attack in the rotation that can start now (a lure waits its turn while it can't); a
  // boss held at a gate throws its signature first.
  let a = null, key = null;
  if (b.held && !b.sigDone) {
    const c = b.def.attacks[phase.signature];
    if (canStart(world, e, c)) { a = c; key = phase.signature; }
  }
  for (let tries = 0; tries < phase.attacks.length && a === null; tries++) {
    const k = phase.attacks[b.next % phase.attacks.length], c = b.def.attacks[k];
    b.next++;
    if (canStart(world, e, c)) { a = c; key = k; }
  }
  if (a === null) { b.timer = 0.25; return; } // nothing can start here: walk on and try again
  b.attack = a; b.attackKey = key;
  const info = b.info[key];
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
      tell(world, x, y, TELE.RING, ticks, a.radius, 0, e, true, true);
      break;
    case 'charge_line':
      tell(world, x, y, TELE.LINE, ticks, a.length, angleOf(b.ady, b.adx), e, true, true);
      break;
    case 'summon_wave':
      tell(world, x, y, TELE.SUMMON, ticks, a.radius, a.count, e, true, true);
      break;
    case 'projectile_fan':
      tell(world, x, y, TELE.FAN, ticks, a.spread, angleOf(b.ady, b.adx), e, true, true);
      break;
    case 'lure': {
      // The Maw's lure: its bite's ring shows, and for the whole warning you're drawn toward it
      // (slower than you walk: walk or dash out of the ring before the bite).
      tell(world, x, y, TELE.RING, ticks, a.bite, 0, e, true, true);
      const P = world.pull;
      P.x = x; P.y = y; P.speed = a.pull; P.ticks = ticks; P.boss = b.handle;
      break;
    }
    case 'tide_lanes': {
      // Lanes of pools across where you stand, east to west or north to south, one after
      // another (`stagger` s apart): stand between two lanes, or keep moving across them.
      const rng = world.rng.boss;
      const across = rng.chance(0.5);
      const shift = (rng.next() - 0.5) * a.gap;
      const per = Math.max(2, Math.round(a.length / a.spacing));
      for (let k = 0; k < a.lanes; k++) {
        const off = (k - (a.lanes - 1) / 2) * a.gap + shift;
        const w = warn + k * a.stagger;
        for (let j = 0; j < per; j++) {
          const along = (j - (per - 1) / 2) * a.spacing;
          setSource(world, HURT.BOSS, e, info, HAZARD_LOOK.BOSS, true);
          spawnHazard(world, across ? p.x + along : p.x + off, across ? p.y + off : p.y + along, a.radius, w, a.last, a.damage);
        }
      }
      break;
    }
    case 'stab_line':
      // The Old Grey's stab: a line from its beak toward you, then the beak goes down it.
      tell(world, x, y, TELE.LINE, ticks, a.length, angleOf(b.ady, b.adx), e, true, true);
      break;
    case 'leap': {
      // Up (untouchable), and down in the shadow ring where you stood, after the warning. On mud
      // it sticks (stuck s, taking weak times the damage): make it miss into the mud.
      let lx = p.x, ly = p.y;
      const T = world.terrain;
      if (T.blockedAt(lx, ly)) { const o = world.scratch.open; if (T.nearestOpen(Math.floor(lx / TILE), Math.floor(ly / TILE), o, 8)) { lx = o[0]; ly = o[1]; } }
      b.ax = lx; b.ay = ly; b.sx = x; b.sy = y;
      E.flags[e] |= EF.AIR;
      tell(world, lx, ly, TELE.RING, ticks, a.radius, 0, e, true, true);
      world.events.push(EV.LEAP, lx, ly, 1, warn, 0, b.handle);
      break;
    }
    case 'lightning_march': {
      // The Salt Widow's lightning marches toward you: a line of rings, each warned and a beat
      // after the last (rule 1); on salt each raises a glass pillar (sim/storm.js); none hurts her.
      for (let k = 0; k < a.count; k++) {
        const d = a.step * (k + 1);
        setSource(world, HURT.BOSS, e, info, HAZARD_LOOK.BOSS, true);
        strikeAt(world, x + b.adx * d, y + b.ady * d, a.radius, warn + k * a.stagger, a.enemyDamage, a.damage, STRIKE_SRC.WIDOW, GIFT_PILLAR);
      }
      break;
    }
    case 'hazard_pools': {
      // The pools are their own warning: each shows its circle for `warn`, then arms.
      const rng = world.rng.boss, sc = world.scratch.sc;
      for (let k = 0; k < a.count; k++) {
        sincosInto(rng.next() * TAU, sc, 0);
        const r = k === 0 ? 0 : rng.next() * a.scatter;
        setSource(world, HURT.BOSS, e, info, HAZARD_LOOK.BOSS, true);
        spawnHazard(world, p.x + sc[1] * r, p.y + sc[0] * r, a.radius, warn, a.last, a.damage);
      }
      break;
    }
    default:
      throw new Error(`Unknown boss attack type "${a.type}"`);
  }
  world.events.push(EV.BOSS_ATTACK, x, y, ATTACK_CODE[a.type], b.handle, key === phase.signature ? 1 : 0, Object.keys(b.def.attacks).indexOf(key));
}

function execute(world, e, b) {
  const E = world.enemies, p = world.player, a = b.attack;
  const x = E.x[e], y = E.y[e];
  const info = b.info[b.attackKey], type = b.type;
  // Its phase's signature, thrown: the gate below this phase opens (ruling 5).
  if (b.attackKey === b.def.phases[b.phase].signature) openGate(world, e, b);
  switch (a.type) {
    case 'slam_ring': {
      const dx = p.x - x, dy = p.y - y, rr = a.radius + world.tuning.player.radius;
      if (dx * dx + dy * dy <= rr * rr) hurtPlayer(world, a.damage, x, y, HURT.BOSS, type, info);
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
      const sc = world.scratch.sc, T = world.terrain, o = world.scratch.open;
      let alive = 0;
      for (let i = 0; i < E.count; i++) if ((E.flags[i] & (EF.MINION | EF.DEAD)) === EF.MINION) alive++;
      for (let k = 0; k < a.count && alive < cap; k++) {
        sincosInto((k / a.count) * TAU, sc, 0);
        let sx = x + sc[1] * a.radius, sy = y + sc[0] * a.radius;
        // Eels come only where there's water within `water` tiles (the Old Grey's call).
        if (a.water > 0 && !waterNear(T, Math.floor(sx / TILE), Math.floor(sy / TILE), a.water, o)) continue;
        if (a.water > 0) { sx = o[0]; sy = o[1]; }
        if (spawnEnemy(world, type, sx, sy, { minion: true }) >= 0) alive++;
      }
      break;
    }
    case 'stab_line': {
      // Along the warned line (from where it stands, its length, its width): you're hit if you're on it.
      const px = p.x - x, py = p.y - y;
      const along = Math.max(0, Math.min(a.length, px * b.adx + py * b.ady));
      const cx = px - b.adx * along, cy = py - b.ady * along, w = a.width * 0.5 + world.tuning.player.radius;
      if (cx * cx + cy * cy <= w * w) hurtPlayer(world, a.damage, x + b.adx * along, y + b.ady * along, HURT.BOSS, type, info);
      world.events.push(EV.EXPLODE, x + b.adx * a.length, y + b.ady * a.length, a.width, -1);
      break;
    }
    case 'leap': {
      E.flags[e] &= ~EF.AIR;
      E.x[e] = E.px[e] = b.ax; E.y[e] = E.py[e] = b.ay;
      const dx = p.x - b.ax, dy = p.y - b.ay, rr = a.radius + world.tuning.player.radius;
      if (dx * dx + dy * dy <= rr * rr) hurtPlayer(world, a.damage, b.ax, b.ay, HURT.BOSS, type, info);
      const T = world.terrain, tx = Math.floor(b.ax / TILE), ty = Math.floor(b.ay / TILE);
      const mud = T.kinds !== null && tx >= 0 && ty >= 0 && tx < T.cols && ty < T.rows && T.kinds[ty * T.cols + tx] === GROUND.MUD && T.wet[ty * T.cols + tx] === 0;
      if (mud) {
        const until = world.tick + Math.round(a.stuck * TPS);
        b.stuckUntil = until; b.weakFrom = world.tick; b.weakUntil = until; b.weakMul = a.weak;
      }
      world.events.push(EV.LEAP, b.ax, b.ay, 0, 0, mud ? 1 : 0, b.handle);
      world.events.push(EV.EXPLODE, b.ax, b.ay, a.radius, -1);
      break;
    }
    case 'lightning_march': {
      // She kneels once the last ring has landed: weak for `kneel` s, then on.
      const rest = Math.round((a.count - 1) * a.stagger * TPS), kneel = Math.round(a.kneel * TPS);
      b.weakFrom = world.tick + rest; b.weakUntil = world.tick + rest + kneel; b.weakMul = a.weak;
      b.state = RECOVER;
      b.timer = (rest + kneel) / TPS + world.tuning.bosses.recover;
      return;
    }
    case 'projectile_fan': {
      const spread = (a.spread * PI) / 180;
      const sc = world.scratch.sc;
      for (let k = 0; k < a.count; k++) {
        const off = a.count === 1 ? 0 : (k / (a.count - 1) - 0.5) * spread;
        sincosInto(off, sc, 0);
        const dx = b.adx * sc[1] - b.ady * sc[0], dy = b.adx * sc[0] + b.ady * sc[1];
        setSource(world, HURT.BOSS, e, info);
        spawnHostileShot(world, x, y, dx * a.speed, dy * a.speed, a.radius, a.damage, a.life ?? 5);
      }
      break;
    }
    case 'lure': {
      world.pull.ticks = 0;
      const dx = p.x - x, dy = p.y - y, rr = a.bite + world.tuning.player.radius;
      if (dx * dx + dy * dy <= rr * rr) hurtPlayer(world, a.damage, x, y, HURT.BOSS, type, info);
      world.events.push(EV.EXPLODE, x, y, a.bite, -1);
      break;
    }
    case 'hazard_pools':
    case 'tide_lanes':
      break; // already placed at the start
    default:
      break;
  }
  b.state = RECOVER;
  b.timer = world.tuning.bosses.recover;
}

/** Water (a swimmer's tile) within `r` tiles of (tx, ty): the nearest such tile's middle to out; false if none. */
function waterNear(T, tx, ty, r, out) {
  let best = -1, bx = 0, by = 0;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (!T.waterAt(tx + dx, ty + dy)) continue;
    const d = dx * dx + dy * dy;
    if (best >= 0 && d >= best) continue;
    best = d; bx = tx + dx; by = ty + dy;
  }
  if (best < 0) return false;
  out[0] = (bx + 0.5) * TILE; out[1] = (by + 0.5) * TILE;
  return true;
}

/** Is boss record `b` (world.bosses[k]) in a weak window now (the HUD, tests)? */
export function bossWeak(world, b) { return world.tick >= b.weakFrom && world.tick < b.weakUntil; }

/** A boss died: record it, drop the boss chest, and after the last boss offer overtime. */
export function bossDied(world, e) {
  const E = world.enemies;
  const b = world.bosses[E.boss[e]];
  if (!b || !b.alive) return;
  b.alive = false;
  world.director.bossesAlive--;
  if (world.pull.boss === b.handle) world.pull.ticks = 0; // a lure ends with its Maw, not another boss
  // Which weapons did the damage, most first.
  const used = [];
  for (let s = 0; s < HIT_SLOTS; s++) if (b.damageBySlot[s] > 0) used.push(s);
  used.sort((i, j) => b.damageBySlot[j] - b.damageBySlot[i] || i - j);
  const weapons = used.map((s) => (world.slots[s] && world.slots[s].def ? world.slots[s].def.id : 'relic'));
  world.result.bossesKilled.push({ id: b.id, tick: world.tick, weapons });
  runHooks(world, 'onBossKill', e, b.id);
  // Every boss drops an Ember (more with the Kindling relic).
  if (world.ascensionLines.size) for (let k = 0; k <= world.emberBossExtra; k++) spawnPickup(world, PK.EMBER, E.x[e] + k * 12, E.y[e] + 14, 0, 0);
  if (b.final) {
    // The last boss's chest opens on the spot, before the stay-or-leave choice, so leaving can
    // never skip it.
    openChest(world, CHEST_BOSS, E.x[e], E.y[e]);
    finalBossDown(world);
  } else {
    dropChest(world, E.x[e], E.y[e], CHEST_BOSS);
  }
}
