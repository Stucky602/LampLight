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
  // v2 -> v3 (Phase 7): gear gets a counter for its items, and the new parts start empty:
  // consumables and rune stones held, bestiary rewards claimed, feats found, challenge runs won,
  // the gate's last choices, and four lifetime numbers. Nothing the player earned moves.
  (doc) => {
    const out = structuredClone(doc);
    out.v = 3;
    const p = out.profile && typeof out.profile === 'object' ? out.profile : (out.profile = {});
    const obj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
    if (!obj(p.gear)) p.gear = { inventory: [], equipped: {} };
    const items = Array.isArray(p.gear.inventory) ? p.gear.inventory : [];
    // The next uid follows the highest one an item already has.
    p.gear.next = items.reduce((m, it) => (obj(it) && Number.isInteger(it.uid) && it.uid >= m ? it.uid + 1 : m), 1);
    p.gear.rolls = 0;
    for (const k of ['consumables', 'bestiaryClaimed']) if (!obj(p[k])) p[k] = {};
    for (const k of ['featsFound', 'challenges']) if (!Array.isArray(p[k])) p[k] = [];
    if (!obj(p.setup)) p.setup = { character: '', kit: '', mode: 'standard', curses: [], arcana: '', consumables: [], rune: '', challenge: '' };
    const st = obj(out.stats) ? out.stats : (out.stats = {});
    for (const k of ['bossKills', 'clears', 'lampsLit', 'bellsRung']) if (!Number.isFinite(st[k])) st[k] = 0;
    return out;
  },
  // v3 -> v4 (0.8.0, the Salt Marsh): Tides are opened per map. Every Tide a v3 save opened was
  // opened on the Drowned Docks (the only map there was), so they move to `tides.drowned_docks`,
  // and `tide` keeps only the last one chosen. New parts: the relics given to the Salt Well
  // (`well`), what each map has shown (`seen`: every enemy the bestiary has counted was met on the
  // Docks, so the field guide and the first-sighting notices start from there), and the gate's
  // map. Nothing the player earned is lost.
  (doc) => {
    const out = structuredClone(doc);
    out.v = 4;
    const p = out.profile && typeof out.profile === 'object' ? out.profile : (out.profile = {});
    const obj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
    const T = obj(p.tide) ? p.tide : {};
    const opened = Number.isFinite(Number(T.unlocked)) ? Math.max(0, Math.floor(Number(T.unlocked))) : 0;
    const selected = Number.isFinite(Number(T.selected)) ? Math.max(0, Math.floor(Number(T.selected))) : 0;
    p.tides = obj(p.tides) ? p.tides : {};
    if (opened > 0) p.tides.drowned_docks = Math.max(opened, Number(p.tides.drowned_docks) || 0);
    p.tide = { selected };
    // Tides above an older build's top, set aside by reconcile, were the Docks' too.
    const O = obj(p.orphans) ? p.orphans : null;
    if (O && obj(O.tide)) {
      const n = Number(O.tide.unlocked);
      if (Number.isFinite(n) && n > 0) O.tides = { ...(obj(O.tides) ? O.tides : {}), drowned_docks: Math.floor(n) };
      delete O.tide;
    }
    if (!Array.isArray(p.well)) p.well = [];
    if (!obj(p.seen)) p.seen = {};
    if (!Array.isArray(p.seen.drowned_docks)) {
      const met = obj(p.bestiary) ? Object.keys(p.bestiary).filter((id) => Number(p.bestiary[id]) > 0).map((id) => `enemy:${id}`) : [];
      if (met.length) p.seen.drowned_docks = met;
    }
    if (obj(p.setup) && typeof p.setup.map !== 'string') p.setup.map = '';
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
