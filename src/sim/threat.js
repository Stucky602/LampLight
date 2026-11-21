// What W3 (0.9.0) keeps on the world for combat: the attack sources and the warning cap
// (sim/attacks.js), the threat that follows your power, the champions (sim/champions.js), and the
// record of what hurt you (sim/player.js). Made once by createWorld, hashed by hashWorld.
//
// Threat follows power (the veteran round, V2: "contact damage and elite pressure scale with the
// run's damage dealt, not only the clock"): once a second the sim takes your damage over the last
// `span` seconds, against the damage a second a run is expected to deal at that minute
// (tuning.threat.ref, measured with the kite bots), and from minute `from` sets `mul` =
// (yours / expected) ^ exp, held between 1 and max. Enemy touches (not a boss's) and each new elite's health are multiplied
// by it, so a build that outruns the clock meets a harder fight; a weak one is never eased.
// "Your damage" (X4, the sweep's finding 4) is what your weapons took off enemies' health
// (`threat.dealt`, counted in sim/enemies.js damageEnemyR): the signature and the Forms count, but
// not what the map or a relic did for you (lamp wards, Lantern Night, thralls and the risen, cranes,
// cairns, the storm: all slot 9), and not overkill past the health an enemy had left.
// The reference curve is refit from tools/bots/threat.mjs (the median curve over N seeds).

import { TPS } from './constants.js';
import { createAttackState } from './attacks.js';
import { fpow } from '../lib/fmath.js';

const HURT_LOG = 8;

export function createCombatState(world) {
  world.attack = createAttackState();
  const W = world.tuning.threat;
  world.threat = { dps: 0, mul: 1, dealt: 0, ring: new Float64Array(W.span + 1), filled: 0, at: 0 };
  world.champions = [];
  world.lastHurt = { tick: -1, kind: 0, type: -1, attack: null, name: null, damage: 0 };
  world.hurtLog = { n: 0, at: 0, list: Array.from({ length: HURT_LOG }, () => ({ tick: -1, kind: 0, type: -1, attack: null, name: null, damage: 0 })) };
  // Per enemy type: keeps its speed under the pace dial (quick), pounces (ai.pounce), stings (a midge).
  const defs = world.enemyDefs;
  world.enemyQuick = Uint8Array.from(defs, (d) => (d.quick ? 1 : 0));
  world.enemyPounce = defs.map((d) => d.ai.pounce ?? null);
  world.enemySting = Uint8Array.from(defs, (d) => (d.sting ? 1 : 0));
}

/** The expected damage a second at `minutes` (tuning.threat.ref: [minute, dps] rows, straight lines between; the last row holds). */
export function refDps(T, minutes) {
  const ref = T.ref;
  if (minutes <= ref[0][0]) return ref[0][1];
  for (let k = 1; k < ref.length; k++) {
    if (minutes <= ref[k][0]) {
      const a = ref[k - 1], b = ref[k], f = (minutes - a[0]) / (b[0] - a[0]);
      return a[1] + (b[1] - a[1]) * f;
    }
  }
  return ref[ref.length - 1][1];
}

/** Once a second (directorStep): your damage over the span, and the threat it sets. */
export function threatStep(world, minutes) {
  if (world.tick % TPS !== 0) return;
  const th = world.threat, T = world.tuning.threat, ring = th.ring;
  const total = th.dealt;
  const n = ring.length;
  ring[th.at] = total;
  th.at = (th.at + 1) % n;
  if (th.filled < n) th.filled++;
  const oldest = th.filled < n ? ring[0] : ring[th.at];
  const span = th.filled - 1;
  th.dps = span > 0 ? (total - oldest) / span : 0;
  const ref = refDps(T, minutes);
  let mul = minutes >= T.from && ref > 0 && th.dps > ref ? fpow(th.dps / ref, T.exp) : 1;
  if (mul > T.max) mul = T.max;
  th.mul = mul;
}

/** W3's state in the world hash (sim/world.js hashWorld). */
export function hashCombat(world, h) {
  const th = world.threat;
  h.int(-21).float64(th.dps).float64(th.mul).float64(th.dealt).int(th.at).int(th.filled);
  for (let k = 0; k < th.filled; k++) h.float64(th.ring[k]);
  const p = world.player;
  h.int(-22).float64(p.slowPct).float64(p.stingT).int(p.stings).float64(p.brineT);
  for (const b of world.bosses) h.int(b.sigDone ? 1 : 0).int(b.held ? 1 : 0).int(b.heldTick).float64(b.eaten);
  for (const c of world.champions) h.int(c.handle).int(c.state).int(c.phase).float64(c.timer).float64(c.ax).float64(c.ay).float64(c.ux).float64(c.uy);
}
