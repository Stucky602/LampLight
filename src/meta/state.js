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
 *   'secret:<id>'             once that map secret is found
 *   'feat:<id>'               once that feat is done (Phase 7)
 *   'challenge:<id>'          (before the sweep) a challenge run won: it is the order of that id now, read as 'feat:<id>'
 *   'boss:<id>'               once that boss has been killed on any run (the bestiary counts it; 0.8.0)
 *   'map:<id>'                once that map is open (its own `unlock` met; 0.8.0)
 *   'mastery:<char>:<rank>'   once that character reaches that mastery rank (0.9.0)
 *   'innate'                  never in a pool (a character's own weapon)
 * Anything else reads as { kind: 'unknown' } (the content test keeps data from doing that).
 */
export function parseUnlock(ref) {
  if (ref === 'starter' || ref === 'innate') return { kind: ref };
  if (typeof ref !== 'string') return { kind: 'unknown' };
  const parts = ref.split(':');
  if (parts[0] === 'research' && parts.length === 2 && parts[1]) return { kind: 'research', id: parts[1] };
  if (parts[0] === 'secret' && parts.length === 2 && parts[1]) return { kind: 'secret', id: parts[1] };
  if (parts[0] === 'feat' && parts.length === 2 && parts[1]) return { kind: 'feat', id: parts[1] };
  if (parts[0] === 'challenge' && parts.length === 2 && parts[1]) return { kind: 'challenge', id: parts[1] };
  if (parts[0] === 'boss' && parts.length === 2 && parts[1]) return { kind: 'boss', id: parts[1] };
  if (parts[0] === 'map' && parts.length === 2 && parts[1]) return { kind: 'map', id: parts[1] };
  if (parts[0] === 'mastery' && parts.length === 3 && parts[1] && /^[1-9]\d*$/.test(parts[2])) return { kind: 'mastery', id: parts[1], level: Number(parts[2]) };
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
  // 'runs:<n>': that many runs played (the gate's waving townswoman, from the tenth).
  const r = /^runs:(\d+)$/.exec(key || '');
  if (r) { const n = Number(doc?.stats?.runs); return (Number.isFinite(n) ? n : 0) >= Number(r[1]); }
  // 'tide:<n>': a Tide that high opened, on any map (0.8.0: Tides are opened per map).
  const t = /^tide:(\d+)$/.exec(key || '');
  if (t) return highestTide(doc) >= Number(t[1]);
  // 'tide:<map>:<n>': that map's Tide n opened (0.9.0: townsfolk lines and props).
  const tm = /^tide:([a-z][a-z0-9_]*):(\d+)$/.exec(key || '');
  if (tm) return tidesOpened(doc, tm[1]) >= Number(tm[2]);
  // 'feat:<id>', 'boss:<id>', 'secret:<id>', 'mastery:<char>:<rank>', 'map:<id>' (0.9.0): read as unlock keys.
  if (/^(feat|boss|secret|map|challenge|research):[a-z0-9_]+$/.test(key || '') || /^mastery:[a-z0-9_]+:\d+$/.test(key || '')) return data ? isUnlocked(doc, data, key) : false;
  const m = /^([a-z][a-z0-9_]*):(\d+)$/.exec(key || '');
  return m ? levelOf(doc, m[1], data) >= Number(m[2]) : false;
}

/** The biggest value a building's reached levels give for an effect (researchSlots, tree, ...; data/buildings.js). */
export function levelEffect(doc, data, buildingId, key) {
  const b = data.buildings.find((x) => x.id === buildingId);
  if (!b) return 0;
  const lv = levelOf(doc, buildingId, data);
  let v = 0;
  for (let i = 0; i < lv; i++) if (Number.isFinite(b.levels[i][key])) v = Math.max(v, b.levels[i][key]);
  return v;
}

/** How many research projects can run at once (the Library's level). */
export function researchSlots(doc, data) { return levelEffect(doc, data, 'library', 'researchSlots') + levelEffect(doc, data, 'lighthouse', 'researchSlotsAdd'); }
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
  if (u.kind === 'feat') return featsDone(doc, data).has(u.id);
  if (u.kind === 'challenge') return featsDone(doc, data).has(u.id);
  if (u.kind === 'boss') return killsOf(doc, u.id) > 0;
  if (u.kind === 'map') return mapOpen(doc, data, u.id);
  if (u.kind === 'mastery') return masteryOf(doc, data, u.id).rank >= u.level;
  return false;
}

/**
 * Unlock keys this profile holds from before they moved (profile.kept; meta/reconcile.js
 * MOVED_UNLOCKS writes them once, on the first load after a move), as a Set. A save that had
 * content under the key it used to be on keeps it under the key it is on now.
 */
export function keptKeys(doc) {
  const k = doc?.profile?.kept;
  return new Set(Array.isArray(k) ? k.filter((x) => typeof x === 'string') : []);
}

/**
 * Is content with this `unlock` open to this profile: its key met, or held from before it moved?
 * Content only (what resolveContent lists, kits, Forms, props, map events). Buildings, research,
 * maps, and the townsfolk's lines read isUnlocked, so a held key opens nothing but content.
 */
export function contentOpen(doc, data, ref) {
  return isUnlocked(doc, data, ref) || (typeof ref === 'string' && Array.isArray(doc?.profile?.kept) && doc.profile.kept.includes(ref));
}

// ---------------------------------------------------------------- maps (0.8.0)

/** A map's `unlock` as a list of keys, every one needed (none: open from the start). */
export function mapUnlockKeys(map) {
  return map?.unlock === undefined ? [] : [].concat(map.unlock);
}

/** Is a map open: every key of its `unlock` met ('building:<id>:<n>', 'boss:<id>', 'feat:<id>', ...)? */
export function mapOpen(doc, data, mapId) {
  const m = data.maps.find((x) => x.id === mapId);
  // (A map can't be keyed to itself: 'map:<its id>' would never open.)
  return !!m && mapUnlockKeys(m).every((k) => k !== `map:${m.id}` && isUnlocked(doc, data, k));
}

/** The maps open to this profile, in the data's order (map 1 always). */
export function mapsOpen(doc, data) {
  return data.maps.filter((m) => mapOpen(doc, data, m.id)).map((m) => m.id);
}

/** The keys of a map's unlock this profile hasn't met yet. */
export function mapMissing(doc, data, mapId) {
  const m = data.maps.find((x) => x.id === mapId);
  return m ? mapUnlockKeys(m).filter((k) => !isUnlocked(doc, data, k)) : [];
}

/** The materials that drop on this map and no other (a material's own `maps`; Coin and Oil drop everywhere). */
export function mapOwnMaterials(data, mapId) {
  return data.materials.filter((m) => Array.isArray(m.maps) && !m.maps.includes('*') && m.maps.length === 1 && m.maps[0] === mapId).map((m) => m.id);
}

/** What a map has shown this profile in earlier runs (profile.seen: 'enemy:<id>', 'water', ...), in order. */
export function seenOn(doc, mapId) {
  const s = doc?.profile?.seen;
  const list = isObj(s) && Array.isArray(s[mapId]) ? s[mapId] : [];
  return [...new Set(list.filter((x) => typeof x === 'string'))];
}

/** Everything any map has shown this profile, as a Set. */
export function seenAnywhere(doc) {
  const s = doc?.profile?.seen;
  return new Set(isObj(s) ? Object.values(s).flatMap((v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [])) : []);
}

/** The relics given to the Salt Well (the Ferryman offers them in a Well slot on every map), known to this build. */
export function wellRelics(doc, data) {
  const w = doc?.profile?.well;
  return Array.isArray(w) ? [...new Set(w.filter((id) => typeof id === 'string' && data.relics.some((r) => r.id === id)))] : [];
}

// ---------------------------------------------------------------- kill counts

/** An enemy's lifetime kills (counted from the first run; the codex's enemy page shows it). */
export function killsOf(doc, enemyId) {
  return count(isObj(doc?.profile?.bestiary) ? doc.profile.bestiary[enemyId] : 0);
}

/**
 * Feats (Harbor Orders) done, as a Set of ids. With `data`, an order split out of an older one
 * (0.9.0: `doneWith`, the order that used to open its content) counts as done once that one is, so
 * a save that had earned the content keeps it.
 */
export function featsDone(doc, data = null) {
  const f = doc?.profile?.feats;
  const ids = Array.isArray(f) ? f.filter((x) => typeof x === 'string') : [];
  if (!data) return new Set(ids);
  // An order merged into another (the sweep, C6: `was`) is that one: done under either id, it's done.
  const now = orderAliases(data);
  const done = new Set(ids.map((x) => now.get(x) ?? x));
  for (const o of data.feats || []) if (o.doneWith && done.has(o.doneWith)) done.add(o.id);
  return done;
}

const aliasCache = new WeakMap();
/** Old order ids and the order each was merged into (data/feats.js `was`): a Map of old id to today's. */
export function orderAliases(data) {
  const list = data?.feats || [];
  let m = aliasCache.get(list);
  if (!m) {
    m = new Map();
    for (const o of list) for (const old of o.was || []) m.set(old, o.id);
    aliasCache.set(list, m);
  }
  return m;
}

/**
 * Orders done before the Tavern kept the board (the sweep, D3; profile.featsHeld): judged from the
 * first run, held by the innkeeper, and counted when the Tavern is restored (meta/actions.js
 * restoreBuilding). A Set of ids, without any already counted.
 */
export function featsHeld(doc, data = null) {
  const f = doc?.profile?.featsHeld;
  const now = data ? orderAliases(data) : new Map();
  const done = featsDone(doc, data);
  return new Set((Array.isArray(f) ? f.filter((x) => typeof x === 'string') : []).map((x) => now.get(x) ?? x).filter((x) => !done.has(x)));
}

/**
 * Is an order posted on the board for this profile? Every order is, but a set run (the sweep,
 * ruling 13: an order with `rules`): the Cartographer posts those from the level that carries
 * `challenges`, and one with `needs` (a mastery rank's trial, the Lighthouse's) once that is met.
 */
export function orderPosted(doc, data, f) {
  if (!f?.rules) return true;
  return levelEffect(doc, data, 'cartographer', 'challenges') > 0 && (f.needs === undefined || contentOpen(doc, data, f.needs));
}

/** Can a run set out carrying an Heirloom (the sweep, ruling 11: the Tavern's level that carries `heirloom`)? */
export function heirloomOpen(doc, data) {
  // (profile.heirloomHeld: a save that had opened an arcana before the sweep keeps the row, meta/retired.js.)
  return levelEffect(doc, data, 'tavern', 'heirloom') > 0 || doc?.profile?.heirloomHeld === true;
}

/**
 * The relics a run can carry as its Heirloom: found before (the codex has them) and in this
 * profile's pool, in the data's order. Empty until the Tavern opens the Heirloom.
 */
export function heirloomChoices(doc, data) {
  if (!heirloomOpen(doc, data)) return [];
  const seen = new Set(Array.isArray(doc?.profile?.codex) ? doc.profile.codex : []);
  return data.relics.filter((r) => seen.has(`relic:${r.id}`) && contentOpen(doc, data, r.unlock)).map((r) => r.id);
}

/**
 * What this profile can meet in a run: weapon, passive, and relic ids for the run's pools,
 * the characters it can play, and what the harbor can make or sell for a run: gear recipes,
 * consumables, and arcana (ARCHITECTURE §10.1 resolveContent).
 */
export function resolveContent(doc, data) {
  const ids = (list) => (list || []).filter((x) => contentOpen(doc, data, x.unlock)).map((x) => x.id);
  return {
    weapons: ids(data.weapons),
    passives: ids(data.passives),
    relics: ids(data.relics),
    characters: ids(data.characters),
    recipes: ids(data.recipes),
    consumables: ids(data.consumables),   // the run tools (data/consumables.js)
    trophies: ids(data.trophies),         // the Hunts' trophies (data/trophies.js)
    forms: formsOpenFor(doc, data),   // 0.9.0: the capstone Forms opened (RunConfig.forms)
  };
}

/**
 * A run's weapon, passive, and relic slots for this profile (0.9.0, the lead's rulings 3 and 4:
 * data/tuning.js SLOTS): { weapons, passives, relics }. runConfigFor sends them; a screen can show them.
 */
export function slotsFor(doc, data) {
  const S = data.slots, out = {};
  for (const k of ['weapons', 'passives', 'relics']) {
    const r = S[k], lv = levelOf(doc, r.building, data);
    out[k] = r.base + r.at.filter((at) => lv >= at).length;
  }
  return out;
}

/** The capstone Forms this profile has opened (0.9.0): those with no `unlock`, or one it has reached. */
export function formsOpenFor(doc, data) {
  return (data.ascensions || []).flatMap((l) => l.options).filter((o) => o.capstone && (o.unlock === undefined || contentOpen(doc, data, o.unlock))).map((o) => o.id);
}

/** The kinds of content an unlock key can bring, with their lists. */
export function contentKinds(data) {
  return [['character', data.characters], ['weapon', data.weapons], ['passive', data.passives], ['relic', data.relics],
    ['recipe', data.recipes || []], ['consumable', data.consumables || []], ['trophy', data.trophies || []],
    // 0.9.0: a starting kit, a challenge run, a harbor prop, and a skill can be opened by an order or a mastery rank.
    ['kit', (data.kits || []).filter((k) => k.unlock)], ['challenge', (data.challenges || []).filter((c) => c.unlock)],
    ['prop', (data.hub?.props || []).filter((p) => p.unlock)], ['skill', (data.skills || []).filter((p) => p.unlock)],
    // W4's map events (0.9.0): a deck entry an order opens.
    ['event', (data.maps || []).flatMap((m) => m.deck || []).filter((e) => e.unlock)],
    // C3 (ruling 18 P1): what a weapon's orders open: its temper and its early Legendary.
    ['temper', (data.weaponPerks || []).filter((x) => x.kind === 'temper')], ['early', (data.weaponPerks || []).filter((x) => x.kind === 'early')]];
}

/**
 * The ids of a map's event deck this profile has opened (0.9.0, W4): entries with no `unlock` are
 * always open, the rest once their key is met. null for a map without a deck (RunConfig leaves
 * mapEvents out, and the sim opens every entry).
 */
export function mapEventsOpen(doc, data, mapId) {
  const m = data.maps.find((x) => x.id === mapId);
  if (!m || !Array.isArray(m.deck)) return null;
  return m.deck.filter((e) => e.unlock === undefined || contentOpen(doc, data, e.unlock)).map((e) => e.id);
}

/** Is a challenge run open to this profile (its own `unlock`, when it has one; 0.9.0)? */
export function challengeOpen(doc, data, c) {
  return !!c && (c.unlock === undefined || contentOpen(doc, data, c.unlock));
}

/** Everything a key ('research:<id>', 'building:<id>:<level>', 'feat:<id>', ...) brings: [{ what, id, name }]. */
export function contentFrom(data, ref) {
  const out = [];
  for (const [what, list] of contentKinds(data)) {
    // (Round 2, L1 3: a starting weapon is named by its weapon, "New starting weapon: Flare Gun", never its kit's data name.)
    for (const x of list) if (x.unlock === ref) out.push({ what, id: x.id, name: what === 'kit' ? (data.weapons.find((w) => w.id === x.start)?.name ?? x.name) : x.name });
  }
  // A capstone Form the Library opens (0.9.0): { what: 'form', id, name, weapon }.
  for (const l of data.ascensions || []) for (const o of l.options) if (o.capstone && o.unlock === ref) out.push({ what: 'form', id: o.id, name: o.name, weapon: l.weapons[0] });
  return out;
}

// ---------------------------------------------------------------- Phase 7

/** The XP each mastery rank needs (META.masteryRanks: ten ranks since 0.7.3). */
export function masteryRanks(data) {
  return data.meta.masteryRanks ?? data.tuning.mastery.ranks;
}

/** A character's mastery XP and rank (0 to 10; META.masteryRanks). */
export function masteryOf(doc, data, character) {
  const c = doc?.profile?.characters?.[character];
  const xp = count(isObj(c) ? c.masteryXp : 0);
  const ranks = masteryRanks(data);
  let rank = 0;
  while (rank < ranks.length && xp >= ranks[rank]) rank++;
  return { xp, rank, next: rank < ranks.length ? ranks[rank] : null };
}

/**
 * The Tides opened on a map (0.8.0, save v4: profile.tides, map id to count). A Tide opens by
 * clearing that map at the one below it, so each map has its own ladder.
 */
export function tidesOpened(doc, mapId) {
  const t = doc?.profile?.tides;
  return count(isObj(t) ? t[mapId] : 0);
}

/** The highest Tide opened on any map ('tide:<n>' keys read this). */
export function highestTide(doc) {
  const t = doc?.profile?.tides;
  return isObj(t) ? Object.values(t).reduce((m, v) => Math.max(m, count(v)), 0) : 0;
}

/**
 * The highest Tide this profile may choose now on a map (map 1 when none is named): what that map
 * has opened, held to what the Chapel allows (the Chapel caps every map alike).
 */
export function tideAvailable(doc, data, mapId = data.maps[0].id) {
  return Math.min(tidesOpened(doc, mapId), levelEffect(doc, data, 'chapel', 'tideMax'), data.tides.length);
}

/** The curses that can be chosen now (the Chapel's level: the first n, in order). */
export function cursesAvailable(doc, data) {
  // (A save that had more from a lower Chapel level before the sweep keeps them: profile.cursesHeld, meta/retired.js.)
  return data.curses.slice(0, Math.max(levelEffect(doc, data, 'chapel', 'curses'), Math.min(data.curses.length, count(doc?.profile?.cursesHeld))));
}

/** A count held of a run tool ('<id>'). */
export function heldOf(doc, key) {
  return count(isObj(doc?.profile?.consumables) ? doc.profile.consumables[key] : 0);
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
 * and the parts it is made of: building levels, upgrade ranks, research, the run content seen (the
 * codex), feats, challenge runs, and Tides opened on every map; later phases add their systems to the same sum.
 */
export function completion(doc, data) {
  const parts = [];
  const add = (name, have, of) => parts.push({ name, have: Math.min(have, of), of });
  add('buildings', data.buildings.reduce((s, b) => s + levelOf(doc, b.id, data), 0), data.buildings.reduce((s, b) => s + b.levels.length, 0));
  add('upgrades', data.upgrades.reduce((s, u) => s + Math.min(rankOf(doc, u.id), u.ranks), 0), data.upgrades.reduce((s, u) => s + u.ranks, 0));
  const done = researchDone(doc);
  add('research', data.research.filter((r) => done.has(r.id)).length, data.research.length);
  const seen = new Set(Array.isArray(doc?.profile?.codex) ? doc.profile.codex : []);
  const keys = codexKeys(data).filter((k) => !k.startsWith('took:'));   // (a weapon page's ticks are its own count, not the codex's)
  add('codex', keys.filter((k) => seen.has(k)).length, keys.length);
  // Phase 7: feats, challenge runs, and the Tides cleared.
  const feats = featsDone(doc, data);
  add('feats', (data.feats || []).filter((f) => feats.has(f.id)).length, (data.feats || []).length);
  // Every map's own ladder of Tides (0.8.0).
  add('tides', data.maps.reduce((s, m) => s + Math.min(tidesOpened(doc, m.id), (data.tides || []).length), 0), data.maps.length * (data.tides || []).length);
  // 0.9.0: the codex's other groups (every enemy and boss killed once, every map open) and mastery's ranks.
  add('bestiary', data.enemies.filter((e) => killsOf(doc, e.id) > 0).length, data.enemies.length);
  add('maps', data.maps.filter((m) => mapOpen(doc, data, m.id)).length, data.maps.length);
  const ranks = masteryRanks(data).length;
  add('mastery', data.characters.reduce((s, c) => s + masteryOf(doc, data, c.id).rank, 0), data.characters.length * ranks);
  const have = parts.reduce((s, p) => s + p.have, 0), of = parts.reduce((s, p) => s + p.of, 0);
  return { percent: of > 0 ? Math.floor((have / of) * 100) : 0, parts };
}

/**
 * The codex's entries (brief §6.8): every weapon, passive, and relic, and
 * every map's secrets, as '<kind>:<id>' keys (ids are unique within a kind, not across kinds).
 * A found secret ('secret:<id>') also unlocks what is keyed to it.
 */
export function codexKeys(data) {
  return [...new Set([
    ...secretsOf(data).map((s) => `secret:${s.id}`),
    ...data.weapons.filter((w) => !w.innate).map((w) => `weapon:${w.id}`),
    ...data.passives.map((p) => `passive:${p.id}`),
    ...data.relics.map((r) => `relic:${r.id}`),
    // C3 (ruling 18 P1): each weapon's pieces, ticked on its codex page once a run has taken them.
    ...data.weapons.filter((w) => !w.innate).flatMap((w) => weaponPieces(data, w.id).map((x) => `took:${w.id}:${x.id}`)),
  ])];
}

/**
 * Everything a weapon can take in a run, for its codex page (C3, ruling 18 P1): its six Form
 * options (by axis), its Legendary specials, and its Rare and Epic lines, each
 * { kind: 'option' | 'special' | 'line', id, name, desc, axis?, price?, rarity?, shared? }.
 */
export function weaponPieces(data, weaponId) {
  const w = data.weapons.find((x) => x.id === weaponId);
  if (!w) return [];
  const line = (data.ascensions || []).find((l) => (l.weapons || []).includes(weaponId));
  return [
    ...(line?.options || []).map((o) => ({ kind: 'option', id: o.id, name: o.name, desc: o.desc, axis: o.axis, price: o.price ?? null, capstone: !!o.capstone })),
    ...(w.specials || []).map((x) => ({ kind: 'special', id: x.id, name: x.name, desc: x.desc })),
    ...(w.lines || []).map((x) => ({ kind: 'line', id: x.id, name: x.name, desc: x.desc, rarity: x.rarity, shared: !!x.shared })),
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
  return data.hub.props.filter((p) => (p.unlock ? contentOpen(doc, data, p.unlock) : reached(doc, p.from, data))).map(({ id, sprite, at }) => ({ id, sprite, at }));
}
