// The harbor's dev commands (ARCHITECTURE §15): for trying the harbor without playing the runs
// that pay for it. They sit behind the tuning panel like the run's, change the profile the way a
// purchase does (a new document, never the one passed in; the app saves it), and mark it
// (profile.flags.devTools), so a save or a report that shows fast progress says why.

import { countOf } from './costs.js';
import { MetaError, newlyUnlocked, writable, partOf } from './actions.js';
import { researchDone, researchActive, resolveContent, contentFrom } from './state.js';

/** The most one press adds: a hundred thousand of each, far more than the harbor costs in all. */
export const DEV_MATERIALS_MAX = 100000;

/** The materials the maps in this build drop (materials.js `maps`: '*' is every map), in data order. */
export function droppedMaterials(data) {
  const maps = new Set(data.maps.map((m) => m.id));
  return data.materials.filter((m) => m.maps.some((id) => id === '*' || maps.has(id))).map((m) => m.id);
}

/** A copy to write `parts` to, marked (flags that aren't a table start as one). */
function marked(doc, parts) {
  const out = writable(doc, [...parts, 'flags']);
  out.profile.flags = { ...out.profile.flags, devTools: true };
  return out;
}

/** Add `count` of every material the maps drop. Returns { doc, changes } (a material change each). */
export function devAddMaterials(doc, data, count) {
  if (!(Number.isInteger(count) && count >= 1 && count <= DEV_MATERIALS_MAX)) throw new MetaError(`Add a whole number of materials from 1 to ${DEV_MATERIALS_MAX.toLocaleString('en-US')}.`);
  const out = marked(doc, ['materials']);
  const changes = [];
  for (const id of droppedMaterials(data)) {
    out.profile.materials[id] = countOf(out.profile.materials[id]) + count;
    changes.push({ kind: 'material', id, count });
  }
  return { doc: out, changes };
}

/** True when nothing is left to unlock: every building at its last level, all research done. */
export function allUnlocked(doc, data) {
  const done = researchDone(doc);
  return data.buildings.every((b) => countOf(partOf(doc, 'buildings')[b.id]) >= b.levels.length)
    && data.research.every((r) => done.has(r.id));
}

/**
 * Unlock everything the harbor gives: every building at its last level and every research
 * project done (the ones under way too). The Lamp Post's upgrades are all open then, and stay
 * unbought. Returns { doc, changes, unlocks }: a change for each thing it did, shaped as a
 * purchase's or a run's are (building_level with what it cost, nothing, and what it opened;
 * research_done with what it adds), and everything that joined your runs ([{ what, id }]).
 */
export function devUnlockAll(doc, data) {
  if (allUnlocked(doc, data)) throw new MetaError('Everything is already unlocked.');
  const before = resolveContent(doc, data);
  const out = marked(doc, ['buildings', 'research']);
  const changes = [];
  for (const b of data.buildings) {
    const top = b.levels.length;
    if (countOf(out.profile.buildings[b.id]) < top) {
      const was = resolveContent(out, data);
      out.profile.buildings[b.id] = top;
      changes.push({ kind: 'building_level', id: b.id, level: top, cost: {}, unlocks: newlyUnlocked(was, resolveContent(out, data)) });
    }
  }
  const done = researchDone(doc);
  const finished = data.research.filter((r) => !done.has(r.id)).map((r) => r.id);
  // A project this build doesn't know stays as it was (a save never loses progress, §12.2).
  const known = new Set(data.research.map((r) => r.id));
  out.profile.research = { done: [...done, ...finished], active: researchActive(doc).filter((a) => !known.has(a.id)) };
  for (const id of finished) changes.push({ kind: 'research_done', id, unlocks: contentFrom(data, `research:${id}`).map(({ what, id: x }) => ({ what, id: x })) });
  return { doc: out, changes, unlocks: newlyUnlocked(before, resolveContent(out, data)) };
}
