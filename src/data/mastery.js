// Character mastery (ARCHITECTURE §10.6). Every run gives the character you played mastery XP
// (tuning.mastery: a point a minute survived plus some for each boss killed). Ranks 1 to 6 come at
// tuning.mastery.ranks; a rank opens that character's perk of that rank, trained at the Tavern for
// materials (once the Tavern reaches level 2), and rank 4 opens their other starting kit.

export const PERKS = [
  { id: 'trimmed_wick', character: 'lamplighter', rank: 1, name: 'Trimmed Wick', desc: '+10% Area.', mods: [{ stat: 'area', op: 'pct', value: 0.1 }], cost: { coin: 80, rum: 4 } },
  { id: 'oil_reserve', character: 'lamplighter', rank: 3, name: 'Oil Reserve', desc: '+15 Max HP.', mods: [{ stat: 'maxHp', op: 'add', value: 15 }], cost: { coin: 160, rum: 8, iron: 3 } },
  { id: 'night_walker', character: 'lamplighter', rank: 5, name: 'Night Walker', desc: '+8% Move Speed.', mods: [{ stat: 'moveSpeed', op: 'pct', value: 0.08 }], cost: { coin: 260, rum: 14, map_scraps: 3 } },
  { id: 'iron_grip', character: 'harpooner', rank: 1, name: 'Iron Grip', desc: '+10% Damage.', mods: [{ stat: 'might', op: 'pct', value: 0.1 }], cost: { coin: 80, rum: 4 } },
  { id: 'tough_hide', character: 'harpooner', rank: 3, name: 'Tough Hide', desc: '+1 Armor.', mods: [{ stat: 'armor', op: 'add', value: 1 }], cost: { coin: 160, rum: 8, iron: 3 } },
  { id: 'long_line', character: 'harpooner', rank: 5, name: 'Long Line', desc: '+20% Pickup Range.', mods: [{ stat: 'magnet', op: 'pct', value: 0.2 }], cost: { coin: 260, rum: 14, map_scraps: 3 } },
];

/** Each character's other starting kit: a different first weapon, from mastery rank 4. */
export const KITS = [
  { id: 'lamplighter_orb', character: 'lamplighter', rank: 4, name: 'Orb Kit', start: 'lantern_orb', desc: 'Start with the Lantern Orb instead of the Flare Gun.' },
  { id: 'harpooner_bell', character: 'harpooner', rank: 4, name: 'Bell Kit', start: 'tide_bell', desc: 'Start with the Tide Bell instead of the Harpoon.' },
];
