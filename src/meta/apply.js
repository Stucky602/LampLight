// A finished run, folded into the profile (ARCHITECTURE §10.2 step 4). Pure; tested in Node.
//
// applyRunResult(doc, result, data) returns { doc, changes }: a new document (the one passed in
// is never changed) and the change list the results screen shows, in this order:
//   { kind: 'material', id, count }                 what the run brought home (all of it: a death
//                                                   costs time, not progress; §20 call 6)
//   { kind: 'time_pay', minutes, materials }        what the minutes it lasted paid (META.timePay)
//   { kind: 'research_step', id, runsLeft }         a qualifying run moved a project on
//   { kind: 'research_done', id, unlocks }          ...and finished it: [{ what, id }] now in runs
//   { kind: 'research_waiting', reason }            projects are running, but this run didn't count
//   { kind: 'codex', key, start? }                  seen for the first time ('weapon:flare_gun'; start: the run began with it)
//   { kind: 'best_time', seconds, previous }        the longest run so far
//   { kind: 'glass_coin', glass, count }            Sea Glass left over, bought by the Market as Coin
//   { kind: 'mastery', character, rank }            the character reached a new mastery rank
//   { kind: 'ledger', character, counts, best, bests } what the character's trade did this run ({ key: count }), the keys that beat the ledger's best, and the bests now
//   { kind: 'research_elsewhere', id, map, runsLeft } a project that counts only runs on another map didn't move (0.8.0)
//   { kind: 'tide', level, map }                    a Tide opened on that map (clearing it at the one below)
//   { kind: 'feat', id, unlocks, materials }        a Harbor Order done (a set run won and a Hunt finished are orders: the sweep, ruling 13)
//   { kind: 'feat_found', id }                      an 'after_found' feat now on the Tavern's list
//   { kind: 'orders_kept', ids }                    orders held from before the Tavern kept the board, counted now (D3)
//   { kind: 'well', id }                            a relic given to the Salt Well: the Ferryman offers it from now on (0.8.0)
//   { kind: 'sighted', map, names }                 what the map showed for the first time (the field guide; 0.8.0)
//   { kind: 'map_open', id }                        a map opened by this run (a boss its unlock needs killed, a feat)
//   { kind: 'arrival', id }                         a character this run brought (a feat, a challenge, a map): by boat
// Research with `runsOn` counts only runs on that map (0.8.0); the others say so.
// A run counts for research when it lasts META.researchQualifySec (5:00) or kills a boss, so
// quitting at once can't farm it, and a real attempt is never wasted (§10.2, §20 call 7).
// A run that used the tuning panel or its dev commands (result.devTools) marks the profile the
// way the harbor's dev commands do (profile.flags.devTools, §15).
//
// A result comes from the sim (sim/run-result.js buildRunResult); anything malformed in it (a
// number that isn't finite, a list that isn't a list) reads as nothing rather than throwing, so a
// damaged result can never cost the run's haul.

import { researchActive, researchDone, codexKeys, contentFrom, levelEffect, masteryOf, featsDone, featsHeld, resolveContent, mapsOpen, tidesOpened, seenOn } from './state.js';
import { judgeFeats } from './feats.js';
import { RETIRED_VERSION } from './retired.js';
import { countOf as count } from './costs.js';
import { clockText } from '../lib/text.js';

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const list = (v) => (Array.isArray(v) ? v : []);
const idOf = (x) => (typeof x === 'string' ? x : isObj(x) && typeof x.id === 'string' ? x.id : null);

/** Whole seconds survived (a non-finite or negative time reads as 0; 299.99 s is not yet 5:00). */
function secondsOf(result) {
  const t = Number(result.timeSurvived);
  return Number.isFinite(t) && t > 0 ? Math.floor(t + 1e-9) : 0;
}

/**
 * Does this run move research on? A boss counts when the result names one this build has (by
 * id, or { id }); anything else in the list, an empty or unknown name included, doesn't.
 */
export function qualifies(result, data) {
  const meta = data.meta;
  const known = new Set([...list(data.bosses).map((b) => b.id), ...list(data.enemies).filter((e) => e.boss).map((e) => e.id)]);
  const bosses = list(result.bossesKilled).filter((b) => known.has(idOf(b))).length;
  return secondsOf(result) >= meta.researchQualifySec || (meta.researchQualifyBoss && bosses > 0);
}

/** The sentence for a run that didn't count, from the rule itself. */
export function waitingReason(meta) {
  return `Research didn't progress. A run counts if you survive ${clockText(meta.researchQualifySec)}${meta.researchQualifyBoss ? ' or kill a boss' : ''}.`;
}

/**
 * Keys the run's build saw ('weapon:<id>', ...), for the codex. A weapon that evolved during the
 * run was still carried: its level record (weaponLevelMax) keeps the base id.
 */
function seenKeys(result) {
  const keys = [];
  // Secrets first: the results say what was found before what it gave.
  for (const id of list(result.secretsFound)) if (typeof id === 'string') keys.push(`secret:${id}`);
  for (const w of list(result.weapons)) { const id = idOf(w); if (id) keys.push(`weapon:${id}`); }
  if (isObj(result.weaponLevelMax)) for (const id of Object.keys(result.weaponLevelMax)) keys.push(`weapon:${id}`);
  for (const e of list(result.evolutions)) { const id = idOf(e); if (id) keys.push(`weapon:${id}`); }
  for (const p of list(result.passives)) { const id = idOf(p); if (id) keys.push(`passive:${id}`); }
  for (const r of list(result.relics)) { const id = idOf(r); if (id) keys.push(`relic:${id}`); }
  // C3 (ruling 18 P1): what each weapon took, for its codex page's ticks: its Form options, its
  // Rare and Epic lines, its Legendaries ('took:<weapon>:<id>'). Quiet: no line on the results.
  for (const w of list(result.weapons)) {
    const id = idOf(w);
    if (!id) continue;
    for (const k of [...list(w.forms), ...list(w.lines), ...list(w.specials)]) if (typeof k === 'string') keys.push(`took:${id}:${k}`);
  }
  return keys;
}

export function applyRunResult(doc, result, data) {
  if (!isObj(result)) throw new Error('applyRunResult: no run result');
  const out = structuredClone(doc);
  // (A loaded profile is reconciled first, meta/reconcile.js; these keep a hand-built one safe:
  // any part missing or of the wrong kind starts empty, and everything below reads the copy.)
  if (!isObj(out.profile)) out.profile = {};
  const P = out.profile;
  if (!isObj(out.stats)) out.stats = {};
  if (!isObj(P.materials)) P.materials = {};
  if (!isObj(P.bestiary)) P.bestiary = {};
  if (!isObj(P.research)) P.research = { done: [], active: [] };
  const st = out.stats;
  // A profile that plays a run on this build has nothing left for meta/retired.js to map (a loaded
  // one was mapped on load; a new one never held any of it).
  if (P.retired === undefined) P.retired = RETIRED_VERSION;
  const changes = [];
  // What was open before the run (the maps and characters it may bring), and the map it was on.
  const charsBefore = new Set(resolveContent(doc, data).characters);
  const mapsBefore = new Set(mapsOpen(doc, data));
  const runMap = data.maps.some((m) => m.id === result.map) ? result.map : data.maps[0].id;
  const mats = isObj(result.materials) ? result.materials : {};
  const kills = isObj(result.kills) ? result.kills : {};

  // Lifetime numbers.
  const secs = secondsOf(result);
  st.runs = count(st.runs) + 1;
  st.kills = count(st.kills) + count(result.totalKills);
  st.playtimeSec = count(st.playtimeSec) + secs;
  if (result.end === 'died') st.deaths = count(st.deaths) + 1;
  const prevBest = count(st.bestTimeSec);
  if (secs > prevBest) st.bestTimeSec = secs;

  // Materials: everything brought home, in the data's order.
  for (const m of data.materials) {
    const n = count(mats[m.id]);
    if (n === 0) continue;
    P.materials[m.id] = count(P.materials[m.id]) + n;
    changes.push({ kind: 'material', id: m.id, count: n });
  }

  // Time-survived pay (0.7.3): every whole minute up to the cap, so an early death brings something.
  const minutes = Math.min(Math.floor(secs / 60), data.meta.timePay?.capMinutes ?? 0);
  const paid = {};
  for (const [id, per] of Object.entries(data.meta.timePay?.perMinute ?? {})) {
    const n = count(per * minutes);
    if (n > 0 && data.materials.some((m) => m.id === id)) { paid[id] = n; P.materials[id] = count(P.materials[id]) + n; }
  }
  if (Object.keys(paid).length) changes.push({ kind: 'time_pay', minutes, materials: paid });

  // Research: every running project moves one run closer, if the run counts; one that counts only
  // runs on another map (`runsOn`, 0.8.0) waits, and says so.
  const active = researchActive(out);
  if (active.length) {
    if (qualifies(result, data)) {
      const done = researchDone(out);
      const still = [];
      const finished = [];
      for (const r of active) {
        const on = data.research.find((x) => x.id === r.id)?.runsOn;
        if (on !== undefined && on !== runMap) { still.push(r); changes.push({ kind: 'research_elsewhere', id: r.id, map: on, runsLeft: r.runsLeft }); continue; }
        const left = r.runsLeft - 1;
        if (left > 0) { still.push({ id: r.id, runsLeft: left }); changes.push({ kind: 'research_step', id: r.id, runsLeft: left }); } else { done.add(r.id); finished.push(r.id); }
      }
      P.research.active = still;
      P.research.done = [...done];
      for (const id of finished) changes.push({ kind: 'research_done', id, unlocks: contentFrom(data, `research:${id}`).map(({ what, id: x }) => ({ what, id: x })) });
    } else {
      changes.push({ kind: 'research_waiting', reason: waitingReason(data.meta) });
    }
  }

  // The codex: what this run's build saw for the first time.
  const known = new Set(Array.isArray(P.codex) ? P.codex : []);
  const valid = new Set(codexKeys(data));
  // The weapon the run started with is in hand from 0:00: seen, but no news on the results.
  const start = result.kit ?? data.characters.find((c) => c.id === result.character)?.start ?? null;
  for (const k of seenKeys(result)) {
    if (!valid.has(k) || known.has(k)) continue;
    known.add(k);
    if (k.startsWith('took:')) continue;   // (a tick on a weapon's page, said nowhere else)
    if (k.startsWith('secret:')) changes.push({ kind: 'codex', key: k, unlocks: contentFrom(data, k).map(({ what, id }) => ({ what, id })) });
    else changes.push({ kind: 'codex', key: k, ...(k === `weapon:${start}` ? { start: true } : {}) });
  }
  P.codex = [...known];

  // Kills per enemy, over every run (from the first run): the codex's enemy page shows them, and the
  // Hunts on the board read them (below, with the other orders).
  for (const e of data.enemies) {
    const n = count(kills[e.id]);
    if (n === 0) continue;
    P.bestiary[e.id] = count(P.bestiary[e.id]) + n;
  }

  // The longest run (the first run sets it without a line: there was nothing to beat).
  if (secs > prevBest && prevBest > 0) changes.push({ kind: 'best_time', seconds: secs, previous: prevBest });

  // ---------------------------------------------------------------- Phase 7

  // Bosses this build knows (an entry it can't read counts for nothing, as in `qualifies`).
  const bossIds = new Set(data.enemies.filter((e) => (e.tags || []).includes('boss')).map((e) => e.id));
  const bosses = list(result.bossesKilled).filter((b) => bossIds.has(isObj(b) ? b.id : b)).length;
  const cleared = result.end === 'cleared' || result.cleared === true;
  st.bossKills = count(st.bossKills) + bosses;
  st.clears = count(st.clears) + (cleared ? 1 : 0);
  st.lampsLit = count(st.lampsLit) + count(result.lampsLit);
  st.bellsRung = count(st.bellsRung) + count(result.bellsRung);
  const bump = (id, k) => { P.materials[id] = count(P.materials[id]) + k; };

  // Sea Glass left over: the Market buys it as Coin, from its level 2.
  const rate = levelEffect(out, data, 'market', 'glassToCoin');
  const glass = count(result.seaGlass);
  if (rate > 0 && glass > 0) {
    const coin = Math.floor(glass * rate);
    if (coin > 0) { bump('coin', coin); changes.push({ kind: 'glass_coin', glass, count: coin }); }
  }

  // Mastery: the character played gains XP (a point a minute, more for each boss); a new rank says so.
  const ch = data.characters.find((c) => c.id === result.character);
  if (ch) {
    if (!isObj(P.characters)) P.characters = {};
    const before = masteryOf(out, data, ch.id).rank;
    const M = data.tuning.mastery;
    const gain = Math.floor((secs / 60) * M.perMinute) + bosses * M.perBoss;
    const c = isObj(P.characters[ch.id]) ? P.characters[ch.id] : (P.characters[ch.id] = { unlocked: true, masteryXp: 0, skills: [] });
    c.masteryXp = count(c.masteryXp) + gain;
    const after = masteryOf(out, data, ch.id).rank;
    if (after > before) changes.push({ kind: 'mastery', character: ch.id, rank: after });
    // The character's ledger (ruling 14, item 12): clears by map and Tide, the best clear's time,
    // and the most their trade did in one run (result.trade: { key: count }, sim/run-result.js).
    const L = isObj(c.ledger) ? c.ledger : (c.ledger = {});
    if (!isObj(L.clears)) L.clears = {};
    if (!isObj(L.best)) L.best = {};
    if (result.end === 'cleared' && typeof result.map === 'string') {
      const key = `${result.map}:${count(result.tide)}`;
      L.clears[key] = count(L.clears[key]) + 1;
      if (!(count(L.time) > 0) || secs < L.time) L.time = Math.floor(secs);
    }
    // What their trade did this run, and which counts beat the ledger's best (ruling 19 PF: a line
    // on the results for the character played; a first run's counts are its bests, said plainly).
    const did = {}, beat = [];
    for (const [k, v] of Object.entries(isObj(result.trade) ? result.trade : {})) {
      if (!(count(v) > 0)) continue;
      did[k] = count(v);
      if (count(v) > count(L.best[k])) { if (count(L.best[k]) > 0) beat.push(k); L.best[k] = count(v); }
    }
    if (Object.keys(did).length) changes.push({ kind: 'ledger', character: ch.id, counts: did, best: beat, bests: { ...L.best } });
  }

  // Tides, per map (0.8.0, save v4): clearing a map at the highest Tide opened there opens its
  // next (Tide 1 from a first clear), one at a time: a challenge run's own Tide above it opens
  // nothing. (The Chapel caps which can be chosen, on every map alike: state.js tideAvailable.)
  if (!isObj(P.tides)) P.tides = {};
  const playedTide = count(result.tide);
  if (cleared && playedTide === tidesOpened(out, runMap) && playedTide < (data.tides || []).length) {
    P.tides[runMap] = playedTide + 1;
    changes.push({ kind: 'tide', level: playedTide + 1, map: runMap });
  }

  // Harbor Orders (feats) done (with the lifetime numbers this run added), and 'after_found' ones
  // discovered. Every order is judged from the first run (the sweep, D3: a first clear before the
  // Tavern earned nothing on the board, while the Salt Marsh's own unlock counted the same kill).
  // Until the Tavern keeps the board (its level 1) the innkeeper holds what was done
  // (profile.featsHeld): it opens nothing and says nothing yet, and restoring the Tavern counts it
  // (meta/actions.js restoreBuilding: "Bram kept count: 6 orders done"). The Chapel's Tide orders
  // count at once, as they did (0.9.0).
  const boardUp = levelEffect(out, data, 'tavern', 'feats') > 0;
  const featsBefore = featsDone(out, data);
  const heldBefore = featsHeld(out, data);
  const foundBefore = new Set(Array.isArray(P.featsFound) ? P.featsFound.filter((x) => typeof x === 'string') : []);
  const judged = judgeFeats(data, result, { ...st, enemyKills: P.bestiary, codex: P.codex }, new Set([...featsBefore, ...heldBefore]), foundBefore);
  const counted = judged.done.filter((f) => boardUp || f.group === 'tide');
  const kept = judged.done.filter((f) => !counted.includes(f));
  // (A board that is up with orders still held, a hand-built profile's: they count now.)
  const late = boardUp ? [...heldBefore] : [];
  if (counted.length || late.length) P.feats = [...featsBefore, ...late, ...counted.map((f) => f.id)];
  if (late.length) changes.push({ kind: 'orders_kept', ids: late });
  if (boardUp) delete P.featsHeld; else if (kept.length) P.featsHeld = [...heldBefore, ...kept.map((f) => f.id)];
  for (const f of counted) {
    for (const [id, k] of Object.entries(f.reward?.materials || {})) bump(id, k);
    changes.push({ kind: 'feat', id: f.id, unlocks: contentFrom(data, `feat:${f.id}`).map(({ what, id }) => ({ what, id })), materials: { ...(f.reward?.materials || {}) } });
  }
  if (judged.found.length) {
    P.featsFound = [...foundBefore, ...judged.found.map((f) => f.id)];
    // (Before the board is up there is no board to put it on: it is on it when the Tavern opens.)
    if (boardUp) for (const f of judged.found) changes.push({ kind: 'feat_found', id: f.id });
  }

  // ---------------------------------------------------------------- the Salt Marsh (0.8.0)

  // A relic given to the Salt Well: the Ferryman offers it in a Well slot, on every map.
  const given = typeof result.wellGiven === 'string' && data.relics.some((r) => r.id === result.wellGiven) ? result.wellGiven : null;
  if (given) {
    const was = Array.isArray(P.well) ? P.well.filter((x) => typeof x === 'string') : [];
    if (!was.includes(given)) { P.well = [...was, given]; changes.push({ kind: 'well', id: given }); } else P.well = was;
  }
  // What the map showed for the first time (the field guide in the pause menu).
  const sighted = list(result.sighted).filter((x) => typeof x === 'string');
  if (sighted.length) {
    const before = seenOn(out, runMap);
    const fresh = [...new Set(sighted)].filter((x) => !before.includes(x));
    if (fresh.length) {
      if (!isObj(P.seen)) P.seen = {};
      P.seen[runMap] = [...before, ...fresh];
      changes.push({ kind: 'sighted', map: runMap, names: fresh });
    }
  }
  // A map this run opened (a boss its unlock needs, a feat), and who this run brought (a feat, a
  // challenge, a secret): they come home by boat.
  for (const id of mapsOpen(out, data)) if (!mapsBefore.has(id)) changes.push({ kind: 'map_open', id });
  for (const id of resolveContent(out, data).characters) if (!charsBefore.has(id)) changes.push({ kind: 'arrival', id });

  if (result.devTools === true) P.flags = { ...(isObj(P.flags) ? P.flags : {}), devTools: true };
  return { doc: out, changes };
}
