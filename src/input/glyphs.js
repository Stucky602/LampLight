// Which controller is this, and what should button prompts say?

/**
 * Classify a gamepad by its id string.
 * Chrome/Edge/Electron ids look like "DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)"
 * or "Xbox 360 Controller (XInput STANDARD GAMEPAD)". Steam Input can disguise a DualSense as an
 * Xbox pad, which is why Settings has a prompt override.
 * @returns {'playstation'|'xbox'|'generic'}
 */
export function detectControllerType(id = '') {
  const s = String(id).toLowerCase();
  // Vendor ids: Chromium writes "Vendor: 054c", Firefox writes "054c-0ce6-...". Anchor on those
  // forms so a product id that happens to be 054c can't be mistaken for Sony.
  const vendor = (v) => new RegExp(`vendor:\\s*${v}\\b|^${v}-`).test(s);
  if (vendor('054c') || /dualsense|dualshock|playstation|\bps[45]\b/.test(s)) return 'playstation';
  if (vendor('045e') || /xbox|xinput|x-box/.test(s)) return 'xbox';
  // A bare "Wireless Controller" with no vendor is how Sony pads report on some systems.
  if (/^wireless controller/.test(s)) return 'playstation';
  return 'generic';
}

/**
 * Prompt style shown on screen.
 * @param {'auto'|'playstation'|'xbox'|'keyboard'} override from settings
 * @param {'keyboard'|'mouse'|'gamepad'} lastDevice
 * @param {'playstation'|'xbox'|'generic'|null} controllerType
 */
export function promptStyle(override, lastDevice, controllerType) {
  if (override === 'playstation' || override === 'xbox' || override === 'keyboard') return override;
  if (lastDevice !== 'gamepad') return 'keyboard';
  return controllerType === 'playstation' ? 'playstation' : 'xbox';
}

export const GLYPHS = Object.freeze({
  playstation: Object.freeze({
    confirm: '✕', back: '○', reroll: '□', banish: '△', skip: 'Hold L1', dash: 'R1',
    pause: 'Options', tuning: 'Hold Create', move: 'Left stick', sides: '◀ ▶',
  }),
  xbox: Object.freeze({
    confirm: 'A', back: 'B', reroll: 'X', banish: 'Y', skip: 'Hold LB', dash: 'RB',
    pause: 'Menu', tuning: 'Hold View', move: 'Left stick', sides: '◀ ▶',
  }),
  keyboard: Object.freeze({
    confirm: 'Enter', back: 'Esc', reroll: 'R', banish: 'B', skip: 'Hold Tab', dash: 'Space',
    pause: 'Esc', tuning: 'F1', move: 'WASD', sides: '← →',
  }),
});

/** The label for an action in a style; unknown actions return the action name. */
export function glyphFor(style, action) {
  return GLYPHS[style]?.[action] ?? action;
}
