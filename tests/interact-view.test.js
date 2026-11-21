// The interactables overhaul's view, HUD, sound, rumble, and screens (0.8.2; I1b's side of
// work/interact/I1-CONTRACT.md): the dashed rings and the Ferryman rowing in (render/signview.js),
// the edge arrows (render/arrows.js), the map's row under the minimap (render/hudmodel.js), each
// kind's sound and rumble (app/runlogic.js, app/rumble.js), the notices, the Fog Bell's pick, the
// map's ledger, the Settings rows, and the gate's line of what a map holds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA } from '../src/data/index.js';
import { RUMBLE, SFX } from '../src/data/sfx.js';
import { createWorld } from '../src/sim/world.js';
import { EV, PICK } from '../src/sim/events.js';
import { TASK, TASK_STATE, PK } from '../src/sim/constants.js';
import { ARROW } from '../src/sim/signs.js';
import { createEventBuffer } from '../src/sim/events.js';
import { dashCount, dashSpan, skiffAt, gatherShare, DASH, SIGN_COLOR, createSignState, consumeSigns, FLARE } from '../src/render/signview.js';
import { edgePoint, pointAt, perimeterOf, placeArrows, ARROW_SIZE, ARROW_LOOK } from '../src/render/arrows.js';
import { createHudModel, updateHudModel, placeMapRow, HUD_LAYOUT } from '../src/render/hudmodel.js';
import { minimapBox, MINIMAP, MARK_SHAPES } from '../src/render/minimapmodel.js';
import { textWidth, FONT_H } from '../src/render/font.js';
import { VIEW_W, VIEW_H } from '../src/render/layout.js';
import { rumbleFor, rumbleEffect, createRumble } from '../src/app/rumble.js';
import { soundFor, pitchFor, noticeFor, quietNotice, haltView, ledgerLines, runSummary, pauseBuild, giftText, GIFT } from '../src/app/runlogic.js';
import { defaultSettings, normalizeSettings } from '../src/save/schema.js';
import { mapHoldsText, mapCard } from '../src/ui/hubtext.js';
import { bellPickScreen, relicScreen, runTips, ledgerText } from '../src/ui/menus.js';
import { installFakeDocument, textsOf } from './helpers/fakedom.js';
import { createUi } from '../src/ui/screens.js';
import { createInput } from '../src/input/input.js';
import { openSettings } from '../src/app/settings-flow.js';
import { defaultProfile } from '../src/save/schema.js';

const evOf = (...list) => {
  const ev = createEventBuffer(64, 8);
  for (const [t, x = 0, y = 0, a = 0, b = 0, c = 0, d = 0] of list) ev.push(t, x, y, a, b, c, d);
  return ev;
};

test('rings: dashed in even counts all the way round, a gap after each dash, from the top', () => {
  for (const r of [0, 4, 20, 30, 84, 220]) {
    const n = dashCount(r);
    assert.ok(n >= DASH.min && n % 2 === 0, `r ${r}: ${n}`);
  }
  assert.ok(dashCount(84) > dashCount(30), 'a wider ring, more dashes (each about the same length)');
  const n = dashCount(80), span = [0, 0], step = (Math.PI * 2) / n;
  dashSpan(0, n, span);
  assert.ok(Math.abs(span[0] + Math.PI / 2) < 1e-9, 'the first starts at the top');
  for (let k = 0; k < n; k++) {
    dashSpan(k, n, span);
    assert.ok(span[1] > span[0] && span[1] - span[0] < step, 'each dash is shorter than its step: a gap follows it');
  }
  // Each kind its own color (the arrows, rings, and minimap agree); the warning color is no one's.
  const warn = [0xdc5638, 0xf08a5d];
  for (const [k, c] of Object.entries(SIGN_COLOR)) assert.ok(!warn.includes(c), `${k} is not the warning color`);
  assert.notEqual(SIGN_COLOR.lamp, SIGN_COLOR.bell);
  assert.notEqual(SIGN_COLOR.bell, SIGN_COLOR.ferry);
});

test('the Ferryman: not there before his call; rows in from the fog to his mooring, slowing as he comes alongside, then rests there', () => {
  const out = {};
  assert.equal(skiffAt(null, 0, out).shown, false);
  assert.equal(skiffAt({ moored: false }, 0, out).shown, false, 'before his first call');
  const F = { moored: true, callTick: 100, tiedTick: 340, fromX: 0, fromY: 0, bx: 160, by: 0 };
  assert.deepEqual([skiffAt(F, 100, out).x, out.u], [0, 0], 'at his call: out in the fog');
  const half = skiffAt(F, 220, out).x;
  assert.ok(half > 80 && half < 160, 'past halfway at half the time (he slows as he comes in)');
  assert.deepEqual([skiffAt(F, 340, out).x, out.u], [160, 1], 'tied up');
  assert.equal(skiffAt(F, 9999, out).x, 160, 'and stays');
  // A tolled bell's crew gathering: 0 at the toll, 1 as they walk in; -1 for none.
  assert.equal(gatherShare({ crewTick: -1 }, 0, 72), -1);
  assert.equal(gatherShare({ crewTick: 172 }, 100, 72), 0);
  assert.equal(gatherShare({ crewTick: 172 }, 136, 72), 0.5);
  // A bell rung makes its wave; a lamp lit its flare.
  const w = createWorld({ seed: 1, character: 'lamplighter' }, DATA);
  const bell = w.tasks.findIndex((t) => t.kind === TASK.BELL), lamp = w.tasks.findIndex((t) => t.kind === TASK.LAMP);
  const S = createSignState(4);
  w.events.push(EV.TASK, 0, 0, TASK.BELL, 2, bell, 0);
  w.events.push(EV.TASK, 0, 0, TASK.LAMP, 2, lamp, 0);
  w.events.push(EV.TASK, 0, 0, TASK.LAMP, 1, lamp, 0);
  consumeSigns(S, w.events, w, 1000);
  assert.deepEqual([S.n, S.kind[0], S.kind[1]], [2, FLARE.WAVE, FLARE.LIT]);
  for (let k = 0; k < 6; k++) consumeSigns(S, w.events, w, 2000 + k);
  assert.equal(S.n, 4, 'a full store keeps its size (the oldest go)');
});

test('edge arrows: on the view\'s edge toward the target, under the top line, off the HUD\'s boxes, spread apart, each still pointing at its own', () => {
  const m = ARROW_SIZE.margin, top = ARROW_SIZE.top, o = {};
  edgePoint(VIEW_W + 500, VIEW_H / 2, VIEW_W, VIEW_H, m, o, top);
  assert.deepEqual([o.x, o.y], [VIEW_W - m, VIEW_H / 2], 'straight right: the right edge');
  edgePoint(VIEW_W / 2, -900, VIEW_W, VIEW_H, m, o, top);
  assert.deepEqual([o.x, o.y], [VIEW_W / 2, top], 'straight up: under the top line');
  // Round the edge and back.
  for (const s of [0, 100, 600, 900, 1300]) { const p = pointAt(s, VIEW_W, VIEW_H, m, {}, top); assert.ok(Math.abs(perimeterOf(p.x, p.y, VIEW_W, VIEW_H, m, top) - s) < 1e-6, `s ${s}`); }
  // Two kinds the same way: spread apart; a box on the edge: kept off it.
  const cam = { x: 1000, y: 1000 };
  const targets = [{ kind: ARROW.LAMP, x: 2000, y: 1000 }, { kind: ARROW.BELL, x: 2000, y: 1003 }, { kind: ARROW.CHEST, x: 1000, y: 3000 }];
  const box = { x: VIEW_W / 2 - 20, y: VIEW_H - 40, w: 40, h: 40 };
  const out = [];
  const n = placeArrows(targets, 3, cam, VIEW_W, VIEW_H, [box], out);
  assert.equal(n, 3);
  const d = Math.hypot(out[0].x - out[1].x, out[0].y - out[1].y);
  assert.ok(d >= ARROW_SIZE.spacing - 1e-6, `two the same way are ${d.toFixed(1)} px apart`);
  const pad = ARROW_SIZE.tip;
  assert.ok(!(out[2].x > box.x - pad && out[2].x < box.x + box.w + pad && out[2].y > box.y - pad), 'the one straight down is off the box');
  for (let k = 0; k < n; k++) {
    const t = targets[k], want = Math.atan2(t.y - cam.y + VIEW_H / 2 - out[k].y, t.x - cam.x + VIEW_W / 2 - out[k].x);
    assert.ok(Math.abs(out[k].angle - want) < 1e-9, 'points at its own target');
    assert.ok(out[k].x >= m - 1e-6 && out[k].x <= VIEW_W - m + 1e-6 && out[k].y >= top - 1e-6 && out[k].y <= VIEW_H - m + 1e-6, 'on the view');
  }
  // Every kind has a look: its color and a minimap mark (told apart by shape, never color alone).
  for (const k of Object.values(ARROW)) { assert.ok(ARROW_LOOK[k], `kind ${k}`); assert.ok(MARK_SHAPES[ARROW_LOOK[k].mark], `kind ${k}'s mark`); }
  const marks = Object.values(ARROW_LOOK).map((l) => l.mark);
  assert.equal(new Set(marks).size, marks.length, 'each kind its own mark');
});

test('the map\'s row: lamps lit and bells rung under the minimap, glowing while Lantern Night is banked; on screen and clear of the minimap at every setting', () => {
  const w = createWorld({ seed: 1, character: 'lamplighter' }, DATA);
  const m = createHudModel();
  updateHudModel(m, w);
  const lamps = w.tasks.filter((t) => t.kind === TASK.LAMP), bells = w.tasks.filter((t) => t.kind === TASK.BELL);
  assert.deepEqual([m.rowShown, m.lampsText, m.bellsText, m.banked], [true, `Lamps 0/${lamps.length}`, `Bells 0/${bells.length}`, false]);
  // (0.9.0, W4: an act's bells wake one at a time; the first is out at 0:00.)
  lamps[0].state = TASK_STATE.DONE; bells[0].state = TASK_STATE.DONE; w.night.banked = true;
  updateHudModel(m, w);
  assert.deepEqual([m.lampsText, m.bellsText, m.banked], [`Lamps 1/${lamps.length}`, `Bells 1/${bells.length}`, true]);
  const row = {};
  const widths = { lamps: textWidth('Lamps 99/99'), bells: textWidth('Bells 99/99') };
  for (const [mode, size] of [['off', 'small'], ['nearby', 'small'], ['nearby', 'large'], ['map', 'large']]) {
    const box = minimapBox(mode, size);
    const top = box ? box.y + box.h + 2 + HUD_LAYOUT.mapRow.gap : MINIMAP.top;
    placeMapRow(row, widths, top);
    assert.ok(row.x >= 0 && row.x + row.w <= VIEW_W - HUD_LAYOUT.edge + 1e-9 && row.y + row.h <= VIEW_H, `on screen (${mode} ${size})`);
    if (box) assert.ok(row.y >= box.y + box.h + 2, `under the minimap's frame (${mode} ${size})`);
    assert.ok(row.lampText > row.lampMark && row.bellText > row.bellMark && row.bellY >= row.lampY + FONT_H, 'mark and count, the bells under the lamps (RULING-L1: labeled)');
  }
  // The Pearls counter's words.
  w.glass = 1; updateHudModel(m, w);
  assert.equal(m.glassText, '1 Pearl');
  w.glass = 12; updateHudModel(m, w);
  assert.equal(m.glassText, '12 Pearls');
  assert.equal(giftText(GIFT.GLASS, 3), '+3 Pearls');
});

test('sounds by kind (idea 9): the lamp, the bell\'s toll, count, and ring, a Reliquary, the vault, a chest out of sight, a watched drop, the oar, Lantern Night banked and falling, a Pearl; the count climbs', () => {
  const view = { x: 0, y: 0, halfW: 320, halfH: 180 };
  const ev = evOf(
    [EV.TASK, 0, 0, TASK.LAMP, 1], [EV.TASK, 0, 0, TASK.LAMP, 2], [EV.TASK, 0, 0, TASK.LAMP, 3], [EV.TASK, 0, 0, TASK.BELL, 1], [EV.TASK, 0, 0, TASK.BELL, 2], [EV.TASK, 0, 0, TASK.BELL, 4],
    [EV.BELL_COUNT, 0, 0, 10, 0, 10], [EV.BELL_COUNT, 0, 0, 0, 0, 10],
    [EV.DROP, 0, 0, PICK.RELIQUARY], [EV.DROP, 0, 0, PICK.VAULT], [EV.DROP, 900, 0, PICK.CHEST], [EV.DROP, 10, 0, PICK.CHEST], [EV.DROP, 10, 0, PICK.CHEST, 2],
    [EV.FERRY, 0, 0, 3], [EV.NIGHT, 0, 0, 2], [EV.NIGHT, 0, 0, 1], [EV.GLASS, 0, 0, 3],
  );
  const got = Array.from({ length: ev.count }, (_, i) => soundFor(ev, i, [], view));
  assert.deepEqual(got, ['ui_confirm', 'lamp_lit', 'lamp_out', 'bell_toll', 'bell_ring', 'swarm', 'bell_count', 'bell_count',
    'reliquary_chime', 'vault_rise', 'chest_knock', null, 'ward_chime', 'ferry_oar', 'night_banked', 'night_falls', 'pearl']);
  for (const n of got) if (n) assert.ok(SFX[n], `${n} is a sound`);
  assert.equal(pitchFor(ev, 6), 1, 'the first kill at the toll\'s own pitch');
  assert.equal(pitchFor(ev, 7), 2, 'the last an octave up');
  assert.equal(pitchFor(ev, 0), 1, 'everything else as written');
  // None of the map's things borrows the level-up, evolve, or gem sound any more.
  for (const n of got) assert.ok(!['level_up', 'evolve', 'gem'].includes(n));
});

test('rumble by kind: a Reliquary, the vault, the Ferryman, a lamp, a bell, Lantern Night; at Settings\' strength, the pad in use only, one shake at a time, off when switched off', () => {
  const ev = evOf([EV.DROP, 0, 0, PICK.RELIQUARY], [EV.DROP, 0, 0, PICK.VAULT], [EV.DROP, 0, 0, PICK.CHEST], [EV.FERRY, 0, 0, 3], [EV.FERRY, 0, 0, 1], [EV.TASK, 0, 0, TASK.LAMP, 2], [EV.TASK, 0, 0, TASK.BELL, 2], [EV.TASK, 0, 0, TASK.BELL, 1], [EV.NIGHT, 0, 0, 1], [EV.NIGHT, 0, 0, 2]);
  assert.deepEqual(Array.from({ length: ev.count }, (_, i) => rumbleFor(ev, i)), ['reliquary', 'vault', null, 'ferry', null, 'lamp', 'bell', null, 'night', null]);
  for (const k of Object.keys(RUMBLE)) assert.ok(RUMBLE[k].ms > 0 && RUMBLE[k].ms <= 400, `${k}: short`);
  assert.deepEqual(rumbleEffect({ ms: 100, strong: 0.4, weak: 0.6 }, 0.5), { startDelay: 0, duration: 100, strongMagnitude: 0.4, weakMagnitude: 0.6 }, 'half strength is the data as written');
  assert.deepEqual([rumbleEffect({ ms: 1, strong: 0.7, weak: 0.4 }, 1).strongMagnitude, rumbleEffect({ ms: 1, strong: 0.7, weak: 0.4 }, 0).weakMagnitude], [1, 0], 'full doubles it (held to 1); 0 is still');
  // The Gamepad API: only the pad in use, only while a pad is what's in use.
  const played = [];
  const pad = (index) => ({ index, vibrationActuator: { playEffect: (type, fx) => { played.push([index, type, fx.duration]); return Promise.resolve(); } } });
  const settings = defaultSettings().controls;
  let t = 0, device = 'gamepad';
  const r = createRumble({ table: RUMBLE, settings: () => settings, getGamepads: () => [pad(0), pad(1)], activePad: () => 1, device: () => device, now: () => t });
  assert.equal(r.events(ev), true);
  assert.deepEqual(played, [[1, 'dual-rumble', RUMBLE.night.ms]], 'one shake for the frame, the strongest it asked for, on the pad in use');
  t += 10;
  assert.equal(r.play('lamp'), false, 'a weaker one while it runs is dropped');
  t += 1000;
  assert.equal(r.play('lamp'), true);
  settings.rumble = false;
  t += 1000;
  assert.equal(r.play('vault'), false, 'switched off');
  settings.rumble = true; device = 'keyboard';
  assert.equal(r.play('vault'), false, 'the keyboard has nothing to shake');
  // Settings: on at half strength by default; kept, and a bad value falls back.
  assert.deepEqual([defaultSettings().controls.rumble, defaultSettings().controls.rumbleStrength], [true, 0.5]);
  assert.deepEqual(normalizeSettings({ controls: { rumble: false, rumbleStrength: 0.3 } }).controls.rumbleStrength, 0.3);
  assert.equal(normalizeSettings({ controls: { rumble: false } }).controls.rumble, false);
  assert.equal(normalizeSettings({ controls: { rumble: 'yes', rumbleStrength: 4 } }).controls.rumbleStrength, 0.5);
  assert.equal(normalizeSettings({ controls: { rumble: 'yes' } }).controls.rumble, true);
});

test('Settings: Rumble, Rumble strength, and Edge arrows rows; a change reaches the live settings and shakes once to show it', () => {
  const document = installFakeDocument();
  const root = document.createElement('div');
  document.body.appendChild(root);
  const ui = createUi({ root, input: createInput({ getGamepads: () => [], target: new EventTarget(), now: () => 0 }), doc: document, sound: () => {} });
  ui.layout({ x: 0, y: 0, scale: 1 }, 640, 360);
  const settings = defaultSettings();
  const shakes = [];
  const s = openSettings({
    ui, menuCtx: { ui, icon: () => document.createElement('span'), sound: () => {} }, settings, desktop: false, native: null,
    atTitleOrHarbor: () => true, reopen: async () => true, input: { setSettings() {} }, audio: { setVolumes() {} }, renderer: { setFillScreen() {} }, save: async () => {},
    rumble: { play: (k) => shakes.push(k) },
  });
  const texts = textsOf(s.el);
  for (const t of ['Rumble', 'Rumble strength', 'Edge arrows', '50%']) assert.ok(texts.includes(t), `says "${t}"`);
  assert.ok(s.scope.focusKey('controls.rumbleStrength'));
  s.onNav('right');
  assert.equal(settings.controls.rumbleStrength, 0.6);
  assert.equal(shakes.length, 1, 'a shake at the new strength');
  assert.ok(s.scope.focusKey('controls.rumble'));
  s.onNav('right');
  assert.equal(settings.controls.rumble, false);
  assert.equal(shakes.length, 1, 'none when switched off');
  assert.ok(s.scope.focusKey('hud.arrows'));
  s.onNav('right');
  assert.equal(settings.hud.arrows, false);
});

test('notices: a lit lamp is a ward, a bell rung has a chest, Lantern Night banked, nothing for a lamp going out (lamps stay lit), the Ferryman tying up, the vault and a Reliquary landing, the pool found; one short line each', () => {
  const w = createWorld({ seed: 1, character: 'lamplighter', harbor: { ferry: 1 } }, DATA);
  const lamp = w.tasks.findIndex((t) => t.kind === TASK.LAMP), bell = w.tasks.findIndex((t) => t.kind === TASK.BELL);
  w.tasks[lamp].state = TASK_STATE.DONE; w.tasks[bell].need = 14;
  const lamps = w.tasks.filter((t) => t.kind === TASK.LAMP).length;
  const ev = evOf(
    [EV.TASK, 0, 0, TASK.LAMP, 2, lamp, 4], [EV.TASK, 0, 0, TASK.BELL, 1, bell], [EV.TASK, 0, 0, TASK.BELL, 2, bell, 9],
    [EV.NIGHT, 0, 0, 2], [EV.TASK, 0, 0, TASK.LAMP, 3, lamp], [EV.TASK, 0, 0, TASK.LAMP, 3, lamp + 1],
    [EV.FERRY, 0, 0, 3, 0, 1], [EV.FERRY, 0, 0, 1, 1], [EV.DROP, 0, 0, PK.VAULT], [EV.DROP, 0, 0, PK.RELIQUARY], [EV.RELIC_POOL, 0, 0, 1, 4, 4], [EV.VAULT_EMPTY, 0, 0, 1],
  );
  const said = Array.from({ length: ev.count }, (_, i) => noticeFor(ev, i, w));
  assert.deepEqual(said, [
    `Lamp 1 of ${lamps} lit: enemies in its light burn, and your Fuel is full, 4 Pearls`,   // (round 4: the Lamplighter's own rule)
    'Fog Bell: kill 14 enemies',
    'Bell rung: its chest gives one item +2 levels, 9 Pearls',
    'Lantern Night is ready. It starts when 10 enemies are near you',   // (round 4: the Lamplighter's own crowd)
    null, null,
    'The Ferryman tied up nearby', null,
    'A vault rose ahead: walk over it for a better relic', 'A Reliquary dropped nearby',
    'Every relic in the pool is found. Research, Harbor Orders, and secrets add more', 'The vault had no relic left: an Ember',
  ]);
  for (const t of said.filter(Boolean)) assert.ok(textWidth(t) <= VIEW_W - 40, `one short line: ${t}`);
  assert.ok(!said.some((t) => /Kindled|XP and Area|Sea Glass/.test(t ?? '')), 'nothing of Kindled or Sea Glass');
  assert.deepEqual(Array.from({ length: ev.count }, (_, i) => quietNotice(ev, i)), [true, false, false, true, true, true, false, true, false, false, true, true]);
});

test('the Fog Bell\'s pick: every weapon and passive offered, each with its levels and what they add, in a screen laid out as the other picks', () => {
  const w = createWorld({ seed: 1, character: 'lamplighter' }, DATA);
  const def = w.slots[0].def;
  const v = haltView(w, { kind: 'bellpick', options: [{ kind: 'weapon', id: def.id, slot: 0, from: 1, to: 3 }] }, DATA);
  assert.equal(v.kind, 'bellpick');
  assert.equal(v.levels, DATA.tuning.tasks.bell.levels);
  assert.deepEqual([v.options[0].name, v.options[0].sub, v.options[0].index], [def.name, 'Lv 1 to 3', 0]);
  assert.ok(v.options[0].desc.length > 0);
  const document = installFakeDocument();
  const picked = [];
  const ctx = { ui: { glyph: () => document.createElement('span') }, icon: () => document.createElement('span'), sound: () => {} };
  const opts = Array.from({ length: 12 }, (_, i) => ({ index: i, kind: i < 6 ? 'weapon' : 'passive', name: `Thing ${i}`, icon: 'x', sub: 'Lv 1 to 3', desc: '+1 Pierce' }));
  const s = bellPickScreen(ctx, { levels: 2, options: opts, onPick: (i) => picked.push(i) });
  const t = textsOf(s.el);
  for (const x of ['Fog Bell', 'Pick one to gain 2 levels.', 'Thing 0', 'Thing 11']) assert.ok(t.includes(x), x);
  assert.match(s.el.className, /bellpick-screen/);
  assert.match(s.el.querySelector('.cards').className, /many/, 'a dozen cards wrap, smaller');
  s.el.querySelectorAll('[data-focus]')[5].click();
  assert.deepEqual(picked, [5]);
  // The vault says it's one rarity higher (round 2: relics have rarities, not tiers); both say how much of the pool is found.
  const r = relicScreen(ctx, { vault: true, relics: [], pool: { found: 3, total: 5 }, onPick: () => {} });
  assert.ok(textsOf(r.el).some((x) => /one rarity higher/.test(x)) && textsOf(r.el).includes('Relics: 3 of 5 found'));
  // The Ferryman's relic found elsewhere since he stocked it: left off, the rest keep their index.
  const f = createWorld({ seed: 1, character: 'lamplighter', harbor: { ferry: 2 } }, DATA);
  f.ferry.offers = [{ kind: 0, id: DATA.relics[0].id, price: 10, sold: false, gone: true }, { kind: 1, price: 8, sold: false }];
  const fv = haltView(f, { kind: 'ferry' }, DATA);
  assert.deepEqual(fv.offers.map((o) => o.index), [1]);
  f.glass = 3;
  assert.equal(haltView(f, { kind: 'ferry' }, DATA).offers[0].why, 'Need 5 more Pearls');
});

test('the map\'s ledger: the pause menu and the run\'s end show the run against what the map holds; the gate\'s card says what it holds', () => {
  const L = { lamps: { lit: 6, most: 4, total: 5 }, bells: { rung: 2, total: 3 }, ferry: { calls: 3, trades: 3, bought: 2 }, relics: { found: 4, total: 5 }, secrets: { found: [], total: 1 }, nights: 1 };
  // 0.9.0 (V4: "Lamps 0/5" beside "Relics 4 of 4 found"): every count says "of".
  assert.deepEqual(ledgerLines(L), [['Lamps', '4 of 5 lit'], ['Bells', '2 of 3 rung'], ['Ferryman trades', '3'], ['Relics', '4 of 5 found'], ['Secret', 'Not found'], ['Lantern Nights', '1']]);
  assert.deepEqual(ledgerLines({ ...L, ferry: null, nights: 0, secrets: { found: ['wreck_cache'], total: 1 } }).map(([k]) => k), ['Lamps', 'Bells', 'Relics', 'Secret']);
  assert.deepEqual(ledgerLines(null), []);
  assert.equal(ledgerText(ledgerLines(L)), 'Lamps 4 of 5 lit, Bells 2 of 3 rung, Ferryman trades 3, Relics 4 of 5 found, Secret: not found, Lantern Nights 1', 'the pause menu\'s line');
  const w = createWorld({ seed: 1, character: 'lamplighter' }, DATA);
  const b = pauseBuild(w);
  assert.ok(Array.isArray(b.ledger) && b.ledger.some(([k]) => k === 'Lamps'), JSON.stringify(b.ledger));
  const sum = runSummary({ timeSurvived: 60, level: 2, totalKills: 3, bossesKilled: [], overtimeMinutes: 0, evolutions: [], materials: {}, end: 'left', ledger: L }, DATA);
  assert.ok(sum.lines.some(([k, v]) => k === 'Lamps' && v === '4 of 5 lit'));
  // The gate: what each map holds, the Ferryman once the Docks bring him, a found secret by name.
  const doc = defaultProfile();
  const docks = DATA.maps[0];
  // (0.9.0, W4: the lamps and bells each act, the map's own task, and its secrets counted.)
  const lamps = docks.acts[0].lamps, bells = docks.acts[0].bells, cranes = docks.cranes.length, n = docks.secrets.length;
  assert.equal(mapHoldsText(doc, DATA, docks), `On this map: ${lamps} Wayside Lamps each act, ${bells} Fog Bells each act, ${cranes} cranes, and ${n} secrets`);
  doc.profile.buildings.docks = 1;
  doc.profile.codex.push(`secret:${docks.secrets[0].id}`);
  assert.equal(mapHoldsText(doc, DATA, docks), `On this map: ${lamps} Wayside Lamps each act, ${bells} Fog Bells each act, ${cranes} cranes, the Ferryman, the ${docks.secrets[0].name}, and ${n - 1} more secrets`);
  assert.equal(mapCard(doc, DATA, docks.id).lines.at(-1), mapHoldsText(doc, DATA, docks));
});

test('How to play is Move and Dash only (0.9.0, V4: nine lines in a lump); the rest come as tips over each thing', () => {
  const document = installFakeDocument();
  const root = document.createElement('div');
  const el = runTips((a) => { const g = document.createElement('span'); g.textContent = a; return g; }, root);
  const t = textsOf(el).join(' | ');
  assert.match(t, /move \| Move/);
  assert.match(t, /dash \| Dash/);
  for (const re of [/Arrows/, /lamp/, /bell/, /Reliquary/, /Ferryman/, /20:00/]) assert.doesNotMatch(t, re, 'the map\'s things are tips over them now');
});

test('a ward\'s burn shows no damage number (HIT_QUIET), and a weapon\'s hit still does', async () => {
  const { HIT_QUIET } = await import('../src/sim/events.js');
  assert.equal(HIT_QUIET, 8);
  const src = (await import('node:fs')).readFileSync(new URL('../src/sim/tasks.js', import.meta.url), 'utf8');
  assert.equal((src.match(/world\.hitQuiet = HIT_QUIET;/g) || []).length, 2, 'both burns are marked');
  assert.equal((src.match(/world\.hitQuiet = 0;/g) || []).length, 2, 'and cleared after');
  const view = (await import('node:fs')).readFileSync(new URL('../src/render/viewstate.js', import.meta.url), 'utf8');
  assert.ok(/\(bits & HIT_QUIET\) !== 0\) break;/.test(view), 'the view skips the number');
});
