import test from 'node:test';
import assert from 'node:assert/strict';
import { createInput, clampDeadzone, DEADZONE_MAX, STICK_NAV } from '../src/input/input.js';
import { normalizePad, radialDeadzone, hatToDpad, B, readPads, readPadsInto } from '../src/input/gamepad.js';
import { detectControllerType, promptStyle, glyphFor } from '../src/input/glyphs.js';
import {
  quantizeAxis, dequantizeAxis, makeFrame, frameMove, createFrameRecorder, readFrame, frameCount, BTN_DASH, EMPTY_FRAME,
} from '../src/lib/inputframe.js';

const DS5_ID = 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)';
const XBOX_ID = 'Xbox 360 Controller (XInput STANDARD GAMEPAD)';

function pad({ id = DS5_ID, index = 0, mapping = 'standard', pressed = [], axes = [0, 0, 0, 0] } = {}) {
  const buttons = Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 }));
  return { id, index, mapping, connected: true, buttons, axes };
}
function key(target, type, code, extra = {}) {
  target.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), { code, repeat: false, ...extra }));
}
function setup(pads = [], settings = {}) {
  const target = new EventTarget();
  const box = { pads, t: 10000 };
  const input = createInput({ getGamepads: () => box.pads, target, settings, now: () => box.t });
  return { input, target, box };
}

test('glyphs: controller types from real id strings', () => {
  assert.equal(detectControllerType(DS5_ID), 'playstation');
  assert.equal(detectControllerType('Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)'), 'playstation');
  assert.equal(detectControllerType(XBOX_ID), 'xbox');
  assert.equal(detectControllerType('Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)'), 'xbox');
  assert.equal(detectControllerType('8BitDo SN30 Pro'), 'generic');
  assert.equal(detectControllerType(undefined), 'generic');
});

test('glyphs: prompt style honors the override, then the last device', () => {
  assert.equal(promptStyle('auto', 'gamepad', 'playstation'), 'playstation');
  assert.equal(promptStyle('auto', 'gamepad', 'generic'), 'xbox');
  assert.equal(promptStyle('auto', 'keyboard', 'playstation'), 'keyboard');
  assert.equal(promptStyle('xbox', 'gamepad', 'playstation'), 'xbox', 'Steam Input override');
  assert.equal(glyphFor('playstation', 'confirm'), '✕');
  assert.equal(glyphFor('xbox', 'back'), 'B');
  assert.equal(glyphFor('keyboard', 'nope'), 'nope');
});

test('gamepad: radial deadzone rescales and keeps direction', () => {
  assert.deepEqual(radialDeadzone(0.1, 0.1, 0.2), { x: 0, y: 0 });
  const full = radialDeadzone(1, 0, 0.2);
  assert.ok(Math.abs(full.x - 1) < 1e-12 && full.y === 0);
  const edge = radialDeadzone(0.2001, 0, 0.2);
  assert.ok(edge.x > 0 && edge.x < 0.001, 'just outside the deadzone is nearly zero, no jump');
  const diag = radialDeadzone(0.6, 0.6, 0.2);
  assert.ok(Math.abs(diag.x - diag.y) < 1e-12);
  assert.deepEqual(radialDeadzone(NaN, 0, 0.2), { x: 0, y: 0 });
});

test('gamepad: a Sony pad without the standard mapping uses the DirectInput table and hat axis', () => {
  const raw = { id: 'Wireless Controller (Vendor: 054c Product: 0ce6)', mapping: '', buttons: [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], axes: [0, 0, 0.3, 0, 0, -0.4, 0, 0, 0, -1] };
  const n = normalizePad(raw);
  assert.equal(n.buttons[B.SOUTH], 1, 'raw 1 is Cross');
  assert.equal(n.buttons[B.UP], 1, 'hat -1 is up');
  assert.equal(n.rx, 0.3);
  assert.equal(n.ry, -0.4);
  assert.deepEqual(hatToDpad(1.2857), { up: 0, down: 0, left: 0, right: 0 });
  assert.deepEqual(hatToDpad(0.714), { up: 0, down: 0, left: 1, right: 0 });
  assert.deepEqual(hatToDpad(-0.714), { up: 1, down: 0, left: 0, right: 1 });
  assert.equal(readPads([null, raw, { ...raw, connected: false }]).length, 1);
});

test('input: keyboard movement is normalized on diagonals; the strongest source wins', () => {
  const { input, target, box } = setup();
  key(target, 'keydown', 'KeyD');
  key(target, 'keydown', 'KeyS');
  input.update();
  const m = input.move;
  assert.ok(Math.abs(Math.hypot(m.x, m.y) - 1) < 1e-12);
  assert.ok(m.x > 0 && m.y > 0);
  key(target, 'keyup', 'KeyD');
  key(target, 'keyup', 'KeyS');
  box.pads = [pad({ axes: [-0.5, 0, 0, 0] })];
  input.update();
  assert.ok(input.move.x < 0 && input.move.x > -1, 'half tilt stays analog');
  assert.equal(input.device, 'gamepad');
});

test('input: pressed fires once; held keys do not re-fire; releases are seen', () => {
  const { input, target } = setup();
  key(target, 'keydown', 'Enter');
  input.update();
  assert.equal(input.pressed('confirm'), true);
  input.update();
  assert.equal(input.pressed('confirm'), false);
  assert.equal(input.down('confirm'), true);
  key(target, 'keydown', 'Enter', { repeat: true }); // OS key repeat is ignored
  input.update();
  assert.equal(input.pressed('confirm'), false);
  key(target, 'keyup', 'Enter');
  input.update();
  assert.equal(input.released('confirm'), true);
});

test('input: skip is a 0.5 s hold on L1 and on Tab; it fires exactly once', () => {
  const { input, box } = setup([pad({ pressed: [B.L1] })]);
  let fires = 0;
  for (let i = 0; i < 60; i++) { input.update(16.67); if (input.fired('skip')) fires++; if (i === 20) assert.equal(fires, 0, 'not yet at 350 ms'); }
  assert.equal(fires, 1);
  box.pads = [pad()];
  input.update(16.67);
  assert.equal(input.fired('skip'), false);
  const k = setup();
  key(k.target, 'keydown', 'Tab');
  let kf = 0;
  for (let i = 0; i < 40; i++) { k.input.update(16.67); if (k.input.fired('skip')) kf++; }
  assert.equal(kf, 1);
});

test('input: tuning opens on a 1 s Create (View) hold, or a plain F1 press; it never triggers pause', () => {
  const { input } = setup([pad({ pressed: [B.SELECT] })]);
  let fireFrame = -1;
  let pauses = 0;
  for (let i = 0; i < 90; i++) { input.update(16.67); if (input.fired('tuning')) fireFrame = i; if (input.pressed('pause') || input.fired('pause')) pauses++; }
  assert.ok(fireFrame >= 59 && fireFrame <= 61, `fired at frame ${fireFrame}`);
  assert.equal(pauses, 0);
  const k = setup();
  key(k.target, 'keydown', 'F1');
  k.input.update();
  assert.equal(k.input.fired('tuning'), true);
});

test('input: Options alone pauses immediately', () => {
  const { input } = setup([pad({ pressed: [B.START] })]);
  input.update();
  assert.equal(input.fired('pause'), true);
  assert.equal(input.fired('tuning'), false);
});

test('input: menu navigation auto-repeats after a delay', () => {
  const { input } = setup([pad({ pressed: [B.DOWN] })]);
  const fires = [];
  for (let i = 0; i < 60; i++) { input.update(16.67); if (input.nav('down')) fires.push(i); }
  assert.equal(fires[0], 0, 'first press is immediate');
  assert.ok(fires[1] >= 20 && fires[1] <= 22, `repeat starts after ~350 ms (frame ${fires[1]})`);
  assert.ok(fires.length >= 5);
});

test('input: connect/disconnect events and device switching', () => {
  const { input, box } = setup();
  const events = [];
  input.on('connect', (e) => events.push(['connect', e.type]));
  input.on('disconnect', () => events.push(['disconnect']));
  input.update();
  box.pads = [pad({ id: XBOX_ID })];
  input.update();
  box.pads = [];
  input.update();
  assert.deepEqual(events, [['connect', 'xbox'], ['disconnect']]);
  assert.equal(input.device, 'keyboard');
});

test('input: releaseAll stops a held pad button from leaking into the next screen', () => {
  const { input, box } = setup([pad({ pressed: [B.SOUTH] })]);
  input.update();
  assert.equal(input.pressed('confirm'), true);
  input.releaseAll();
  for (let i = 0; i < 5; i++) { input.update(); assert.equal(input.down('confirm'), false); }
  box.pads = [pad()];
  input.update();
  box.pads = [pad({ pressed: [B.SOUTH] })];
  input.update();
  assert.equal(input.pressed('confirm'), true, 'a fresh press works again');
});

test('input: blur clears held keys; game keys have their browser default prevented', () => {
  const { input, target } = setup();
  const ev = Object.assign(new Event('keydown', { cancelable: true }), { code: 'Space', repeat: false });
  target.dispatchEvent(ev);
  assert.equal(ev.defaultPrevented, true);
  input.update();
  assert.equal(input.down('dash'), true);
  target.dispatchEvent(new Event('blur'));
  input.update();
  assert.equal(input.down('dash'), false);
  input.destroy();
});

test('input: sampleFrame quantizes movement and carries the dash bit', () => {
  const { input, target } = setup();
  key(target, 'keydown', 'KeyD');
  key(target, 'keydown', 'Space');
  input.update();
  const f = input.sampleFrame();
  assert.equal(f.mx, 127);
  assert.equal(f.my, 0);
  assert.equal(f.buttons & BTN_DASH, BTN_DASH);
  input.setSettings({ deadzone: 5, prompts: 'xbox' });
  assert.equal(input.promptStyle, 'xbox');
});

test('input: in the harbor only the dash\'s own buttons dash; ✕, A, and Space are confirm there', () => {
  // ✕ (SOUTH) and Space both confirm and dash in a run; in the harbor they must only confirm.
  const { input, box, target } = setup([pad({ pressed: [B.SOUTH] })]);
  input.update();
  assert.equal(input.sampleFrame().buttons & BTN_DASH, BTN_DASH, 'in a run, ✕ dashes');
  assert.equal(input.sampleFrame({ dashOnly: true }).buttons & BTN_DASH, 0, 'in the harbor, ✕ does not');
  assert.ok(input.fired('confirm'), 'and it confirms');
  box.pads = [pad({ pressed: [B.R1] })];
  input.update();
  assert.equal(input.sampleFrame({ dashOnly: true }).buttons & BTN_DASH, BTN_DASH, 'R1 dashes anywhere');
  box.pads = [];
  input.update();
  key(target, 'keydown', 'Space');
  input.update();
  assert.equal(input.sampleFrame({ dashOnly: true }).buttons & BTN_DASH, 0, 'Space confirms in the harbor');
  key(target, 'keyup', 'Space');
  key(target, 'keydown', 'ShiftLeft');
  input.update();
  assert.equal(input.sampleFrame({ dashOnly: true }).buttons & BTN_DASH, BTN_DASH, 'Shift dashes');
  input.releaseAll();
  assert.equal(input.sampleFrame({ dashOnly: true }).buttons & BTN_DASH, 0, 'released with everything else');
});

test('inputframe: quantize, clamp, and round-trip through the recorder', () => {
  assert.equal(quantizeAxis(1), 127);
  assert.equal(quantizeAxis(-1), -127);
  assert.equal(quantizeAxis(2), 127);
  assert.equal(quantizeAxis(NaN), 0);
  assert.equal(dequantizeAxis(127), 1);
  const rec = createFrameRecorder(2);
  const frames = [makeFrame(0.5, -0.25, 0), makeFrame(-1, 1, BTN_DASH), makeFrame(0, 0, 0), makeFrame(-0.001, 0.999, BTN_DASH)];
  for (const f of frames) rec.push(f);
  const bytes = rec.toBytes();
  assert.equal(frameCount(bytes), 4);
  for (let i = 0; i < frames.length; i++) assert.deepEqual(readFrame(bytes, i), frames[i]);
  assert.deepEqual(readFrame(bytes, 99), EMPTY_FRAME);
  assert.deepEqual(readFrame(bytes, -1), EMPTY_FRAME);
  assert.throws(() => readFrame(bytes, 1.5), /integer tick/);
  const mv = frameMove(makeFrame(Math.SQRT1_2, Math.SQRT1_2));
  assert.ok(Math.hypot(mv.x, mv.y) <= 1 + 1e-12, 'diagonal clamped to unit length');
});

test('input: the d-pad moves, with normalized diagonals', () => {
  const { input } = setup([pad({ pressed: [B.UP, B.RIGHT] })]);
  input.update();
  const m = input.move;
  assert.ok(Math.abs(m.x - Math.SQRT1_2) < 1e-12 && Math.abs(m.y + Math.SQRT1_2) < 1e-12);
});

test('input: with two pads connected, prompts follow the one being used', () => {
  const ds = pad({ id: DS5_ID, index: 0 });
  const xb = pad({ id: XBOX_ID, index: 1 });
  const { input, box } = setup([ds, xb]);
  box.pads = [pad({ id: DS5_ID, index: 0, pressed: [B.SOUTH] }), xb];
  input.update();
  assert.equal(input.controllerType, 'playstation');
  assert.equal(input.promptStyle, 'playstation');
  box.pads = [ds, pad({ id: XBOX_ID, index: 1, axes: [0.9, 0, 0, 0] })];
  input.update();
  assert.equal(input.controllerType, 'xbox');
  box.pads = [ds, xb];
  input.update();
  assert.equal(input.controllerType, 'xbox', 'idle pads do not steal the prompts');
});

test('input: stick navigation needs a firm push', () => {
  const { input, box } = setup([pad({ axes: [0, STICK_NAV - 0.05, 0, 0] })]);
  input.update();
  assert.equal(input.nav('down'), false);
  box.pads = [pad({ axes: [0, STICK_NAV + 0.05, 0, 0] })];
  input.update();
  assert.equal(input.nav('down'), true);
});

test('input: analog stick movement reaches the sim frame quantized', () => {
  const { input } = setup([pad({ axes: [0.6, -0.8, 0, 0] })]);
  input.update();
  const f = input.sampleFrame();
  const m = input.move;
  assert.equal(f.mx, Math.round(m.x * 127));
  assert.equal(f.my, Math.round(m.y * 127));
  assert.ok(f.mx > 0 && f.my < 0);
});

test('input: releaseAll also stops held directions from racing through a menu', () => {
  const { input, box } = setup([pad({ pressed: [B.DOWN] })]);
  for (let i = 0; i < 30; i++) input.update(16.67);
  input.releaseAll();
  let fires = 0;
  for (let i = 0; i < 30; i++) { input.update(16.67); if (input.nav('down')) fires++; }
  assert.equal(fires, 0, 'held d-pad ignored until released');
  box.pads = [pad()];
  input.update();
  box.pads = [pad({ pressed: [B.DOWN] })];
  input.update();
  assert.equal(input.nav('down'), true, 'a fresh press navigates');
});

test('input: typing in a text box is not a game input and keeps its default', () => {
  const { input, target } = setup();
  const ev = Object.assign(new Event('keydown', { cancelable: true }), { code: 'Space', repeat: false });
  Object.defineProperty(ev, 'target', { value: { tagName: 'INPUT' } });
  target.dispatchEvent(ev);
  input.update();
  assert.equal(ev.defaultPrevented, false);
  assert.equal(input.down('dash'), false);
});

test('input: a jittering mouse does not flip controller prompts; a click does', () => {
  const { input, target, box } = setup([pad({ pressed: [B.SOUTH] })]);
  input.update();
  assert.equal(input.device, 'gamepad');
  const mv = (x, y) => target.dispatchEvent(Object.assign(new Event('mousemove'), { clientX: x, clientY: y }));
  mv(100, 100); mv(103, 101); mv(101, 104);
  assert.equal(input.device, 'gamepad', 'a few pixels of drift');
  mv(200, 200);
  assert.equal(input.device, 'gamepad', 'right after pad use');
  box.t += 2000;
  mv(300, 300);
  assert.equal(input.device, 'gamepad', 'the first move after a pause starts a new count');
  box.t += 16; mv(330, 310);
  assert.equal(input.device, 'mouse', 'a real, continuous mouse move after the pad went quiet');
  input.update();
  target.dispatchEvent(new Event('mousedown'));
  assert.equal(input.device, 'mouse');
});

test('input: slow desk bumps never add up to a device switch', () => {
  const { input, target, box } = setup([pad({ pressed: [B.SOUTH] })]);
  input.update();
  box.pads = [pad({})];
  input.update();
  assert.equal(input.device, 'gamepad');
  const mv = (x, y) => target.dispatchEvent(Object.assign(new Event('mousemove'), { clientX: x, clientY: y }));
  for (let k = 0; k < 30; k++) { box.t += 1000; mv(100 + (k % 2) * 12, 100); }
  assert.equal(input.device, 'gamepad', '30 bumps of 12 px, a second apart, stay separate');
});

test('input: deadzone is clamped the same way everywhere', () => {
  assert.equal(clampDeadzone(5), DEADZONE_MAX);
  assert.equal(clampDeadzone(-1), 0);
  assert.equal(clampDeadzone('abc'), 0.2);
  const { input } = setup([pad({ axes: [1, 0, 0, 0] })], { deadzone: 1 });
  input.update();
  assert.equal(input.deadzone, DEADZONE_MAX);
  assert.ok(input.move.x > 0.99, 'full tilt still moves at full speed');
  input.setSettings({ deadzone: 'x' });
  assert.equal(input.deadzone, DEADZONE_MAX, 'garbage keeps the previous value');
});

test('input: destroy() detaches every listener', () => {
  const { input, target } = setup();
  input.destroy();
  key(target, 'keydown', 'KeyD');
  input.update();
  assert.equal(input.move.x, 0);
  assert.throws(() => input.on('nope', () => {}));
});

test('gamepad: readPadsInto reuses one object per pad and notices a swapped controller', () => {
  const cache = new Map();
  const out = [];
  readPadsInto([pad({ id: DS5_ID, index: 0 })], out, cache);
  const first = out[0];
  readPadsInto([pad({ id: DS5_ID, index: 0, pressed: [B.SOUTH] })], out, cache);
  assert.equal(out[0], first, 'same object, no per-frame garbage');
  assert.equal(out[0].buttons[B.SOUTH], 1);
  readPadsInto([pad({ id: XBOX_ID, index: 0 })], out, cache);
  assert.equal(out[0].type, 'xbox', 'a different pad in the same slot is re-detected');
  assert.equal(out[0].buttons[B.SOUTH], 0, 'buttons cleared between frames');
});

// ------------------------------------------------------------------ 0.9.0 (W7)

import { rebind, normalizeBindings, savedBindings, setDashOnConfirm, dashOnConfirm, buttonsText, bindable, defaultBindings, REMAPPABLE, keyName, padButtonName } from '../src/input/bindings.js';

test('input: a key pressed and let go between two polls still counts once (V5: short taps were lost)', () => {
  const { input, target } = setup();
  input.update(16);
  key(target, 'keydown', 'KeyR');
  key(target, 'keyup', 'KeyR');
  input.update(16);
  assert.equal(input.fired('reroll'), true, 'the tap is a press');
  input.update(16);
  assert.equal(input.fired('reroll'), false, 'once');
  // A movement tap moves the menu once too.
  key(target, 'keydown', 'ArrowDown');
  key(target, 'keyup', 'ArrowDown');
  input.update(16);
  assert.equal(input.nav('down'), true);
  input.update(16);
  assert.equal(input.nav('down'), false);
});

test('bindings: a button given to an action swaps with the action that had it; Dash and Confirm may share; Confirm and Back keep one', () => {
  const b = defaultBindings();
  // Reroll to △ (Banish's): Banish takes □.
  const r = rebind(b, 'pad', 'reroll', B.NORTH);
  assert.deepEqual([r.pad.reroll, r.pad.banish], [[B.NORTH], [B.WEST]]);
  assert.deepEqual(b.pad.reroll, [B.WEST], 'the bindings passed in never change');
  // Dash to L2 (the glossary's): the glossary takes R1, and Dash keeps ✕ for runs.
  const d = rebind(b, 'pad', 'dash', B.L2);
  assert.deepEqual([d.pad.dash, d.pad.glossary], [[B.L2, B.SOUTH], [B.R1]]);
  // Confirm to ✕ is a no-op; Back to ✕ swaps them, and both keep a button.
  const c = rebind(b, 'pad', 'back', B.SOUTH);
  assert.deepEqual([c.pad.back, c.pad.confirm], [[B.SOUTH], [B.EAST]]);
  // The d-pad and Home can't be bound; nor can movement keys.
  assert.equal(rebind(b, 'pad', 'reroll', B.UP), b);
  assert.equal(bindable('keys', 'KeyW'), false);
  assert.equal(bindable('keys', 'KeyQ'), true);
  // Dash off ✕ (V4: "✕ is both confirm and dash, and that can't be changed"), and back on.
  const off = setDashOnConfirm(b, 'pad', false);
  assert.deepEqual(off.pad.dash, [B.R1]);
  assert.equal(dashOnConfirm(off, 'pad'), false);
  assert.equal(dashOnConfirm(setDashOnConfirm(off, 'pad', true), 'pad'), true);
  // Saved: only what differs; read back the same; a broken save falls back per action.
  const saved = { keys: savedBindings(r, 'keys'), pad: savedBindings(r, 'pad') };
  assert.deepEqual(saved.keys, {});
  assert.deepEqual(Object.keys(saved.pad).sort(), ['banish', 'reroll']);
  assert.deepEqual(normalizeBindings(saved).pad.reroll, [B.NORTH]);
  assert.deepEqual(normalizeBindings({ pad: { confirm: [], back: 'x', reroll: [99, B.UP] } }).pad.confirm, [B.SOUTH], 'Confirm never left without a button');
  assert.deepEqual(normalizeBindings({ pad: { reroll: [99, B.UP] } }).pad.reroll, []);
  assert.equal(REMAPPABLE.includes('tuning'), false, 'the tuning panel stays put');
  assert.equal(buttonsText(b, 'pad', 'dash', 'playstation'), 'R1, ✕');
  assert.equal(buttonsText(b, 'keys', 'pause', 'keyboard'), 'Esc, P');
  assert.deepEqual([keyName('KeyQ'), keyName('Digit4'), keyName('ShiftLeft'), padButtonName('xbox', B.L2)], ['Q', '4', 'Shift', 'LT']);
});

test('input: remapped buttons act, the prompts name them, and Dash can come off ✕ in a run and in the harbor', () => {
  const p = pad({});
  const { input, box } = setup([p], { pad: { reroll: [B.NORTH], banish: [B.WEST] } });
  input.update(16);
  p.buttons[B.NORTH] = { pressed: true, value: 1 };
  input.update(16);
  assert.equal(input.fired('reroll'), true);
  assert.equal(input.fired('banish'), false);
  assert.equal(input.glyph('reroll', 'playstation'), '△');
  assert.equal(input.glyph('skip', 'xbox'), 'Hold LB');
  assert.equal(input.glyph('dash', 'playstation'), 'R1');
  assert.equal(input.glyph('glossary', 'keyboard'), 'G');
  p.buttons[B.NORTH] = { pressed: false, value: 0 };
  // Dash off ✕: ✕ no longer dashes in a run.
  input.setSettings({ pad: { dash: [B.R1] } });
  p.buttons[B.SOUTH] = { pressed: true, value: 1 };
  input.update(16);
  assert.equal(input.sampleFrame().buttons, 0, '✕ confirms only');
  assert.equal(input.fired('confirm'), true);
  box.pads = [p];
});

test('input: Settings waits for the next button (captureNext), and nothing else acts on that press; 5s with none gives null', () => {
  const p = pad({});
  const { input, box, target } = setup([p]);
  input.update(16);
  const got = [];
  input.captureNext('pad', (c) => got.push(c));
  p.buttons[B.L2] = { pressed: true, value: 1 };
  input.update(16);
  assert.deepEqual(got, [B.L2]);
  assert.equal(input.fired('glossary'), false, 'the press that was heard does nothing else');
  input.releaseAll();
  input.captureNext('keys', (c) => got.push(c));
  key(target, 'keydown', 'KeyQ');
  assert.deepEqual(got, [B.L2, 'KeyQ']);
  input.captureNext('pad', (c) => got.push(c));
  box.t += 6000;
  input.update(16);
  assert.deepEqual(got, [B.L2, 'KeyQ', null], 'nothing pressed in 5s');
  assert.equal(input.capturing, null);
});
