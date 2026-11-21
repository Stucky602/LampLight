// Harbor Orders (0.9.0; the feats of ARCHITECTURE §10.6, folded into one board at the Tavern).
// The veteran round's meta judge: "feats are few and half pay only materials". Now each order is
// a plain goal, posted by someone in the harbor, that opens exactly one thing: the one piece of
// content whose `unlock` is 'feat:<id>' (tests/content.test.js checks exactly one). The code keeps
// the word "feat"; the screens say Harbor Orders. Ids are permanent (profile.feats holds them), so
// the 14 feats before 0.9.0 keep theirs and an order done before stays done.
//
//   name        the order's name (a label)
//   desc        the goal, one plain sentence
//   group       the board's section: harbor, docks, marsh, tide, weapon, build, character
//   tier        1 to 4: how far into the game it sits (the board sorts by it)
//   by          who posts it (an npc id, data/npcs.js): the source the board names
//   visibility  visible        always on the board
//               after_found    on the board once its `found` part has happened in a run
//               hidden         shows nothing until it's done
//   when        what a run (or the lifetime numbers) must show, every part (meta/feats.js featMet;
//               the keys are listed there as FEAT_KEYS and in work/veteran/W5-CONTRACT.md §2)
//   reward      { unlock: true }: always, since every order opens a thing
//   doneWith    (0.9.0) an older order whose content this one took over: done once that one is, so
//               a save that earned the content keeps it (meta/state.js featsDone)
//   was         (the sweep, C6) ids of orders merged into this one: the same goal had been posted
//               twice. A save that did one under an old id has done this one (meta/state.js featsDone
//               reads it, meta/reconcile.js rewrites it; tests/orders.test.js). An old id is never reused.
// Orders are judged from the first run (the sweep, D3). Until the Tavern keeps the board (its
// level 1) the innkeeper holds what was done (profile.featsHeld), and restoring the Tavern counts
// them; the Chapel's Tide orders (group 'tide') count at once.
// Merged (C6): 'bell_breaker' into 'dawn' (kill the Tidecaller, the Docks' last boss) and 'causeway'
// into 'warden_causeway' (the Drowned Causeway's cache, which only the Bog Warden can raise).
// A name here is never a name the glossary or another kind of thing uses (tests/content.test.js). Counts were set from bots on 0.9.0's pace
// (work/veteran/W5/runstats.txt): a practiced run kills about 25,000 on the Docks (12,000 to 13,000
// Bilge Rats, 170 Gulls, 6 elites, 13 to 15 Embers, 10 lamps and 2 Lantern Nights) and about 22,500
// on the Marsh (2,400 Mire Toads, 110 Creek Eels, 8 to 10 Marsh Herbs, 9 elites).
//
// The sweep, X2 (ruling 13: one board). Set runs (data/challenges.js: an order with `rules`, started
// from the board) and Hunts (data/trophies.js: lifetime kills of one enemy) are orders too, in their
// own sections. Six orders went with what they opened (a one-run tonic) because another order asks
// the same: 'reel_it_in' (the Harpooner has two of her own), 'eel_catcher' and 'toad_hunter' (their
// Hunts), 'high_tide' (the Tide ladder's 4 and 6), 'wreck_diver' (the cache gives its own relic), and
// 'longer_night' (Dawn Over the Docks). 'arcanist' asks for an Heirloom now, as arcana are relics.
//
// W2 adds character orders in orders-characters.js and W8 and W4 content orders in
// orders-content.js; both are appended here.

import { CHARACTER_ORDERS } from './orders-characters.js';
import { CONTENT_ORDERS } from './orders-content.js';
import { MAPS } from './maps.js';
import { SET_RUNS } from './challenges.js';
import { HUNT_ORDERS } from './trophies.js';

const R = { unlock: true };
const DOCKS = 'drowned_docks', MARSH = 'salt_marsh';
/** Every Wayside Lamp a whole run brings on a map: its three acts' (data/maps.js acts). */
const lampsOn = (map) => MAPS.find((m) => m.id === map).acts.reduce((n, a) => n + a.lamps, 0);

/** A Tide order: clear a map at that Tide (the Chapel's; Tides 2, 4, 6, 8, and 10). */
const tide = (map, n, mapName) => ({
  id: `${map === DOCKS ? 'docks' : 'marsh'}_tide_${n}`, name: `${mapName} Tide ${n}`, desc: `Kill the last boss on the ${mapName} at Tide ${n}.`,
  group: 'tide', tier: n <= 4 ? 2 : n <= 8 ? 3 : 4, by: 'warden', visibility: 'visible', when: { cleared: true, map, tide: n }, reward: R,
});

/** A weapon order: kill a boss with that weapon doing the most damage. It opens that weapon as a starting kit for everyone. */
const weapon = (id, name, weaponName, boss, bossName, tier) => ({
  id: `kit_${id}`, name, desc: `Kill ${bossName} with the ${weaponName} doing the most damage.`,
  group: 'weapon', tier, by: 'smith', visibility: 'visible', when: { boss, bossWeapon: id }, reward: R,
});

const OWN = [
  // ---------------------------------------------------------------- the harbor's first orders
  { id: 'maw_slayer', name: 'Maw Slayer', desc: 'Kill the Harbor Maw.', group: 'harbor', tier: 1, by: 'innkeeper', visibility: 'visible', when: { boss: 'harbor_maw' }, reward: R },
  { id: 'dawn', was: ['bell_breaker'], name: 'Bell Breaker', desc: 'Kill the Tidecaller.', group: 'harbor', tier: 1, by: 'dockhand', visibility: 'visible', when: { boss: 'the_tidecaller' }, reward: R },
  { id: 'lantern_night', name: 'First Night', desc: 'Start Lantern Night once: light every Wayside Lamp on the map.', group: 'harbor', tier: 1, by: 'lamp_keeper', visibility: 'visible', when: { lanternNight: true }, reward: R },
  { id: 'bell_ringer', name: 'Bell Ringer', desc: 'Ring 3 Fog Bells in one run.', group: 'harbor', tier: 1, by: 'warden', visibility: 'visible', when: { bells: 3 }, reward: R },
  { id: 'ten_thousand', name: 'Three Thousand', desc: 'Kill 3,000 enemies, counting every run.', group: 'harbor', tier: 1, by: 'cartographer', visibility: 'visible', when: { lifetimeKills: 3000 }, reward: R },
  { id: 'three_forms', name: 'Three Forms', desc: 'Give one weapon all 3 of its Forms in one run.', group: 'harbor', tier: 1, by: 'smith', visibility: 'visible', when: { forms: 3 }, reward: R },
  { id: 'untouched', name: 'Untouched', desc: 'Reach 5:00 without taking a hit.', group: 'harbor', tier: 2, by: 'apothecary', visibility: 'after_found', found: { untouchedSec: 60 }, when: { untouchedSec: 300 }, reward: R },
  { id: 'glass_hoard', name: 'Pearl Hoard', desc: 'Hold 300 Pearls at once.', group: 'harbor', tier: 2, by: 'trader', visibility: 'hidden', when: { seaGlassHeld: 300 }, reward: R },

  // ---------------------------------------------------------------- the Drowned Docks
  { id: 'gull_season', name: 'Gull Season', desc: 'Kill 120 Gulls in one run.', group: 'docks', tier: 1, by: 'dockhand', visibility: 'visible', when: { enemy: { gull: 120 } }, reward: R },
  { id: 'bosun_muster', name: 'All Hands', desc: 'Kill 3 Drowned Bosuns in one run.', group: 'docks', tier: 1, by: 'dockhand', visibility: 'visible', when: { enemy: { drowned_bosun: 3 } }, reward: R },
  { id: 'rat_catcher', name: 'Rat Catcher', desc: 'Kill 15,000 Bilge Rats in one run.', group: 'docks', tier: 2, by: 'innkeeper', visibility: 'visible', when: { enemy: { bilge_rat: 15000 } }, reward: R },
  { id: 'lamp_runner', name: 'Lamp Runner', desc: `Light all ${lampsOn(DOCKS)} Wayside Lamps of the three acts in one run on the Drowned Docks.`, group: 'docks', tier: 2, by: 'lamp_keeper', visibility: 'visible', when: { map: DOCKS, lamps: lampsOn(DOCKS) }, reward: R },
  { id: 'regular', name: 'Regular', desc: 'Buy 4 things from the Ferryman in one run.', group: 'docks', tier: 2, by: 'dockhand', visibility: 'visible', when: { trades: 4 }, reward: R },
  { id: 'relic_hunter', name: 'Relic Hunter', desc: 'Open 5 Reliquaries in one run.', group: 'docks', tier: 1, by: 'cartographer', visibility: 'visible', when: { reliquaries: 5 }, reward: R },
  { id: 'long_night', name: 'Late Hours', desc: 'Stay 5 minutes into overtime.', group: 'docks', tier: 2, by: 'lamp_keeper', visibility: 'visible', when: { overtime: 5 }, reward: R },
  { id: 'quick_trip', name: 'Quick Trip', desc: 'Kill the last boss of a short run.', group: 'docks', tier: 2, by: 'cartographer', visibility: 'visible', when: { mode: 'short', cleared: true }, reward: R },

  // ---------------------------------------------------------------- the Salt Marsh
  { id: 'first_crossing', name: 'First Crossing', desc: 'Reach 5:00 on the Salt Marsh.', group: 'marsh', tier: 1, by: 'dockhand', visibility: 'visible', when: { map: MARSH, surviveSec: 300 }, reward: R },
  { id: 'glass_underfoot', doneWith: 'first_crossing', name: 'Halfway Across', desc: 'Reach 10:00 on the Salt Marsh.', group: 'marsh', tier: 1, by: 'smith', visibility: 'visible', when: { map: MARSH, surviveSec: 600 }, reward: R },
  { id: 'wet_feet', doneWith: 'first_crossing', name: 'Wet Feet', desc: 'Pick 12 Marsh Herbs in one run.', group: 'marsh', tier: 1, by: 'apothecary', visibility: 'visible', when: { herbs: 12 }, reward: R },
  { id: 'lost_lights', doneWith: 'eel_season', name: 'Heron Down', desc: 'Kill the Old Grey.', group: 'marsh', tier: 1, by: 'librarian', visibility: 'visible', when: { boss: 'old_grey' }, reward: R },
  { id: 'quencher', name: 'Quencher', desc: 'Hit 15 burning enemies with Sea or Frost weapons in one run.', group: 'marsh', tier: 1, by: 'apothecary', visibility: 'visible', when: { quenched: 15 }, reward: R },
  { id: 'watchman', name: 'Watchman', desc: 'Stand among 20 enemies for 10s on the Salt Marsh.', group: 'marsh', tier: 2, by: 'warden', visibility: 'visible', when: { map: MARSH, crowdSec: 10 }, reward: R },
  { id: 'marsh_dawn', name: 'Across the Marsh', desc: 'Kill the last boss on the Salt Marsh.', group: 'marsh', tier: 1, by: 'apothecary', visibility: 'visible', when: { cleared: true, map: MARSH }, reward: R },
  // (C6: this was Across the Marsh over again. Both open something real, so it has a goal of its own now: Frost, for the Frost boots it opens.)
  { id: 'widow_slayer', name: 'Widow Slayer', desc: 'Kill the Salt Widow in a run that ends carrying 2 Frost weapons and passives.', group: 'marsh', tier: 2, by: 'smith', visibility: 'visible', when: { boss: 'salt_widow', tag: { frost: 2 } }, reward: R },
  { id: 'eye_of_the_storm', name: 'Storm Hours', desc: 'Reach 19:45 on the Salt Marsh.', group: 'marsh', tier: 1, by: 'warden', visibility: 'visible', when: { map: MARSH, surviveSec: 1185 }, reward: R },
  { id: 'eel_season', name: 'Eel Season', desc: 'Kill the Tidecaller with the Eel Pot at Lv 8 doing the most damage.', group: 'marsh', tier: 2, by: 'innkeeper', visibility: 'after_found', found: { boss: 'the_tidecaller' }, when: { boss: 'the_tidecaller', bossWeapon: 'eel_pot', weaponLevel: 8 }, reward: R },
  { id: 'offering', name: 'Offering', desc: 'Give a relic to the Salt Well.', group: 'marsh', tier: 2, by: 'warden', visibility: 'visible', when: { well: true }, reward: R },

  // ---------------------------------------------------------------- the Chapel's Tides
  tide(DOCKS, 2, 'Drowned Docks'), tide(DOCKS, 4, 'Drowned Docks'), tide(DOCKS, 6, 'Drowned Docks'), tide(DOCKS, 8, 'Drowned Docks'), tide(DOCKS, 10, 'Drowned Docks'),
  tide(MARSH, 2, 'Salt Marsh'), tide(MARSH, 4, 'Salt Marsh'), tide(MARSH, 6, 'Salt Marsh'), tide(MARSH, 8, 'Salt Marsh'), tide(MARSH, 10, 'Salt Marsh'),

  // ---------------------------------------------------------------- weapons (each opens a starting kit for everyone)
  weapon('flare_gun', 'Flare Work', 'Flare Gun', 'harbor_maw', 'the Harbor Maw', 1),
  weapon('lantern_orb', 'Orb Work', 'Lantern Orb', 'harbor_maw', 'the Harbor Maw', 1),
  weapon('harpoon_chain', 'Chain Work', 'Harpoon Chain', 'harbor_maw', 'the Harbor Maw', 1),
  weapon('tide_bell', 'Bell Work', 'Tide Bell', 'harbor_maw', 'the Harbor Maw', 1),
  weapon('signal_mirror', 'Mirror Work', 'Signal Mirror', 'harbor_maw', 'the Harbor Maw', 1),
  weapon('oil_flask', 'Flask Work', 'Oil Flask', 'harbor_maw', 'the Harbor Maw', 1),
  weapon('lightning_rod', 'Rod Work', 'Lightning Rod', 'the_tidecaller', 'the Tidecaller', 2),
  weapon('corpse_candles', 'Candle Work', 'Corpse Candles', 'the_tidecaller', 'the Tidecaller', 2),
  weapon('brine_spring', 'Spring Work', 'Brine Spring', 'old_grey', 'the Old Grey', 2),
  weapon('ice_picks', 'Pick Work', 'Ice Picks', 'old_grey', 'the Old Grey', 2),
  { ...weapon('fog_horn', 'Horn Work', 'Fog Horn', 'old_grey', 'the Old Grey', 2), was: ['kit_fulgurite'] },   // (the Fulgurite's order, ruling 18 WD)
  weapon('eel_pot', 'Pot Work', 'Eel Pot', 'old_grey', 'the Old Grey', 2),
  weapon('anchor_chain', 'Anchor Work', 'Anchor Chain', 'salt_widow', 'the Salt Widow', 3),
  weapon('glass_caltrops', 'Caltrop Work', 'Glass Caltrops', 'salt_widow', 'the Salt Widow', 3),

  // ---------------------------------------------------------------- builds
  { id: 'heavy_iron', name: 'All Steel', desc: 'Finish a run carrying 4 Steel weapons and passives.', group: 'build', tier: 2, by: 'smith', visibility: 'visible', when: { tag: { steel: 4 } }, reward: R },
  { id: 'bright_work', name: 'Bright Work', desc: 'Finish a run carrying 5 Light weapons and passives.', group: 'build', tier: 2, by: 'lamp_keeper', visibility: 'visible', when: { tag: { light: 5 } }, reward: R },
  { id: 'wildfire', name: 'Wildfire', desc: 'Finish a run carrying 5 Fire weapons and passives.', group: 'build', tier: 2, by: 'apothecary', visibility: 'visible', when: { tag: { fire: 5 } }, reward: R },
  { id: 'deep_water', name: 'Deep Water', desc: 'Finish a run carrying 4 Sea weapons and passives.', group: 'build', tier: 2, by: 'dockhand', visibility: 'visible', when: { tag: { sea: 4 } }, reward: R },
  { id: 'frozen_hold', name: 'Frozen Hold', desc: 'Finish a run carrying 3 Frost weapons and passives.', group: 'build', tier: 2, by: 'smith', visibility: 'visible', when: { tag: { frost: 3 } }, reward: R },
  { id: 'rot_and_ruin', name: 'Rot and Ruin', desc: 'Finish a run carrying 3 Rot weapons and passives.', group: 'build', tier: 2, by: 'apothecary', visibility: 'visible', when: { tag: { rot: 3 } }, reward: R },
  { id: 'ring_them_all', name: 'Echoes', desc: 'Finish a run carrying 3 Echo weapons and passives.', group: 'build', tier: 2, by: 'warden', visibility: 'visible', when: { tag: { echo: 3 } }, reward: R },
  { id: 'full_house', name: 'Full House', desc: 'Finish a run with 4 passives at their max level.', group: 'build', tier: 2, by: 'librarian', visibility: 'visible', when: { passivesMax: 4 }, reward: R },
  { id: 'collector', name: 'Collector', desc: 'Finish a run holding 6 relics.', group: 'build', tier: 2, by: 'trader', visibility: 'visible', when: { relics: 6 }, reward: R },
  { id: 'ember_keeper', name: 'Ember Keeper', desc: 'Pick up 18 Embers in one run.', group: 'build', tier: 2, by: 'smith', visibility: 'visible', when: { embers: 18 }, reward: R },
  { id: 'elite_hunter', name: 'Elite Hunter', desc: 'Kill 25 elites in one run.', group: 'build', tier: 2, by: 'innkeeper', visibility: 'visible', when: { elites: 25 }, reward: R },
  { id: 'dash_killer', name: 'Dash Killer', desc: 'Kill 2,500 enemies while dashing in one run.', group: 'build', tier: 3, by: 'innkeeper', visibility: 'visible', when: { dashKills: 2500 }, reward: R },
  { id: 'untouchable', name: 'Untouchable', desc: 'Kill the last boss taking 150 damage or less in the run.', group: 'build', tier: 4, by: 'apothecary', visibility: 'after_found', found: { cleared: true }, when: { cleared: true, damageTakenMax: 150 }, reward: R },
  { id: 'wildfire_night', name: 'Three Nights', desc: 'Start Lantern Night 3 times in one run.', group: 'build', tier: 2, by: 'lamp_keeper', visibility: 'visible', when: { nights: 3 }, reward: R },
  { id: 'cursed', name: 'Bad Luck', desc: 'Kill the last boss with 3 curses on.', group: 'build', tier: 3, by: 'warden', visibility: 'visible', when: { cleared: true, curses: 3 }, reward: R },
  { id: 'arcanist', name: 'Handed Down', desc: 'Kill the last boss in a run that set out with an Heirloom.', group: 'build', tier: 2, by: 'librarian', visibility: 'visible', when: { cleared: true, heirloom: true }, reward: R },
  { id: 'level_100', name: 'Level 50', desc: 'Reach Lv 50 in one run.', group: 'build', tier: 3, by: 'librarian', visibility: 'visible', when: { level: 50 }, reward: R },

  // ---------------------------------------------------------------- the characters (W2 adds more)
  { id: 'long_wick', name: 'Long Wick', desc: 'Kill the last boss on the Drowned Docks at Tide 3 as the Lamplighter.', group: 'character', tier: 2, by: 'lamp_keeper', visibility: 'visible', when: { cleared: true, map: DOCKS, tide: 3, character: 'lamplighter' }, reward: R },
  { id: 'pole_star', name: 'Pole Star', desc: 'Kill the last boss on the Salt Marsh as the Punter.', group: 'character', tier: 3, by: 'cartographer', visibility: 'visible', when: { cleared: true, map: MARSH, character: 'punter' }, reward: R },
  { id: 'bog_host', name: 'Bog Host', desc: 'Raise 60 thralls in one run as the Bog Warden.', group: 'character', tier: 3, by: 'warden', visibility: 'visible', when: { character: 'bog_warden', thralls: 60 }, reward: R },
];

export const FEATS = [...OWN, ...CHARACTER_ORDERS, ...CONTENT_ORDERS, ...SET_RUNS, ...HUNT_ORDERS];

/** The board's sections, in order, with their headings. */
export const ORDER_GROUPS = Object.freeze([
  ['harbor', 'The harbor'], ['docks', 'Drowned Docks'], ['marsh', 'Salt Marsh'], ['tide', 'Tides'],
  ['weapon', 'Weapons'], ['build', 'Builds'], ['character', 'Characters'], ['run', 'Challenge runs'], ['hunt', 'Hunts'],
]);
