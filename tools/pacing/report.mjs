// The pacing report's text (ARCHITECTURE §10.3), from measured sets (a map at a harbor stage each):
// what the runs of each set bring home and whether it's fresh, what the hours stand on, each
// milestone against its target, the runs between new things, the MVP harbor and the whole harbor,
// how the MVP harbor's hours move if every run were like the shortest third measured (not for
// --skilled) or cleared the map (where its target is read, for --skilled), the share of runs on
// each map, and a fresh profile's share of the run content. pacingReport is pure; reportFiles
// reads the committed yields and checks their fingerprints (pacing.mjs prints it; the gate runs it).

import { join } from 'node:path';
import { simulatePlayers, summarize, freshShare, shortestThird, assumptions, setsOf, filterSets, clearedRuns, TARGETS } from './model.mjs';
import { readYields, yieldsFingerprints, staleSets, staleText, setKey, YIELDS_FILE, SKILLED_YIELDS_FILE, STAYS_YIELDS_FILE, REMEASURE } from './yields.mjs';

/** Each player's yields file, and how the report names the player. */
const KIND_FILE = Object.freeze({ skilled: SKILLED_YIELDS_FILE, ordinary: YIELDS_FILE, stays: STAYS_YIELDS_FILE });
const KIND_TITLE = Object.freeze({
  skilled: 'a practiced player (bots that can\'t die)', ordinary: 'a newer player (the ordinary bots)',
  stays: 'a practiced player who stays for overtime to the dawn (bots that can\'t die, staying: the sweep, X3)',
});
const KIND_WHO = Object.freeze({ skilled: 'practiced', ordinary: 'newer', stays: 'practiced, stays for overtime' });

/** How many runs the main simulation and the shortest-third one give each player at most. */
export const MAX_RUNS = 400, SLOW_MAX_RUNS = 600;

const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
/** A verdict as the table says it: met, MISSED (and which side), or nothing where there's no target. */
export const verdict = (met, side = null) => (met === null ? '' : met ? 'met' : `MISSED${side ? ` (${side})` : ''}`);
/** Hours as the report says them: the median and its range, or never within the cap. */
export const hoursText = (m, cap = MAX_RUNS) => (m.hours === null ? `more than ${cap} runs` : `${m.hours.toFixed(1)} h (${m.low.toFixed(1)} to ${m.high.toFixed(1)} h)`);

/**
 * The report for measured `yields` (sets, or a list of runs: model.setsOf), measured as `how` says
 * ({ character, archetypes, overtime, skilled }) with runs of at most `minutes`, for `players`
 * simulated players who spend `hubMinutes` in the harbor after each run, against `targets`.
 * Returns { before, sets, table, after } (lines, a row a measured set, the milestone table's rows,
 * lines) and the numbers under them: { report, slow, short, share, clear, clearWhole }.
 */
export function pacingReport({ yields, how, minutes, players, hubMinutes, data, targets = TARGETS }) {
  const sets = setsOf(yields, data);
  const runs = sets.flatMap((s) => s.runs);
  const mapName = (id) => data.maps.find((m) => m.id === id)?.name ?? id;
  const name = (id) => data.characters.find((c) => c.id === id)?.name ?? id;
  const haul = (rs) => {
    const per = {};
    for (const r of rs) for (const [id, n] of Object.entries(r.materials)) per[id] = (per[id] || 0) + n / rs.length;
    return Object.entries(per).map(([id, n]) => `${Math.round(n)} ${id}`).join(', ');
  };
  const ends = (rs) => ['cleared', 'died', 'left'].map((e) => `${rs.filter((r) => r.end === e).length} ${e}`).join(', ');
  const setRows = sets.map((s) => ({
    map: mapName(s.map), stage: s.stage, progress: `${Math.round(s.progress * 100)}%`, runs: s.runs.length, ends: ends(s.runs),
    minutes: (s.runs.reduce((a, r) => a + r.seconds, 0) / s.runs.length / 60).toFixed(1), 'an average run brings home': haul(s.runs),
  }));
  const before = [
    `the runs, shortest first: ${[...runs].sort((a, b) => a.seconds - b.seconds).map((r) => `${clock(r.seconds)} ${r.end}`).join(', ')}`,
    '',
    'What the hours stand on:',
    ...assumptions({ runs, minutes, hubMinutes, character: name(how.character), archetypes: how.archetypes, overtime: how.overtime, players, skilled: !!how.skilled, sets: sets.map((s) => ({ ...s, mapName: `the ${mapName(s.map)}` })) }).map((l) => `  - ${l}`),
    '',
    `runs: the median of the players' runs to it; hours: the median of their hours (each column's own middle, so a row's runs and hours needn't be one player's); range: the 10th to the 90th percentile of the ${players} players' hours; a verdict is on the medians, and a milestone some player never reached is missed.`,
  ];
  const sim = (ys, cap = MAX_RUNS) => summarize(simulatePlayers(ys, data, { players, hubMinutes, maxRuns: cap }), data, targets);
  const report = sim(sets);
  // A practiced player clears the map: the same players on each set's cleared runs alone, when
  // some were measured and some weren't (Kevin cleared his first run, 0.7.1). For --skilled, the
  // MVP harbor's target is read on it, not on all the runs (ARCHITECTURE §10.3, 0.7.2).
  const someCleared = runs.some((r) => r.end === 'cleared') && runs.some((r) => r.end !== 'cleared');
  const clearSets = someCleared ? filterSets(sets, clearedRuns) : null;
  const cleared = clearSets ? sim(clearSets.sets) : null;
  const clear = cleared ? cleared.mvp : null, clearWhole = cleared ? cleared.whole : null;
  const onClear = !!(clear && how.skilled);
  const table = report.milestones.map((m) => ({
    milestone: m.milestone, target: m.target ?? '', runs: m.runs ?? 'never', hours: m.hours === null ? '-' : m.hours.toFixed(1),
    range: m.low === null ? '-' : `${m.low.toFixed(1)} to ${m.high.toFixed(1)} h`, reached: `${m.reached}/${m.of}`,
    verdict: onClear && m === report.mvp ? 'on the cleared runs' : verdict(m.met),
  }));
  const g = report.gaps;
  const gapText = (x) => (x.runs === null ? 'never' : `every ${x.runs.toFixed(1)} runs (target ${x.target}: ${verdict(x.met, x.side)})`);
  const mvp = report.mvp;
  // Sensitivity: the same players on the shortest third of each set's runs (closer to a newer
  // player's). Not for --skilled: bots that can't die have no early deaths, so their shortest
  // runs are their fastest clears, the easy side.
  const shortSets = how.skilled ? null : filterSets(sets, shortestThird).sets;
  const short = shortSets ? shortSets.flatMap((s) => s.runs) : [];
  const slow = shortSets ? sim(shortSets, SLOW_MAX_RUNS).mvp : null;
  const share = freshShare(data, targets);
  const onMaps = Object.entries(report.mapShare).map(([m, f]) => `the ${mapName(m)} ${Math.round(f * 100)}%`).join(', ');
  const after = [
    `something new (a building level or research finished; upgrade ranks don't count): ${gapText(g.early)} over runs 1 to ${g.early.until}; ${gapText(g.later)} from run ${g.later.from} until each player's new things end (run ${g.later.until ?? '-'} for the median player; the harbor has nothing more to give after that)`,
    `MVP harbor fully restored: ${mvp.hours === null ? 'never' : hoursText(mvp)} ${onClear ? `(all the runs; the ${mvp.target} target is read on the cleared runs, below)` : `(target ${mvp.target}: ${verdict(mvp.met)})`}; the whole harbor, every building, in ${hoursText(report.whole)}`,
    ...(slow ? [`if every run were like the shortest third measured (${short.length} runs, a third of each set's): MVP harbor fully restored in ${slow.hours === null ? `more than ${SLOW_MAX_RUNS} runs` : hoursText(slow)}, by ${slow.reached} of ${slow.of} players within ${SLOW_MAX_RUNS} runs`] : []),
    ...(clear ? [`if every run cleared the map (the ${clearedRuns(runs).length} cleared runs measured${clearSets.whole.length ? `; ${clearSets.whole.map((s) => `${s.map} stage ${s.stage}`).join(', ')} cleared none, so all its runs` : ''}): MVP harbor fully restored in ${hoursText(clear)} (target ${clear.target}: ${verdict(clear.met)}); the whole harbor, every building, in ${hoursText(clearWhole)}`] : []),
    `runs played on each map: ${onMaps}`,
    `a fresh profile's pools hold ${Math.round(share.share * 100)}% of the run content (${share.have} of ${share.of} weapons, passives, and relics; brief §6.4 wants about 70% locked at the start, so ${Math.round(targets.freshShare * 100)}% or less: ${verdict(share.met)}; §20 calls 60 and 99)`,
  ];
  const allCleared = runs.every((r) => r.end === 'cleared');
  return { before, sets: setRows, table, after, report, slow, short, share, clear, clearWhole, allCleared };
}

/**
 * The report on the yields kept in the repo at `root`, for each player (`kinds`: 'skilled' and
 * 'ordinary', or a file of its own), said through `log` (console.log; console.table for tables
 * is `table`). Returns { reports: { [kind]: pacingReport }, stale: { [kind]: staleSets } }. Each
 * file's stale sets are named first, with the command that measures them again.
 */
export async function reportFiles({ root, data, kinds = ['skilled', 'ordinary', 'stays'], files = {}, players = 40, hubMinutes = 1.5, log = console.log, table = console.table }) {
  const fps = await yieldsFingerprints(root);
  const reports = {}, stale = {};
  for (const kind of kinds) {
    const file = files[kind] ?? join(root, KIND_FILE[kind] ?? YIELDS_FILE);
    const saved = readYields(file);
    if (!saved) { log(`\n${kind}: no yields at ${file}: measure them with ${REMEASURE}`); continue; }
    stale[kind] = staleSets(saved, fps);
    log(`\n=== ${KIND_TITLE[kind] ?? KIND_TITLE.ordinary}: ${saved.sets.length} sets from ${file}`);
    const said = staleText(file, stale[kind]);
    if (said) log(`\n${said}\nThe hours below may not hold.\n`);
    const out = pacingReport({ yields: saved, how: saved.measure, minutes: saved.minutes, players, hubMinutes, data });
    reports[kind] = out;
    const fresh = new Set(stale[kind].stale);
    table(out.sets.map((row, i) => ({ ...row, yields: fresh.has(setKey(saved.sets[i])) ? 'STALE' : 'fresh' })));
    for (const line of out.before) log(line);
    table(out.table);
    for (const line of out.after) log(line);
  }
  // Both players side by side: the MVP harbor and the whole harbor, on all the runs and the cleared ones.
  const rows = [];
  for (const [kind, out] of Object.entries(reports)) {
    const who = KIND_WHO[kind] ?? KIND_WHO.ordinary;
    if (out.clear) rows.push({ player: `${who}, cleared runs`, 'MVP harbor': hoursText(out.clear), 'whole harbor': hoursText(out.clearWhole), target: kind === 'skilled' ? `${verdict(out.clear.met)} (${out.clear.target})` : '' });
    const everyCleared = !out.clear && out.allCleared;
    rows.push({ player: `${who}, all runs${everyCleared ? ' (every one cleared)' : ''}`, 'MVP harbor': hoursText(out.report.mvp), 'whole harbor': hoursText(out.report.whole), target: kind === 'skilled' && out.clear ? '' : `${verdict(out.report.mvp.met)} (${out.report.mvp.target})` });
  }
  if (rows.length) { log('\nThe MVP harbor (the Lamp Post, Library, and Tavern to level 5) and the whole harbor:'); table(rows); }
  // The two practiced players side by side (X3, E1): how much sooner staying for overtime gets there.
  if (reports.skilled && reports.stays) {
    const a = reports.skilled.clear ?? reports.skilled.report.mvp, b = reports.stays.report.mvp;
    if (a.hours !== null && b.hours !== null) log(`Staying for overtime to the dawn restores the MVP harbor in ${(b.hours / a.hours * 100).toFixed(0)}% of the hours of leaving at the last boss (${b.hours.toFixed(1)} h against ${a.hours.toFixed(1)} h).`);
  }
  return { reports, stale };
}
