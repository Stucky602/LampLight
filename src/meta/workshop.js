// What the Phase 7 buildings sell (ARCHITECTURE §10.6). Pure; tested in Node. Each action has a
// `whyNot...` twin with the reason it can't happen (the panels show it), and returns
// { doc, changes } as meta/actions.js's do: a new document and what changed.
//
//   Smithy        make gear, raise its tier, re-roll an affix (choosing one of three), wear it,
//                 cut a rune stone
//   Market        trade materials at its (poor) rate
//   Apothecary    buy consumables for a run
//   Cartographer  claim bestiary milestones
//   Tavern        train a mastery perk
//
// Nothing here is random in the way a drop is: what a new item rolls and what a re-roll offers come
// from a seed made of the item and the profile's own counters, so the same profile always sees the
// same offer (reloading doesn't reroll it).

import { canPay, pay, scale } from './costs.js';
import { MetaError, writable, partOf, shortText } from './actions.js';
import { levelOf, levelEffect, resolveContent, masteryOf, perksOf, heldOf } from './state.js';
import { createRng } from '../lib/rng.js';
import { GEAR_SLOTS, TIER_MUL, THIRD_AFFIX_TIER, RUNE_STONE_COST, REROLL_COST } from '../data/gear.js';

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const need = (data, doc, cost) => `Need ${shortText(data, partOf(doc, 'materials'), cost)}`;
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
  const pct = m.op === 'pct';
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
  if (levelOf(doc, 'smithy', data) === 0) return 'Requires Smithy Lv 1';
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

/** What raising an item one tier costs: its recipe's price times the new tier. */
export function upgradeCost(data, item) {
  const r = data.recipes.find((x) => x.id === item.id);
  return r ? scale(r.cost, item.tier + 1) : null;
}

export function whyNotUpgradeGear(doc, data, uid) {
  const item = gearItems(doc).find((x) => x.uid === uid);
  if (!item) return 'No such item';
  if (item.tier >= TIER_MUL.length) return 'Already at max tier';
  const max = gearTierMax(doc, data);
  if (item.tier >= max) {
    const b = data.buildings.find((x) => x.id === 'smithy');
    const lv = b ? b.levels.findIndex((l) => (l.gearTier ?? 0) > item.tier) + 1 : 0;
    return lv > 0 ? `Requires Smithy Lv ${lv}` : 'Not in this version';
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
    return `Requires Smithy Lv ${b.levels.findIndex((l) => l.reroll) + 1}`;
  }
  if (!(at >= 1 && at < item.affixes.length)) return at === 0 ? "The recipe's own affix stays" : 'No such affix';
  if (!rerollOffer(doc, data, uid, at).length) return 'Nothing to re-roll into';
  if (!canPay(partOf(doc, 'materials'), rerollCost(item))) return need(data, doc, rerollCost(item));
  return null;
}

/** Re-roll affix `at` of an item into `choice` (one of rerollOffer's three). */
export function rerollGear(doc, data, uid, at, choice) {
  const why = whyNotReroll(doc, data, uid, at);
  if (why) throw new MetaError(why);
  if (!rerollOffer(doc, data, uid, at).includes(choice)) throw new MetaError('Not one of the offered affixes');
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
    return `Requires Smithy Lv ${lv}`;
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

// ---------------------------------------------------------------- rune stones

export function whyNotCutRune(doc, data, runeId) {
  const r = data.runes.find((x) => x.id === runeId);
  if (!r) return `There is no rune called "${runeId}".`;
  if (!levelEffect(doc, data, 'smithy', 'runeCrafting')) {
    const b = data.buildings.find((x) => x.id === 'smithy');
    return `Requires Smithy Lv ${b.levels.findIndex((l) => l.runeCrafting) + 1}`;
  }
  if (!resolveContent(doc, data).runes.includes(runeId)) return 'Not found yet';
  if (!canPay(partOf(doc, 'materials'), RUNE_STONE_COST)) return need(data, doc, RUNE_STONE_COST);
  return null;
}

/** Cut a rune stone: one run's rune, placed in a weapon at 0:00. */
export function cutRuneStone(doc, data, runeId) {
  const why = whyNotCutRune(doc, data, runeId);
  if (why) throw new MetaError(why);
  const out = writable(doc, ['materials', 'consumables']);
  out.profile.materials = pay(out.profile.materials, RUNE_STONE_COST);
  const key = `rune:${runeId}`;
  out.profile.consumables[key] = heldOf(doc, key) + 1;
  return { doc: out, changes: [{ kind: 'rune_stone', id: runeId, cost: RUNE_STONE_COST }] };
}

// ---------------------------------------------------------------- the Market

/** The Market's rates now, or null (a ruin). */
export function marketRates(doc, data) {
  const lv = levelEffect(doc, data, 'market', 'market');
  return lv > 0 ? data.market.rates[lv] : null;
}

/**
 * One trade of `give` for `get` at the Market's rates: { give: n, get: m } (n of `give` for m of
 * `get`), or null when the two don't trade (the same material, or one the Market doesn't deal in).
 */
export function tradeTerms(doc, data, give, get) {
  const rates = marketRates(doc, data), M = data.market;
  if (!rates || give === get) return null;
  const tier = (id) => (M.common.includes(id) ? 'common' : M.rare.includes(id) ? 'rare' : null);
  const a = tier(give), b = tier(get);
  if (!a || !b) return null;
  if (a === 'common' && b === 'common') return { give: rates.common, get: 1 };
  if (a === 'common' && b === 'rare') return { give: rates.toRare, get: 1 };
  if (a === 'rare' && b === 'common') return { give: 1, get: rates.fromRare };
  return { give: rates.common, get: 1 }; // rare for rare
}

export function whyNotTrade(doc, data, give, get) {
  if (!marketRates(doc, data)) return 'Requires Market Lv 1';
  const t = tradeTerms(doc, data, give, get);
  if (!t) return 'Market doesn\'t trade those';
  if (!canPay(partOf(doc, 'materials'), { [give]: t.give })) return need(data, doc, { [give]: t.give });
  return null;
}

/** Trade once: `give` for `get` at the Market's terms. */
export function marketTrade(doc, data, give, get) {
  const why = whyNotTrade(doc, data, give, get);
  if (why) throw new MetaError(why);
  const t = tradeTerms(doc, data, give, get);
  const out = writable(doc, ['materials']);
  out.profile.materials = pay(out.profile.materials, { [give]: t.give });
  out.profile.materials[get] = (out.profile.materials[get] | 0) + t.get;
  return { doc: out, changes: [{ kind: 'trade', give, gave: t.give, get, got: t.get }] };
}

// ---------------------------------------------------------------- the Apothecary

/** How many consumables can go into a run (the Apothecary's level). */
export function consumableSlots(doc, data) { return levelEffect(doc, data, 'apothecary', 'consumableSlots'); }

export function whyNotBuyConsumable(doc, data, id) {
  const c = data.consumables.find((x) => x.id === id);
  if (!c) return `There is nothing called "${id}".`;
  if (levelOf(doc, 'apothecary', data) === 0) return 'Requires Apothecary Lv 1';
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

// ---------------------------------------------------------------- the Cartographer's bestiary

/** Milestones claimed for an enemy (0 to the number of milestones). */
export function claimedOf(doc, data, enemyId) {
  const c = doc?.profile?.bestiaryClaimed;
  const n = isObj(c) && Number.isInteger(c[enemyId]) ? c[enemyId] : 0;
  return Math.max(0, Math.min(data.meta.bestiaryMilestones.length, n));
}

/** Each enemy's bestiary line: kills, milestones claimed, and the next one (null when all are). */
export function bestiaryRows(doc, data) {
  const kills = isObj(doc?.profile?.bestiary) ? doc.profile.bestiary : {};
  const ms = data.meta.bestiaryMilestones;
  return data.enemies.filter((e) => !(e.tags || []).includes('boss')).map((e) => {
    const k = Number.isFinite(kills[e.id]) ? Math.floor(kills[e.id]) : 0;
    const claimed = claimedOf(doc, data, e.id);
    const next = claimed < ms.length ? { kills: ms[claimed], reward: data.meta.bestiaryRewards[claimed], ready: k >= ms[claimed] } : null;
    return { id: e.id, name: e.name, kills: k, claimed, next };
  });
}

export function whyNotClaim(doc, data, enemyId) {
  if (!levelEffect(doc, data, 'cartographer', 'bestiary')) {
    const b = data.buildings.find((x) => x.id === 'cartographer');
    return `Requires Cartographer Lv ${b.levels.findIndex((l) => l.bestiary) + 1}`;
  }
  const row = bestiaryRows(doc, data).find((r) => r.id === enemyId);
  if (!row) return 'Not in the bestiary';
  if (!row.next) return 'All claimed';
  if (!row.next.ready) return `Need ${row.next.kills} kills (${row.kills})`;
  return null;
}

/** Claim an enemy's next bestiary milestone: its materials (and, later on, its bonus). */
export function claimBestiary(doc, data, enemyId) {
  const why = whyNotClaim(doc, data, enemyId);
  if (why) throw new MetaError(why);
  const row = bestiaryRows(doc, data).find((r) => r.id === enemyId);
  const reward = row.next.reward;
  const out = writable(doc, ['materials', 'bestiaryClaimed']);
  for (const [id, n] of Object.entries(reward.materials || {})) out.profile.materials[id] = (out.profile.materials[id] | 0) + n;
  out.profile.bestiaryClaimed[enemyId] = row.claimed + 1;
  return { doc: out, changes: [{ kind: 'bestiary_claim', id: enemyId, kills: row.next.kills, materials: { ...(reward.materials || {}) }, damageMul: reward.damageMul ?? 0 }] };
}

/** The bestiary bonus a run gets: { enemyId: share more damage }, each held to META.bestiaryBonusMax. */
export function bestiaryBonus(doc, data) {
  const out = {};
  for (const e of data.enemies) {
    const n = claimedOf(doc, data, e.id);
    let v = 0;
    for (let k = 0; k < n; k++) v += data.meta.bestiaryRewards[k].damageMul ?? 0;
    if (v > 0) out[e.id] = Math.min(v, data.meta.bestiaryBonusMax);
  }
  return out;
}

// ---------------------------------------------------------------- the Tavern's training

export function whyNotTrain(doc, data, perkId) {
  const p = data.perks.find((x) => x.id === perkId);
  if (!p) return `There is no perk called "${perkId}".`;
  if (!levelEffect(doc, data, 'tavern', 'mastery')) {
    const b = data.buildings.find((x) => x.id === 'tavern');
    return `Requires Tavern Lv ${b.levels.findIndex((l) => l.mastery) + 1}`;
  }
  if (perksOf(doc, p.character).has(perkId)) return 'Already trained';
  if (!resolveContent(doc, data).characters.includes(p.character)) return `${nameOf(data.characters, p.character)} hasn't arrived yet`;
  if (masteryOf(doc, data, p.character).rank < p.rank) return `Requires mastery rank ${p.rank}`;
  if (!canPay(partOf(doc, 'materials'), p.cost)) return need(data, doc, p.cost);
  return null;
}

/** Train a perk: from now on, every run as that character has it. */
export function trainPerk(doc, data, perkId) {
  const why = whyNotTrain(doc, data, perkId);
  if (why) throw new MetaError(why);
  const p = data.perks.find((x) => x.id === perkId);
  const out = writable(doc, ['materials', 'characters']);
  out.profile.materials = pay(out.profile.materials, p.cost);
  const c = isObj(out.profile.characters[p.character]) ? { ...out.profile.characters[p.character] } : { unlocked: true, masteryXp: 0, perks: [] };
  c.perks = [...(Array.isArray(c.perks) ? c.perks : []), perkId];
  out.profile.characters[p.character] = c;
  return { doc: out, changes: [{ kind: 'perk', id: perkId, character: p.character, cost: p.cost }] };
}

/** A character's kits: their own first, then the other once mastery opens it. [{ id, name, start, open }] */
export function kitsOf(doc, data, character) {
  const c = data.characters.find((x) => x.id === character);
  if (!c) return [];
  const rank = masteryOf(doc, data, character).rank;
  return [
    { id: '', name: 'Standard', start: c.start, open: true },
    ...data.kits.filter((k) => k.character === character).map((k) => ({ id: k.id, name: k.name, start: k.start, open: rank >= k.rank, rank: k.rank })),
  ];
}
