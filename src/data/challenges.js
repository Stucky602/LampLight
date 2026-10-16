// Challenge runs (ARCHITECTURE §10.6), chosen at the gate once the Cartographer reaches level 3.
// Each is a fixed loadout plus restrictions, a goal, and a reward you can't get any other way.
//   character   who sets out (the kit is the character's first)
//   tide        the Tide it's played at (0 when absent)
//   curses      curses it adds
//   pools       pools emptied for the run ('weapons': no new weapons from level-ups; 'passives')
//   goal        { surviveSec } or { boss } (that boss killed)
//   reward      { unlock: true } (content keyed 'challenge:<id>') and/or { materials }

export const CHALLENGES = [
  {
    id: 'lamp_only', name: 'Lamp Only', desc: 'Lamplighter, with no new weapons from level-ups. Survive 10:00.',
    character: 'lamplighter', pools: ['weapons'], goal: { surviveSec: 600 },
    reward: { unlock: true },
  },
  {
    id: 'bare_hands', name: 'Bare Hands', desc: 'Harpooner, with no passives. Kill The Harbor Maw.',
    character: 'harpooner', pools: ['passives'], goal: { boss: 'harbor_maw' },
    reward: { unlock: true },
  },
  {
    id: 'flood', name: 'Flood', desc: 'Lamplighter at Tide 4 with Swarm. Survive 8:00.',
    character: 'lamplighter', tide: 4, curses: ['swarm'], goal: { surviveSec: 480 },
    reward: { materials: { map_scraps: 6, iron: 8 } },
  },
];
