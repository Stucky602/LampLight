// Enemies (ARCHITECTURE §5.6, §11). Placeholder roster for the Drowned Docks; the content pass
// for map 1 (Phase 6) renames, re-sprites, and rebalances these.
//
// hp, speed (px/s), contact (damage on touch), mass (knockback divides by it), radius (px),
// xp (gem value). ai.type is one of: chase, swarm, charger, hazard, splitter, ranged_slow.
// Optional ai fields with defaults: splitter burst (0.8, how hard the pieces fly apart);
// ranged_slow reach (1.3, x range at which it starts aiming) and shotRange (1.6, x range a shot
// flies).
// drops: extra material chances on top of the map's common drops.

export const ENEMIES = [
  {
    id: 'fog_wisp', name: 'Fog Wisp', desc: 'Fog that drifts toward light.', sprite: 'en_fog_wisp', tags: ['fog'],
    hp: 5, speed: 44, contact: 4, mass: 0.6, radius: 5, xp: 1,
    ai: { type: 'chase' },
    drops: [],
  },
  {
    id: 'drowned_sailor', name: 'Drowned Sailor', desc: 'Still on watch.', sprite: 'en_sailor', tags: ['undead', 'water'],
    hp: 16, speed: 34, contact: 7, mass: 1, radius: 6, xp: 2,
    ai: { type: 'chase' },
    drops: [{ material: 'rope', chance: 0.012 }, { material: 'drowned_pages', chance: 0.008 }],
  },
  {
    id: 'gull', name: 'Gull', desc: 'A gull the fog got to.', sprite: 'en_gull', tags: ['beast'],
    hp: 3, speed: 78, contact: 3, mass: 0.4, radius: 4, xp: 1,
    ai: { type: 'swarm' },
    drops: [],
  },
  {
    id: 'mud_crab', name: 'Mud Crab', desc: 'Winds up, then runs at you.', sprite: 'en_crab', tags: ['beast', 'water'],
    hp: 34, speed: 24, contact: 9, mass: 1.6, radius: 7, xp: 3,
    ai: { type: 'charger', range: 120, windup: 0.8, dashSpeed: 230, dashTime: 0.55, recover: 0.9 },
    drops: [{ material: 'timber', chance: 0.02 }],
  },
  {
    id: 'bloater', name: 'Bloater', desc: 'Bursts into rats when it dies.', sprite: 'en_bloater', tags: ['undead', 'water'],
    hp: 40, speed: 22, contact: 8, mass: 1.5, radius: 8, xp: 3,
    ai: { type: 'splitter', into: 'bilge_rat', count: 3 },
    drops: [{ material: 'rum', chance: 0.02 }],
  },
  {
    id: 'bilge_rat', name: 'Bilge Rat', desc: 'Fast and weak. Comes in packs.', sprite: 'en_rat', tags: ['beast'],
    hp: 6, speed: 52, contact: 4, mass: 0.5, radius: 4, xp: 1,
    ai: { type: 'chase' },
    drops: [],
  },
  {
    id: 'lantern_eater', name: 'Lantern Eater', desc: 'Spits pools of black water. Watch the rings.', sprite: 'en_lantern_eater', tags: ['fog'],
    hp: 60, speed: 20, contact: 10, mass: 2, radius: 8, xp: 5,
    ai: { type: 'hazard', every: 5, radius: 22, warn: 0.9, last: 3, damage: 6, range: 150 },
    drops: [{ material: 'drowned_pages', chance: 0.03 }],
  },
  {
    id: 'wreck_gunner', name: 'Wreck Gunner', desc: 'Lobs slow cannonballs. Easy to see coming.', sprite: 'en_gunner', tags: ['undead'],
    hp: 45, speed: 26, contact: 8, mass: 1.4, radius: 7, xp: 5,
    ai: { type: 'ranged_slow', range: 190, every: 3.5, warn: 0.8, speed: 70, damage: 6, radius: 5 },
    drops: [{ material: 'timber', chance: 0.03 }],
  },
  {
    id: 'drowned_bosun', name: 'Drowned Bosun', desc: 'Keeps the drowned in line.', sprite: 'en_bosun', tags: ['undead', 'water'],
    hp: 60, speed: 30, contact: 12, mass: 3, radius: 7, xp: 8,
    ai: { type: 'chase' },
    drops: [{ material: 'rope', chance: 0.2 }],
  },
  {
    id: 'harbor_maw', name: 'The Harbor Maw', desc: 'The thing under the pier.', sprite: 'boss_maw', tags: ['boss', 'water'],
    hp: 3500, speed: 30, contact: 15, mass: 60, radius: 20, xp: 120,
    ai: { type: 'boss' }, boss: 'harbor_maw',
    drops: [{ material: 'iron', chance: 1, amount: [3, 5] }, { material: 'map_scraps', chance: 1, amount: [1, 2] }, { material: 'drowned_pages', chance: 1, amount: [4, 6] }],
  },
  {
    id: 'the_tidecaller', name: 'The Tidecaller', desc: 'Rings a bell that brings the tide in.', sprite: 'boss_tidecaller', tags: ['boss', 'water'],
    hp: 11000, speed: 34, contact: 20, mass: 80, radius: 22, xp: 250,
    ai: { type: 'boss' }, boss: 'the_tidecaller',
    drops: [{ material: 'iron', chance: 1, amount: [5, 8] }, { material: 'map_scraps', chance: 1, amount: [2, 3] }, { material: 'rum', chance: 1, amount: [3, 5] }],
  },
];
