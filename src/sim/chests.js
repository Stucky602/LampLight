// Chests (ARCHITECTURE §5.8, §5.11).
//
// Elites drop a chest with 1 item. Bosses drop a chest with 1, 3, or 5 items (luck shifts the
// odds toward more). Items are level-ups of owned weapons and passives (where a rune was, ruling
// 14: a weapon upgrade at Rare or better, tuning.chests.rareChance); relics come from Reliquaries,
// the vault, and the Ferryman instead (sim/relics.js), and a map's secret cache holds its own.
// Everything applies at once; the chest halt is for the reel on screen.
//
// Evolutions are gone (0.9.0, the lead's ruling 1): Forms are the only way a weapon transforms
// (sim/ascend.js). A weapon's level from a chest is one rolled upgrade (ruling 10, sim/weaponups.js,
// on the loot stream), and like every weapon level-up it can open an axis of its Forms.

import { PK, EF, DT } from './constants.js';
import { NO_CHEST } from './enemies.js';
import { EV } from './events.js';
import { spawnPickup, addMaterial } from './pickups.js';
import { applyCard } from './draft.js';
import { heal } from './player.js';
import { runHooks } from './hooks.js';
import { markStatsDirty, addRelic, relicsFull } from './build.js';
import { giveUpgrade, isDrafted } from './ascend.js';
import { canLevelWeapon, rollUpgrade, noteLegendaryOffered } from './weaponups.js';

export const CHEST_ELITE = 1;
export const CHEST_BOSS = 2;
export const CHEST_SECRET = 3;
/** A rung Fog Bell's chest (0.8.2, idea 3): a pick of a weapon or passive to gain levels. */
export const CHEST_BELL = 4;

/** A chest on the ground where an elite or boss fell. */
export function dropChest(world, x, y, kind) {
  spawnPickup(world, PK.CHEST, x, y, kind, 0);
}

// (stub, 0.9.0) The evolutions are gone; these stay until the screens stop asking (W1-CONTRACT.md §4).
/** No weapon evolves: -1. */
export function evolvableSlot() { return -1; }
/** No weapon evolves: false. */
export function canEvolve() { return false; }
/** Nothing is ever ready to evolve: false. */
export function showsReady() { return false; }
/** Nothing evolves: -1. */
export function evolveOne() { return -1; }

function ownedLevelUps(world) {
  const out = [];
  for (let s = 0; s < world.build.weaponSlots; s++) {
    const slot = world.slots[s];
    // (A character's own weapon grows on its own track, never from a chest.)
    if (isDrafted(slot) && canLevelWeapon(world, slot)) out.push({ kind: 'weapon', id: slot.def.id, slot: s, level: slot.level + 1, isNew: false });
  }
  for (const ps of world.build.passives) {
    if (ps.level < ps.def.maxLevel) out.push({ kind: 'passive', id: ps.def.id, level: ps.level + 1, isNew: false });
  }
  return out;
}

function rollItem(world) {
  const rng = world.rng.loot, T = world.tuning.chests;
  // (Where a chest once held a rune: an item is Rare or better this often, when a weapon can take it.)
  const fine = rng.chance(T.rareChance);
  const ups = ownedLevelUps(world);
  if (ups.length) {
    const weapons = ups.filter((c) => c.kind === 'weapon');
    let c = fine && weapons.length ? weapons[rng.int(weapons.length)] : ups[rng.int(ups.length)];
    if (c.kind === 'weapon') {
      const u = rollUpgrade(world, c.slot, rng, null, fine ? { min: 2 } : null);   // its upgrade, rolled on the loot stream
      if (u.up === 'special') noteLegendaryOffered(world, c.slot);
      c = { ...c, ...u };
    }
    applyCard(world, c);
    return c;
  }
  // Nothing to level (no weapon carried, every passive maxed): coin or a heal.
  // (A character who can't heal always takes the Coin; the roll is still drawn, so the stream stays in step.)
  if (rng.chance(0.5) || world.config.noHeal) {
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
 * Open a chest: roll and apply its items, and queue the reel. A boss
 * chest rolls 1, 3, or 5 items, an elite's 1.
 */
export function openChest(world, kind, x, y) {
  if (kind === CHEST_BELL) { openBellChest(world, x, y); return; }
  const items = [];
  const at = world.halts.length;   // the chest's reel shows before any Form choice its items earn (S1)
  const count = kind === CHEST_BOSS ? bossItemCount(world) : 1;
  for (let k = 0; k < count; k++) items.push(rollItem(world));
  finishChest(world, kind, x, y, items, at);
}

/**
 * A rung bell's chest (idea 3): a pick (the `bellpick` halt) of a weapon or passive you carry that
 * can level, to gain tuning.tasks.bell.levels levels (a weapon's: that many rolled upgrades, on the
 * loot stream when picked; ruling 10); with nothing to level, Coin, as any chest.
 */
function openBellChest(world, x, y) {
  const options = bellOptions(world);
  if (!options.length) { const at = world.halts.length; finishChest(world, CHEST_BELL, x, y, [rollItem(world)], at); return; }
  world.result.chests++;
  world.events.push(EV.CHEST, x, y, CHEST_BELL, 1);
  runHooks(world, 'onChestOpen', CHEST_BELL, []);
  world.halts.push({ kind: 'bellpick', x, y, options });
}

/** What a bell's pick offers: each weapon (in slot order) that can level, then each passive (in the order taken) that isn't maxed. */
export function bellOptions(world) {
  const n = world.tuning.tasks.bell.levels, out = [];
  for (let s = 0; s < world.build.weaponSlots; s++) {
    const sl = world.slots[s];
    if (isDrafted(sl) && canLevelWeapon(world, sl)) out.push({ kind: 'weapon', id: sl.def.id, slot: s, from: sl.level, to: sl.level + n });
  }
  world.build.passives.forEach((ps, k) => {
    if (ps.level < ps.def.maxLevel) out.push({ kind: 'passive', id: ps.def.id, slot: k, from: ps.level, to: Math.min(ps.def.maxLevel, ps.level + n) });
  });
  return out;
}

/** The bell's pick: { kind: 'pick', index }: that one gains its levels. Returns true (done). */
export function bellPickDecide(world, h, d) {
  if (d.kind !== 'pick') throw new Error(`bellpick: expected "pick", got "${d.kind}"`);
  const o = h.options[d.index];
  if (!o) throw new Error(`bellpick: no option ${d.index}`);
  if (o.kind === 'weapon') {
    const sl = world.slots[o.slot];
    if (!sl || sl.def.id !== o.id) throw new Error(`bellpick: ${o.id} isn't in slot ${o.slot}`);
    // Its levels, each a rolled upgrade (the loot stream) and a step of Form progress. The halt keeps what was rolled (h.rolled), for the screen.
    h.rolled = [];
    for (let k = o.from; k < o.to; k++) {
      const u = rollUpgrade(world, o.slot, world.rng.loot);
      if (!u) break;
      giveUpgrade(world, o.slot, u);
      h.rolled.push(u);
    }
  } else {
    const ps = world.build.passives[o.slot];
    if (!ps || ps.def.id !== o.id) throw new Error(`bellpick: ${o.id} isn't carried`);
    ps.level = Math.min(ps.def.maxLevel, o.to);
  }
  markStatsDirty(world);
  return true;
}

/**
 * `at`: how many halts were queued before the chest's items were rolled. The chest's halt goes in
 * there, ahead of the halts its items queued (a Form choice an item's level earned), so the reel
 * that gave the level shows first (S1's finding 11).
 */
function finishChest(world, kind, x, y, items, at = world.halts.length) {
  world.result.chests++;
  world.events.push(EV.CHEST, x, y, kind, items.length);
  runHooks(world, 'onChestOpen', kind, items);
  // The Lodestone's rule: a chest pulls in every gem on the map. The Salt Ledger: an elite's or a boss's chest gives a Reroll.
  if (world.rules.lodestone) world.magnetAll = Math.max(world.magnetAll, world.tuning.xp.magnetItemPull);
  if (world.rules.saltledger && (kind === CHEST_ELITE || kind === CHEST_BOSS)) world.charges.reroll++;
  world.halts.splice(Math.min(at, world.halts.length), 0, { kind: 'chest', chestKind: kind, items });
  markStatsDirty(world);
}

/**
 * Open a map's secret cache (once a run). It holds the secret's relic while you can take it
 * (not owned, not banished; with the relic slots full, a relic pick of it to swap for); otherwise
 * one chest item. It shows as a chest reel.
 */
export function openCache(world, index) {
  const s = world.secrets[index];
  if (s.open) return;
  s.open = true;
  const relic = world.relicDefs.find((r) => r.id === s.relic) || null;
  const b = world.build;
  const items = [];
  const at = world.halts.length;
  if (relic && !b.relics.includes(relic) && !b.banished.has(`relic:${relic.id}`)) {
    if (relicsFull(world)) {
      // The relic slots full (0.9.0): its relic is a pick to swap one for, or pass.
      world.result.secrets.push(s.id);
      world.events.push(EV.SECRET, s.x, s.y, index);
      world.halts.push({ kind: 'relic', source: 'secret', offer: [relic.id], x: s.x, y: s.y, full: true });
      return;
    }
    addRelic(world, relic);
    items.push({ kind: 'relic', id: relic.id });
  } else items.push(rollItem(world));
  world.result.secrets.push(s.id);
  world.events.push(EV.SECRET, s.x, s.y, index);
  finishChest(world, CHEST_SECRET, s.x, s.y, items, at);
}

/**
 * Where the next chest comes from, for the ready-to-evolve notice (0.7.3): a chest already lying
 * on the map (the nearest), else a living elite or boss that carries one (the nearest), else the
 * next timeline event that pays one (an elite, a muster, a boss, a chest), else overtime's next
 * repeating elite or muster. Plain data (a cold path: the run scene asks while a weapon is ready):
 *   { kind: 'chest', x, y }
 *   { kind: 'elite' | 'boss', handle, enemy: id, x, y }
 *   { kind: 'event', event: 'elite' | 'muster' | 'boss' | 'chest', enemy: id | null, name: string | null, at: run seconds }
 * or null when nothing is coming.
 */
export function nextChestSource(world) {
  const p = world.player, P = world.pickups, E = world.enemies;
  let best = -1, bestD = Infinity;
  for (let i = 0; i < P.count; i++) {
    if (P.kind[i] !== PK.CHEST) continue;
    const dx = P.x[i] - p.x, dy = P.y[i] - p.y, d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = i; }
  }
  if (best >= 0) return { kind: 'chest', x: P.x[best], y: P.y[best] };
  bestD = Infinity;
  for (let i = 0; i < E.count; i++) {
    const f = E.flags[i];
    if ((f & EF.DEAD) !== 0 || (f & (EF.ELITE | EF.BOSS)) === 0 || E.boss[i] === NO_CHEST) continue;
    const dx = E.x[i] - p.x, dy = E.y[i] - p.y, d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = i; }
  }
  if (best >= 0) {
    return { kind: (E.flags[best] & EF.BOSS) !== 0 ? 'boss' : 'elite', handle: E.handle(best), enemy: world.enemyDefs[E.type[best]].id, x: E.x[best], y: E.y[best] };
  }
  const d = world.director;
  for (let k = d.eventIdx; k < d.events.length; k++) {
    const e = d.events[k];
    if (e.event === 'elite' || e.event === 'muster' || e.event === 'boss' || e.event === 'chest') {
      return { kind: 'event', event: e.event, enemy: e.enemy ?? null, name: e.name ?? null, at: e.at };
    }
  }
  if (d.overtime) {
    const reps = world.map.overtime.repeat || [];
    let j0 = -1;
    for (let j = 0; j < reps.length; j++) {
      if (reps[j].event !== 'elite' && reps[j].event !== 'muster') continue;
      if (j0 < 0 || d.otNext[j] < d.otNext[j0]) j0 = j;
    }
    if (j0 >= 0) {
      const r = reps[j0];
      const enemy = r.enemies ? r.enemies[d.otCount[j0] % r.enemies.length] : r.enemy;
      return { kind: 'event', event: r.event, enemy, name: r.name ?? null, at: d.otNext[j0] * DT };
    }
  }
  return null;
}
