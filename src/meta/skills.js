// Skill trees at the Tavern (ruling 15; data/skills.js). Pure; tested (tests/skills.test.js).
// A character's skills are profile.characters[id].skills (ids, in the order taken). Points come
// from mastery ranks (SKILL_RANKS); a skill costs one point and nothing else; a reset gives every
// point back for materials. The run reads the tree as set when it starts (RunConfig.skills).
//
// Also here: what a save's mastery perks became (retirePerks, called once per save by
// meta/retired.js). Perks sat at ranks 1, 3, 5, 7, 9, and 10, where the points sit now, so a
// trained perk is that rank's point, unspent; the materials it cost are paid back.

import { SKILL_RANKS, SKILL_RESET, TREE_ROWS } from '../data/skills.js';
import { canPay, pay, countOf } from './costs.js';
import { MetaError, writable, partOf, needText, needsLevel } from './actions.js';
import { levelEffect, resolveContent, masteryOf, contentOpen } from './state.js';

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const nameOf = (list, id) => list.find((x) => x.id === id)?.name ?? id;
const tree = (data, character) => (data.skills || []).filter((s) => s.character === character);

/** The skills a character holds, in the order taken (ids this build knows, each once). */
export function skillsOf(doc, data, character) {
  const c = doc?.profile?.characters?.[character];
  const ids = new Set(tree(data, character).map((s) => s.id));
  const out = [];
  for (const id of isObj(c) && Array.isArray(c.skills) ? c.skills : []) if (ids.has(id) && !out.includes(id)) out.push(id);
  return out;
}

/** A character's points: { earned, spent, left, max, nextRank } (nextRank: the rank that gives the next, or null). */
export function skillPoints(doc, data, character) {
  const rank = masteryOf(doc, data, character).rank;
  const earned = SKILL_RANKS.filter((r) => rank >= r).length;
  const spent = skillsOf(doc, data, character).length;
  return { earned, spent, left: Math.max(0, earned - spent), max: SKILL_RANKS.length, nextRank: SKILL_RANKS.find((r) => rank < r) ?? null };
}

/** The order that opens a skill, by name (for "Opens with ..."). */
function orderName(data, key) {
  const id = String(key).split(':')[1];
  return (data.feats || []).find((f) => f.id === id)?.name ?? 'a Harbor Order';
}

/** Why a skill can't be taken now, or null. */
export function whyNotSkill(doc, data, skillId) {
  const s = (data.skills || []).find((x) => x.id === skillId);
  if (!s) return `There is no skill called "${skillId}".`;
  if (!levelEffect(doc, data, 'tavern', 'mastery')) {
    const b = data.buildings.find((x) => x.id === 'tavern');
    return needsLevel(data, 'tavern', b.levels.findIndex((l) => l.mastery) + 1);
  }
  if (!resolveContent(doc, data).characters.includes(s.character)) return `${nameOf(data.characters, s.character)} hasn't arrived yet`;
  const held = skillsOf(doc, data, s.character);
  if (held.includes(s.id)) return 'Already taken';
  const closer = closedBy(data, s, held);
  if (closer) return `Closed: you took ${closer.name}`;
  if (s.needs && !held.includes(s.needs)) return `Needs ${nameOf(data.skills, s.needs)} first`;
  if (s.unlock !== undefined && !contentOpen(doc, data, s.unlock)) return `Opens with the order ${orderName(data, s.unlock)}`;
  const pts = skillPoints(doc, data, s.character);
  if (pts.left < 1) return pts.nextRank !== null ? `No points to spend. The next comes at mastery rank ${pts.nextRank}` : 'No points to spend. Reset the tree to choose again';
  return null;
}

/** The held skill that closes `s` (its rival, or the rival of what it needs), or null. */
function closedBy(data, s, held) {
  const by = (x) => (x.rival && held.includes(x.rival) ? data.skills.find((r) => r.id === x.rival) : null);
  const need = s.needs ? data.skills.find((x) => x.id === s.needs) : null;
  return by(s) ?? (need ? by(need) : null);
}

/** Take a skill: one point. */
export function takeSkill(doc, data, skillId) {
  const why = whyNotSkill(doc, data, skillId);
  if (why) throw new MetaError(why);
  const s = data.skills.find((x) => x.id === skillId);
  const out = writable(doc, ['characters']);
  const c = isObj(out.profile.characters[s.character]) ? { ...out.profile.characters[s.character] } : { unlocked: true, masteryXp: 0 };
  c.skills = [...skillsOf(doc, data, s.character), skillId];
  out.profile.characters[s.character] = c;
  return { doc: out, changes: [{ kind: 'skill', id: skillId, character: s.character }] };
}

/** What a reset of this character's tree costs now ({} with nothing spent). */
export function resetCost(doc, data, character) {
  const n = skillsOf(doc, data, character).length;
  if (n === 0) return {};
  return { coin: SKILL_RESET.coin * n, [SKILL_RESET.material[character] ?? 'rum']: SKILL_RESET.each * n };
}

export function whyNotReset(doc, data, character) {
  if (!data.characters.some((c) => c.id === character)) return `There is no character called "${character}".`;
  if (!skillsOf(doc, data, character).length) return 'No skills taken';
  const cost = resetCost(doc, data, character);
  if (!canPay(partOf(doc, 'materials'), cost)) return needText(doc, data, cost);
  return null;
}

/** Reset a character's tree: every point back, for materials. */
export function resetSkills(doc, data, character) {
  const why = whyNotReset(doc, data, character);
  if (why) throw new MetaError(why);
  const cost = resetCost(doc, data, character);
  const out = writable(doc, ['materials', 'characters']);
  out.profile.materials = pay(out.profile.materials, cost);
  out.profile.characters[character] = { ...out.profile.characters[character], skills: [] };
  return { doc: out, changes: [{ kind: 'skill_reset', character, cost }] };
}

/**
 * A character's tree for the screen: { character, points, reset, rows: [{ label, skills: [...] }] }.
 * Each skill: { id, name, desc, row, rival, needs, held, why (null when it can be taken), state:
 * 'held' | 'open' | 'closed' | 'locked' | 'needs' | 'points', closes: [names of what taking it closes] }.
 */
export function treeView(doc, data, character) {
  const all = tree(data, character), held = skillsOf(doc, data, character);
  const view = (s) => {
    const has = held.includes(s.id), why = has ? null : whyNotSkill(doc, data, s.id);
    let state = 'open';
    if (has) state = 'held';
    else if (closedBy(data, s, held)) state = 'closed';
    else if (s.unlock !== undefined && !contentOpen(doc, data, s.unlock)) state = 'locked';
    else if (s.needs && !held.includes(s.needs)) state = 'needs';
    else if (why) state = 'points';
    const closes = s.rival ? [s.rival, ...all.filter((x) => x.needs === s.rival).map((x) => x.id)].map((id) => nameOf(all, id)) : [];
    return { id: s.id, name: s.name, desc: s.desc, row: s.row, rival: s.rival ?? null, needs: s.needs ?? null, held: has, why, state, closes };
  };
  const labels = TREE_ROWS[character] ?? ['', ''];
  const rows = [['build', 'Builds'], ['fork1', labels[0]], ['fork2', labels[1]], ['free', 'Free']].map(([row, label]) => ({ row, label, skills: all.filter((s) => s.row === row).map(view) }));
  return { character, points: skillPoints(doc, data, character), reset: resetCost(doc, data, character), rows };
}

/** The skills a run as this character starts with: { id: p } (RunConfig.skills), or null with none. */
export function runSkills(doc, data, character) {
  const held = skillsOf(doc, data, character);
  if (!held.length) return null;
  const out = {};
  for (const id of held) out[id] = { ...(data.skills.find((s) => s.id === id).p || {}) };
  return out;
}

// ---------------------------------------------------------------- what perks became (meta/retired.js)

/** The mastery perks of 0.9.0's first builds: whose, at which rank, and what training cost (data/mastery.js before ruling 15). */
const R = (c, r, cost) => ({ c, r, cost });
const DOCKS = { 1: { coin: 460, rum: 30 }, 3: { coin: 810, rum: 55, iron: 5 }, 5: { coin: 1160, rum: 80, map_scraps: 2 }, 7: { coin: 1510, rum: 100, iron: 9 }, 9: { coin: 1850, rum: 130, map_scraps: 4 }, 10: { coin: 2320, rum: 160, map_scraps: 5 }, 8: { coin: 1680, rum: 115, iron: 9 } };
const MARSH = { 1: { coin: 460, marsh_herbs: 110 }, 3: { coin: 810, marsh_herbs: 200, salt_glass: 10 }, 5: { coin: 1160, marsh_herbs: 290, salt_glass: 15 }, 7: { coin: 1510, marsh_herbs: 370, salt_glass: 20 }, 9: { coin: 1850, marsh_herbs: 460, salt_glass: 25 }, 10: { coin: 2320, marsh_herbs: 570, salt_glass: 30 }, 8: { coin: 1680, marsh_herbs: 330, iron: 9 } };
const row = (c, table, ids) => Object.fromEntries(ids.map(([id, r]) => [id, R(c, r, table[r])]));
export const RETIRED_PERKS = Object.freeze({
  ...row('lamplighter', DOCKS, [['trimmed_wick', 1], ['oil_reserve', 3], ['night_walker', 5], ['lamp_shove', 7], ['night_runner', 9], ['beacon', 10], ['lamplighter_trial_perk', 8]]),
  ...row('harpooner', DOCKS, [['iron_grip', 1], ['tough_hide', 3], ['long_line', 5], ['barnacle_hide', 7], ['lucky_hook', 9], ['deep_daze', 10], ['harpooner_trial_perk', 8]]),
  ...row('punter', MARSH, [['long_pole', 1], ['reed_eye', 3], ['quick_water', 5], ['push_off', 7], ['heavy_pole', 9], ['river_pilot', 10], ['punter_trial_perk', 8]]),
  ...row('bog_warden', MARSH, [['deep_rot', 1], ['peat_smoke', 3], ['mire_host', 5], ['bitter_bite', 7], ['old_roots', 9], ['bog_queen', 10], ['warden_trial_perk', 8]]),
  ...row('drowned_man', DOCKS, [['cold_hands', 1], ['barnacles', 3], ['old_debts', 5], ['deep_pockets', 7], ['long_stride', 9], ['full_fathom', 10], ['drowned_man_trial_perk', 8]]),
  ...row('tide_priest', DOCKS, [['rising_water', 1], ['salt_blood', 3], ['slack_water', 5], ['stillness', 7], ['chapel_bell', 9], ['last_rites', 10]]),
  tide_priest_trial_perk: R('tide_priest', 8, MARSH[8]),
});

/**
 * Ruling 15: perks are skill trees. For a profile document's `profile` P (changed in place): every
 * trained perk is paid back at what it cost, the perk lists are emptied, and each character gets an
 * empty tree. Its points are its ranks' (a trained perk's rank had been reached, so its point is
 * there to spend). Returns { perks, points, refund, did } (did: 'perk:<id>' strings), with perks 0
 * when nothing was trained.
 */
export function retirePerks(P, data) {
  const refund = {}, did = [];
  let perks = 0, points = 0;
  if (!isObj(P.characters)) return { perks, points, refund, did };
  if (!isObj(P.materials)) P.materials = {};
  for (const [id, c] of Object.entries(P.characters)) {
    if (!isObj(c)) continue;
    const trained = Array.isArray(c.perks) ? c.perks.filter((x) => typeof x === 'string') : [];
    let mine = 0;
    for (const pid of new Set(trained)) {
      const r = RETIRED_PERKS[pid];
      if (!r) continue;
      for (const [m, n] of Object.entries(r.cost)) { P.materials[m] = countOf(P.materials[m]) + n; refund[m] = (refund[m] ?? 0) + n; }
      perks++; mine++; did.push(`perk:${pid}`);
    }
    delete c.perks;
    if (!Array.isArray(c.skills)) c.skills = [];
    if (mine > 0) {
      const xp = countOf(c.masteryXp), ranks = data.meta.masteryRanks;
      let rank = 0;
      while (rank < ranks.length && xp >= ranks[rank]) rank++;
      points += SKILL_RANKS.filter((r) => rank >= r).length;
    }
    void id;
  }
  return { perks, points, refund, did };
}
