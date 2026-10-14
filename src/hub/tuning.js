// The harbor's live tuning (ARCHITECTURE §15): a copy of data/tuning.js HUB_TUNING that the
// harbor's tuning panel changes in place. The world reads its timing every tick and the view its
// look every frame, so a change shows at once. It lasts until the game closes; "Copy tuning" is
// how a change reaches the data. Each number is held to its range (data/tuning.js
// HUB_TUNING_RANGE), so the panel can't set one the harbor can't run on. Pure; tested.

import { HUB_TUNING, HUB_TUNING_RANGE } from '../data/tuning.js';

/** A fresh live copy (plain objects the panel may change; the data's stay frozen). */
export function createHubTuning(base = HUB_TUNING) {
  return structuredClone(base);
}

function valueAt(t, path) {
  if (path === '') return t;
  let o = t;
  for (const k of String(path).split('.')) {
    if (o === null || typeof o !== 'object' || !Object.prototype.hasOwnProperty.call(o, k)) return undefined;
    o = o[k];
  }
  return o;
}

/** A number's range ('above0', 'unit', 'any', 'min0'), or undefined for a path that has none. */
export function hubTuneRange(path, ranges = HUB_TUNING_RANGE) {
  const r = valueAt(ranges, path);
  return typeof r === 'string' ? r : undefined;
}

/**
 * Why this change can't be made (a sentence), or null if it can. `path` is inside the harbor's
 * tuning ('timing.panIn', 'look.lampReach', 'look.smoke.every'). Only numbers change here, and
 * only within their range: above 0 for what the harbor divides by, 0 to 1 for a brightness, a
 * thickness, or a share, any sign for a boost, a drift, or an offset, and 0 or more for the rest.
 */
export function checkHubTune(t, path, value, ranges = HUB_TUNING_RANGE) {
  const cur = valueAt(t, path);
  if (typeof cur !== 'number') return `there is no harbor tuning number "${path}"`;
  if (!Number.isFinite(value)) return `${path} should be a number`;
  const range = hubTuneRange(path, ranges);
  if (range === 'any') return null;
  if (range === 'above0' && !(value > 0)) return `${path} must stay above 0`;
  if (value < 0) return `${path} can't go below 0`;
  if (range === 'unit' && value > 1) return `${path} can't go above 1`;
  return null;
}

/** Make the change in place (the world and the view see it at once). Throws the check's sentence. */
export function setHubTune(t, path, value) {
  const bad = checkHubTune(t, path, value);
  if (bad) throw new Error(bad);
  const keys = path.split('.');
  const last = keys.pop();
  valueAt(t, keys.join('.'))[last] = value;
}

/** Every value back to the data's, in place (the groups inside a group too). */
export function resetHubTuning(t, base = HUB_TUNING) {
  const reset = (to, from) => {
    for (const [k, v] of Object.entries(from)) {
      if (v && typeof v === 'object' && !Array.isArray(v) && to[k] && typeof to[k] === 'object') reset(to[k], v);
      else to[k] = structuredClone(v);
    }
  };
  reset(t, base);
}
