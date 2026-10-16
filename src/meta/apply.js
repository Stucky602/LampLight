// A finished run, folded into the profile (ARCHITECTURE §10.2 step 4). Pure; tested in Node.
//
// applyRunResult(doc, result, data) returns { doc, changes }: a new document (the one passed in
// is never changed) and the change list the results screen shows, in this order:
//   { kind: 'material', id, count }                 what the run brought home (all of it: a death
//                                                   costs time, not progress; §20 call 6)
//   { kind: 'research_step', id, runsLeft }         a qualifying run moved a project on
//   { kind: 'research_done', id, unlocks }          ...and finished it: [{ what, id }] now in runs
//   { kind: 'research_waiting', reason }            projects are running, but this run didn't count
//   { kind: 'codex', key }                          seen for the first time ('weapon:flare_gun')
//   { kind: 'bestiary', id, kills }                 a lifetime kill count crossed a milestone
//   { kind: 'best_time', seconds, previous }        the longest run so far
//   { kind: 'glass_coin', glass, count }            Sea Glass left over, bought by the Market as Coin
//   { kind: 'mastery', character, rank }            the character reached a new mastery rank
//   { kind: 'tide', level }                         a Tide opened (clearing the one below it)
//   { kind: 'challenge', id, unlocks, materials }   a challenge run won
//   { kind: 'feat', id, unlocks, materials }        a feat done
//   { kind: 'feat_found', id }                      an 'after_found' feat now on the Tavern's list
// A run counts for research when it lasts META.researchQualifySec (5:00) or kills a boss, so
// quitting at once can't farm it, and a real attempt is never wasted (§10.2, §20 call 7).
// A run that used the tuning panel or its dev commands (result.devTools) marks the profile the
// way the harbor's dev commands do (profile.flags.devTools, §15).
//
// A result comes from the sim (sim/run-result.js buildRunResult); anything malformed in it (a
// number that isn't finite, a list that isn't a list) reads as nothing rather than throwing, so a
// damaged result can never cost the run's haul.

import { researchActive, researchDone, codexKeys, contentFrom, levelEffect, masteryOf, featsDone, challengesDone } from './state.js';
import { judgeFeats, challengeWon } from './feats.js';
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
 * run was still carried: its level record (weaponLevelMax) keeps the base id. Runes come as
 * { weapon, rune } (where each was placed).
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
  for (const r of list(result.runes)) {
    const id = typeof r === 'string' ? r : isObj(r) && typeof r.rune === 'string' ? r.rune : idOf(r);
    if (id) keys.push(`rune:${id}`);
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
  const changes = [];
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

  // Research: every running project moves one run closer, if the run counts.
  const active = researchActive(out);
  if (active.length) {
    if (qualifies(result, data)) {
      const done = researchDone(out);
      const still = [];
      for (const r of active) {
        const left = r.runsLeft - 1;
        if (left > 0) { still.push({ id: r.id, runsLeft: left }); changes.push({ kind: 'research_step', id: r.id, runsLeft: left }); } else done.add(r.id);
      }
      P.research.active = still;
      P.research.done = [...done];
      for (const r of active) {
        if (r.runsLeft > 1) continue;
        changes.push({ kind: 'research_done', id: r.id, unlocks: contentFrom(data, `research:${r.id}`).map(({ what, id }) => ({ what, id })) });
      }
    } else {
      changes.push({ kind: 'research_waiting', reason: waitingReason(data.meta) });
    }
  }

  // The codex: what this run's build saw for the first time.
  const known = new Set(Array.isArray(P.codex) ? P.codex : []);
  const valid = new Set(codexKeys(data));
  for (const k of seenKeys(result)) {
    if (!valid.has(k) || known.has(k)) continue;
    known.add(k);
    if (k.startsWith('secret:')) changes.push({ kind: 'codex', key: k, unlocks: contentFrom(data, k).map(({ what, id }) => ({ what, id })) });
    else changes.push({ kind: 'codex', key: k });
  }
  P.codex = [...known];

  // The bestiary: kills per enemy, and the milestones crossed.
  for (const e of data.enemies) {
    const n = count(kills[e.id]);
    if (n === 0) continue;
    const was = count(P.bestiary[e.id]);
    const now = was + n;
    P.bestiary[e.id] = now;
    for (const m of data.meta.bestiaryMilestones) if (was < m && now >= m) changes.push({ kind: 'bestiary', id: e.id, kills: m });
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
    const c = isObj(P.characters[ch.id]) ? P.characters[ch.id] : (P.characters[ch.id] = { unlocked: true, masteryXp: 0, perks: [] });
    c.masteryXp = count(c.masteryXp) + gain;
    const after = masteryOf(out, data, ch.id).rank;
    if (after > before) changes.push({ kind: 'mastery', character: ch.id, rank: after });
  }

  // Tides: clearing the map at the highest Tide opened opens the next (Tide 1 from a first clear),
  // one at a time: a challenge run's own Tide above it opens nothing.
  if (!isObj(P.tide)) P.tide = { unlocked: 0, selected: 0 };
  const playedTide = count(result.tide);
  if (cleared && playedTide === count(P.tide.unlocked) && playedTide < (data.tides || []).length) {
    P.tide.unlocked = playedTide + 1;
    changes.push({ kind: 'tide', level: playedTide + 1 });
  }

  // A challenge run won, once: what it opens, or its materials.
  const wins = challengesDone(out);
  const chal = (data.challenges || []).find((c) => c.id === result.challenge);
  if (chal && !wins.has(chal.id) && challengeWon(chal, result)) {
    P.challenges = [...wins, chal.id];
    for (const [id, k] of Object.entries(chal.reward?.materials || {})) bump(id, k);
    changes.push({ kind: 'challenge', id: chal.id, unlocks: contentFrom(data, `challenge:${chal.id}`).map(({ what, id }) => ({ what, id })), materials: { ...(chal.reward?.materials || {}) } });
  }

  // Feats done (with the lifetime numbers this run added), and 'after_found' ones discovered:
  // once the Tavern keeps the list (before that, nobody's counting).
  const featsBefore = featsDone(out);
  const foundBefore = new Set(Array.isArray(P.featsFound) ? P.featsFound.filter((x) => typeof x === 'string') : []);
  const judged = levelEffect(out, data, 'tavern', 'feats') ? judgeFeats(data, result, st, featsBefore, foundBefore) : { done: [], found: [] };
  if (judged.done.length) P.feats = [...featsBefore, ...judged.done.map((f) => f.id)];
  for (const f of judged.done) {
    for (const [id, k] of Object.entries(f.reward?.materials || {})) bump(id, k);
    changes.push({ kind: 'feat', id: f.id, unlocks: contentFrom(data, `feat:${f.id}`).map(({ what, id }) => ({ what, id })), materials: { ...(f.reward?.materials || {}) } });
  }
  if (judged.found.length) {
    P.featsFound = [...foundBefore, ...judged.found.map((f) => f.id)];
    for (const f of judged.found) changes.push({ kind: 'feat_found', id: f.id });
  }

  if (result.devTools === true) P.flags = { ...(isObj(P.flags) ? P.flags : {}), devTools: true };
  return { doc: out, changes };
}
