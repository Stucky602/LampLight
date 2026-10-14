// The pacing report's text (ARCHITECTURE §10.3), from measured runs: what an average run brings
// home, what the hours stand on, each milestone against its target, the runs between new things,
// the MVP harbor and how its hours move if every run were like the shortest third measured, and a
// fresh profile's share of the run content. Pure (pacing.mjs prints it; the gate runs it on the
// committed yields).

import { simulatePlayers, summarize, freshShare, shortestThird, assumptions, TARGETS } from './model.mjs';

/** How many runs the main simulation and the shortest-third one give each player at most. */
export const MAX_RUNS = 400, SLOW_MAX_RUNS = 600;

const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
/** A verdict as the table says it: met, MISSED (and which side), or nothing where there's no target. */
export const verdict = (met, side = null) => (met === null ? '' : met ? 'met' : `MISSED${side ? ` (${side})` : ''}`);

/**
 * The report for measured `runs` ({ seconds, materials, bosses, end }), measured as `how` says
 * ({ character, archetypes, overtime }) with runs of at most `minutes`, for `players` simulated
 * players who spend `hubMinutes` in the harbor after each run, against `targets`. Returns
 * { before, table, after } (lines, the milestone table's rows, lines) and the numbers under them:
 * { report, slow, short, share }.
 */
export function pacingReport({ runs, how, minutes, players, hubMinutes, data, targets = TARGETS }) {
  const perRun = {};
  for (const r of runs) for (const [id, n] of Object.entries(r.materials)) perRun[id] = (perRun[id] || 0) + n / runs.length;
  const name = (id) => data.characters.find((c) => c.id === id)?.name ?? id;
  const before = [
    `an average run: ${(runs.reduce((s, r) => s + r.seconds, 0) / runs.length / 60).toFixed(1)} min, brings home ${Object.entries(perRun).map(([id, n]) => `${n.toFixed(1)} ${id}`).join(', ')}`,
    `the runs, shortest first: ${[...runs].sort((a, b) => a.seconds - b.seconds).map((r) => `${clock(r.seconds)} ${r.end}`).join(', ')}`,
    '',
    'What the hours stand on:',
    ...assumptions({ runs, minutes, hubMinutes, character: name(how.character), archetypes: how.archetypes, overtime: how.overtime, players }).map((l) => `  - ${l}`),
    '',
    `runs: the median of the players' runs to it; hours: the median of their hours (each column's own middle, so a row's runs and hours needn't be one player's); range: the 10th to the 90th percentile of the ${players} players' hours; a verdict is on the medians, and a milestone some player never reached is missed.`,
  ];
  const report = summarize(simulatePlayers(runs, data, { players, hubMinutes, maxRuns: MAX_RUNS }), data, targets);
  const table = report.milestones.map((m) => ({
    milestone: m.milestone, target: m.target ?? '', runs: m.runs ?? 'never', hours: m.hours === null ? '-' : m.hours.toFixed(1),
    range: m.low === null ? '-' : `${m.low.toFixed(1)} to ${m.high.toFixed(1)} h`, reached: `${m.reached}/${m.of}`, verdict: verdict(m.met),
  }));
  const g = report.gaps;
  const gapText = (x) => (x.runs === null ? 'never' : `every ${x.runs.toFixed(1)} runs (target ${x.target}: ${verdict(x.met, x.side)})`);
  const mvp = report.mvp;
  // Sensitivity: the same players on the shortest third of the measured runs (closer to a newer player's).
  const short = shortestThird(runs);
  const slow = summarize(simulatePlayers(short, data, { players, hubMinutes, maxRuns: SLOW_MAX_RUNS }), data, targets).mvp;
  const share = freshShare(data, targets);
  const after = [
    `something new (a building level or research finished; upgrade ranks don't count): ${gapText(g.early)} over runs 1 to ${g.early.until}; ${gapText(g.later)} from run ${g.later.from} until each player's new things end (run ${g.later.until ?? '-'} for the median player; the MVP harbor has nothing more to give after that)`,
    `MVP harbor fully restored: ${mvp.hours === null ? 'never' : `${mvp.hours.toFixed(1)} h (${mvp.low.toFixed(1)} to ${mvp.high.toFixed(1)} h)`} (target ${mvp.target}: ${verdict(mvp.met)})`,
    `if every run were like the shortest third measured (${short.length} runs, ${clock(short[0].seconds)} to ${clock(short[short.length - 1].seconds)}): MVP harbor fully restored in ${slow.hours === null ? `more than ${SLOW_MAX_RUNS} runs` : `${slow.hours.toFixed(1)} h (${slow.low.toFixed(1)} to ${slow.high.toFixed(1)} h)`}, by ${slow.reached} of ${slow.of} players within ${SLOW_MAX_RUNS} runs`,
    `a fresh profile's pools hold ${Math.round(share.share * 100)}% of the run content (${share.have} of ${share.of} weapons, passives, relics, and runes; brief §6.4 wants about 70% locked at the start, so ${Math.round(targets.freshShare * 100)}% or less: ${verdict(share.met)}; §20 call 60)`,
  ];
  return { before, table, after, report, slow, short, share };
}
