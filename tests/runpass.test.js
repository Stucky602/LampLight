// The run side of 0.7.3's gamer pass (ARCHITECTURE §5.7, §5.10, §5.13, §10.8): starters and what
// research opens, the Docks' chests on the clock, the next chest's source, dry level-ups past the
// draft (draft.test.js), the XP curve past 40, boss health from your level and the fight-length
// floor, Lantern Night's burn by the minute, overtime's repeating events, the Tides' rules, and
// the Ferryman's Ember priced per Form.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, spawnAt, give, givePassive, run, runCollect, eventsOf, DATA, IDLE, pastGates } from './helpers/simworld.js';
import { createWorld, stepWorld, decide, currentHalt } from '../src/sim/world.js';
import { xpToNext, heal } from '../src/sim/player.js';
import { damageEnemy, NO_CHEST } from '../src/sim/enemies.js';
import { nextChestSource, CHEST_ELITE } from '../src/sim/chests.js';
import { dropChest } from '../src/sim/chests.js';
import { maybeReliquary, emberPrice, emberQuote, FERRY_KINDS } from '../src/sim/relics.js';
import { optionChoices } from '../src/sim/ascend.js';
import { tideRulesFor } from '../src/sim/director.js';
import { EV, HIT_CAPPED } from '../src/sim/events.js';
import { TPS, EF, PK } from '../src/sim/constants.js';
import { crowdArrives } from '../src/sim/tasks.js';
import { TILE } from '../src/sim/terrain.js';

const T = DATA.tuning;
const byId = (list, id) => list.find((x) => x.id === id);

// ---------------------------------------------------------------- starters and research

test('starters: six weapons and eight passives from the start (0.9.0: a pool twice the slots); the tier-1 projects that held passives now open capstones', () => {
  const starters = (list) => list.filter((x) => x.unlock === 'starter').map((x) => x.id);
  assert.deepEqual(starters(DATA.weapons).sort(), ['flare_gun', 'harpoon_chain', 'lantern_orb', 'oil_flask', 'signal_mirror', 'tide_bell']);
  assert.deepEqual(starters(DATA.passives).sort(), ['ballast', 'bitterns_call', 'lamp_glass', 'lodestone', 'sea_legs', 'tallow_candle', 'thick_coat', 'wick_oil']);
  // About twice the slots a fresh profile runs with (4 weapons, the character's own in one of them; 4 passives).
  assert.ok(starters(DATA.weapons).length >= 6 && starters(DATA.passives).length === 8);
  const capstones = DATA.ascensions.flatMap((l) => l.options.filter((o) => o.capstone).map((o) => ({ ...o, weapon: l.weapons[0] })));
  for (const [key, form] of [['research:orbwright', 'wards'], ['research:tide_charts', 'riptide'], ['research:ships_ballast', 'dead_weight'], ['research:oil_stores', 'fuel_line']]) {
    assert.equal(capstones.find((o) => o.id === form).unlock, key, `${form} behind ${key}`);
    assert.equal(DATA.research.find((r) => r.id === key.slice(9)).tier, 1, 'tier-1 research');
  }
  // (Ruling 25 WA: Tether waits for a later project, Stern Lines, so the Marsh's first runs meet the chain without it.)
  assert.equal(capstones.find((o) => o.id === 'tether').unlock, 'research:reversed_runes');
  assert.equal(byId(DATA.relics, 'tide_clock').unlock, 'starter', '0.8.2: the Tide Clock is in a fresh pool');
  assert.equal(byId(DATA.passives, 'undertow').unlock, 'research:signal_codes', '0.8.2: the Harbor Clock opens Undertow');
  assert.equal(byId(DATA.research, 'signal_codes').name, 'Harbor Clock');
  assert.equal(byId(DATA.research, 'storm_glass').name, 'Weatherglass');
  const all = [...Object.values(DATA).filter(Array.isArray).flat(), ...capstones];
  for (const r of DATA.research) assert.ok(all.some((x) => x.unlock === `research:${r.id}`), `${r.name} still opens something`);
  // A starter's partner passive the first pool can't hold, and where it comes from (ruling 14: a partner makes the capstone hit harder; it gates nothing).
  const fresh = new Set(starters(DATA.passives));
  const missing = starters(DATA.weapons).map((id) => byId(DATA.weapons, id)).filter((x) => !fresh.has(x.partner)).map((x) => [x.id, byId(DATA.passives, x.partner).unlock]);
  assert.deepEqual(missing, [['tide_bell', 'research:signal_codes']], 'only the Tide Bell\'s Undertow, from the Library (the Harbor Clock)');
});

// ---------------------------------------------------------------- the XP curve

test('xp: each level past 40 costs 1.06 times more than the formula before it', () => {
  const X = T.xp, flat = { ...T, xp: { ...X, growthFrom: undefined } };
  for (let L = 1; L < X.growthFrom; L++) assert.equal(xpToNext(T, L), xpToNext(flat, L), `level ${L} unchanged`);
  for (let L = X.growthFrom; L < X.growthFrom + 30; L++) {
    const want = Math.round(xpToNext(flat, L) * X.growth ** (L + 1 - X.growthFrom));
    assert.equal(xpToNext(T, L), want, `level ${L + 1}`);
  }
  assert.ok(xpToNext(T, 60) > 2.5 * xpToNext(flat, 60), 'twenty levels on, about 3.2 times');
});

// ---------------------------------------------------------------- the Docks' chests

test('docks: elites at 2:30, 7:30, 12:00, and 18:30 beside the bosses and the musters; overtime repeats, 1.08 a minute, materials capped', () => {
  const docks = byId(DATA.maps, 'drowned_docks');
  const chests = docks.timeline.events.filter((e) => ['elite', 'muster', 'boss', 'chest'].includes(e.event)).map((e) => `${e.event}@${e.at}`);
  assert.deepEqual(chests, ['elite@150', 'muster@300', 'elite@450', 'boss@600', 'elite@720', 'muster@900', 'muster@1050', 'elite@1110', 'boss@1200'], '0.9.0: the First Mate at 5:00; ruling 17 W7: the Quartermaster at 17:30');
  const gaps = docks.timeline.events.filter((e) => ['elite', 'muster', 'boss'].includes(e.event)).map((e) => e.at).map((t, k, a) => t - (a[k - 1] ?? 0));
  assert.ok(Math.max(...gaps) <= 300, 'never more than 5 minutes without a chest');
  const ot = docks.overtime;
  assert.equal(ot.hpPerMin, 1.08);
  assert.ok(ot.materialsCap >= 1);
  assert.deepEqual(ot.repeat.map((r) => r.event).sort(), ['elite', 'muster', 'ring']);
});

test('next chest: a chest on the ground first, then a living elite or boss, then the next timeline event, then overtime\'s', () => {
  const w = makeWorld({ invulnerable: true }, { events: [{ at: 30, event: 'ring', enemy: 'fog_wisp', count: 4 }, { at: 90, event: 'elite', enemy: 'drowned_bosun' }, { at: 600, event: 'boss', enemy: 'harbor_maw' }],
    mapExtra: { overtime: { densityPerMin: 1.1, hpPerMin: 1.08, materialsPerMin: 1.1, repeat: [{ every: 60, event: 'ring', enemy: 'bilge_rat', count: 4 }, { every: 120, event: 'elite', enemies: ['drowned_bosun', 'lantern_eater'] }] } } });
  assert.deepEqual(nextChestSource(w), { kind: 'event', event: 'elite', enemy: 'drowned_bosun', name: null, at: 90 }, 'the ring is no chest: the elite at 1:30');
  const el = spawnAt(w, 'drowned_sailor', 120, 0, { elite: true });
  const pair = spawnAt(w, 'drowned_sailor', 30, 0, { elite: true });
  w.enemies.boss[pair] = NO_CHEST;
  const src = nextChestSource(w);
  assert.equal(src.kind, 'elite');
  assert.equal(src.handle, w.enemies.handle(el), 'a living elite, not the pair\'s second (no chest)');
  dropChest(w, w.player.x + 200, w.player.y, CHEST_ELITE);
  assert.equal(nextChestSource(w).kind, 'chest', 'one lying on the map comes first');
  // Overtime: the next repeating elite.
  const o = makeWorld({ invulnerable: true }, { events: [], mapExtra: { overtime: { densityPerMin: 1.1, hpPerMin: 1.08, materialsPerMin: 1.1, repeat: [{ every: 60, event: 'ring', enemy: 'bilge_rat', count: 4 }, { every: 120, event: 'elite', enemies: ['drowned_bosun', 'lantern_eater'] }] } } });
  assert.equal(nextChestSource(o), null, 'nothing coming');
  o.halts.push({ kind: 'overtime' });
  decide(o, { kind: 'stay' });
  assert.deepEqual(nextChestSource(o), { kind: 'event', event: 'elite', enemy: 'drowned_bosun', name: null, at: o.tick / TPS + 120 });
});

test('reliquary: still offered with one relic left to find; with none left, none drops and the run says so once', () => {
  const w = makeWorld({ invulnerable: true, pools: { weapons: [], passives: [], relics: ['brass_button'] } });
  w.reliquary.kills = T.relics.reliquaryPity;
  w.tick = Math.ceil(T.relics.reliquaryGap * TPS) + 1;
  maybeReliquary(w, w.player.x, w.player.y);
  assert.equal(w.result.reliquaries, 1);
  run(w, 2, IDLE, { halts: 'stop' });
  assert.deepEqual(currentHalt(w).offer, ['brass_button'], 'one to pick from');
  decide(w, { kind: 'pick', index: 0 });
  w.reliquary.kills = T.relics.reliquaryPity;
  w.tick += Math.ceil(T.relics.reliquaryGap * TPS) + 1;
  const before = w.pickups.count;
  w.events.clear();
  maybeReliquary(w, w.player.x, w.player.y);
  maybeReliquary(w, w.player.x, w.player.y);
  assert.equal(w.result.reliquaries, 1, 'none left: no Reliquary');
  assert.equal(w.pickups.count, before, 'and nothing in its place (no Pearls: 0.8.2)');
  assert.deepEqual(eventsOf(w, EV.RELIC_POOL).map((e) => [e.a, e.b, e.c]), [[1, 1, 1]], 'said once: every relic in the pool found');
  void PK;
});

// ---------------------------------------------------------------- bosses

test('bosses: minFight is a floor: hits past the budget are cut and say so (HIT_CAPPED); past it and its gates, it dies', () => {
  const w = makeWorld({ invulnerable: true }, { events: [{ at: 0, event: 'boss', enemy: 'harbor_maw' }] });
  run(w, 1);
  const b = w.bosses[0], e = w.enemies.resolve(b.handle), max = w.enemies.maxHp[e];
  assert.equal(b.minFightTicks, Math.round(byId(DATA.bosses, 'harbor_maw').minFight * TPS));
  damageEnemy(w, e, 1e9, 0);
  const hits = eventsOf(w, EV.HIT);
  assert.equal(hits.length, 1);
  assert.ok((hits[0].c & HIT_CAPPED) !== 0, 'the HIT says the cap ate it');
  assert.ok(hits[0].a < max * 0.01, `only a sliver gets through (${hits[0].a})`);
  assert.ok(w.enemies.hp[e] > 0, 'alive');
  // Half the floor gone: at most half its health lost, whatever is thrown at it.
  let capped = 0;
  for (let t = 0; t < b.minFightTicks / 2; t++) {
    run(w, 1, IDLE, { halts: 'pass' });
    const i = w.enemies.resolve(b.handle);
    damageEnemy(w, i, max / 10, 0);
    capped += eventsOf(w, EV.HIT).filter((h) => h.c & HIT_CAPPED).length;
  }
  const i = w.enemies.resolve(b.handle);
  assert.ok(w.enemies.hp[i] >= max * 0.49 && w.enemies.hp[i] < max * 0.55, `about half left (${(w.enemies.hp[i] / max).toFixed(3)})`);
  assert.ok(capped > 0);
  // An ordinary hit within the budget is untouched.
  const f = makeWorld({ invulnerable: true }, { events: [{ at: 0, event: 'boss', enemy: 'harbor_maw' }] });
  run(f, 120, IDLE, { halts: 'pass' });
  const fe = f.enemies.resolve(f.bosses[0].handle);
  damageEnemy(f, fe, 10, 0);
  assert.deepEqual(eventsOf(f, EV.HIT).map((h) => [h.a, h.c]), [[10, 0]]);
  // Once its minFight has passed (and its phase gates are open: tests/fights.test.js) the budget is the whole of its health.
  pastGates(b);
  damageEnemy(w, w.enemies.resolve(b.handle), 1e9, 0);
  run(w, 1, IDLE, { halts: 'pass' });
  assert.equal(w.director.bossesAlive, 0, 'dead');
  // Every boss has both numbers.
  for (const bd of DATA.bosses) assert.ok(Number.isInteger(bd.level) && bd.minFight > 0, bd.id);
});

// ---------------------------------------------------------------- Lantern Night

test('lantern night: the burn grows with the minute the last lamp is lit', () => {
  const burnAt = (minute) => {
    const probe = makeWorld();
    const cx = Math.floor(probe.player.x / TILE), cy = Math.floor(probe.player.y / TILE);
    const w = makeWorld({ invulnerable: true }, { mapExtra: { tasks: [{ kind: 'lamp', at: [cx, cy] }] } });
    w.tick = Math.round(minute * 60 * TPS);
    const lamp = w.tasks[0];
    w.player.x = lamp.x; w.player.y = lamp.y;
    for (let k = 0; k < 60 * 60 && !w.night.banked; k++) run(w, 1, IDLE, { halts: 'pass' });
    crowdArrives(w, false);   // (banked: a muster sets it off)
    return w.night.burn;
  };
  const N = T.tasks.night, hp = makeWorld().tuning.pace.hp;   // (the test field's pace)
  assert.ok(Math.abs(burnAt(0) - N.burn * hp) < 0.05, 'at 0:00, its listed burn times the pace dial\'s health');
  const late = burnAt(12);
  assert.ok(Math.abs(late - N.burn * hp * (1 + N.burnPerMin * 12)) < N.burn * hp * N.burnPerMin * 0.2, `at 12:00 (${late})`);
});

// ---------------------------------------------------------------- overtime

test('overtime: repeating events on their clocks, a muster announced 5 s ahead, health 1.08 a minute, materials capped', () => {
  const ot = { densityPerMin: 1.12, hpPerMin: 1.08, materialsPerMin: 2, materialsCap: 3, repeat: [{ every: 20, event: 'elite', enemies: ['drowned_bosun', 'lantern_eater'] }, { every: 30, event: 'muster', name: 'Test Muster', enemy: 'drowned_bosun', escort: 'drowned_sailor', count: 6, radius: 36 }] };
  const w = makeWorld({ invulnerable: true }, { events: [], mapExtra: { overtime: ot } });
  w.halts.push({ kind: 'overtime' });
  decide(w, { kind: 'stay' });
  const start = w.tick;
  const elites = runCollect(w, 61 * TPS, EV.ELITE_SPAWN, IDLE, { halts: 'pass' });
  const at = (list) => list.map((e) => Math.round((e.tick + 1 - start) / TPS));
  // Elites at 20, 40, 60 (taken in turn), plus each muster's captain at 30 and 60.
  const types = elites.map((e) => DATA.enemies[e.a].id);
  assert.deepEqual(at(elites), [20, 30, 40, 60, 60]);
  assert.deepEqual(types, ['drowned_bosun', 'drowned_bosun', 'lantern_eater', 'drowned_bosun', 'drowned_bosun']);
  const w2 = makeWorld({ invulnerable: true }, { events: [], mapExtra: { overtime: ot } });
  w2.halts.push({ kind: 'overtime' });
  decide(w2, { kind: 'stay' });
  const s2 = w2.tick;
  const soon = runCollect(w2, 31 * TPS, EV.MUSTER_SOON, IDLE, { halts: 'pass' });
  assert.equal(soon.length, 1);
  assert.equal(soon[0].tick - s2, 30 * TPS - T.director.musterWarn * TPS, 'announced 300 ticks ahead');
  assert.deepEqual([soon[0].a, soon[0].b], [T.director.musterWarn, 1], 'seconds ahead, and which repeat');
  // The muster's c names its repeat: -1 - index.
  const w3 = makeWorld({ invulnerable: true }, { events: [], mapExtra: { overtime: ot } });
  w3.halts.push({ kind: 'overtime' });
  decide(w3, { kind: 'stay' });
  const m3 = runCollect(w3, 31 * TPS, EV.MUSTER, IDLE, { halts: 'pass' });
  assert.deepEqual(m3.map((m) => m.c), [-2]);
  // The minutes: health by 1.08, materials capped.
  run(w3, 4 * 60 * TPS, IDLE, { halts: 'pass' });
  assert.ok(Math.abs(w3.director.otHp - 1.08 ** w3.director.overtimeMinutes) < 1e-9);
  assert.equal(w3.director.otMaterialMul, 3, 'materials capped at 3 (2 a minute would be 16)');
});

// ---------------------------------------------------------------- Tides

test('tides: each from 2 adds a rule and keeps the ones below; Tide 2\'s elites come in pairs and only the first carries a chest', () => {
  assert.deepEqual(DATA.tides.filter((t) => t.level >= 2).map((t) => !!(t.rule && t.rule.desc)), DATA.tides.filter((t) => t.level >= 2).map(() => true), 'every Tide from 2 has a rule with words');
  assert.equal(DATA.tides[0].rule, undefined);
  const r1 = tideRulesFor(DATA.tides, 1), r2 = tideRulesFor(DATA.tides, 2), r10 = tideRulesFor(DATA.tides, 10);
  assert.equal(r1.elitePack, 1);
  assert.equal(r2.elitePack, 2);
  assert.equal(r2.healMul, 1, 'Tide 3\'s rule waits for Tide 3');
  assert.equal(tideRulesFor(DATA.tides, 3).healMul, 0.75);
  assert.equal(r10.elitePack, 3, 'threes from Tide 9');
  for (const k of ['healMul', 'swarmMul', 'bossTempo', 'musterMul', 'eliteSpeed', 'reliquaryGap', 'nightMul']) assert.notEqual(r10[k], 1, `${k} by Tide 10`);
  assert.throws(() => tideRulesFor([{ level: 2, rule: { healMul: 0 } }], 2), /must be a number above 0/);
  // A pair: two elites, the second marked, one chest between them.
  const w = makeWorld({ invulnerable: true, tide: 2 }, { events: [{ at: 1, event: 'elite', enemy: 'drowned_bosun' }] });
  run(w, TPS + 2);
  const elites = [];
  for (let i = 0; i < w.enemies.count; i++) if (w.enemies.flags[i] & EF.ELITE) elites.push(i);
  assert.equal(elites.length, 2);
  assert.deepEqual(elites.map((i) => w.enemies.boss[i]), [-1, NO_CHEST]);
  for (const i of elites) damageEnemy(w, i, 1e9, 0);
  run(w, 1, IDLE, { halts: 'pass' });
  const chests = [];
  for (let i = 0; i < w.pickups.count; i++) if (w.pickups.kind[i] === PK.CHEST) chests.push(i);
  assert.equal(chests.length, 1, 'one chest');
  // Tide 0: one elite.
  const z = makeWorld({ invulnerable: true }, { events: [{ at: 1, event: 'elite', enemy: 'drowned_bosun' }] });
  run(z, TPS + 2);
  let n = 0;
  for (let i = 0; i < z.enemies.count; i++) if (z.enemies.flags[i] & EF.ELITE) n++;
  assert.equal(n, 1);
});

test('tides: the later rules: weaker healing, bigger walls and rings, quicker bosses, bigger musters, faster elites, rarer Reliquaries, a shorter night', () => {
  const at10 = makeWorld({ invulnerable: true, tide: 10 }, { events: [{ at: 1, event: 'ring', enemy: 'fog_wisp', count: 20 }, { at: 1, event: 'muster', name: 'M', enemy: 'drowned_bosun', escort: 'drowned_sailor', count: 10, radius: 36 }] });
  const at0 = makeWorld({ invulnerable: true }, { events: [{ at: 1, event: 'ring', enemy: 'fog_wisp', count: 20 }, { at: 1, event: 'muster', name: 'M', enemy: 'drowned_bosun', escort: 'drowned_sailor', count: 10, radius: 36 }] });
  const R = at10.tideRules;
  const swarm10 = runCollect(at10, TPS + 2, EV.SWARM), swarm0 = runCollect(at0, TPS + 2, EV.SWARM);
  assert.equal(swarm10[0].b, Math.round(20 * R.swarmMul));
  assert.equal(swarm0[0].b, 20);
  const crew = (w) => { let n = 0; for (let i = 0; i < w.enemies.count; i++) if (w.enemies.type[i] === w.enemyIndex.get('drowned_sailor')) n++; return n; };
  assert.equal(crew(at10), Math.round(10 * R.musterMul));
  assert.equal(crew(at0), 10);
  // Healing.
  at10.player.hp = 10; at0.player.hp = 10;
  heal(at10, 20); heal(at0, 20);
  assert.equal(at10.player.hp, 10 + 20 * R.healMul);
  assert.equal(at0.player.hp, 30);
  // Elite speed.
  const el10 = spawnAt(at10, 'drowned_bosun', 200, 0, { elite: true }), el0 = spawnAt(at0, 'drowned_bosun', 200, 0, { elite: true });
  assert.ok(Math.abs(at10.enemies.speed[el10] / at0.enemies.speed[el0] - R.eliteSpeed * at10.enemySpeedMul / at0.enemySpeedMul) < 1e-6);
  // Bosses' waits.
  const b10 = makeWorld({ invulnerable: true, tide: 10 }, { events: [{ at: 0, event: 'boss', enemy: 'harbor_maw' }] });
  const b0 = makeWorld({ invulnerable: true }, { events: [{ at: 0, event: 'boss', enemy: 'harbor_maw' }] });
  run(b10, 1); run(b0, 1);
  assert.ok(Math.abs(b10.bosses[0].timer / b0.bosses[0].timer - R.bossTempo) < 1e-9);
  // Reliquaries: the gap and the count that makes one certain both grow.
  const due = (w, gapSec) => {
    w.reliquary.last = w.tick; w.reliquary.kills = T.relics.reliquaryPity - 1;
    w.tick += Math.ceil(gapSec * TPS) + 1;
    const before = w.result.reliquaries;
    maybeReliquary(w, w.player.x, w.player.y);
    return w.result.reliquaries - before;
  };
  assert.equal(due(at0, T.relics.reliquaryGap), 1, 'Tide 0: due after the gap and the count');
  assert.equal(due(at10, T.relics.reliquaryGap), 0, 'Tide 8 on: the gap is longer');
  assert.equal(due(at10, T.relics.reliquaryGap * R.reliquaryGap), 0, 'and the count that makes one certain too');
});

// ---------------------------------------------------------------- the Ferryman's Ember

function ferryAt(level = 1) {
  const probe = makeWorld();
  const cx = Math.floor(probe.player.x / TILE), cy = Math.floor(probe.player.y / TILE);
  return makeWorld({ invulnerable: true, harbor: { ferry: level } }, { mapExtra: { ferry: { at: [cx + 6, cy] } } });
}

test('ferry: the Ember costs more for each Form the weapon it\'s priced for holds; once bought it goes on any weapon (ruling 14)', () => {
  const w = ferryAt();
  give(w, 'flare_gun', { level: 3 });
  give(w, 'lantern_orb', { level: 3 });
  w.tick = w.ferry.nextCall;   // (his first call brings his first stock)
  run(w, 1);
  const P = T.ferry, ember = w.ferry.offers.findIndex((o) => o.kind === FERRY_KINDS.ember);
  assert.equal(emberPrice(w, 0), P.prices.ember);
  w.slots[0].ascensions = [w.ascensionLines.get('flare_gun').options[0]];
  w.slots[0].axes = 1;
  assert.equal(emberPrice(w, 0), P.prices.ember + P.emberPerForm, 'one Form held: dearer');
  assert.deepEqual(emberQuote(w), { slot: 1, price: P.prices.ember }, 'the cheapest is the Orb');
  w.glass = 1000;
  w.halts.push({ kind: 'ferry' });
  assert.throws(() => decide(w, { kind: 'buy', index: ember, slot: 5 }), /can't take another Form/);
  decide(w, { kind: 'buy', index: ember, slot: 0 });
  assert.equal(w.glass, 1000 - (P.prices.ember + P.emberPerForm), 'paid the Flare Gun\'s price');
  assert.equal(w.build.embers, 1);
  decide(w, { kind: 'done' });
  assert.equal(currentHalt(w).kind, 'ascend');
  assert.ok(optionChoices(w, 0).some((c) => c.cost === 'ember'), 'the Flare Gun can take it');
  assert.ok(optionChoices(w, 1).some((c) => c.cost === 'ember'), 'and so can the Orb: an Ember goes on any weapon');
  decide(w, { kind: 'ascend', slot: 1, id: w.ascensionLines.get('lantern_orb').options[0].id });
  assert.equal(w.build.embers, 0);
  assert.equal(w.slots[1].ascensions.length, 1);
});

// ---------------------------------------------------------------- numbers

test('numbers: the Lamplight 20 (ruling 14: it grows on its own track), Oil Flask pools twice its Damage every 0.3 s (ruling 17 W2: they grow with it), Corpse Candles 1.8 times faster and harder', () => {
  assert.equal(byId(DATA.weapons, 'lamplight').base.damage, 20);   // (C2's K2: 18 to 23; C2b, Ruling 24: 20)
  const pool = byId(DATA.weapons, 'oil_flask').pipeline.onHit.find((f) => f.type === 'zone');
  assert.deepEqual([pool.damageMul, pool.interval], [2, 0.3]);
  const c = byId(DATA.weapons, 'corpse_candles');
  assert.equal(c.pipeline.motion.speed, 126);
  assert.equal(c.base.damage, 20);   // (ruling 18 WB: 13 to 20, the weakest weapon alone at 20:00)
});

// ---------------------------------------------------------------- mastery perks reach the mechanic

test('characterParams: a mastery perk\'s numbers change the character\'s mechanic; a bad one is refused plainly', () => {
  const hit = (params) => {
    const w = createWorld({ seed: 3, map: 'drowned_docks', character: 'harpooner', invulnerable: true, densityCap: 0, ...(params ? { characterParams: params } : {}) }, DATA);
    const e = spawnAt(w, 'drowned_sailor', 30, 0);
    w.enemies.hp[e] = w.enemies.maxHp[e] = 1e6;
    let daze = 0;
    for (let k = 0; k < 240 && daze === 0; k++) { stepWorld(w, { mx: 0, my: 0, buttons: 0 }); daze = w.enemies.dazeT[e]; }
    return { daze, entry: w.hookEntries.find((h) => h.id === 'harpooner') };
  };
  const plain = hit(null), long = hit({ daze: 0.6, armorPerNear: 0.3, cap: 14 });
  assert.ok(Math.abs(plain.daze - 0.4) < 0.02, `0.4 s by default (${plain.daze})`);
  assert.ok(Math.abs(long.daze - 0.6) < 0.02, `Long Daze: 0.6 s (${long.daze})`);
  assert.equal(long.entry.params.cap, 14, 'Barnacle Hide');
  assert.equal(long.entry.params.nearRadius, DATA.characters.find((c) => c.id === 'harpooner').mechanic.params.nearRadius, 'what the perks leave alone stays');
  const lamp = createWorld({ seed: 3, map: 'drowned_docks', character: 'lamplighter', characterParams: { areaPerLevel: 0.035, damagePerLevel: 0.05 } }, DATA);
  assert.deepEqual([lamp.hookEntries[0].params.areaPerLevel, lamp.hookEntries[0].params.damagePerLevel], [0.035, 0.05], 'Wide Wick and Hot Wick');
  assert.throws(() => createWorld({ seed: 3, map: 'drowned_docks', character: 'harpooner', characterParams: { daze: 'long' } }, DATA), /characterParams\.daze must be a number/);
  assert.throws(() => createWorld({ seed: 3, map: 'drowned_docks', character: 'harpooner', characterParams: [1] }, DATA), /characterParams must be/);
});
