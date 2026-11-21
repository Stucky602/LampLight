// Button bindings and remapping (0.9.0, W7; V4: "No button remapping, for pad or keyboard. ✕ is
// both confirm and dash, and that can't be changed"). Pure; tested.
//
// Bindings are { keys: { action: [KeyboardEvent.code] }, pad: { action: [standard button index] } }.
// Settings keep the player's own (settings.controls.keys / .pad); anything missing or broken falls
// back to the defaults, and Confirm and Back always keep a button (every screen needs them).
//
// One button may serve two actions only where the game tells them apart by where you are: Dash and
// Confirm (✕ dashes in a run, confirms in a menu and the harbor), and on the keyboard Back and Pause
// (Esc). Any other clash swaps: the button moves to the new action, and the action that had it takes
// the new action's old button, so nothing is ever left without one by accident.

import { B } from './gamepad.js';

export const DEFAULT_KEYS = Object.freeze({
  dash: Object.freeze(['Space', 'ShiftLeft', 'ShiftRight']),
  confirm: Object.freeze(['Enter', 'NumpadEnter', 'Space']),
  back: Object.freeze(['Escape', 'Backspace']),
  reroll: Object.freeze(['KeyR']),
  banish: Object.freeze(['KeyB']),
  skip: Object.freeze(['Tab']),
  pause: Object.freeze(['Escape', 'KeyP']),
  glossary: Object.freeze(['KeyG']),
  tuning: Object.freeze(['F1']),
  debug: Object.freeze(['F3']),
});

export const DEFAULT_PAD = Object.freeze({
  dash: Object.freeze([B.R1, B.SOUTH]),
  confirm: Object.freeze([B.SOUTH]),
  back: Object.freeze([B.EAST]),
  reroll: Object.freeze([B.WEST]),
  banish: Object.freeze([B.NORTH]),
  skip: Object.freeze([B.L1]),
  pause: Object.freeze([B.START]),
  glossary: Object.freeze([B.L2]),
  tuning: Object.freeze([B.SELECT]),
  debug: Object.freeze([]),
});

/** What Settings, Controls lets the player change, in its order (the tuning panel and F3 stay put). */
export const REMAPPABLE = Object.freeze(['dash', 'confirm', 'back', 'reroll', 'banish', 'skip', 'pause', 'glossary']);

/** Each action's name on the Controls screen. */
export const ACTION_NAMES = Object.freeze({
  dash: 'Dash', confirm: 'Confirm', back: 'Back', reroll: 'Reroll', banish: 'Banish', skip: 'Skip (hold)',
  pause: 'Pause', glossary: 'Glossary',
});

/** Pairs that may share a button (the game tells them apart by where you are). */
const SHARE = Object.freeze({ keys: [['dash', 'confirm'], ['back', 'pause']], pad: [['dash', 'confirm']] });
const shares = (device, a, b) => SHARE[device].some(([x, y]) => (x === a && y === b) || (x === b && y === a));

/** Pad buttons that can't be bound: the d-pad moves and steers menus, Home belongs to the system. */
const PAD_FIXED = new Set([B.UP, B.DOWN, B.LEFT, B.RIGHT, B.HOME]);
/** Keys that can't be bound: movement, and the keys the browser or the system keep. */
const KEY_FIXED = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'MetaLeft', 'MetaRight', 'F11', 'F1', 'F3', 'AltLeft', 'AltRight']);

/** Can this button (pad: index; keys: code) be given to an action? */
export function bindable(device, code) {
  if (device === 'pad') return Number.isInteger(code) && code >= 0 && code < 18 && !PAD_FIXED.has(code);
  return typeof code === 'string' && /^[A-Za-z0-9]{1,20}$/.test(code) && !KEY_FIXED.has(code);
}

export function defaultBindings() {
  const copy = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, [...v]]));
  return { keys: copy(DEFAULT_KEYS), pad: copy(DEFAULT_PAD) };
}

/**
 * The bindings from settings' saved ones (controls.keys, controls.pad), each action checked: a
 * list of buttons it can have, else the default. Confirm and Back are never left empty.
 */
export function normalizeBindings({ keys = null, pad = null } = {}) {
  const out = defaultBindings();
  const fit = (device, saved) => {
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return;
    for (const a of REMAPPABLE) {
      const v = saved[a];
      if (!Array.isArray(v)) continue;
      const list = [...new Set(v.filter((c) => bindable(device, c)))].slice(0, 4);
      if (list.length || (a !== 'confirm' && a !== 'back')) out[device][a] = list;
    }
  };
  fit('keys', keys);
  fit('pad', pad);
  return out;
}

/** The saved form of bindings: only the actions that differ from the defaults (settings stay small). */
export function savedBindings(b, device) {
  const D = device === 'pad' ? DEFAULT_PAD : DEFAULT_KEYS;
  const out = {};
  for (const a of REMAPPABLE) {
    const v = b[device][a] || [];
    if (v.length !== D[a].length || v.some((c, i) => c !== D[a][i])) out[a] = [...v];
  }
  return out;
}

/**
 * Give `code` to `action` as its main button (the first in its list). A button another action had
 * moves here; that action takes this one's old main button in its place (a swap), unless the two
 * may share it. Returns new bindings (the ones passed in never change), or the same object when the
 * button can't be bound.
 */
export function rebind(bindings, device, action, code) {
  if (!REMAPPABLE.includes(action) || !bindable(device, code)) return bindings;
  const b = { keys: { ...bindings.keys }, pad: { ...bindings.pad } };
  const map = b[device];
  for (const k of Object.keys(map)) map[k] = [...map[k]];
  const mine = map[action];
  const old = mine[0];
  if (old === code) return b;
  const dashWasOnConfirm = dashOnConfirm(bindings, device);
  // Whoever had the button gives it up for this action's old one.
  for (const other of REMAPPABLE) {
    if (other === action || shares(device, other, action)) continue;
    const i = map[other].indexOf(code);
    if (i < 0) continue;
    // Confirm and Back always swap (the sweep, S3b F10: B given to Confirm, the A/B swap, left
    // both on B, since A is also Dash's and the swap was refused). What the swap moves is then
    // taken off the actions that may not share it with its new owner (fixPair, below).
    if (PAIR.has(action) && PAIR.has(other) && old !== undefined) { if (map[other].includes(old)) map[other].splice(i, 1); else map[other][i] = old; fixPair(map, device, other, old, action, code, dashWasOnConfirm); continue; }
    if (old !== undefined && !map[other].includes(old) && !conflicts(map, device, other, old, action)) map[other][i] = old;
    else map[other].splice(i, 1);
  }
  const at = mine.indexOf(code);
  if (at >= 0) mine.splice(at, 1);
  if (mine.length) mine[0] = code;
  else mine.push(code);
  // Confirm or Back left without a button (a swap took its only one) gets the default back.
  for (const a of ['confirm', 'back']) if (!map[a].length) map[a] = [...(device === 'pad' ? DEFAULT_PAD : DEFAULT_KEYS)[a]];
  // Last check: Confirm and Back on one button would leave no way back (Confirm is handled first).
  // Such a change is refused: the bindings passed in come back (rebindRefusal says why).
  const clash = (m) => (m.confirm || []).some((c) => (m.back || []).includes(c));
  if (clash(map) && !clash(bindings[device])) return bindings;
  return b;
}

const PAIR = new Set(['confirm', 'back']);

/**
 * After a Confirm and Back swap on `device`: `moved` went to `to` (Confirm or Back) from `from`, which
 * now has `took`. Dash keeps its "Dash on Confirm" (the button that left Confirm comes off Dash, the
 * one that came to Confirm goes on), and an action that may not share `moved` with `to` gives it up
 * (on the keyboard Esc going to Confirm comes off Pause, which keeps P; one left with nothing takes
 * Back's new button, since Back and Pause may share).
 */
function fixPair(map, device, to, moved, from, took, dashWasOnConfirm) {
  const confirmGot = to === 'confirm' ? moved : took;
  const confirmLost = to === 'confirm' ? took : moved;
  for (const o of REMAPPABLE) {
    if (o === to || o === from || o === 'dash' || shares(device, o, to)) continue;
    if (!map[o].includes(moved)) continue;
    map[o] = map[o].filter((c) => c !== moved);
    if (!map[o].length && shares(device, o, 'back')) map[o] = [to === 'back' ? moved : took];
  }
  if (dashWasOnConfirm) {
    map.dash = map.dash.filter((c) => c !== confirmLost);
    if (!map.dash.some((c) => map.confirm.includes(c) || c === confirmGot) && !conflicts(map, device, 'dash', confirmGot, null)) map.dash.push(confirmGot);
  }
  // Dash may not keep a button that is now Back's.
  const backNow = to === 'back' ? moved : took;
  if (map.dash.includes(backNow)) {
    map.dash = map.dash.filter((c) => c !== backNow);
    if (!map.dash.length) map.dash = [...(device === 'pad' ? DEFAULT_PAD : DEFAULT_KEYS).dash.filter((c) => !map.confirm.includes(c) && !map.back.includes(c))];
  }
}

/**
 * Why giving `code` to `action` changes nothing, in the player's words, or null when it changes the
 * bindings (or the button already is that action's). Settings, Controls shows it under the list.
 */
export function rebindRefusal(bindings, device, action, code) {
  if (!REMAPPABLE.includes(action)) return null;
  // (Language polish: a refusal says what to do, WRITING.md 2.5.)
  if (!bindable(device, code)) return device === 'pad' ? 'That button can\'t be given to an action. Choose another button.' : 'That key can\'t be given to an action. Choose another key.';
  if ((bindings[device][action] || [])[0] === code) return null;
  return rebind(bindings, device, action, code) === bindings ? (device === 'pad' ? 'Confirm and Back need different buttons. Choose another button.' : 'Confirm and Back need different keys. Choose another key.') : null;
}

/** Would `code` on `action` clash with another action that may not share it? */
function conflicts(map, device, action, code, moving = null) {
  // (`moving`: the action whose old button this is; it's giving it up.)
  return REMAPPABLE.some((o) => o !== action && o !== moving && !shares(device, o, action) && map[o].includes(code));
}

/** Does Dash also take Confirm's button in a run (✕, A, Space)? */
export function dashOnConfirm(bindings, device) {
  const m = bindings[device];
  return (m.confirm || []).some((c) => (m.dash || []).includes(c));
}

/** Dash on Confirm's buttons in a run, or off them (V4: dash able to come off ✕). Returns new bindings. */
export function setDashOnConfirm(bindings, device, on) {
  const b = { keys: { ...bindings.keys }, pad: { ...bindings.pad } };
  const m = b[device];
  const conf = m.confirm || [];
  let dash = (m.dash || []).filter((c) => !conf.includes(c));
  if (on) dash = [...dash, ...conf];
  // Off with nothing left would leave Dash with no button: it keeps its default own one.
  if (!dash.length) dash = [...(device === 'pad' ? DEFAULT_PAD : DEFAULT_KEYS).dash.filter((c) => !conf.includes(c))];
  m.dash = dash;
  return b;
}

/** The buttons that dash without confirming (the harbor's dash, where Confirm's buttons confirm). */
export function dashAloneOf(bindings) {
  return {
    keys: bindings.keys.dash.filter((k) => !bindings.keys.confirm.includes(k)),
    pad: bindings.pad.dash.filter((p) => !bindings.pad.confirm.includes(p)),
  };
}

// ---------------------------------------------------------------- what a button is called

const PAD_NAMES = Object.freeze({
  playstation: ['✕', '○', '□', '△', 'L1', 'R1', 'L2', 'R2', 'Create', 'Options', 'L3', 'R3', 'Up', 'Down', 'Left', 'Right', 'PS', 'Touchpad'],
  xbox: ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'LS', 'RS', 'Up', 'Down', 'Left', 'Right', 'Guide', 'Share'],
});

/** A pad button's name as a controller of that style prints it ("✕", "LB"). */
export function padButtonName(style, index) {
  return (PAD_NAMES[style] || PAD_NAMES.xbox)[index] ?? `Button ${index}`;
}

/** A key's name as the keyboard prints it ("R", "Space", "Esc", "Shift"). */
export function keyName(code) {
  if (typeof code !== 'string') return '?';
  const named = { Escape: 'Esc', ShiftLeft: 'Shift', ShiftRight: 'Right Shift', ControlLeft: 'Ctrl', ControlRight: 'Right Ctrl', NumpadEnter: 'Enter', Backspace: 'Backspace', CapsLock: 'Caps Lock', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: '\'', Comma: ',', Period: '.', Slash: '/', Backslash: '\\' };
  if (named[code]) return named[code];
  let m = /^Key([A-Z])$/.exec(code);
  if (m) return m[1];
  m = /^Digit(\d)$/.exec(code);
  if (m) return m[1];
  m = /^Numpad(\w+)$/.exec(code);
  if (m) return `Num ${m[1]}`;
  return code;
}

/** Every button an action has on a device, by name ("R1, ✕"; "Space, Shift"); "None" for none. */
export function buttonsText(bindings, device, action, style) {
  const list = bindings[device][action] || [];
  const names = [...new Set(list.map((c) => (device === 'pad' ? padButtonName(style, c) : keyName(c))))];
  return names.length ? names.join(', ') : 'None';
}
