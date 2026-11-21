// The Lamp Post's upgrades (ARCHITECTURE §10.4; brief §6.1): the permanent stat tree, and the
// only place the meta adds bigger numbers. Every upgrade is capped (a few ranks) and small, and
// most of what the harbor opens adds new things instead (brief §6: "most unlocks add new things,
// not bigger numbers").
//
// tier: the tier it's in (the Lamp Post's levels open tiers: buildings.js tree). ranks: how many
// times it can be bought. mods: what one rank adds, as stat modifiers (sim/stats.js), applied to
// every run from 0:00. cost: the price of rank 1; rank r costs r times as much.
//
// The cap (tests/content.test.js): at its last rank, no upgrade is worth more than 25%: a percent
// of at most 25, 25 health on the base 100, or 1 armor (a quarter of the first enemy's 4-damage
// hit). Second Wind, the last tier's one revival, is the exception by design.
//
// The prices are the pacing simulator's (tools/pacing; ARCHITECTURE §10.3): 0.8.0's refit put every
// rank at four times its common materials and twice its Iron and Map Scraps.

export const UPGRADES = [
  // Tier 1: the Lamp Post's first level.
  { id: 'bright_flame', name: 'Brighter Flame', desc: '+5% Damage per rank.', tier: 1, ranks: 5, mods: [{ stat: 'might', op: 'pct', value: 0.05 }], cost: { oil: 95, coin: 70 } },
  { id: 'thick_blood', name: 'Thick Blood', desc: '+5 Max HP per rank.', tier: 1, ranks: 5, mods: [{ stat: 'maxHp', op: 'add', value: 5 }], cost: { oil: 95, coin: 70 } },
  { id: 'long_reach', name: 'Long Reach', desc: '+8% Pickup Range per rank.', tier: 1, ranks: 3, mods: [{ stat: 'magnet', op: 'pct', value: 0.08 }], cost: { oil: 70, coin: 95 } },
  // Tier 2.
  { id: 'quick_step', name: 'Quick Step', desc: '+3% Move Speed per rank.', tier: 2, ranks: 3, mods: [{ stat: 'moveSpeed', op: 'pct', value: 0.03 }], cost: { oil: 140, coin: 120 } },
  { id: 'tide_luck', name: 'Scavenger', desc: '+5% Materials per rank.', tier: 2, ranks: 5, mods: [{ stat: 'greed', op: 'pct', value: 0.05 }], cost: { oil: 140, coin: 140 } },
  { id: 'keen_eye', name: 'Keen Eye', desc: '+4% XP Gain per rank.', tier: 2, ranks: 5, mods: [{ stat: 'growth', op: 'pct', value: 0.04 }], cost: { oil: 120, coin: 140 } },
  // Tier 3.
  { id: 'salt_skin', name: 'Salt Skin', desc: '+1 Armor.', tier: 3, ranks: 1, mods: [{ stat: 'armor', op: 'add', value: 1 }], cost: { oil: 480, coin: 360, rope: 70 } },
  { id: 'wide_glow', name: 'Wide Glow', desc: '+5% Area per rank.', tier: 3, ranks: 3, mods: [{ stat: 'area', op: 'pct', value: 0.05 }], cost: { oil: 200, coin: 200 } },
  // Tier 4.
  { id: 'old_clockwork', name: 'Old Clockwork', desc: '-3% Cooldown per rank.', tier: 4, ranks: 4, mods: [{ stat: 'cooldown', op: 'pct', value: -0.03 }], cost: { oil: 320, coin: 320, iron: 8 } },
  // Tier 5.
  { id: 'second_wind', name: 'Second Wind', desc: '+1 Revival.', tier: 5, ranks: 1, mods: [{ stat: 'revival', op: 'add', value: 1 }], cost: { oil: 1450, coin: 1200, map_scraps: 10 } },
];
