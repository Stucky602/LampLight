// The pause wiring main.js uses, run with the real input module and the real loop driver.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createInput } from '../src/input/input.js';
import { B } from '../src/input/gamepad.js';
import { createLoop } from '../src/app/loop.js';
import { wirePauses } from '../src/app/pauses.js';

const DS5_ID = 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)';
function pad({ pressed = [], index = 0 } = {}) {
  const buttons = Array.from({ length: 18 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 }));
  return { id: DS5_ID, index, mapping: 'standard', connected: true, buttons, axes: [0, 0, 0, 0] };
}
function rig() {
  const win = new EventTarget();   // the window: key, mouse, focus, and blur events
  const box = { pads: [], t: 10000 };
  const input = createInput({ getGamepads: () => box.pads, target: win, now: () => box.t });
  const loop = createLoop({ step: () => {}, render: () => {}, now: () => box.t, raf: () => 1, cancelRaf: () => {} });
  const events = [];
  input.on('device', (d) => events.push(`device:${d}`));
  input.on('disconnect', () => events.push('disconnect'));
  const off = wirePauses({ loop, input, win });
  const key = (code) => win.dispatchEvent(Object.assign(new Event('keydown'), { code, repeat: false }));
  return { win, box, input, loop, events, off, key };
}
function usePad(r) {
  r.box.pads = [pad({ pressed: [B.SOUTH] })];
  r.input.update();
  r.box.pads = [pad()];
  r.input.update();
  assert.equal(r.input.device, 'gamepad');
}

test('pauses: the pad in use dying mid-run pauses the game and it stays paused', () => {
  const r = rig();
  usePad(r);
  r.events.length = 0;
  r.box.pads = [];
  r.input.update();
  assert.deepEqual(r.events, ['disconnect'], 'no device event from the fallback');
  assert.equal(r.loop.isPaused(), true);
  assert.deepEqual(r.loop.pauseReasons(), ['controller']);
  assert.equal(r.input.promptStyle, 'keyboard', 'prompts still fall back to keyboard');
  r.input.update();
  r.input.update();
  assert.equal(r.loop.isPaused(), true, 'still paused a few frames later');
});

test('pauses: carrying on with the keyboard or mouse resumes; so does plugging a pad back in', () => {
  const a = rig();
  usePad(a);
  a.box.pads = [];
  a.input.update();
  a.key('KeyW');
  assert.equal(a.loop.isPaused(), false, 'a real key press after the unplug resumes');
  assert.equal(a.events.at(-1), 'device:keyboard');

  const b = rig();
  usePad(b);
  b.box.pads = [];
  b.input.update();
  const mv = (x, y) => b.win.dispatchEvent(Object.assign(new Event('mousemove'), { clientX: x, clientY: y }));
  b.box.t += 2000;
  mv(100, 100); b.box.t += 16; mv(140, 120);
  assert.equal(b.loop.isPaused(), false, 'a real mouse move resumes');

  const c = rig();
  usePad(c);
  c.box.pads = [];
  c.input.update();
  c.box.pads = [pad()];
  c.input.update();
  assert.equal(c.loop.isPaused(), false, 'the pad reconnecting resumes');
});

test('pauses: the pad in use dying pauses even with a spare pad plugged in; picking up the spare resumes', () => {
  const r = rig();
  r.box.pads = [pad({ index: 0, pressed: [B.SOUTH] }), pad({ index: 1 })];
  r.input.update();
  r.box.pads = [pad({ index: 0 }), pad({ index: 1 })];
  r.input.update();
  assert.equal(r.input.activePad, 0);
  r.box.pads = [pad({ index: 1 })];
  r.input.update();
  assert.deepEqual(r.loop.pauseReasons(), ['controller'], 'the spare pad does not hide the loss');
  r.input.update();
  assert.equal(r.loop.isPaused(), true);
  r.box.pads = [pad({ index: 1, pressed: [B.SOUTH] })];
  r.input.update();
  assert.equal(r.input.activePad, 1);
  assert.equal(r.loop.isPaused(), false, 'using the spare pad resumes');
});

test('pauses: pulling out the idle pad while playing on the other one does not pause', () => {
  const r = rig();
  r.box.pads = [pad({ index: 0 }), pad({ index: 1, pressed: [B.SOUTH] })];
  r.input.update();
  r.box.pads = [pad({ index: 1 })];
  r.input.update();
  assert.equal(r.loop.isPaused(), false);
});

test('pauses: pulling out a pad nobody was using does not pause a keyboard player', () => {
  const r = rig();
  r.box.pads = [pad()];
  r.input.update();
  r.key('KeyW');
  assert.equal(r.input.device, 'keyboard');
  r.box.pads = [];
  r.input.update();
  assert.equal(r.loop.isPaused(), false);
});

test('pauses: focus loss pauses and focus resumes; unwiring removes every listener', () => {
  const r = rig();
  r.win.dispatchEvent(new Event('blur'));
  assert.deepEqual(r.loop.pauseReasons(), ['blur']);
  r.win.dispatchEvent(new Event('focus'));
  assert.equal(r.loop.isPaused(), false);
  r.off();
  r.win.dispatchEvent(new Event('blur'));
  assert.equal(r.loop.isPaused(), false, 'no longer wired');
  usePad(r);
  r.box.pads = [];
  r.input.update();
  assert.equal(r.loop.isPaused(), false, 'no longer wired to input either');
});
