// The combat's pace dials (data/tuning.js pace, 0.8.1; ARCHITECTURE §5.7): fewer, slower,
// stronger enemies, each a dial on the tuning panel. The test field elsewhere plays at the neutral
// pace (tests/helpers/simworld.js NEUTRAL_PACE); here each dial is turned and checked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DATA } from '../src/data/index.js';
import { stepWorld, decide } from '../src/sim/world.js';
import { EF } from '../src/sim/constants.js';
import { EV } from '../src/sim/events.js';
import { CHARGER } from '../src/sim/enemies.js';
import { rollDrops } from '../src/sim/pickups.js';
import { checkTimeline } from '../src/sim/director.js';
import { plainName, plainGroup, flattenTuning } from '../src/ui/tuningmodel.js';
import { makeWorld, spawnAt, run, runCollect, eventsOf, IDLE, NEUTRAL_PACE } from './helpers/simworld.js';

const pace = (o) => ({ tuning: { pace: o } });

test('pace: every dial is in the data, neutral reads as 0.8.0, and each has a plain name with its unit on the panel', () => {
  const P = DATA.tuning.pace;
  assert.deepEqual(Object.keys(P).sort(), Object.keys(NEUTRAL_PACE).sort(), 'the test helper knows every dial');
  for (const [k, v] of Object.entries(P)) assert.ok(Number.isFinite(v) && v > 0, `pace.${k}`);
  // Fewer, slower, stronger, and a minute still earns about what it did; set pieces full size (ruling 7).
  assert.ok(P.density < 1 && P.maxAlive < NEUTRAL_PACE.maxAlive && P.speed < 1 && P.hp > 1 && P.contact > 1 && P.xp > 1 && P.drops > 1);
  assert.equal(P.events, 1, 'walls, rings, flocks, and musters at full size');
  const rows = flattenTuning(DATA.tuning).filter((r) => r.group === 'pace');
  assert.equal(rows.length, Object.keys(P).length, 'every dial is a panel row');
  for (const r of rows) {
    const n = plainName(r.path);
    assert.ok(!/[A-Z].*[A-Z]|\./.test(n.label.replace(/\b(HP|XP)\b/g, 'hp').slice(1)) && n.label.length > 3, `${r.path}: words, not code (${n.label})`);
    assert.ok(r.path === 'pace.maxAlive' ? n.unit === null : n.unit === 'x', `${r.path}: its unit (${n.unit})`);
  }
  assert.equal(plainGroup('pace'), 'Pace');
});

test('pace: every band of every map has a floor, a whole number no higher than its density, and the director holds it', () => {
  for (const m of DATA.maps) {
    for (const b of m.timeline.bands) assert.ok(Number.isInteger(b.min) && b.min > 0 && b.min <= b.density[0], `${m.id} band from ${b.from}: min ${b.min}`);
  }
  const bad = { id: 'x', timeline: { bands: [{ from: 0, to: 60, roster: { fog_wisp: 1 }, density: [10, 20], min: 30 }] }, overtime: { densityPerMin: 1, hpPerMin: 1, materialsPerMin: 1 } };
  assert.throws(() => checkTimeline(bad, new Map(DATA.enemies.map((e, i) => [e.id, i])), DATA.enemies), /min/);
  // Turned all the way down, the band's min still comes.
  const bands = [{ from: 0, to: 60, roster: { fog_wisp: 1 }, density: [100, 100], min: 12 }];
  const w = makeWorld({ invulnerable: true, ...pace({ density: 0.01 }) }, { bands });
  run(w, 300);
  assert.equal(w.director.target, 12);
  assert.equal(w.director.regularAlive, 12);
});

test('pace: density scales the band\'s target, events every scripted crowd (ruling 7); the alive cap stops the band, not the map\'s events', () => {
  const bands = [{ from: 0, to: 60, roster: { fog_wisp: 1 }, density: [200, 200], min: 5 }];
  const w = makeWorld({ invulnerable: true, ...pace({ density: 0.4 }) }, { bands });
  run(w, 200);
  assert.ok(Math.abs(w.director.target - 80) < 1e-9, `target ${w.director.target}`);
  // A wall, a ring, a flock, and a muster's crew: full size whatever the density dial says (0.9.0),
  // and times the set-piece dial (at least one).
  const events = [
    { at: 1, event: 'wall', enemy: 'gull', count: 30 },
    { at: 2, event: 'ring', enemy: 'fog_wisp', count: 40 },
    { at: 3, event: 'flock', enemy: 'gull', count: 8 },
    { at: 4, event: 'muster', name: 'Test Muster', enemy: 'drowned_bosun', escort: 'drowned_sailor', count: 24, radius: 36 },
    { at: 5, event: 'ring', enemy: 'fog_wisp', count: 1 },
  ];
  const full = makeWorld({ invulnerable: true, ...pace({ density: 0.35 }) }, { events });
  assert.deepEqual(runCollect(full, 3 * 60 + 2, EV.SWARM).map((s) => s.b), [30, 40, 8], 'the density dial leaves set pieces whole');
  assert.deepEqual(runCollect(full, 2 * 60, EV.MUSTER).map((m) => m.a), [24]);
  const e = makeWorld({ invulnerable: true, ...pace({ density: 0.35, events: 0.35 }) }, { events });
  const swarms = runCollect(e, 3 * 60 + 2, EV.SWARM).map((s) => s.b);
  const musters = runCollect(e, 2 * 60, EV.MUSTER).map((m) => m.a);
  assert.deepEqual(swarms, [11, 14, 3], 'events 0.35: the wall 30 to 11, the ring 40 to 14, the flock 8 to 3');
  assert.deepEqual(musters, [8], 'the crew 24 to 8');
  assert.ok(runCollect(e, 60, EV.SWARM).every((s) => s.b === 1), 'never fewer than one');
  // The cap counts every enemy alive but a set piece's: the band stops spawning there. A set piece
  // comes in full (it is the map's content) and may pass the cap while it runs (ruling 7).
  const capped = makeWorld({ invulnerable: true, ...pace({ maxAlive: 30 }) }, { bands, events: [{ at: 3, event: 'ring', enemy: 'fog_wisp', count: 25 }] });
  run(capped, 170);
  assert.equal(capped.enemies.count, 30, 'the band fills to the cap and no further');
  assert.ok(capped.director.target <= 30);
  run(capped, 400);
  assert.equal(capped.enemies.count, 55, 'the ring came whole on top of the band');
  let ev = 0;
  for (let i = 0; i < capped.enemies.count; i++) if ((capped.enemies.flags[i] & EF.EVENT) !== 0) ev++;
  assert.equal(ev, 25, 'the ring is a set piece (EF.EVENT)');
  assert.equal(capped.director.regularAlive, 30, 'the band counts its own');
});

test('pace: speed slows walking and a charger\'s dash, which still covers exactly its warned line, and keeps every warning\'s length', () => {
  const walk = (s) => {
    const w = makeWorld({ invulnerable: true, ...pace({ speed: s }) });
    const e = spawnAt(w, 'drowned_sailor', 200, 0);
    const x0 = w.enemies.x[e];
    run(w, 60);
    return x0 - w.enemies.x[e];
  };
  const def = DATA.enemies.find((x) => x.id === 'drowned_sailor');
  assert.ok(Math.abs(walk(1) - def.speed) < 1, `${walk(1)} px at 1`);
  assert.ok(Math.abs(walk(0.5) - def.speed * 0.5) < 1, `${walk(0.5)} px at 0.5`);
  // A crab: the same warning, a dash half as fast for twice as long, the same reach.
  const crab = DATA.enemies.find((x) => x.id === 'mud_crab').ai;
  const dash = (s) => {
    const w = makeWorld({ invulnerable: true, ...pace({ speed: s }) });
    const e = spawnAt(w, 'mud_crab', 100, 0);
    const E = w.enemies;
    let warn = 0, dashTicks = 0, from = 0, to = 0, line = 0;
    for (let t = 0; t < 600; t++) {
      stepWorld(w, IDLE);
      const tele = eventsOf(w, EV.TELEGRAPH);
      if (tele.length && line === 0) line = tele[0].c;
      if (E.aiState[e] === CHARGER.WINDUP) warn++;
      if (E.aiState[e] === CHARGER.DASH) { if (dashTicks === 0) from = E.x[e]; dashTicks++; to = E.x[e]; }
      if (dashTicks > 0 && E.aiState[e] !== CHARGER.DASH) break;
      w.player.x = E.x[e] - 400; // out of the crab's way, so nothing stops its dash
    }
    return { warn, dashTicks, reach: Math.abs(to - from), line };
  };
  const full = dash(1), half = dash(0.5);
  assert.equal(half.line, full.line, 'the warned line is as long');
  assert.ok(Math.abs(full.line - crab.dashSpeed * crab.dashTime) < 1e-6, `the line ${full.line}`);
  assert.equal(half.warn, full.warn, 'the warning keeps its length');
  assert.ok(Math.abs(half.dashTicks - 2 * full.dashTicks) <= 1, `${full.dashTicks} ticks at 1, ${half.dashTicks} at 0.5`);
  assert.ok(Math.abs(half.reach - full.reach) <= crab.dashSpeed / 60 + 0.5, `reach ${full.reach.toFixed(1)} at 1, ${half.reach.toFixed(1)} at 0.5`);
});

test('pace: health and XP scale ordinary enemies only; elites and bosses keep their own rules', () => {
  const w = makeWorld({ invulnerable: true, ...pace({ hp: 2.5, xp: 3 }) });
  const E = w.enemies, T = w.tuning.enemies;
  const sailor = DATA.enemies.find((x) => x.id === 'drowned_sailor');
  const plain = spawnAt(w, 'drowned_sailor', 200, 0);
  const elite = spawnAt(w, 'drowned_sailor', -200, 0, { elite: true });
  const boss = spawnAt(w, 'harbor_maw', 0, 300);
  const hpMul = w.director.hpMul;
  const f = Math.fround;
  assert.equal(E.maxHp[plain], f(sailor.hp * hpMul * 2.5));
  assert.equal(E.xp[plain], f(sailor.xp * 3));
  assert.equal(E.maxHp[elite], f(sailor.hp * hpMul * T.eliteHp), 'an elite: eliteHp, no pace');
  assert.equal(E.xp[elite], f(sailor.xp * T.eliteXp));
  assert.equal(E.maxHp[boss], f(DATA.enemies.find((x) => x.id === 'harbor_maw').hp * w.director.bossHpMul), 'a boss: its own health');
  assert.ok((E.flags[boss] & EF.BOSS) !== 0);
});

test('pace: contact scales an enemy\'s touch (not a boss\'s); drops scale an ordinary enemy\'s chances (not an elite\'s)', () => {
  const touch = (c, id = 'drowned_sailor') => {
    const w = makeWorld({ ...pace({ contact: c }) });
    w.player.hp = 1000;
    spawnAt(w, id, 0, 0);
    run(w, 1, IDLE, { halts: 'pass' });
    return 1000 - w.player.hp;
  };
  assert.ok(Math.abs(touch(1.5) - touch(1) * 1.5) < 1e-6, `${touch(1)} at 1, ${touch(1.5)} at 1.5`);
  assert.equal(touch(2, 'harbor_maw'), touch(1, 'harbor_maw'), 'a boss hits as it always did');
  // A chance of 1 stays one drop; an elite's table is its own.
  const rolls = (drops, elite) => {
    const w = makeWorld({ map: 'drowned_docks', ...pace({ drops }) }, {});
    const t = w.enemyIndex.get('drowned_sailor');
    let n = 0;
    for (let k = 0; k < 4000; k++) {
      const e = spawnAt(w, 'drowned_sailor', 300, 0, elite ? { elite: true } : null);
      rollDrops(w, e, w.enemyDefs[t], w.enemies.flags[e]);
      n += w.pickups.count;
      while (w.pickups.count) w.pickups.remove(0);
      w.enemies.remove(e);
    }
    return n;
  };
  const a = rolls(1, false), b = rolls(3, false);
  assert.ok(b > a * 2.6 && b < a * 3.4, `${a} drops at 1, ${b} at 3`);
  const ea = rolls(1, true), eb = rolls(3, true);
  assert.ok(Math.abs(eb - ea) < ea * 0.15, `an elite: ${ea} at 1, ${eb} at 3`);
});

test('pace: a dial turned on the panel changes the run from then on, and replays as a logged decision', () => {
  const bands = [{ from: 0, to: 60, roster: { fog_wisp: 1 }, density: [100, 100], min: 5 }];
  const w = makeWorld({ invulnerable: true }, { bands });
  const before = { ...DATA.tuning.pace };
  run(w, 120);
  assert.ok(Math.abs(w.director.target - 100) < 1e-9);
  decide(w, { kind: 'tune', path: 'pace.density', value: 0.5 });
  decide(w, { kind: 'tune', path: 'pace.hp', value: 2 });
  run(w, 1);
  assert.ok(Math.abs(w.director.target - 50) < 1e-9, 'the target halves at once');
  const e = spawnAt(w, 'fog_wisp', 200, 0);
  assert.equal(w.enemies.maxHp[e], Math.fround(DATA.enemies.find((x) => x.id === 'fog_wisp').hp * w.director.hpMul * 2), 'what spawns next is tougher');
  assert.deepEqual(DATA.tuning.pace, before, 'the defaults are untouched');
});
