// The pacing model (tools/pacing/model.mjs, ARCHITECTURE §10.3) on made-up yields: the greedy
// buyer's order and its spending, greed scaling a run's haul, players finishing what the harbor
// offers with their events in order, the report's arithmetic pinned on hand-built players, the
// fresh profile's share, what the report says its hours stand on, and the fingerprint that says
// whether the kept yields were measured on today's code. (The workspace tool measures real yields
// with the bots; this checks the arithmetic the report stands on.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA } from '../src/data/index.js';
import { defaultProfile } from '../src/save/schema.js';
import { purchaseOptions } from '../src/meta/next.js';
import { levelOf } from '../src/meta/state.js';
import { applyRunResult } from '../src/meta/apply.js';
import {
  buyGreedy, allDone, simulatePlayer, simulatePlayers, summarize, freshShare, runResultFor, greedOf, shortestThird, assumptions, percentile, BUY_ORDER, TARGETS,
} from '../tools/pacing/model.mjs';
import { yieldsFingerprint, yieldsInputs, readYields, YIELDS_FILE, HARBOR_ONLY } from '../tools/pacing/yields.mjs';
import { measureOne, measureConfig, measureBot, playOut, MEASURE } from '../tools/pacing/measure.mjs';
import { pacingReport, verdict, MAX_RUNS, SLOW_MAX_RUNS } from '../tools/pacing/report.mjs';
import { resolveContent } from '../src/meta/state.js';
import { createKiteBot } from '../src/sim/bot.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const RUN = { seconds: 900, materials: { coin: 45, oil: 30, timber: 9, rope: 6, drowned_pages: 9, rum: 3, iron: 1, map_scraps: 1 }, bosses: 1, end: 'died' };
const RICH = Object.fromEntries(DATA.materials.map((m) => [m.id, 9999]));
function profile(levels = {}, mats = {}) { const d = defaultProfile(); Object.assign(d.profile.buildings, levels); Object.assign(d.profile.materials, mats); return d; }

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
  // The cheapest first within a kind: the Lamp Post (15 Oil, 15 Coin) and the Library (10 Drowned
  // Pages, 20 Coin, 5 Timber) before the Tavern (90 Coin, 5 Rum, 10 Timber), though all three are
  // affordable; buying the Tavern first would leave neither of the others.
  const cost = (id) => DATA.buildings.find((b) => b.id === id).levels[0].cost;
  const exact = {};
  for (const id of ['lamp_post', 'library', 'tavern']) for (const [m, n] of Object.entries(cost(id))) exact[m] = Math.max(exact[m] ?? 0, n);
  const three = buyGreedy(profile({}, exact), DATA).bought.filter((c) => c.kind === 'building_level').map((c) => c.id);
  assert.deepEqual(three, ['lamp_post', 'library'], 'the cheap ones first, and then the Tavern is out of reach');
  // The cost decides, not the order the data lists them in: listed the other way round, the same.
  const reversed = { ...DATA, buildings: [...DATA.buildings].reverse() };
  assert.deepEqual(buyGreedy(profile({}, exact), reversed).bought.filter((c) => c.kind === 'building_level').map((c) => c.id), ['lamp_post', 'library'], 'still the cheap ones first');
  // Done means every level, every project, and every rank: one rank short is not done.
  const all = profile(Object.fromEntries(DATA.buildings.map((b) => [b.id, b.levels.length])));
  all.profile.research.done = DATA.research.map((r) => r.id);
  for (const u of DATA.upgrades) all.profile.upgrades[u.id] = u.ranks;
  assert.equal(allDone(all, DATA), true);
  all.profile.upgrades[DATA.upgrades[0].id] -= 1;
  assert.equal(allDone(all, DATA), false, 'an upgrade a rank short');
});

test('pacing: a measured run replayed for a profile brings home more with its greed', () => {
  const run = { seconds: 600, materials: { coin: 100, oil: 7 }, bosses: 1, end: 'died' };
  const plain = runResultFor(run, profile(), DATA);
  assert.deepEqual(plain.materials, { coin: 100, oil: 7 });
  assert.equal(plain.timeSurvived, 600);
  assert.equal(plain.bossesKilled.length, 1);
  const lucky = profile({ lamp_post: 5 });
  lucky.profile.upgrades.tide_luck = 3;   // +5% a rank
  assert.deepEqual(runResultFor(run, lucky, DATA).materials, { coin: 115, oil: 8 });
  assert.deepEqual(runResultFor({ ...run, materials: { coin: 13 } }, lucky, DATA).materials, { coin: 14 }, '14.95: rounded down, once');
  // The bosses it killed are named as the game names them, so the research rule counts a short run that killed one.
  assert.deepEqual(runResultFor({ ...run, bosses: 2 }, profile(), DATA).bossesKilled, ['harbor_maw', 'the_tidecaller']);
  const going = profile({ library: 1 });
  going.profile.research.active = [{ id: 'tide_charts', runsLeft: 2 }];
  const quick = { seconds: 120, materials: {}, bosses: 1, end: 'died' };
  assert.deepEqual(applyRunResult(going, runResultFor(quick, going, DATA), DATA).doc.profile.research.active, [{ id: 'tide_charts', runsLeft: 1 }], 'a 2:00 run with a boss down counts');
  assert.deepEqual(applyRunResult(going, runResultFor({ ...quick, bosses: 0 }, going, DATA), DATA).doc.profile.research.active, [{ id: 'tide_charts', runsLeft: 2 }], 'without one it doesn\'t');
  // Greed goes through the sim's stat formula: an added or a "more" greed counts too, within the cap.
  const as = (op, value) => ({ ...DATA, upgrades: DATA.upgrades.map((u) => (u.id === 'tide_luck' ? { ...u, mods: [{ stat: 'greed', op, value }] } : u)) });
  const one = profile({ lamp_post: 5 }); one.profile.upgrades.tide_luck = 1;
  assert.equal(greedOf(one, as('add', 0.5)), 1.5);
  assert.equal(greedOf(one, as('more', 1)), 2);
  assert.deepEqual(runResultFor(run, one, as('more', 1)).materials, { coin: 200, oil: 14 });
  assert.equal(greedOf(one, as('add', 50)), DATA.tuning.caps.player.greed[1], 'held to the stat\'s cap');
  assert.equal(greedOf(profile(), DATA), 1, 'none without upgrades');
  // And the players use their own greed: with a lot of it, the harbor comes back in fewer runs.
  const greedy = { ...DATA, upgrades: DATA.upgrades.map((u) => (u.id === 'tide_luck' ? { ...u, mods: [{ stat: 'greed', op: 'pct', value: 0.5 }] } : u)) };
  const none = { ...DATA, upgrades: DATA.upgrades.map((u) => (u.id === 'tide_luck' ? { ...u, mods: [{ stat: 'greed', op: 'pct', value: 0 }] } : u)) };
  assert.ok(simulatePlayer([RUN], greedy, { seed: 1 }).runs < simulatePlayer([RUN], none, { seed: 1 }).runs);
});

test('pacing: a player plays until the harbor has nothing left, and the events come in order', () => {
  const s = simulatePlayer([RUN], DATA, { seed: 3, hubMinutes: 1.5 });
  assert.ok(s.done && allDone(s.doc, DATA), 'everything bought and researched');
  assert.equal(s.events[0].run, 1, 'the first building level comes at the end of run 1 (§10.3)');
  for (let i = 1; i < s.events.length; i++) assert.ok(s.events[i].minutes >= s.events[i - 1].minutes && s.events[i].run >= s.events[i - 1].run);
  assert.ok(Math.abs(s.minutes - s.runs * (15 + 1.5)) < 1e-6, 'every run is its length plus the time in the harbor');
  const levels = s.events.filter((e) => e.kind === 'building');
  assert.equal(levels.length, DATA.buildings.reduce((n, b) => n + b.levels.length, 0), 'every level, once');
  assert.deepEqual(s.events.filter((e) => e.kind === 'research').map((e) => e.id).sort(), DATA.research.map((r) => r.id).sort(), 'every project once, when it finishes');
  assert.equal(s.events.filter((e) => e.kind === 'upgrade').length, DATA.upgrades.reduce((n, u) => n + u.ranks, 0), 'every rank, once');
  // Runs that never reach 5:00 or a boss never move research on.
  const short = simulatePlayer([{ ...RUN, seconds: 120, bosses: 0 }], DATA, { seed: 1, maxRuns: 30 });
  assert.equal(short.events.filter((e) => e.kind === 'research').length, 0);
  // Each run is drawn at random from the measured ones, and each player draws their own: with a
  // short run and a long one, players take different times, and every player gets some of each.
  const two = [{ ...RUN, seconds: 600 }, { ...RUN, seconds: 1500 }];
  const players = simulatePlayers(two, DATA, { players: 4, maxRuns: 20 });
  assert.ok(new Set(players.map((p) => p.minutes)).size > 1, 'players draw different runs');
  for (const p of players) {
    const longRuns = (p.minutes - p.runs * (10 + 1.5)) / 15;   // each long run adds 15 minutes over a short one
    assert.ok(longRuns > 0 && longRuns < p.runs, `a mix of both (${longRuns} long of ${p.runs})`);
  }
});

/**
 * A hand-built player: the 15 building levels (the Lamp Post's five, the Library's, the Tavern's)
 * at the runs given, research finished at others, upgrade ranks at others; `pace` minutes a run.
 */
function handBuilt(levelRuns, { research = [], upgrades = [], pace = 20 } = {}) {
  const order = DATA.buildings.filter((b) => DATA.meta.mvpBuildings.includes(b.id)).flatMap((b) => b.levels.map((_, i) => ({ id: b.id, level: i + 1 })));
  const events = [
    ...order.map((l, i) => ({ run: levelRuns[i], kind: 'building', id: l.id, level: l.level, unlocks: l.id === 'tavern' && l.level === 1 ? [{ what: 'character', id: 'harpooner' }] : [] })),
    ...research.map((run, i) => ({ run, kind: 'research', id: DATA.research[i].id })),
    ...upgrades.map((run) => ({ run, kind: 'upgrade', id: 'bright_flame', rank: 1 })),
  ].map((e) => ({ ...e, minutes: e.run * pace })).sort((a, b) => a.run - b.run);
  return { events };
}

test('pacing: the report\'s arithmetic, pinned on three hand-built players', () => {
  const steps = (k) => Array.from({ length: 15 }, (_, i) => k * i + 1);        // a level every k runs
  // Three players at three paces (20, 15, and 25 minutes a run), so hours never follow runs alone.
  const sims = [handBuilt(steps(1), { research: [20, 22], upgrades: [30], pace: 20 }), handBuilt(steps(2), { pace: 15 }), handBuilt(steps(3), { pace: 25 })];
  const r = summarize(sims, DATA);
  const row = (name) => r.milestones.find((m) => m.milestone === name);
  assert.deepEqual(r.milestones.map((m) => m.milestone), [
    'first building level', 'Harpooner arrives', 'first research done', ...DATA.buildings.map((b) => `${b.name} fully restored`),
    'MVP harbor fully restored', 'all research done', 'every upgrade at its last rank',
  ], 'every character a building brings gets an arrival row, every building a row of its own');
  // The median is the middle value, the range the 10th to the 90th percentile (the ends, here);
  // runs and hours are sorted on their own.
  const h = (run, pace) => (run * pace) / 60;
  assert.deepEqual(row('first building level'), { milestone: 'first building level', target: 'run 1', runs: 1, hours: h(1, 20), low: h(1, 15), high: h(1, 25), reached: 3, of: 3, met: true });
  assert.deepEqual(row('Harpooner arrives'), { milestone: 'Harpooner arrives', target: null, runs: 21, hours: h(21, 15), low: h(11, 20), high: h(31, 25), reached: 3, of: 3, met: null });
  assert.deepEqual(row('Lamp Post fully restored'), { milestone: 'Lamp Post fully restored', target: null, runs: 9, hours: h(9, 15), low: h(5, 20), high: h(13, 25), reached: 3, of: 3, met: null });
  assert.deepEqual(row('MVP harbor fully restored'), { milestone: 'MVP harbor fully restored', target: '6 to 10 h', runs: 29, hours: h(29, 15), low: h(15, 20), high: h(43, 25), reached: 3, of: 3, met: true });
  assert.equal(r.mvp, row('MVP harbor fully restored'));
  assert.deepEqual(row('first research done'), { milestone: 'first research done', target: null, runs: 20, hours: h(20, 20), low: h(20, 20), high: h(20, 20), reached: 1, of: 3, met: null });
  assert.deepEqual(row('all research done'), { milestone: 'all research done', target: null, runs: null, hours: null, low: null, high: null, reached: 0, of: 3, met: null });
  // Runs between new things (levels and research; the upgrade at run 30 doesn't count): over the
  // first 10 runs, 10, 5, and 4 of them brought something (30 runs over 19); after that, to each
  // player's own last new thing, 7 in 12 runs, 10 in 19, and 11 in 33 (64 over 28).
  assert.deepEqual(r.gaps.early, { runs: 30 / 19, target: '1 to 2 runs', met: true, side: null, from: 1, until: 10 });
  assert.deepEqual(r.gaps.later, { runs: 64 / 28, target: '3 to 4 runs', met: false, side: 'sooner', from: 11, until: 29 });
  // A dry stretch at the end of the early window counts in it: something new at runs 1 to 5, then
  // nothing until 11, is something every 2 runs over runs 1 to 10, not every run.
  const dry = { events: [1, 2, 3, 4, 5, 11].map((run) => ({ run, minutes: run * 20, kind: 'building', id: 'lamp_post', level: run, unlocks: [] })), runs: 11 };
  assert.equal(summarize([dry], DATA).gaps.early.runs, 2);
  assert.equal(summarize([dry], DATA).gaps.later.runs, 1, 'and the later window starts at run 11');
  assert.equal(summarize([{ events: [], runs: 30 }], DATA).gaps.early.runs, null, 'nothing new at all: no number');
  // A player who never finishes the harbor misses the MVP target, though the one who does is on it.
  const onTime = handBuilt(steps(2), { pace: 20 });   // the 15th level at run 29, 9.7 h
  assert.equal(summarize([onTime], DATA).mvp.met, true);
  const stuck = summarize([onTime, { events: [] }], DATA);
  assert.equal(stuck.mvp.reached, 1);
  assert.equal(stuck.mvp.met, false);
  // The first level misses its target when it comes after run 1.
  const late = summarize([handBuilt(steps(1).map((run) => run + 1))], DATA);
  assert.deepEqual([late.milestones[0].runs, late.milestones[0].met], [2, false]);
  // Targets come from one place, and the verdicts follow them, their edges included.
  assert.equal(summarize(sims, DATA, { ...TARGETS, mvpHours: [1, 5] }).mvp.met, false);
  const mvpH = r.mvp.hours;
  assert.equal(summarize(sims, DATA, { ...TARGETS, mvpHours: [mvpH, mvpH + 1] }).mvp.met, true, 'the low edge counts');
  assert.equal(summarize(sims, DATA, { ...TARGETS, mvpHours: [mvpH - 1, mvpH] }).mvp.met, true, 'the high edge counts');
  assert.equal(summarize(sims, DATA, { ...TARGETS, newEarly: [30 / 19, 2] }).gaps.early.met, true, 'a gap on the edge counts');
  assert.deepEqual([percentile([1, 2, 3, 4, 5], 0.1), percentile([1, 2, 3, 4, 5], 0.5), percentile([1, 2, 3, 4, 5], 0.9)], [1, 3, 5]);
  // Eleven players (a level every run, at 10 to 20 minutes a run): the median is the sixth, and the
  // range is the 10th and 90th percentiles, the second and the tenth, not the ends.
  const eleven = Array.from({ length: 11 }, (_, k) => handBuilt(steps(1), { pace: 10 + k }));
  const e = summarize(eleven, DATA).mvp;
  assert.deepEqual([e.runs, e.hours, e.low, e.high], [15, h(15, 15), h(15, 11), h(15, 19)]);
  // The MVP harbor is the MVP buildings: a building a later phase adds (its levels bought early,
  // among the MVP's) doesn't move it.
  const later = { ...DATA, buildings: [...DATA.buildings, { id: 'docks', name: 'The Docks', levels: DATA.buildings[0].levels }] };
  const withDocks = sims.map((x) => ({ events: [...x.events, ...[1, 2, 3, 4, 5].map((level) => ({ run: 1 + level, minutes: (1 + level) * 20, kind: 'building', id: 'docks', level, unlocks: [] }))].sort((a, b) => a.run - b.run) }));
  const rd = summarize(withDocks, later);
  assert.deepEqual([rd.mvp.runs, rd.mvp.hours], [r.mvp.runs, r.mvp.hours]);
});

test('pacing: the fresh profile\'s share, the shortest third, and what the report stands on', () => {
  // Pool content only (brief §6.4: what research locks away): the weapons that go in the pools,
  // passives, relics, and runes, not the characters.
  assert.deepEqual(freshShare(DATA), { have: 12, of: 35, share: 12 / 35, met: false });
  const unlocked = { ...DATA, relics: DATA.relics.map((x) => ({ ...x, unlock: 'starter' })) };
  assert.ok(freshShare(unlocked).share > freshShare(DATA).share);
  assert.equal(freshShare({ ...DATA, characters: [...DATA.characters, { ...DATA.characters[0], id: 'extra' }] }).of, 35, 'characters don\'t count');
  const runs = [300, 1200, 800, 1500, 600, 1000, 900].map((seconds, k) => ({ k, seconds, materials: {}, bosses: 0, end: k % 2 ? 'died' : 'left' }));
  assert.deepEqual(shortestThird(runs).map((r) => r.seconds), [300, 600, 800]);
  assert.deepEqual(shortestThird(runs.slice(0, 1)).map((r) => r.seconds), [300]);
  const lines = assumptions({ runs, minutes: 25, hubMinutes: 1.5, character: 'Lamplighter', archetypes: ['projectile_storm', 'orbit_tank'], overtime: 'leave', players: 40 });
  assert.match(lines[0], /^The yields are 7 bot runs from a fresh profile, all as Lamplighter \(projectile_storm, orbit_tank builds, in turn\): 0 cleared the map, 3 died, 4 were still going at 25:00 and left\./);
  assert.ok(lines.some((l) => /outlast/.test(l)), 'the bots play better than a new player');
  assert.ok(lines.includes('Each simulated run is one of those 7 runs, drawn at random, for 40 players: the range is the spread of those draws, not the spread between real players.'));
  assert.ok(lines.includes('Each run is followed by 1.5 minutes in the harbor.'));
  assert.ok(lines.includes('After every run the player spends everything they can: building levels, then research, then upgrades, the cheapest first.'));
  assert.ok(lines.includes('A run brings home the same whatever the player has bought, except for greed from the Lamp Post\'s upgrades.'));
  assert.match(lines[0], /After the last boss a bot leaves at once \(no overtime\)\.$/);
  assert.match(assumptions({ runs, minutes: 25, hubMinutes: 1.5, character: 'x', archetypes: ['a'], overtime: 'stay', players: 40 })[0], /After the last boss a bot stays for overtime\.$/);
});

test('pacing: a measured run plays a fresh profile\'s config with the bot, and a halt it can\'t answer stops it with an error', () => {
  // What the report says: the yields are from a fresh profile's pools, not all the content.
  const cfg = measureConfig(3);
  const fresh = resolveContent(defaultProfile(), DATA);
  assert.deepEqual([cfg.character, cfg.seed], [MEASURE.character, 'pacing-3']);
  assert.deepEqual(cfg.pools, { weapons: fresh.weapons, passives: fresh.passives, relics: fresh.relics, runes: fresh.runes });
  assert.ok(cfg.pools.weapons.length < DATA.weapons.length, 'less than everything');
  // The bot: the archetypes in turn, run by run, and overtime as MEASURE says (what the report says it did).
  const n = MEASURE.archetypes.length;
  assert.deepEqual(Array.from({ length: n * 2 }, (_, k) => measureBot(k).archetype), [...MEASURE.archetypes, ...MEASURE.archetypes]);
  assert.ok(new Set(MEASURE.archetypes).size === n && n >= 2, 'more than one build, each once in a turn');
  assert.equal(measureBot(5).stay, MEASURE.overtime === 'stay');
  assert.equal(MEASURE.overtime, 'leave', 'the bots leave after the last boss (the report says so)');
  const given = [];
  measureOne({ k: 4, minutes: 0.01 }, (o) => { given.push(o); return createKiteBot(o); });
  assert.deepEqual(given, [measureBot(4)], 'a measured run\'s bot is made as measureBot says');
  // A few seconds of a real one.
  const r = measureOne({ k: 0, minutes: 0.05 });
  assert.deepEqual(Object.keys(r).sort(), ['bosses', 'end', 'k', 'materials', 'seconds']);
  assert.ok(Math.abs(r.seconds - 3) <= 1 && r.end === 'left' && r.bosses === 0, JSON.stringify(r));
  // A halt that never clears: an error naming it, not a hang (a halted world doesn't tick).
  const stuck = { tick: 0, over: false };
  const sim = { stepWorld: () => {}, currentHalt: () => ({ kind: 'mystery' }), decide: () => {} };
  assert.throws(() => playOut(stuck, { input: () => null, decide: () => ({ kind: 'ok' }) }, 1, sim), /can't get past a mystery \(still there after 100 answers\)/);
  // One that clears after a few answers plays on to the end.
  let halts = 3;
  const w = { tick: 0, over: false };
  playOut(w, { input: () => null, decide: () => ({}) }, 0.01, { stepWorld: (x) => { x.tick++; }, currentHalt: () => (halts > 0 ? { kind: 'levelup' } : null), decide: () => { halts--; } });
  assert.equal(w.tick, 36);
});

test('pacing: the kept yields say whether they were measured on today\'s code and data (the fingerprint)', async () => {
  // What a measured run runs: measure.mjs and the code it imports (the data is taken as data).
  const inputs = yieldsInputs(ROOT);
  for (const f of ['tools/pacing/measure.mjs', 'src/sim/world.js', 'src/sim/pickups.js', 'src/meta/runconfig.js', 'src/sim/bot.js']) assert.ok(inputs.includes(f), f);
  assert.ok(!inputs.some((f) => f.startsWith('src/data/')), 'data files are fingerprinted as data');
  const now = await yieldsFingerprint(ROOT);
  assert.match(now, /^[0-9a-f]{16}$/);
  // Everything the sim plays with is fingerprinted as data; only the harbor's own is left out.
  assert.deepEqual(Object.keys(DATA).filter((k) => !HARBOR_ONLY.includes(k)).sort(), ['ascensions', 'bosses', 'characters', 'enemies', 'maps', 'materials', 'palette', 'passives', 'relics', 'runes', 'sfx', 'sfxVoiceCap', 'tuning', 'weapons']);
  assert.equal(await yieldsFingerprint(ROOT), now, 'the same code, the same fingerprint');
  // On copies (each its own, so its modules load fresh): a comment or a harbor cost keeps it; a
  // code change, a change to what the sim plays with, or a change to a fresh profile's pools doesn't.
  const tmps = [];
  const copy = (edit) => {
    const tmp = mkdtempSync(join(tmpdir(), 'lamplight-yields-'));
    tmps.push(tmp);
    for (const dir of ['src', 'tools/pacing', 'tools/atlas', 'tests/helpers']) cpSync(join(ROOT, dir), join(tmp, dir), { recursive: true, filter: (f) => !f.includes('node_modules') });
    if (edit) { const [file, from, to] = edit; const p = join(tmp, file); const src = readFileSync(p, 'utf8'); assert.ok(src.includes(from), `${file} has ${from}`); writeFileSync(p, src.replace(from, to)); }
    return tmp;
  };
  try {
    assert.equal(await yieldsFingerprint(copy()), now, 'a copy fingerprints the same');
    assert.equal(await yieldsFingerprint(copy(['src/sim/pickups.js', 'world.stats.greed', 'world.stats.greed /* a note */'])), now, 'a comment doesn\'t count');
    const lamp = DATA.buildings[0].levels[0].cost.oil;
    assert.equal(await yieldsFingerprint(copy(['src/data/buildings.js', `cost: { oil: ${lamp},`, `cost: { oil: ${lamp + 1},`])), now, 'a harbor cost doesn\'t change a fresh run');
    assert.notEqual(await yieldsFingerprint(copy(['src/sim/pickups.js', 'world.stats.greed', 'world.stats.greed * 2'])), now, 'a code change does');
    assert.notEqual(await yieldsFingerprint(copy(['src/data/tuning.js', 'speed: 80', 'speed: 81'])), now, 'what the sim plays with does');
    assert.notEqual(await yieldsFingerprint(copy(['src/data/relics.js', "unlock: 'building:tavern:2'", "unlock: 'starter'"])), now, 'a fresh profile\'s pools do');
    assert.notEqual(await yieldsFingerprint(copy(['src/data/maps.js', 'density: [15, 40]', 'density: [15, 41]'])), now, 'a map\'s timeline does');
    assert.notEqual(await yieldsFingerprint(copy(['src/data/enemies.js', "drops: [{ material: 'rope', chance: 0.2 }]", "drops: [{ material: 'rope', chance: 0.3 }]"])), now, 'an enemy\'s drops do');
    // readYields: none there, fresh, or stale.
    const kept = join(tmps[0], 'yields.json');
    assert.equal(readYields(kept, now), null);
    writeFileSync(kept, JSON.stringify({ fingerprint: now, runs: [RUN] }));
    assert.equal(readYields(kept, now).stale, false);
    assert.equal(readYields(kept, 'something else').stale, true);
    writeFileSync(kept, JSON.stringify({ runs: [RUN] }));
    assert.equal(readYields(kept, now).stale, true, 'no fingerprint is stale');
    writeFileSync(kept, JSON.stringify({ fingerprint: now, runs: [] }));
    assert.throws(() => readYields(kept, now), /holds no measured runs/);
  } finally {
    for (const t of tmps) rmSync(t, { recursive: true, force: true });
  }
  // The yields the report stands on are kept in the repo, where a fresh workspace finds them.
  assert.ok(existsSync(join(ROOT, YIELDS_FILE)), YIELDS_FILE);
  const { saved } = readYields(join(ROOT, YIELDS_FILE), now);
  assert.ok(saved.runs.length >= 6 && saved.runs.every((r) => r.seconds > 0 && r.materials && ['died', 'cleared', 'left'].includes(r.end)));
});

test('pacing: the report says what its numbers are, and says so when its yields are stale', async () => {
  const { execFileSync } = await import('node:child_process');
  const tmp = mkdtempSync(join(tmpdir(), 'lamplight-report-'));
  try {
    const { saved } = readYields(join(ROOT, YIELDS_FILE), 'any');
    const old = join(tmp, 'yields.json');
    writeFileSync(old, JSON.stringify({ ...saved, fingerprint: 'measured-elsewhere' }));
    const out = execFileSync(process.execPath, [join(ROOT, 'tools/pacing/pacing.mjs'), '--yields', old, '--players', '12'], { encoding: 'utf8' });
    assert.match(out, /STALE YIELDS: they were measured on other data or sim code \(measured-elsewhere; now [0-9a-f]{16}\)/);
    assert.match(out, /runs: the median of the players' runs to it; hours: the median of their hours \(each column's own middle, so a row's runs and hours needn't be one player's\); range: the 10th to the 90th percentile of the 12 players' hours/);
    assert.match(out, /from run 11 until each player's new things end \(run \d+ for the median player/);
    assert.match(out, /by \d+ of 12 players within 600 runs/);
    // With runs that bring home next to nothing, no one gets there: said as 0 of the players.
    const poor = join(tmp, 'poor.json');
    writeFileSync(poor, JSON.stringify({ ...saved, runs: saved.runs.map((x) => ({ ...x, materials: { coin: 1 } })) }));
    const none = execFileSync(process.execPath, [join(ROOT, 'tools/pacing/pacing.mjs'), '--yields', poor, '--players', '12'], { encoding: 'utf8' });
    assert.match(none, /MVP harbor fully restored in more than 600 runs, by 0 of 12 players within 600 runs/);
    assert.match(out, /pools hold \d+% of the run content \(\d+ of \d+ weapons, passives, relics, and runes/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('pacing: the report on the committed yields: its table, its verdicts, and its lines say what the simulations found', () => {
  const { saved } = readYields(join(ROOT, YIELDS_FILE), 'any');
  const how = saved.measure;
  const players = 12, hubMinutes = 1.5;
  const out = pacingReport({ runs: saved.runs, how, minutes: saved.minutes, players, hubMinutes, data: DATA });
  // The simulations it reports: the measured runs for these players with this long in the harbor,
  // and the same players on the shortest third.
  const main = summarize(simulatePlayers(saved.runs, DATA, { players, hubMinutes, maxRuns: MAX_RUNS }), DATA);
  assert.deepEqual(out.report, main, 'the players, the harbor minutes, and the run cap the report says');
  const short = shortestThird(saved.runs);
  const slow = summarize(simulatePlayers(short, DATA, { players, hubMinutes, maxRuns: SLOW_MAX_RUNS }), DATA).mvp;
  assert.deepEqual(out.slow, slow, 'the shortest third, with its own cap');
  assert.ok(slow.hours === null || slow.hours > main.mvp.hours, 'shorter runs, more hours (or never, when the short runs never bring home some material)');
  // The table: a row a milestone, its medians, its range from the 10th to the 90th percentile, and its verdict.
  assert.deepEqual(out.table.map((row) => row.milestone), main.milestones.map((m) => m.milestone));
  main.milestones.forEach((m, i) => {
    const row = out.table[i];
    assert.deepEqual([row.runs, row.hours, row.range, row.reached, row.verdict], [
      m.runs ?? 'never', m.hours === null ? '-' : m.hours.toFixed(1), m.low === null ? '-' : `${m.low.toFixed(1)} to ${m.high.toFixed(1)} h`, `${m.reached}/${m.of}`, verdict(m.met),
    ], m.milestone);
  });
  assert.ok(out.table.some((row) => row.verdict === 'met') && out.table.some((row) => row.verdict === ''), 'verdicts where there are targets, and none where there aren\'t');
  assert.deepEqual([verdict(true), verdict(false), verdict(false, 'sooner'), verdict(null)], ['met', 'MISSED', 'MISSED (sooner)', '']);
  // The lines: what the hours stand on (with this many minutes in the harbor), the gaps, the MVP
  // harbor, and the shortest third, each with the numbers above.
  assert.ok(out.before.includes(`  - Each run is followed by ${hubMinutes} minutes in the harbor.`));
  const mvp = main.mvp;
  assert.ok(out.after.includes(`MVP harbor fully restored: ${mvp.hours.toFixed(1)} h (${mvp.low.toFixed(1)} to ${mvp.high.toFixed(1)} h) (target ${mvp.target}: ${verdict(mvp.met)})`), out.after[1]);
  assert.match(out.after[0], new RegExp(`every ${main.gaps.early.runs.toFixed(1)} runs \\(target 1 to 2 runs: ${verdict(main.gaps.early.met, main.gaps.early.side).replace(/[()]/g, '\\$&')}\\) over runs 1 to 10`));
  const slowText = slow.hours === null ? `more than ${SLOW_MAX_RUNS} runs` : `${slow.hours.toFixed(1)} h (${slow.low.toFixed(1)} to ${slow.high.toFixed(1)} h)`;
  assert.ok(out.after[2].includes(`(${short.length} runs,`) && out.after[2].includes(`in ${slowText}, by ${slow.reached} of ${players} players within ${SLOW_MAX_RUNS} runs`), out.after[2]);
  assert.match(out.after[3], new RegExp(`pools hold ${Math.round(freshShare(DATA).share * 100)}% of the run content`));
  // Other targets, other verdicts: the report's verdicts follow them, the table's and the lines' alike.
  const strict = { ...TARGETS, mvpHours: [1, 2], firstLevelRun: 0, freshShare: 0.9 };
  const other = pacingReport({ runs: saved.runs, how, minutes: saved.minutes, players, hubMinutes, data: DATA, targets: strict });
  assert.equal(other.table.find((row) => row.milestone === 'MVP harbor fully restored').verdict, 'MISSED');
  assert.equal(other.table[0].verdict, 'MISSED', 'the first level after run 0');
  assert.match(other.after[1], /\(target 1 to 2 h: MISSED\)$/);
  assert.match(other.after[3], /so 90% or less: met;/);
});
