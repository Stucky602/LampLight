// Maps (ARCHITECTURE §5.7, §11). The timeline drives the director:
//   bands   { from, to, roster: { enemyId: weight }, density: [start, end] }: while the clock
//           is in [from, to), keep about `density` enemies alive (rising from start to end),
//           spawning from the roster by weight. The last band keeps going past its `to`.
//   events  { at, event, ... } at a fixed second:
//           elite  { enemy }                  one enemy with the elite modifier (drops a chest)
//           boss   { enemy }                  a boss; the run's two bosses are at 600 and 1200
//           wall   { enemy, count, speed? }   a line from one side: swarmers fly straight across
//           ring   { enemy, count, radius?, speed? }  a ring closing in from just off screen
//           chest  { }                        a chest (one item) on the ground a short walk away
//           muster { name, enemy, escort, count, radius }  an elite captain and a ring of its crew,
//                                             walking in together; the captain drops a boss chest
// secrets: { id, name, at: [col, row], radius, relic } caches hidden on the map. Each opens once
// a run when you reach it: its relic while you can take it, otherwise one chest item. Finding one
// is recorded in the codex as 'secret:<id>', which unlocks content keyed to it (the relic).
// commonDrops apply to every regular enemy; eliteDrops to elites. Coin and oil drop everywhere.
// overtime: after the 20:00 boss the player can stay; every minute these multiply.

const T = (m, s = 0) => m * 60 + s;

export const MAPS = [
  {
    id: 'drowned_docks', name: 'Drowned Docks', desc: 'The flooded harbor front. 20 minutes, 2 bosses.',
    size: [256, 256], ambient: 0.5,
    // A wharf with flooded slips in it (footbridges across the long ones), sheds and crates on it,
    // and a wreck beached in the far northeast with the secret cache aboard (sim/terrain.js
    // buildDocks).
    layout: {
      kind: 'docks', seed: 'drowned_docks_2', clearRadius: 14,
      slips: { count: 34, width: 4, length: [10, 22], apart: 4, bridgeOver: 15, bridge: 4 },
      sheds: { count: 44, size: [6, 4] },
      crates: { count: 240, size: [1, 2] },
      wreck: { at: [212, 40], size: [14, 8] },
    },
    materials: ['timber', 'rope', 'drowned_pages', 'rum'],
    commonDrops: [
      { material: 'coin', chance: 0.02 },
      { material: 'oil', chance: 0.012 },
      { material: 'timber', chance: 0.004 },
      { material: 'drowned_pages', chance: 0.003 },
    ],
    eliteDrops: [
      { material: 'iron', chance: 1, amount: [1, 2] },
      { material: 'map_scraps', chance: 0.5, amount: [1, 1] },
      { material: 'rope', chance: 1, amount: [2, 4] },
    ],
    pickups: { heal: 0.0025, magnet: 0.0008, healAmount: 30 },
    timeline: {
      bands: [
        { from: T(0), to: T(1), roster: { fog_wisp: 1 }, density: [15, 40] },
        { from: T(1), to: T(3), roster: { fog_wisp: 3, drowned_sailor: 1 }, density: [40, 90] },
        { from: T(3), to: T(5), roster: { fog_wisp: 2, drowned_sailor: 2, bilge_rat: 1 }, density: [90, 150] },
        { from: T(5), to: T(7), roster: { drowned_sailor: 3, bilge_rat: 2, mud_crab: 1 }, density: [150, 240] },
        { from: T(7), to: T(10), roster: { drowned_sailor: 3, fog_wisp: 2, mud_crab: 1, bloater: 1 }, density: [240, 380] },
        { from: T(10), to: T(12), roster: { drowned_sailor: 2, bilge_rat: 2, bloater: 2, lantern_eater: 1 }, density: [300, 450] },
        { from: T(12), to: T(15), roster: { drowned_sailor: 3, bilge_rat: 3, bloater: 2, lantern_eater: 1, wreck_gunner: 1 }, density: [450, 700] },
        { from: T(15), to: T(18), roster: { drowned_sailor: 3, bilge_rat: 3, mud_crab: 2, bloater: 2, lantern_eater: 1, wreck_gunner: 1 }, density: [700, 1000] },
        { from: T(18), to: T(20), roster: { drowned_sailor: 4, bilge_rat: 4, mud_crab: 2, bloater: 2, lantern_eater: 1, wreck_gunner: 1 }, density: [1000, 1200] },
      ],
      events: [
        { at: T(2, 30), event: 'wall', enemy: 'gull', count: 30 },
        { at: T(4), event: 'ring', enemy: 'fog_wisp', count: 40 },
        { at: T(5), event: 'elite', enemy: 'drowned_bosun' },
        { at: T(6, 30), event: 'wall', enemy: 'gull', count: 40 },
        { at: T(8), event: 'ring', enemy: 'bilge_rat', count: 50 },
        { at: T(10), event: 'boss', enemy: 'harbor_maw' },
        { at: T(12, 30), event: 'wall', enemy: 'gull', count: 60 },
        { at: T(15), event: 'muster', name: "Bosun's Muster", enemy: 'drowned_bosun', escort: 'drowned_sailor', count: 24, radius: 36 },
        { at: T(16, 30), event: 'wall', enemy: 'gull', count: 80 },
        { at: T(17), event: 'elite', enemy: 'lantern_eater' },
        { at: T(18), event: 'ring', enemy: 'bilge_rat', count: 80 },
        { at: T(20), event: 'boss', enemy: 'the_tidecaller' },
      ],
    },
    overtime: { densityPerMin: 1.12, hpPerMin: 1.15, materialsPerMin: 1.10 },
    secrets: [
      { id: 'wreck_cache', name: 'Wreck Cache', at: [212, 40], radius: 10, relic: 'wreck_lantern' },
    ],
  },
];
