// Forms (ARCHITECTURE §5.16): what an Ember does to a weapon. An Ember is a rare drop in a run
// (every boss, the muster's captain, and now and then an elite). Picking one up lets you choose a
// weapon you carry, then one of its line's three Forms. Each Form changes a different part of how
// the weapon works, so a weapon can hold all three at once and they combine in any order:
//
//   delivery  when and from where it fires (a ring every 4th shot, a rod you plant, a pyre)
//   flight    how its shots travel (lobbed, hunting, carrying an enemy, rolling in from the edge)
//   payoff    what a hit or a kill leaves behind (a hanging flare, a ward, a tether, a charge)
//
// A weapon's evolution keeps its Forms (each line names the base weapon and its evolution).
// The mechanics live in sim/forms.js, keyed by `form`; the numbers are here.
//
// needs: what the weapon must be (after its runes) for every part of the Form to work: a
//        motion type it must have (`motion`), or must not have (`notMotion`). sim/weapons.js
//        runeFits and sim/ascend.js openAscensions keep a rune and a Form from cancelling each other.

export const FORM_AXES = Object.freeze(['delivery', 'flight', 'payoff']);

export const ASCENSIONS = [
  {
    line: 'flare_gun', weapons: ['flare_gun', 'flare_barrage'],
    options: [
      { id: 'salvo', axis: 'delivery', form: 'salvo', name: 'Salvo', desc: 'Every 4th shot also sets off a ring of 8 flares.',
        every: 4, count: 8, needs: { notMotion: ['orbit'] } },
      { id: 'mortar', axis: 'flight', form: 'mortar', name: 'Mortar', desc: 'Flares are lobbed onto the thickest crowd and burst where they land. +30% Cooldown.',
        range: 260, flight: 0.7, burst: { radius: 20, damageMul: 0.8 }, cooldownMul: 1.3, needs: { notMotion: ['orbit'] } },
      { id: 'hanging_flare', axis: 'payoff', form: 'hang', name: 'Hanging Flare', desc: 'Where a flare hits, it hangs for 4s and rains sparks.',
        radius: 28, duration: 4, damageMul: 0.3, interval: 0.5, every: 0.6 },
    ],
  },
  {
    line: 'lantern_orb', weapons: ['lantern_orb', 'lighthouse_lens'],
    options: [
      { id: 'eclipse', axis: 'delivery', form: 'eclipse', name: 'Eclipse', desc: 'The orbs merge into one big orb that grows with each kill and bursts when full.',
        sizePer: 0.5, damagePer: 0.7, growPerKill: 0.04, burstRadius: 60, burstMul: 3 },
      { id: 'hunting_lights', axis: 'flight', form: 'hunting', name: 'Hunting Lights', desc: 'Orbs break away to chase enemies.',
        speed: 140, turn: 6, range: 260 },
      { id: 'wards', axis: 'payoff', form: 'wards', name: 'Wards', desc: 'Where an orb kills, a small lantern stays and pulses for 5s.',
        radius: 24, duration: 5, damageMul: 0.4, interval: 0.6, every: 0.4, max: 8 },
    ],
  },
  {
    line: 'harpoon_chain', weapons: ['harpoon_chain', 'kraken_line'],
    options: [
      { id: 'lunge', axis: 'delivery', form: 'lunge', name: 'Lunge', desc: 'Each dash throws a harpoon in 4 directions.',
        count: 4, needs: { notMotion: ['orbit'] } },
      { id: 'skewer', axis: 'flight', form: 'skewer', name: 'Skewer', desc: 'The first enemy a harpoon hits is carried along as a ram, and bursts at the end.',
        burstRadius: 24, burstMul: 1.5, needs: { motion: ['linear'] } },
      { id: 'tether', axis: 'payoff', form: 'tether', name: 'Tether', desc: 'The harpoon sticks in the last enemy it hits. The chain back to you hurts whatever crosses it.',
        duration: 3, width: 6, damageMul: 0.4 },
    ],
  },
  {
    line: 'tide_bell', weapons: ['tide_bell', 'storm_bell'],
    options: [
      { id: 'great_toll', axis: 'delivery', form: 'toll', name: 'Great Toll', desc: 'One huge ring every 6s instead of waves. Each kill brings the next one sooner, by up to half the wait.',
        cooldown: 6, areaMul: 2.2, damageMul: 2.5, freeze: 0.6, cutPerKill: 0.15, maxCut: 0.5 },
      { id: 'breakers', axis: 'flight', form: 'breakers', name: 'Breakers', desc: 'Waves start at the edge of the screen and roll inward, dragging enemies with them.',
        startRadius: 220 },
      { id: 'riptide', axis: 'payoff', form: 'riptide', name: 'Riptide', desc: 'Enemies a wave hits are thrown, and hurt whatever they land among.',
        knockMul: 2.5, delay: 0.4, radius: 20, damageMul: 0.5, max: 24 },
    ],
  },
  {
    line: 'signal_mirror', weapons: ['signal_mirror'],
    options: [
      { id: 'full_circle', axis: 'delivery', form: 'sweep', name: 'Full Circle', desc: 'The beam sweeps a full circle around you.',
        duration: 1 },
      { id: 'relay', axis: 'flight', form: 'relay', name: 'Relay', desc: 'The beam jumps on to 3 more enemies, 25% stronger each jump.',
        hops: 3, range: 110, damageMul: 1.25 },
      { id: 'burning_glass', axis: 'payoff', form: 'focus', name: 'Burning Glass', desc: 'The beam sets enemies on fire. Each time it finds one again within 2.5s, the fire burns 25% hotter, up to 3x.',
        per: 0.25, max: 2, hold: 2.5, burn: 0.5, duration: 2.5 },
    ],
  },
  {
    line: 'oil_flask', weapons: ['oil_flask'],
    options: [
      { id: 'slick_trail', axis: 'delivery', form: 'trail', name: 'Slick Trail', desc: 'Leaves a trail of burning oil while moving.',
        every: 0.45, radiusMul: 0.7 },
      { id: 'firebomb', axis: 'flight', form: 'cluster', name: 'Firebomb', desc: 'Each flask bursts into 4 small ones.',
        count: 4, spread: 36, damageMul: 0.5, radiusMul: 0.6, needs: { motion: ['arc'] } },
      { id: 'fuel_line', axis: 'payoff', form: 'fuel', name: 'Fuel Line', desc: 'Pools that touch link up. A new pool sets off every pool linked to it.',
        flareMul: 2 },
    ],
  },
  {
    line: 'lightning_rod', weapons: ['lightning_rod'],
    options: [
      { id: 'planted_rod', axis: 'delivery', form: 'rod', name: 'Planted Rod', desc: 'Plants a rod on the spot. Strikes fall around it, 2 more at a time.',
        radius: 150, extra: 2, replantAt: 260, life: 15 },
      { id: 'storm_front', axis: 'flight', form: 'march', name: 'Storm Front', desc: 'Each strike marches on in a line, away from you.',
        reach: 72, speed: 300, damageMul: 0.6 },
      { id: 'static', axis: 'payoff', form: 'static', name: 'Static', desc: 'Struck enemies carry a charge for 3s and zap their neighbors.',
        duration: 3, every: 0.5, range: 60, damageMul: 0.3, max: 24 },
    ],
  },
  {
    line: 'corpse_candles', weapons: ['corpse_candles'],
    options: [
      { id: 'pyre', axis: 'delivery', form: 'pyre', name: 'Pyre', desc: 'The flames gather in a pyre, then erupt all at once.',
        hold: 8, damageMul: 1.5 },
      { id: 'wisps', axis: 'flight', form: 'wisps', name: 'Will-o\'-Wisps', desc: 'The flames lure nearby enemies toward them, away from you.',
        range: 80, strength: 0.4, every: 0.25 },
      { id: 'vigil', axis: 'payoff', form: 'vigil', name: 'Vigil', desc: 'Each kill leaves a new flame where the enemy fell.',
        life: 2, every: 0.15 },
    ],
  },
];
