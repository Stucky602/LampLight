// Rolled weapon upgrades (ruling 14, C1; work/cw/C1-CONTRACT.md section 3). A weapon has no level
// table and no max level: each level-up is one upgrade rolled at a rarity.
//   Common, Uncommon   numbers (data/weaponups.js): damage, cooldown, area, duration; from Uncommon a
//                      count (its unit: a flare, an orb), pierce, crit, hit delay. Damage, cooldown,
//                      duration, and hit delay multiply what the weapon has now.
//   Rare, Epic         one of the weapon's own behavior lines (its data's `lines`), once each; with
//                      none left at that rarity, a number at that rarity's size.
//   Legendary          one of the weapon's own specials (its data's `specials`), once each; with
//                      none left, a number at Legendary size.
// A weapon's 3rd, 6th, 9th... upgrade rolls Rare or better (tuning.weaponUps.milestone), and its
// 10th, 20th... a Legendary unless one was offered to it since the last (`legendary`). No number is
// offered that changes the weapon's output by less than `floor` (cardWorth). A number type leaves
// the pool at its cap; damage never does, so the pool never runs dry.
//
// Rolls take the stream they're given: the draft's for level-ups (sim/draft.js), the loot stream for
// a chest's item, the Fog Bell's pick, and a signature weapon's own track, so replays stay exact.

import { WEAPON_UPS, RETIRED_UPS } from '../data/weaponups.js';
import { weaponOwnNumbers, upCapsOf } from './stats.js';
import { fpow } from '../lib/fmath.js';
import { EV } from './events.js';

/** The rarity ids in order (data/rarity.js names and colors them; tests/weaponups.test.js keeps the two the same). */
export const RARITY_IDS = Object.freeze(['common', 'uncommon', 'rare', 'epic', 'legendary']);
export const UP_TYPES = new Map(WEAPON_UPS.map((t) => [t.id, t]));
/** A type's number, for the world hash. */
export const UP_INDEX = new Map(WEAPON_UPS.map((t, i) => [t.id, i]));
const EPS = 1e-9;
const LINE = UP_TYPES.get('line'), SPECIAL = UP_TYPES.get('special');

/** Is number type t at its cap for this weapon after `ups`? */
export function upCapped(world, def, ups, t) {
  const caps = upCapsOf(world.tuning, def);
  const base = weaponOwnNumbers(def, []), own = weaponOwnNumbers(def, ups);
  switch (t.id) {
    case 'damage': return false;
    case 'cooldown': return own.cooldown <= base.cooldown * caps.cooldown + EPS;
    case 'area': return own.area >= caps.area - EPS;
    case 'duration': return own.duration >= base.duration * caps.duration - EPS;
    case 'amount': return own.amount >= base.amount + caps.amountExtra;
    case 'pierce': return base.pierce < 0 || own.pierce >= world.tuning.caps.weapon.maxPierce;
    case 'crit': return own.crit >= caps.crit - EPS;
    case 'hit_cooldown': return base.hitCooldown <= 0 || own.hitCooldown <= base.hitCooldown * caps.hitCooldown + EPS;
    default: return true;
  }
}

/** The weapon's behavior lines it hasn't taken (and hasn't had banished), at rarity index r (any, when r is omitted). */
export function linesOpen(world, slot, r = -1) {
  const def = slot.def, ban = world.build.banished, held = slot.lines || [];
  return (def.lines || []).filter((l) => !held.includes(l.id) && !ban.has(`up:${def.id}:line:${l.id}`) && (r < 0 || RARITY_IDS.indexOf(l.rarity) === r));
}

/** The weapon's Legendary specials it hasn't taken (and hasn't had banished). */
export function specialsOpen(world, slot) {
  const def = slot.def, ban = world.build.banished, held = slot.specials || [];
  return (def.specials || []).filter((x) => !held.includes(x.id) && !ban.has(`up:${def.id}:special:${x.id}`));
}

/** The number types the weapon in this slot can still roll: its own, not capped, not banished for it. */
export function upsOpen(world, slot) {
  const def = slot.def;
  if (!def || def.innate || !def.numbers || !def.numbers.length) return [];
  const ban = world.build.banished, out = [];
  for (const t of WEAPON_UPS) {
    if (!t.stat || !def.numbers.includes(t.id)) continue;
    if (ban.has(`up:${def.id}:${t.id}`)) continue;
    if (upCapped(world, def, slot.ups, t)) continue;
    out.push(t);
  }
  return out;
}

/** Can the weapon in this slot level up at all? */
export function canLevelWeapon(world, slot) {
  return upsOpen(world, slot).length > 0;
}

/** A rarity rolled on `rng` (an index): the odds, shifted up by Luck. */
export function rollRarity(world, rng) {
  const T = world.tuning.weaponUps, luck = Math.max(0.1, world.stats ? world.stats.luck : 1);
  const w = T.odds.map((x, r) => x * fpow(luck, r * T.luckPow));
  return Math.max(0, rng.weighted(w));
}

/** What number type t gives at rarity r: a Common's value x the rarity's multiplier (whole types: 1, or 2 from Epic). */
export function upValue(world, t, r, slot = null) {
  const T = world.tuning.weaponUps, rr = Math.max(r, t.min);
  if (t.whole) return rr >= 2 ? 2 : 1;   // (W9: a Rare count is +2, not the Uncommon's +1)
  let v = T.value[t.id] * T.mul[rr] / T.mul[t.min];
  if (t.id === 'cooldown' || t.id === 'hit_cooldown') v = Math.min(v, T.cooldownMax);
  // Damage cards on one weapon shrink as it takes more of them (x damageDecay each, never under the
  // floor): stacking one weapon still pays, but less each time, so a second weapon is worth raising
  // (the late runaway, C1 Nov 17). The card's now and after are worked out from this value.
  if (t.id === 'damage' && slot && T.damageDecay) {
    let n = 0;
    for (const u of slot.ups) if (u.up === 'damage') n++;
    if (n > 0) v = Math.max(T.floor, v * fpow(T.damageDecay, n));
  }
  return Math.round(v * 1e4) / 1e4;
}

/**
 * About how much an upgrade changes the weapon's output (0.2: a fifth more): the floor's measure,
 * and what "Pick for me" and the bots score a card by. Damage and a count are their ratio, a
 * cooldown or a hit delay 1 / (1 - v), area its share of the footprint, crit its chance x what a
 * crit adds; a line and a special count what tuning.weaponUps says.
 */
export function cardWorth(world, slot, u) {
  const T = world.tuning.weaponUps;
  if (u.up === 'line') return T.lineWorth * (u.rarity === 'epic' ? 1.4 : 1);
  if (u.up === 'special') return T.specialWorth;
  const own = weaponOwnNumbers(slot.def, slot.ups), v = u.value;
  switch (RETIRED_UPS[u.up] ?? u.up) {
    case 'damage': return v;
    case 'cooldown': case 'hit_cooldown': return 1 / (1 - Math.min(0.9, v)) - 1;
    case 'area': { const k = (own.area + v) / own.area; return k * Math.sqrt(k) - 1; }
    case 'duration': return v * 0.6;
    case 'amount': return v / Math.max(1, own.amount);
    case 'pierce': return own.pierce < 0 ? 0 : 0.6 * v / (own.pierce + 1);
    case 'crit': return v * (own.critMult - 1) / (1 + own.crit * (own.critMult - 1));
    default: return 0;
  }
}

/** Every how-many upgrades a weapon's is Rare or better (the Whetstone: one sooner). */
function milestoneEvery(world) {
  const n = world.tuning.weaponUps.milestone;
  return world.rules && world.rules.whetstone ? Math.max(2, n - 1) : n;
}

/** Is the weapon's n-th upgrade (1 for its first) a milestone: Rare or better for certain? */
export function isMilestone(world, n) {
  const m = milestoneEvery(world);
  return m > 0 && n > 0 && n % m === 0;
}

/** The weapon's real number for a stat now and after upgrade u (its final stats, passives and Forms included). */
function nowAfter(world, slot, t, value) {
  const caps = upCapsOf(world.tuning, slot.def), mp = world.tuning.caps.weapon.maxPierce;
  const a = weaponOwnNumbers(slot.def, slot.ups, caps, mp), b = weaponOwnNumbers(slot.def, [...slot.ups, { up: t.id, value }], caps, mp);
  const now = slot.stats[t.stat];
  const after = t.how === 'mul' ? (a[t.stat] !== 0 ? now * b[t.stat] / a[t.stat] : now) : now + (b[t.stat] - a[t.stat]) * (t.stat === 'area' && a.area > 0 ? now / a.area : 1);
  return [now, after];
}

/**
 * Roll one upgrade for the weapon in slot s on `rng`: { up, rarity, value, line?, special?, stat?,
 * now?, after?, worth, milestone } (rarity an id), or null when nothing is open. `skip` (a Set of
 * keys: a type id, 'line:<id>', 'special:<id>') keeps a second card for the same weapon from showing
 * the same thing. opts.min: a lowest rarity (an index); opts.noSpecial: never a special (a second
 * card beside one).
 */
export function rollUpgrade(world, s, rng, skip = null, opts = null) {
  const slot = world.slots[s];
  if (!slot || !slot.def) return null;
  const T = world.tuning.weaponUps;
  const n = slot.ups.length + 1;
  let r = rollRarity(world, rng);
  const milestone = isMilestone(world, n);
  if (milestone) r = Math.max(r, 2);
  // A Legendary rolled by luck before the weapon's legendaryFrom-th upgrade is an Epic: the
  // specials come once a weapon has grown into them (it narrows the lucky against unlucky spread).
  if (r === 4 && n < (T.legendaryFrom ?? 0)) r = 3;
  if (T.legendary > 0 && n % T.legendary === 0 && (slot.legAt ?? 0) <= n - T.legendary) r = 4;
  // A weapon whose order opened its early Legendary (C3, ruling 18 P1; RunConfig.legendaryEarly, a
  // list of weapon ids): its first Legendary comes at its legendaryFrom-th upgrade, not its
  // legendary-th. (The run's config decides it, so replays and the hash follow it.)
  if (n === (T.legendaryFrom ?? 0) && (slot.legAt ?? 0) === 0 && Array.isArray(world.config?.legendaryEarly) && world.config.legendaryEarly.includes(slot.def.id)) r = 4;
  if (opts && opts.min !== undefined) r = Math.max(r, opts.min);
  const has = (k) => skip !== null && skip.has(k);
  // Legendary: one of its specials, while it has one left.
  if (r === 4 && !(opts && opts.noSpecial)) {
    const sp = specialsOpen(world, slot).filter((x) => !has(`special:${x.id}`));
    if (sp.length) {
      const x = sp[rng.int(sp.length)];
      const u = { up: 'special', rarity: RARITY_IDS[4], value: 0, special: x.id, milestone };
      u.worth = cardWorth(world, slot, u);
      return u;
    }
  }
  // Rare and Epic: one of its behavior lines at that rarity, while it has one left.
  if (r === 2 || r === 3) {
    const ln = linesOpen(world, slot, r).filter((x) => !has(`line:${x.id}`));
    if (ln.length) {
      const x = ln[rng.int(ln.length)];
      const u = { up: 'line', rarity: RARITY_IDS[r], value: 0, line: x.id, milestone };
      u.worth = cardWorth(world, slot, u);
      return u;
    }
  }
  // A number at this rarity: the types open at it and worth the floor.
  const open = upsOpen(world, slot).filter((t) => !has(t.id));
  if (!open.length) return null;
  const pick = (rr) => open.filter((t) => t.min <= rr && cardWorth(world, slot, { up: t.id, value: upValue(world, t, rr, slot) }) >= T.floor - EPS);
  let can = pick(r);
  // Nothing at this roll (a second card with damage showing, Uncommon types only): the roll rises to
  // the lowest rarity something is open at; failing that, damage, which never leaves.
  for (let rr = r + 1; !can.length && rr <= 4; rr++) { can = pick(rr); if (can.length) r = rr; }
  if (!can.length) { can = open.filter((t) => t.id === 'damage'); if (!can.length) can = [open[0]]; r = Math.max(r, can[0].min); }
  const t = can[rng.weighted(can.map((x) => T.weight[x.id] ?? 1))];
  const value = upValue(world, t, r, slot);
  const u = { up: t.id, rarity: RARITY_IDS[r], value, stat: t.stat, milestone };
  if (t.id === 'damage' && T.damageDecay) { let n = 0; for (const x of slot.ups) if (x.up === 'damage') n++; if (n > 0) u.shrink = n; }   // (W9: the card says it is smaller)
  if (slot.stats) { const na = nowAfter(world, slot, t, value); u.now = na[0]; u.after = na[1]; }
  u.worth = cardWorth(world, slot, u);
  return u;
}

/** Note that a Legendary was offered to the weapon in slot s at its next upgrade (the every-10th guarantee counts from it). */
export function noteLegendaryOffered(world, s) {
  const slot = world.slots[s];
  if (slot) slot.legAt = slot.ups.length + 1;
}

/** Take an upgrade on the weapon in slot s (the caller rebuilds stats: markStatsDirty). */
export function takeUpgrade(world, s, u) {
  const slot = world.slots[s];
  const id = RETIRED_UPS[u.up] ?? u.up;
  const t = UP_TYPES.get(id);
  if (!t) throw new Error(`weapon upgrade: unknown type "${u.up}"`);
  let rec, kind = 0;
  if (t === LINE) {
    const l = (slot.def.lines || []).find((x) => x.id === u.line);
    if (!l) throw new Error(`weapon upgrade: ${slot.def.id} has no line "${u.line}"`);
    if (slot.lines.includes(l.id)) throw new Error(`weapon upgrade: ${slot.def.id} already holds "${u.line}"`);
    slot.lines = [...slot.lines, l.id];
    rec = { up: 'line', rarity: u.rarity ?? l.rarity, value: 0, line: l.id };
    kind = 1;
  } else if (t === SPECIAL) {
    const x = (slot.def.specials || []).find((y) => y.id === u.special) ?? (u.special === undefined ? specialsOpen(world, slot)[0] : undefined);
    if (!x) throw new Error(`weapon upgrade: ${slot.def.id} has no special "${u.special}"`);
    if (slot.specials.includes(x.id)) throw new Error(`weapon upgrade: ${slot.def.id} already holds "${x.id}"`);
    slot.specials = [...slot.specials, x.id];
    rec = { up: 'special', rarity: 'legendary', value: 0, special: x.id };
    kind = 2;
    const p = world.player;
    world.events.push(EV.LEGENDARY, p.x, p.y, s, slot.def.specials.indexOf(x));
    world.result.specials.push({ weapon: slot.def.id, id: x.id, tick: world.tick });
  } else {
    if (!(slot.def.numbers || []).includes(id)) throw new Error(`weapon upgrade: ${slot.def.id} can't take "${u.up}"`);
    rec = { up: id, rarity: u.rarity, value: u.value };
  }
  slot.ups = [...slot.ups, rec];
  slot.level = 1 + slot.ups.length;
  const ri = RARITY_IDS.indexOf(rec.rarity);
  if (ri >= 0) world.result.upRolls[ri]++;
  if (ri === 4) slot.legAt = slot.ups.length;
  world.result.weaponUps++;
  world.result.noteWeaponLevel(slot.def.id, slot.level);
  const p = world.player;
  world.events.push(EV.UPGRADE, p.x, p.y, s, Math.max(0, ri), kind);
}

/** A named number for the weapon in slot s at a rarity (an id), without a roll: { up, rarity, value }. */
export function numberAt(world, type, rarity) {
  const t = UP_TYPES.get(type);
  if (!t || !t.stat) throw new Error(`weapon upgrade: "${type}" is not a number type`);
  const r = Math.max(t.min, RARITY_IDS.indexOf(rarity));
  return { up: t.id, rarity: RARITY_IDS[r], value: upValue(world, t, r) };
}

/**
 * The score the bots and "Pick for me" give a weapon upgrade card: what it's worth to the weapon
 * (cardWorth; more for one that opens an axis) x the weapon's tag weight (1 + 0.5 for each other
 * weapon or passive carried that shares a tag with it).
 */
export function upgradeScore(world, card) {
  const slot = world.slots[card.slot] && world.slots[card.slot].def && world.slots[card.slot].def.id === card.id ? world.slots[card.slot] : world.slots.find((x) => x && x.def && x.def.id === card.id);
  const worth = card.worth ?? (slot ? cardWorth(world, slot, card) : 0.2);
  return (worth + (card.opens ? world.tuning.weaponUps.axisWorth : 0)) * tagWeight(world, card.id);
}

/** 1 + 0.5 for each other weapon or passive carried that shares a tag with weapon `id`. */
export function tagWeight(world, id) {
  const def = world.weaponDefs[world.weaponIndex.get(id)];
  const tags = (def && def.tags) || [];
  let n = 0;
  for (let s = 0; s < world.build.weaponSlots; s++) {
    const o = world.slots[s];
    if (o && o.def && o.def.id !== id && (o.def.tags || []).some((t) => tags.includes(t))) n++;
  }
  for (const ps of world.build.passives) if ((ps.def.tags || []).some((t) => tags.includes(t))) n++;
  return 1 + 0.5 * n;
}

/** The highest tag weight among the weapons carried (at least 1): the bots' measure for a weapon upgrade. */
export function bestTagWeight(world) {
  let best = 1;
  for (let s = 0; s < world.build.weaponSlots; s++) {
    const o = world.slots[s];
    if (o && o.def && !o.def.innate) best = Math.max(best, tagWeight(world, o.def.id));
  }
  return best;
}
