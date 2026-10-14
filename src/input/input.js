// The input manager: keyboard + every connected gamepad, merged into abstract actions.
//
// Call update(frameMs) once per rendered frame. Then read:
//   move              {x, y} after the deadzone, magnitude <= 1
//   down(a)           held right now
//   pressed(a)        went down this frame
//   released(a)       went up this frame
//   heldMs(a)         how long it has been held
//   fired(a)          hold actions (skip, tuning): true on the one frame the hold threshold is
//                     crossed. Other actions: same as pressed(a). UI code should use fired().
//   nav(dir)          d-pad / stick / arrow navigation with auto-repeat, for menus
//   sampleFrame()     the quantized InputFrame for this sim tick
// Events: on('connect'|'disconnect'|'device', fn)
//
// Bindings follow ARCHITECTURE.md §7. The tuning panel is "hold Create (View) for 1 s" rather
// than a two-button chord, so it can never also trigger Pause (Options/Menu).

import { makeFrame, BTN_DASH } from '../lib/inputframe.js';
import { readPadsInto, radialDeadzone, B } from './gamepad.js';
import { promptStyle as stylePick } from './glyphs.js';

export const ACTIONS = ['dash', 'confirm', 'back', 'reroll', 'banish', 'skip', 'pause', 'tuning', 'debug'];

export const DEFAULT_BINDINGS = Object.freeze({
  keys: Object.freeze({
    dash: ['Space', 'ShiftLeft', 'ShiftRight'],
    confirm: ['Enter', 'NumpadEnter', 'Space'],
    back: ['Escape', 'Backspace'],
    reroll: ['KeyR'],
    banish: ['KeyB'],
    skip: ['Tab'],
    pause: ['Escape', 'KeyP'],
    tuning: ['F1'],
    debug: ['F3'],
  }),
  pad: Object.freeze({
    dash: [B.R1, B.SOUTH],
    confirm: [B.SOUTH],
    back: [B.EAST],
    reroll: [B.WEST],
    banish: [B.NORTH],
    skip: [B.L1],
    pause: [B.START],
    tuning: [B.SELECT],
    debug: [],
  }),
});

/**
 * The dash's own buttons: the ones bound to dash and not to confirm (R1 or RB, Shift). In the
 * harbor, where ✕ or A and Space confirm (walk up to a door and press it), only these dash.
 */
export const DASH_ALONE = Object.freeze({
  keys: Object.freeze(DEFAULT_BINDINGS.keys.dash.filter((k) => !DEFAULT_BINDINGS.keys.confirm.includes(k))),
  pad: Object.freeze(DEFAULT_BINDINGS.pad.dash.filter((b) => !DEFAULT_BINDINGS.pad.confirm.includes(b))),
});

/** Hold-to-activate actions: threshold in ms, and whether the keyboard binding is also a hold. */
export const HOLDS = Object.freeze({
  skip: Object.freeze({ ms: 500, keyboard: true }),     // Tab, like L1, must be held
  tuning: Object.freeze({ ms: 1000, keyboard: false }), // F1 is a plain press
});

export const DEADZONE_MIN = 0;
export const DEADZONE_MAX = 0.6;
export function clampDeadzone(v, fallback = 0.2) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(DEADZONE_MAX, Math.max(DEADZONE_MIN, n));
}

const MOVE_KEYS = Object.freeze({
  up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
});
const NAV_DIRS = ['up', 'down', 'left', 'right'];
const NAV_PAD = Object.freeze({ up: B.UP, down: B.DOWN, left: B.LEFT, right: B.RIGHT });
export const REPEAT_DELAY = 350;
export const REPEAT_EVERY = 90;
export const STICK_NAV = 0.55;
const MOUSE_SWITCH_PX = 24;      // a desk mouse jittering shouldn't flip the button prompts
const MOUSE_QUIET_MS = 750;      // ...and neither should movement right after the pad was used
const MOUSE_GAP_MS = 300;        // travel only adds up within one continuous movement
// Keys whose browser defaults (scrolling, focus moves, the help page) must never fire in the game.
const SWALLOW = new Set(['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F1', 'F3', 'Backspace']);

function isEditable(t) {
  if (!t) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable === true;
}

function anyKey(keys, list) {
  for (let i = 0; i < list.length; i++) if (keys.has(list[i])) return true;
  return false;
}

/**
 * @param {object} [o]
 * @param {()=>ArrayLike<any>} [o.getGamepads]
 * @param {EventTarget|null} [o.target] where keyboard and mouse events are heard (window in the game)
 * @param {object} [o.settings] { deadzone, prompts }
 * @param {()=>number} [o.now] ms clock (for the mouse-quiet window)
 */
export function createInput({
  getGamepads = () => (typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : []),
  target = typeof window !== 'undefined' ? window : null,
  settings = {},
  now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
} = {}) {
  const keys = new Set();
  const listeners = { connect: [], disconnect: [], device: [] };
  let deadzone = clampDeadzone(settings.deadzone);
  let promptOverride = settings.prompts ?? 'auto';
  let device = 'keyboard';
  let controllerType = null;
  let activePadIndex = null;          // the pad the player last used
  let lastPadActiveAt = -Infinity;
  let mouseTravel = 0;
  let lastMouseX = 0, lastMouseY = 0, lastMouseAt = -Infinity;
  const pads = [];                    // normalized pads, reused frame to frame
  const padCache = new Map();         // gamepad index -> normalized object
  let knownPads = new Map();          // index -> id
  let seen = new Map();
  const state = {};
  for (const a of ACTIONS) state[a] = { down: false, prev: false, heldMs: 0, fired: false, suppressed: false, byPad: false };
  const navState = {};
  for (const d of NAV_DIRS) navState[d] = { down: false, heldMs: 0, fire: false, nextAt: 0, suppressed: false };
  const move = { x: 0, y: 0 };
  let dashAlone = false;              // one of the dash's own buttons is down (DASH_ALONE)

  function emit(ev, arg) { for (const f of listeners[ev]) f(arg); }
  // 'device' events mean "the player is now using this": they come only from real input. When
  // the last pad disappears, the prompts fall back to keyboard silently (the 'disconnect' event
  // already said what happened), and the first real key or mouse use afterwards still emits.
  let deviceIsFallback = false;
  function setDevice(d, force = false) {
    if (d !== device || deviceIsFallback || force) { device = d; deviceIsFallback = false; emit('device', d); }
  }

  const onKeyDown = (e) => {
    if (isEditable(e.target)) return;  // typing in a text box is never a game input
    if (SWALLOW.has(e.code)) e.preventDefault?.();
    if (e.repeat) return;
    keys.add(e.code);
    setDevice('keyboard');
  };
  const onKeyUp = (e) => { keys.delete(e.code); };
  const onBlur = () => keys.clear();   // alt-tab must not leave keys stuck down
  const onMouseDown = () => { setDevice('mouse'); mouseTravel = 0; };
  const onMouseMove = (e) => {
    const x = e.clientX ?? 0, y = e.clientY ?? 0, t = now();
    // A desk bumped now and then shouldn't add up to a switch: a pause resets the count.
    mouseTravel = t - lastMouseAt <= MOUSE_GAP_MS ? mouseTravel + Math.abs(x - lastMouseX) + Math.abs(y - lastMouseY) : 0;
    lastMouseX = x; lastMouseY = y; lastMouseAt = t;
    if (device !== 'mouse' && mouseTravel >= MOUSE_SWITCH_PX && t - lastPadActiveAt > MOUSE_QUIET_MS) {
      setDevice('mouse');
      mouseTravel = 0;
    }
  };
  if (target) {
    target.addEventListener('keydown', onKeyDown);
    target.addEventListener('keyup', onKeyUp);
    target.addEventListener('blur', onBlur);
    target.addEventListener('mousemove', onMouseMove);
    target.addEventListener('mousedown', onMouseDown);
  }

  function padButton(i) {
    for (let p = 0; p < pads.length; p++) if (pads[p].buttons[i] > 0.5) return true;
    return false;
  }
  function anyPadButton(list) {
    for (let i = 0; i < list.length; i++) if (padButton(list[i])) return true;
    return false;
  }

  function pollPads() {
    readPadsInto(getGamepads(), pads, padCache);
    seen.clear();
    for (const p of pads) {
      seen.set(p.index, p.id);
      if (!knownPads.has(p.index)) emit('connect', { index: p.index, id: p.id, type: p.type });
    }
    for (const [idx, id] of knownPads) if (!seen.has(idx)) { padCache.delete(idx); emit('disconnect', { index: idx, id }); }
    const swap = knownPads; knownPads = seen; seen = swap;

    // Which pad is being used right now? Its type decides the prompts.
    let active = null;
    for (const p of pads) {
      let on = false;
      for (let i = 0; i < p.buttons.length && !on; i++) if (p.buttons[i] > 0.5) on = true;
      if (!on && (p.lx * p.lx + p.ly * p.ly) > deadzone * deadzone) on = true;
      if (on) { active = p; break; }
    }
    if (active) {
      // Picking up a different pad counts as a new device (it emits even though both are pads).
      const switched = activePadIndex !== null && active.index !== activePadIndex;
      activePadIndex = active.index;
      controllerType = active.type;
      lastPadActiveAt = now();
      mouseTravel = 0;
      setDevice('gamepad', switched);
    }
    if (!pads.length && device === 'gamepad') { device = 'keyboard'; deviceIsFallback = true; }
  }

  function updateMove() {
    // The strongest of: any stick, the d-pad, the keys.
    let bx = 0, by = 0, bm = 0;
    for (const p of pads) {
      const s = radialDeadzone(p.lx, p.ly, deadzone);
      const m = s.x * s.x + s.y * s.y;
      if (m > bm) { bx = s.x; by = s.y; bm = m; }
    }
    const digital = (dx, dy) => {
      if (!dx && !dy) return;
      const m = Math.sqrt(dx * dx + dy * dy);
      if (1 > bm) { bx = dx / m; by = dy / m; bm = 1; }
    };
    digital((padButton(B.RIGHT) ? 1 : 0) - (padButton(B.LEFT) ? 1 : 0), (padButton(B.DOWN) ? 1 : 0) - (padButton(B.UP) ? 1 : 0));
    digital((anyKey(keys, MOVE_KEYS.right) ? 1 : 0) - (anyKey(keys, MOVE_KEYS.left) ? 1 : 0),
      (anyKey(keys, MOVE_KEYS.down) ? 1 : 0) - (anyKey(keys, MOVE_KEYS.up) ? 1 : 0));
    move.x = bx; move.y = by;
  }

  function updateActions(frameMs) {
    for (const a of ACTIONS) {
      const st = state[a];
      const keyDown = anyKey(keys, DEFAULT_BINDINGS.keys[a]);
      const padDown = anyPadButton(DEFAULT_BINDINGS.pad[a]);
      const raw = keyDown || padDown;
      if (st.suppressed && !raw) st.suppressed = false;
      st.prev = st.down;
      st.down = raw && !st.suppressed;
      if (st.down && !st.prev) st.byPad = padDown && !keyDown;
      st.heldMs = st.down ? (st.prev ? st.heldMs + frameMs : 0) : 0;
      const hold = HOLDS[a];
      if (hold && (st.byPad || hold.keyboard)) {
        st.fired = st.down && st.prev && st.heldMs >= hold.ms && st.heldMs - frameMs < hold.ms;
      } else {
        st.fired = st.down && !st.prev;
      }
    }
    // Held along with the dash action (and released with it by releaseAll).
    dashAlone = state.dash.down && (anyKey(keys, DASH_ALONE.keys) || anyPadButton(DASH_ALONE.pad));
  }

  function updateNav(frameMs) {
    // The stick that is pushed furthest drives stick navigation.
    let sx = 0, sy = 0, sm = 0;
    for (const p of pads) { const m = Math.abs(p.lx) + Math.abs(p.ly); if (m > sm) { sm = m; sx = p.lx; sy = p.ly; } }
    for (const d of NAV_DIRS) {
      const stick = d === 'up' ? sy < -STICK_NAV : d === 'down' ? sy > STICK_NAV : d === 'left' ? sx < -STICK_NAV : sx > STICK_NAV;
      const raw = padButton(NAV_PAD[d]) || anyKey(keys, MOVE_KEYS[d]) || stick;
      const n = navState[d];
      if (n.suppressed && !raw) n.suppressed = false;
      const was = n.down;
      n.down = raw && !n.suppressed;
      n.fire = false;
      if (n.down && !was) { n.heldMs = 0; n.fire = true; n.nextAt = REPEAT_DELAY; }
      else if (n.down) {
        n.heldMs += frameMs;
        if (n.heldMs >= n.nextAt) { n.fire = true; n.nextAt += REPEAT_EVERY; }
      } else n.heldMs = 0;
    }
  }

  function update(frameMs = 1000 / 60) {
    pollPads();
    updateMove();
    updateActions(frameMs);
    updateNav(frameMs);
  }

  return {
    update,
    get move() { return { x: move.x, y: move.y }; },
    down: (a) => !!state[a]?.down,
    pressed: (a) => !!state[a] && state[a].down && !state[a].prev,
    released: (a) => !!state[a] && !state[a].down && state[a].prev,
    heldMs: (a) => state[a]?.heldMs ?? 0,
    fired: (a) => !!state[a]?.fired,
    nav: (dir) => !!navState[dir]?.fire,
    get device() { return device; },
    get controllerType() { return controllerType; },
    /** Index of the pad the player last used (null before any pad input). */
    get activePad() { return activePadIndex; },
    get padCount() { return pads.length; },
    get deadzone() { return deadzone; },
    /** 'playstation' | 'xbox' | 'keyboard', honoring the settings override. */
    get promptStyle() { return stylePick(promptOverride, device, controllerType); },
    setSettings(s = {}) {
      if (s.deadzone !== undefined) deadzone = clampDeadzone(s.deadzone, deadzone);
      if (s.prompts !== undefined) promptOverride = s.prompts;
    },
    /**
     * The quantized frame the sim consumes this tick. dashOnly: only the dash's own buttons dash
     * (the harbor, where the others confirm).
     */
    sampleFrame({ dashOnly = false } = {}) { return makeFrame(move.x, move.y, (dashOnly ? dashAlone : state.dash.down) ? BTN_DASH : 0); },
    on(ev, fn) {
      if (!listeners[ev]) throw new Error(`Unknown input event: ${ev}`);
      listeners[ev].push(fn);
      return () => { listeners[ev] = listeners[ev].filter((f) => f !== fn); };
    },
    /**
     * Forget everything currently held. Call it when a menu opens and again when it closes, so a
     * button held across the change can't act on the new screen: held buttons, keys, and
     * directions are ignored until they are let go.
     */
    releaseAll() {
      keys.clear();
      for (const a of ACTIONS) { const st = state[a]; st.down = false; st.prev = false; st.heldMs = 0; st.fired = false; st.suppressed = true; }
      for (const d of NAV_DIRS) { const n = navState[d]; n.down = false; n.fire = false; n.heldMs = 0; n.suppressed = true; }
      move.x = 0; move.y = 0;
      dashAlone = false;
    },
    destroy() {
      if (!target) return;
      target.removeEventListener('keydown', onKeyDown);
      target.removeEventListener('keyup', onKeyUp);
      target.removeEventListener('blur', onBlur);
      target.removeEventListener('mousemove', onMouseMove);
      target.removeEventListener('mousedown', onMouseDown);
      keys.clear();
    },
  };
}
