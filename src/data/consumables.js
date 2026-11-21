// Run tools (the sweep, ruling 12; ARCHITECTURE §10.6). Bought at the Apothecary, taken into a run
// from the gate's Run tools row (as many as the harbor's slots allow, data/buildings.js
// consumableSlots), and used up as the run sets out. The code keeps the word "consumable" (the save
// holds them under profile.consumables); the screens say run tool.
//
// A run tool does what nothing you wear or train does: a charge for the level-up cards, a Revival,
// something in hand at 0:00. The 35 one-run stat boosts that were here (tonics, tag torches, the
// bestiary's trophies) went: upgrades, gear, and perks give those stats for good. A save that held
// any is paid its price back in materials on load, once (meta/retired.js RETIRED_CONSUMABLES keeps
// the old prices).
//
// Each is stat modifiers for the run (`mods`: reroll, banish, skip, revival), or a `start`
// ({ seaGlass: Pearls in hand, embers: Embers in hand, draftCards: more cards a level-up, foodHeal:
// a share more healing from food }).
// Prices are W5's shares of a practiced run's haul, untouched here (they are tuned later).

export const CONSUMABLES = [
  { id: 'driftwood_token', name: 'Driftwood Token', desc: '+2 Skips this run.', icon: 'item_token', cost: { coin: 60, timber: 10 }, unlock: 'building:apothecary:1', mods: [{ stat: 'skip', op: 'add', value: 2 }] },
  { id: 'gull_bone', name: 'Gull Bone', desc: '+2 Rerolls this run.', icon: 'item_bone', cost: { coin: 60, marsh_herbs: 15 }, unlock: 'feat:maw_slayer', mods: [{ stat: 'reroll', op: 'add', value: 2 }] },
  { id: 'smelling_salts', name: 'Smelling Salts', desc: '+1 Revival this run.', icon: 'item_salts', cost: { coin: 170, rum: 10 }, unlock: 'feat:dawn', mods: [{ stat: 'revival', op: 'add', value: 1 }] },
  { id: 'herb_salve', name: 'Herb Salve', desc: 'Food heals 50% more this run.', icon: 'item_salve', cost: { coin: 95, marsh_herbs: 25 }, unlock: 'building:apothecary:2', start: { foodHeal: 0.5 } },
  { id: 'black_pebble', name: 'Black Pebble', desc: '+1 Banish this run.', icon: 'item_pebble', cost: { coin: 60, rope: 5 }, unlock: 'research:herb_notes', mods: [{ stat: 'banish', op: 'add', value: 1 }] },
  { id: 'spyglass', name: 'Spyglass', desc: 'Level-ups offer 1 more card this run.', icon: 'item_dust', cost: { coin: 120, drowned_pages: 30 }, unlock: 'building:apothecary:4', start: { draftCards: 1 } },
  { id: 'pearl_purse', name: 'Pearl Purse', desc: 'Start the run with 50 Pearls.', icon: 'item_pouch', cost: { coin: 60, rum: 4 }, unlock: 'feat:glass_hoard', start: { seaGlass: 50 } },
  { id: 'ember_tin', name: 'Ember Tin', desc: 'Start the run with 1 Ember.', icon: 'item_tonic', cost: { coin: 200, oil: 80 }, unlock: 'building:lighthouse:9', start: { embers: 1 } },
];
