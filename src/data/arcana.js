// Arcana (ARCHITECTURE §10.6): one chosen at the gate for a run, each a rule the run plays by
// (a hook in src/sim/hooks.js, sometimes with a price in stat modifiers). They come from research,
// a challenge, and a feat (`unlock`).

export const ARCANA = [
  {
    id: 'high_water', name: 'High Water', desc: 'Every 60s, every gem on the map flies to you.', icon: 'arcana_high_water',
    unlock: 'research:moon_tables', hook: 'arcana_vacuum', params: { every: 60 },
  },
  {
    id: 'brine', name: 'Brine', desc: 'Kills by Tide weapons heal you 1 HP, up to 3 a second.', icon: 'arcana_brine',
    unlock: 'research:brine_rites', hook: 'arcana_tide_heal', params: { heal: 1, perSecond: 3 },
  },
  {
    id: 'kindling', name: 'Kindling', desc: 'Elites drop an Ember twice as often, and bosses drop 2.', icon: 'arcana_kindling',
    unlock: 'challenge:lamp_only', hook: 'arcana_embers', params: { eliteMul: 2, bossExtra: 1 },
  },
  {
    id: 'glassblower', name: 'Glassblower', desc: 'Relics are offered a tier better. -15% Max HP.', icon: 'arcana_glassblower',
    unlock: 'feat:lantern_night', hook: 'arcana_relic_tier', params: { tiers: 1 },
    mods: [{ stat: 'maxHp', op: 'pct', value: -0.15 }],
  },
];
