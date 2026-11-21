// The signature weapons' axes (ruling 14 sections C and D, C2). Each signature (data/signatures.js)
// has three axes of two options, and holds one option per axis, in C1's shape (work/cw/
// C1-CONTRACT.md section 4.1): { id, axis, name, desc, price, boost, capstone }. data/index.js joins
// these lines to DATA.ascensions.
//
// The first two axes open at the weapon's 5th and 10th upgrade on its track; the capstone axis
// opens when the character's own deed is done in the run (data/characters.js trade.deed), not by
// an order. (The six orders that opened these capstones open a skill of the character's tree now.)
//
// Most options are built from the character's own mechanic: their key (`fx`, data/signatures.js)
// is one sim/forms.js doesn't know, and what it does lives in that character's hook
// (sim/hooks-characters.js), which reads the slot's options as slot.fx.<key>. A few reuse a
// forms.js mechanic where it is the option's idea (relay: a hit that skips on; breakers: a wave
// that rolls in).

import { fx, SIGNATURES, textScope } from './signatures.js';
import { fillText } from './textnum.js';

const opt = (id, axis, name, desc, price, key, p, stats, onHit) => ({ id, axis, name, desc, price, ...(axis === 'payoff' ? { capstone: true } : {}), ...fx(key ?? id, p, stats, onHit) });
const D = 'delivery', F = 'flight', P = 'payoff';

export const SIGNATURE_FORMS = [
  {
    line: 'lamplight', weapons: ['lamplight'],
    options: [
      opt('kindle', D, 'Kindle', 'Every {p.every}s her light flares to +{p.areaAdd%} Area for {p.sec}s.', '{p.lull%} Damage between flares', null, { every: 8, sec: 1, areaAdd: 0.6, lull: -0.2 }),
      opt('hot_wick', D, 'Hot Wick', '+{x.damageMul-1%} Damage.', '-{1-x.areaMul%} Area', null, {}, { damageMul: 2.5, areaMul: 0.8 }),
      opt('lamp_wake', F, 'Lamp Wake', 'While she moves, her light leaves patches behind that burn for {p.life}s.', '-{1-x.areaMul%} Area', null, { every: 0.5, life: 2, radiusMul: 0.6, damageMul: 0.38, interval: 0.5 }, { areaMul: 0.85 }),
      opt('standing_light', F, 'Standing Light', '+{p.moveAdd%} Area, and +{p.areaAdd%} more Area while she stands still.', '+{x.cooldownMul-1%} Cooldown', null, { still: 0.5, areaAdd: 0.5, moveAdd: 0.25 }, { cooldownMul: 1.15 }),
      opt('wardlight', P, 'Watch Light', 'Where her light kills an enemy, a small patch of light stays for {p.life}s and burns enemies in it.', '+{x.hitCooldownMul-1%} Hit Delay', null, { life: 4, radius: 16, damageMul: 0.35, interval: 0.5, every: 0.5, max: 4 }, { hitCooldownMul: 1.1 }),
      opt('dread_light', P, 'Dread Light', 'Enemies in her light take {p.amp%} more damage. Her light also gets +{x.damageMul-1%} Damage.', '-{1-x.areaMul%} Area', null, { amp: 0.2, sec: 0.9 }, { areaMul: 0.9, damageMul: 1.6 }),
    ],
  },
  {
    line: 'grapnel', weapons: ['grapnel'],
    options: [
      opt('cast_net', D, 'Cast Net', 'Every {p.every#} pull is a net: enemies near the hooked one are pulled in too and stunned.', '+{x.cooldownMul-1%} Cooldown', null, { every: 4, radius: 50, pull: 2.4, daze: 0.6 }, { cooldownMul: 1.15 }),
      opt('twin_hooks', D, 'Twin Hooks', 'Throws {w.amount+x.amount} hooks at {w.amount+x.amount} enemies, and pulls both in.', '+{x.cooldownMul-1%} Cooldown', null, {}, { amount: 1, cooldownMul: 1.2 }),
      opt('long_line', F, 'Long Line', 'The hook flies {x.durationMul-1%} farther, and the enemy it pulls hits every enemy it is pulled through.', '-{1-x.speedMul%} Projectile Speed', null, { radius: 16, damageMul: 0.5 }, { durationMul: 1.6, speedMul: 0.8 }),
      opt('short_gaff', F, 'Short Hook', 'Thrown twice as often.', '-{1-x.durationMul%} Range', null, {}, { cooldownMul: 0.5, durationMul: 0.75 }),
      opt('flense', P, 'Flense', 'An enemy it kills throws a barb into the nearest enemy: {p.damageMul%} of its damage, and it is hooked ({p.perSec} a second at most).', '+{x.cooldownMul-1%} Cooldown', null, { radius: 30, damageMul: 0.5, knockback: 0.8, perSec: 6 }, { cooldownMul: 1.1 }),
      opt('keelhaul', P, 'Keelhaul', 'A pulled enemy takes {p.amp%} more damage for {p.sec}s. The Grapnel also gets +{x.damageMul-1%} Damage.', '+{x.cooldownMul-1%} Cooldown', null, { amp: 0.6, sec: 3 }, { cooldownMul: 1.1, damageMul: 1.3 }),
    ],
  },
  {
    line: 'punt_pole', weapons: ['punt_pole'],
    options: [
      opt('long_jab', D, 'Long Jab', '+{x.areaMul-1%} Area. An enemy at the tip is hit twice.', '-{1-x.damageMul%} Damage', null, { tip: 0.7 }, { areaMul: 1.2, damageMul: 0.8 }),
      opt('pin', D, 'Pin', 'The jab stuns enemies it hits for {p.daze}s. +{x.damageMul-1%} Damage.', 'No Knockback', null, { daze: 0.8 }, { damageMul: 1.5, knockbackMul: 0.01 }),
      opt('long_sweep', F, 'Long Sweep', 'The sweep reaches {p.radius-1%} farther.', '{p.every}s more between sweeps', null, { radius: 1.25, every: 1 }),
      opt('eddy', F, 'Eddy', 'The sweep leaves a whirl of water for {p.life}s that pulls enemies to its middle.', '-{1-p.damageMul%} Damage on sweeps', null, { life: 2, pull: 1.2, damageMul: 0.9 }),
      opt('bow_wave', P, 'Bow Wave', 'At full Momentum each jab bursts at its tip and knocks back enemies near it.', '+{x.cooldownMul-1%} Cooldown', null, { radius: 26, damageMul: 0.3, knockback: 1.8, every: 0.6 }, { cooldownMul: 1.1 }),
      opt('breakwater', P, 'Backwater', 'A sweep leaves standing water for {p.life}s that slows enemies by {p.slow%} and deals {p.damageMul%} of the sweep\'s damage every {p.interval}s.', '-{1-x.knockbackMul%} Knockback', null, { life: 3, damageMul: 0.3, interval: 0.5, slow: 0.4 }, { knockbackMul: 0.6 }),
    ],
  },
  {
    line: 'bog_hands', weapons: ['bog_hands'],
    options: [
      opt('mire_ring', D, 'Mire Ring', 'Every {p.every}s, hands rise under every enemy close to her.', '+{x.cooldownMul-1%} Cooldown', null, { every: 6, radius: 80, damageMul: 1, rot: 3, amp: 0.25 }, { cooldownMul: 1.15 }),
      opt('grave_reach', D, 'Grave Reach', 'With each grasp, a hand also rises beside each of her thralls, up to {p.n}.', '-{1-x.damageMul%} Damage', null, { n: 3, range: 60, rot: 3, amp: 0.25, daze: 0.5 }, { damageMul: 0.9 }),
      opt('mire_grip', F, 'Mire Grip', 'Where a hand grabs, the mire churns for {p.life}s, dealing {p.damageMul%} of the hand\'s damage to enemies in it every {p.interval}s.', '-{1-x.damageMul%} Damage', null, { life: 1.5, damageMul: 0.04, interval: 0.5, radius: 1 }, { damageMul: 0.8 }),
      opt('deep_hold', F, 'Deep Hold', 'Hands stun for {p.daze}s and squeeze for {p.squeeze%} of their damage every {p.interval}s. Rotting enemies take {p.amp%} more damage, not {o.rot.amp%}.', '+{x.cooldownMul-1%} Cooldown', null, { daze: 1.5, amp: 0.5, squeeze: 0.25, interval: 0.5 }, { cooldownMul: 1.15 }),
      opt('bog_kin', P, 'Bog Kin', 'Her thralls last {p.secMul-1%} longer, and their bites rot: enemies take {p.amp%} more damage for {p.rot}s.', '-{1-x.damageMul%} Damage', 'bog_host', { secMul: 1.6, rot: 3, amp: 0.25 }, { damageMul: 0.75 }),
      opt('peat_fire', P, 'Bog Fire', 'A thrall that dies bursts into rot, damaging enemies near it.', 'Thralls last {-p.sec}s less', null, { radius: 32, bites: 2, rot: 3, amp: 0.25, sec: -1 }),
    ],
  },
  {
    line: 'grave_pennies', weapons: ['grave_pennies'],
    options: [
      opt('full_purse', D, 'Full Purse', '+1 Penny for each sea chest he has brought up.', '-{1-x.damageMul%} Damage', null, {}, { damageMul: 0.9 }),
      opt('paid_in_advance', D, 'Paid in Advance', 'Each crate he brings up adds {p.per%} to the pennies\' damage for the run, up to {p.max} crates.', '-{1-x.damageMul%} Damage', null, { per: 0.08, max: 15 }, { damageMul: 0.85 }),
      opt('heads_or_tails', F, 'Heads or Tails', 'Every {p.every#} penny that hits strikes again for the same damage.', '-{1-x.damageMul%} Damage', null, { every: 2 }, { damageMul: 0.8 }),
      opt('paid_passage', F, 'Paid Passage', 'Pennies pass through every enemy, and he throws {x.amount} more.', '+{x.cooldownMul-1%} Cooldown', null, {}, { cooldownMul: 1.2, amount: 2, set: { pierce: -1 } }),
      opt('pennies_on_the_eyes', P, 'Pennies on the Eyes', 'His pennies finish enemies under {p.below%} HP, and each penny also hits the enemy beside its target for {p.mul%} damage.', '+{x.cooldownMul-1%} Cooldown', 'eyes_paid', { below: 0.3, range: 90, mul: 0.5, every: 0.5 }, { cooldownMul: 1.1 }),
      opt('weighed_down', P, 'Weighed Down', 'Each penny on an enemy slows it by {p.slow%} and makes it take {p.amp%} more damage, up to {p.max} pennies.', '+{x.cooldownMul-1%} Cooldown', null, { slow: 0.12, amp: 0.12, max: 5, sec: 3 }, { cooldownMul: 1.1 }),
    ],
  },
  {
    line: 'king_tide', weapons: ['king_tide'],
    options: [
      opt('tide_table', D, 'Tide Table', 'Each enemy the flood hits brings the next flood {p.cutPerHit}s sooner, up to {p.maxCut%} sooner.', '-{1-x.damageMul%} Damage', null, { cutPerHit: 0.1, maxCut: 0.33 }, { damageMul: 0.85 }),
      opt('spring_neap', D, 'Spring and Neap', 'Every other flood deals {1+p.big}x damage and reaches {p.bigArea%} farther.', '{p.small%} Damage on the other floods', null, { big: 1, bigArea: 0.5, small: -0.5 }),
      opt('spring_tide', F, 'Spring Tide', 'A thin flood also runs out the way she faces, twice as far as the round one, and back.', '-{1-x.damageMul%} Damage', null, { reach: 2, width: 18, sec: 0.6, damageMul: 0.6 }, { damageMul: 0.8 }),
      opt('neap_pull', F, 'Neap Pull', 'The ebb pulls from twice as far and holds the enemies it pulls for {p.daze}s.', 'No Knockback on the flood', null, { reach: 2, daze: 0.5 }, { knockbackMul: 0.01 }),
      opt('high_water_mark', P, 'High Water Mark', 'Where the flood passes it leaves pools that slow enemies by {o.zone.status.pct%}.', '+{x.hitCooldownMul-1%} Hit Delay', null, {}, { hitCooldownMul: 1.1 },
        [{ type: 'zone', radius: 20, duration: 4, damage: 6, interval: 0.5, every: 0.25, status: { status: 'slow', pct: 0.3, duration: 1 } }]),
      opt('drowning_tide', P, 'Drowning Tide', 'Enemies the ebb pulls take {p.amp%} more damage until the next flood.', 'The ebb itself does no damage', null, { amp: 1 }),
    ],
  },
];
// A travel option that swaps the motion says so on its boost (C1's shape), as well as flat for the older tree.
for (const l of SIGNATURE_FORMS) for (const o of l.options) if (o.motion) o.boost.motion = o.motion;
// Numbers in an option's line and price read its own data (data/textnum.js; the scope: signatures.js textScope).
for (const l of SIGNATURE_FORMS) {
  const w = SIGNATURES.find((x) => x.id === l.line);
  for (const o of l.options) { o.desc = fillText(o.desc, textScope(w, o), `${l.line}.${o.id}`); o.price = fillText(o.price, textScope(w, o), `${l.line}.${o.id}.price`); }
}

/**
 * The keys whose mechanics are the characters' hooks (tests/forms.test.js counts them as known):
 * every key of a signature's options, lines, and specials that sim/forms.js doesn't build.
 */
const SHARED = new Set(['relay', 'breakers']);
export const SIGNATURE_MECHANICS = Object.freeze([...new Set([
  ...SIGNATURE_FORMS.flatMap((l) => l.options.map((o) => o.form)),
  ...SIGNATURES.flatMap((w) => [...w.lines, ...w.specials].map((x) => x.form)),
].filter((k) => !SHARED.has(k)))]);
