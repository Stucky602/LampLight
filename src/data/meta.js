// Rules of the meta layer (ARCHITECTURE §10.2, §10.5): what a run must do to count for research,
// what a run pays for the time it lasted, mastery's ranks, the
// Market's cap on rares, which buildings make the MVP harbor, and the field guide's entries.

export const META = Object.freeze({
  researchQualifySec: 300,                  // a run advances research if it lasts this long...
  researchQualifyBoss: true,                // ...or kills a boss
  // Time-survived pay (0.7.3): every whole minute a run lasts brings this home on top of what it
  // picked up, up to `capMinutes`, so an early death still pays for the walk. Overtime is paid in
  // drops instead, so the pay stops at the last boss's minute.
  timePay: Object.freeze({ perMinute: Object.freeze({ coin: 4, oil: 2 }), capMinutes: 20 }),
  // (The sweep, ruling 13: the bestiary's ladders and rung rewards went. Kill counts are on the codex's
  // enemy page, and each enemy's Hunt is a Harbor Order: data/trophies.js. What the old rungs paid is
  // in meta/retired.js, which pays a save the rungs it had reached and not claimed.)
  // Mastery's ranks (0.7.3: ten): the mastery XP each rank needs (tuning.mastery says what a run
  // gives). Perks sit at ranks 1, 3, 5, 7, and 9, the second starting kit at 4 (data/mastery.js).
  masteryRanks: Object.freeze([8, 25, 50, 90, 140, 200, 270, 350, 440, 540, 800]),
  // The Market (0.7.3): how many rare materials it sells between two runs, so it fills a gap
  // rather than replacing the elites that drop them.
  marketRaresPerRun: 3,
  // The MVP harbor (§10.5): everything these sell (their levels, the Lamp Post's upgrades, and the
  // Library's research of the tiers they open) is paid for from map 1 (tests/content.test.js), and
  // "the MVP harbor fully restored" is these at their last level (tools/pacing).
  mvpBuildings: Object.freeze(['lamp_post', 'library', 'tavern']),
  // The field guide (0.8.0; the pause menu, and the first-sighting notices): each thing a map shows,
  // by the name the sim's first sighting gives (sim/events.js SIGHT_NAMES), is a glossary entry
  // (`term`, data/glossary.js). Its name and its line are that entry's (its `short`): nothing is
  // described here, so a rule that changes is written once (the sweep, A1: this list once kept its
  // own lines, and the lamp's still said a boss puts it out). Enemies use their own name and
  // description (data/enemies.js).
  fieldGuide: Object.freeze({
    water: Object.freeze({ term: 'high_water' }),
    storm: Object.freeze({ term: 'storm' }),
    eye: Object.freeze({ term: 'eye' }),
    herbs: Object.freeze({ term: 'herbs' }),
    well: Object.freeze({ term: 'well' }),
    pillar: Object.freeze({ term: 'pillar' }),
    causeway: Object.freeze({ term: 'causeway' }),
    thrall: Object.freeze({ term: 'thrall' }),
    // The interactables (0.8.2), on every map.
    lamp: Object.freeze({ term: 'lamp' }),
    bell: Object.freeze({ term: 'bell' }),
    ferry: Object.freeze({ term: 'ferryman' }),
    reliquary: Object.freeze({ term: 'reliquary' }),
  }),
});
