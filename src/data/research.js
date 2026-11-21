// Library research (ARCHITECTURE §10.6; brief §6.4). A project costs materials to start and
// finishes after a set number of qualifying runs, never after real time: a run counts when it
// lasts at least META.researchQualifySec (5:00) or kills a boss (§10.2). What a project adds says
// so itself: each weapon, passive, relic, gear recipe, or run tool it brings has
// `unlock: 'research:<id>'`, so there is one place that decides where a thing comes from (the
// Library lists it from there; `desc` is only the flavor).
//
// tier: its research tier (the Library's levels open tiers: buildings.js researchTier, tier 3 at
// level 4, tier 4 at level 5). requires: projects that must be finished first.
// needs (the sweep, D2): an unlock key that must be met before it can start: a project that finds
// things for a building in the fog waits for that building ('building:smithy:1'), so nothing is
// found two runs before there is anywhere to use it.
// Ids are permanent (saves hold them); a name can change: 'signal_codes' is the Harbor Clock and
// 'storm_glass' the Weatherglass since 0.7.3, when the Lantern Orb, Tide Bell, Signal Mirror, and
// Ballast became starters and their projects took Tallow Candle, Lodestone, the Tide Clock relic,
// and Sea Legs instead.
// 0.8.2: the Spark Flint and the Tide Clock became starters (a fresh relic pool of four), so the
// Harbor Clock opens Undertow (from Tide Charts) and Drowned Charms the Lucky Knot (from the
// Almanac) instead.
// Prices (0.8.0's refit, tools/pacing): tiers 2 to 4 at four times their common materials, twice
// their Iron and Map Scraps, and the Marsh's Herbs and Glass at 14 and 10 times; tier 1, a first
// run's, as it was.

export const RESEARCH = [
  // Tier 1: the Library's first level.
  {
    id: 'orbwright', name: "Orbwright's Notes", desc: 'A glassmaker\'s notes on lamp glass and candles.',
    tier: 1, cost: { drowned_pages: 8, coin: 20 }, runs: 1, requires: [],
  },
  {
    id: 'tide_charts', name: 'Harbor Charts', desc: 'The old harbormaster\'s charts and compass.',
    tier: 1, cost: { drowned_pages: 12, coin: 30 }, runs: 2, requires: [],
  },
  {
    id: 'rune_stones', name: 'Carved Stones', desc: 'Carved stones from the breakwater.',
    tier: 1, cost: { drowned_pages: 10, rope: 6 }, runs: 1, requires: [],
  },
  {
    id: 'signal_codes', name: 'Harbor Clock', desc: 'The clock on the harbormaster\'s wall that told the tides.',
    tier: 1, cost: { drowned_pages: 10, timber: 6 }, runs: 1, requires: [],
  },
  {
    id: 'oil_stores', name: 'Oil Stores', desc: 'A chandler\'s ledger of what burns and how well.',
    tier: 1, cost: { drowned_pages: 12, oil: 15 }, runs: 2, requires: [],
  },
  {
    id: 'ships_ballast', name: "Ship's Ballast", desc: 'Notes on keeping upright on a rolling deck.',
    tier: 1, cost: { drowned_pages: 10, timber: 6 }, runs: 1, requires: [],
  },
  // Tier 2.
  {
    id: 'almanac', name: "Sailor's Almanac", desc: 'A sailor\'s book of weather and luck.',
    tier: 2, cost: { drowned_pages: 100, coin: 160 }, runs: 2, requires: [],
  },
  {
    id: 'reversed_runes', name: 'Stern Lines', desc: 'A pilot\'s notes on what to hang off the stern.',
    tier: 2, cost: { drowned_pages: 80, iron: 4 }, runs: 2, requires: ['rune_stones'],
  },
  {
    id: 'storm_glass', name: 'Weatherglass', desc: 'A sealed glass that clouds before lightning.',
    tier: 2, cost: { drowned_pages: 90, coin: 140, iron: 4 }, runs: 2, requires: ['signal_codes'],
  },
  // Tier 3.
  {
    id: 'volatile_salts', name: 'Volatile Salts', desc: 'Salts that burst when handled.',
    tier: 3, cost: { drowned_pages: 160, coin: 240, iron: 8 }, runs: 3, requires: ['almanac'],
  },
  {
    id: 'corpse_lights', name: 'Corpse Lights', desc: 'Accounts of candle flames seen over drowned men.',
    tier: 3, cost: { drowned_pages: 140, rum: 25, coin: 200 }, runs: 3, requires: ['oil_stores'],
  },
  // Phase 7: gear, run tools, and relics.
  {
    id: 'smiths_ledger', name: "Smith's Ledger", desc: 'Patterns for lanterns, coats, and boots.',
    tier: 1, cost: { drowned_pages: 12, iron: 1, coin: 25 }, runs: 1, requires: [], needs: 'building:smithy:1',
  },
  {
    id: 'herb_notes', name: "Herbalist's Notes", desc: 'The old apothecary\'s recipe book.',
    tier: 1, cost: { drowned_pages: 10, rum: 2, coin: 15 }, runs: 1, requires: [], needs: 'building:apothecary:1',
  },
  {
    id: 'drowned_charms', name: 'Drowned Charms', desc: 'Small things sailors carried for luck.',
    tier: 2, cost: { drowned_pages: 90, rope: 40 }, runs: 2, requires: [],
  },
  {
    id: 'compass_rose', name: 'Compass Rose', desc: 'Instrument makers\' drawings: compasses and rings.',
    tier: 2, cost: { drowned_pages: 95, iron: 4, coin: 160 }, runs: 2, requires: ['smiths_ledger'],
  },
  {
    id: 'moon_tables', name: 'Moon Tables', desc: 'Tables of high and low water.',
    tier: 2, cost: { drowned_pages: 100, oil: 80 }, runs: 2, requires: [],
  },
  {
    id: 'deep_salvage', name: 'Deep Salvage', desc: 'A diver\'s log of what the wrecks still hold.',
    tier: 3, cost: { drowned_pages: 160, iron: 8, rope: 80 }, runs: 3, requires: ['drowned_charms'],
  },
  {
    id: 'brine_rites', name: 'Brine Rites', desc: 'Prayers the chapel said for the drowned.',
    tier: 3, cost: { drowned_pages: 150, rum: 25 }, runs: 3, requires: ['moon_tables'],
  },
  {
    id: 'tide_forging', name: 'Sea Forging', desc: 'A smith\'s notes on working iron at the water\'s edge.',
    tier: 3, cost: { drowned_pages: 170, iron: 10, coin: 240 }, runs: 3, requires: ['compass_rose'],
  },
  // The Salt Marsh (0.8.0). `runsOn`: only runs on that map count (the harbor's research, B5):
  // the Marsh's own point at the Marsh, and the Docks-bound ones cost Salt Glass, so the Marsh
  // points back at the Docks.
  {
    id: 'brine_notes', name: 'Brine Notes', desc: 'Notes on what the salt pans do to things left in them.',
    tier: 2, cost: { marsh_herbs: 280, drowned_pages: 40, coin: 160 }, runs: 2, requires: [], runsOn: 'salt_marsh',
  },
  {
    id: 'ice_house', name: 'Ice House Ledger', desc: 'How the ice house kept fish cold all summer.',
    tier: 2, cost: { marsh_herbs: 250, salt_glass: 20, coin: 160 }, runs: 2, requires: [], runsOn: 'salt_marsh',
  },
  {
    id: 'eel_trapper', name: "Eel Trapper's Notes", desc: 'An eel trapper\'s notes on bait and pots.',
    tier: 2, cost: { marsh_herbs: 310, coin: 180 }, runs: 2, requires: [], runsOn: 'salt_marsh',
  },
  {
    id: 'fowlers_calls', name: "Fowler's Calls", desc: 'A bird hunter\'s notebook of calls and lamp oil.',
    tier: 2, cost: { drowned_pages: 95, rope: 30, coin: 160 }, runs: 2, requires: [],
  },
  {
    id: 'fulgurite', name: 'Fog Signals', desc: 'Notes on fog horns and lightning rods.',   // (the id is the Fulgurite's, which the Fog Horn replaced: saves keep it)
   
    tier: 3, cost: { marsh_herbs: 420, salt_glass: 50, coin: 240 }, runs: 3, requires: [], runsOn: 'salt_marsh',
  },
  {
    id: 'anchor_smithing', name: 'Anchor Smithing', desc: 'Forging an anchor that holds in any bottom.',
    tier: 3, cost: { iron: 8, salt_glass: 40, coin: 240 }, runs: 3, requires: [], runsOn: 'drowned_docks',
  },
  {
    id: 'salting_ledger', name: 'Salting Ledger', desc: 'The salt house\'s account book.',
    tier: 3, cost: { drowned_pages: 120, salt_glass: 50, coin: 200 }, runs: 3, requires: [], runsOn: 'drowned_docks',
  },
  {
    id: 'lantern_lore', name: 'Lantern Lore', desc: 'Old stories about the harbor\'s lanterns.',
    tier: 4, cost: { drowned_pages: 280, map_scraps: 6, coin: 400 }, runs: 4, requires: ['deep_salvage'],
  },
];
