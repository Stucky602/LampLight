// 0.7.3's gamer pass, the meta and the screens (batch B2): time-survived pay, the Market's cap and
// trade row, Next up's rules and the door pointer, mastery's mechanic perks, mergeRuns carrying
// everything, save codes in the title and harbor menus, the run's quiet line and a level's gift,
// the pad unplugged mid-run, the shared hint row and "N more" bands, plain tuning names, the build
// stamp, the materials bar's counts, the Bestiary, and every character's waiting line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakeDocument, textsOf } from './helpers/fakedom.js';
import { DATA } from '../src/data/index.js';
import { defaultProfile } from '../src/save/schema.js';
import * as W from '../src/meta/workshop.js';
import { applyRunResult, reconcileProfile, runConfigFor, resolveContent } from '../src/meta/index.js';
import { nextAffordable, opensOf } from '../src/meta/next.js';
import { guideStep, newsAt } from '../src/meta/guide.js';
import { SKILL_RANKS } from '../src/data/skills.js';
import { mergeRuns, lineFor, clearedAt } from '../src/app/hublogic.js';
import { changeLines, homeTotals, countText, optionText } from '../src/ui/hubtext.js';
import { runSummary, createGiftNotices, giftText, GIFT, quietNotice, noticeFor, chestSource, chestSourceName } from '../src/app/runlogic.js';
import { importSummaryText, importErrorText, pickTextFile, createSaveCodes } from '../src/app/savecode.js';
import { decodeExportCode, encodeExportCode } from '../src/save/codec.js';
import { createStore } from '../src/save/store.js';
import { createKvBackend, memoryKv } from '../src/save/backends.js';
import { buildStampText } from '../src/app/platform.js';
import { plainName, plainGroup, valueText } from '../src/ui/tuningmodel.js';
import { hintRow, bandCounts, snapScroll, bandList } from '../src/ui/hints.js';
import { createFocusScope } from '../src/ui/focus.js';
import { wirePauses } from '../src/app/pauses.js';
import { EV, createEventBuffer } from '../src/sim/events.js';
import { WAITING_LINES } from '../src/data/npcs.js';
import { createInput } from '../src/input/input.js';
import { createUi } from '../src/ui/screens.js';
import { buildingScreen, codexScreen, hubMenuScreen, resultsScreen, RESULTS_INPUT_DELAY_MS } from '../src/ui/hubscreens.js';
import { titleScreen, saveCodeScreen } from '../src/ui/menus.js';
import { HUNT_COUNTS } from '../src/data/trophies.js';   // (X3)

const RICH = Object.fromEntries(DATA.materials.map((m) => [m.id, 99999]));
function make(levels = {}, mats = {}, extra = {}) {
  const d = defaultProfile();
  Object.assign(d.profile.buildings, levels);
  Object.assign(d.profile.materials, mats);
  Object.assign(d.profile, extra);
  return d;
}
function result(over = {}) {
  return { end: 'died', character: 'lamplighter', timeSurvived: 400, totalKills: 0, kills: {}, bossesKilled: [], materials: {}, weapons: [], passives: [], relics: [], runes: [], evolutions: [], ...over };
}

// ---------------------------------------------------------------- time-survived pay

test('time-survived pay: every whole minute pays, up to 20; an early death still brings something home', () => {
  const P = DATA.meta.timePay.perMinute;
  const at = (secs) => applyRunResult(make(), result({ timeSurvived: secs }), DATA);
  assert.equal(at(59).changes.find((c) => c.kind === 'time_pay'), undefined, 'under a minute: nothing');
  assert.deepEqual(at(150).changes.find((c) => c.kind === 'time_pay'), { kind: 'time_pay', minutes: 2, materials: { coin: 2 * P.coin, oil: 2 * P.oil } });
  assert.deepEqual(at(150).doc.profile.materials, { coin: 2 * P.coin, oil: 2 * P.oil }, 'a death at 2:30 with nothing picked up still pays');
  assert.equal(at(3000).changes.find((c) => c.kind === 'time_pay').minutes, DATA.meta.timePay.capMinutes, 'overtime is paid in drops, not minutes');
  // In the results, on its own line and in the totals.
  const lines = changeLines(DATA, at(150).changes).map((l) => l.text);
  assert.deepEqual(lines, [`${2 * P.coin} Coin`, `${2 * P.oil} Oil`, `Time bonus (2 min): +${2 * P.coin} Coin, +${2 * P.oil} Oil`]);
});

// ---------------------------------------------------------------- the Market

test('the Market: a trade row with its amount and what it pays with; rares capped between runs', () => {
  const d = make({ market: 1 }, { coin: 1000, oil: 500, timber: 3 });
  assert.deepEqual(W.payOptions(d, DATA, 'iron'), [...DATA.market.common, 'map_scraps'], 'any material that trades for it');
  const t = W.tradeTerms(d, DATA, 'coin', 'oil');
  const five = W.marketTrade(d, DATA, 'coin', 'oil', 5);
  assert.deepEqual(five.changes, [{ kind: 'trade', give: 'coin', gave: t.give * 5, get: 'oil', got: 5 }]);
  assert.equal(W.whyNotTrade(d, DATA, 'timber', 'oil', 1), `Need ${t.give - 3} Timber`);
  assert.equal(W.whyNotTrade(d, DATA, 'coin', 'oil', 0), 'Trade a whole number of times');
  // Rares: META.marketRaresPerRun between two runs.
  const cap = DATA.meta.marketRaresPerRun;
  assert.equal(W.raresLeft(d, DATA), cap);
  assert.equal(W.whyNotTrade(d, DATA, 'coin', 'iron', cap + 1), `Only ${cap} more Iron or Map Scraps until after your next run`);
  let m = d;
  for (let k = 0; k < cap; k++) m = W.marketTrade(m, DATA, 'coin', 'iron').doc;
  assert.equal(W.raresLeft(m, DATA), 0);
  assert.equal(W.whyNotTrade(m, DATA, 'coin', 'iron'), 'No more Iron or Map Scraps until after your next run');
  assert.equal(W.whyNotTrade(m, DATA, 'coin', 'oil'), null, 'commons are never capped');
  const after = applyRunResult(m, result({ timeSurvived: 30 }), DATA).doc;
  assert.equal(W.raresLeft(after, DATA), cap, 'a run in between: the Market has more');
  // Reconcile keeps the count tidy (or drops it).
  assert.deepEqual(reconcileProfile(m, DATA).doc.profile.market, m.profile.market);
  const junk = make({}, {}, { market: { run: 'x', rares: -2 } });
  assert.equal(reconcileProfile(junk, DATA).doc.profile.market, undefined);
});

test('the Market panel: Amount, then a row a material; left and right change what a row pays with', () => {
  const document = installFakeDocument();
  const ui = { glyph: (a) => { const s = document.createElement('span'); s.textContent = a; return s; } };
  let doc = make({ market: 1 }, { coin: 1000, oil: 500 });
  const acts = [];
  const ctx = { ui, icon: () => document.createElement('span'), sound: () => {} };
  const s = buildingScreen(ctx, { data: DATA, building: 'market', get: () => ({ doc }), onRestore() {}, onUpgrade() {}, onResearch() {}, onAct: (...a) => acts.push(a), onClose() {} });
  document.body.appendChild(s.el);
  s.refresh();
  assert.ok(s.scope.focusKey('amt'));
  assert.equal(s.onNav('right'), true);
  assert.ok(textsOf(s.el).includes('5x'), 'the amount steps 1, 5, 10, 25');
  assert.ok(s.scope.focusKey('t:rope'));
  const payWith = () => s.el.querySelector('[data-focus="t:rope"] .row-desc').textContent;
  const before = payWith();
  assert.match(before, /Coin \(you have 1,000\)/, 'it starts on the common held most of');
  s.onNav('right');
  assert.notEqual(payWith(), before, 'right: the next material');
  s.scope.focusKey('t:rope');
  s.scope.current.click();
  assert.equal(acts.at(-1)[0], 'trade');
  assert.equal(acts.at(-1)[3], 5, 'the amount goes with the trade');
  assert.ok(textsOf(s.el).some((x) => /^Iron and Map Scraps left to buy before your next run: 3 of 3$/.test(x)));
  const hint = textsOf(s.el.querySelector('.hint')).join(' ');
  assert.match(hint, /Trade/);
  assert.match(hint, /Pay with/);
});

// ---------------------------------------------------------------- Next up and the door pointer

test('Next up: closest first, a building out of the fog always, one upgrade at most, no consumables, one opener said', () => {
  const d = make({ lamp_post: 5, library: 1, apothecary: 1, tavern: 0 }, { coin: 400, oil: 400, rope: 60, timber: 60, drowned_pages: 40, rum: 20 });
  const next = nextAffordable(d, DATA, 3);
  assert.equal(next.length, 3);
  assert.ok(next.some((o) => o.kind === 'building'), 'a building level is always listed');
  assert.ok(next.filter((o) => o.kind === 'upgrade').length <= 1, 'one upgrade rank at most');
  assert.ok(!next.some((o) => o.kind === 'consumable'), 'no consumables');
  for (let k = 1; k < next.length; k++) assert.ok(next[k - 1].progress >= next[k].progress, 'closest first');
  const openers = next.filter((o) => o.opens);
  assert.ok(openers.length <= 1, 'one option says what it opens');
  for (const o of openers) assert.deepEqual(o.opens.map((x) => x.id), opensOf(DATA, o).map((x) => x.id));
  // Lots of upgrades nearly affordable and a building far off: the building stays on the list.
  const rich = make({ lamp_post: 5 }, { oil: 9999, coin: 9999 });
  const list = nextAffordable(rich, DATA, 3);
  assert.ok(list.some((o) => o.kind === 'building'));
  assert.equal(list.filter((o) => o.kind === 'upgrade').length, 1);
  // A research that adds things is the opener, with its line.
  const lib = nextAffordable(make({ library: 1 }, RICH), DATA, 3).find((o) => o.opens);
  assert.ok(lib, 'something opens content');
  assert.ok(optionText(DATA, lib).opens.startsWith('New '));
});

test('the guide after a run: "New at the Smithy" and its door, until the player goes in', () => {
  const smithy = make({ lamp_post: 5, smithy: 1 }, {}, {});
  smithy.stats.runs = 3;
  const changes = [{ kind: 'research_done', id: 'smiths_ledger', unlocks: [{ what: 'recipe', id: DATA.recipes[0].id }] }, { kind: 'research_done', id: 'x', unlocks: [{ what: 'weapon', id: 'flare_gun' }] }];
  assert.deepEqual(newsAt(smithy, DATA, changes), ['smithy'], 'a recipe is news at the Smithy; a weapon is news in runs');
  assert.deepEqual(guideStep(smithy, DATA, ['smithy']), { id: 'new_at', text: 'New at the Smithy', target: { kind: 'door', id: 'smithy' } });
  assert.equal(guideStep(smithy, DATA, []), null);
  assert.deepEqual(newsAt(make({ lamp_post: 5 }), DATA, changes), [], 'not at a building still in ruins');
  const tav = make({ tavern: 2, cartographer: 2 });
  assert.deepEqual(newsAt(tav, DATA, [{ kind: 'mastery', character: 'lamplighter', rank: 1 }, { kind: 'bestiary', id: 'drowned_bosun', kills: 1 }]), ['tavern'], 'the Cartographer has nothing to claim (ruling 13)');
  assert.deepEqual(newsAt(tav, DATA, [{ kind: 'mastery', character: 'lamplighter', rank: 2 }]), [], 'no skill point at rank 2');
  // The first steps still come first.
  assert.equal(guideStep(make(), DATA, ['smithy']).id, 'first_run');
});

// ---------------------------------------------------------------- mastery

test('mastery: eleven ranks; the skill points sit at ranks 1, 3, 5, 7, 9, 10, and 11 (ruling 15)', () => {
  assert.equal(DATA.meta.masteryRanks.length, 11);
  assert.deepEqual([...SKILL_RANKS], [1, 3, 5, 7, 9, 10, 11]);
  for (const r of SKILL_RANKS) assert.ok(r <= DATA.meta.masteryRanks.length);
});

// ---------------------------------------------------------------- mergeRuns

test('mergeRuns carries feats, found feats, mastery, Tides, the Market\'s Sea Glass, and the minutes\' pay', () => {
  const a = { runs: 1, result: 'a', changes: [
    { kind: 'material', id: 'coin', count: 5 }, { kind: 'time_pay', minutes: 3, materials: { coin: 12, oil: 6 } },
    { kind: 'feat', id: 'dawn', unlocks: [], materials: { coin: 150, map_scraps: 2 } }, { kind: 'feat_found', id: 'untouched' },
    { kind: 'mastery', character: 'lamplighter', rank: 1 }, { kind: 'tide', level: 1 }, { kind: 'glass_coin', glass: 10, count: 5 },
  ] };
  const b = { runs: 1, result: 'b', changes: [
    { kind: 'material', id: 'coin', count: 7 }, { kind: 'time_pay', minutes: 20, materials: { coin: 80, oil: 40 } },
    { kind: 'feat', id: 'lamp_only', unlocks: [{ what: 'relic', id: 'kindling' }], materials: {} }, { kind: 'feat', id: 'dawn', unlocks: [], materials: { coin: 150 } },
    { kind: 'mastery', character: 'lamplighter', rank: 2 }, { kind: 'tide', level: 2 }, { kind: 'glass_coin', glass: 4, count: 2 },
  ] };
  const m = mergeRuns(a, b, DATA);
  const of = (k) => m.changes.filter((c) => c.kind === k);
  assert.deepEqual(of('material'), [{ kind: 'material', id: 'coin', count: 12 }]);
  assert.deepEqual(of('time_pay'), [{ kind: 'time_pay', minutes: 23, materials: { coin: 92, oil: 46 } }]);
  assert.deepEqual(of('feat').map((c) => c.id), ['dawn', 'lamp_only'], 'a feat once (a set run won is one)');
  assert.deepEqual(of('feat_found').map((c) => c.id), ['untouched']);
  assert.deepEqual(of('mastery'), [{ kind: 'mastery', character: 'lamplighter', rank: 2 }], 'the highest rank');
  assert.deepEqual(of('tide').map((c) => c.level), [1, 2]);
  assert.deepEqual(of('glass_coin'), [{ kind: 'glass_coin', glass: 14, count: 7 }]);
  assert.deepEqual(homeTotals(m.changes), { coin: 12 + 92 + 150 + 7, oil: 46, map_scraps: 2 });
});

// ---------------------------------------------------------------- the results

test('results: a death in overtime after a clear is a clear; the heading says when, and the overtime after', () => {
  const r = { end: 'died', cleared: true, timeSurvived: 1510, level: 40, totalKills: 9000, bossesKilled: [{ id: 'the_tidecaller', time: 1267 }], overtimeMinutes: 4, evolutions: [], materials: {}, map: 'drowned_docks' };
  assert.equal(runSummary(r, DATA).title, 'Map cleared');
  assert.equal(clearedAt(r, DATA), 1267);
  assert.equal(clearedAt({ ...r, cleared: false }, DATA), null);
  assert.equal(runSummary({ ...r, cleared: false }, DATA).title, 'Defeated');
  // The screen: its heading pinned above the news, an 800 ms input delay, and the hint row.
  const document = installFakeDocument();
  const ctx = { ui: { glyph: (a) => { const s = document.createElement('span'); s.textContent = a; return s; } }, icon: () => document.createElement('span') };
  const s = resultsScreen(ctx, { data: DATA, changes: [{ kind: 'material', id: 'coin', count: 3 }], next: [], summary: { title: 'Results', line: 'Survived 1:00' }, onContinue() {}, onSetOut() {} });
  assert.equal(s.ignoreMs, RESULTS_INPUT_DELAY_MS);
  assert.equal(RESULTS_INPUT_DELAY_MS, 800);
  assert.ok(s.el.querySelector('.results-head h1'));
  assert.ok(s.el.querySelector('.hint'));
  // A feat's materials on its line and in the totals.
  const lines = changeLines(DATA, [{ kind: 'feat', id: 'dawn', unlocks: [], materials: { coin: 150, map_scraps: 2 } }]).map((l) => l.text);
  assert.deepEqual(lines, ['150 Coin', '2 Map Scraps', 'Order done: Bell Breaker, +150 Coin, +2 Map Scraps']);
});

// ---------------------------------------------------------------- notices in runs

test('a level\'s gift: repeats on levels in a row collapse into one line, said on the quiet line', () => {
  const g = createGiftNotices(900);
  g.add(GIFT.COIN, 10, 54, 0);
  g.add(GIFT.COIN, 10, 55, 300);
  g.add(GIFT.COIN, 10, 56, 600);
  assert.deepEqual(g.take(1000), [], 'still collecting');
  assert.deepEqual(g.take(1500), ['Levels 54 to 56: +30 Coin']);
  g.add(GIFT.COIN, 10, 57, 2000);
  g.add(GIFT.EMBER, 1, 58, 2100);
  assert.deepEqual(g.take(2100), ['Level 57: +10 Coin'], 'another kind breaks the row');
  assert.deepEqual(g.flush(), ['Level 58: +1 Ember']);
  g.add(GIFT.GLASS, 3, 60, 0); g.add(GIFT.GLASS, 3, 62, 10);
  assert.deepEqual(g.flush(), ['Level 60: +3 Pearls', 'Level 62: +3 Pearls'], 'only levels in a row (0.8.2: Sea Glass is Pearls)');
  assert.deepEqual([giftText(GIFT.FOOD, 1), giftText(GIFT.EMBER, 2), giftText(GIFT.GLASS, 1)], ['Food', '+2 Embers', '+1 Pearl']);
  g.add(GIFT.COIN, 0, 70, 0);
  assert.deepEqual(g.flush(), [], 'nothing for nothing');
});

test('the run\'s notices: what asks nothing goes quiet; a muster is warned; a ready weapon is said again only for a chest', () => {
  const ev = createEventBuffer(32, 4);
  ev.push(EV.TASK, 0, 0, 1, 2, 0, 0);    // a lamp lit
  ev.push(EV.FERRY, 0, 0, 1, 2);         // new stock
  ev.push(EV.ELITE_SPAWN, 0, 0, 0, 1);   // an elite: loud, and a chest within reach
  ev.push(EV.TASK, 0, 0, 1, 1, 0, 0);    // a task started: loud
  // 0.8.2: the Ferryman tying up nearby and a bell rung (its chest to open) are loud; Lantern
  // Night banked, the fog taking the lamps back, and the relic pool running out are quiet.
  ev.push(EV.FERRY, 0, 0, 3, 0, 1);      // he calls
  ev.push(EV.TASK, 0, 0, 2, 2, 0, 0);    // a bell rung
  ev.push(EV.NIGHT, 0, 0, 2, 0, 1);      // banked
  ev.push(EV.TASK, 0, 0, 1, 3, 0, 0);    // the fog takes a lamp
  ev.push(EV.RELIC_POOL, 0, 0, 1, 5, 5);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => quietNotice(ev, i)), [true, true, false, false, false, false, true, true, true]);
  assert.deepEqual([0, 1, 2, 3].map((i) => chestSource(ev, i)), [false, false, true, false]);
  const world = { enemyDefs: [{ name: 'Bloater' }] };
  assert.equal(chestSourceName(ev, 2, world), 'the elite Bloater');
  if (EV.MUSTER_SOON !== undefined) {
    ev.clear();
    ev.push(EV.MUSTER_SOON, 0, 0);
    assert.equal(noticeFor(ev, 0, {}), 'A muster in 5s');
  }
});

// ---------------------------------------------------------------- the pad unplugged mid-run

test('the pad in use unplugged: the sim pauses, the run is told (it opens the pause menu), and a reconnect doesn\'t resume the menu', () => {
  const reasons = new Set();
  const loop = { pause: (r) => reasons.add(r), resume: (r) => reasons.delete(r) };
  const handlers = {};
  const input = { device: 'gamepad', activePad: 0, on: (k, f) => { handlers[k] = f; return () => {}; } };
  const win = { addEventListener() {}, removeEventListener() {} };
  let lost = 0;
  wirePauses({ loop, input, win, onControllerLost: () => { lost++; reasons.add('menu'); } });
  handlers.disconnect({ index: 1 });
  assert.equal(lost, 0, 'a pad nobody was using');
  handlers.disconnect({ index: 0 });
  assert.equal(lost, 1);
  assert.ok(reasons.has('controller') && reasons.has('menu'));
  handlers.connect();
  assert.deepEqual([...reasons], ['menu'], 'the pause menu holds until Resume is pressed');
});

// ---------------------------------------------------------------- save codes

test('save codes: a cancelled picker says nothing; a bad code says what\'s wrong in plain words; a good one asks, then replaces through the keeper', async () => {
  const document = installFakeDocument();
  const root = document.createElement('div');
  document.body.appendChild(root);
  const input = createInput({ getGamepads: () => [], target: new EventTarget(), now: () => 0 });
  const ui = createUi({ root, input, doc: document, sound: () => {} });
  const menuCtx = { ui, icon: () => document.createElement('span'), sound: () => {} };
  const store = createStore({ backend: createKvBackend(memoryKv(), 'test') });
  const kept = [];
  const mine = defaultProfile();
  const keeper = { profile: mine, keep: async (doc, o) => { kept.push([doc, o]); keeper.profile = doc; return true; } };
  let next = null, imported = 0;
  const files = [];
  const codes = createSaveCodes({ ui, menuCtx, store, keeper, data: DATA, deliverFile: async (name, text) => { files.push([name, text]); return `the saves folder as ${name}`; }, copy: async () => true, pickText: async () => next, onImported: () => imported++ });
  const s = codes.open();
  assert.match(s.el.className, /savecode-screen/);
  assert.ok(s.el.querySelector('.hint'), 'the shared hint row');
  // Export: a file, and the clipboard.
  await codes.exportCode();
  assert.equal(files.length, 1);
  assert.match(files[0][0], /save-code\.txt$/);
  assert.deepEqual(decodeExportCode(files[0][1]), mine);
  assert.match(s.note, /^Save code saved to the saves folder as .*\. It is on the clipboard too\.$/);
  // Cancelled: nothing.
  next = null;
  await codes.importCode();
  assert.equal(s.note, '');
  assert.equal(ui.top, s);
  // Bad: plain words, no "checksum".
  const other = defaultProfile(); other.stats.runs = 12; other.profile.buildings.lamp_post = 3;
  const good = encodeExportCode(other);
  next = `${good.slice(0, -1)}${good.at(-1) === '0' ? '1' : '0'}`;
  await codes.importCode();
  assert.match(s.note, /damaged/);
  assert.doesNotMatch(s.note, /checksum|crc|mismatch/i);
  next = 'hello';
  await codes.importCode();
  assert.match(s.note, /not a Lamplight save code/);
  // Good: asks first, with what the code holds; Import replaces through the keeper (rotating backups).
  next = good;
  await codes.importCode();
  const ask = ui.top;
  assert.match(ask.el.className, /confirm-screen/);
  assert.ok(textsOf(ask.el).some((x) => /^This code holds 12 runs, 0 hours played, 1 building restored \(3 levels\), 0 characters\./.test(x)), textsOf(ask.el).join(' | '));
  await ask.el.querySelector('[data-focus="yes"]').click();
  await new Promise((r) => setImmediate(r));
  assert.equal(kept.length, 1);
  assert.equal(kept[0][1].rotate, true);
  assert.equal(kept[0][0].stats.runs, 12);
  assert.equal(imported, 1);
  // The summary and the error words, alone.
  assert.equal(importSummaryText({ runs: 1, hours: 0.5, buildings: 0, buildingLevels: 0, characters: 1 }), '1 run, 0.5 hours played, no buildings restored, 1 character');
  assert.equal(importErrorText(new Error('x')), "That file doesn't hold a Lamplight save code.");
  // Every error the codec can give is in plain words.
  for (const bad of ['', 'LAMP1.', 'LAMP1.abc.zzzzzzzz', 'LAMP9.a.00000000', `${good}.extra`]) {
    try { decodeExportCode(bad); assert.fail('should refuse'); } catch (e) { assert.doesNotMatch(e.message, /checksum|crc|deflate|base64|JSON/i, e.message); }
  }
});

test('save codes: the file picker resolves to null when cancelled, however the browser says so', async () => {
  const document = installFakeDocument();
  const listeners = {};
  const win = { addEventListener: (k, f) => { listeners[k] = f; }, removeEventListener: (k) => { delete listeners[k]; } };
  // The input's own 'cancel'.
  const p1 = pickTextFile({ doc: document, win, waitMs: 5 });
  const input1 = document.body.querySelector('input');
  input1.dispatchEvent({ type: 'cancel' });
  assert.equal(await p1, null);
  assert.equal(document.body.querySelector('input'), null, 'the input goes');
  // No 'cancel' event: the window's focus comes back with no file chosen.
  const p2 = pickTextFile({ doc: document, win, waitMs: 5 });
  listeners.focus();
  assert.equal(await p2, null);
  // A file chosen: its text.
  const p3 = pickTextFile({ doc: document, win, waitMs: 5 });
  const input3 = document.body.querySelector('input');
  input3.files = [{ text: async () => 'LAMP1.x.y' }];
  input3.dispatchEvent({ type: 'change' });
  assert.equal(await p3, 'LAMP1.x.y');
});

test('save codes: in the title\'s menu and the harbor\'s', () => {
  const document = installFakeDocument();
  const ctx = { ui: { glyph: (a) => { const s = document.createElement('span'); s.textContent = a; return s; } }, icon: () => document.createElement('span') };
  const t = titleScreen(ctx, { build: buildStampText('0.7.3+20261020T143000Z', { utc: true }), onStart() {}, onSettings() {}, onCredits() {}, onSaveCode() {} });
  assert.ok(t.el.querySelector('[data-focus="savecode"]'));
  assert.ok(textsOf(t.el).includes('Build 0.7.3, Oct 20, 14:30'));
  const m = hubMenuScreen(ctx, { onResume() {}, onSetOut() {}, onSettings() {}, onTitle() {}, onSaveCode() {}, onCodex() {} });
  assert.ok(m.el.querySelector('[data-focus="savecode"]') && m.el.querySelector('[data-focus="codex"]'));
  assert.equal(hubMenuScreen(ctx, { onResume() {}, onSetOut() {}, onSettings() {}, onTitle() {} }).el.querySelector('[data-focus="codex"]'), null, 'no codex in the menu before a run');
  assert.ok(saveCodeScreen(ctx, { onExport() {}, onImport() {}, onBack() {} }).el.querySelector('[data-focus="import"]'));
  assert.equal(buildStampText('dev'), 'Build dev');
});

// ---------------------------------------------------------------- the screens

test('the hint row: one helper, prompts in order with the same spacing', () => {
  const document = installFakeDocument();
  const ctx = { ui: { glyph: (a) => { const s = document.createElement('span'); s.className = 'glyph'; s.textContent = a; return s; } } };
  const row = hintRow(ctx, ['confirm', 'Select'], ['back', 'Back']);
  assert.equal(row.className, 'hint');
  assert.equal(row.textContent, 'confirm Select   back Back');
  assert.equal(hintRow(ctx, 'Choose', null, ['back', 'Back']).textContent, 'Choose   back Back');
});

test('lists: whole rows, and a solid band above and below says how many are out of view', () => {
  const rows = [0, 1, 2, 3, 4, 5].map((k) => ({ top: k * 20, bottom: k * 20 + 18 }));
  assert.deepEqual(bandCounts({ top: 0, bottom: 60 }, rows), { above: 0, below: 3 });
  assert.deepEqual(bandCounts({ top: 30, bottom: 90 }, rows.map((r) => r)), { above: 2, below: 2 }, 'a row cut at an edge counts as out of view');
  // Moving focus down past the bottom: the focused row comes whole into view, and the top row is whole too.
  const dy = snapScroll({ top: 0, bottom: 50 }, rows, rows[3]);
  assert.ok(rows[3].bottom - dy <= 50 && rows[3].top - dy >= 0, 'the focused row whole');
  assert.ok(!rows.some((r) => r.top - dy < 0 && r.bottom - dy > 0), 'no row cut at the top');
  assert.equal(snapScroll({ top: 0, bottom: 60 }, rows, rows[1]), 0, 'already in view');
  assert.equal(snapScroll({ top: 40, bottom: 100 }, rows, rows[1]), -20);
  // On the page: bands named in words, solid (a class, no gradient in the CSS), updated as focus moves.
  const document = installFakeDocument();
  const items = rows.map((r, k) => { const el = document.createElement('div'); el.className = 'list-row'; el.dataset.focus = `r${k}`; el.rect = { left: 0, top: r.top, width: 10, height: 18 }; return el; });
  const wrap = bandList({ class: 'list' }, ...items);
  const list = wrap.bands.list;
  list.rect = { left: 0, top: 0, width: 10, height: 60 };
  document.body.appendChild(wrap);
  const scope = createFocusScope(wrap);
  scope.refresh();
  assert.equal(wrap.querySelector('.list-band.down').textContent, '3 more');
  assert.equal(wrap.querySelector('.list-band.up').textContent, '');
  assert.ok(wrap.querySelector('.list-band.down').classList.contains('on'));
  const css = readFileSync(new URL('../src/ui/ui.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ''), /gradient\s*\(/i, 'no gradients anywhere in the UI');
});

test('the tuning panels: plain names with units, groups in words', () => {
  assert.deepEqual(plainName('run.materialMul'), { label: 'Material multiplier', unit: 'x' });
  assert.deepEqual(plainName('ferry.restockSec'), { label: 'Restock', unit: 's' });
  assert.deepEqual(plainName('feel.hitStop.bossKill'), { label: 'Boss kill', unit: 'ms' });
  assert.deepEqual(plainName('tasks.lamp.radius'), { label: 'Radius', unit: 'px' });
  assert.equal(plainGroup('hub.look.fog'), 'Harbor look, fog');
  assert.equal(plainGroup('player.stats'), 'Player stats');
  assert.deepEqual([valueText(1.2, 'x'), valueText(45, 's'), valueText(84, 'px'), valueText(true, null), valueText(3, null)], ['1.2x', '45s', '84 px', 'On', '3']);
  for (const p of ['xp.first', 'feel.flash.playerHurtMs', 'hub.timing.walkOff']) assert.ok(!/[A-Z].*[A-Z]|\./.test(plainName(p).label.slice(1)), `${p}: words, not code (${plainName(p).label})`);
});

test('the materials bar: 9,999 in full, then 12.3k', () => {
  assert.deepEqual([0, 999, 9999, 12345, 999999, 4560000].map(countText), ['0', '999', '9,999', '12.3k', '999.9k', '4.5M']);
});

test('the codex\'s enemy page (the harbor\'s menu; ruling 13): every enemy met with its kills once, its Hunt\'s count, and blanks for the rest', () => {
  const document = installFakeDocument();
  const ctx = { ui: { glyph: (a) => { const s = document.createElement('span'); s.textContent = a; return s; } }, icon: () => document.createElement('span') };
  const doc = make({}, {}, { bestiary: { bilge_rat: 1234, drowned_bosun: 12, harbor_maw: 2 }, feats: ['hunt_drowned_bosun'] });
  const s = codexScreen(ctx, { data: DATA, get: () => ({ doc }), initialGroup: 'enemy', onBack() {} });
  assert.ok(s.scope.focusKey(`x:enemy:${DATA.enemies[0].id}`));
  const rat = textsOf(s.el.querySelector('[data-focus="x:enemy:bilge_rat"]'));
  assert.ok(rat.includes('1,234 kills') && rat.includes(`Bilge Rat Hunt: 1,234 of ${HUNT_COUNTS.bilge_rat.toLocaleString('en-US')}`)   /* (X3: the count from the data) */, rat.join(' | '));
  assert.equal(textsOf(s.el).filter((x) => x === '1,234 kills').length, 1, 'the count said once');
  assert.ok(textsOf(s.el.querySelector('[data-focus="x:enemy:drowned_bosun"]')).includes('Drowned Bosun Hunt: done'));
  const maw = textsOf(s.el.querySelector('[data-focus="x:boss:harbor_maw"]'));
  assert.ok(maw.includes('2 kills') && !maw.some((x) => /Hunt/.test(x)), 'a boss has a count and no Hunt');
  assert.ok(textsOf(s.el.querySelector('[data-focus="x:enemy:gull"]')).includes('???'), 'not met: a blank');
  // One map's codex (the pause menu's): that map's enemies only, and what it has shown first.
  const marsh = codexScreen(ctx, { data: DATA, get: () => ({ doc: { ...doc, profile: { ...doc.profile, seen: { salt_marsh: ['water', 'enemy:leech'] } } } }), map: 'salt_marsh', onBack() {} });
  assert.equal(marsh.el.querySelector('h1').textContent, 'Codex: Salt Marsh');
  assert.equal(marsh.el.querySelector('[data-focus="x:enemy:bilge_rat"]'), null);
  assert.ok(textsOf(marsh.el.querySelector('[data-focus="x:place:water"]')).includes('High water'));
  assert.ok(textsOf(marsh.el.querySelector('[data-focus="x:enemy:leech"]')).some((x) => x.trim() === 'Leech'), 'sighted this run: shown before its first kill');
});

test('every character has a waiting line, and a trophy for every enemy that isn\'t a boss', () => {
  for (const c of DATA.characters) {
    const d = make();
    assert.ok(lineFor(d, DATA, c.id).text !== '...', `${c.id} has a line`);
    assert.ok(c.hubLine || WAITING_LINES[c.id], c.id);
  }
  const lines = Object.values(WAITING_LINES);
  assert.equal(new Set(lines).size, lines.length, 'no two alike');
  // The keepers' lines: none shares a template with another's.
  const all = DATA.npcs.flatMap((n) => n.lines.map((l) => l.text));
  for (const phrase of ['Out all night', 'the big one', 'five minutes', 'ten thousand']) assert.ok(all.filter((t) => t.toLowerCase().includes(phrase.toLowerCase())).length <= 1, phrase);
  for (const e of DATA.enemies.filter((x) => !(x.tags || []).includes('boss'))) assert.ok(DATA.trophies.some((c) => c.enemy === e.id && c.unlock === `feat:hunt_${e.id}`), `${e.id}: a trophy, opened by its Hunt`);
  assert.ok(!DATA.trophies.some((c) => DATA.enemies.find((e) => e.id === c.enemy)?.tags.includes('boss')), 'none for a boss');
  // The Bell Pendant's own affix is a rule, not a stat.
  const pendant = DATA.recipes.find((r) => r.id === 'bell_pendant');
  assert.equal(DATA.affixes.find((a) => a.id === pendant.base).kind, 'hook');
  // A fresh profile holds no trophy.
  assert.deepEqual(resolveContent(make(), DATA).trophies, []);
});

test('B1\'s events read right: an overtime muster by its repeat name, its warning in seconds, a NO_CHEST elite never a chest, the next chest named', async () => {
  const { NO_CHEST } = await import('../src/sim/enemies.js');
  const { createWorld } = await import('../src/sim/world.js');
  const { nextChestText, chestSource } = await import('../src/app/runlogic.js');
  const { cardInfo, capstoneFor } = await import('../src/ui/describe.js');
  const { tideRules } = await import('../src/ui/hubtext.js');
  const w = createWorld({ seed: 'b1', map: DATA.maps[0].id, character: 'lamplighter', mode: 'standard', invulnerable: true }, DATA);
  const ev = createEventBuffer(16, 2);
  const reps = w.map.overtime?.repeat || [];
  const k = reps.findIndex((r) => r.name);
  if (k >= 0) { ev.push(EV.MUSTER, 0, 0, 30, 0, -1 - k); assert.equal(noticeFor(ev, 0, w), `${reps[k].name} and crew. Kill the captain for a chest`, 'an overtime muster by its repeat name, and what to do'); }
  ev.clear();
  ev.push(EV.MUSTER_SOON, 0, 0, 5, Math.max(0, k));
  assert.equal(noticeFor(ev, 0, w), 'A muster in 5s');
  // An elite marked NO_CHEST (a Tide pair's second) is no chest source.
  const E = w.enemies;
  const i = E.alloc();
  E.boss[i] = NO_CHEST;
  ev.clear();
  ev.push(EV.ELITE_SPAWN, 0, 0, 0, E.handle(i));
  assert.equal(chestSource(ev, 0, w), false);
  E.boss[i] = -1;
  assert.equal(chestSource(ev, 0, w), true);
  // The first ready line names the next chest (at 0:00: the next one on the timeline).
  assert.match(nextChestText(w) ?? '', /^(the next chest comes at \d+:\d\d|kill the elite .+ for its chest|open the chest on the map)$/);
  // A new weapon's card says what opens its capstone: its deed, or the project the profile lacks
  // (ruling 19 PA, short).
  const cap = capstoneFor(DATA, 'tide_bell');
  assert.equal(cardInfo({ kind: 'weapon', id: 'tide_bell', isNew: true }, DATA, { tags: {}, weapons: [], passives: [], pool: [] }).note, null, 'not before a Form screen (RULING-L1)');
  assert.equal(cardInfo({ kind: 'weapon', id: 'tide_bell', isNew: true }, DATA, { tags: {}, weapons: [], passives: [], pool: [], formSeen: true }).note, `Final Form goal: ${cap.deed.text}`);
  assert.match(cardInfo({ kind: 'weapon', id: 'tide_bell', isNew: true }, DATA, { tags: {}, weapons: [], passives: [], forms: [], formSeen: true }).note, /^Final Form locked: needs .+ \(Library\)$/);
  // Tide rules: a Tide plays with its own and every one below it.
  assert.deepEqual(tideRules(DATA, 1), []);
  assert.equal(tideRules(DATA, 3).length, DATA.tides.slice(0, 3).filter((t) => t.rule?.desc).length);
});
