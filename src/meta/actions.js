// What you can do in the harbor (ARCHITECTURE §10.4, §10.6): restore a building's next level,
// buy an upgrade's next rank at the Lamp Post, start a Library project. Pure; tested in Node.
//
// Each action has a `whyNot...` twin that returns the reason it can't happen, as a plain sentence
// the panels show (or null when it can). The action itself returns { doc, changes }: a new
// document (the one passed in is never changed) and the change list the ceremony and the panels
// read. It throws MetaError with that same sentence if called when it can't happen.
//
// A loaded profile is reconciled first (meta/reconcile.js fits every part); a hand-built one (a
// tool's, a test's) may lack a part, which reads as empty and is written as a new one (writable).

import { canPay, missing, pay, scale } from './costs.js';
import { levelOf, rankOf, treeTier, researchTier, researchSlots, researchDone, researchActive, resolveContent, reached } from './state.js';

export class MetaError extends Error {
  constructor(msg) { super(msg); this.name = 'MetaError'; }
}

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
/** What a profile has of a part that's a table of counts ({} when it has none of the right kind). */
export const partOf = (doc, part) => (isObj(doc?.profile?.[part]) ? doc.profile[part] : {});

/**
 * A copy of the profile to write to, with the `parts` about to be written fitted: a part missing
 * or of the wrong kind starts empty (research as { done: [], active: [] }), so a write never
 * throws halfway and never keeps junk. The rest is copied as it is.
 */
export function writable(doc, parts) {
  const out = structuredClone(doc);
  if (!isObj(out.profile)) out.profile = {};
  for (const k of parts) {
    if (k === 'research') { if (!isObj(out.profile.research)) out.profile.research = { done: [], active: [] }; } else if (!isObj(out.profile[k])) out.profile[k] = {};
  }
  return out;
}

const nameOf = (data, id) => data.materials.find((m) => m.id === id)?.name ?? id;
/** A building's name from the data, to start a sentence ("The Library"). */
const buildingName = (data, id) => data.buildings.find((b) => b.id === id)?.name ?? id;

/** "4 Drowned Pages, 10 Coin" for what's missing. */
export function shortText(data, have, cost) {
  return missing(have, cost).map((m) => `${m.need} ${nameOf(data, m.id)}`).join(', ');
}

/** The level of a building that first gives `key` (tree, researchTier) at least `value`, or null. */
export function levelFor(data, buildingId, key, value) {
  const b = data.buildings.find((x) => x.id === buildingId);
  const i = b ? b.levels.findIndex((l) => (l[key] ?? 0) >= value) : -1;
  return i < 0 ? null : i + 1;
}

/** Content that became available between two resolveContent results: [{ what, id }]. */
export function newlyUnlocked(before, after) {
  const out = [];
  for (const [what, key] of [['character', 'characters'], ['weapon', 'weapons'], ['passive', 'passives'], ['relic', 'relics'], ['rune', 'runes'],
    ['recipe', 'recipes'], ['consumable', 'consumables'], ['arcana', 'arcana']]) {
    const had = new Set(before[key]);
    for (const id of after[key]) if (!had.has(id)) out.push({ what, id });
  }
  return out;
}

// ---------------------------------------------------------------- buildings

/** The cost of a building's next level, or null when it's fully restored (or unknown). */
export function nextLevelCost(doc, data, id) {
  const b = data.buildings.find((x) => x.id === id);
  if (!b) return null;
  const lv = levelOf(doc, id, data);
  return lv < b.levels.length ? b.levels[lv].cost : null;
}

/**
 * The milestone the fog in front of a building clears at, when it hasn't yet (its plot's
 * `openAt`, data/hub.js), else null: a ruin in the fog can't be walked up to or restored.
 */
export function fogOver(doc, data, id) {
  const at = data.hub.plots.find((p) => p.building === id)?.openAt;
  return at && at !== 'start' && !reached(doc, at, data) ? at : null;
}

export function whyNotRestore(doc, data, id) {
  const b = data.buildings.find((x) => x.id === id);
  if (!b) return `There is no building called "${id}".`;
  const cost = nextLevelCost(doc, data, id);
  if (!cost) return 'Already at max level';
  const fog = fogOver(doc, data, id);
  if (fog) return `Requires ${buildingName(data, fog.split(':')[0])} Lv ${fog.split(':')[1]}`;
  if (!canPay(partOf(doc, 'materials'), cost)) return `Need ${shortText(data, partOf(doc, 'materials'), cost)}`;
  return null;
}

/** Restore a building's next level: pay, level up, and report what it opened. */
export function restoreBuilding(doc, data, id) {
  const why = whyNotRestore(doc, data, id);
  if (why) throw new MetaError(why);
  const before = resolveContent(doc, data);
  const out = writable(doc, ['materials', 'buildings']);
  const cost = nextLevelCost(doc, data, id);
  out.profile.materials = pay(out.profile.materials, cost);
  const level = levelOf(doc, id, data) + 1;
  out.profile.buildings[id] = level;
  const unlocks = newlyUnlocked(before, resolveContent(out, data));
  return { doc: out, changes: [{ kind: 'building_level', id, level, cost, unlocks }] };
}

// ---------------------------------------------------------------- the Lamp Post's upgrades

/** The cost of an upgrade's next rank, or null at its last rank (or unknown). */
export function nextRankCost(doc, data, id) {
  const u = data.upgrades.find((x) => x.id === id);
  if (!u) return null;
  const r = rankOf(doc, id);
  return r < u.ranks ? scale(u.cost, r + 1) : null;
}

export function whyNotUpgrade(doc, data, id) {
  const u = data.upgrades.find((x) => x.id === id);
  if (!u) return `There is no upgrade called "${id}".`;
  if (rankOf(doc, id) >= u.ranks) return 'Already at max rank';
  if (treeTier(doc, data) < u.tier) {
    const lv = levelFor(data, 'lamp_post', 'tree', u.tier);
    return lv ? `Requires ${buildingName(data, 'lamp_post')} Lv ${lv}` : 'Not in this version';
  }
  const cost = nextRankCost(doc, data, id);
  if (!canPay(partOf(doc, 'materials'), cost)) return `Need ${shortText(data, partOf(doc, 'materials'), cost)}`;
  return null;
}

export function buyUpgrade(doc, data, id) {
  const why = whyNotUpgrade(doc, data, id);
  if (why) throw new MetaError(why);
  const out = writable(doc, ['materials', 'upgrades']);
  const cost = nextRankCost(doc, data, id);
  out.profile.materials = pay(out.profile.materials, cost);
  const rank = rankOf(doc, id) + 1;
  out.profile.upgrades[id] = rank;
  return { doc: out, changes: [{ kind: 'upgrade_rank', id, rank, cost }] };
}

// ---------------------------------------------------------------- Library research

export function whyNotResearch(doc, data, id) {
  const r = data.research.find((x) => x.id === id);
  if (!r) return `There is no research called "${id}".`;
  if (researchDone(doc).has(id)) return 'Already complete';
  const active = researchActive(doc);
  if (active.some((a) => a.id === id)) return 'Already in progress';
  if (researchTier(doc, data) < r.tier) {
    if (levelOf(doc, 'library', data) === 0) return `Requires ${buildingName(data, 'library')} Lv 1`;
    const lv = levelFor(data, 'library', 'researchTier', r.tier);
    return lv ? `Requires ${buildingName(data, 'library')} Lv ${lv}` : 'Not in this version';
  }
  const done = researchDone(doc);
  const need = r.requires.filter((q) => !done.has(q)).map((q) => data.research.find((x) => x.id === q)?.name ?? q);
  if (need.length) return `Requires research: ${need.join(', ')}`;
  const slots = researchSlots(doc, data);
  if (active.length >= slots) return `Research slots full (${active.length}/${slots})`;
  if (!canPay(partOf(doc, 'materials'), r.cost)) return `Need ${shortText(data, partOf(doc, 'materials'), r.cost)}`;
  return null;
}

/** Start a project: pay, and it finishes after its number of qualifying runs. */
export function startResearch(doc, data, id) {
  const why = whyNotResearch(doc, data, id);
  if (why) throw new MetaError(why);
  const r = data.research.find((x) => x.id === id);
  const out = writable(doc, ['materials', 'research']);
  out.profile.materials = pay(out.profile.materials, r.cost);
  out.profile.research.active = [...researchActive(doc), { id, runsLeft: r.runs }];
  return { doc: out, changes: [{ kind: 'research_started', id, runs: r.runs, cost: r.cost }] };
}
