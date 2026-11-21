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
import { levelOf, rankOf, treeTier, researchTier, researchSlots, researchDone, researchActive, resolveContent, reached, mapsOpen, mapOpen, mapMissing, parseUnlock, secretsOf, isUnlocked, featsDone, featsHeld } from './state.js';

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
  return missing(have, cost).map((m) => `${Number(m.need).toLocaleString('en-US')} ${nameOf(data, m.id)}`).join(', ');   // (round 4: 2,060, never 2060)
}

// ---------------------------------------------------------------- maps not open yet (0.8.0)

/** What an unlock key the data names can't be met by in this build reads as (never its raw id). */
const NOT_HERE = 'something not in this version';

/** A name from the data inside a sentence: a boss's "The Harbor Maw" reads "the Harbor Maw". */
const inLine = (name) => (name.startsWith('The ') ? `the ${name.slice(4)}` : name);

/**
 * One unlock key in plain words ("the Docks at Lv 1", "the Harbor Maw killed"), for every kind
 * state.js parseUnlock reads; '' for 'starter' (nothing to do). A key this build can't read, or one
 * naming something it doesn't have, says so instead of showing the id.
 */
export function unlockText(data, key) {
  const u = parseUnlock(key);
  const name = (list) => (list || []).find((x) => x.id === u.id)?.name ?? null;
  const say = (n, text) => (n ? text(n) : NOT_HERE);
  switch (u.kind) {
    case 'starter': return '';
    case 'building': return say(name(data.buildings), (n) => `the ${n} at Lv ${u.level}`);
    case 'boss': return say(name(data.enemies), (n) => `${inLine(n)} killed`);
    case 'feat': return say(name(data.feats), (n) => `the ${n} order done`);
    case 'research': return say(name(data.research), (n) => `${n} researched`);
    case 'challenge': return say(name(data.feats), (n) => `the ${n} order done`);
    case 'map': return say(name(data.maps), (n) => `the ${n} open`);
    case 'secret': return say(name(secretsOf(data)), (n) => `the ${n} found`);
    case 'mastery': return say(name(data.characters), (n) => `the ${n} at mastery rank ${u.level}`);
    default: return NOT_HERE;
  }
}

/** Unlock keys in plain words, joined: "the Docks at Lv 1, the Harbor Maw killed, and the Tavern at Lv 1". */
export function mapKeysText(data, keys) {
  const parts = [...new Set(keys.map((k) => unlockText(data, k)).filter(Boolean))];
  return parts.length < 3 ? parts.join(' and ') : `${parts.slice(0, -1).join(', ')}, and ${parts.at(-1)}`;
}

/**
 * What a map still waits on, in plain words ("Needs the Docks at Lv 1 and the Harbor Maw killed."),
 * from its missing unlock keys.
 */
export function mapNeedsText(data, mapId, missingKeys) {
  const list = mapKeysText(data, missingKeys);
  return list ? `Needs ${list}.` : '';
}

/** The map a material drops on alone (its `maps` names one map this build has), or null. */
function onlyMapOf(data, matId) {
  const m = data.materials.find((x) => x.id === matId);
  const id = Array.isArray(m?.maps) && m.maps.length === 1 ? m.maps[0] : null;
  return id && data.maps.some((x) => x.id === id) ? id : null;
}

/**
 * The maps not open yet that something waits on: a project's `runsOn`, and the only map a
 * material still short of `cost` drops on. [map id], in the data's order.
 */
export function closedMapsFor(doc, data, cost, runsOn = null) {
  const want = new Set(missing(partOf(doc, 'materials'), cost || {}).map((m) => onlyMapOf(data, m.id)).filter(Boolean));
  if (runsOn) want.add(runsOn);
  return data.maps.filter((m) => want.has(m.id) && !mapOpen(doc, data, m.id)).map((m) => m.id);
}

/** ", which needs the Harbor Maw killed and the Tavern at Lv 1" for a map not open yet ('' when nothing readable is missing). */
function whichNeeds(doc, data, mapId) {
  const keys = mapKeysText(data, mapMissing(doc, data, mapId));
  return keys ? `, which needs ${keys}` : ', which isn\'t open yet';
}

/** A project that counts only runs on a map not open yet: "Opens with the Salt Marsh, which needs the Harbor Maw killed and the Tavern at Lv 1". */
export function opensWithText(doc, data, mapId) {
  const name = data.maps.find((x) => x.id === mapId)?.name;
  return name ? `Opens with the ${name}${whichNeeds(doc, data, mapId)}` : 'Not in this version';
}

/**
 * "Need 25 Marsh Herbs", and, for each map not open yet that a short material drops on alone,
 * where it comes from: "Need 25 Marsh Herbs. Marsh Herbs drop only on the Salt Marsh, which needs
 * the Harbor Maw killed and the Tavern at Lv 1".
 */
export function needText(doc, data, cost) {
  const have = partOf(doc, 'materials');
  const short = missing(have, cost).map((m) => m.id);
  const lines = [`Need ${shortText(data, have, cost)}`];
  for (const mapId of closedMapsFor(doc, data, cost)) {
    const mats = short.filter((id) => onlyMapOf(data, id) === mapId).map((id) => nameOf(data, id));
    // "Salt Glass drops", "Marsh Herbs drop", "Marsh Herbs and Salt Glass drop" (a name ending in
    // a single s is a plural: Herbs, Pages, Scraps; Glass is not).
    const verb = mats.length > 1 || /[^s]s$/.test(mats[0]) ? 'drop' : 'drops';
    const list = mats.length < 3 ? mats.join(' and ') : `${mats.slice(0, -1).join(', ')}, and ${mats.at(-1)}`;
    lines.push(`${list} ${verb} only on the ${data.maps.find((m) => m.id === mapId).name}${whichNeeds(doc, data, mapId)}`);
  }
  return lines.join('. ');
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
  for (const [what, key] of [['character', 'characters'], ['weapon', 'weapons'], ['passive', 'passives'], ['relic', 'relics'],
    ['recipe', 'recipes'], ['consumable', 'consumables'], ['trophy', 'trophies'], ['form', 'forms']]) {   // form: a capstone the Library opens (0.9.0)
    const had = new Set(before[key] || []);
    for (const id of after[key] || []) if (!had.has(id)) out.push({ what, id });
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

/** A refusal for a building's level not yet reached: "Restore the Smithy first", "Needs the Smithy at Lv 3". */
export function needsLevel(data, id, lv) {
  const name = buildingName(data, id);
  return Number(lv) <= 1 ? `Restore the ${name} first` : `Needs the ${name} at Lv ${lv}`;
}

/**
 * What a building's next level waits on besides the fog (data/buildings.js `needs`, an unlock key:
 * the sweep, X3, D5, so the harbor hands its systems over a few runs apart): its refusal, or null.
 */
export function levelNeeds(doc, data, id) {
  const b = data.buildings.find((x) => x.id === id);
  const lv = b?.levels[levelOf(doc, id, data)];
  if (!lv?.needs || isUnlocked(doc, data, lv.needs)) return null;
  const u = parseUnlock(lv.needs);
  return u.kind === 'building' ? needsLevel(data, u.id, u.level) : `Needs ${unlockText(data, lv.needs)}`;
}

export function whyNotRestore(doc, data, id) {
  const b = data.buildings.find((x) => x.id === id);
  if (!b) return `There is no building called "${id}".`;
  const cost = nextLevelCost(doc, data, id);
  if (!cost) return 'Already at max level';
  const fog = fogOver(doc, data, id);
  if (fog) return `The fog still covers it. ${needsLevel(data, fog.split(':')[0], fog.split(':')[1])}`;
  const waits = levelNeeds(doc, data, id);
  if (waits) return waits;
  if (!canPay(partOf(doc, 'materials'), cost)) return needText(doc, data, cost);
  return null;
}

/** Restore a building's next level: pay, level up, and report what it opened. */
export function restoreBuilding(doc, data, id) {
  const why = whyNotRestore(doc, data, id);
  if (why) throw new MetaError(why);
  const before = resolveContent(doc, data);
  const mapsBefore = new Set(mapsOpen(doc, data));
  const out = writable(doc, ['materials', 'buildings']);
  const cost = nextLevelCost(doc, data, id);
  out.profile.materials = pay(out.profile.materials, cost);
  const level = levelOf(doc, id, data) + 1;
  out.profile.buildings[id] = level;
  // The level that puts up the Harbor Orders board counts what the innkeeper held (the sweep, D3):
  // orders done in runs before it. What they open is among this level's unlocks.
  let orders = [];
  if (data.buildings.find((x) => x.id === id).levels[level - 1].feats) {
    orders = [...featsHeld(doc, data)];
    if (orders.length) out.profile.feats = [...featsDone(doc, data), ...orders];
    delete out.profile.featsHeld;
  }
  const unlocks = newlyUnlocked(before, resolveContent(out, data));
  // A map the level opened (0.8.0: the Salt Marsh waits on the Docks and the Tavern too).
  const maps = mapsOpen(out, data).filter((m) => !mapsBefore.has(m));
  return { doc: out, changes: [{ kind: 'building_level', id, level, cost, unlocks, ...(maps.length ? { maps } : {}), ...(orders.length ? { orders } : {}) }] };
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
    return lv ? needsLevel(data, 'lamp_post', lv) : 'Not in this version';
  }
  const cost = nextRankCost(doc, data, id);
  if (!canPay(partOf(doc, 'materials'), cost)) return needText(doc, data, cost);
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
    if (levelOf(doc, 'library', data) === 0) return needsLevel(data, 'library', 1);
    const lv = levelFor(data, 'library', 'researchTier', r.tier);
    return lv ? needsLevel(data, 'library', lv) : 'Not in this version';
  }
  const done = researchDone(doc);
  const need = r.requires.filter((q) => !done.has(q)).map((q) => data.research.find((x) => x.id === q)?.name ?? q);
  if (need.length) return `Finish ${need.join(' and ')} first`;
  // A project that finds things for a building waits for that building (the sweep, D2: `needs`).
  const needs = researchNeeds(doc, data, r);
  if (needs) return needs;
  // A project that counts only runs on a map not open yet can't start: it could never finish.
  if (r.runsOn && !mapOpen(doc, data, r.runsOn)) return opensWithText(doc, data, r.runsOn);
  const slots = researchSlots(doc, data);
  if (active.length >= slots) {
    const more = levelFor(data, 'library', 'researchSlots', slots + 1);
    const lib = buildingName(data, 'library');
    return `The ${lib} is busy. Play runs until a project finishes${more ? `, or restore the ${lib} to Lv ${more}` : ''}`;
  }
  if (!canPay(partOf(doc, 'materials'), r.cost)) return needText(doc, data, r.cost);
  return null;
}

/**
 * What a project waits on besides its tier and the projects before it (data/research.js `needs`, an
 * unlock key): "Restore the Smithy first", or null when it has none or it's met.
 */
export function researchNeeds(doc, data, r) {
  if (!r?.needs || isUnlocked(doc, data, r.needs)) return null;
  const u = parseUnlock(r.needs);
  return u.kind === 'building' ? needsLevel(data, u.id, u.level) : `Needs ${unlockText(data, r.needs)}`;
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
