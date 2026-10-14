// The RunConfig for a run from the harbor (ARCHITECTURE §10.2 steps 1 and 2): the profile's
// pools (what research and the buildings have added) and the Lamp Post's upgrades as stat
// modifiers from 0:00. Pure; tested in Node. The sim checks what it gets (world.js).

import { resolveContent, rankOf } from './state.js';
import { MetaError } from './actions.js';

/** Every bought upgrade rank as modifiers: one rank's mods times the rank. */
export function upgradeMods(doc, data) {
  const mods = [];
  for (const u of data.upgrades) {
    const r = Math.min(rankOf(doc, u.id), u.ranks);
    if (r > 0) for (const m of u.mods) mods.push({ ...m, value: m.value * r });
  }
  return mods;
}

/**
 * choice: { character, seed, map?, mode? }. Throws MetaError for a character the profile can't
 * play yet.
 */
export function runConfigFor(doc, data, { character, seed, map = data.maps[0].id, mode = 'standard' }) {
  const content = resolveContent(doc, data);
  if (!content.characters.includes(character)) {
    const c = data.characters.find((x) => x.id === character);
    throw new MetaError(c ? `${c.name} hasn't arrived in the harbor yet.` : `There is no character called "${character}".`);
  }
  return {
    seed, map, mode, character,
    pools: { weapons: content.weapons, passives: content.passives, relics: content.relics, runes: content.runes },
    mods: upgradeMods(doc, data),
  };
}
