// Weapon upgrade types (ruling 14, C1; work/cw/C1-CONTRACT.md section 3). A weapon has no level
// table: each level-up is one of these, rolled at a rarity (sim/weaponups.js). A weapon's `numbers`
// lists the number types that make sense for it; `line` (its own Rare and Epic behavior lines) and
// `special` (its own Legendary specials) are every weapon's.
//
// min: the lowest rarity it can roll at (an index into DATA.rarities: 0 Common ... 4 Legendary).
// stat: the weapon number it changes. how: 'mul' multiplies what the weapon has now (damage x
//   (1 + value), cooldown x (1 - value)): +20% is +20%; 'add' adds value (area, whose base is 1;
//   amount, pierce, crit). sign -1 takes it away.
// whole: a whole-number type (1 at Uncommon and Rare, 2 at Epic and Legendary).
// The values, the caps, the odds, and the rarity multipliers are numbers in tuning.weaponUps (the
// tuning panel steps them); this file is what each type is.

export const WEAPON_UPS = Object.freeze([
  { id: 'damage', name: 'Damage', desc: 'More damage on every hit.', min: 0, stat: 'damage', how: 'mul', sign: 1 },
  { id: 'cooldown', name: 'Cooldown', desc: 'Fires more often.', min: 0, stat: 'cooldown', how: 'mul', sign: -1, seconds: true },
  { id: 'area', name: 'Area', desc: 'Bigger shots, waves, and pools.', min: 0, stat: 'area', how: 'add', sign: 1, pct: true },
  { id: 'duration', name: 'Duration', desc: 'Its shots and pools last longer.', min: 0, stat: 'duration', how: 'mul', sign: 1, seconds: true },
  { id: 'amount', name: 'Projectile', plural: 'Projectiles', desc: 'One more each volley.', min: 1, stat: 'amount', how: 'add', sign: 1, whole: true },
  { id: 'pierce', name: 'Pierce', desc: 'Each shot passes through one more enemy.', min: 1, stat: 'pierce', how: 'add', sign: 1, whole: true },
  { id: 'crit', name: 'Crit Chance', desc: 'A better chance to land a crit, for 2x damage.', min: 1, stat: 'crit', how: 'add', sign: 1, pct: true },
  { id: 'hit_cooldown', name: 'Hit Delay', desc: 'Hits the same enemy again sooner.', min: 1, stat: 'hitCooldown', how: 'mul', sign: -1, seconds: true },
  // A weapon's own behavior lines (its data's `lines`, each Rare or Epic, once a run) and its
  // Legendary specials (its data's `specials`, once each).
  { id: 'line', name: 'Line', desc: 'One of the weapon\'s own Rare or Epic changes, once a run.', min: 2 },
  { id: 'special', name: 'Special', desc: 'One of the weapon\'s own Legendary changes, once a run.', min: 4 },
].map((x) => Object.freeze(x)));

/** The number types (everything but a line and a special). */
export const NUMBER_UPS = Object.freeze(WEAPON_UPS.filter((x) => x.stat).map((x) => x.id));

/**
 * Types 0.9.0's first builds rolled that are gone (ruling 14): a run's record or a test that still
 * names one reads it as the type beside it, so nothing throws on an old upgrade list.
 */
export const RETIRED_UPS = Object.freeze({ speed: 'damage', knockback: 'damage', crit_mult: 'crit', amount2: 'amount', bundle: 'damage' });
