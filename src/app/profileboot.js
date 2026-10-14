// The profile the game starts with, from what the store loaded (ARCHITECTURE §12.2). Pure; tested.
//
// A save from another build keeps what this build doesn't know (meta/reconcile.js moves it aside,
// never deletes it), and anything out of range is brought back in. A save from a NEWER build is
// different: this build can't read it and won't write over it (save/store.js), so the game says
// so and doesn't start, rather than playing on a blank profile that could never be saved.

import { reconcileProfile } from '../meta/reconcile.js';

/**
 * load: save/store.js loadProfile()'s result. Returns { profile, notes } (notes: lines for the
 * error log's notices), or { stop, notes } with the sentence to show instead of starting.
 */
export function profileFromLoad(load, data) {
  const notes = [...(load?.warnings ?? [])];
  if (load?.tooNew || !load?.doc) {
    const why = notes.find((w) => /newer version/.test(w)) ?? 'This save is from a newer version of Lamplight. Update the game to load it.';
    return { stop: `${why} The save file hasn't been changed.`, notes };
  }
  const fitted = reconcileProfile(load.doc, data);
  if (fitted.moved.length) notes.push(`Stored content this version doesn't have: ${fitted.moved.join(', ')}.`);
  if (fitted.restored.length) notes.push(`Restored content this version has again: ${fitted.restored.join(', ')}.`);
  return { profile: fitted.doc, notes };
}
