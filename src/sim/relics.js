// Relics in a run (ARCHITECTURE §5.18, §10.8; the relics themselves: data/relics.js), Pearls (the
// run's money; Sea Glass before 0.8.2, so the code still says glass), and the Ferryman. Relics
// never come from level-ups or chests:
//   a Reliquary   a rare drop from ordinary enemies (tuning.relics: a chance per kill, a gap
//                 between them that grows to spread what's left of the pool over the run, and a
//                 count of kills that makes the next one certain); walking over it stops the run
//                 to pick one of three. With every relic in the pool found, none drops, and the run
//                 says so once (EV.RELIC_POOL)
//   the vault     Lantern Night's (sim/tasks.js): one of three, a tier better; an Ember when the
//                 pool has nothing left
//   the Ferryman  rows in on a schedule and ties up near you (0.8.2), selling one relic (two from
//                 the Docks' level 2, three from level 4) for Pearls, with food, a reroll, and an Ember;
//                 and the relics given up for others (0.9.0: relic slots, world.build.relicSlots)
// What's offered leans on the run's minute (tuning.relics.tierWeights): Trinkets early, Relics late.
// Every draw is on the loot stream, so the draft and the spawns never move.

import { DT, TPS, PK, EF } from './constants.js';
import { EV, SIGHT } from './events.js';
import { sightThing } from './sight.js';
import { addRelic, relicAvailable, relicsFull, swapRelic } from './build.js';
import { heal } from './player.js';
import { collectEmber, optionChoices } from './ascend.js';
import { spawnPickup } from './pickups.js';
import { snapShore } from './places.js';

/** The run's minute on the map's own clock (a short run's 5:00 is the map's 10:00). */
export function runMinute(world) {
  return (world.tick * DT) / 60 / world.director.timeScale;
}

/** Pearls gained (or spent, when negative), with its event. None without the Ferryman in the run (world.pearlsOn). */
export function addGlass(world, amount, x, y) {
  if (amount === 0 || !world.pearlsOn) return;
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

/**
 * Ready a relic pick (prepareHalt): its three. With nothing left to find (the Ferryman sold the
 * last one since it dropped, or the vault came after the pool ran out), an Ember instead, said so
 * (EV.VAULT_EMPTY: a = 1 the vault, 2 a Reliquary), and no screen.
 */
export function prepareRelicPick(world, h) {
  if (h.offer !== null) { h.full = relicsFull(world); return true; }
  h.offer = drawRelics(world, world.tuning.relics.offer, h.source === 'vault' ? 1 : 0).map((r) => r.id);
  h.full = relicsFull(world);
  if (h.offer.length) return true;
  const p = world.player;
  world.events.push(EV.VAULT_EMPTY, p.x, p.y, h.source === 'vault' ? 1 : 2);
  spawnPickup(world, PK.EMBER, p.x, p.y, 0, 0);
  return false;
}

/**
 * The run's relic pool, counted (no allocation): out.total the relics it can give (weight above
 * 0), out.found the ones of them carried, given to the Well, or banished. Returns what's left.
 */
export function relicPool(world, out) {
  const pool = world.pools.relics, b = world.build;
  if (world.relicKeys === null) world.relicKeys = pool.map((r) => `relic:${r.id}`); // (made once: no strings a kill)
  const keys = world.relicKeys;
  let total = 0, left = 0;
  for (let i = 0; i < pool.length; i++) {
    const r = pool[i];
    if (!((r.weight ?? 100) > 0)) continue;
    total++;
    let have = b.banished.has(keys[i]);
    for (let k = 0; k < b.relics.length && !have; k++) if (b.relics[k].id === r.id) have = true;
    if (!have) left++;
  }
  if (out) { out.total = total; out.found = total - left; }
  return left;
}

/** Seconds of the run left before the map's last boss (0 past it): what the Reliquaries spread the pool over. */
function runLeft(world) {
  const d = world.director, e = d.lastBossEvent >= 0 ? d.events[d.lastBossEvent] : null;
  const left = e ? e.at - world.tick * DT : 0;
  return left > 0 ? left : 0;
}

/**
 * The relic pick's answer: { kind: 'pick', index }; with the relic slots full (0.9.0, ruling 4)
 * { kind: 'pick', index, swap: id } gives up a carried relic for it, and { kind: 'pass' } takes
 * none. Returns true (done).
 */
export function relicDecide(world, h, d) {
  const full = relicsFull(world);
  if (d.kind === 'pass') {
    if (!full) throw new Error('relic: a pass is only for when the relic slots are full');
    const p = world.player;
    world.events.push(EV.RELIC_SWAP, p.x, p.y, -1, -1);
    return true;
  }
  if (d.kind !== 'pick') throw new Error(`relic: expected "pick" or "pass", got "${d.kind}"`);
  const id = h.offer?.[d.index];
  if (id === undefined) throw new Error(`relic: no relic ${d.index} on offer`);
  if (world.build.relics.some((r) => r.id === id)) throw new Error(`relic: ${id} is already carried`);
  const def = world.relicDefs.find((r) => r.id === id);
  if (full) {
    const out = world.build.relics.find((r) => r.id === d.swap);
    if (!out) throw new Error(`relic: the slots are full; give up a carried relic (swap) or pass${d.swap ? ` (${d.swap} isn't carried)` : ''}`);
    swapRelic(world, out, def, returnToFerry);
  } else addRelic(world, def);
  return true;
}

/**
 * A relic given up for another (the slots full) goes back to the Ferryman's stock: beside his
 * current one if he's tied up, else in his next; at its tier's price, `returned`. Without him it's
 * simply back in the pool.
 */
export function returnToFerry(world, def) {
  const F = world.ferry;
  if (!F) return;
  if (F.moored && F.offers.length) F.offers.splice(relicOffers(F), 0, returnedOffer(world, F, def));
  else world.build.returned.push(def.id);
}

function relicOffers(F) {
  let n = 0;
  while (n < F.offers.length && F.offers[n].kind === FERRY_KINDS.relic) n++;
  return n;
}

function returnedOffer(world, F, def) {
  const P = world.tuning.ferry.prices;
  return { kind: FERRY_KINDS.relic, id: def.id, price: ferryPrice(world, F, [0, P.trinket, P.charm, P.relic][def.tier]), sold: false, returned: true };
}

/**
 * An ordinary enemy died at (x, y): maybe a Reliquary. Not before the wait since the last one (the
 * tuning's gap, or longer: set as one drops, the time left to the last boss over the relics still
 * to find after it plus one, so a small pool lasts the run); after it, at the chance per kill (times luck), and certainly once
 * enough kills have gone by. With every relic in the pool found, none: the run says so once.
 * One from a kill far off lands nearer you, toward the kill (tuning.relics.pullFrom, pullTo).
 */
export function maybeReliquary(world, x, y) {
  const R = world.reliquary, T = world.tuning.relics, slower = world.tideRules.reliquaryGap; // a Tide's rarer Reliquaries
  R.kills++;
  const left = relicPool(world, null);
  if (left === 0) {
    if (!R.out && world.pools.relics.length > 0) {
      R.out = true;
      const pool = world.scratch.pool;
      relicPool(world, pool);
      world.events.push(EV.RELIC_POOL, world.player.x, world.player.y, 1, pool.found, pool.total);
    }
    return;
  }
  const gap = T.reliquaryGap * slower;
  if (world.tick - R.last < (R.wait > gap ? R.wait : gap) * TPS) return;
  if (R.kills < T.reliquaryPity * slower && !world.rng.loot.chance(T.reliquaryChance * world.stats.luck)) return;
  R.last = world.tick;
  R.kills = 0;
  R.wait = runLeft(world) / left;   // (left - 1 still to find after this one, plus one)
  world.result.reliquaries++;
  const p = world.player, dx = x - p.x, dy = y - p.y, d = Math.sqrt(dx * dx + dy * dy);
  let pulled = 0;
  if (d > T.pullFrom) { x = p.x + (dx / d) * T.pullTo; y = p.y + (dy / d) * T.pullTo; pulled = 1; }
  // (PK_STAYS: it waits where it lands.)
  spawnPickup(world, PK.RELIQUARY, x, y, 0, 0, pulled);
  sightThing(world, SIGHT.RELIQUARY);
}

// ---------------------------------------------------------------- the Ferryman

/**
 * The Ferryman for a run (null without the Docks, or on a map with nowhere to tie up). He isn't
 * there at 0:00 (0.8.2, idea 6): he rows in at tuning.ferry.firstCall, then every callEvery (the
 * map's clock), and ties up at the map's mooring nearest you that's at least minAway from you, with
 * new stock each call. moorings: [{ x, y, bx, by }]: the boards you stand on and the skiff's water.
 * x, y, bx, by: where he's tied up now (moored), rowing in from fromX, fromY between callTick and
 * tiedTick; the trade opens from tiedTick.
 */
export function createFerry(world) {
  const lv = world.config.harbor?.ferry ?? 0, f = world.map.ferry;
  const spots = f?.moorings ?? (f?.at ? [f.at] : []);
  if (!(lv > 0) || !spots.length) return null;
  const moorings = spots.map((at) => snapShore(world, at[0], at[1]));
  const T = world.tuning.ferry, scale = world.director.timeScale;
  return {
    level: lv, moorings, moored: false, mooring: -1, x: 0, y: 0, bx: 0, by: 0, fromX: 0, fromY: 0,
    callTick: -1, tiedTick: -1, calls: 0, nextCall: Math.round(T.firstCall * scale * TPS),
    stock: -1, offers: [], touch: 0, armed: true,
  };
}

const FERRY_KINDS = Object.freeze({ relic: 1, food: 2, reroll: 3, ember: 4 });

function ferryPrice(world, F, v) {
  const T = world.tuning.ferry;
  return Math.max(1, Math.round(v * ((F?.level ?? 0) >= 3 ? 1 - T.discount : 1)));
}

/** The Form options a weapon holds. */
function formsFor(world, s) {
  return world.slots[s]?.ascensions?.length ?? 0;
}

/** Could an Ember do anything for the weapon in slot s (open its next axis early, or switch an option)? */
export function emberFits(world, s) {
  if (!(Number.isInteger(s) && s >= 0 && s < world.build.weaponSlots)) return false;
  return optionChoices(world, s).some((c) => c.cost === 'ember');
}

/**
 * What the Ferryman asks for an Ember bought for the weapon in slot s (0.7.3): his Ember price
 * plus tuning.ferry.emberPerForm for each Form the weapon already holds (or has an Ember bought
 * for), with the Docks' discount. Stacking Forms on one weapon gets dear.
 */
export function emberPrice(world, s) {
  const T = world.tuning.ferry, F = world.ferry;
  return ferryPrice(world, F, T.prices.ember + T.emberPerForm * (s >= 0 ? formsFor(world, s) : 0));
}

/** The cheapest weapon to buy an Ember for: { slot, price } (slot -1 when none can take a Form: the base price). */
export function emberQuote(world) {
  let slot = -1, price = 0;
  for (let s = 0; s < world.build.weaponSlots; s++) {
    if (!emberFits(world, s)) continue;
    const v = emberPrice(world, s);
    if (slot < 0 || v < price) { slot = s; price = v; }
  }
  return { slot, price: slot >= 0 ? price : emberPrice(world, -1) };
}

/** Keep the Ember offer's price on what it costs now (it follows the cheapest weapon to buy it for). */
function quoteEmber(world, F) {
  for (const o of F.offers) if (o.kind === FERRY_KINDS.ember && !o.sold) o.price = emberQuote(world).price;
}

/**
 * The Well slot (0.8.0): a relic given to the Salt Well on an earlier run (RunConfig.wellRelics),
 * one a stock, in turn, among those still to be found this run and not already on offer; null when
 * there's none. No draw, so the loot stream never moves for it.
 */
function wellOffer(world, k, taken) {
  const ids = world.config.wellRelics;
  if (!ids || !ids.length) return null;
  const open = relicAvailable(world).filter((r) => ids.includes(r.id) && !taken.includes(r.id));
  if (!open.length) return null;
  const order = ids.filter((id) => open.some((r) => r.id === id));
  return open.find((r) => r.id === order[k % order.length]);
}

/** Fill his stock for stock number k: a relic (two from Docks level 2, three from level 4), the Well's, food, a reroll, an Ember. */
function restock(world, F, k) {
  F.stock = k;
  const T = world.tuning.ferry, P = T.prices;
  const price = (v) => ferryPrice(world, F, v);
  // Each stock a little better: Trinkets at first, then Charms, then Relics; from the second
  // stock, a tier better again at the Docks' level 5 (never a Relic in the opening stock).
  const bonus = Math.min(2, k) + (F.level >= 5 && k > 0 ? 1 : 0);
  const relics = drawRelics(world, F.level >= 4 ? 3 : F.level >= 2 ? 2 : 1, bonus);
  const tierPrice = [0, P.trinket, P.charm, P.relic];
  const well = wellOffer(world, k, relics.map((r) => r.id));
  // Relics given up for others since his last stock (the slots full) come back with this one.
  const back = world.build.returned.splice(0).filter((id) => !relics.some((r) => r.id === id) && (!well || well.id !== id) && !world.build.relics.some((r) => r.id === id));
  F.offers = [
    ...relics.map((r) => ({ kind: FERRY_KINDS.relic, id: r.id, price: price(tierPrice[r.tier]), sold: false })),
    ...(well ? [{ kind: FERRY_KINDS.relic, id: well.id, price: price(tierPrice[well.tier]), sold: false, well: true }] : []),
    ...back.map((id) => returnedOffer(world, F, world.relicDefs.find((r) => r.id === id))),
    // (The sweep, A5: food does nothing for a character who can't heal. She is sold a second reroll.)
    world.config.noHeal
      ? { kind: FERRY_KINDS.reroll, id: 'reroll', price: price(P.reroll), sold: false }
      : { kind: FERRY_KINDS.food, id: 'food', price: price(P.food), sold: false },
    { kind: FERRY_KINDS.reroll, id: 'reroll', price: price(P.reroll), sold: false },
    { kind: FERRY_KINDS.ember, id: 'ember', price: price(P.ember), sold: false },
  ];
  quoteEmber(world, F);
  world.events.push(EV.FERRY, F.x, F.y, 1, k);
}

/**
 * He calls: casts off from where he was, and ties up at the mooring nearest you that's at least
 * minAway from you (the farthest when none is that far), rowing in from the fog beyond it, with a
 * new stock. `at` (a mooring index; W2's Harpooner calls him early to the post she stands on) names
 * the mooring instead.
 */
export function ferryCall(world, at = -1) {
  const F = world.ferry, T = world.tuning.ferry, p = world.player;
  if (F.moored) world.events.push(EV.FERRY, F.x, F.y, 4, F.mooring);
  let best = -1, bestD = Infinity, far = 0, farD = -1;
  for (let k = 0; k < F.moorings.length; k++) {
    const m = F.moorings[k], dx = m.x - p.x, dy = m.y - p.y, d = dx * dx + dy * dy;
    if (d > farD) { farD = d; far = k; }
    if (d >= T.minAway * T.minAway && d < bestD) { bestD = d; best = k; }
  }
  const k = Number.isInteger(at) && at >= 0 && at < F.moorings.length ? at : best >= 0 ? best : far, m = F.moorings[k];
  F.mooring = k; F.moored = true;
  F.x = m.x; F.y = m.y; F.bx = m.bx; F.by = m.by;
  // He rows in from the fog: from beyond the skiff, away from you.
  const dx = m.bx - p.x, dy = m.by - p.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
  F.fromX = m.bx + (dx / d) * 160; F.fromY = m.by + (dy / d) * 160;
  F.callTick = world.tick;
  F.tiedTick = world.tick + Math.max(1, Math.round(T.rowSec * TPS));
  F.calls++;
  F.nextCall = Math.round((T.firstCall + T.callEvery * F.calls) * world.director.timeScale * TPS);
  F.touch = 0; F.armed = true;
  restock(world, F, F.calls - 1);
  world.events.push(EV.FERRY, F.x, F.y, 3, k, F.calls);
  sightThing(world, SIGHT.FERRY);
}

/**
 * Each tick (after you move): he calls on his schedule, and once he's tied up his ring fills while
 * you're inside it (moving allowed) and opens the trade: once, until you leave the ring and come back.
 */
export function ferryStep(world) {
  const F = world.ferry;
  if (!F) return;
  if (world.tick >= F.nextCall) ferryCall(world);
  if (!F.moored || world.tick < F.tiedTick) return;
  const T = world.tuning.ferry;
  const p = world.player, dx = p.x - F.x, dy = p.y - F.y;
  if (dx * dx + dy * dy > T.radius * T.radius) { F.armed = true; F.touch = 0; return; }
  if (!F.armed) return;
  F.touch += DT;
  if (F.touch + 1e-9 < T.openSec) return;
  F.armed = false;
  F.touch = 0;
  // A relic found elsewhere since he stocked it isn't on offer any more (the screen leaves it out).
  for (const o of F.offers) if (o.kind === FERRY_KINDS.relic && !o.sold && world.build.relics.some((r) => r.id === o.id)) o.gone = true;
  quoteEmber(world, F);
  world.result.ferryTrades++;
  world.halts.push({ kind: 'ferry' });
}

/**
 * The trade's answers: { kind: 'buy', index } (stays open), { kind: 'done' }. The Ember is bought
 * for one weapon: { kind: 'buy', index, slot } names it (the price is emberPrice for it); without
 * a slot it goes to the cheapest (emberQuote, the price the offer shows). Its choice then lists
 * that weapon only (sim/ascend.js openAscensions).
 */
export function ferryDecide(world, d) {
  if (d.kind === 'done') return true;
  if (d.kind !== 'buy') throw new Error(`ferry: expected "buy" or "done", got "${d.kind}"`);
  const F = world.ferry, o = F?.offers[d.index];
  if (!o) throw new Error(`ferry: no offer ${d.index}`);
  if (o.sold) throw new Error('ferry: already bought');
  if (o.gone) throw new Error('ferry: no longer stocked (found since)');
  let slot = -1, price = o.price;
  if (o.kind === FERRY_KINDS.ember) {
    if (d.slot !== undefined && d.slot !== null) {
      if (!emberFits(world, d.slot)) throw new Error(`ferry: the weapon in slot ${d.slot} can't take another Form`);
      slot = d.slot;
    } else slot = emberQuote(world).slot;
    price = emberPrice(world, slot);
  }
  if (world.glass < price) throw new Error(`ferry: needs ${price} Pearls (${world.glass} held)`);
  if (o.kind === FERRY_KINDS.relic && world.build.relics.some((r) => r.id === o.id)) throw new Error('ferry: already carried');
  // The relic slots full (0.9.0): a relic bought gives up a carried one (swap), which goes back to his stock.
  let out = null;
  if (o.kind === FERRY_KINDS.relic && relicsFull(world)) {
    out = world.build.relics.find((r) => r.id === d.swap) ?? null;
    if (!out) throw new Error(`ferry: the relic slots are full; give up a carried relic (swap)${d.swap ? ` (${d.swap} isn't carried)` : ''}`);
  }
  o.price = price;
  o.sold = true;
  addGlass(world, -o.price, F.x, F.y);
  const p = world.player;
  if (o.kind === FERRY_KINDS.relic) {
    const def = world.relicDefs.find((r) => r.id === o.id);
    if (out) swapRelic(world, out, def, returnToFerry); else addRelic(world, def);
  }
  else if (o.kind === FERRY_KINDS.food) heal(world, world.tuning.ferry.foodHeal * (1 + (world.config.harbor?.foodHeal ?? 0)));
  else if (o.kind === FERRY_KINDS.reroll) world.charges.reroll++;
  else if (o.kind === FERRY_KINDS.ember) {
    collectEmber(world, p.x, p.y);   // (an Ember goes on any weapon: ruling 14; the weapon named only sets the price)
  }
  world.result.ferryBought++;
  world.events.push(EV.FERRY, F.x, F.y, 2, d.index);
  quoteEmber(world, F);
  return false;
}

export { FERRY_KINDS };

/** Pearls a kill drops: elites and bosses only (tuning.glass), and only with the Ferryman in the run. */
export function glassFor(world, flags) {
  const T = world.tuning.glass;
  if (!world.pearlsOn) return 0;
  if ((flags & EF.BOSS) !== 0) return T.boss;
  if ((flags & EF.ELITE) !== 0) return T.elite[0] + world.rng.loot.int(T.elite[1] - T.elite[0] + 1);
  return 0;
}
