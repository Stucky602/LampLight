// Harbor Orders for new run content: weapons, passives, relics, and maps (W8 and W4 add
// here; work/veteran/W5-CONTRACT.md §1). Each entry is an order as data/feats.js describes;
// exactly one piece of content carries unlock: 'feat:<id>' for each. data/feats.js appends this
// list to the board.
//
// W4 (0.9.0): the map orders. Each opens one of a map's deck entries (data/maps.js `deck`, the
// entry whose unlock is 'feat:<id>'), so doing more on a map gives it more to happen. Keys from
// meta/feats.js featMet: act (the act reached), finds (small secrets found), dawnWon (the Long
// Night won), lamps and bells (lit and rung in the run), map.

import { WEAPON_ORDERS } from './orders-weapons.js';

const R = { unlock: true };
const DOCKS = 'drowned_docks', MARSH = 'salt_marsh';

const MAP_ORDERS = [
  { id: 'docks_ghost_ship', name: 'Second Act', desc: 'Reach Act 2 on the Drowned Docks and light 8 Wayside Lamps in the run.',
    group: 'docks', tier: 1, by: 'dockhand', visibility: 'visible', when: { map: DOCKS, act: 2, lamps: 8 }, reward: R },
  { id: 'docks_harbor_master', name: 'Six Bells', desc: 'Ring 6 Fog Bells in one run on the Drowned Docks.',
    group: 'docks', tier: 2, by: 'dockhand', visibility: 'visible', when: { map: DOCKS, bells: 6 }, reward: R },
  { id: 'docks_rat_tide', name: 'Beachcomber', desc: 'Find 3 small secrets in one run on the Drowned Docks.',
    group: 'docks', tier: 2, by: 'cartographer', visibility: 'visible', when: { map: DOCKS, finds: 3 }, reward: R },
  { id: 'docks_press_gang', name: 'Dawn Over the Docks', desc: 'Win the Long Night on the Drowned Docks.',
    group: 'docks', tier: 2, by: 'lamp_keeper', visibility: 'visible', when: { map: DOCKS, dawnWon: true }, reward: R },
  { id: 'marsh_peat_fire', name: 'Marsh Second Act', desc: 'Reach Act 2 on the Salt Marsh and light 7 Wayside Lamps in the run.',
    group: 'marsh', tier: 2, by: 'apothecary', visibility: 'visible', when: { map: MARSH, act: 2, lamps: 7 }, reward: R },
  { id: 'marsh_reed_cutters', name: 'Mudlark', desc: 'Find 3 small secrets in one run on the Salt Marsh.',
    group: 'marsh', tier: 2, by: 'cartographer', visibility: 'visible', when: { map: MARSH, finds: 3 }, reward: R },
  { id: 'marsh_leech_bloom', name: 'Third Act', desc: 'Reach Act 3 on the Salt Marsh.',
    group: 'marsh', tier: 2, by: 'warden', visibility: 'visible', when: { map: MARSH, act: 3 }, reward: R },
  { id: 'marsh_midge_summer', name: 'Dawn Over the Marsh', desc: 'Win the Long Night on the Salt Marsh.',
    group: 'marsh', tier: 3, by: 'lighthouse_keeper', visibility: 'visible', when: { map: MARSH, dawnWon: true }, reward: R },
];

// C3 (ruling 18 P1): each drafted weapon's two orders past its kit order (data/orders-weapons.js).
export const CONTENT_ORDERS = [...MAP_ORDERS, ...WEAPON_ORDERS];
