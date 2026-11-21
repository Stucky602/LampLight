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
//   tempering: 1         the weapon you set out with starts each run with one of its Rare lines (sim/world.js temper)
//   tideMax: n           Tides up to n can be chosen (once cleared up to them; data/tide.js)
//   curses: n            this many of the curses can be chosen (data/tide.js CURSES, in order)
//   bellRing: f          Fog Bells' rings are f wider
//   market: n            the Market trades at its rates for level n (data/market.js)
//   glassToCoin: f       Pearls left at a run's end come home as f Coin each
//   consumableSlots: n   this many run tools can go into a run (data/consumables.js)
//   tasksOnMap: 1        Reliquaries are marked on the minimap wherever they drop (0.8.2: lamps and
//                        bells are on it for everyone; the key keeps its name for saves); the secret's hint shows
//   findsOnMap: 1        a map's small secrets (finds) are marked on its minimap (the sweep, X2: this level paid bestiary claims)
//   challenges: 1        set runs are posted on the Harbor Orders board (data/challenges.js)
//   heirloom: 1          a run can set out carrying one relic found before, in a relic slot (the sweep, ruling 11)
//   needs: key           (the sweep, X3, D5) the level waits on this unlock key besides its cost and the fog
//                        (meta/actions.js levelNeeds), so the harbor hands its systems over a run or two apart
//   foodHeal: f          food heals f more in runs (the Apothecary's healing side)
//   shortRuns: 1         short runs can be chosen
//   secretsOnMap: 1      a map's secrets are marked on its minimap
//   stage: n             the Lighthouse's stage (0.9.0: ten of them, each a level, `stages` names them)
//   consumableSlotsAdd   one more run tool a run, on top of the Apothecary's
//   lampSpeedAdd, bellRingAdd   more of the Lamp Post's lampSpeed and the Chapel's bellRing (the Lighthouse's stages 1 and 8)
//   researchSlotsAdd     one more research project at once, on top of the Library's (no level gives it since the sweep:
//                        every project was done long before the Lighthouse's stage 7; the key still reads)
//   marketRaresAdd       the Market sells this many more rare materials between two runs (the Lighthouse's stage 7)
// Content a level brings (a character, a relic, a consumable) says so itself: its `unlock` is
// 'building:<id>:<level>' (for example the Harpooner's is 'building:tavern:1').
//
// Every cost drops on a map that's built (§10.5), so the economy has no dead ends, and the MVP
// buildings (the Lamp Post, the Library, the Tavern) cost only what map 1, the Drowned Docks,
// drops, so they never wait on a second map; tests/content.test.js checks both. 0.8.0, the Salt
// Marsh: its materials come in from level 2 or 3, never level 1 (the Apothecary's Oil becomes
// Marsh Herbs from level 2, the Docks take a pinch of Herbs at levels 3 to 5, the Smithy Salt
// Glass from level 3), and every Smithy and Apothecary level keeps a Docks material beside the
// Marsh one, so neither map is ever finished. The Chapel's Candles and Bone wait for the Sunken
// Chapel. The numbers are the pacing simulator's (tools/pacing; ARCHITECTURE §10.3) and Kevin's:
// 0.8.0's refit, on yields measured per map and harbor stage, puts every level past the first (and
// the Docks' and the Tavern's first, so a first run doesn't open the Salt Marsh) at four times its
// common materials, twice its Iron and Map Scraps, and the Marsh's Herbs and Glass at 14 and 10
// times what B5a placed (a Marsh run brings home about as many Herbs as a Docks run does Timber).
// The Lamp Post's and the Library's first levels are as they were: a first cleared run buys them
// and the Lamp Post's second (and in most runs the Library's second), not four buildings.

// The sweep, X2 (D5: ten systems in the first six runs). Level gates, not prices: curses wait for
// the Chapel's level 4 (they came with its first, beside Tides); the Heirloom is the Tavern's level 3;
// set runs are the Cartographer's level 3. A save that had curses from a lower level keeps them
// (meta/retired.js, profile.cursesHeld).
// The sweep, X3 (D5: still seven systems by hour 2, two of them in one run). Three first levels wait on
// something besides their cost: Tides (the Chapel) on the Salt Widow killed, so they come once both
// maps are cleared; gear (the Smithy) on the Tavern's level 2; run tools (the Apothecary) on the
// Smithy's level 3. In the pacing model on today's yields the systems come a run or more apart from
// run 3: the Ferryman (3), the board and the Marsh (4), Tides (5), mastery (6), the Heirloom (7), gear
// (9), re-rolls (13), run tools (14) (work/sweep/X3/walk.mjs).

export const BUILDINGS = [
  {
    id: 'lamp_post', name: 'Lamp Post', desc: 'The harbor\'s big lamp. Each level pushes the fog back and opens new Harbor upgrades, bought here with materials, for every run. Two of its levels add a weapon slot to your runs.',
    npc: 'lamp_keeper', material: 'oil',
    levels: [
      { cost: { oil: 15, coin: 15 }, tree: 1 },
      { cost: { oil: 520, coin: 480, timber: 160 }, tree: 2 },
      { cost: { oil: 640, coin: 600, rope: 100 }, tree: 3, lampSpeed: 0.25 },
      { cost: { oil: 900, coin: 780, timber: 180, iron: 10 }, tree: 4 },
      { cost: { oil: 1400, coin: 1200, rope: 180, iron: 30, map_scraps: 6 }, tree: 5, lampSpeed: 0.5 },
    ],
  },
  {
    id: 'library', name: 'Library', desc: 'Pay materials to start a research project. It finishes after a few runs, and what it finds (new weapons, passives, and relics) can then turn up in your runs.',
    npc: 'librarian', material: 'drowned_pages',
    levels: [
      { cost: { drowned_pages: 40, coin: 90, timber: 25 }, researchSlots: 1, researchTier: 1 },
      { cost: { drowned_pages: 360, coin: 640, timber: 180 }, researchTier: 2 },
      { cost: { drowned_pages: 440, coin: 720, rope: 100 }, researchSlots: 2 },
      { cost: { drowned_pages: 600, coin: 780, timber: 160, iron: 10 }, researchTier: 3 },
      { cost: { drowned_pages: 900, coin: 1150, rope: 160, map_scraps: 6 }, researchSlots: 3, researchTier: 4 },
    ],
  },
  {
    id: 'tavern', name: 'Tavern', desc: 'Keeps the Harbor Orders board (goals the townsfolk post) and each character\'s mastery. Its later levels add relics to your runs and let a run set out with an Heirloom.',
    npc: 'innkeeper', material: 'rum',
    levels: [
      { cost: { coin: 1200, rum: 120, timber: 200 }, feats: 1 },
      { cost: { coin: 1200, rum: 140, rope: 200 }, mastery: 1 },
      { cost: { coin: 1300, rum: 140, timber: 200 }, heirloom: 1 },
      { cost: { coin: 1600, rum: 160, rope: 180, iron: 10 } },
      { cost: { coin: 1900, rum: 180, map_scraps: 8 } },
    ],
  },
  {
    id: 'docks', name: 'Docks', desc: 'Restore the Docks and the Ferryman appears in your runs, tying up near you to sell relics, food, and more for Pearls. Each level improves what he sells, and its later levels add relic slots.',
    npc: 'dockhand', material: 'timber',
    levels: [
      { cost: { timber: 440, rope: 240, coin: 800 }, ferry: 1 },
      { cost: { timber: 560, rope: 320, coin: 960, iron: 8 }, ferry: 2 },
      { cost: { timber: 640, rope: 380, coin: 1100, map_scraps: 4, marsh_herbs: 110 }, ferry: 3 },
      { cost: { timber: 800, rope: 480, coin: 1250, iron: 20, marsh_herbs: 170 }, ferry: 4 },
      { cost: { timber: 880, rope: 560, coin: 1400, map_scraps: 10, marsh_herbs: 220 }, ferry: 5 },
    ],
  },
  {
    id: 'smithy', name: 'Smithy', desc: 'Make gear here: pieces you wear into every run, each with a bonus. Its levels add passive slots to your runs. A later level gives your starting weapon one of its Rare traits in every run.',
    npc: 'smith', material: 'iron',
    levels: [
      { cost: { iron: 6, timber: 30, coin: 90 }, gearSlots: 4, gearTier: 1, needs: 'building:tavern:2' },
      { cost: { iron: 25, rope: 120, coin: 560 }, gearTier: 3 },
      { cost: { iron: 40, timber: 240, coin: 800, salt_glass: 30 }, gearSlots: 5, reroll: 1 },
      { cost: { iron: 60, rope: 280, coin: 1100, map_scraps: 6, salt_glass: 50 }, tempering: 1, gearTier: 4 },
      { cost: { iron: 90, coin: 1450, map_scraps: 10, salt_glass: 80 }, gearSlots: 6, gearTier: 5 },
    ],
  },
  {
    id: 'chapel', name: 'Chapel', desc: 'Opens Tides, then curses: ways to make a run harder for more materials. You pick them at the gate before a run.',
    npc: 'warden', material: 'drowned_pages',
    levels: [
      { cost: { drowned_pages: 30, oil: 40, coin: 80 }, tideMax: 2, needs: 'boss:salt_widow' },
      { cost: { drowned_pages: 220, oil: 280, coin: 520, iron: 8 }, tideMax: 4 },
      { cost: { drowned_pages: 340, oil: 440, coin: 760 }, tideMax: 6, bellRing: 0.25 },
      { cost: { drowned_pages: 480, oil: 640, coin: 1050, map_scraps: 6 }, tideMax: 8, curses: 3 },
      { cost: { drowned_pages: 680, oil: 880, coin: 1400, map_scraps: 10 }, tideMax: 10, curses: 5 },
    ],
  },
  {
    id: 'market', name: 'Market', desc: 'Swap a material you have plenty of for one you need, at a poor rate. Later, Pearls you didn\'t spend in a run come home as Coin.',
    npc: 'trader', material: 'coin',
    levels: [
      { cost: { coin: 150, timber: 20 }, market: 1 },
      { cost: { coin: 880, rope: 120 }, glassToCoin: 0.5 },
      { cost: { coin: 1200, rum: 50, iron: 8 }, market: 2 },
      { cost: { coin: 1600, timber: 240, rope: 160 }, glassToCoin: 1 },
      { cost: { coin: 2100, iron: 15, map_scraps: 8 }, market: 3 },
    ],
  },
  {
    id: 'apothecary', name: 'Apothecary', desc: 'Sells run tools: rerolls, banishes, skips, a Revival, and a head start for one run. You pick them at the gate, and the run uses them up. Its other levels make food heal more.',
    npc: 'apothecary', material: 'rum',
    levels: [
      { cost: { rum: 6, oil: 30, coin: 70 }, consumableSlots: 1, needs: 'building:smithy:3' },
      { cost: { rum: 40, marsh_herbs: 350, coin: 400 }, foodHeal: 0.25 },
      { cost: { rum: 65, marsh_herbs: 560, coin: 640, iron: 8 }, consumableSlots: 2 },
      { cost: { rum: 95, marsh_herbs: 840, coin: 880 }, foodHeal: 0.5 },
      { cost: { rum: 140, marsh_herbs: 1200, coin: 1200, map_scraps: 8 }, consumableSlots: 3 },
    ],
  },
  {
    id: 'cartographer', name: 'Cartographer', desc: 'Draws more onto your minimap: Reliquaries wherever they drop, then small secrets, then the big ones, with hints. It also posts Challenge runs on the Harbor Orders board and opens short runs.',
    npc: 'cartographer', material: 'map_scraps',
    levels: [
      { cost: { map_scraps: 2, drowned_pages: 25, coin: 70 }, tasksOnMap: 1 },
      { cost: { map_scraps: 8, drowned_pages: 180, coin: 480 }, findsOnMap: 1 },
      { cost: { map_scraps: 10, timber: 200, coin: 680 }, challenges: 1 },
      { cost: { map_scraps: 20, rope: 240, coin: 920 }, shortRuns: 1 },
      { cost: { map_scraps: 25, drowned_pages: 440, coin: 1200 }, secretsOnMap: 1 },
    ],
  },
  // 0.9.0 (W5; the veteran round: "the runway ends at about 13 hours" and materials stop
  // mattering once the harbor is done): the Lighthouse, a ten-stage relight that soaks up what
  // late runs bring home. Each stage is a big mix from both maps (about 1.2 to 3 runs of a
  // practiced player's haul, rising: work/veteran/W5/income.txt), shows in the harbor (the tower
  // comes back over stages 1 to 5, then its lamps, bunting, gallery, and the beam), and opens one
  // thing: what's keyed 'building:lighthouse:<stage>', faster lamps (stage 1), a run tool slot (stage 4), wider bells (stage 8), or more of the
  // Market's rare materials between runs (stage 7, when Iron is what the harbor is short of). It's in the fog
  // until the Lamp Post's last level.
  {
    id: 'lighthouse', name: 'Lighthouse', desc: 'The old light on the point. Relight it stage by stage with materials from every map. Each stage shows on the tower and opens something new.',
    npc: 'lighthouse_keeper', material: 'oil',
    stages: ['Clear the rubble', 'Shore up the tower', 'Rebuild the stair', 'Glaze the lantern room', "Light the keeper's room", 'Mend the gallery', 'Set the lens', 'Hang the fog bell', 'Fill the oil store', 'Light the lamp'],
    levels: [
      { cost: { oil: 900, coin: 2400, timber: 400, drowned_pages: 350, iron: 14 }, stage: 1, lampSpeedAdd: 0.25 },
      { cost: { oil: 840, coin: 2400, rope: 150, drowned_pages: 290, iron: 14, marsh_herbs: 480, salt_glass: 32 }, stage: 2 },
      { cost: { oil: 960, coin: 2800, timber: 350, drowned_pages: 340, iron: 16, map_scraps: 6, marsh_herbs: 540, salt_glass: 37 }, stage: 3 },
      { cost: { oil: 1100, coin: 3200, rope: 200, drowned_pages: 380, rum: 110, iron: 18, marsh_herbs: 610, salt_glass: 41 }, stage: 4, consumableSlotsAdd: 1 },
      { cost: { oil: 1200, coin: 3500, timber: 440, drowned_pages: 420, iron: 20, marsh_herbs: 680, salt_glass: 46 }, stage: 5 },
      { cost: { oil: 1300, coin: 3900, rope: 240, drowned_pages: 460, iron: 22, map_scraps: 9, marsh_herbs: 750, salt_glass: 51 }, stage: 6 },
      { cost: { oil: 1400, coin: 4200, timber: 530, drowned_pages: 500, iron: 24, marsh_herbs: 820, salt_glass: 55 }, stage: 7, marketRaresAdd: 3 },
      { cost: { oil: 1600, coin: 4600, rope: 290, drowned_pages: 550, rum: 160, iron: 26, marsh_herbs: 880, salt_glass: 60 }, stage: 8, bellRingAdd: 0.25 },
      { cost: { oil: 1700, coin: 4900, timber: 620, drowned_pages: 590, iron: 28, map_scraps: 11, marsh_herbs: 950, salt_glass: 64 }, stage: 9 },
      { cost: { oil: 1800, coin: 5200, rope: 330, drowned_pages: 630, iron: 30, marsh_herbs: 1000, salt_glass: 69 }, stage: 10 },
    ],
  },
];

/** The levels a building can reach (the ruin is level 0). The Lighthouse has ten stages instead (data/buildings.js levels). */
export const MAX_BUILDING_LEVEL = 5;
