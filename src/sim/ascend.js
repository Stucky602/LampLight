// Embers and ascensions (ARCHITECTURE §5.16; the ascensions themselves: data/ascensions.js).
//
// An Ember is a rare pickup: every boss drops one, the muster's captain drops one, and an elite
// now and then (tuning.embers.eliteChance). Picking one up adds it to your Embers and, if a
// weapon you carry can still ascend, stops the run for the choice: a weapon and one of its
// line's ascensions, or keep the Ember for later (the pause menu's Ascend spends it then).
// Ascensions stack: with more Embers a weapon can take more of its line's three, and its
// evolution keeps them.

import { EV } from './events.js';
import { PK } from './constants.js';
import { buildSlot, runeShape, ascensionWorks } from './weapons.js';
import { markStatsDirty } from './build.js';

/** weaponId -> its ascension line (data.ascensions), for a world's data. */
export function ascensionLines(data) {
  const m = new Map();
  for (const line of data.ascensions || []) for (const id of line.weapons) m.set(id, line);
  return m;
}

/** The ascensions a slot could still take ([] if none). */
export function openAscensions(world, s) {
  const slot = world.slots[s];
  if (!slot || !slot.def || slot.def.innate) return [];
  const line = world.ascensionLines.get(slot.def.id);
  if (!line) return [];
  // Each once a weapon, and only one that does all it says with the runes it has (Signal Pair's
  // backward shot does nothing on a Backfire or an Orbiting weapon).
  const shape = runeShape(slot.def, slot.runes);
  return line.options.filter((o) => !slot.ascensions.includes(o) && ascensionWorks(o, shape.emit, shape.mirrored, shape.piercesAll));
}

/** Can any weapon you carry ascend now? */
export function canAscend(world) {
  for (let s = 0; s < world.build.weaponSlots; s++) if (openAscensions(world, s).length) return true;
  return false;
}

/** An Ember picked up: count it, and stop for the choice if a weapon can take it. */
export function collectEmber(world, x, y) {
  world.build.embers++;
  world.result.embers++;
  world.events.push(EV.PICKUP, x, y, PK.EMBER, world.build.embers);
  if (canAscend(world)) world.halts.push({ kind: 'ascend' });
}

/**
 * The ascend halt's answer: { kind: 'ascend', slot, id } spends an Ember on that weapon's
 * ascension, { kind: 'keep' } keeps it for later. Returns true (the halt is done).
 */
export function ascendDecide(world, d) {
  if (d.kind === 'keep') return true;
  if (d.kind !== 'ascend') throw new Error(`ascend: expected "ascend" or "keep", got "${d.kind}"`);
  if (world.build.embers <= 0) throw new Error('ascend: no Ember to spend');
  const s = d.slot;
  if (!Number.isInteger(s) || s < 0 || s >= world.build.weaponSlots) throw new Error(`ascend: no weapon slot ${s}`);
  const a = openAscensions(world, s).find((o) => o.id === d.id);
  if (!a) throw new Error(`ascend: the weapon in slot ${s} can't take "${d.id}"`);
  world.build.embers--;
  const slot = world.slots[s];
  const next = { ...slot, ascensions: [...slot.ascensions, a] };
  world.slots[s] = buildSlot(world, s, slot.def, slot.level, slot.runes, next);
  world.result.ascensions.push({ weapon: slot.def.id, id: a.id, tick: world.tick });
  const p = world.player;
  world.events.push(EV.ASCEND, p.x, p.y, s);
  markStatsDirty(world);
  return true;
}

/**
 * The pause menu's Ascend: spend a kept Ember now. Queues the ascend halt (the run stops for it).
 * Throws when there's no Ember or nothing can take one.
 */
export function emberDecide(world) {
  if (world.build.embers <= 0) throw new Error('ember: no Ember kept');
  if (!canAscend(world)) throw new Error('ember: no weapon can ascend');
  if (world.halts.length) throw new Error('ember: wait until nothing else is waiting');
  world.halts.push({ kind: 'ascend' });
}
