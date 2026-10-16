// Library research (ARCHITECTURE §10.6; brief §6.4). A project costs materials to start and
// finishes after a set number of qualifying runs, never after real time: a run counts when it
// lasts at least META.researchQualifySec (5:00) or kills a boss (§10.2). What a project adds to
// your runs says so itself: each weapon, passive, relic, or rune it brings has
// `unlock: 'research:<id>'`, so there is one place that decides where a thing comes from (the
// Library lists it from there; `desc` is only the flavor).
//
// tier: its research tier (the Library's levels open tiers: buildings.js researchTier, tier 3 at
// level 4). requires: projects that must be finished first. Phase 5 builds this basic tree;
// Phase 7 grows it.

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
];
