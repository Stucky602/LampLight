// Relics in a run (ARCHITECTURE §10.8; the relics themselves: data/relics.js), Sea Glass, and the
// Ferryman. Relics never come from level-ups or chests:
//   a Reliquary   a rare drop from ordinary enemies (tuning.relics: a chance per kill, a gap
//                 between them, and a count of kills that makes the next one certain); walking
//                 over it stops the run to pick one of three
//   the vault     Lantern Night's (sim/tasks.js): one of three, a tier better
//   the Ferryman  sells one (or two) for Sea Glass, with food, a reroll, and an Ember
// What's offered leans on the run's minute (tuning.relics.tierWeights): Trinkets early, Relics late.
// Every draw is on the loot stream, so the draft and the spawns never move.

import { DT, TPS, PK, EF } from './constants.js';
import { EV } from './events.js';
import { addRelic, relicAvailable } from './build.js';
import { heal } from './player.js';
import { collectEmber } from './ascend.js';
import { spawnPickup } from './pickups.js';
import { snapShore } from './places.js';

/** The run's minute on the map's own clock (a short run's 5:00 is the map's 10:00). */
export function runMinute(world) {
  return (world.tick * DT) / 60 / world.director.timeScale;
}

/** Sea Glass gained (or spent, when negative), with its event. */
export function addGlass(world, amount, x, y) {
  if (amount === 0) return;
  world.glass += amount;
  const r = world.result;
  if (amount > 0) r.glassEarned += amount;
  if (world.glass > r.glassMax) r.glassMax = world.glass;
  world.events.push(EV.GLASS, x, y, amount, world.glass);
}

/** Each tier's weight now (index 1..3), shifted `bonus` tiers better (the vault, Glassblower). */
function tierWeights(world, bonus) {
  const rows = world.tuning.relics.tierWeights, m = runMinute(world);
  let row = rows[0];
  for (const r of rows) if (m >= r[0]) row = r;
  const w = [0, row[1], row[2], row[3]];
  for (let k = 0; k < bonus; k++) { w[3] += w[2]; w[2] = w[1]; w[1] = 0; }
  return w;
}

/**
 * Draw up to n relics you could still find (none twice), weighted by tier for the minute and by
 * each relic's own weight. When the minute's tiers leave nothing (only Relics left, at 1:00), the
 * lowest tier still there is offered, by its own weights: never a stronger one early. Returns
 * relic defs.
 */
export function drawRelics(world, n, bonus = 0) {
  const pool = relicAvailable(world);
  const tw = tierWeights(world, bonus + (world.relicTierBonus || 0));
  const out = [];
  const rng = world.rng.loot;
  while (out.length < n && pool.length) {
    let w = pool.map((r) => tw[r.tier] * (r.weight ?? 100));
    if (!w.some((x) => x > 0)) {
      let low = 99;
      for (const r of pool) if (r.tier < low) low = r.tier;
      w = pool.map((r) => (r.tier === low ? r.weight ?? 100 : 0));
    }
    const i = rng.weighted(w);
    out.push(pool[i]);
    pool.splice(i, 1);
  }
  return out;
}

/** A Reliquary or the vault, walked over: stop for the pick. */
export function openRelicPick(world, source, x, y) {
  world.halts.push({ kind: 'relic', source, offer: null, x, y });
}

/** Ready a relic pick (prepareHalt): its three. With nothing left to find, Sea Glass instead and no screen. */
export function prepareRelicPick(world, h) {
  if (h.offer !== null) return true;
  h.offer = drawRelics(world, world.tuning.relics.offer, h.source === 'vault' ? 1 : 0).map((r) => r.id);
  if (h.offer.length) return true;
  addGlass(world, world.tuning.relics.emptyGlass, h.x, h.y);
  return false;
}

/** The relic pick's answer: { kind: 'pick', index }. Returns true (done). */
export function relicDecide(world, h, d) {
  if (d.kind !== 'pick') throw new Error(`relic: expected "pick", got "${d.kind}"`);
  const id = h.offer?.[d.index];
  if (id === undefined) throw new Error(`relic: no relic ${d.index} on offer`);
  if (world.build.relics.some((r) => r.id === id)) throw new Error(`relic: ${id} is already carried`);
  addRelic(world, world.relicDefs.find((r) => r.id === id));
  return true;
}

/**
 * An ordinary enemy died at (x, y): maybe a Reliquary. Not before the gap since the last one;
 * after it, at the chance per kill (times luck), and certainly once enough kills have gone by.
 * Carrying every relic there is, it drops Sea Glass instead.
 */
export function maybeReliquary(world, x, y) {
  const R = world.reliquary, T = world.tuning.relics;
  R.kills++;
  if (world.tick - R.last < T.reliquaryGap * TPS) return;
  if (R.kills < T.reliquaryPity && !world.rng.loot.chance(T.reliquaryChance * world.stats.luck)) return;
  R.last = world.tick;
  R.kills = 0;
  if (!relicAvailable(world).length) { spawnPickup(world, PK.GLASS, x, y, T.emptyGlass, 0); return; }
  world.result.reliquaries++;
  // (PK_STAYS: it waits where it fell.)
  spawnPickup(world, PK.RELIQUARY, x, y, 0, 0);
}

// ---------------------------------------------------------------- the Ferryman

/** The Ferryman for a run (null without the Docks): his skiff, stock, and whether you're beside it. */
export function createFerry(world) {
  const lv = world.config.harbor?.ferry ?? 0, at = world.map.ferry?.at;
  if (!(lv > 0) || !at) return null;
  // He ties up at the nearest water's edge: you stand on the boards (x, y), the skiff floats (bx, by).
  const p = snapShore(world, at[0], at[1]);
  return { level: lv, x: p.x, y: p.y, bx: p.bx, by: p.by, stock: -1, offers: [], stand: 0, armed: true };
}

const FERRY_KINDS = Object.freeze({ relic: 1, food: 2, reroll: 3, ember: 4 });

/** Fill his stock for stock number k: a relic (two from Docks level 2), food, a reroll, an Ember. */
function restock(world, F, k) {
  F.stock = k;
  const T = world.tuning.ferry, P = T.prices;
  const disc = F.level >= 3 ? 1 - T.discount : 1;
  const price = (v) => Math.max(1, Math.round(v * disc));
  // Each stock a little better: Trinkets at first, then Charms, then Relics; from the second
  // stock, a tier better again at the Docks' level 5 (never a Relic in the opening stock).
  const bonus = Math.min(2, k) + (F.level >= 5 && k > 0 ? 1 : 0);
  const relics = drawRelics(world, F.level >= 2 ? 2 : 1, bonus);
  const tierPrice = [0, P.trinket, P.charm, P.relic];
  F.offers = [
    ...relics.map((r) => ({ kind: FERRY_KINDS.relic, id: r.id, price: price(tierPrice[r.tier]), sold: false })),
    { kind: FERRY_KINDS.food, id: 'food', price: price(P.food), sold: false },
    { kind: FERRY_KINDS.reroll, id: 'reroll', price: price(P.reroll), sold: false },
    { kind: FERRY_KINDS.ember, id: 'ember', price: price(P.ember), sold: false },
  ];
  world.events.push(EV.FERRY, F.x, F.y, 1, k);
}

/**
 * Each tick (after you move): his stock turns over on its clock, and standing still beside the
 * skiff for a moment opens the trade (once; walk away and back for another).
 */
export function ferryStep(world) {
  const F = world.ferry;
  if (!F) return;
  const T = world.tuning.ferry;
  const every = (F.level >= 4 ? T.fastRestockSec : T.restockSec) * world.director.timeScale;
  const k = Math.floor((world.tick * DT) / every);
  if (k !== F.stock) restock(world, F, k);
  const p = world.player, dx = p.x - F.x, dy = p.y - F.y;
  const near = dx * dx + dy * dy <= T.radius * T.radius;
  if (!near) { F.armed = true; F.stand = 0; return; }
  if (!F.armed || p.moving || p.dashTicks > 0) { F.stand = 0; return; }
  F.stand += DT;
  if (F.stand >= T.standSec) {
    F.armed = false;
    F.stand = 0;
    world.halts.push({ kind: 'ferry' });
  }
}

/** The trade's answers: { kind: 'buy', index } (stays open), { kind: 'done' }. */
export function ferryDecide(world, d) {
  if (d.kind === 'done') return true;
  if (d.kind !== 'buy') throw new Error(`ferry: expected "buy" or "done", got "${d.kind}"`);
  const F = world.ferry, o = F?.offers[d.index];
  if (!o) throw new Error(`ferry: no offer ${d.index}`);
  if (o.sold) throw new Error('ferry: already bought');
  if (world.glass < o.price) throw new Error(`ferry: needs ${o.price} Sea Glass (${world.glass} held)`);
  if (o.kind === FERRY_KINDS.relic && world.build.relics.some((r) => r.id === o.id)) throw new Error('ferry: already carried');
  o.sold = true;
  addGlass(world, -o.price, F.x, F.y);
  const p = world.player;
  if (o.kind === FERRY_KINDS.relic) addRelic(world, world.relicDefs.find((r) => r.id === o.id));
  else if (o.kind === FERRY_KINDS.food) heal(world, world.tuning.ferry.foodHeal);
  else if (o.kind === FERRY_KINDS.reroll) world.charges.reroll++;
  else if (o.kind === FERRY_KINDS.ember) collectEmber(world, p.x, p.y);
  world.result.ferryBought++;
  world.events.push(EV.FERRY, F.x, F.y, 2, d.index);
  return false;
}

export { FERRY_KINDS };

/** Sea Glass a kill drops: elites and bosses only (tuning.glass). */
export function glassFor(world, flags) {
  const T = world.tuning.glass;
  if ((flags & EF.BOSS) !== 0) return T.boss;
  if ((flags & EF.ELITE) !== 0) return T.elite[0] + world.rng.loot.int(T.elite[1] - T.elite[0] + 1);
  return 0;
}
