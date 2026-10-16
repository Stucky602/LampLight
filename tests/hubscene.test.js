// The harbor scene and its screens, driven the way a player drives them (src/app/scenes/hub.js,
// ui/hubscreens.js, ui/hubhud.js; ARCHITECTURE §10.4): the real input module fed a stand-in
// DualSense, the real menu layer over a stand-in DOM, and a stand-in view. Confirm at a person
// or a door uses it without dashing you; things you can't buy say why when pressed; a purchase
// keeps your place in the list; the harbor's menu closes on the button that opened it; skipping a
// ceremony still shows its banner; the results, the gate, and when the harbor is idle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDocument, textsOf } from './helpers/fakedom.js';
import { DATA } from '../src/data/index.js';
import { defaultProfile } from '../src/save/schema.js';
import { createInput } from '../src/input/input.js';
import { B } from '../src/input/gamepad.js';
import { createUi } from '../src/ui/screens.js';
import { createHubScene } from '../src/app/scenes/hub.js';
import { applyRunResult, startResearch, runConfigFor } from '../src/meta/index.js';
import { gateScreen, resultsScreen, hubMenuScreen } from '../src/ui/hubscreens.js';
import { openSettings } from '../src/app/settings-flow.js';
import { createSceneManager } from '../src/app/scenes.js';
import { defaultSettings } from '../src/save/schema.js';
import { createHubTuning } from '../src/hub/tuning.js';
import { HUB_TUNING } from '../src/data/tuning.js';
import { createProgressKeeper } from '../src/app/keeper.js';
import { createGameFlow } from '../src/app/flow.js';
import { createRunScene } from '../src/app/scenes/run.js';
import { stepFor } from '../src/ui/tuningmodel.js';
import { errorScreen, titleScreen, confirmScreen } from '../src/ui/menus.js';
import { readFileSync } from 'node:fs';
import { routeTo } from '../src/hub/map.js';
import { routeExit } from '../src/ui/hubhud.js';

const HUB = DATA.hub;
const px = (t) => t * 16 + 8;
const RICH = Object.fromEntries(DATA.materials.map((m) => [m.id, 9999]));
const FRAME_MS = 1000 / 60;

function profile(levels = {}, mats = {}) {
  const d = defaultProfile();
  Object.assign(d.profile.buildings, levels);
  Object.assign(d.profile.materials, mats);
  return d;
}

/** A DualSense as the browser reports it, with these buttons held. */
function dualSense(pressed = []) {
  const buttons = Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 }));
  return { id: 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)', index: 0, mapping: 'standard', connected: true, buttons, axes: [0, 0, 0, 0] };
}

/** The harbor scene with everything it talks to, and a frame() that runs one frame as main.js does. */
function harbor(doc0, { results = null, view: viewIn = null } = {}) {
  const document = installFakeDocument();
  const root = document.createElement('div');
  document.body.appendChild(root);
  const box = { pads: [dualSense()], t: 1000 };
  const input = createInput({ getGamepads: () => box.pads, target: new EventTarget(), now: () => box.t });
  const sounds = [];
  const ui = createUi({ root, input, doc: document, sound: (s) => sounds.push(s) });
  ui.layout({ x: 0, y: 0, scale: 1 }, 640, 360);
  const view = {
    now: 0,
    attach(w, lv) { this.world = w; this.levels = lv; }, detach() { this.world = null; }, setLevels(lv) { this.levels = lv; },
    draw(alpha, ms) { this.now += ms; },
    toView: (x, y) => ({ x, y }), anchorOf: (near) => (near ? { x: 0, y: 0 } : null),
    ...viewIn,
  };
  const state = { doc: doc0, saves: 0, runs: [], idle: 0, title: 0, copied: null };
  const menuCtx = { ui, icon: () => document.createElement('span'), sound: (s) => sounds.push(s) };
  const scene = createHubScene({
    view, input, ui, menuCtx, data: DATA, audio: { ok: true, play: (s) => sounds.push(s) },
    profile: { get: () => state.doc, save: (d) => { state.doc = d; state.saves++; } },
    startRun: (cfg) => state.runs.push(cfg), onTitle: () => state.title++, onSettings: () => {}, onIdle: () => state.idle++,
    hubTuning: createHubTuning(), buildId: 'test-build', copyText: (text) => { state.copied = text; return 'Copied.'; },
  });
  scene.enter(results ? { results } : {});
  const t = {
    scene, ui, input, box, sounds, state, view, root,
    get world() { return scene.world; },
    /** One frame: input, a sim tick, the scene's frame, the menus (main.js's order). */
    frame(n = 1) { for (let i = 0; i < n; i++) { box.t += FRAME_MS; input.update(FRAME_MS); scene.step(1 / 60); scene.frame(1, FRAME_MS); ui.update(FRAME_MS); } },
    /** Open a building's panel (as its door does), and let a frame pass (a new screen ignores buttons already held). */
    open(building) { scene.openBuildingForTools(building); t.frame(); return ui.top; },
    /** Press pad buttons for one frame, then let go for one. */
    press(...buttons) { box.pads = [dualSense(buttons)]; t.frame(); box.pads = [dualSense()]; t.frame(); },
    place([tx, ty], dx = 0, dy = 0) { const p = scene.world.player; p.x = p.px = px(tx) + dx; p.y = p.py = px(ty) + dy; },
    top: () => ui.top,
    hud: (cls) => root.querySelector(`.${cls}`),
  };
  t.frame();
  return t;
}

test('hub scene: ✕ next to someone says their line and doesn\'t move you; R1 still dashes', () => {
  const t = harbor(profile({ tavern: 1 }));
  const her = t.world.people.find((p) => p.id === 'harpooner');
  assert.ok(her, 'the Harpooner waits on the square');
  t.place(her.post, 10);
  t.frame();
  assert.equal(t.world.near?.id, 'harpooner');
  const at = [t.world.player.x, t.world.player.y];
  t.press(B.SOUTH);
  assert.deepEqual([t.world.player.x, t.world.player.y], at, '✕ confirms in the harbor; it doesn\'t dash');
  const bubble = t.hud('hud-bubble');
  assert.equal(bubble.hidden, false, 'her line shows');
  assert.deepEqual(textsOf(bubble), ['Harpooner', DATA.characters.find((c) => c.id === 'harpooner').hubLine]);
  // The dash's own button still dashes (the run's distance).
  t.place([30, 18]);
  t.world.player.fx = 1; t.world.player.fy = 0;
  const x0 = t.world.player.x;
  t.press(B.R1);
  t.frame(20);
  assert.ok(Math.abs(t.world.player.x - x0 - DATA.tuning.player.dash.distance) < 1, `R1 dashed ${t.world.player.x - x0} px`);
});

test('hub scene: ✕ at a door opens its panel without moving you; the panel says why for what you can\'t do yet', () => {
  const going = startResearch(profile({ library: 1 }, { drowned_pages: 99, coin: 99 }), DATA, 'orbwright').doc;
  const t = harbor(going);
  const lib = HUB.plots.find((p) => p.building === 'library');
  t.place(lib.door);
  t.frame();
  const at = [t.world.player.x, t.world.player.y];
  t.press(B.SOUTH);
  assert.deepEqual([t.world.player.x, t.world.player.y], at);
  assert.match(t.top().el.className, /building-screen bld-library/);
  // Tide Charts can't start while the Orbwright's Notes runs (one project at a time): the row says
  // so, and pressing it says so again (with the menu's "no"), buying nothing.
  const row = t.top().el.querySelector('[data-focus="r:tide_charts"]');
  assert.ok(textsOf(row).includes('Research slots full (1/1)'));
  assert.equal(row.getAttribute('aria-disabled'), null, 'it still takes a press');
  assert.ok(t.top().scope.focusKey('r:tide_charts'));
  t.sounds.length = 0;
  t.press(B.SOUTH);
  assert.equal(t.top().el.querySelector('.bld-note').textContent, 'Research slots full (1/1)');
  assert.deepEqual(t.sounds, ['ui_back']);
  assert.equal(t.state.saves, 0, 'nothing bought');
  // The one under way says so when pressed; a click does what a press does.
  t.top().el.querySelector('[data-focus="r:orbwright"]').click();
  assert.equal(t.top().el.querySelector('.bld-note').textContent, 'Already in progress');
  // The restore button, too, when you're short.
  const restore = t.top().el.querySelector('[data-focus="restore"]');
  assert.ok(restore.classList.contains('off'));
  restore.click();
  assert.match(t.top().el.querySelector('.bld-note').textContent, /^Need \d+ /);
  // Circle leaves.
  t.press(B.EAST);
  assert.equal(t.top(), null);
});

test('hub scene: after a purchase the focus stays on the row and the list keeps its scroll', () => {
  const t = harbor(profile({ lamp_post: 3 }, RICH));
  const panel = t.open('lamp_post');
  assert.ok(panel.scope.focusKey('u:tide_luck'));
  panel.el.querySelector('.list').scrollTop = 42;
  t.press(B.SOUTH);
  assert.equal(t.state.doc.profile.upgrades.tide_luck, 1, 'bought rank 1');
  assert.equal(panel.scope.current.dataset.focus, 'u:tide_luck', 'still on the row just bought');
  assert.equal(panel.el.querySelector('.list').scrollTop, 42, 'and the list didn\'t jump to the top');
  assert.equal(panel.el.querySelector('.bld-note').textContent, `Scavenger 1/${DATA.upgrades.find((u) => u.id === 'tide_luck').ranks}`);
  t.press(B.SOUTH);
  assert.equal(t.state.doc.profile.upgrades.tide_luck, 2, 'so the next press buys the next rank');
});

test('hub scene: the harbor\'s menu opens and closes on Options; its Set out goes to the gate', () => {
  const t = harbor(profile({ tavern: 1 }));
  t.press(B.START);
  assert.match(t.top().el.className, /hub-menu/);
  assert.equal(t.scene.idle, false, 'not a safe point with the menu open');
  t.press(B.START);
  assert.equal(t.top(), null, 'the button that opened it closes it');
  assert.equal(t.scene.idle, true);
  // Set out: the gate, with the characters you have; confirm sets out with the focused one.
  t.press(B.START);
  t.top().scope.focusKey('setout');
  t.press(B.SOUTH);
  const gate = t.top();
  assert.match(gate.el.className, /gate-screen/);
  assert.equal(gate.el.querySelectorAll('.char-card').length, 2, 'the Lamplighter and the Harpooner');
  gate.scope.focusKey('c1');
  t.press(B.SOUTH);
  assert.deepEqual(t.state.runs, [{ character: 'harpooner' }]);
  assert.equal(t.top(), null);
});

test('hub scene: a restore plays its ceremony; skipping it still shows the banner and lands everything', () => {
  const t = harbor(profile({}, RICH));
  t.open('library').scope.focusKey('restore');
  t.press(B.SOUTH);
  assert.equal(t.state.doc.profile.buildings.library, 1);
  assert.equal(t.world.timeline?.kind, 'ceremony');
  assert.equal(t.scene.idle, false, 'not a safe point during a set piece');
  const idleBefore = t.state.idle;
  t.press(B.SOUTH);   // skip
  assert.equal(t.world.timeline, null);
  const banner = t.hud('hud-banner');
  assert.equal(banner.hidden, false);
  assert.deepEqual(textsOf(banner), ['Library Lv 1', 'Unlocks research', 'Clears the fog nearby']);
  assert.ok(t.world.revealed.has('library_1'));
  assert.equal(t.state.idle, idleBefore + 1, 'the harbor says it is idle again (a waiting update may load)');
});

test('hub scene: the results come up over the harbor; closing them makes the harbor idle', () => {
  const result = {
    end: 'died', timeSurvived: 431, totalKills: 210, kills: { fog_wisp: 210 }, bossesKilled: [],
    materials: { coin: 12, oil: 3 }, weapons: [{ id: 'flare_gun' }], passives: [], relics: [], runes: [], evolutions: [],
  };
  const out = applyRunResult(profile(), result, DATA);
  const t = harbor(out.doc, { results: { changes: out.changes, result } });
  const s = t.top();
  assert.match(s.el.className, /results-screen/);
  const texts = textsOf(s.el);
  for (const line of ['Results', 'Survived 7:11', '12 Coin', '3 Oil', 'Fog Wisp: 100 kills total', 'Next up']) assert.ok(texts.includes(line), `says "${line}" (${texts.join(' | ')})`);
  assert.equal(s.scope.current.dataset.focus, 'continue');
  assert.equal(t.scene.idle, false, 'never a safe point with the results up');
  t.frame(30);   // past the screen's input delay
  assert.equal(t.state.idle, 0);
  t.press(B.SOUTH);
  assert.equal(t.top(), null);
  assert.equal(t.scene.idle, true);
  assert.equal(t.state.idle, 1, 'said once, when they closed');
});

test('harbor screens: the gate, the results, and the menu, on their own', () => {
  const document = installFakeDocument();
  const ctx = { ui: { glyph: (a) => { const e = document.createElement('span'); e.textContent = a; return e; } }, icon: () => document.createElement('span'), sound: () => {} };
  const picked = [];
  const gate = gateScreen(ctx, { characters: [{ id: 'lamplighter', name: 'Lamplighter', desc: 'd', sprite: 'pc_lamplighter', startName: 'Flare Gun' }], map: { name: 'Drowned Docks', desc: '' }, onSetOut: (id) => picked.push(id), onBack: () => {} });
  assert.ok(textsOf(gate.el).includes('Starting weapon: Flare Gun'));
  gate.el.querySelector('[data-focus="c0"]').click();
  assert.deepEqual(picked, ['lamplighter']);
  // Nothing brought home, nothing new, nothing next: it says so rather than showing empty boxes.
  const empty = resultsScreen(ctx, { data: DATA, changes: [], next: [], summary: { title: 'Results', line: 'Left at 0:10' }, onContinue: () => {}, onSetOut: () => {} });
  const words = textsOf(empty.el);
  assert.equal(words.filter((w) => w === 'None').length, 2);
  assert.equal(empty.el.querySelector('.next-block'), null);
  // The menu: Options (pause) closes it; everything else is left to the buttons.
  let resumed = 0;
  const menu = hubMenuScreen(ctx, { onResume: () => resumed++, onSetOut: () => {}, onSettings: () => {}, onTitle: () => {} });
  assert.equal(menu.onAction('confirm'), false);
  assert.equal(menu.onAction('pause'), true);
  assert.equal(resumed, 1);
  assert.equal(menu.el.querySelector('[data-focus="quit"]'), null, 'no Quit on the web');
});

test('hub scene: the prompt, the corner panels, the skip hint, a keeper\'s line, and the banner come and go', () => {
  const t = harbor(profile({ library: 4 }, RICH));
  const lib = HUB.plots.find((p) => p.building === 'library');
  const prompt = t.hud('hud-prompt');
  t.place([30, 18]);
  t.frame();
  assert.equal(prompt.hidden, true, 'nothing in reach, no prompt');
  t.place(lib.door);
  t.frame();
  assert.equal(prompt.hidden, false);
  assert.deepEqual(textsOf(prompt).slice(-1), ['Enter Library']);
  // Silas at his door: his line in a bubble, gone once you step away.
  const silas = t.world.people.find((p) => p.id === 'librarian');
  t.place(silas.post, 6);
  t.frame();
  assert.equal(t.world.near?.id, 'librarian');
  t.press(B.SOUTH);
  const bubble = t.hud('hud-bubble');
  assert.equal(bubble.hidden, false);
  assert.equal(prompt.hidden, true, 'the prompt makes way for the line');
  t.place([30, 18]);
  t.frame();
  assert.equal(bubble.hidden, true, 'walk away and it goes');
  // ...and on its own after a while, even standing there.
  t.place(silas.post, 6);
  t.frame();
  t.press(B.SOUTH);
  assert.equal(bubble.hidden, false);
  t.frame(Math.ceil(4300 / FRAME_MS));
  assert.equal(bubble.hidden, true, 'it times out');
  // A screen up: the corner panels hide; the menu closed, they're back.
  const hudEl = t.hud('hub-hud');
  t.press(B.START);
  assert.ok(hudEl.classList.contains('quiet'));
  t.press(B.START);
  assert.ok(!hudEl.classList.contains('quiet'));
  // A set piece: the skip hint shows and the panels hide; the banner stays a while after, then goes.
  t.open('tavern').scope.focusKey('restore');
  t.press(B.SOUTH);
  const skip = t.hud('hud-skip');
  assert.equal(skip.hidden, false);
  assert.ok(hudEl.classList.contains('quiet'));
  t.press(B.SOUTH);   // skip the ceremony (the boat comes next)
  t.press(B.SOUTH);   // and the boat
  assert.equal(t.world.timeline, null);
  assert.equal(skip.hidden, true);
  const banner = t.hud('hud-banner');
  assert.equal(banner.hidden, false);
  t.frame(Math.ceil(4300 / FRAME_MS));
  assert.equal(banner.hidden, true, 'the banner goes after its time');
});

test('hub scene: a purchase updates the materials and the next three at once', () => {
  const t = harbor(profile({ lamp_post: 3 }, { oil: 20, coin: 20 }));
  const mats = t.hud('hud-mats'), next = t.hud('hud-next');
  const oilBefore = textsOf(mats);
  const nextBefore = textsOf(next).join(' | ');
  const panel = t.open('lamp_post');
  panel.scope.focusKey('u:bright_flame');
  t.press(B.SOUTH);
  assert.equal(t.state.doc.profile.upgrades.bright_flame, 1);
  assert.notDeepEqual(textsOf(mats), oilBefore, 'the materials bar shows what\'s left');
  assert.ok(textsOf(mats).includes(String(20 - DATA.upgrades.find((u) => u.id === 'bright_flame').cost.oil)), textsOf(mats).join(' '));
  assert.notEqual(textsOf(next).join(' | '), nextBefore, 'the next three moved on');
  assert.ok(textsOf(next).includes('Brighter Flame 2/5') || !textsOf(next).includes('Brighter Flame 1/5'), textsOf(next).join(' | '));
});

test('hub scene: the d-pad moves through a panel by where things are, and presses what it lands on', () => {
  const t = harbor(profile({ lamp_post: 3 }, RICH));
  const panel = t.open('lamp_post');
  // Lay the panel out (again after each redraw): the restore button on the left, the upgrades in a
  // column on the right.
  const layout = () => {
    panel.el.querySelector('[data-focus="restore"]').rect = { left: 10, top: 200, width: 150, height: 20 };
    DATA.upgrades.forEach((u, i) => { panel.el.querySelector(`[data-focus="u:${u.id}"]`).rect = { left: 200, top: 40 + i * 30, width: 200, height: 26 }; });
  };
  layout();
  assert.equal(panel.scope.current.dataset.focus, 'restore');
  t.press(B.RIGHT);
  assert.equal(panel.scope.current.dataset.focus, `u:${DATA.upgrades[5].id}`, 'right: the row beside it');
  t.press(B.DOWN);
  assert.equal(panel.scope.current.dataset.focus, `u:${DATA.upgrades[6].id}`);
  t.press(B.UP); t.press(B.UP);
  assert.equal(panel.scope.current.dataset.focus, `u:${DATA.upgrades[4].id}`);
  t.press(B.SOUTH);
  assert.equal(t.state.doc.profile.upgrades[DATA.upgrades[4].id], 1, 'pressed what it landed on');
  layout();
  t.press(B.LEFT);
  assert.equal(panel.scope.current.dataset.focus, 'restore');
});

test('hub scene: the Tavern lists who comes back; the results\' next three and Set out again', () => {
  const t = harbor(profile({ tavern: 2 }));
  const panel = t.open('tavern');
  const words = textsOf(panel.el.querySelector('.bld-list'));
  for (const line of ['Unlocks', 'New character: Harpooner', 'New relic: Tide Clock', 'Bram returns', 'Bram walks the harbor']) assert.ok(words.includes(line), `says "${line}"`);
  assert.equal(words.filter((w) => w === 'Unlocked').length, 2, 'levels 1 and 2 are here');
  assert.ok(!words.includes('Clears the fog nearby'), 'the fog isn\'t someone coming back');
  t.press(B.EAST);
  // The results, with the next three, and Set out again straight to the gate.
  const result = { end: 'left', timeSurvived: 70, totalKills: 3, kills: {}, bossesKilled: [], materials: { coin: 4 }, weapons: [], passives: [], relics: [], runes: [], evolutions: [] };
  const out = applyRunResult(profile({}, { oil: 10, coin: 10 }), result, DATA);
  const r = harbor(out.doc, { results: { changes: out.changes, result } });
  const s = r.top();
  const texts = textsOf(s.el);
  assert.ok(texts.includes('Lamp Post Lv 1'), texts.join(' | '));
  assert.ok(texts.includes('Returned at 1:10'));
  r.frame(30);
  s.scope.focusKey('again');
  r.press(B.SOUTH);
  assert.match(r.top().el.className, /gate-screen/, 'Set out again opens the gate');
});

test('settings in the harbor: a borderless switch is allowed there, and waits for progress to be saved', async () => {
  const document = installFakeDocument();
  const root = document.createElement('div');
  document.body.appendChild(root);
  const box = { pads: [dualSense()], t: 1000 };
  const input = createInput({ getGamepads: () => box.pads, target: new EventTarget(), now: () => box.t });
  const ui = createUi({ root, input, doc: document, sound: () => {} });
  const menuCtx = { ui, icon: () => document.createElement('span'), sound: () => {} };
  // In the harbor with a screen open (the settings themselves): not a reload point for an update,
  // but the harbor all the same, where the window may be reopened.
  const scenes = createSceneManager();
  scenes.register('hub', { get safePoint() { return !ui.open; } });
  await scenes.go('hub');
  const settings = defaultSettings();
  // The game's own flow and keeper (app/flow.js, app/keeper.js), over a store whose profile save
  // fails for now, and a settings file on "disk".
  const disk = { settings: null, broken: true };
  const saveSettings = async () => { disk.settings = structuredClone(settings); };
  const store = { saveProfile: async () => { if (disk.broken) throw new Error('disk full'); }, flush: async () => {} };
  const keeper = createProgressKeeper({ store, notice: { show() {}, clear() {} }, log() {}, profile: defaultProfile() });
  await keeper.keep(profile({ lamp_post: 1 }));
  assert.equal(keeper.failing, true);
  const flow = createGameFlow({
    keeper, scenes, data: DATA, saveReplay: async () => {}, flushSettings: saveSettings, saveSettingsNow: saveSettings,
    askToLeave: async () => false, native: null, reload: () => {},
  });
  const switched = [];
  const s = openSettings({
    ui, menuCtx, settings, desktop: true, native: { setDisplayMode: (m) => switched.push(m) },
    atTitleOrHarbor: () => flow.atTitleOrHarbor(), reopen: (go) => flow.reopenWindow(go),
    input, audio: { setVolumes() {} }, renderer: { setFillScreen() {} }, save: saveSettings,
  });
  const frame = () => { box.t += FRAME_MS; input.update(FRAME_MS); ui.update(FRAME_MS); };
  const press = (b) => { box.pads = [dualSense([b])]; frame(); box.pads = [dualSense()]; frame(); };
  const settle = () => new Promise((r) => setImmediate(r));
  frame();
  assert.equal(scenes.isSafePoint(), false);
  assert.ok(s.scope.focusKey('display.mode'));
  // Progress not saved yet (the keeper couldn't save it): the window stays, the row says why, and
  // the settings file keeps the mode the window still has (the next launch opens it that way).
  press(B.RIGHT);
  await settle();
  assert.equal(settings.display.mode, 'fullscreen');
  assert.deepEqual(switched, []);
  assert.ok(textsOf(s.el).some((x) => /Progress isn't saved yet/.test(x)), textsOf(s.el).join(' | '));
  assert.equal(disk.settings.display.mode, 'fullscreen', 'the refused mode isn\'t left on disk');
  // Saved: it switches (the progress kept in memory is saved first).
  disk.broken = false;
  press(B.RIGHT);
  await settle();
  assert.equal(settings.display.mode, 'borderless');
  assert.deepEqual(switched, ['borderless']);
  assert.equal(disk.settings.display.mode, 'borderless');
  assert.equal(keeper.failing, false);
  // In a run it's refused.
  scenes.register('run', {});
  await scenes.go('run');
  press(B.LEFT);
  await settle();
  assert.equal(settings.display.mode, 'borderless');
  assert.ok(textsOf(s.el).some((x) => /Borderless can only be changed in the harbor or on the main menu/.test(x)));
});

test('hub scene: the tuning panel (hold Create): the harbor\'s numbers live, Copy tuning, and the dev commands saved to the profile', () => {
  const t = harbor(profile());
  // Hold Create for a second: the panel opens beside the harbor, which goes on drawing behind it.
  t.box.pads = [dualSense([B.SELECT])];
  t.frame(62);
  t.box.pads = [dualSense()];
  t.frame();
  const panel = t.top();
  assert.match(panel.el.className, /tuning-screen/);
  const note = () => panel.el.querySelector('.tuning-note').textContent;
  assert.match(note(), /the harbor shows it at once/);
  const groups = [...panel.el.querySelectorAll('.tuning-group')].map((g) => g.textContent);
  assert.deepEqual(groups, ['Dev commands', 'hub.timing', 'hub.look', 'hub.look.dust', 'hub.look.smoke', 'hub.look.puffs']);
  assert.equal(panel.el.querySelector('[data-focus="t:hub.look.fogColor"]'), null, 'colors are changed in the data, not stepped');
  assert.equal(panel.el.querySelector('[data-focus="t:hub.look.dust.color"]'), null, 'in a group of their own too');
  assert.ok(panel.el.querySelector('[data-focus="t:hub.look.smoke.every"]'), 'the numbers in a group of their own are on it');
  assert.equal(t.hud('hub-hud').classList.contains('quiet'), false, 'the materials and Next up stay in view beside it');
  // Add materials: saved like a purchase, and the materials bar shows it.
  assert.ok(panel.scope.focusKey('mats100'));
  t.press(B.SOUTH);
  assert.equal(t.state.saves, 1);
  assert.equal(t.state.doc.profile.materials.coin, 100);
  assert.equal(t.state.doc.profile.flags.devTools, true);
  assert.match(note(), /^Added 100 of each material the maps drop \(8 kinds\)\. Saved to your profile\.$/);
  assert.ok(textsOf(t.hud('hud-mats')).some((x) => x.trim() === '100'));
  // A value: right steps it, and the world reads it on its next tick.
  const reach = DATA.hubTuning.timing.reach;
  assert.ok(panel.scope.focusKey('t:hub.timing.reach'));
  t.press(B.RIGHT);
  assert.equal(t.scene.tuning.timing.reach, reach + stepFor(reach));
  assert.equal(t.world.T.reach, reach + stepFor(reach), 'the world has the same live timing');
  assert.equal(DATA.hubTuning.timing.reach, reach, 'the data is untouched');
  // A number the harbor divides by can't reach 0: the panel says why and keeps the last good value.
  assert.ok(panel.scope.focusKey('t:hub.timing.panIn'));
  for (let i = 0; i < 20; i++) t.press(B.LEFT);
  assert.equal(note(), 'timing.panIn must stay above 0');
  assert.ok(t.scene.tuning.timing.panIn > 0);
  // Copy tuning: the harbor's changes, under "hub.".
  assert.ok(panel.scope.focusKey('copy'));
  t.press(B.SOUTH);
  assert.match(t.state.copied, /^Lamplight tuning changes \(build test-build, the harbor\):/);
  assert.match(t.state.copied, new RegExp(`hub\\.timing\\.reach: ${reach + stepFor(reach)} +\\(was ${reach}\\)`));
  assert.match(t.state.copied, /hub\.timing\.panIn: /);
  // Unlock everything: the harbor as it is now, at once, and you where you stood.
  t.place([30, 18], 3);
  const at = [t.world.player.x, t.world.player.y];
  assert.ok(panel.scope.focusKey('unlockAll'));
  t.press(B.SOUTH);
  assert.deepEqual(DATA.buildings.map((b) => t.state.doc.profile.buildings[b.id]), DATA.buildings.map((b) => b.levels.length));
  assert.match(note(), /^Every building restored and all research complete \(\d+ unlocked\)\. Saved to your profile\.$/);
  assert.deepEqual(t.world.people.filter((p) => p.kind === 'keeper').map((p) => p.id), ['lamp_keeper', 'librarian', 'innkeeper']);
  assert.deepEqual([...t.world.revealed].sort(), DATA.hub.fog.map((f) => f.id).sort(), 'the fog is gone from every region');
  assert.equal(t.world.timeline, null, 'no ceremonies');
  assert.deepEqual([t.world.player.x, t.world.player.y], at, 'you stay where you stood');
  assert.equal(t.world.T, t.scene.tuning.timing, 'the new world reads the same live timing');
  t.press(B.SOUTH);
  assert.equal(note(), 'Everything is already unlocked.');
  // Reset: every value back to the data's.
  assert.ok(panel.scope.focusKey('reset'));
  t.press(B.SOUTH);
  assert.deepEqual(t.scene.tuning, JSON.parse(JSON.stringify(DATA.hubTuning)));
  // Hold Create again: it closes, and the harbor is yours again.
  t.box.pads = [dualSense([B.SELECT])];
  t.frame(62);
  t.box.pads = [dualSense()];
  t.frame();
  assert.equal(t.top(), null);
});

test('run scene: a run\'s end is saved the moment it ends, and the end screen\'s buttons go where they say', () => {
  const document = installFakeDocument();
  const root = document.createElement('div');
  document.body.appendChild(root);
  const box = { pads: [dualSense()], t: 1000 };
  const input = createInput({ getGamepads: () => box.pads, target: new EventTarget(), now: () => box.t });
  const ui = createUi({ root, input, doc: document, sound: () => {} });
  ui.layout({ x: 0, y: 0, scale: 1 }, 640, 360);
  const menuCtx = { ui, icon: () => document.createElement('span'), sound: () => {} };
  const view = { now: 0, attach() {}, detach() {}, markTick() {}, consume() {}, draw(a, ms) { this.now += ms; }, screenFlash: () => 0 };
  const saved = [], runs = [], harbor = [];
  const scene = createRunScene({
    view, hud: { attach() {}, detach() {}, draw() {}, notice() {} }, input, ui, menuCtx, audio: { ok: false }, data: DATA, buildId: 'test',
    loop: { pause() {}, resume() {}, reset() {}, hitStop() {} }, renderer: { camera: { x: 0 } },
    onRunSaved: (replay, result) => saved.push({ replay, result }), onHarbor: () => harbor.push(true), startRun: (cfg) => runs.push(cfg),
    onSettings() {}, saveReport() {}, copyText: () => 'ok', onTitle() {},
  });
  scene.enter({ character: 'harpooner', seed: 'end-test', all: true });
  const frame = (n = 1) => { for (let i = 0; i < n; i++) { box.t += FRAME_MS; input.update(FRAME_MS); scene.step(1 / 60); scene.frame(1, FRAME_MS); ui.update(FRAME_MS); } };
  frame(10);
  scene.recorded.decide({ kind: 'leave' });
  frame();
  assert.equal(saved.length, 1, 'folded in and saved on the tick the run ends, before any screen');
  assert.equal(saved[0].result.end, 'left');
  assert.equal(saved[0].result.character, 'harpooner');
  assert.ok(saved[0].replay && saved[0].replay.decisions.some((d) => d.kind === 'leave'), 'with its replay');
  assert.equal(ui.top, null, 'the moment lands first');
  frame(Math.ceil(1400 / FRAME_MS) + 2);
  assert.match(ui.top.el.className, /end-screen/);
  assert.equal(saved.length, 1, 'saved once');
  frame(40);   // the end screen ignores presses for its first moments
  // Run again: the same character, a new seed.
  ui.top.scope.focusKey('again');
  box.pads = [dualSense([B.SOUTH])]; frame(); box.pads = [dualSense()]; frame();
  assert.deepEqual(runs.map((c) => [c.character, c.seed]), [['harpooner', undefined]]);
  assert.deepEqual(harbor, []);
  // Back to the harbor, from another run's end.
  scene.enter({ character: 'lamplighter', seed: 'end-test-2', all: true });
  frame(5);
  scene.recorded.decide({ kind: 'leave' });
  frame(Math.ceil(1400 / FRAME_MS) + 45);
  ui.top.scope.focusKey('harbor');
  box.pads = [dualSense([B.SOUTH])]; frame(); box.pads = [dualSense()]; frame();
  assert.deepEqual(harbor, [true]);
  assert.equal(saved.length, 2);
});

test('run scene: a run is the app\'s config for it (the profile\'s pools), and Run again asks for the same character\'s again', () => {
  const document = installFakeDocument();
  const root = document.createElement('div');
  document.body.appendChild(root);
  const box = { pads: [dualSense()], t: 1000 };
  const input = createInput({ getGamepads: () => box.pads, target: new EventTarget(), now: () => box.t });
  const ui = createUi({ root, input, doc: document, sound: () => {} });
  ui.layout({ x: 0, y: 0, scale: 1 }, 640, 360);
  const menuCtx = { ui, icon: () => document.createElement('span'), sound: () => {} };
  const view = { now: 0, attach() {}, detach() {}, markTick() {}, consume() {}, draw(a, ms) { this.now += ms; }, screenFlash: () => 0 };
  const doc = profile();   // a fresh profile: its pools hold less than all the content
  const asked = [], runs = [];
  const scene = createRunScene({
    view, hud: { attach() {}, detach() {}, draw() {}, notice() {} }, input, ui, menuCtx, audio: { ok: false }, data: DATA, buildId: 'test',
    loop: { pause() {}, resume() {}, reset() {}, hitStop() {} }, renderer: { camera: { x: 0 } },
    configFor: (choice) => { asked.push(choice); return runConfigFor(doc, DATA, choice); },
    onRunSaved() {}, onHarbor() {}, startRun: (cfg) => runs.push(cfg), onSettings() {}, saveReport() {}, copyText: () => 'ok', onTitle() {},
  });
  scene.enter({ character: 'lamplighter', seed: 'cfg-test' });
  assert.deepEqual(asked, [{ character: 'lamplighter', seed: 'cfg-test', all: false }], 'the app is asked for the run\'s config');
  const want = runConfigFor(doc, DATA, { character: 'lamplighter', seed: 'cfg-test' });
  const ids = (list) => list.map((x) => x.id);
  for (const kind of ['weapons', 'passives', 'relics', 'runes']) assert.deepEqual(ids(scene.world.pools[kind]), want.pools[kind], `the run draws from the profile's ${kind}`);
  assert.ok(want.pools.weapons.length < DATA.weapons.length, 'which is less than everything');
  const frame = (n = 1) => { for (let i = 0; i < n; i++) { box.t += FRAME_MS; input.update(FRAME_MS); scene.step(1 / 60); scene.frame(1, FRAME_MS); ui.update(FRAME_MS); } };
  frame(5);
  scene.recorded.decide({ kind: 'leave' });
  frame(Math.ceil(1400 / FRAME_MS) + 2);
  assert.match(ui.top.el.className, /end-screen/);
  ui.top.scope.focusKey('again');
  box.pads = [dualSense([B.SOUTH])]; frame(); box.pads = [dualSense()]; frame();
  assert.deepEqual(runs, [], 'a press as it comes up is ignored (a button still held from the fight)');
  frame(40);
  box.pads = [dualSense([B.SOUTH])]; frame(); box.pads = [dualSense()]; frame();
  assert.deepEqual(runs, [{ character: 'lamplighter', seed: undefined, all: false }], 'Run again: the same character, a new seed, the profile\'s pools again');
  scene.exit();
});

test('run scene: a run\'s end that can\'t be folded in goes to the error screen (thrown, or failing later)', async () => {
  const document = installFakeDocument();
  const root = document.createElement('div');
  document.body.appendChild(root);
  const box = { pads: [dualSense()], t: 1000 };
  const input = createInput({ getGamepads: () => box.pads, target: new EventTarget(), now: () => box.t });
  const ui = createUi({ root, input, doc: document, sound: () => {} });
  const menuCtx = { ui, icon: () => document.createElement('span'), sound: () => {} };
  const view = { now: 0, attach() {}, detach() {}, markTick() {}, consume() {}, draw(a, ms) { this.now += ms; }, screenFlash: () => 0 };
  for (const fail of [() => { throw new Error('no run result'); }, async () => { throw new Error('disk gone'); }]) {
    const errors = [];
    const scene = createRunScene({
      view, hud: { attach() {}, detach() {}, draw() {}, notice() {} }, input, ui, menuCtx, audio: { ok: false }, data: DATA, buildId: 'test',
      loop: { pause() {}, resume() {}, reset() {}, hitStop() {} }, renderer: { camera: { x: 0 } },
      onRunSaved: fail, onError: (e) => errors.push(e.message), onHarbor() {}, startRun() {}, onSettings() {}, saveReport() {}, copyText: () => 'ok', onTitle() {},
    });
    scene.enter({ character: 'lamplighter', seed: 'fail-test', all: true });
    const frame = () => { box.t += FRAME_MS; input.update(FRAME_MS); scene.step(1 / 60); scene.frame(1, FRAME_MS); ui.update(FRAME_MS); };
    frame();
    scene.recorded.decide({ kind: 'leave' });
    frame();
    await new Promise((r) => setImmediate(r));
    assert.equal(errors.length, 1, 'said once');
    assert.match(errors[0], /no run result|disk gone/);
    // The error screen stays: no end screen over it offering to go on as if the run were saved.
    for (let i = 0; i < Math.ceil(1400 / FRAME_MS) + 30; i++) frame();
    assert.equal(ui.top, null, 'no end screen');
    scene.exit?.();
  }
});

test('screens: the title\'s Continue, the question before leaving, the desktop\'s Quit, the materials bar, Next up\'s ready line, and the notice clear of Next up', () => {
  const t = harbor(profile({}, { oil: 30, coin: 30 }));
  const ctx = { ui: t.ui, icon: () => document.createElement('span'), sound: () => {} };
  // The title's first button says what it's given (Continue once there's progress: hublogic titleStartLabel).
  const title = titleScreen(ctx, { build: 'x', onStart() {}, onSettings() {}, onCredits() {}, startLabel: 'Continue' });
  assert.equal(title.el.querySelector('[data-focus="start"]').textContent, 'Continue');
  // The question before leaving with a failed save (main.js askToLeave): Stay has the focus, and Back means Stay.
  const said = [];
  const q = confirmScreen(ctx, { title: 'Unsaved progress', text: 'Quitting now loses everything since the last successful save.', yes: 'Quit anyway', no: 'Stay', onYes: () => said.push('leave'), onNo: () => { said.push('stay'); t.ui.close(q); } });
  t.ui.push(q);
  t.frame();
  assert.equal(q.scope.current?.dataset.focus, 'no', 'Stay has the focus');
  t.frame(20);   // past the moment it ignores presses
  t.press(B.EAST);
  assert.deepEqual(said, ['stay'], 'Circle is Stay');
  // The harbor's menu on the desktop has a Quit, and it quits.
  const quits = [];
  const menu = hubMenuScreen(ctx, { onResume() {}, onSetOut() {}, onSettings() {}, onTitle() {}, onQuit: () => quits.push('quit') });
  menu.el.querySelector('[data-focus="quit"]').click();
  assert.deepEqual(quits, ['quit']);
  // The materials bar lists what the harbor asks for (something costs it), in the data's order, and nothing else.
  const costs = [...DATA.buildings.flatMap((b) => b.levels.map((l) => l.cost)), ...DATA.research.map((r) => r.cost), ...DATA.upgrades.map((u) => u.cost)];
  const asked = DATA.materials.filter((m) => costs.some((c) => c[m.id] > 0));
  assert.ok(asked.length < DATA.materials.length, 'some materials nothing asks for yet');
  assert.deepEqual([...t.hud('hud-mats').querySelectorAll('.hud-mat')].map((e) => e.getAttribute('title')), asked.map((m) => m.name));
  // Next up: a row you can afford says where to go; one you can't says what's short.
  const rows = [...t.hud('hud-next').querySelectorAll('.hud-next-row')].map((r) => textsOf(r));
  assert.deepEqual(rows.find((r) => r[0] === 'Lamp Post Lv 1'), ['Lamp Post Lv 1', 'Ready']);
  assert.ok(rows.some((r) => /^Need /.test(r.at(-1))), JSON.stringify(rows));
  // The update notice keeps clear of Next up at every window size: it reserves more than Next up reaches.
  const css = readFileSync(new URL('../src/ui/ui.css', import.meta.url), 'utf8');
  const rule = (sel) => css.match(new RegExp(`\\n${sel.replace('.', '\\.')} \\{([^}]*)\\}`))[1];
  const next = rule('.hud-next');
  const units = (prop) => Number(next.match(new RegExp(`${prop}: calc\\(var\\(--u\\) \\* (\\d+)\\)`))[1]);
  assert.match(css, /\.ui-view \* \{ box-sizing: border-box;/, 'Next up\'s width holds its padding and border');
  const reach = units('left') + units('width');
  const reserve = Number(rule('.update-marker').match(/var\(--view-left, 0px\) - var\(--u\) \* (\d+)\)/)[1]);
  assert.ok(reserve >= reach + 6, `the notice keeps ${reserve} game px clear; Next up reaches ${reach}`);
});

test('hub scene: what a purchase and a set piece leave behind, and the smaller rules of the screens', () => {
  // The view gets the new levels the moment a building is restored (its ceremony shows the step).
  const t = harbor(profile({}, RICH));
  assert.deepEqual(t.view.levels, { lamp_post: 0, library: 0, tavern: 0 });
  t.open('tavern').scope.focusKey('restore');
  t.press(B.SOUTH);
  assert.equal(t.view.levels.tavern, 1);
  // The Tavern's first level: its ceremony, then the Harpooner's boat. Circle skips as well as cross.
  assert.equal(t.world.timeline.kind, 'ceremony');
  t.press(B.EAST);
  assert.deepEqual([t.world.timeline?.kind, t.world.timeline?.id], ['arrival', 'harpooner']);
  t.press(B.EAST);
  assert.equal(t.world.timeline, null);
  assert.ok(t.world.people.some((p) => p.id === 'harpooner'));
  // The gate offers only who has arrived.
  const fresh = harbor(profile());
  fresh.scene.openGateForTools();
  fresh.frame();
  assert.equal(fresh.top().el.querySelectorAll('.char-card').length, 1, 'the Lamplighter alone');
  // A panel redraws after a purchase: the rank, the cost, the reason.
  const lp = harbor(profile({ lamp_post: 1 }, { ...DATA.upgrades.find((u) => u.id === 'bright_flame').cost })); // exactly rank 1's price
  const panel = lp.open('lamp_post');
  const rankOf = (id) => panel.el.querySelector(`[data-focus="u:${id}"] .row-rank`).textContent;
  assert.equal(rankOf('bright_flame'), '0/5');
  assert.equal(textsOf(panel.el.querySelector('[data-focus="u:quick_step"]')).includes('Requires Lamp Post Lv 2'), true, 'a locked upgrade says why');
  panel.scope.focusKey('u:bright_flame');
  lp.press(B.SOUTH);
  assert.equal(rankOf('bright_flame'), '1/5', 'redrawn with the new rank');
  assert.ok(textsOf(panel.el.querySelector('[data-focus="u:bright_flame"]')).some((x) => /^Need \d+ /.test(x)), 'and what the next rank is short of');
  // Everything bought: Next up has nothing to show and hides.
  const all = profile(Object.fromEntries(DATA.buildings.map((b) => [b.id, b.levels.length])));
  all.profile.research.done = DATA.research.map((r) => r.id);
  for (const u of DATA.upgrades) all.profile.upgrades[u.id] = u.ranks;
  assert.equal(harbor(all).hud('hud-next').hidden, true);
  // A corner panel fades while you stand under it (the stand-in DOM gives it a place).
  const c = harbor(profile());
  const next = c.hud('hud-next');
  next.rect = { left: 6, top: 261, width: 132, height: 93 };
  c.view.toView = (x, y) => ({ x, y });
  c.place([30, 18]); c.frame();
  assert.equal(next.classList.contains('under'), false);
  c.world.player.x = c.world.player.px = 40; c.world.player.y = c.world.player.py = 300;
  c.frame();
  assert.equal(next.classList.contains('under'), true, 'faded while you walk under it');
});

test('hub scene: the results take a moment before a press counts, then Circle closes them; their next lines say what\'s short', () => {
  const result = { end: 'left', timeSurvived: 70, totalKills: 0, kills: {}, bossesKilled: [], materials: { oil: 15, coin: 15 }, weapons: [], passives: [], relics: [], runes: [], evolutions: [] };
  const out = applyRunResult(profile(), result, DATA);
  const t = harbor(out.doc, { results: { changes: out.changes, result } });
  const s = t.top();
  const lines = [...s.el.querySelectorAll('.next-line')].map((l) => textsOf(l));
  assert.ok(lines.some((l) => l[0] === 'Lamp Post Lv 1' && l.includes('Ready')), JSON.stringify(lines));
  assert.ok(lines.some((l) => l[0] === 'Library Lv 1' && l.some((x) => /^Need .*Drowned Pages/.test(x))), 'what\'s short, for the others');
  t.press(B.EAST);
  assert.equal(t.top(), s, 'a press right away is ignored (a held button from the run can\'t close them)');
  t.frame(30);
  t.press(B.EAST);
  assert.equal(t.top(), null, 'Circle closes them');
});

test('hub scene: research starts from the Library\'s panel, saved, and its row says it\'s under way', () => {
  const t = harbor(profile({ library: 1 }, RICH));
  const panel = t.open('library');
  const tide = DATA.research.find((r) => r.id === 'tide_charts');
  assert.ok(panel.scope.focusKey('r:tide_charts'));
  t.sounds.length = 0;
  t.press(B.SOUTH);
  assert.deepEqual(t.state.doc.profile.research.active, [{ id: 'tide_charts', runsLeft: tide.runs }], 'started and saved');
  assert.equal(t.state.saves, 1);
  assert.ok(t.sounds.includes('pickup'), 'the purchase sound');
  assert.equal(panel.el.querySelector('.bld-note').textContent, `Research started: ${tide.name}`);
  const row = panel.el.querySelector('[data-focus="r:tide_charts"]');
  assert.equal(row.querySelector('.row-active').textContent, `In progress: ${tide.runs} runs left`);
  assert.equal(panel.scope.current.dataset.focus, 'r:tide_charts', 'still on its row');
  // Each row starts its own project: another one is refused for the slot, not started in its place.
  assert.ok(panel.scope.focusKey('r:orbwright'));
  t.press(B.SOUTH);
  assert.deepEqual(t.state.doc.profile.research.active.map((r) => r.id), ['tide_charts'], 'one project at a time');
  // What you can't cover yet is marked in a cost; a building with nothing left says so.
  const poor = harbor(profile({ library: 1 }, { drowned_pages: 1 }));
  const costs = [...poor.open('library').el.querySelectorAll('[data-focus="r:orbwright"] .cost-item')];
  assert.ok(costs.length > 0 && costs.every((c) => c.classList.contains('short')), 'short of it all');
  const rich = harbor(profile({ library: 1 }, RICH));
  assert.ok([...rich.open('library').el.querySelectorAll('[data-focus="r:orbwright"] .cost-item')].every((c) => !c.classList.contains('short')), 'none short');
  const done = harbor(profile({ tavern: 5 }));
  assert.deepEqual(textsOf(done.open('tavern').el.querySelector('.bld-next')), ['Fully restored']);
});

test('hub scene: after Run again, the results say how many runs since the harbor, and which map the last one cleared', () => {
  const run = (end, secs) => ({ end, timeSurvived: secs, map: 'drowned_docks', totalKills: 0, kills: {}, bossesKilled: [], materials: { coin: 5 }, weapons: [], passives: [], relics: [], runes: [], evolutions: [] });
  const first = applyRunResult(profile(), run('died', 200), DATA);
  const second = applyRunResult(first.doc, run('cleared', 1500), DATA);
  const t = harbor(second.doc, { results: { changes: [...first.changes, ...second.changes], result: run('cleared', 1500), runs: 2 } });
  assert.ok(textsOf(t.top().el).includes('Results (2 runs)') && textsOf(t.top().el).includes('Last run: Drowned Docks cleared in 25:00'), textsOf(t.top().el).join(' | '));
});

test('settings: a switch between fullscreen and a window saves first, then switches; the error screen says what stopped; the root carries the view\'s unit and left edge', async () => {
  const document = installFakeDocument();
  const root = document.createElement('div');
  document.body.appendChild(root);
  const box = { pads: [dualSense()], t: 1000 };
  const input = createInput({ getGamepads: () => box.pads, target: new EventTarget(), now: () => box.t });
  const ui = createUi({ root, input, doc: document, sound: () => {} });
  ui.layout({ x: 137, y: 20, scale: 3 }, 640, 360);
  assert.deepEqual([root.style.getPropertyValue('--u'), root.style.getPropertyValue('--view-left')], ['3px', '137px'], 'what sits beside the view keeps clear of it with these');
  const menuCtx = { ui, icon: () => document.createElement('span'), sound: () => {} };
  const settings = defaultSettings();
  const order = [];
  const save = async () => { await null; order.push(`saved ${settings.display.mode}`); };
  const s = openSettings({
    ui, menuCtx, settings, desktop: true, native: { setDisplayMode: (m) => order.push(`switched to ${m}`) },
    atTitleOrHarbor: () => true, reopen: async (go) => { go(); return true; },
    input, audio: { setVolumes() {} }, renderer: { setFillScreen() {} }, save,
  });
  const frame = () => { box.t += FRAME_MS; input.update(FRAME_MS); ui.update(FRAME_MS); };
  frame();
  assert.ok(s.scope.focusKey('display.mode'));
  box.pads = [dualSense([B.LEFT])]; frame(); box.pads = [dualSense()]; frame();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(order, ['saved windowed', 'switched to windowed'], 'fullscreen to a window: saved, then switched');
  ui.close(s);
  // The error screen, in a run and out of one.
  const texts = (inRun) => textsOf(errorScreen(menuCtx, { message: 'boom', inRun, onReport() {}, onReload() {} }).el);
  assert.ok(texts(true).includes('The run stopped because of an error. Save a bug report, then reload.'));
  assert.ok(texts(false).includes('The game stopped because of an error. Save a bug report, then reload.'));
  assert.ok(texts(false).includes('boom') && texts(false).includes('Save bug report') && texts(false).includes('Reload'));
});

/** The pad with the left stick held at (x, y) (-1..1) and these buttons. */
function stick(x, y = 0, pressed = []) { const p = dualSense(pressed); p.axes = [x, y, 0, 0]; return p; }

test('hub scene: walking off the quay by the gate opens the gate once a push; backing out with west still held doesn\'t reopen it', () => {
  const t = harbor(profile());
  const g = HUB.gate.at;
  t.place([0, g[1]]);
  t.box.pads = [stick(-1)];
  let frames = 0;
  while (!t.top() && frames < 60) { t.frame(); frames++; }
  assert.match(t.top()?.el.className ?? '', /gate-screen/, 'pushing west at the quay\'s end opened the gate');
  assert.ok(frames <= Math.ceil(HUB_TUNING.timing.walkOff * 60) + 4, `in ${frames} frames (the walk to the edge, then the push)`);
  // Circle backs out, the stick still held west: it stays shut, however long you hold.
  t.frame(30);   // past the screen's input delay
  t.box.pads = [stick(-1, 0, [B.EAST])]; t.frame(); t.box.pads = [stick(-1)];
  assert.equal(t.top(), null, 'backed out');
  t.frame(60);
  assert.equal(t.top(), null, 'still holding west: no second gate');
  // Under a screen you stand still, whatever the stick says.
  t.box.pads = [stick(1, 1)];
  t.press(B.START);
  t.box.pads = [stick(1, 1)];
  const still = [t.world.player.x, t.world.player.y];
  t.frame(20);
  assert.match(t.top()?.el.className ?? '', /hub-menu/);
  assert.deepEqual([t.world.player.x, t.world.player.y], still, 'no walking under a screen');
  t.box.pads = [stick(0)]; t.press(B.START);
  assert.equal(t.top(), null);
  t.place([0, g[1]]);
  // Let go, push again: it opens again.
  t.box.pads = [stick(0)]; t.frame();
  t.box.pads = [stick(-1)]; t.frame(30);
  assert.match(t.top()?.el.className ?? '', /gate-screen/, 'a new push opens it again');
});

test('hub scene: the guide shows its goal and marker until its target is in reach, hides under a screen, and goes once the Lamp Post stands', () => {
  // No run yet: to the gate.
  const t = harbor(profile());
  const goal = t.hud('hud-goal'), arrow = t.hud('hud-guide');
  t.place([30, 18]);
  t.frame();
  assert.equal(goal.hidden, false);
  assert.match(goal.textContent, /gate at the bottom left/);
  assert.equal(arrow.hidden, false, 'the marker shows');
  // In reach of the gate: the gate's own prompt takes over from the marker.
  t.place(HUB.gate.at);
  t.frame();
  assert.equal(t.world.near?.kind, 'gate');
  assert.equal(arrow.hidden, true, 'no marker over a prompt');
  assert.equal(goal.hidden, false, 'the goal stays');
  // Under a screen, both go.
  t.place([30, 18]);
  t.press(B.START);
  t.frame();
  assert.match(t.top().el.className, /hub-menu/);
  assert.equal(goal.hidden, true);
  assert.equal(arrow.hidden, true);
  // After a run, with the Lamp Post a ruin: restore it. Restored: no guide at all.
  const ran = profile({}, DATA.buildings.find((b) => b.id === 'lamp_post').levels[0].cost); ran.stats.runs = 1;
  const t2 = harbor(ran);
  t2.place([30, 18]); t2.frame();
  assert.match(t2.hud('hud-goal').textContent, /Restore the Lamp Post/);
  const done = profile({ lamp_post: 1 }); done.stats.runs = 3;
  const t3 = harbor(done);
  t3.place([30, 18]); t3.frame();
  assert.equal(t3.hud('hud-goal').hidden, true);
  assert.equal(t3.hud('hud-guide').hidden, true);
});

/** The run scene with stand-ins for what needs a browser, and a frame() that runs one frame as main.js does. */
function runRig({ isFirstRun = () => false, character = 'lamplighter', seed = 'rig' } = {}) {
  const document = installFakeDocument();
  const root = document.createElement('div');
  document.body.appendChild(root);
  const box = { pads: [dualSense()], t: 1000 };
  const input = createInput({ getGamepads: () => box.pads, target: new EventTarget(), now: () => box.t });
  const ui = createUi({ root, input, doc: document, sound: () => {} });
  ui.layout({ x: 0, y: 0, scale: 1 }, 640, 360);
  const menuCtx = { ui, icon: () => document.createElement('span'), sound: () => {} };
  const view = { now: 0, attach() {}, detach() {}, markTick() {}, consume() {}, draw(a, ms) { this.now += ms; }, screenFlash: () => 0 };
  const errors = [];
  const camera = { x: 320, y: 180 };
  const scene = createRunScene({
    view, hud: { attach() {}, detach() {}, draw() {}, notice() {} }, input, ui, menuCtx, audio: { ok: false }, data: DATA, buildId: 'test',
    loop: { pause() {}, resume() {}, reset() {}, hitStop() {} }, renderer: { camera },
    onRunSaved() {}, onHarbor() {}, startRun() {}, onSettings() {}, saveReport() {}, copyText: () => 'ok', onTitle() {},
    isFirstRun, onError: (e) => errors.push(e),
  });
  scene.enter({ character, seed, all: true });
  const frame = (n = 1) => { for (let i = 0; i < n; i++) { box.t += FRAME_MS; input.update(FRAME_MS); scene.step(1 / 60); scene.frame(1, FRAME_MS); ui.update(FRAME_MS); } };
  const press = (b) => { box.pads = [dualSense([b])]; frame(); box.pads = [dualSense()]; frame(); };
  return { scene, ui, root, box, frame, press, errors, camera };
}

test('run scene: a first run shows How to play, hidden under a screen, gone after its seconds; a later run never shows it', () => {
  for (const first of [true, false]) {
    const { scene, ui, root, frame, camera } = runRig({ isFirstRun: () => first, seed: 'tips' });
    frame(2);
    const card = () => root.querySelector('.run-tips');
    if (!first) { assert.equal(card(), null, 'not after the first run'); continue; }
    assert.ok(card(), 'a first run shows it');
    assert.deepEqual(textsOf(card()).filter((s) => /\w{4}/.test(s)).slice(0, 1), ['How to play']);
    scene.openPauseForTools();
    frame();
    assert.equal(card().hidden, true, 'hidden under the pause');
    ui.closeAll();
    frame();
    assert.equal(card().hidden, false);
    // Under it, it fades (as the minimap does); away from it, it's solid.
    ui.view.rect = { left: 0, top: 0, width: 640, height: 360 };
    card().rect = { left: 8, top: 274, width: 116, height: 76 };
    const w = scene.world;
    camera.x = w.player.x; camera.y = w.player.y;
    frame();
    assert.equal(card().style.opacity, '', 'solid while you\'re in the middle');
    w.player.x = camera.x - 320 + 60; w.player.y = camera.y - 180 + 300;
    frame();
    assert.equal(card().style.opacity, '0.25', 'faded while you stand under it');
    // Its seconds pass (the world's clock: a paused run doesn't wear it down).
    scene.world.tick = DATA.tuning.feel.firstRunTipsSec * 60 + 1;
    frame();
    assert.equal(card(), null, 'gone');
  }
});

test('run scene: an Ember opens Ascend; Keep for later, then the pause\'s Ascend spends it; the pause never offers it over another screen', () => {
  const { scene, ui, frame, press } = runRig({ seed: 'ascend' });
  frame(2);
  const w = scene.world;
  scene.recorded.decide({ kind: 'dev', cmd: 'ember' });
  frame(3);
  assert.match(ui.top?.el.className ?? '', /ascend-screen/, 'the Ember stopped the run for the choice');
  const words = textsOf(ui.top.el);
  for (const t of ['Ascend', 'Flare Gun', 'Starburst', 'Signal Pair', 'White Phosphor', 'Keep for later']) assert.ok(words.includes(t), `says "${t}"`);
  // Options over the Ascend screen: the pause has no Ascend (the Ember's own screen is open).
  frame(20);
  press(B.START);
  assert.ok(ui.has((x) => x.isPause), 'paused over it');
  assert.equal(ui.top.el.querySelector('[data-focus="ascend"]'), null, 'no Ascend in the pause over the Ascend screen');
  press(B.START);
  assert.match(ui.top?.el.className ?? '', /ascend-screen/);
  // Keep it.
  ui.top.scope.focusKey('keep');
  press(B.SOUTH);
  assert.equal(ui.top, null);
  assert.equal(w.build.embers, 1);
  // The pause now offers it; Ascend there opens the screen; a pick spends it.
  press(B.START);
  const asc = ui.top.el.querySelector('[data-focus="ascend"]');
  assert.ok(asc, 'Ascend (1) in the pause');
  assert.deepEqual(textsOf(asc).slice(-1), ['Ascend (1)']);
  ui.top.scope.focusKey('ascend');
  press(B.SOUTH);
  frame(20);
  assert.match(ui.top?.el.className ?? '', /ascend-screen/);
  ui.top.scope.focusKey('a0_1');
  press(B.SOUTH);
  assert.equal(ui.top, null);
  assert.equal(w.build.embers, 0);
  assert.deepEqual(w.slots[0].ascensions.map((a) => a.id), ['signal_pair']);
  // Pause, Stats: the character, the weapons (her own light too), and the items.
  press(B.START);
  ui.top.scope.focusKey('stats');
  press(B.SOUTH);
  assert.match(ui.top?.el.className ?? '', /stats-screen/);
  const stats = textsOf(ui.top.el);
  for (const t of ['Character', 'All weapons', 'Weapons', 'Items', 'HP', 'Dealt this run', 'Ascended: Signal Pair']) assert.ok(stats.includes(t), `Stats says "${t}" (${stats.join(' | ')})`);
  assert.ok(stats.some((t) => /\(built in\)/.test(t)), "the character's own weapon is listed");
  press(B.EAST);
  assert.ok(ui.has((x) => x.isPause), 'Back returns to the pause');
});

test('hub scene: off screen the guide\'s arrow aims where the walk to the gate leaves the screen, and stays off the goal line and the corner panels', () => {
  // A view with a real camera on you, anchors as the real view places them, and the HUD's boxes laid out.
  const cam = { x: 0, y: 0 };
  let t = null;
  const view = {
    toView: (x, y) => ({ x: x - cam.x + 320, y: y - cam.y + 180 }),
    anchorOf: (n) => (n?.kind === 'gate' ? { x: HUB.gate.at[0] * 16 + 8, y: HUB.gate.at[1] * 16 - 20 } : n ? { x: 0, y: 0 } : null),
    draw(alpha, ms) { this.now += ms; cam.x = t?.world.player.x ?? 0; cam.y = t?.world.player.y ?? 0; },
  };
  t = harbor(profile(), { view });
  const hud = t.root.querySelector('.hub-hud');
  hud.rect = { left: 0, top: 0, width: 640, height: 360 };
  t.hud('hud-mats').rect = { left: 6, top: 6, width: 226, height: 20 };
  t.hud('hud-next').rect = { left: 6, top: 262, width: 132, height: 92 };
  t.hud('hud-goal').rect = { left: 238, top: 8, width: 164, height: 17 };
  t.place(HUB.spawn);
  t.frame(2);
  const shown = t.scene.hudForTools.guideShown;
  assert.ok(shown && shown.marker && !shown.marker.on, 'the gate is off screen: an edge arrow');
  // It aims where the walk leaves the screen, not at the gate in a straight line.
  const w = t.world;
  const p = [Math.floor(w.player.x / 16), Math.floor(w.player.y / 16)];
  const exit = routeExit(routeTo(w.map, w.solid, p, HUB.gate.at), (tt) => view.toView(tt[0] * 16 + 8, tt[1] * 16 + 8), 640, 360);
  assert.ok(exit, 'the walk leaves the screen');
  assert.deepEqual(shown.target, exit);
  // And sits on none of the boxes.
  const m = shown.marker;
  for (const cls of ['hud-mats', 'hud-next', 'hud-goal']) {
    const r = t.hud(cls).rect;
    assert.ok(m.x < r.left - 7 || m.x > r.left + r.width + 7 || m.y < r.top - 7 || m.y > r.top + r.height + 7, `clear of ${cls} (${m.x}, ${m.y})`);
  }
});
