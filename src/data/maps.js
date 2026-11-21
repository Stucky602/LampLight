// Maps (ARCHITECTURE §5.7, §11). The timeline drives the director:
//   bands   { from, to, roster: { enemyId: weight }, density: [start, end], min }: while the
//           clock is in [from, to), keep about `density` enemies alive (rising from start to end,
//           times the pace dial tuning.pace.density), spawning from the roster by weight, and never
//           fewer than `min` (0.8.1: whatever the dials say, the screen never empties; a boss's
//           thinning aside). The last band keeps going past its `to`.
//   events  { at, event, ... } at a fixed second:
//           elite  { enemy }                  one enemy with the elite modifier (drops a chest)
//           boss   { enemy }                  a boss; the run's two bosses are at 600 and 1200
//           wall   { enemy, count, speed? }   a line from one side: swarmers fly straight across
//           ring   { enemy, count, radius?, speed? }  a ring closing in from just off screen
//           (a wall's, a ring's, a flock's, and a muster's count are times tuning.pace.events, 1:
//           set pieces stay full size, 0.9.0)
//           chest  { }                        a chest (one item) on the ground a short walk away
//           muster { name, enemy, escort, count, radius, champion? }  an elite captain and a ring of
//                                             its crew, walking in together; the captain drops a boss
//                                             chest. champion (0.9.0): { name, chest, attack } makes
//                                             the captain a named champion with one warned attack
//                                             (sim/champions.js); chest 'elite' pays an elite's chest
// A band's `pace` (0.9.0, default 1) multiplies tuning.pace.density for that band alone: the early
// bands are busier than the global dial makes them (the veteran round: the first five minutes had
// no threat). A Tide's densityMul raises every band's floor too.
// secrets: { id, name, at: [col, row], radius, relic } caches hidden on the map. Each opens once
// a run when you reach it: its relic while you can take it, otherwise one chest item. Finding one
// is recorded in the codex as 'secret:<id>', which unlocks content keyed to it (the relic).
// only: the one character a secret is there for (the Drowned Causeway is the Bog Warden's; the sim's
// own rule is sim/trades.js SECRET_OWNER, and tests/content.test.js holds the two together).
// commonDrops apply to every regular enemy; eliteDrops to elites. Coin and oil drop everywhere.
// overtime: after the 20:00 boss the player can stay; every minute these multiply (the materials
// up to materialsCap). eliteRare: the share of an elite's rare-material chance left in overtime; dropMul: the same for an ordinary enemy's materials. repeat: events that come again and again while you stay, each `every`
// seconds from the start of overtime: elite { enemy } or { enemies: [...] } (taken in turn), ring,
// wall, and muster (announced tuning.director.musterWarn seconds ahead: MUSTER_SOON).
// tasks: { kind: 'lamp' | 'bell', at: [col, row] } the run's tasks (sim/tasks.js), each moved to the
// nearest open tile; lighting every lamp banks Lantern Night. ferry: { moorings: [[col, row], ...] }
// where the Ferryman can tie up (with the Docks restored), each moved to the nearest dry tile beside
// water or a creek's bed (sim/places.js snapShore); each call he ties up at the one nearest you that's
// at least tuning.ferry.minAway from you (0.8.2). A test map may give { at } for one mooring.
// unlock (0.8.0): what opens a map, a key or a list of keys, every one needed (meta/state.js
// mapOpen): 'building:<id>:<n>', 'boss:<id>' (that boss killed on any run, read off the bestiary),
// 'feat:<id>', and the rest of the unlock keys. A map without one is open from the start (map 1).

const T = (m, s = 0) => m * 60 + s;

export const MAPS = [
  {
    id: 'drowned_docks', name: 'Drowned Docks', desc: 'The flooded harbor front. A full run is 20 minutes, with 2 bosses.',
    size: [256, 256], ambient: 0.5,
    // A wharf with flooded slips in it (footbridges across the long ones), sheds and crates on it,
    // and a wreck beached in the far northeast with the secret cache aboard (sim/terrain.js
    // buildDocks).
    layout: {
      kind: 'docks', seed: 'drowned_docks_2', clearRadius: 14,
      slips: { count: 24, width: 4, length: [10, 22], apart: 4, bridgeOver: 15, bridge: 4 },
      sheds: { count: 32, size: [6, 4] },
      crates: { count: 200, size: [1, 2] },
      wreck: { at: [212, 40], size: [14, 8] },
      // The districts (0.9.0, W4; sim/terrain.js DISTRICT_KINDS): the outer map's places.
      districts: [
        { kind: 'crane_yard', rect: [16, 14, 64, 60] },
        { kind: 'fish_market', rect: [16, 150, 52, 40] },
        { kind: 'breakwater', rect: [64, 226, 188, 28] },
        { kind: 'ropewalk', rect: [166, 132, 72, 3] },
        { kind: 'dry_dock', rect: [196, 176, 20, 50] },
      ],
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
        { from: T(0), to: T(1), roster: { fog_wisp: 3, bilge_rat: 1 }, density: [15, 40], min: 15, pace: 2.2 },
        { from: T(1), to: T(3), roster: { fog_wisp: 3, drowned_sailor: 1, bilge_rat: 1 }, density: [40, 90], min: 26, pace: 1.85 },
        { from: T(3), to: T(5), roster: { fog_wisp: 2, drowned_sailor: 3, bilge_rat: 1 }, density: [90, 150], min: 36, pace: 1.5 },
        { from: T(5), to: T(7), roster: { drowned_sailor: 4, bilge_rat: 1, mud_crab: 1 }, density: [140, 220], min: 40, pace: 1.2 },   // (C1 Nov 17: fewer rats, fewer in all)
        { from: T(7), to: T(10), roster: { drowned_sailor: 3, fog_wisp: 2, mud_crab: 1, bloater: 1 }, density: [240, 380], min: 45 },
        { from: T(10), to: T(12), roster: { drowned_sailor: 2, bilge_rat: 2, bloater: 2, lantern_eater: 1 }, density: [300, 450], min: 60 },
        // (C1 Nov 17, ruling 17 W7: from 12:00, fewer, slower, stronger: the rats give way to Bosuns, and the
        // crowd thins, so the build's damage decides how fast the field clears.)
        { from: T(12), to: T(15), roster: { drowned_sailor: 3, bloater: 2, lantern_eater: 1, wreck_gunner: 1, drowned_bosun: 1 }, density: [380, 560], min: 80 },
        { from: T(15), to: T(18), roster: { drowned_sailor: 3, mud_crab: 2, bloater: 2, lantern_eater: 1, wreck_gunner: 1, drowned_bosun: 2 }, density: [600, 840], min: 100 },
        { from: T(18), to: T(20), roster: { drowned_sailor: 3, mud_crab: 2, bloater: 2, lantern_eater: 1, wreck_gunner: 1, drowned_bosun: 3 }, density: [840, 1000], min: 120 },
      ],
      // Chests come at about 2:30 (an easy elite), 7:30, 10:00 (the Maw), 12:00, 15:00 (the
      // muster), 18:30, and 20:00 (0.7.3: a weapon ready to evolve never waits long for one).
      events: [
        { at: T(2, 30), event: 'elite', enemy: 'drowned_sailor' },
        { at: T(3, 15), event: 'wall', enemy: 'gull', count: 30 },
        { at: T(4), event: 'ring', enemy: 'fog_wisp', count: 40 },
        // The 5:00 champion (0.9.0): the First Mate and his watch; his anchor lands where you stand.
        { at: T(5), event: 'muster', name: 'The First Mate', enemy: 'drowned_sailor', escort: 'drowned_sailor', count: 9, radius: 36,
          // (C1 Nov 17: a smaller watch, and a slower, longer-warned anchor that hits harder: 9 of the 48 early deaths had it in the last hits)
          champion: { name: 'The First Mate', chest: 'elite', attack: { type: 'anchor', name: 'anchor', warn: 1.6, every: 7, reach: 260, radius: 30, damage: 18 } } },
        { at: T(6, 30), event: 'wall', enemy: 'gull', count: 40 },
        { at: T(7, 30), event: 'elite', enemy: 'drowned_bosun' },
        { at: T(8), event: 'ring', enemy: 'bilge_rat', count: 50 },
        { at: T(10), event: 'boss', enemy: 'harbor_maw' },
        { at: T(12), event: 'elite', enemy: 'lantern_eater' },
        { at: T(12, 30), event: 'wall', enemy: 'gull', count: 60 },
        { at: T(15), event: 'muster', name: "Bosun's Muster", enemy: 'drowned_bosun', escort: 'drowned_sailor', count: 24, radius: 36,
          champion: { name: 'The Bosun', attack: { type: 'rope_drag', name: 'rope drag', warn: 1.2, every: 7, reach: 240, length: 220, width: 18, damage: 14, drag: 70, dragSec: 0.35 } } },
        { at: T(16, 30), event: 'wall', enemy: 'gull', count: 80 },
        { at: T(18), event: 'ring', enemy: 'bilge_rat', count: 80 },
        // (C1 Nov 17, ruling 17 W7: a late champion that asks for focus: a build that can't bring him
        // down in time eats his anchor every 6s. Fully warned, a major tier.)
        { at: T(17, 30), event: 'muster', name: 'The Quartermaster', enemy: 'drowned_bosun', escort: 'drowned_bosun', count: 6, radius: 36,
          champion: { name: 'The Quartermaster', chest: 'elite', attack: { type: 'anchor', name: 'anchor', warn: 1.6, every: 6, reach: 280, radius: 34, damage: 24 } } },
        { at: T(18, 30), event: 'elite', enemy: 'wreck_gunner' },
        { at: T(20), event: 'boss', enemy: 'the_tidecaller' },
      ],
    },
    overtime: {
      // (X3, E1: staying paid 4 to 6 runs in one. Materials grow to 1.5x at most, and overtime's elites drop
      // their rare material at half the chance; the Long Night pays in its dawn chest and its order. Round 2:
      // an ordinary enemy's materials drop at 0.45 of their chance, so staying pays about 1.5x an hour.)
      densityPerMin: 1.12, hpPerMin: 1.08, materialsPerMin: 1.10, materialsCap: 1.5, eliteRare: 0.5, dropMul: 0.45,
      // 0.9.0 (W4): an elite pairing every minute, each a new pair in turn; the rings and the muster as before.
      repeat: [
        { every: 60, event: 'elite', pairs: [['drowned_bosun', 'lantern_eater'], ['lantern_eater', 'wreck_gunner'], ['wreck_gunner', 'mud_crab'], ['mud_crab', 'drowned_bosun']] },
        { every: 120, event: 'ring', enemy: 'bilge_rat', count: 80 },
        { every: 300, event: 'muster', name: "Bosun's Muster", enemy: 'drowned_bosun', escort: 'drowned_sailor', count: 30, radius: 36 },
      ],
      // Once each, seconds from the start of overtime: the first boss comes back at 5:00, and at
      // 10:00 the Long Night: both bosses at once (the second `gap` s behind). Kill both and dawn
      // breaks: the run ends cleared (sim/acts.js).
      events: [
        { at: 300, event: 'boss', enemy: 'harbor_maw' },
        { at: 600, event: 'long_night', enemies: ['harbor_maw', 'the_tidecaller'], gap: 15, hpMul: 0.8 },
      ],
    },
    secrets: [
      { id: 'wreck_cache', name: 'Wreck Hold', at: [212, 40], radius: 10, relic: 'wreck_lantern', hint: 'Something glints aboard the wreck in the far northeast.' },
      // Small finds (0.9.0, W4): hidden at the map's edges, unmarked; each gives what it says once a run.
      { id: 'net_bottle', name: 'Bottle in the Nets', at: [128, 6], radius: 8, gift: { kind: 'pearls', amount: 25 }, hint: 'Nets hang off the north edge of the wharf.' },
      { id: 'tarred_chest', name: 'Tarred Locker', at: [246, 10], radius: 8, gift: { kind: 'item' }, hint: 'A tarred locker sits in the far northeast corner, past the wreck.' },
      { id: 'drowned_purse', name: 'Drowned Purse', at: [6, 100], radius: 8, gift: { kind: 'materials', material: 'rum', amount: 6 }, hint: 'A purse lies at the west edge of the wharf.' },
      { id: 'harbor_ember', name: 'Warm Coals', at: [248, 170], radius: 8, gift: { kind: 'ember' }, from: 2, hint: 'Coals keep warm at the east edge, once the first boss has come.' },
      { id: 'cook_pot', name: "Cook's Pot", at: [6, 246], radius: 8, gift: { kind: 'heal', amount: 60 }, hint: 'A pot hangs over a cold fire in the far southwest.' },
      // The character secret: at the breakwater's point, uncovered once the first boss has come.
      { id: 'breakwater_point', name: 'Breakwater Point', at: [69, 248], radius: 9, gift: { kind: 'item' }, from: 2, hint: 'At the end of the breakwater, after the first boss, something has washed up.' },
    ],
    // Named places (0.9.0, W4): districts and landmarks, for notices and for spreading the run's sites.
    places: [
      { id: 'quay', name: 'the Quay', at: [128, 128], radius: 30 },
      { id: 'crane_yard', name: 'the Crane Yard', at: [48, 44], radius: 36 },
      { id: 'net_lofts', name: 'the Net Lofts', at: [128, 40], radius: 34 },
      { id: 'wreck', name: 'the Wreck', at: [212, 40], radius: 30 },
      { id: 'west_wharf', name: 'the West Wharf', at: [36, 108], radius: 30 },
      { id: 'east_wharf', name: 'the East Wharf', at: [220, 96], radius: 30 },
      { id: 'ropewalk', name: 'the Ropewalk', at: [202, 136], radius: 36 },
      { id: 'fish_market', name: 'the Fish Market', at: [42, 170], radius: 30 },
      { id: 'slipways', name: 'the Slipways', at: [124, 192], radius: 30 },
      { id: 'dry_dock', name: 'the Dry Dock', at: [206, 196], radius: 26 },
      { id: 'breakwater', name: 'the Breakwater', at: [140, 238], radius: 44 },
    ],
    // The run's task sites (0.9.0, W4, ruling 6): each act draws its lamps and bells from these,
    // spread over the places, never one already used this run (sim/acts.js).
    sites: {
      lamp: [[48, 20], [42, 186], [154, 245], [200, 140], [192, 200], [200, 52], [128, 28], [28, 110], [236, 96], [120, 212], [162, 96], [96, 160], [96, 92], [164, 164], [236, 214], [100, 60]],
      bell: [[64, 30], [26, 160], [180, 220], [230, 142], [176, 62], [128, 66], [64, 120], [190, 110], [128, 186], [80, 204], [226, 172]],
      cache: [[22, 70], [60, 186], [244, 20], [24, 236], [244, 120], [128, 14], [104, 245], [236, 240]],
    },
    // The Drowned Docks' own task: cranes (stand in the ring; a load drops on the thickest crowd near it).
    cranes: [[30, 20], [64, 20], [120, 221], [218, 188]],
    // The run in three acts (ruling 6): what each brings. bellAt: seconds into the act each bell
    // wakes; span: [from, to] seconds (acts 1 and 2 on the run's clock, act 3 from overtime's
    // start) the deck's events fall in; twists: how many of the map's twists the act brings.
    acts: [
      { lamps: 5, bells: 3, bellAt: [0, 160, 330], twists: 0, deck: 2, span: [130, 560] },
      { lamps: 5, bells: 3, bellAt: [20, 180, 340], twists: 1, deck: 3, span: [640, 1150] },
      { lamps: 4, bells: 3, bellAt: [10, 150, 290], twists: 2, deck: 2, span: [40, 560] },
    ],
    twists: ['held', 'elite_crew'],
    // The map's event deck (0.9.0, W4): each act draws its `deck` from the entries open to it.
    // Entries with `unlock` come from Harbor Orders (data/orders-content.js). Ids are permanent.
    deck: [
      { id: 'gulls_rise', name: 'The Gulls Rise', acts: [1, 2, 3],
        events: [{ event: 'wall', enemy: 'gull', count: 40 }, { event: 'wall', enemy: 'gull', count: 40, after: 4 }, { event: 'wall', enemy: 'gull', count: 40, after: 8 }] },
      { id: 'surfaced_hull', name: 'The Surfaced Hull', acts: [1, 2, 3],
        events: [{ event: 'cache', chest: ['elite', 'boss', 'boss'], guard: { enemy: 'drowned_sailor', count: 16, elite: 'drowned_bosun' } }] },
      { id: 'fish_market', name: 'The Market Rats', acts: [1, 2],
        events: [{ event: 'rising', place: 'fish_market', enemy: 'bilge_rat', count: 50, spoils: { heal: 3, material: 'coin', amount: 12 } }] },
      { id: 'smugglers_lights', name: "Smugglers' Lanterns", acts: [1, 3],
        events: [{ event: 'trail', chest: ['elite', 'elite', 'boss'], gems: 24, pearls: 20 }] },
      { id: 'ghost_ship', name: 'The Ghost Ship', acts: [2, 3], unlock: 'feat:docks_ghost_ship',
        events: [{ event: 'wall', enemy: 'drowned_sailor', count: 36 }, { event: 'elite', enemy: 'drowned_bosun', after: 2 }] },
      { id: 'harbor_master', name: 'The Harbor Master', acts: [2, 3], unlock: 'feat:docks_harbor_master',
        events: [{ event: 'muster', name: 'The Harbor Master', enemy: 'drowned_bosun', escort: 'drowned_sailor', count: 16, radius: 36,
          champion: { name: 'The Harbor Master', chest: 'elite', attack: { type: 'anchor', name: 'anchor', warn: 1.2, every: 6, reach: 260, radius: 34, damage: 18 } } }] },
      { id: 'rat_tide', name: 'The Rat Swarm', acts: [2, 3], unlock: 'feat:docks_rat_tide',
        events: [{ event: 'ring', enemy: 'bilge_rat', count: 70 }, { event: 'rising', place: 'slipways', enemy: 'bilge_rat', count: 40, spoils: { heal: 2, material: 'timber', amount: 6 }, after: 6 }] },
      { id: 'press_gang', name: 'The Press Gang', acts: [3], unlock: 'feat:docks_press_gang',
        events: [{ event: 'ring', enemy: 'drowned_sailor', count: 60 }, { event: 'elite', enemy: 'lantern_eater', after: 3 }, { event: 'elite', enemy: 'wreck_gunner', after: 3 }] },
    ],
    ferry: { moorings: [[151, 118], [116, 84], [168, 89], [70, 116], [132, 182], [180, 164]] },
  },

  // ---------------------------------------------------------------- the Salt Marsh (map 2, 0.8.0)
  // docs/design/SALT_MARSH.md; ARCHITECTURE §5.17. Pale salt flats cut by creeks (mud at low water,
  // water at high), boardwalks across them, peat islands, stumps, and reeds; you land at the
  // northwest landing. The water (sim/marsh.js), the storm and the Eye (sim/storm.js), the Salt
  // Well (sim/well.js), and the secret come with the run's layers (RunConfig.layers, from the
  // profile: the storm after the Old Grey's first kill, the well after a first clear, the secret
  // at the Marsh's Tide 2 or the Cartographer's level 5). No `wall` events here (rule 2): gulls
  // come in small flocks. It opens when the Docks' first level has repaired the boat, the Harbor
  // Maw has been killed, and the Tavern keeps the feat list (its level 1): skill and the Tavern open
  // it, not a pile of Coin.
  {
    id: 'salt_marsh', name: 'Salt Marsh', desc: 'Salt flats and creeks that flood twice a run. A full run is 20 minutes, with 2 bosses.',
    unlock: ['building:docks:1', 'boss:harbor_maw', 'building:tavern:1'],
    size: [256, 256], ambient: 0.55, start: [10, 8],
    layers: ['storm', 'well', 'secret'],
    layout: {
      kind: 'marsh', seed: 'salt_marsh_1',
      creeks: { count: 5, width: [3, 4], apart: 0.2, alongside: 0.12, boardwalks: [2, 3] },
      islands: { count: 12, radius: [3, 6] },
      stumps: 140, reeds: 90,
      landing: { at: [10, 8], pool: 3 },
      secret: { at: [222, 222], island: 9, moat: 4 },
    },
    // High water 3:00 to 8:00 and 13:00 to 18:00, creeping in over 10 s from the creek mouths,
    // warned 15 s ahead (seconds, never squeezed in a short run). Mud slows enemies to 60%. In
    // overtime the flood comes in and doesn't go out: 8% more of the flats a minute, never more
    // than leaves 35% of the open ground dry.
    water: { high: [[180, 480], [780, 1080]], creep: 10, warn: 15, mudSlow: 0.6, rebuildEvery: 0.25, overtime: { perMin: 0.08, keepDry: 0.35 } },
    // The storm (layer 'storm'): bursts of warned rings on the thickest crowd standing on salt.
    storm: {
      windows: [{ from: 330, to: 480, every: 40, burst: [3, 6] }, { from: 930, to: 1080, every: 30, burst: [4, 7] }],
      overtime: { every: 30, burst: [4, 7] },
      warn: 1.2, radius: 28, damage: 80, playerDamage: 8, glassEvery: 8,
    },
    // The Eye (19:00 to 19:45, layer 'storm'): spawns stop, rings on the leftover horde, gems and Salt Glass.
    eye: { sec: 45, every: 2.5, burst: 4, radius: 30, damage: 120, warn: 1.2, gems: 30, gemXp: 5, glass: 4 },
    // Herb beds on the creek mud, placed from the run's loot stream; under water at high water.
    herbs: { beds: 80, amount: [1, 2] },
    materials: ['marsh_herbs', 'salt_glass'],
    commonDrops: [
      { material: 'coin', chance: 0.02 },
      { material: 'oil', chance: 0.012 },
      { material: 'marsh_herbs', chance: 0.006 },
    ],
    eliteDrops: [
      { material: 'salt_glass', chance: 1, amount: [1, 2] },
      { material: 'map_scraps', chance: 0.5, amount: [1, 1] },
      { material: 'marsh_herbs', chance: 1, amount: [2, 4] },
    ],
    pickups: { heal: 0.0025, magnet: 0.0008, healAmount: 30 },
    timeline: {
      bands: [
        { from: T(0), to: T(1), roster: { midge_cloud: 3, fog_wisp: 1 }, density: [15, 45], min: 15, pace: 2.2 },
        { from: T(1), to: T(3), roster: { midge_cloud: 3, fog_wisp: 2, salted_dead: 1 }, density: [45, 100], min: 26, pace: 1.85 },
        { from: T(3), to: T(5), roster: { midge_cloud: 2, salted_dead: 2, leech: 2, creek_eel: 1 }, density: [100, 170], min: 36, pace: 1.5 },
        { from: T(5), to: T(7), roster: { salted_dead: 3, leech: 2, creek_eel: 1, mire_toad: 1, midge_cloud: 2 }, density: [170, 260], min: 40, pace: 1.2 },
        { from: T(7), to: T(10), roster: { salted_dead: 3, mire_toad: 2, midge_cloud: 3, fog_wisp: 1, leech: 1 }, density: [260, 400], min: 45 },
        { from: T(10), to: T(12), roster: { salted_dead: 3, mire_toad: 2, midge_cloud: 3, leech: 2 }, density: [320, 480], min: 60 },
        { from: T(12), to: T(15), roster: { salted_dead: 3, mire_toad: 2, midge_cloud: 3, leech: 2, creek_eel: 1 }, density: [480, 720], min: 80 },
        { from: T(15), to: T(18), roster: { salted_dead: 4, mire_toad: 2, midge_cloud: 3, leech: 2, creek_eel: 1 }, density: [720, 1000], min: 100 },
        { from: T(18), to: T(20), roster: { salted_dead: 4, mire_toad: 3, midge_cloud: 4, leech: 2, fog_wisp: 1 }, density: [1000, 1200], min: 120 },
      ],
      events: [
        { at: T(2), event: 'elite', enemy: 'salted_dead' },
        { at: T(2, 30), event: 'ring', enemy: 'midge_cloud', count: 40 },
        { at: T(4), event: 'elite', enemy: 'mire_toad' },
        // The 5:00 champion (0.9.0): the Reed Cutter and a cloud of midges; his scythe sweeps a ring round him.
        { at: T(5), event: 'muster', name: 'The Reed Cutter', enemy: 'salted_dead', escort: 'midge_cloud', count: 12, radius: 36,
          champion: { name: 'The Reed Cutter', chest: 'elite', attack: { type: 'scythe', name: 'scythe', warn: 1.1, every: 6, reach: 200, radius: 56, damage: 14 } } },
        { at: T(6, 30), event: 'flock', enemy: 'gull', count: 8 },
        { at: T(7, 30), event: 'elite', enemy: 'mire_toad' },
        { at: T(8), event: 'ring', enemy: 'midge_cloud', count: 60 },
        { at: T(10), event: 'boss', enemy: 'old_grey' },
        { at: T(11, 30), event: 'flock', enemy: 'gull', count: 8 },
        { at: T(12), event: 'elite', enemy: 'salted_dead' },
        { at: T(13, 30), event: 'elite', enemy: 'mire_toad' },
        // The Salt Well (layer 'well'): the Well Warden and his crew; without it, an elite.
        { at: T(15), event: 'muster', name: 'The Salt Well', enemy: 'well_warden', escort: 'salted_dead', count: 24, radius: 36, layer: 'well', otherwise: { event: 'elite', enemy: 'salted_dead' },
          champion: { name: 'The Well Warden', attack: { type: 'salt_wall', name: 'salt wall', warn: 1.2, every: 9, reach: 280, length: 300, spacing: 26, radius: 14, last: 6, damage: 8 } } },
        { at: T(16, 30), event: 'flock', enemy: 'gull', count: 8 },
        { at: T(17), event: 'elite', enemy: 'salted_dead' },
        { at: T(18), event: 'ring', enemy: 'midge_cloud', count: 80 },
        { at: T(18, 30), event: 'elite', enemy: 'mire_toad' },
        { at: T(19), event: 'eye', sec: 45, layer: 'storm' },
        { at: T(20), event: 'boss', enemy: 'salt_widow' },
      ],
    },
    overtime: {
      // (X3, E1: staying paid 4 to 6 runs in one. Materials grow to 1.5x at most, and overtime's elites drop
      // their rare material at half the chance; the Long Night pays in its dawn chest and its order. Round 2:
      // an ordinary enemy's materials drop at 0.45 of their chance, so staying pays about 1.5x an hour.)
      densityPerMin: 1.12, hpPerMin: 1.08, materialsPerMin: 1.10, materialsCap: 1.5, eliteRare: 0.5, dropMul: 0.45,
      repeat: [
        { every: 60, event: 'elite', pairs: [['salted_dead', 'mire_toad'], ['mire_toad', 'well_warden'], ['well_warden', 'leech'], ['leech', 'salted_dead']] },
        { every: 120, event: 'ring', enemy: 'midge_cloud', count: 80 },
        { every: 300, event: 'muster', name: 'The Salt Watch', enemy: 'well_warden', escort: 'salted_dead', count: 30, radius: 36 },
      ],
      events: [
        { at: 300, event: 'boss', enemy: 'old_grey' },
        { at: 600, event: 'long_night', enemies: ['old_grey', 'salt_widow'], gap: 15, hpMul: 0.8 },
      ],
    },
    secrets: [
      { id: 'drowned_causeway', name: 'Drowned Causeway', at: [222, 222], radius: 10, relic: 'bog_torc', layer: 'secret', only: 'bog_warden', hint: 'A stone causeway in the far southeast, above the water only at low water. Only the Bog Warden can raise the dead there.' },
      { id: 'eel_trap', name: 'Forgotten Eel Trap', at: [4, 128], radius: 8, gift: { kind: 'materials', material: 'marsh_herbs', amount: 8 }, hint: 'An eel trap lies at the west edge of the flats.' },
      { id: 'salt_purse', name: "Salter's Purse", at: [250, 8], radius: 8, gift: { kind: 'pearls', amount: 25 }, hint: 'A purse lies in the far northeast corner.' },
      { id: 'peat_hoard', name: 'Peat Hoard', at: [128, 250], radius: 8, gift: { kind: 'item' }, hint: 'Something is cut into the peat at the south edge.' },
      { id: 'heron_feather', name: "Old Grey's Feather", at: [250, 128], radius: 8, gift: { kind: 'ember' }, from: 2, hint: 'Once the heron has come, a feather lies at the east edge.' },
      { id: 'reed_bundle', name: 'Reed Bundle', at: [60, 250], radius: 8, gift: { kind: 'heal', amount: 60 }, hint: 'A bundle of cut reeds at the south edge, west of the middle.' },
    ],
    places: [
      { id: 'landing', name: 'the Landing', at: [10, 8], radius: 20 },
      { id: 'withy_beds', name: 'the Withy Beds', at: [120, 22], radius: 30 },
      { id: 'heronry', name: 'the Heronry', at: [40, 100], radius: 34 },
      { id: 'salt_pans', name: 'the Salt Pans', at: [110, 110], radius: 38 },
      { id: 'far_flats', name: 'the Far Flats', at: [200, 40], radius: 38 },
      { id: 'eel_creeks', name: 'the Eel Creeks', at: [212, 110], radius: 34 },
      { id: 'black_pools', name: 'the Black Pools', at: [165, 172], radius: 34 },
      { id: 'peat_cuttings', name: 'the Peat Cuttings', at: [40, 208], radius: 38 },
      { id: 'ditches', name: 'the Ditches', at: [112, 228], radius: 30 },
      { id: 'causeway', name: 'the Drowned Causeway', at: [222, 222], radius: 26 },
    ],
    // Lamps on the peat islands where there are any (the peat never floods, overtime's either).
    sites: {
      lamp: [[70, 57], [47, 102], [29, 120], [188, 152], [145, 175], [178, 181], [15, 188], [80, 213], [33, 230], [182, 32], [202, 98], [120, 20], [110, 110], [230, 60]],
      // (X4: the last four stand on flats overtime's flood never reaches, with dry ground all round
      // for a crew to gather on: act 3's bells. The acts keep them for it: sim/acts.js drawSites.)
      bell: [[40, 40], [100, 70], [160, 60], [60, 160], [120, 140], [230, 140], [110, 230], [195, 215], [240, 20], [15, 150], [18, 58], [176, 80], [166, 166], [24, 204]],
      cache: [[130, 60], [240, 100], [90, 180], [250, 200], [10, 250], [150, 250], [60, 80]],
    },
    // The Salt Marsh's own task: salt cairns (stand in the ring; the storm works the ground round it a while).
    cairns: [[75, 90], [150, 100], [60, 200], [220, 180]],
    acts: [
      { lamps: 4, bells: 3, bellAt: [0, 160, 330], twists: 0, deck: 2, span: [120, 560] },
      { lamps: 4, bells: 3, bellAt: [20, 180, 340], twists: 1, deck: 3, span: [640, 1120] },
      { lamps: 4, bells: 3, bellAt: [10, 150, 290], twists: 2, deck: 2, span: [40, 560] },
    ],
    twists: ['held', 'elite_crew'],
    deck: [
      { id: 'bog_lights', name: 'Bog Lights', acts: [1, 2, 3],
        events: [{ event: 'trail', chest: ['elite', 'elite', 'boss'], gems: 24, pearls: 15, guard: { enemy: 'fog_wisp', count: 20 } }] },
      { id: 'toad_chorus', name: 'The Toad Chorus', acts: [2, 3], events: [{ event: 'ring', enemy: 'mire_toad', count: 24 }] },
      { id: 'drowned_barge', name: 'The Drowned Barge', acts: [1, 2, 3],
        events: [{ event: 'cache', chest: ['elite', 'boss', 'boss'], guard: { enemy: 'salted_dead', count: 14, elite: 'salted_dead' } }] },
      { id: 'heron_flight', name: 'The Heron Flight', acts: [1, 2],
        events: [{ event: 'flock', enemy: 'gull', count: 8 }, { event: 'flock', enemy: 'gull', count: 8, after: 3 }, { event: 'flock', enemy: 'gull', count: 8, after: 6 }] },
      { id: 'peat_fire', name: 'The Peat Fire', acts: [2, 3], unlock: 'feat:marsh_peat_fire',
        events: [{ event: 'fire', count: 14, step: 34, radius: 26, warn: 1.2, stagger: 0.15, damage: 160, playerDamage: 10 }] },
      { id: 'reed_cutters', name: 'The Reed Cutters', acts: [2, 3], unlock: 'feat:marsh_reed_cutters',
        events: [{ event: 'muster', name: 'The Reed Cutters', enemy: 'salted_dead', escort: 'midge_cloud', count: 16, radius: 36,
          champion: { name: 'The Head Cutter', chest: 'elite', attack: { type: 'scythe', name: 'scythe', warn: 1.1, every: 6, reach: 200, radius: 60, damage: 16 } } }] },
      { id: 'leech_bloom', name: 'The Leech Bloom', acts: [2, 3], unlock: 'feat:marsh_leech_bloom', events: [{ event: 'ring', enemy: 'leech', count: 40 }] },
      { id: 'midge_summer', name: 'Midge Summer', acts: [3], unlock: 'feat:marsh_midge_summer', events: [{ event: 'ring', enemy: 'midge_cloud', count: 100 }] },
    ],
    ferry: { moorings: [[14, 8], [36, 21], [68, 19], [92, 44], [98, 70], [100, 100]] },
  },
];
