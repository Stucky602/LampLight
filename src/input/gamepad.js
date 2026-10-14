// Reading gamepads into one normalized shape.
//
// Normalized pad: { id, type, buttons: Float32Array(18) of 0..1, lx, ly, rx, ry }
// Button indices follow the W3C "standard" mapping:
//   0 A/Cross  1 B/Circle  2 X/Square  3 Y/Triangle  4 LB/L1  5 RB/R1  6 LT/L2  7 RT/R2
//   8 View/Create  9 Menu/Options  10 L3  11 R3  12 Up  13 Down  14 Left  15 Right
//   16 Home/PS  17 Touchpad
// A Sony pad that doesn't report mapping "standard" (DualShock 4 or DualSense over DirectInput)
// goes through a remap table, hat switch included. Any other pad is read as if standard.

import { detectControllerType } from './glyphs.js';

export const PAD_BUTTONS = 18;
export const B = Object.freeze({
  SOUTH: 0, EAST: 1, WEST: 2, NORTH: 3, L1: 4, R1: 5, L2: 6, R2: 7,
  SELECT: 8, START: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15, HOME: 16, TOUCH: 17,
});

// DualShock 4 / DualSense over DirectInput (seen in Firefox and some Chromium builds):
// raw index -> standard index.
const SONY_DINPUT = [B.WEST, B.SOUTH, B.EAST, B.NORTH, B.L1, B.R1, B.L2, B.R2, B.SELECT, B.START, B.L3, B.R3, B.HOME, B.TOUCH];

/** Decode a DirectInput hat axis (-1..1 in 8 steps, >1 when centered) into d-pad buttons. */
export function hatToDpad(v) {
  const out = { up: 0, down: 0, left: 0, right: 0 };
  if (!(v >= -1.05 && v <= 1.05)) return out;          // centered reports ~1.2857
  const step = Math.round((v + 1) / (2 / 7));          // 0..7, clockwise from up
  const dirs = [
    ['up'], ['up', 'right'], ['right'], ['down', 'right'],
    ['down'], ['down', 'left'], ['left'], ['up', 'left'],
  ][((step % 8) + 8) % 8];
  for (const d of dirs) out[d] = 1;
  return out;
}

function btn(b) {
  if (!b) return 0;
  if (typeof b === 'number') return b;
  return b.pressed ? Math.max(b.value || 0, 1) : (b.value || 0);
}

/**
 * Normalize one Gamepad (or a test double with the same fields) into `into` (reused if given).
 * Pads whose mapping isn't "standard" and aren't Sony are read as if standard: in Chromium and
 * Electron on Windows, XInput pads always report "standard", so this is the rare case.
 */
export function normalizePad(gp, into = null) {
  const out = into || { id: '', index: 0, type: 'generic', standard: false, buttons: new Float32Array(PAD_BUTTONS), lx: 0, ly: 0, rx: 0, ry: 0 };
  const buttons = out.buttons;
  buttons.fill(0);
  const axes = gp.axes || [];
  if (out.id !== (gp.id || '') || !into) out.type = detectControllerType(gp.id);
  out.id = gp.id || '';
  out.index = gp.index ?? 0;
  out.standard = gp.mapping === 'standard';
  out.lx = axes[0] || 0; out.ly = axes[1] || 0; out.rx = axes[2] || 0; out.ry = axes[3] || 0;

  if (out.standard || out.type !== 'playstation') {
    const n = Math.min(PAD_BUTTONS, gp.buttons?.length || 0);
    for (let i = 0; i < n; i++) buttons[i] = btn(gp.buttons[i]);
  } else {
    // Sony pad without the standard mapping (DirectInput layout).
    const raw = gp.buttons || [];
    for (let i = 0; i < SONY_DINPUT.length && i < raw.length; i++) buttons[SONY_DINPUT[i]] = btn(raw[i]);
    if (axes.length > 9) {
      const hat = hatToDpad(axes[9]);
      buttons[B.UP] = hat.up; buttons[B.DOWN] = hat.down; buttons[B.LEFT] = hat.left; buttons[B.RIGHT] = hat.right;
    }
    out.rx = axes[2] || 0; out.ry = axes[5] || 0;
  }
  return out;
}

/**
 * Radial deadzone with rescale: inside the deadzone is 0; outside, magnitude is remapped so
 * the edge of the deadzone is 0 and full tilt is 1, keeping the direction.
 */
export function radialDeadzone(x, y, dz = 0.2) {
  const m = Math.sqrt(x * x + y * y);
  if (!(m > dz) || !(m === m)) return { x: 0, y: 0 };
  const scaled = Math.min(1, (m - dz) / (1 - dz));
  return { x: (x / m) * scaled, y: (y / m) * scaled };
}

/** Read every connected pad from a getGamepads() result into fresh objects (tests, tools). */
export function readPads(list) {
  const out = [];
  if (!list) return out;
  for (let i = 0; i < list.length; i++) {
    const gp = list[i];
    if (gp && gp.connected !== false) out.push(normalizePad(gp));
  }
  return out;
}

/**
 * Same as readPads, but reuses one normalized object per gamepad index (no per-frame garbage).
 * `out` is cleared and refilled; `cache` maps index -> normalized object.
 */
export function readPadsInto(list, out, cache) {
  out.length = 0;
  if (!list) return out;
  for (let i = 0; i < list.length; i++) {
    const gp = list[i];
    if (!gp || gp.connected === false) continue;
    const idx = gp.index ?? i;
    const prev = cache.get(idx) || null;
    const n = normalizePad(gp, prev);
    if (!prev) cache.set(idx, n);
    out.push(n);
  }
  return out;
}
