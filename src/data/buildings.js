// The harbor's buildings (ARCHITECTURE §10.4, §10.5; brief §6.1). Each has 5 levels after its
// ruined state, and each level costs materials and opens something. Phase 5 built the three MVP
// buildings; Phase 7 the other six, each thinly (content passes fill them in).
//
// A level's effects (the building panel describes them from here; meta/state.js levelEffect reads
// the largest a building's reached levels give):
//   tree: n              the Lamp Post's upgrades of tier n can be bought (data/upgrades.js)
//   lampSpeed: f         Wayside Lamps light f faster in runs (data/tuning.js tasks)
//   researchTier: n      Library research of tier n can be started (data/research.js)
//   researchSlots: n     this many research projects can run at once
//   feats: 1, mastery: 1 the Tavern lists the feats; trains mastery perks and kits (data/mastery.js)
//   ferry: n             the Ferryman's skiff is in runs, at stock level n (data/tuning.js ferry)
//   gearSlots: n         gear slots open (data/gear.js GEAR_SLOTS, in order)
//   gearTier: n          gear can be crafted at tier 1 and upgraded up to tier n
//   reroll: 1            a gear affix can be re-rolled
//   runeCrafting: 1      rune stones can be made (one goes into a run's first weapon at 0:00)
//   tideMax: n           Tides up to n can be chosen (once cleared up to them; data/tide.js)
//   curses: n            this many of the curses can be chosen (data/tide.js CURSES, in order)
//   bellRing: f          Fog Bells' rings are f wider
//   market: n            the Market trades at its rates for level n (data/market.js)
//   glassToCoin: f       Sea Glass left at a run's end comes home as f Coin each
//   consumableSlots: n   this many consumables can go into a run (data/consumables.js)
//   tasksOnMap: 1        the run's tasks are on the minimap from 0:00 (and the secret's hint shows)
//   bestiary: 1          bestiary milestones can be claimed (data/meta.js bestiaryRewards)
//   challenges: 1        challenge runs can be chosen (data/challenges.js)
//   shortRuns: 1         short runs can be chosen
//   secretsOnMap: 1      a map's secrets are marked on its minimap
// Content a level brings (a character, a relic, a consumable) says so itself: its `unlock` is
// 'building:<id>:<level>' (for example the Harpooner's is 'building:tavern:1').
//
// Costs use only materials that drop on map 1, the Drowned Docks (§10.5), so the economy has no
// dead ends; tests/content.test.js checks it. The buildings whose own materials come from later
// maps (the Chapel's Candles and Bone, the Apothecary's Marsh Herbs, the Smithy's Salt Glass) ask
// for them once those maps exist. The numbers are a first pass for the pacing simulator
// (tools/pacing) and Kevin.

export const BUILDINGS = [
  {
    id: 'lamp_post', name: 'Lamp Post', desc: 'Burns Oil to push the fog back. Unlocks permanent upgrades.',
    npc: 'lamp_keeper', material: 'oil',
    levels: [
      { cost: { oil: 15, coin: 15 }, tree: 1 },
      { cost: { oil: 70, coin: 60, timber: 15 }, tree: 2 },
      { cost: { oil: 135, coin: 120, rope: 20 }, tree: 3, lampSpeed: 0.25 },
      { cost: { oil: 225, coin: 195, timber: 45, iron: 6 }, tree: 4 },
      { cost: { oil: 345, coin: 300, rope: 45, iron: 15, map_scraps: 3 }, tree: 5, lampSpeed: 0.5 },
    ],
  },
  {
    id: 'library', name: 'Library', desc: 'Researches new weapons, passives, and runes.',
    npc: 'librarian', material: 'drowned_pages',
    levels: [
      { cost: { drowned_pages: 10, coin: 20, timber: 5 }, researchSlots: 1, researchTier: 1 },
      { cost: { drowned_pages: 45, coin: 70, timber: 18 }, researchTier: 2 },
      { cost: { drowned_pages: 90, coin: 120, rope: 18 }, researchSlots: 2 },
      { cost: { drowned_pages: 150, coin: 195, timber: 40, iron: 6 }, researchTier: 3 },
      { cost: { drowned_pages: 225, coin: 285, rope: 40, map_scraps: 3 }, researchSlots: 3, researchTier: 4 },
    ],
  },
  {
    id: 'tavern', name: 'Tavern', desc: 'Brings new characters and relics to the harbor.',
    npc: 'innkeeper', material: 'rum',
    levels: [
      { cost: { coin: 90, rum: 5, timber: 10 }, feats: 1 },
      { cost: { coin: 150, rum: 9, rope: 15 }, mastery: 1 },
      { cost: { coin: 225, rum: 15, timber: 25 } },
      { cost: { coin: 315, rum: 22, rope: 35, iron: 6 } },
      { cost: { coin: 420, rum: 33, map_scraps: 4 } },
    ],
  },
  {
    id: 'docks', name: 'Docks', desc: 'Mends the boats. Ferryman sails into runs from here.',
    npc: 'dockhand', material: 'timber',
    levels: [
      { cost: { timber: 40, rope: 25, coin: 80 }, ferry: 1 },
      { cost: { timber: 70, rope: 45, coin: 130, iron: 4 }, ferry: 2 },
      { cost: { timber: 110, rope: 70, coin: 190, map_scraps: 2 }, ferry: 3 },
      { cost: { timber: 160, rope: 100, coin: 260, iron: 10 }, ferry: 4 },
      { cost: { timber: 220, rope: 140, coin: 350, map_scraps: 5 }, ferry: 5 },
    ],
  },
  {
    id: 'smithy', name: 'Smithy', desc: 'Makes and improves gear, and cuts rune stones.',
    npc: 'smith', material: 'iron',
    levels: [
      { cost: { iron: 6, timber: 30, coin: 90 }, gearSlots: 4, gearTier: 1 },
      { cost: { iron: 12, rope: 30, coin: 140 }, gearTier: 3 },
      { cost: { iron: 20, timber: 60, coin: 200 }, gearSlots: 5, reroll: 1 },
      { cost: { iron: 30, rope: 70, coin: 270, map_scraps: 3 }, runeCrafting: 1, gearTier: 4 },
      { cost: { iron: 45, coin: 360, map_scraps: 6 }, gearSlots: 6, gearTier: 5 },
    ],
  },
  {
    id: 'chapel', name: 'Chapel', desc: 'Opens the higher Tides and the curses. Rings the Fog Bells louder.',
    npc: 'warden', material: 'drowned_pages',
    levels: [
      { cost: { drowned_pages: 30, oil: 40, coin: 80 }, tideMax: 2, curses: 2 },
      { cost: { drowned_pages: 55, oil: 70, coin: 130, iron: 4 }, tideMax: 4, curses: 3 },
      { cost: { drowned_pages: 85, oil: 110, coin: 190 }, tideMax: 6, curses: 4, bellRing: 0.25 },
      { cost: { drowned_pages: 120, oil: 160, coin: 260, map_scraps: 3 }, tideMax: 8, curses: 5 },
      { cost: { drowned_pages: 170, oil: 220, coin: 350, map_scraps: 6 }, tideMax: 10 },
    ],
  },
  {
    id: 'market', name: 'Market', desc: 'Trades one material for another, at a poor rate. Buys back your Sea Glass.',
    npc: 'trader', material: 'coin',
    levels: [
      { cost: { coin: 150, timber: 20 }, market: 1 },
      { cost: { coin: 220, rope: 30 }, glassToCoin: 0.5 },
      { cost: { coin: 300, rum: 12, iron: 4 }, market: 2 },
      { cost: { coin: 400, timber: 60, rope: 40 }, glassToCoin: 1 },
      { cost: { coin: 520, iron: 8, map_scraps: 4 }, market: 3 },
    ],
  },
  {
    id: 'apothecary', name: 'Apothecary', desc: 'Sells what you take into a run: tonics, salts, and charms.',
    npc: 'apothecary', material: 'rum',
    levels: [
      { cost: { rum: 6, oil: 30, coin: 70 }, consumableSlots: 1 },
      { cost: { rum: 10, oil: 50, coin: 110 } },
      { cost: { rum: 16, oil: 80, coin: 160, iron: 4 }, consumableSlots: 2 },
      { cost: { rum: 24, oil: 120, coin: 220 } },
      { cost: { rum: 34, oil: 170, coin: 300, map_scraps: 4 }, consumableSlots: 3 },
    ],
  },
  {
    id: 'cartographer', name: 'Cartographer', desc: 'Charts the maps: where the tasks are, what the bestiary is worth, challenge runs, and short runs.',
    npc: 'cartographer', material: 'map_scraps',
    levels: [
      { cost: { map_scraps: 2, drowned_pages: 25, coin: 70 }, tasksOnMap: 1 },
      { cost: { map_scraps: 4, drowned_pages: 45, coin: 120 }, bestiary: 1 },
      { cost: { map_scraps: 6, timber: 50, coin: 170 }, challenges: 1 },
      { cost: { map_scraps: 9, rope: 60, coin: 230 }, shortRuns: 1 },
      { cost: { map_scraps: 12, drowned_pages: 110, coin: 300 }, secretsOnMap: 1 },
    ],
  },
];

/** The levels a building can reach (the ruin is level 0). */
export const MAX_BUILDING_LEVEL = 5;
