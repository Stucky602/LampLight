// Tides and curses (ARCHITECTURE §10.6), chosen at the gate. Both make a run harder for more
// materials. A Tide is the whole run turned up: enemies tougher, harder-hitting, more of them,
// a little faster. (0.9.0: its density raises the bands' floors too, by half its step, and its
// health reaches a boss only as its square root: tuning.director.floorTide and bossTideExp; from
// Tide 2 every elite has two affixes: tuning.affixes.) Tide 1 opens once you've cleared the map at Tide 0, and each Tide you clear
// opens the next, up to what the Chapel's level allows (data/buildings.js tideMax).
//
// A curse is one rule against you, for a share more materials; the Chapel's level says how many
// of them (in this order) can be chosen, and they stack. rewardMul adds to the run's material
// multiplier (Tide and curses together: 1 + their sum).

//
// From Tide 2 each Tide also adds a rule (brief §6.6: "elites spawn in pairs, less healing"), and a
// Tide keeps every rule below it. `rule` is what the run reads (sim/director.js tideRulesFor:
// a pack size takes the largest, the rest multiply); `rule.desc` is the line the Chapel and the
// gate show.
//   elitePack     elites come this many at a time; only the first carries a chest
//   healMul       every heal is this share
//   swarmMul      walls and rings bring this many times the enemies
//   bossTempo     a boss's wait between attacks is this share
//   musterMul     a muster's crew is this many times larger
//   eliteSpeed    elites walk this many times faster
//   reliquaryGap  the wait between Reliquaries (and the kills that make one certain) is this many times longer
//   nightMul      Lantern Night lasts this share

export const TIDES = [
  { level: 1, hpMul: 1.15, damageMul: 1.08, densityMul: 1.05, speedMul: 1.015, rewardMul: 0.12 },
  { level: 2, hpMul: 1.3, damageMul: 1.16, densityMul: 1.1, speedMul: 1.03, rewardMul: 0.24, rule: { elitePack: 2, desc: 'Elites come in pairs. Only the first carries a chest.' } },
  { level: 3, hpMul: 1.45, damageMul: 1.24, densityMul: 1.15, speedMul: 1.045, rewardMul: 0.36, rule: { healMul: 0.75, desc: 'Food and other healing give 25% less.' } },
  { level: 4, hpMul: 1.6, damageMul: 1.32, densityMul: 1.2, speedMul: 1.06, rewardMul: 0.48, rule: { swarmMul: 1.25, desc: 'Swarms that come as a wall or a ring have 25% more enemies.' } },
  { level: 5, hpMul: 1.8, damageMul: 1.4, densityMul: 1.25, speedMul: 1.075, rewardMul: 0.6, rule: { bossTempo: 0.85, desc: 'Bosses attack 15% more often.' } },
  { level: 6, hpMul: 2.0, damageMul: 1.5, densityMul: 1.3, speedMul: 1.09, rewardMul: 0.75, rule: { musterMul: 1.5, desc: 'Musters bring 50% more crew.' } },
  { level: 7, hpMul: 2.25, damageMul: 1.6, densityMul: 1.35, speedMul: 1.1, rewardMul: 0.9, rule: { eliteSpeed: 1.2, desc: 'Elites move 20% faster.' } },
  { level: 8, hpMul: 2.5, damageMul: 1.7, densityMul: 1.4, speedMul: 1.11, rewardMul: 1.05, rule: { reliquaryGap: 2, desc: 'Reliquaries come half as often.' } },
  { level: 9, hpMul: 2.8, damageMul: 1.85, densityMul: 1.45, speedMul: 1.12, rewardMul: 1.2, rule: { elitePack: 3, desc: 'Elites come in threes. Only the first carries a chest.' } },
  { level: 10, hpMul: 3.2, damageMul: 2.0, densityMul: 1.5, speedMul: 1.13, rewardMul: 1.4, rule: { nightMul: 0.5, desc: 'Lantern Night lasts half as long.' } },
];

export const CURSES = [
  { id: 'brittle', name: 'Brittle', desc: '-30% Max HP.', rewardMul: 0.15, mods: [{ stat: 'maxHp', op: 'pct', value: -0.3 }] },
  { id: 'swarm', name: 'Swarm', desc: '+30% Enemies.', rewardMul: 0.15, densityMul: 1.3 },
  { id: 'hunger', name: 'Hunger', desc: 'No food drops.', rewardMul: 0.1, noFood: true },
  { id: 'dull_edge', name: 'Dull Edge', desc: '-15% Damage.', rewardMul: 0.1, mods: [{ stat: 'might', op: 'pct', value: -0.15 }] },
  { id: 'fast_water', name: 'Fast Water', desc: '+15% Enemy Speed.', rewardMul: 0.15, speedMul: 1.15 },
];
