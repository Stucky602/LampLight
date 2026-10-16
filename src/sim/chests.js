// Chests, runes, and evolutions (ARCHITECTURE §5.8, §5.11).
//
// Elites drop a chest with 1 item. Bosses drop a chest with 1, 3, or 5 items (luck shifts the
// odds toward more), and each item is an evolution first, while any weapon can evolve. Items are level-ups
// of owned weapons and passives, runes (you choose which weapon's open socket gets it: a real
// decision), and a chance at a relic. Everything but runes applies at once; the chest halt is
// for the reel on screen, and each rune queues its own placement decision.
//
// Evolution: a maxed weapon, plus its partner passive at the required level, plus a boss chest,
// becomes the evolved weapon (its own definition).

import { PK } from './constants.js';
import { EV } from './events.js';
import { spawnPickup, addMaterial } from './pickups.js';
import { applyCard } from './draft.js';
import { runeFits, buildSlot } from './weapons.js';
import { heal } from './player.js';
import { runHooks } from './hooks.js';
import { relicAvailable, markStatsDirty, addRelic } from './build.js';

export const CHEST_ELITE = 1;
export const CHEST_BOSS = 2;
export const CHEST_SECRET = 3;

/** A chest on the ground where an elite or boss fell. */
export function dropChest(world, x, y, kind) {
  spawnPickup(world, PK.CHEST, x, y, kind, 0);
}

/** First weapon slot that can evolve now, or -1. */
export function evolvableSlot(world) {
  const b = world.build;
  for (let s = 0; s < b.weaponSlots; s++) {
    const slot = world.slots[s];
    if (!slot || !slot.def.evolution) continue;
    const evo = slot.def.evolution;
    if (slot.level < slot.def.maxLevel) continue;
    const need = Math.max(1, evo.passiveLevel - (world.config.evolutionPassiveReduction || 0));
    const ps = b.passives.find((p) => p.def.id === evo.passive);
    if (!ps || ps.level < need) continue;
    if (!world.weaponIndex.has(evo.into)) continue;
    if (world.slots.some((o) => o && o.def && o.def.id === evo.into)) continue;
    return s;
  }
  return -1;
}

/** Evolve the first eligible weapon. Returns its slot index, or -1 if none can evolve. */
export function evolveOne(world, source) {
  const s = evolvableSlot(world);
  if (s < 0) return -1;
  const slot = world.slots[s];
  const into = world.weaponDefs[world.weaponIndex.get(slot.def.evolution.into)];
  // Runes carry over, in order, while they still fit the new weapon (and the runes before them).
  const runes = new Array(into.runeSlots || 0).fill(null);
  let r = 0;
  for (const rune of slot.runes) if (rune && r < runes.length && runeFits(rune, into, runes, slot.ascensions)) runes[r++] = rune;
  world.build.evolvedFrom.add(slot.def.id);
  world.slots[s] = buildSlot(world, s, into, 1, runes, slot);
  world.result.evolutions.push({ from: slot.def.id, into: into.id, source, tick: world.tick });
  world.result.noteWeaponLevel(into.id, 1);
  const p = world.player;
  world.events.push(EV.EVOLVE, p.x, p.y, s);
  markStatsDirty(world);
  return s;
}

/**
 * Runes that could go somewhere in the current build. `claimed` counts sockets per slot already
 * promised to runes rolled earlier in the same chest, so a chest never rolls more runes than
 * there are sockets for them.
 */
function placeableRunes(world, claimed) {
  const out = [];
  for (const rune of world.pools.runes) {
    if (!(rune.weight > 0)) continue;
    if (freeSocketFor(world, rune, claimed) >= 0) out.push(rune);
  }
  return out;
}

function freeSocketFor(world, rune, claimed) {
  for (const s of openSocketsFor(world, rune)) {
    const open = world.slots[s].runes.filter((r) => r === null).length;
    if (open > (claimed.get(s) || 0)) return s;
  }
  return -1;
}

/** Weapon slots with an open socket where this rune fits (with the runes already there). */
export function openSocketsFor(world, rune) {
  const out = [];
  for (let s = 0; s < world.build.weaponSlots; s++) {
    const slot = world.slots[s];
    if (!slot || !slot.runes.length) continue;
    if (!slot.runes.includes(null)) continue;
    if (!runeFits(rune, slot.def, slot.runes, slot.ascensions)) continue;
    out.push(s);
  }
  return out;
}

function ownedLevelUps(world) {
  const out = [];
  for (let s = 0; s < world.build.weaponSlots; s++) {
    const slot = world.slots[s];
    if (slot && slot.level < slot.def.maxLevel) out.push({ kind: 'weapon', id: slot.def.id, level: slot.level + 1, isNew: false });
  }
  for (const ps of world.build.passives) {
    if (ps.level < ps.def.maxLevel) out.push({ kind: 'passive', id: ps.def.id, level: ps.level + 1, isNew: false });
  }
  return out;
}

function rollItem(world, claimed) {
  const rng = world.rng.loot, T = world.tuning.chests, luck = world.stats.luck;
  const runes = placeableRunes(world, claimed);
  if (runes.length && rng.chance(T.runeChance)) {
    const i = rng.weighted(runes.map((r) => r.weight));
    const s = freeSocketFor(world, runes[i], claimed);
    claimed.set(s, (claimed.get(s) || 0) + 1);
    return { kind: 'rune', id: runes[i].id };
  }
  const relics = relicAvailable(world);
  if (relics.length && rng.chance(T.relicChance * luck)) {
    const i = rng.weighted(relics.map((r) => r.weight ?? 100));
    addRelic(world, relics[i]);
    return { kind: 'relic', id: relics[i].id };
  }
  const ups = ownedLevelUps(world);
  if (ups.length) {
    const c = ups[rng.int(ups.length)];
    applyCard(world, c);
    return c;
  }
  // Everything maxed: coin or a heal.
  if (rng.chance(0.5)) {
    addMaterial(world, world.materialIndex.get('coin'), T.fallbackCoin);
    return { kind: 'coin', id: 'coin', amount: T.fallbackCoin };
  }
  heal(world, T.fallbackHeal);
  return { kind: 'heal', id: 'heal', amount: T.fallbackHeal };
}

function bossItemCount(world) {
  const rng = world.rng.loot, luck = world.stats.luck;
  const table = world.tuning.chests.bossItems;
  // Luck scales the weight of every roll above 1 item.
  const w = table.map(([n, wt]) => (n > 1 ? wt * luck : wt));
  return table[rng.weighted(w)][0];
}

/**
 * Open a chest: roll and apply its items, and queue the reel and any rune placements. A boss
 * chest rolls 1, 3, or 5 items, and each item is an evolution while any weapon can evolve (so
 * a big chest can evolve several), then an ordinary item.
 */
export function openChest(world, kind, x, y) {
  const items = [];
  const claimed = new Map();
  const count = kind === CHEST_BOSS ? bossItemCount(world) : 1;
  for (let k = 0; k < count; k++) {
    const s = kind === CHEST_BOSS ? evolveOne(world, 'chest') : -1;
    if (s >= 0) items.push({ kind: 'evolution', id: world.slots[s].def.id, slot: s });
    else items.push(rollItem(world, claimed));
  }
  finishChest(world, kind, x, y, items);
}

function finishChest(world, kind, x, y, items) {
  world.result.chests++;
  world.events.push(EV.CHEST, x, y, kind, items.length);
  runHooks(world, 'onChestOpen', kind, items);
  world.halts.push({ kind: 'chest', chestKind: kind, items });
  for (const it of items) if (it.kind === 'rune') world.halts.push({ kind: 'rune', rune: it.id });
  markStatsDirty(world);
}

/**
 * Open a map's secret cache (once a run). It holds the secret's relic while you can take it
 * (not owned, not banished); otherwise one ordinary chest item. It shows as a chest reel.
 */
export function openCache(world, index) {
  const s = world.secrets[index];
  if (s.open) return;
  s.open = true;
  const relic = world.relicDefs.find((r) => r.id === s.relic) || null;
  const b = world.build;
  const items = [];
  if (relic && !b.relics.includes(relic) && !b.banished.has(`relic:${relic.id}`)) {
    addRelic(world, relic);
    items.push({ kind: 'relic', id: relic.id });
  } else {
    items.push(rollItem(world, new Map()));
  }
  world.result.secrets.push(s.id);
  world.events.push(EV.SECRET, s.x, s.y, index);
  finishChest(world, CHEST_SECRET, s.x, s.y, items);
}

/** Resolve a rune placement: { kind: 'place', slot } or { kind: 'discard' }. */
export function runeDecide(world, halt, d) {
  const rune = world.runeDefs.find((r) => r.id === halt.rune);
  const p = world.player;
  if (d.kind === 'discard') {
    world.events.push(EV.RUNE, p.x, p.y, world.runeDefs.indexOf(rune), -1);
    return true;
  }
  if (d.kind !== 'place') throw new Error(`rune: unknown decision "${d.kind}"`);
  const open = openSocketsFor(world, rune);
  if (!open.includes(d.slot)) throw new Error(`rune: ${halt.rune} can't go in slot ${d.slot}`);
  const slot = world.slots[d.slot];
  slot.runes[slot.runes.indexOf(null)] = rune;
  world.result.runes.push({ weapon: slot.def.id, rune: rune.id });
  world.events.push(EV.RUNE, p.x, p.y, world.runeDefs.indexOf(rune), d.slot);
  markStatsDirty(world);
  return true;
}

