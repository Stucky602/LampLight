// Stats and tags (ARCHITECTURE §5.9).
//
// A modifier is { stat, op: 'add' | 'pct' | 'more', value, tags?, weapon? }.
// The one formula, used everywhere:
//     final = (base + Σadd) × (1 + Σpct) × Π(1 + more)
// then the caps in data/tuning.js apply.
//
// Weapon stats come from a weapon's own numbers (its base plus its rolled upgrades: ruling 10,
// weaponOwnNumbers; a synthetic test weapon's level table, weaponLevelBase) and from
// every modifier whose stat maps to a weapon stat: `might` is damage, `area` is area, and so
// on (WEAPON_STAT_OF). A modifier with tags applies to a weapon that shares at least one of
// them; one without tags applies to every weapon; one with `weapon` applies to that weapon id
// only (character mechanics use it). Player stats (move speed, max HP, ...) take untagged
// modifiers only.
//
// Stats are recomputed when the build changes (a level-up pick, a relic, a Form), never per tick.

import { WEAPON_UPS, RETIRED_UPS } from '../data/weaponups.js';

const UP_BY_ID = new Map(WEAPON_UPS.map((t) => [t.id, t]));

export const WEAPON_STAT_OF = Object.freeze({
  might: 'damage', area: 'area', speed: 'speed', duration: 'duration', amount: 'amount',
  cooldown: 'cooldown', pierce: 'pierce', knockback: 'knockback', crit: 'crit', critMult: 'critMult',
  hops: 'hops',   // Copper Wire (0.8.0): more hops for anything that chains
});

export const PLAYER_STAT_IDS = Object.freeze([
  'moveSpeed', 'maxHp', 'regen', 'armor', 'magnet', 'luck', 'growth', 'greed', 'density',
  'revival', 'reroll', 'banish', 'skip', 'dashCooldown',
]);

export const STAT_IDS = Object.freeze([...Object.keys(WEAPON_STAT_OF), ...PLAYER_STAT_IDS]);

/** Base values of the weapon stats every weapon has (a weapon's `base` overrides these). */
export const WEAPON_DEFAULTS = Object.freeze({
  damage: 0, cooldown: 1, amount: 1, area: 1, speed: 1, duration: 1, pierce: 1, knockback: 0,
  hitCooldown: 0, radius: 4, interval: 0.08, crit: 0, critMult: 2, hops: 0,
});

const OPS = new Set(['add', 'pct', 'more']);

/** Does a modifier apply to a weapon with these tags and this id? */
export function modAppliesToWeapon(mod, weaponTags, weaponId) {
  if (mod.weapon !== undefined) return mod.weapon === weaponId;
  if (!mod.tags || mod.tags.length === 0) return true;
  for (let i = 0; i < mod.tags.length; i++) if (weaponTags.includes(mod.tags[i])) return true;
  return false;
}

/** Check a modifier's shape (content tests use this; the sim trusts validated data). */
export function checkModifier(mod) {
  if (!mod || typeof mod !== 'object') return 'modifier is not an object';
  if (!STAT_IDS.includes(mod.stat)) return `unknown stat "${mod.stat}"`;
  if (!OPS.has(mod.op)) return `unknown op "${mod.op}" (add, pct, or more)`;
  if (typeof mod.value !== 'number' || !Number.isFinite(mod.value)) return `value must be a finite number (got ${mod.value})`;
  if (mod.tags !== undefined && (!Array.isArray(mod.tags) || mod.tags.some((t) => typeof t !== 'string'))) return 'tags must be an array of strings';
  if (mod.weapon !== undefined && typeof mod.weapon !== 'string') return 'weapon must be a weapon id';
  if (PLAYER_STAT_IDS.includes(mod.stat) && (mod.tags?.length || mod.weapon)) return `player stat "${mod.stat}" can't be scoped to tags or a weapon`;
  if (mod.op === 'more' && mod.value <= -1) return '"more" must stay above -1 (it multiplies by 1 + value)';
  return null;
}

/**
 * (base + Σadd) × (1 + Σpct) × Π(1 + more) over the modifiers for one stat.
 * `filter(mod)` decides which modifiers apply (null: all of them).
 */
export function combine(base, mods, stat, filter = null) {
  let add = 0, pct = 0, more = 1;
  for (let i = 0; i < mods.length; i++) {
    const m = mods[i];
    if (m.stat !== stat || (filter !== null && !filter(m))) continue;
    if (m.op === 'add') add += m.value;
    else if (m.op === 'pct') pct += m.value;
    else if (m.op === 'more') more *= 1 + m.value;
    else throw new Error(`Modifier for ${stat} has an unknown op "${m.op}" (add, pct, or more)`);
  }
  const v = (base + add) * (1 + pct) * more;
  return v;
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

/**
 * Player stats from the character's base (with tuning defaults underneath) and the untagged
 * modifiers. Caps from tuning.caps.player.
 */
export function computePlayerStats(tuning, characterBase, mods) {
  const d = tuning.player.stats;
  const caps = tuning.caps.player;
  const out = {};
  for (const id of PLAYER_STAT_IDS) {
    const base = characterBase && characterBase[id] !== undefined ? characterBase[id] : d[id];
    let v = combine(base, mods, id, noScope);
    const cap = caps[id];
    if (cap) v = clamp(v, cap[0], cap[1]);
    out[id] = v;
  }
  // Charges and revivals are whole numbers.
  out.revival = Math.floor(out.revival);
  out.reroll = Math.floor(out.reroll);
  out.banish = Math.floor(out.banish);
  out.skip = Math.floor(out.skip);
  return out;
}

function noScope(m) { return !(m.tags && m.tags.length) && m.weapon === undefined; }

/**
 * A weapon's own numbers after its rolled upgrades (ruling 14, C1; data/weaponups.js): its base,
 * then each number upgrade taken ({ up, value }). 'mul' types multiply what it has now (damage x
 * (1 + value), cooldown x (1 - value)), so +20% Damage is +20% of what the weapon does; 'add' types
 * add. A line or a special changes no number here (sim/forms.js applies its boost). `caps`
 * (tuning.weaponUps.caps, with maxPierce) holds each where it leaves the pool.
 */
export function weaponOwnNumbers(def, ups, caps = null, maxPierce = Infinity) {
  const base = { ...WEAPON_DEFAULTS, ...def.base };
  const b = { ...base };
  for (const u of ups) {
    const t = UP_BY_ID.get(RETIRED_UPS[u.up] ?? u.up);
    if (!t || !t.stat) continue;
    if (t.stat === 'pierce' && base.pierce < 0) continue;
    if (t.how === 'mul') b[t.stat] *= 1 + t.sign * u.value;
    else b[t.stat] += t.sign * u.value;
  }
  if (caps) {
    b.cooldown = Math.max(b.cooldown, base.cooldown * caps.cooldown);
    b.area = Math.min(b.area, caps.area);
    b.duration = Math.min(b.duration, base.duration * caps.duration);
    b.amount = Math.min(b.amount, base.amount + (def.caps?.amountExtra ?? caps.amountExtra));
    if (base.pierce >= 0) b.pierce = Math.min(b.pierce, maxPierce);
    b.crit = Math.min(b.crit, Math.max(base.crit, caps.crit));
    b.hitCooldown = Math.max(b.hitCooldown, base.hitCooldown * caps.hitCooldown);
  }
  return b;
}

/** The upgrade caps (tuning.weaponUps.caps); a weapon's data may lower its count's (`caps.amountExtra`). */
export function upCapsOf(tuning, def) {
  return def.caps ? { ...tuning.weaponUps.caps, ...def.caps } : tuning.weaponUps.caps;
}

/** A level-table weapon's own numbers at a level (synthetic weapons in tests and probes: levels[L - 1]). */
export function weaponLevelBase(def, level) {
  const b = { ...WEAPON_DEFAULTS, ...def.base };
  const lv = Math.max(1, Math.min(level, def.maxLevel || 1));
  for (let L = 2; L <= lv; L++) {
    const delta = def.levels && def.levels[L - 1];
    if (!delta) continue;
    for (const k of Object.keys(delta)) b[k] = (b[k] ?? 0) + delta[k];
  }
  return b;
}

/**
 * Final weapon stats for a weapon at a level under the modifiers.
 * pierce: a base of -1 means "passes through everything" and stays -1.
 * The cooldown cap is relative to the weapon's own cooldown at that level.
 */
export function computeWeaponStats(tuning, def, level, mods) {
  // `level` is the upgrades taken (a drawable weapon, ruling 10) or a number (a level-table weapon).
  const base = Array.isArray(level)
    ? weaponOwnNumbers(def, level, tuning.weaponUps ? upCapsOf(tuning, def) : null, tuning.caps.weapon.maxPierce)
    : weaponLevelBase(def, level);
  // The calibration's one knob for the whole pool (tuning.weaponUps.baseDamage).
  if (Array.isArray(level) && tuning.weaponUps && tuning.weaponUps.baseDamage) base.damage *= tuning.weaponUps.baseDamage;
  const caps = tuning.caps.weapon;
  const tags = def.tags || [];
  const applies = (m) => modAppliesToWeapon(m, tags, def.id);
  const out = { ...base };
  for (const [stat, key] of Object.entries(WEAPON_STAT_OF)) {
    if (key === 'pierce' && base.pierce < 0) { out.pierce = -1; continue; }
    out[key] = combine(base[key], mods, stat, applies);
  }
  out.damage = Math.max(0, out.damage);
  out.cooldown = Math.max(out.cooldown, base.cooldown * caps.minCooldownFraction, caps.minCooldown);
  out.amount = clamp(Math.floor(out.amount), 0, base.amount + caps.maxExtraAmount);
  out.area = clamp(out.area, caps.area[0], caps.area[1]);
  out.speed = clamp(out.speed, caps.speed[0], caps.speed[1]);
  out.duration = clamp(out.duration, caps.duration[0], caps.duration[1]);
  if (out.pierce >= 0) out.pierce = clamp(Math.floor(out.pierce), 1, caps.maxPierce);
  out.knockback = Math.max(0, out.knockback);
  out.crit = clamp(out.crit, 0, 1);
  out.critMult = Math.max(1, out.critMult);
  out.hitCooldown = Math.max(0, base.hitCooldown);   // (its own, after its Hit Delay upgrades)
  out.hops = Math.max(0, Math.floor(out.hops));
  return out;
}
