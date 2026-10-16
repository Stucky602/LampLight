// What the profile says, read and derived (ARCHITECTURE §10.1). Pure; tested in Node.
//
// The profile stores only what the player did: material counts, building levels, research done
// and running, upgrade ranks, flags. Everything else is worked out from those, here: what is in
// the run pools, how many research projects can run, which upgrades are open, which of the fog's
// regions have cleared, who and what is out in the harbor, each building's look, and the
// completion percentage.
//
// `doc` is a whole profile document (schema.js defaultProfile: { v, profile, stats }). `data` is
// the content bundle (src/data/index.js).

import { countOf as count } from './costs.js';

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

/**
 * Where a thing comes from: its `unlock` field read into { kind, id, level }.
 *   'starter'                 there from the start
 *   'research:<project>'      when that Library project is done
 *   'building:<id>:<level>'   when that building reaches that level
 *   'evolution', 'innate'     never in a pool (evolved into, or a character's own weapon)
 * Anything else reads as { kind: 'unknown' } (the content test keeps data from doing that).
 */
export function parseUnlock(ref) {
  if (ref === 'starter' || ref === 'evolution' || ref === 'innate') return { kind: ref };
  if (typeof ref !== 'string') return { kind: 'unknown' };
  const parts = ref.split(':');
  if (parts[0] === 'research' && parts.length === 2 && parts[1]) return { kind: 'research', id: parts[1] };
  if (parts[0] === 'secret' && parts.length === 2 && parts[1]) return { kind: 'secret', id: parts[1] };
  if (parts[0] === 'building' && parts.length === 3 && parts[1] && /^[1-9]\d*$/.test(parts[2])) return { kind: 'building', id: parts[1], level: Number(parts[2]) };
  return { kind: 'unknown' };
}

/** A building's level, 0 (ruin) to its last level; anything unreadable is 0. */
export function levelOf(doc, id, data = null) {
  const v = count(doc?.profile?.buildings?.[id]);
  const max = data ? (data.buildings.find((b) => b.id === id)?.levels.length ?? 0) : Infinity;
  return Math.min(v, max);
}

/** A key like 'library:3' or 'start' reached? (fog regions, props, and NPC lines use these). */
export function reached(doc, key, data = null) {
  if (key === 'start') return true;
  const m = /^([a-z][a-z0-9_]*):(\d+)$/.exec(key || '');
  return m ? levelOf(doc, m[1], data) >= Number(m[2]) : false;
}

/** The biggest value a building's reached levels give for an effect (researchSlots, tree, ...). */
function levelEffect(doc, data, buildingId, key) {
  const b = data.buildings.find((x) => x.id === buildingId);
  if (!b) return 0;
  const lv = levelOf(doc, buildingId, data);
  let v = 0;
  for (let i = 0; i < lv; i++) if (Number.isFinite(b.levels[i][key])) v = Math.max(v, b.levels[i][key]);
  return v;
}

/** How many research projects can run at once (the Library's level). */
export function researchSlots(doc, data) { return levelEffect(doc, data, 'library', 'researchSlots'); }
/** The highest research tier the Library has opened. */
export function researchTier(doc, data) { return levelEffect(doc, data, 'library', 'researchTier'); }
/** The highest tier of Lamp Post upgrades that can be bought. */
export function treeTier(doc, data) { return levelEffect(doc, data, 'lamp_post', 'tree'); }

/** Research projects finished, as a Set of ids. */
export function researchDone(doc) {
  const d = doc?.profile?.research?.done;
  return new Set(Array.isArray(d) ? d.filter((x) => typeof x === 'string') : []);
}

/**
 * Research projects running: [{ id, runsLeft }]. Every entry naming a project that isn't done is
 * running, once (the one furthest along), with its runs left read as a whole number, 1 or more
 * (an unreadable count reads as 1). A save the game loads is reconciled first (meta/reconcile.js),
 * which also holds each count to its project's own runs and gives an unreadable one the full
 * count; a hand-built profile read here is not held to the data, but no project is dropped.
 */
export function researchActive(doc) {
  const a = doc?.profile?.research?.active;
  if (!Array.isArray(a)) return [];
  const done = researchDone(doc);
  const byId = new Map();
  for (const r of a) {
    if (!isObj(r) || typeof r.id !== 'string' || done.has(r.id)) continue;
    const n = typeof r.runsLeft === 'string' && r.runsLeft.trim() !== '' ? Number(r.runsLeft) : r.runsLeft;
    const left = Number.isFinite(n) ? Math.max(1, Math.ceil(n)) : 1;
    if (!byId.has(r.id) || byId.get(r.id).runsLeft > left) byId.set(r.id, { id: r.id, runsLeft: left });
  }
  return [...byId.values()];
}

/** An upgrade's rank (0 when never bought). */
export function rankOf(doc, id) { return count(doc?.profile?.upgrades?.[id]); }

/** Is a thing with this `unlock` available to this profile? */
export function isUnlocked(doc, data, ref) {
  const u = parseUnlock(ref);
  if (u.kind === 'starter') return true;
  if (u.kind === 'research') return researchDone(doc).has(u.id);
  if (u.kind === 'building') return levelOf(doc, u.id, data) >= u.level;
  if (u.kind === 'secret') return Array.isArray(doc?.profile?.codex) && doc.profile.codex.includes(`secret:${u.id}`);
  return false;
}

/**
 * What this profile can meet in a run: weapon, passive, relic, and rune ids for the run's pools,
 * and the characters it can play (ARCHITECTURE §10.1 resolveContent).
 */
export function resolveContent(doc, data) {
  const ids = (list) => list.filter((x) => isUnlocked(doc, data, x.unlock)).map((x) => x.id);
  return {
    weapons: ids(data.weapons),
    passives: ids(data.passives),
    relics: ids(data.relics),
    runes: ids(data.runes),
    characters: ids(data.characters),
  };
}

/** Everything a key ('research:<id>' or 'building:<id>:<level>') brings: [{ what, id, name }]. */
export function contentFrom(data, ref) {
  const out = [];
  for (const [what, list] of [['character', data.characters], ['weapon', data.weapons], ['passive', data.passives], ['relic', data.relics], ['rune', data.runes]]) {
    for (const x of list) if (x.unlock === ref) out.push({ what, id: x.id, name: x.name });
  }
  return out;
}

/** Ids of the fog's regions that have cleared. */
export function revealedFog(doc, data) {
  return new Set(data.hub.fog.filter((f) => reached(doc, f.revealedBy, data)).map((f) => f.id));
}

/** Every map's secrets, in map order. */
export function secretsOf(data) {
  return data.maps.flatMap((m) => m.secrets || []);
}

/** The look of a building at a level: its stage name (ARCHITECTURE §10.4). */
export const STAGES = Object.freeze(['ruin', 'scaffold', 'roof', 'lit', 'keeper', 'alive']);
export function buildingStage(level) {
  return STAGES[Math.max(0, Math.min(STAGES.length - 1, count(level)))];
}


/**
 * How much of the game this profile has done, as a whole percentage (the title screen's number)
 * and the parts it is made of. Phase 5 counts building levels, upgrade ranks, research, and the
 * run content seen (the codex); later phases add their systems to the same sum.
 */
export function completion(doc, data) {
  const parts = [];
  const add = (name, have, of) => parts.push({ name, have: Math.min(have, of), of });
  add('buildings', data.buildings.reduce((s, b) => s + levelOf(doc, b.id, data), 0), data.buildings.reduce((s, b) => s + b.levels.length, 0));
  add('upgrades', data.upgrades.reduce((s, u) => s + Math.min(rankOf(doc, u.id), u.ranks), 0), data.upgrades.reduce((s, u) => s + u.ranks, 0));
  const done = researchDone(doc);
  add('research', data.research.filter((r) => done.has(r.id)).length, data.research.length);
  const seen = new Set(Array.isArray(doc?.profile?.codex) ? doc.profile.codex : []);
  const keys = codexKeys(data);
  add('codex', keys.filter((k) => seen.has(k)).length, keys.length);
  const have = parts.reduce((s, p) => s + p.have, 0), of = parts.reduce((s, p) => s + p.of, 0);
  return { percent: of > 0 ? Math.floor((have / of) * 100) : 0, parts };
}

/**
 * The codex's entries (brief §6.8): every weapon (evolutions too), passive, relic, and rune, and
 * every map's secrets, as '<kind>:<id>' keys (ids are unique within a kind, not across kinds).
 * A found secret ('secret:<id>') also unlocks what is keyed to it.
 */
export function codexKeys(data) {
  return [
    ...secretsOf(data).map((s) => `secret:${s.id}`),
    ...data.weapons.filter((w) => !w.innate).map((w) => `weapon:${w.id}`),
    ...data.passives.map((p) => `passive:${p.id}`),
    ...data.relics.map((r) => `relic:${r.id}`),
    ...data.runes.map((r) => `rune:${r.id}`),
  ];
}

/**
 * Who is out in the harbor for this profile (hub/world.js setPeople): each keeper by their door
 * from their building's level 4, walking the streets from level 5; and the characters you can
 * play, but the one you walk as, on the square's waiting spots in the data's order.
 */
export function hubPeople(doc, data) {
  const out = [];
  for (const n of data.npcs) {
    const lv = levelOf(doc, n.home, data), k = data.hub.keepers[n.id];
    if (lv < 4 || !k) continue;
    out.push({ id: n.id, sprite: n.sprite, kind: 'keeper', post: k.post, loop: lv >= 5 ? k.loop : null });
  }
  const spots = data.hub.waiting;
  const chars = resolveContent(doc, data).characters.filter((id) => id !== data.hub.avatar);
  chars.slice(0, spots.length).forEach((id, i) => {
    out.push({ id, sprite: data.characters.find((c) => c.id === id).sprite, kind: 'waiting', post: spots[i] });
  });
  return out;
}

/** What a keeper says now: the last of their lines whose milestone is reached, or null. */
export function npcLine(doc, data, id) {
  const n = data.npcs.find((x) => x.id === id);
  if (!n) return null;
  let line = null;
  for (const l of n.lines) if (reached(doc, l.when, data)) line = l.text;
  return line;
}

/** The harbor's props this profile has brought out (data/hub.js props): [{ id, sprite, at }]. */
export function shownProps(doc, data) {
  return data.hub.props.filter((p) => reached(doc, p.from, data)).map(({ id, sprite, at }) => ({ id, sprite, at }));
}
