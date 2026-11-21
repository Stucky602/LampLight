// The run's build: weapon slots, passives, relics, and the stats they add up to.
//
// Stats are recomputed only when the build changes (ARCHITECTURE §5.9): a card is picked, a
// chest item lands, a Form is taken, a relic arrives, or a hook says so (the Lamplighter's
// light grows each level). markStatsDirty() flags it; rebuildStats() runs at the start of the
// next tick and after every decision.

import { INNATE_SLOT, RELIC_SLOT } from './constants.js';
import { EV } from './events.js';
import { computePlayerStats } from './stats.js';
import { buildSlot, buildRelicSlot } from './weapons.js';
import { addHook, runHooks, removeHook } from './hooks.js';

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
  world.slots[s] = buildSlot(world, s, def, 1, null);
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

/** Take a relic off: out of the build, its hook taken back with everything it did to the run (removeHook). */
function takeOffRelic(world, def) {
  const k = world.build.relics.indexOf(def);
  if (k < 0) throw new Error(`removeRelic: ${def.id} isn't carried`);
  world.build.relics.splice(k, 1);
  if (def.hook) {
    const entry = world.hookEntries.find((e) => e.source === `relic:${def.id}`);
    if (entry) removeHook(world, entry);
  }
  markStatsDirty(world);
}

/**
 * Give a relic up (the Salt Well): taken off, and kept out of every pool for the rest of the run.
 */
export function removeRelic(world, def) {
  takeOffRelic(world, def);
  world.build.banished.add(`relic:${def.id}`);
}

/** Are the relic slots full (0.9.0, ruling 4: world.build.relicSlots)? */
export function relicsFull(world) {
  return world.build.relics.length >= world.build.relicSlots;
}

/**
 * A pick with the relic slots full (0.9.0, ruling 4): `out` (carried) is given up for `inDef` (or
 * for nothing: inDef null). The one given up can be found again this run, and goes back to the
 * Ferryman's stock (sim/relics.js returnToFerry). EV.RELIC_SWAP: a = out, b = in (-1 none).
 */
export function swapRelic(world, out, inDef, returnToFerry) {
  if (!world.build.relics.includes(out)) throw new Error(`relic swap: ${out.id} isn't carried`);
  takeOffRelic(world, out);
  world.result.relicSwaps.push(out.id);
  const p = world.player;
  world.events.push(EV.RELIC_SWAP, p.x, p.y, world.relicDefs.indexOf(out), inDef ? world.relicDefs.indexOf(inDef) : -1);
  if (inDef) addRelic(world, inDef);
  if (returnToFerry) returnToFerry(world, out);
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
  runHooks(world, 'modifyStats', mods);
  return mods;
}

/**
 * The rules the whole build carries now (ruling 14): each passive at its max level (its
 * `keystone`), each relic with a `rule`, and a Form option that is a rule for every weapon (Pitch).
 * The sim reads them as world.rules.<id>.
 */
export function buildRules(world) {
  const R = {};
  for (const ps of world.build.passives) if (ps.def.keystone && ps.level >= ps.def.maxLevel) R[ps.def.keystone.id] = true;
  for (const r of world.build.relics) if (r.rule) R[r.rule] = true;
  for (const slot of world.slots) if (slot && slot.ascensions) for (const a of slot.ascensions) if (a.boost && a.boost.fx && a.boost.fx.pitch) R.pitch = a.boost.fx.pitch.mul ?? 1.25;   // (its multiplier, from the data)
  return R;
}

/** Recompute modifiers, player stats, and every weapon slot, if anything changed. */
export function rebuildStats(world) {
  if (!world.statsDirty) return;
  world.statsDirty = false;
  const old = world.stats;
  world.mods = collectMods(world);
  world.stats = computePlayerStats(world.tuning, world.character.base, world.mods);
  world.rules = buildRules(world);
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
    world.slots[s] = buildSlot(world, s, slot.def, slot.level, null, slot);
  }
  if (!world.slots[RELIC_SLOT]) world.slots[RELIC_SLOT] = buildRelicSlot(world);
}

/**
 * Set up the character: starting weapon (or `startWeapon`, the other kit's), innate weapon,
 * mechanic hook.
 */
export function setupCharacter(world, startWeapon = null) {
  const c = world.character;
  // Mastery perks that change the mechanic arrive as RunConfig.characterParams (meta/runconfig.js).
  if (c.mechanic) addHook(world, c.mechanic.hook, { ...(c.mechanic.params || {}), ...(world.config.characterParams || {}) }, `character:${c.id}`);
  if (c.innate) {
    const def = world.weaponDefs[world.weaponIndex.get(c.innate)];
    world.slots[INNATE_SLOT] = buildSlot(world, INNATE_SLOT, def, 1, null);
  }
  const start = startWeapon || c.start;
  if (start) addWeapon(world, world.weaponDefs[world.weaponIndex.get(start)]);
  markStatsDirty(world);
}
