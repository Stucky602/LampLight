// What the Phase 7 buildings sell (ARCHITECTURE §10.6). Pure; tested in Node. Each action has a
// `whyNot...` twin with the reason it can't happen (the panels show it), and returns
// { doc, changes } as meta/actions.js's do: a new document and what changed.
//
//   Smithy        make gear, raise its tier, re-roll an affix (choosing one of three), wear it,
//   Market        trade materials at its (poor) rate, a few rares between two runs
//   Apothecary    buy run tools for a run
//   Tavern        starting kits (the skill trees are meta/skills.js)
//
// Nothing here is random in the way a drop is: what a new item rolls and what a re-roll offers come
// from a seed made of the item and the profile's own counters, so the same profile always sees the
// same offer (reloading doesn't reroll it).

import { canPay, pay, scale } from './costs.js';
import { MetaError, writable, partOf, needText, needsLevel, newlyUnlocked } from './actions.js';
import { levelOf, levelEffect, resolveContent, masteryOf, heldOf, contentOpen } from './state.js';
import { createRng } from '../lib/rng.js';
import { GEAR_SLOTS, TIER_MUL, THIRD_AFFIX_TIER, REROLL_COST, GEAR_TIER_EXTRA } from '../data/gear.js';

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
/** "Need 5 Salt Glass", and where a short material drops when that map isn't open yet (meta/actions.js needText). */
const need = (data, doc, cost) => needText(doc, data, cost);
const nameOf = (list, id) => list.find((x) => x.id === id)?.name ?? id;

// ---------------------------------------------------------------- gear

/** The gear slots open now (the Smithy's level), in order. */
export function gearSlotsOpen(doc, data) {
  return GEAR_SLOTS.slice(0, levelEffect(doc, data, 'smithy', 'gearSlots'));
}

/** The highest tier gear can be raised to now (0: the Smithy is a ruin). */
export function gearTierMax(doc, data) { return levelEffect(doc, data, 'smithy', 'gearTier'); }

/** The items held: [{ uid, id, tier, affixes }] (a loaded profile is reconciled; this reads a hand-built one safely). */
export function gearItems(doc) {
  const inv = doc?.profile?.gear?.inventory;
  return Array.isArray(inv) ? inv.filter((x) => isObj(x) && typeof x.id === 'string' && Array.isArray(x.affixes)) : [];
}

/**
 * The inventory as a writer keeps it: every entry, copied, the ones gearItems can't read (a
 * hand-built profile's) left as they were, so a purchase never drops what it doesn't understand.
 */
function inventoryCopy(doc) {
  const inv = doc?.profile?.gear?.inventory;
  return Array.isArray(inv) ? inv.map((x) => (isObj(x) ? { ...x, ...(Array.isArray(x.affixes) ? { affixes: [...x.affixes] } : {}) } : x)) : [];
}

/** What's worn: { slot: uid }. */
export function gearEquipped(doc) {
  const eq = doc?.profile?.gear?.equipped;
  return isObj(eq) ? eq : {};
}

const nextUid = (doc) => Math.max(1, Number.isInteger(doc?.profile?.gear?.next) ? doc.profile.gear.next : 1, ...gearItems(doc).map((x) => (x.uid | 0) + 1));
const rolls = (doc) => (Number.isInteger(doc?.profile?.gear?.rolls) ? doc.profile.gear.rolls : 0);
const itemRolls = (item) => (Number.isInteger(item.rolls) && item.rolls > 0 ? item.rolls : 0);

const tierMul = (tier) => TIER_MUL[Math.min(TIER_MUL.length, Math.max(1, tier)) - 1];

/** An affix's value on an item of this tier: a stat's grows with it, a build affix's doesn't (a hook or a rule has none). */
export function affixValue(affix, tier) {
  if (affix.kind === 'stat') return affix.value * tierMul(tier);
  return affix.kind === 'build' ? affix.value : 0;
}

/** "+6% Damage", "+1 Projectile (Fire)", "-3% Cooldown", or a rule's own words, for an affix at a tier. */
export function affixText(affix, tier) {
  if (affix.kind === 'hook' || affix.kind === 'rule') return affix.name;
  const v = affixValue(affix, tier), m = affix.mod;
  const pct = m.op === 'pct' || affix.percent === true;   // (`percent`: a share that adds, such as Crit Chance)
  const n = pct ? Math.round(v * 1000) / 10 : Math.round(v * 10) / 10;
  return `${n >= 0 ? '+' : ''}${n}${pct ? '%' : ''} ${affix.name}`;
}

/**
 * Draw `n` affixes from a recipe's pool, none of `taken`, with the seed: the pool is shuffled by
 * the seed alone and the first `n` not taken are drawn, so what's taken only ever drops one out
 * (the rest of a draw stays put).
 */
function drawAffixes(data, recipe, taken, n, seed) {
  const rng = createRng(seed);
  const pool = recipe.pool.filter((id) => id !== recipe.base && data.affixes.some((a) => a.id === id));
  for (let i = pool.length - 1; i > 0; i--) { const j = rng.int(i + 1); const t = pool[i]; pool[i] = pool[j]; pool[j] = t; }
  return pool.filter((id) => !taken.includes(id)).slice(0, n);
}

export function whyNotCraft(doc, data, recipeId) {
  const r = data.recipes.find((x) => x.id === recipeId);
  if (!r) return `There is no gear called "${recipeId}".`;
  if (levelOf(doc, 'smithy', data) === 0) return needsLevel(data, 'smithy', 1);
  if (!resolveContent(doc, data).recipes.includes(recipeId)) return 'Not found yet';
  if (!canPay(partOf(doc, 'materials'), r.cost)) return need(data, doc, r.cost);
  return null;
}

/** Make a tier 1 item: its recipe's affix and one more. Worn at once if its slot is open and empty. */
export function craftGear(doc, data, recipeId) {
  const why = whyNotCraft(doc, data, recipeId);
  if (why) throw new MetaError(why);
  const r = data.recipes.find((x) => x.id === recipeId);
  const out = writable(doc, ['materials', 'gear']);
  out.profile.materials = pay(out.profile.materials, r.cost);
  const G = out.profile.gear;
  G.inventory = inventoryCopy(doc);
  G.equipped = { ...gearEquipped(doc) };
  const uid = nextUid(doc);
  const item = { uid, id: r.id, tier: 1, affixes: [r.base, ...drawAffixes(data, r, [r.base], 1, `craft:${uid}`)] };
  G.inventory.push(item);
  G.next = uid + 1;
  const worn = gearSlotsOpen(doc, data).includes(r.slot) && !G.equipped[r.slot];
  if (worn) G.equipped[r.slot] = uid;
  return { doc: out, changes: [{ kind: 'gear_made', uid, id: r.id, cost: r.cost, worn }] };
}

/** What raising an item one tier costs: its recipe's price times the new tier, and tiers 4 and 5's Salt Glass (0.8.0). */
export function upgradeCost(data, item) {
  const r = data.recipes.find((x) => x.id === item.id);
  if (!r) return null;
  const cost = { ...scale(r.cost, item.tier + 1) };
  for (const [id, n] of Object.entries(GEAR_TIER_EXTRA[item.tier + 1] || {})) cost[id] = (cost[id] ?? 0) + n;
  return cost;
}

export function whyNotUpgradeGear(doc, data, uid) {
  const item = gearItems(doc).find((x) => x.uid === uid);
  if (!item) return 'No such item';
  if (item.tier >= TIER_MUL.length) return 'Already Legendary';
  const max = gearTierMax(doc, data);
  if (item.tier >= max) {
    const b = data.buildings.find((x) => x.id === 'smithy');
    const lv = b ? b.levels.findIndex((l) => (l.gearTier ?? 0) > item.tier) + 1 : 0;
    return lv > 0 ? needsLevel(data, 'smithy', lv) : 'Not in this version';
  }
  const cost = upgradeCost(data, item);
  if (!cost) return 'Not in this version';
  if (!canPay(partOf(doc, 'materials'), cost)) return need(data, doc, cost);
  return null;
}

/** Raise an item one tier (its affixes grow with it); at tier 3 it gains a third affix. */
export function upgradeGear(doc, data, uid) {
  const why = whyNotUpgradeGear(doc, data, uid);
  if (why) throw new MetaError(why);
  const out = writable(doc, ['materials', 'gear']);
  out.profile.gear.inventory = inventoryCopy(doc);
  const item = out.profile.gear.inventory.find((x) => x.uid === uid);
  const cost = upgradeCost(data, item);
  out.profile.materials = pay(out.profile.materials, cost);
  item.tier++;
  if (item.tier >= THIRD_AFFIX_TIER && item.affixes.length < 3) {
    const r = data.recipes.find((x) => x.id === item.id);
    item.affixes.push(...drawAffixes(data, r, item.affixes, 1, `third:${uid}`));
  }
  return { doc: out, changes: [{ kind: 'gear_tier', uid, id: item.id, tier: item.tier, cost }] };
}

/** What re-rolling one of an item's affixes costs (times its tier). */
export function rerollCost(item) { return scale(REROLL_COST, item.tier); }

/**
 * The three affixes a re-roll of affix `at` (not the recipe's own, the first) would offer now:
 * the same until one is taken (each item counts its own re-rolls, so another item's never moves
 * it; an affix the item gains at tier 3 drops out of it, and the next in line takes its place).
 */
export function rerollOffer(doc, data, uid, at) {
  const item = gearItems(doc).find((x) => x.uid === uid);
  const r = item && data.recipes.find((x) => x.id === item.id);
  if (!r || !(at >= 1 && at < item.affixes.length)) return [];
  return drawAffixes(data, r, item.affixes, 3, `reroll:${uid}:${at}:${itemRolls(item)}`);
}

export function whyNotReroll(doc, data, uid, at) {
  const item = gearItems(doc).find((x) => x.uid === uid);
  if (!item) return 'No such item';
  if (!levelEffect(doc, data, 'smithy', 'reroll')) {
    const b = data.buildings.find((x) => x.id === 'smithy');
    return needsLevel(data, 'smithy', b.levels.findIndex((l) => l.reroll) + 1);
  }
  if (!(at >= 1 && at < item.affixes.length)) return at === 0 ? "This bonus comes with the pattern and can't change" : 'That bonus isn\'t on this piece';
  if (!rerollOffer(doc, data, uid, at).length) return 'Nothing to reroll into';
  if (!canPay(partOf(doc, 'materials'), rerollCost(item))) return need(data, doc, rerollCost(item));
  return null;
}

/** Re-roll affix `at` of an item into `choice` (one of rerollOffer's three). */
export function rerollGear(doc, data, uid, at, choice) {
  const why = whyNotReroll(doc, data, uid, at);
  if (why) throw new MetaError(why);
  if (!rerollOffer(doc, data, uid, at).includes(choice)) throw new MetaError('Pick one of the 3 offered bonuses');
  const out = writable(doc, ['materials', 'gear']);
  out.profile.gear.inventory = inventoryCopy(doc);
  const item = out.profile.gear.inventory.find((x) => x.uid === uid);
  const cost = rerollCost(item);
  out.profile.materials = pay(out.profile.materials, cost);
  const was = item.affixes[at];
  item.affixes[at] = choice;
  item.rolls = itemRolls(item) + 1;         // this item's next re-roll offers afresh
  out.profile.gear.rolls = rolls(doc) + 1;  // (and every re-roll made, for the record)
  return { doc: out, changes: [{ kind: 'gear_reroll', uid, id: item.id, was, now: choice, cost }] };
}

export function whyNotEquip(doc, data, uid) {
  const item = gearItems(doc).find((x) => x.uid === uid);
  if (!item) return 'No such item';
  const r = data.recipes.find((x) => x.id === item.id);
  if (!r) return 'Not in this version';
  if (!gearSlotsOpen(doc, data).includes(r.slot)) {
    const b = data.buildings.find((x) => x.id === 'smithy');
    const lv = b.levels.findIndex((l) => (l.gearSlots ?? 0) > GEAR_SLOTS.indexOf(r.slot)) + 1;
    return needsLevel(data, 'smithy', lv);
  }
  if (gearEquipped(doc)[r.slot] === uid) return 'Already worn';
  return null;
}

/** Wear an item in its slot (taking off what was there). */
export function equipGear(doc, data, uid) {
  const why = whyNotEquip(doc, data, uid);
  if (why) throw new MetaError(why);
  const item = gearItems(doc).find((x) => x.uid === uid);
  const slot = data.recipes.find((x) => x.id === item.id).slot;
  const out = writable(doc, ['gear']);
  out.profile.gear.equipped = { ...gearEquipped(doc), [slot]: uid };
  return { doc: out, changes: [{ kind: 'gear_worn', uid, slot }] };
}

/** Take off what's in a slot. */
export function unequipGear(doc, data, slot) {
  if (!gearEquipped(doc)[slot]) throw new MetaError('Nothing worn there');
  const out = writable(doc, ['gear']);
  const eq = { ...gearEquipped(doc) };
  delete eq[slot];
  out.profile.gear.equipped = eq;
  return { doc: out, changes: [{ kind: 'gear_off', slot }] };
}

/**
 * What worn gear adds to a run: stat modifiers (stat and build affixes), the RunConfig numbers its
 * rule affixes add, and the hooks its hook affixes run, as { hook, params } with the grown params
 * at the item's tier. A rule or a hook counts once however many items carry it (a hook at the
 * highest tier it's worn at). Slots the Smithy hasn't opened don't count.
 */
export function gearForRun(doc, data) {
  const mods = [], config = {};
  const open = gearSlotsOpen(doc, data), eq = gearEquipped(doc), items = gearItems(doc);
  const rules = new Set(), hookTier = new Map();
  for (const slot of open) {
    const it = items.find((x) => x.uid === eq[slot]);
    if (!it) continue;
    for (const id of it.affixes) {
      const a = data.affixes.find((x) => x.id === id);
      if (!a) continue; // an affix this build doesn't know: ignored, kept on the item
      if (a.kind === 'rule') rules.add(a.id);
      else if (a.kind === 'hook') hookTier.set(a.id, Math.max(hookTier.get(a.id) ?? 0, it.tier));
      else mods.push({ ...a.mod, value: affixValue(a, it.tier) });
    }
  }
  for (const id of rules) for (const [k, v] of Object.entries(data.affixes.find((x) => x.id === id).config)) config[k] = (config[k] ?? 0) + v;
  // In the affixes' order, so the same gear always adds its hooks the same way.
  const hooks = data.affixes.filter((a) => hookTier.has(a.id)).map((a) => {
    const params = { ...a.params };
    for (const k of a.grow || []) params[k] = a.params[k] * tierMul(hookTier.get(a.id));
    return { hook: a.hook, params, affix: a.id };
  });
  return { mods, config, hooks };
}

// ---------------------------------------------------------------- the Market

/** The Market's rates now, or null (a ruin). */
export function marketRates(doc, data) {
  const lv = levelEffect(doc, data, 'market', 'market');
  return lv > 0 ? data.market.rates[lv] : null;
}

const marketTier = (data, id) => (data.market.common.includes(id) ? 'common' : data.market.rare.includes(id) ? 'rare' : null);

/**
 * One trade of `give` for `get` at the Market's rates: { give: n, get: m } (n of `give` for m of
 * `get`), or null when the two don't trade (the same material, or one the Market doesn't deal in).
 */
export function tradeTerms(doc, data, give, get) {
  const rates = marketRates(doc, data);
  if (!rates || give === get) return null;
  const a = marketTier(data, give), b = marketTier(data, get);
  if (!a || !b) return null;
  if (a === 'common' && b === 'common') return { give: rates.common, get: 1 };
  if (a === 'common' && b === 'rare') return { give: rates.toRare, get: 1 };
  if (a === 'rare' && b === 'common') return { give: 1, get: rates.fromRare };
  return { give: rates.common, get: 1 }; // rare for rare
}

/** How many rare materials the Market sells between two runs: META's, plus what the Lighthouse adds (its stage 7). */
export function raresCap(doc, data) {
  const base = data.meta.marketRaresPerRun;
  return Number.isFinite(base) ? base + levelEffect(doc, data, 'lighthouse', 'marketRaresAdd') : Infinity;
}

/** "Iron or Map Scraps": the Market's rare materials by name (no word of their own: "Rare" is a rarity). */
const rareNames = (data, and = 'or') => { const n = data.market.rare.map((id) => nameOf(data.materials, id)); return n.length < 3 ? n.join(` ${and} `) : `${n.slice(0, -1).join(', ')}, ${and} ${n.at(-1)}`; };

/**
 * Rare materials the Market still sells before the next run (0.7.3: META.marketRaresPerRun
 * between two runs, so trading never stands in for the elites that drop them). The count bought
 * is kept with the run it was bought after (profile.market: { rares, run }).
 */
export function raresLeft(doc, data) {
  const cap = raresCap(doc, data);
  const M = doc?.profile?.market;
  const runs = Number(doc?.stats?.runs) || 0;
  const bought = isObj(M) && M.run === runs && Number.isInteger(M.rares) && M.rares > 0 ? M.rares : 0;
  return Math.max(0, cap - bought);
}

/** The materials one row could be paid with, in the Market's order (commons, then rares). */
export function payOptions(doc, data, get) {
  return [...data.market.common, ...data.market.rare].filter((give) => tradeTerms(doc, data, give, get));
}

export function whyNotTrade(doc, data, give, get, times = 1) {
  if (!marketRates(doc, data)) return needsLevel(data, 'market', 1);
  const t = tradeTerms(doc, data, give, get);
  if (!t) return `The ${data.buildings.find((x) => x.id === 'market')?.name ?? 'Market'} doesn't trade those`;
  if (!(Number.isInteger(times) && times >= 1)) return 'Trade a whole number of times';
  if (marketTier(data, get) === 'rare') {
    const left = raresLeft(doc, data);
    if (left <= 0) return `No more ${rareNames(data)} until after your next run`;
    if (t.get * times > left) return `Only ${left} more ${rareNames(data)} until after your next run`;
  }
  const cost = { [give]: t.give * times };
  if (!canPay(partOf(doc, 'materials'), cost)) return need(data, doc, cost);
  return null;
}

/** Trade `times` times: `give` for `get` at the Market's terms (a rare counts against the cap). */
export function marketTrade(doc, data, give, get, times = 1) {
  const why = whyNotTrade(doc, data, give, get, times);
  if (why) throw new MetaError(why);
  const t = tradeTerms(doc, data, give, get);
  const out = writable(doc, ['materials']);
  out.profile.materials = pay(out.profile.materials, { [give]: t.give * times });
  out.profile.materials[get] = (out.profile.materials[get] | 0) + t.get * times;
  if (marketTier(data, get) === 'rare') {
    const runs = Number(doc?.stats?.runs) || 0;
    const cap = raresCap(doc, data);
    out.profile.market = { run: runs, rares: (Number.isFinite(cap) ? cap : 0) - raresLeft(doc, data) + t.get * times };
  }
  return { doc: out, changes: [{ kind: 'trade', give, gave: t.give * times, get, got: t.get * times }] };
}

// ---------------------------------------------------------------- the Apothecary

/** How many run tools can go into a run (the Apothecary's level, and the Lighthouse's stage 4). */
export function consumableSlots(doc, data) {
  const own = levelEffect(doc, data, 'apothecary', 'consumableSlots');
  return own > 0 ? own + levelEffect(doc, data, 'lighthouse', 'consumableSlotsAdd') : 0;   // the Lighthouse's stage 4 (0.9.0), once the Apothecary sells any
}

export function whyNotBuyConsumable(doc, data, id) {
  const c = data.consumables.find((x) => x.id === id);
  if (!c) return `There is nothing called "${id}".`;
  if (levelOf(doc, 'apothecary', data) === 0) return needsLevel(data, 'apothecary', 1);
  if (!resolveContent(doc, data).consumables.includes(id)) return 'Not found yet';
  if (!canPay(partOf(doc, 'materials'), c.cost)) return need(data, doc, c.cost);
  return null;
}

export function buyConsumable(doc, data, id) {
  const why = whyNotBuyConsumable(doc, data, id);
  if (why) throw new MetaError(why);
  const c = data.consumables.find((x) => x.id === id);
  const out = writable(doc, ['materials', 'consumables']);
  out.profile.materials = pay(out.profile.materials, c.cost);
  out.profile.consumables[id] = heldOf(doc, id) + 1;
  return { doc: out, changes: [{ kind: 'consumable', id, cost: c.cost, held: heldOf(doc, id) + 1 }] };
}

// ---------------------------------------------------------------- trophies

/**
 * The damage bonus a run gets against each enemy whose trophy is open (its Hunt done; data/trophies.js):
 * { enemyId: share more damage }. (RunConfig keeps the name bestiaryBonus.)
 */
export function bestiaryBonus(doc, data) {
  const out = {};
  for (const t of data.trophies || []) if (contentOpen(doc, data, t.unlock)) out[t.enemy] = t.damageMul;
  return out;
}

// ---------------------------------------------------------------- the Tavern's kits (skills: meta/skills.js)

/**
 * A character's kits: their own first, then the others, each open once its mastery rank (`rank`)
 * and its own `unlock` (an order, 0.9.0), when it has them, are met. [{ id, name, start, open, rank, unlock }]
 */
export function kitsOf(doc, data, character) {
  const c = data.characters.find((x) => x.id === character);
  if (!c) return [];
  const rank = masteryOf(doc, data, character).rank;
  return [
    { id: '', name: 'Standard', start: c.start, open: true },
    // A character's own kits, then the ones anyone can take (a weapon order's), once each weapon (never their own first).
    ...data.kits.filter((k) => k.character === character || (k.character === '*' && k.start !== c.start && !data.kits.some((o) => o.character === character && o.start === k.start))).map((k) => ({
      id: k.id, name: k.name, start: k.start, rank: k.rank, unlock: k.unlock,
      // Their own kit opens at its rank, or sooner with that weapon's order (the order's kit says
      // "any character", and their own kit of the same weapon stands in for it; the sweep, A7).
      open: ((k.rank === undefined || rank >= k.rank) && (k.unlock === undefined || contentOpen(doc, data, k.unlock)))
        || (k.character === character && data.kits.some((o) => o.character === '*' && o.start === k.start && o.unlock !== undefined && contentOpen(doc, data, o.unlock))),
    })),
  ];
}
