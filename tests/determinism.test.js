// Determinism (ARCHITECTURE §5.2, §5.5, §12.4): the same build, RunConfig, input frames, and
// decisions give the same run, bit for bit; replays reproduce runs exactly; and a stored hash
// from a fixed run catches any drift (including math that differs between JavaScript engines).
import test from 'node:test';
import assert from 'node:assert/strict';
import { DATA } from '../src/data/index.js';
import { createWorld, stepWorld, decide, currentHalt, hashWorld } from '../src/sim/world.js';
import { createRecordedRun, playReplay, ReplayError } from '../src/sim/replay.js';
import { createKiteBot } from '../src/sim/bot.js';
import { GOLDEN, frozenData, playGolden } from './helpers/golden.js';
import { spawnEnemy } from '../src/sim/enemies.js';
import { registerBoss } from '../src/sim/bosses.js';

function botRun(seed, ticks) {
  const w = createWorld({ seed, character: 'lamplighter' }, DATA);
  const bot = createKiteBot({ archetype: 'orbit_tank' });
  while (w.tick < ticks && !w.over) {
    stepWorld(w, bot.input(w));
    let g = 0;
    while (currentHalt(w) && g++ < 100) decide(w, bot.decide(w, currentHalt(w)));
  }
  return w;
}

test('determinism: two runs with the same seed and inputs hash the same at 60 s', () => {
  const a = botRun(1234, 3600), b = botRun(1234, 3600);
  assert.equal(a.tick, 3600);
  assert.equal(hashWorld(a), hashWorld(b));
  assert.notEqual(hashWorld(botRun(1235, 3600)), hashWorld(a), 'a different seed is a different run');
});

test('determinism: a recorded run replays to the same state, tick for tick', () => {
  const rec = createRecordedRun({ seed: 'replay test', character: 'lamplighter' }, DATA, 'test-build');
  const bot = createKiteBot({ archetype: 'chain_lightning' });
  const hashes = new Map();
  while (rec.world.tick < 3600 && !rec.world.over) {
    rec.step(bot.input(rec.world));
    let g = 0;
    while (currentHalt(rec.world) && g++ < 100) rec.decide(bot.decide(rec.world, currentHalt(rec.world)));
    if (rec.world.tick % 600 === 0) hashes.set(rec.world.tick, hashWorld(rec.world));
  }
  const replay = rec.toReplay();
  assert.ok(replay.decisions.length >= 3, `${replay.decisions.length} decisions recorded (the replay must carry some)`);
  const back = playReplay(replay, DATA, {
    buildId: 'test-build',
    onTick: (w) => { if (hashes.has(w.tick) && !currentHalt(w)) assert.equal(hashWorld(w), hashes.get(w.tick), `tick ${w.tick}`); },
  });
  assert.equal(hashWorld(back), replay.hash, 'same end state');
  // 20 minutes of input is 72,000 frames at 3 bytes: small, and it compresses well.
  assert.equal(replay.frames.length, replay.endTick * 3);
});

test('determinism: a Harpooner run, full of dazed enemies, replays to the same state', () => {
  const rec = createRecordedRun({ seed: 'daze replay', character: 'harpooner' }, DATA, 'test-build');
  const bot = createKiteBot({ archetype: 'orbit_tank' });
  const hashes = new Map();
  let dazedTicks = 0;
  // Early enemies die to the hit that dazes them; by the second minute they live through it.
  while (rec.world.tick < 7200 && !rec.world.over) {
    rec.step(bot.input(rec.world));
    let g = 0;
    while (currentHalt(rec.world) && g++ < 100) rec.decide(bot.decide(rec.world, currentHalt(rec.world)));
    const E = rec.world.enemies;
    for (let i = 0; i < E.count; i++) if (E.dazeT[i] > 0) { dazedTicks++; break; }
    if (rec.world.tick % 600 === 0) hashes.set(rec.world.tick, hashWorld(rec.world));
  }
  assert.ok(dazedTicks > 200, `enemies were dazed on ${dazedTicks} ticks (the replay must cover it)`);
  const replay = rec.toReplay();
  const back = playReplay(replay, DATA, {
    buildId: 'test-build',
    onTick: (w) => { if (hashes.has(w.tick) && !currentHalt(w)) assert.equal(hashWorld(w), hashes.get(w.tick), `tick ${w.tick}`); },
  });
  assert.equal(hashWorld(back), replay.hash, 'same end state');
});

test('determinism: a replay refuses another build, and a tampered one says it is out of step', () => {
  const rec = createRecordedRun({ seed: 5 }, DATA, 'build-a');
  const bot = createKiteBot();
  while (rec.world.tick < 900) {
    rec.step(bot.input(rec.world));
    while (currentHalt(rec.world)) rec.decide(bot.decide(rec.world, currentHalt(rec.world)));
  }
  const replay = rec.toReplay();
  assert.throws(() => playReplay(replay, DATA, { buildId: 'build-b' }), (e) => e instanceof ReplayError && /from build build-a/.test(e.message));
  const tampered = { ...replay, decisions: replay.decisions.slice(1) };
  assert.throws(() => playReplay(tampered, DATA, { buildId: 'build-a' }), ReplayError);
  const extra = { ...replay, decisions: [...replay.decisions, { tick: replay.endTick + 30, halt: null, kind: 'leave' }] };
  assert.throws(() => playReplay(extra, DATA, { buildId: 'build-a' }), (e) => e instanceof ReplayError && /never asked for/.test(e.message), 'a decision past the last frame');
  assert.equal(hashWorld(playReplay(replay, DATA, { buildId: 'build-a' })), replay.hash, 'the untouched replay still plays');
  assert.throws(() => playReplay(replay, DATA), /needs the build id/, 'the build check is not optional');
  const d0 = replay.decisions[0];
  const wrongHalt = { ...replay, decisions: [{ ...d0, halt: 'chest' }, ...replay.decisions.slice(1)] };
  assert.throws(() => playReplay(wrongHalt, DATA, { buildId: 'build-a' }), /recorded a "chest" decision, but the run is waiting on "draft"/);
  const part = playReplay(replay, DATA, { buildId: 'build-a', untilTick: 300 });
  assert.equal(part.tick, 300, 'untilTick stops there');
  assert.throws(() => playReplay({ v: 99 }, DATA), ReplayError);
});

test('determinism: the state hash sees what decides the future: boss timers, hook state, a dash in progress', () => {
  const pair = () => [0, 1].map(() => {
    const w = createWorld({ seed: 11, relics: ['tide_clock'] }, DATA);
    const e = spawnEnemy(w, w.enemyIndex.get('harbor_maw'), w.player.x + 200, w.player.y);
    registerBoss(w, e, false);
    for (let t = 0; t < 30; t++) stepWorld(w, { mx: 0, my: 0, buttons: 0 });
    return w;
  });
  let [a, b] = pair();
  assert.equal(hashWorld(a), hashWorld(b));
  b.bosses[0].timer += 0.001;
  assert.notEqual(hashWorld(a), hashWorld(b), 'a boss attack timer');
  [a, b] = pair();
  b.hookEntries.find((x) => x.id === 'timed_wave').state.t += 0.001;
  assert.notEqual(hashWorld(a), hashWorld(b), "a relic's own clock");
  [a, b] = pair();
  b.player.dashDx += 0.5;
  assert.notEqual(hashWorld(a), hashWorld(b), 'the dash direction');
});

test('determinism: random streams are separate (draft changes never reshuffle spawns or loot)', () => {
  const a = createWorld({ seed: 7 }, DATA), b = createWorld({ seed: 7 }, DATA);
  for (let k = 0; k < 500; k++) b.rng.draft.next();
  assert.deepEqual(a.rng.spawn.getState(), b.rng.spawn.getState());
  assert.deepEqual(a.rng.loot.getState(), b.rng.loot.getState());
  assert.notDeepEqual(a.rng.draft.getState(), b.rng.draft.getState());
});

// The golden run (tests/helpers/golden.js) uses a frozen copy of the data, so tuning and
// content changes don't move it: only sim code (or the math under it) can.
// The frozen copy must have every tuning field the sim reads (a missing one would be undefined
// and quietly turn numbers into NaN).
function tuningShape(o, path = '') {
  return Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? tuningShape(v, `${path}${k}.`) : [`${path}${k}`])).sort();
}

test('determinism: a fixed run from frozen data matches its stored hash', () => {
  const frozen = frozenData();
  assert.deepEqual(tuningShape(frozen.tuning), tuningShape(DATA.tuning), 'The frozen data is missing tuning fields: run node tools/golden/freeze.mjs, then update GOLDEN.hash in tests/helpers/golden.js.');
  const w = playGolden(frozen);
  const hash = hashWorld(w);
  assert.equal(hash, GOLDEN.hash, `The golden run now ends at ${hash}. If a sim change was meant to change runs, set GOLDEN.hash in tests/helpers/golden.js to '${hash}'. If not, something drifted.`);
});
