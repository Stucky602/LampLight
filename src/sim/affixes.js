// Elite affixes (0.9.0, W3; the veteran round, V1: "elites are just bigger copies"). Each elite
// gets one (two from Tide 2: tuning.affixes), drawn from the spawn stream, each a rule you can see
// and answer (data/enemies.js AFFIXES):
//   warded    a ward takes `wardHits` hits to break (one a `wardGap` s at most); until then no damage lands
//   herald    comes with `herald` of its own kind
//   molten    leaves burning ground where it walks, each patch warned before it burns
//   tethered  comes with `links` of its own kind, linked; while they live the damage it takes is
//             shared with them (a hit on it lands split between it and each link alive)
//   brine     its touch slows you (sim/player.js brine)
// A muster's captain (a champion, sim/champions.js) has none. Links are kept as handle + 1 (0 none).

import { DT, TPS, EF_GONE } from './constants.js';
import { EV, HURT, TELE } from './events.js';
import { ELITE_AFFIXES as AFFIXES } from '../data/enemies.js';
import { setSource, spawnHazard, HAZARD_LOOK } from './attacks.js';
import { sincosInto, TAU } from '../lib/fmath.js';

export const AFFIX = Object.freeze(Object.fromEntries(AFFIXES.map((a) => [a.id.toUpperCase(), a.bit])));
const ALL = AFFIXES.map((a) => a.bit);
/** The Molten fire's source, for what hurt you (its name in the death recap). */
const MOLTEN_SRC = Object.freeze({ key: 'molten', name: 'burning ground' });

/** How many affixes an elite gets at this run's Tide. */
export function affixCount(world) {
  const A = world.tuning.affixes;
  return (world.config.tide ?? 0) >= A.twoFromTide ? 2 : A.perElite;
}

/**
 * Give elite e `n` affixes (distinct, from the spawn stream) and set each up: a ward, a herald's
 * crowd, a tether's links. `spawn` is sim/enemies.js spawnEnemy (passed in: this file is imported
 * by it).
 */
export function assignAffixes(world, e, n, spawn) {
  if (!(n > 0)) return 0;
  const rng = world.rng.spawn;
  let bits = 0;
  for (let k = 0; k < n && k < ALL.length; k++) {
    let pick = ALL[Math.floor(rng.next() * ALL.length)];
    for (let g = 0; (bits & pick) !== 0 && g < ALL.length; g++) pick = ALL[(ALL.indexOf(pick) + 1) % ALL.length];
    bits |= pick;
  }
  return giveAffixes(world, e, bits, spawn);
}

/** Give elite e these affix bits and set each up (assignAffixes, and tests that want one). */
export function giveAffixes(world, e, bits, spawn) {
  const E = world.enemies, A = world.tuning.affixes;
  E.affix[e] = bits;
  const x = E.x[e], y = E.y[e], type = E.type[e], h = E.handle(e);
  world.events.push(EV.AFFIX, x, y, bits, h, type);
  if ((bits & AFFIX.WARDED) !== 0) { E.ward[e] = A.wardHits; E.wardT[e] = -1e6; }
  if ((bits & AFFIX.MOLTEN) !== 0) E.affixT[e] = A.molten.every;
  const sc = world.scratch.sc, T = world.terrain;
  if ((bits & AFFIX.HERALD) !== 0) {
    for (let k = 0; k < A.herald; k++) {
      sincosInto((k / A.herald) * TAU, sc, 0);
      const cx = x + sc[1] * 26, cy = y + sc[0] * 26;
      if (cx < 8 || cy < 8 || cx > T.width - 8 || cy > T.height - 8 || T.blockedAt(cx, cy)) continue;
      spawn(world, type, cx, cy, null);
    }
  }
  if ((bits & AFFIX.TETHERED) !== 0) {
    let made = 0;
    for (let k = 0; k < A.links * 2 && made < A.links; k++) {
      sincosInto((k / A.links) * TAU + 0.6, sc, 0);
      const cx = x + sc[1] * 34, cy = y + sc[0] * 34;
      if (cx < 8 || cy < 8 || cx > T.width - 8 || cy > T.height - 8 || T.blockedAt(cx, cy)) continue;
      const l = spawn(world, type, cx, cy, null);
      if (l < 0) continue;
      const lh = E.handle(l);
      if (made === 0) E.link0[e] = lh + 1; else E.link1[e] = lh + 1;
      made++;
      world.events.push(EV.TETHER, cx, cy, 1, h, lh);
    }
  }
  return bits;
}

/** A link of e (its handle + 1 in field `f`) still alive: its index, else -1 (and the link is let go, said once). */
function linkAlive(world, e, f) {
  const E = world.enemies, v = f[e];
  if (v === 0) return -1;
  const l = E.resolve(v - 1);
  if (l >= 0 && (E.flags[l] & EF_GONE) === 0) return l;
  f[e] = 0;
  world.events.push(EV.TETHER, E.x[e], E.y[e], 0, E.handle(e), v - 1);
  return -1;
}

/**
 * What lands on an elite with affixes (damageEnemyR, before anything else touches the amount):
 * a ward eats the hit and loses a hit's worth; a tether passes shares to its links (each its own
 * hit, by the same slot). `hitLink` is damageEnemyR's own way to hurt a link (passed in).
 */
export function affixDamage(world, e, amount, slot, hitLink) {
  const E = world.enemies, bits = E.affix[e];
  if ((bits & AFFIX.WARDED) !== 0 && E.ward[e] > 0) {
    const gap = Math.round(world.tuning.affixes.wardGap * TPS);
    if (world.tick - E.wardT[e] >= gap) {
      E.ward[e]--; E.wardT[e] = world.tick;
      world.events.push(EV.WARD, E.x[e], E.y[e], E.ward[e], E.handle(e));
    }
    return 0;
  }
  if ((bits & AFFIX.TETHERED) !== 0) {
    const a = linkAlive(world, e, E.link0), b = linkAlive(world, e, E.link1);
    const n = (a >= 0 ? 1 : 0) + (b >= 0 ? 1 : 0);
    if (n > 0) {
      const share = amount / (1 + n);
      if (a >= 0) hitLink(world, a, share, slot);
      if (b >= 0) hitLink(world, b, share, slot);
      return share;
    }
  }
  return amount;
}

/** An affixed elite's turn (enemiesAct): a tether lets go of a dead link; a Molten one leaves a warned patch of fire where it stands. */
export function affixTick(world, i) {
  const E = world.enemies;
  // A tether whose link has died lets go now (said once, for the view's line).
  if ((E.affix[i] & AFFIX.TETHERED) !== 0 && (E.link0[i] !== 0 || E.link1[i] !== 0)) { linkAlive(world, i, E.link0); linkAlive(world, i, E.link1); }
  if ((E.affix[i] & AFFIX.MOLTEN) === 0) return;
  E.affixT[i] -= DT;
  if (E.affixT[i] > 0) return;
  const M = world.tuning.affixes.molten;
  E.affixT[i] = M.every;
  setSource(world, HURT.HAZARD, i, MOLTEN_SRC, HAZARD_LOOK.FIRE, false);
  spawnHazard(world, E.x[i], E.y[i], M.radius, Math.max(M.warn, world.tuning.enemies.telegraphMin), M.last, M.damage * world.director.contactMul);
}

/** Does the shape of its warning say Molten? (Tests and tools.) */
export const MOLTEN_SHAPE = TELE.CIRCLE;
