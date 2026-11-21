// The pacing model (tools/pacing/, ARCHITECTURE §10.3) on made-up yields: the greedy buyer's order
// and its spending, greed scaling a run's haul over its stage's, the map a player runs on and the
// stage they draw from, players finishing what the harbor offers with their events in order, the
// report's arithmetic pinned on hand-built players, the fresh profile's share, the harbor stages,
// and the fingerprints that say whether the kept yields were measured on today's code and data.
// The gate checks that the committed yields exist and parse; whether they are fresh is the drift
// check, `npm run pacing:check`, a release step (ARCHITECTURE §14). This file never measures (the
// workspace tool does, in about an hour): it reads the committed yields.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA } from '../src/data/index.js';
import { defaultProfile } from '../src/save/schema.js';
import { purchaseOptions } from '../src/meta/next.js';
import { levelOf, mapOpen } from '../src/meta/state.js';
import { applyRunResult } from '../src/meta/apply.js';
import { resolveContent } from '../src/meta/state.js';
import { createKiteBot } from '../src/sim/bot.js';
import { codeOf } from '../tools/atlas/sources.mjs';
import {
  buyGreedy, allDone, simulatePlayer, simulatePlayers, summarize, freshShare, runResultFor, greedOf, shortestThird, assumptions, percentile,
  chooseMap, nearestSet, setsOf, nextWant, filterSets, BUY_ORDER, TARGETS,
} from '../tools/pacing/model.mjs';
import { stageProfile, stagesFor, progressOf, stageShare, bossOrder, STAGES } from '../tools/pacing/stages.mjs';
import {
  yieldsFingerprints, yieldsInputs, readYields, staleSets, staleText, checkYields, setKey, playedData, YIELDS_FILE, SKILLED_YIELDS_FILE, STAYS_YIELDS_FILE, HARBOR_ONLY, RENDER_ONLY, RENDER_FIELDS, REMEASURE,
} from '../tools/pacing/yields.mjs';
import { measureOne, measureConfig, measureBot, measureSeed, playOut, MEASURE, STAYS, FIRST_MAP } from '../tools/pacing/measure.mjs';
import { pacingReport, reportFiles, verdict, hoursText, MAX_RUNS, SLOW_MAX_RUNS } from '../tools/pacing/report.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MARSH = 'salt_marsh';

const RUN = { seconds: 900, materials: { coin: 45, oil: 30, timber: 9, rope: 6, drowned_pages: 9, rum: 3, iron: 1, map_scraps: 1 }, bosses: 1, end: 'died' };
// (X3, D5: a Marsh run here kills both its bosses, since the Chapel's first level waits on the Salt Widow.)
const MARSH_RUN = { seconds: 900, materials: { coin: 45, oil: 30, marsh_herbs: 12, salt_glass: 1, map_scraps: 1 }, bosses: 2, end: 'cleared' };
const times = (r, k) => ({ ...r, materials: Object.fromEntries(Object.entries(r.materials).map(([id, n]) => [id, n * k])) });
/** Made-up yields on both maps, rich enough that a player finishes the harbor in a hundred runs or so. */
const BOTH = [{ map: FIRST_MAP, stage: 0, runs: [times(RUN, 8)] }, { map: MARSH, stage: 1, runs: [times(MARSH_RUN, 8)] }];   // (0.9.0: x8, the Lighthouse's ten stages too)
const RICH = Object.fromEntries(DATA.materials.map((m) => [m.id, 999999]));
function profile(levels = {}, mats = {}) { const d = defaultProfile(); Object.assign(d.profile.buildings, levels); Object.assign(d.profile.materials, mats); return d; }
/** A profile with the Salt Marsh open (the Docks and the Tavern restored, the Harbor Maw killed). */
function marshOpen(levels = {}, mats = {}) { const d = profile({ docks: 1, tavern: 1, ...levels }, mats); d.profile.bestiary.harbor_maw = 1; return d; }

test('pacing: the greedy buyer restores first, then researches, then upgrades, spends until nothing is affordable, never overspends', () => {
  const doc = profile({}, { oil: 40, coin: 40, timber: 10, drowned_pages: 12 });
  const { doc: after, bought } = buyGreedy(doc, DATA);
  assert.equal(bought[0].kind, 'building_level', 'a building level first');
  assert.equal(levelOf(after, 'lamp_post', DATA), 1);
  assert.ok(purchaseOptions(after, DATA).every((o) => o.progress < 1), 'nothing affordable is left unbought');
  for (const n of Object.values(after.profile.materials)) assert.ok(n >= 0);
  assert.equal(doc.profile.materials.oil, 40, 'the profile passed in is untouched');
  // With everything affordable: every building level, then research, then upgrades, in that order.
  const rich = buyGreedy(profile({ lamp_post: 1, library: 1 }, RICH), DATA).bought;
  const kindOf = { building_level: 'building', research_started: 'research', upgrade_rank: 'upgrade' };
  const order = rich.map((c) => BUY_ORDER.indexOf(kindOf[c.kind]));
  assert.ok(order.every((k, i) => i === 0 || k >= order[i - 1]), `bought in order: ${[...new Set(rich.map((c) => c.kind))].join(', ')}`);
  assert.deepEqual([...new Set(rich.map((c) => kindOf[c.kind]))], BUY_ORDER);
  // The cheapest first within a kind: with exactly enough for the Lamp Post's, the Library's, and
  // the Tavern's first levels, the two cheap ones, and then the Tavern is out of reach.
  const cost = (id) => DATA.buildings.find((b) => b.id === id).levels[0].cost;
  const exact = {};
  for (const id of ['lamp_post', 'library', 'tavern']) for (const [m, n] of Object.entries(cost(id))) exact[m] = Math.max(exact[m] ?? 0, n);
  const three = buyGreedy(profile({}, exact), DATA).bought.filter((c) => c.kind === 'building_level').map((c) => c.id);
  assert.deepEqual(three, ['lamp_post', 'library'], 'the cheap ones first, and then the Tavern is out of reach');
  const reversed = { ...DATA, buildings: [...DATA.buildings].reverse() };
  assert.deepEqual(buyGreedy(profile({}, exact), reversed).bought.filter((c) => c.kind === 'building_level').map((c) => c.id), ['lamp_post', 'library'], 'the cost decides, not the data\'s order');
  // Done means every level, every project, and every rank: one rank short is not done.
  const all = profile(Object.fromEntries(DATA.buildings.map((b) => [b.id, b.levels.length])));
  all.profile.research.done = DATA.research.map((r) => r.id);
  for (const u of DATA.upgrades) all.profile.upgrades[u.id] = u.ranks;
  assert.equal(allDone(all, DATA), true);
  all.profile.upgrades[DATA.upgrades[0].id] -= 1;
  assert.equal(allDone(all, DATA), false, 'an upgrade a rank short');
});

test('pacing: a measured run replayed for a profile: on its map, its bosses named, with the player\'s greed over its stage\'s', () => {
  const run = { seconds: 600, materials: { coin: 100, oil: 7 }, seaGlass: 9, bosses: 1, end: 'died' };
  const plain = runResultFor(run, profile(), DATA);
  assert.deepEqual(plain.materials, { coin: 100, oil: 7 });
  assert.deepEqual([plain.map, plain.timeSurvived, plain.bossesKilled, plain.kills, plain.seaGlass, plain.tide], [FIRST_MAP, 600, ['harbor_maw'], { harbor_maw: 1 }, 9, 0]);
  const lucky = profile({ lamp_post: 5 });
  lucky.profile.upgrades.tide_luck = 3;   // +5% a rank
  assert.deepEqual(runResultFor(run, lucky, DATA).materials, { coin: 115, oil: 8 });
  assert.deepEqual(runResultFor({ ...run, materials: { coin: 13 } }, lucky, DATA).materials, { coin: 14 }, '14.95: rounded down, once');
  // A run measured at a stage that had that greed already brings home what it did; one with less, more.
  assert.deepEqual(runResultFor(run, lucky, DATA, { map: FIRST_MAP, greed: greedOf(lucky, DATA) }).materials, { coin: 100, oil: 7 });
  assert.deepEqual(runResultFor(run, profile(), DATA, { map: FIRST_MAP, greed: 2 }).materials, { coin: 50, oil: 3 });
  // The bosses are each map's own, in its timeline's order: the research rule and the bestiary read them.
  assert.deepEqual(runResultFor({ ...run, bosses: 2 }, profile(), DATA).bossesKilled, ['harbor_maw', 'the_tidecaller']);
  assert.deepEqual(runResultFor({ ...run, bosses: 2 }, profile(), DATA, { map: MARSH }).bossesKilled, bossOrder(DATA, MARSH));
  assert.deepEqual(bossOrder(DATA, MARSH), ['old_grey', 'salt_widow']);
  // The Maw killed (with the Docks and the Tavern restored) opens the Marsh, as the bestiary says.
  const before = profile({ docks: 1, tavern: 1 });
  assert.equal(mapOpen(before, DATA, MARSH), false);
  assert.equal(mapOpen(applyRunResult(before, runResultFor(run, before, DATA), DATA).doc, DATA, MARSH), true);
  const going = profile({ library: 1 });
  going.profile.research.active = [{ id: 'tide_charts', runsLeft: 2 }];
  const quick = { seconds: 120, materials: {}, bosses: 1, end: 'died' };
  assert.deepEqual(applyRunResult(going, runResultFor(quick, going, DATA), DATA).doc.profile.research.active, [{ id: 'tide_charts', runsLeft: 1 }], 'a 2:00 run with a boss down counts');
  assert.deepEqual(applyRunResult(going, runResultFor({ ...quick, bosses: 0 }, going, DATA), DATA).doc.profile.research.active, [{ id: 'tide_charts', runsLeft: 2 }], 'without one it doesn\'t');
  // A project that counts only runs on the Marsh waits on a Docks run.
  const marshy = marshOpen({ library: 2 });
  marshy.profile.research.active = [{ id: 'brine_notes', runsLeft: 2 }];
  assert.deepEqual(applyRunResult(marshy, runResultFor(quick, marshy, DATA), DATA).doc.profile.research.active, [{ id: 'brine_notes', runsLeft: 2 }]);
  assert.deepEqual(applyRunResult(marshy, runResultFor(quick, marshy, DATA, { map: MARSH }), DATA).doc.profile.research.active, [{ id: 'brine_notes', runsLeft: 1 }]);
  // Greed goes through the sim's stat formula: an added or a "more" greed counts too, within the cap.
  const as = (op, value) => ({ ...DATA, upgrades: DATA.upgrades.map((u) => (u.id === 'tide_luck' ? { ...u, mods: [{ stat: 'greed', op, value }] } : u)) });
  const one = profile({ lamp_post: 5 }); one.profile.upgrades.tide_luck = 1;
  assert.equal(greedOf(one, as('add', 0.5)), 1.5);
  assert.equal(greedOf(one, as('more', 1)), 2);
  assert.deepEqual(runResultFor(run, one, as('more', 1)).materials, { coin: 200, oil: 14 });
  assert.equal(greedOf(one, as('add', 50)), DATA.tuning.caps.player.greed[1], 'held to the stat\'s cap');
  assert.equal(greedOf(profile(), DATA), 1, 'none without upgrades');
});

test('pacing: the map a player runs on: a project under way there, the next want\'s materials, else the newest map open', () => {
  const maps = [FIRST_MAP, MARSH];
  assert.equal(chooseMap(profile({}, RICH), DATA, maps), FIRST_MAP, 'the Marsh shut: the Docks');
  assert.equal(chooseMap(marshOpen(), DATA, [FIRST_MAP]), FIRST_MAP, 'no yields for the Marsh: the Docks');
  // A project that counts only runs on one map sends the player there.
  const busy = marshOpen({ library: 2 });
  busy.profile.research.active = [{ id: 'brine_notes', runsLeft: 2 }];
  assert.equal(chooseMap(busy, DATA, maps), MARSH);
  busy.profile.research.active = [{ id: 'anchor_smithing', runsLeft: 2 }];
  assert.equal(chooseMap(busy, DATA, maps), FIRST_MAP);
  // The next thing wanted (the closest building level), short of a material only one map drops.
  const need = (doc) => nextWant(doc, DATA);
  const docks = marshOpen({ lamp_post: 1, library: 1 }, {});
  assert.equal(need(docks).kind, 'building');
  assert.ok(need(docks).missing.some((m) => ['timber', 'rope', 'drowned_pages', 'rum', 'iron'].includes(m.id)));
  assert.equal(chooseMap(docks, DATA, maps), FIRST_MAP, 'short of Docks materials: the Docks');
  // Everything but the Apothecary's next level done, and it short of Marsh Herbs: the Marsh.
  const herbs = marshOpen(Object.fromEntries(DATA.buildings.map((b) => [b.id, b.levels.length])), {});
  herbs.profile.buildings.apothecary = 1;
  herbs.profile.materials = { rum: 999 };
  assert.deepEqual(need(herbs).id, 'apothecary');
  assert.ok(need(herbs).missing.some((m) => m.id === 'marsh_herbs'));
  assert.equal(chooseMap(herbs, DATA, maps), MARSH, 'short of Marsh Herbs: the Marsh');
  // Short of nothing only one map drops (Coin): the newest map open.
  const coin = structuredClone(herbs);
  coin.profile.materials = { ...need(herbs).cost, coin: 0 };
  assert.deepEqual(need(coin).missing.map((m) => m.id), ['coin']);
  assert.equal(chooseMap(coin, DATA, maps), MARSH);
  // The stage nearest the player's progress; the sets carry their stage's progress and greed.
  const sets = setsOf([{ map: FIRST_MAP, stage: 0, runs: [RUN] }, { map: FIRST_MAP, stage: 2, runs: [RUN] }, { map: MARSH, stage: 1, runs: [MARSH_RUN] }], DATA);
  assert.deepEqual(sets.map((s) => s.progress), [0, progressOf(stageProfile(DATA, 2), DATA), progressOf(stageProfile(DATA, 1), DATA)]);
  assert.equal(sets[0].greed, 1);
  assert.equal(nearestSet(sets, FIRST_MAP, 0.1).stage, 0);
  assert.equal(nearestSet(sets, FIRST_MAP, 0.4).stage, 2);
  assert.equal(nearestSet(sets, MARSH, 0).stage, 1, 'the only set on the map');
  assert.deepEqual(setsOf([RUN], DATA), [{ map: FIRST_MAP, stage: 0, runs: [RUN], progress: 0, greed: 1 }], 'a list of runs: the first map, fresh');
  assert.deepEqual(filterSets(sets, (rs) => rs.filter((r) => r.end === 'cleared')).whole.length, 2, 'a set with none kept keeps all its runs (the Marsh\'s made-up run cleared: X3)');
});

test('pacing: a player plays until the harbor has nothing left, moving to the Marsh once it opens, and the events come in order', () => {
  const s = simulatePlayer(BOTH, DATA, { seed: 3, hubMinutes: 1.5 });
  assert.ok(s.done && allDone(s.doc, DATA), 'everything bought and researched');
  assert.equal(s.events[0].run, 1, 'the first building level comes at the end of run 1 (§10.3)');
  for (let i = 1; i < s.events.length; i++) assert.ok(s.events[i].minutes >= s.events[i - 1].minutes && s.events[i].run >= s.events[i - 1].run);
  assert.ok(Math.abs(s.minutes - s.runs * (15 + 1.5)) < 1e-6, 'every run is its length plus the time in the harbor');
  const levels = s.events.filter((e) => e.kind === 'building');
  assert.equal(levels.length, DATA.buildings.reduce((n, b) => n + b.levels.length, 0), 'every level, once');
  assert.deepEqual(s.events.filter((e) => e.kind === 'research').map((e) => e.id).sort(), DATA.research.map((r) => r.id).sort(), 'every project once, when it finishes');
  assert.equal(s.events.filter((e) => e.kind === 'upgrade').length, DATA.upgrades.reduce((n, u) => n + u.ranks, 0), 'every rank, once');
  // The Marsh opens once, and the player runs there from then on, some of the time.
  const opened = s.events.filter((e) => e.kind === 'map');
  assert.deepEqual(opened.map((e) => e.id), [MARSH]);
  assert.ok(s.mapRuns[MARSH] > 0 && s.mapRuns[FIRST_MAP] >= opened[0].run, JSON.stringify(s.mapRuns));
  assert.equal(s.mapRuns[MARSH] + s.mapRuns[FIRST_MAP], s.runs);
  // With only the Docks' yields, the Marsh's materials never come, and the harbor is never done.
  const docksOnly = simulatePlayer([times(RUN, 3)], DATA, { seed: 3, maxRuns: 150 });
  assert.equal(docksOnly.done, false);
  // Runs that never reach 5:00 or a boss never move research on.
  const short = simulatePlayer([{ ...RUN, seconds: 120, bosses: 0 }], DATA, { seed: 1, maxRuns: 30 });
  assert.equal(short.events.filter((e) => e.kind === 'research').length, 0);
  // Each run is drawn at random from its set, and each player draws their own: with a short run and
  // a long one, players take different times, and every player gets some of each.
  const two = [{ ...RUN, seconds: 600 }, { ...RUN, seconds: 1500 }];
  const players = simulatePlayers(two, DATA, { players: 4, maxRuns: 20 });
  assert.ok(new Set(players.map((p) => p.minutes)).size > 1, 'players draw different runs');
  for (const p of players) {
    const longRuns = (p.minutes - p.runs * (10 + 1.5)) / 15;   // each long run adds 15 minutes over a short one
    assert.ok(longRuns > 0 && longRuns < p.runs, `a mix of both (${longRuns} long of ${p.runs})`);
  }
  // And the players use their own greed: with a lot of it, the harbor comes back in fewer runs.
  const greedy = { ...DATA, upgrades: DATA.upgrades.map((u) => (u.id === 'tide_luck' ? { ...u, mods: [{ stat: 'greed', op: 'pct', value: 0.5 }] } : u)) };
  const none = { ...DATA, upgrades: DATA.upgrades.map((u) => (u.id === 'tide_luck' ? { ...u, mods: [{ stat: 'greed', op: 'pct', value: 0 }] } : u)) };
  assert.ok(simulatePlayer(BOTH, greedy, { seed: 1 }).runs < simulatePlayer(BOTH, none, { seed: 1 }).runs);
});

/**
 * A hand-built player: the 15 building levels (the Lamp Post's five, the Library's, the Tavern's)
 * at the runs given, research finished at others, upgrade ranks at others; `pace` minutes a run.
 */
function handBuilt(levelRuns, { research = [], upgrades = [], pace = 20, marsh = null } = {}) {
  const order = DATA.buildings.filter((b) => DATA.meta.mvpBuildings.includes(b.id)).flatMap((b) => b.levels.map((_, i) => ({ id: b.id, level: i + 1 })));
  const events = [
    ...order.map((l, i) => ({ run: levelRuns[i], kind: 'building', id: l.id, level: l.level, unlocks: l.id === 'lamp_post' && l.level === 2 ? [{ what: 'character', id: 'harpooner' }] : [] })),
    ...research.map((run, i) => ({ run, kind: 'research', id: DATA.research[i].id })),
    ...upgrades.map((run) => ({ run, kind: 'upgrade', id: 'bright_flame', rank: 1 })),
    ...(marsh ? [{ run: marsh, kind: 'map', id: MARSH }] : []),
  ].map((e) => ({ ...e, minutes: e.run * pace })).sort((a, b) => a.run - b.run);
  return { events };
}

test('pacing: the report\'s arithmetic, pinned on three hand-built players', () => {
  const steps = (k) => Array.from({ length: 15 }, (_, i) => k * i + 1);        // a level every k runs
  // Three players at three paces (20, 15, and 25 minutes a run), so hours never follow runs alone.
  const sims = [handBuilt(steps(1), { research: [20, 22], upgrades: [30], pace: 20, marsh: 8 }), handBuilt(steps(2), { pace: 15, marsh: 12 }), handBuilt(steps(3), { pace: 25 })];
  sims[0].mapRuns = { [FIRST_MAP]: 30, [MARSH]: 10 }; sims[1].mapRuns = { [FIRST_MAP]: 20 };
  const r = summarize(sims, DATA);
  const row = (name) => r.milestones.find((m) => m.milestone === name);
  assert.deepEqual(r.milestones.map((m) => m.milestone), [
    'first building level', 'Harpooner arrives', 'first research done', 'Salt Marsh opens', ...DATA.buildings.map((b) => `${b.name} fully restored`),
    'MVP harbor fully restored', 'whole harbor fully restored', 'all research done', 'every upgrade at its last rank',
  ], 'every character a building brings and every later map get a row, every building a row of its own');
  // The median is the middle value, the range the 10th to the 90th percentile (the ends, here);
  // runs and hours are sorted on their own.
  const h = (run, pace) => (run * pace) / 60;
  assert.deepEqual(row('first building level'), { milestone: 'first building level', target: 'run 1', runs: 1, hours: h(1, 20), low: h(1, 15), high: h(1, 25), reached: 3, of: 3, met: true });
  assert.deepEqual(row('Harpooner arrives'), { milestone: 'Harpooner arrives', target: null, runs: 3, hours: h(3, 15), low: h(2, 20), high: h(4, 25), reached: 3, of: 3, met: null });
  assert.deepEqual(row('Salt Marsh opens'), { milestone: 'Salt Marsh opens', target: null, runs: 12, hours: h(12, 15), low: h(8, 20), high: h(12, 15), reached: 2, of: 3, met: null });
  assert.deepEqual(row('Lamp Post fully restored'), { milestone: 'Lamp Post fully restored', target: null, runs: 9, hours: h(9, 15), low: h(5, 20), high: h(13, 25), reached: 3, of: 3, met: null });
  assert.deepEqual(row('MVP harbor fully restored'), { milestone: 'MVP harbor fully restored', target: '6 to 10 h', runs: 29, hours: h(29, 15), low: h(15, 20), high: h(43, 25), reached: 3, of: 3, met: true });
  assert.equal(r.mvp, row('MVP harbor fully restored'));
  assert.deepEqual(row('first research done'), { milestone: 'first research done', target: null, runs: 20, hours: h(20, 20), low: h(20, 20), high: h(20, 20), reached: 1, of: 3, met: null });
  assert.deepEqual(row('all research done'), { milestone: 'all research done', target: null, runs: null, hours: null, low: null, high: null, reached: 0, of: 3, met: null });
  // The runs on each map, pooled over the players (the third has none recorded).
  assert.deepEqual(r.mapShare, { [FIRST_MAP]: 50 / 60, [MARSH]: 10 / 60 });
  // Runs between new things (levels and research; the upgrade at run 30 doesn't count): over the
  // first 10 runs, 10, 5, and 4 of them brought something (30 runs over 19); after that, to each
  // player's own last new thing, 7 in 12 runs, 10 in 19, and 11 in 33 (64 over 28).
  assert.deepEqual(r.gaps.early, { runs: 30 / 19, target: '1 to 2 runs', met: true, side: null, from: 1, until: 10 });
  assert.deepEqual(r.gaps.later, { runs: 64 / 28, target: '3 to 4 runs', met: false, side: 'sooner', from: 11, until: 29 });
  // A dry stretch at the end of the early window counts in it.
  const dry = { events: [1, 2, 3, 4, 5, 11].map((run) => ({ run, minutes: run * 20, kind: 'building', id: 'lamp_post', level: run, unlocks: [] })), runs: 11 };
  assert.equal(summarize([dry], DATA).gaps.early.runs, 2);
  assert.equal(summarize([dry], DATA).gaps.later.runs, 1, 'and the later window starts at run 11');
  assert.equal(summarize([{ events: [], runs: 30 }], DATA).gaps.early.runs, null, 'nothing new at all: no number');
  // A player who never finishes the harbor misses the MVP target, though the one who does is on it.
  const onTime = handBuilt(steps(2), { pace: 20 });   // the 15th level at run 29, 9.7 h
  assert.equal(summarize([onTime], DATA).mvp.met, true);
  const stuck = summarize([onTime, { events: [] }], DATA);
  assert.deepEqual([stuck.mvp.reached, stuck.mvp.met], [1, false]);
  const late = summarize([handBuilt(steps(1).map((run) => run + 1))], DATA);
  assert.deepEqual([late.milestones[0].runs, late.milestones[0].met], [2, false], 'the first level after run 1 misses');
  // Targets come from one place, and the verdicts follow them, their edges included.
  assert.equal(summarize(sims, DATA, { ...TARGETS, mvpHours: [1, 5] }).mvp.met, false);
  const mvpH = r.mvp.hours;
  assert.equal(summarize(sims, DATA, { ...TARGETS, mvpHours: [mvpH, mvpH + 1] }).mvp.met, true, 'the low edge counts');
  assert.equal(summarize(sims, DATA, { ...TARGETS, mvpHours: [mvpH - 1, mvpH] }).mvp.met, true, 'the high edge counts');
  assert.equal(summarize(sims, DATA, { ...TARGETS, newEarly: [30 / 19, 2] }).gaps.early.met, true, 'a gap on the edge counts');
  assert.deepEqual([percentile([1, 2, 3, 4, 5], 0.1), percentile([1, 2, 3, 4, 5], 0.5), percentile([1, 2, 3, 4, 5], 0.9)], [1, 3, 5]);
  const eleven = Array.from({ length: 11 }, (_, k) => handBuilt(steps(1), { pace: 10 + k }));
  const e = summarize(eleven, DATA).mvp;
  assert.deepEqual([e.runs, e.hours, e.low, e.high], [15, h(15, 15), h(15, 11), h(15, 19)], 'eleven players: the sixth, and the second and the tenth');
  // The MVP harbor is the MVP buildings: a building a later phase adds doesn't move it.
  const later = { ...DATA, buildings: [...DATA.buildings, { id: 'reef', name: 'The Reef', levels: DATA.buildings[0].levels }] };
  const withReef = sims.map((x) => ({ events: [...x.events, ...[1, 2, 3, 4, 5].map((level) => ({ run: 1 + level, minutes: (1 + level) * 20, kind: 'building', id: 'reef', level, unlocks: [] }))].sort((a, b) => a.run - b.run) }));
  const rd = summarize(withReef, later);
  assert.deepEqual([rd.mvp.runs, rd.mvp.hours], [r.mvp.runs, r.mvp.hours]);
  assert.equal(hoursText({ hours: 2, low: 1, high: 3.25 }), '2.0 h (1.0 to 3.3 h)');
  assert.equal(hoursText({ hours: null }, 7), 'more than 7 runs');
});

test('pacing: the fresh profile\'s share, the shortest third, and what the report stands on', () => {
  // Pool content only (brief §6.4: what research locks away): the weapons that go in the pools,
  // passives, relics, and runes, not the characters.
  // 0.9.0 (the lead's ruling 3): a pool about twice the slots from the first run puts the Oil Flask
  // and four passives in a fresh profile's pools: 20 of 57, 35%, over the brief's 30% (a builder's call).
  // (The sweep, ruling 11: five arcana became relics, so the pool is 62 and the fresh share 32%.)
  assert.deepEqual(freshShare(DATA), { have: 18, of: 59, share: 18 / 59, met: false }, '6 weapons, 8 passives, 4 relics: 31% (ruling 14: runes are gone)');
  const unlocked = { ...DATA, relics: DATA.relics.map((x) => ({ ...x, unlock: 'starter' })) };
  assert.ok(freshShare(unlocked).share > freshShare(DATA).share);
  assert.equal(freshShare({ ...DATA, characters: [...DATA.characters, { ...DATA.characters[0], id: 'extra' }] }).of, freshShare(DATA).of, 'characters don\'t count');
  const runs = [300, 1200, 800, 1500, 600, 1000, 900].map((seconds, k) => ({ k, seconds, materials: {}, bosses: 0, end: k % 2 ? 'died' : 'left' }));
  assert.deepEqual(shortestThird(runs).map((r) => r.seconds), [300, 600, 800]);
  assert.deepEqual(shortestThird(runs.slice(0, 1)).map((r) => r.seconds), [300]);
  const lines = assumptions({ runs, minutes: 25, hubMinutes: 1.5, character: 'Lamplighter', archetypes: ['projectile_storm', 'orbit_tank'], overtime: 'leave', players: 40 });
  assert.match(lines[0], /^The yields are 7 bot runs, all as Lamplighter \(projectile_storm, orbit_tank builds, in turn\): 0 cleared the map, 3 died, 4 were still going at 25:00 and left\./);
  assert.match(lines[0], /After the last boss a bot leaves at once \(no overtime\)\.$/);
  assert.ok(lines.some((l) => /newer player's; --skilled gives a practiced player's/.test(l)), 'the dying bots are a newer player');
  const clears = runs.map((r) => ({ ...r, end: 'cleared' }));
  assert.ok(assumptions({ runs: clears, minutes: 25, hubMinutes: 1.5, character: 'x', archetypes: ['a'], overtime: 'leave', players: 40 }).some((l) => /can die, but none did: .* not a newer player's/.test(l)), 'bots that never died aren\'t called a newer player');
  const sk = assumptions({ runs, minutes: 25, hubMinutes: 1.5, character: 'Lamplighter', archetypes: ['a'], overtime: 'leave', players: 40, skilled: true });
  assert.ok(sk.some((l) => /can't die: a practiced player's pace.*\(the line under the table\)/.test(l)), 'the --skilled yields are a practiced player, read on the cleared line');
  assert.ok(assumptions({ runs: clears, minutes: 25, hubMinutes: 1.5, character: 'x', archetypes: ['a'], overtime: 'leave', players: 40, skilled: true }).some((l) => /Every one of their runs cleared the map, so the table is the cleared runs'/.test(l)), 'and on the table when every run cleared');
  assert.ok(lines.includes('Each simulated run is one of those runs, drawn at random, for 40 players: the range is the spread of those draws, not the spread between real players.'));
  assert.ok(lines.includes('Each run is followed by 1.5 minutes in the harbor.'));
  assert.ok(lines.includes('After every run the player spends everything they can: building levels, then research, then upgrades, the cheapest first.'));
  assert.ok(lines.includes('A run brings home what its stage\'s runs did, with the greed of the player\'s own Lamp Post upgrades over the stage\'s.'));
  const two = assumptions({ runs, minutes: 25, hubMinutes: 1.5, character: 'x', archetypes: ['a'], overtime: 'stay', players: 40, sets: [{ map: 'a', mapName: 'the A' }, { map: 'b', mapName: 'the B' }] });
  assert.match(two[0], /^The yields are 7 bot runs on the A and the B, in 2 sets \(a map at a harbor stage each\).*After the last boss a bot stays for overtime\.$/);
  assert.ok(two.some((l) => /each run uses the stage nearest the player's own progress/.test(l)));
});

test('pacing: the harbor stages: a declared share of the harbor, never its costs; the Marsh open with its storm and Well past the first', () => {
  assert.deepEqual(STAGES, [0, 1, 2, 3]);
  assert.deepEqual(STAGES.map(stageShare), [0, 0.25, 0.5, 0.75]);
  assert.deepEqual(stageProfile(DATA, 0), defaultProfile(), 'stage 0 is a fresh profile');
  const progress = STAGES.map((s) => progressOf(stageProfile(DATA, s), DATA));
  assert.ok(progress.every((p, i) => i === 0 || p > progress[i - 1]) && progress[3] < 1, progress.join(', '));
  assert.equal(progressOf(stageProfile(DATA, 0), DATA), 0);
  // The fog keeps a building a ruin: at a quarter, only the Docks of the six; at a half, the Chapel too.
  assert.deepEqual(stageProfile(DATA, 1).profile.buildings, { lamp_post: 1, library: 1, tavern: 1, docks: 1 });
  assert.equal(stageProfile(DATA, 2).profile.buildings.chapel, 3);
  assert.equal(stageProfile(DATA, 2).profile.buildings.smithy, undefined);
  // Upgrades only of open tiers; research only of open tiers, each after what it requires.
  for (const s of STAGES) {
    const d = stageProfile(DATA, s);
    const tree = Math.max(0, ...DATA.buildings[0].levels.slice(0, d.profile.buildings.lamp_post ?? 0).map((l) => l.tree));
    for (const id of Object.keys(d.profile.upgrades)) assert.ok(DATA.upgrades.find((u) => u.id === id).tier <= tree, `${id} at stage ${s}`);
    const done = d.profile.research.done;
    done.forEach((id, i) => assert.ok(DATA.research.find((r) => r.id === id).requires.every((q) => done.slice(0, i).includes(q)), `${id} after what it requires`));
  }
  // Past the fresh profile the Marsh is open, with its storm and Well; its secret is past every stage.
  assert.deepEqual(stagesFor(DATA, FIRST_MAP), [0, 1, 2, 3]);
  assert.deepEqual(stagesFor(DATA, MARSH), [1, 2, 3]);
  for (const s of [1, 2, 3]) assert.deepEqual(measureConfig(0, false, MARSH, s).layers, { storm: true, well: true, secret: false }, `stage ${s}`);
  // A stage reads no cost: with every cost doubled, the same profiles.
  const dear = { ...DATA, buildings: DATA.buildings.map((b) => ({ ...b, levels: b.levels.map((l) => ({ ...l, cost: Object.fromEntries(Object.entries(l.cost).map(([k, v]) => [k, v * 2])) })) })),
    research: DATA.research.map((r) => ({ ...r, cost: { coin: 999 } })), upgrades: DATA.upgrades.map((u) => ({ ...u, cost: { oil: 999 } })) };
  for (const s of STAGES) assert.deepEqual(stageProfile(dear, s), stageProfile(DATA, s));
});

test('pacing: a measured run plays its stage\'s config on its map with the bot, and a halt it can\'t answer stops it with an error', () => {
  // What the report says: a fresh profile's pools on the Docks at stage 0, not all the content.
  const cfg = measureConfig(3);
  const fresh = resolveContent(defaultProfile(), DATA);
  assert.deepEqual([cfg.character, cfg.seed, cfg.map], [MEASURE.character, measureSeed(3), FIRST_MAP]);
  assert.equal(measureSeed(3, MARSH, 2), 'pacing-salt_marsh-s2-3', 'each set its own seeds');
  assert.equal(cfg.invulnerable, undefined, 'an ordinary measured run can die');
  assert.equal(measureConfig(3, true).invulnerable, true, 'a --skilled one can\'t');
  assert.deepEqual(cfg.pools, { weapons: fresh.weapons, passives: fresh.passives, relics: fresh.relics });
  assert.ok(cfg.pools.weapons.length < DATA.weapons.length, 'less than everything');
  const later = measureConfig(3, false, MARSH, 2);
  assert.equal(later.map, MARSH);
  assert.ok(later.pools.weapons.length > cfg.pools.weapons.length && later.mods.length > 0 && later.harbor.ferry > 0, 'a later stage plays with more');
  // The bot: the archetypes in turn, run by run, and overtime as MEASURE says (what the report says it did).
  const n = MEASURE.archetypes.length;
  assert.deepEqual(Array.from({ length: n * 2 }, (_, k) => measureBot(k).archetype), [...MEASURE.archetypes, ...MEASURE.archetypes]);
  assert.ok(new Set(MEASURE.archetypes).size === n && n >= 2, 'more than one build, each once in a turn');
  assert.equal(MEASURE.overtime, 'leave', 'the bots leave after the last boss (the report says so)');
  const given = [];
  measureOne({ k: 4, minutes: 0.01 }, (o) => { given.push(o); return createKiteBot(o); });
  assert.deepEqual(given, [measureBot(4)], 'a measured run\'s bot is made as measureBot says');
  // The player who stays (X3, E1): the same builds, staying for overtime, and a run that says whether it won the dawn.
  assert.deepEqual([STAYS.overtime, measureBot(4, true).stay, measureBot(4, true).archetype, measureBot(4).stay], ['stay', true, measureBot(4).archetype, false]);
  assert.ok(STAYS.minutes >= 40, 'long enough for the Long Night');
  given.length = 0;
  const st = measureOne({ k: 4, minutes: 0.01, skilled: true, stays: true }, (o) => { given.push(o); return createKiteBot(o); });
  assert.deepEqual(given, [measureBot(4, true)]);
  assert.equal(st.dawn, false);
  // A few seconds of a real one.
  const r = measureOne({ k: 0, minutes: 0.05 });
  assert.deepEqual(Object.keys(r).sort(), ['bosses', 'end', 'k', 'materials', 'seaGlass', 'seconds']);
  assert.ok(Math.abs(r.seconds - 3) <= 1 && r.end === 'left' && r.bosses === 0, JSON.stringify(r));
  // A halt that never clears: an error naming it, not a hang (a halted world doesn't tick).
  const stuck = { tick: 0, over: false };
  const sim = { stepWorld: () => {}, currentHalt: () => ({ kind: 'mystery' }), decide: () => {} };
  assert.throws(() => playOut(stuck, { input: () => null, decide: () => ({ kind: 'ok' }) }, 1, sim), /can't get past a mystery \(still there after 100 answers\)/);
  let halts = 3;
  const w = { tick: 0, over: false };
  playOut(w, { input: () => null, decide: () => ({}) }, 0.01, { stepWorld: (x) => { x.tick++; }, currentHalt: () => (halts > 0 ? { kind: 'levelup' } : null), decide: () => { halts--; } });
  assert.equal(w.tick, 36, 'one that clears after a few answers plays on to the end');
});

test('pacing: each set\'s fingerprint covers what its runs play with, and not the harbor\'s costs or the art', async () => {
  // What a measured run runs: measure.mjs and the code it imports (the data is taken as data).
  const inputs = yieldsInputs(ROOT);
  for (const f of ['tools/pacing/measure.mjs', 'tools/pacing/stages.mjs', 'src/sim/world.js', 'src/sim/pickups.js', 'src/sim/marsh.js', 'src/meta/runconfig.js', 'src/sim/bot.js']) assert.ok(inputs.includes(f), f);
  assert.ok(!inputs.some((f) => f.startsWith('src/data/') || f.startsWith('src/render/')), 'data files are fingerprinted as data, and no view code');
  // The art is left out because nothing a run runs reads it: the sim's code never names a render
  // field or table (a sim that started to would have to take it out of RENDER_FIELDS and RENDER_ONLY).
  const art = new RegExp(`\\b(${[...RENDER_FIELDS, ...RENDER_ONLY].join('|')})\\b`);
  for (const f of inputs.filter((x) => x.startsWith('src/sim/') || x.startsWith('src/lib/'))) assert.ok(!art.test(codeOf(readFileSync(join(ROOT, f), 'utf8'))), `${f} names ${art}`);
  // Everything the sim plays with is fingerprinted as data; only the harbor's own and the art's is left out.
  assert.deepEqual(Object.keys(DATA).filter((k) => !HARBOR_ONLY.includes(k) && !RENDER_ONLY.includes(k)).sort(), ['ascensions', 'bosses', 'characters', 'dashes', 'enemies', 'maps', 'materials', 'passives', 'relics', 'retiredWeapons', 'skills', 'slots', 'tuning', 'weaponUps', 'weapons']);
  assert.ok(!/"(sprite|icon)":/.test(playedData(DATA, MARSH)) && JSON.parse(playedData(DATA, MARSH)).maps.map((m) => m.id).join() === MARSH, 'no art, and only its own map');
  const now = await yieldsFingerprints(ROOT);
  assert.deepEqual(now.sets.map(setKey), [...[0, 1, 2, 3].map((s) => `${FIRST_MAP} stage ${s}`), ...[1, 2, 3].map((s) => `${MARSH} stage ${s}`)]);
  const fp = (x) => x.sets.map((s) => x.of(s.map, s.stage));
  const base = fp(now);
  for (const f of base) assert.match(f, /^[0-9a-f]{16}$/);
  assert.equal(new Set(base).size, base.length, 'each set its own');
  // On copies (each its own, so its modules load fresh): a comment, a harbor cost, or the art keeps
  // them; a code change, what the sim plays with, a stage's pools, or a map's own data doesn't.
  const tmps = [];
  const copy = async (...edits) => {
    const tmp = mkdtempSync(join(tmpdir(), 'lamplight-yields-'));
    tmps.push(tmp);
    for (const dir of ['src', 'tools/pacing', 'tools/atlas', 'tests/helpers']) cpSync(join(ROOT, dir), join(tmp, dir), { recursive: true, filter: (f) => !f.includes('node_modules') });
    for (const [file, from, to] of edits) { const p = join(tmp, file); const src = readFileSync(p, 'utf8'); assert.ok(src.includes(from), `${file} has ${from}`); writeFileSync(p, src.replace(from, to)); }
    return fp(await yieldsFingerprints(tmp));
  };
  try {
    const lamp = DATA.buildings[0].levels[0].cost.oil;
    const enemy = DATA.enemies.find((x) => typeof x.sprite === 'string');
    const icon = DATA.weapons.find((x) => typeof x.icon === 'string');
    assert.deepEqual(await copy(
      ['src/sim/pickups.js', 'world.stats.greed', 'world.stats.greed /* a note */'],
      ['src/data/buildings.js', `cost: { oil: ${lamp},`, `cost: { oil: ${lamp + 1},`],
      ['src/data/enemies.js', `sprite: '${enemy.sprite}'`, `sprite: '${enemy.sprite}_redrawn'`],
      ['src/data/weapons.js', `icon: '${icon.icon}'`, `icon: '${icon.icon}_redrawn'`],
    ), base, 'a comment, a harbor cost, a sprite, and an icon don\'t count');
    const changed = async (why, ...edits) => { const got = await copy(...edits); return base.map((f, i) => f !== got[i]); };
    assert.deepEqual(await changed('code', ['src/sim/pickups.js', 'world.stats.greed', 'world.stats.greed * 2']), base.map(() => true), 'a code change: every set');
    assert.deepEqual(await changed('tuning', ['src/data/tuning.js', 'speed: 80', 'speed: 81']), base.map(() => true), 'what the sim plays with: every set');
    assert.notDeepEqual(await changed('pools', ['src/data/relics.js', "unlock: 'building:tavern:3'", "unlock: 'starter'"]), base.map(() => false), 'a relic\'s unlock (the data the sim plays with)');
    // A harbor change that changes what a stage plays with: the Lamp Post's level 1 opening tier 2's
    // upgrades. Only stage 1 has the Lamp Post at level 1 (stage 0 a ruin, stages 2 and 3 past tier 2).
    assert.deepEqual(await changed('stage', ['src/data/buildings.js', ', tree: 1 }', ', tree: 2 }']), [false, true, false, false, true, false, false], 'a stage\'s run config: its sets alone');
    const marshDensity = DATA.maps.find((m) => m.id === MARSH).timeline.bands[0].density;
    assert.deepEqual(await changed('marsh', ['src/data/maps.js', `density: [${marshDensity.join(', ')}]`, `density: [${marshDensity[0]}, ${marshDensity[1] + 1}]`]), [false, false, false, false, true, true, true], 'the Marsh\'s timeline: the Marsh\'s sets alone');
  } finally {
    for (const t of tmps) rmSync(t, { recursive: true, force: true });
  }
  // staleSets: fresh, stale, missing, and no longer a set.
  const saved = { sets: now.sets.map((s) => ({ ...s, fingerprint: now.of(s.map, s.stage), runs: [RUN] })) };
  assert.deepEqual(staleSets(saved, now), { stale: [], extra: [] });
  saved.sets[4].fingerprint = 'measured-elsewhere';
  saved.sets.pop();
  saved.sets.push({ map: MARSH, stage: 0, fingerprint: 'x', runs: [RUN] });
  const st = staleSets(saved, now);
  assert.deepEqual(st, { stale: [`${MARSH} stage 1`, `${MARSH} stage 3`], extra: [`${MARSH} stage 0`] });
  assert.equal(staleText('y.json', st), `STALE YIELDS in y.json: ${MARSH} stage 1, ${MARSH} stage 3 were measured on other code or data (or never); ${MARSH} stage 0 is no longer a set. Measure again with: ${REMEASURE}`);
  assert.equal(staleText('y.json', { stale: [], extra: [] }), '');
  // readYields: none there, sets, or a file of another shape (an older version's) that says what to run.
  const tmp = mkdtempSync(join(tmpdir(), 'lamplight-read-'));
  try {
    const kept = join(tmp, 'y.json');
    assert.equal(readYields(kept), null);
    writeFileSync(kept, JSON.stringify({ sets: [{ map: FIRST_MAP, stage: 0, runs: [RUN] }] }));
    assert.equal(readYields(kept).sets.length, 1);
    writeFileSync(kept, JSON.stringify({ v: 2, runs: [RUN] }));
    assert.throws(() => readYields(kept), new RegExp(`holds no measured sets.*${REMEASURE.replace(/[.]/g, '\\.')}`));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- the committed yields

const kept = (file) => readYields(join(ROOT, file));
// The staying player's yields (X3, E1) are optional in the deploy gate: the release remeasure writes them.
const STAYS_KEPT = existsSync(join(ROOT, STAYS_YIELDS_FILE)) ? [STAYS_YIELDS_FILE] : [];

/** `saved` as if every set today's code wants had just been measured: each stamped with today's fingerprint. */
const freshened = (saved, fps) => ({ ...saved, sets: fps.sets.map((f) => ({ ...(saved.sets.find((s) => setKey(s) === setKey(f)) ?? saved.sets[0]), map: f.map, stage: f.stage, fingerprint: fps.of(f.map, f.stage) })) });

// Whether the committed yields are FRESH is not this gate's business (the sweep, S4 D6): any sim or
// balance change makes them stale until 168 twenty-minute bot runs are measured again, and that
// stood between every small fix and a deploy. The gate checks that the files are there and parse;
// `npm run pacing:check` (tools/pacing/check.mjs) is the drift check, a release step (ARCHITECTURE §14).
test('pacing: the yields files the report stands on exist and parse (their freshness is `npm run pacing:check`, not this gate)', () => {
  for (const file of [SKILLED_YIELDS_FILE, YIELDS_FILE, ...STAYS_KEPT]) {
    const saved = kept(file);
    assert.ok(saved, `${file} is missing: measure it with ${REMEASURE}`);
    assert.ok(saved.sets.length >= 1 && saved.measure && saved.minutes > 0, file);
    assert.equal(new Set(saved.sets.map(setKey)).size, saved.sets.length, `${file}: a set once`);
    for (const s of saved.sets) {
      assert.ok(DATA.maps.some((m) => m.id === s.map) && Number.isInteger(s.stage), `${file}: ${setKey(s)} is a map at a stage`);
      assert.match(String(s.fingerprint), /^[0-9a-f]{16}$/, `${file}: ${setKey(s)} says what it was measured on`);
    }
  }
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['pacing:check'], 'node tools/pacing/check.mjs');
  assert.doesNotMatch(pkg.scripts.build, /pacing/, 'the deploy gate does not wait on a remeasure');
});

test('pacing: the drift check (npm run pacing:check) passes on sets measured today, and names a stale set, a missing file, and the command', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'lamplight-drift-'));
  try {
    const fps = await yieldsFingerprints(ROOT);
    const a = join(tmp, 'a.json'), b = join(tmp, 'b.json');
    const fresh = freshened(kept(YIELDS_FILE), fps);
    writeFileSync(a, JSON.stringify(fresh));
    writeFileSync(b, JSON.stringify(freshened(kept(SKILLED_YIELDS_FILE), fps)));
    assert.deepEqual(await checkYields(ROOT, { files: [a, b], fps }), { ok: true, said: [] });
    // One set measured on other code.
    writeFileSync(a, JSON.stringify({ ...fresh, sets: fresh.sets.map((s, i) => (i === 1 ? { ...s, fingerprint: 'measured-elsewhere' } : s)) }));
    const one = await checkYields(ROOT, { files: [a, b], fps });
    assert.equal(one.ok, false);
    assert.equal(one.said.length, 1);
    assert.ok(one.said[0].startsWith(`STALE YIELDS in ${a}: ${setKey(fresh.sets[1])} was measured on other code or data`), one.said[0]);
    assert.ok(one.said[0].endsWith(`Measure again with: ${REMEASURE}`));
    // A file that isn't there, and one that holds no sets.
    writeFileSync(b, JSON.stringify({ sets: [] }));
    const two = await checkYields(ROOT, { files: [join(tmp, 'none.json'), b], fps });
    assert.equal(two.ok, false);
    assert.match(two.said[0], /none\.json is missing: measure it with/);
    assert.match(two.said[1], /holds no measured sets/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('pacing: the committed yields: every set measured as the report says, the practiced player\'s bots never dying', () => {
  for (const [file, skilled] of [[SKILLED_YIELDS_FILE, true], [YIELDS_FILE, false]]) {
    const saved = kept(file);
    assert.equal(saved.measure.skilled, skilled, `${file} measured ${skilled ? 'with' : 'without'} --skilled`);
    assert.deepEqual([saved.measure.character, saved.measure.archetypes, saved.measure.overtime], [MEASURE.character, MEASURE.archetypes, MEASURE.overtime]);
    for (const s of saved.sets) {
      assert.ok(s.runs.length >= 8, `${file} ${setKey(s)}: ${s.runs.length} runs`);
      assert.ok(s.runs.every((r) => r.seconds > 0 && r.materials && ['died', 'cleared', 'left'].includes(r.end) && Number.isInteger(r.bosses)), setKey(s));
      if (skilled) assert.equal(s.runs.filter((r) => r.end === 'died').length, 0, `${setKey(s)}: none died`);
    }
    if (skilled) assert.ok(saved.sets.some((s) => s.runs.some((r) => r.end === 'cleared')), 'some cleared the map: the line the MVP target is read on');
  }
  // The player who stays (X3, E1): bots that can't die, staying for overtime, every set's runs to the dawn.
  // (Until the release remeasure writes its file, there is nothing to check: ARCHITECTURE §14.3.)
  if (!STAYS_KEPT.length) return;
  const stays = kept(STAYS_YIELDS_FILE);
  assert.deepEqual([stays.measure.character, stays.measure.archetypes, stays.measure.overtime, stays.measure.skilled, stays.measure.stays], [MEASURE.character, MEASURE.archetypes, STAYS.overtime, true, true]);
  assert.ok(stays.minutes >= STAYS.minutes);
  for (const s of stays.sets) {
    assert.ok(s.runs.length >= 4, `${STAYS_YIELDS_FILE} ${setKey(s)}: ${s.runs.length} runs`);
    assert.ok(s.runs.every((r) => r.end === 'cleared' && r.dawn === true && r.seconds > 25 * 60), `${setKey(s)}: every run stayed and won the dawn`);
  }
});

test('pacing: the report on the committed yields: its sets, table, verdicts, and lines say what the simulations found', () => {
  const players = 3, hubMinutes = 1.5;
  for (const file of [SKILLED_YIELDS_FILE, YIELDS_FILE, ...STAYS_KEPT]) {
    const saved = kept(file);
    const how = saved.measure;
    const out = pacingReport({ yields: saved, how, minutes: saved.minutes, players, hubMinutes, data: DATA });
    // The simulation it reports: the measured sets for these players with this long in the harbor.
    const sets = setsOf(saved, DATA);
    const main = summarize(simulatePlayers(sets, DATA, { players, hubMinutes, maxRuns: MAX_RUNS }), DATA);
    assert.deepEqual(out.report, main, 'the players, the harbor minutes, and the run cap the report says');
    assert.deepEqual(out.sets.map((r) => [r.stage, r.runs]), saved.sets.map((s) => [s.stage, s.runs.length]), 'a row a set');
    // The table: a row a milestone, its medians, its range, and its verdict.
    const onClear = !!(out.clear && how.skilled);
    main.milestones.forEach((m, i) => {
      const row = out.table[i];
      assert.deepEqual([row.milestone, row.runs, row.hours, row.range, row.reached, row.verdict], [
        m.milestone, m.runs ?? 'never', m.hours === null ? '-' : m.hours.toFixed(1), m.low === null ? '-' : `${m.low.toFixed(1)} to ${m.high.toFixed(1)} h`, `${m.reached}/${m.of}`,
        onClear && m.milestone === 'MVP harbor fully restored' ? 'on the cleared runs' : verdict(m.met),
      ], m.milestone);
    });
    assert.ok(out.before.includes(`  - Each run is followed by ${hubMinutes} minutes in the harbor.`));
    const mvp = main.mvp;
    const tail = onClear ? `(all the runs; the ${mvp.target} target is read on the cleared runs, below)` : `(target ${mvp.target}: ${verdict(mvp.met)})`;
    assert.ok(out.after.includes(`MVP harbor fully restored: ${mvp.hours === null ? 'never' : hoursText(mvp)} ${tail}; the whole harbor, every building, in ${hoursText(main.whole)}`), out.after.join('\n'));
    assert.match(out.after[0], new RegExp(`over runs 1 to 10; .* from run 11 until each player's new things end`));
    assert.ok(out.after.some((l) => /^runs played on each map: the Drowned Docks \d+%, the Salt Marsh \d+%$/.test(l)), out.after.join('\n'));
    assert.match(out.after.find((l) => /pools hold/.test(l)), new RegExp(`pools hold ${Math.round(freshShare(DATA).share * 100)}% of the run content`));
    // For bots that can't die there's no shortest third (their fastest clears); for the others, it's the shortest third of each set.
    if (how.skilled) assert.equal(out.slow, null);
    else {
      assert.deepEqual(out.short.length, saved.sets.reduce((n, s) => n + shortestThird(s.runs).length, 0));
      assert.ok(out.after.some((l) => l.startsWith(`if every run were like the shortest third measured (${out.short.length} runs, a third of each set's)`)));
    }
    // A practiced player's line: the same players on each set's cleared runs, when there are some and not only those.
    const all = saved.sets.flatMap((s) => s.runs);
    if (all.some((r) => r.end === 'cleared') && all.some((r) => r.end !== 'cleared')) {
      assert.ok(out.after.some((l) => l.startsWith('if every run cleared the map') && l.includes(`MVP harbor fully restored in ${hoursText(out.clear)}`) && l.includes(`; the whole harbor, every building, in ${hoursText(out.clearWhole)}`)), out.after.join('\n'));
    } else assert.equal(out.clear, null);
  }
});

test('pacing: the report, run as the command runs it, names its stale sets and the command, and says when no one gets there', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'lamplight-report-'));
  try {
    // The committed sets as if measured today (so this test says what the report does, whatever state
    // the committed files are in: the sweep, S4 D3), then one set measured on other code: named,
    // with the command; the rest fresh.
    const saved = freshened(kept(YIELDS_FILE), await yieldsFingerprints(ROOT));
    const old = join(tmp, 'yields.json');
    const marked = { ...saved, sets: saved.sets.map((s, i) => (i === 1 ? { ...s, fingerprint: 'measured-elsewhere' } : s)) };
    writeFileSync(old, JSON.stringify(marked));
    const lines = [], tables = [];
    const { stale } = await reportFiles({ root: ROOT, data: DATA, kinds: ['ordinary'], files: { ordinary: old }, players: 2, log: (l) => lines.push(l), table: (t) => tables.push(t) });
    const text = lines.join('\n');
    assert.ok(stale.ordinary.stale.includes(setKey(saved.sets[1])));
    assert.match(text, new RegExp(`STALE YIELDS in ${old.replace(/[.\\/]/g, '\\$&')}: ${setKey(saved.sets[1])}`));
    assert.ok(text.includes(`Measure again with: ${REMEASURE}`));
    assert.equal(tables[0][1].yields, 'STALE', 'and its row in the sets says so');
    assert.match(text, /range: the 10th to the 90th percentile of the 2 players' hours/);
    assert.ok(tables.at(-1).some((r) => r.player.startsWith('newer, all runs')), 'and the summary row');
    // With runs that bring home next to nothing, no one gets there: said as 0 of the players.
    const poor = { ...saved, sets: saved.sets.map((s) => ({ ...s, runs: s.runs.slice(0, 1).map((x) => ({ ...x, materials: { coin: 1 } })) })) };
    const none = pacingReport({ yields: poor, how: saved.measure, minutes: saved.minutes, players: 1, hubMinutes: 1.5, data: DATA });
    assert.ok(none.after.some((l) => l.endsWith(`MVP harbor fully restored in more than ${SLOW_MAX_RUNS} runs, by 0 of 1 players within ${SLOW_MAX_RUNS} runs`)), none.after.join('\n'));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
