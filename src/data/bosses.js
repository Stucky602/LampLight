// Boss attack patterns (ARCHITECTURE §5.13). A boss enemy names one of these with `boss: id`.
//
// Phases: the boss uses the last phase whose `from` (a fraction of max HP) it is at or below.
// It cycles through that phase's attack list in order, starting the next attack `every`
// seconds after the last one finished. Every attack warns for at least tuning.enemies.telegraphMin
// (0.8 s) with a clear shape, so the game stays playable while half-watching TV.
//
// Attack types (the pattern library):
//   slam_ring     a ring around the boss fills in, then everything inside takes damage
//   charge_line   a line toward you lights up, then the boss runs along it
//   summon_wave   a circle of minions appears around the boss after a warning
//   projectile_fan  slow, readable shots in a fan toward you
//   hazard_pools  circles near you fill in, then stay harmful for a while

export const BOSSES = [
  {
    id: 'harbor_maw',
    phases: [
      { from: 1.0, every: 2.8, attacks: ['slam', 'summon', 'charge'] },
      { from: 0.5, every: 2.0, attacks: ['charge', 'slam', 'charge', 'summon'] },
    ],
    attacks: {
      slam: { type: 'slam_ring', radius: 72, warn: 1.0, damage: 18 },
      summon: { type: 'summon_wave', enemy: 'fog_wisp', count: 12, radius: 70, warn: 0.8 },
      charge: { type: 'charge_line', length: 240, width: 20, warn: 1.0, speed: 320, damage: 20 },
    },
  },
  {
    id: 'the_tidecaller',
    phases: [
      { from: 1.0, every: 2.6, attacks: ['fan', 'pools', 'slam'] },
      { from: 0.6, every: 2.0, attacks: ['pools', 'fan', 'summon', 'fan'] },
      { from: 0.3, every: 1.6, attacks: ['slam', 'fan', 'pools', 'charge'] },
    ],
    attacks: {
      fan: { type: 'projectile_fan', count: 7, spread: 70, speed: 80, damage: 10, warn: 0.9, radius: 5, life: 5 },
      pools: { type: 'hazard_pools', count: 4, radius: 26, scatter: 90, warn: 1.1, last: 4, damage: 8 },
      slam: { type: 'slam_ring', radius: 88, warn: 1.1, damage: 24 },
      summon: { type: 'summon_wave', enemy: 'bilge_rat', count: 16, radius: 80, warn: 0.8 },
      charge: { type: 'charge_line', length: 260, width: 24, warn: 1.0, speed: 340, damage: 26 },
    },
  },
];
