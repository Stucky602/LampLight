// Enemies (ARCHITECTURE §5.6, §11). Placeholder roster for the Drowned Docks; the content pass
// for map 1 (Phase 6) renames, re-sprites, and rebalances these.
//
// hp, speed (px/s), contact (damage on touch), mass (knockback divides by it), radius (px),
// xp (gem value). ai.type is one of: chase, swarm, charger, hazard, splitter, ranged_slow.
// Optional ai fields with defaults: splitter burst (0.8, how hard the pieces fly apart);
// ranged_slow reach (1.3, x range at which it starts aiming) and shotRange (1.6, x range a shot
// flies).
// drops: extra material chances on top of the map's common drops.
// The Salt Marsh (0.8.0) adds: swims ('amphibious' crosses water, 'water' lives in it), latch
// ({ every, drain }: a leech latches on and drains), crust (half damage until a Frost, Sea, or
// Steel hit cracks it), clump (comes as this many together), loot (x the map's common drop
// chances), well (a muster's captain whose fall opens the Salt Well), stormproof (strikes never
// hurt it: the Salt Widow). AI hopper (a toad: hops, warned by a ring where it lands) and eel
// (waits in the water, warns along a line as long as its lunge, lunges up to `bank` px onto the
// bank, and slides back).
// 0.9.0 (W3): quick (keeps its full speed under tuning.pace.speed: the one fast kind on each map),
// ai.pounce ({ range, warn, speed, dist, lead }: a chaser crouches, warning along a line toward
// where you'll be, at most `dist` long, then leaps along it at `speed`, once), sting (its touch that hurts you slows you, adding up:
// tuning.player.slow). AFFIXES (below): an elite's extra rules (sim/affixes.js).

export const ENEMIES = [
  {
    id: 'fog_wisp', name: 'Fog Wisp', desc: 'Fog that drifts toward light.', sprite: 'en_fog_wisp', tags: ['fog'],
    hp: 5, speed: 44, contact: 4, mass: 0.6, radius: 5, xp: 1,
    ai: { type: 'chase' },
    drops: [],
  },
  {
    id: 'drowned_sailor', name: 'Drowned Sailor', desc: 'A drowned sailor. Walks straight at you.', sprite: 'en_sailor', tags: ['undead', 'water'],
    hp: 16, speed: 34, contact: 7, mass: 1, radius: 6, xp: 2,
    ai: { type: 'chase' },
    drops: [{ material: 'rope', chance: 0.012 }, { material: 'drowned_pages', chance: 0.008 }],
  },
  {
    id: 'gull', name: 'Gull', desc: 'A fog-sick gull. Fast, comes in flocks, and dies to one hit.', sprite: 'en_gull', tags: ['beast'],
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
    id: 'bilge_rat', name: 'Bilge Rat', desc: 'Fast and weak. Comes in packs, and pounces once when close.', sprite: 'en_rat', tags: ['beast'],
    hp: 6, speed: 46, contact: 4, mass: 0.5, radius: 4, xp: 1, quick: true,   // (C1 Nov 17: 52 to 46, and a 1s warning before the pounce: the Docks' 5:00 to 7:00 deaths were mostly rats)
    ai: { type: 'chase', pounce: { range: 90, warn: 1, speed: 240, dist: 110, lead: 1, bite: 8 } },
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
    id: 'drowned_bosun', name: 'Drowned Bosun', desc: 'A big drowned sailor. Slow, and takes many hits.', sprite: 'en_bosun', tags: ['undead', 'water'],
    hp: 60, speed: 30, contact: 12, mass: 3, radius: 7, xp: 8,
    ai: { type: 'chase' },
    drops: [{ material: 'rope', chance: 0.02 }],   // (X3: 0.2 when a Bosun was a rare sight; from 12:00 they come by the thousand, and Rope ran 5 times what it could buy)
  },
  {
    id: 'harbor_maw', name: 'The Harbor Maw', desc: 'The first boss on the Drowned Docks. It lures, slams, calls up its crew, and charges.', sprite: 'boss_maw', tags: ['boss', 'water'],
    hp: 3500, speed: 30, contact: 15, mass: 60, radius: 20, xp: 120,
    ai: { type: 'boss' }, boss: 'harbor_maw',
    drops: [{ material: 'iron', chance: 1, amount: [3, 5] }, { material: 'map_scraps', chance: 1, amount: [1, 2] }, { material: 'drowned_pages', chance: 1, amount: [4, 6] }],
  },
  {
    id: 'the_tidecaller', name: 'The Tidecaller', desc: 'The last boss on the Drowned Docks. It sends a line of water, fans of shots, and pools, then slams and charges.', sprite: 'boss_tidecaller', tags: ['boss', 'water'],
    hp: 11000, speed: 34, contact: 20, mass: 80, radius: 22, xp: 250,
    ai: { type: 'boss' }, boss: 'the_tidecaller',
    drops: [{ material: 'iron', chance: 1, amount: [5, 8] }, { material: 'map_scraps', chance: 1, amount: [2, 3] }, { material: 'rum', chance: 1, amount: [3, 5] }],
  },

  // ---------------------------------------------------------------- the Salt Marsh (0.8.0)
  {
    id: 'midge_cloud', name: 'Midge Cloud', desc: 'A clump of biting midges. They drift at you in threes and dart in once when close. Each bite slows you a little.', sprite: 'en_midges', tags: ['beast'],
    hp: 4, speed: 50, contact: 3, mass: 0.3, radius: 3, xp: 1, clump: 3, loot: 0.4, quick: true, sting: true,
    ai: { type: 'chase', pounce: { range: 80, warn: 0.8, speed: 230, dist: 100, lead: 1, bite: 7 } },
    drops: [],
  },
  {
    id: 'salted_dead', name: 'Salted Dead', desc: 'Drowned in the marsh and crusted with salt. Frost, Sea, and Steel crack the crust.', sprite: 'en_salted_dead', tags: ['undead', 'water'],
    hp: 22, speed: 30, contact: 8, mass: 1.2, radius: 6, xp: 2, crust: true,
    ai: { type: 'chase' },
    drops: [{ material: 'marsh_herbs', chance: 0.008 }],
  },
  {
    id: 'mire_toad', name: 'Mire Toad', desc: 'Hops at you. A ring shows where it will land.', sprite: 'en_mire_toad', tags: ['beast', 'water'],
    hp: 26, speed: 26, contact: 7, mass: 1.2, radius: 6, xp: 3,
    ai: { type: 'hopper', every: 2.2, range: 150, hop: 110, warn: 0.9, radius: 16, damage: 9, creep: 0.35 },
    drops: [{ material: 'marsh_herbs', chance: 0.012 }],
  },
  {
    id: 'creek_eel', name: 'Creek Eel', desc: 'Waits in the high water and lunges along a line as you pass, a short way onto the bank.', sprite: 'en_creek_eel', tags: ['beast', 'water'],
    hp: 30, speed: 30, contact: 9, mass: 1, radius: 6, xp: 3, swims: 'water',
    ai: { type: 'eel', every: 1.6, range: 120, warn: 0.8, lungeSpeed: 260, lungeTime: 0.45, bank: 24, recover: 1 },
    drops: [],
  },
  {
    id: 'leech', name: 'Leech', desc: 'Swims the creeks. Latches on and drains 1 HP every 2s. A dash throws it off.', sprite: 'en_leech', tags: ['beast', 'water'],
    hp: 10, speed: 40, contact: 2, mass: 0.5, radius: 4, xp: 1, swims: 'amphibious', latch: { every: 2, drain: 1 },
    ai: { type: 'chase' },
    drops: [],
  },
  {
    id: 'well_warden', name: 'Well Warden', desc: 'Guards the Salt Well. Throws up walls of salt.', sprite: 'en_well_warden', tags: ['undead', 'water'],
    hp: 70, speed: 30, contact: 13, mass: 3, radius: 7, xp: 8, well: true,
    ai: { type: 'chase' },
    drops: [{ material: 'marsh_herbs', chance: 0.3 }],
  },
  {
    id: 'old_grey', name: 'The Old Grey', desc: 'A giant heron that stabs and leaps. When it lands on mud it gets stuck for a moment. Hit it then.', sprite: 'boss_old_grey', tags: ['boss', 'beast'],
    hp: 6500, speed: 34, contact: 16, mass: 60, radius: 20, xp: 130,
    ai: { type: 'boss' }, boss: 'old_grey',
    drops: [{ material: 'salt_glass', chance: 1, amount: [3, 5] }, { material: 'map_scraps', chance: 1, amount: [1, 2] }, { material: 'marsh_herbs', chance: 1, amount: [4, 6] }],
  },
  {
    id: 'salt_widow', name: 'The Salt Widow', desc: 'The last boss on the Salt Marsh. She sends lightning marching in a line and throws salt shards.', sprite: 'boss_salt_widow', tags: ['boss', 'undead'],
    hp: 30000, speed: 32, contact: 20, mass: 80, radius: 22, xp: 260, stormproof: true,
    ai: { type: 'boss' }, boss: 'salt_widow',
    drops: [{ material: 'salt_glass', chance: 1, amount: [8, 12] }, { material: 'map_scraps', chance: 1, amount: [2, 3] }, { material: 'marsh_herbs', chance: 1, amount: [6, 9] }],
  },
];

// Elite affixes (0.9.0, W3; sim/affixes.js). One an elite, two from Tide 2 (tuning.affixes). Each
// shows on the elite (its icon and color, the view) and in the elite's notice. `bit` is its bit in
// the enemy pool's `affix` field.
export const ELITE_AFFIXES = [
  { id: 'warded', bit: 1, name: 'Shielded', desc: 'Its shield takes 3 hits to break. Until then the elite takes no damage.', icon: 'affix_warded' },
  { id: 'herald', bit: 2, name: 'Herald', desc: 'Comes with 6 of its own kind.', icon: 'affix_herald' },
  { id: 'molten', bit: 4, name: 'Molten', desc: 'Leaves burning ground where it walks.', icon: 'affix_molten' },
  { id: 'tethered', bit: 8, name: 'Tethered', desc: 'Linked to 2 of its own kind. While they live, they share the damage it takes.', icon: 'affix_tethered' },
  { id: 'brine', bit: 16, name: 'Brine', desc: 'Its touch slows you by 30% for 2s.', icon: 'affix_brine' },
];
