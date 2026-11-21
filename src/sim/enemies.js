// Enemies: spawning, AI, movement, crowds, knockback, status effects, contact damage, deaths
// (ARCHITECTURE §5.6, §5.13).
//
// Everything here runs over the enemy pool's typed arrays. AI types: chase (walk at you),
// swarm (a wall crossing the screen in a straight line), charger (warns, then dashes),
// hazard (drops warned pools), splitter (bursts into smaller enemies), ranged_slow (slow,
// readable shots), boss (bosses.js drives its attacks).

import { DT, TPS, EF, EF_GONE, AI, HIT_SLOTS, RELIC_SLOT, PK, SWIMS, LEECH, HOP, EEL } from './constants.js';
import { deedKill, deedHit } from './deeds.js';
import { EV, TELE, STATUS, HIT_CRIT, HURT, HITSTOP } from './events.js';
import { hurtPlayer, drainPlayer, sting, brine } from './player.js';
import { sightEnemy } from './sight.js';
import { shatterAt, openWellAt } from './holds.js';
import { runHooks } from './hooks.js';
import { spawnGem, rollDrops, spawnPickup } from './pickups.js';
import { formKill } from './forms.js';
import { bellKill } from './tasks.js';
import { maybeReliquary, glassFor } from './relics.js';
import { dropChest, CHEST_BOSS, CHEST_ELITE } from './chests.js';

import { bossStep, bossDied, bossAllow, BOSS_STATE } from './bosses.js';
import { spawnHazard, spawnHostileShot, setSource, tell, lineCrossesPlayer, ringHoldsPlayer } from './attacks.js';
import { assignAffixes, affixCount, affixDamage, affixTick, AFFIX } from './affixes.js';
import { championChest, championsStep } from './champions.js';
import { sincosInto, fatan2, TAU } from '../lib/fmath.js';
import { TILE, GROUND } from './terrain.js';

/** E.boss for a muster's captain (an elite, not a boss, but paid like one; never an index). */
export const MUSTER_CAPTAIN = -2;
/** E.boss for an elite that carries no chest: the second of a Tide's pair (sim/director.js). */
export const NO_CHEST = -3;

export const ENEMY_FIELDS = {
  x: Float32Array, y: Float32Array, px: Float32Array, py: Float32Array,
  vx: Float32Array, vy: Float32Array,       // knockback velocity (px/s), decays every tick
  dx: Float32Array, dy: Float32Array,       // locked direction (swarm, charge, aim)
  hp: Float32Array, maxHp: Float32Array,
  type: Uint16Array, flags: Uint16Array,     // EF (AIR needs the ninth bit)
  radius: Float32Array, speed: Float32Array, mass: Float32Array, contact: Float32Array, xp: Float32Array,
  ai: Uint8Array, aiState: Uint8Array, aiTimer: Float32Array,
  flash: Uint8Array,                        // ticks of hit flash left (render reads it)
  burnT: Float32Array, burnDps: Float32Array, burnAcc: Float32Array, burnSlot: Uint8Array,
  slowT: Float32Array, slowPct: Float32Array, freezeT: Float32Array, rotT: Float32Array, rotAmp: Float32Array,
  openT: Float32Array, openAmp: Float32Array, // exposed (C2: gaffed by the Harpooner, in the Dread Light, weighed down by pennies): s left, and the share more it takes from everything
  dazeT: Float32Array,                      // seconds left dazed (reeled in by the Harpooner): no walking, no contact damage
  bumpT: Float32Array, bumpDmg: Float32Array, bumpDaze: Float32Array, bumpSlot: Uint8Array, lostBump: Float32Array, // knocked into others (FX bump: s left, the damage, whose); Low Note: lost ones that bump are dazed this long
  lostT: Float32Array, lostX: Float32Array, lostY: Float32Array, // the Fog Horn's: s left lost in the fog (it walks away from you, or, with Wrecker's Horn, to lostX, lostY when lostX > 0)
  killer: Int8Array,                        // weapon slot of the killing blow (-1: not a weapon)
  killedByZone: Uint8Array,                 // 1 when that blow was a zone's pulse (ground, a ward), not the weapon's own hit
  anim: Float32Array,                       // render phase, fixed at spawn
  boss: Int8Array,                          // index into world.bosses; -1 none; MUSTER_CAPTAIN a muster's elite (pays a boss chest); NO_CHEST an elite without one
  nextHit: [Int32Array, HIT_SLOTS],         // tick each weapon slot may hit this enemy again
  waveHit: [Int32Array, HIT_SLOTS],         // per slot: the last wave that hit it (zone handle + 1)
  focusN: Uint8Array, focusT: Int32Array,   // Burning Glass: hits held in a beam, and the tick of the last one
  // The Salt Marsh (0.8.0, §5.17): the hold statuses and the new enemies' own state.
  crust: Uint8Array,                        // 1: a Salted Dead's crust (half damage until a Frost, Sea, or Steel hit cracks it)
  thawT: Float32Array,                      // s after a freeze ends that it can't be frozen again
  saltT: Float32Array, saltHold: Float32Array, // salt (the Brine Vat): s left; s held at the slow cap
  tarT: Float32Array, tarDmg: Float32Array, tarSlot: Uint8Array, // Tarred: s left, what it sets off for, whose
  feverT: Float32Array, feverDone: Uint8Array, // Marsh Fever: s left; 1 once it has spread
  pudTick: Int32Array, pudN: Uint8Array,    // brine puddles: the tick of the last pulse that reached it, and how many
  quenched: Uint8Array,                     // 1 once a Sea or Frost hit found it burning (counted once)
  held: Uint8Array,                         // at its death: 1 it was frozen, 2 slowed (shatters, Cold Iron)
  shardKill: Uint8Array,                    // 1 when the killing blow was a Salt Pan shard's (it doesn't shatter again)
  ax: Float32Array, ay: Float32Array,       // a hop's landing; an eel's lunge start (it slides back toward it)
  lunge: Float32Array,                      // an eel's lunge: px still to go (its warning line showed the whole reach)
  crew: Uint8Array,                         // 0.8.2: a Fog Bell's crew (its task index + 1): its kill counts for that bell wherever it falls
  // 0.9.0 (W3): elite affixes (sim/affixes.js).
  affix: Uint8Array,                        // the affix bits (data/enemies.js AFFIXES)
  ward: Uint8Array, wardT: Int32Array,      // Warded: hits left to break the ward, and the tick of the last
  link0: Int32Array, link1: Int32Array,     // Tethered: the linked enemies' handles + 1 (0 none)
  affixT: Float32Array,                     // Molten: seconds to the next patch of fire
};

export const KB_UNIT = 100; // knockback 1 = an impulse of 100 px/s against mass 1

/** Angles only ever go to render (in events); the sim never branches on them. */
function angleOf(y, x) { return x === 0 && y === 0 ? 0 : fatan2(y, x); }

/** A toad's landing, as what hurt you reads it (the death recap). */
const TOAD_LANDING = Object.freeze({ key: 'landing', name: 'landing' });

/**
 * Spawn one enemy. opts: { elite, swarmDir: [dx, dy], minion, hpMul, event (part of a set piece:
 * EF.EVENT), affixes (an elite's count; 0 none; left out, the run's: sim/affixes.js) }.
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
  // The pace dials (tuning.pace): an ordinary enemy is tougher and worth more; elites and bosses
  // keep their own rules (eliteHp and eliteXp; a boss's level and minFight).
  const pace = world.tuning.pace, plain = !elite && !isBoss;
  E.x[i] = x; E.y[i] = y; E.px[i] = x; E.py[i] = y;
  E.type[i] = type;
  // An elite's health also follows your power (sim/threat.js: 1 unless your damage outruns the clock).
  E.hp[i] = E.maxHp[i] = def.hp * (isBoss ? world.director.bossHpMul : hpMul) * (elite ? T.eliteHp * world.threat.mul : 1) * (plain ? pace.hp : 1);
  E.radius[i] = def.radius * (elite ? T.eliteSize : 1);
  E.speed[i] = def.speed * world.enemySpeedMul * (elite ? world.tideRules.eliteSpeed : 1); // a Tide or Fast Water makes them quicker
  E.mass[i] = def.mass * (elite ? T.eliteMass : 1);
  E.contact[i] = def.contact * world.director.contactMul * (elite ? T.eliteContact : 1);
  E.xp[i] = def.xp * (elite ? T.eliteXp : 1) * (plain ? pace.xp : 1);
  E.ai[i] = AI[def.ai.type];
  E.killer[i] = -1; E.killedByZone[i] = 0;
  E.boss[i] = -1;
  E.anim[i] = world.rng.spawn.next();
  let f = 0;
  if (elite) f |= EF.ELITE;
  if (isBoss) f |= EF.BOSS;
  if (opts !== null && opts.minion) f |= EF.MINION;
  if (opts !== null && opts.event === true) f |= EF.EVENT;
  if (opts !== null && opts.swarmDir) { f |= EF.SWARM; E.dx[i] = opts.swarmDir[0]; E.dy[i] = opts.swarmDir[1]; }
  else if (E.ai[i] === AI.swarm) {
    // A swarmer from anywhere but a wall or ring (a roster, a split, a summon) flies straight
    // at where you are now, and on past.
    const p = world.player, dx = p.x - x, dy = p.y - y, d = Math.sqrt(dx * dx + dy * dy);
    f |= EF.SWARM;
    E.dx[i] = d > 1e-6 ? dx / d : 1; E.dy[i] = d > 1e-6 ? dy / d : 0;
  }
  E.flags[i] = f;
  if (def.crust) E.crust[i] = 1;
  if (world.seen[type] === 0) sightEnemy(world, type, x, y);
  // Hazard and ranged enemies start partway through their timer so a group doesn't act in unison.
  if (E.ai[i] === AI.hazard || E.ai[i] === AI.ranged_slow || E.ai[i] === AI.hopper || E.ai[i] === AI.eel) E.aiTimer[i] = def.ai.every * (0.3 + 0.7 * world.rng.spawn.next());
  if (elite) {
    world.events.push(EV.ELITE_SPAWN, x, y, type, E.handle(i));
    const n = opts.affixes ?? affixCount(world);
    if (n > 0) assignAffixes(world, i, n, spawnEnemy);
  }
  return i;
}

/** A tethered elite's share landing on one of its links (sim/affixes.js), as a hit of its own. */
function hitLink(world, l, amount, slot) {
  world.scratch.num[0] = amount;
  damageEnemyR(world, l, slot, false);
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
  if ((E.flags[e] & EF.AIR) !== 0 || E.saltT[e] > 0 || E.aiState[e] === LEECH.LATCHED && world.enemyLatch[E.type[e]] === 1) return;
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

/**
 * damageEnemy() with the amount in num[0] (hot paths). Returns the damage dealt. A boss loses at
 * most its fight-length budget so far (its health times the seconds since it arrived over its
 * minFight, data/bosses.js): what goes past it is eaten, and the HIT says so (HIT_CAPPED).
 */
export function damageEnemyR(world, e, slot, crit) {
  let amount = world.scratch.num[0];
  const E = world.enemies;
  if ((E.flags[e] & EF_GONE) !== 0 || !(amount > 0)) return 0;   // dead, or in the air (untouchable)
  if (E.rotT[e] > 0) amount *= 1 + E.rotAmp[e];
  if (E.openT[e] > 0) amount *= 1 + E.openAmp[e];
  if (E.feverT[e] > 0) amount *= 1 + world.tuning.status.feverTaken;
  // Rules of the build: Hoarfrost's last level (frozen enemies take more), Pitch (burning enemies take more).
  const R = world.rules;
  if (R.hoarfrost && E.freezeT[e] > 0) amount *= 1.25;
  if (R.pitch && E.burnT[e] > 0) amount *= R.pitch === true ? 1.25 : R.pitch;
  if (E.crust[e] === 1) {
    // A Salted Dead's crust: half damage, until a Frost, Sea, or Steel weapon's hit cracks it.
    if (slot < HIT_SLOTS && world.slots[slot] !== null && world.slots[slot].cracks === true) E.crust[e] = 0;
    else amount *= world.tuning.status.crust;
  }
  if (world.bestiaryMul !== null && slot < HIT_SLOTS) amount *= world.bestiaryMul[E.type[e]]; // the Cartographer's bestiary bonus
  // An elite's affixes (a ward, a tether's shares: sim/affixes.js).
  if (E.affix[e] !== 0) { amount = affixDamage(world, e, amount, slot, hitLink); if (!(amount > 0)) amount = 0; }
  let bits = crit ? HIT_CRIT : 0;
  const bi = E.boss[e];
  // A boss's phase gates, weak windows, and its 15 s floor (sim/bosses.js bossAllow; ruling 5).
  if (bi >= 0) { amount = bossAllow(world, world.bosses[bi], e, amount); bits |= world.bosses[bi].hitBits; }
  // What counts as your damage for the threat (sim/threat.js): a weapon's hit (the signature's and
  // their Forms' included; never slot 9: wards, Lantern Night, thralls, cranes, cairns, the storm,
  // a relic's blast), and only the health it took (overkill past what the enemy had left is nothing).
  const real = amount < E.hp[e] ? amount : E.hp[e] > 0 ? E.hp[e] : 0;   // the health it took (no overkill)
  if (slot < RELIC_SLOT) world.threat.dealt += real;
  if (slot < HIT_SLOTS) world.result.realBySlot[slot] += real;
  E.hp[e] -= amount;
  E.flash[e] = world.tuning.enemies.flashTicks;
  if (slot < HIT_SLOTS) world.result.damageBySlot[slot] += amount;
  if (slot < RELIC_SLOT) { const sl = world.slots[slot]; if (sl !== null && sl.deedHits === true) deedHit(world, sl); }
  if (bi >= 0 && slot < HIT_SLOTS) world.bosses[bi].damageBySlot[slot] += amount;
  const ev = world.events;
  const k = ev.reserve(EV.HIT);
  if (k >= 0) { ev.x[k] = E.x[e]; ev.y[k] = E.y[e]; ev.a[k] = amount; ev.b[k] = E.handle(e); ev.c[k] = bits | world.hitQuiet; ev.d[k] = slot; }
  if (E.hp[e] <= 0) {
    E.flags[e] |= EF.DEAD;
    E.held[e] = (E.freezeT[e] > 0 ? 1 : 0) | (E.slowT[e] > 0 ? 2 : 0); // before this hit's own statuses land
    E.killer[e] = slot < HIT_SLOTS ? slot : -1;
    E.killedByZone[e] = world.zonePulse;
    E.shardKill[e] = world.shardHit;
  }
  return amount;
}

const STATUS_CODE = { burn: STATUS.BURN, slow: STATUS.SLOW, freeze: STATUS.FREEZE, rot: STATUS.ROT, lost: STATUS.LOST };

/** Apply a status effect from an on-hit effect ({ status, dps, duration, pct, amp }). */
export function applyStatus(world, e, fx, slot) {
  const E = world.enemies;
  if ((E.flags[e] & EF_GONE) !== 0) return;
  // A weapon's statuses last as much longer as its Duration is above its own (Hoarfrost, Grave Moss).
  const sl = slot < HIT_SLOTS ? world.slots[slot] : null;
  const d = fx.duration * (sl !== null && sl !== undefined && sl.statusMul !== undefined ? sl.statusMul : 1);
  switch (fx.status) {
    case 'burn':
      if (d > E.burnT[e]) E.burnT[e] = d;
      if (fx.dps > E.burnDps[e]) { E.burnDps[e] = fx.dps; E.burnSlot[e] = slot; }
      break;
    case 'slow': {
      const pct = fx.pct ?? 0.3;
      if (d > E.slowT[e]) E.slowT[e] = d;
      // The Brine Vat: slows add together, up to its cap (held there, an enemy turns to salt).
      if (world.slowStack > 0) { const v = E.slowPct[e] + pct; E.slowPct[e] = v > world.slowStack ? world.slowStack : v; }
      else if (pct > E.slowPct[e]) E.slowPct[e] = pct;
      break;
    }
    case 'freeze': {
      if (midAttack(E, e, world.bosses)) break; // holding it would stop its attack's clock (see midAttack)
      if (E.thawT[e] > 0) break;              // just thawed: not again for a moment (tuning.status.thaw)
      const t = (E.flags[e] & EF.BOSS) !== 0 ? d * world.tuning.enemies.freezeBossFactor : d;
      if (t > E.freezeT[e]) E.freezeT[e] = t;
      break;
    }
    case 'lost': {
      // The Fog Horn: lost in the fog, it walks away from you (never a boss, nor one mid-attack).
      if ((E.flags[e] & EF.BOSS) !== 0 || midAttack(E, e, world.bosses)) break;
      if (d > E.lostT[e]) E.lostT[e] = d;
      E.lostX[e] = 0;
      if ((fx.bump ?? 0) > E.lostBump[e]) E.lostBump[e] = fx.bump;   // (Low Note: the lost bump into each other, dazed)
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
  const flow = world.flow, bigFlow = world.bigFlow, swimFlow = world.swimFlow, terrain = world.terrain, hash = world.enemyHash;
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
  const S = world.tuning.status;
  // The Marsh: mud slows enemies (never you); swimmers go by their own grids.
  const kinds = terrain.kinds, wet = terrain.wet, cols = terrain.cols, rows = terrain.rows;
  const mudMul = world.marsh !== null ? world.marsh.W.mudSlow : 1, MUD = GROUND.MUD;
  const swims = world.enemySwims, latches = world.enemyLatch;
  const eelGone2 = T.eelSinkDistance * T.eelSinkDistance;
  // The pace dial: how fast every enemy walks and charges (a boss's warned attacks keep their own).
  const paceDial = world.tuning.pace.speed, quick = world.enemyQuick, pounces = world.enemyPounce;
  let regular = 0, eventAlive = 0;

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
    if (E.openT[i] > 0) { E.openT[i] -= DT; if (E.openT[i] <= 0) { E.openT[i] = 0; E.openAmp[i] = 0; } }
    if (E.feverT[i] > 0) { E.feverT[i] -= DT; if (E.feverT[i] <= 0) { E.feverT[i] = 0; E.feverDone[i] = 0; } }
    if (E.tarT[i] > 0) {
      E.tarT[i] -= DT;
      // Tar left alone burns off at its end, for half (Tarred: sim/holds.js).
      if (E.tarT[i] <= 0) { E.tarT[i] = 0; tarBurst(world, i, S.tarEndShare); if ((E.flags[i] & EF.DEAD) !== 0) continue; }
    }
    if (E.thawT[i] > 0) { E.thawT[i] -= DT; if (E.thawT[i] < 0) E.thawT[i] = 0; }
    let speedMul = 1;
    if (E.slowT[i] > 0) {
      E.slowT[i] -= DT; speedMul = 1 - E.slowPct[i];
      // The Brine Vat: held at its cap long enough, an enemy turns to salt. Never a boss, a muster's
      // captain (a champion: the crumble takes all the health there is, and W3 gave champions
      // theirs to make a fight; X4), one in the air (a toad's hop lands on its own clock), or one
      // in a warned attack (its warning would run out while it stood held).
      if (world.slowStack > 0 && E.slowPct[i] >= world.slowStack - 1e-6 && E.saltT[i] <= 0 && (f & (EF.BOSS | EF.AIR)) === 0 && E.boss[i] !== MUSTER_CAPTAIN && !midAttack(E, i, world.bosses)) {
        E.saltHold[i] += DT;
        if (E.saltHold[i] >= world.saltAfter) { E.saltHold[i] = 0; E.saltT[i] = world.saltSec; statusEvent(world, i, STATUS.SALT); }
      } else E.saltHold[i] = 0;
      if (E.slowT[i] <= 0) { E.slowT[i] = 0; E.slowPct[i] = 0; E.saltHold[i] = 0; }
    }
    // Frozen or dazed: it doesn't walk or act (knockback still moves it). A freeze that ends
    // leaves a thaw: it can't be frozen again for a moment.
    let frozen = E.freezeT[i] > 0;
    if (frozen) {
      E.freezeT[i] -= DT; speedMul = 0;
      if (E.freezeT[i] <= 0) { E.freezeT[i] = 0; E.thawT[i] = S.thaw; statusEvent(world, i, STATUS.THAW); }
    }
    if (E.dazeT[i] > 0) { E.dazeT[i] -= DT; speedMul = 0; frozen = true; if (E.dazeT[i] < 0) E.dazeT[i] = 0; }
    // Salt: it can't move or hurt you, the crowd piles up behind it; then it crumbles. The crumble
    // is a kill, crust or not: the crust goes with it, so the blow lands whole.
    if (E.saltT[i] > 0) {
      E.saltT[i] -= DT; speedMul = 0; frozen = true;
      if (E.saltT[i] <= 0) { E.saltT[i] = 0; E.crust[i] = 0; world.scratch.num[0] = E.hp[i] + 1; damageEnemyR(world, i, RELIC_SLOT, false); continue; }
    }
    if ((f & (EF.SWARM | EF.BOSS | EF.MINION)) === 0) { if ((f & EF.EVENT) !== 0) eventAlive++; else regular++; }
    else if ((f & EF.EVENT) !== 0) eventAlive++;
    // The fast kind of each map keeps its speed under the pace dial (data: quick).
    const paceSpeed = quick[E.type[i]] === 1 ? 1 : paceDial;
    if (E.affix[i] !== 0 && !frozen) affixTick(world, i);

    const ai = E.ai[i];
    const sw = swims[E.type[i]];
    // A leech latched on rides with you and drains you; a freeze or a daze throws it off.
    if (latches[E.type[i]] === 1 && E.aiState[i] === LEECH.LATCHED) {
      if (frozen) { unlatch(world, i); continue; }
      E.x[i] = p.x + E.dx[i]; E.y[i] = p.y + E.dy[i]; E.vx[i] = 0; E.vy[i] = 0;
      E.aiTimer[i] -= DT;
      if (E.aiTimer[i] <= 0) { E.aiTimer[i] += world.enemyDefs[E.type[i]].latch.every; drainPlayer(world, world.enemyDefs[E.type[i]].latch.drain, E.type[i]); }
      continue;
    }
    // A toad in the air always lands on its own clock, where its ring warned (nothing holds it up there).
    if (ai === AI.hopper && (!frozen || E.aiState[i] === HOP.AIR)) { if (hopStep(world, i)) continue; }
    else if (ai === AI.eel) {
      const ex = p.x - E.x[i], ey = p.y - E.y[i];
      // An eel far from you sinks back into the mud (no kill).
      if (ex * ex + ey * ey > eelGone2) { E.flags[i] = f | EF.DEAD | EF.VANISH | EF.RESOLVED; continue; }
      eelStep(world, i, frozen, paceSpeed);
      continue;
    }

    const x = E.x[i], y = E.y[i];
    const tx = p.x - x, ty = p.y - y;
    const d2 = tx * tx + ty * ty;
    const dist = Math.sqrt(d2);
    let mvx = 0, mvy = 0;
    let sp = E.speed[i] * speedMul * paceSpeed;
    // Mud slows every enemy on it (low water: a creek bed; a swimmer in the water isn't on mud).
    if (kinds !== null && mudMul < 1) {
      const kx = Math.floor(x / TILE), ky = Math.floor(y / TILE);
      if (kx >= 0 && ky >= 0 && kx < cols && ky < rows) { const ki = ky * cols + kx; if (kinds[ki] === MUD && wet[ki] === 0) sp *= mudMul; }
    }

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
      bossStep(world, i, dist, tx, ty, speedMul * paceSpeed, dir);
      mvx = dir[0]; mvy = dir[1]; sp = dir[2];
      walks = world.bosses[E.boss[i]].state === BOSS_STATE.WALK;
      if ((E.flags[i] & EF.AIR) !== 0) { E.x[i] = x + mvx * sp * DT; E.y[i] = y + mvy * sp * DT; E.vx[i] = 0; E.vy[i] = 0; continue; } // a leap: over everything
    } else if (!frozen) {
      // (A boss-type enemy that wasn't spawned by a boss event has no attack pattern: it
      // chases like anything else. The content test keeps bosses out of rosters and summons.)
      if (ai === AI.charger) {
        chargerStep(world, i, dir);
        mvx = dir[0]; mvy = dir[1]; sp *= dir[2];
        walks = E.aiState[i] === CHARGER.APPROACH || E.aiState[i] === CHARGER.RECOVER;
      } else {
        // chase, splitter, the slow walkers, and a toad between hops: toward you, around walls when needed.
        if (dist > 0.0001) { mvx = tx / dist; mvy = ty / dist; }
        walks = true;
        const pd = pounces[E.type[i]];
        if (pd !== null && E.aiState[i] !== POUNCE.DONE && (E.aiState[i] !== POUNCE.WALK || dist < pd.range)) {
          // A rat's pounce (once): it crouches, warning along a short line, then leaps along it at full
          // speed. (Called only when it has something to do; the distance goes in reg[3], §17.)
          reg[3] = dist;
          const ps = pounceStep(world, i, pd);
          if (ps === 1) { mvx = 0; mvy = 0; walks = false; }
          else if (ps === 2) { mvx = E.dx[i]; mvy = E.dy[i]; sp = pd.speed * speedMul; walks = false; }
        }
        if (ai === AI.hazard) hazardStep(world, i);
        else if (ai === AI.ranged_slow) {
          const r = world.enemyDefs[E.type[i]].ai.range;
          // (An elite stands its ground: one that backed away for ever was a chase, not a fight.)
          if (dist < r * T.rangedBackOff && (f & EF.ELITE) === 0) { mvx = -mvx; mvy = -mvy; walks = false; } // too close: back off
          else if (dist < r) sp *= T.rangedDrift;                                    // in range: drift
          rangedStep(world, i);
        } else if (ai === AI.hopper) sp *= world.enemyDefs[E.type[i]].ai.creep;     // a toad creeps between hops
      }
    }
    const field = sw === SWIMS.amphibious ? swimFlow : E.radius[i] > bigBody ? bigFlow : flow;
    if (walks && field.active) {
      reg[0] = x; reg[1] = y;
      // Take the field's way where it disagrees with the straight line by more than 45 degrees,
      // and wherever the straight step runs into a wall (otherwise a corner can hold an enemy
      // between the two rules). The probe reaches past the body, so big enemies see walls too.
      if (field.dirR(reg, v2)) {
        const ahead = E.radius[i] + 8;
        const px2 = Math.floor((x + mvx * ahead) / TILE), py2 = Math.floor((y + mvy * ahead) / TILE);
        const blockedAhead = sw === SWIMS.amphibious ? (px2 < 0 || py2 < 0 || px2 >= cols || py2 >= rows || terrain.swimWall[py2 * cols + px2] === 1) : terrain.blocked(px2, py2);
        if (v2[0] * mvx + v2[1] * mvy < 0.7071 || blockedAhead) { mvx = v2[0]; mvy = v2[1]; }
      }
    }
    // Lost in the fog (the Fog Horn): it walks away from you at 60% of its pace, or (Wrecker's Horn)
    // toward the point the note carried it to.
    if (E.bumpT[i] > 0) { E.bumpT[i] -= DT; if (E.bumpT[i] <= 0) { E.bumpT[i] = 0; E.bumpDmg[i] = 0; E.bumpDaze[i] = 0; } }
    if (E.lostT[i] > 0) {
      E.lostT[i] -= DT;
      if (E.lostT[i] <= 0) E.lostT[i] = 0;
      else if (!frozen && ai !== AI.boss && ai !== AI.swarm) {
        if (E.lostX[i] > 0) { const gx = E.lostX[i] - x, gy = E.lostY[i] - y, g = Math.sqrt(gx * gx + gy * gy); if (g > 4) { mvx = gx / g; mvy = gy / g; } else { mvx = 0; mvy = 0; } }
        else { mvx = -mvx; mvy = -mvy; }
        sp *= 0.6;
      }
    }

    // An enemy showing a warning stays exactly where the warning was drawn (no crowd pushes, no
    // knockback), so the attack comes from where the player saw it coming.
    const anchored = (ai === AI.charger && E.aiState[i] === CHARGER.WINDUP) || (ai === AI.ranged_slow && E.aiState[i] === RANGED.WARN) ||
      (ai === AI.boss && E.boss[i] >= 0 && world.bosses[E.boss[i]].state === BOSS_STATE.WARN) || E.saltT[i] > 0 || (E.flags[i] & EF.WARNING) !== 0;
    if (anchored) {
      E.vx[i] = 0; E.vy[i] = 0;
      if ((f & (EF.SWARM | EF.BOSS)) === 0 && d2 > tp2 && E.saltT[i] <= 0) teleportAhead(world, i);
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
      // Marsh Fever: what this enemy carries spreads to one it bumps into (once each).
      const fever = E.feverT[i] > 0 && E.feverDone[i] === 0;
      // Every overlapping neighbor counts (a capped subset would be the ones the grid scan meets
      // first, which would push whole crowds one way). The buffer holds 16: more overlap than
      // that only happens in a crush, and it still pushes outward.
      reg[0] = nx; reg[1] = ny; reg[2] = ri * sepRange;
      const m = hash.queryR(reg, sep, i);
      let px2 = 0, py2 = 0;
      for (let k = 0; k < m; k++) {
        const j = sep[k];
        if ((E.flags[j] & EF_GONE) !== 0) continue;
        const ddx = nx - E.x[j], ddy = ny - E.y[j];
        const want = (ri + E.radius[j]) * sepRange;
        const dd2 = ddx * ddx + ddy * ddy;
        if (dd2 >= want * want) continue;
        if (fever && E.feverT[j] <= 0) { spreadFever(world, i, j); E.feverDone[i] = 1; }
        // Knocked into another (FX bump): it hurts the first one it meets, once.
        if (E.bumpT[i] > 0 && (E.bumpDmg[i] > 0 || E.bumpDaze[i] > 0) && (E.flags[j] & EF.DEAD) === 0) {
          if (E.bumpDaze[i] > 0 && (E.flags[j] & EF.BOSS) === 0 && E.dazeT[j] < E.bumpDaze[i]) E.dazeT[j] = E.bumpDaze[i];
          if (E.bumpDmg[i] > 0) { world.scratch.num[0] = E.bumpDmg[i]; damageEnemyR(world, j, E.bumpSlot[i], false); }
          E.bumpDmg[i] = 0; E.bumpDaze[i] = 0;
        }
        // Low Note: two lost ones that walk into each other are both dazed (once each a note).
        if (E.lostBump[i] > 0 && E.lostT[i] > 0 && E.lostT[j] > 0 && (f & EF.BOSS) === 0 && (E.flags[j] & EF.BOSS) === 0) { const t = E.lostBump[i]; E.lostBump[i] = 0; if (E.dazeT[i] < t) E.dazeT[i] = t; if (E.dazeT[j] < t) E.dazeT[j] = t; }
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

    // Walls and the map edge (swarms fly over walls, and vanish once they leave the map). A
    // leech swims: water is open to it, stumps and pillars aren't.
    if ((f & EF.SWARM) === 0) {
      reg[0] = nx; reg[1] = ny; reg[2] = E.radius[i];
      if (sw === SWIMS.amphibious) terrain.collideGridR(reg, terrain.swimWall);
      else terrain.collideR(reg);
      nx = reg[0]; ny = reg[1];
    }
    E.x[i] = nx; E.y[i] = ny;

    // Teleport-ahead: a straggler far behind jumps to the spawn ring ahead of you.
    if ((f & (EF.SWARM | EF.BOSS)) === 0 && d2 > tp2) teleportAhead(world, i);
  }
  world.director.regularAlive = regular;
  world.director.eventAlive = eventAlive;
  championsStep(world);   // the champions' attacks (sim/champions.js)
}

/** A pouncer's states (E.aiState; data ai.pounce): walking, crouched (warning), leaping, done (it pounces once). */
export const POUNCE = Object.freeze({ WALK: 0, CROUCH: 1, LEAP: 2, DONE: 3 });

/**
 * A rat's pounce (ai.pounce: { range, warn, speed, dist, lead, bite }): within range it crouches, warning
 * along a line toward where you'll be (you keep going for `lead` of the warning; at least
 * telegraphMin; the line as long as the leap, at most `dist`, kept in E.lunge), then leaps along it
 * at `speed` (the pace dial doesn't slow it), once, biting you if it comes within `bite` px of
 * touching. Returns 1 crouched, 2 leaping, 0 walking.
 */
function pounceStep(world, i, pd) {
  const E = world.enemies, st = E.aiState[i], p = world.player, dist = world.scratch.reg[3];
  if (st === POUNCE.WALK) {
    if (dist >= pd.range || dist < 1e-3) return 0;
    const warn = Math.max(pd.warn, world.tuning.enemies.telegraphMin);
    // It leaps for where you'll be if you keep going (`lead` of the way), as far as that, at most `dist`.
    const tx = p.x + p.vx * warn * pd.lead - E.x[i], ty = p.y + p.vy * warn * pd.lead - E.y[i];
    const td = Math.sqrt(tx * tx + ty * ty);
    if (td < 1e-3) return 0;
    let reach = td + 8;
    if (reach > pd.dist) reach = pd.dist;
    E.aiState[i] = POUNCE.CROUCH; E.aiTimer[i] = warn;
    E.dx[i] = tx / td; E.dy[i] = ty / td; E.lunge[i] = reach;
    E.flags[i] |= EF.WARNING;
    tell(world, E.x[i], E.y[i], TELE.LINE, Math.round(warn * TPS), reach, angleOf(E.dy[i], E.dx[i]), i, false, lineCrossesPlayer(world, E.x[i], E.y[i], E.dx[i], E.dy[i], reach, 2 * E.radius[i]));
    return 1;
  }
  E.aiTimer[i] -= DT;
  if (st === POUNCE.CROUCH) {
    if (E.aiTimer[i] > 0) return 1;
    E.aiState[i] = POUNCE.LEAP; E.aiTimer[i] = E.lunge[i] / pd.speed;
    E.flags[i] = (E.flags[i] & ~EF.WARNING) | EF.LUNGING;
    return 2;
  }
  // The leap bites what it reaches (`bite` px past touching), once, and ends there.
  const bx = p.x - E.x[i], by = p.y - E.y[i], br = E.radius[i] + world.tuning.player.radius + pd.bite;
  if (bx * bx + by * by <= br * br) {
    hurtPlayer(world, E.contact[i] * world.tuning.pace.contact * world.threat.mul, E.x[i], E.y[i], HURT.CONTACT, E.type[i], null);
    E.aiTimer[i] = 0;
  }
  if (E.aiTimer[i] > 0) return 2;
  E.aiState[i] = POUNCE.DONE; E.flags[i] &= ~EF.LUNGING;
  return 0;
}

function statusEvent(world, e, code) {
  const ev = world.events, k = ev.reserve(EV.STATUS);
  if (k >= 0) { ev.x[k] = world.enemies.x[e]; ev.y[k] = world.enemies.y[e]; ev.a[k] = code; ev.b[k] = world.enemies.handle(e); }
}

/**
 * Marsh Fever spreads from enemy a to enemy b at half the time left: the fever itself, and the
 * burn, rot, or slow a carries. (Once each: a's feverDone is set by the caller.)
 */
function spreadFever(world, a, b) {
  const E = world.enemies;
  if ((E.flags[b] & EF.BOSS) !== 0) return;
  E.feverT[b] = E.feverT[a] * 0.5; E.feverDone[b] = 0;
  if (E.burnT[a] > 0 && E.burnT[a] * 0.5 > E.burnT[b]) { E.burnT[b] = E.burnT[a] * 0.5; if (E.burnDps[a] > E.burnDps[b]) { E.burnDps[b] = E.burnDps[a]; E.burnSlot[b] = E.burnSlot[a]; } }
  if (E.rotT[a] > 0 && E.rotT[a] * 0.5 > E.rotT[b]) { E.rotT[b] = E.rotT[a] * 0.5; if (E.rotAmp[a] > E.rotAmp[b]) E.rotAmp[b] = E.rotAmp[a]; }
  if (E.slowT[a] > 0 && E.slowT[a] * 0.5 > E.slowT[b]) { E.slowT[b] = E.slowT[a] * 0.5; if (E.slowPct[a] > E.slowPct[b]) E.slowPct[b] = E.slowPct[a]; }
  statusEvent(world, b, STATUS.FEVER);
}

/** Tar goes off on enemy e: a blast of its own radius for `share` of what it holds, by the weapon that put it there. */
export function tarBurst(world, e, share) {
  const E = world.enemies, S = world.tuning.status;
  const dmg = E.tarDmg[e] * share, slot = E.tarSlot[e];
  E.tarT[e] = 0;
  const xr = world.scratch.xreg;
  xr[0] = E.x[e]; xr[1] = E.y[e]; xr[2] = S.tarRadius; xr[3] = dmg; xr[4] = 0;
  const x = xr[0], y = xr[1];
  explodeRef(world, slot, -1);
  world.events.push(EV.TAR, x, y, S.tarRadius, share >= 1 ? 1 : 0);
}
/** sim/weapons.js explodeR (set by world.js: weapons imports this file). */
let explodeRef = null;
export function setExplode(fn) { explodeRef = fn; }

/**
 * A toad's hop (AI.hopper): it sits, creeping a little; when you're in reach its shadow ring shows
 * where it will land (warned at least telegraphMin), it leaps (untouchable in the air) and lands in
 * the ring, hurting you if you're in it. Returns true when it moved itself this tick (in the air).
 */
function hopStep(world, i) {
  const E = world.enemies, def = world.enemyDefs[E.type[i]].ai, p = world.player;
  if (E.aiState[i] === HOP.AIR) {
    E.aiTimer[i] -= DT;
    const total = Math.max(def.warn, world.tuning.enemies.telegraphMin);
    const u = 1 - (E.aiTimer[i] > 0 ? E.aiTimer[i] : 0) / total;
    E.x[i] = E.dx[i] + (E.ax[i] - E.dx[i]) * u; E.y[i] = E.dy[i] + (E.ay[i] - E.dy[i]) * u;
    E.vx[i] = 0; E.vy[i] = 0;
    if (E.aiTimer[i] <= 0) {
      E.flags[i] &= ~EF.AIR;
      E.aiState[i] = HOP.SIT; E.aiTimer[i] = def.every;
      const dx = p.x - E.x[i], dy = p.y - E.y[i], rr = def.radius + world.tuning.player.radius;
      if (dx * dx + dy * dy <= rr * rr) hurtPlayer(world, def.damage * world.director.contactMul * world.tuning.pace.contact, E.x[i], E.y[i], HURT.ATTACK, E.type[i], TOAD_LANDING);
      world.events.push(EV.LEAP, E.x[i], E.y[i], 0, 0, 0, E.handle(i));
    }
    return true;
  }
  E.aiTimer[i] -= DT;
  if (E.aiTimer[i] > 0) return false;
  const dx = p.x - E.x[i], dy = p.y - E.y[i], d = Math.sqrt(dx * dx + dy * dy);
  if (d > def.range) { E.aiTimer[i] = 0.25; return false; }
  // Where it lands: where you are, at most `hop` px away, on ground it can stand on.
  const reach = d < def.hop ? d : def.hop, k = d > 1e-6 ? reach / d : 0;
  let lx = E.x[i] + dx * k, ly = E.y[i] + dy * k;
  if (world.terrain.blockedAt(lx, ly)) {
    const o = world.scratch.open;
    if (!world.terrain.nearestOpen(Math.floor(lx / TILE), Math.floor(ly / TILE), o, 6)) { E.aiTimer[i] = 0.5; return false; }
    lx = o[0]; ly = o[1];
  }
  const warn = Math.max(def.warn, world.tuning.enemies.telegraphMin);
  E.aiState[i] = HOP.AIR; E.aiTimer[i] = warn;
  E.dx[i] = E.x[i]; E.dy[i] = E.y[i]; E.ax[i] = lx; E.ay[i] = ly;
  E.flags[i] |= EF.AIR;
  tell(world, lx, ly, TELE.RING, Math.round(warn * TPS), def.radius, 0, i, false, ringHoldsPlayer(world, lx, ly, def.radius));
  world.events.push(EV.LEAP, lx, ly, 1, warn, 0, E.handle(i));
  return true;
}

/**
 * A creek eel (AI.eel): it stays in the water, drifting your way; when you pass within reach it
 * warns along a line, lunges along it, carries up to `bank` px past the water's edge (its leading
 * edge; never through a stump or a pillar, and never past you: reaching you ends it), and slides
 * back into the water; then it waits again.
 * The warning line is exactly as long as the lunge will go. It sinks into the mud when the creek
 * drains under it (sim/marsh.js) or you're far away.
 */
function eelStep(world, i, frozen, paceSpeed) {
  const E = world.enemies, def = world.enemyDefs[E.type[i]].ai, p = world.player, terrain = world.terrain;
  const lungeSpeed = def.lungeSpeed * paceSpeed;
  const reg = world.scratch.reg;
  const st = E.aiState[i];
  E.vx[i] = 0; E.vy[i] = 0;
  if (st === EEL.LUNGE) {
    const step = lungeSpeed * DT < E.lunge[i] ? lungeSpeed * DT : E.lunge[i];
    E.lunge[i] -= step;
    E.x[i] += E.dx[i] * step; E.y[i] += E.dy[i] * step;
    // It ends at the end of its line, or where it reaches you (the bite: contactStep), never past you.
    const px = p.x - E.x[i], py = p.y - E.y[i], rr = E.radius[i] + world.tuning.player.radius;
    if (E.lunge[i] <= 1e-3 || px * px + py * py <= rr * rr) { E.lunge[i] = 0; E.aiState[i] = EEL.BACK; E.aiTimer[i] = def.recover; }
    return;
  }
  if (st === EEL.BACK && !terrain.waterAt(Math.floor(E.x[i] / TILE), Math.floor(E.y[i] / TILE))) {
    // On the bank after a lunge: it slides back the way it came, into the water.
    const bx = E.ax[i] - E.x[i], by = E.ay[i] - E.y[i], bd = Math.sqrt(bx * bx + by * by);
    const step = lungeSpeed * 0.5 * DT;
    if (bd <= step) {
      E.x[i] = E.ax[i]; E.y[i] = E.ay[i];
      // Its creek drained while it was out: it sinks into the mud (no kill).
      if (!terrain.waterAt(Math.floor(E.x[i] / TILE), Math.floor(E.y[i] / TILE))) E.flags[i] |= EF.DEAD | EF.VANISH | EF.RESOLVED;
    } else { E.x[i] += (bx / bd) * step; E.y[i] += (by / bd) * step; }
    return;
  }
  if (frozen) return;
  if (st === EEL.WARN) {
    E.aiTimer[i] -= DT;
    if (E.aiTimer[i] <= 0) { E.aiState[i] = EEL.LUNGE; E.aiTimer[i] = 0; }
    return;
  }
  E.aiTimer[i] -= DT;
  const dx = p.x - E.x[i], dy = p.y - E.y[i], d = Math.sqrt(dx * dx + dy * dy) || 1;
  if (st === EEL.BACK) { if (E.aiTimer[i] <= 0) { E.aiState[i] = EEL.WAIT; E.aiTimer[i] = def.every; } return; }
  if (E.aiTimer[i] <= 0 && d < def.range) {
    const warn = Math.max(def.warn, world.tuning.enemies.telegraphMin);
    E.aiState[i] = EEL.WARN; E.aiTimer[i] = warn;
    E.dx[i] = dx / d; E.dy[i] = dy / d;
    E.ax[i] = E.x[i]; E.ay[i] = E.y[i];
    E.lunge[i] = lungeReach(world, i, def);
    tell(world, E.x[i], E.y[i], TELE.LINE, Math.round(warn * TPS), E.lunge[i], angleOf(E.dy[i], E.dx[i]), i, false, lineCrossesPlayer(world, E.x[i], E.y[i], E.dx[i], E.dy[i], E.lunge[i], 2 * E.radius[i]));
    return;
  }
  // Drift your way, in the water only.
  reg[0] = E.x[i] + (dx / d) * E.speed[i] * paceSpeed * DT; reg[1] = E.y[i] + (dy / d) * E.speed[i] * paceSpeed * DT; reg[2] = E.radius[i];
  terrain.collideGridR(reg, terrain.dryWall);
  E.x[i] = reg[0]; E.y[i] = reg[1];
}

/**
 * How far an eel's lunge goes along its line (E.dx, E.dy): up to lungeSpeed x lungeTime, and at
 * most `bank` px past where its leading edge leaves the water; a stump or a pillar ahead stops it
 * sooner. Worked out once, when it warns (a cold path: one a lunge).
 */
function lungeReach(world, i, def) {
  const E = world.enemies, T = world.terrain, cols = T.cols, rows = T.rows;
  const most = def.lungeSpeed * def.lungeTime, bank = def.bank ?? 0, r = E.radius[i];
  const x0 = E.x[i], y0 = E.y[i], ux = E.dx[i], uy = E.dy[i];
  let edge = -1;
  for (let t = 1; t <= most; t++) {
    const fx = Math.floor((x0 + ux * (t + r)) / TILE), fy = Math.floor((y0 + uy * (t + r)) / TILE);
    if (fx < 0 || fy < 0 || fx >= cols || fy >= rows) return t - 1;
    const ti = fy * cols + fx;
    const water = T.dryWall[ti] === 0;
    if (!water && (T.base[ti] === 1 || T.pillar[ti] === 1)) return t - 1;   // a wall on the bank
    if (edge < 0 && !water) edge = t - 1;
    if (edge >= 0 && t - 1 >= edge + bank) return edge + bank;
  }
  return most;
}

/** A latched leech lets go (a freeze, a daze, or your dash throws it off). */
export function unlatch(world, i) {
  const E = world.enemies;
  if (E.aiState[i] !== LEECH.LATCHED) return;
  E.aiState[i] = LEECH.SWIM;
  world.latched--;
  const d = Math.sqrt(E.dx[i] * E.dx[i] + E.dy[i] * E.dy[i]) || 1;
  const num = world.scratch.num;
  num[1] = E.dx[i] / d; num[2] = E.dy[i] / d; num[3] = world.tuning.enemies.leechThrow;
  impulseR(world, i);
  world.events.push(EV.LATCH, E.x[i], E.y[i], 0, E.handle(i), world.latched);
}

/** Your dash throws every leech off (sim/world.js, on the dash's tick). */
export function throwLeeches(world) {
  if (world.latched <= 0) return;
  const E = world.enemies;
  for (let i = 0; i < E.count; i++) if (world.enemyLatch[E.type[i]] === 1 && E.aiState[i] === LEECH.LATCHED) unlatch(world, i);
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
 * a gunner aiming, a creek eel warning or lunging, a toad in its hop, and, given `bosses`
 * (world.bosses), a boss warning or charging)? Such an enemy can't be held (frozen, dazed, or salted): a hold stops its AI's clock, so the attack would land after its
 * warning had gone, or a charge would stop and then finish with no warning at all (§5.13: every
 * attack is warned; §16.4).
 */
export function midAttack(E, e, bosses = null) {
  if ((E.flags[e] & (EF.WARNING | EF.LUNGING)) !== 0) return true;   // a rat's pounce, a champion's warning
  const ai = E.ai[e], s = E.aiState[e];
  if (ai === AI.charger) return s === CHARGER.WINDUP || s === CHARGER.DASH;
  if (ai === AI.ranged_slow) return s === RANGED.WARN;
  if (ai === AI.eel) return s === EEL.WARN || s === EEL.LUNGE;   // a creek eel's warned line and its lunge
  if (ai === AI.hopper) return s === HOP.AIR;                    // a toad's hop (in the air: untouchable anyway)
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
      tell(world, E.x[i], E.y[i], TELE.LINE, Math.round(warn * TPS), def.dashSpeed * def.dashTime, angleOf(dir[1], dir[0]), i, false, lineCrossesPlayer(world, E.x[i], E.y[i], dir[0], dir[1], def.dashSpeed * def.dashTime, 2 * E.radius[i]));
      dir[2] = 0;
    }
    return;
  }
  if (st === CHARGER.WINDUP) {
    // Winding up: stand still (enemiesAct keeps it anchored where the warning shows).
    dir[0] = E.dx[i]; dir[1] = E.dy[i]; dir[2] = 0;
    E.aiTimer[i] -= DT;
    // At a slower pace (tuning.pace.speed) the dash runs longer, so it covers exactly the line it warned of.
    if (E.aiTimer[i] <= 0) { E.aiState[i] = CHARGER.DASH; E.aiTimer[i] = def.dashTime / world.tuning.pace.speed; }
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
  setSource(world, HURT.HAZARD, i);
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
    tell(world, E.x[i], E.y[i], TELE.LINE, Math.round(warn * TPS), def.range, angleOf(E.dy[i], E.dx[i]), i, false, lineCrossesPlayer(world, E.x[i], E.y[i], E.dx[i], E.dy[i], def.range * (def.shotRange ?? 1.6), 2 * def.radius));
    return;
  }
  if (E.aiTimer[i] > 0) return;
  E.aiState[i] = RANGED.WAIT;
  E.aiTimer[i] = def.every;
  setSource(world, HURT.SHOT, i);
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
  const sunk = world.torc !== null && world.torc.sinkUntil >= 0;   // (the Bog Torc: player.js isSunk)
  let worstE = -1;
  // The pace dial: an enemy's touch hurts this much more (a boss's keeps its own), and more again
  // while your damage outruns the clock (sim/threat.js).
  const touch = world.tuning.pace.contact * world.threat.mul, stingers = world.enemySting;
  let stung = false;
  for (let k = 0; k < m; k++) {
    const e = near[k];
    if ((E.flags[e] & EF_GONE) !== 0 || E.saltT[e] > 0) continue;   // dead, in the air, or turned to salt
    // A leech latches on instead of biting (at most a few at once, never while you're sunk into
    // the peat). It never bites: one that can't latch waits beside you until a latch frees.
    let bites = true;
    if (world.enemyLatch[E.type[e]] === 1) {
      if (E.aiState[e] === LEECH.LATCHED) continue;
      if (world.latched < world.tuning.enemies.leechMax && E.dazeT[e] <= 0 && E.freezeT[e] <= 0 && p.dashTicks === 0 && !sunk) { latch(world, e); continue; }
      bites = false;
    }
    // A dazed enemy can't hurt you (it's still pushed out of you below).
    const c = (E.flags[e] & EF.BOSS) !== 0 ? E.contact[e] : E.contact[e] * touch;
    if (bites && E.dazeT[e] <= 0 && c > worst) { worst = c; worstE = e; }
    if (bites && E.dazeT[e] <= 0 && stingers[E.type[e]] === 1) stung = true;
    const dx = E.x[e] - p.x, dy = E.y[e] - p.y;
    const want = E.radius[e] + T.radius;
    const d2 = dx * dx + dy * dy;
    if (d2 < want * want && d2 > 1e-6) {
      // Who gives way: a boss or an enemy showing a warning never moves, so you're pushed fully
      // out of it. Otherwise the overlap splits by weight (the player counts as mass 1), and the
      // crowd's shove on you is capped (tuning.player.shoveMax), so a crowd slows you and jostles
      // you, but no enemy can bulldoze a player across the map.
      const d = Math.sqrt(d2), over = (want - d) / d;
      // (A creek eel goes only where its own AI takes it: in its water, or its warned lunge.)
      const anchored = (E.ai[e] === AI.charger && E.aiState[e] === CHARGER.WINDUP) || (E.ai[e] === AI.ranged_slow && E.aiState[e] === RANGED.WARN) || E.ai[e] === AI.eel;
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
  if (worst > 0) {
    world.hurtBy = worstE;
    const hit = hurtPlayer(world, worst, p.x, p.y, HURT.CONTACT, E.type[worstE], null);
    world.hurtBy = -1;
    // What a touch leaves: a midge's sting (a slow that adds up), a Brine elite's slow.
    if (hit > 0 || p.iframes > 0 && world.lastHurt.tick === world.tick) {
      if (stung) sting(world);
      if ((E.affix[worstE] & AFFIX.BRINE) !== 0) brine(world);
    }
  }
  if (p.dashTicks !== 0 || sunk) return; // (sunk into the peat: nothing shoves you)
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

/** A leech latches on: it rides where it touched you and drains you (enemiesAct). */
function latch(world, e) {
  const E = world.enemies, p = world.player, def = world.enemyDefs[E.type[e]];
  E.aiState[e] = LEECH.LATCHED;
  const dx = E.x[e] - p.x, dy = E.y[e] - p.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
  const r = world.tuning.player.radius + E.radius[e] * 0.5;
  E.dx[e] = (dx / d) * r; E.dy[e] = (dy / d) * r;
  E.aiTimer[e] = def.latch.every;
  E.vx[e] = 0; E.vy[e] = 0;
  world.latched++;
  world.events.push(EV.LATCH, E.x[e], E.y[e], 1, E.handle(e), world.latched);
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
    if ((f & (EF.ELITE | EF.BOSS)) !== 0) world.events.push(EV.HIT_STOP, x, y, (f & EF.BOSS) !== 0 ? HITSTOP.BOSS_KILL : HITSTOP.ELITE_KILL, 0);
    const ev = world.events, kk = ev.reserve(EV.KILL);
    if (kk >= 0) { ev.x[kk] = x; ev.y[kk] = y; ev.a[kk] = type; ev.b[kk] = ((f & EF.ELITE) !== 0 ? 1 : 0) | ((f & EF.BOSS) !== 0 ? 2 : 0); ev.c[kk] = E.killer[i]; ev.d[kk] = E.handle(i); }
    runHooks(world, 'onKill', i, type);
    const ks = E.killer[i];
    // Where it died (Grave Lights rise there), the killer's deed, and what the weapon does with a kill.
    const C = world.corpses, ci = C.n % C.t.length;
    C.x[ci] = x; C.y[ci] = y; C.t[ci] = world.tick; C.n++;
    if (ks >= 0) {
      const sl = world.slots[ks];
      if (sl && ks < RELIC_SLOT && sl.def && sl.def.deed) deedKill(world, sl, i);
      if (sl && sl.killForm) formKill(world, sl, x, y, E.killedByZone[i] === 1, i);
    }
    deathRules(world, i, x, y, f);
    const xp = E.xp[i] * world.killXpMul;
    if (xp > 0) spawnGem(world, x, y, xp);
    rollDrops(world, i, def, f);
    // Phase 7: a tolled Fog Bell's count, a Reliquary now and then from an ordinary kill, Pearls from elites and bosses.
    if (world.tasks.length) bellKill(world, x, y, E.crew[i]);
    // The Marsh: a kill that shatters (a frozen kill by Salt Pan's spouts, a held kill by a Steel
    // weapon with Cold Iron), a leech that was latched lets go, the Well Warden's well.
    if (ks >= 0 || E.held[i] !== 0) shatterAt(world, i, x, y);
    if (world.enemyLatch[type] === 1 && E.aiState[i] === LEECH.LATCHED) { E.aiState[i] = LEECH.SWIM; world.latched--; }
    if (def.well && E.boss[i] === MUSTER_CAPTAIN) openWellAt(world, x, y);
    if ((f & (EF.ELITE | EF.BOSS | EF.MINION)) === 0) maybeReliquary(world, x, y);
    else { const g = glassFor(world, f); if (g > 0) spawnPickup(world, PK.GLASS, x, y - 8, g, 0); }
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
    else if ((f & EF.ELITE) !== 0 && E.boss[i] !== NO_CHEST) {          // the second of a Tide's pair carries nothing
      // A muster's captain pays a boss chest and an Ember; a champion whose data says 'elite' (the
      // 5:00 ones) an elite's chest and an elite's chance of one (sim/champions.js).
      const big = E.boss[i] === MUSTER_CAPTAIN && championChest(world, i) === 'boss';
      dropChest(world, x, y, big ? CHEST_BOSS : CHEST_ELITE);
      // An Ember: always from a big captain, now and then from an elite (tuning.embers).
      const chance = (world.tuning.embers?.eliteChance ?? 0) * world.emberEliteMul;
      if (world.ascensionLines.size && (big || (chance > 0 && world.rng.loot.chance(chance)))) spawnPickup(world, PK.EMBER, x, y + 14, 0, 0);
    }
  }
  return resolved;
}

const PASS = { status: 'burn', dps: 0, duration: 0, amp: 0 }; // reused: applyStatus copies what it keeps

/** The build's rules that act on a death (a passive's last level): Wick Oil, Grave Moss, the Lucky Knot. */
function deathRules(world, i, x, y, f) {
  const R = world.rules, E = world.enemies;
  if (R.wick && E.burnT[i] > 0) {
    // An enemy that dies burning sets the nearest enemy burning.
    const t = world.enemyHash.nearest(x, y, 60, E.flags, EF_GONE, i);
    if (t >= 0) { PASS.status = 'burn'; PASS.dps = E.burnDps[i]; PASS.duration = 2; applyStatus(world, t, PASS, E.burnSlot[i]); }
  }
  if (R.gravemoss && E.rotT[i] > 0 && world.tick >= world.rotPatchAt && explodeRef !== null) {
    // An enemy that dies rotting leaves a patch of rot (at most 4 a second).
    world.rotPatchAt = world.tick + 15;
    rotPatch(world, x, y);
  }
  if (R.luckyknot && (f & EF.ELITE) !== 0 && world.rng.loot.chance(0.25)) world.charges.reroll++;
}

let rotPatch = () => {};
/** sim/weapons.js gives the patch of rot (it owns the zones), as it gives the blast. */
export function setRotPatch(fn) { rotPatch = fn; }

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
