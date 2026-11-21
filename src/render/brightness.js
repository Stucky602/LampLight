// The Brightness setting (0.9.0, the veteran round's presentation list): one slider that moves the
// light model, in runs and in the harbor alike. It never brightens the picture after it's drawn
// (that would wash out the lamps and the fog): it raises or lowers the ambient light where no lamp
// reaches, so lit pools, windows, and the player's lamp keep their contrast against the dark.
//
// The setting lives in the saved settings as access.brightness (save/schema.js, W7's), 0 to 1,
// 0.5 the game as tuned. Settings shows it as a slider in steps of 0.1.

/** The setting's key, default, and range (save/schema.js and app/settings-flow.js take these). */
export const BRIGHTNESS = Object.freeze({ key: 'access.brightness', default: 0.5, min: 0, max: 1, step: 0.1 });

/** How far the slider's ends move the ambient light (each way), in the light map's 0..1. */
export const BRIGHTNESS_SPAN = 0.2;

/** A setting value held to 0..1; anything that isn't a number is the default. */
export function brightnessValue(b) {
  if (typeof b !== 'number' || !Number.isFinite(b)) return BRIGHTNESS.default;
  return b < BRIGHTNESS.min ? BRIGHTNESS.min : b > BRIGHTNESS.max ? BRIGHTNESS.max : b;
}

/** The ambient light a Brightness setting adds (below 0.5 it takes some away): -0.2 to +0.2. */
export function brightnessLift(b) {
  return (brightnessValue(b) - BRIGHTNESS.default) * 2 * BRIGHTNESS_SPAN;
}

/**
 * A run's ambient light, 0..1: the map's own, the tuning's boost (feel.light.ambientBoost), the
 * setting, and Lantern Night's lift while it burns.
 */
export function runAmbient(mapAmbient, boost, brightness, nightLift = 0) {
  const a = (mapAmbient ?? 0.35) + (boost || 0) + brightnessLift(brightness) + nightLift;
  return a < 0 ? 0 : a > 1 ? 1 : a;
}
