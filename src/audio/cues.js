// What the app asks the sound side for, kept pure so the gate can check it (0.9.0, W6):
//   musicFor(scene, world)  which loop plays now (audio/music.js): 'harbor', 'run', 'boss', or null
//   fireSound(def)          a weapon's own fire sound: data/sfx.js WEAPON_FIRE by its id, else its
//                           data's sfx.fire (so no two weapons share one, and a new weapon with its
//                           own sound needs nothing here)

import { SFX, WEAPON_FIRE, DASH_SOUND } from '../data/sfx.js';

export { musicFor } from './music.js';

/** The sound a weapon fires with, or null for one that fires none. */
export function fireSound(def) {
  if (!def) return null;
  const own = WEAPON_FIRE[def.id];
  if (own && SFX[own]) return own;
  return def.sfx?.fire || null;
}

/** The sound a dash makes: the Dash slot item's own (data/sfx.js DASH_SOUND), else the plain one. */
export function dashSound(id) {
  const own = id ? DASH_SOUND[id] : null;
  return own && SFX[own] ? own : 'dash';
}
