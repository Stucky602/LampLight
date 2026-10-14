// Profile migrations. PROFILE_MIGRATIONS[i] converts a version (i + 1) doc into version (i + 2).
//
// Rules:
// - A migration never deletes player progress. Content that no longer exists moves to
//   profile.orphans.
// - Every migration is pure: it takes a doc and returns a doc.
// - When you add one, also add tests/fixtures/saves/profile-v<N>.txt (a real save envelope at the
//   old version). The gate migrates every fixture forever.

import { PROFILE_VERSION, repairProfile } from './schema.js';

export const PROFILE_MIGRATIONS = [
  // v1 -> v2 (Phase 5): the Lamp Post's upgrade ranks get their own place, and research slots
  // stop being stored (the Library's level decides them now). Nothing the player earned moves.
  (doc) => {
    const out = structuredClone(doc);
    out.v = 2;
    const p = out.profile && typeof out.profile === 'object' ? out.profile : (out.profile = {});
    if (!p.upgrades || typeof p.upgrades !== 'object' || Array.isArray(p.upgrades)) p.upgrades = {};
    if (p.research && typeof p.research === 'object') delete p.research.slots;
    return out;
  },
];

export class SaveTooNewError extends Error {
  constructor(v, max = PROFILE_VERSION) {
    super(`This save is from a newer version of Lamplight (save version ${v}, this version reads up to ${max}). Update the game to load it.`);
    this.name = 'SaveTooNewError';
  }
}

/**
 * Bring a profile doc up to the current version. Returns { doc, steps, repairs }.
 * Throws SaveTooNewError for saves from a newer build, and Error for docs that aren't profiles.
 * `table` (tests only) replaces PROFILE_MIGRATIONS; the target version is then table.length + 1.
 */
export function migrateProfile(input, table = PROFILE_MIGRATIONS) {
  const target = table === PROFILE_MIGRATIONS ? PROFILE_VERSION : table.length + 1;
  if (!input || typeof input !== 'object' || typeof input.v !== 'number' || !Number.isInteger(input.v) || input.v < 1) {
    throw new Error('Not a Lamplight profile (missing or invalid version).');
  }
  if (input.v > target) throw new SaveTooNewError(input.v, target);
  if (table.length !== target - 1) {
    throw new Error(`Migration table has ${table.length} steps but the profile version is ${target}.`);
  }
  let doc = structuredClone(input);
  let steps = 0;
  while (doc.v < target) {
    const from = doc.v;
    doc = table[from - 1](doc);
    if (!doc || doc.v !== from + 1) throw new Error(`Migration from v${from} did not produce v${from + 1}.`);
    steps++;
  }
  const repairs = table === PROFILE_MIGRATIONS ? repairProfile(doc) : [];
  return { doc, steps, repairs };
}
