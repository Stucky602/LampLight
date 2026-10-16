// Library research (ARCHITECTURE §10.6; brief §6.4). A project costs materials to start and
// finishes after a set number of qualifying runs, never after real time: a run counts when it
// lasts at least META.researchQualifySec (5:00) or kills a boss (§10.2). What a project adds says
// so itself: each weapon, passive, relic, rune, gear recipe, consumable, or arcana it brings has
// `unlock: 'research:<id>'`, so there is one place that decides where a thing comes from (the
// Library lists it from there; `desc` is only the flavor).
//
// tier: its research tier (the Library's levels open tiers: buildings.js researchTier, tier 3 at
// level 4, tier 4 at level 5). requires: projects that must be finished first.

export const RESEARCH = [
  // Tier 1: the Library's first level.
  {
    id: 'orbwright', name: "Orbwright's Notes", desc: 'Notes on holding light in glass.',
    tier: 1, cost: { drowned_pages: 8, coin: 20 }, runs: 1, requires: [],
  },
  {
    id: 'tide_charts', name: 'Tide Charts', desc: 'The old harbormaster\'s tide charts.',
    tier: 1, cost: { drowned_pages: 12, coin: 30 }, runs: 2, requires: [],
  },
  {
    id: 'rune_stones', name: 'Rune Stones', desc: 'Carved stones from the breakwater.',
    tier: 1, cost: { drowned_pages: 10, rope: 6 }, runs: 1, requires: [],
  },
  {
    id: 'signal_codes', name: 'Signal Codes', desc: 'The flashes ships used to talk across the water.',
    tier: 1, cost: { drowned_pages: 10, timber: 6 }, runs: 1, requires: [],
  },
  {
    id: 'oil_stores', name: 'Oil Stores', desc: 'A chandler\'s ledger of what burns and how well.',
    tier: 1, cost: { drowned_pages: 12, oil: 15 }, runs: 2, requires: [],
  },
  // Tier 2.
  {
    id: 'ships_ballast', name: "Ship's Ballast", desc: 'Notes on keeping a ship upright.',
    tier: 2, cost: { drowned_pages: 20, timber: 12 }, runs: 2, requires: [],
  },
  {
    id: 'almanac', name: "Sailor's Almanac", desc: 'A sailor\'s book of weather and luck.',
    tier: 2, cost: { drowned_pages: 25, coin: 40 }, runs: 2, requires: [],
  },
  {
    id: 'reversed_runes', name: 'Reversed Runes', desc: 'Runes cut in reverse.',
    tier: 2, cost: { drowned_pages: 20, iron: 2 }, runs: 2, requires: ['rune_stones'],
  },
  {
    id: 'storm_glass', name: 'Storm Glass', desc: 'A sealed glass that clouds before lightning.',
    tier: 2, cost: { drowned_pages: 22, coin: 35, iron: 2 }, runs: 2, requires: ['signal_codes'],
  },
  // Tier 3.
  {
    id: 'volatile_salts', name: 'Volatile Salts', desc: 'Salts that burst when handled.',
    tier: 3, cost: { drowned_pages: 40, coin: 60, iron: 4 }, runs: 3, requires: ['almanac'],
  },
  {
    id: 'corpse_lights', name: 'Corpse Lights', desc: 'Accounts of candle flames seen over drowned men.',
    tier: 3, cost: { drowned_pages: 35, rum: 6, coin: 50 }, runs: 3, requires: ['oil_stores'],
  },
  // Phase 7: gear, consumables, arcana, and relics.
  {
    id: 'smiths_ledger', name: "Smith's Ledger", desc: 'Patterns for hoods, coats, gloves, and boots.',
    tier: 1, cost: { drowned_pages: 12, iron: 1, coin: 25 }, runs: 1, requires: [],
  },
  {
    id: 'herb_notes', name: "Herbalist's Notes", desc: 'What the old apothecary mixed, and for what.',
    tier: 1, cost: { drowned_pages: 10, rum: 2, coin: 15 }, runs: 1, requires: [],
  },
  {
    id: 'drowned_charms', name: 'Drowned Charms', desc: 'Small things sailors carried for luck.',
    tier: 2, cost: { drowned_pages: 22, rope: 10 }, runs: 2, requires: [],
  },
  {
    id: 'compass_rose', name: 'Compass Rose', desc: 'Instrument makers\' drawings: compasses and rings.',
    tier: 2, cost: { drowned_pages: 24, iron: 2, coin: 40 }, runs: 2, requires: ['smiths_ledger'],
  },
  {
    id: 'moon_tables', name: 'Moon Tables', desc: 'When the water rises, and how far.',
    tier: 2, cost: { drowned_pages: 26, oil: 20 }, runs: 2, requires: [],
  },
  {
    id: 'deep_salvage', name: 'Deep Salvage', desc: 'A diver\'s log of what the wrecks still hold.',
    tier: 3, cost: { drowned_pages: 40, iron: 4, rope: 20 }, runs: 3, requires: ['drowned_charms'],
  },
  {
    id: 'brine_rites', name: 'Brine Rites', desc: 'Old words said over the water.',
    tier: 3, cost: { drowned_pages: 38, rum: 6 }, runs: 3, requires: ['moon_tables'],
  },
  {
    id: 'tide_forging', name: 'Tide Forging', desc: 'Working iron with the tide in it.',
    tier: 3, cost: { drowned_pages: 42, iron: 5, coin: 60 }, runs: 3, requires: ['compass_rose'],
  },
  {
    id: 'lantern_lore', name: 'Lantern Lore', desc: 'Why the drowned bell still rings.',
    tier: 4, cost: { drowned_pages: 70, map_scraps: 3, coin: 100 }, runs: 4, requires: ['deep_salvage'],
  },
];
