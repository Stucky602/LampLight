// The run's build: weapon slots, passives, relics, and the stats they add up to.
//
// Stats are recomputed only when the build changes (ARCHITECTURE §5.9): a card is picked, a
// chest item lands, a rune is socketed, a relic arrives, or a hook says so (the Lamplighter's
// light grows each level). markStatsDirty() flags it; rebuildStats() runs at the start of the
// next tick and after every decision.

import { INNATE_SLOT, RELIC_SLOT } from './constants.js';
import { EV } from './events.js';
import { computePlayerStats } from './stats.js';
import { buildSlot, buildRelicSlot } from './weapons.js';
import { addHook, runHooks } from './hooks.js';
import { kindledMods } from './tasks.js';

export function markStatsDirty(world) { world.statsDirty = true; }

/** First free weapon slot index, or -1. */
export function freeWeaponSlot(world) {
  for (let s = 0; s < world.build.weaponSlots; s++) if (!world.slots[s]) return s;
  return -1;
}

/** Add a weapon at level 1 in the first free slot. Returns the slot index or -1. */
export function addWeapon(world, def) {
  const s = freeWeaponSlot(world);
  if (s < 0) return -1;
  world.slots[s] = buildSlot(world, s, def, 1, new Array(def.runeSlots || 0).fill(null));
  world.result.noteWeaponLevel(def.id, 1);
  markStatsDirty(world);
  return s;
}

/** Add a relic: its hook starts working now. */
export function addRelic(world, def) {
  if (!def) throw new Error('addRelic: unknown relic');
  world.build.relics.push(def);
  if (def.hook) addHook(world, def.hook, def.params || {}, `relic:${def.id}`);
  const p = world.player;
  world.events.push(EV.RELIC, p.x, p.y, world.relicDefs.indexOf(def));
  world.result.relics.push(def.id);
  markStatsDirty(world);
}

/** Relics that could still be found this run (in the pool, not owned, not banished). */
export function relicAvailable(world) {
  const b = world.build;
  return world.pools.relics.filter((r) => (r.weight ?? 100) > 0 && !b.relics.some((o) => o.id === r.id) && !b.banished.has(`relic:${r.id}`));
}

/** Every modifier active right now, in a fixed order (so the same build always sums the same way). */
export function collectMods(world) {
  const mods = [];
  const cfg = world.config;
  if (cfg.mods) for (const m of cfg.mods) mods.push(m);            // hub, gear, Tide, curses (Phases 5 and 7)
  for (const ps of world.build.passives) {
    for (let L = 1; L <= ps.level; L++) {
      const list = ps.def.levels[L - 1];
      if (list) for (const m of list) mods.push(m);
    }
  }
  for (const r of world.build.relics) if (r.mods) for (const m of r.mods) mods.push(m);
  if (world.arcanaDef?.mods) for (const m of world.arcanaDef.mods) mods.push(m);   // an arcana's price
  kindledMods(world, mods);                                                        // Wayside Lamps lit
  runHooks(world, 'modifyStats', mods);
  return mods;
}

/** Recompute modifiers, player stats, and every weapon slot, if anything changed. */
export function rebuildStats(world) {
  if (!world.statsDirty) return;
  world.statsDirty = false;
  const old = world.stats;
  world.mods = collectMods(world);
  world.stats = computePlayerStats(world.tuning, world.character.base, world.mods);
  const p = world.player, st = world.stats;
  if (old !== null) {
    // More max HP comes with that much more current HP; less max HP clamps.
    if (st.maxHp > old.maxHp) p.hp += st.maxHp - old.maxHp;
    if (p.hp > st.maxHp) p.hp = st.maxHp;
    // Revivals and draft charges gained mid-run (a relic, a passive) are added to what's left.
    if (st.revival > old.revival) p.revivals += st.revival - old.revival;
    const ch = world.charges;
    for (const k of ['reroll', 'banish', 'skip']) if (st[k] > old[k]) ch[k] += st[k] - old[k];
  }
  for (let s = 0; s < world.slots.length; s++) {
    const slot = world.slots[s];
    if (!slot || s === RELIC_SLOT) continue;
    world.slots[s] = buildSlot(world, s, slot.def, slot.level, slot.runes, slot);
  }
  if (!world.slots[RELIC_SLOT]) world.slots[RELIC_SLOT] = buildRelicSlot(world);
}

/**
 * Set up the character: starting weapon (or `startWeapon`, the other kit's), innate weapon,
 * mechanic hook.
 */
export function setupCharacter(world, startWeapon = null) {
  const c = world.character;
  if (c.mechanic) addHook(world, c.mechanic.hook, c.mechanic.params || {}, `character:${c.id}`);
  if (c.innate) {
    const def = world.weaponDefs[world.weaponIndex.get(c.innate)];
    world.slots[INNATE_SLOT] = buildSlot(world, INNATE_SLOT, def, 1, []);
  }
  const start = startWeapon || c.start;
  if (start) addWeapon(world, world.weaponDefs[world.weaponIndex.get(start)]);
  markStatsDirty(world);
}
