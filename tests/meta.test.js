// The meta layer (ARCHITECTURE §10, src/meta/): what the profile says and how it changes. A run
// folded in, the harbor's purchases, the pools and modifiers a run gets, the next-3 list, the
// completion number, and saves from other builds reconciled. Every function is pure: each test
// also checks the document passed in never changes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DATA } from '../src/data/index.js';
import { defaultProfile } from '../src/save/schema.js';
import { migrateProfile } from '../src/save/migrations.js';
import { unwrap } from '../src/save/envelope.js';
import {
  parseUnlock, levelOf, reached, researchSlots, researchTier, treeTier, resolveContent, contentFrom, buildingStage,
  revealedFog, completion, codexKeys, restoreBuilding, whyNotRestore, buyUpgrade, whyNotUpgrade, startResearch,
  whyNotResearch, MetaError, applyRunResult, qualifies, waitingReason, nextAffordable, purchaseOptions, runConfigFor, upgradeMods,
  reconcileProfile, canPay, missing, pay, scale, progress, shortText, nextRankCost, researchActive,
  devAddMaterials, devUnlockAll, allUnlocked, droppedMaterials, DEV_MATERIALS_MAX, researchDone,
} from '../src/meta/index.js';
import { createWorld, stepWorld, decide, currentHalt } from '../src/sim/world.js';
import { buildRunResult } from '../src/sim/run-result.js';
import { joinList, clockText, midSentence } from '../src/lib/text.js';
import { createKiteBot } from '../src/sim/bot.js';

const fresh = () => defaultProfile();
function withMats(doc, mats) { const d = structuredClone(doc); Object.assign(d.profile.materials, mats); return d; }
function withLevels(doc, levels) { const d = structuredClone(doc); Object.assign(d.profile.buildings, levels); return d; }
const RICH = { coin: 99999, oil: 99999, timber: 99999, rope: 99999, drowned_pages: 99999, rum: 99999, iron: 99999, map_scraps: 99999 };
function frozenCopy(doc) { return JSON.stringify(doc); }
/** Materials after paying a cost. */
function spent(have, cost) { const out = { ...have }; for (const [id, n] of Object.entries(cost)) out[id] -= n; return out; }
function result(over = {}) {
  return {
    v: 1, seed: 1, map: 'drowned_docks', mode: 'standard', character: 'lamplighter', end: 'died', timeSurvived: 400, ticks: 24000,
    level: 12, kills: { fog_wisp: 150, drowned_sailor: 40 }, totalKills: 190, elitesKilled: 0, bossesKilled: [], cleared: false,
    weapons: [{ id: 'flare_gun', slot: 0, level: 5, runes: [], damage: 900 }], weaponLevelMax: { flare_gun: 5 }, maxWeaponLevel: 5,
    passives: [{ id: 'wick_oil', level: 2 }], relics: [], runes: [], evolutions: [], tags: {},
    materials: { coin: 40, oil: 22, drowned_pages: 9 }, damageTaken: 120, dashKills: 0, revivalsUsed: 0, gems: 300, chests: 0,
    overtimeMinutes: 0, secretsFound: [], rerolls: 0, skips: 0, banished: [],
    ...over,
  };
}

test('meta: unlock keys read as their kind, and anything else is unknown', () => {
  assert.deepEqual(parseUnlock('starter'), { kind: 'starter' });
  assert.deepEqual(parseUnlock('research:tide_charts'), { kind: 'research', id: 'tide_charts' });
  assert.deepEqual(parseUnlock('building:tavern:3'), { kind: 'building', id: 'tavern', level: 3 });
  assert.deepEqual(parseUnlock('evolution'), { kind: 'evolution' });
  for (const bad of ['research:', 'building:tavern', 'building:tavern:0', 'building:tavern:x', 'feat:x', 42, null, 'research:a:b']) {
    assert.equal(parseUnlock(bad).kind, 'unknown', String(bad));
  }
});

test('meta: building levels, reached keys, and what the levels open', () => {
  const d = withLevels(fresh(), { library: 3, lamp_post: 2, tavern: 99 });
  assert.equal(levelOf(d, 'library', DATA), 3);
  assert.equal(levelOf(d, 'tavern', DATA), 5, 'held at the last level');
  assert.equal(levelOf(d, 'smithy', DATA), 0);
  assert.equal(levelOf(withLevels(fresh(), { library: -2 }), 'library', DATA), 0);
  assert.ok(reached(d, 'start') && reached(d, 'library:3') && !reached(d, 'library:4') && !reached(d, 'nonsense'));
  assert.equal(researchSlots(fresh(), DATA), 0, 'no Library, no research');
  assert.equal(researchSlots(d, DATA), 2);
  assert.equal(researchTier(d, DATA), 2);
  assert.equal(treeTier(d, DATA), 2);
  assert.equal(researchSlots(withLevels(fresh(), { library: 5 }), DATA), 3);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(buildingStage), ['ruin', 'scaffold', 'roof', 'lit', 'keeper', 'alive']);
  assert.equal(buildingStage(9), 'alive');
});

test('meta: a new profile starts with the starter content; research and the Tavern add the rest', () => {
  const c = resolveContent(fresh(), DATA);
  assert.deepEqual(c.characters, ['lamplighter']);
  assert.deepEqual(c.weapons, ['flare_gun', 'harpoon_chain']);
  assert.deepEqual(c.relics, []);
  assert.deepEqual(c.runes.sort(), ['burning_ground', 'splitting']);
  assert.ok(!c.passives.includes('undertow') && c.passives.includes('wick_oil'));
  // Everything the data has comes from somewhere a profile can reach.
  const all = structuredClone(fresh());
  all.profile.research.done = DATA.research.map((r) => r.id);
  for (const b of DATA.buildings) all.profile.buildings[b.id] = b.levels.length;
  all.profile.codex = DATA.maps.flatMap((m) => (m.secrets || []).map((x) => `secret:${x.id}`)); // every secret found
  const full = resolveContent(all, DATA);
  const pickable = (list) => list.filter((x) => x.unlock !== 'evolution' && !x.innate).map((x) => x.id).sort();
  assert.deepEqual(full.weapons.sort(), pickable(DATA.weapons));
  assert.deepEqual(full.passives.sort(), pickable(DATA.passives));
  assert.deepEqual(full.relics.sort(), pickable(DATA.relics));
  assert.deepEqual(full.runes.sort(), pickable(DATA.runes));
  assert.deepEqual(full.characters.sort(), DATA.characters.map((x) => x.id).sort());
  // Content a key brings, by name, for the panels.
  assert.deepEqual(contentFrom(DATA, 'research:tide_charts').map((x) => `${x.what}:${x.id}`), ['weapon:tide_bell', 'passive:undertow']);
  assert.deepEqual(contentFrom(DATA, 'building:tavern:1').map((x) => x.id), ['harpooner']);
});

test('meta: costs are checked, paid, scaled, and described plainly', () => {
  const have = { coin: 10, oil: 3 };
  assert.ok(canPay(have, { coin: 10 }) && !canPay(have, { coin: 11 }) && !canPay(have, { rope: 1 }));
  assert.deepEqual(missing(have, { coin: 12, oil: 3, rope: 2 }), [{ id: 'coin', need: 2 }, { id: 'rope', need: 2 }]);
  assert.deepEqual(pay(have, { coin: 10, oil: 1 }), { oil: 2 }, 'spent materials drop out');
  assert.deepEqual(have, { coin: 10, oil: 3 }, 'the materials passed in are untouched');
  assert.throws(() => pay(have, { coin: 11 }), /not enough/);
  assert.deepEqual(scale({ oil: 8, coin: 6 }, 3), { oil: 24, coin: 18 });
  assert.equal(progress({ coin: 5 }, { coin: 10, oil: 10 }), 0.25);
  assert.equal(progress({ coin: 50 }, { coin: 10 }), 1, 'more than enough counts as enough');
  assert.equal(shortText(DATA, { coin: 5 }, { coin: 10, drowned_pages: 4, rope: 1 }), '5 Coin, 4 Drowned Pages, 1 Rope');
  assert.equal(shortText(DATA, {}, { coin: 3, oil: 2 }), '3 Coin, 2 Oil');
});

test('meta: restoring a building pays, levels up, and says what it opened; the input never changes', () => {
  // (The costs come from the data, so tuning them never breaks this; the wording is what's checked.)
  const cost = DATA.buildings.find((b) => b.id === 'tavern').levels[0].cost;
  const d = withMats(fresh(), { ...cost, coin: cost.coin + 10 });
  const snap = frozenCopy(d);
  assert.equal(whyNotRestore(fresh(), DATA, 'tavern'), `Need ${cost.coin} Coin, ${cost.rum} Rum, ${cost.timber} Timber`);
  const { doc, changes } = restoreBuilding(d, DATA, 'tavern');
  assert.equal(frozenCopy(d), snap);
  assert.equal(levelOf(doc, 'tavern', DATA), 1);
  assert.deepEqual(doc.profile.materials, { coin: 10 });
  assert.equal(changes.length, 1);
  assert.deepEqual(changes[0], { kind: 'building_level', id: 'tavern', level: 1, cost, unlocks: [{ what: 'character', id: 'harpooner' }] });
  assert.ok(resolveContent(doc, DATA).characters.includes('harpooner'));
  // Fully restored, unknown, or unaffordable: refused with the reason.
  const max = withLevels(withMats(fresh(), RICH), { library: 5 });
  assert.equal(whyNotRestore(max, DATA, 'library'), 'Already at max level');
  assert.throws(() => restoreBuilding(max, DATA, 'library'), (e) => e instanceof MetaError && /max level/.test(e.message));
  assert.match(whyNotRestore(fresh(), DATA, 'smithy'), /no building called "smithy"/);
  // Level by level, the Lamp Post to the top.
  let lp = withMats(fresh(), RICH);
  for (let lv = 1; lv <= 5; lv++) { lp = restoreBuilding(lp, DATA, 'lamp_post').doc; assert.equal(levelOf(lp, 'lamp_post', DATA), lv); }
});

test('meta: Lamp Post upgrades open by tier, cost more each rank, and stop at their last', () => {
  const rich = withMats(fresh(), RICH);
  assert.equal(whyNotUpgrade(rich, DATA, 'bright_flame'), 'Requires Lamp Post Lv 1');
  let d = withLevels(rich, { lamp_post: 1 });
  assert.equal(whyNotUpgrade(d, DATA, 'quick_step'), 'Requires Lamp Post Lv 2');
  const u = DATA.upgrades.find((x) => x.id === 'bright_flame');
  assert.deepEqual(nextRankCost(d, DATA, 'bright_flame'), u.cost);
  const snap = frozenCopy(d);
  const r1 = buyUpgrade(d, DATA, 'bright_flame');
  assert.equal(frozenCopy(d), snap);
  assert.deepEqual(r1.changes, [{ kind: 'upgrade_rank', id: 'bright_flame', rank: 1, cost: u.cost }]);
  assert.deepEqual(r1.doc.profile.materials, spent(RICH, u.cost), 'a rank takes its cost');
  assert.deepEqual(buyUpgrade(r1.doc, DATA, 'bright_flame').doc.profile.materials, spent(spent(RICH, u.cost), scale(u.cost, 2)), 'and the next rank its own');
  assert.deepEqual(nextRankCost(r1.doc, DATA, 'bright_flame'), scale(u.cost, 2), 'rank 2 costs twice rank 1');
  d = r1.doc;
  for (let r = 2; r <= u.ranks; r++) d = buyUpgrade(d, DATA, 'bright_flame').doc;
  assert.equal(d.profile.upgrades.bright_flame, u.ranks);
  assert.equal(whyNotUpgrade(d, DATA, 'bright_flame'), 'Already at max rank');
  assert.equal(nextRankCost(d, DATA, 'bright_flame'), null);
  const poor = withLevels(fresh(), { lamp_post: 1 });
  assert.match(whyNotUpgrade(poor, DATA, 'bright_flame'), /^Need /);
  assert.throws(() => buyUpgrade(poor, DATA, 'bright_flame'), MetaError);
});

test('meta: research needs the Library, its tier, what it requires, a free slot, and the cost', () => {
  const rich = withMats(fresh(), RICH);
  assert.equal(whyNotResearch(rich, DATA, 'orbwright'), 'Requires Library Lv 1');
  let d = withLevels(rich, { library: 1 });
  assert.equal(whyNotResearch(d, DATA, 'almanac'), 'Requires Library Lv 2');
  assert.equal(whyNotResearch(d, DATA, 'orbwright'), null);
  const snap = frozenCopy(d);
  const s1 = startResearch(d, DATA, 'orbwright');
  assert.equal(frozenCopy(d), snap);
  assert.deepEqual(s1.doc.profile.research.active, [{ id: 'orbwright', runsLeft: 1 }]);
  assert.deepEqual(s1.doc.profile.materials, spent(RICH, DATA.research.find((r) => r.id === 'orbwright').cost), 'a project takes its cost');
  assert.equal(s1.changes[0].kind, 'research_started');
  assert.equal(whyNotResearch(s1.doc, DATA, 'orbwright'), 'Already in progress');
  assert.equal(whyNotResearch(s1.doc, DATA, 'tide_charts'), 'Research slots full (1/1)');
  // Two slots at Library level 3; requirements named.
  d = withLevels(rich, { library: 3 });
  assert.equal(whyNotResearch(d, DATA, 'reversed_runes'), 'Requires research: Rune Stones');
  d = startResearch(d, DATA, 'rune_stones').doc;
  d = startResearch(d, DATA, 'tide_charts').doc;
  assert.equal(whyNotResearch(d, DATA, 'almanac'), 'Research slots full (2/2)');
  d.profile.research.done = ['orbwright'];
  assert.equal(whyNotResearch(d, DATA, 'orbwright'), 'Already complete');
  const broke = withLevels(fresh(), { library: 1 });
  assert.match(whyNotResearch(broke, DATA, 'orbwright'), /^Need 8 Drowned Pages, 20 Coin$/);
  assert.match(whyNotResearch(fresh(), DATA, 'nope'), /no research called/);
});

test('meta: a run brings its materials home, moves research on if it counts, and records what it saw', () => {
  let d = withLevels(withMats(fresh(), RICH), { library: 3 });
  d = startResearch(d, DATA, 'orbwright').doc;          // 1 run
  d = startResearch(d, DATA, 'tide_charts').doc;        // 2 runs
  d.profile.materials = { coin: 5 };
  const snap = frozenCopy(d);
  const r = result();
  const { doc, changes } = applyRunResult(d, r, DATA);
  assert.equal(frozenCopy(d), snap, 'the input is untouched');
  assert.deepEqual(doc.profile.materials, { coin: 45, oil: 22, drowned_pages: 9 });
  assert.deepEqual(changes.filter((c) => c.kind === 'material'), [{ kind: 'material', id: 'coin', count: 40 }, { kind: 'material', id: 'oil', count: 22 }, { kind: 'material', id: 'drowned_pages', count: 9 }]);
  // Research: the one-run project finished (with what it adds), the other moved on.
  assert.deepEqual(changes.find((c) => c.kind === 'research_step'), { kind: 'research_step', id: 'tide_charts', runsLeft: 1 });
  assert.deepEqual(changes.find((c) => c.kind === 'research_done'), { kind: 'research_done', id: 'orbwright', unlocks: [{ what: 'weapon', id: 'lantern_orb' }] });
  assert.deepEqual(doc.profile.research.active, [{ id: 'tide_charts', runsLeft: 1 }]);
  assert.deepEqual(doc.profile.research.done, ['orbwright']);
  assert.ok(resolveContent(doc, DATA).weapons.includes('lantern_orb'));
  // Stats.
  assert.equal(doc.stats.runs, 1); assert.equal(doc.stats.deaths, 1); assert.equal(doc.stats.kills, 190); assert.equal(doc.stats.playtimeSec, 400);
  assert.equal(doc.stats.bestTimeSec, 400);
  assert.ok(!changes.some((c) => c.kind === 'best_time'), 'the first run sets the best without a fanfare');
  // The codex and the bestiary.
  assert.deepEqual(changes.filter((c) => c.kind === 'codex').map((c) => c.key), ['weapon:flare_gun', 'passive:wick_oil']);
  assert.deepEqual(changes.filter((c) => c.kind === 'bestiary'), [{ kind: 'bestiary', id: 'fog_wisp', kills: 10 }, { kind: 'bestiary', id: 'fog_wisp', kills: 100 }, { kind: 'bestiary', id: 'drowned_sailor', kills: 10 }]);
  // A second, short run that leaves: no research step, but it says why; best time holds.
  const second = applyRunResult(doc, result({ timeSurvived: 90, end: 'left', materials: {}, kills: { fog_wisp: 20 }, totalKills: 20 }), DATA);
  assert.deepEqual(second.doc.profile.research.active, [{ id: 'tide_charts', runsLeft: 1 }]);
  assert.match(second.changes.find((c) => c.kind === 'research_waiting').reason, /5:00 or kill a boss/);
  assert.equal(second.doc.stats.deaths, 1, 'leaving is not a death');
  assert.equal(second.doc.stats.bestTimeSec, 400);
  assert.ok(!second.changes.some((c) => c.kind === 'codex'), 'the codex notes a thing once');
  // A short run that kills a boss still counts.
  const boss = applyRunResult(doc, result({ timeSurvived: 200, bossesKilled: [{ id: 'harbor_maw', time: 190, weapons: [] }] }), DATA);
  assert.ok(boss.changes.some((c) => c.kind === 'research_done' && c.id === 'tide_charts'));
  // A longer run: a best time worth mentioning.
  const best = applyRunResult(doc, result({ timeSurvived: 700 }), DATA);
  assert.deepEqual(best.changes.find((c) => c.kind === 'best_time'), { kind: 'best_time', seconds: 700, previous: 400 });
  // No research running: nothing said about research.
  assert.ok(!applyRunResult(fresh(), result(), DATA).changes.some((c) => c.kind.startsWith('research')));
  assert.equal(qualifies({ timeSurvived: 299.99, bossesKilled: [] }, DATA), false);
  assert.equal(qualifies({ timeSurvived: 300, bossesKilled: [] }, DATA), true);
  assert.throws(() => applyRunResult(fresh(), null, DATA), /no run result/);
});

test('meta: junk in a run result never corrupts the profile', () => {
  const junk = result({ materials: { coin: -5, oil: 2.9, drowned_pages: 'x', rum: NaN, unknown_thing: 50 }, kills: { fog_wisp: -1, drowned_sailor: 3.5 }, totalKills: 'many', timeSurvived: -40 });
  const { doc } = applyRunResult(fresh(), junk, DATA);
  assert.deepEqual(doc.profile.materials, { oil: 2 });
  assert.deepEqual(doc.profile.bestiary, { drowned_sailor: 3 });
  assert.equal(doc.stats.kills, 0);
  assert.equal(doc.stats.playtimeSec, 0);
  // A time that isn't finite, and lists that aren't lists or hold junk: nothing thrown, nothing wiped.
  const seasoned = fresh();
  Object.assign(seasoned.stats, { runs: 9, playtimeSec: 50000, bestTimeSec: 900 });
  const odd = result({ timeSurvived: Infinity, weapons: 'x', passives: [null, 7], relics: [5, null], runes: [null, { weapon: 'flare_gun' }, 'splitting'], evolutions: {}, bossesKilled: 'yes', kills: 'lots', materials: { coin: Infinity, oil: 3 } });
  const after = applyRunResult(seasoned, odd, DATA).doc;
  assert.equal(after.stats.playtimeSec, 50000, 'an endless time adds nothing');
  assert.equal(after.stats.bestTimeSec, 900);
  assert.equal(after.stats.runs, 10);
  assert.deepEqual(after.profile.materials, { oil: 3 });
  assert.deepEqual(after.profile.codex, ['weapon:flare_gun', 'rune:splitting'], 'the level record still names the weapon');
  assert.equal(qualifies({ timeSurvived: Infinity, bossesKilled: 'yes' }, DATA), false);
  assert.equal(JSON.parse(JSON.stringify(after)).stats.playtimeSec, 50000, 'and it saves as a number');
});

test('meta: a real run\'s result folds in: a placed rune, a relic, and the weapon it evolved from reach the codex', () => {
  // The sim's own record, not a hand-built one: runes come as { weapon, rune }.
  const w = createWorld({ seed: 'codex', character: 'lamplighter', map: 'drowned_docks' }, DATA);
  w.eventsPerTick = true;
  const bot = createKiteBot({ archetype: 'projectile_storm' });
  decide(w, { kind: 'dev', cmd: 'give', what: 'relic', id: 'volatile_gems' });
  decide(w, { kind: 'dev', cmd: 'give', what: 'rune', id: 'splitting' });
  for (let t = 0; t < 120; t++) {
    let g = 0;
    while (currentHalt(w) && g++ < 20) decide(w, bot.decide(w, currentHalt(w)));
    stepWorld(w, bot.input(w));
  }
  decide(w, { kind: 'leave' });
  const res = buildRunResult(w);
  assert.ok(res.runes.some((r) => r.rune === 'splitting'), 'the sim recorded the rune where it was placed');
  const { doc, changes } = applyRunResult(fresh(), res, DATA);
  for (const key of ['weapon:flare_gun', 'relic:volatile_gems', 'rune:splitting']) assert.ok(doc.profile.codex.includes(key), key);
  assert.ok(changes.some((c) => c.kind === 'codex' && c.key === 'rune:splitting'));
  // A weapon that evolved during the run: both it and what it became.
  const evolved = applyRunResult(fresh(), result({ weapons: [{ id: 'lighthouse_lens', slot: 0, level: 1 }], weaponLevelMax: { lantern_orb: 8, lighthouse_lens: 1 }, evolutions: ['lighthouse_lens'] }), DATA).doc;
  assert.ok(evolved.profile.codex.includes('weapon:lantern_orb') && evolved.profile.codex.includes('weapon:lighthouse_lens'));
  // The waiting note says the rule as it is.
  assert.equal(waitingReason({ researchQualifySec: 270, researchQualifyBoss: false }), "Research didn't progress. A run counts if you survive 4:30.");
  assert.equal(waitingReason(DATA.meta), "Research didn't progress. A run counts if you survive 5:00 or kill a boss.");
});

test('meta: the next three things you can nearly afford, affordable first', () => {
  const d = withMats(fresh(), { oil: 15, coin: 15, drowned_pages: 5 });
  const next = nextAffordable(d, DATA, 3);
  assert.equal(next.length, 3);
  assert.deepEqual(next[0], { kind: 'building', id: 'lamp_post', level: 1, cost: { oil: 15, coin: 15 }, progress: 1, missing: [] });
  assert.ok(next[1].progress >= next[2].progress);
  assert.ok(next.every((o) => o.kind === 'building'), 'with nothing restored, only buildings can be bought');
  // Upgrades appear once their tier is open; research only while a slot is free.
  let e = withLevels(withMats(fresh(), { oil: 1 }), { lamp_post: 1, library: 1 });
  const opts = purchaseOptions(e, DATA);
  assert.ok(opts.some((o) => o.kind === 'upgrade' && o.id === 'bright_flame' && o.rank === 1));
  assert.ok(!opts.some((o) => o.kind === 'upgrade' && o.id === 'quick_step'));
  assert.ok(opts.some((o) => o.kind === 'research' && o.id === 'orbwright'));
  e = withMats(e, RICH);
  e = startResearch(e, DATA, 'orbwright').doc;
  assert.ok(!purchaseOptions(e, DATA).some((o) => o.kind === 'research'), 'no free slot, no research on the list');
  assert.equal(nextAffordable(fresh(), DATA, 0).length, 0);
});

test('meta: a run from the harbor gets the profile\'s pools and the Lamp Post\'s upgrades', () => {
  let d = withLevels(withMats(fresh(), RICH), { lamp_post: 1 });
  d = buyUpgrade(d, DATA, 'thick_blood').doc;
  d = buyUpgrade(d, DATA, 'thick_blood').doc;
  d = buyUpgrade(d, DATA, 'bright_flame').doc;
  const cfg = runConfigFor(d, DATA, { character: 'lamplighter', seed: 'harbor-1' });
  assert.deepEqual(cfg.pools.weapons, ['flare_gun', 'harpoon_chain']);
  const per = DATA.upgrades.find((u) => u.id === 'thick_blood').mods[0].value;
  assert.deepEqual(upgradeMods(d, DATA), [{ stat: 'might', op: 'pct', value: 0.05 }, { stat: 'maxHp', op: 'add', value: per * 2 }]);
  const w = createWorld(cfg, DATA);
  stepWorld(w, { mx: 0, my: 0, buttons: 0 });
  assert.equal(w.stats.maxHp, DATA.characters.find((c) => c.id === 'lamplighter').base.maxHp + per * 2, 'two ranks of Thick Blood, from 0:00');
  assert.deepEqual(w.pools.weapons.map((x) => x.id), ['flare_gun', 'harpoon_chain'], 'locked weapons never show up');
  assert.throws(() => runConfigFor(fresh(), DATA, { character: 'harpooner', seed: 1 }), (e) => e instanceof MetaError && /hasn't arrived/.test(e.message));
  assert.throws(() => runConfigFor(fresh(), DATA, { character: 'nobody', seed: 1 }), /no character called/);
  // The sim checks what it's given, in plain words.
  const base = { seed: 1, character: 'lamplighter', map: 'drowned_docks' };
  const four = { weapons: ['flare_gun'], passives: [], relics: [], runes: [] };
  assert.throws(() => createWorld({ ...base, pools: { ...four, weapons: ['flare_gun', 'flare_gun'] } }, DATA), /pools\.weapons: "flare_gun" is listed twice/);
  assert.throws(() => createWorld({ ...base, pools: { ...four, weapons: 'flare_gun' } }, DATA), /pools\.weapons must be a list of ids/);
  assert.throws(() => createWorld({ ...base, pools: { ...four, gear: [] } }, DATA), /there is no "gear" pool/);
  assert.throws(() => createWorld({ ...base, pools: ['flare_gun'] }, DATA), /pools must be/);
  assert.throws(() => createWorld({ ...base, mods: { stat: 'maxHp' } }, DATA), /mods must be a list/);
  assert.throws(() => createWorld({ ...base, pools: { ...four, weapons: ['sunken_sword'] } }, DATA), /unknown weapon "sunken_sword"/);
  // A pool left out would quietly be everything (locked content too); an evolution or a
  // character's own weapon never goes in a pool.
  assert.throws(() => createWorld({ ...base, pools: { weapons: ['flare_gun'] } }, DATA), /pools: passives, relics, runes are missing/);
  assert.throws(() => createWorld({ ...base, pools: { ...four, weapons: ['flare_barrage'] } }, DATA), /the weapon "flare_barrage" is never drawn \(it comes from an evolution\)/);
  assert.throws(() => createWorld({ ...base, pools: { ...four, weapons: ['lamplight'] } }, DATA), /the weapon "lamplight" is never drawn \(it comes from its character\)/);
  assert.deepEqual(createWorld({ ...base, pools: four }, DATA).pools.passives, [], 'an empty list is an empty pool');
  // The Tavern's relics come level by level, into the run's config and the world built from it.
  const tavernRelics = (lv) => {
    const c = runConfigFor(withLevels(fresh(), { tavern: lv }), DATA, { character: 'lamplighter', seed: 's' });
    assert.deepEqual(createWorld(c, DATA).pools.relics.map((x) => x.id).sort(), [...c.pools.relics].sort(), 'the world draws what the config gives');
    return c.pools.relics;
  };
  assert.ok(!tavernRelics(1).includes('tide_clock') && tavernRelics(2).includes('tide_clock'), 'the Tide Clock at the Tavern\'s level 2');
  assert.ok(!tavernRelics(4).includes('glass_lantern') && tavernRelics(5).includes('glass_lantern'), 'the Glass Lantern at its level 5');
  const fresh4 = runConfigFor(fresh(), DATA, { character: 'lamplighter', seed: 's' });
  const content = resolveContent(fresh(), DATA);
  assert.deepEqual(fresh4.pools, { weapons: content.weapons, passives: content.passives, relics: content.relics, runes: content.runes }, 'each pool is the profile\'s own');
});

test('meta: completion counts buildings, upgrades, research, and the codex, from 0 to 100', () => {
  assert.equal(completion(fresh(), DATA).percent, 0);
  const all = withMats(fresh(), {});
  for (const b of DATA.buildings) all.profile.buildings[b.id] = b.levels.length;
  for (const u of DATA.upgrades) all.profile.upgrades[u.id] = u.ranks;
  all.profile.research.done = DATA.research.map((r) => r.id);
  all.profile.codex = codexKeys(DATA);
  const c = completion(all, DATA);
  assert.equal(c.percent, 100);
  assert.deepEqual(c.parts.map((p) => p.name), ['buildings', 'upgrades', 'research', 'codex']);
  const some = withLevels(fresh(), { lamp_post: 5 });
  const p = completion(some, DATA).percent;
  assert.ok(p > 0 && p < 100, `${p}%`);
});

test('meta: saves from other builds are reconciled: unknown things are kept aside, never lost', () => {
  const d = withMats(fresh(), { coin: 5, glowstone: 7 });
  d.profile.buildings = { lamp_post: 9, library: 2, observatory: 3 };
  d.profile.upgrades = { bright_flame: 12, feather_fall: 2 };
  d.profile.research = { done: ['orbwright', 'basics_1'], active: [{ id: 'tide_1', runsLeft: 1 }, { id: 'tide_charts', runsLeft: 2 }, 'junk', { id: 'orbwright', runsLeft: 1 }] };
  const snap = frozenCopy(d);
  const { doc, moved } = reconcileProfile(d, DATA);
  assert.equal(frozenCopy(d), snap);
  assert.deepEqual(doc.profile.materials, { coin: 5 });
  assert.deepEqual(doc.profile.buildings, { lamp_post: 5, library: 2 });
  assert.deepEqual(doc.profile.upgrades, { bright_flame: 5 });
  assert.deepEqual(doc.profile.research, { done: ['orbwright'], active: [{ id: 'tide_charts', runsLeft: 2 }] });
  const o = doc.profile.orphans;
  assert.equal(o.materials.glowstone, 7);
  assert.equal(o.buildings.observatory, 3); assert.equal(o.buildings.lamp_post, 9);
  assert.equal(o.upgrades.feather_fall, 2); assert.equal(o.upgrades.bright_flame, 12);
  assert.equal(o.research.basics_1, 'done'); assert.deepEqual(o.research.tide_1, { id: 'tide_1', runsLeft: 1 });
  assert.ok(moved.length >= 8);
  // A profile with nothing unknown comes back the same (a new document, never the one passed in).
  const clean = fresh();
  const again = reconcileProfile(clean, DATA);
  assert.deepEqual(again.doc, clean);
  assert.notEqual(again.doc, clean);
  assert.deepEqual([again.moved, again.restored], [[], []]);
});

test('meta: a save that goes between a newer build and an older one, and back, twice, loses nothing', () => {
  // Every .exe shares one save file: an older one can open what a newer one wrote.
  const NEWER = {
    ...DATA,
    materials: [...DATA.materials, { id: 'glowstone', name: 'Glowstone', desc: '', icon: 'mat_coin', maps: ['*'] }],
    research: [...DATA.research, { id: 'deep_charts', name: 'Deep Charts', desc: '', tier: 1, cost: { coin: 1 }, runs: 3, requires: [] }],
    weapons: [...DATA.weapons, { id: 'sunken_sword', name: 'Sunken Sword', unlock: 'research:deep_charts' }],
  };
  let d = withMats(fresh(), { coin: 5, glowstone: 50 });
  d.profile.research = { done: [], active: [{ id: 'deep_charts', runsLeft: 2 }] };
  d.profile.codex = ['weapon:flare_gun', 'weapon:sunken_sword'];
  d = reconcileProfile(d, NEWER).doc;
  for (let round = 1; round <= 2; round++) {
    // The older build: what it doesn't know is set aside.
    const old = reconcileProfile(d, DATA);
    assert.equal(old.doc.profile.materials.glowstone, undefined);
    assert.equal(old.doc.profile.orphans.materials.glowstone, round === 1 ? 50 : 53, `round ${round}: set aside, whole`);
    assert.deepEqual(old.doc.profile.orphans.research.deep_charts, { id: 'deep_charts', runsLeft: 2 });
    assert.ok(old.doc.profile.orphans.codex.includes('weapon:sunken_sword'));
    // The newer build again: everything comes back out, and more can be earned on top.
    const back = reconcileProfile(old.doc, NEWER);
    assert.equal(back.doc.profile.materials.glowstone, round === 1 ? 50 : 53, `round ${round}: back`);
    assert.deepEqual(back.doc.profile.research.active, [{ id: 'deep_charts', runsLeft: 2 }]);
    assert.ok(back.doc.profile.codex.includes('weapon:sunken_sword'));
    assert.equal(back.doc.profile.orphans.materials, undefined, 'nothing left set aside');
    assert.ok(back.restored.includes('materials:glowstone') && back.restored.includes('research:deep_charts'));
    d = back.doc;
    d.profile.materials.glowstone += 3;
  }
  // A set-aside level above this build's top stays set aside (a build with more levels gets it back).
  const high = withLevels(fresh(), { lamp_post: 7 });
  const r1 = reconcileProfile(high, DATA).doc;
  assert.equal(r1.profile.buildings.lamp_post, 5);
  assert.equal(reconcileProfile(r1, DATA).doc.profile.orphans.buildings.lamp_post, 7);
});

test('meta: levels, ranks, and kill counts survive builds with fewer and more of them, in any order', () => {
  // Three builds: this one (5 levels, Brighter Flame has 5 ranks), a smaller one (the Library has
  // 4 levels here, Brighter Flame 3 ranks, and no mud crab yet), and a bigger one (7 levels).
  const lib = DATA.buildings.find((b) => b.id === 'library');
  const withLevelsOf = (n) => ({ ...DATA, buildings: DATA.buildings.map((b) => (b.id === 'library' ? { ...b, levels: Array.from({ length: n }, (_, i) => lib.levels[Math.min(i, lib.levels.length - 1)]) } : b)) });
  const SMALL = { ...withLevelsOf(4), upgrades: DATA.upgrades.map((u) => (u.id === 'bright_flame' ? { ...u, ranks: 3 } : u)), enemies: DATA.enemies.filter((e) => e.id !== 'mud_crab') };
  const BIG = withLevelsOf(7), SIX = withLevelsOf(6);
  let d = withLevels(fresh(), { library: 7 });
  d.profile.upgrades = { bright_flame: 5 };
  d.profile.bestiary = { fog_wisp: 2210, mud_crab: 88 };
  d = reconcileProfile(d, BIG).doc;
  assert.equal(d.profile.buildings.library, 7);
  // 7 -> this build (5) -> the smaller one (4) -> 6 -> this build -> 7: every step keeps the most.
  const path = [[DATA, 5], [SMALL, 4], [SIX, 6], [DATA, 5], [BIG, 7]];
  for (const [build, top] of path) {
    d = reconcileProfile(d, build).doc;
    assert.equal(d.profile.buildings.library, top, `the Library at ${top} in a build whose top is ${top}`);
  }
  assert.equal(d.profile.orphans.buildings, undefined, 'all of it back, nothing left aside');
  // Ranks: 5 in this build, held at 3 in the smaller one, 5 again after.
  d = reconcileProfile(d, SMALL).doc;
  assert.equal(d.profile.upgrades.bright_flame, 3);
  assert.equal(d.profile.orphans.upgrades.bright_flame, 5);
  d = reconcileProfile(d, DATA).doc;
  assert.equal(d.profile.upgrades.bright_flame, 5);
  // Kill counts: a build without the mud crab keeps its count aside, and gives it back after.
  d = reconcileProfile(d, SMALL).doc;
  assert.deepEqual(d.profile.bestiary, { fog_wisp: 2210 });
  assert.equal(d.profile.orphans.bestiary.mud_crab, 88);
  d.profile.bestiary.fog_wisp += 10;
  d = reconcileProfile(d, DATA).doc;
  assert.deepEqual(d.profile.bestiary, { fog_wisp: 2220, mud_crab: 88 });
  assert.equal(d.profile.orphans.bestiary, undefined);
  // A count set aside and one kept since (a save written by two builds): the two add up.
  const both = fresh();
  both.profile.bestiary = { mud_crab: 5 };
  both.profile.orphans = { bestiary: { mud_crab: 88 } };
  assert.deepEqual(reconcileProfile(both, DATA).doc.profile.bestiary, { mud_crab: 93 });
  // Set aside twice (the same thing earned in two builds that don't know it): merged, the most kept.
  const twice = withLevels(fresh(), { observatory: 2 });
  twice.profile.orphans = { buildings: { observatory: 3 }, materials: { glowstone: 4 } };
  twice.profile.materials = { glowstone: 6 };
  const merged = reconcileProfile(twice, DATA).doc.profile.orphans;
  assert.equal(merged.buildings.observatory, 3, 'the higher level');
  assert.equal(merged.materials.glowstone, 10, 'counts add');
});

test('meta: a run folds into a seasoned profile: counts add, a milestone hit exactly is said, unknown keys stay out of the codex', () => {
  const d = withMats(fresh(), { coin: 100, oil: 3 });
  d.profile.bestiary = { fog_wisp: 95, drowned_sailor: 9 };
  d.profile.codex = ['weapon:flare_gun'];
  Object.assign(d.stats, { runs: 4, kills: 500, playtimeSec: 3000, deaths: 2, bestTimeSec: 600 });
  const r = result({ materials: { coin: 12, oil: 2 }, kills: { fog_wisp: 5, drowned_sailor: 1 }, totalKills: 6, timeSurvived: 300,
    weapons: [{ id: 'flare_gun' }, { id: 'harpoon_chain' }, { id: 'no_such_weapon' }], passives: [{ id: 'nope' }], weaponLevelMax: { flare_gun: 3 } });
  const { doc, changes } = applyRunResult(d, r, DATA);
  assert.deepEqual(doc.profile.materials, { coin: 112, oil: 5 }, 'added to what was there');
  assert.deepEqual(doc.profile.bestiary, { fog_wisp: 100, drowned_sailor: 10 });
  assert.deepEqual(changes.filter((c) => c.kind === 'bestiary'), [{ kind: 'bestiary', id: 'fog_wisp', kills: 100 }, { kind: 'bestiary', id: 'drowned_sailor', kills: 10 }], 'exactly 100 and exactly 10 are milestones');
  assert.deepEqual(doc.stats, { runs: 5, kills: 506, playtimeSec: 3300, deaths: 3, bestTimeSec: 600 });
  assert.deepEqual(doc.profile.codex, ['weapon:flare_gun', 'weapon:harpoon_chain'], 'only keys this build knows, each once');
  assert.deepEqual(changes.filter((c) => c.kind === 'codex').map((c) => c.key), ['weapon:harpoon_chain']);
});

test('meta: a hand-built profile never loses a project or breaks a run result', () => {
  // A project with a fraction of a run left (or the same project twice) is still running.
  let d = withLevels(fresh(), { library: 3 });
  d.profile.research = { done: [], active: [{ id: 'tide_charts', runsLeft: 1.5 }, { id: 'tide_charts', runsLeft: 3 }, { id: 'orbwright', runsLeft: 0 }] };
  assert.deepEqual(researchActive(d), [{ id: 'tide_charts', runsLeft: 2 }, { id: 'orbwright', runsLeft: 1 }]);
  const once = applyRunResult(d, result(), DATA);
  assert.deepEqual(once.doc.profile.research.active, [{ id: 'tide_charts', runsLeft: 1 }]);
  assert.deepEqual(once.doc.profile.research.done, ['orbwright']);
  assert.deepEqual(applyRunResult(once.doc, result(), DATA).doc.profile.research.done, ['orbwright', 'tide_charts']);
  // No profile at all, or its parts the wrong kind: the run still lands.
  for (const profile of [null, 7, { materials: [], research: 'x', bestiary: null }]) {
    const out = applyRunResult({ v: 2, profile, stats: null }, result(), DATA).doc;
    assert.deepEqual(out.profile.materials, { coin: 40, oil: 22, drowned_pages: 9 }, JSON.stringify(profile));
    assert.equal(out.stats.runs, 1);
  }
  // Entries reconcile can't read at all are all kept aside, not just the first.
  const junk = fresh();
  junk.profile.research = { done: [], active: ['a', 7, { runsLeft: 2 }] };
  assert.deepEqual(reconcileProfile(junk, DATA).doc.profile.orphans.research.unreadable, ['a', 7, { runsLeft: 2 }]);
});

test('text: lists joined with the Oxford comma, clock times, names inside a sentence', () => {
  assert.equal(joinList([]), '');
  assert.equal(joinList(['Oil']), 'Oil');
  assert.equal(joinList(['Oil', null, '', undefined, 'Coin']), 'Oil and Coin');
  assert.equal(joinList(['a', 'b', 'c', 'd']), 'a, b, c, and d');
  assert.deepEqual([clockText(0), clockText(59.9), clockText(60), clockText(3599.9), clockText(4000)], ['0:00', '0:59', '1:00', '59:59', '66:40']);
  for (const bad of [NaN, -5, Infinity, '300', null]) assert.equal(clockText(bad), '0:00', String(bad));
  assert.deepEqual([midSentence('The Library'), midSentence('Bram'), midSentence('Theodore'), midSentence(null)], ['the Library', 'Bram', 'Theodore', '']);
});

test('meta: counts and running projects are brought into range on every load, and no known project is dropped', () => {
  const d = fresh();
  d.profile.materials = { coin: '12', oil: -4, rope: 1.5, timber: NaN, rum: 'lots' };
  d.profile.research = { done: ['almanac'], active: [
    { id: 'orbwright', runsLeft: 0 }, { id: 'tide_charts', runsLeft: 1.5 }, { id: 'rune_stones', runsLeft: '1' },
    { id: 'ships_ballast', runsLeft: -1 }, { id: 'reversed_runes', runsLeft: 99 }, { id: 'almanac', runsLeft: 1 },
    { id: 'tide_charts', runsLeft: 2 },
  ] };
  d.stats.runs = '3'; d.stats.kills = -1;
  const { doc } = reconcileProfile(d, DATA);
  assert.deepEqual(doc.profile.materials, { coin: 12, rope: 1 });
  const byId = Object.fromEntries(doc.profile.research.active.map((r) => [r.id, r.runsLeft]));
  const runs = (id) => DATA.research.find((r) => r.id === id).runs;
  assert.deepEqual(byId, { orbwright: 1, tide_charts: 2, rune_stones: 1, ships_ballast: 1, reversed_runes: runs('reversed_runes') });
  assert.equal(doc.profile.research.active.filter((r) => r.id === 'tide_charts').length, 1, 'the same project once, the one further along');
  assert.deepEqual(doc.profile.research.done, ['almanac'], 'done wins over running');
  assert.equal(doc.stats.runs, 3); assert.equal(doc.stats.kills, 0);
  // Nothing hidden: every running project shows as running, so it can't be paid for twice.
  assert.match(whyNotResearch(withLevels(withMats(doc, RICH), { library: 5 }), DATA, 'orbwright'), /Already in progress/);
});

test('meta: the shipped v1 fixture migrates, reconciles, and plays', () => {
  const { doc: v1 } = unwrap(readFileSync(new URL('./fixtures/saves/profile-v1.txt', import.meta.url), 'utf8'), 'profile');
  const { doc: v2 } = migrateProfile(v1);
  assert.equal(v2.v, 2);
  assert.deepEqual(v2.profile.upgrades, {});
  assert.equal(v2.profile.research.slots, undefined, 'slots come from the Library now');
  const { doc } = reconcileProfile(v2, DATA);
  assert.equal(levelOf(doc, 'lamp_post', DATA), 3);
  assert.deepEqual(doc.profile.research.done, []);
  assert.equal(doc.profile.orphans.research.basics_1, 'done');
  assert.equal(doc.profile.materials.coin, 140);
  const cfg = runConfigFor(doc, DATA, { character: 'lamplighter', seed: 3 });
  assert.ok(cfg.pools.weapons.includes('flare_gun'));
});

test('meta: the harbor\'s dev commands add materials and unlock everything, like a purchase, and say so in the save', () => {
  // Add materials: every material a map in this build drops, none a later map's.
  const mats = droppedMaterials(DATA);
  assert.deepEqual(mats, ['coin', 'oil', 'timber', 'rope', 'drowned_pages', 'rum', 'iron', 'map_scraps']);
  const d0 = withMats(fresh(), { coin: 5, bone: 3 });
  const before = frozenCopy(d0);
  const { doc, changes } = devAddMaterials(d0, DATA, 100);
  assert.equal(frozenCopy(d0), before, 'the document passed in never changes');
  assert.equal(doc.profile.materials.coin, 105);
  assert.equal(doc.profile.materials.bone, 3, 'a later map\'s material is left alone');
  assert.deepEqual(changes.map((c) => [c.kind, c.id, c.count]), mats.map((id) => ['material', id, 100]));
  assert.equal(doc.profile.flags.devTools, true, 'the save says dev commands were used');
  for (const bad of [0, -5, 2.5, NaN, DEV_MATERIALS_MAX + 1, '100']) assert.throws(() => devAddMaterials(d0, DATA, bad), MetaError);
  // Unlock everything: every building at its last level, every project done (the one running too),
  // the upgrades opened and not bought; what joined your runs is named.
  const going = startResearch(withMats(withLevels(fresh(), { library: 1 }), RICH), DATA, 'orbwright').doc;
  const u = devUnlockAll(going, DATA);
  assert.deepEqual(DATA.buildings.map((b) => levelOf(u.doc, b.id, DATA)), DATA.buildings.map((b) => b.levels.length));
  assert.deepEqual([...researchDone(u.doc)].sort(), DATA.research.map((r) => r.id).sort());
  assert.deepEqual(researchActive(u.doc), [], 'nothing left running');
  assert.equal(treeTier(u.doc, DATA), 5);
  assert.deepEqual(u.doc.profile.upgrades, {}, 'no upgrade bought');
  assert.deepEqual(u.doc.profile.materials, going.profile.materials, 'nothing paid');
  assert.ok(allUnlocked(u.doc, DATA));
  assert.ok(u.unlocks.some((x) => x.what === 'character' && x.id === 'harpooner'), 'the Harpooner comes with the Tavern');
  // Each change is shaped as a purchase's or a run's of the same kind, and they add up to the whole.
  const bought = restoreBuilding(withMats(fresh(), RICH), DATA, 'tavern').changes[0];
  const ran = applyRunResult(startResearch(withMats(withLevels(fresh(), { library: 1 }), RICH), DATA, 'orbwright').doc, result({ timeSurvived: 400 }), DATA).changes.find((c) => c.kind === 'research_done');
  const keys = (c) => Object.keys(c).sort();
  for (const c of u.changes) assert.deepEqual(keys(c), keys(c.kind === 'building_level' ? bought : ran), `${c.kind} ${c.id}`);
  assert.ok(u.changes.every((c) => c.kind !== 'building_level' || JSON.stringify(c.cost) === '{}'), 'nothing paid');
  const named = u.changes.flatMap((c) => c.unlocks).map((x) => `${x.what}:${x.id}`).sort();
  assert.deepEqual(named, u.unlocks.map((x) => `${x.what}:${x.id}`).sort(), 'what each brought is what joined your runs');
  const everything = resolveContent(u.doc, DATA);
  for (const kind of ['weapons', 'passives', 'relics', 'runes', 'characters']) {
    const earned = DATA[kind].filter((x) => /^(research|building):/.test(x.unlock)).map((x) => x.id);
    assert.ok(earned.length > 0 || kind === 'runes', kind);
    assert.deepEqual(earned.filter((id) => !everything[kind].includes(id)), [], `every ${kind.slice(0, -1)} the harbor gives is unlocked`);
  }
  assert.equal(u.doc.profile.flags.devTools, true);
  assert.throws(() => devUnlockAll(u.doc, DATA), /Everything is already unlocked/);
  // A project this build doesn't know is kept as it was (a save never loses progress).
  const odd = structuredClone(going);
  odd.profile.research.active.push({ id: 'from_a_later_build', runsLeft: 2 });
  assert.deepEqual(devUnlockAll(odd, DATA).doc.profile.research.active, [{ id: 'from_a_later_build', runsLeft: 2 }]);
});

/** A profile with a little of everything, the way years of play leave one. */
function seasonedProfile() {
  const d = fresh();
  d.profile.materials = { ...RICH, bone: 7 };
  d.profile.buildings = { lamp_post: 3, library: 3, tavern: 2 };
  d.profile.research = { done: ['orbwright'], active: [{ id: 'tide_charts', runsLeft: 2 }] };
  d.profile.upgrades = { bright_flame: 2, quick_step: 1 };
  d.profile.characters = { lamplighter: { unlocked: true, masteryXp: 40, perks: ['steady_hand'] } };
  d.profile.gear = { inventory: [{ id: 'rusty_hook', level: 2 }], equipped: { hand: 'rusty_hook' } };
  d.profile.bestiary = { fog_wisp: 1234, drowned_sailor: 56, mud_crab: 9 };
  d.profile.codex = ['weapon:flare_gun', 'passive:wick_oil'];
  d.profile.feats = ['first_blood'];
  d.profile.tide = { unlocked: 3, selected: 1 };
  d.profile.prestige = { cycle: 1, relics: ['old_compass'] };
  d.profile.flags = { sawIntro: true };
  d.profile.orphans = { materials: { glowstone: 5 }, research: { deep_charts: 'done' } };
  Object.assign(d.stats, { runs: 20, playtimeSec: 20000, kills: 5000, deaths: 10, bestTimeSec: 1100 });
  return d;
}

/** The profile without the parts a writer may change (`may`: profile keys, and 'stats'). */
function untouched(doc, may) {
  const out = structuredClone(doc);
  for (const k of may) if (k === 'stats') delete out.stats; else delete out.profile[k];
  return out;
}

test('meta: every writer leaves the rest of the profile alone (an update can never wipe progress, §12.2)', () => {
  const d = seasonedProfile();
  const same = (after, may, what) => assert.deepEqual(untouched(after, may), untouched(d, may), `${what} changes only ${may.join(', ')}`);
  const sameExcept = (before, after, keys, what) => {
    for (const k of Object.keys({ ...before, ...after })) if (!keys.includes(k)) assert.deepEqual(after[k], before[k], `${what}: ${k} untouched`);
  };
  // A run: its haul, research, the codex, the kills it made, the stats. Nothing else.
  const run = applyRunResult(d, result({ materials: { coin: 40, oil: 22 }, kills: { fog_wisp: 150 }, totalKills: 150, relics: ['glass_lantern'] }), DATA).doc;
  same(run, ['materials', 'research', 'codex', 'bestiary', 'stats'], 'a run');
  sameExcept(d.profile.materials, run.profile.materials, ['coin', 'oil'], 'a run\'s materials');
  assert.deepEqual([run.profile.materials.coin, run.profile.materials.oil], [RICH.coin + 40, RICH.oil + 22]);
  sameExcept(d.profile.bestiary, run.profile.bestiary, ['fog_wisp'], 'a run\'s kills');
  assert.equal(run.profile.bestiary.fog_wisp, 1384);
  assert.deepEqual(run.profile.codex.slice(0, 2), d.profile.codex, 'the codex only grows');
  assert.deepEqual(run.profile.research, { done: ['orbwright'], active: [{ id: 'tide_charts', runsLeft: 1 }] });
  assert.deepEqual(run.stats, { runs: 21, playtimeSec: 20400, kills: 5150, deaths: 11, bestTimeSec: 1100 });
  // A run that used the tuning panel or its commands marks the save, and keeps the other flags.
  const devRun = applyRunResult(d, result({ devTools: true }), DATA).doc;
  assert.deepEqual(devRun.profile.flags, { sawIntro: true, devTools: true });
  same(devRun, ['materials', 'research', 'codex', 'bestiary', 'stats', 'flags'], 'a dev run');
  // Restoring, upgrading, starting research: the cost and the one thing bought.
  const cost = (c) => spent(d.profile.materials, c);
  const lp = restoreBuilding(d, DATA, 'lamp_post').doc;
  same(lp, ['materials', 'buildings'], 'a restore');
  assert.deepEqual(lp.profile.materials, cost(DATA.buildings[0].levels[3].cost));
  assert.deepEqual(lp.profile.buildings, { ...d.profile.buildings, lamp_post: 4 });
  const up = buyUpgrade(d, DATA, 'bright_flame').doc;
  same(up, ['materials', 'upgrades'], 'an upgrade');
  assert.deepEqual(up.profile.upgrades, { ...d.profile.upgrades, bright_flame: 3 });
  assert.deepEqual(up.profile.materials, cost(nextRankCost(d, DATA, 'bright_flame')));
  const rs = startResearch(d, DATA, 'rune_stones').doc;
  same(rs, ['materials', 'research'], 'a new project');
  assert.deepEqual(rs.profile.research, { done: ['orbwright'], active: [{ id: 'tide_charts', runsLeft: 2 }, { id: 'rune_stones', runsLeft: DATA.research.find((r) => r.id === 'rune_stones').runs }] });
  // The harbor's dev commands: the materials the maps drop, or the buildings and research, and the mark.
  const more = devAddMaterials(d, DATA, 100).doc;
  same(more, ['materials', 'flags'], 'adding materials');
  sameExcept(d.profile.materials, more.profile.materials, droppedMaterials(DATA), 'adding materials');
  assert.deepEqual(more.profile.flags, { sawIntro: true, devTools: true });
  const all = devUnlockAll(d, DATA).doc;
  same(all, ['buildings', 'research', 'flags'], 'unlocking everything');
  assert.deepEqual(all.profile.flags, { sawIntro: true, devTools: true });
});

test('meta: entries no build can read are kept aside, never dropped; a building\'s name in a refusal comes from the data', () => {
  const d = fresh();
  d.profile.research = { done: ['orbwright', { id: 'tide_charts' }, 7], active: [{ runsLeft: 2 }] };
  d.profile.codex = ['weapon:flare_gun', { key: 'odd' }];
  const out = reconcileProfile(d, DATA);
  assert.deepEqual(out.doc.profile.research.done, ['orbwright']);
  assert.deepEqual(out.doc.profile.orphans.research.unreadable, [{ id: 'tide_charts' }, 7, { runsLeft: 2 }], 'finished and running alike');
  assert.deepEqual(out.doc.profile.codex, ['weapon:flare_gun']);
  assert.deepEqual(out.doc.profile.orphans.unreadable.codex, [{ key: 'odd' }]);
  assert.deepEqual(reconcileProfile(out.doc, DATA).doc, out.doc, 'kept as they are on the next load');
  // Renamed in the data, renamed in what the panels say.
  const RENAMED = { ...DATA, buildings: DATA.buildings.map((b) => (b.id === 'library' ? { ...b, name: 'Archive' } : b.id === 'lamp_post' ? { ...b, name: 'Beacon' } : b)) };
  const tide = DATA.research.find((r) => r.id === 'tide_charts');
  assert.equal(whyNotResearch(withMats(fresh(), RICH), RENAMED, 'tide_charts'), 'Requires Archive Lv 1');
  assert.equal(whyNotUpgrade(withMats(fresh(), RICH), RENAMED, 'quick_step'), 'Requires Beacon Lv 2');
  const busy = startResearch(withLevels(withMats(fresh(), RICH), { library: 1 }), DATA, 'orbwright').doc;
  assert.equal(whyNotResearch(busy, RENAMED, tide.id), 'Research slots full (1/1)');
});

test('meta: reconcile, on every load, and the v1 migration before it, leave a seasoned profile as it is', () => {
  const d = seasonedProfile();
  const r = reconcileProfile(d, DATA);
  assert.deepEqual(r.doc, d, 'every part as it was: gear, feats, the tide, prestige, the codex, the flags, the stats, what was set aside');
  assert.deepEqual([r.moved, r.restored], [[], []]);
  // The same profile as a v1 save (no upgrades yet, research slots stored) comes through whole.
  const v1 = structuredClone(d);
  v1.v = 1;
  delete v1.profile.upgrades;
  v1.profile.research.slots = 2;
  const want = structuredClone(d);
  want.profile.upgrades = {};
  assert.deepEqual(reconcileProfile(migrateProfile(v1).doc, DATA).doc, want);
});

test('meta: a hand-built profile missing a part still buys, starts, and unlocks, with a new part (never a crash)', () => {
  // Even with no profile at all: it reads as empty, and says what it would need.
  for (const doc of [{ v: 2 }, { v: 2, profile: null }]) {
    assert.match(whyNotRestore(doc, DATA, 'lamp_post'), /^Need /);
    assert.equal(levelOf(doc, 'library', DATA), 0);
    assert.deepEqual(nextAffordable(doc, DATA, 3).map((o) => o.kind), ['building', 'building', 'building']);
    assert.throws(() => restoreBuilding(doc, DATA, 'lamp_post'), MetaError);
    assert.throws(() => runConfigFor(doc, DATA, { character: 'harpooner', seed: 1 }), MetaError);
    assert.equal(allUnlocked(doc, DATA), false);
    assert.deepEqual(devUnlockAll(doc, DATA).doc.profile.buildings, Object.fromEntries(DATA.buildings.map((b) => [b.id, b.levels.length])));
  }
  const bare = (drop) => { const d = withMats(fresh(), RICH); for (const k of drop) delete d.profile[k]; return d; };
  const lp = restoreBuilding(bare(['buildings']), DATA, 'lamp_post');
  assert.deepEqual(lp.doc.profile.buildings, { lamp_post: 1 });
  const three = withLevels(withMats(fresh(), RICH), { lamp_post: 3 });
  delete three.profile.upgrades;
  assert.equal(buyUpgrade(three, DATA, 'bright_flame').doc.profile.upgrades.bright_flame, 1);
  const lib = withLevels(withMats(fresh(), RICH), { library: 1 });
  lib.profile.research = 'lost';
  assert.deepEqual(startResearch(lib, DATA, 'tide_charts').doc.profile.research, { done: [], active: [{ id: 'tide_charts', runsLeft: DATA.research.find((r) => r.id === 'tide_charts').runs }] });
  const noMats = bare(['materials']);
  assert.match(whyNotRestore(noMats, DATA, 'lamp_post'), /^Need /, 'no materials reads as none');
  assert.equal(devAddMaterials(noMats, DATA, 5).doc.profile.materials.coin, 5);
  const odd = fresh();
  odd.profile.flags = 'abc';
  assert.deepEqual(devAddMaterials(odd, DATA, 1).doc.profile.flags, { devTools: true }, 'flags that aren\'t a table start as one');
  const none = fresh();
  delete none.profile.buildings;
  delete none.profile.research;
  assert.equal(allUnlocked(none, DATA), false);
  assert.deepEqual(devUnlockAll(none, DATA).doc.profile.buildings, Object.fromEntries(DATA.buildings.map((b) => [b.id, b.levels.length])));
});

test('meta: the smaller rules of a run and of the lists, pinned', () => {
  // A short run with nothing running says nothing about research.
  assert.ok(!applyRunResult(fresh(), result({ timeSurvived: 60 }), DATA).changes.some((c) => c.kind.startsWith('research')));
  // The boss rule follows META: a build that turns it off doesn't count a boss.
  const boss = { timeSurvived: 10, bossesKilled: [{ id: 'harbor_maw', time: 9, weapons: [] }] };
  assert.equal(qualifies(boss, DATA), true);
  assert.equal(qualifies(boss, { ...DATA, meta: { ...DATA.meta, researchQualifyBoss: false } }), false);
  assert.equal(qualifies({ timeSurvived: 10, bossesKilled: ['harbor_maw'] }, DATA), true, 'a boss named by id');
  assert.equal(qualifies({ timeSurvived: 10, bossesKilled: [null, 5, {}, []] }, DATA), false, 'junk entries are not bosses');
  for (const junk of ['', { id: '' }, 'not_a_boss', { id: 'fog_wisp' }]) {
    assert.equal(qualifies({ timeSurvived: 10, bossesKilled: [junk] }, DATA), false, `${JSON.stringify(junk)} is no boss this build has`);
  }
  // A milestone is said once, as a count crosses it: not again by a run that starts on it.
  const on = fresh();
  on.profile.bestiary = { fog_wisp: 100 };
  assert.ok(!applyRunResult(on, result({ kills: { fog_wisp: 5 } }), DATA).changes.some((c) => c.kind === 'bestiary'), 'already at 100');
  const below = fresh();
  below.profile.bestiary = { fog_wisp: 99 };
  assert.deepEqual(applyRunResult(below, result({ kills: { fog_wisp: 1 } }), DATA).changes.filter((c) => c.kind === 'bestiary'), [{ kind: 'bestiary', id: 'fog_wisp', kills: 100 }], 'crossing it');
  // Kills of an enemy this build doesn't know stay out of the bestiary.
  assert.deepEqual(applyRunResult(fresh(), result({ kills: { ghost_ship: 5, fog_wisp: 2 } }), DATA).doc.profile.bestiary, { fog_wisp: 2 });
  // A project both done and running is done: it doesn't tick or finish again.
  const both = fresh();
  both.profile.research = { done: ['orbwright'], active: [{ id: 'orbwright', runsLeft: 1 }] };
  const once = applyRunResult(both, result(), DATA);
  assert.ok(!once.changes.some((c) => c.kind === 'research_done' || c.kind === 'research_step'));
  assert.deepEqual(once.doc.profile.research.done, ['orbwright']);
  // The same project twice: the one further along is kept, by the reader and by reconcile.
  const twice = fresh();
  for (const pair of [[2, 1], [1, 2]]) {
    twice.profile.research.active = pair.map((runsLeft) => ({ id: 'tide_charts', runsLeft }));
    assert.deepEqual(researchActive(twice), [{ id: 'tide_charts', runsLeft: 1 }], `read from ${pair}`);
    assert.deepEqual(reconcileProfile(twice, DATA).doc.profile.research.active, [{ id: 'tide_charts', runsLeft: 1 }], `reconciled from ${pair}`);
  }
  // ...and so is one this build doesn't know, in either order ('done' over running).
  const unknownTwice = (entries, orphan = null) => {
    const d = fresh();
    d.profile.research.active = entries;
    if (orphan) d.profile.orphans = { research: { deep_charts: orphan } };
    return reconcileProfile(d, DATA).doc.profile.orphans.research.deep_charts;
  };
  assert.deepEqual(unknownTwice([{ id: 'deep_charts', runsLeft: 1 }, { id: 'deep_charts', runsLeft: 3 }]), { id: 'deep_charts', runsLeft: 1 });
  assert.deepEqual(unknownTwice([{ id: 'deep_charts', runsLeft: 3 }, { id: 'deep_charts', runsLeft: 1 }]), { id: 'deep_charts', runsLeft: 1 });
  assert.equal(unknownTwice([{ id: 'deep_charts', runsLeft: 1 }], 'done'), 'done', 'set aside as done, and running again in a save: done');
  assert.deepEqual(unknownTwice([{ id: 'deep_charts', runsLeft: 1 }], { id: 'deep_charts', runsLeft: 3 }), { id: 'deep_charts', runsLeft: 1 }, 'further along than what was set aside');
  // The next three: as close as each other, the cheaper first.
  const TWO = { ...DATA, buildings: [{ id: 'a', name: 'A', levels: [{ cost: { coin: 20 } }] }, { id: 'b', name: 'B', levels: [{ cost: { coin: 10 } }] }] };
  assert.deepEqual(nextAffordable(withMats(fresh(), { coin: 100 }), TWO, 2).map((o) => o.id), ['b', 'a']);
  // Unlock everything with every building restored still finishes the research...
  const built = withLevels(fresh(), Object.fromEntries(DATA.buildings.map((b) => [b.id, b.levels.length])));
  assert.equal(allUnlocked(built, DATA), false, 'research left to do');
  assert.deepEqual([...researchDone(devUnlockAll(built, DATA).doc)].sort(), DATA.research.map((r) => r.id).sort());
  // ...and with all research done, still restores a building left in ruins.
  const read = withLevels(fresh(), { lamp_post: 5, library: 4 });
  read.profile.research = { done: DATA.research.map((r) => r.id), active: [] };
  assert.equal(allUnlocked(read, DATA), false, 'the Tavern is still a ruin');
  const tavern = devUnlockAll(read, DATA);
  assert.deepEqual(tavern.doc.profile.buildings, { lamp_post: 5, library: 5, tavern: 5 });
  assert.deepEqual(tavern.changes.map((c) => [c.kind, c.id]), [['building_level', 'library'], ['building_level', 'tavern']]);
});

test('meta: research finished in a newer build comes back finished in it, after an older build kept it aside', () => {
  const NEWER = { ...DATA, research: [...DATA.research, { id: 'deep_charts', name: 'Deep Charts', desc: '', tier: 1, cost: { coin: 1 }, runs: 3, requires: [] }] };
  const d = fresh();
  d.profile.research = { done: ['orbwright', 'deep_charts'], active: [] };
  const old = reconcileProfile(d, DATA).doc;
  assert.deepEqual(old.profile.research.done, ['orbwright']);
  assert.equal(old.profile.orphans.research.deep_charts, 'done');
  const back = reconcileProfile(old, NEWER).doc;
  assert.deepEqual([...researchDone(back)].sort(), ['deep_charts', 'orbwright'], 'done, not running again from the start');
  assert.deepEqual(back.profile.research.active, []);
});

test('meta: a run says when the tuning panel or its commands were used, and folding it in marks the save', () => {
  const cfg = runConfigFor(fresh(), DATA, { character: 'lamplighter', seed: 'dev-mark' });
  const plain = createWorld(cfg, DATA);
  for (let i = 0; i < 30; i++) stepWorld(plain, { mx: 0, my: 0, buttons: 0 });
  assert.equal(buildRunResult(plain).devTools, false);
  const healed = createWorld(cfg, DATA);
  decide(healed, { kind: 'dev', cmd: 'heal' });
  assert.equal(buildRunResult(healed).devTools, true, 'a dev command');
  const tuned = createWorld(cfg, DATA);
  decide(tuned, { kind: 'tune', path: 'enemies.separation', value: 0.3 });
  assert.equal(buildRunResult(tuned).devTools, true, 'a tuning change');
  assert.equal(applyRunResult(fresh(), buildRunResult(tuned), DATA).doc.profile.flags.devTools, true);
  assert.equal(applyRunResult(fresh(), buildRunResult(plain), DATA).doc.profile.flags.devTools, undefined);
});

test('meta: the fog clears region by region with the buildings', () => {
  const start = revealedFog(fresh(), DATA);
  assert.ok(start.has('square') && !start.has('lamp_1'));
  const later = revealedFog(withLevels(fresh(), { lamp_post: 2, library: 1 }), DATA);
  for (const id of ['square', 'lamp_1', 'lamp_2', 'library_1']) assert.ok(later.has(id), id);
  assert.ok(!later.has('lamp_3') && !later.has('tavern_1'));
});
