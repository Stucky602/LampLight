// The presentation batch (C3, ruling 14 E and C9, ruling 16): every growth and character event
// has a sound of its own (and a rumble where it is a big moment), no two weapons fire alike, each
// Dash slot item sounds its own, every capstone has a look, the HUD's character meter reads the
// trade's own state and fits beside the rest of the HUD, two bosses get two bars, and a card's
// "now → after" line is drawn without leaving the one typeface.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA } from '../src/data/index.js';
import { SFX, DASH_SOUND, RUMBLE } from '../src/data/sfx.js';
import { color as pal } from '../src/data/palette.js';
import { EV, createEventBuffer } from '../src/sim/events.js';
import { createWorld, stepWorld } from '../src/sim/world.js';
import { growthSound, soundFor, noticeFor } from '../src/app/runlogic.js';
import { fireSound, dashSound } from '../src/audio/cues.js';
import { rumbleFor } from '../src/render/rumble.js';
import { CAPSTONE_LOOK, capstoneLook } from '../src/render/looks.js';
import { createHudModel, updateHudModel, updateTrade, placeTrade, HUD_LAYOUT, createHudPlaces, placeHud } from '../src/render/hudmodel.js';
import { createViewState, consumeEvents } from '../src/render/viewstate.js';
import { textWidth, FONT_H } from '../src/render/font.js';
import { VIEW_W, VIEW_H } from '../src/render/layout.js';
import { MAX_WEAPON_SLOTS } from '../src/sim/constants.js';

const IDLE = { mx: 0, my: 0, buttons: 0 };
const evOf = (...rows) => { const ev = createEventBuffer(64, 8); for (const r of rows) ev.push(...r); return ev; };

function field(character) {
  const map = {
    id: 'c3_field', name: 'Field', desc: 'For tests.', size: [128, 128], ambient: 0.5, layout: { kind: 'open' },
    materials: [], commonDrops: [], eliteDrops: [], pickups: null,
    timeline: { bands: [{ from: 0, to: 60, roster: { fog_wisp: 1 }, density: [0, 0] }], events: [] },
    overtime: { densityPerMin: 1.12, hpPerMin: 1.15, materialsPerMin: 1.1 }, secrets: [],
  };
  return createWorld({ seed: 3, map: 'c3_field', character, invulnerable: true }, { ...DATA, maps: [...DATA.maps, map] });
}

test('C3 sounds: every growth and character event (81 to 95) that marks a moment has its own sound, and each exists', () => {
  const ev = evOf(
    [EV.DEED, 0, 0, 0, 60, 60, 1], [EV.AXIS_OPEN, 0, 0, 0, 1, 0], [EV.LEGENDARY, 0, 0, 0, 0], [EV.UPGRADE, 0, 0, 0, 2, 1], [EV.PLANT, 0, 0, 0, 1, 6], [EV.LOOP, 0, 0, 0, 40],
    [EV.TIDE, 0, 0, 0, 0, 60], [EV.MOMENTUM, 0, 0, 4], [EV.SIG_UP, 0, 0, 0, 1, 3], [EV.LANTERN, 0, 0, 30, 15], [EV.DIVE, 0, 0, 1], [EV.OIL, 0, 0, 0, 0],
    [EV.CALL_DEAD, 0, 0, 0, 1], [EV.HAUL, 0, 0, 1], [EV.SKILL, 0, 0, 3],
  );
  const got = Array.from({ length: ev.count }, (_, i) => growthSound(ev, i));
  assert.deepEqual(got, ['deed_done', 'axis_open', 'legendary', 'line_taken', 'plant', 'glass_ring', 'tide_ebb', 'momentum_full', 'sig_up', 'lantern_set', 'sea_chest', 'oil_low', 'dead_rise', 'haul_elite', 'skill']);
  for (const n of got) assert.ok(SFX[n], `${n} exists`);
  assert.equal(new Set(got).size, got.length, 'no two share one');
  // Through soundFor, the same (the run scene's one call).
  assert.equal(soundFor(ev, 2, []), 'legendary');
  // Quiet where nothing happened worth a sound: a deed's count moving, a number card, the flood itself (King Tide fires its own).
  const quiet = evOf([EV.DEED, 0, 0, 0, 3, 60, 0], [EV.UPGRADE, 0, 0, 0, 0, 0], [EV.TIDE, 0, 0, 1, 0, 60]);
  assert.deepEqual([0, 1, 2].map((i) => growthSound(quiet, i)), [null, null, null]);
  // A Form taken has its own sound now (not the old evolve), a capstone a deeper one, and no line to read mid-fight.
  const asc = evOf([EV.ASCEND, 0, 0, 0, 0], [EV.ASCEND, 0, 0, 0, 1]);
  assert.deepEqual([soundFor(asc, 0, []), soundFor(asc, 1, [])], ['form_pick', 'capstone_pick']);
  assert.equal(noticeFor(asc, 0, { slots: [] }), null);
});

test('C3 rumble: a Legendary taken, a deed done, a sea chest, an elite yanked, a called tide; each short', () => {
  const ev = evOf([EV.LEGENDARY, 0, 0, 0, 0], [EV.DEED, 0, 0, 0, 60, 60, 1], [EV.DEED, 0, 0, 0, 3, 60, 0], [EV.DIVE, 0, 0, 1], [EV.DIVE, 0, 0, 0], [EV.HAUL, 0, 0, 1], [EV.HAUL, 0, 0, 4], [EV.TIDE, 0, 0, 1, 1, 60], [EV.TIDE, 0, 0, 1, 0, 60]);
  assert.deepEqual(Array.from({ length: ev.count }, (_, i) => rumbleFor(ev, i)), ['legendary', 'deedDone', null, 'seaChest', null, 'haul', null, 'tideCall', null]);
  for (const k of ['legendary', 'deedDone', 'seaChest', 'haul', 'tideCall']) assert.ok(RUMBLE[k] && RUMBLE[k].ms <= 400, k);
  assert.ok(RUMBLE.legendary.strong + RUMBLE.legendary.weak > RUMBLE.capstone.strong + RUMBLE.capstone.weak, 'a Legendary shakes hardest of the picks');
});

test('C3 weapons: no two fire alike (each its own sound, and two of one wave shape are a fifth of the pitch apart or slide opposite ways)', () => {
  const seen = new Map();
  for (const w of DATA.weapons) {
    const s = fireSound(w);
    if (s === null) continue;
    assert.ok(SFX[s], `${w.id}: ${s} exists`);
    assert.ok(!seen.has(s), `${w.id} and ${seen.get(s)} both fire ${s}`);
    seen.set(s, w.id);
  }
  const list = [...seen.keys()].map((n) => ({ n, f: SFX[n].zzfx[2], shape: SFX[n].zzfx[6] ?? 0, slide: Math.sign(SFX[n].zzfx[8] ?? 0) }));
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j];
    if (a.shape !== b.shape) continue;
    const ratio = Math.max(a.f, b.f) / Math.min(a.f, b.f);
    assert.ok(ratio >= 1.15 || a.slide !== b.slide, `${a.n} (${seen.get(a.n)}) and ${b.n} (${seen.get(b.n)}) sound alike`);
  }
});

test('C3 dash: each Dash slot item makes a light sound of its own (ruling 16)', () => {
  const got = DATA.dashes.map((d) => dashSound(d.id));
  assert.equal(new Set(got).size, DATA.dashes.length, 'one each');
  for (const [i, n] of got.entries()) { assert.ok(SFX[n], n); assert.ok(SFX[n].gain <= SFX.dash.gain, `${DATA.dashes[i].id}: light`); }
  for (const id of Object.keys(DASH_SOUND)) assert.ok(DATA.dashes.some((d) => d.id === id), `${id} is a dash item`);
  assert.equal(dashSound(null), 'dash');
  const ev = evOf([EV.DASH, 0, 0, 1, 0]);
  assert.equal(soundFor(ev, 0, [], null, 'long_push'), 'dash_long');
});

test('C3 looks: every capstone in the data has a look of its own, in palette colors; a weapon\'s two never match', () => {
  for (const line of DATA.ascensions) {
    const caps = (line.options || []).filter((o) => o.capstone);
    for (const o of caps) {
      const L = CAPSTONE_LOOK[o.id];
      assert.ok(L, `${line.line}: ${o.id} has a look`);
      assert.ok(Number.isInteger(pal(L.color)), `${o.id}: ${L.color} is a palette color`);
      assert.ok(!L.frame || ['DOT', 'SPARK', 'PLUS', 'RING'].includes(L.frame), `${o.id}: ${L.frame}`);
    }
    if (caps.length === 2) {
      const [a, b] = caps.map((o) => CAPSTONE_LOOK[o.id]);
      assert.ok(a.color !== b.color || a.frame !== b.frame, `${line.line}: its two capstones look alike`);
    }
  }
  assert.equal(capstoneLook([{ id: 'salvo' }, { id: 'phosphor', capstone: true }]), CAPSTONE_LOOK.phosphor);
  assert.equal(capstoneLook([{ id: 'salvo' }]), null);
});

test('C3 view: each growth event leaves something to see, and none moves the view', () => {
  const st = createViewState({ slots: 64, rand: () => 0.5 });
  const ev = evOf([EV.LEGENDARY, 10, 10, 0, 0], [EV.DEED, 10, 10, 0, 60, 60, 1], [EV.TIDE, 10, 10, 0, 0, 50], [EV.HAUL, 50, 10, 1], [EV.LOOP, 10, 10, 0, 30], [EV.DIVE, 10, 10, 1]);
  consumeEvents(st, ev, { now: 0, tick: 0, feel: DATA.tuning.feel, numbersOn: true, playerX: 0, playerY: 0, slotOf: () => -1, alive: 0, noBolt: -1 });
  assert.ok(st.sparks.count > 40, 'sparks and rings');
  assert.ok(st.lights.n >= 3, 'a light for the Legendary, the deed, the sea chest');
  assert.equal(st.hauls.n, 1, 'the Harpooner\'s line');
});

test('C3 HUD: each character\'s meter reads the trade, and sits clear of the rest of the HUD at its longest', () => {
  const kinds = {};
  for (const c of DATA.characters) {
    const w = field(c.id);
    for (let i = 0; i < 90; i++) stepWorld(w, IDLE);
    const m = updateHudModel(createHudModel(), w);
    kinds[c.id] = m.trade.kind;
    assert.ok(m.trade.label, `${c.id}: labeled`);
    assert.ok(m.weapons[0].sig, `${c.id}: the signature is marked, first`);
    assert.ok(m.weapons.filter((e) => e.sig).length === 1, `${c.id}: one signature`);
  }
  assert.deepEqual(kinds, { lamplighter: 'oil', harpooner: 'hook', punter: 'momentum', bog_warden: 'thralls', drowned_man: 'purse', tide_priest: 'tide' });
  // The Tide Priest's clock: the ebb marked at the half; lit in the last seconds before each beat.
  const w = field('tide_priest');
  for (let i = 0; i < 5; i++) stepWorld(w, IDLE);
  const t = updateTrade({}, w);
  assert.equal(t.mark, 0.5);
  w.trade.s.tideT = w.trade.s.tideEvery * 0.5 - 1; assert.equal(updateTrade(t, w).hot, true, 'before the ebb');
  w.trade.s.tideT = w.trade.s.tideEvery * 0.2; assert.equal(updateTrade(t, w).hot, false);
  // Placed at its longest (the Lamplighter's: label, steps, "Flames", pips; the purse's text): on screen, clear of the icons and bars.
  const L = HUD_LAYOUT;
  const longest = [
    placeTrade({}, { kind: 'oil', steps: 3, pipsMax: 3 }, { label: textWidth('Oil'), text: 0, flames: textWidth('Flames') }),
    placeTrade({}, { kind: 'purse', steps: 0, pipsMax: 0 }, { label: textWidth('Purse'), text: textWidth('Crate marked'), flames: 0 }),
    placeTrade({}, { kind: 'tide', steps: 0, pipsMax: 0 }, { label: textWidth('King Tide'), text: 0, flames: 0 }),
    placeTrade({}, { kind: 'momentum', steps: 4, pipsMax: 0 }, { label: textWidth('Momentum'), text: 0, flames: 0 }),
  ];
  const P = placeHud(createHudPlaces(), { hp: 40, level: 30, timer: 30, kills: 60, glass: 50, boss: 120, overtime: 90, notice: 300, quiet: 300 }, true);
  const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const icons = { x: L.icons.x, y: L.icons.weaponsY, w: MAX_WEAPON_SLOTS * L.icons.step + L.icons.sigGap, h: L.icons.passivesY + L.icons.size - L.icons.weaponsY };
  for (const b of longest) {
    const box = { x: b.x - 1, y: b.y - 1, w: b.w + 2, h: FONT_H + 2 };
    assert.ok(box.x >= 0 && box.x + box.w <= VIEW_W && box.y + box.h <= VIEW_H, 'on screen');
    assert.ok(!hit(box, icons), 'clear of the icons');
    for (const k of ['bossBar', 'bossName', 'notice', 'overtime']) assert.ok(!hit(box, P[k]), `clear of ${k}`);
  }
  assert.ok(L.icons.deedY + L.icons.deedH <= L.icons.passivesY, 'a deed bar sits between the rows');
});

test('C3 HUD: two bosses up at once (the Long Night) get two bars', () => {
  const w = field('lamplighter');
  const boss = DATA.enemies.filter((e) => e.ai.type === 'boss').slice(0, 2);
  const m = createHudModel();
  // A stand-in for the world's boss list: two alive.
  const fake = { ...w, bosses: boss.map((b, k) => ({ alive: true, handle: k, type: w.enemyIndex.get(b.id), notches: [] })), enemies: { resolve: (h) => h, hp: [50, 25], maxHp: [100, 100] } };
  updateHudModel(m, fake);
  assert.equal(m.bossCount, 2);
  assert.deepEqual([m.boss.frac, m.boss2.frac], [0.5, 0.25]);
  assert.deepEqual([m.boss.name, m.boss2.name], boss.map((b) => b.name));
  // Each name fits over its half of the bar (the two share the one bar's width).
  const half = (HUD_LAYOUT.bossBar.w - HUD_LAYOUT.bossPair.gap) / 2;
  for (const e of DATA.enemies.filter((x) => x.ai.type === 'boss')) assert.ok(textWidth(e.name) <= half, `${e.name} fits half a bar`);
});

test('C3 cards: "now → after" splits into the number now, a drawn arrow, and the number after (the typeface has no arrow)', async () => {
  const { installFakeDocument } = await import('./helpers/fakedom.js');
  installFakeDocument();
  const { changeLine } = await import('../src/ui/menus.js');
  const el = changeLine('Damage 24 → 29');
  assert.equal(el.querySelector('.change-now').textContent, '24');
  assert.equal(el.querySelector('.change-after').textContent, '29');
  assert.ok(el.querySelector('.arrow'));
  assert.equal(changeLine('Backblast: Also fires a flare straight behind you.'), 'Backblast: Also fires a flare straight behind you.');
});

test('C3 gate: every character has a card line of what they do and what it costs, each one line under the select\'s card width', async () => {
  const { installFakeDocument } = await import('./helpers/fakedom.js');
  installFakeDocument();
  // The card is 96 units wide less 4 a side of padding; the line is 8 units tall in Jersey 10, whose
  // glyphs run about half their height wide: about 22 characters a line at that size, less at 150%.
  // One line means it fits in two such lines at 100% (the cards' own width, measured on screen).
  for (const c of DATA.characters) {
    assert.ok(c.card && c.card.does && c.card.costs, `${c.id}: card.does and card.costs`);
    for (const line of [c.card.does, c.card.costs]) {
      assert.ok((line.match(/\. /g) ?? []).length <= 1, `${c.id}: "${line}" is at most two short sentences`);   // (round 3: "Can't heal. Takes 15% more damage with no shield.")
      assert.ok(line.length <= 50, `${c.id}: "${line}" is short (${line.length})`);
      assert.ok(!/px\b|\d+ ?pixels?/.test(line), `${c.id}: no pixels`);
    }
  }
});

test('C3 sounds: no two of the growth and character sounds share a wave shape and a pitch (axis_open was the sea chest)', () => {
  const names = ['legendary', 'form_pick', 'capstone_pick', 'axis_open', 'deed_done', 'line_taken', 'plant', 'glass_ring', 'tide_ebb', 'tide_call', 'momentum_step', 'momentum_full', 'sig_up', 'lantern_set', 'crate_up', 'sea_chest', 'oil_low', 'oil_fill', 'dead_rise', 'haul_elite', 'haul_loot', 'haul_line', 'skill'];
  const seen = new Map();
  for (const n of names) {
    const z = SFX[n].zzfx, key = `${z[6] ?? 0}:${z[2]}`;
    assert.ok(!seen.has(key), `${n} and ${seen.get(key)} share a shape and a pitch`);
    seen.set(key, n);
  }
});

test('C3 stats: a weapon a modifier keeps apart is named on the All weapons line (the Bog Warden: Bog Hands)', async () => {
  const { statsView } = await import('../src/app/runlogic.js');
  const w = createWorld({ seed: 1, map: 'drowned_docks', character: 'bog_warden', invulnerable: true }, DATA);
  for (let i = 0; i < 5; i++) stepWorld(w, IDLE);
  assert.match(statsView(w).allWeapons[0][1], /^-\d+% \(Bog Hands 0%\)$/);
});

test('damage shrink (RULING-L1, round 2): said once, plainly, in the glossary\'s Damage entry, not on a card; no multiplier anywhere', async () => {
  const { cardInfo } = await import('../src/ui/describe.js');
  const { makeWorld, give } = await import('./helpers/simworld.js');
  const { rollUpgrade } = await import('../src/sim/weaponups.js');
  const { createRng } = await import('../src/lib/rng.js');
  const { statsView } = await import('../src/app/runlogic.js');
  const w = makeWorld({});
  give(w, 'flare_gun', { level: 2 });
  const rng = createRng(3);
  let card = null;
  for (let k = 0; k < 400 && !card; k++) { const c = rollUpgrade(w, 0, rng); if (c?.up === 'damage') card = c; }
  assert.ok(card, 'a damage card rolls');
  const note = (shrink) => cardInfo({ ...card, kind: 'weapon', id: 'flare_gun', level: 3, shrink }, DATA, { tags: {}, weapons: ['flare_gun'], passives: [] }).note;
  assert.equal(note(undefined), null);
  assert.equal(note(1), 'Repeat Damage cards add less', 'Ruling 25 PA: on the card, short; the number is the glossary\'s (Damage)');
  assert.match(DATA.glossary.find((e) => e.id === 'stat_damage').more, /Each Damage card on the same weapon adds \d+% less than the last/);
  assert.equal(note(3), 'Repeat Damage cards add less', 'on every repeat');
  w.slots[0].ups.push({ up: 'damage' }, { up: 'damage' });
  assert.ok(!JSON.stringify(statsView(w)).includes('Next Damage card'), 'no multiplier row on the stats screen');
});

test('ruling 19: the gate strip (who-line, ledger, pad lines), the results\' ledger line, and passive level cards', async () => {
  const { installFakeDocument, textsOf } = await import('./helpers/fakedom.js');
  const { gateScreen, resultsScreen } = await import('../src/ui/hubscreens.js');
  const { applyRunResult } = await import('../src/meta/apply.js');
  const { defaultProfile } = await import('../src/save/schema.js');
  const { ledgerLines } = await import('../src/ui/hubtext.js');
  const { cardInfo } = await import('../src/ui/describe.js');
  const document = installFakeDocument();
  const ctx = { ui: { textScale: 1.5, glyph: (a) => { const e = document.createElement('span'); e.textContent = a; return e; } }, icon: () => document.createElement('span'), sound: () => {} };
  // A run, then its ledger: the results say what the trade did; the gate's strip says the ledger.
  const result = { character: 'lamplighter', map: DATA.maps[0].id, timeSurvived: 1200, end: 'cleared', cleared: true, tide: 0, trade: { lamps: 12, lanterns: 3 }, weapons: [], passives: [], relics: [], bossesKilled: [], kills: {} };
  const one = applyRunResult(defaultProfile(), result, DATA);
  const led = one.changes.find((c) => c.kind === 'ledger');
  assert.deepEqual([led.character, led.counts, led.best], ['lamplighter', { lamps: 12, lanterns: 3 }, []], 'a first run: counts, no "new best" yet');
  const two = applyRunResult(one.doc, { ...result, trade: { lamps: 15, lanterns: 1 } }, DATA);
  assert.deepEqual(two.changes.find((c) => c.kind === 'ledger').best, ['lamps']);
  const res = resultsScreen(ctx, { data: DATA, changes: two.changes, next: [], summary: { title: 'Results', line: 'Cleared' }, onContinue: () => {}, onSetOut: () => {} });
  assert.ok(textsOf(res.el).includes('Lamplighter: 15 lamps lit (a new best)'), textsOf(res.el).filter((t) => /Lamplighter/.test(t)).join(' / '));   // (Ruling 21 PB: one number)
  const c = DATA.characters.find((x) => x.id === 'lamplighter');
  const gate = gateScreen(ctx, { characters: [{ ...c, ledger: ledgerLines(two.doc, DATA, 'lamplighter') }], map: { name: 'Drowned Docks', desc: '' }, onSetOut: () => {}, onBack: () => {} });
  const strip = gate.el.querySelector('.char-detail');
  const lines = strip.querySelectorAll('[data-focus]');
  assert.ok(textsOf(strip).includes(c.who), 'the who-line at 150%, in the strip');
  assert.ok(textsOf(strip).some((t) => /^Ledger: .*cleared at Tide 0.*15 lamps lit/.test(t)), 'the ledger line');
  assert.ok(lines.length >= 2 && lines.every((e) => e.getAttribute('aria-disabled') === 'true'), 'each line takes the pad\'s focus, read only');
  const tops = strip.querySelectorAll('.char-col').map((col) => col.querySelector('[data-focus]')).filter(Boolean);
  assert.ok(tops.every((e) => e.dataset.navUp === 'c0'), 'up from a column\'s top line: back to the card');
  // Passive level cards: what this level adds, the total, and the rule its levels lead to.
  const mid = cardInfo({ kind: 'passive', id: 'wick_oil', level: 3, isNew: false }, DATA, { tags: {}, weapons: [], passives: [] });
  const ks = DATA.passives.find((p) => p.id === 'wick_oil');
  assert.match(mid.desc, /, \+\d+% Damage \(Fire\) in all$/);
  assert.equal(mid.rule, `Lv ${ks.maxLevel} bonus (${ks.maxLevel - 3} to go): ${ks.keystone.desc}`);   // (Ruling 23 PC)
  assert.equal(mid.step, 'No Fire weapon carried yet');
  assert.equal(cardInfo({ kind: 'passive', id: 'wick_oil', level: 3, isNew: false }, DATA, { tags: { fire: 1 }, weapons: ['flare_gun'], passives: [] }).step, 'Boosts Flare Gun');
  // Ruling 23 PA: a shared Rare trait carries the Shared tag; others don't.
  const fg = DATA.weapons.find((w) => w.id === 'flare_gun'), sh = fg.lines.find((l) => l.shared), own = fg.lines.find((l) => !l.shared);
  if (sh) assert.equal(cardInfo({ kind: 'weapon', id: 'flare_gun', level: 4, isNew: false, up: 'line', line: sh.id, rarity: sh.rarity, value: 0 }, DATA).shared, 'Shared');
  if (own) assert.equal(cardInfo({ kind: 'weapon', id: 'flare_gun', level: 4, isNew: false, up: 'line', line: own.id, rarity: own.rarity, value: 0 }, DATA).shared, null);
});

test('C3b (Ruling 25 WA): a Final Form is locked on the card only while none of its options is open (Tether has a later project of its own)', async () => {
  const { cardInfo } = await import('../src/ui/describe.js');
  const note = (forms) => cardInfo({ kind: 'weapon', id: 'harpoon_chain', level: 1, isNew: true }, DATA, { tags: {}, weapons: [], passives: [], formSeen: true, forms }).note;
  assert.match(note([]), /^Final Form locked: needs Ship's Ballast/);
  assert.doesNotMatch(note(['dead_weight']), /locked/, 'Ship\'s Ballast done, Stern Lines not: the Final Form is open (Dead Weight)');
});
