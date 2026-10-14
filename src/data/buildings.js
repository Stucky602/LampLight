// The harbor's buildings (ARCHITECTURE §10.4, §10.5; brief §6.1). Each has 5 levels after its
// ruined state, and each level costs materials and opens something. Phase 5 builds the three MVP
// buildings; the other plots on the hub map (data/hub.js) stay in the fog until Phase 7.
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
      { cost: { oil: 45, coin: 40, timber: 10 }, tree: 2 },
      { cost: { oil: 90, coin: 80, rope: 15 }, tree: 3 },
      { cost: { oil: 150, coin: 130, timber: 30, iron: 4 }, tree: 4 },
      { cost: { oil: 230, coin: 200, rope: 30, iron: 10, map_scraps: 2 }, tree: 5 },
    ],
  },
  {
    id: 'library', name: 'Library', desc: 'Researches new weapons, passives, and runes.',
    npc: 'librarian', material: 'drowned_pages',
    levels: [
      { cost: { drowned_pages: 10, coin: 20, timber: 5 }, researchSlots: 1, researchTier: 1 },
      { cost: { drowned_pages: 30, coin: 45, timber: 12 }, researchTier: 2 },
      { cost: { drowned_pages: 60, coin: 80, rope: 12 }, researchSlots: 2 },
      { cost: { drowned_pages: 100, coin: 130, timber: 25, iron: 4 }, researchTier: 3 },
      { cost: { drowned_pages: 150, coin: 190, rope: 25, map_scraps: 2 }, researchSlots: 3 },
    ],
  },
  {
    id: 'tavern', name: 'Tavern', desc: 'Brings new characters and relics to the harbor.',
    npc: 'innkeeper', material: 'rum',
    levels: [
      { cost: { coin: 90, rum: 5, timber: 10 } },
      { cost: { coin: 100, rum: 6, rope: 10 } },
      { cost: { coin: 150, rum: 10, timber: 18 } },
      { cost: { coin: 210, rum: 15, rope: 22, iron: 4 } },
      { cost: { coin: 280, rum: 22, map_scraps: 3 } },
    ],
  },
];

/** The levels a building can reach (the ruin is level 0). */
export const MAX_BUILDING_LEVEL = 5;
