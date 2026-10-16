// The Apothecary's wares (ARCHITECTURE §10.6): bought in the harbor, taken into a run from the
// gate (as many as the Apothecary's level allows, data/buildings.js consumableSlots), used up when
// the run starts. Each is stat modifiers for the run (as a passive's), or a start: Sea Glass in
// hand at 0:00. Where each comes from is its `unlock`.

export const CONSUMABLES = [
  { id: 'smelling_salts', name: 'Smelling Salts', desc: '+1 Revival this run.', icon: 'item_salts', cost: { rum: 3, oil: 10, coin: 20 }, unlock: 'building:apothecary:1', mods: [{ stat: 'revival', op: 'add', value: 1 }] },
  { id: 'tallow_tonic', name: 'Tallow Tonic', desc: '+15% XP this run.', icon: 'item_tonic', cost: { oil: 15, coin: 20 }, unlock: 'building:apothecary:1', mods: [{ stat: 'growth', op: 'pct', value: 0.15 }] },
  { id: 'gull_bone', name: 'Gull Bone', desc: '+2 Rerolls this run.', icon: 'item_bone', cost: { timber: 5, coin: 30 }, unlock: 'building:apothecary:2', mods: [{ stat: 'reroll', op: 'add', value: 2 }] },
  { id: 'black_pebble', name: 'Black Pebble', desc: '+1 Banish this run.', icon: 'item_pebble', cost: { rope: 5, coin: 30 }, unlock: 'building:apothecary:2', mods: [{ stat: 'banish', op: 'add', value: 1 }] },
  { id: 'driftwood_token', name: 'Driftwood Token', desc: '+2 Skips this run.', icon: 'item_token', cost: { timber: 5, coin: 25 }, unlock: 'building:apothecary:2', mods: [{ stat: 'skip', op: 'add', value: 2 }] },
  { id: 'tar_salve', name: 'Tar Salve', desc: '+25 Max HP this run.', icon: 'item_salve', cost: { oil: 10, rope: 6, coin: 20 }, unlock: 'research:herb_notes', mods: [{ stat: 'maxHp', op: 'add', value: 25 }] },
  { id: 'lodestone_dust', name: 'Lodestone Dust', desc: '+30% Pickup Range this run.', icon: 'item_dust', cost: { iron: 1, coin: 25 }, unlock: 'research:herb_notes', mods: [{ stat: 'magnet', op: 'pct', value: 0.3 }] },
  { id: 'glass_pouch', name: 'Glass Pouch', desc: 'Start the run with 20 Sea Glass.', icon: 'item_pouch', cost: { rum: 4, coin: 40 }, unlock: 'building:apothecary:4', start: { seaGlass: 20 } },
];
