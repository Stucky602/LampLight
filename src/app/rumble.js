// Rumble moved to src/render/rumble.js in 0.9.0 (W6: the combat cues read the fight's events and
// the world). This keeps the old path working for the app and the tests.
export { rumbleFor, rumbleEffect, createRumble, hurtScale, HURT_FULL_SHARE, HURT_MIN_SCALE, LOW_HEALTH, PULSE_MS } from '../render/rumble.js';
