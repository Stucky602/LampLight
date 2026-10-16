// The harbor's buildings (ARCHITECTURE §10.4, §10.5; brief §6.1). Each has 5 levels after its
// ruined state, and each level costs materials and opens something. Phase 5 builds the three MVP
// buildings; the other plots on the hub map (data/hub.js) stay ruins until Phase 7.
//
// A level's effects (the building panel describes them from here):
//   tree: n            the Lamp Post's upgrades of tier n can be bought (data/upgrades.js)
//   researchTier: n    Library research of tier n can be started (data/research.js)
//   researchSlots: n   this many research projects can run at once
// Content a level brings (a character, a relic) says so itself: its `unlock` is
// 'building:<id>:<level>' (for example the Harpooner's is 'building:tavern:1').
//
// Costs use only materials that drop on map 1, the Drowned Docks (§10.5), so the MVP economy
// has no dead ends; tests/content.test.js checks it. The numbers are a first pass for the pacing
// simulator (tools/pacing) and Kevin.

export const BUILDINGS = [
  {
    id: 'lamp_post', name: 'Lamp Post', desc: 'Burns Oil to push the fog back. Unlocks permanent upgrades.',
    npc: 'lamp_keeper', material: 'oil',
    levels: [
      { cost: { oil: 15, coin: 15 }, tree: 1 },
      { cost: { oil: 70, coin: 60, timber: 15 }, tree: 2 },
      { cost: { oil: 135, coin: 120, rope: 20 }, tree: 3 },
      { cost: { oil: 225, coin: 195, timber: 45, iron: 6 }, tree: 4 },
      { cost: { oil: 345, coin: 300, rope: 45, iron: 15, map_scraps: 3 }, tree: 5 },
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
      { cost: { drowned_pages: 225, coin: 285, rope: 40, map_scraps: 3 }, researchSlots: 3 },
    ],
  },
  {
    id: 'tavern', name: 'Tavern', desc: 'Brings new characters and relics to the harbor.',
    npc: 'innkeeper', material: 'rum',
    levels: [
      { cost: { coin: 90, rum: 5, timber: 10 } },
      { cost: { coin: 150, rum: 9, rope: 15 } },
      { cost: { coin: 225, rum: 15, timber: 25 } },
      { cost: { coin: 315, rum: 22, rope: 35, iron: 6 } },
      { cost: { coin: 420, rum: 33, map_scraps: 4 } },
    ],
  },
];

/** The levels a building can reach (the ruin is level 0). */
export const MAX_BUILDING_LEVEL = 5;
