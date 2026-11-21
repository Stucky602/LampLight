// Set runs (the sweep, ruling 13; they were "challenge runs", chosen at the gate). A set run is a
// Harbor Order with rules of its own: who sets out, on which map, at what Tide, with which curses,
// and which pools are empty. It is posted on the board (the Cartographer's level that carries
// `challenges`, and its own `needs` when it has one) and started from the board, never the gate.
// Like every order it opens exactly one thing (the content keyed 'feat:<id>').
//
//   rules.character  who sets out (with the character's own first weapon)
//   rules.map        the map it's played on
//   rules.tide       the Tide it's played at (0 when absent)
//   rules.curses     curses it adds
//   rules.pools      pools emptied for the run ('weapons': no new weapons from level-ups; 'passives')
//   when             { run: '<its id>', surviveSec | boss }: the run set out as this order, and its goal
//   needs            a key that must be met before it's posted (a mastery rank's trial, the Lighthouse's)
//
// Ids are the challenge ids saves hold (profile.challenges before the sweep): a challenge won is its
// order done (meta/retired.js). 'flood' (Swarm Tide) paid only materials and went.
// The six trials paid only materials; each opens a perk for its character now (data/mastery.js).

const DOCKS = 'drowned_docks', MARSH = 'salt_marsh';
const R = { unlock: true };
const run = (id, name, desc, by, tier, rules, goal, needs) => ({
  id, name, desc, group: 'run', tier, by, visibility: 'visible', rules, when: { run: id, ...goal }, reward: R, ...(needs ? { needs } : {}),
});

export const SET_RUNS = [
  run('lamp_only', 'Lamp Only', 'Play the Lamplighter. Level-ups offer no new weapons. Survive to 10:00.', 'cartographer', 2,
    { character: 'lamplighter', map: DOCKS, pools: ['weapons'] }, { surviveSec: 600 }),
  run('bare_hands', 'Bare Hands', 'Play the Harpooner. Level-ups offer no passives. Kill the Harbor Maw.', 'cartographer', 2,
    { character: 'harpooner', map: DOCKS, pools: ['passives'] }, { boss: 'harbor_maw' }),
  run('brittle_tide', 'Brittle Tide', 'Play the Harpooner at Tide 3, with the Brittle curse. Kill the Harbor Maw.', 'cartographer', 3,
    { character: 'harpooner', map: DOCKS, tide: 3, curses: ['brittle'] }, { boss: 'harbor_maw' }),
  // The Salt Marsh.
  run('low_water', 'Bare Pole', 'Play the Punter. Level-ups offer no passives. Kill the Old Grey.', 'cartographer', 2,
    { character: 'punter', map: MARSH, pools: ['passives'] }, { boss: 'old_grey' }),
  run('bog_lights', 'Hungry Marsh', 'Play the Bog Warden at Tide 3, with the Hunger curse. Survive to 12:00.', 'cartographer', 3,
    { character: 'bog_warden', map: MARSH, tide: 3, curses: ['hunger'] }, { surviveSec: 720 }),
  run('salt_and_iron', 'Salt and Iron', 'Play the Harpooner. Level-ups offer no new weapons. Survive to 10:00 on the Salt Marsh.', 'cartographer', 2,
    { character: 'harpooner', map: MARSH, pools: ['weapons'] }, { surviveSec: 600 }),
  run('widow_watch', 'Widow Watch', 'Play the Lamplighter at Tide 5, with the Fast Water curse. Kill the Salt Widow.', 'cartographer', 3,
    { character: 'lamplighter', map: MARSH, tide: 5, curses: ['fast_water'] }, { boss: 'salt_widow' }),
  // The Lighthouse's stage 5.
  run('long_watch', 'Long Watch', 'Play the Lamplighter at Tide 4. Survive to 25:00, 5 minutes into overtime.', 'lighthouse_keeper', 4,
    { character: 'lamplighter', map: DOCKS, tide: 4 }, { surviveSec: 1500 }, 'building:lighthouse:5'),
  // Mastery rank 8: each character's own trial.
  run('lamplighter_trial', "Lamplighter's Trial", 'Play the Lamplighter at Tide 6, with the Dull Edge curse. Kill the Tidecaller.', 'innkeeper', 4,
    { character: 'lamplighter', map: DOCKS, tide: 6, curses: ['dull_edge'] }, { boss: 'the_tidecaller' }, 'mastery:lamplighter:8'),
  run('harpooner_trial', "Harpooner's Trial", 'Play the Harpooner at Tide 6, with the Brittle curse. Kill the Tidecaller.', 'innkeeper', 4,
    { character: 'harpooner', map: DOCKS, tide: 6, curses: ['brittle'] }, { boss: 'the_tidecaller' }, 'mastery:harpooner:8'),
  run('punter_trial', "Punter's Trial", 'Play the Punter at Tide 6, with the Fast Water curse. Kill the Salt Widow.', 'innkeeper', 4,
    { character: 'punter', map: MARSH, tide: 6, curses: ['fast_water'] }, { boss: 'salt_widow' }, 'mastery:punter:8'),
  run('warden_trial', "Warden's Trial", 'Play the Bog Warden at Tide 6, with the Swarm curse. Kill the Salt Widow.', 'innkeeper', 4,
    { character: 'bog_warden', map: MARSH, tide: 6, curses: ['swarm'] }, { boss: 'salt_widow' }, 'mastery:bog_warden:8'),
  run('drowned_man_trial', "Drowned Man's Trial", 'Play the Drowned Man at Tide 6, with the Hunger curse. Kill the Tidecaller.', 'innkeeper', 4,
    { character: 'drowned_man', map: DOCKS, tide: 6, curses: ['hunger'] }, { boss: 'the_tidecaller' }, 'mastery:drowned_man:8'),
  run('tide_priest_trial', "Tide Priest's Trial", 'Play the Tide Priest at Tide 6, with the Fast Water curse. Kill the Salt Widow.', 'innkeeper', 4,
    { character: 'tide_priest', map: MARSH, tide: 6, curses: ['fast_water'] }, { boss: 'salt_widow' }, 'mastery:tide_priest:8'),
];

/**
 * The set runs as the run's config reads them (meta/runconfig.js; RunConfig.challenge is the id):
 * { id, name, desc, map, character, tide, curses, pools, unlock? }. `unlock` is the order's `needs`,
 * so a mastery rank or a Lighthouse stage says "New set run" for what it posts.
 */
export const CHALLENGES = SET_RUNS.map((o) => ({ id: o.id, name: o.name, desc: o.desc, ...o.rules, ...(o.needs ? { unlock: o.needs } : {}) }));
