// Ascensions (ARCHITECTURE §5.16): what an Ember does to a weapon. An Ember is a rare drop in a
// run (every boss, the muster's captain, and now and then an elite). Picking one up lets you
// ascend a weapon you carry with one of its line's three ascensions; with more Embers you can
// take more of them, on the same weapon or another, and they stack. A weapon's evolution keeps
// its ascensions (its line names both).
//
// Each ascension is a patch on the weapon's pipeline, applied after its level and before its
// runes:
//   add        { stat: n } added to the weapon's base (damage, cooldown, amount, area, pierce,
//              duration, speed, knockback, radius, crit): a flat change that its levels and your
//              bonuses then scale
//   onHitAdd   [{ type, ... }] an on-hit effect: if the weapon already has one of that type (a
//              status: of that status) its numbers join it (sim/weapons.js addEffect: amounts
//              add, reaches take the larger, a chain's per-hop multiplier never adds); otherwise
//              it's appended
//   emitAdd    { field: n } added to the emitter's numbers (an orbit's radius, a beam's width)
//   mirror     true: it fires backward too
// An ascension never changes the emitter's type (runes are checked against it).

export const ASCENSIONS = [
  {
    line: 'flare_gun', weapons: ['flare_gun', 'flare_barrage'],
    options: [
      { id: 'starburst', name: 'Starburst', desc: 'Flares burst on hit for 40% more damage.',
        onHitAdd: [{ type: 'explode', radius: 16, damageMul: 0.4 }] },
      { id: 'signal_pair', name: 'Signal Pair', desc: '+1 Projectile. Fires backward too.',
        add: { amount: 1 }, mirror: true },
      { id: 'white_phosphor', name: 'White Phosphor', desc: 'Hits set enemies burning. +2 Pierce.',
        add: { pierce: 2 }, onHitAdd: [{ type: 'status', status: 'burn', dps: 6, duration: 2 }] },
    ],
  },
  {
    line: 'lantern_orb', weapons: ['lantern_orb', 'lighthouse_lens'],
    options: [
      { id: 'wide_circle', name: 'Wide Circle', desc: '+2 Orbs. They circle further out.',
        add: { amount: 2 }, emitAdd: { radius: 12 } },
      { id: 'searing_glass', name: 'Searing Glass', desc: 'Orbs leave burning ground.',
        onHitAdd: [{ type: 'zone', radius: 14, duration: 2, damage: 3, interval: 0.4, every: 0.3, status: { status: 'burn', dps: 3, duration: 1.2 } }] },
      { id: 'lodestar', name: 'Lodestar', desc: 'Orbs drag enemies toward you.',
        onHitAdd: [{ type: 'pull', strength: 0.8 }] },
    ],
  },
  {
    line: 'harpoon_chain', weapons: ['harpoon_chain', 'kraken_line'],
    options: [
      { id: 'barbed_line', name: 'Barbed Line', desc: 'Hits jump to 1 more enemy.',
        onHitAdd: [{ type: 'chain', hops: 1, range: 80, damageMul: 0.5 }] },
      { id: 'whalers_haul', name: "Whaler's Haul", desc: 'Hits drag enemies toward you.',
        onHitAdd: [{ type: 'pull', strength: 1.0 }] },
      { id: 'heavy_iron', name: 'Heavy Iron', desc: '+8 Damage. +2 Pierce.',
        add: { damage: 8, pierce: 2 } },
    ],
  },
  {
    line: 'tide_bell', weapons: ['tide_bell', 'storm_bell'],
    options: [
      { id: 'double_toll', name: 'Double Toll', desc: '+1 Wave. Waves reach 25% further.',
        add: { amount: 1, area: 0.25 } },
      { id: 'cold_water', name: 'Cold Water', desc: 'Waves freeze enemies for 0.5s more.',
        onHitAdd: [{ type: 'status', status: 'freeze', duration: 0.5 }] },
      { id: 'slack_tide', name: 'Slack Tide', desc: 'Waves slow enemies by 40% for 2s.',
        onHitAdd: [{ type: 'status', status: 'slow', pct: 0.4, duration: 2 }] },
    ],
  },
  {
    line: 'signal_mirror', weapons: ['signal_mirror'],
    options: [
      { id: 'burning_glass', name: 'Burning Glass', desc: 'Beams set enemies burning.',
        onHitAdd: [{ type: 'status', status: 'burn', dps: 6, duration: 2 }] },
      { id: 'heliograph', name: 'Heliograph', desc: '+2 Beams.',
        add: { amount: 2 } },
      { id: 'long_glass', name: 'Long Glass', desc: 'Beams reach 60% further and hit a wider line.',
        add: { radius: 84 }, emitAdd: { width: 3 } },
    ],
  },
  {
    line: 'oil_flask', weapons: ['oil_flask'],
    options: [
      { id: 'greek_fire', name: 'Greek Fire', desc: 'Its burning oil hits twice as hard and lasts twice as long.',
        onHitAdd: [{ type: 'zone', damage: 4, duration: 3 }] },
      { id: 'cluster_flask', name: 'Cluster Flask', desc: '+2 Flasks.',
        add: { amount: 2 } },
      { id: 'slick', name: 'Slick', desc: 'Flasks slow what they hit by 50% for 2s.',
        onHitAdd: [{ type: 'status', status: 'slow', pct: 0.5, duration: 2 }] },
    ],
  },
  {
    line: 'lightning_rod', weapons: ['lightning_rod'],
    options: [
      { id: 'forked_bolt', name: 'Forked Bolt', desc: 'Bolts jump to 3 more enemies.',
        onHitAdd: [{ type: 'chain', hops: 3 }] },
      { id: 'thunderhead', name: 'Thunderhead', desc: '+2 Strikes.',
        add: { amount: 2 } },
      { id: 'static', name: 'Static', desc: 'Struck enemies freeze for 0.6s.',
        onHitAdd: [{ type: 'status', status: 'freeze', duration: 0.6 }] },
    ],
  },
  {
    line: 'corpse_candles', weapons: ['corpse_candles'],
    options: [
      { id: 'grave_choir', name: 'Grave Choir', desc: '+2 Flames.',
        add: { amount: 2 } },
      { id: 'black_wick', name: 'Black Wick', desc: 'Rotting enemies take 50% more damage, not 25%.',
        onHitAdd: [{ type: 'status', status: 'rot', amp: 0.25 }] },
      { id: 'wildfire', name: 'Wildfire', desc: 'Flames burst on hit for 50% damage.',
        onHitAdd: [{ type: 'explode', radius: 20, damageMul: 0.5 }] },
    ],
  },
];
