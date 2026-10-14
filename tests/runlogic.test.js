// The run scene's pure parts (app/runlogic.js) and the replay and report files (save/replay.js):
// hit-stop, sounds, what each halt's screen shows, the run summary, the report event log, and
// a report round trip that plays back to the same state.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA } from '../src/data/index.js';
import { createEventBuffer, EV, PICK } from '../src/sim/events.js';
import { stepWorld, decide, currentHalt, hashWorld, buildRunResult } from '../src/sim/world.js';
import { createRecordedRun, playReplay } from '../src/sim/replay.js';
import { hitStopFor, soundFor, noticeFor, haltView, pauseBuild, runSummary, createEventLog, buildContext, settingRefusal } from '../src/app/runlogic.js';
import { TELE } from '../src/sim/events.js';
import { encodeReplay, decodeReplay, buildReport, readReport } from '../src/save/replay.js';
import { makeWorld, give, spawnAt, IDLE } from './helpers/simworld.js';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const HS = { playerHurt: 70, eliteKill: 60, bossKill: 220, bossSlam: 90 };

test('hit-stop: only big events hold the sim, and the longest one wins', () => {
  const ev = createEventBuffer(64, 8);
  ev.push(EV.HIT, 0, 0, 5, 1, 0, 0);
  ev.push(EV.KILL, 0, 0, 1, 0, 0);
  assert.equal(hitStopFor(ev, 0, ev.count, HS), 0, 'ordinary hits and kills never freeze the horde');
  ev.push(EV.KILL, 0, 0, 1, 1, 0);          // elite
  assert.equal(hitStopFor(ev, 0, ev.count, HS), 60);
  ev.push(EV.PLAYER_HURT, 0, 0, 5, 90);
  ev.push(EV.KILL, 0, 0, 1, 2, 0);          // boss
  assert.equal(hitStopFor(ev, 0, ev.count, HS), 220);
  assert.equal(hitStopFor(ev, 3, 4, HS), 70, 'only the range asked for');
  ev.clear();
  ev.push(EV.EXPLODE, 0, 0, 30, -1);        // a boss slam
  ev.push(EV.EXPLODE, 0, 0, 30, 2);         // a weapon's explosion
  assert.equal(hitStopFor(ev, 0, 1, HS), 90);
  assert.equal(hitStopFor(ev, 1, 2, HS), 0);
});

test('sounds: weapons use their own data, and quiet events stay quiet', () => {
  const w = makeWorld();
  give(w, 'harpoon_chain');
  const ev = createEventBuffer(32, 4);
  ev.push(EV.HIT, 0, 0, 5, 1, 0, 0);
  ev.push(EV.FIRE, 0, 0, 0, 1);
  ev.push(EV.HIT, 0, 0, 5, 1, 0, 5);        // an empty slot
  ev.push(EV.PICKUP, 0, 0, PICK.HEAL, 30);
  ev.push(EV.PICKUP, 0, 0, PICK.MATERIAL, 0);
  ev.push(EV.KILL, 0, 0, 1, 2, 0);
  ev.push(EV.STATUS, 0, 0, 1, 0);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map((i) => soundFor(ev, i, w.slots)), ['hit_hard', 'harpoon_throw', 'hit_soft', 'heal', 'pickup', 'kill_big', null]);
  for (const name of ['hit_hard', 'harpoon_throw', 'hit_soft', 'heal', 'pickup', 'kill_big']) assert.ok(DATA.sfx[name], `${name} exists in data/sfx.js`);
  for (const wdef of DATA.weapons) for (const s of Object.values(wdef.sfx || {})) assert.ok(DATA.sfx[s], `${wdef.id} names sound "${s}", which exists`);
});

test('sounds for warnings: boss-sized shapes always, ordinary lines through the rate-limited beep; shots sound as they fire', () => {
  const w = makeWorld();
  const ev = createEventBuffer(32, 4);
  ev.push(EV.TELEGRAPH, 0, 0, TELE.RING, 60, 70, 0);
  ev.push(EV.TELEGRAPH, 0, 0, TELE.LINE, 48, 120, 0);
  ev.push(EV.TELEGRAPH, 0, 0, TELE.CIRCLE, 54, 22, 3);
  ev.push(EV.TELEGRAPH, 0, 0, TELE.FAN, 54, 70, 0);
  ev.push(EV.BOSS_ATTACK, 0, 0, 4, 1);
  ev.push(EV.ENEMY_SHOT, 0, 0);
  ev.push(EV.EXPLODE, 0, 0, 72, -1);
  ev.push(EV.EVOLVE, 0, 0, 0);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map((i) => soundFor(ev, i, w.slots)), ['warn_big', 'warn', 'warn', 'warn_big', null, 'enemy_shot', 'boss_slam', 'evolve']);
  assert.ok(DATA.sfx.warn.gapMs > 0, 'the ordinary warning beep is rate-limited');
  ev.clear();
  ev.push(EV.BOSS_SPAWN, 0, 0, w.enemyIndex.get('harbor_maw'), 1);
  ev.push(EV.OVERTIME, 0, 0, 3);
  ev.push(EV.HIT, 0, 0, 1, 1);
  assert.deepEqual([0, 1, 2].map((i) => noticeFor(ev, i, w)), ['The Harbor Maw', 'Overtime: 3 min', null]);
});

test('sim: a gunner\'s shot writes ENEMY_SHOT (so it sounds as it fires)', () => {
  const w = makeWorld();
  spawnAt(w, 'wreck_gunner', 150, 0);
  let seen = 0;
  for (let t = 0; t < 600 && !seen; t++) { stepWorld(w, IDLE); seen = w.events.countOf(EV.ENEMY_SHOT); }
  assert.ok(seen > 0, 'a gunner in range fires within 10 s');
});

test('settings: borderless switches only where a reload loses nothing', () => {
  assert.equal(settingRefusal('display.mode', 'borderless', 'fullscreen', true), null);
  assert.match(settingRefusal('display.mode', 'borderless', 'fullscreen', false), /main menu/);
  assert.match(settingRefusal('display.mode', 'windowed', 'borderless', false), /main menu/);
  assert.equal(settingRefusal('display.mode', 'windowed', 'fullscreen', false), null, 'fullscreen to a window never reopens');
  assert.equal(settingRefusal('display.mode', 'borderless', 'borderless', false), null);
  assert.equal(settingRefusal('audio.master', 0.5, 0.8, false), null);
});

test('halt screens: a draft shows its cards and charges; a chest, a rune, and overtime show theirs', () => {
  const w = makeWorld();
  give(w, 'flare_gun');
  decide(w, { kind: 'dev', cmd: 'level', count: 1 });
  stepWorld(w, IDLE);
  const draft = haltView(w, currentHalt(w), DATA);
  assert.equal(draft.kind, 'draft');
  assert.equal(draft.cards.length, 3);
  assert.deepEqual(draft.charges, w.charges);
  for (const c of draft.cards) assert.ok(c.title && c.sub && c.desc, 'every card has words');
  decide(w, { kind: 'pick', index: 0 });
  decide(w, { kind: 'dev', cmd: 'chest', boss: false });
  const chest = haltView(w, currentHalt(w), DATA);
  assert.equal(chest.kind, 'chest');
  assert.equal(chest.boss, false);
  assert.equal(chest.items.length, 1);
  decide(w, { kind: 'ok' });
  while (currentHalt(w)) decide(w, currentHalt(w).kind === 'rune' ? { kind: 'discard' } : { kind: 'ok' });
  decide(w, { kind: 'dev', cmd: 'give', what: 'rune', id: 'backfire' });
  const rune = haltView(w, currentHalt(w), DATA);
  assert.equal(rune.kind, 'rune');
  assert.deepEqual(rune.options.map((o) => o.slot), [0]);
  assert.equal(rune.options[0].name, 'Flare Gun');
  assert.equal(haltView(w, { kind: 'overtime' }, DATA).bossName, 'Boss');
  assert.throws(() => haltView(w, { kind: 'dance' }, DATA), /unknown halt/);
  const ctx = buildContext(w);
  assert.deepEqual(ctx.weapons, ['flare_gun']);
  assert.ok(ctx.tags.fire >= 1);
});

test('pause and run end: the build summary and the end screen read from the run', () => {
  const rec = createRecordedRun({ seed: 'summary', character: 'lamplighter' }, DATA, 'b');
  for (let t = 0; t < 1200 && !rec.world.over; t++) {
    rec.step({ mx: 100, my: 30, buttons: 0 });
    while (currentHalt(rec.world)) rec.decide(currentHalt(rec.world).kind === 'draft' ? { kind: 'pick', index: 0 } : { kind: 'ok' });
  }
  const b = pauseBuild(rec.world);
  assert.equal(b.time, '0:20');
  const flare = b.weapons.find((x) => x.name === 'Flare Gun');
  assert.ok(flare && flare.desc === DATA.weapons.find((w) => w.id === 'flare_gun').desc && Array.isArray(flare.runes));
  rec.decide({ kind: 'dev', cmd: 'give', what: 'relic', id: 'tide_clock' });
  rec.decide({ kind: 'dev', cmd: 'give', what: 'rune', id: 'backfire' });
  rec.decide({ kind: 'place', slot: 0 });
  const b2 = pauseBuild(rec.world);
  assert.deepEqual(b2.weapons[0].runes, ['Backfire']);
  assert.deepEqual(b2.relics.at(-1), { name: 'Tide Clock', icon: 'relic_tide_clock', desc: DATA.relics.find((r) => r.id === 'tide_clock').desc });
  rec.decide({ kind: 'leave' });
  const s = runSummary(buildRunResult(rec.world), DATA);
  assert.equal(s.title, 'Run ended');
  assert.deepEqual(s.lines[0], ['Time', '0:20']);
  assert.ok(s.lines.some(([k]) => k === 'Kills'));
  const fake = { ...buildRunResult(rec.world), end: 'cleared', overtimeMinutes: 3, evolutions: ['kraken_line'], materials: { rope: 4 }, bossesKilled: [{ id: 'harbor_maw', time: 600 }] };
  const f = runSummary(fake, DATA);
  assert.equal(f.title, 'Map cleared');
  assert.deepEqual(f.lines.find(([k]) => k === 'Bosses'), ['Bosses', 'The Harbor Maw']);
  assert.deepEqual(f.lines.find(([k]) => k === 'Evolved'), ['Evolved', 'Kraken Line']);
  assert.deepEqual(f.materials, [{ icon: 'mat_rope', name: 'Rope', count: 4 }]);
});

test('event log: keeps the last N events that matter, oldest first', () => {
  const log = createEventLog(3);
  const ev = createEventBuffer(32, 4);
  ev.push(EV.HIT, 0, 0, 1); ev.push(EV.KILL, 1, 1, 2); ev.push(EV.FIRE, 0, 0, 0); ev.push(EV.PLAYER_HURT, 2, 2, 5, 95);
  log.add(ev, 0, ev.count, 10);
  assert.deepEqual(log.list().map((e) => e.type), ['KILL', 'PLAYER_HURT'], 'hits and shots are left out');
  ev.clear(); ev.push(EV.LEVEL_UP, 0, 0, 2); ev.push(EV.CHEST, 0, 0, 1, 1);
  log.add(ev, 0, ev.count, 11);
  assert.deepEqual(log.list().map((e) => `${e.type}@${e.tick}`), ['PLAYER_HURT@10', 'LEVEL_UP@11', 'CHEST@11']);
  log.clear();
  assert.equal(log.count, 0);
});

test('replays: a step that throws still records its frame, so playback reaches the same tick', () => {
  const rec = createRecordedRun({ seed: 'crash', character: 'lamplighter' }, DATA, 'b');
  for (let t = 0; t < 100; t++) rec.step({ mx: 50, my: 0, buttons: 0 });
  const real = rec.world.enemies.alloc;
  rec.world.enemies.alloc = () => { throw new Error('boom'); };
  decide(rec.world, { kind: 'dev', cmd: 'god', on: true }); // any logged change before the crash
  assert.throws(() => { for (let k = 0; k < 600; k++) rec.step({ mx: 50, my: 0, buttons: 0 }); }, /boom/);
  rec.world.enemies.alloc = real;
  const crashedAt = rec.world.tick;
  const replay = rec.toReplay();
  assert.equal(replay.frames.length / 3, crashedAt + 1, 'the frame of the tick that threw is in the replay');
});

test('replay files and reports: round trip, and a report plays back to the moment it was saved', () => {
  const rec = createRecordedRun({ seed: 'report', character: 'harpooner' }, DATA, 'build-x');
  for (let t = 0; t < 900; t++) {
    if (t === 300) rec.decide({ kind: 'tune', path: 'enemies.separation', value: 0.6 });
    rec.step({ mx: Math.round(90 * Math.cos(t / 40)), my: Math.round(90 * Math.sin(t / 40)), buttons: t % 200 === 0 ? 1 : 0 });
    while (currentHalt(rec.world)) rec.decide(currentHalt(rec.world).kind === 'draft' ? { kind: 'pick', index: 1 } : { kind: 'ok' });
  }
  const replay = rec.toReplay();
  const bytes = encodeReplay(replay);
  assert.ok(bytes.length < 8000, `15 seconds compress small (${bytes.length} bytes)`);
  const back = decodeReplay(bytes);
  assert.deepEqual([...back.frames], [...replay.frames]);
  assert.deepEqual(back.decisions, replay.decisions);
  assert.equal(hashWorld(playReplay(back, DATA, { buildId: 'build-x' })), replay.hash);
  const text = buildReport({ build: 'build-x', target: 'web', createdAt: '2026-09-28T00:00:00Z', replay, tuning: [{ path: 'enemies.separation', from: 0.35, to: 0.6 }], events: [{ tick: 1, type: 'KILL' }], settings: { a: 1 } });
  const r = readReport(text);
  assert.equal(r.build, 'build-x');
  assert.equal(r.tuning[0].to, 0.6);
  assert.equal(hashWorld(playReplay(r.replay, DATA, { buildId: 'build-x' })), replay.hash, 'the report replays exactly');
  assert.equal(readReport(buildReport({ build: 'b', target: 'web', createdAt: 'now' })).replay, null, 'a report from the title has no replay');
  assert.throws(() => decodeReplay(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])), /not a Lamplight replay/);
  const damaged = bytes.slice(); damaged[20] ^= 0xff; damaged[30] ^= 0xff;
  assert.throws(() => decodeReplay(damaged), /damaged|not a Lamplight/);
  assert.throws(() => readReport('{"kind":"other"}'), /not a Lamplight report/);
  assert.throws(() => readReport('nope'), /not JSON/);
  assert.throws(() => encodeReplay({ frames: [1, 2] }), /needs a replay/);
  // A part that fails to build is named, and the rest of the report is still there.
  const partial = readReport(buildReport({ build: 'b', target: 'web', createdAt: 'now', replay: () => replay, state: () => { throw new Error('half-stepped'); }, errors: [{ message: 'boom' }] }));
  assert.deepEqual(partial.problems, ['state: half-stepped']);
  assert.equal(partial.state, null);
  assert.equal(partial.errors[0].message, 'boom');
  assert.equal(hashWorld(playReplay(partial.replay, DATA, { buildId: 'build-x' })), replay.hash);
  const obj = JSON.parse(text);
  assert.throws(() => readReport(JSON.stringify({ ...obj, replay: '%%%not base64%%%' })), /replay in this report is damaged/);
  assert.throws(() => readReport(JSON.stringify({ ...obj, v: 99 })), /version 99/);
});

test('tools/replay: plays a report to a moment, and refuses another build unless told', () => {
  const rec = createRecordedRun({ seed: 'tool', character: 'lamplighter' }, DATA, 'kevin-build');
  for (let t = 0; t < 1200; t++) {
    rec.step({ mx: 60, my: 20, buttons: 0 });
    while (currentHalt(rec.world)) rec.decide(currentHalt(rec.world).kind === 'draft' ? { kind: 'pick', index: 0 } : { kind: 'ok' });
  }
  const dir = mkdtempSync(join(tmpdir(), 'lamplight-replay-'));
  const file = join(dir, 'report.json');
  writeFileSync(file, buildReport({ build: 'kevin-build', target: 'web', createdAt: 'now', replay: rec.toReplay() }));
  const tool = new URL('../tools/replay/replay.mjs', import.meta.url).pathname;
  const refused = spawnSync(process.execPath, [tool, file], { encoding: 'utf8' });
  assert.equal(refused.status, 3);
  assert.match(refused.stderr, /--any-build/);
  const full = JSON.parse(spawnSync(process.execPath, [tool, file, '--any-build'], { encoding: 'utf8' }).stdout);
  assert.equal(full.endedAtTick, 1200);
  assert.equal(full.hashMatches, true);
  const early = JSON.parse(spawnSync(process.execPath, [tool, file, '--any-build', '--until', '0:10'], { encoding: 'utf8' }).stdout);
  assert.equal(early.endedAtTick, 600);
  assert.equal(spawnSync(process.execPath, [tool, file, '--until', 'soon'], { encoding: 'utf8' }).status, 2);
  rmSync(dir, { recursive: true, force: true });
});
