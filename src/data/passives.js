// Passives (ARCHITECTURE §5.9, §11). Most scale a tag, not "all damage": stacking a tag is a
// build (brief §5.3). levels[L - 1] is the list of modifiers reaching level L adds. Its last level
// also adds a rule (ruling 14): `keystone: { id, desc }`, on while the passive is at its max level
// (world.rules[id], sim/build.js). Most are some weapon's partner: each level makes that weapon's
// capstone hit harder (the weapon's `partner`; nothing is gated on a passive any more).
// Since 0.9.0 a fresh profile holds 8 (twice its 4 passive slots, ruling 3): the tier-1 projects
// that brought Sea Legs, the Lodestone, and the Tallow Candle now bring capstones instead.
// A modifier: { stat, op: 'add' | 'pct' | 'more', value, tags? }.

const each = (n, mods) => Array.from({ length: n }, () => mods);

export const PASSIVES = [
  {
    id: 'wick_oil', name: 'Wick Oil', desc: '+12% Damage (Fire) per level.', icon: 'icon_wick_oil',
    tags: ['fire'], unlock: 'starter', maxLevel: 5, weight: 100,
    keystone: { id: 'wick', desc: 'An enemy that dies burning sets the nearest enemy burning.' },
    levels: each(5, [{ stat: 'might', op: 'pct', value: 0.12, tags: ['fire'] }]),
  },
  {
    id: 'lamp_glass', name: 'Lamp Glass', desc: '+10% Area (Light) per level.', icon: 'icon_lamp_glass',
    tags: ['light'], unlock: 'starter', maxLevel: 5, weight: 100,
    keystone: { id: 'lampglass', desc: 'An enemy hit by a Light weapon takes 10% more damage for 2s.' },
    levels: each(5, [{ stat: 'area', op: 'pct', value: 0.10, tags: ['light'] }]),
  },
  {
    id: 'ballast', name: 'Ballast', desc: '+1 Pierce and +12% Knockback (Steel). Gains Damage as it levels.', icon: 'icon_ballast',
    tags: ['steel'], unlock: 'starter', maxLevel: 5, weight: 100,
    keystone: { id: 'ballast', desc: 'Steel weapons deal 25% more damage to elites and bosses.' },
    levels: [
      [{ stat: 'pierce', op: 'add', value: 1, tags: ['steel'] }, { stat: 'knockback', op: 'pct', value: 0.12, tags: ['steel'] }],
      [{ stat: 'might', op: 'pct', value: 0.1, tags: ['steel'] }],
      [{ stat: 'pierce', op: 'add', value: 1, tags: ['steel'] }, { stat: 'knockback', op: 'pct', value: 0.12, tags: ['steel'] }],
      [{ stat: 'might', op: 'pct', value: 0.1, tags: ['steel'] }],
      [{ stat: 'might', op: 'pct', value: 0.1, tags: ['steel'] }, { stat: 'knockback', op: 'pct', value: 0.12, tags: ['steel'] }],
    ],
  },
  {
    id: 'undertow', name: 'Undertow', desc: '+1 Projectile (Sea). Gains Damage and Duration as it levels.', icon: 'icon_undertow',
    tags: ['sea'], unlock: 'research:signal_codes', maxLevel: 5, weight: 100,
    keystone: { id: 'undertow', desc: 'Sea hits slow enemies by 20% for 1.5s.' },
    levels: [
      [{ stat: 'amount', op: 'add', value: 1, tags: ['sea'] }],
      [{ stat: 'might', op: 'pct', value: 0.1, tags: ['sea'] }],
      [{ stat: 'duration', op: 'pct', value: 0.15, tags: ['sea'] }],
      [{ stat: 'might', op: 'pct', value: 0.1, tags: ['sea'] }],
      [{ stat: 'amount', op: 'add', value: 1, tags: ['sea'] }],
    ],
  },
  {
    id: 'sea_legs', name: 'Sea Legs', desc: '+8% Move Speed per level.', icon: 'icon_sea_legs',
    tags: [], unlock: 'starter', maxLevel: 5, weight: 90,
    keystone: { id: 'sealegs', desc: 'After 2s of moving without a stop, each weapon\'s next hit is a critical hit. At most once every 2s for each weapon.' },
    levels: each(5, [{ stat: 'moveSpeed', op: 'pct', value: 0.08 }]),
  },
  {
    id: 'thick_coat', name: 'Thick Coat', desc: '+15 Max HP per level. +1 Armor at Lv 3 and Lv 5.', icon: 'icon_thick_coat',
    tags: [], unlock: 'starter', maxLevel: 5, weight: 90,
    keystone: { id: 'thickcoat', desc: 'Taking a hit knocks back enemies close to you.' },
    levels: [
      [{ stat: 'maxHp', op: 'add', value: 15 }],
      [{ stat: 'maxHp', op: 'add', value: 15 }],
      [{ stat: 'maxHp', op: 'add', value: 15 }, { stat: 'armor', op: 'add', value: 1 }],
      [{ stat: 'maxHp', op: 'add', value: 15 }],
      [{ stat: 'maxHp', op: 'add', value: 15 }, { stat: 'armor', op: 'add', value: 1 }],
    ],
  },
  {
    id: 'lodestone', name: 'Lodestone', desc: '+12% Pickup Range per level.', icon: 'icon_lodestone',
    tags: [], unlock: 'starter', maxLevel: 5, weight: 80,
    keystone: { id: 'lodestone', desc: 'Opening a chest pulls in every gem on the map.' },
    levels: each(5, [{ stat: 'magnet', op: 'pct', value: 0.12 }]),
  },
  {
    id: 'tallow_candle', name: 'Tallow Candle', desc: '-6% Cooldown per level.', icon: 'icon_tallow_candle',
    tags: [], unlock: 'starter', maxLevel: 5, weight: 90,
    keystone: { id: 'tallow', desc: 'While you stand still, weapons fire 12% faster.' },
    levels: each(5, [{ stat: 'cooldown', op: 'pct', value: -0.06 }]),
  },
  {
    id: 'almanac', name: 'Almanac', desc: '+8% XP Gain per level.', icon: 'icon_almanac',
    tags: [], unlock: 'research:almanac', maxLevel: 5, weight: 80,
    keystone: { id: 'almanac', desc: 'Every 5th level-up gives a Reroll.' },
    levels: each(5, [{ stat: 'growth', op: 'pct', value: 0.08 }]),
  },
  // The Salt Marsh (0.8.0). Hoarfrost, Grave Moss, and Bittern's Call give Frost, Rot, and Echo their
  // first; Copper Wire's hops reach anything that chains.
  {
    id: 'hoarfrost', name: 'Hoarfrost', desc: '+10% Damage and +10% Duration (Frost) per level. Frost statuses last longer too.', icon: 'icon_hoarfrost',
    tags: ['frost'], unlock: 'research:brine_notes', maxLevel: 5, weight: 100,
    keystone: { id: 'hoarfrost', desc: 'Frozen enemies take 25% more damage.' },
    levels: each(5, [{ stat: 'might', op: 'pct', value: 0.1, tags: ['frost'] }, { stat: 'duration', op: 'pct', value: 0.1, tags: ['frost'] }]),
  },
  {
    id: 'copper_wire', name: 'Copper Wire', desc: '+1 Chain every other level. +8% Damage (Light) on the levels between.', icon: 'icon_copper_wire',
    tags: ['light'], unlock: 'research:fulgurite', maxLevel: 5, weight: 100,
    keystone: { id: 'copper', desc: 'The last hit of a chain bursts.' },
    levels: [
      [{ stat: 'hops', op: 'add', value: 1 }],
      [{ stat: 'might', op: 'pct', value: 0.08, tags: ['light'] }],
      [{ stat: 'hops', op: 'add', value: 1 }],
      [{ stat: 'might', op: 'pct', value: 0.08, tags: ['light'] }],
      [{ stat: 'hops', op: 'add', value: 1 }],
    ],
  },
  {
    id: 'grave_moss', name: 'Grave Moss', desc: '+15% Duration and +8% Damage (Rot) per level.', icon: 'icon_grave_moss',
    tags: ['rot'], unlock: 'research:eel_trapper', maxLevel: 5, weight: 100,
    keystone: { id: 'gravemoss', desc: 'An enemy that dies rotting leaves a patch of rot for 2s.' },
    levels: each(5, [{ stat: 'duration', op: 'pct', value: 0.15, tags: ['rot'] }, { stat: 'might', op: 'pct', value: 0.08, tags: ['rot'] }]),
  },
  {
    id: 'bitterns_call', name: "Bittern's Call", desc: '+10% Area (Echo) per level. +1 Projectile (Echo) at Lv 3 and Lv 5.', icon: 'icon_bitterns_call',
    tags: ['echo'], unlock: 'starter', maxLevel: 5, weight: 100,
    keystone: { id: 'bittern', desc: 'Every 4th volley of an Echo weapon fires again at once.' },
    levels: [
      [{ stat: 'area', op: 'pct', value: 0.1, tags: ['echo'] }],
      [{ stat: 'area', op: 'pct', value: 0.1, tags: ['echo'] }],
      [{ stat: 'area', op: 'pct', value: 0.1, tags: ['echo'] }, { stat: 'amount', op: 'add', value: 1, tags: ['echo'] }],
      [{ stat: 'area', op: 'pct', value: 0.1, tags: ['echo'] }],
      [{ stat: 'area', op: 'pct', value: 0.1, tags: ['echo'] }, { stat: 'amount', op: 'add', value: 1, tags: ['echo'] }],
    ],
  },
  {
    id: 'waders', name: 'Waders', desc: '+4% Move Speed and +8% Area (Frost) per level.', icon: 'icon_waders',
    tags: [], unlock: 'feat:wet_feet', maxLevel: 5, weight: 90,
    keystone: { id: 'waders', desc: 'Stand still for 1s and enemies close to you are stunned for 1s. At most once every 4s.' },
    levels: each(5, [{ stat: 'moveSpeed', op: 'pct', value: 0.04 }, { stat: 'area', op: 'pct', value: 0.08, tags: ['frost'] }]),
  },
  {
    id: 'lucky_knot', name: 'Lucky Knot', desc: '+12% Luck per level. More drops, more Reliquaries, and fuller chests.', icon: 'icon_lucky_knot',
    tags: [], unlock: 'research:drowned_charms', maxLevel: 5, weight: 70,
    keystone: { id: 'luckyknot', desc: 'Killing an elite has a 1 in 4 chance to give a Reroll.' },
    levels: each(5, [{ stat: 'luck', op: 'pct', value: 0.12 }]),
  },
];
