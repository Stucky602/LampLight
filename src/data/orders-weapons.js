// Three Harbor Orders a weapon (C3, ruling 18 P1; work/veteran/W5-CONTRACT.md §1). The first is the
// weapon's kit order (data/feats.js `kit_<id>`: kill a boss with it doing the most damage, and any
// character can start with it). These are the other two, for every drafted weapon (a character's
// own weapon grows on its own track and is never a start weapon, so it has none):
//
//   <id>_both      take both options on one of its axes,   opens "Tempered <Name>": a run that sets
//                  across runs (its codex page's ticks)    out with it starts with one of its Rare lines
//                  (ruling 19 PD; it was <id>_capstone, "take a capstone": a save that did that keeps it)
//   <id>_master    clear a map at Tide 3 with it doing     opens "<Name> Early Legendary": its first
//                  the most damage                         Legendary comes at its 6th upgrade, not its 10th
//
// Each opens exactly one thing, keyed 'feat:<order id>' (WEAPON_PERKS below, the content kinds
// 'temper' and 'early': meta/state.js contentKinds; meta/runconfig.js reads them into RunConfig
// `tempered` and `legendaryEarly`). Built from the weapons' data, so a new weapon gets its two.

import { WEAPONS } from './weapons.js';
import { TUNING } from './tuning.js';
import { ASCENSIONS } from './ascensions.js';

const EARLY = TUNING.weaponUps.legendaryFrom, LATE = TUNING.weaponUps.legendary;

const R = { unlock: true };
const drafted = () => WEAPONS.filter((w) => !w.signature && !w.innate);
// A weapon's option pairs, one an axis ([[a, b], ...]), from its Form line.
const pairs = (id) => {
  const line = ASCENSIONS.find((l) => (l.weapons || []).includes(id));
  const by = new Map();
  for (const o of line?.options || []) by.set(o.axis, [...(by.get(o.axis) || []), o.id]);
  return [...by.values()].filter((x) => x.length === 2);
};

/** The weapons' two further orders each. */
export const WEAPON_ORDERS = drafted().flatMap((w) => [
  { id: `${w.id}_both`, was: [`${w.id}_capstone`], name: `${w.name}: Both Forms`, desc: `Take both options of one ${w.name} Form, in any runs.`,   // (RULING-L1: no axes)
    group: 'weapon', tier: 2, by: 'smith', visibility: 'visible', when: { axisBoth: { weapon: w.id, pairs: pairs(w.id) } }, reward: R },
  { id: `${w.id}_master`, name: `${w.name} Mastered`, desc: `Clear a map at Tide 3 with the ${w.name} doing the most damage.`,
    group: 'weapon', tier: 3, by: 'smith', visibility: 'visible', when: { cleared: true, tide: 3, topWeapon: w.id }, reward: R },
]);

/**
 * What those orders open: { id, kind: 'temper' | 'early', weapon, name, desc, unlock }. A run reads
 * them (meta/runconfig.js): a temper for the weapon it sets out with, every early Legendary.
 */
export const WEAPON_PERKS = drafted().flatMap((w) => [
  { id: `temper_${w.id}`, kind: 'temper', weapon: w.id, name: `Tempered ${w.name}`,
    desc: `Runs that start with the ${w.name} start with one of its Rare traits.`, unlock: `feat:${w.id}_both` },
  { id: `early_${w.id}`, kind: 'early', weapon: w.id, name: `${w.name} Early Legendary`,
    desc: `The ${w.name}${/s$/.test(w.name) ? "'" : "'s"} first Legendary trait comes at Lv ${EARLY + 1}, not Lv ${LATE + 1}.`, unlock: `feat:${w.id}_master` },
]);
