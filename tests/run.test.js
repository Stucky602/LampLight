// Whole runs: the director (§5.7), RunResult (§5.15), and the headless run the brief asks for
// (§9.4: "a scripted 20-minute run that stays stable"), kept fast for every deploy (§14.1).
import test from 'node:test';
import assert from 'node:assert/strict';
import { DATA } from '../src/data/index.js';
import { createWorld, stepWorld, decide, currentHalt } from '../src/sim/world.js';
import { buildRunResult } from '../src/sim/run-result.js';
import { createKiteBot } from '../src/sim/bot.js';
import { EF } from '../src/sim/constants.js';
import { EV } from '../src/sim/events.js';
import { makeWorld, give, run, runCollect, IDLE } from './helpers/simworld.js';
import { addMaterial } from '../src/sim/pickups.js';
import { damageEnemy } from '../src/sim/enemies.js';
import { hurtPlayer } from '../src/sim/player.js';

const T = (m, s = 0) => (m * 60 + s) * 60; // minutes:seconds to ticks

function play(w, bot, ticks, onTick = null) {
  const end = w.tick + ticks;
  while (w.tick < end && !w.over) {
    stepWorld(w, bot.input(w));
    if (onTick) onTick(w);
    let g = 0;
    while (currentHalt(w) && g++ < 100) decide(w, bot.decide(w, currentHalt(w)));
  }
}

// ---------------------------------------------------------------- the director

test('director: keeps the regular count on the band\'s curve and never spawns on screen', () => {
  const bands = [{ from: 0, to: 60, roster: { fog_wisp: 1, drowned_sailor: 1 }, density: [20, 80] }];
  const w = makeWorld({ invulnerable: true }, { bands });
  let onScreen = 0;
  for (let t = 0; t < 60 * 60; t++) {
    const before = w.enemies.count;
    stepWorld(w, IDLE);
    for (let i = before; i < w.enemies.count; i++) {
      if (w.enemies.flags[i] & EF.DEAD) continue;
      if (Math.abs(w.enemies.x[i] - w.player.x) < 330 && Math.abs(w.enemies.y[i] - w.player.y) < 190) onScreen++;
    }
  }
  assert.equal(onScreen, 0, 'every spawn was off screen');
  assert.ok(Math.abs(w.director.regularAlive - 80) <= 2, `about 80 alive at the end (${w.director.regularAlive})`);
  assert.ok(Math.abs(w.director.target - 80) < 1.5);
});

test('director: scripted events fire on time; short mode compresses the timeline', () => {
  const events = [
    { at: 2, event: 'wall', enemy: 'gull', count: 20 },
    { at: 3, event: 'ring', enemy: 'fog_wisp', count: 16 },
    { at: 4, event: 'elite', enemy: 'drowned_bosun' },
    { at: 6, event: 'boss', enemy: 'harbor_maw' },
  ];
  const swarms = [];
  const w = makeWorld({ invulnerable: true }, { events });
  const got = runCollect(w, 7 * 60, EV.SWARM);
  for (const s of got) swarms.push([s.tick, s.a, s.b]);
  assert.deepEqual(swarms, [[120, 1, 20], [180, 2, 16]], 'the wall at 2 s, the ring at 3 s, all spawned');
  assert.equal([...Array(w.enemies.count).keys()].filter((i) => w.enemies.flags[i] & EF.ELITE).length, 1);
  assert.equal(w.bosses.length, 1);
  assert.equal(w.bosses[0].spawnTick, 360);
  assert.equal(w.bosses[0].final, true, 'the last boss event is the final boss');
  const s = makeWorld({ invulnerable: true, mode: 'short' }, { events });
  run(s, 3 * 60 + 1);
  assert.equal(s.bosses.length, 1, 'short mode: the 6 s boss comes at 3 s');
  assert.equal(s.bosses[0].spawnTick, 180);
});

test('director: enemies get tougher with time; a boss thins the crowd; overtime escalates each minute', () => {
  const bands = [{ from: 0, to: 600, roster: { fog_wisp: 1 }, density: [100, 100] }];
  const w = makeWorld({ invulnerable: true }, { bands, events: [{ at: 120, event: 'boss', enemy: 'harbor_maw' }] });
  run(w, 60 * 60);
  assert.ok(Math.abs(w.director.hpMul - (1 + w.tuning.director.hpPerMinute)) < 0.01, `hp x${w.director.hpMul.toFixed(3)} at 1:00`);
  run(w, 61 * 60);
  assert.ok(Math.abs(w.director.target - 100 * w.tuning.director.bossDensityMul) < 1e-6, 'fewer while the boss is up');
  // Overtime: stay, then each minute multiplies density, HP, and materials.
  w.halts.push({ kind: 'overtime' });
  decide(w, { kind: 'stay' });
  const hp0 = w.director.hpMul;
  run(w, 60 * 60 + 1);
  assert.equal(w.director.overtimeMinutes, 1);
  const ot = w.map.overtime;
  assert.ok(Math.abs(w.director.otDensity - ot.densityPerMin) < 1e-12);
  assert.ok(Math.abs(w.director.materialMul - ot.materialsPerMin) < 1e-12);
  assert.ok(w.director.hpMul > hp0 * ot.hpPerMin * 0.99);
});

test('director: the pause menu can leave at any time; after the last boss that counts as cleared', () => {
  const w = makeWorld({ invulnerable: true });
  run(w, 30);
  decide(w, { kind: 'leave' });
  assert.equal(buildRunResult(w).end, 'left');
  assert.throws(() => decide(w, { kind: 'leave' }), /over/);
  assert.equal(stepWorld(w, IDLE), false, 'nothing runs after the end');
});

// ---------------------------------------------------------------- RunResult

test('RunResult: plain data that covers what feats need, with materials after greed and short-run pay', () => {
  const w = createWorld({ seed: 9, invulnerable: true, mods: [{ stat: 'greed', op: 'pct', value: 1 }] }, DATA);
  const bot = createKiteBot();
  play(w, bot, T(2));
  const coin = w.materialIndex.get('coin');
  w.result.materialsRaw[coin] = 0;
  addMaterial(w, coin, 10.6);                      // greed counts when you pick it up
  decide(w, { kind: 'leave' });
  const r = buildRunResult(w);
  assert.deepEqual(JSON.parse(JSON.stringify(r)), r, 'serializes cleanly');
  for (const k of ['end', 'timeSurvived', 'kills', 'totalKills', 'bossesKilled', 'weapons', 'weaponLevelMax', 'maxWeaponLevel', 'tags', 'materials', 'damageTaken', 'dashKills', 'secretsFound', 'character', 'map', 'mode', 'level']) {
    assert.ok(k in r, `has ${k}`);
  }
  assert.equal(r.materials.coin, 21, 'greed doubles: floor(10.6 x 2)');
  // Tags count weapons and passives in the build (a tagged passive included for sure).
  if (!w.build.passives.some((ps) => ps.def.tags.length)) w.build.passives.push({ def: w.passiveDefs.find((x) => x.id === 'wick_oil'), level: 1 });
  const r2 = buildRunResult(w);
  const expected = {};
  for (let k = 0; k < w.build.weaponSlots; k++) if (w.slots[k]) for (const t of w.slots[k].def.tags) expected[t] = (expected[t] || 0) + 1;
  for (const ps of w.build.passives) for (const t of ps.def.tags) expected[t] = (expected[t] || 0) + 1;
  assert.deepEqual(r2.tags, expected);
  assert.ok(r2.tags.fire >= 1);
  assert.equal(r.totalKills, Object.values(r.kills).reduce((a, b) => a + b, 0));
  assert.ok(r.timeSurvived > 119 && r.timeSurvived < 121);
  assert.ok(r.maxWeaponLevel >= 1 && r.weapons.length >= 2, 'the starting weapon and the innate light');
  const s = createWorld({ seed: 9, mode: 'short', rewardMul: 1.5 }, DATA);
  s.result.materialsRaw[coin] = 100;
  decide(s, { kind: 'leave' });
  assert.equal(buildRunResult(s).materials.coin, Math.floor(100 * s.tuning.run.shortRewardMul * 1.5), 'short runs and reward multipliers scale the haul');
});

test('RunResult: a death, and a boss kill in seconds with the weapons that did it', () => {
  const w = makeWorld({ invulnerable: true }, { events: [{ at: 1, event: 'boss', enemy: 'harbor_maw' }] });
  give(w, 'flare_gun');
  run(w, 90, undefined, { halts: 'pass' });
  const b = w.bosses[0], e = w.enemies.resolve(b.handle);
  b.damageBySlot[0] = 5;
  damageEnemy(w, e, 1e9, 9);                       // a relic blast lands the killing blow
  run(w, 1, undefined, { halts: 'pass' });
  w.config.invulnerable = false;
  w.player.iframes = 0;
  hurtPlayer(w, 1e9, w.player.x, w.player.y);
  const r = buildRunResult(w);
  assert.equal(r.end, 'died');
  assert.equal(r.bossesKilled.length, 1);
  assert.equal(r.bossesKilled[0].id, 'harbor_maw');
  assert.deepEqual(r.bossesKilled[0].weapons, ['relic', 'flare_gun'], 'most damage first');
  assert.ok(r.bossesKilled[0].time >= 1 && r.bossesKilled[0].time <= 2, `killed at ${r.bossesKilled[0].time} s: seconds, not ticks`);
});

// ---------------------------------------------------------------- the whole run

// The full-density 20:00 run (plus overtime) is tools/soak, run before every zip; the gate keeps
// the same run at a lower density so every Cloudflare build stays quick.
test('run: a kiting bot plays a full 20:00 run (density capped at 100): stable, both bosses, a sane result', () => {
  const w = createWorld({ seed: 2026, invulnerable: true, densityCap: 100 }, DATA);
  const bot = createKiteBot({ stay: false });
  const bossTicks = [];
  let bad = null;
  play(w, bot, T(21, 30), (world) => {
    for (const b of world.bosses) if (!bossTicks.includes(b.spawnTick)) bossTicks.push(b.spawnTick);
    if (bad === null && world.tick % 60 === 0) {
      const p = world.player;
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.hp)) bad = `player NaN at ${world.tick}`;
      const E = world.enemies;
      for (let i = 0; i < E.count && bad === null; i++) if (!Number.isFinite(E.x[i]) || !Number.isFinite(E.hp[i])) bad = `enemy NaN at ${world.tick}`;
      const P = world.projectiles;
      for (let i = 0; i < P.count && bad === null; i++) if (!Number.isFinite(P.x[i])) bad = `shot NaN at ${world.tick}`;
    }
  });
  assert.equal(bad, null);
  assert.deepEqual(bossTicks.slice(0, 2), [T(10), T(20)], 'bosses at 10:00 and 20:00');
  for (const pool of ['enemies', 'projectiles', 'gems', 'zones', 'pickups']) assert.equal(w[pool].refused, 0, `the ${pool} pool never ran out`);
  const r = buildRunResult(w);
  assert.ok(r.totalKills > 2000, `${r.totalKills} kills`);
  assert.ok(r.level >= 20, `level ${r.level}`);
  assert.ok(r.bossesKilled.length >= 1, 'the bot beat at least the first boss');
  assert.ok(Object.keys(r.materials).length >= 3, 'brought materials home');
  assert.equal(w.events.droppedTotal, 0, 'no events dropped at this density');
});

test('run: half a minute at full late-game density (1,500 alive) stays stable', () => {
  const bands = [{ from: 0, to: 600, roster: { drowned_sailor: 3, bilge_rat: 3, mud_crab: 1, bloater: 1, lantern_eater: 1, wreck_gunner: 1 }, density: [1500, 1500] }];
  const w = makeWorld({ seed: 4, invulnerable: true, tuning: { director: { maxSpawnPerTick: 60 } } }, { bands });
  const bot = createKiteBot();
  play(w, bot, 30 * 60);
  assert.ok(w.enemies.count >= 1400, `${w.enemies.count} alive`);
  assert.ok(Number.isFinite(w.player.x) && Number.isFinite(w.player.hp));
  assert.equal(w.enemies.refused, 0);
});

// ---------------------------------------------------------------- the director, more closely

test('director: a chest event drops a chest in view; elites and bosses still come when you stand in a corner', () => {
  const w = makeWorld({ invulnerable: true }, { events: [{ at: 1, event: 'chest' }] });
  run(w, 61);
  const chests = [...Array(w.pickups.count).keys()].filter((i) => w.pickups.kind[i] === 4);
  assert.equal(chests.length, 1);
  const c = chests[0];
  assert.ok(Math.abs(w.pickups.x[c] - w.player.x) < 320 && Math.abs(w.pickups.y[c] - w.player.y) < 180, 'on screen');
  for (let seed = 1; seed <= 25; seed++) {
    const k = makeWorld({ seed, invulnerable: true }, { events: [{ at: 0, event: 'elite', enemy: 'drowned_bosun' }, { at: 0, event: 'boss', enemy: 'harbor_maw' }] });
    k.player.x = 20; k.player.y = 20;
    run(k, 1);
    const elites = [...Array(k.enemies.count).keys()].filter((i) => k.enemies.flags[i] & EF.ELITE);
    assert.equal(elites.length, 1, `seed ${seed}: the elite came`);
    const b = k.enemies.resolve(k.bosses[0].handle);
    const d = Math.hypot(k.enemies.x[b] - k.player.x, k.enemies.y[b] - k.player.y);
    assert.ok(d > 360, `seed ${seed}: the boss came from off screen (${d.toFixed(0)} px)`);
  }
});

test('director: bad timeline or overtime data fails when the run starts, with a plain message', () => {
  assert.throws(() => makeWorld({}, { events: [{ at: 5, event: 'party', enemy: 'gull' }] }), /unknown event type/);
  assert.throws(() => makeWorld({}, { events: [{ at: 5, event: 'wall', enemy: 'gull' }] }), /whole-number count/);
  assert.throws(() => makeWorld({}, { events: [{ at: 5, event: 'ring', enemy: 'harbor_maw', count: 3 }] }), /bosses come only from boss events/);
  assert.throws(() => makeWorld({}, { mapExtra: { overtime: null } }), /overtime needs/);
  assert.throws(() => makeWorld({}, { bands: [{ from: 0, to: 60, roster: { gull: 1 }, density: [40, 40] }] }), /can't be in a band roster/, 'swarmers as filler would flood the pool');
  assert.throws(() => makeWorld({}, { events: [{ at: 5, event: 'ring', enemy: 'fog_wisp', count: 8, radius: 200 }] }), /would spawn on screen/);
  assert.throws(() => makeWorld({}, { events: [{ at: 5, event: 'wall', enemy: 'gull', count: 8, speed: 0 }] }), /speed must be above 0/);
});

test('director: contact damage grows with time; overtime compounds each minute; the enemy cap holds', () => {
  const bands = [{ from: 0, to: 600, roster: { fog_wisp: 1 }, density: [50, 50] }];
  const w = makeWorld({ invulnerable: true }, { bands });
  run(w, 5 * 60 * 60, undefined, { halts: 'pass' });
  assert.ok(Math.abs(w.director.contactMul - (1 + 5 * w.tuning.director.contactPerMinute)) < 1e-3, `contact x${w.director.contactMul}`);
  w.director.finalBossDead = true;
  w.halts.push({ kind: 'overtime' });
  decide(w, { kind: 'stay' });
  run(w, 3 * 60 * 60 + 1, undefined, { halts: 'pass' });
  assert.equal(w.director.overtimeMinutes, 3);
  assert.ok(Math.abs(w.director.otDensity - w.map.overtime.densityPerMin ** 3) < 1e-9);
  decide(w, { kind: 'leave' });
  assert.equal(buildRunResult(w).end, 'cleared', 'leaving from the pause menu in overtime counts as cleared');
  const cap = makeWorld({ invulnerable: true, tuning: { director: { maxEnemies: 40 } } }, { bands: [{ from: 0, to: 60, roster: { fog_wisp: 1 }, density: [500, 500] }] });
  run(cap, 300);
  assert.ok(cap.director.regularAlive <= 40, `${cap.director.regularAlive} alive, cap 40`);
});

test('director: short mode gives bosses less health', () => {
  const events = [{ at: 2, event: 'boss', enemy: 'harbor_maw' }];
  const s = makeWorld({ invulnerable: true, mode: 'short' }, { events });
  run(s, 61);
  const e = s.enemies.resolve(s.bosses[0].handle);
  assert.equal(s.enemies.maxHp[e], s.enemyDefs[s.enemies.type[e]].hp * s.tuning.run.shortBossHp);
});
