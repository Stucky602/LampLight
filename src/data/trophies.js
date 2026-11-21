// Hunts and trophies (the sweep, ruling 13). The bestiary's ladders and the Cartographer's claim
// screen went. Each enemy that isn't a boss has one Hunt on the Harbor Orders board: kill that many
// of it, counting every run (the count is on the codex's enemy page). A Hunt opens that enemy's
// trophy: more damage against it in every run, for good (RunConfig.bestiaryBonus).
//
// The counts are the third rung of the old ladders (where a trophy was claimed), so a save that had
// claimed a trophy has its Hunt done (meta/retired.js). Set from how often each dies in a run: a
// Bilge Rat by the hundred a minute, a Drowned Bosun once a run.

import { ENEMIES } from './enemies.js';

// The sweep, X3 (D4): one run to the dawn finished 7 of the 15 (a Drowned Bosun is an ordinary enemy
// from 12:00 now, 5,900 of them a run). Each count is about 5 to 8 runs to the dawn of that enemy on its
// map (work/sweep/X3/d4.mjs: the kite and follow bots' runs to the dawn, Nov 19), so a Hunt is a long
// goal on the board (tier 3), never a first run's by-product. A save that had done a Hunt keeps it.
export const HUNT_COUNTS = Object.freeze({
  fog_wisp: 8000, drowned_sailor: 70000, bilge_rat: 120000, gull: 4000, bloater: 40000, mud_crab: 40000,
  lantern_eater: 20000, wreck_gunner: 20000, drowned_bosun: 50000,
  midge_cloud: 250000, salted_dead: 90000, leech: 45000, mire_toad: 60000, creek_eel: 1000, well_warden: 200,
});
/** The share more damage a trophy gives against its enemy. */
export const TROPHY_DAMAGE = 0.05;

const PLURAL = Object.freeze({ salted_dead: 'Salted Dead', leech: 'Leeches' });
const plural = (e) => PLURAL[e.id] ?? `${e.name}s`;
const hunted = ENEMIES.filter((e) => HUNT_COUNTS[e.id] !== undefined);
const MARSH_IDS = new Set(['midge_cloud', 'salted_dead', 'leech', 'mire_toad', 'creek_eel', 'well_warden']);

export const TROPHIES = hunted.map((e) => Object.freeze({
  id: e.id, enemy: e.id, name: `${e.name} Trophy`, desc: `+${Math.round(TROPHY_DAMAGE * 100)}% Damage against ${plural(e)} in every run.`,
  icon: e.sprite, damageMul: TROPHY_DAMAGE, unlock: `feat:hunt_${e.id}`,
}));

export const HUNT_ORDERS = hunted.map((e) => ({
  id: `hunt_${e.id}`, name: `${e.name} Hunt`, desc: `Kill ${HUNT_COUNTS[e.id].toLocaleString('en-US')} ${plural(e)}, counting every run.`,
  group: 'hunt', tier: 3, by: 'cartographer', visibility: 'visible', map: MARSH_IDS.has(e.id) ? 'salt_marsh' : 'drowned_docks',
  when: { enemyTotal: { [e.id]: HUNT_COUNTS[e.id] } }, reward: { unlock: true },
}));
