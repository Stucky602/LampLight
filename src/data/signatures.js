// Signature weapons (ruling 14 section D, C2). Each character carries one weapon nobody else can
// take: `signature: '<character id>'` here, and the character's own `signature: '<weapon id>'`
// (data/characters.js). It sits in weapon slot 0 from 0:00 and is never in the draft, a chest, a
// Fog Bell's pick, or an Ember's choice: it grows on its own track (sim/trades.js: the run's clock
// and the character's trade), and its three axis choices are picked on that track.
//
// Each does its own verb at level 1, and that verb lives in the character's hook
// (sim/hooks-characters.js), not in another weapon's pipeline:
//   Lamplight      her light burns what stands in it (the game's one aura)
//   Grapnel        the haul: the last enemy the hook bit is hauled to her feet, dazed
//   Punt Pole      the turn: at full Momentum the pole sweeps all round him every few seconds
//   Bog Hands      raise: what dies in a hand's grip gets up for her
//   Grave Pennies  the finish: a penny kills an ordinary enemy under a share of its health
//   King Tide      two beats on a clock: the ebb drags in, the flood throws back
//
// The format is C1's v4 (work/cw/C1-CONTRACT.md section 2): `numbers` (what its track can roll;
// King Tide's has no cooldown and no amount, so nothing can touch its clock), `lines` (Rare and
// Epic behavior, once each), `specials` (Legendary, once each; `moves`: it changes how you move
// or where you stand). Its axes are in data/signature-forms.js. A line or a special is written
// with `fx` below: its mechanic key (read by the hook as slot.fx.<key>) and that key's numbers.
// (`upgrades` and the flat copy of each key's numbers are for the tree before C1's growth core,
// which the tools still measure against; they go when that tree does.)

import { CHARACTERS } from './characters.js';
import { fillText } from './textnum.js';

/** A line, special, or option built on a hook mechanic: `key` and its numbers, with optional stats and on-hit effects. */
export function fx(key, p = {}, stats = null, onHit = null) {
  return { form: key, ...p, boost: { ...(stats ? { stats } : {}), ...(onHit ? { onHit } : {}), fx: { [key]: p } } };
}
const line = (id, name, rarity, desc, key, p, stats, onHit) => ({ id, name, rarity, desc, ...fx(key ?? id, p, stats, onHit) });
const special = (id, name, moves, desc, p, stats, onHit) => ({ id, name, desc, ...(moves ? { moves: true } : {}), ...fx(id, p, stats, onHit) });

export const SIGNATURES = [
  {
    id: 'lamplight', name: 'Lamplight', desc: 'Her light burns enemies in it.',
    unit: 'Light', units: 'Lights',
    tags: ['light', 'fire'], sprite: 'fx_lamplight', icon: 'icon_lamplight', unlock: 'innate', signature: 'lamplighter', weight: 100,
    base: { damage: 20, cooldown: 1, amount: 1, duration: 1, pierce: -1, knockback: 0.2, hitCooldown: 0.6, radius: 26 },
    numbers: ['damage', 'area', 'crit', 'hit_cooldown'],
    upgrades: ['damage', 'area', 'crit', 'crit_mult', 'hit_cooldown'],
    lines: [
      line('afterglow', 'Lingering Light', 'rare', 'Enemies that leave her light keep burning for {p.duration}s.', null, { dpsMul: 0.6, duration: 2 }),
      line('lamp_shove', 'Lamp Shove', 'epic', 'Every {p.every}s her light knocks back enemies in it.', null, { every: 4, damageMul: 1, knockback: 3 }),
    ],
    specials: [
      special('long_shadow', 'Long Shadow', true, 'Enemies past {p.from%} of the way out in her light take {1+p.mul}x damage from it.', { from: 0.66, mul: 1 }),
      special('second_sun', 'Second Sun', true, 'Her lanterns deal the same damage as her light, not {c.lanternDamage%}, and each lasts until {p.keep} more are set down.', { damageMul: 1, keep: 3 }),
    ],
    pipeline: { emit: { type: 'aura' }, motion: { type: 'stationary' }, onHit: [{ type: 'damage' }, { type: 'knockback' }] },
    sfx: { hit: 'hit_soft' },
  },
  {
    id: 'grapnel', name: 'Grapnel', desc: 'Throws a hook at the nearest enemy. It hits on the way out and back, and pulls the last enemy, or the nearest one there, to her, stunned.',
    unit: 'Hook', units: 'Hooks',
    tags: ['steel', 'sea'], sprite: 'proj_grapnel', icon: 'icon_grapnel', unlock: 'innate', signature: 'harpooner', weight: 100,
    base: { damage: 270, cooldown: 1.3, amount: 1, duration: 1.0, pierce: -1, knockback: 1.0, hitCooldown: 0.4, radius: 9, interval: 0.15 },
    numbers: ['damage', 'cooldown', 'area', 'duration', 'crit'],
    upgrades: ['damage', 'cooldown', 'area', 'duration', 'crit', 'crit_mult'],
    lines: [
      line('barbs', 'Barbs', 'rare', 'Pulled enemies are slowed by {p.slow%} for {p.sec}s.', null, { slow: 0.3, sec: 3 }),
      line('chain_haul', 'Chain Haul', 'epic', 'Each pull brings in the {p.extra} nearest enemies too.', null, { extra: 2, radius: 60 }),
    ],
    specials: [
      special('whalers_brace', 'Whaler\'s Brace', true, 'While she stands still she throws {1/(1+p.rate)-1%} faster, and her pulls stun twice as long.', { still: 0.6, rate: -0.375, dazeMul: 2 }),
      special('ring_of_hooks', 'Ring of Hooks', false, 'Every {p.every}s the Grapnel hooks the {p.n} nearest enemies and pulls them in.', { every: 5, n: 3, radius: 150, damageMul: 1 }),
    ],
    pipeline: { emit: { type: 'nearest', range: 240 }, motion: { type: 'boomerang', speed: 250 }, onHit: [{ type: 'damage' }, { type: 'knockback' }] },
    sfx: { fire: 'grapnel_throw', hit: 'hit_hard' },
  },
  {
    id: 'punt_pole', name: 'Punt Pole', desc: 'Jabs at the nearest enemy, +{c.reachPerStep%} Area for each step of Momentum. At full Momentum it sweeps around him every {c.sweepEvery}s, knocking enemies back.',
    unit: 'Jab', units: 'Jabs',
    tags: ['sea', 'steel'], sprite: 'fx_glint', icon: 'icon_punt_pole', unlock: 'innate', signature: 'punter', weight: 100,
    base: { damage: 42, cooldown: 1.2, amount: 1, duration: 0.18, pierce: -1, knockback: 1.6, hitCooldown: 0.3, radius: 64, interval: 0.12 },
    // A jab hits each enemy once (it lasts less than its hit delay): no Duration or Hit Delay to stretch it.
    numbers: ['damage', 'cooldown', 'area', 'amount', 'crit'],
    caps: { amountExtra: 2 },
    upgrades: ['damage', 'cooldown', 'area', 'amount', 'crit', 'crit_mult'],
    upCaps: { amountExtra: 2, area: 2 },
    lines: [
      line('splash', 'Splash', 'rare', 'A sweep slows enemies it hits by {p.slow%} for {p.sec}s.', null, { slow: 0.3, sec: 2 }),
      line('follow_through', 'Follow Through', 'epic', 'A sweep readies the jab at once.', null, {}),
    ],
    specials: [
      special('full_tilt', 'Full Tilt', true, 'At full Momentum he jabs twice as fast.', { rate: -0.5 }),
      special('crows_landing', 'Crow\'s Landing', true, 'A sweep among {p.count} or more enemies sweeps twice.', { count: 6 }),
    ],
    pipeline: { emit: { type: 'beam', width: 7 }, motion: { type: 'stationary' }, onHit: [{ type: 'damage' }, { type: 'knockback' }] },
    sfx: { fire: 'pole_jab', hit: 'hit_hard' },
  },
  {
    id: 'bog_hands', name: 'Bog Hands', desc: 'Hands rise under enemies, stun them for {o.daze.duration}s, and rot them: they take {o.rot.amp%} more damage for {o.rot.duration}s. Enemies that die in their grip fight for her.',
    unit: 'Hand', units: 'Hands',
    tags: ['rot'], sprite: 'fx_mire_hand', upright: true, icon: 'icon_bog_hands', unlock: 'innate', signature: 'bog_warden', weight: 100,
    base: { damage: 13, cooldown: 4.8, amount: 2, duration: 0.35, pierce: -1, knockback: 0, hitCooldown: 0.3, radius: 12 },   // (duration: how long the hand shows)
    numbers: ['damage', 'cooldown', 'area', 'amount', 'crit'],
    upgrades: ['damage', 'cooldown', 'area', 'amount', 'crit', 'crit_mult'],
    lines: [
      line('cold_fingers', 'Cold Fingers', 'rare', 'Enemies a hand held are slowed by {p.slow%} for {p.sec}s after.', null, { slow: 0.4, sec: 2.5 }),
      line('many_hands', 'Many Hands', 'epic', 'A grasp also reaches for the nearest enemy beside it, once every {p.every}s.', null, { range: 80, damageMul: 1, every: 0.5 }),
    ],
    specials: [
      special('dead_march', 'Dead March', true, 'Her thralls stay near her and bite enemies that come close, twice as fast.', { radius: 60, rate: 2 }),
      special('pallbearers', 'Pallbearers', false, 'A hit that would hurt her falls on her nearest thrall instead, once every {p.every}s.', { every: 6 }),
    ],
    pipeline: {
      emit: { type: 'strike' }, motion: { type: 'stationary' },
      onHit: [{ type: 'damage' }, { type: 'daze', duration: 0.5 }, { type: 'status', status: 'rot', duration: 3, amp: 0.25 }],
    },
    sfx: { fire: 'mire_grasp', hit: 'hit_soft' },
  },
  {
    id: 'grave_pennies', name: 'Grave Pennies', desc: 'Flings pennies at the nearest enemies. A penny finishes an ordinary enemy under {c.below%} HP.',
    unit: 'Penny', units: 'Pennies',
    tags: ['steel', 'fire'], sprite: 'proj_penny', upright: true, icon: 'icon_grave_pennies', unlock: 'innate', signature: 'drowned_man', weight: 100,
    base: { damage: 9, cooldown: 0.9, amount: 2, duration: 1.2, pierce: 1, knockback: 0.3, radius: 3, interval: 0.08 },
    numbers: ['damage', 'cooldown', 'area', 'amount', 'pierce', 'crit'],
    upgrades: ['damage', 'cooldown', 'area', 'amount', 'pierce', 'crit', 'crit_mult'],
    lines: [
      line('cold_coin', 'Cold Coin', 'rare', 'A finished enemy chills enemies near it: slowed by {p.slow%} for {p.sec}s.', null, { radius: 34, slow: 0.3, sec: 2 }),
      line('two_coins', 'Two Coins', 'epic', 'Every {p.every}s it throws all its pennies at once.', null, { every: 3 }),
    ],
    specials: [
      special('close_reckoning', 'Close Reckoning', true, 'Pennies deal {p.mul%} more damage close to him, and a penny that lands close puts {p.pay} in the purse.', { radius: 70, mul: 0.5, pay: 2 }),
      special('ferrymans_fee', 'Ferryman\'s Fee', false, 'Each time his purse fills it pays a Pearl, one every {p.gap}s at most, and his pennies finish elites under {p.elite%} HP.', { gap: 30, elite: 0.1 }),
    ],
    pipeline: { emit: { type: 'nearest', range: 300 }, motion: { type: 'linear', speed: 300 }, onHit: [{ type: 'damage' }, { type: 'knockback' }] },
    sfx: { fire: 'penny_flick', hit: 'hit_hard' },
  },
  {
    id: 'king_tide', name: 'King Tide', desc: 'Every {c.every}s a flood knocks back enemies near her. Halfway between floods, the ebb pulls enemies toward her.',
    unit: 'Tide', units: 'Tides',
    tags: ['sea', 'frost'], sprite: 'fx_wave_big', icon: 'icon_king_tide', unlock: 'innate', signature: 'tide_priest', weight: 100,
    base: { damage: 32, cooldown: 30, amount: 1, duration: 1.4, pierce: -1, knockback: 4, hitCooldown: 1.5, radius: 200, interval: 0.4 },
    // Her clock is fixed: no Cooldown and no Amount (ruling 14, item 11), and her hook sets the wait
    // itself, so nothing else in a build shortens it. The tide passes each enemy once: no Duration.
    numbers: ['damage', 'area', 'crit'],
    upgrades: ['damage', 'area', 'crit', 'crit_mult'],
    lines: [
      line('cold_tide', 'Numbing Flood', 'rare', 'The flood slows enemies it hits by {o.slow.pct%} for {o.slow.duration}s.', null, {}, null, [{ type: 'status', status: 'slow', pct: 0.3, duration: 2 }]),
      line('shock', 'Shock', 'epic', 'The flood stuns enemies it hits for {o.daze.duration}s.', null, {}, null, [{ type: 'daze', duration: 0.5 }]),
    ],
    specials: [
      special('twin_tide', 'Twin Tide', false, 'Each flood is followed {p.delay}s later by a second at {p.mul%} damage.', { delay: 1.5, mul: 0.5 }),
      special('moons_pull', 'Full Moon', true, 'The ebb reaches twice as far, and the flood deals {1+p.mul}x damage to enemies right next to her.', { reach: 2, near: 54, mul: 1 }),
    ],
    pipeline: { emit: { type: 'wave', thickness: 22 }, motion: { type: 'stationary' }, onHit: [{ type: 'damage' }, { type: 'knockback' }] },
    sfx: { fire: 'tide_roll', hit: 'hit_hard' },
  },
];

/**
 * The scope a signature's text reads its numbers from (data/textnum.js): p a line's own numbers,
 * x its stats, o the hit effects (by type, a status by its name), w the weapon's base, c its
 * character's mechanic. data/signature-forms.js uses it for the options too.
 */
export function textScope(weapon, item = null) {
  const o = {};
  for (const e of [...(weapon.pipeline?.onHit ?? []), ...(item?.boost?.onHit ?? [])]) o[e.type === 'status' ? e.status : e.type] = e;
  const ch = CHARACTERS.find((c) => c.id === weapon.signature);
  return { p: item ? item.boost?.fx?.[item.form] ?? {} : {}, x: item?.boost?.stats ?? {}, o, w: weapon.base, c: ch ? ch.mechanic.params : {} };
}
for (const w of SIGNATURES) {
  w.desc = fillText(w.desc, textScope(w), w.id);
  for (const it of [...w.lines, ...w.specials]) it.desc = fillText(it.desc, textScope(w, it), `${w.id}.${it.id}`);
}

/** The signature weapons' ids (data/index.js replaces the old built-in Lamplight by its id). */
export const SIGNATURE_IDS = Object.freeze(new Set(SIGNATURES.map((w) => w.id)));
