// The pacing model (ARCHITECTURE §10.3): simulated players, each playing run after run with
// measured yields and spending everything they can in the harbor, through the real meta layer.
// Pure (no workers, no files), so the gate can test it on made-up yields.

import { defaultProfile } from '../../src/save/schema.js';
import { applyRunResult } from '../../src/meta/apply.js';
import { purchaseOptions } from '../../src/meta/next.js';
import { restoreBuilding, startResearch, buyUpgrade } from '../../src/meta/actions.js';
import { upgradeMods } from '../../src/meta/runconfig.js';
import { resolveContent, levelOf, researchDone, rankOf } from '../../src/meta/state.js';
import { combine } from '../../src/sim/stats.js';
import { createRng } from '../../src/lib/rng.js';

/** The targets the report checks each milestone against (ARCHITECTURE §10.3; brief §6.4). */
export const TARGETS = Object.freeze({
  firstLevelRun: 1,                      // the first building level by the end of run 1
  earlyRuns: 10,                         // "early on": the first 10 runs
  newEarly: Object.freeze([1, 2]),       // something new every 1 to 2 runs early on...
  newLater: Object.freeze([3, 4]),       // ...and every 3 to 4 later
  mvpHours: Object.freeze([6, 10]),      // the MVP harbor fully restored
  freshShare: 0.3,                       // a fresh profile's pools hold 30% or less of the run content
});

const total = (cost) => Object.values(cost).reduce((s, v) => s + v, 0);
/** The greedy buyer's order: the town first, then research, then the Lamp Post's upgrades. */
export const BUY_ORDER = Object.freeze(['building', 'research', 'upgrade']);

/**
 * Spend like a player who wants the town back first: while anything is affordable, restore the
 * next building level, else start research, else buy an upgrade rank (BUY_ORDER); the cheapest
 * first within each. Returns { doc, bought: changes }.
 */
export function buyGreedy(doc, data) {
  const bought = [];
  for (let guard = 0; guard < 500; guard++) {
    const can = purchaseOptions(doc, data).filter((o) => o.progress >= 1);
    if (!can.length) break;
    can.sort((a, b) => BUY_ORDER.indexOf(a.kind) - BUY_ORDER.indexOf(b.kind) || total(a.cost) - total(b.cost));
    const o = can[0];
    const out = o.kind === 'building' ? restoreBuilding(doc, data, o.id) : o.kind === 'research' ? startResearch(doc, data, o.id) : buyUpgrade(doc, data, o.id);
    doc = out.doc;
    bought.push(...out.changes);
  }
  return { doc, bought };
}

/** Has this profile bought and researched everything the harbor offers? */
export function allDone(doc, data) {
  const done = researchDone(doc);
  return data.buildings.every((b) => levelOf(doc, b.id, data) >= b.levels.length)
    && data.research.every((r) => done.has(r.id))
    && data.upgrades.every((u) => rankOf(doc, u.id) >= u.ranks);
}

/**
 * How much more a run brings home with this profile's Lamp Post upgrades than with none: their
 * greed through the sim's own stat formula (add, pct, and more, within the stat's caps), over the
 * base greed the measured runs had.
 */
export function greedOf(doc, data) {
  const base = data.tuning.player.stats.greed;
  const [lo, hi] = data.tuning.caps.player.greed ?? [-Infinity, Infinity];
  return Math.min(hi, Math.max(lo, combine(base, upgradeMods(doc, data), 'greed'))) / base;
}

/** The first map's bosses in the order its timeline brings them (a measured run kills them in that order). */
export function bossOrder(data) {
  return data.maps[0].timeline.events.filter((e) => e.event === 'boss').sort((a, b) => a.at - b.at).map((e) => e.enemy);
}

/**
 * A measured run replayed for a profile: the run's result as the game would fold it in, with its
 * materials scaled by the profile's greed (greedOf), and the bosses it killed named by id (the
 * map's, in order), as the research rule reads them. In a real run greed counts at each pickup,
 * the fractions add up, and the haul is rounded down once at the end; here the measured haul is
 * scaled and rounded down once. (Greed the bot found in the run is in the measured haul already;
 * a percent from the upgrades multiplies it rather than adding to it, a slight overstatement.)
 */
export function runResultFor(run, doc, data) {
  const greed = greedOf(doc, data);
  const materials = {};
  for (const [id, c] of Object.entries(run.materials)) materials[id] = Math.floor(c * greed + 1e-9);
  const bosses = bossOrder(data);
  return {
    end: run.end, timeSurvived: run.seconds, bossesKilled: Array.from({ length: run.bosses }, (_, k) => bosses[Math.min(k, bosses.length - 1)]),
    materials, kills: {}, totalKills: 0, weapons: [], passives: [], relics: [], runes: [], evolutions: [],
  };
}

/**
 * One player: `runs` are measured runs ({ seconds, materials, bosses, end }), drawn at random
 * (seeded). After each run, buyGreedy spends everything it can. Returns the events (each with the
 * run number and the minutes played by then: 'building' levels, 'research' finished, 'upgrade'
 * ranks) and the totals.
 */
export function simulatePlayer(runs, data, { seed = 1, hubMinutes = 1.5, maxRuns = 400 } = {}) {
  if (!runs.length) throw new Error('simulatePlayer: no measured runs');
  const rng = createRng(`pacing-${seed}`);
  let doc = defaultProfile();
  let minutes = 0;
  const events = [];
  let n = 0;
  while (n < maxRuns && !allDone(doc, data)) {
    n++;
    const r = runs[rng.int(runs.length)];
    const applied = applyRunResult(doc, runResultFor(r, doc, data), data);
    doc = applied.doc;
    minutes += r.seconds / 60 + hubMinutes;
    for (const c of applied.changes) if (c.kind === 'research_done') events.push({ run: n, minutes, kind: 'research', id: c.id });
    const b = buyGreedy(doc, data);
    doc = b.doc;
    for (const c of b.bought) {
      if (c.kind === 'building_level') events.push({ run: n, minutes, kind: 'building', id: c.id, level: c.level, unlocks: c.unlocks });
      else if (c.kind === 'upgrade_rank') events.push({ run: n, minutes, kind: 'upgrade', id: c.id, rank: c.rank });
    }
  }
  return { events, runs: n, minutes, done: allDone(doc, data), doc };
}

export function simulatePlayers(runs, data, { players = 40, hubMinutes = 1.5, maxRuns = 400 } = {}) {
  return Array.from({ length: players }, (_, k) => simulatePlayer(runs, data, { seed: k + 1, hubMinutes, maxRuns }));
}

/** The value at a fraction of the way through a sorted list (the nearest rank). */
export const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))];
const within = (v, [lo, hi]) => v >= lo && v <= hi;

/**
 * The report, as numbers: each milestone's median run and hours, the 10th to 90th percentile of
 * the hours, how many players reached it, its target (text) and whether the median met it (null
 * where there's no target); the runs between new things (a building level or research finished;
 * upgrade ranks don't count), early and later, against their targets; and the MVP harbor.
 */
export function summarize(sims, data, targets = TARGETS) {
  const of = sims.length;
  /** A milestone from each player's event for it (null where a player never got there). */
  const milestone = (name, hits, target = null, meets = null) => {
    const got = hits.filter(Boolean);
    if (!got.length) return { milestone: name, target, runs: null, hours: null, low: null, high: null, reached: 0, of, met: target ? false : null };
    const hrs = got.map((e) => e.minutes / 60).sort((a, b) => a - b);
    const rs = got.map((e) => e.run).sort((a, b) => a - b);
    const m = { milestone: name, target, runs: percentile(rs, 0.5), hours: percentile(hrs, 0.5), low: percentile(hrs, 0.1), high: percentile(hrs, 0.9), reached: got.length, of };
    m.met = meets ? got.length === of && meets(m) : null;
    return m;
  };
  const first = (want) => sims.map((s) => s.events.find(want) ?? null);
  /** The event that completes `count` of a kind (the last of them), or null short of that. */
  const nth = (count, want) => sims.map((s) => { const hits = s.events.filter(want); return hits.length >= count ? hits[count - 1] : null; });

  const arrivals = data.characters.filter((c) => typeof c.unlock === 'string' && c.unlock.startsWith('building:'));
  // The MVP harbor is the MVP buildings (data/meta.js), not every building a later phase adds.
  const mvpIds = data.meta.mvpBuildings;
  const mvpLevels = data.buildings.filter((b) => mvpIds.includes(b.id)).reduce((s, b) => s + b.levels.length, 0);
  const milestones = [
    milestone('first building level', first((e) => e.kind === 'building'), `run ${targets.firstLevelRun}`, (m) => m.runs <= targets.firstLevelRun),
    ...arrivals.map((c) => milestone(`${c.name} arrives`, first((e) => e.kind === 'building' && e.unlocks?.some((u) => u.what === 'character' && u.id === c.id)))),
    milestone('first research done', first((e) => e.kind === 'research')),
    ...data.buildings.map((b) => milestone(`${b.name} fully restored`, first((e) => e.kind === 'building' && e.id === b.id && e.level === b.levels.length))),
    milestone('MVP harbor fully restored', nth(mvpLevels, (e) => e.kind === 'building' && mvpIds.includes(e.id)), `${targets.mvpHours[0]} to ${targets.mvpHours[1]} h`, (m) => within(m.hours, targets.mvpHours)),
    milestone('all research done', nth(data.research.length, (e) => e.kind === 'research')),
    milestone('every upgrade at its last rank', nth(data.upgrades.reduce((s, u) => s + u.ranks, 0), (e) => e.kind === 'upgrade')),
  ];
  // Runs between new things (a building level or research finished; upgrade ranks don't count),
  // over a window: the runs it spans over the runs in it with something new, pooled over the
  // players, so a dry stretch at a window's end counts in that window. The early window is runs 1
  // to earlyRuns (as far as each player got); the later one from there to each player's own last
  // new thing (the harbor has nothing more to give after it); `until` is where that is for the
  // median player.
  const early = { runs: 0, fresh: 0 }, later = { runs: 0, fresh: 0 }, lastNew = [];
  for (const s of sims) {
    const runsWithNew = [...new Set(s.events.filter((e) => e.kind === 'building' || e.kind === 'research').map((e) => e.run))].sort((a, b) => a - b);
    const last = runsWithNew.length ? runsWithNew[runsWithNew.length - 1] : 0;
    const played = Number.isFinite(s.runs) ? s.runs : Math.max(last, targets.earlyRuns);
    early.runs += Math.min(targets.earlyRuns, played);
    early.fresh += runsWithNew.filter((r) => r <= targets.earlyRuns).length;
    if (last > targets.earlyRuns) { later.runs += last - targets.earlyRuns; later.fresh += runsWithNew.filter((r) => r > targets.earlyRuns).length; }
    if (runsWithNew.length) lastNew.push(last);
  }
  const gap = (w, t, from, until) => {
    const m = w.fresh ? w.runs / w.fresh : null;
    return { runs: m, target: `${t[0]} to ${t[1]} runs`, met: m !== null && within(m, t), side: m === null ? null : m < t[0] ? 'sooner' : m > t[1] ? 'later' : null, from, until };
  };
  const until = lastNew.length ? percentile(lastNew.sort((a, b) => a - b), 0.5) : null;
  const mvp = milestones.find((m) => m.milestone === 'MVP harbor fully restored');
  return {
    milestones,
    gaps: { early: gap(early, targets.newEarly, 1, targets.earlyRuns), later: gap(later, targets.newLater, targets.earlyRuns + 1, until) },
    mvp,
  };
}

/**
 * How much of what a run can offer is in a fresh profile's pools (brief §6.4, "about 70% of all
 * run content is locked behind research at the start"): the weapons that go in the pools (not the
 * evolutions or a character's own), the passives, the relics, and the runes. (Characters come
 * from the Tavern and feats, brief §6.5, so they don't count.)
 */
export function freshShare(data, targets = TARGETS) {
  const fresh = resolveContent(defaultProfile(), data);
  const inPools = (list) => list.filter((x) => x.unlock !== 'evolution' && x.unlock !== 'innate' && !x.innate);
  const of = inPools(data.weapons).length + data.passives.length + data.relics.length + data.runes.length;
  const have = fresh.weapons.length + fresh.passives.length + fresh.relics.length + fresh.runes.length;
  return { have, of, share: have / of, met: have / of <= targets.freshShare };
}

/** The shortest third of the measured runs (at least one): the sensitivity check's yields. */
export function shortestThird(runs) {
  return [...runs].sort((a, b) => a.seconds - b.seconds).slice(0, Math.max(1, Math.ceil(runs.length / 3)));
}

/**
 * What the report's hours stand on, as sentences: how the yields were measured, how they are
 * replayed, and how the simulated players spend.
 */
export function assumptions({ runs, minutes, hubMinutes, character, archetypes, overtime, players }) {
  const died = runs.filter((r) => r.end === 'died').length, cleared = runs.filter((r) => r.end === 'cleared').length;
  return [
    `The yields are ${runs.length} bot runs from a fresh profile, all as ${character} (${archetypes.join(', ')} builds, in turn): ${cleared} cleared the map, ${died} died, ${runs.length - cleared - died} were still going at ${minutes}:00 and left. After the last boss a bot ${overtime === 'stay' ? 'stays for overtime' : 'leaves at once (no overtime)'}.`,
    'The bots play better than a new player: they outlast one, so real runs will be shorter and bring home less, and the hours longer.',
    `Each simulated run is one of those ${runs.length} runs, drawn at random, for ${players} players: the range is the spread of those draws, not the spread between real players.`,
    'A run brings home the same whatever the player has bought, except for greed from the Lamp Post\'s upgrades.',
    `Each run is followed by ${hubMinutes} minutes in the harbor.`,
    `After every run the player spends everything they can: ${BUY_ORDER.map((k) => ({ building: 'building levels', research: 'research', upgrade: 'upgrades' }[k])).join(', then ')}, the cheapest first.`,
  ];
}
