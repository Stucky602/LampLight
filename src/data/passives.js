// Passives (ARCHITECTURE §5.9, §11). Most scale a tag, not "all damage": stacking a tag is a
// build (brief §5.3). levels[L - 1] is the list of modifiers reaching level L adds.
// A modifier: { stat, op: 'add' | 'pct' | 'more', value, tags? }.

const each = (n, mods) => Array.from({ length: n }, () => mods);

export const PASSIVES = [
  {
    id: 'wick_oil', name: 'Wick Oil', desc: '+12% Damage (Fire) per level.', icon: 'icon_wick_oil',
    tags: ['fire'], unlock: 'starter', maxLevel: 5, weight: 100,
    levels: each(5, [{ stat: 'might', op: 'pct', value: 0.12, tags: ['fire'] }]),
  },
  {
    id: 'lamp_glass', name: 'Lamp Glass', desc: '+10% Area (Light) per level.', icon: 'icon_lamp_glass',
    tags: ['light'], unlock: 'starter', maxLevel: 5, weight: 100,
    levels: each(5, [{ stat: 'area', op: 'pct', value: 0.10, tags: ['light'] }]),
  },
  {
    id: 'ballast', name: 'Ballast', desc: '+1 Pierce and +12% Knockback (Steel). Gains Damage as it levels.', icon: 'icon_ballast',
    tags: ['steel'], unlock: 'research:ships_ballast', maxLevel: 5, weight: 100,
    levels: [
      [{ stat: 'pierce', op: 'add', value: 1, tags: ['steel'] }, { stat: 'knockback', op: 'pct', value: 0.12, tags: ['steel'] }],
      [{ stat: 'might', op: 'pct', value: 0.1, tags: ['steel'] }],
      [{ stat: 'pierce', op: 'add', value: 1, tags: ['steel'] }, { stat: 'knockback', op: 'pct', value: 0.12, tags: ['steel'] }],
      [{ stat: 'might', op: 'pct', value: 0.1, tags: ['steel'] }],
      [{ stat: 'might', op: 'pct', value: 0.1, tags: ['steel'] }, { stat: 'knockback', op: 'pct', value: 0.12, tags: ['steel'] }],
    ],
  },
  {
    id: 'undertow', name: 'Undertow', desc: '+1 Projectile (Tide). Gains Damage and Duration as it levels.', icon: 'icon_undertow',
    tags: ['tide'], unlock: 'research:tide_charts', maxLevel: 5, weight: 100,
    levels: [
      [{ stat: 'amount', op: 'add', value: 1, tags: ['tide'] }],
      [{ stat: 'might', op: 'pct', value: 0.1, tags: ['tide'] }],
      [{ stat: 'duration', op: 'pct', value: 0.15, tags: ['tide'] }],
      [{ stat: 'might', op: 'pct', value: 0.1, tags: ['tide'] }],
      [{ stat: 'amount', op: 'add', value: 1, tags: ['tide'] }],
    ],
  },
  {
    id: 'sea_legs', name: 'Sea Legs', desc: '+8% Move Speed per level.', icon: 'icon_sea_legs',
    tags: [], unlock: 'starter', maxLevel: 5, weight: 90,
    levels: each(5, [{ stat: 'moveSpeed', op: 'pct', value: 0.08 }]),
  },
  {
    id: 'thick_coat', name: 'Thick Coat', desc: '+15 Max HP per level. +1 Armor at Lv 3 and Lv 5.', icon: 'icon_thick_coat',
    tags: [], unlock: 'starter', maxLevel: 5, weight: 90,
    levels: [
      [{ stat: 'maxHp', op: 'add', value: 15 }],
      [{ stat: 'maxHp', op: 'add', value: 15 }],
      [{ stat: 'maxHp', op: 'add', value: 15 }, { stat: 'armor', op: 'add', value: 1 }],
      [{ stat: 'maxHp', op: 'add', value: 15 }],
      [{ stat: 'maxHp', op: 'add', value: 15 }, { stat: 'armor', op: 'add', value: 1 }],
    ],
  },
  {
    id: 'lodestone', name: 'Lodestone', desc: '+20% Pickup Range per level.', icon: 'icon_lodestone',
    tags: [], unlock: 'starter', maxLevel: 5, weight: 80,
    levels: each(5, [{ stat: 'magnet', op: 'pct', value: 0.2 }]),
  },
  {
    id: 'tallow_candle', name: 'Tallow Candle', desc: '-6% Cooldown per level.', icon: 'icon_tallow_candle',
    tags: [], unlock: 'starter', maxLevel: 5, weight: 90,
    levels: each(5, [{ stat: 'cooldown', op: 'pct', value: -0.06 }]),
  },
  {
    id: 'almanac', name: 'Almanac', desc: '+8% XP per level.', icon: 'icon_almanac',
    tags: [], unlock: 'research:almanac', maxLevel: 5, weight: 80,
    levels: each(5, [{ stat: 'growth', op: 'pct', value: 0.08 }]),
  },
  {
    id: 'lucky_knot', name: 'Lucky Knot', desc: '+12% Luck per level. Better relics, chests, and drops.', icon: 'icon_lucky_knot',
    tags: [], unlock: 'research:almanac', maxLevel: 5, weight: 70,
    levels: each(5, [{ stat: 'luck', op: 'pct', value: 0.12 }]),
  },
];
