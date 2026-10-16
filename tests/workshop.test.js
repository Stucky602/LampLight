// What the Phase 7 buildings sell and keep (ARCHITECTURE §10.6; src/meta/workshop.js, feats.js,
// apply.js's Phase 7 part, runconfig.js, and the gate's rows in src/app/setup.js). Pure: each
// test also checks the document passed in never changes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA } from '../src/data/index.js';
import { defaultProfile } from '../src/save/schema.js';
import * as W from '../src/meta/workshop.js';
import { featMet, challengeWon, judgeFeats, featShown } from '../src/meta/feats.js';
import { applyRunResult, runConfigFor, startRunProfile, reconcileProfile, MetaError, masteryOf, resolveContent } from '../src/meta/index.js';
import { modesOpen, harborForRun } from '../src/meta/runconfig.js';
import { purchaseOptions, nextAffordable } from '../src/meta/next.js';
import { startChoice, setupRows, applyRow, choiceForRun, rewardText, settleChoice, stoneFits, checkStone, challengesOpen, setsOutAs } from '../src/app/setup.js';
import { tideText } from '../src/ui/hubtext.js';
import { createWorld } from '../src/sim/world.js';
import { optionText } from '../src/ui/hubtext.js';
import { TIER_MUL, REROLL_COST, RUNE_STONE_COST, GEAR_SLOTS } from '../src/data/gear.js';

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
  assert.equal(W.whyNotCraft(make(), DATA, r.id), 'Requires Smithy Lv 1');
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
  assert.equal(W.whyNotEquip(ring.doc, DATA, 1), 'Requires Smithy Lv 3');
  // The slots by the Smithy's level: the brief's four, the 5th at level 3, the 6th at level 5.
  assert.deepEqual([1, 2, 3, 4, 5].map((lv) => W.gearSlotsOpen(make({ smithy: lv }), DATA).length), [4, 4, 5, 5, 6]);
  assert.deepEqual(W.gearSlotsOpen(make({ smithy: 5 }), DATA), GEAR_SLOTS);
});

test('smithy: a tier up costs the recipe times the new tier, waits on the Smithy, and brings a third affix at tier 3', () => {
  const r = DATA.recipes.find((x) => x.id === 'harbor_coat');
  let d = W.craftGear(make({ smithy: 1 }), DATA, r.id).doc;
  assert.equal(W.whyNotUpgradeGear(d, DATA, 1), 'Requires Smithy Lv 2', 'tier 1 only, at level 1');
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
  assert.equal(W.whyNotUpgradeGear(top, DATA, 1), 'Already at max tier');
  assert.equal(W.gearItems(top)[0].affixes.length, 3, 'never a fourth');
  assert.match(W.whyNotUpgradeGear(make({ smithy: 5 }, {}, { gear: three.profile.gear }), DATA, 1), /^Need /);
});

test('smithy: a re-roll offers three, the same until one is taken, never the recipe\'s own; it costs by tier', () => {
  const base = W.craftGear(make({ smithy: 3 }), DATA, 'sea_boots').doc;
  assert.equal(W.whyNotReroll(W.craftGear(make({ smithy: 2 }), DATA, 'sea_boots').doc, DATA, 1, 1), 'Requires Smithy Lv 3');
  assert.equal(W.whyNotReroll(base, DATA, 1, 0), "The recipe's own affix stays");
  assert.equal(W.whyNotReroll(base, DATA, 1, 4), 'No such affix');
  assert.equal(W.whyNotReroll(base, DATA, 1, 1), null);
  const offer = W.rerollOffer(base, DATA, 1, 1);
  const item = W.gearItems(base)[0];
  assert.equal(offer.length, 3);
  assert.ok(offer.every((id) => !item.affixes.includes(id)), 'nothing already on it');
  assert.deepEqual(W.rerollOffer(base, DATA, 1, 1), offer, 'the same offer however often it\'s asked');
  assert.throws(() => W.rerollGear(base, DATA, 1, 1, item.affixes[1]), /Not one of the offered affixes/);
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
  assert.equal(W.affixText(affix('oil_wake'), 4), 'Dash leaves burning oil');
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
  assert.deepEqual(g.hooks, [{ hook: 'dash_trail', affix: 'oil_wake', params: { ...wake.params, damage: wake.params.damage * TIER_MUL[2], dps: wake.params.dps * TIER_MUL[2] } }], 'once, at the best tier worn');
  // Into a run: the RunConfig, and a world that takes it.
  const doc = make({ smithy: 5, tavern: 1 }, RICH, { gear });
  const cfg = runConfigFor(doc, DATA, { character: 'lamplighter', seed: 1 });
  assert.equal(cfg.draftCards, DATA.tuning.draft.cards + 1);
  assert.equal(cfg.evolutionPassiveReduction, 1);
  assert.deepEqual(cfg.gearHooks.map((x) => x.hook), ['dash_trail']);
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

test('smithy: a rune stone needs the Smithy\'s level 4 and a rune you\'ve found; it\'s held until a run takes it', () => {
  assert.equal(W.whyNotCutRune(make({ smithy: 3 }), DATA, 'splitting'), 'Requires Smithy Lv 4');
  const fresh = make({ smithy: 4 }); fresh.profile.research.done = [];
  const locked = DATA.runes.find((r) => r.unlock !== 'starter');
  assert.equal(W.whyNotCutRune(fresh, DATA, locked.id), 'Not found yet');
  assert.match(W.whyNotCutRune(make({ smithy: 4 }, {}), DATA, 'splitting'), /^Need /);
  const out = W.cutRuneStone(make({ smithy: 4 }), DATA, 'splitting');
  assert.equal(out.doc.profile.consumables['rune:splitting'], 1);
  assert.deepEqual(out.doc.profile.materials, spent(RICH, RUNE_STONE_COST));
  assert.equal(W.cutRuneStone(out.doc, DATA, 'splitting').doc.profile.consumables['rune:splitting'], 2);
});

// ---------------------------------------------------------------- the Market, the Apothecary, the Cartographer, the Tavern

test('market: a poor rate, better at its levels; commons for commons, a rare dear, a rare for a few commons', () => {
  assert.equal(W.marketRates(make(), DATA), null);
  assert.equal(W.whyNotTrade(make(), DATA, 'coin', 'oil'), 'Requires Market Lv 1');
  const d = make({ market: 1 }, { coin: 100, iron: 2 });
  assert.deepEqual(W.tradeTerms(d, DATA, 'coin', 'oil'), { give: 5, get: 1 });
  assert.deepEqual(W.tradeTerms(d, DATA, 'coin', 'iron'), { give: 30, get: 1 });
  assert.deepEqual(W.tradeTerms(d, DATA, 'iron', 'coin'), { give: 1, get: 3 });
  assert.deepEqual(W.tradeTerms(make({ market: 5 }), DATA, 'coin', 'oil'), { give: 3, get: 1 }, 'level 5: the best rate');
  assert.equal(W.tradeTerms(d, DATA, 'coin', 'coin'), null);
  assert.equal(W.whyNotTrade(d, DATA, 'coin', 'bone'), 'Market doesn\'t trade those');
  const snap = frozen(d);
  const out = W.marketTrade(d, DATA, 'coin', 'iron');
  assert.equal(frozen(d), snap);
  assert.deepEqual(out.doc.profile.materials, { coin: 70, iron: 3 });
  assert.deepEqual(out.changes, [{ kind: 'trade', give: 'coin', gave: 30, get: 'iron', got: 1 }]);
  assert.match(W.whyNotTrade(make({ market: 1 }, { coin: 4 }), DATA, 'coin', 'oil'), /^Need 1 Coin$/);
});

test('apothecary: consumables bought one at a time, held until a run takes them; slots by its level', () => {
  const c = DATA.consumables.find((x) => x.unlock === 'building:apothecary:1');
  assert.equal(W.whyNotBuyConsumable(make(), DATA, c.id), 'Requires Apothecary Lv 1');
  const later = DATA.consumables.find((x) => x.unlock === 'building:apothecary:4');
  assert.equal(W.whyNotBuyConsumable(make({ apothecary: 1 }), DATA, later.id), 'Not found yet');
  const out = W.buyConsumable(make({ apothecary: 1 }), DATA, c.id);
  assert.deepEqual(out.changes, [{ kind: 'consumable', id: c.id, cost: c.cost, held: 1 }]);
  assert.equal(W.buyConsumable(out.doc, DATA, c.id).doc.profile.consumables[c.id], 2);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((lv) => W.consumableSlots(make({ apothecary: lv }), DATA)), [0, 1, 1, 2, 2, 3]);
});

test('cartographer: a bestiary milestone claimed once each, in order; the last two add a capped bonus', () => {
  const d = make({ cartographer: 1 }, {}, { bestiary: { fog_wisp: 1500, drowned_sailor: 5 } });
  assert.equal(W.whyNotClaim(d, DATA, 'fog_wisp'), 'Requires Cartographer Lv 2');
  let doc = make({ cartographer: 2 }, {}, { bestiary: { fog_wisp: 1500, drowned_sailor: 5 } });
  assert.equal(W.whyNotClaim(doc, DATA, 'drowned_sailor'), 'Need 10 kills (5)');
  assert.equal(W.whyNotClaim(doc, DATA, 'harbor_maw'), 'Not in the bestiary', 'bosses aren\'t claimed');
  const rows = W.bestiaryRows(doc, DATA);
  assert.ok(rows.every((r) => !DATA.enemies.find((e) => e.id === r.id).tags.includes('boss')));
  for (let k = 0; k < 3; k++) {
    const out = W.claimBestiary(doc, DATA, 'fog_wisp');
    assert.equal(out.changes[0].kills, DATA.meta.bestiaryMilestones[k]);
    doc = out.doc;
  }
  assert.equal(W.whyNotClaim(doc, DATA, 'fog_wisp'), 'Need 10000 kills (1500)');
  assert.deepEqual(doc.profile.materials, { coin: 230, drowned_pages: 6, iron: 2 });
  assert.deepEqual(W.bestiaryBonus(doc, DATA), { fog_wisp: 0.03 });
  doc.profile.bestiary.fog_wisp = 10000;
  doc = W.claimBestiary(doc, DATA, 'fog_wisp').doc;
  assert.equal(W.whyNotClaim(doc, DATA, 'fog_wisp'), 'All claimed');
  assert.deepEqual(W.bestiaryBonus(doc, DATA), { fog_wisp: DATA.meta.bestiaryBonusMax });
  assert.deepEqual(runConfigFor(doc, DATA, { character: 'lamplighter', seed: 1 }).bestiaryBonus, { fog_wisp: 0.06 });
});

test('tavern: mastery ranks from runs; perks trained at the Tavern\'s level 2, at their rank, once; a kit at rank 4', () => {
  const ranks = DATA.tuning.mastery.ranks;
  const at = (xp) => masteryOf(make({}, {}, { characters: { lamplighter: { unlocked: true, masteryXp: xp, perks: [] } } }), DATA, 'lamplighter');
  assert.deepEqual(at(0), { xp: 0, rank: 0, next: ranks[0] });
  assert.deepEqual(at(ranks[0]), { xp: ranks[0], rank: 1, next: ranks[1] });
  assert.equal(at(1e6).rank, ranks.length);
  assert.equal(at(1e6).next, null);
  const who = (xp, lv = 2) => make({ tavern: lv }, RICH, { characters: { lamplighter: { unlocked: true, masteryXp: xp, perks: [] } } });
  assert.equal(W.whyNotTrain(who(999, 1), DATA, 'trimmed_wick'), 'Requires Tavern Lv 2');
  assert.equal(W.whyNotTrain(who(0), DATA, 'trimmed_wick'), 'Requires mastery rank 1');
  assert.equal(W.whyNotTrain(who(0), DATA, 'iron_grip'), 'Requires mastery rank 1', 'each character\'s own mastery');
  const out = W.trainPerk(who(ranks[0]), DATA, 'trimmed_wick');
  assert.deepEqual(out.doc.profile.characters.lamplighter.perks, ['trimmed_wick']);
  assert.equal(W.whyNotTrain(out.doc, DATA, 'trimmed_wick'), 'Already trained');
  const cfg = runConfigFor(out.doc, DATA, { character: 'lamplighter', seed: 1 });
  assert.ok(cfg.mods.some((m) => m.stat === 'area' && m.value === 0.1), 'every run as her has it');
  assert.ok(!runConfigFor(who(ranks[0]), DATA, { character: 'lamplighter', seed: 1 }).mods.some((m) => m.stat === 'area' && m.value === 0.1));
  // Kits.
  assert.deepEqual(W.kitsOf(who(ranks[2]), DATA, 'lamplighter').map((k) => [k.id, k.open]), [['', true], ['lamplighter_orb', false]]);
  assert.deepEqual(W.kitsOf(who(ranks[3]), DATA, 'lamplighter').map((k) => k.open), [true, true]);
  assert.throws(() => runConfigFor(who(ranks[2]), DATA, { character: 'lamplighter', seed: 1, kit: 'lamplighter_orb' }), /more mastery/);
  assert.equal(runConfigFor(who(ranks[3]), DATA, { character: 'lamplighter', seed: 1, kit: 'lamplighter_orb' }).startWeapon, 'lantern_orb');
});

// ---------------------------------------------------------------- feats and challenge runs

test('feats: each condition read from the run and the lifetime numbers; an unknown one is never met; who sees which', () => {
  const r = result({ end: 'cleared', tide: 5, bossesKilled: [{ id: 'harbor_maw' }], lanternNight: true, bellsRung: 3, maxForms: 3, untouchedSec: 320, timeSurvived: 1300, seaGlassMax: 210 });
  for (const f of DATA.feats) assert.equal(featMet(f.when, r, { kills: 10000 }), true, f.id);
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
  // Challenge runs: only as that challenge, and only at the goal.
  const lamp = DATA.challenges.find((c) => c.id === 'lamp_only'), hands = DATA.challenges.find((c) => c.id === 'bare_hands');
  assert.equal(challengeWon(lamp, result({ challenge: 'lamp_only', timeSurvived: 600 })), true);
  assert.equal(challengeWon(lamp, result({ challenge: 'lamp_only', timeSurvived: 599 })), false);
  assert.equal(challengeWon(lamp, result({ timeSurvived: 900 })), false, 'not set out as the challenge');
  assert.equal(challengeWon(hands, result({ challenge: 'bare_hands', bossesKilled: [{ id: 'harbor_maw' }] })), true);
});

test('apply: a run\'s Phase 7 part: lifetime counts, Sea Glass sold, mastery, the next Tide, a challenge won, feats with the Tavern', () => {
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
  assert.ok(kinds.includes('mastery'));
  assert.deepEqual(out.doc.profile.tide.unlocked, 1);
  assert.ok(out.changes.some((c) => c.kind === 'tide' && c.level === 1));
  assert.deepEqual(out.doc.profile.feats.sort(), ['dawn', 'lantern_night', 'maw_slayer']);
  assert.ok(out.changes.some((c) => c.kind === 'feat' && c.id === 'lantern_night' && c.unlocks.some((u) => u.what === 'arcana' && u.id === 'glassblower')));
  assert.ok(resolveContent(out.doc, DATA).arcana.includes('glassblower'));
  assert.equal(out.doc.profile.materials.coin, 10 + 20 + 150, 'the Sea Glass and Dawn\'s Coin');
  // No Market: the Sea Glass is lost; no Tavern: nobody counts feats.
  const bare = applyRunResult(make({}, {}), result({ end: 'cleared', seaGlass: 41, lanternNight: true }), DATA);
  assert.ok(!bare.changes.some((c) => c.kind === 'glass_coin' || c.kind === 'feat'));
  assert.deepEqual(bare.doc.profile.feats, []);
  // A Tide clear opens the next only from the highest opened.
  const t3 = make({ chapel: 5 }, {}, { tide: { unlocked: 3, selected: 3 } });
  assert.equal(applyRunResult(t3, result({ end: 'cleared', tide: 3 }), DATA).doc.profile.tide.unlocked, 4);
  assert.equal(applyRunResult(t3, result({ end: 'cleared', tide: 1 }), DATA).doc.profile.tide.unlocked, 3, 'a lower Tide opens nothing');
  assert.equal(applyRunResult(t3, result({ end: 'died', tide: 3 }), DATA).doc.profile.tide.unlocked, 3, 'only a clear');
  // A challenge won once: its reward, then never again.
  const ch = make({ cartographer: 3 }, {});
  const won = applyRunResult(ch, result({ challenge: 'flood', timeSurvived: 500 }), DATA);
  assert.deepEqual(won.doc.profile.challenges, ['flood']);
  assert.deepEqual(won.doc.profile.materials, { map_scraps: 6, iron: 8 });
  assert.ok(!applyRunResult(won.doc, result({ challenge: 'flood', timeSurvived: 500 }), DATA).changes.some((c) => c.kind === 'challenge'));
});

// ---------------------------------------------------------------- the gate: run config and setup

test('run config: the gate\'s choices, each checked against what the profile has opened', () => {
  const base = make();
  assert.deepEqual(modesOpen(base, DATA), ['standard']);
  assert.deepEqual(modesOpen(make({ cartographer: 4 }), DATA), ['standard', 'short', 'challenge']);
  assert.throws(() => runConfigFor(base, DATA, { character: 'lamplighter', seed: 1, mode: 'short' }), (e) => e instanceof MetaError && /Short runs open at the Cartographer/.test(e.message));
  // The Tide and curses: the Chapel's level and what clears have opened.
  const ch = make({ chapel: 2 }, RICH, { tide: { unlocked: 9, selected: 0 } });
  assert.throws(() => runConfigFor(ch, DATA, { character: 'lamplighter', seed: 1, tide: 5 }), /Tide 5 isn't open yet/);
  assert.throws(() => runConfigFor(ch, DATA, { character: 'lamplighter', seed: 1, curses: [DATA.curses[4].id] }), /curse isn't open yet/);
  const cfg = runConfigFor(ch, DATA, { character: 'lamplighter', seed: 1, tide: 4, curses: ['brittle', 'swarm'] });
  const T4 = DATA.tides[3], cs = DATA.curses.filter((c) => ['brittle', 'swarm'].includes(c.id));
  assert.equal(cfg.tide, 4);
  assert.ok(Math.abs(cfg.densityMul - T4.densityMul * cs.reduce((m, c) => m * (c.densityMul ?? 1), 1)) < 1e-9);
  assert.ok(Math.abs(cfg.rewardMul - (1 + T4.rewardMul + cs.reduce((s, c) => s + c.rewardMul, 0))) < 1e-9);
  assert.deepEqual(cfg.curses, ['brittle', 'swarm']);
  // A challenge run sets its own character, Tide, curses, and empty pools.
  const cc = runConfigFor(make({ cartographer: 3 }), DATA, { character: 'harpooner', seed: 1, mode: 'challenge', challenge: 'flood' });
  assert.deepEqual([cc.character, cc.tide, cc.curses, cc.challenge, cc.mode], ['lamplighter', 4, ['swarm'], 'flood', 'standard']);
  const lo = runConfigFor(make({ cartographer: 3 }), DATA, { character: 'lamplighter', seed: 1, mode: 'challenge', challenge: 'lamp_only' });
  assert.deepEqual(lo.pools.weapons, []);
  assert.throws(() => runConfigFor(make({ cartographer: 3 }), DATA, { character: 'lamplighter', seed: 1, mode: 'challenge', challenge: 'nope' }), /Choose a challenge/);
  // Consumables: held, and no more than the slots.
  const ap = make({ apothecary: 1 }, RICH, { consumables: { tallow_tonic: 1, smelling_salts: 1, glass_pouch: 1, 'rune:splitting': 1 } });
  assert.throws(() => runConfigFor(ap, DATA, { character: 'lamplighter', seed: 1, consumables: ['tallow_tonic', 'smelling_salts'] }), /Only 1 consumables/);
  assert.throws(() => runConfigFor(ap, DATA, { character: 'lamplighter', seed: 1, consumables: ['gull_bone'] }), /No Gull Bone held/);
  const one = runConfigFor(ap, DATA, { character: 'lamplighter', seed: 1, consumables: ['glass_pouch'], rune: 'splitting' });
  assert.equal(one.startGlass, 20);
  assert.equal(one.startRune, 'splitting');
  assert.throws(() => runConfigFor(ap, DATA, { character: 'lamplighter', seed: 1, rune: 'orbiting' }), /No Orbiting stone held/);
  // The harbor's part, and the world takes all of it.
  assert.deepEqual(harborForRun(make({ docks: 4, lamp_post: 5, chapel: 3, cartographer: 5 }), DATA), { ferry: 4, lampSpeed: 0.5, bellRing: 0.25, tasksOnMap: 1, secretsOnMap: 1 });
  for (const c of [cfg, cc, lo, one]) assert.ok(createWorld(c, DATA));
  // Setting out uses up what it took and keeps the choices for next time.
  const left = startRunProfile(ap, DATA, { character: 'lamplighter', consumables: ['glass_pouch'], rune: 'splitting', tide: 0, curses: [] });
  assert.deepEqual(left.profile.consumables, { tallow_tonic: 1, smelling_salts: 1 });
  assert.equal(left.profile.setup.character, 'lamplighter');
  assert.deepEqual(left.profile.setup.consumables, [], 'what was used up isn\'t chosen again by itself');
});

test('setup: the gate shows only the rows the harbor has opened, starts from the last choices still open, and says what each does', () => {
  const fresh = defaultProfile();
  assert.deepEqual(setupRows(fresh, DATA, startChoice(fresh, DATA, 'lamplighter')), [], 'nothing to choose: the gate sets out at once');
  const ranks = DATA.tuning.mastery.ranks;
  const d = make({ chapel: 3, cartographer: 4, apothecary: 3, smithy: 4, tavern: 1 }, RICH, {
    tide: { unlocked: 4, selected: 3 },
    characters: { lamplighter: { unlocked: true, masteryXp: ranks[3], perks: [] } },
    consumables: { tallow_tonic: 2, smelling_salts: 1, 'rune:splitting': 1, 'rune:orbiting': 1 },
    setup: { character: 'lamplighter', kit: '', mode: 'short', curses: ['brittle', 'fast_water'], arcana: 'nope', consumables: [], rune: '', challenge: '' },
  });
  const c = startChoice(d, DATA, 'lamplighter');
  assert.deepEqual([c.kit, c.mode, c.tide, c.curses, c.arcana], ['', 'short', 3, ['brittle'], ''], 'the last choices, held to what\'s open');
  const rows = setupRows(d, DATA, c), keys = rows.map((r) => r.key);
  assert.deepEqual(keys.slice(0, 3), ['kit', 'mode', 'tide']);
  assert.ok(keys.includes('curse:brittle') && !keys.includes('curse:fast_water'));
  assert.ok(keys.includes('slot:0') && keys.includes('slot:1') && keys.includes('rune') && keys.includes('arcana'));
  // Each row says what its value does.
  const row = (k, ch = c) => setupRows(d, DATA, ch).find((r) => r.key === k);
  assert.deepEqual(row('tide').detail, [tideText(DATA.tides[2])]);
  assert.deepEqual(row('curse:brittle').detail, ['-30% Max HP.', '+15% Materials']);
  assert.deepEqual(row('mode').detail, ['Last boss at 10:00, 40% Materials']);
  assert.deepEqual(row('kit').detail, ['Starting weapon: Flare Gun']);
  const arc = applyRow(c, 'arcana', 'high_water');
  assert.deepEqual(row('arcana', arc).detail, [DATA.arcana.find((a) => a.id === 'high_water').desc]);
  assert.equal(row('arcana', arc).icon, 'arcana_high_water');
  for (const r of rows) assert.ok(r.label.split(' ').length <= 4, r.label);
  // A rune stone only where the run's first weapon can take it: the Orb Kit's orbs take Orbiting
  // nowhere, Splitting not at all; a stone already chosen goes when the kit changes under it.
  const runes = (ch) => row('rune', ch)?.choices.map(([id]) => id) ?? [];
  assert.ok(runes(c).includes('splitting'), 'the Flare Gun takes Splitting');
  const orb = settleChoice(d, DATA, applyRow(applyRow(c, 'rune', 'splitting'), 'kit', 'lamplighter_orb'));
  assert.ok(!runes(orb).includes('splitting'));
  assert.equal(orb.rune, '', 'dropped, so it is never used up for nothing');
  assert.equal(stoneFits(d, DATA, { ...c, kit: 'lamplighter_orb' }, 'splitting'), false);
  assert.throws(() => checkStone(d, DATA, { ...c, kit: 'lamplighter_orb', rune: 'splitting' }), /doesn't fit the Lantern Orb/);
  // A slot keeps its place, and never offers what another slot holds.
  const c2 = applyRow(c, 'slot:1', 'smelling_salts');
  assert.deepEqual(c2.consumables, ['', 'smelling_salts'], 'set in the second slot, it stays there');
  assert.equal(row('slot:1', c2).value, 'smelling_salts');
  assert.ok(!row('slot:0', c2).choices.some(([id]) => id === 'smelling_salts'));
  assert.deepEqual(choiceForRun(c2).consumables, ['smelling_salts']);
  assert.deepEqual(applyRow(c2, 'slot:1', '').consumables, []);
  const c3 = applyRow(applyRow(c2, 'curse:swarm', true), 'curse:brittle', false);
  assert.deepEqual(c3.curses, ['swarm']);
  assert.deepEqual(choiceForRun({ ...c3, mode: 'standard' }), { character: 'lamplighter', mode: 'standard', tide: 3, curses: ['swarm'], consumables: ['smelling_salts'] });
  assert.equal(rewardText(DATA, { ...c3, tide: 3 }), `+${Math.round((DATA.tides[2].rewardMul + DATA.curses.find((x) => x.id === 'swarm').rewardMul) * 100)}% Materials`);
  assert.equal(rewardText(DATA, { ...c3, tide: 0, curses: [] }), null);
  // A challenge run: its own character, no kit, its Tide and curses' reward said; only those
  // whose character has arrived (no Tavern, no Harpooner, no Bare Hands); none at all, no mode.
  const chs = settleChoice(d, DATA, applyRow(c, 'mode', 'challenge'));
  const chRows = setupRows(d, DATA, chs).map((r) => r.key);
  assert.ok(chRows.includes('challenge') && !chRows.includes('tide') && !chRows.includes('kit') && !chRows.some((k) => k.startsWith('curse:')));
  const flood = { ...chs, challenge: 'flood' };
  assert.equal(rewardText(DATA, flood), `+${Math.round((DATA.tides[3].rewardMul + DATA.curses.find((x) => x.id === 'swarm').rewardMul) * 100)}% Materials`);
  assert.deepEqual(row('challenge', flood).detail, [DATA.challenges.find((x) => x.id === 'flood').desc, 'Reward: 6 Map Scraps, 8 Iron']);
  assert.equal(setsOutAs(DATA, { ...chs, character: 'harpooner', challenge: 'flood' }), 'lamplighter');
  const noTavern = make({ cartographer: 3 }, RICH);
  assert.deepEqual(challengesOpen(noTavern, DATA).map((x) => x.id), ['lamp_only', 'flood']);
  const settled = settleChoice(noTavern, DATA, { ...startChoice(noTavern, DATA, 'lamplighter'), mode: 'challenge', challenge: 'bare_hands' });
  assert.equal(settled.challenge, 'lamp_only', 'a challenge that can\'t set out is never the one chosen');
  const nobody = { ...DATA, challenges: DATA.challenges.filter((x) => x.character === 'harpooner') };
  assert.ok(!(setupRows(noTavern, nobody, startChoice(noTavern, nobody, 'lamplighter')).find((r) => r.key === 'mode')?.choices ?? []).some(([m]) => m === 'challenge'), 'no challenge mode with none to run');
  // Every value every row offers, in every mode, is one the run config takes (and its stone fits).
  for (const doc of [d, noTavern]) {
    const modes = setupRows(doc, DATA, startChoice(doc, DATA, 'lamplighter')).find((r) => r.key === 'mode')?.choices.map(([m]) => m) ?? ['standard'];
    for (const mode of modes) {
      const base = settleChoice(doc, DATA, { ...startChoice(doc, DATA, 'lamplighter'), mode });
      for (const r of setupRows(doc, DATA, base)) for (const [v] of r.choices || [[true], [false]]) {
        const pick = settleChoice(doc, DATA, applyRow(base, r.key, v));
        assert.doesNotThrow(() => { runConfigFor(doc, DATA, { ...choiceForRun(pick), seed: 1 }); checkStone(doc, DATA, pick); }, `${mode}: ${r.key} = ${v}`);
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
    feats: ['dawn', 'swim_far'], featsFound: ['untouched'], challenges: ['flood', 'later_one'],
    consumables: { tallow_tonic: 2, moon_oil: 4, 'rune:splitting': 1, 'rune:later': 1, smelling_salts: 0 },
    bestiaryClaimed: { fog_wisp: 9, kraken: 2 },
    setup: { character: 'lamplighter', mode: 'sideways', curses: ['brittle', 'nope'], arcana: 'nope', consumables: ['tallow_tonic', 'x'], rune: 'splitting', challenge: 'flood' },
  });
  const { doc, moved } = reconcileProfile(d, DATA);
  const G = doc.profile.gear;
  assert.deepEqual(G.inventory.map((x) => [x.uid, x.id, x.tier]), [[1, 'storm_lantern', 5], [2, 'harbor_coat', 1]], 'a tier held to 5; a uid used twice gets a new one');
  assert.deepEqual(G.inventory[0].affixes, ['fire_volley', 'from_later'], 'an affix this build doesn\'t know stays on the item');
  assert.equal(G.next, 3);
  assert.equal(G.rolls, 0);
  assert.deepEqual(G.equipped, { lantern: 1 }, 'worn only what\'s held, in its own slot');
  assert.deepEqual(doc.profile.orphans.gear.map((x) => x.id), ['glass_sword']);
  assert.deepEqual([doc.profile.feats, doc.profile.challenges], [['dawn'], ['flood']]);
  assert.deepEqual([doc.profile.orphans.feats, doc.profile.orphans.challenges], [['swim_far'], ['later_one']]);
  assert.deepEqual(doc.profile.consumables, { tallow_tonic: 2, 'rune:splitting': 1 });
  assert.deepEqual(doc.profile.orphans.consumables, { moon_oil: 4, 'rune:later': 1 });
  assert.deepEqual(doc.profile.bestiaryClaimed, { fog_wisp: DATA.meta.bestiaryMilestones.length });
  assert.equal(doc.profile.orphans.bestiaryClaimed.kraken, 2);
  assert.deepEqual(doc.profile.setup, { character: 'lamplighter', kit: '', mode: 'standard', curses: ['brittle'], arcana: '', consumables: ['tallow_tonic'], rune: 'splitting', challenge: 'flood' });
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

test('next up: Phase 7\'s goals join the list: gear not made, a worn item\'s next tier, a perk earned, a consumable none held', () => {
  const ranks = DATA.tuning.mastery.ranks;
  const d = make({ smithy: 2, tavern: 2, apothecary: 1 }, { coin: 40 }, { characters: { lamplighter: { unlocked: true, masteryXp: ranks[0], perks: [] } } });
  const kinds = (doc) => purchaseOptions(doc, DATA).map((o) => `${o.kind}:${o.id}`);
  const k = kinds(d);
  for (const r of DATA.recipes) assert.equal(k.includes(`craft:${r.id}`), r.id !== 'bosun_coat', `${r.id}: research opened it (Bosun's Coat waits on its challenge)`);
  assert.ok(k.includes('perk:trimmed_wick') && !k.includes('perk:oil_reserve'), 'a perk its rank allows, not the next');
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
  assert.ok(!kinds(make({ apothecary: 1 }, RICH, { consumables: { smelling_salts: 1 } })).includes('consumable:smelling_salts'));
  // They compete with the rest on how close they are, and the panels name them.
  const top = nextAffordable(make({ smithy: 1, lamp_post: 5, library: 5, tavern: 5 }, { iron: 2, oil: 16, coin: 40 }), DATA, 99);
  const lantern = top.find((o) => o.kind === 'craft' && o.id === 'storm_lantern');
  const short = top.findIndex((o) => o.progress < 1);
  assert.ok(lantern && (short < 0 || top.indexOf(lantern) < short), 'affordable now: ahead of anything short');
  assert.deepEqual(optionText(DATA, lantern), { title: 'Storm Lantern', where: 'Smithy', readyAt: 'Ready at Smithy', progress: 1, need: null });
  assert.equal(optionText(DATA, { ...tier, missing: [] }).title, 'Storm Lantern T2');
});

test('apply and reconcile: unknown bosses count for nothing; a challenge\'s Tide skips none; claims set aside come back; Tides held to the build', () => {
  const out = applyRunResult(make({}, {}), result({ timeSurvived: 120, bossesKilled: ['nope', { id: 'harbor_maw' }, { id: 'also_nope' }] }), DATA).doc;
  assert.equal(out.stats.bossKills, 1);
  assert.equal(out.profile.characters.lamplighter.masteryXp, 2 * DATA.tuning.mastery.perMinute + DATA.tuning.mastery.perBoss);
  const skip = applyRunResult(make({ cartographer: 3 }, {}), result({ challenge: 'flood', end: 'cleared', cleared: true, tide: 4, timeSurvived: 1300 }), DATA).doc;
  assert.equal(skip.profile.tide.unlocked, 0, 'a clear at Tide 4 with nothing opened opens nothing');
  // Claims set aside for an enemy this build didn't know, back when it does; never paid twice.
  const later = { ...DATA, enemies: [...DATA.enemies, { ...DATA.enemies[0], id: 'kraken', name: 'Kraken' }] };
  const d = make({ cartographer: 2 }, {}, { bestiary: { kraken: 500 }, bestiaryClaimed: { kraken: 2 } });
  const here = reconcileProfile(d, DATA).doc;
  assert.equal(here.profile.orphans.bestiaryClaimed.kraken, 2);
  const back = reconcileProfile(here, later);
  assert.equal(back.doc.profile.bestiaryClaimed.kraken, 2);
  assert.equal(back.doc.profile.orphans.bestiaryClaimed, undefined);
  assert.ok(back.restored.includes('bestiaryClaimed:kraken'));
  assert.equal(W.whyNotClaim(back.doc, later, 'kraken'), 'Need 1000 kills (500)', 'the two claimed stay claimed');
  // The Tide record: held to this build's 10 (the rest set aside), the choice a whole number within it.
  const odd = make({}, {}, { tide: { unlocked: 14, selected: 2.5 } });
  const t = reconcileProfile(odd, DATA).doc;
  assert.deepEqual([t.profile.tide.unlocked, t.profile.tide.selected, t.profile.orphans.tide.unlocked], [10, 2, 14]);
  const more = { ...DATA, tides: [...DATA.tides, ...DATA.tides.slice(0, 5).map((x, i) => ({ ...x, level: 11 + i }))] };
  assert.equal(reconcileProfile(t, more).doc.profile.tide.unlocked, 14, 'a build with more Tides gives them back');
  assert.deepEqual(reconcileProfile(make({}, {}, { tide: { unlocked: -3, selected: 'x' } }), DATA).doc.profile.tide, { unlocked: 0, selected: 0 });
  assert.throws(() => runConfigFor(make(), DATA, { character: 'lamplighter', seed: 1, tide: 1.5 }), /whole number/);
  assert.throws(() => runConfigFor(make(), DATA, { character: 'lamplighter', seed: 1, tide: '1' }), /whole number/);
  // A challenge run keeps the last Tide and curses chosen.
  const kept = startRunProfile(make({}, {}, { tide: { unlocked: 3, selected: 3 }, setup: { curses: ['brittle'] } }), DATA, { character: 'lamplighter', mode: 'challenge', challenge: 'flood' });
  assert.deepEqual([kept.profile.tide.selected, kept.profile.setup.curses], [3, ['brittle']]);
});

test('workshop: every Phase 7 writer leaves the rest of the profile alone (an update can never wipe progress, §12.2)', () => {
  const ranks = DATA.tuning.mastery.ranks;
  const base = make({ smithy: 5, market: 5, apothecary: 5, cartographer: 5, tavern: 5, docks: 2 }, RICH, {
    bestiary: { fog_wisp: 50 }, codex: ['weapon:flare_gun'], feats: ['dawn'], challenges: ['flood'], tide: { unlocked: 2, selected: 1 },
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
  same(W.cutRuneStone(d, DATA, 'splitting').doc, ['materials', 'consumables'], 'a rune stone');
  same(W.marketTrade(d, DATA, 'coin', 'oil').doc, ['materials'], 'a trade');
  same(W.buyConsumable(d, DATA, 'smelling_salts').doc, ['materials', 'consumables'], 'a consumable');
  same(W.claimBestiary(d, DATA, 'fog_wisp').doc, ['materials', 'bestiaryClaimed'], 'a claim');
  same(W.trainPerk(d, DATA, 'trimmed_wick').doc, ['materials', 'characters'], 'training');
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
