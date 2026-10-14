// The screen stack's input routing (ui/screens.js), with a stand-in document and input: the
// input delay a screen asks for, released buttons on open and close, one Esc doing one thing,
// closing a screen that isn't on top, and the menu sounds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUi } from '../src/ui/screens.js';

function fakeEl() {
  const classes = new Set();
  const el = {
    children: [], style: { setProperty() {} }, className: '',
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) },
    appendChild(c) { el.children.push(c); c.parent = el; return c; },
    remove() { if (el.parent) el.parent.children = el.parent.children.filter((x) => x !== el); },
    querySelectorAll: () => [],
  };
  return el;
}
const doc = { createElement: () => fakeEl() };

function fakeInput() {
  const fired = new Set(), nav = new Set();
  return {
    promptStyle: 'keyboard', released: 0,
    fired: (a) => fired.has(a), nav: (d) => nav.has(d), down: () => false, heldMs: () => 0,
    releaseAll() { this.released++; },
    press(...acts) { fired.clear(); nav.clear(); for (const a of acts) (['up', 'down', 'left', 'right'].includes(a) ? nav : fired).add(a); },
  };
}

function fakeScreen(log, name, extra = {}) {
  let focus = 0;
  return {
    el: fakeEl(),
    scope: { refresh() {}, destroy() { log.push(`${name}:destroy`); }, move(d) { log.push(`${name}:move ${d}`); focus++; return d !== 'up'; }, press() { log.push(`${name}:press`); return true; }, get focus() { return focus; } },
    onBack: () => log.push(`${name}:back`),
    onAction: (a) => { log.push(`${name}:${a}`); return false; },
    onClose: () => log.push(`${name}:close`),
    ...extra,
  };
}

test('ui stack: a screen\'s input delay swallows presses until it has passed', () => {
  const log = [], sounds = [], input = fakeInput();
  const ui = createUi({ root: fakeEl(), input, doc, sound: (s) => sounds.push(s) });
  ui.push(fakeScreen(log, 'cards', { ignoreMs: 300 }));
  input.press('confirm');
  ui.update(100); ui.update(100); ui.update(99);
  assert.deepEqual(log, [], 'nothing reaches the cards for the first 300 ms');
  ui.update(16);
  ui.update(16);
  assert.deepEqual(log, ['cards:confirm', 'cards:press']);
  assert.deepEqual(sounds, ['ui_confirm']);
});

test('ui stack: opening and closing release held buttons; closing reveals the one under it', () => {
  const log = [], input = fakeInput();
  const ui = createUi({ root: fakeEl(), input, doc });
  const a = ui.push(fakeScreen(log, 'a'));
  const b = ui.push(fakeScreen(log, 'b'));
  assert.equal(input.released, 2);
  assert.ok(a.el.classList.contains('under'), 'the lower screen is hidden');
  ui.close(a);
  assert.equal(ui.top, b, 'closing a screen that is not on top leaves the top alone');
  assert.deepEqual(log, ['a:destroy', 'a:close']);
  ui.close();
  assert.equal(ui.open, false);
  assert.equal(input.released, 4);
  ui.close(); // nothing open: nothing happens
  assert.throws(() => ui.push({}), /needs a screen/);
});

test('ui stack: one Esc (back and pause together) does one thing; menu sounds follow what happened', () => {
  const log = [], sounds = [], input = fakeInput();
  const ui = createUi({ root: fakeEl(), input, doc, sound: (s) => sounds.push(s) });
  ui.push(fakeScreen(log, 'rune'));
  input.press('back', 'pause');
  ui.update(16);
  assert.deepEqual(log, ['rune:back'], 'back only; the pause half of the same key is ignored');
  input.press('pause');
  ui.update(16);
  assert.deepEqual(log.at(-1), 'rune:pause', 'a pause button on its own still reaches the screen');
  log.length = 0; sounds.length = 0;
  input.press('down'); ui.update(16);
  input.press('up'); ui.update(16);  // the fake scope can't move up
  assert.deepEqual(sounds, ['ui_move'], 'a move that went nowhere is silent');
  input.press('right');
  const s = ui.top;
  s.onNav = () => true; // a screen that handles left/right itself (a settings slider)
  ui.update(16);
  assert.deepEqual(sounds, ['ui_move'], 'a handled direction is the screen\'s own business');
  input.press('reroll');
  ui.update(16);
  assert.equal(log.at(-1), 'rune:reroll');
});
