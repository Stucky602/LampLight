// Feats (ARCHITECTURE §10.6), listed at the Tavern. Each has a visibility:
//   visible       always listed
//   after_found   listed once its discovery trigger fires (`found`: part of the condition met)
//   hidden        shows nothing until it's done
// `when` is what a run (or your lifetime numbers) must show, every part of it (meta/feats.js):
//   cleared: true        the run cleared the map           tide: n          at Tide n or higher
//   boss: id             that boss killed                  lanternNight     every Wayside Lamp lit
//   bells: n             n Fog Bells rung in one run       forms: n         one weapon with n Forms
//   untouchedSec: n      n seconds before the first hit    seaGlassHeld: n  n Sea Glass held at once
//   lifetimeKills: n     your kills over every run
// reward: { unlock: true } (content keyed 'feat:<id>') and/or { materials }.

export const FEATS = [
  { id: 'dawn', name: 'Dawn', desc: 'Clear the Drowned Docks.', visibility: 'visible', when: { cleared: true }, reward: { materials: { coin: 150, map_scraps: 2 } } },
  { id: 'maw_slayer', name: 'Maw Slayer', desc: 'Kill the Harbor Maw.', visibility: 'visible', when: { boss: 'harbor_maw' }, reward: { materials: { iron: 6 } } },
  { id: 'lantern_night', name: 'Lantern Night', desc: 'Light every Wayside Lamp in one run.', visibility: 'visible', when: { lanternNight: true }, reward: { unlock: true } },
  { id: 'bell_ringer', name: 'Bell Ringer', desc: 'Ring 3 Fog Bells in one run.', visibility: 'visible', when: { bells: 3 }, reward: { unlock: true } },
  { id: 'three_forms', name: 'Three Forms', desc: 'Give a weapon all 3 of its Forms.', visibility: 'visible', when: { forms: 3 }, reward: { materials: { map_scraps: 3 } } },
  { id: 'untouched', name: 'Untouched', desc: 'Reach 5:00 without taking a hit.', visibility: 'after_found', found: { untouchedSec: 60 }, when: { untouchedSec: 300 }, reward: { materials: { rum: 10, coin: 100 } } },
  { id: 'high_tide', name: 'High Tide', desc: 'Clear the Drowned Docks at Tide 5.', visibility: 'visible', when: { cleared: true, tide: 5 }, reward: { materials: { map_scraps: 5, iron: 10 } } },
  { id: 'glass_hoard', name: 'Glass Hoard', desc: 'Hold 200 Sea Glass at once.', visibility: 'hidden', when: { seaGlassHeld: 200 }, reward: { materials: { coin: 300 } } },
  { id: 'ten_thousand', name: 'Ten Thousand', desc: 'Kill 10,000 enemies.', visibility: 'visible', when: { lifetimeKills: 10000 }, reward: { materials: { oil: 100, coin: 200 } } },
];
