// The screens sweep's fixes (work/sweep/S3b.md, batch X6), and the rules they keep:
// - giving B to Confirm (the A/B swap) swaps Confirm and Back, so the pad always has a Back (F10);
// - a movement key held through a screen keeps walking after it (F5);
// - the window's close question pauses under its own reason, so "Stay" leaves the pause menu's (F7);
// - no low-health pulse while the run is stopped (F14);
// - the keyboard's hint names a key that pauses, and Esc pauses where Back does nothing (F6);
// - the save code's paste box gives the keyboard back: Esc, Up and Down, Enter (F11);
// - every panel is a column whose list gives way (F13's shared rule; ui.css).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakeDocument } from './helpers/fakedom.js';
import { createInput } from '../src/input/input.js';
import { B } from '../src/input/gamepad.js';
import { rebind, rebindRefusal, defaultBindings, REMAPPABLE, bindable } from '../src/input/bindings.js';
import { createLoop } from '../src/app/loop.js';
import { wireCloseQuestion, CLOSE_REASON } from '../src/app/closequestion.js';
import { createRumble, PULSE_MS } from '../src/render/rumble.js';
import { RUMBLE } from '../src/data/sfx.js';
import { createEventBuffer } from '../src/sim/events.js';
import { createUi } from '../src/ui/screens.js';
import { levelUpScreen, bellPickScreen, relicScreen, saveCodeScreen, chestScreen } from '../src/ui/menus.js';
import { glossaryScreen } from '../src/ui/glossary.js';

const FRAME = 1000 / 60;
const keyEv = (target, type, code) => target.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), { code, repeat: false }));

// ---------------------------------------------------------------- F10

test('X6 F10: B given to Confirm swaps Confirm and Back (A is Back), Dash stays on Confirm; the keyboard the same', () => {
  const b = defaultBindings();
  const s = rebind(b, 'pad', 'confirm', B.EAST);
  assert.deepEqual(s.pad.confirm, [B.EAST]);
  assert.deepEqual(s.pad.back, [B.SOUTH], 'A is Back now: the pad still has a way back');
  assert.deepEqual(s.pad.dash, [B.R1, B.EAST], 'Dash on Confirm stays on: it follows Confirm to B, and leaves A (Back)');
  // And the reverse, from either side, ends the same.
  assert.deepEqual(rebind(b, 'pad', 'back', B.SOUTH).pad, s.pad);
  // And back again to the defaults.
  const again = rebind(s, 'pad', 'confirm', B.SOUTH);
  assert.deepEqual([again.pad.confirm, again.pad.back], [[B.SOUTH], [B.EAST]]);
  // The keyboard: Enter given to Back. Esc comes to Confirm and leaves Pause, which keeps P.
  const k = rebind(b, 'keys', 'back', 'Enter');
  assert.equal(k.keys.back[0], 'Enter');
  assert.ok(!k.keys.confirm.some((c) => k.keys.back.includes(c)), 'Confirm and Back share nothing');
  assert.ok(k.keys.pause.includes('KeyP') && !k.keys.pause.some((c) => k.keys.confirm.includes(c)), 'Pause keeps P and nothing of Confirm\'s');
});

test('X6 F10: no rebind from the defaults or from the A/B swap ever leaves Confirm and Back sharing a button, or either without one', () => {
  const keys = ['Enter', 'NumpadEnter', 'Space', 'Escape', 'Backspace', 'ShiftLeft', 'KeyR', 'KeyB', 'Tab', 'KeyP', 'KeyG', 'KeyQ', 'KeyE'];
  const pads = Array.from({ length: 18 }, (_, i) => i).filter((i) => bindable('pad', i));
  const starts = [defaultBindings(), rebind(defaultBindings(), 'pad', 'confirm', B.EAST), rebind(defaultBindings(), 'keys', 'back', 'Enter')];
  let n = 0;
  for (const s0 of starts) {
    for (const [device, codes] of [['pad', pads], ['keys', keys]]) {
      for (const a of REMAPPABLE) for (const c of codes) {
        // Two steps deep: every change, then every change after it on the same device.
        const s1 = rebind(s0, device, a, c);
        for (const a2 of ['confirm', 'back']) for (const c2 of codes) {
          const s2 = rebind(s1, device, a2, c2);
          for (const x of [s1, s2]) {
            const m = x[device];
            assert.ok(m.confirm.length && m.back.length, `${device} ${a}=${c}: Confirm and Back each keep a button`);
            assert.ok(!m.confirm.some((q) => m.back.includes(q)), `${device} ${a}=${c} then ${a2}=${c2}: Confirm ${m.confirm} and Back ${m.back} share a button`);
            n++;
          }
        }
      }
    }
  }
  assert.ok(n > 1000);
  // What the screen says when a change does nothing.
  assert.match(rebindRefusal(defaultBindings(), 'keys', 'reroll', 'KeyW'), /can't be given/);
  assert.equal(rebindRefusal(defaultBindings(), 'pad', 'confirm', B.EAST), null, 'the A/B swap is allowed');
});

test('X6 F10: the glossary has a Back button a pad can reach and press', () => {
  installFakeDocument();
  const ctx = { ui: { glyph: () => document.createElement('span') } };
  let backs = 0;
  const data = { glossary: [{ id: 'a', name: 'Alpha', kind: 'basic', desc: 'x' }] };
  const s = glossaryScreen(ctx, { data, kinds: [['basic', 'Basics']], onBack: () => backs++ });
  const btn = s.el.querySelector('[data-focus="back"]');
  assert.ok(btn, 'a Back button');
  btn.click();
  assert.equal(backs, 1);
});

// ---------------------------------------------------------------- F5

test('X6 F5: a movement key held through a screen opening and closing keeps walking; other keys wait for a let-go', () => {
  const target = new EventTarget();
  const input = createInput({ getGamepads: () => [], target, now: () => 1000 });
  keyEv(target, 'keydown', 'KeyA');
  keyEv(target, 'keydown', 'KeyR');
  input.update(FRAME);
  assert.equal(input.move.x, -1, 'walking left');
  input.releaseAll();   // a level-up opens
  for (let i = 0; i < 30; i++) { input.update(FRAME); assert.equal(input.nav('left'), false, 'the held key never moves the menu'); }
  assert.equal(input.fired('reroll'), false);
  input.releaseAll();   // the card is picked: the screen closes, A still held
  input.update(FRAME);
  assert.equal(input.move.x, -1, 'still walking without pressing A again');
  assert.equal(input.down('reroll'), false, 'R still waits for a let-go');
  keyEv(target, 'keyup', 'KeyA');
  input.update(FRAME);
  assert.equal(input.move.x, 0);
  // The arrows the same.
  keyEv(target, 'keydown', 'ArrowLeft');
  input.update(FRAME);
  input.releaseAll();
  input.update(FRAME);
  assert.equal(input.move.x, -1);
});

// ---------------------------------------------------------------- F7

test('X6 F7: the window\'s X while paused, answered Stay, leaves the run paused under the pause menu', () => {
  const loop = createLoop({ step() {}, render() {}, raf: () => 0, cancelRaf() {} });
  const stack = [];
  const ui = { has: (f) => stack.some(f), push: (s) => stack.push(s), close: (s) => { const i = stack.indexOf(s); if (i >= 0) stack.splice(i, 1); } };
  let ask = null;
  const answers = [];
  wireCloseQuestion({ native: { onCloseAsked: (f) => { ask = f; }, closeAck() {}, closeAnswer: (v) => answers.push(v) }, ui, loop, inRunNow: () => true, saveRun: async () => {}, keepAll: async () => true, makeScreen: (o) => ({ ...o }) });
  loop.pause('menu'); stack.push({ isPause: true });   // the pause menu (app/scenes/run.js openPause)
  ask('run');
  assert.equal(CLOSE_REASON, 'close');
  assert.deepEqual(loop.pauseReasons().sort(), ['close', 'menu']);
  stack.at(-1).buttons.find((b) => b[0] === 'Stay')[2]();
  assert.deepEqual(answers, [false]);
  assert.equal(stack.length, 1, 'the pause menu is still up');
  assert.deepEqual(loop.pauseReasons(), ['menu'], 'and the run still waits under it');
  // The run scene's resumeAll knows the reason (a run left from the question resumes everything).
  assert.match(readFileSync(new URL('../src/app/scenes/run.js', import.meta.url), 'utf8'), /function resumeAll\(\) \{ for \(const r of \[[^\]]*CLOSE_REASON\]/);
});

// ---------------------------------------------------------------- F14

test('X6 F14: no low-health pulse while the run is stopped; it comes back when the run goes on', () => {
  let t = 0;
  const played = [];
  const pad = { index: 0, vibrationActuator: { playEffect: (type, fx) => { played.push(fx); return Promise.resolve(); } } };
  const r = createRumble({ table: RUMBLE, settings: () => ({ rumble: true, rumbleStrength: 0.5 }), getGamepads: () => [pad], activePad: () => 0, device: () => 'gamepad', now: () => t });
  const none = createEventBuffer(8, 2);
  const world = { stats: { maxHp: 100 }, player: { hp: 10 }, over: null };
  for (let i = 0; i < 10; i++) { t += PULSE_MS; assert.equal(r.events(none, world, { stopped: true }), false, 'paused: still'); }
  assert.equal(played.length, 0);
  t += PULSE_MS;
  assert.equal(r.events(none, world, { stopped: false }), true, 'the run goes on: the pulse');
  // The run scene passes it.
  assert.match(readFileSync(new URL('../src/app/scenes/run.js', import.meta.url), 'utf8'), /rumble\?\.events\(ev, world, \{ stopped: !!ui\.open \|\| !!deps\.loop\.isPaused\?\.\(\) \}\)/);
});

// ---------------------------------------------------------------- F6

function uiRig() {
  installFakeDocument();
  const target = new EventTarget();
  const input = createInput({ getGamepads: () => [], target, now: () => 1000 });
  const root = document.createElement('div');
  document.body.appendChild(root);
  const ui = createUi({ root, input, doc: document, sound: () => {} });
  ui.layout({ x: 0, y: 0, scale: 1 }, 640, 360);
  let pauses = 0;
  const ctx = { ui, icon: () => document.createElement('span'), sound: () => {}, pause: () => { pauses++; } };
  const frame = (n = 1) => { for (let i = 0; i < n; i++) { input.update(FRAME); ui.update(FRAME); } };
  const tap = (code) => { keyEv(target, 'keydown', code); frame(); keyEv(target, 'keyup', code); frame(); };
  return { ui, input, ctx, frame, tap, pauses: () => pauses };
}
const card = (t) => ({ kind: 'weapon', title: t, sub: 'New weapon', desc: '+1 Damage', tags: [] });

test('X6 F6: the keyboard\'s hint names P for Pause, and Esc pauses the level-up, the Reliquary, and the Fog Bell pick', () => {
  const r = uiRig();
  assert.equal(r.input.glyph('pause', 'keyboard'), 'P', 'Esc is Back\'s too: the hint names the key that only pauses');
  assert.equal(r.input.glyph('back', 'keyboard'), 'Esc');
  const lv = levelUpScreen(r.ctx, { level: 2, cards: [card('A'), card('B'), card('C')], charges: { reroll: 1, banish: 1, skip: 1 }, onPick() {}, onReroll() {}, onBanish() {}, onSkip() {} });
  r.ui.push(lv);
  r.frame(30);
  assert.match(lv.el.textContent, /P Pause/);
  r.tap('Escape');
  assert.equal(r.pauses(), 1, 'Esc on the level-up pauses');
  // In banish mode Esc cancels the banish and does not also pause.
  lv.onAction('banish');
  assert.ok(lv.el.classList.contains('banishing'));
  r.tap('Escape');
  assert.equal(lv.el.classList.contains('banishing'), false, 'the banish is cancelled');
  assert.equal(r.pauses(), 1, 'and nothing else');
  r.ui.close(lv);
  const rel = relicScreen(r.ctx, { vault: false, relics: [{ name: 'R', desc: 'd', icon: 'x', tierName: 'Rare' }], onPick() {} });
  r.ui.push(rel); r.frame(30); r.tap('Escape');
  assert.equal(r.pauses(), 2, 'the Reliquary');
  r.ui.close(rel);
  const bell = bellPickScreen(r.ctx, { levels: 2, options: [{ index: 0, kind: 'weapon', name: 'W', icon: null, sub: 'Lv 1 to 3', desc: 'd' }], onPick() {} });
  r.ui.push(bell); r.frame(30); r.tap('Escape');
  assert.equal(r.pauses(), 3, 'the Fog Bell pick');
  r.ui.close(bell);
  // A screen whose Back does something still backs, and doesn't also pause.
  let done = 0;
  const ch = chestScreen(r.ctx, { boss: false, items: [card('A')], pool: ['x'], onDone: () => { done++; } });
  r.ui.push(ch); r.frame(30); r.tap('Escape'); r.tap('Escape');
  assert.equal(done, 1);
  assert.equal(r.pauses(), 3);
});

// ---------------------------------------------------------------- F11

test('X6 F11: the paste box gives the keyboard back: Esc lets go of the box, Up and Down move the focus, Enter presses', () => {
  const r = uiRig();
  let pasted = null, backs = 0;
  const s = saveCodeScreen(r.ctx, { onExport() {}, onImport() {}, onPaste() {}, onPasted: (t) => { pasted = t; }, onBack: () => { backs++; } });
  r.ui.push(s);
  // A column of buttons, laid out top to bottom (the fake document has no layout of its own).
  const keys = ['export', 'paste', 'import', 'usepaste', 'back'];
  keys.forEach((k, i) => { s.el.querySelector(`[data-focus="${k}"]`).rect = { left: 0, top: i * 20, width: 100, height: 16 }; });
  s.showPasteBox();
  const box = s.pasteBox;
  let blurs = 0;
  box.blur = () => { blurs++; };
  const inBox = (code) => { const ev = { type: 'keydown', code, preventDefault() { this.prevented = true; } }; box.dispatchEvent(ev); return ev; };
  assert.equal(s.scope.current.dataset.focus, 'usepaste');
  const e1 = inBox('Escape');
  assert.equal(blurs, 1, 'Esc lets go of the box');
  assert.ok(e1.prevented);
  assert.equal(backs, 0, 'the first Esc only lets go');
  inBox('ArrowUp');
  assert.equal(s.scope.current.dataset.focus, 'import', 'Up moves the focus');
  inBox('ArrowDown');
  assert.equal(s.scope.current.dataset.focus, 'usepaste');
  box.value = 'CODE';
  inBox('Enter');
  assert.equal(pasted, 'CODE', 'Enter presses Use pasted code');
  const other = inBox('KeyV');
  assert.equal(other.prevented, undefined, 'typing is left alone');
});

// ---------------------------------------------------------------- F13 (the shared rule)

test('X6 F13: a panel is a column: its title and hint row never shrink, a banded list or a .give part takes what is left', () => {
  const css = readFileSync(new URL('../src/ui/ui.css', import.meta.url), 'utf8');
  const rule = (sel) => { const m = new RegExp(`(^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css); return m ? m[2] : null; };
  assert.match(rule('.panel') || '', /display: flex; flex-direction: column/);
  assert.match(rule('.panel > *') || '', /flex: none/);
  assert.match(rule('.panel > .give, .panel > .banded') || '', /flex: 1 1 auto; min-height: 0/);
});
