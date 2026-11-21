// Forms (ARCHITECTURE §5.16; ruling 14, C1: work/cw/C1-CONTRACT.md section 4): the three choices a
// weapon makes. Each weapon has three axes and two options on each, and holds ONE option per axis:
//
//   delivery  how it fires          opens at the weapon's 5th upgrade
//   flight    how its shots travel  opens at its 10th upgrade
//   payoff    what a hit leaves     the capstone: opens when the weapon's deed is done (its data's `deed`)
//
// An Ember opens the next axis early or switches an option already taken (sim/ascend.js).
// An option: { id, axis, name, desc, price, boost, capstone?, control?, look? }.
//   control  its worth is what it stops (a daze, a freeze, a slow, a drag): ruling 18 WC caps its
//           damage rider at one +40%, and the balance test reads it on the tank ruler (damage taken).
//   price   what it costs, as the card prints it after "Price:". Where it is a number, boost.stats carries it.
//   boost   { stats, onHit, emit, motion, fx } (sim/forms.js; the same shape as a weapon's lines and specials).
//           Only a delivery option replaces an emitter's type and only a flight option a motion's type.
//   look    (a capstone) the sprite its shots and the icon it shows from then on.
//   excludes  options this one can't be held with (either way round; ruling 21 WA: Breakers and Great
//             Toll). The choice doesn't offer an option the weapon's held options exclude.
// A line's capstoneUnlock: a research key that keeps its capstone axis shut until the profile has it
// (RunConfig.forms lists the first capstone option's id when it is open).
// The first payoff option of each line keeps the id of the old capstone, so saves, research, and
// codex keys still name it; RETIRED_FORMS maps the options that were cut to what took their place.

export const FORM_AXES = Object.freeze(['delivery', 'flight', 'payoff']);

/** The evolved weapons 0.9.0 retired: each is its base weapon with its capstone (saves and replays that name one). */
export const RETIRED_WEAPONS = Object.freeze({
  flare_barrage: { weapon: 'flare_gun', form: 'hanging_flare' },
  lighthouse_lens: { weapon: 'lantern_orb', form: 'wards' },
  kraken_line: { weapon: 'harpoon_chain', form: 'tether' },
  storm_bell: { weapon: 'tide_bell', form: 'riptide' },
  salt_pan: { weapon: 'brine_spring', form: 'salt_crust' },
  stormglass: { weapon: 'lightning_rod', form: 'static' },   // (the Fulgurite folded into the Rod, ruling 18 WD)
  fulgurite: { weapon: 'lightning_rod', form: 'static' },
  conger_pot: { weapon: 'eel_pot', form: 'conger' },
  sea_anchor: { weapon: 'anchor_chain', form: 'deep_anchor' },
});

/**
 * How a weapon looks with the Forms it holds (0.9.0): its capstone's look once taken, else its own.
 * For the view and the screens (the sim never reads a look): { sprite, icon }.
 */
export function weaponLook(def, ascensions = []) {
  for (const a of ascensions) if (a.capstone && a.look) return { sprite: a.look.sprite ?? def.sprite, icon: a.look.icon ?? def.icon };
  return { sprite: def.sprite, icon: def.icon };
}

export const ASCENSIONS = [
  {
    line: 'flare_gun', weapons: ['flare_gun'],
    options: [
      { id: 'salvo', axis: 'delivery', name: 'Salvo', desc: 'Every 6th flare also sets off a ring of 6.', price: '+10% Cooldown',
        boost: { fx: { salvo: { every: 6, count: 6 } }, stats: { cooldownMul: 1.1 } } },
      { id: 'muzzle_flash', axis: 'delivery', name: 'Muzzle Flash', desc: 'Each shot also scorches enemies close in front of you.', price: '-25% Range',
        boost: { fx: { muzzle: { radius: 34, damageMul: 0.5 } }, emit: { range: 270 } } },   // (ruling 19 RA: at 0.9 the B set ran over x4 the next weapon in 3 full runs)
      { id: 'mortar', axis: 'flight', name: 'Mortar', desc: 'Flares are lobbed onto the thickest crowd and burst where they land.', price: '+25% Cooldown',
        boost: { fx: { mortar: { range: 260, flight: 0.7, burst: { radius: 20, damageMul: 0.5 } } }, stats: { cooldownMul: 1.25 } } },
      { id: 'star_shell', axis: 'flight', name: 'Star Shell', desc: 'Flares pass through 3 enemies, 60% bigger, and last 60% longer.', price: '-45% Projectile Speed',
        boost: { stats: { set: { pierce: 3 }, radiusMul: 1.6, durationMul: 1.6, speedMul: 0.55 } } },   // (ruling 19 RA: the B set over x4 the next weapon in full runs at 5 and 2x)
      { id: 'hanging_flare', axis: 'payoff', name: 'Hanging Flare', desc: 'Flares explode on hit. Where one hits, a flare hangs for 2s and rains sparks.', price: '+10% Cooldown',
        capstone: true,
        boost: { fx: { hang: { radius: 28, duration: 2, damageMul: 0.15, interval: 0.5, every: 2 } }, onHit: [{ type: 'explode', radius: 22, damageMul: 0.6 }], stats: { cooldownMul: 1.1 } },
        look: { sprite: 'proj_flare_big', icon: 'icon_flare_barrage' } },
      { id: 'phosphor', axis: 'payoff', name: 'Phosphor', desc: 'Hits set enemies burning for 5s. An enemy that dies burning sets the enemies next to it burning.', price: '-20% Damage (not on the burn)',
        capstone: true,
        boost: { onHit: [{ type: 'status', status: 'burn', dpsMul: 0.45, duration: 5 }], fx: { killburst: { radius: 24, damageMul: 0, ifStatus: 'burn', spread: 'burn', spreadSec: 2.5 } }, stats: { damageMul: 0.8 } },
        look: { sprite: 'proj_flare_big', icon: 'icon_flare_barrage' } },
    ],
  },
  {
    line: 'lantern_orb', weapons: ['lantern_orb'], capstoneUnlock: 'research:orbwright',
    options: [
      { id: 'eclipse', axis: 'delivery', name: 'Eclipse', desc: 'The orbs merge into one big orb. It grows for 4s, bursts, then starts small again.', price: 'Always 1 orb: extra Projectiles make it bigger',
        boost: { fx: { eclipse: { sizePer: 0.25, damagePer: 0.9, growSec: 4, burstRadius: 60, burstMul: 0.6 } } } },
      { id: 'bow_lantern', axis: 'delivery', name: 'Bow Lantern', desc: 'The ring circles a point ahead of the way you face. +20% Damage.', price: 'No orbs behind you',
        boost: { fx: { origin: { mode: 'ahead', dist: 34 } }, stats: { damageMul: 1.2 } } },
      { id: 'hunting_lights', axis: 'flight', name: 'Hunting Lights', desc: 'Orbs break away to chase enemies.', price: '-55% Damage, and orbs no longer circle you',
        boost: { fx: { hunting: { speed: 120, turn: 6, range: 200 } }, stats: { damageMul: 0.45 } } },
      { id: 'swell', axis: 'flight', name: 'Breathing Ring', desc: 'Every 3s the ring swells out 60% farther, then back. +40% Damage.', price: 'At full Range only half the time',
        boost: { fx: { breathe: { mul: 1.6, period: 3 } }, stats: { damageMul: 1.4 } } },   // (ruling 18 WB: at 2.2 with a wide ring it swept up an Orb at 7M a minute)
      { id: 'wards', axis: 'payoff', name: 'Little Lanterns', desc: 'Every 1.5s, an orb leaves a small lantern where it is, pulsing for 3s. At most 5.', price: '-50% Knockback',
        capstone: true,
        boost: { fx: { wards: { radius: 24, duration: 3, damageMul: 0.13, interval: 0.6, every: 1.5, max: 5 } }, stats: { knockbackMul: 0.5 } },
        look: { sprite: 'proj_lens', icon: 'icon_lighthouse_lens' } },
      { id: 'sunfire', axis: 'payoff', name: 'Sunfire', desc: 'Orbs set enemies burning. An enemy that dies burning sets the enemies next to it burning.', price: '-15% Area',
        capstone: true,
        boost: { onHit: [{ type: 'status', status: 'burn', dpsMul: 0.9, duration: 3 }], fx: { killburst: { radius: 24, damageMul: 0, ifStatus: 'burn', spread: 'burn', spreadSec: 2.5 } }, stats: { areaMul: 0.85 } },
        look: { sprite: 'proj_lens', icon: 'icon_lighthouse_lens' } },
    ],
  },
  {
    line: 'harpoon_chain', weapons: ['harpoon_chain'], capstoneUnlock: 'research:ships_ballast',
    options: [
      { id: 'lunge', axis: 'delivery', name: 'Lunge', desc: 'Every 3s while you keep moving, it also throws 2 harpoons, one ahead of you and one behind.', price: '+15% Cooldown',
        boost: { fx: { lunge: { count: 2, every: 3, after: 0.5 } }, stats: { cooldownMul: 1.15 } } },   // (ruling 23 WA: every 2s, the Marsh's careful runs ended on it; without Lunge, the Bog Warden's didn't)
      { id: 'swivel_mount', axis: 'delivery', name: 'Swivel Mount', desc: 'Throws at the nearest enemy, wherever you face.', price: '-25% Damage',
        boost: { emit: { type: 'nearest', range: 300 }, stats: { damageMul: 0.75 } } },
      { id: 'skewer', axis: 'flight', excludes: ['tether'], name: 'Skewer', desc: 'The first enemy a harpoon hits is carried along as a ram, and bursts at the end. Can\'t be taken with Tether.', price: '-2 Pierce',   // (ruling 23 WA: Lunge, Skewer, and Tether together ended 6 of 6 Marsh runs that held it)
        boost: { fx: { skewer: { burstRadius: 24, burstMul: 1.0 } }, stats: { pierce: -2 } } },
      { id: 'barbed_heads', axis: 'flight', name: 'Barbed Heads', desc: 'Harpoons stun enemies they hit for 0.6s and pass through 3 more enemies.', price: '-20% Projectile Speed',
        boost: { onHit: [{ type: 'daze', duration: 0.6 }], stats: { pierce: 3, speedMul: 0.8 } } },
      { id: 'tether', axis: 'payoff', unlock: 'research:reversed_runes', name: 'Tether',   // (ruling 25 WA: held back to a later research, so the Marsh's first runs meet the chain without it)
        desc: 'Harpoons pull enemies and chain to 1 more. One that pulls nothing sticks in the last enemy, and its chain damages enemies that cross it. Can\'t be taken with Skewer.', price: '-65% Knockback',
        capstone: true,
        boost: { fx: { tether: { duration: 1.5, width: 6, damageMul: 0.1 } }, onHit: [{ type: 'pull', strength: 1.4 }, { type: 'chain', hops: 1, range: 90, damageMul: 0.6 }], stats: { knockbackMul: 0.35 } },
        look: { sprite: 'proj_harpoon_big', icon: 'icon_kraken_line' } },
      { id: 'dead_weight', axis: 'payoff', name: 'Dead Weight', desc: 'An enemy a harpoon kills falls as a dead weight: enemies close to it are stunned for 1.5s. +3 Pierce.', price: '-20% Knockback',
        capstone: true,
        boost: { fx: { killburst: { radius: 40, damageMul: 0, spread: 'daze', spreadSec: 1.5 } }, stats: { knockbackMul: 0.8, pierce: 3 } },
        look: { sprite: 'proj_harpoon_big', icon: 'icon_kraken_line' } },
    ],
  },
  {
    line: 'tide_bell', weapons: ['tide_bell'], capstoneUnlock: 'research:tide_charts',
    options: [
      { id: 'great_toll', axis: 'delivery', name: 'Great Toll', desc: 'One huge wave every 5s. It freezes enemies for 1s, and the more it hits, the sooner the next comes, up to 25% sooner. +35% Damage.', price: 'Always 1 wave: extra Waves do nothing',
        boost: { fx: { toll: { cooldown: 5, minCooldown: 2.5, areaMul: 1.5, damageMul: 1.35, freeze: 1, cutPerEnemy: 0.02, maxCut: 0.25 } } } },
      { id: 'bell_buoy', axis: 'delivery', name: 'Bell Buoy', desc: 'Stand still for 1s to moor the bell. Its waves come 65% faster from where it floats.', price: 'Waves start at the buoy, not at you',
        boost: { fx: { origin: { mode: 'plant', after: 1, life: 14 } }, stats: { cooldownMul: 0.6 } } },
      { id: 'breakers', axis: 'flight', excludes: ['great_toll'], name: 'Breakers', desc: 'Waves start at the edge of the screen and roll inward, pulling enemies with them. Can\'t be taken with Great Toll.', price: 'No Knockback',
        boost: { fx: { breakers: { startRadius: 220, damageMul: 1.1 } } } },
      { id: 'slack_water', axis: 'flight', name: 'Standing Wave', desc: 'A wave stops at its farthest point and stands for 2s, damaging enemies that cross it.', price: '-20% Damage',
        boost: { fx: { stand: { sec: 2, every: 0.5 } }, stats: { damageMul: 0.8 } } },
      { id: 'riptide', axis: 'payoff', name: 'Riptide', desc: 'Waves freeze enemies they hit and knock them back into the enemies they land on, damaging those too.', price: '+10% Cooldown',
        capstone: true,
        boost: { fx: { riptide: { knockMul: 2.5, delay: 0.4, radius: 20, damageMul: 0.5, max: 24 } }, onHit: [{ type: 'status', status: 'freeze', duration: 0.6 }], stats: { cooldownMul: 1.1 } },
        look: { sprite: 'fx_wave_big', icon: 'icon_storm_bell' } },
      { id: 'death_knell', axis: 'payoff', name: 'Death Knell', desc: 'Waves deal 40% more damage and finish ordinary enemies under 40% HP.', price: '-25% Knockback',
        capstone: true,
        boost: { fx: { knell: { below: 0.4 } }, stats: { knockbackMul: 0.75, damageMul: 1.4 } },
        look: { sprite: 'fx_wave_big', icon: 'icon_storm_bell' } },
    ],
  },
  {
    line: 'signal_mirror', weapons: ['signal_mirror'],
    options: [
      { id: 'full_circle', axis: 'delivery', name: 'Full Circle', desc: 'The beam sweeps a full circle around you.', price: '-60% Damage a hit',
        boost: { fx: { sweep: { duration: 1, damageMul: 0.4 } } } },
      { id: 'heliograph', axis: 'delivery', name: 'Heliograph', desc: 'The beam flashes the way you face, 60% longer. +40% Damage.', price: 'No longer aims at enemies',
        boost: { emit: { aim: 'facing' }, stats: { areaMul: 1.6, damageMul: 1.4 } } },
      { id: 'relay', axis: 'flight', name: 'Relay', desc: 'The beam chains to 2 more enemies, with -40% Damage each time. On a full circle it chains once.', price: '-15% Area',
        boost: { fx: { relay: { hops: 2, sweepHops: 1, range: 110, damageMul: 0.6 } }, stats: { areaMul: 0.85 } } },
      { id: 'prism', axis: 'flight', name: 'Prism', desc: 'At the first enemy it hits, the beam splits in two.', price: '-20% Damage',
        boost: { fx: { fork: { angle: 28, lengthMul: 0.7, damageMul: 0.8 } }, stats: { damageMul: 0.8 } } },
      { id: 'burning_glass', axis: 'payoff', name: 'Burning Glass', desc: 'The beam sets enemies burning. A hit within 2.5s gives the fire +25% Damage, up to 3 times (2 on a full circle).', price: '+10% Cooldown',
        capstone: true,
        boost: { fx: { focus: { per: 0.25, max: 2, hold: 2.5, burn: 0.5, duration: 2.5 } }, stats: { cooldownMul: 1.1 } } },
      { id: 'dazzle', axis: 'payoff', name: 'Dazzle', desc: 'Struck enemies are stunned for 2s. +30% Damage.', price: '-15% Area',
        capstone: true, control: true,
        boost: { onHit: [{ type: 'daze', duration: 2 }], stats: { areaMul: 0.85, damageMul: 1.3 } } },
    ],
  },
  {
    line: 'oil_flask', weapons: ['oil_flask'], capstoneUnlock: 'research:oil_stores',
    options: [
      { id: 'slick_trail', axis: 'delivery', name: 'Slick Trail', desc: 'Leaves a trail of burning oil while you move.', price: '+20% Cooldown',
        boost: { fx: { trail: { every: 0.9, radiusMul: 0.7 } }, stats: { cooldownMul: 1.2 } } },   // (ruling 21 WB: with Fuel Line, x13.7 the next weapon at Tide 5; C1b: at 0.6, still x5.3, now a pool every 0.9s)
      { id: 'stern_cask', axis: 'delivery', name: 'Stern Cask', desc: 'Flasks are thrown behind you, 3 more each throw. +20% Damage.', price: 'Never thrown ahead',
        boost: { emit: { aim: 'rear' }, motion: { range: 110 }, stats: { amount: 3, damageMul: 1.2 } } },
      { id: 'firebomb', axis: 'flight', name: 'Firebomb', desc: 'Each flask bursts into 4 small ones.', price: '-30% Duration',
        boost: { fx: { cluster: { count: 4, spread: 36, damageMul: 0.5, radiusMul: 0.6 } }, stats: { durationMul: 0.7 } } },
      { id: 'skipping_flask', axis: 'flight', name: 'Skipping Flask', desc: 'A flask bounces on twice and leaves a pool at each landing.', price: '-25% Area',
        boost: { fx: { skip: { count: 2, dist: 46, flight: 0.3 } }, stats: { areaMul: 0.75 } } },
      { id: 'fuel_line', axis: 'payoff', name: 'Linked Pools', desc: 'Pools are 30% wider and deal 30% more damage. Pools that touch link up, and a new pool sets off 1 pool linked to it.', price: '+5% Cooldown',
        capstone: true,
        boost: { fx: { fuel: { flareMul: 2, max: 1 } },   // (C1b, Nov 20: at 2, the Drowned Man's Oil Flask held 82% of his damage at Tide 5; with no link, 40%; at 1, 58%)
         stats: { cooldownMul: 1.05, areaMul: 1.3, damageMul: 1.3 } } },
      { id: 'pitch', axis: 'payoff', name: 'Pitch', desc: 'Its pools are 50% wider, and burning enemies take 40% more damage from every weapon.', price: '+10% Cooldown',
        capstone: true,
        boost: { fx: { pitch: { mul: 1.4 } }, stats: { areaMul: 1.5, cooldownMul: 1.1 } } },
    ],
  },
  {
    line: 'lightning_rod', weapons: ['lightning_rod'],
    options: [
      { id: 'storm_kite', axis: 'delivery', name: 'Storm Kite', desc: 'No rod: lightning strikes enemies anywhere on screen. +1 Bolt.', price: 'Strikes land at random',
        boost: { emit: { rod: null }, stats: { amount: 1 } } },
      { id: 'ground_rod', axis: 'delivery', name: 'Ground Rod', desc: 'Standing still for 1s plants the rod there. It strikes 45% faster.', price: 'It no longer follows you on its own',
        boost: { emit: { rodStill: 1 }, stats: { cooldownMul: 0.69 } } },
      { id: 'storm_front', axis: 'flight', name: 'Storm Front', desc: 'Each strike marches on in a line, away from you.', price: '-15% Damage',
        boost: { fx: { march: { reach: 72, speed: 300, damageMul: 0.6 } }, stats: { damageMul: 0.85 } } },
      { id: 'live_ground', axis: 'flight', name: 'Live Ground', desc: 'Each strike leaves the ground live for 1.5s.', price: '-10% Damage',
        boost: { onHit: [{ type: 'zone', radius: 16, duration: 1.5, damageMul: 0.7, interval: 0.3, every: 0.2 }], stats: { damageMul: 0.9 } } },
      { id: 'static', axis: 'payoff', name: 'Static', desc: 'Struck enemies carry a charge for 3s and zap their neighbors.', price: '+10% Cooldown',
        capstone: true,
        boost: { fx: { static: { duration: 3, every: 0.5, range: 60, damageMul: 0.3, max: 24 } }, stats: { cooldownMul: 1.1 } } },
      { id: 'thunderclap', axis: 'payoff', name: 'Thunderclap', desc: 'Each strike bursts and stuns enemies for 0.5s.', price: '-1 Chain',
        capstone: true,
        boost: { onHit: [{ type: 'explode', radius: 30, damageMul: 0.5 }, { type: 'daze', duration: 0.5 }, { type: 'chain', hops: -1, range: 80, damageMul: 0.6 }] } },
    ],
  },
  {
    line: 'corpse_candles', weapons: ['corpse_candles'],
    options: [
      { id: 'pyre', axis: 'delivery', name: 'Pyre', desc: 'The flames gather in a pyre beside you. Once 4 are in, they all fly out at once. +60% Damage.', price: 'Nothing fires until 4 flames are ready',
        boost: { fx: { pyre: { hold: 4, damageMul: 1.6 } } } },   // (ruling 24: at 6 and +80%, the Tide Priest's plain runs had the Candles over 3x the next in 3 of 12; with no bonus, none)   // (ruling 21 WB: Candles at Tide 5 x16.5 the next weapon)
      { id: 'grave_lights', axis: 'delivery', name: 'Grave Lights', desc: 'Flames rise where enemies last died. +25% Damage.', price: '-1 Flame. With no kills nearby, flames rise beside you',
        boost: { fx: { corpse: { within: 300, age: 6 } }, stats: { damageMul: 1.25 } } },
      { id: 'wisps', axis: 'flight', name: 'Will-o\'-Wisps', desc: 'The flames lure nearby enemies toward them, away from you.', price: '-15% Damage',
        boost: { fx: { wisps: { range: 80, strength: 0.4, every: 0.25 } }, stats: { damageMul: 0.85 } } },
      { id: 'procession', axis: 'flight', name: 'Procession', desc: 'The flames follow behind you in a line along the path you walked, and are bigger. +80% Damage.', price: 'Flames no longer chase enemies',
        boost: { motion: { type: 'follow', gap: 4 }, stats: { damageMul: 1.8, radiusMul: 1.8 } } },
      { id: 'vigil', axis: 'payoff', name: 'Vigil', desc: 'Every 1s, a new flame rises where an enemy last fell, or beside you. These flames don\'t pull enemies, and Grave Mist doesn\'t work on them.', price: '+10% Cooldown',
        capstone: true,
        boost: { fx: { vigil: { life: 1, every: 1, plain: true } },   // (C1b, Nov 20, plain: with Wisps and Grave Mist, a flame a second that pulled and left mist took the Candles to 7x the next weapon at Tide 5)   // (ruling 19 RA: at 0.5 with Pyre and Wisps, x18 the next weapon in full runs)
         stats: { cooldownMul: 1.1 } } },
      { id: 'consumption', axis: 'payoff', name: 'Consumption', desc: 'Rotting enemies take 60% more damage instead of 25%, and an enemy that dies rotting rots the enemies next to it. +2 Flames.', price: '-15% Duration',
        capstone: true,
        boost: { onHit: [{ type: 'status', status: 'rot', duration: 0, amp: 0.6 }], fx: { killburst: { radius: 26, damageMul: 0, ifStatus: 'rot', spread: 'rot', spreadSec: 3 } }, stats: { durationMul: 0.85, amount: 2 } } },
    ],
  },

  // ---------------------------------------------------------------- the Salt Marsh's
  {
    line: 'brine_spring', weapons: ['brine_spring'],
    options: [
      { id: 'tide_pools', axis: 'delivery', name: 'Salt Pools', desc: 'Puddles that touch join into one pool, as big as both together and lasting as long as both. +50% Damage, +1 Spout.', price: 'Fewer puddles, each one bigger',
        boost: { fx: { tidepool: { maxRadius: 90, maxLife: 3 } }, stats: { damageMul: 1.5, amount: 1 } } },
      { id: 'artesian', axis: 'delivery', name: 'Artesian', desc: 'The spring bursts right under you, 60% bigger. +40% Damage.', price: 'No longer aims at the crowd',
        boost: { emit: { aim: 'self' }, stats: { areaMul: 1.6, damageMul: 1.4 } } },
      { id: 'creeping_brine', axis: 'flight', name: 'Creeping Brine', desc: 'Puddles creep toward the nearest enemy. +60% Damage.', price: '-10% Duration',
        boost: { fx: { drift: { speed: 60, range: 240 } }, stats: { durationMul: 0.9, damageMul: 1.6 } } },
      { id: 'seep', axis: 'flight', name: 'Seep', desc: 'A puddle bursts again where it lies every 1.5s.', price: '-25% Damage on the first burst',
        boost: { fx: { seep: { every: 1.5, damageMul: 0.7 } }, stats: { damageMul: 0.75 } } },
      { id: 'salt_crust', axis: 'payoff', name: 'Salt Crust', desc: 'Spouts deal 60% more damage, frozen enemies they kill shatter into 6 ice shards, and puddles last 5s longer.', price: '+10% Cooldown',
        capstone: true,
        boost: { emit: { shatter: { count: 6, damage: 35, slow: 0.4 } }, stats: { durationAdd: 5, cooldownMul: 1.1, damageMul: 1.6 } },
        look: { sprite: 'fx_wave_big', icon: 'icon_salt_pan' } },
      { id: 'brinicle', axis: 'payoff', name: 'Brinicle', desc: '+30% Damage, and a frozen enemy that dies freezes the enemies next to it for 1.5s.', price: '-15% Area',
        capstone: true, control: true,
        boost: { fx: { killburst: { radius: 34, damageMul: 0, ifStatus: 'freeze', spread: 'freeze', spreadSec: 1.5, any: true } }, stats: { areaMul: 0.85, damageMul: 1.3 } },
        look: { sprite: 'fx_wave_big', icon: 'icon_salt_pan' } },
    ],
  },
  {
    line: 'ice_picks', weapons: ['ice_picks'],
    options: [
      { id: 'tongs', axis: 'delivery', name: 'Tongs', desc: 'Picks fly in pairs, wide to each side of the target, and sweep back to you. +1 Pick, +75% Damage.', price: 'Misses the enemy straight ahead',
        boost: { fx: { pincer: { angle: 32 } }, stats: { amount: 1, damageMul: 1.75 } } },
      { id: 'ice_axe', axis: 'delivery', name: 'Ice Axe', desc: 'All its picks become one heavy axe, twice the size. Each extra Pick makes it bigger and adds damage.', price: 'Always 1 axe: extra Picks make it bigger',
        boost: { fx: { merge: { size: 2, sizePer: 0.4, damageBase: 1.5, damagePer: 0.8 } } } },
      { id: 'ice_wall', axis: 'flight', control: true, name: 'Ice Wall', desc: 'A pick stays in the first enemy it hits for 10x damage. It freezes that enemy for 2s, and its ice bursts, slowing enemies near it and dealing them the pick\'s damage. +1 Pick.', price: 'It doesn\'t come back',
        boost: { fx: { stick: { freeze: 2, radius: 30, slow: 0.6, slowSec: 2, damageMul: 10, burstMul: 1 } }, stats: { amount: 1 } } },   // (ruling 23 WC: burstMul, set A fell after 15:00: a pick that kills one enemy can't keep up with a crowd)
      { id: 'long_throw', axis: 'flight', name: 'Long Throw', desc: 'Picks fly 60% farther, with +100% Damage on the way back.', price: '-20% Projectile Speed',
        boost: { fx: { returnMul: { mul: 2 } }, stats: { durationMul: 1.6, speedMul: 0.8 } } },
      { id: 'rime', axis: 'payoff', name: 'Rime', desc: 'On its way back a pick freezes enemies it hits for 1.2s, and it deals 40% more damage to frozen enemies. +1 Pick.', price: '+10% Cooldown',
        capstone: true, control: true,
        boost: { fx: { returnFreeze: { status: 'freeze', duration: 1.2 }, bonus: { status: 'freeze', mul: 1.4 } }, stats: { amount: 1, cooldownMul: 1.1 } } },
      { id: 'shatter', axis: 'payoff', name: 'Shatter', desc: 'It deals 70% more damage to slowed enemies, and an enemy it kills slows the enemies near it. +1 Pick.', price: '+10% Cooldown',
        capstone: true,
        boost: { fx: { bonus: { status: 'slow', mul: 1.7 }, killburst: { radius: 24, damageMul: 0, spread: 'slow', spreadSec: 2 } }, stats: { cooldownMul: 1.1, amount: 1 } } },
    ],
  },
  {
    // The Fog Horn (ruling 18 WD, in the Fulgurite's place): a note in a cone that leaves what it
    // passes lost in the fog (it walks away from you).
    line: 'fog_horn', weapons: ['fog_horn'],
    options: [
      { id: 'bow_horn', axis: 'delivery', name: 'Bow Horn', desc: 'The note goes back the way you came, 30% wider. +40% Damage.', price: 'No longer aims at enemies',
        boost: { emit: { aim: 'rear', cone: 52 }, stats: { damageMul: 1.4 } } },   // (ruling 21 WE: the way you face, it sounded away from the crowd a moving player leaves behind)
      { id: 'twin_horns', axis: 'delivery', name: 'Twin Horns', desc: 'Two notes at once, fanned out to either side of the enemy.', price: '-20% Damage each',
        boost: { emit: { fan: 70 }, stats: { amount: 1, damageMul: 0.8 } } },
      { id: 'long_note', axis: 'flight', name: 'Long Note', desc: 'Notes carry 60% farther, rolling out slower.', price: '-20% Damage',
        boost: { stats: { areaMul: 1.6, durationMul: 1.5, damageMul: 0.8 } } },
      { id: 'held_note', axis: 'flight', name: 'Hanging Fog', desc: 'Where a note hits, fog hangs for 3s. Enemies that walk into it are lost.', price: '-10% Damage',
        boost: { onHit: [{ type: 'zone', radius: 18, duration: 3, damageMul: 0.2, interval: 0.5, every: 0.4, status: { status: 'lost', duration: 1 } }], stats: { damageMul: 0.9 } } },   // (ruling 19 RC: its own, not the Tide Bell's Standing Wave; the id kept)
      { id: 'fog_bank', axis: 'payoff', name: 'Fog Bank', desc: 'Lost enemies stay lost 1s longer and move 30% slower.', price: '+10% Cooldown',
        capstone: true, control: true,
        boost: { onHit: [{ type: 'status', status: 'lost', duration: 2.5 }, { type: 'status', status: 'slow', pct: 0.3, duration: 2.5 }], stats: { cooldownMul: 1.1 } },
        look: { sprite: 'fx_wave_big', icon: 'icon_fog_horn' } },
      { id: 'wreckers_horn', axis: 'payoff', name: "Wrecker's Horn", desc: 'Lost enemies walk to where the note ends, into one heap, instead of away from you. +40% Damage.', price: '+10% Cooldown',
        capstone: true,
        boost: { fx: { wreck: true }, stats: { cooldownMul: 1.1, damageMul: 1.4 } },
        look: { sprite: 'fx_wave_big', icon: 'icon_fog_horn' } },
    ],
  },
  {
    line: 'eel_pot', weapons: ['eel_pot'],
    options: [
      { id: 'string_of_pots', axis: 'delivery', name: 'String of Pots', desc: 'Holds 4 pots at once, set every 2.5s, and every pot lunges.', price: '-10% Damage',
        boost: { emit: { pot: { every: 2.5, life: 11, max: 4 } }, stats: { damageMul: 0.9 } } },   // (ruling 23 WC: set A was a third of set B at 20:00)
      { id: 'bait_bucket', axis: 'delivery', name: 'Bait Bucket', desc: 'No pot: eels lunge from you, farther and 30% more often.', price: 'No pot on the ground',
        boost: { emit: { pot: null, range: 200 }, stats: { cooldownMul: 0.77 } } },
      { id: 'drag_under', axis: 'flight', name: 'Drag Under', desc: 'An eel pulls the enemy it bites under and stuns it for 1.5s. Eels deal 40% more damage to stunned enemies. +1 Eel.', price: '+10% Cooldown', control: true,
        boost: { onHit: [{ type: 'daze', duration: 1.5 }], fx: { bonus: { status: 'daze', mul: 1.4 } }, stats: { amount: 1, cooldownMul: 1.1 } } },
      { id: 'lamprey', axis: 'flight', name: 'Lamprey', desc: 'An eel stays on the first enemy it bites and keeps biting for 0.8s.', price: 'Each eel stays on one enemy',
        boost: { fx: { latch: { life: 0.8, every: 0.45 } } } },
      { id: 'conger', axis: 'payoff', name: 'Conger', desc: 'Bites stun for 0.5s. +2 Eels.', price: '+10% Cooldown',
        capstone: true,
        boost: { onHit: [{ type: 'daze', duration: 0.5 }], stats: { amount: 2, cooldownMul: 1.1 } },
        look: { sprite: 'proj_eel', icon: 'icon_conger_pot' } },
      { id: 'feeding_frenzy', axis: 'payoff', name: 'Feeding Frenzy', desc: 'Each bite on a rotting enemy makes the eels bite 8% faster for 3s, up to +48%.', price: '-15% Damage',
        capstone: true,
        boost: { fx: { frenzy: { per: 0.08, max: 6, sec: 3 } }, stats: { damageMul: 0.85 } },
        look: { sprite: 'proj_eel', icon: 'icon_conger_pot' } },
    ],
  },
  {
    line: 'anchor_chain', weapons: ['anchor_chain'],
    options: [
      { id: 'drop_anchor', axis: 'delivery', name: 'Drop Anchor', desc: 'After standing still for 1s, the anchor swings twice as wide and deals 50% more damage.', price: '-25% Area while you move',
        boost: { fx: { stance: { still: { after: 1, damageMul: 1.5, areaMul: 2 }, elseAreaMul: 0.75 } } } },
      { id: 'second_anchor', axis: 'delivery', name: 'Second Anchor', desc: 'A second anchor swings opposite the first.', price: '-30% Damage each',
        boost: { stats: { amount: 1, damageMul: 0.7 } } },
      { id: 'long_chain', axis: 'flight', name: 'Long Chain', desc: '+80% Range, and a bigger anchor.', price: 'Swings 65% slower, -50% Damage',
        boost: { stats: { orbitMul: 1.8, speedMul: 0.35, radiusMul: 1.05, damageMul: 0.5 } } },
      { id: 'cast_anchor', axis: 'flight', name: 'Cast Anchor', desc: 'Every 2.5s while moving, an anchor is thrown ahead and pulled back through enemies for 4.5x damage.', price: '-15% Damage while it swings',
        boost: { fx: { cue: { cast: { speed: 300, life: 1.1, damageMul: 4.5 }, every: 2.5 } }, stats: { damageMul: 0.85 } } },
      { id: 'deep_anchor', axis: 'payoff', name: 'Deep Anchor', desc: '+35% Damage, and +3 Damage for each point of Armor, up to 6 points.', price: '+10% Cooldown',
        capstone: true,
        boost: { emit: { armorDamage: 3, armorMax: 6 },   // (ruling 25 WE: the Harpooner's crowd Armor reaches 10; her seed-0 runs went to 3.7x)
          stats: { cooldownMul: 1.1, damageMul: 1.35 } },
        look: { sprite: 'proj_anchor', icon: 'icon_sea_anchor' } },
      { id: 'dredge', axis: 'payoff', name: 'Dredge', desc: 'The anchor pulls enemies it hits round with it, stunned for 0.6s, and deals 40% more damage to stunned enemies.', price: '-40% Knockback',
        capstone: true, control: true,
        boost: { fx: { dredge: { pull: 0.5 }, bonus: { status: 'daze', mul: 1.4 } }, onHit: [{ type: 'daze', duration: 0.6 }], stats: { knockbackMul: 0.6 } },
        look: { sprite: 'proj_anchor', icon: 'icon_sea_anchor' } },
    ],
  },
  {
    line: 'glass_caltrops', weapons: ['glass_caltrops'],
    options: [
      { id: 'glass_ring', axis: 'delivery', name: 'Glass Ring', desc: 'A trail of glass that crosses itself closes a loop. Enemies inside take 6x its damage.', price: '+20% Cooldown',
        boost: { fx: { loop: { mul: 6, minAge: 1, near: 12, every: 1 } }, stats: { cooldownMul: 1.2 } } },
      { id: 'scatter', axis: 'delivery', name: 'Scatter', desc: 'Glass is thrown ahead of you, 3 at a time in a fan.', price: 'Nothing lands behind you, and it throws less often',
        boost: { fx: { toss: { dist: 28, angle: 35 } }, stats: { amount: 2, cooldownMul: 2 } } },
      { id: 'deep_glass', axis: 'flight', name: 'Deep Glass', desc: 'Each piece lasts 2.5 times as long and cuts 3 more enemies.', price: '-20% Damage',
        boost: { stats: { durationMul: 2.5, pierce: 3, damageMul: 0.8 } } },
      { id: 'kicked_glass', axis: 'flight', name: 'Kicked Glass', desc: 'Every 1s while you move, glass close by is kicked at the nearest enemy, dealing 3x damage to enemies it crosses.', price: '-15% Duration',
        boost: { fx: { kick: { radius: 60, speed: 220, sec: 0.45, damageMul: 3, every: 1 } }, stats: { durationMul: 0.85 } } },
      { id: 'shatterfield', axis: 'payoff', name: 'Shatterfield', desc: 'Glass bursts when stepped on, slowing enemies near it.', price: '+10% Cooldown',
        capstone: true,
        boost: { onHit: [{ type: 'explode', radius: 18, damageMul: 0.6 }, { type: 'status', status: 'slow', pct: 0.3, duration: 1.2 }], stats: { cooldownMul: 1.1 } } },
      { id: 'hamstring', axis: 'payoff', name: 'Hamstring', desc: 'Cut enemies are slowed by 60% for 3s, and it deals 40% more damage to slowed enemies.', price: '+10% Cooldown',
        capstone: true, control: true,
        boost: { onHit: [{ type: 'status', status: 'slow', pct: 0.6, duration: 3 }], fx: { bonus: { status: 'slow', mul: 1.4 } }, stats: { cooldownMul: 1.1 } } },
    ],
  },
];

/**
 * Form options the game had before ruling 14 that are gone, and the option that took each one's
 * place (a save's `form:<id>` codex key, an order that counted one, a dev command that names one).
 */
export const RETIRED_FORMS = Object.freeze({
  planted_rod: 'ground_rod', wellspring: 'tide_pools', pick_volley: 'tongs', seeking_picks: 'long_throw',
  ricochet: 'skip_glass', eel_run: 'string_of_pots', creeping_glass: 'deep_glass',
  flood_tide: 'spring_tide', standing_wave: 'neap_pull',   // (King Tide's travel axis, C2, ruling 17 K1)
  starburst: 'bow_horn', buried_glass: 'twin_horns', skip_glass: 'long_note', split_bolt: 'held_note', glass_spikes: 'fog_bank', closed_circuit: 'wreckers_horn',   // (the Fulgurite's, to the Fog Horn in its place)
  skipping_jab: 'long_jab', creeping_hands: 'mire_grip', skipping_coin: 'heads_or_tails',   // (C2's replacements for the signatures' relay hops, ruling 18 KF)
});

// A line's capstoneUnlock is also its capstone options' `unlock`, where meta reads it
// (meta/state.js formsOpenFor, contentFrom): one key, written once. An option with a later key of its
// own keeps it (ruling 25 WA: Tether, held to Stern Lines so the Marsh's first runs meet the chain without it).
for (const l of ASCENSIONS) if (l.capstoneUnlock) for (const o of l.options) if (o.capstone && o.unlock === undefined) o.unlock = l.capstoneUnlock;
