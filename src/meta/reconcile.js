// A loaded profile against this build's content (ARCHITECTURE §10.1, §12.2). Pure; tested.
//
// A save can name things this build doesn't have: content renamed or removed, or a save from a
// newer build with more in it (every .exe shares one save file, so an older one can open a newer
// one's save). Nothing the player earned is deleted: anything unknown moves to profile.orphans (by
// kind), merged with what's already there, and whatever this build knows again comes back out of
// orphans on the next load. Levels and ranks above what the content allows are held at the top,
// with the full value kept in orphans, so a build with more levels gives them back.
//
// Everything else is brought into range on every load: counts as whole numbers, 0 or more (a
// count stored as text is read as the number it says); a running project's runs left between 1
// and its own number of runs; a project never both running and done.

import { countOf } from './costs.js';
import { codexKeys, orderAliases, isUnlocked } from './state.js';
import { retireOld } from './retired.js';
import { GEAR_TIERS } from '../data/gear.js';

/**
 * Unlock keys that moved: content that opened on `was` in an older build opens on `now` in this one.
 * A save that had met `was` when it first loads on a build with the row holds `now` from then on
 * (profile.kept; meta/state.js contentOpen), so nothing it could play or draw is taken away. Each
 * row is judged once per save (profile.keptThrough counts the rows judged): a harbor built after
 * the move earns the content the new way. When an unlock key changes in src/data, add a row here.
 * Rows are only ever added at the end.
 */
export const MOVED_UNLOCKS = Object.freeze([
  Object.freeze({ was: 'building:tavern:1', now: 'building:lamp_post:2' }),       // the Harpooner (0.8.0)
  Object.freeze({ was: 'research:tide_charts', now: 'research:signal_codes' }),   // Undertow (0.8.2)
  Object.freeze({ was: 'research:almanac', now: 'research:drowned_charms' }),     // the Lucky Knot (0.8.2)
  // The sweep, X2 (ruling 12): three run tools the Apothecary's levels sold open with an order or a project now.
  Object.freeze({ was: 'building:apothecary:2', now: 'feat:maw_slayer' }),        // the Gull Bone
  Object.freeze({ was: 'building:apothecary:1', now: 'feat:dawn' }),              // the Smelling Salts
  Object.freeze({ was: 'building:apothecary:2', now: 'research:herb_notes' }),    // the Black Pebble
]);
/** The most held keys a save can carry (a list far longer than any build could write is not a save's). */
const KEPT_MAX = 256;

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
/** A count, reading a number stored as text too ("12" -> 12). */
const countIn = (v) => countOf(typeof v === 'string' && v.trim() !== '' ? Number(v) : v);

/** Returns { doc, moved, restored }: always a new, fitted document, and what moved each way. */
export function reconcileProfile(doc, data) {
  const out = structuredClone(doc);
  if (!isObj(out.profile)) out.profile = {};
  if (!isObj(out.stats)) out.stats = {};
  const P = out.profile;
  for (const k of ['materials', 'buildings', 'upgrades', 'bestiary', 'orphans', 'consumables']) if (!isObj(P[k])) P[k] = {};
  if (!isObj(P.research)) P.research = {};
  const O = P.orphans;
  const moved = [], restored = [];
  // What the sweep retired (arcana, tonics, challenge runs, the bestiary's rungs) is mapped to what it
  // became first, once per save, so the fitting below sees today's shapes (meta/retired.js).
  moved.push(...retireOld(out, data));
  // The retired lists are no longer part of a profile (save/schema.js): empty, they go; holding
  // anything (a save an older build wrote to since), they stay as they are, untouched and unread.
  if (isObj(P.bestiaryClaimed) && !Object.keys(P.bestiaryClaimed).length) delete P.bestiaryClaimed;
  if (Array.isArray(P.challenges) && !P.challenges.length) delete P.challenges;
  const bucket = (kind) => { if (!isObj(O[kind])) O[kind] = {}; return O[kind]; };
  const known = (list) => new Set(list.map((x) => x.id));
  const byId = (list, id) => list.find((x) => x.id === id);

  // ---------------------------------------------------------------- orphans this build knows again

  const mats = known(data.materials);
  for (const [id, v] of Object.entries(bucket('materials'))) {
    if (!mats.has(id)) continue;
    P.materials[id] = countIn(P.materials[id]) + countIn(v);
    delete O.materials[id];
    restored.push(`materials:${id}`);
  }
  for (const [kind, list, max] of [['buildings', data.buildings, (x) => x.levels.length], ['upgrades', data.upgrades, (x) => x.ranks]]) {
    for (const [id, v] of Object.entries(bucket(kind))) {
      const def = byId(list, id);
      if (!def) continue;
      const cur = countIn(P[kind][id]), was = countIn(v);
      if (was > cur) P[kind][id] = Math.min(was, max(def));
      // The part above this build's top stays set aside for a build that has it.
      if (was > max(def)) continue;
      delete O[kind][id];
      restored.push(`${kind}:${id}`);
    }
  }
  const res = known(data.research);
  const oldDone = Array.isArray(P.research.done) ? P.research.done.filter((x) => typeof x === 'string') : [];
  const unreadableDone = Array.isArray(P.research.done) ? P.research.done.filter((x) => typeof x !== 'string') : [];
  const oldActive = Array.isArray(P.research.active) ? P.research.active : [];
  const backDone = [], backActive = [];
  for (const [id, v] of Object.entries(bucket('research'))) {
    if (!res.has(id)) continue;
    if (v === 'done') backDone.push(id); else backActive.push({ id, runsLeft: isObj(v) ? v.runsLeft : v });
    delete O.research[id];
    restored.push(`research:${id}`);
  }
  const codex = new Set(codexKeys(data));
  const oldCodex = Array.isArray(P.codex) ? P.codex.filter((k) => typeof k === 'string') : [];
  const unreadableCodex = Array.isArray(P.codex) ? P.codex.filter((k) => typeof k !== 'string') : [];
  const setAsideCodex = Array.isArray(O.codex) ? O.codex.filter((k) => typeof k === 'string') : [];
  const backCodex = setAsideCodex.filter((k) => codex.has(k));
  O.codex = setAsideCodex.filter((k) => !codex.has(k));
  for (const k of new Set(backCodex)) restored.push(`codex:${k}`);
  const enemyIds = known(data.enemies);
  for (const [id, v] of Object.entries(bucket('bestiary'))) {
    if (!enemyIds.has(id)) continue;
    P.bestiary[id] = countIn(P.bestiary[id]) + countIn(v);
    delete O.bestiary[id];
    restored.push(`bestiary:${id}`);
  }

  // ---------------------------------------------------------------- what this build doesn't know

  // Set aside, merged with anything already set aside under the same name.
  const setAside = (kind, id, v, merge) => {
    const b = bucket(kind);
    b[id] = id in b ? merge(b[id], v) : v;
    moved.push(`${kind}:${id}`);
  };
  const add = (a, b) => countIn(a) + countIn(b);
  const most = (a, b) => Math.max(countIn(a), countIn(b));
  // A project this build doesn't know, listed twice: 'done' over running, else the fewer runs left.
  const runsLeftOf = (r) => { const v = isObj(r) ? Number(r.runsLeft) : NaN; return Number.isFinite(v) ? v : Infinity; };
  const furtherAlong = (a, b) => (a === 'done' || b === 'done' ? 'done' : runsLeftOf(b) < runsLeftOf(a) ? b : a);

  for (const [id, v] of Object.entries(P.materials)) {
    if (!mats.has(id)) { setAside('materials', id, v, add); delete P.materials[id]; } else P.materials[id] = countIn(v);
    if (P.materials[id] === 0) delete P.materials[id];
  }
  for (const [kind, list, max] of [['buildings', data.buildings, (x) => x.levels.length], ['upgrades', data.upgrades, (x) => x.ranks]]) {
    for (const [id, v] of Object.entries(P[kind])) {
      const def = byId(list, id);
      if (!def) { setAside(kind, id, v, most); delete P[kind][id]; continue; }
      const n = countIn(v);
      if (n > max(def)) { setAside(kind, id, n, most); P[kind][id] = max(def); } else P[kind][id] = n;
    }
  }
  // Research: done wins over running; a known project is never dropped; runs left brought in range.
  const done = new Set();
  for (const id of [...oldDone, ...backDone]) {
    if (res.has(id)) done.add(id);
    else setAside('research', id, 'done', () => 'done');
  }
  // Entries no build can read (not an id: running, finished, or seen) are kept too, every one of
  // them, in a list: research's with research's, the codex's under unreadable.codex.
  const keepUnreadable = (kind, id, list) => { if (list.length) setAside(kind, id, list, (a, b) => [...(Array.isArray(a) ? a : [a]), ...b]); };
  keepUnreadable('research', 'unreadable', unreadableDone);
  const active = new Map();
  for (const r of [...oldActive, ...backActive]) {
    const id = isObj(r) && typeof r.id === 'string' ? r.id : null;
    if (!id) { keepUnreadable('research', 'unreadable', [r]); continue; }
    if (!res.has(id)) { setAside('research', id, r, furtherAlong); continue; }
    if (done.has(id)) continue;
    const def = byId(data.research, id);
    const raw = typeof r.runsLeft === 'string' ? Number(r.runsLeft) : r.runsLeft;
    const left = Number.isFinite(raw) ? Math.min(def.runs, Math.max(1, Math.ceil(raw))) : def.runs;
    // The same project twice: keep the one further along.
    if (!active.has(id) || active.get(id).runsLeft > left) active.set(id, { id, runsLeft: left });
  }
  P.research = { done: [...done], active: [...active.values()] };
  // The codex and the bestiary.
  const keepCodex = [];
  // An evolved weapon (retired in 0.9.0) is its base weapon now: the base joins the codex, and the
  // old key is set aside as anything unknown is (data/ascensions.js RETIRED_WEAPONS).
  const retired = data.retiredWeapons || {};
  // (Sets throughout: every pass over a save's lists is linear, however long a crafted list is.)
  const haveCodex = new Set(oldCodex);
  for (const k of oldCodex) {
    const r = k.startsWith('weapon:') && Object.hasOwn(retired, k.slice(7)) ? retired[k.slice(7)] : null;
    if (r && codex.has(`weapon:${r.weapon}`)) haveCodex.add(`weapon:${r.weapon}`);
  }
  const asideCodex = new Set(O.codex);
  for (const k of new Set([...haveCodex, ...backCodex])) {
    if (codex.has(k)) keepCodex.push(k);
    else { if (!asideCodex.has(k)) { asideCodex.add(k); O.codex.push(k); } moved.push(`codex:${k}`); }
  }
  P.codex = keepCodex;
  keepUnreadable('unreadable', 'codex', unreadableCodex);
  if (!O.codex.length) delete O.codex;
  for (const [id, v] of Object.entries(P.bestiary)) {
    if (!enemyIds.has(id)) { setAside('bestiary', id, v, add); delete P.bestiary[id]; } else P.bestiary[id] = countIn(v);
  }
  // ---------------------------------------------------------------- unlock keys that moved

  // Judged here, with buildings and research fitted: each row not yet judged for this save holds
  // its new key when the save had met the old one (met outright, or held from an earlier move).
  // Keys held by a build with more rows are kept as they are.
  {
    const table = data.movedUnlocks || MOVED_UNLOCKS;
    const kept = new Set((Array.isArray(P.kept) ? P.kept : []).filter((x) => typeof x === 'string' && x.length <= 80).slice(0, KEPT_MAX));
    const through = countIn(P.keptThrough);
    for (let i = Math.min(through, table.length); i < table.length; i++) {
      const { was, now: to } = table[i];
      if (kept.has(to) || isUnlocked(out, data, to)) continue;
      if (isUnlocked(out, data, was) || kept.has(was)) kept.add(to);
    }
    if (kept.size) P.kept = [...kept]; else delete P.kept;
    P.keptThrough = Math.max(through, table.length);
  }

  // ---------------------------------------------------------------- Phase 7's parts (v3)

  // Lists of ids (feats done and found, challenge runs won): known ones kept, the rest set aside,
  // and set-aside ones this build knows again brought back.
  // An order merged into another (the sweep, C6: data/feats.js `was`) is rewritten to the order it
  // became, wherever it's listed (done, found, held, or set aside by a build that didn't know it), so
  // it stays done and nothing of it is orphaned. Orders held from before the Tavern (D3: featsHeld)
  // are fitted like the rest; a profile without the list gets none.
  const merged = orderAliases(data);
  const now = (x) => merged.get(x) ?? x;
  for (const [key, list] of [['feats', data.feats || []], ['featsFound', data.feats || []], ['featsHeld', data.feats || []]]) {
    if (key === 'featsHeld' && P[key] === undefined && O[key] === undefined) continue;
    const ids = new Set(list.map((x) => x.id));
    const order = true;
    const have = [...new Set((Array.isArray(P[key]) ? P[key].filter((x) => typeof x === 'string') : []).map((x) => (order ? now(x) : x)))];
    const aside = [...new Set((Array.isArray(O[key]) ? O[key].filter((x) => typeof x === 'string') : []).map((x) => (order ? now(x) : x)))];
    const back = aside.filter((x) => ids.has(x));
    const keep = [...new Set([...have.filter((x) => ids.has(x)), ...back])];
    const away = [...new Set([...aside.filter((x) => !ids.has(x)), ...have.filter((x) => !ids.has(x))])];
    for (const x of back) restored.push(`${key}:${x}`);
    for (const x of have) if (!ids.has(x)) moved.push(`${key}:${x}`);
    P[key] = keep;
    if (away.length) O[key] = away; else delete O[key];
  }
  // An order both held and counted is counted.
  if (Array.isArray(P.featsHeld)) {
    const counted = new Set(P.feats);
    P.featsHeld = P.featsHeld.filter((x) => !counted.has(x));
    if (!P.featsHeld.length) delete P.featsHeld;
  }
  // Run tools held: counts, set aside when this build doesn't know them.
  if (!isObj(P.consumables)) P.consumables = {};
  const heldIds = new Set((data.consumables || []).map((c) => c.id));
  const heldKnown = (k) => heldIds.has(k);
  for (const [k, v] of Object.entries(bucket('consumables'))) {
    if (!heldKnown(k)) continue;
    P.consumables[k] = countIn(P.consumables[k]) + countIn(v);
    delete O.consumables[k];
    restored.push(`consumables:${k}`);
  }
  for (const [k, v] of Object.entries(P.consumables)) {
    if (!heldKnown(k)) { setAside('consumables', k, v, add); delete P.consumables[k]; continue; }
    P.consumables[k] = countIn(v);
    if (P.consumables[k] === 0) delete P.consumables[k];
  }
  // The Market's rares bought since the last run (0.7.3): { run, rares }, whole numbers, or nothing.
  if (P.market !== undefined) {
    const M = isObj(P.market) ? P.market : {};
    const run = countIn(M.run), rares = countIn(M.rares);
    if (rares > 0) P.market = { run, rares }; else delete P.market;
  }
  // Gear: every item that names a recipe this build has is kept (its tier held to 1..5, its
  // affixes this build doesn't know left on it but ignored); an item of an unknown recipe is set
  // aside whole, and comes back when the recipe does. What's equipped must be held, in a slot.
  const G = isObj(P.gear) ? P.gear : (P.gear = {});
  const recipes = new Set((data.recipes || []).map((r) => r.id));
  const items = Array.isArray(G.inventory) ? G.inventory.filter(isObj) : [];
  const asideItems = Array.isArray(O.gear) ? O.gear.filter(isObj) : [];
  const keepItems = [], awayItems = [];
  for (const it of [...items, ...asideItems.filter((x) => recipes.has(x.id))]) {
    if (!recipes.has(it.id)) { awayItems.push(it); moved.push(`gear:${it.id}`); continue; }
    keepItems.push({ ...it, uid: Number.isInteger(it.uid) && it.uid > 0 ? it.uid : 0, tier: Math.min(GEAR_TIERS, Math.max(1, countIn(it.tier) || 1)), affixes: Array.isArray(it.affixes) ? it.affixes.filter((x) => typeof x === 'string') : [] });
  }
  for (const it of asideItems) if (recipes.has(it.id)) restored.push(`gear:${it.id}`); else awayItems.push(it);
  // Every item has a distinct uid; ones without get new ones past the highest.
  let next = keepItems.reduce((m, it) => Math.max(m, it.uid + 1), Math.max(countIn(G.next), 1));
  const uids = new Set();
  for (const it of keepItems) { if (!it.uid || uids.has(it.uid)) it.uid = next++; uids.add(it.uid); }
  G.inventory = keepItems;
  G.next = next;
  G.rolls = countIn(G.rolls);
  if (awayItems.length) O.gear = awayItems; else delete O.gear;
  const eq = isObj(G.equipped) ? G.equipped : {};
  G.equipped = {};
  const itemByUid = new Map(keepItems.map((x) => [x.uid, x]));
  const recipeById = new Map((data.recipes || []).map((x) => [x.id, x]));
  for (const [slot, uid] of Object.entries(eq)) {
    const it = itemByUid.get(uid);
    const r = it && recipeById.get(it.id);
    if (r && r.slot === slot) G.equipped[slot] = uid;
  }
  // The Tides, per map (save v4): what each map has opened, held to this build's Tides (the rest
  // set aside for a build with more, as a level above the top is); a map this build doesn't know
  // set aside whole, and brought back when it does. The last chosen is a whole number from 0 to
  // the most any map has opened.
  const tides = (data.tides || []).length;
  const maps = known(data.maps);
  if (!isObj(P.tides)) P.tides = {};
  const asideT = isObj(O.tides) ? O.tides : {};
  const TS = {};
  for (const id of new Set([...Object.keys(P.tides), ...Object.keys(asideT)])) {
    const total = Math.max(countIn(P.tides[id]), countIn(asideT[id]));
    const had = id in asideT;
    // Set aside (a map this build doesn't know, or more Tides than it has): reported as moved only
    // when the bucket gains something.
    const keepAside = () => {
      if (!had || countIn(asideT[id]) < total) moved.push(`tides:${id}`);
      asideT[id] = total;
    };
    if (!maps.has(id)) {
      if (total > 0) keepAside();
      continue;
    }
    if (total > tides) keepAside();
    else if (had) {
      delete asideT[id];
      restored.push(`tides:${id}`);
    }
    if (total > 0) TS[id] = Math.min(total, tides);
  }
  P.tides = TS;
  if (Object.keys(asideT).length) O.tides = asideT; else delete O.tides;
  // (A v3 save's `tide.unlocked` moved to `tides` in the migration; what's left is the last chosen.)
  const T = isObj(P.tide) ? P.tide : {};
  const top = Object.values(TS).reduce((m, v) => Math.max(m, v), 0);
  P.tide = { selected: Math.min(countIn(T.selected), top) };
  // The Salt Well's relics (v4): known ones kept, once each, the rest set aside and brought back.
  const relicIds = known(data.relics);
  const wellHave = Array.isArray(P.well) ? P.well.filter((x) => typeof x === 'string') : [];
  const wellAside = Array.isArray(O.well) ? O.well.filter((x) => typeof x === 'string') : [];
  for (const x of wellAside) if (relicIds.has(x)) restored.push(`well:${x}`);
  for (const x of wellHave) if (!relicIds.has(x)) moved.push(`well:${x}`);
  P.well = [...new Set([...wellHave, ...wellAside].filter((x) => relicIds.has(x)))];
  const wellAway = [...new Set([...wellAside, ...wellHave].filter((x) => !relicIds.has(x)))];
  if (wellAway.length) O.well = wellAway; else delete O.well;
  // What each map has shown (v4): a map this build knows keeps its list (names as text, once each);
  // one it doesn't is set aside whole, and comes back when it does.
  if (!isObj(P.seen)) P.seen = {};
  const seenAside = isObj(O.seen) ? O.seen : {};
  const SEEN = {};
  for (const id of new Set([...Object.keys(P.seen), ...Object.keys(seenAside)])) {
    const names = [...new Set([...(Array.isArray(P.seen[id]) ? P.seen[id] : []), ...(Array.isArray(seenAside[id]) ? seenAside[id] : [])].filter((x) => typeof x === 'string'))];
    if (maps.has(id)) {
      if (id in seenAside) {
        delete seenAside[id];
        restored.push(`seen:${id}`);
      }
      if (names.length) SEEN[id] = names;
    } else if (names.length) {
      if (!(id in seenAside)) moved.push(`seen:${id}`);
      seenAside[id] = names;
    }
  }
  P.seen = SEEN;
  if (Object.keys(seenAside).length) O.seen = seenAside; else delete O.seen;
  // The gate's last choices are preferences, not progress: anything this build can't use is reset
  // (meta/runconfig.js checks them again against what the profile has opened).
  const S = isObj(P.setup) ? P.setup : {};
  const str = (v) => (typeof v === 'string' ? v : '');
  P.setup = {
    character: str(S.character), kit: str(S.kit), mode: ['standard', 'short'].includes(S.mode) ? S.mode : 'standard',
    curses: Array.isArray(S.curses) ? S.curses.filter((c) => (data.curses || []).some((x) => x.id === c)) : [],
    heirloom: (data.relics || []).some((x) => x.id === S.heirloom) ? S.heirloom : '',
    consumables: Array.isArray(S.consumables) ? S.consumables.filter((c) => (data.consumables || []).some((x) => x.id === c)) : [],
    rune: '',   // (runes are gone: ruling 14; the field stays so the save's shape does)
    challenge: (data.challenges || []).some((x) => x.id === S.challenge) ? S.challenge : '',
    map: data.maps.some((x) => x.id === S.map) ? S.map : '',
  };

  // Lifetime numbers.
  for (const k of ['runs', 'playtimeSec', 'kills', 'deaths', 'bestTimeSec', 'bossKills', 'clears', 'lampsLit', 'bellsRung']) out.stats[k] = countIn(out.stats[k]);
  // Empty buckets go.
  for (const [k, v] of Object.entries(O)) if (isObj(v) && !Object.keys(v).length) delete O[k];

  return { doc: out, moved, restored };
}
