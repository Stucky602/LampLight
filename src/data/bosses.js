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
//   lure          (the Maw's own) its bite's ring shows and you're drawn toward it at `pull`
//                 px/s (slower than you walk) for the warning; then it bites inside `bite`
//   tide_lanes    (the Tidecaller's own) `lanes` rows of pools `gap` apart across where you
//                 stand, each warning `stagger` s after the last; stand between them
//   stab_line     (the Old Grey's) a line toward you shows, then the beak goes down it
//   leap          (the Old Grey's) up and untouchable while a shadow ring shows where you stood,
//                 down in it as the warning ends; landing on mud it sticks `stuck` s, taking `weak`
//                 times the damage (free of the minFight floor)
//   lightning_march (the Salt Widow's) `count` warned rings marching toward you `step` px apart,
//                 each a beat (`stagger`) after the last; on salt each raises a glass pillar; then
//                 she kneels `kneel` s, taking `weak` times the damage
//   summon_wave   with `water`: only where there's water within that many tiles (eels)

// level: the player's level its enemy's listed health is set for (0.7.3: the kiting bots' median
//   level at 10:00 and 20:00 on the new XP curve, about 50 and 81; 0.9.0: the Marsh's own, 46 and
//   72, where its bots are, so the Old Grey and the Salt Widow no longer sit at the low clamp). A boss arriving to a stronger
//   or weaker player gets more or less (tuning.bosses.hpPerLevel, held to hpLevelMin..hpLevelMax).
// minFight: a safety floor (0.9.0: 15 s for every boss; it was the fight's length): the boss can
//   lose at most its health times the seconds since it arrived over minFight, outside a weak window.
//   A hit past that is cut down (the HIT event's HIT_CAPPED bit).
// signature (each phase, 0.9.0, ruling 5): the attack that opens that phase's gate. The boss can't
//   lose health past the notch below its phase (the next phase's `from`; the last phase's: its
//   death) until it has thrown it once (HIT_GATED). So a strong build still meets every phase, and
//   the fight's length is the build's.
// name (each attack, 0.9.0): what it's called in a sentence ("the Tidecaller's tide line"; the
//   death recap).

export const BOSSES = [
  {
    id: 'harbor_maw', level: 48, minFight: 15,
    phases: [
      { from: 1.0, every: 2.8, signature: 'lure', attacks: ['slam', 'lure', 'summon', 'charge'] },
      { from: 0.5, every: 2.0, signature: 'charge', attacks: ['lure', 'charge', 'slam', 'charge', 'summon'] },
    ],
    attacks: {
      lure: { type: 'lure', name: 'lure', bite: 46, pull: 38, warn: 1.6, damage: 26 },
      slam: { type: 'slam_ring', name: 'slam', radius: 72, warn: 1.0, damage: 18 },
      summon: { type: 'summon_wave', name: 'call', enemy: 'fog_wisp', count: 12, radius: 70, warn: 0.8 },
      charge: { type: 'charge_line', name: 'charge', length: 240, width: 20, warn: 1.0, speed: 320, damage: 20 },
    },
  },
  {
    id: 'the_tidecaller', level: 80, minFight: 15,
    phases: [
      { from: 1.0, every: 2.6, signature: 'tide', attacks: ['fan', 'tide', 'slam', 'pools'] },
      { from: 0.6, every: 2.0, signature: 'summon', attacks: ['tide', 'fan', 'summon', 'fan'] },
      { from: 0.3, every: 1.6, signature: 'charge', attacks: ['slam', 'tide', 'fan', 'pools', 'charge'] },
    ],
    attacks: {
      tide: { type: 'tide_lanes', name: 'tide line', lanes: 3, gap: 76, length: 360, spacing: 32, radius: 18, warn: 1.2, stagger: 0.3, last: 2.5, damage: 10 },
      fan: { type: 'projectile_fan', name: 'shot fan', count: 7, spread: 70, speed: 80, damage: 10, warn: 0.9, radius: 5, life: 5 },
      pools: { type: 'hazard_pools', name: 'pools', count: 4, radius: 26, scatter: 90, warn: 1.1, last: 4, damage: 8 },
      slam: { type: 'slam_ring', name: 'slam', radius: 88, warn: 1.1, damage: 24 },
      summon: { type: 'summon_wave', name: 'call', enemy: 'bilge_rat', count: 16, radius: 80, warn: 0.8 },
      charge: { type: 'charge_line', name: 'charge', length: 260, width: 24, warn: 1.0, speed: 340, damage: 26 },
    },
  },

  // The Salt Marsh (0.8.0). The Old Grey at 10:00: stab, leap (make it miss into the mud), and its
  // calls (toads, and eels where there's water). The Salt Widow at 20:00: the lightning march and
  // her kneel; under half health, slow fans of salt shards.
  {
    id: 'old_grey', level: 46, minFight: 15,
    phases: [
      { from: 1.0, every: 2.6, signature: 'leap', attacks: ['stab', 'leap', 'toads', 'stab', 'eels'] },
      { from: 0.5, every: 2.0, signature: 'leap', attacks: ['leap', 'stab', 'toads', 'leap', 'stab', 'eels'] },
    ],
    attacks: {
      stab: { type: 'stab_line', name: 'stab', length: 150, width: 18, warn: 0.9, damage: 20 },
      leap: { type: 'leap', name: 'leap', radius: 40, warn: 1.2, damage: 24, stuck: 3, weak: 2 },
      toads: { type: 'summon_wave', name: 'call', enemy: 'mire_toad', count: 6, radius: 70, warn: 0.8 },
      eels: { type: 'summon_wave', name: 'call', enemy: 'creek_eel', count: 4, radius: 90, warn: 0.8, water: 3 },
    },
  },
  {
    id: 'salt_widow', level: 72, minFight: 15,
    phases: [
      { from: 1.0, every: 2.6, signature: 'march', attacks: ['march', 'slam', 'summon', 'march'] },
      { from: 0.5, every: 2.0, signature: 'fan', attacks: ['march', 'fan', 'march', 'fan', 'summon'] },
    ],
    attacks: {
      march: { type: 'lightning_march', name: 'lightning march', count: 5, step: 44, radius: 26, warn: 1.0, stagger: 0.25, damage: 16, enemyDamage: 60, kneel: 2, weak: 2 },
      fan: { type: 'projectile_fan', name: 'salt shards', count: 7, spread: 60, speed: 70, damage: 10, warn: 0.8, radius: 5, life: 6 },
      slam: { type: 'slam_ring', name: 'slam', radius: 80, warn: 1.1, damage: 22 },
      summon: { type: 'summon_wave', name: 'call', enemy: 'salted_dead', count: 12, radius: 80, warn: 0.8 },
    },
  },
];
