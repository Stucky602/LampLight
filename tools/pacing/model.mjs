// The pacing model (ARCHITECTURE §10.3): simulated players, each playing run after run with
// measured yields and spending everything they can in the harbor, through the real meta layer.
// Pure (no workers, no files), so the gate can test it on made-up yields.
//
// The yields are sets, a map at a harbor stage each (stages.mjs): { map, stage, progress, greed,
// runs }. Each run, the player picks a map (chooseMap: where a project under way or the next thing
// they want points, else the newest map open), then the set on that map whose stage is nearest
// their own progress, and draws one of its runs.

import { defaultProfile } from '../../src/save/schema.js';
import { applyRunResult } from '../../src/meta/apply.js';
import { purchaseOptions } from '../../src/meta/next.js';
import { restoreBuilding, startResearch, buyUpgrade } from '../../src/meta/actions.js';
import { upgradeMods } from '../../src/meta/runconfig.js';
import { resolveContent, levelOf, researchDone, researchActive, rankOf, mapsOpen } from '../../src/meta/state.js';
import { combine } from '../../src/sim/stats.js';
import { createRng } from '../../src/lib/rng.js';
import { progressOf, bossOrder, stageProfile } from './stages.mjs';

export { bossOrder };

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
 * first within each. Phase 7's goals (gear, perks, consumables) aren't bought: they don't change
 * what a measured run brings home here, so the hours are the town's, research's, and the
 * upgrades'. Returns { doc, bought: changes }.
 */
export function buyGreedy(doc, data) {
  const bought = [];
  for (let guard = 0; guard < 500; guard++) {
    const can = purchaseOptions(doc, data).filter((o) => o.progress >= 1 && BUY_ORDER.includes(o.kind));
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
 * base greed.
 */
export function greedOf(doc, data) {
  const base = data.tuning.player.stats.greed;
  const [lo, hi] = data.tuning.caps.player.greed ?? [-Infinity, Infinity];
  return Math.min(hi, Math.max(lo, combine(base, upgradeMods(doc, data), 'greed'))) / base;
}

/** The maps a material drops on alone (none for one that drops everywhere: Coin, Oil, Map Scraps). */
function onlyOn(data, id) {
  const m = data.materials.find((x) => x.id === id);
  return m && Array.isArray(m.maps) && !m.maps.includes('*') && m.maps.length === 1 ? m.maps[0] : null;
}

/**
 * What the player wants next, as the greedy buyer would buy it once it could: the first kind in
 * BUY_ORDER with anything on offer, and of it the closest to affordable (then the cheapest).
 * null when there's nothing left to buy.
 */
export function nextWant(doc, data) {
  const opts = purchaseOptions(doc, data).filter((o) => BUY_ORDER.includes(o.kind));
  if (!opts.length) return null;
  opts.sort((a, b) => BUY_ORDER.indexOf(a.kind) - BUY_ORDER.indexOf(b.kind) || b.progress - a.progress || total(a.cost) - total(b.cost));
  return opts[0];
}

/**
 * Where the player runs next, of the open `maps` (those with yields): one map open, that one; a
 * project under way that counts only runs on one map, there; the next thing they want short of
 * materials that only one map drops, the map it's shortest of (its share of the cost); else the
 * newest map open (a player moves to a map once it opens).
 */
export function chooseMap(doc, data, maps) {
  const open = mapsOpen(doc, data).filter((m) => maps.includes(m));
  if (open.length <= 1) return open[0] ?? maps[0];
  for (const a of researchActive(doc)) {
    const on = data.research.find((r) => r.id === a.id)?.runsOn;
    if (on && open.includes(on)) return on;
  }
  const want = nextWant(doc, data);
  if (want) {
    const short = new Map();
    for (const { id, need } of want.missing) {
      const on = onlyOn(data, id);
      if (on && open.includes(on)) short.set(on, (short.get(on) ?? 0) + need / want.cost[id]);
    }
    if (short.size) return [...short.entries()].sort((a, b) => b[1] - a[1] || open.indexOf(b[0]) - open.indexOf(a[0]))[0][0];
  }
  return open[open.length - 1];
}

/**
 * The yields as sets ({ map, stage, progress, greed, runs }): a list of runs is one set, the
 * first map's at a fresh profile (the tests' made-up yields); sets (a list, or a saved file's) as
 * they are, with each one's progress and greed worked out from its stage's profile where it
 * doesn't give them (a saved set doesn't: they follow today's data).
 */
export function setsOf(yields, data) {
  let sets;
  if (Array.isArray(yields) && yields.length && !Array.isArray(yields[0]?.runs)) sets = [{ map: data.maps[0].id, stage: 0, runs: yields }];
  else if (Array.isArray(yields)) sets = yields;
  else if (yields && Array.isArray(yields.sets)) sets = yields.sets;
  else throw new Error('the yields are a list of runs, or sets ({ map, stage, runs })');
  const stage = new Map();
  const of = (k) => { if (!stage.has(k)) { const d = stageProfile(data, k); stage.set(k, { progress: progressOf(d, data), greed: greedOf(d, data) }); } return stage.get(k); };
  return sets.map((s) => (Number.isFinite(s.progress) && Number.isFinite(s.greed) ? s : { ...s, progress: s.progress ?? of(s.stage ?? 0).progress, greed: s.greed ?? of(s.stage ?? 0).greed }));
}

/** The set on `map` whose stage's progress is nearest `progress` (the earlier one on a tie). */
export function nearestSet(sets, map, progress) {
  let best = null;
  for (const s of sets) if (s.map === map && (!best || Math.abs((s.progress ?? 0) - progress) < Math.abs((best.progress ?? 0) - progress))) best = s;
  return best;
}

/**
 * A measured run replayed for a profile: the run's result as the game would fold it in, on the
 * map it was measured on, with its materials scaled by the profile's greed over the greed of the
 * stage it was measured at (greedOf; `set.greed`, 1 for a fresh profile), and the bosses it killed
 * named by id (the map's, in order), as the research rule and the bestiary read them (a map that
 * opens on a boss killed opens on them). In a real run greed counts at each pickup and the haul is
 * rounded down once at the end; here the measured haul is scaled and rounded down once. Sea Glass
 * left in hand comes along for the Market to buy.
 */
export function runResultFor(run, doc, data, set = null) {
  const map = set?.map ?? data.maps[0].id;
  const greed = greedOf(doc, data) / (set?.greed ?? 1);
  const materials = {};
  for (const [id, c] of Object.entries(run.materials)) materials[id] = Math.floor(c * greed + 1e-9);
  const bosses = bossOrder(data, map);
  const bossesKilled = Array.from({ length: run.bosses }, (_, k) => bosses[Math.min(k, bosses.length - 1)]);
  const kills = {};
  for (const b of bossesKilled) kills[b] = (kills[b] ?? 0) + 1;
  return {
    map, end: run.end, timeSurvived: run.seconds, bossesKilled, tide: 0, seaGlass: run.seaGlass ?? 0,
    materials, kills, totalKills: 0, weapons: [], passives: [], relics: [], runes: [], evolutions: [],
  };
}

/**
 * One player: `yields` (setsOf), drawn at random (seeded). Each run the player picks a map
 * (chooseMap) and the set there nearest their progress (nearestSet), and after it buyGreedy spends
 * everything it can. Returns the events (each with the run number and the minutes played by then:
 * 'building' levels, 'research' finished, 'upgrade' ranks, 'map' opened), the runs played on each
 * map, and the totals.
 */
export function simulatePlayer(yields, data, { seed = 1, hubMinutes = 1.5, maxRuns = 400 } = {}) {
  const sets = setsOf(yields, data);
  if (!sets.length || sets.some((s) => !s.runs.length)) throw new Error('simulatePlayer: no measured runs');
  const maps = [...new Set(sets.map((s) => s.map))];
  const rng = createRng(`pacing-${seed}`);
  let doc = defaultProfile();
  let minutes = 0;
  const events = [];
  const mapRuns = Object.fromEntries(maps.map((m) => [m, 0]));
  let open = new Set(mapsOpen(doc, data));
  let n = 0;
  while (n < maxRuns && !allDone(doc, data)) {
    n++;
    const map = chooseMap(doc, data, maps);
    const set = nearestSet(sets, map, progressOf(doc, data));
    const r = set.runs[rng.int(set.runs.length)];
    mapRuns[map]++;
    const applied = applyRunResult(doc, runResultFor(r, doc, data, set), data);
    doc = applied.doc;
    minutes += r.seconds / 60 + hubMinutes;
    for (const c of applied.changes) if (c.kind === 'research_done') events.push({ run: n, minutes, kind: 'research', id: c.id });
    const b = buyGreedy(doc, data);
    doc = b.doc;
    for (const c of b.bought) {
      if (c.kind === 'building_level') events.push({ run: n, minutes, kind: 'building', id: c.id, level: c.level, unlocks: c.unlocks });
      else if (c.kind === 'upgrade_rank') events.push({ run: n, minutes, kind: 'upgrade', id: c.id, rank: c.rank });
    }
    const now = mapsOpen(doc, data);
    for (const id of now) if (!open.has(id)) events.push({ run: n, minutes, kind: 'map', id });
    open = new Set(now);
  }
  return { events, runs: n, minutes, mapRuns, done: allDone(doc, data), doc };
}

export function simulatePlayers(yields, data, { players = 40, hubMinutes = 1.5, maxRuns = 400 } = {}) {
  return Array.from({ length: players }, (_, k) => simulatePlayer(yields, data, { seed: k + 1, hubMinutes, maxRuns }));
}

/** The value at a fraction of the way through a sorted list (the nearest rank). */
export const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))];
const within = (v, [lo, hi]) => v >= lo && v <= hi;

/**
 * The report, as numbers: each milestone's median run and hours, the 10th to 90th percentile of
 * the hours, how many players reached it, its target (text) and whether the median met it (null
 * where there's no target); the runs between new things (a building level or research finished;
 * upgrade ranks don't count), early and later, against their targets; the MVP harbor and the
 * whole harbor; and the share of their runs the players played on each map (pooled).
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
    ...data.maps.slice(1).map((m) => milestone(`${m.name} opens`, first((e) => e.kind === 'map' && e.id === m.id))),
    ...data.buildings.map((b) => milestone(`${b.name} fully restored`, first((e) => e.kind === 'building' && e.id === b.id && e.level === b.levels.length))),
    milestone('MVP harbor fully restored', nth(mvpLevels, (e) => e.kind === 'building' && mvpIds.includes(e.id)), `${targets.mvpHours[0]} to ${targets.mvpHours[1]} h`, (m) => within(m.hours, targets.mvpHours)),
    milestone('whole harbor fully restored', nth(data.buildings.reduce((s, b) => s + b.levels.length, 0), (e) => e.kind === 'building')),
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
  const whole = milestones.find((m) => m.milestone === 'whole harbor fully restored');
  // The share of the runs played on each map, over all the players.
  const onMap = {};
  for (const s of sims) for (const [m, k] of Object.entries(s.mapRuns ?? {})) onMap[m] = (onMap[m] ?? 0) + k;
  const all = Object.values(onMap).reduce((a, b) => a + b, 0);
  const mapShare = Object.fromEntries(Object.entries(onMap).map(([m, k]) => [m, all ? k / all : 0]));
  return {
    milestones,
    gaps: { early: gap(early, targets.newEarly, 1, targets.earlyRuns), later: gap(later, targets.newLater, targets.earlyRuns + 1, until) },
    mvp,
    whole,
    mapShare,
  };
}

/**
 * How much of what a run can offer is in a fresh profile's pools (brief §6.4, "about 70% of all
 * run content is locked behind research at the start"): the weapons that go in the pools (not the
 * evolutions or a character's own), the passives, and the relics. (Characters come
 * from the Tavern and feats, brief §6.5, so they don't count.)
 */
export function freshShare(data, targets = TARGETS) {
  const fresh = resolveContent(defaultProfile(), data);
  const inPools = (list) => list.filter((x) => x.unlock !== 'evolution' && x.unlock !== 'innate' && !x.innate);
  // (Runes are gone since ruling 14; an old bundle that still lists them counts them.)
  const of = inPools(data.weapons).length + data.passives.length + data.relics.length + (data.runes?.length ?? 0);
  const have = fresh.weapons.length + fresh.passives.length + fresh.relics.length + (fresh.runes?.length ?? 0);
  return { have, of, share: have / of, met: have / of <= targets.freshShare };
}

/** The shortest third of the measured runs (at least one): the sensitivity check's yields. */
export function shortestThird(runs) {
  return [...runs].sort((a, b) => a.seconds - b.seconds).slice(0, Math.max(1, Math.ceil(runs.length / 3)));
}

/** Each set with only its runs that `keep` (a set none of whose runs it keeps keeps them all, and is named in `whole`). */
export function filterSets(sets, keep) {
  const whole = [];
  const out = sets.map((s) => {
    const runs = keep(s.runs);
    if (runs.length) return { ...s, runs };
    whole.push(s);
    return s;
  });
  return { sets: out, whole };
}

/** The runs that cleared the map. */
export const clearedRuns = (runs) => runs.filter((r) => r.end === 'cleared');

/**
 * What the report's hours stand on, as sentences: how the yields were measured, how they are
 * replayed, and how the simulated players spend.
 */
export function assumptions({ runs, minutes, hubMinutes, character, archetypes, overtime, players, skilled = false, sets = null }) {
  const died = runs.filter((r) => r.end === 'died').length, cleared = runs.filter((r) => r.end === 'cleared').length;
  const where = sets && sets.length > 1
    ? ` on ${[...new Set(sets.map((s) => s.mapName ?? s.map))].join(' and ')}, in ${sets.length} sets (a map at a harbor stage each)` : '';
  return [
    `The yields are ${runs.length} bot runs${where}, all as ${character} (${archetypes.join(', ')} builds, in turn): ${cleared} cleared the map, ${died} died, ${runs.length - cleared - died} were still going at ${minutes}:00 and left. After the last boss a bot ${overtime === 'stay' ? 'stays for overtime' : 'leaves at once (no overtime)'}.`,
    skilled
      ? `These bots can't die: a practiced player's pace (Kevin cleared his first run). ${cleared === runs.length ? 'Every one of their runs cleared the map, so the table is the cleared runs\' and the MVP harbor\'s 6 to 10 hours are read on it.' : 'The MVP harbor\'s 6 to 10 hours are read on the runs that cleared the map (the line under the table).'}`
      : died > 0
        ? 'The bots die in some of their runs, unlike a practiced player (Kevin cleared his first run), so these hours are a newer player\'s; --skilled gives a practiced player\'s.'
        : 'These bots can die, but none did: at this pace they play like a practiced player, so these hours are not a newer player\'s (the shortest third below is the nearest to one); --skilled gives a practiced player\'s.',
    ...(sets && sets.length > 1 ? ['A harbor stage is a share of every building, project, and upgrade rank (0, a quarter, a half, three quarters); each run uses the stage nearest the player\'s own progress. The player runs on the map a project under way or the next thing they want points at, else the newest map open.'] : []),
    `Each simulated run is one of those runs, drawn at random, for ${players} players: the range is the spread of those draws, not the spread between real players.`,
    'A run brings home what its stage\'s runs did, with the greed of the player\'s own Lamp Post upgrades over the stage\'s.',
    `Each run is followed by ${hubMinutes} minutes in the harbor.`,
    `After every run the player spends everything they can: ${BUY_ORDER.map((k) => ({ building: 'building levels', research: 'research', upgrade: 'upgrades' }[k])).join(', then ')}, the cheapest first.`,
  ];
}
