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
import { orderPosted } from '../src/meta/state.js';   // (round 2: the Tavern counts the posted orders, as the board does)
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
import { TASK, TASK_STATE } from '../src/sim/constants.js';
import { HUNT_COUNTS } from '../src/data/trophies.js';   // (X3)

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
  const t = harbor(profile({ tavern: 1, lamp_post: 2 }));
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
  assert.ok(textsOf(row).includes('The Library is busy. Play runs until a project finishes, or restore the Library to Lv 3'));
  assert.equal(row.getAttribute('aria-disabled'), null, 'it still takes a press');
  assert.ok(t.top().scope.focusKey('r:tide_charts'));
  t.sounds.length = 0;
  t.press(B.SOUTH);
  assert.equal(t.top().el.querySelector('.bld-note').textContent, 'The Library is busy. Play runs until a project finishes, or restore the Library to Lv 3');
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
  assert.equal(panel.el.querySelector('.bld-note').textContent, `Scavenger, rank 1 of ${DATA.upgrades.find((u) => u.id === 'tide_luck').ranks}`);
  t.press(B.SOUTH);
  assert.equal(t.state.doc.profile.upgrades.tide_luck, 2, 'so the next press buys the next rank');
});

test('hub scene: the harbor\'s menu opens and closes on Options; its Set out goes to the gate', () => {
  const t = harbor(profile({ tavern: 1, lamp_post: 2 }));
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
  assert.deepEqual(textsOf(banner), ['Library Lv 1', 'Research: pay materials to start a project, and it finishes after a few runs', 'Pushes the fog back from nearby streets']);
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
  // The totals (picked up, and 7 minutes' pay), the news, Next up (0.7.3).
  for (const line of ['Results', 'Survived 7:11', '40 Coin', '17 Oil', 'Time bonus (7 min): +28 Coin, +14 Oil', 'Next up']) assert.ok(texts.includes(line), `says "${line}" (${texts.join(' | ')})`);
  assert.equal(s.scope.current.dataset.focus, 'continue');
  assert.equal(t.scene.idle, false, 'never a safe point with the results up');
  t.frame(30);
  t.press(B.SOUTH);
  assert.equal(t.top(), s, 'a press in the first 800 ms does nothing (0.7.3)');
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
  assert.deepEqual(textsOf(prompt).slice(-1), ['Enter the Library']);
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
  const t = harbor(profile({ lamp_post: 3 }, { oil: 130, coin: 130 }));
  const mats = t.hud('hud-mats'), next = t.hud('hud-next');
  const oilBefore = textsOf(mats);
  const nextBefore = textsOf(next).join(' | ');
  const panel = t.open('lamp_post');
  panel.scope.focusKey('u:bright_flame');
  t.press(B.SOUTH);
  assert.equal(t.state.doc.profile.upgrades.bright_flame, 1);
  assert.notDeepEqual(textsOf(mats), oilBefore, 'the materials bar shows what\'s left');
  assert.ok(textsOf(mats).includes(String(130 - DATA.upgrades.find((u) => u.id === 'bright_flame').cost.oil)), textsOf(mats).join(' '));
  assert.notEqual(textsOf(next).join(' | '), nextBefore, 'the next three moved on');
  assert.ok(textsOf(next).includes('Brighter Flame, rank 2 of 5') || !textsOf(next).includes('Brighter Flame, rank 1 of 5'), textsOf(next).join(' | '));
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
  // Right from Restore: the list's first row in view (0.9.0, V4: it landed on the second), however
  // the rows line up beside it.
  t.press(B.RIGHT);
  assert.equal(panel.scope.current.dataset.focus, `u:${DATA.upgrades[0].id}`, 'right: the list\'s first row');
  t.press(B.DOWN); t.press(B.DOWN);
  assert.equal(panel.scope.current.dataset.focus, `u:${DATA.upgrades[2].id}`);
  t.press(B.UP);
  assert.equal(panel.scope.current.dataset.focus, `u:${DATA.upgrades[1].id}`);
  t.press(B.SOUTH);
  assert.equal(t.state.doc.profile.upgrades[DATA.upgrades[1].id], 1, 'pressed what it landed on');
  layout();
  t.press(B.LEFT);
  assert.equal(panel.scope.current.dataset.focus, 'restore');
});

test('hub scene: the Tavern lists who comes back; the results\' next three and Set out again', () => {
  const t = harbor(profile({ tavern: 2 }));
  const panel = t.open('tavern');
  const words = textsOf(panel.el.querySelector('.bld-list'));
  // Three parts (0.7.3): Levels, Mastery (each character's way into their skill tree: ruling 15), and Feats.
  for (const line of ['Levels', 'Mastery', 'Harbor Orders', `0 of ${DATA.feats.filter((f) => orderPosted(profile({ tavern: 2 }), DATA, f)).length} done`, 'Bram, the innkeeper, moves back in', 'Bram starts walking around the harbor', 'Lamplighter\'s skills', 'No skills taken yet.']) assert.ok(words.includes(line), `says "${line}" (${words.join(' | ')})`);
  assert.equal(words.filter((w) => w === 'Restored').length, 2, 'levels 1 and 2 are here');
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
  r.frame(50);
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
  // Plain names (0.7.3): the groups and every value in words, with units; Copy tuning keeps the paths.
  assert.deepEqual(groups, ['Dev commands', 'Harbor timing', 'Harbor look', 'Harbor look, dust', 'Harbor look, smoke', 'Harbor look, puffs']);
  assert.ok(!textsOf(panel.el).some((x) => /^hub\./.test(x)), 'no code names on the rows');
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
  assert.match(note(), /^Added 100 of each material the maps drop \(10 kinds\)\. Saved to your profile\.$/);
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
  assert.deepEqual(t.world.people.filter((p) => p.kind === 'keeper').map((p) => p.id), DATA.npcs.map((n) => n.id), 'every keeper, in the data\'s order');
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
  for (const kind of ['weapons', 'passives', 'relics']) assert.deepEqual(ids(scene.world.pools[kind]), want.pools[kind], `the run draws from the profile's ${kind}`);
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
  assert.deepEqual(runs, [{ character: 'lamplighter', seed: undefined, all: false, consumables: [], rune: '' }], 'Run again: the same character, a new seed, the profile\'s pools again, nothing used up taken twice');
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
  const t = harbor(profile({ lamp_post: 1 }, RICH));
  assert.deepEqual(t.view.levels, Object.fromEntries(DATA.buildings.map((b) => [b.id, b.id === 'lamp_post' ? 1 : 0])));
  t.open('lamp_post').scope.focusKey('restore');
  t.press(B.SOUTH);
  assert.equal(t.view.levels.lamp_post, 2);
  // The Lamp Post's second level: its ceremony, then the Harpooner's boat. Circle skips as well as cross.
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
  assert.equal(textsOf(panel.el.querySelector('[data-focus="u:quick_step"]')).includes('Needs the Lamp Post at Lv 2'), true, 'a locked upgrade says why');
  panel.scope.focusKey('u:bright_flame');
  lp.press(B.SOUTH);
  assert.equal(rankOf('bright_flame'), '1/5', 'redrawn with the new rank');
  assert.ok(textsOf(panel.el.querySelector('[data-focus="u:bright_flame"]')).some((x) => /^Need \d+ /.test(x)), 'and what the next rank is short of');
  // Everything bought: Next up has nothing to show and hides.
  const all = profile(Object.fromEntries(DATA.buildings.map((b) => [b.id, b.levels.length])));
  all.profile.research.done = DATA.research.map((r) => r.id);
  for (const u of DATA.upgrades) all.profile.upgrades[u.id] = u.ranks;
  // (and every piece of gear made, each consumable held: Phase 7's goals met too)
  all.profile.gear = { inventory: DATA.recipes.map((r, i) => ({ uid: i + 1, id: r.id, tier: 5, affixes: [r.base] })), equipped: {}, next: DATA.recipes.length + 1, rolls: 0 };
  all.profile.consumables = Object.fromEntries(DATA.consumables.map((c) => [c.id, 1]));
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
  assert.ok(t.top() === s, 'and for 800 ms (0.7.3)');
  t.frame(20);
  t.press(B.EAST);
  assert.ok(t.top() === null, 'Circle closes them');
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
  // Fully restored: no next level, the list takes the whole width, and the Tavern's levels go (0.7.3).
  const done = harbor(profile({ tavern: 5 }));
  const full = done.open('tavern').el;
  assert.deepEqual(textsOf(full.querySelector('.bld-next')), []);
  assert.ok(full.querySelector('.bld-body').classList.contains('full'));
  assert.ok(!textsOf(full.querySelector('.bld-list')).includes('Levels'), textsOf(full.querySelector('.bld-list')).join(' | '));
});

test('hub scene: after Run again, the results say how many runs since the harbor, and which map the last one cleared', () => {
  const run = (end, secs) => ({ end, timeSurvived: secs, map: 'drowned_docks', totalKills: 0, kills: {}, bossesKilled: [], materials: { coin: 5 }, weapons: [], passives: [], relics: [], runes: [], evolutions: [] });
  const first = applyRunResult(profile(), run('died', 200), DATA);
  const second = applyRunResult(first.doc, run('cleared', 1500), DATA);
  const t = harbor(second.doc, { results: { changes: [...first.changes, ...second.changes], result: run('cleared', 1500), runs: 2 } });
  assert.ok(textsOf(t.top().el).includes('Results (2 runs)') && textsOf(t.top().el).includes('Last run: Drowned Docks cleared at 25:00'), textsOf(t.top().el).join(' | '));
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
function runRig({ isFirstRun = () => false, character = 'lamplighter', seed = 'rig', harbor = null, map = null, seen = null, config = null } = {}) {
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
  const notices = [], quiet = [], loud = [];
  const scene = createRunScene({
    view, hud: { attach() {}, detach() {}, draw() {}, notice(lines, ms, now, opts) { notices.push(lines); (opts?.quiet ? quiet : loud).push(lines); } }, input, ui, menuCtx, audio: { ok: false }, data: DATA, buildId: 'test',
    ...(harbor || map || config ? { configFor: (c) => ({ seed: c.seed, character: c.character, map: map ?? DATA.maps[0].id, ...(harbor ? { harbor } : {}), ...config }) } : {}),
    ...(seen ? { seen } : {}),
    loop: { pause() {}, resume() {}, reset() {}, hitStop() {} }, renderer: { camera },
    onRunSaved() {}, onHarbor() {}, startRun() {}, onSettings() {}, saveReport() {}, copyText: () => 'ok', onTitle() {},
    isFirstRun, onError: (e) => errors.push(e),
  });
  scene.enter({ character, seed, all: true });
  const frame = (n = 1) => { for (let i = 0; i < n; i++) { box.t += FRAME_MS; input.update(FRAME_MS); scene.step(1 / 60); scene.frame(1, FRAME_MS); ui.update(FRAME_MS); } };
  const press = (b) => { box.pads = [dualSense([b])]; frame(); box.pads = [dualSense()]; frame(); };
  return { scene, ui, root, box, frame, press, errors, camera, notices, quiet, loud };
}

test('run scene: one frame\'s notices show in turn, so the first Pearls are explained even when a lamp gives it; a lamp lit goes on the quiet line', () => {
  const light = (rig) => {
    rig.frame(2);
    const w = rig.scene.world;
    const lamp = w.tasks.findIndex((t) => t.kind === TASK.LAMP);
    rig.scene.recorded.decide({ kind: 'dev', cmd: 'warp', task: lamp });
    for (let k = 0; k < 900 && w.tasks[lamp].state !== TASK_STATE.DONE; k++) rig.frame();
    assert.equal(w.tasks[lamp].state, TASK_STATE.DONE, 'lit by standing there');
  };
  // With the Ferryman in the run: the lamp's line asks nothing (the quiet line), and the first Sea
  // Glass says what it's for (the middle line), once a run.
  const r = runRig({ seed: 'glass', harbor: { ferry: 1, lampSpeed: 0, bellRing: 0, tasksOnMap: 0, secretsOnMap: 0 } });
  light(r);
  const lit = r.quiet.find((n) => n.some((l) => /^Lamp 1 of \d+ lit/.test(l)));
  assert.ok(lit, JSON.stringify(r.notices));
  assert.ok(r.loud.flat().some((l) => /^Pearls: spend them with the Ferryman/.test(l)), `the first Pearls are said: ${JSON.stringify(r.loud)}`);
  assert.equal(r.notices.flat().filter((l) => /^Pearls: /.test(l)).length, 1, 'once a run');
  assert.ok(lit.some((l) => /enemies in its light burn(, and your Fuel is full)?, \d+ Pearls$/.test(l)), 'a lit lamp is a ward, and says what it paid (0.8.2)');
  // Before the Docks there is no one to spend them with: nothing about Pearls at all (0.7.3).
  const bare = runRig({ seed: 'glass' });
  light(bare);
  assert.ok(bare.quiet.flat().some((l) => /^Lamp 1 of \d+ lit: enemies in its light burn(, and your Fuel is full)?$/.test(l)), JSON.stringify(bare.quiet));
  assert.ok(!bare.notices.flat().some((l) => /Sea Glass|Pearl/.test(l)), JSON.stringify(bare.notices));
});

test('run scene: a first run shows How to play, hidden under a screen, gone after its seconds; a later run never shows it', () => {
  for (const first of [true, false]) {
    const { scene, ui, root, frame, camera } = runRig({ isFirstRun: () => first, seed: 'tips' });
    frame(2);
    const card = () => root.querySelector('.run-tips');
    if (!first) { assert.equal(card(), null, 'not after the first run'); continue; }
    assert.ok(card(), 'a first run shows it');
    // 0.9.0: Move and Dash only (the map's things get a tip over each, app/runtips.js).
    assert.ok(textsOf(card()).some((s) => /Move/.test(s)) && textsOf(card()).some((s) => /Dash/.test(s)));
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

test('run scene: an Ember opens its screen; Keep for later, then the pause\'s Use an Ember spends it; the pause never offers it over another screen', () => {
  const { scene, ui, frame, press } = runRig({ seed: 'ascend' });
  frame(2);
  const w = scene.world;
  scene.recorded.decide({ kind: 'dev', cmd: 'ember' });
  frame(3);
  assert.match(ui.top?.el.className ?? '', /ascend-screen/, 'the Ember stopped the run for the choice');
  const words = textsOf(ui.top.el);
  for (const t of ['Forms', 'Flare Gun', '0 of 3 Forms', 'Keep for later']) assert.ok(words.includes(t), `says "${t}"`);
  // Step 2: a weapon's options, two an axis, each with its axis and price; Back returns to the weapons.
  frame(20);
  ui.top.scope.focusKey('w1');   // (0.9.0, W2: her lamp, Lamplight, is weapon 0 now; the Flare Gun is 1)
  press(B.SOUTH);
  const forms = textsOf(ui.top.el);
  for (const t of ['Salvo', 'Muzzle Flash', 'Mortar', 'Hanging Flare', 'First Form', 'Second Form', 'Final Form', 'Drawback: +10% Cooldown']) assert.ok(forms.includes(t), `the Forms screen says "${t}"`);
  press(B.EAST);
  assert.ok(textsOf(ui.top.el).includes('Keep for later'), 'Back: the weapons again');
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
  assert.ok(asc, 'Forms (1 Ember) in the pause');
  assert.deepEqual(textsOf(asc).slice(-1), ['Forms (1 Ember)']);
  ui.top.scope.focusKey('ascend');
  press(B.SOUTH);
  frame(20);
  assert.match(ui.top?.el.className ?? '', /ascend-screen/);
  ui.top.scope.focusKey('w1');
  press(B.SOUTH);
  ui.top.scope.focusKey('f1');   // (an Ember opens its next axis early: how it fires, Muzzle Flash the second)
  press(B.SOUTH);
  assert.equal(ui.top, null);
  assert.equal(w.build.embers, 0);
  assert.deepEqual(w.slots[1].ascensions.map((a) => a.id), ['muzzle_flash']);
  // Pause, Stats: the character, the weapons (her own light too), and the items.
  press(B.START);
  ui.top.scope.focusKey('stats');
  press(B.SOUTH);
  assert.match(ui.top?.el.className ?? '', /stats-screen/);
  const stats = textsOf(ui.top.el);
  for (const t of ['Character', 'All weapons', 'Weapons', 'Items', 'HP', 'DPS', 'Total Damage', 'Materials found', 'Forms: Muzzle Flash']) assert.ok(stats.includes(t), `Stats says "${t}" (${stats.join(' | ')})`);
  assert.ok(stats.some((t) => /^Lamplight/.test(t)), "the character's own weapon is listed (0.9.0: her signature, Lamplight)");
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

// ---------------------------------------------------------------- Phase 7's panels and screens

/** A profile with every Phase 7 building at its top and the means to use them. */
function phase7Profile() {
  const d = profile(Object.fromEntries(DATA.buildings.map((b) => [b.id, b.levels.length])), RICH);
  d.profile.research.done = DATA.research.map((r) => r.id);
  d.profile.characters = { lamplighter: { unlocked: true, masteryXp: 60, perks: [] } };
  d.profile.bestiary = { fog_wisp: 150, drowned_bosun: 5 };
  d.profile.tides = { drowned_docks: 4 }; d.profile.tide = { selected: 2 };
  d.profile.consumables = { smelling_salts: 1 };
  d.profile.feats = ['dawn'];   // (the Smelling Salts: Bell Breaker's)
  return d;
}
const keyOf = (t) => t.top().scope.current?.dataset.focus;

test('hub scene: every row of every Phase 7 panel takes focus (a pad reaches them all), and each panel lists what it should', () => {
  const t = harbor(phase7Profile());
  const want = { tavern: ['i:lamplighter_s_mastery', 'k:lamplighter', 'orders'], smithy: ['i:wearing', 'c:storm_lantern'], chapel: ['i:tide_1', 'i:tide_10', 'i:brittle'],
    market: ['t:iron'], apothecary: ['b:smelling_salts', 'b:driftwood_token'], cartographer: ['i:wreck_hold', 'i:on_your_minimap', 'i:challenge_runs'], docks: ['lv:1', 'lv:5'] };
  for (const [b, keys] of Object.entries(want)) {
    const panel = t.open(b);
    const rows = [...panel.el.querySelectorAll('.bld-list .list-row')];
    assert.ok(rows.length > 0, b);
    assert.deepEqual(rows.filter((r) => !r.dataset.focus).length, 0, `${b}: every row can take focus`);
    for (const k of keys) assert.ok(panel.scope.focusKey(k), `${b}: ${k}`);
    t.press(B.EAST);
  }
  // The Chapel says what opens each Tide and curse.
  const low = harbor((() => { const d = profile({ chapel: 1 }, RICH); d.profile.tides = {}; d.profile.tide = { selected: 0 }; return d; })());
  const ch = low.open('chapel');
  const texts = textsOf(ch.el);
  assert.ok(texts.includes('Kill the last boss to open it') && texts.includes('Opens at Chapel Lv 2') && texts.includes('Opens at Chapel Lv 5'));
  assert.ok(texts.some((x) => /^\+15% Enemy HP, \+8% Enemy Damage, \+5% Enemies, \+1.5% Enemy Speed, \+12% Materials$/.test(x)), 'a Tide\'s whole effect');
});

test('hub scene: the Smithy: make an item, open it, wear and take off, raise its tier, re-roll an affix from the three offered', () => {
  const t = harbor(phase7Profile());
  const panel = t.open('smithy');
  assert.ok(panel.scope.focusKey('c:storm_lantern'));
  t.press(B.SOUTH);
  assert.equal(t.state.doc.profile.gear.inventory.length, 1);
  assert.ok(textsOf(panel.el).includes('Made a Storm Lantern and put it on'));
  assert.ok(panel.scope.focusKey('g:1'));
  t.press(B.SOUTH);
  const gear = t.top();
  assert.match(gear.el.className, /gear-screen/);
  assert.equal(keyOf(t), 'wear');
  t.press(B.SOUTH);
  assert.equal(t.state.doc.profile.gear.equipped.lantern, undefined, 'taken off');
  t.press(B.SOUTH);
  assert.equal(t.state.doc.profile.gear.equipped.lantern, 1, 'and worn again');
  gear.scope.focusKey('tier');
  t.press(B.SOUTH);
  assert.equal(t.state.doc.profile.gear.inventory[0].tier, 2);
  assert.ok(textsOf(gear.el).includes('The Storm Lantern is now Uncommon'), 'tiers read as rarities (ruling 10)');
  const before = t.state.doc.profile.gear.inventory[0].affixes[1];
  gear.scope.focusKey('a1');
  t.press(B.SOUTH);
  assert.equal(keyOf(t), 'o0', 'the three offered');
  assert.equal(gear.el.querySelectorAll('.list-row.pick').length, 3);
  t.press(B.EAST);
  assert.equal(gear.el.querySelectorAll('.list-row.pick').length, 0, 'back closes the offer first');
  assert.equal(t.top(), gear);
  gear.scope.focusKey('a1');
  t.press(B.SOUTH);
  gear.scope.focusKey('o2');
  t.press(B.SOUTH);
  const after = t.state.doc.profile.gear.inventory[0].affixes[1];
  assert.notEqual(after, before);
  t.press(B.EAST);
  assert.equal(t.top(), panel, 'back to the Smithy');
  // The item's own affix is fixed (focusable, does nothing).
  panel.scope.focusKey('g:1'); t.press(B.SOUTH);
  assert.ok(t.top().scope.focusKey('a0'));
  const saves = t.state.saves;
  t.press(B.SOUTH);
  assert.equal(t.state.saves, saves);
});

test('hub scene: the Market trades, the Apothecary sells, the Cartographer shows its charts, the Tavern trains, each said on the panel', () => {
  const t = harbor(phase7Profile());
  const m = t.open('market');
  m.scope.focusKey('t:iron'); t.press(B.SOUTH);
  assert.ok(textsOf(m.el).some((x) => /^Traded \d+ \w[\w ]* for 1 Iron$/.test(x)));
  t.press(B.EAST);
  const a = t.open('apothecary');
  a.scope.focusKey('b:smelling_salts'); t.press(B.SOUTH);
  assert.equal(t.state.doc.profile.consumables.smelling_salts, 2);
  assert.ok(textsOf(a.el).includes('Bought Smelling Salts. You have 2'));
  t.press(B.EAST);
  // The Cartographer draws maps (ruling 13: no claims): what the charts mark, and where the set runs are.
  const c = t.open('cartographer');
  assert.ok(textsOf(c.el).includes('Small secrets: marked') && textsOf(c.el).includes('Big secrets: marked'), textsOf(c.el).join(' | '));
  assert.ok(![...c.el.querySelectorAll('[data-focus]')].some((e) => e.dataset.focus.startsWith('k:')), 'nothing to claim');
  t.press(B.EAST);
  const v = t.open('tavern');
  // Ruling 15: the Mastery list opens a character's skill tree, a screen of its own.
  v.scope.focusKey('k:lamplighter'); t.press(B.SOUTH);
  assert.notEqual(t.top(), v, 'the tree is its own screen');
  assert.ok(textsOf(t.top().el).includes('Great Lamp'), textsOf(t.top().el).join(' | '));
  t.press(B.EAST);
  assert.equal(t.top(), v, 'and back to the Tavern');
});

test('hub scene: the gate\'s second step: its rows, a detail for the focused value, changes, a refusal that stays, and Start', () => {
  const t = harbor(phase7Profile());
  t.scene.openGateForTools();
  t.frame();
  t.press(B.SOUTH);   // the Lamplighter
  const s = t.top();
  assert.match(s.el.className, /setup-screen/);
  assert.equal(s.el.querySelector('h1').textContent, 'Start a run', 'the screen\'s name; the Character row says who (C3)');
  // Six rows (the sweep, X2; no Rune stone row since ruling 14), every one in reach of the pad.
  assert.deepEqual([...s.el.querySelectorAll('.set-row')].map((r) => r.dataset.focus), ['map', 'character', 'kit', 'tools', 'difficulty']);
  // Difficulty is one row: left and right move along Lower, Raise, and the curses; confirm changes the one in focus.
  assert.ok(s.scope.focusKey('difficulty'));
  const diff = () => s.el.querySelector('[data-focus="difficulty"]');
  assert.equal(diff().querySelector('.set-item.at').textContent, 'Lower');
  s.onNav('right');
  assert.equal(diff().querySelector('.set-item.at').textContent, 'Raise');
  s.onAction('confirm');
  assert.ok(textsOf(diff()).some((x) => x.includes('Tide 3')), textsOf(diff()).join(' | '));
  assert.equal(diff().querySelector('.set-item.at').textContent, 'Raise', 'the item in focus stays in focus after a change');
  assert.ok(textsOf(s.el.querySelector('.setup-detail')).some((x) => x.startsWith('+45% Enemy HP')));
  s.onNav('right'); s.onAction('confirm');
  assert.equal(diff().querySelector('.set-item.at').textContent, 'Brittle: On', 'a switch says its state in words');
  assert.ok(textsOf(s.el).some((x) => /^This run pays 51% more materials$/.test(x)), 'what it adds');
  s.onAction('confirm');
  assert.equal(diff().querySelector('.set-item.at').textContent, 'Brittle: Off');
  for (let k = 0; k < 9; k++) s.onNav('right');
  assert.equal(diff().querySelector('.set-item.at').textContent.split(':')[0], DATA.curses.at(-1).name, 'the row stops at its last item');
  // An item that can't be pressed says why, and changes nothing.
  for (let k = 0; k < 9; k++) s.onNav('left');
  s.onAction('confirm'); s.onAction('confirm'); s.onAction('confirm');
  assert.ok(textsOf(s.el.querySelector('.setup-detail')).includes('No Tide is chosen.'));
  s.onNav('right'); s.onAction('confirm'); s.onAction('confirm'); s.onAction('confirm');
  // The map row steps to the short run and back.
  s.scope.focusKey('map');
  s.onNav('right');
  assert.ok(s.el.querySelector('[data-focus="map"] .set-value').textContent.includes('short run'));
  s.onNav('left');
  // A choice the profile no longer allows is refused on the screen, and nothing is used up.
  s.scope.focusKey('tools');
  s.onAction('confirm');
  assert.equal(s.el.querySelector('[data-focus="tools"] .set-item.at').textContent, 'Smelling Salts: On');
  t.state.doc = structuredClone(t.state.doc);
  delete t.state.doc.profile.consumables.smelling_salts;
  s.scope.focusKey('start');
  t.press(B.SOUTH);
  assert.equal(t.top(), s, 'still on the gate');
  assert.ok(textsOf(s.el).includes('You have no Smelling Salts.'));
  assert.deepEqual(t.state.runs, []);
  t.state.doc.profile.consumables.smelling_salts = 1;
  s.refresh();
  s.scope.focusKey('tools');
  s.onAction('confirm');
  s.scope.focusKey('start');
  t.press(B.SOUTH);
  assert.equal(t.state.runs.length, 1);
  assert.equal(t.state.runs[0].character, 'lamplighter');
  assert.equal(t.state.runs[0].tide, 3);
  assert.equal(t.state.runs[0].consumables, undefined);
});

test('hub scene: a set run starts from the Harbor Orders board, and one whose character hasn\'t come says why (ruling 13)', () => {
  const t = harbor(phase7Profile());
  const panel = t.open('tavern');
  panel.scope.focusKey('orders'); t.press(B.SOUTH);
  const board = t.top();
  assert.ok(textsOf(board.el).some((x) => x.startsWith('Challenge runs: 0 of ')) && textsOf(board.el).some((x) => x.startsWith('Hunts: 0 of 15')));
  // The Harpooner is here (the Lamp Post's level 2); the Punter is not.
  assert.ok(board.scope.focusKey('o:low_water'));
  t.press(B.SOUTH);
  assert.equal(t.top(), board);
  assert.ok(textsOf(board.el).includes('The Punter hasn\'t arrived yet'));
  assert.deepEqual(t.state.runs, []);
  assert.ok(board.scope.focusKey('o:bare_hands'));
  assert.ok(textsOf(board.el.querySelector('[data-focus="o:bare_hands"]')).includes('Start this run'));
  t.press(B.SOUTH);
  assert.deepEqual(t.state.runs, [{ character: 'harpooner', mode: 'challenge', challenge: 'bare_hands' }]);
  // A Hunt shows its count so far; a trial not earned yet isn't posted.
  const t2 = harbor(phase7Profile());
  t2.open('tavern').scope.focusKey('orders'); t2.press(B.SOUTH);
  assert.ok(textsOf(t2.top().el.querySelector('[data-focus="o:hunt_fog_wisp"]')).includes(`150 kills of ${HUNT_COUNTS.fog_wisp.toLocaleString('en-US')}`)   /* (X3: the count from the data) */);
  assert.equal(t2.top().el.querySelector('[data-focus="o:lamplighter_trial"]'), null);
});

test('hub scene: a pad walks a Phase 7 panel\'s whole list with the d-pad, every key its own, and a fixed row presses silently', () => {
  const t = harbor(phase7Profile());
  for (const b of ['tavern', 'smithy', 'chapel', 'market', 'apothecary', 'cartographer', 'docks']) {
    const panel = t.open(b);
    const keys = [...panel.el.querySelectorAll('[data-focus]')].map((e) => e.dataset.focus);
    assert.equal(new Set(keys).size, keys.length, `${b}: no two rows share a key`);
    t.press(B.EAST);
  }
  const panel = t.open('chapel');
  // The stand-in DOM has no layout: give the rows a column of places, as the real one would.
  const els = [...panel.el.querySelectorAll('[data-focus]')];
  els.forEach((e, i) => { e.rect = { left: 300, top: 40 + i * 20, width: 200, height: 18 }; });
  panel.scope.focus(els[0]);
  const seen = [keyOf(t)];
  for (let k = 0; k < els.length + 3; k++) { t.press(B.DOWN); if (keyOf(t) !== seen.at(-1)) seen.push(keyOf(t)); }
  assert.deepEqual(seen, els.map((e) => e.dataset.focus), 'down, row by row, to the last curse');
  assert.equal(seen.at(-1), 'i:fast_water');
  const sounds = t.sounds.length;
  t.press(B.SOUTH);
  assert.ok(!t.sounds.slice(sounds).includes('ui_confirm'), 'a fixed row presses nothing, and says nothing');
});

// ---------------------------------------------------------------- W5 (0.9.0): the board, the codex, the Lighthouse

test('hub scene: the Tavern\'s Harbor Orders and the Library\'s codex open from a row, walk row by row on the pad, and back out', () => {
  const t = harbor(phase7Profile());
  for (const [b, key, cls, first] of [['tavern', 'orders', 'orders-screen', 'o:'], ['library', 'codex', 'codex-screen', 'x:']]) {
    const panel = t.open(b);
    assert.ok(panel.scope.focusKey(key), `${b}: its ${key} row`);
    t.press(B.SOUTH);
    const top = t.top();
    assert.ok(top.el.className.includes(cls), `${b}: the ${cls} is up`);
    const els = [...top.el.querySelectorAll('[data-focus]')];
    const keys = els.map((e) => e.dataset.focus);
    assert.equal(new Set(keys).size, keys.length, `${cls}: no two rows share a key`);
    assert.ok(keyOf(t).startsWith(first), `${cls}: focus starts on the first row`);
    // A column of places, as the page lays them out: down walks every row, then Back.
    els.forEach((e, i) => { e.rect = { left: 300, top: 40 + i * 20, width: 200, height: 18 }; });
    top.scope.focus(els[0]);
    const seen = [keyOf(t)];
    for (let k = 0; k < els.length + 2; k++) { t.press(B.DOWN); if (keyOf(t) !== seen.at(-1)) seen.push(keyOf(t)); }
    assert.deepEqual(seen, keys, `${cls}: down, row by row, to Back`);
    t.press(B.EAST);
    assert.ok(!t.top().el.className.includes(cls), `${cls}: Back closes it`);
    t.press(B.EAST);
  }
});

test('hub scene: the Lighthouse\'s panel counts stages and lists each with what it opens', () => {
  const d = phase7Profile();
  d.profile.buildings.lighthouse = 3;
  const t = harbor(d);
  const panel = t.open('lighthouse');
  const words = textsOf(panel.el);
  assert.ok(words.includes('Stage 3 of 10'), words.join(' | '));
  assert.ok(words.includes('Next: Glaze the lantern room'));
  assert.ok(words.includes('4. Glaze the lantern room') && words.includes('Take 1 more run tool into each run'));
  assert.ok(panel.scope.focusKey('st:10'), 'the last stage takes focus');
});

// ---------------------------------------------------------------- the Salt Marsh (0.8.0)

/** A harbor with the Salt Marsh open (the Docks and the Tavern restored, the Harbor Maw killed). */
function marshProfile(extra = {}) {
  const d = profile({ docks: 1, tavern: 1, lamp_post: 2 }, { coin: 50 });
  d.profile.bestiary = { harbor_maw: 1 };
  Object.assign(d.profile, extra);
  return d;
}

test('hub scene: once the Marsh is open the gate asks where first, a card per map, then who sets out on it', () => {
  // One map: straight to who sets out.
  const one = harbor(profile({ tavern: 1, lamp_post: 2 }));
  one.scene.openGateForTools(); one.frame();
  assert.match(one.top().el.className, /gate-screen/);
  assert.ok(!/map-screen/.test(one.top().el.className));
  const t = harbor(marshProfile({ setup: { ...defaultProfile().profile.setup, map: 'salt_marsh' } }));
  t.scene.openGateForTools(); t.frame();
  const m = t.top();
  assert.match(m.el.className, /map-screen/);
  const cards = [...m.el.querySelectorAll('.map-card')];
  assert.deepEqual(cards.map((c) => textsOf(c)[0]), ['Drowned Docks', 'Salt Marsh']);
  assert.ok(textsOf(cards[1]).includes('Drops here only: Marsh Herbs and Salt Glass'), textsOf(cards[1]).join(' | '));
  assert.equal(m.scope.current.dataset.focus, 'm1', 'it starts on the map last chosen');
  t.press(B.SOUTH);
  const g = t.top();
  assert.match(g.el.className, /gate-screen/);
  assert.equal(g.el.querySelector('h1').textContent, 'Salt Marsh');
  // Back returns to the maps.
  t.press(B.EAST);
  assert.equal(t.top(), m);
  t.press(B.SOUTH);
  t.press(B.SOUTH);   // the Lamplighter
  assert.deepEqual(t.state.runs, [{ character: 'lamplighter', map: 'salt_marsh' }]);
  assert.equal(runConfigFor(t.state.doc, DATA, { ...t.state.runs[0], seed: 1 }).map, 'salt_marsh');
});

test('hub scene: a setup.map naming a known map that is closed: the gate skips the map cards and sets out on the Docks', () => {
  const d = profile({ docks: 1, tavern: 1, lamp_post: 2 });
  d.profile.setup = { ...defaultProfile().profile.setup, map: 'salt_marsh' };
  const t = harbor(d);
  t.scene.openGateForTools(); t.frame();
  assert.ok(!/map-screen/.test(t.top().el.className), 'one map open: no cards');
  assert.equal(t.top().el.querySelector('h1').textContent, 'Drowned Docks');
  t.press(B.SOUTH);   // the Lamplighter
  assert.deepEqual(t.state.runs, [{ character: 'lamplighter' }], 'map 1 says nothing more');
  assert.equal(runConfigFor(t.state.doc, DATA, { ...t.state.runs[0], seed: 1 }).map, 'drowned_docks');
});

test('run scene: Run again on the Salt Marsh asks the app\'s configFor for the Marsh again', () => {
  const document = installFakeDocument();
  const root = document.createElement('div');
  document.body.appendChild(root);
  const box = { pads: [dualSense()], t: 1000 };
  const input = createInput({ getGamepads: () => box.pads, target: new EventTarget(), now: () => box.t });
  const ui = createUi({ root, input, doc: document, sound: () => {} });
  ui.layout({ x: 0, y: 0, scale: 1 }, 640, 360);
  const menuCtx = { ui, icon: () => document.createElement('span'), sound: () => {} };
  const view = { now: 0, attach() {}, detach() {}, markTick() {}, consume() {}, draw(a, ms) { this.now += ms; }, screenFlash: () => 0 };
  const doc = marshProfile();
  const asked = [], runs = [];
  const configFor = (choice) => { asked.push(choice); return runConfigFor(doc, DATA, choice); };
  const scene = createRunScene({
    view, hud: { attach() {}, detach() {}, draw() {}, notice() {} }, input, ui, menuCtx, audio: { ok: false }, data: DATA, buildId: 'test',
    loop: { pause() {}, resume() {}, reset() {}, hitStop() {} }, renderer: { camera: { x: 0 } },
    configFor, onRunSaved() {}, onHarbor() {}, startRun: (cfg) => runs.push(cfg), onSettings() {}, saveReport() {}, copyText: () => 'ok', onTitle() {},
  });
  scene.enter({ character: 'lamplighter', seed: 'marsh-again', map: 'salt_marsh', tide: 0, curses: [] });
  assert.equal(asked[0].map, 'salt_marsh');
  assert.equal(scene.world.map.id, 'salt_marsh', 'the run is on the Marsh');
  const frame = (n = 1) => { for (let i = 0; i < n; i++) { box.t += FRAME_MS; input.update(FRAME_MS); scene.step(1 / 60); scene.frame(1, FRAME_MS); ui.update(FRAME_MS); } };
  frame(5);
  scene.recorded.decide({ kind: 'leave' });
  frame(Math.ceil(1400 / FRAME_MS) + 45);
  assert.match(ui.top.el.className, /end-screen/);
  ui.top.scope.focusKey('again');
  box.pads = [dualSense([B.SOUTH])]; frame(); box.pads = [dualSense()]; frame();
  assert.equal(runs.length, 1);
  assert.equal(runs[0].map, 'salt_marsh', 'Run again keeps the map');
  // As the app sets it out (main.js startRun enters the scene with it), the config is the Marsh's.
  const again = configFor({ ...runs[0], seed: 'next' });
  assert.equal(again.map, 'salt_marsh');
  assert.deepEqual(again.layers, { storm: false, well: false, secret: false }, 'with the Marsh\'s layers as the profile has them');
  scene.exit();
});

test('hub scene: the Punter comes home by boat when the results close; setting out from the results, he is simply there', () => {
  const d0 = marshProfile();
  const out = applyRunResult(d0, { map: 'salt_marsh', character: 'lamplighter', end: 'died', timeSurvived: 320, kills: {}, bossesKilled: [], materials: {} }, DATA);
  assert.ok(out.changes.some((c) => c.kind === 'arrival' && c.id === 'punter'));
  const t = harbor(out.doc, { results: { changes: out.changes, result: { end: 'died', timeSurvived: 320, map: 'salt_marsh' }, runs: 1 } });
  assert.ok(!t.world.people.some((p) => p.id === 'punter'), 'still out at sea under the results');
  assert.ok(textsOf(t.top().el).includes('New character: Punter. Coming home by boat'));
  t.frame(50);
  t.press(B.SOUTH);   // Continue
  assert.equal(t.world.timeline?.kind, 'arrival');
  assert.equal(t.world.timeline.id, 'punter');
  t.press(B.EAST);    // skip it
  assert.ok(t.world.people.some((p) => p.id === 'punter' && p.kind === 'waiting'));
  // Start run from the results instead: he's on the square, no boat.
  const s = harbor(out.doc, { results: { changes: out.changes, result: { end: 'died', timeSurvived: 320, map: 'salt_marsh' }, runs: 1 } });
  s.frame(50);
  s.top().scope.focusKey('again');
  s.press(B.SOUTH);
  assert.equal(s.world.timeline, null);
  assert.ok(s.world.people.some((p) => p.id === 'punter'));
});

test('run scene: the Salt Well\'s screen gives one relic or keeps them all; the pause menu\'s Field guide lists what the map has shown', () => {
  const rig = runRig({ map: 'salt_marsh', config: { layers: { storm: false, well: true, secret: false } }, seen: { on: () => ['enemy:midge_cloud', 'herbs'], any: () => new Set(['enemy:midge_cloud', 'herbs']) } });
  rig.frame(2);
  const w = rig.scene.world;
  assert.equal(w.map.id, 'salt_marsh');
  for (const id of ['brass_button', 'gull_feather']) rig.scene.recorded.decide({ kind: 'dev', cmd: 'give', what: 'relic', id });
  // The well, open where you stand (as the Well Warden's fall opens it).
  w.well.open = true; w.well.x = w.player.x; w.well.y = w.player.y; w.well.armed = true;
  for (let k = 0; k < 90 && !rig.ui.has((x) => /well-screen/.test(x.el.className)); k++) rig.frame();
  const screen = rig.ui.top;
  assert.match(screen.el.className, /well-screen/);
  assert.ok(textsOf(screen.el).includes('Give up one relic. It is gone for the rest of this run, and the Ferryman offers it on every map from then on.'));
  assert.deepEqual([...screen.el.querySelectorAll('.card-title')].map((e) => e.textContent), ['Brass Button', 'Gull Feather']);
  assert.equal(screen.scope.current.dataset.focus, 'keep', 'keeping is where it starts: ignoring the well costs nothing');
  rig.frame(30);
  screen.scope.focusKey('c1');
  rig.press(B.SOUTH);
  assert.equal(w.result.wellGiven, 'gull_feather');
  assert.ok(!w.build.relics.some((r) => r.id === 'gull_feather'));
  assert.ok(!rig.ui.has((x) => /well-screen/.test(x.el.className)));
  // The pause menu's Codex is the codex for this map (ruling 13): what it has shown, earlier runs' and this run's.
  w.result.sighted.push('enemy:midge_cloud', 'water');
  rig.scene.openPauseForTools(); rig.frame();
  const pause = rig.ui.top;
  assert.equal(pause.el.querySelector('[data-focus="guide"]').textContent, 'Codex');
  pause.scope.focusKey('guide'); rig.press(B.SOUTH);
  const guide = rig.ui.top;
  assert.match(guide.el.className, /codex-screen/);
  assert.equal(guide.el.querySelector('h1').textContent, 'Codex: Salt Marsh');
  const names = [...guide.el.querySelectorAll('.list-row .row-name')].map((r) => r.textContent.trim());
  assert.ok(names.includes('High water') && names.includes('Midge Cloud'), names.join(' | '));
  assert.ok(names.includes('???'), 'what the map hasn\'t shown yet is a blank');
  rig.press(B.EAST);
  assert.equal(rig.ui.top, pause);
});

test('run scene: a first sighting goes on the quiet line once ever; the high-water warning on the middle line', async () => {
  const { currentHalt } = await import('../src/sim/world.js');
  const rig = runRig({ map: 'salt_marsh', seed: 'sights', config: { invulnerable: true, layers: { storm: false, well: false, secret: false } }, seen: { on: () => [], any: () => new Set(['enemy:fog_wisp']) } });
  const w = rig.scene.world;
  // Play on, answering any level-up with its first card.
  const play = (n) => { for (let k = 0; k < n; k++) { rig.frame(); const h = currentHalt(w); if (h) { rig.ui.closeAll(); rig.scene.recorded.decide(h.kind === 'draft' ? { kind: 'pick', index: 0 } : { kind: 'ok' }); } } };
  play(60 * 20);
  const quiet = rig.quiet.flat();
  // One line once the cloud is on screen (0.9.0: the name and what it is together).
  assert.ok(quiet.some((l) => /^First sighting: Midge Cloud\. /.test(l)), JSON.stringify(rig.quiet));
  assert.ok(!quiet.some((l) => /^First sighting: Fog Wisp/.test(l)), 'met on an earlier run');
  rig.scene.recorded.decide({ kind: 'dev', cmd: 'jump', to: 3 * 60 - 20 });   // just before the first high water's warning
  play(60 * 8);
  assert.ok(rig.loud.flat().includes('High water in 15s: the creeks will flood'), JSON.stringify(rig.loud.slice(-5)));
});
