// Characters (ARCHITECTURE §5.12, §11). Each has a unique mechanic (a hook in
// src/sim/hooks.js), not only a different starting weapon (brief §5.4).
// base: player stats that differ from tuning.player.stats. innate: a character-only weapon
// that doesn't take one of the 6 slots. hubLine: what they say waiting on the harbor's square
// (everyone but the one you walk as, data/hub.js avatar).

export const CHARACTERS = [
  {
    id: 'lamplighter', name: 'Lamplighter', desc: 'Carries a lamp that burns nearby enemies. The lamp grows as she levels up.', sprite: 'pc_lamplighter',
    start: 'flare_gun', innate: 'lamplight',
    base: { maxHp: 100 },
    mechanic: { hook: 'lamplighter', params: { areaPerLevel: 0.025, damagePerLevel: 0.02 } },
    unlock: 'starter',
  },
  {
    id: 'harpooner', name: 'Harpooner', desc: 'Pulls enemies in and dazes them for 0.4s. Gains Armor for each enemy close by.', sprite: 'pc_harpooner',
    start: 'harpoon_chain', innate: null,
    base: { maxHp: 110, moveSpeed: 0.95 },
    // daze: seconds an enemy she hits can't walk or hurt her (bosses are immune).
    mechanic: { hook: 'harpooner', params: { armorPerNear: 0.2, nearRadius: 40, cap: 10, pull: 0.6, daze: 0.4 } },
    unlock: 'building:tavern:1',
    // What she says on the square when you walk up to her (the harbor, Phase 5).
    hubLine: 'Tide\'s turning. Say the word and I\'ll head out.',
  },
];
