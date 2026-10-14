// The player and the world's edges (ARCHITECTURE §5.1, §5.5, §7, builder's call 5): movement,
// the dash, damage, death and revival, experience and levels, the RunConfig and InputFrame the
// sim accepts, and the state hash's coverage.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, spawnAt, run, DATA } from './helpers/simworld.js';
import { createWorld, stepWorld, currentHalt, decide, hashWorld } from '../src/sim/world.js';
import { hurtPlayer, xpToNext } from '../src/sim/player.js';
import { buildRunResult } from '../src/sim/run-result.js';
import { damageEnemy } from '../src/sim/enemies.js';
import { addHook, HOOKS } from '../src/sim/hooks.js';
import { TPS } from '../src/sim/constants.js';

const DASH = { mx: 127, my: 0, buttons: 1 };
const IDLE = { mx: 0, my: 0, buttons: 0 };

test('player: dying ends the run as died; a revival brings you back instead', () => {
  const w = makeWorld();
  hurtPlayer(w, 1e6, w.player.x, w.player.y);
  assert.equal(buildRunResult(w).end, 'died');
  assert.equal(stepWorld(w, IDLE), false, 'nothing runs after death');
  const r = makeWorld({ mods: [{ stat: 'revival', op: 'add', value: 1 }] });
  const T = r.tuning.player;
  const e = spawnAt(r, 'drowned_sailor', 30, 0);
  stepWorld(r, IDLE);                                          // the enemy grid now has it
  hurtPlayer(r, 1e6, r.player.x, r.player.y);
  assert.equal(r.over, null, 'still going');
  assert.equal(r.player.hp, r.stats.maxHp * T.reviveHpFraction);
  assert.equal(r.player.iframes, Math.round(T.reviveIframes * TPS));
  assert.equal(r.player.revivals, 0);
  assert.equal(r.result.revivalsUsed, 1);
  assert.ok(r.enemies.vx[e] > 0, 'nearby enemies pushed away');
  r.player.iframes = 0;
  hurtPlayer(r, 1e6, r.player.x, r.player.y);
  assert.equal(buildRunResult(r).end, 'died', 'no revivals left');
});

test('player: the dash covers its distance, once per press, then cools down (the dashCooldown stat scales it)', () => {
  const w = makeWorld({ invulnerable: false });
  const T = w.tuning.player;
  const x0 = w.player.x;
  const ticks = Math.round(T.dash.time * TPS);
  for (let k = 0; k < ticks; k++) stepWorld(w, DASH);             // held the whole time
  assert.ok(Math.abs(w.player.x - x0 - T.dash.distance) < 1e-6, `dashed ${w.player.x - x0} px`);
  assert.equal(w.player.iframes, Math.round(T.dash.iframesAfter * TPS) - 1, 'a little invulnerability after (the dash\'s last tick counts as the first)');
  const x1 = w.player.x;
  stepWorld(w, DASH);                                              // still held: no second dash
  assert.ok(Math.abs(w.player.x - x1 - T.speed / TPS) < 1e-6, 'holding the button walks');
  // Pressed again while cooling down: no dash over the next 10 ticks, just walking.
  stepWorld(w, IDLE);
  const x2 = w.player.x;
  for (let k = 0; k < 10; k++) { stepWorld(w, k === 0 ? DASH : { ...DASH, buttons: 0 }); assert.equal(w.player.dashTicks, 0, `no dash at ${k}`); }
  assert.ok(Math.abs(w.player.x - x2 - 10 * T.speed / TPS) < 1e-6, 'walked, did not dash');
  const cd = w.player.dashCd;
  assert.ok(cd > 0 && cd < T.dash.cooldown);
  // Held down past the cooldown: still no dash until it's released and pressed again.
  const held = Math.ceil(cd * TPS) + 5;
  for (let k = 0; k < held; k++) { stepWorld(w, DASH); assert.equal(w.player.dashTicks, 0, 'holding never starts a dash'); }
  assert.ok(w.player.dashCd <= 0, 'cooled down by now');
  stepWorld(w, IDLE); stepWorld(w, DASH);
  assert.ok(w.player.dashTicks > 0, 'a fresh press dashes');
  const fast = makeWorld({ mods: [{ stat: 'dashCooldown', op: 'pct', value: -0.5 }] });
  stepWorld(fast, DASH);
  assert.ok(Math.abs(fast.player.dashCd - (T.dash.cooldown * 0.5 - 1 / TPS)) < 1e-9, 'half the cooldown');
});

test('player: walls stop you; a dash into a wall stops at it', () => {
  const layout = { kind: 'rects', rects: [[66, 60, 1, 10]] };  // a wall 2 tiles right of the start
  const w = makeWorld({}, { layout });
  for (let k = 0; k < 120; k++) stepWorld(w, { mx: 127, my: 0, buttons: k === 60 ? 1 : 0 });
  assert.ok(w.player.x <= 66 * 16 - w.tuning.player.radius + 1e-6, `stopped at the wall (${w.player.x})`);
});

test('player: the XP curve matches its table, and one big gem can give several levels at once', () => {
  const X = DATA.tuning.xp;
  const table = { 1: 5, 2: 15, 3: 25, 19: 185 };
  for (const [L, need] of Object.entries(table)) assert.equal(xpToNext(DATA.tuning, Number(L)), need, `level ${L}`);
  assert.equal(xpToNext(DATA.tuning, 20), X.first + X.perLevel * (X.lateFrom - 2) + X.latePerLevel + X.steps[20], 'level 20: the late slope starts, plus the step');
  assert.equal(xpToNext(DATA.tuning, 21), X.first + X.perLevel * (X.lateFrom - 2) + X.latePerLevel * 2);
  const w = makeWorld({ invulnerable: true });
  w.player.xp = 5 + 15 + 25;
  stepWorld(w, IDLE);
  assert.equal(w.player.level, 4, 'three levels from one gem');
  let drafts = 0;
  while (currentHalt(w)) { assert.equal(currentHalt(w).kind, 'draft'); drafts++; w.charges.skip = 9; decide(w, { kind: 'skip' }); }
  assert.equal(drafts, 3, 'one draft per level');
});

test('world: a RunConfig or tuning the sim can\'t run is refused with a plain message', () => {
  const bad = [
    [{ mode: 'hard' }, /unknown mode/],
    [{ weaponSlots: 'x' }, /weaponSlots/],
    [{ weaponSlots: 12 }, /weaponSlots/],
    [{ charges: { reroll: -1 } }, /charges/],
    [{ tuning: { player: { speed: 'fast' } } }, /player.speed/],
    [{ tuning: { player: { spead: 90 } } }, /player.spead/],
    [{ tuning: { enemies: [1, 2] } }, /enemies/],
    [{ tuning: { player: { speed: NaN } } }, /player.speed/],
  ];
  for (const [cfg, re] of bad) assert.throws(() => createWorld({ seed: 1, ...cfg }, DATA), re, JSON.stringify(cfg));
  const ok = createWorld({ seed: 1, tuning: { player: { speed: 95 } } }, DATA);
  assert.equal(ok.tuning.player.speed, 95);
});

test('world: a start tile inside a wall moves you to open ground; a broken input frame reads as no input', () => {
  const w = makeWorld({}, { layout: { kind: 'rects', rects: [[62, 62, 4, 4]] } });
  assert.equal(w.terrain.blockedAt(w.player.x, w.player.y), false);
  const x = w.player.x, y = w.player.y;
  stepWorld(w, { mx: NaN, my: 900, buttons: 'x' });
  stepWorld(w, { mx: undefined, my: -1e9, buttons: undefined });
  assert.deepEqual([w.player.x, w.player.y], [x, y]);
});

test('world: the state hash sees banished cards, the number of weapon slots, and what evolved', () => {
  const pair = () => [makeWorld({ invulnerable: true }), makeWorld({ invulnerable: true })];
  let [a, b] = pair();
  b.build.banished.add('weapon:flare_gun');
  assert.notEqual(hashWorld(a), hashWorld(b));
  [a, b] = pair();
  b.build.weaponSlots = 7;
  assert.notEqual(hashWorld(a), hashWorld(b));
  [a, b] = pair();
  b.build.evolvedFrom.add('flare_gun');
  assert.notEqual(hashWorld(a), hashWorld(b));
});

test('world: a death caused while deaths are being counted (a kill hook) is counted too', () => {
  const w = makeWorld({ invulnerable: true });
  // A test hook: each kill kills the next enemy in the pool, from the front.
  HOOKS.test_chain_kill = { onKill(world) { const E = world.enemies; for (let i = 0; i < E.count; i++) if (!(E.flags[i] & 1)) { damageEnemy(world, i, 1e9, 9); return; } } };
  try {
    addHook(w, 'test_chain_kill', {});
    const ids = [spawnAt(w, 'fog_wisp', 200, 0), spawnAt(w, 'fog_wisp', 220, 0), spawnAt(w, 'fog_wisp', 240, 0)];
    damageEnemy(w, ids[2], 1e9, 0);
    run(w, 1, IDLE, { halts: 'pass' });
    assert.equal(w.result.totalKills, 3);
    assert.equal(w.gems.count, 3);
    assert.equal(w.enemies.count, 0);
  } finally { delete HOOKS.test_chain_kill; }
});

test('player: health regenerates with the regen stat; a missing input frame is no input', () => {
  const w = makeWorld({ mods: [{ stat: 'regen', op: 'add', value: 6 }] });
  w.player.hp = 50;
  run(w, 60);
  assert.ok(Math.abs(w.player.hp - 56) < 1e-6, `6 per second: ${w.player.hp}`);
  const x = w.player.x;
  stepWorld(w, undefined); stepWorld(w, null);
  assert.equal(w.player.x, x);
});

test('world: RunConfig numbers are checked too, and a starting relic must exist', () => {
  for (const [cfg, re] of [[{ rewardMul: NaN }, /rewardMul/], [{ hpMul: 0 }, /hpMul/], [{ densityCap: -1 }, /densityCap/], [{ draftCards: 9 }, /draftCards/], [{ evolutionPassiveReduction: 1.5 }, /evolutionPassiveReduction/], [{ relics: ['nope'] }, /unknown relic "nope"/], [{ tuning: { caps: { weapon: { maxPierce: 12 } } } }, /maxPierce/]]) {
    assert.throws(() => createWorld({ seed: 1, ...cfg }, DATA), re, JSON.stringify(cfg));
  }
});

test('world: removeDead keeps counting deaths until none are left (a kill that causes an earlier kill)', async () => {
  const { removeDead } = await import('../src/sim/enemies.js');
  const w = makeWorld({ invulnerable: true });
  HOOKS.test_back_kill = { onKill(world) { const E = world.enemies; if (!(E.flags[0] & 1)) damageEnemy(world, 0, 1e9, 9); } };
  try {
    addHook(w, 'test_back_kill', {});
    spawnAt(w, 'fog_wisp', 200, 0); spawnAt(w, 'fog_wisp', 220, 0);
    damageEnemy(w, 1, 1e9, 0);          // index 1 dies; resolving it kills index 0, already passed
    removeDead(w);
    assert.equal(w.result.totalKills, 2);
    assert.equal(w.enemies.count, 0);
  } finally { delete HOOKS.test_back_kill; }
});
