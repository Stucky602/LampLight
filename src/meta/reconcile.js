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
import { codexKeys } from './state.js';

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
/** A count, reading a number stored as text too ("12" -> 12). */
const countIn = (v) => countOf(typeof v === 'string' && v.trim() !== '' ? Number(v) : v);

/** Returns { doc, moved, restored }: always a new, fitted document, and what moved each way. */
export function reconcileProfile(doc, data) {
  const out = structuredClone(doc);
  if (!isObj(out.profile)) out.profile = {};
  if (!isObj(out.stats)) out.stats = {};
  const P = out.profile;
  for (const k of ['materials', 'buildings', 'upgrades', 'bestiary', 'orphans']) if (!isObj(P[k])) P[k] = {};
  if (!isObj(P.research)) P.research = {};
  const O = P.orphans;
  const moved = [], restored = [];
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
  if (backCodex.length) restored.push(...backCodex.map((k) => `codex:${k}`));
  for (const [id, v] of Object.entries(bucket('bestiary'))) {
    if (!data.enemies.some((e) => e.id === id)) continue;
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
  for (const k of new Set([...oldCodex, ...backCodex])) {
    if (codex.has(k)) keepCodex.push(k);
    else { if (!O.codex.includes(k)) O.codex.push(k); moved.push(`codex:${k}`); }
  }
  P.codex = keepCodex;
  keepUnreadable('unreadable', 'codex', unreadableCodex);
  if (!O.codex.length) delete O.codex;
  for (const [id, v] of Object.entries(P.bestiary)) {
    if (!data.enemies.some((e) => e.id === id)) { setAside('bestiary', id, v, add); delete P.bestiary[id]; } else P.bestiary[id] = countIn(v);
  }
  // Lifetime numbers.
  for (const k of ['runs', 'playtimeSec', 'kills', 'deaths', 'bestTimeSec']) out.stats[k] = countIn(out.stats[k]);
  // Empty buckets go.
  for (const [k, v] of Object.entries(O)) if (isObj(v) && !Object.keys(v).length) delete O[k];

  return { doc: out, moved, restored };
}
