// Live tuning and dev commands (sim/dev.js): logged decisions, so a tuned or cheated run still
// replays exactly, and nothing a panel does can leak into the defaults or another run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA } from '../src/data/index.js';
import { TUNING } from '../src/data/tuning.js';
import { createWorld, stepWorld, decide, currentHalt, hashWorld } from '../src/sim/world.js';
import { createRecordedRun, playReplay } from '../src/sim/replay.js';
import { checkTune, tuningAt, characterTuning, checkCharacterTune } from '../src/sim/dev.js';
import { panelTuning } from '../src/app/runlogic.js';
import { flattenTuning, tuningDiff, tuningCopyText } from '../src/ui/tuningmodel.js';
import { impulse } from '../src/sim/enemies.js';
import { makeWorld, spawnAt, IDLE } from './helpers/simworld.js';

function stepN(w, n, frame = IDLE) { for (let i = 0; i < n; i++) stepWorld(w, frame); }

test('tune: changes one value on this world only, and the change is logged', () => {
  const before = TUNING.enemies.separation;
  const w = makeWorld();
  const other = makeWorld();
  decide(w, { kind: 'tune', path: 'enemies.separation', value: 0.9 });
  assert.equal(w.tuning.enemies.separation, 0.9);
  assert.equal(TUNING.enemies.separation, before, 'the defaults are untouched');
  assert.equal(other.tuning.enemies.separation, before, 'another run is untouched');
  assert.equal(w.tuning.enemies.knockbackDecay, TUNING.enemies.knockbackDecay, 'the rest of the group is kept');
  assert.deepEqual(w.decisions.at(-1), { tick: 0, halt: null, kind: 'tune', path: 'enemies.separation', value: 0.9 });
  decide(w, { kind: 'tune', path: 'chests.bossItems', value: [[1, 10], [3, 10], [5, 80]] });
  assert.deepEqual(w.tuning.chests.bossItems, [[1, 10], [3, 10], [5, 80]]);
  assert.deepEqual(TUNING.chests.bossItems, [[1, 60], [3, 30], [5, 10]], 'lists are copied, not shared');
  decide(w, { kind: 'tune', path: 'run.overtimeChoiceAfterBoss', value: false });
  assert.equal(w.tuning.run.overtimeChoiceAfterBoss, false);
});

test('tune: a change the tuning cannot hold is refused and leaves no trace', () => {
  const w = makeWorld();
  const cases = [
    [{ path: 'enemies.nope', value: 1 }, /no tuning value "enemies.nope"/],
    [{ path: 'enemies', value: 1 }, /group of values/],
    [{ path: 'enemies.separation', value: NaN }, /should be a number/],
    [{ path: 'enemies.separation', value: '0.4' }, /should be a number/],
    [{ path: 'chests.bossItems', value: [[1, 2]] }, /list of 6 numbers/],
    [{ path: 'caps.weapon.maxPierce', value: 9 }, /at most 8/],
    [{ path: 'run.overtimeChoiceAfterBoss', value: 1 }, /true or false/],
    [{ path: '', value: 1 }, /needs a path/],
    [{ path: 'toString', value: 1 }, /no tuning value/],
  ];
  for (const [d, re] of cases) assert.throws(() => decide(w, { kind: 'tune', ...d }), re, JSON.stringify(d));
  assert.equal(w.decisions.length, 0);
  assert.equal(checkTune(TUNING, 'feel.shake.playerHurt', 0.5), null, 'feel values tune like any other');
  assert.equal(tuningAt(TUNING, 'feel.fog.density'), TUNING.feel.fog.density);
  assert.equal(tuningAt(TUNING, 'feel.fog.nope'), undefined);
});

test('tune: the sim reads the new value on the next tick (live, as the panel promises)', () => {
  const w = makeWorld();
  const e = spawnAt(w, 'drowned_sailor', -100, 0);
  decide(w, { kind: 'tune', path: 'enemies.knockbackScale', value: 0 });
  impulse(w, e, 1, 0, 5);
  assert.equal(w.enemies.vx[e], 0, 'knockback scale 0: no knockback at all');
  decide(w, { kind: 'tune', path: 'player.speed', value: 160 });
  const x0 = w.player.x;
  stepN(w, 60, { mx: 127, my: 0, buttons: 0 });
  assert.ok(Math.abs(w.player.x - x0 - 160) < 2, `moved ${w.player.x - x0} px in a second at speed 160`);
});

test('tune: the run\'s character numbers (the Harpooner\'s daze) change live, on this run only', () => {
  const dataDaze = DATA.characters.find((c) => c.id === 'harpooner').mechanic.params.daze;
  const w = createWorld({ seed: 5, character: 'harpooner', invulnerable: true }, DATA);
  const other = createWorld({ seed: 5, character: 'harpooner' }, DATA);
  assert.deepEqual(Object.keys(characterTuning(w)), ['harpooner']);
  decide(w, { kind: 'tune', path: 'character.harpooner.daze', value: 0.25 });
  assert.equal(characterTuning(w).harpooner.daze, 0.25);
  assert.equal(characterTuning(w, false).harpooner.daze, dataDaze, 'the defaults are still the data');
  assert.equal(DATA.characters.find((c) => c.id === 'harpooner').mechanic.params.daze, dataDaze, 'data untouched');
  assert.equal(characterTuning(other).harpooner.daze, dataDaze, 'another run untouched');
  assert.deepEqual(w.decisions.at(-1), { tick: 0, halt: null, kind: 'tune', path: 'character.harpooner.daze', value: 0.25 });
  // The hook reads it on its next hit.
  const e = spawnAt(w, 'drowned_sailor', 60, 0);
  for (const { fn, h } of w.hooks.onHit) fn(w, h, e, 0);
  assert.equal(w.enemies.dazeT[e], Math.fround(0.25));
  decide(w, { kind: 'tune', path: 'character.harpooner.daze', value: 0 });
  w.enemies.dazeT[e] = 0;
  for (const { fn, h } of w.hooks.onHit) fn(w, h, e, 0);
  assert.equal(w.enemies.dazeT[e], 0, 'a daze of 0 dazes nothing');
  // Refused: another character's numbers, a name it doesn't have, a non-number, a group.
  const n = w.decisions.length;
  for (const [path, value, re] of [
    ['character.lamplighter.areaPerLevel', 0.1, /no character value/],
    ['character.harpooner.nope', 1, /no character value/],
    ['character.harpooner.daze', 'x', /should be a number/],
    ['character.harpooner.daze', NaN, /should be a number/],
    ['character.harpooner', 1, /no character value/],
    ['character.harpooner.daze.more', 1, /no character value/],
  ]) assert.throws(() => decide(w, { kind: 'tune', path, value }), re, path);
  assert.equal(w.decisions.length, n, 'refusals leave no trace');
  assert.equal(checkCharacterTune(w, 'character.harpooner.pull', 0.8), null);
  // A character's numbers that feed stats (the Lamplighter's growth) apply on the next tick.
  const l = createWorld({ seed: 5, character: 'lamplighter' }, DATA);
  l.player.level = 11;
  stepN(l, 1);
  const area = l.slots.find((x) => x && x.def && x.def.id === 'lamplight').stats.area;
  decide(l, { kind: 'tune', path: 'character.lamplighter.areaPerLevel', value: 0.1 });
  stepN(l, 1);
  assert.ok(l.slots.find((x) => x && x.def && x.def.id === 'lamplight').stats.area > area, 'the light grew');
});

test('tuning panel: the character\'s numbers sit beside the tuning, and Copy tuning names them', () => {
  const w = createWorld({ seed: 5, character: 'harpooner' }, DATA);
  const { defaults, current } = panelTuning(w, DATA);
  const rows = flattenTuning(current);
  const daze = rows.find((r) => r.path === 'character.harpooner.daze');
  assert.ok(daze && daze.group === 'character.harpooner' && daze.key === 'daze');
  assert.ok(rows.some((r) => r.path === 'player.speed'), 'the tuning is all still there');
  assert.equal(tuningDiff(defaults, current).length, 0);
  decide(w, { kind: 'tune', path: 'character.harpooner.daze', value: 0.3 });
  decide(w, { kind: 'tune', path: 'player.speed', value: 90 });
  const now = panelTuning(w, DATA);
  const diff = tuningDiff(now.defaults, now.current);
  assert.deepEqual(diff.map((d) => [d.path, d.from, d.to]), [['player.speed', 80, 90], ['character.harpooner.daze', 0.4, 0.3]]);
  assert.match(tuningCopyText(diff, { build: 'b' }), /character\.harpooner\.daze: 0\.3 {3}\(was 0\.4\)/);
  // Reset puts both back, through the same decisions.
  for (const d of diff) decide(w, { kind: 'tune', path: d.path, value: d.from });
  const back = panelTuning(w, DATA);
  assert.equal(tuningDiff(back.defaults, back.current).length, 0);
  assert.equal(DATA.tuning.character, undefined, 'the tuning has no group of that name to hide');
});

test('dev spawn: puts that many enemies around you, off the player, and the director counts them', () => {
  const w = makeWorld();
  const n = decide(w, { kind: 'dev', cmd: 'spawn', count: 300, enemy: 'drowned_sailor' });
  assert.equal(n, 300);
  assert.equal(w.enemies.count, 300);
  let closest = Infinity;
  for (let i = 0; i < w.enemies.count; i++) closest = Math.min(closest, Math.hypot(w.enemies.x[i] - w.player.x, w.enemies.y[i] - w.player.y));
  assert.ok(closest >= 149, `none on top of you (closest ${closest.toFixed(0)} px)`);
  stepWorld(w, IDLE);
  assert.equal(w.director.regularAlive, 300);
  assert.throws(() => decide(w, { kind: 'dev', cmd: 'spawn', count: 0 }), /count must be/);
  assert.throws(() => decide(w, { kind: 'dev', cmd: 'spawn', count: 5, enemy: 'harbor_maw' }), /bosses come from the timeline/);
  assert.throws(() => decide(w, { kind: 'dev', cmd: 'spawn', count: 5, enemy: 'nope' }), /unknown enemy/);
  const w2 = makeWorld();
  decide(w2, { kind: 'dev', cmd: 'spawn', count: 20 });
  assert.equal(w2.enemies.count, 20, 'no enemy named: the current band roster');
});

test('dev jump: forward only; the events in between are skipped, later ones still fire', () => {
  const w = makeWorld({}, { events: [{ at: 30, event: 'chest' }, { at: 90, event: 'chest' }] });
  assert.throws(() => decide(w, { kind: 'dev', cmd: 'jump', to: 0 }), /later than now/);
  decide(w, { kind: 'dev', cmd: 'jump', to: 60 });
  assert.equal(w.tick, 3600);
  stepWorld(w, IDLE);
  assert.equal(w.pickups.count, 0, 'the 0:30 chest was skipped');
  decide(w, { kind: 'dev', cmd: 'jump', to: 89.99 });
  stepN(w, 2);
  assert.equal(w.pickups.count, 1, 'the 1:30 chest still came');
});

test('dev give: weapons, passives, relics, and runes, through the same rules as the draft', () => {
  const w = makeWorld();
  decide(w, { kind: 'dev', cmd: 'give', what: 'weapon', id: 'flare_gun' });
  assert.equal(w.slots[0].def.id, 'flare_gun');
  assert.equal(w.slots[0].level, 1);
  decide(w, { kind: 'dev', cmd: 'give', what: 'weapon', id: 'flare_gun' });
  assert.equal(w.slots[0].level, 2, 'giving one you own levels it');
  decide(w, { kind: 'dev', cmd: 'give', what: 'passive', id: 'wick_oil' });
  assert.equal(w.build.passives[0].def.id, 'wick_oil');
  decide(w, { kind: 'dev', cmd: 'give', what: 'relic', id: 'tide_clock' });
  assert.ok(w.build.relics.some((r) => r.id === 'tide_clock'));
  assert.throws(() => decide(w, { kind: 'dev', cmd: 'give', what: 'relic', id: 'tide_clock' }), /already holding/);
  decide(w, { kind: 'dev', cmd: 'give', what: 'rune', id: 'backfire' });
  assert.deepEqual(currentHalt(w), { kind: 'rune', rune: 'backfire' }, 'a rune asks where it goes');
  decide(w, { kind: 'place', slot: 0 });
  assert.equal(w.slots[0].runes[0].id, 'backfire');
  assert.throws(() => decide(w, { kind: 'dev', cmd: 'give', what: 'weapon', id: 'lamplight' }), /character's own weapon/);
  for (let k = 0; k < 6; k++) decide(w, { kind: 'dev', cmd: 'give', what: 'weapon', id: 'flare_gun' });
  assert.equal(w.slots[0].level, 8);
  assert.throws(() => decide(w, { kind: 'dev', cmd: 'give', what: 'weapon', id: 'flare_gun' }), /already at its highest level/, 'a no-op give says so');
  for (let k = 0; k < 4; k++) decide(w, { kind: 'dev', cmd: 'give', what: 'passive', id: 'wick_oil' });
  assert.throws(() => decide(w, { kind: 'dev', cmd: 'give', what: 'passive', id: 'wick_oil' }), /already at its highest level/);
  assert.throws(() => decide(w, { kind: 'dev', cmd: 'give', what: 'weapon', id: 'nope' }), /unknown weapon/);
  assert.throws(() => decide(w, { kind: 'dev', cmd: 'give', what: 'hat', id: 'x' }), /not weapon, passive/);
  assert.throws(() => decide(w, { kind: 'dev', cmd: 'give', what: 'rune', id: 'orbiting' }), /no open socket fits/, 'Orbiting would strand the Backfire already in the Flare Gun, and no other weapon has sockets');
});

test('dev level: queues exactly that many level-ups; god, heal, and clear do what they say', () => {
  const w = makeWorld();
  decide(w, { kind: 'dev', cmd: 'level', count: 3 });
  stepWorld(w, IDLE);
  assert.equal(w.player.level, 4);
  let drafts = 0;
  while (currentHalt(w)) { drafts++; decide(w, { kind: 'pick', index: 0 }); }
  assert.equal(drafts, 3);
  assert.throws(() => decide(w, { kind: 'dev', cmd: 'level', count: 51 }), /count must be/);

  decide(w, { kind: 'dev', cmd: 'god', on: true });
  spawnAt(w, 'drowned_sailor', 0, 0);
  stepN(w, 120);
  assert.equal(w.player.hp, w.stats.maxHp, 'invulnerable');
  decide(w, { kind: 'dev', cmd: 'god', on: false });
  for (let k = 0; k < 6; k++) spawnAt(w, 'drowned_bosun', 0, 0); // more than three levels of weapons clear at once
  stepN(w, 60);
  assert.ok(w.player.hp < w.stats.maxHp, 'hurt again once god mode is off');
  decide(w, { kind: 'dev', cmd: 'heal' });
  assert.equal(w.player.hp, w.stats.maxHp);
  assert.throws(() => decide(w, { kind: 'dev', cmd: 'god', on: 1 }), /true or false/);

  const kills = w.result.totalKills;
  decide(w, { kind: 'dev', cmd: 'spawn', count: 50 });
  const cleared = decide(w, { kind: 'dev', cmd: 'clear' });
  assert.ok(cleared >= 50);
  stepWorld(w, IDLE);
  assert.equal(w.enemies.count, 0);
  assert.equal(w.result.totalKills, kills, 'cleared, not killed: no kills, no gems');
  assert.equal(w.gems.count, 0);
  assert.throws(() => decide(w, { kind: 'dev', cmd: 'fly' }), /unknown command "fly"/);
  decide(w, { kind: 'dev', cmd: 'chest', boss: true });
  assert.equal(currentHalt(w).kind, 'chest', 'a dev chest opens with its reel');
  assert.equal(currentHalt(w).chestKind, 2);
});

test('replays: a run tuned and cheated along the way plays back exactly', () => {
  const rec = createRecordedRun({ seed: 'tuned', character: 'lamplighter' }, DATA, 'b1');
  const frame = (t) => ({ mx: Math.round(100 * Math.cos(t / 50)), my: Math.round(100 * Math.sin(t / 70)), buttons: t % 240 === 0 ? 1 : 0 });
  for (let t = 0; t < 1800 && !rec.world.over; t++) {
    if (t === 200) rec.decide({ kind: 'tune', path: 'enemies.separation', value: 0.7 });
    if (t === 250) rec.decide({ kind: 'tune', path: 'character.lamplighter.areaPerLevel', value: 0.05 });
    if (t === 400) rec.decide({ kind: 'dev', cmd: 'spawn', count: 120 });
    if (t === 600) rec.decide({ kind: 'dev', cmd: 'give', what: 'weapon', id: 'tide_bell' });
    if (t === 700) rec.decide({ kind: 'dev', cmd: 'level', count: 2 });
    if (t === 800) rec.decide({ kind: 'dev', cmd: 'god', on: true });
    if (t === 850) rec.decide({ kind: 'dev', cmd: 'chest', boss: true });
    if (t === 900) rec.decide({ kind: 'dev', cmd: 'jump', to: 300 });
    if (t === 1000) rec.decide({ kind: 'dev', cmd: 'heal' });
    if (t === 1100) rec.decide({ kind: 'dev', cmd: 'clear' });
    if (t === 1300) rec.decide({ kind: 'dev', cmd: 'god', on: false });
    rec.step(frame(t));
    while (currentHalt(rec.world)) {
      const h = currentHalt(rec.world);
      rec.decide(h.kind === 'draft' ? { kind: 'pick', index: 0 } : h.kind === 'rune' ? { kind: 'discard' } : h.kind === 'overtime' ? { kind: 'leave' } : { kind: 'ok' });
    }
  }
  const replay = rec.toReplay();
  assert.ok(replay.decisions.some((d) => d.kind === 'tune') && replay.decisions.some((d) => d.kind === 'dev'));
  const back = playReplay(replay, DATA, { buildId: 'b1' });
  assert.equal(hashWorld(back), replay.hash);
  assert.equal(back.tuning.enemies.separation, 0.7);
  assert.equal(characterTuning(back).lamplighter.areaPerLevel, 0.05, 'the character tune replays too');
  assert.equal(replay.config.invulnerable, undefined, 'god mode is not written into the config the replay starts from');
});

test('god mode is a world flag the state hash sees, not a change to the RunConfig', () => {
  const a = makeWorld(), b = makeWorld();
  decide(a, { kind: 'dev', cmd: 'god', on: true });
  assert.equal(a.god, true);
  assert.notEqual(a.config.invulnerable, true);
  assert.notEqual(hashWorld(a), hashWorld(b));
});

test('decide: a decision that is not an object is refused with a plain message', () => {
  const w = createWorld({ seed: 1 }, DATA);
  assert.throws(() => decide(w, null), /needs a decision object/);
  assert.throws(() => decide(w, 'pick'), /needs a decision object/);
});
