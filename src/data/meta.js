// Rules of the meta layer (ARCHITECTURE §10.2, §10.5): what a run must do to count for research,
// when the results screen calls out a bestiary count, and which buildings make the MVP harbor.

export const META = Object.freeze({
  researchQualifySec: 300,                  // a run advances research if it lasts this long...
  researchQualifyBoss: true,                // ...or kills a boss
  bestiaryMilestones: Object.freeze([10, 100, 1000, 10000]),
  // The MVP harbor (§10.5): everything these sell (their levels, the Lamp Post's upgrades, and the
  // Library's research of the tiers they open) is paid for from map 1 (tests/content.test.js), and
  // "the MVP harbor fully restored" is these at their last level (tools/pacing).
  mvpBuildings: Object.freeze(['lamp_post', 'library', 'tavern']),
  // The Cartographer's bestiary rewards (data/buildings.js bestiary): what each milestone of
  // META.bestiaryMilestones pays out once claimed, per enemy kind. The third and fourth add a
  // small, capped bonus against that kind (`damageMul`, at most bestiaryBonusMax over every claim).
  bestiaryRewards: Object.freeze([
    Object.freeze({ materials: Object.freeze({ coin: 20 }) }),
    Object.freeze({ materials: Object.freeze({ coin: 60, drowned_pages: 6 }) }),
    Object.freeze({ materials: Object.freeze({ coin: 150, iron: 2 }), damageMul: 0.03 }),
    Object.freeze({ materials: Object.freeze({ coin: 400, map_scraps: 3 }), damageMul: 0.03 }),
  ]),
  bestiaryBonusMax: 0.06,
});
