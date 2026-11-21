// What the Phase 7 buildings sell and keep (ARCHITECTURE §10.6; src/meta/workshop.js, feats.js,
// apply.js's Phase 7 part, runconfig.js, and the gate's rows in src/app/setup.js). Pure: each
// test also checks the document passed in never changes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA } from '../src/data/index.js';
import { defaultProfile } from '../src/save/schema.js';
import * as W from '../src/meta/workshop.js';
import * as K from '../src/meta/skills.js';
import { featMet, judgeFeats, featShown } from '../src/meta/feats.js';
import { applyRunResult, runConfigFor, startRunProfile, reconcileProfile, MetaError, masteryOf, resolveContent } from '../src/meta/index.js';
import { modesOpen, harborForRun } from '../src/meta/runconfig.js';
import { purchaseOptions, nextAffordable } from '../src/meta/next.js';
import { startChoice, setupRows, applyRow, choiceForRun, rewardText, settleChoice, challengesOpen, setsOutAs, whyNotSetRun } from '../src/app/setup.js';
import { tideText } from '../src/ui/hubtext.js';
import { createWorld } from '../src/sim/world.js';
import { optionText } from '../src/ui/hubtext.js';
import { TIER_MUL, REROLL_COST, GEAR_SLOTS } from '../src/data/gear.js';
import { HUNT_COUNTS } from '../src/data/trophies.js';   // (X3)

const RICH = Object.fromEntries(DATA.materials.map((m) => [m.id, 99999]));
function make(levels = {}, mats = RICH, extra = {}) {
  const d = defaultProfile();
  Object.assign(d.profile.buildings, levels);
  d.profile.materials = { ...mats };
  d.profile.research.done = DATA.research.map((r) => r.id);
  Object.assign(d.profile, extra);
  return d;
}
const frozen = (doc) => JSON.stringify(doc);
const spent = (have, cost, times = 1) => { const o = { ...have }; for (const [k, n] of Object.entries(cost)) o[k] -= n * times; return o; };
function result(over = {}) {
  return {
    v: 1, seed: 1, map: 'drowned_docks', mode: 'standard', character: 'lamplighter', end: 'died', timeSurvived: 600, ticks: 36000,
    level: 20, kills: { fog_wisp: 100 }, totalKills: 100, elitesKilled: 0, bossesKilled: [], cleared: false,
    weapons: [], weaponLevelMax: {}, maxWeaponLevel: 1, passives: [], relics: [], runes: [], evolutions: [], tags: {},
    materials: {}, damageTaken: 0, dashKills: 0, revivalsUsed: 0, gems: 0, chests: 0, overtimeMinutes: 0, secretsFound: [],
    rerolls: 0, skips: 0, banished: [], seaGlass: 0, lampsLit: 0, bellsRung: 0, lanternNight: false, tide: 0, ...over,
  };
}

// ---------------------------------------------------------------- the Smithy

test('smithy: gear is made from what research opened, paid for, and worn at once when its slot is open and empty', () => {
  const r = DATA.recipes.find((x) => x.id === 'storm_lantern');
  assert.equal(W.whyNotCraft(make(), DATA, r.id), 'Restore the Smithy first');
  const none = make({ smithy: 1 }); none.profile.research.done = [];
  assert.equal(W.whyNotCraft(none, DATA, r.id), 'Not found yet');
  assert.match(W.whyNotCraft(make({ smithy: 1 }, {}), DATA, r.id), /^Need /);
  assert.match(W.whyNotCraft(make({ smithy: 1 }), DATA, 'nope'), /no gear called "nope"/);
  const d = make({ smithy: 1 });
  const snap = frozen(d);
  const out = W.craftGear(d, DATA, r.id);
  assert.equal(frozen(d), snap);
  const [item] = W.gearItems(out.doc);
  assert.deepEqual([item.uid, item.id, item.tier, item.affixes.length, item.affixes[0]], [1, r.id, 1, 2, r.base], 'its own affix first, and one more');
  assert.ok(r.pool.includes(item.affixes[1]));
  assert.deepEqual(W.gearEquipped(out.doc), { lantern: 1 });
  assert.deepEqual(out.doc.profile.materials, spent(RICH, r.cost));
  assert.deepEqual(out.changes, [{ kind: 'gear_made', uid: 1, id: r.id, cost: r.cost, worn: true }]);
  // The same profile makes the same item (nothing rerolls on a reload); a second goes to the bag.
  assert.deepEqual(W.craftGear(d, DATA, r.id).doc.profile.gear, out.doc.profile.gear);
  const two = W.craftGear(out.doc, DATA, r.id);
  assert.equal(two.changes[0].worn, false);
  assert.deepEqual(W.gearEquipped(two.doc), { lantern: 1 });
  assert.equal(W.gearItems(two.doc)[1].uid, 2);
  // A ring before the Smithy opens its slot: made, not worn.
  const ring = W.craftGear(make({ smithy: 1 }), DATA, 'salt_ring');
  assert.equal(ring.changes[0].worn, false);
  assert.equal(W.whyNotEquip(ring.doc, DATA, 1), 'Needs the Smithy at Lv 3');
  // The slots by the Smithy's level: the brief's four, the 5th at level 3, the 6th at level 5.
  assert.deepEqual([1, 2, 3, 4, 5].map((lv) => W.gearSlotsOpen(make({ smithy: lv }), DATA).length), [4, 4, 5, 5, 6]);
  assert.deepEqual(W.gearSlotsOpen(make({ smithy: 5 }), DATA), GEAR_SLOTS);
});

test('smithy: a tier up costs the recipe times the new tier, waits on the Smithy, and brings a third affix at tier 3', () => {
  const r = DATA.recipes.find((x) => x.id === 'harbor_coat');
  let d = W.craftGear(make({ smithy: 1 }), DATA, r.id).doc;
  assert.equal(W.whyNotUpgradeGear(d, DATA, 1), 'Needs the Smithy at Lv 2', 'tier 1 only, at level 1');
  assert.equal(W.whyNotUpgradeGear(d, DATA, 9), 'No such item');
  d = make({ smithy: 5 }, d.profile.materials, { gear: d.profile.gear });
  const before = d.profile.materials;
  const up = W.upgradeGear(d, DATA, 1);
  assert.deepEqual(up.doc.profile.materials, spent(before, r.cost, 2));
  assert.equal(W.gearItems(up.doc)[0].tier, 2);
  assert.equal(W.gearItems(up.doc)[0].affixes.length, 2);
  const three = W.upgradeGear(up.doc, DATA, 1).doc;
  const it = W.gearItems(three)[0];
  assert.equal(it.tier, 3);
  assert.equal(it.affixes.length, 3, 'a third affix at tier 3');
  assert.equal(new Set(it.affixes).size, 3, 'none twice');
  let top = three;
  for (let k = 0; k < 2; k++) top = W.upgradeGear(top, DATA, 1).doc;
  assert.equal(W.whyNotUpgradeGear(top, DATA, 1), 'Already Legendary');
  assert.equal(W.gearItems(top)[0].affixes.length, 3, 'never a fourth');
  assert.match(W.whyNotUpgradeGear(make({ smithy: 5 }, {}, { gear: three.profile.gear }), DATA, 1), /^Need /);
});

test('smithy: a re-roll offers three, the same until one is taken, never the recipe\'s own; it costs by tier', () => {
  const base = W.craftGear(make({ smithy: 3 }), DATA, 'sea_boots').doc;
  assert.equal(W.whyNotReroll(W.craftGear(make({ smithy: 2 }), DATA, 'sea_boots').doc, DATA, 1, 1), 'Needs the Smithy at Lv 3');
  assert.equal(W.whyNotReroll(base, DATA, 1, 0), "This bonus comes with the pattern and can't change");
  assert.equal(W.whyNotReroll(base, DATA, 1, 4), 'That bonus isn\'t on this piece');
  assert.equal(W.whyNotReroll(base, DATA, 1, 1), null);
  const offer = W.rerollOffer(base, DATA, 1, 1);
  const item = W.gearItems(base)[0];
  assert.equal(offer.length, 3);
  assert.ok(offer.every((id) => !item.affixes.includes(id)), 'nothing already on it');
  assert.deepEqual(W.rerollOffer(base, DATA, 1, 1), offer, 'the same offer however often it\'s asked');
  assert.throws(() => W.rerollGear(base, DATA, 1, 1, item.affixes[1]), /Pick one of the 3 offered bonuses/);
  const snap = frozen(base);
  const out = W.rerollGear(base, DATA, 1, 1, offer[2]);
  assert.equal(frozen(base), snap);
  assert.equal(W.gearItems(out.doc)[0].affixes[1], offer[2]);
  assert.deepEqual(out.doc.profile.materials, spent(base.profile.materials, REROLL_COST));
  assert.deepEqual(out.changes[0], { kind: 'gear_reroll', uid: 1, id: 'sea_boots', was: item.affixes[1], now: offer[2], cost: W.rerollCost(item) });
  assert.equal(out.doc.profile.gear.rolls, 1);
  assert.notDeepEqual(W.rerollOffer(out.doc, DATA, 1, 1), W.rerollOffer(base, DATA, 1, 1), 'the next re-roll offers afresh');
  assert.deepEqual(W.rerollCost({ tier: 3 }), Object.fromEntries(Object.entries(REROLL_COST).map(([k, v]) => [k, v * 3])));
});

test('smithy: worn gear in a run: stats grow with the tier, a build affix doesn\'t, a rule counts once, a hook at its best tier', () => {
  const affix = (id) => DATA.affixes.find((a) => a.id === id);
  assert.equal(W.affixText(affix('might'), 1), '+2% Damage');
  assert.equal(W.affixText(affix('might'), 3), '+4% Damage');
  assert.equal(W.affixText(affix('haste'), 5), '-4.5% Cooldown');
  assert.equal(W.affixText(affix('vigor'), 2), '+7.5 Max HP');
  assert.equal(W.affixText(affix('fire_volley'), 1), '+1 Projectile (Fire)');
  assert.equal(W.affixText(affix('fire_volley'), 5), '+1 Projectile (Fire)', 'the same at every tier');
  assert.equal(W.affixText(affix('oil_wake'), 4), 'Walking leaves burning oil');
  const item = (uid, id, tier, affixes) => ({ uid, id, tier, affixes });
  const gear = {
    inventory: [
      item(1, 'storm_lantern', 3, ['fire_volley', 'might', 'oil_wake']),
      item(2, 'sea_boots', 1, ['oil_wake', 'vigor']),
      item(3, 'brass_compass', 2, ['kinship', 'fourth_card']),
      item(4, 'salt_ring', 1, ['fourth_card', 'kinship']),
      item(5, 'bell_pendant', 5, ['echo_reach', 'no_such_affix']),
    ],
    equipped: { lantern: 1, boots: 2, charm: 3, ring: 4, pendant: 5 },
    next: 6, rolls: 0,
  };
  const g = W.gearForRun(make({ smithy: 3 }, RICH, { gear }), DATA);
  assert.deepEqual(g.mods, [
    { stat: 'amount', op: 'add', tags: ['fire'], value: 1 },
    { stat: 'might', op: 'pct', value: 0.02 * TIER_MUL[2] },
    { stat: 'maxHp', op: 'add', value: 5 },
  ], 'the pendant\'s slot isn\'t open at Smithy level 3; an unknown affix is left on the item, ignored');
  assert.deepEqual(g.config, { evolutionPassiveReduction: 1, draftCards: 1 }, 'each rule once, however many carry it');
  const wake = affix('oil_wake');
  assert.deepEqual(g.hooks, [{ hook: 'walk_trail', affix: 'oil_wake', params: { ...wake.params, damage: wake.params.damage * TIER_MUL[2], dps: wake.params.dps * TIER_MUL[2] } }], 'once, at the best tier worn');
  // Into a run: the RunConfig, and a world that takes it.
  const doc = make({ smithy: 5, tavern: 1 }, RICH, { gear });
  const cfg = runConfigFor(doc, DATA, { character: 'lamplighter', seed: 1 });
  assert.equal(cfg.draftCards, DATA.tuning.draft.cards + 1);
  assert.equal(cfg.evolutionPassiveReduction, 1);
  assert.deepEqual(cfg.gearHooks.map((x) => x.hook), ['walk_trail']);
  assert.ok(cfg.mods.some((m) => m.stat === 'area' && m.tags?.[0] === 'echo'), 'the pendant, now its slot is open');
  const w = createWorld(cfg, DATA);
  assert.ok(w.hookEntries.some((h) => h.source === 'gear:oil_wake'));
  // Wearing and taking off.
  const d = make({ smithy: 1 }, RICH, { gear: structuredClone(gear) });
  assert.equal(W.whyNotEquip(d, DATA, 1), 'Already worn');
  const off = W.unequipGear(d, DATA, 'lantern');
  assert.equal(W.gearEquipped(off.doc).lantern, undefined);
  assert.throws(() => W.unequipGear(off.doc, DATA, 'lantern'), /Nothing worn there/);
  assert.deepEqual(W.equipGear(off.doc, DATA, 1).changes, [{ kind: 'gear_worn', uid: 1, slot: 'lantern' }]);
});

test('market: a poor rate, better at its levels; commons for commons, a rare dear, a rare for a few commons', () => {
  assert.equal(W.marketRates(make(), DATA), null);
  assert.equal(W.whyNotTrade(make(), DATA, 'coin', 'oil'), 'Restore the Market first');
  const d = make({ market: 1 }, { coin: 100, iron: 2 });
  assert.deepEqual(W.tradeTerms(d, DATA, 'coin', 'oil'), { give: 5, get: 1 });
  assert.deepEqual(W.tradeTerms(d, DATA, 'coin', 'iron'), { give: 30, get: 1 });
  assert.deepEqual(W.tradeTerms(d, DATA, 'iron', 'coin'), { give: 1, get: 3 });
  assert.deepEqual(W.tradeTerms(make({ market: 5 }), DATA, 'coin', 'oil'), { give: 3, get: 1 }, 'level 5: the best rate');
  assert.equal(W.tradeTerms(d, DATA, 'coin', 'coin'), null);
  assert.equal(W.whyNotTrade(d, DATA, 'coin', 'bone'), 'The Market doesn\'t trade those');
  const snap = frozen(d);
  const out = W.marketTrade(d, DATA, 'coin', 'iron');
  assert.equal(frozen(d), snap);
  assert.deepEqual(out.doc.profile.materials, { coin: 70, iron: 3 });
  assert.deepEqual(out.changes, [{ kind: 'trade', give: 'coin', gave: 30, get: 'iron', got: 1 }]);
  assert.match(W.whyNotTrade(make({ market: 1 }, { coin: 4 }), DATA, 'coin', 'oil'), /^Need 1 Coin$/);
});

test('apothecary: run tools bought one at a time, held until a run takes them; slots by its level; food heals more at levels 2 and 4', () => {
  const c = DATA.consumables.find((x) => x.unlock === 'building:apothecary:1');
  assert.equal(W.whyNotBuyConsumable(make(), DATA, c.id), 'Restore the Apothecary first');
  const later = DATA.consumables.find((x) => x.unlock === 'building:apothecary:4');
  assert.equal(W.whyNotBuyConsumable(make({ apothecary: 1 }), DATA, later.id), 'Not found yet');
  const out = W.buyConsumable(make({ apothecary: 1 }), DATA, c.id);
  assert.deepEqual(out.changes, [{ kind: 'consumable', id: c.id, cost: c.cost, held: 1 }]);
  assert.equal(W.buyConsumable(out.doc, DATA, c.id).doc.profile.consumables[c.id], 2);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((lv) => W.consumableSlots(make({ apothecary: lv }), DATA)), [0, 1, 1, 2, 2, 3]);
  // The sweep, ruling 12: about eight run tools, none a plain stat for a run, and no level empty.
  assert.ok(DATA.consumables.length >= 6 && DATA.consumables.length <= 9, `${DATA.consumables.length} run tools`);
  const TOOL = new Set(['reroll', 'banish', 'skip', 'revival']);
  for (const t of DATA.consumables) assert.ok(t.start ? !t.mods : t.mods.every((m) => TOOL.has(m.stat)), `${t.id}: a charge, a Revival, or something in hand`);
  assert.deepEqual([1, 2, 3, 4, 5].map((lv) => harborForRun(make({ apothecary: lv }), DATA).foodHeal), [0, 0.25, 0.25, 0.5, 0.5]);
  const ap = DATA.buildings.find((b) => b.id === 'apothecary');
  ap.levels.forEach((lv, i) => assert.ok(lv.consumableSlots || lv.foodHeal, `the Apothecary's level ${i + 1} does something of its own`));
});

test('hunts and trophies (ruling 13): one Hunt for each enemy that isn\'t a boss, done by kills over every run, opening its trophy', () => {
  const hunts = DATA.feats.filter((f) => f.group === 'hunt');
  assert.deepEqual(hunts.map((f) => f.id.slice(5)).sort(), DATA.enemies.filter((e) => !(e.tags || []).includes('boss')).map((e) => e.id).sort());
  assert.equal(DATA.trophies.length, hunts.length);
  // Kills add up across runs; the run that crosses the count finishes the order (with the Tavern's board up).
  let doc = make({ tavern: 1 }, {}, { bestiary: { gull: HUNT_COUNTS.gull - 10 } });   // (X3: the count from the data)
  assert.deepEqual(W.bestiaryBonus(doc, DATA), {});
  const short = applyRunResult(doc, result({ kills: { gull: 9 } }), DATA);
  assert.ok(!short.doc.profile.feats.includes('hunt_gull'));
  const out = applyRunResult(short.doc, result({ kills: { gull: 1 } }), DATA);
  assert.ok(out.doc.profile.feats.includes('hunt_gull'));
  assert.deepEqual(out.changes.find((c) => c.kind === 'feat' && c.id === 'hunt_gull').unlocks, [{ what: 'trophy', id: 'gull' }]);
  assert.deepEqual(W.bestiaryBonus(out.doc, DATA), { gull: 0.05 });
  assert.deepEqual(runConfigFor(out.doc, DATA, { character: 'lamplighter', seed: 1 }).bestiaryBonus, { gull: 0.05 });
  assert.ok(createWorld(runConfigFor(out.doc, DATA, { character: 'lamplighter', seed: 1 }), DATA));
  // No claim screen and no ladders left in the data.
  assert.equal(W.claimBestiary, undefined); assert.equal(W.bestiaryRows, undefined);
  assert.equal(DATA.meta.bestiaryLadders, undefined); assert.equal(DATA.meta.bestiaryRewards, undefined);
});

test('tavern: mastery ranks from runs, eleven of them; skill points at their ranks (ruling 15: tests/skills.test.js has the trees)', () => {
  const ranks = DATA.meta.masteryRanks;
  assert.equal(ranks.length, 11, 'ruling 15: an eleventh rank for the last skill point');
  const at = (xp) => masteryOf(make({}, {}, { characters: { lamplighter: { unlocked: true, masteryXp: xp, skills: [] } } }), DATA, 'lamplighter');
  assert.deepEqual(at(0), { xp: 0, rank: 0, next: ranks[0] });
  assert.deepEqual(at(ranks[0]), { xp: ranks[0], rank: 1, next: ranks[1] });
  assert.equal(at(1e6).rank, ranks.length);
  assert.equal(at(1e6).next, null);
});

// ---------------------------------------------------------------- feats and challenge runs

test('feats: each condition read from the run and the lifetime numbers; an unknown one is never met; who sees which', () => {
  const r = result({ map: 'drowned_docks', end: 'cleared', tide: 5, bossesKilled: [{ id: 'harbor_maw' }, { id: 'the_tidecaller' }], lanternNight: true, bellsRung: 3, maxForms: 3, untouchedSec: 320, timeSurvived: 1300, seaGlassMax: 310 });   // (X3: Pearl Hoard asks 300)
  // (The Salt Marsh's feats, 0.8.0, are judged in tests/marsh.test.js.)
  // The feats before 0.9.0 on the Docks (the Harbor Orders' other keys: their own test below).
  const OLD = ['dawn', 'maw_slayer', 'lantern_night', 'bell_ringer', 'three_forms', 'untouched', 'high_tide', 'glass_hoard', 'ten_thousand'];
  for (const f of DATA.feats.filter((x) => OLD.includes(x.id))) assert.equal(featMet(f.when, r, { kills: 10000 }), true, f.id);
  assert.equal(featMet({ cleared: true }, result()), false);
  assert.equal(featMet({ tide: 5 }, result({ tide: 4 })), false);
  assert.equal(featMet({ boss: 'harbor_maw' }, result({ bossesKilled: ['harbor_maw'] })), true, 'a boss by id');
  assert.equal(featMet({ untouchedSec: 300 }, result({ untouchedSec: 400, timeSurvived: 250 })), false, 'not past the run\'s end');
  assert.equal(featMet({ lifetimeKills: 10 }, result(), { kills: 9 }), false);
  assert.equal(featMet({ swims: 3 }, r, { kills: 1e9 }), false, 'a condition this build can\'t judge');
  // Judged: done ones once; an 'after_found' one found when its first part is met.
  const j = judgeFeats(DATA, result({ untouchedSec: 90, timeSurvived: 600 }), { kills: 0 }, new Set(), new Set());
  assert.deepEqual([j.done.map((f) => f.id), j.found.map((f) => f.id)], [[], ['untouched']]);
  const again = judgeFeats(DATA, result({ untouchedSec: 90 }), { kills: 0 }, new Set(), new Set(['untouched']));
  assert.deepEqual(again.found, [], 'found once');
  assert.deepEqual(judgeFeats(DATA, r, { kills: 1e5 }, new Set(DATA.feats.map((f) => f.id)), new Set()).done, [], 'done once');
  // Visibility.
  const F = Object.fromEntries(DATA.feats.map((f) => [f.visibility, f]));
  assert.equal(featShown(F.visible, new Set(), new Set()), true);
  assert.equal(featShown(F.after_found, new Set(), new Set()), false);
  assert.equal(featShown(F.after_found, new Set(), new Set([F.after_found.id])), true);
  assert.equal(featShown(F.hidden, new Set(), new Set()), false);
  assert.equal(featShown(F.hidden, new Set([F.hidden.id]), new Set()), true, 'a hidden one shows once done');
  // Set runs (ruling 13): an order met only by a run that set out as it, and only at its goal.
  const lamp = DATA.feats.find((f) => f.id === 'lamp_only'), hands = DATA.feats.find((f) => f.id === 'bare_hands');
  assert.equal(featMet(lamp.when, result({ challenge: 'lamp_only', timeSurvived: 600 }), {}), true);
  assert.equal(featMet(lamp.when, result({ challenge: 'lamp_only', timeSurvived: 599 }), {}), false);
  assert.equal(featMet(lamp.when, result({ timeSurvived: 900 }), {}), false, 'not set out as the set run');
  assert.equal(featMet(hands.when, result({ challenge: 'bare_hands', bossesKilled: [{ id: 'harbor_maw' }] }), {}), true);
});

test('apply: a run\'s Phase 7 part: lifetime counts, Sea Glass sold, mastery, the next Tide, a set run won, feats with the Tavern', () => {
  const d = make({ tavern: 1, market: 2 }, { coin: 10 });
  const snap = frozen(d);
  const out = applyRunResult(d, result({ end: 'cleared', cleared: true, timeSurvived: 1260, bossesKilled: [{ id: 'harbor_maw' }, { id: 'the_tidecaller' }], seaGlass: 41, lampsLit: 5, bellsRung: 1, lanternNight: true }), DATA);
  assert.equal(frozen(d), snap);
  const S = out.doc.stats;
  assert.deepEqual([S.bossKills, S.clears, S.lampsLit, S.bellsRung], [2, 1, 5, 1]);
  const kinds = out.changes.map((c) => c.kind);
  assert.ok(out.changes.some((c) => c.kind === 'glass_coin' && c.glass === 41 && c.count === 20), 'half a Coin each at the Market\'s level 2, rounded down');
  const M = DATA.tuning.mastery;
  assert.equal(out.doc.profile.characters.lamplighter.masteryXp, 21 * M.perMinute + 2 * M.perBoss);
  assert.deepEqual(out.changes.find((c) => c.kind === 'time_pay'), { kind: 'time_pay', minutes: 20, materials: { coin: 80, oil: 40 } }, 'the pay stops at 20 minutes');
  assert.ok(kinds.includes('mastery'));
  assert.deepEqual(out.doc.profile.tides, { drowned_docks: 1 }, 'Tide 1 opens on the map cleared (0.8.0: Tides per map)');
  assert.ok(out.changes.some((c) => c.kind === 'tide' && c.level === 1 && c.map === 'drowned_docks'));
  assert.deepEqual(out.doc.profile.feats.sort(), ['dawn', 'lantern_night', 'maw_slayer', 'tide_priest_call', 'untouchable'], '0.9.0: the Harbor Orders this run met (Bell Breaker is `dawn` since the merge; W2: past 15:00 with no damage brings the Tide Priest)');
  assert.ok(out.changes.some((c) => c.kind === 'feat' && c.id === 'lantern_night' && c.unlocks.some((u) => u.what === 'relic' && u.id === 'glassblower')));
  assert.ok(resolveContent(out.doc, DATA).relics.includes('glassblower'));
  assert.equal(out.doc.profile.materials.coin, 10 + 20 + 80, 'the Sea Glass and the minutes\' pay (0.9.0: Dawn opens a thing, no Coin)');
  // No Market: the Sea Glass is lost; no Tavern: nobody counts feats.
  const bare = applyRunResult(make({}, {}), result({ end: 'cleared', seaGlass: 41, lanternNight: true }), DATA);
  assert.ok(!bare.changes.some((c) => c.kind === 'glass_coin' || c.kind === 'feat'));
  assert.deepEqual(bare.doc.profile.feats, []);
  // A Tide clear opens the next only from the highest opened.
  const t3 = make({ chapel: 5 }, {}, { tides: { drowned_docks: 3 }, tide: { selected: 3 } });
  assert.equal(applyRunResult(t3, result({ end: 'cleared', tide: 3 }), DATA).doc.profile.tides.drowned_docks, 4);
  assert.equal(applyRunResult(t3, result({ end: 'cleared', tide: 1 }), DATA).doc.profile.tides.drowned_docks, 3, 'a lower Tide opens nothing');
  assert.equal(applyRunResult(t3, result({ end: 'died', tide: 3 }), DATA).doc.profile.tides.drowned_docks, 3, 'only a clear');
  // A set run won is its order done, once: what it opens, then nothing more.
  const ch = make({ cartographer: 3, tavern: 1 }, {});
  const won = applyRunResult(ch, result({ challenge: 'lamp_only', timeSurvived: 600 }), DATA);
  assert.ok(won.doc.profile.feats.includes('lamp_only'));
  assert.deepEqual(won.changes.find((c) => c.kind === 'feat' && c.id === 'lamp_only').unlocks, [{ what: 'relic', id: 'kindling' }]);
  assert.ok(!applyRunResult(won.doc, result({ challenge: 'lamp_only', timeSurvived: 600 }), DATA).changes.some((c) => c.kind === 'feat' && c.id === 'lamp_only'));
  assert.ok(!applyRunResult(ch, result({ timeSurvived: 900 }), DATA).doc.profile.feats.includes('lamp_only'), 'the same goal in an ordinary run is not the set run');
});

// ---------------------------------------------------------------- the gate: run config and setup

test('run config: the gate\'s choices, each checked against what the profile has opened', () => {
  const base = make();
  assert.deepEqual(modesOpen(base, DATA), ['standard']);
  assert.deepEqual(modesOpen(make({ cartographer: 4 }), DATA), ['standard', 'short'], 'a set run starts from the board, never the gate');
  assert.throws(() => runConfigFor(base, DATA, { character: 'lamplighter', seed: 1, mode: 'short' }), (e) => e instanceof MetaError && /Short runs open at the Cartographer/.test(e.message));
  // The Tide and curses: the Chapel's level and what clears have opened.
  const ch = make({ chapel: 4 }, RICH, { tides: { drowned_docks: 9 } });   // (the sweep, D5: curses come with the Chapel's level 4)
  assert.throws(() => runConfigFor(make({ chapel: 3 }, RICH), DATA, { character: 'lamplighter', seed: 1, curses: ['brittle'] }), /curse isn't open yet/);
  assert.throws(() => runConfigFor(make({ chapel: 2 }, RICH, { tides: { drowned_docks: 9 } }), DATA, { character: 'lamplighter', seed: 1, tide: 5 }), /Tide 5 needs the Chapel at Lv \d+\.$/, 'opened on the Docks, above the Chapel\'s cap');
  assert.throws(() => runConfigFor(make({ chapel: 2 }, RICH, { tides: { drowned_docks: 2 } }), DATA, { character: 'lamplighter', seed: 1, tide: 3 }), /Tide 3 isn't open on the Drowned Docks yet\. Clear the Drowned Docks at Tide 2 first\./);
  assert.throws(() => runConfigFor(ch, DATA, { character: 'lamplighter', seed: 1, curses: [DATA.curses[4].id] }), /curse isn't open yet/);
  const cfg = runConfigFor(ch, DATA, { character: 'lamplighter', seed: 1, tide: 4, curses: ['brittle', 'swarm'] });
  const T4 = DATA.tides[3], cs = DATA.curses.filter((c) => ['brittle', 'swarm'].includes(c.id));
  assert.equal(cfg.tide, 4);
  assert.ok(Math.abs(cfg.densityMul - T4.densityMul * cs.reduce((m, c) => m * (c.densityMul ?? 1), 1)) < 1e-9);
  assert.ok(Math.abs(cfg.rewardMul - (1 + T4.rewardMul + cs.reduce((s, c) => s + c.rewardMul, 0))) < 1e-9);
  assert.deepEqual(cfg.curses, ['brittle', 'swarm']);
  // A set run sets its own character, Tide, curses, and empty pools, and takes no Heirloom and no tools.
  const board = make({ cartographer: 3, lamp_post: 2, apothecary: 1, tavern: 3 }, RICH, { consumables: { driftwood_token: 1 }, codex: ['relic:tide_clock'] });
  const cc = runConfigFor(board, DATA, { character: 'lamplighter', seed: 1, mode: 'challenge', challenge: 'brittle_tide', heirloom: 'tide_clock', consumables: ['driftwood_token'] });
  assert.deepEqual([cc.character, cc.tide, cc.curses, cc.challenge, cc.mode, cc.relics, cc.heirloom], ['harpooner', 3, ['brittle'], 'brittle_tide', 'standard', undefined, undefined]);
  assert.ok(!cc.mods.some((m) => m.stat === 'skip'));
  const lo = runConfigFor(board, DATA, { character: 'lamplighter', seed: 1, mode: 'challenge', challenge: 'lamp_only' });
  assert.deepEqual(lo.pools.weapons, []);
  assert.throws(() => runConfigFor(board, DATA, { character: 'lamplighter', seed: 1, mode: 'challenge', challenge: 'nope' }), /Choose a challenge run on the Harbor Orders board/);
  assert.throws(() => runConfigFor(make({ cartographer: 2 }), DATA, { character: 'lamplighter', seed: 1, mode: 'challenge', challenge: 'lamp_only' }), /Lamp Only isn't posted on the board yet/);
  assert.throws(() => runConfigFor(board, DATA, { character: 'lamplighter', seed: 1, mode: 'challenge', challenge: 'lamplighter_trial' }), /isn't posted/, 'a trial waits for its mastery rank');
  assert.deepEqual(startRunProfile(board, DATA, { character: 'harpooner', mode: 'challenge', challenge: 'brittle_tide', consumables: ['driftwood_token'] }).profile.consumables, { driftwood_token: 1 }, 'and uses nothing up');
  // The Heirloom (ruling 11): a relic found before, in a relic slot from 0:00, once the Tavern opens it.
  const heir = runConfigFor(board, DATA, { character: 'lamplighter', seed: 1, heirloom: 'tide_clock' });
  assert.deepEqual([heir.relics, heir.heirloom], [['tide_clock'], 'tide_clock']);
  const hw = createWorld(heir, DATA);
  assert.deepEqual([hw.build.relics.map((r) => r.id), hw.build.relicSlots], [['tide_clock'], 3], 'it takes one of the three slots');
  assert.throws(() => runConfigFor(board, DATA, { character: 'lamplighter', seed: 1, heirloom: 'brass_button' }), /Brass Button hasn't been found in a run yet/);
  assert.throws(() => runConfigFor(make({ tavern: 2 }, RICH, { codex: ['relic:tide_clock'] }), DATA, { character: 'lamplighter', seed: 1, heirloom: 'tide_clock' }), /An Heirloom needs the Tavern at Lv 3/);
  // Run tools: held, and no more than the slots.
  const ap = make({ apothecary: 1 }, RICH, { consumables: { driftwood_token: 1, smelling_salts: 1, pearl_purse: 1, ember_tin: 1, spyglass: 1 } });
  assert.throws(() => runConfigFor(ap, DATA, { character: 'lamplighter', seed: 1, consumables: ['driftwood_token', 'smelling_salts'] }), /Only 1 run tool can go into a run/);
  assert.throws(() => runConfigFor(ap, DATA, { character: 'lamplighter', seed: 1, consumables: ['gull_bone'] }), /You have no Gull Bone/);
  const one = runConfigFor(ap, DATA, { character: 'lamplighter', seed: 1, consumables: ['pearl_purse'], rune: 'splitting' });
  assert.equal(one.startGlass, 50);
  assert.equal(one.startRune, undefined, 'a choice that still names a rune stone is passed over (ruling 14)');
  // What a tool puts in hand: an Ember, a fourth card, more from food.
  const ap3 = make({ apothecary: 5 }, RICH, ap.profile);
  const three = runConfigFor({ ...ap3, profile: { ...ap3.profile, buildings: { apothecary: 5 }, consumables: { ...ap.profile.consumables, herb_salve: 1 } } }, DATA, { character: 'lamplighter', seed: 1, consumables: ['ember_tin', 'spyglass', 'herb_salve'] });
  assert.deepEqual([three.startEmbers, three.draftCards, three.harbor.foodHeal], [1, DATA.tuning.draft.cards + 1, 1]);
  assert.equal(createWorld(three, DATA).build.embers, 1);
  // The harbor's part, and the world takes all of it.
  assert.deepEqual(harborForRun(make({ docks: 4, lamp_post: 5, chapel: 3, cartographer: 5 }), DATA), { ferry: 4, lampSpeed: 0.5, bellRing: 0.25, tasksOnMap: 1, findsOnMap: 1, secretsOnMap: 1, foodHeal: 0 });
  assert.equal(harborForRun(make({ cartographer: 2 }), DATA).findsOnMap, 1, 'the Cartographer\'s level 2 marks small secrets');
  assert.deepEqual([harborForRun(make({ lamp_post: 5, chapel: 3, lighthouse: 8 }), DATA).lampSpeed, harborForRun(make({ chapel: 3, lighthouse: 8 }), DATA).bellRing], [0.75, 0.5], 'the Lighthouse adds to both');
  for (const c of [cfg, cc, lo, one, three]) assert.ok(createWorld(c, DATA));
  // Setting out uses up what it took and keeps the choices for next time.
  const left = startRunProfile(ap, DATA, { character: 'lamplighter', consumables: ['pearl_purse'], rune: 'splitting', tide: 0, curses: [] });
  assert.deepEqual(left.profile.consumables, { driftwood_token: 1, smelling_salts: 1, ember_tin: 1, spyglass: 1 });
  assert.equal(left.profile.setup.character, 'lamplighter');
  assert.deepEqual(left.profile.setup.consumables, [], 'what was used up isn\'t chosen again by itself');
});

test('setup: the gate is six rows, each shown once the harbor opens it, from the last choices still open', () => {
  const fresh = defaultProfile();
  assert.deepEqual(setupRows(fresh, DATA, startChoice(fresh, DATA, 'lamplighter')), [], 'nothing to choose: the gate sets out at once');
  const two = make({ lamp_post: 2 }, RICH);
  assert.deepEqual(setupRows(two, DATA, startChoice(two, DATA, 'lamplighter')), [], 'the cards ask the map and the character: nothing past them, no rows');
  const ranks = DATA.meta.masteryRanks;
  const d = make({ chapel: 4, cartographer: 4, apothecary: 3, smithy: 4, tavern: 3, lamp_post: 2 }, RICH, {
    tides: { drowned_docks: 4 }, tide: { selected: 3 }, codex: ['relic:tide_clock', 'relic:brass_button'],
    characters: { lamplighter: { unlocked: true, masteryXp: ranks[3], skills: ['great_lamp'] } },
    consumables: { driftwood_token: 2, smelling_salts: 1, gull_bone: 1, 'rune:splitting': 1, 'rune:orbiting': 1 },
    setup: { character: 'lamplighter', kit: '', mode: 'short', curses: ['brittle', 'fast_water'], heirloom: 'nope', consumables: [], rune: '', challenge: '' },
  });
  const c = startChoice(d, DATA, 'lamplighter');
  assert.deepEqual([c.kit, c.mode, c.tide, c.curses, c.heirloom], ['', 'short', 3, ['brittle'], ''], 'the last choices, held to what\'s open');
  const rows = setupRows(d, DATA, c), keys = rows.map((r) => r.key);
  assert.deepEqual(keys, ['map', 'character', 'kit', 'heirloom', 'tools', 'difficulty'], 'six rows (no Rune stone row: ruling 14)');
  for (const r of rows) assert.ok(r.label.split(' ').length <= 4, r.label);
  const row = (k, ch = c) => setupRows(d, DATA, ch).find((r) => r.key === k);
  // The map row carries the short run.
  assert.deepEqual(row('map').choices, [['drowned_docks', 'Drowned Docks'], ['drowned_docks:short', 'Drowned Docks, short run']]);
  assert.equal(row('map').value, 'drowned_docks:short');
  assert.equal(row('map').detail[0], 'Everything comes twice as fast. The last boss comes at 10:00, and the run pays 40% of what a full run would.');
  assert.equal(row('map').detail[1], 'Slots: 4 weapons, 6 passives, 3 relics.');
  const full = applyRow(c, 'map', 'drowned_docks');
  assert.deepEqual([full.map, full.mode], ['drowned_docks', 'standard']);
  // The character row: who, and the skills they have taken. A new character keeps only a kit of their own.
  assert.deepEqual(row('character').choices, [['lamplighter', 'Lamplighter'], ['harpooner', 'Harpooner']]);
  assert.ok(row('character').detail.includes('Skills: Great Lamp.'), row('character').detail.join(' | '));
  const harp = settleChoice(d, DATA, applyRow({ ...c, kit: 'lamplighter_orb' }, 'character', 'harpooner'));
  assert.deepEqual([harp.character, harp.kit], ['harpooner', '']);
  assert.deepEqual(row('kit').detail, [DATA.weapons.find((w) => w.id === 'flare_gun').desc], 'what the starting weapon does');
  assert.equal(row('kit').label, 'Starting weapon');
  assert.deepEqual(row('kit').choices.map(([, t]) => t), ['Flare Gun', 'Lantern Orb', 'Signal Mirror'], '0.9.0: the rank 2 and rank 4 kits');
  // The Heirloom: relics found before, and what the pick costs.
  assert.deepEqual(row('heirloom').choices, [['', 'None'], ['brass_button', 'Brass Button'], ['tide_clock', "Ship's Clock"]]);
  assert.deepEqual(row('heirloom').detail, ['One relic you have found before, carried from the start of a run. It takes a relic slot.']);
  const heir = applyRow(c, 'heirloom', 'tide_clock');
  assert.deepEqual(row('heirloom', heir).detail, [DATA.relics.find((r) => r.id === 'tide_clock').desc, 'It takes 1 of your 3 relic slots.']);
  assert.equal(row('heirloom', heir).icon, 'relic_tide_clock');
  // Run tools: one row, each tool held a switch, up to the slots (2 at the Apothecary's level 3).
  const tools = row('tools');
  assert.deepEqual([tools.kind, tools.summary, tools.items.map((i) => [i.id, i.on])], ['multi', '0 of 2', [['driftwood_token', false], ['gull_bone', false], ['smelling_salts', false]]]);
  let t2 = c;
  for (const id of ['smelling_salts', 'gull_bone']) { const it = row('tools', t2).items.find((i) => i.id === id); t2 = settleChoice(d, DATA, applyRow(t2, ...it.press)); }
  assert.deepEqual(t2.consumables, ['smelling_salts', 'gull_bone']);
  const third = row('tools', t2).items.find((i) => i.id === 'driftwood_token');
  assert.equal(third.why, 'Only 2 run tools can go into a run. Take one out first.');
  assert.equal(row('tools', t2).summary, '2 of 2');
  const off = row('tools', t2).items.find((i) => i.id === 'gull_bone');
  assert.deepEqual(applyRow(t2, ...off.press).consumables, ['smelling_salts']);
  // Difficulty: the Tide (Lower, Raise) and the curses, together.
  const diff = row('difficulty');
  assert.deepEqual(diff.items.map((i) => i.id), ['tide_down', 'tide_up', 'brittle', 'swarm', 'hunger']);
  assert.equal(diff.summary, 'Tide 3, 1 curse');
  // The Tide's numbers, then every rule it plays with (its own and those below it; 0.7.3).
  assert.deepEqual(diff.items[0].detail, [tideText(DATA.tides[2]), ...DATA.tides.slice(0, 3).filter((t) => t.rule?.desc).map((t) => t.rule.desc)]);
  assert.deepEqual(diff.items[2].detail, ['Curse: -30% Max HP.', 'Pays 15% more materials']);
  const up = applyRow(c, ...diff.items[1].press);
  assert.equal(up.tide, 4);
  assert.equal(row('difficulty', up).items[1].why, 'Tide 4 is the highest open on this map.');
  assert.equal(applyRow(c, ...diff.items[0].press).tide, 2);
  assert.equal(row('difficulty', { ...c, tide: 0 }).items[0].why, 'No Tide is chosen.');
  const c3 = applyRow(applyRow(t2, ...row('difficulty', t2).items.find((i) => i.id === 'swarm').press), 'curse:brittle', false);
  assert.deepEqual(c3.curses, ['swarm']);
  assert.deepEqual(choiceForRun({ ...c3, mode: 'standard' }), { character: 'lamplighter', mode: 'standard', tide: 3, curses: ['swarm'], map: 'drowned_docks', consumables: ['smelling_salts', 'gull_bone'] });
  assert.equal(rewardText(DATA, { ...c3, mode: 'standard', tide: 3 }), `This run pays ${Math.round((DATA.tides[2].rewardMul + DATA.curses.find((x) => x.id === 'swarm').rewardMul) * 100)}% more materials`);
  assert.equal(rewardText(DATA, { ...c3, mode: 'standard', tide: 0, curses: [] }), null);
  // A short run says its share of a full run's materials (its Tide and curses included).
  assert.equal(rewardText(DATA, { ...c3, mode: 'short', tide: 0, curses: [] }), "This run pays 40% of a full run's materials");
  // Set runs start from the board (ruling 13): only posted ones whose character has arrived; the gate has no row for them.
  assert.ok(!keys.includes('mode') && !keys.includes('challenge') && !keys.some((k) => k.startsWith('curse:') || k.startsWith('slot:') || k === 'arcana' || k === 'tide'));
  const noHarp = make({ cartographer: 3 }, RICH);
  assert.deepEqual(challengesOpen(noHarp, DATA).map((x) => x.id), ['lamp_only']);
  const order = (id) => DATA.feats.find((f) => f.id === id);
  assert.equal(whyNotSetRun(noHarp, DATA, order('bare_hands')), 'The Harpooner hasn\'t arrived yet');
  assert.equal(whyNotSetRun(noHarp, DATA, order('lamp_only')), null);
  assert.equal(whyNotSetRun(make({ cartographer: 2 }), DATA, order('lamp_only')), 'Not posted yet');
  assert.equal(setsOutAs(DATA, { character: 'lamplighter', mode: 'challenge', challenge: 'bare_hands' }), 'harpooner');
  assert.equal(rewardText(DATA, { mode: 'challenge', challenge: 'brittle_tide', curses: [], tide: 0 }), `This run pays ${Math.round((DATA.tides[2].rewardMul + DATA.curses.find((x) => x.id === 'brittle').rewardMul) * 100)}% more materials`);
  // Every value every row offers is one the run config takes (and its stone fits).
  for (const who of ['lamplighter', 'harpooner']) {
    const base = settleChoice(d, DATA, startChoice(d, DATA, who));
    for (const r of setupRows(d, DATA, base)) {
      const presses = r.kind === 'multi' ? r.items.filter((i) => !i.why).map((i) => i.press) : r.choices.map(([v]) => [r.key, v]);
      for (const [k, v] of presses) {
        const pick = settleChoice(d, DATA, applyRow(base, k, v));
        assert.doesNotThrow(() => { runConfigFor(d, DATA, { ...choiceForRun(pick), seed: 1 }); }, `${who}: ${k} = ${v}`);
      }
    }
  }
});

// ---------------------------------------------------------------- reconcile, v3

test('reconcile: Phase 7\'s parts from another build: unknown gear, feats, and consumables set aside and brought back; the rest held to this build', () => {
  const d = make({ smithy: 3 }, {}, {
    gear: {
      inventory: [{ uid: 1, id: 'storm_lantern', tier: 9, affixes: ['fire_volley', 'from_later'] }, { uid: 1, id: 'harbor_coat', tier: 1, affixes: ['tide_volley'] }, { uid: 3, id: 'glass_sword', tier: 2, affixes: [] }],
      equipped: { lantern: 1, coat: 3, boots: 77 }, next: 1, rolls: 'x',
    },
    feats: ['dawn', 'swim_far'], featsFound: ['untouched'], retired: 1,
    consumables: { driftwood_token: 2, moon_oil: 4, 'rune:splitting': 1, 'rune:later': 1, smelling_salts: 0 },
    setup: { character: 'lamplighter', mode: 'sideways', curses: ['brittle', 'nope'], heirloom: 'nope', consumables: ['driftwood_token', 'x'], rune: 'splitting', challenge: 'flood' },
  });
  const { doc, moved } = reconcileProfile(d, DATA);
  const G = doc.profile.gear;
  assert.deepEqual(G.inventory.map((x) => [x.uid, x.id, x.tier]), [[1, 'storm_lantern', 5], [2, 'harbor_coat', 1]], 'a tier held to 5; a uid used twice gets a new one');
  assert.deepEqual(G.inventory[0].affixes, ['fire_volley', 'from_later'], 'an affix this build doesn\'t know stays on the item');
  assert.equal(G.next, 3);
  assert.equal(G.rolls, 0);
  assert.deepEqual(G.equipped, { lantern: 1 }, 'worn only what\'s held, in its own slot');
  assert.deepEqual(doc.profile.orphans.gear.map((x) => x.id), ['glass_sword']);
  assert.deepEqual(doc.profile.feats, ['dawn']);
  assert.deepEqual(doc.profile.orphans.feats, ['swim_far']);
  // (Ruling 14's step, once: every rune stone held is paid back at the cutting price, and a chosen one cleared.)
  assert.deepEqual(doc.profile.consumables, { driftwood_token: 2 });
  assert.deepEqual(doc.profile.orphans.consumables, { moon_oil: 4 });
  assert.deepEqual(doc.profile.retiredNote, { stones: 2, stoneRefund: { iron: 8, salt_glass: 12, drowned_pages: 140, coin: 460 } });
  assert.deepEqual(doc.profile.setup, { character: 'lamplighter', kit: '', mode: 'standard', curses: ['brittle'], heirloom: '', consumables: ['driftwood_token'], rune: '', challenge: '', map: '' });
  assert.ok(moved.includes('gear:glass_sword') && moved.includes('feats:swim_far'));
  assert.deepEqual(reconcileProfile(doc, DATA).doc, doc, 'kept as it is on the next load');
  // A build that knows them again gets them back.
  const LATER = {
    ...DATA,
    recipes: [...DATA.recipes, { id: 'glass_sword', name: 'Glass Sword', slot: 'coat', base: 'might', pool: ['vigor'], cost: { coin: 1 }, unlock: 'starter' }],
    feats: [...DATA.feats, { id: 'swim_far', name: 'Swim Far', visibility: 'visible', when: {}, reward: { materials: { coin: 1 } } }],
    consumables: [...DATA.consumables, { id: 'moon_oil', name: 'Moon Oil', mods: [], cost: { coin: 1 }, unlock: 'starter' }],
  };
  const back = reconcileProfile(doc, LATER);
  assert.ok(back.doc.profile.gear.inventory.some((x) => x.id === 'glass_sword'));
  assert.deepEqual(back.doc.profile.feats, ['dawn', 'swim_far']);
  assert.equal(back.doc.profile.consumables.moon_oil, 4);
  assert.ok(back.restored.includes('gear:glass_sword') && back.restored.includes('feats:swim_far') && back.restored.includes('consumables:moon_oil'));
});

test('next up: Phase 7\'s goals join the list: gear not made, a worn item\'s next tier, a consumable none held', () => {
  const ranks = DATA.meta.masteryRanks;
  const d = make({ smithy: 2, tavern: 2, apothecary: 1 }, { coin: 40 }, { characters: { lamplighter: { unlocked: true, masteryXp: ranks[0], perks: [] } } });
  const kinds = (doc) => purchaseOptions(doc, DATA).map((o) => `${o.kind}:${o.id}`);
  const k = kinds(d);
  for (const r of DATA.recipes) assert.equal(k.includes(`craft:${r.id}`), r.unlock.startsWith('research:'), `${r.id}: research opened it (the rest wait on an order or a rank)`);
  assert.ok(DATA.consumables.filter((c) => c.unlock === 'building:apothecary:1').every((c) => k.includes(`consumable:${c.id}`)));
  // Made and worn: no longer a craft, but its next tier is (until the Smithy's cap).
  const made = W.craftGear(make({ smithy: 2 }), DATA, 'storm_lantern').doc;
  assert.ok(!kinds(made).includes('craft:storm_lantern'));
  const tier = purchaseOptions(made, DATA).find((o) => o.kind === 'gear_tier');
  assert.deepEqual([tier.id, tier.uid, tier.tier], ['storm_lantern', 1, 2]);
  assert.deepEqual(tier.cost, W.upgradeCost(DATA, W.gearItems(made)[0]));
  assert.ok(!purchaseOptions(make({ smithy: 1 }, RICH, { gear: made.profile.gear }), DATA).some((o) => o.kind === 'gear_tier'), 'not past the Smithy\'s tier');
  // Held already, trained already, or nothing open: nothing.
  const none = make({}, RICH);
  assert.ok(!kinds(none).some((x) => /^(craft|gear_tier|perk|consumable):/.test(x)));
  assert.ok(!kinds(make({ apothecary: 1 }, RICH, { consumables: { driftwood_token: 1 } })).includes('consumable:driftwood_token'));
  // They compete with the rest on how close they are, and the panels name them.
  const top = nextAffordable(make({ smithy: 1, lamp_post: 5, library: 5, tavern: 5 }, { ...DATA.recipes.find((r) => r.id === 'storm_lantern').cost }), DATA, 99);
  const lantern = top.find((o) => o.kind === 'craft' && o.id === 'storm_lantern');
  const short = top.findIndex((o) => o.progress < 1);
  assert.ok(lantern && (short < 0 || top.indexOf(lantern) < short), 'affordable now: ahead of anything short');
  assert.deepEqual(optionText(DATA, lantern), { title: 'Storm Lantern', where: 'Smithy', readyAt: 'Ready at the Smithy', progress: 1, need: null, opens: null, runs: null, waits: null });
  assert.equal(optionText(DATA, { ...tier, missing: [] }).title, 'Storm Lantern, Uncommon');
});

test('apply and reconcile: unknown bosses count for nothing; a set run\'s Tide skips none; Tides held to the build', () => {
  const out = applyRunResult(make({}, {}), result({ timeSurvived: 120, bossesKilled: ['nope', { id: 'harbor_maw' }, { id: 'also_nope' }] }), DATA).doc;
  assert.equal(out.stats.bossKills, 1);
  assert.equal(out.profile.characters.lamplighter.masteryXp, 2 * DATA.tuning.mastery.perMinute + DATA.tuning.mastery.perBoss);
  const skip = applyRunResult(make({ cartographer: 3 }, {}), result({ challenge: 'long_watch', end: 'cleared', cleared: true, tide: 4, timeSurvived: 1300 }), DATA).doc;
  assert.deepEqual(skip.profile.tides, {}, 'a clear at Tide 4 with nothing opened opens nothing');
  // The Tide record, per map (v4): held to this build's 10 (the rest set aside), the choice a
  // whole number within what's opened; a map this build doesn't know set aside whole.
  const odd = make({}, {}, { tides: { drowned_docks: 14, salt_marsh: 2, reef: 3 }, tide: { selected: 2.5 } });
  const t = reconcileProfile(odd, DATA).doc;
  assert.deepEqual([t.profile.tides, t.profile.tide, t.profile.orphans.tides], [{ drowned_docks: 10, salt_marsh: 2 }, { selected: 2 }, { drowned_docks: 14, reef: 3 }]);
  const more = { ...DATA, tides: [...DATA.tides, ...DATA.tides.slice(0, 5).map((x, i) => ({ ...x, level: 11 + i }))] };
  const backT = reconcileProfile(t, more).doc;
  assert.equal(backT.profile.tides.drowned_docks, 14, 'a build with more Tides gives them back');
  assert.deepEqual(backT.profile.orphans.tides, { reef: 3 });
  assert.deepEqual(reconcileProfile(make({}, {}, { tides: { drowned_docks: -3 }, tide: { selected: 'x' } }), DATA).doc.profile.tide, { selected: 0 });
  assert.throws(() => runConfigFor(make(), DATA, { character: 'lamplighter', seed: 1, tide: 1.5 }), /whole number/);
  assert.throws(() => runConfigFor(make(), DATA, { character: 'lamplighter', seed: 1, tide: '1' }), /whole number/);
  // A set run keeps the gate's last Tide, curses, character, and Heirloom.
  const kept = startRunProfile(make({}, {}, { tides: { drowned_docks: 3 }, tide: { selected: 3 }, setup: { character: 'punter', curses: ['brittle'], heirloom: 'tide_clock' } }), DATA, { character: 'harpooner', mode: 'challenge', challenge: 'bare_hands' });
  assert.deepEqual([kept.profile.tide.selected, kept.profile.setup.curses, kept.profile.setup.character, kept.profile.setup.heirloom, kept.profile.setup.mode], [3, ['brittle'], 'punter', 'tide_clock', 'standard']);
});

test('workshop: every Phase 7 writer leaves the rest of the profile alone (an update can never wipe progress, §12.2)', () => {
  const ranks = DATA.meta.masteryRanks;
  const base = make({ smithy: 5, market: 5, apothecary: 5, cartographer: 5, tavern: 5, docks: 2 }, RICH, {
    bestiary: { fog_wisp: 1050 }, codex: ['weapon:flare_gun'], feats: ['dawn'], tides: { drowned_docks: 2 }, tide: { selected: 1 },
    characters: { lamplighter: { unlocked: true, masteryXp: ranks[2], perks: [] } }, flags: { sawIntro: true },
    orphans: { materials: { glowstone: 3 } },
  });
  const d = W.craftGear(base, DATA, 'storm_lantern').doc;
  const strip = (doc, may) => { const o = structuredClone(doc); for (const k of may) delete o.profile[k]; return o; };
  const same = (after, may, what) => assert.deepEqual(strip(after, may), strip(d, may), `${what} changes only ${may.join(', ')}`);
  same(W.craftGear(d, DATA, 'harbor_coat').doc, ['materials', 'gear'], 'making gear');
  same(W.upgradeGear(d, DATA, 1).doc, ['materials', 'gear'], 'a tier up');
  same(W.rerollGear(d, DATA, 1, 1, W.rerollOffer(d, DATA, 1, 1)[0]).doc, ['materials', 'gear'], 'a re-roll');
  same(W.unequipGear(d, DATA, 'lantern').doc, ['gear'], 'taking off');
  same(W.equipGear(W.unequipGear(d, DATA, 'lantern').doc, DATA, 1).doc, ['gear'], 'wearing');
  same(W.marketTrade(d, DATA, 'coin', 'oil').doc, ['materials'], 'a trade');
  same(W.buyConsumable(d, DATA, 'smelling_salts').doc, ['materials', 'consumables'], 'a consumable');
  same(K.takeSkill({ ...d, profile: { ...d.profile, characters: { lamplighter: { unlocked: true, masteryXp: DATA.meta.masteryRanks[0], skills: [] } } } }, DATA, 'great_lamp').doc, ['characters'], 'a skill taken');
  const held = W.buyConsumable(d, DATA, 'smelling_salts').doc;
  same(startRunProfile(held, DATA, { character: 'lamplighter', consumables: ['smelling_salts'], tide: 1, curses: [] }), ['consumables', 'setup', 'tide', 'materials'], 'setting out');
  assert.deepEqual(startRunProfile(held, DATA, { character: 'lamplighter', tide: 1, curses: [] }).profile.materials, held.profile.materials, '(no materials touched)');
});

test('workshop: a purchase keeps an item it can\'t read (a hand-built profile\'s), never drops it', () => {
  const d = make({ smithy: 3 }, RICH, { gear: { inventory: [{ uid: 1, id: 'storm_lantern', affixes: 'x' }, 'junk'], equipped: { lantern: 1 }, next: 2, rolls: 0 } });
  const out = W.craftGear(d, DATA, 'sea_boots').doc;
  assert.deepEqual(out.profile.gear.inventory.slice(0, 2), [{ uid: 1, id: 'storm_lantern', affixes: 'x' }, 'junk']);
  assert.equal(out.profile.gear.inventory[2].id, 'sea_boots');
  assert.equal(out.profile.gear.inventory[2].uid, 2);
  assert.equal(out.profile.gear.equipped.lantern, 1, 'what was worn stays worn');
});
