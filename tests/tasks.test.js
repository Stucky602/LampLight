// Phase 7 in a run (ARCHITECTURE §10.8): Wayside Lamps and Fog Bells, Lantern Night and its
// vault, Reliquaries and the relic pick, Sea Glass, the Ferryman; and what the harbor's gate sends
// into a run: a Tide, curses, an arcana, a rune stone, a kit, the bestiary's bonus, gear's hooks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, spawnAt, give, run, runCollect, DATA, IDLE } from './helpers/simworld.js';
import { createWorld, stepWorld, decide, currentHalt, hashWorld } from '../src/sim/world.js';
import { damageEnemy } from '../src/sim/enemies.js';
import { maybeReliquary, drawRelics, glassFor, FERRY_KINDS } from '../src/sim/relics.js';
import { hurtPlayer } from '../src/sim/player.js';
import { spawnGem, spawnPickup } from '../src/sim/pickups.js';
import { taskRadius, isNight } from '../src/sim/tasks.js';
import { EV } from '../src/sim/events.js';
import { TPS, PK, TASK, TASK_STATE, EF } from '../src/sim/constants.js';
import { TILE } from '../src/sim/terrain.js';
import { addRelic } from '../src/sim/build.js';

const T = DATA.tuning;
/** The tile the player stands on, offset by (dx, dy) tiles. */
const tileAt = (w, dx = 0, dy = 0) => [Math.floor(w.player.x / TILE) + dx, Math.floor(w.player.y / TILE) + dy];
/** A test field with tasks; the player at its middle. */
function field(tasks, config = {}) {
  const probe = makeWorld();
  const [cx, cy] = tileAt(probe);
  return makeWorld({ invulnerable: true, ...config }, { mapExtra: { tasks: tasks.map(([kind, dx, dy]) => ({ kind, at: [cx + dx, cy + dy] })) } });
}
const goTo = (w, x, y) => { w.player.x = x; w.player.y = y; };
const kill = (w, e) => { damageEnemy(w, e, 1e9, 0); };
const pickupsOf = (w, kind) => { const P = w.pickups, out = []; for (let i = 0; i < P.count; i++) if (P.kind[i] === kind) out.push(i); return out; };

// ---------------------------------------------------------------- Wayside Lamps

test('tasks: a Wayside Lamp lights only while you stand by it, waits when you leave, and gives Kindled, Sea Glass, and a look around', () => {
  const w = field([['lamp', 0, 0], ['lamp', 30, 0]]);
  const lamp = w.tasks[0];
  assert.equal(lamp.kind, TASK.LAMP);
  assert.equal(lamp.state, TASK_STATE.IDLE);
  goTo(w, lamp.x + 200, lamp.y);
  run(w, 60);
  assert.equal(lamp.state, TASK_STATE.IDLE, 'nothing moves from afar: no countdown, no timer');
  goTo(w, lamp.x, lamp.y);
  const started = runCollect(w, 1, EV.TASK);
  assert.deepEqual(started.map((e) => [e.a, e.b]), [[TASK.LAMP, 1]], 'it wakes when you step in');
  assert.ok(Math.abs(lamp.need - T.tasks.lamp.baseSec) < 0.01, `at 0:00 it takes ${T.tasks.lamp.baseSec}s`);
  run(w, TPS);   // a second by it
  goTo(w, lamp.x + 300, lamp.y);
  run(w, 10 * TPS);
  assert.ok(Math.abs(lamp.progress - 1 - 1 / TPS) < 0.02 && lamp.state === TASK_STATE.ACTIVE, `held where it was: ${lamp.progress}`);
  goTo(w, lamp.x, lamp.y);
  const done = runCollect(w, Math.ceil(TPS * lamp.need), EV.TASK).filter((e) => e.b === 2);
  assert.equal(done.length, 1, 'lit');
  assert.equal(lamp.state, TASK_STATE.DONE);
  assert.equal(w.kindled, 1);
  assert.equal(w.glass, lamp.glass, 'its Sea Glass');
  assert.equal(w.result.lampsLit, 1);
  assert.ok(w.mods.some((m) => m.stat === 'growth' && Math.abs(m.value - T.tasks.lamp.kindledXp) < 1e-9), 'Kindled: XP');
  assert.ok(w.mods.some((m) => m.stat === 'area' && Math.abs(m.value - T.tasks.lamp.kindledArea) < 1e-9), 'Kindled: Area');
  assert.ok(!isNight(w), 'one of two: no Lantern Night yet');
  // Standing by a lit one does nothing more.
  run(w, 2 * TPS);
  assert.equal(w.kindled, 1);
  // A second lamp: Kindled stacks.
  const second = w.tasks[1];
  goTo(w, second.x, second.y);
  run(w, Math.ceil(TPS * (T.tasks.lamp.baseSec + 0.5)), IDLE, { halts: 'pass' });
  assert.equal(w.kindled, 2);
  assert.ok(w.mods.some((m) => m.stat === 'growth' && Math.abs(m.value - 2 * T.tasks.lamp.kindledXp) < 1e-9), 'two stacks of XP');
});

test('tasks: one put off costs more and pays more, by the minute it starts', () => {
  const early = field([['lamp', 0, 0], ['bell', 0, 20]]);
  const late = field([['lamp', 0, 0], ['bell', 0, 20]]);
  late.tick = 10 * 60 * TPS;
  for (const w of [early, late]) { goTo(w, w.tasks[0].x, w.tasks[0].y); run(w, 1); goTo(w, w.tasks[1].x, w.tasks[1].y); run(w, 1); }
  const m = 10;   // (a tick or two past 10:00)
  assert.ok(Math.abs(late.tasks[0].need - (T.tasks.lamp.baseSec + T.tasks.lamp.perMinSec * m)) < 0.01);
  assert.equal(late.tasks[0].glass, Math.round(T.tasks.lamp.glass[0] + T.tasks.lamp.glass[1] * m));
  assert.equal(late.tasks[1].need, Math.round(T.tasks.bell.baseKills + T.tasks.bell.perMinKills * m));
  assert.ok(late.tasks[0].need > early.tasks[0].need && late.tasks[0].glass > early.tasks[0].glass);
  assert.ok(late.tasks[1].need > early.tasks[1].need && late.tasks[1].glass > early.tasks[1].glass);
  // The Lamp Post's levels light lamps faster.
  const quick = field([['lamp', 0, 0]], { harbor: { lampSpeed: 0.5 } });
  goTo(quick, quick.tasks[0].x, quick.tasks[0].y);
  run(quick, TPS);
  assert.ok(Math.abs(quick.tasks[0].progress - 1.5) < 0.05, `${quick.tasks[0].progress}`);
});

test('tasks: lighting every lamp brings Lantern Night: the light burns, a vault opens, and it ends', () => {
  const w = field([['lamp', 0, 0]]);
  const lamp = w.tasks[0];
  goTo(w, lamp.x, lamp.y);
  const nights = runCollect(w, Math.ceil(TPS * (T.tasks.lamp.baseSec + 0.2)), EV.NIGHT, IDLE, { halts: 'stop' });
  assert.deepEqual(nights.map((e) => e.a), [1]);
  assert.ok(isNight(w) && w.result.lanternNight);
  // The vault opens where the last lamp stood (here, at your feet: its pick comes up at once).
  run(w, 3, IDLE, { halts: 'stop' });
  assert.deepEqual([currentHalt(w)?.kind, currentHalt(w)?.source], ['relic', 'vault']);
  decide(w, { kind: 'pick', index: 0 });
  // The light burns what stands in it, every pulse.
  const e = spawnAt(w, 'drowned_sailor', 60, 0);
  w.enemies.speed[e] = 0; w.enemies.hp[e] = w.enemies.maxHp[e] = 1e6;
  const far = spawnAt(w, 'drowned_sailor', T.tasks.night.light + 120, 0);
  w.enemies.speed[far] = 0; w.enemies.hp[far] = w.enemies.maxHp[far] = 1e6;
  run(w, TPS);
  const pulses = Math.round(1 / T.tasks.night.every);
  assert.ok(1e6 - w.enemies.hp[e] >= T.tasks.night.burn * (pulses - 1), `burned ${1e6 - w.enemies.hp[e]}`);
  assert.equal(w.enemies.hp[far], 1e6, 'beyond the light: untouched');
  // It ends on time.
  const ends = runCollect(w, Math.ceil(T.tasks.night.sec * TPS), EV.NIGHT);
  assert.deepEqual(ends.map((x) => x.a), [0]);
  assert.ok(!isNight(w));
});

test('tasks: the vault offers three relics a tier better; a Reliquary offers three for the minute; the pick takes one', () => {
  const w = field([]);
  // At 0:00 a Reliquary's three are Trinkets (and a Charm or two at most).
  const tiers = (list) => list.map((r) => r.tier);
  for (let k = 0; k < 20; k++) assert.ok(tiers(drawRelics(w, 3)).every((t) => t <= 2));
  assert.ok(Array.from({ length: 20 }, () => drawRelics(w, 3, 1)).some((l) => l.some((r) => r.tier === 3)), 'a tier better: Relics turn up');
  // Walking onto a vault: a pick of three, none owned, none twice.
  addRelic(w, DATA.relics.find((r) => r.id === 'brass_button'));
  w.pickups.count = 0;
  const v = w.pickups.alloc();
  w.pickups.x[v] = w.pickups.px[v] = w.player.x; w.pickups.y[v] = w.pickups.py[v] = w.player.y; w.pickups.kind[v] = PK.VAULT;
  run(w, 2, IDLE, { halts: 'stop' });
  const h = currentHalt(w);
  assert.equal(h?.kind, 'relic');
  assert.equal(h.source, 'vault');
  assert.equal(h.offer.length, 3);
  assert.equal(new Set(h.offer).size, 3);
  assert.ok(!h.offer.includes('brass_button'), 'never one you carry');
  assert.throws(() => decide(w, { kind: 'ok' }), /expected "pick"/);
  assert.throws(() => decide(w, { kind: 'pick', index: 5 }), /no relic 5/);
  const want = h.offer[1];
  decide(w, { kind: 'pick', index: 1 });
  assert.equal(currentHalt(w), null);
  assert.ok(w.build.relics.some((r) => r.id === want));
  // Carrying every relic there is: Sea Glass instead, and no screen.
  for (const r of DATA.relics) if (!w.build.relics.includes(r)) addRelic(w, r);
  const g = w.glass;
  const r2 = w.pickups.alloc();
  w.pickups.x[r2] = w.pickups.px[r2] = w.player.x; w.pickups.y[r2] = w.pickups.py[r2] = w.player.y; w.pickups.kind[r2] = PK.RELIQUARY;
  run(w, 2, IDLE, { halts: 'stop' });
  assert.equal(currentHalt(w), null);
  assert.equal(w.glass, g + T.relics.emptyGlass);
});

test('tasks: a Fog Bell wakes when you walk in; kills inside its ring ring it, wherever you are; Sea Glass and a chest', () => {
  const w = field([['bell', 0, 0]]);
  const bell = w.tasks[0];
  // A kill in the ring before it's awake doesn't count.
  const e0 = spawnAt(w, 'fog_wisp', bell.x - w.player.x + 10, bell.y - w.player.y);
  goTo(w, bell.x + 400, bell.y);
  kill(w, e0); run(w, 1);
  assert.equal(bell.progress, 0);
  goTo(w, bell.x, bell.y);
  run(w, 1);
  assert.equal(bell.state, TASK_STATE.ACTIVE);
  assert.equal(bell.need, T.tasks.bell.baseKills);
  goTo(w, bell.x + 400, bell.y);   // walk away: it keeps counting kills in its ring
  const r = taskRadius(w, bell);
  for (let k = 0; k < bell.need - 1; k++) { const e = spawnAt(w, 'fog_wisp', bell.x - w.player.x + (k % 2 ? 1 : -1) * r * 0.5, bell.y - w.player.y); w.enemies.speed[e] = 0; kill(w, e); }
  const out = spawnAt(w, 'fog_wisp', bell.x - w.player.x + r + 30, bell.y - w.player.y);
  w.enemies.speed[out] = 0; kill(w, out);
  run(w, 1);
  assert.equal(bell.progress, bell.need - 1, 'one outside the ring didn\'t count');
  const last = spawnAt(w, 'fog_wisp', bell.x - w.player.x, bell.y - w.player.y);
  w.enemies.speed[last] = 0; kill(w, last);
  const rung = runCollect(w, 1, EV.TASK);
  assert.deepEqual(rung.map((x) => [x.a, x.b]), [[TASK.BELL, 2]]);
  assert.equal(bell.state, TASK_STATE.DONE);
  assert.equal(w.glass, bell.glass);
  assert.equal(w.result.bellsRung, 1);
  assert.equal(pickupsOf(w, PK.CHEST).length, 1, 'and a chest under it');
  // The Chapel widens the ring.
  const wide = field([['bell', 0, 0]], { harbor: { bellRing: 0.25 } });
  assert.equal(taskRadius(wide, wide.tasks[0]), T.tasks.bell.radius * 1.25);
});

// ---------------------------------------------------------------- Reliquaries and Sea Glass

test('relics: a Reliquary needs the gap since the last; the pity count makes one certain; never with nothing left to find', () => {
  const w = makeWorld({ invulnerable: true, tuning: { relics: { reliquaryChance: 0 } } });
  const n = () => pickupsOf(w, PK.RELIQUARY).length;
  for (let k = 0; k < T.relics.reliquaryPity - 1; k++) maybeReliquary(w, w.player.x, w.player.y);
  assert.equal(n(), 0, 'at chance 0, nothing before the pity count');
  maybeReliquary(w, w.player.x, w.player.y);
  assert.equal(n(), 1, 'the pity count: certain');
  assert.equal(w.result.reliquaries, 1);
  for (let k = 0; k < T.relics.reliquaryPity * 2; k++) maybeReliquary(w, w.player.x, w.player.y);
  assert.equal(n(), 1, 'inside the gap: none, however many kills');
  w.tick += T.relics.reliquaryGap * TPS;
  maybeReliquary(w, w.player.x, w.player.y);
  assert.equal(n(), 2, 'after the gap, the kills already counted');
  // At chance 1 after the gap, the first kill.
  const sure = makeWorld({ invulnerable: true, tuning: { relics: { reliquaryChance: 1 } } });
  maybeReliquary(sure, 0, 0);
  assert.equal(sure.result.reliquaries, 1);
  // Nothing left to find: Sea Glass where it would have dropped.
  const all = makeWorld({ invulnerable: true, tuning: { relics: { reliquaryChance: 1 } } });
  for (const r of DATA.relics) addRelic(all, r);
  maybeReliquary(all, all.player.x + 100, all.player.y);
  assert.equal(all.result.reliquaries, 0);
  assert.equal(pickupsOf(all, PK.RELIQUARY).length, 0);
  assert.deepEqual(pickupsOf(all, PK.GLASS).map((i) => all.pickups.a[i]), [T.relics.emptyGlass]);
  // Only ordinary kills count: an elite drops Sea Glass instead.
  const g = makeWorld({ invulnerable: true });
  assert.equal(glassFor(g, 0), 0);
  assert.equal(glassFor(g, EF.BOSS), T.glass.boss);
  for (let k = 0; k < 20; k++) { const v = glassFor(g, EF.ELITE); assert.ok(v >= T.glass.elite[0] && v <= T.glass.elite[1]); }
});

test('relics: Sea Glass from an elite flies to you; what was earned and the most held are on the result', () => {
  const w = makeWorld({ invulnerable: true });
  const e = spawnAt(w, 'drowned_sailor', 12, 0, { elite: true });
  w.enemies.speed[e] = 0;
  kill(w, e);
  run(w, 3 * TPS, IDLE, { halts: 'pass' });   // (its chest too)
  assert.ok(w.glass >= T.glass.elite[0] && w.glass <= T.glass.elite[1], `${w.glass}`);
  assert.equal(w.result.glassEarned, w.glass);
  assert.equal(w.result.glassMax, w.glass);
});

test('relics: what waits where it fell (a chest, a Reliquary, the vault) never lands where you can\'t stand; the nearest open tile is the nearest', () => {
  const w = makeWorld({ invulnerable: true }, { layout: { kind: 'open' } });
  const T = w.terrain;
  // Wall off a block of tiles beside you, then drop each kind into its middle.
  const [cx, cy] = tileAt(w, 6, 0);
  for (let y = cy - 2; y <= cy + 2; y++) for (let x = cx - 2; x <= cx + 2; x++) T.solid[y * T.cols + x] = 1;
  const mid = [(cx + 0.5) * TILE, (cy + 0.5) * TILE];
  for (const kind of [PK.CHEST, PK.RELIQUARY, PK.VAULT]) {
    const i = spawnPickup(w, kind, mid[0], mid[1], 1, 0);
    assert.ok(!T.blockedAt(w.pickups.x[i], w.pickups.y[i]), `kind ${kind} on open ground`);
    assert.ok(Math.hypot(w.pickups.x[i] - mid[0], w.pickups.y[i] - mid[1]) <= 3 * TILE, 'just past the block\'s edge');
  }
  // What flies to you anyway (a gem, Sea Glass) stays where it fell.
  const g = spawnPickup(w, PK.GLASS, mid[0], mid[1], 3, 0);
  assert.deepEqual([w.pickups.x[g], w.pickups.y[g]], mid);
  // Nearest by distance, not scan order: a tile straight out beats a corner of the same ring.
  const out = [0, 0];
  const t2 = makeWorld({}, { layout: { kind: 'open' } }).terrain;
  const [ox, oy] = [40, 40];
  for (let y = oy - 3; y <= oy + 3; y++) for (let x = ox - 3; x <= ox + 3; x++) t2.solid[y * t2.cols + x] = 1;
  t2.solid[(oy - 4) * t2.cols + (ox - 4)] = 0;   // (a corner of ring 4, open already)
  assert.ok(t2.nearestOpen(ox, oy, out));
  assert.equal(Math.hypot(out[0] / TILE - 0.5 - ox, out[1] / TILE - 0.5 - oy), 4, 'straight out, 4 tiles: not the corner');
  assert.equal(t2.nearestOpen(ox, oy, out, 3), false, 'none within the reach');
});

// ---------------------------------------------------------------- the Ferryman

function ferryWorld(level, config = {}) {
  const probe = makeWorld();
  const [cx, cy] = tileAt(probe);
  return makeWorld({ invulnerable: true, harbor: { ferry: level }, ...config }, { mapExtra: { ferry: { at: [cx + 6, cy] } } });
}

test('ferry: none without the Docks; his stock by the Docks\' level, turning over on its clock', () => {
  assert.equal(makeWorld({}, { mapExtra: { ferry: { at: [60, 60] } } }).ferry, null, 'no Docks, no Ferryman');
  assert.equal(makeWorld({ harbor: { ferry: 1 } }).ferry, null, 'a map without a mooring: no Ferryman');
  const one = ferryWorld(1);
  run(one, 1);
  const kinds = (w) => w.ferry.offers.map((o) => o.kind);
  assert.deepEqual(kinds(one), [FERRY_KINDS.relic, FERRY_KINDS.food, FERRY_KINDS.reroll, FERRY_KINDS.ember]);
  const P = T.ferry.prices;
  assert.deepEqual(one.ferry.offers.slice(1).map((o) => o.price), [P.food, P.reroll, P.ember]);
  const two = ferryWorld(2); run(two, 1);
  assert.equal(kinds(two).filter((k) => k === FERRY_KINDS.relic).length, 2, 'two relics from the Docks\' level 2');
  const three = ferryWorld(3); run(three, 1);
  assert.equal(three.ferry.offers.at(-1).price, Math.round(P.ember * (1 - T.ferry.discount)), 'cheaper from level 3');
  // A new stock every restockSec (faster from level 4).
  const ev = runCollect(one, T.ferry.restockSec * TPS + 2, EV.FERRY).filter((e) => e.a === 1);
  assert.deepEqual(ev.map((e) => e.b), [1]);
  const four = ferryWorld(4);
  const ev4 = runCollect(four, T.ferry.fastRestockSec * TPS + 2, EV.FERRY).filter((e) => e.a === 1);
  assert.deepEqual(ev4.map((e) => e.b), [0, 1]);
});

test('ferry: standing still by the skiff opens the trade once; buying spends Sea Glass; walk away and back for another', () => {
  const w = ferryWorld(2, { startGlass: 200 });
  const F = w.ferry;
  goTo(w, F.x, F.y);
  run(w, Math.ceil(T.ferry.standSec * TPS) - 2, IDLE, { halts: 'stop' });
  assert.equal(currentHalt(w), null, 'not before standSec');
  run(w, 4, IDLE, { halts: 'stop' });
  assert.equal(currentHalt(w)?.kind, 'ferry');
  const relic = F.offers[0];
  assert.throws(() => decide(w, { kind: 'pick', index: 0 }), /expected "buy" or "done"/);
  decide(w, { kind: 'buy', index: 0 });
  assert.equal(currentHalt(w)?.kind, 'ferry', 'a purchase keeps the trade open');
  assert.equal(w.glass, 200 - relic.price);
  assert.ok(w.build.relics.some((r) => r.id === relic.id));
  assert.throws(() => decide(w, { kind: 'buy', index: 0 }), /already bought/);
  const hp = w.player.hp = 10;
  decide(w, { kind: 'buy', index: 2 });   // food
  assert.ok(w.player.hp > hp);
  const rr = w.charges.reroll;
  decide(w, { kind: 'buy', index: 3 });
  assert.equal(w.charges.reroll, rr + 1);
  assert.equal(w.result.ferryBought, 3);
  decide(w, { kind: 'done' });
  run(w, 2 * TPS, IDLE, { halts: 'stop' });
  assert.equal(currentHalt(w), null, 'once: standing on doesn\'t reopen it');
  goTo(w, F.x + 200, F.y); run(w, 2);
  goTo(w, F.x, F.y); run(w, TPS, IDLE, { halts: 'stop' });
  assert.equal(currentHalt(w)?.kind, 'ferry', 'back again: open again');
  // What can't be bought is refused.
  const poor = ferryWorld(1);
  goTo(poor, poor.ferry.x, poor.ferry.y);
  run(poor, TPS, IDLE, { halts: 'stop' });
  assert.throws(() => decide(poor, { kind: 'buy', index: 3 }), /needs \d+ Sea Glass/);
  assert.throws(() => decide(poor, { kind: 'buy', index: 9 }), /no offer 9/);
});

// ---------------------------------------------------------------- what the gate sends into a run

test('run config: a Tide\'s and curses\' multipliers reach the enemies; Hunger drops no food', () => {
  const plain = makeWorld({ invulnerable: true });
  const hard = makeWorld({ invulnerable: true, hpMul: 1.5, enemySpeedMul: 1.2, enemyDamageMul: 1.3 });
  run(plain, 1); run(hard, 1);
  assert.ok(Math.abs(hard.director.bossHpMul / plain.director.bossHpMul - 1.5) < 1e-9, 'bosses too');
  const a = spawnAt(plain, 'drowned_sailor', 100, 0), b = spawnAt(hard, 'drowned_sailor', 100, 0);
  assert.ok(Math.abs(hard.enemies.maxHp[b] / plain.enemies.maxHp[a] - 1.5) < 1e-6, 'hp');
  assert.ok(Math.abs(hard.enemies.speed[b] / plain.enemies.speed[a] - 1.2) < 1e-6, 'speed');
  assert.equal(hard.enemyDamageMul, 1.3);
  assert.throws(() => makeWorld({ enemySpeedMul: 0 }), /enemySpeedMul must be a number above 0/);
  // Hunger: no food from anything.
  const fed = (noFood) => {
    const w = makeWorld({ invulnerable: true, noFood }, { mapExtra: { pickups: { heal: 1, magnet: 0, healAmount: 30 } } });
    for (let k = 0; k < 10; k++) { const e = spawnAt(w, 'fog_wisp', 80, k * 3); kill(w, e); }
    run(w, 2);
    return pickupsOf(w, PK.HEAL).length;
  };
  assert.equal(fed(false), 10, 'every kill drops food at chance 1');
  assert.equal(fed(true), 0, 'under Hunger, none');
});

test('run config: an arcana joins with its hook and its price; a rune stone halts at 0:00; a kit starts with its weapon', () => {
  for (const a of DATA.arcana) {
    const w = createWorld({ seed: 2, character: 'lamplighter', arcana: a.id }, DATA);
    assert.ok(w.hookEntries.some((h) => h.source === `arcana:${a.id}`), a.id);
    assert.equal(w.arcanaDef, a);
  }
  const glass = createWorld({ seed: 2, character: 'lamplighter', arcana: 'glassblower' }, DATA);
  const base = createWorld({ seed: 2, character: 'lamplighter' }, DATA);
  assert.ok(Math.abs(glass.stats.maxHp / base.stats.maxHp - 0.85) < 1e-6, 'its price');
  assert.equal(glass.relicTierBonus, 1);
  assert.throws(() => createWorld({ seed: 2, character: 'lamplighter', arcana: 'nope' }, DATA), /unknown arcana "nope"/);
  // A rune stone: the run starts on the rune's placement.
  const rune = createWorld({ seed: 2, character: 'lamplighter', startRune: 'splitting' }, DATA);
  assert.deepEqual([currentHalt(rune)?.kind, currentHalt(rune)?.rune], ['rune', 'splitting']);
  decide(rune, { kind: 'place', slot: 0 });
  assert.equal(rune.slots[0].runes[0].id, 'splitting');
  // A kit: the character's other start.
  const kit = DATA.kits[0];
  const k = createWorld({ seed: 2, character: kit.character, startWeapon: kit.start }, DATA);
  assert.equal(k.slots[0].def.id, kit.start);
  assert.throws(() => createWorld({ seed: 2, character: 'lamplighter', startWeapon: 'nope' }, DATA), /unknown weapon "nope"/);
  // Starting Sea Glass (the Glass Pouch).
  assert.equal(createWorld({ seed: 2, character: 'lamplighter', startGlass: 20 }, DATA).glass, 20);
});

test('run config: the bestiary\'s bonus hurts that enemy more; gear\'s hooks join and work', () => {
  const hit = (cfg) => {
    const w = makeWorld({ invulnerable: true, ...cfg });
    const e = spawnAt(w, 'fog_wisp', 50, 0);
    w.enemies.hp[e] = w.enemies.maxHp[e] = 1e6;
    damageEnemy(w, e, 100, 0);
    return 1e6 - w.enemies.hp[e];
  };
  assert.ok(Math.abs(hit({ bestiaryBonus: { fog_wisp: 0.06 } }) / hit({}) - 1.06) < 1e-6);
  assert.ok(Math.abs(hit({ bestiaryBonus: { drowned_sailor: 0.06 } }) / hit({}) - 1) < 1e-6, 'only that enemy');
  // Oil Wake: a dash leaves burning ground behind.
  const wake = DATA.affixes.find((a) => a.id === 'oil_wake');
  const w = makeWorld({ invulnerable: true, gearHooks: [{ hook: wake.hook, params: wake.params, affix: wake.id }] });
  assert.ok(w.hookEntries.some((h) => h.source === 'gear:oil_wake'));
  const zones0 = w.zones.count;
  run(w, 1, { mx: 127, my: 0, buttons: 1 });
  run(w, 12, { mx: 127, my: 0, buttons: 0 });
  assert.ok(w.zones.count - zones0 >= 2, `pools along the dash: ${w.zones.count - zones0}`);
  // Tide Pulse: a level-up sends out a wave.
  const pulse = DATA.affixes.find((a) => a.id === 'tide_pulse');
  const p = makeWorld({ invulnerable: true, gearHooks: [{ hook: pulse.hook, params: pulse.params, affix: pulse.id }] });
  p.player.xp = p.player.xpNext;
  const waves = runCollect(p, 1, EV.WAVE, IDLE, { halts: 'pass' });
  assert.equal(waves.length, 1);
  assert.throws(() => makeWorld({ gearHooks: [{ hook: 'dash_trail', params: { radius: 'x' } }] }), /must be a number/);
  assert.throws(() => makeWorld({ gearHooks: [{ hook: 'nope', params: {} }] }), /Unknown hook "nope"/);
});

// ---------------------------------------------------------------- what relics offer, and when

test('relics: what\'s offered by the minute: Trinkets early, Relics late; never a stronger tier early when the weak ones run out', () => {
  const share = (minute, bonus = 0) => {
    const w = makeWorld({ invulnerable: true });
    w.tick = minute * 60 * TPS;
    const n = [0, 0, 0, 0];
    for (let k = 0; k < 300; k++) n[drawRelics(w, 1, bonus)[0].tier]++;
    return n.map((x) => x / 300);
  };
  const at0 = share(0), at5 = share(5), at10 = share(10), at15 = share(15);
  assert.equal(at0[3], 0, '0:00: no Relics');
  assert.ok(at0[1] > 0.7, `0:00: mostly Trinkets (${at0[1]})`);
  assert.ok(at5[3] > 0 && at5[3] < at10[3] && at10[3] < at15[3], `Relics grow: ${at5[3]}, ${at10[3]}, ${at15[3]}`);
  assert.ok(at15[3] > at15[1], '15:00: more Relics than Trinkets');
  // Only Relics left at 1:00: offered anyway, but only if nothing weaker is left.
  const w = makeWorld({ invulnerable: true });
  for (const r of DATA.relics.filter((x) => x.tier < 3)) addRelic(w, r);
  assert.ok(drawRelics(w, 3).every((r) => r.tier === 3));
  const w2 = makeWorld({ invulnerable: true });
  for (const r of DATA.relics.filter((x) => x.tier === 1)) addRelic(w2, r);
  assert.ok(drawRelics(w2, 2).every((r) => r.tier === 2), 'Charms before Relics, at 0:00');
});

test('ferry: each stock a little better, the Docks\' level 5 better again from the second; the Ember bought is an Ember', () => {
  const tiersOf = (level, stock) => {
    const n = [0, 0, 0, 0];
    for (let seed = 1; seed <= 40; seed++) {
      const w = ferryWorld(level, { seed });
      w.tick = Math.round(stock * (level >= 4 ? T.ferry.fastRestockSec : T.ferry.restockSec) * TPS);
      run(w, 1);
      for (const o of w.ferry.offers) if (o.kind === FERRY_KINDS.relic) n[DATA.relics.find((r) => r.id === o.id).tier]++;
    }
    return n;
  };
  const s0 = tiersOf(1, 0), s2 = tiersOf(1, 2);
  assert.equal(s0[3], 0, 'the opening stock: no Relics');
  assert.ok(s2[3] > s0[3] && s2[1] < s0[1], `later stocks: better (${s0} then ${s2})`);
  assert.equal(tiersOf(5, 0)[3], 0, 'level 5 opens like the rest');
  assert.ok(tiersOf(5, 1)[3] > tiersOf(4, 1)[3], 'then a tier better');
  // The Ember: a pick for the Ascend screen.
  const w = ferryWorld(1, { startGlass: 200 });
  give(w, 'flare_gun');
  goTo(w, w.ferry.x, w.ferry.y);
  run(w, TPS, IDLE, { halts: 'stop' });
  decide(w, { kind: 'buy', index: 3 });
  decide(w, { kind: 'done' });
  assert.equal(w.glass, 200 - T.ferry.prices.ember);
  run(w, 1, IDLE, { halts: 'stop' });
  assert.equal(currentHalt(w)?.kind, 'ascend', 'its Ember opens the Ascend screen');
  // A relic already carried (found since he stocked it) can't be bought twice.
  const c = ferryWorld(1, { startGlass: 200 });
  goTo(c, c.ferry.x, c.ferry.y);
  run(c, TPS, IDLE, { halts: 'stop' });
  addRelic(c, DATA.relics.find((r) => r.id === c.ferry.offers[0].id));
  assert.throws(() => decide(c, { kind: 'buy', index: 0 }), /already carried/);
});

// ---------------------------------------------------------------- the relics' and arcana's rules

const withRelic = (id, config = {}) => { const w = makeWorld({ ...config }); addRelic(w, DATA.relics.find((r) => r.id === id)); return w; };
const tough = (w, dx, dy = 0) => { const e = spawnAt(w, 'drowned_sailor', dx, dy); w.enemies.speed[e] = 0; w.enemies.hp[e] = w.enemies.maxHp[e] = 1e6; return e; };

test('relics: Spark Flint bursts where a dash starts; Barnacle Shell answers a hit, once a cooldown, shielded or not', () => {
  const w = withRelic('spark_flint', { invulnerable: true });
  const near = tough(w, -20), far = tough(w, -200);
  const bursts = runCollect(w, 2, EV.EXPLODE, { mx: 127, my: 0, buttons: 1 });
  assert.equal(bursts.length, 1);
  assert.ok(w.enemies.hp[near] < 1e6 && w.enemies.hp[far] === 1e6, 'what stood by the start, only');
  run(w, 2, { mx: 127, my: 0, buttons: 1 });   // held, not a new dash
  assert.equal(runCollect(w, 2, EV.EXPLODE).length, 0);
  // Barnacle Shell.
  const b = withRelic('barnacle_shell');
  const e = tough(b, 60);
  run(b, 1);   // (into the enemy grid)
  const P = DATA.relics.find((r) => r.id === 'barnacle_shell').params;
  b.player.iframes = 0;
  hurtPlayer(b, 5, b.player.x, b.player.y);
  assert.ok(b.enemies.hp[e] < 1e6, 'the wave hit');
  const after = b.enemies.hp[e];
  b.player.iframes = 0;
  hurtPlayer(b, 5, b.player.x, b.player.y);
  assert.equal(b.enemies.hp[e], after, 'within the cooldown: no wave');
  b.tick += P.cooldown * TPS;
  b.player.iframes = 0;
  b.player.shield = 1e3;   // a shield takes the whole hit: still a hit taken
  hurtPlayer(b, 5, b.player.x, b.player.y);
  assert.ok(b.enemies.hp[e] < after);
});

test('relics: Bloodied Hook: enough kills in the window and Damage rises, then falls; Drowned Bell tolls every Nth kill', () => {
  const P = DATA.relics.find((r) => r.id === 'bloodied_hook').params;
  const w = withRelic('bloodied_hook', { invulnerable: true });
  const fury = () => w.mods.some((m) => m.stat === 'might' && m.value === P.damage);
  for (let k = 0; k < P.kills - 1; k++) { const e = spawnAt(w, 'fog_wisp', 200, k); kill(w, e); }
  run(w, 1);
  assert.ok(!fury(), 'one short');
  kill(w, spawnAt(w, 'fog_wisp', 200, 0));
  run(w, 2);
  assert.ok(fury(), 'the streak');
  run(w, P.duration * TPS);
  assert.ok(!fury(), 'and it ends');
  // Kills spread past the window never add up.
  const slow = withRelic('bloodied_hook', { invulnerable: true });
  for (let k = 0; k < P.kills * 2; k++) { kill(slow, spawnAt(slow, 'fog_wisp', 200, 0)); run(slow, Math.ceil((P.within * TPS) / P.kills) + 2); }
  assert.ok(!slow.mods.some((m) => m.stat === 'might' && m.value === P.damage), 'too slow');
  // Drowned Bell.
  const D = DATA.relics.find((r) => r.id === 'drowned_bell').params;
  const b = withRelic('drowned_bell', { invulnerable: true });
  const e = tough(b, 80);
  let tolls = 0;
  for (let k = 0; k < D.every * 2; k++) { kill(b, spawnAt(b, 'fog_wisp', 300, 0)); tolls += runCollect(b, 1, EV.WAVE).length; }
  assert.equal(tolls, 2);
  assert.ok(b.enemies.hp[e] < 1e6);
});

test('arcana: High Water pulls every gem in; Brine heals on Tide kills, capped a second; Kindling doubles elites\' Embers', () => {
  const hw = DATA.arcana.find((a) => a.id === 'high_water');
  const w = makeWorld({ invulnerable: true, arcana: 'high_water' }, {});
  w.player.xpNext = 1e9;
  spawnGem(w, w.player.x + 600, w.player.y, 1);
  run(w, (hw.params.every - 1) * TPS);
  assert.equal(w.gems.count, 1, 'not before its time');
  run(w, 4 * TPS);
  assert.equal(w.gems.count, 0, 'then every gem flies in');
  // Brine.
  const br = makeWorld({ arcana: 'brine' });
  give(br, 'tide_bell');
  give(br, 'flare_gun');
  const BP = DATA.arcana.find((a) => a.id === 'brine').params;
  br.player.hp = 10;
  for (let k = 0; k < BP.perSecond + 5; k++) damageEnemy(br, spawnAt(br, 'fog_wisp', 200, k), 1e9, 0);
  run(br, 1);
  const capped = 10 + BP.heal * BP.perSecond;
  assert.equal(br.player.hp, capped, 'its cap a second at most');
  for (let k = 0; k < 3; k++) damageEnemy(br, spawnAt(br, 'fog_wisp', 200, k), 1e9, 1);
  run(br, 1);
  assert.equal(br.player.hp, capped, 'not a Fire weapon\'s kills');
  run(br, TPS);
  damageEnemy(br, spawnAt(br, 'fog_wisp', 200, 0), 1e9, 0);
  run(br, 1);
  assert.equal(br.player.hp, capped + BP.heal, 'the next second');
  // Kindling.
  const embers = (arcana) => {
    let n = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const k = makeWorld({ seed, invulnerable: true, arcana, tuning: { embers: { eliteChance: 0.5 } } });
      give(k, 'flare_gun');
      const e = spawnAt(k, 'drowned_sailor', 300, 0, { elite: true });
      k.enemies.speed[e] = 0; kill(k, e);
      run(k, 1, IDLE, { halts: 'pass' });
      n += pickupsOf(k, PK.EMBER).length;
    }
    return n;
  };
  assert.equal(embers('kindling'), 20, 'at chance 1');
  assert.ok(embers(undefined) < 20);
  assert.equal(makeWorld({ arcana: 'kindling' }).emberBossExtra, 1, 'and a boss drops 2');
});

// ---------------------------------------------------------------- replays

test('tasks: a run with lamps, a bell, the Ferryman, and a Reliquary replays to the same state', () => {
  const play = () => {
    const w = createWorld({ seed: 77, character: 'lamplighter', invulnerable: true, harbor: { ferry: 3 }, startGlass: 120, tuning: { relics: { reliquaryChance: 0.05 } } }, DATA);
    // Walk to the first lamp and light it, then to the skiff and stand there (the input is a
    // function of the state, so both plays steer the same).
    const steer = (tx, ty) => {
      const dx = tx - w.player.x, dy = ty - w.player.y, d = Math.hypot(dx, dy);
      return d < 6 ? IDLE : { mx: Math.round((127 * dx) / d), my: Math.round((127 * dy) / d), buttons: 0 };
    };
    const frames = { length: 3600, at: () => (w.tasks[0].state !== TASK_STATE.DONE ? steer(w.tasks[0].x, w.tasks[0].y) : steer(w.ferry.x, w.ferry.y)) };
    for (let k = 0; k < frames.length; k++) {
      let g = 0;
      while (currentHalt(w) && g++ < 20) {
        const h = currentHalt(w);
        if (h.kind === 'relic') decide(w, { kind: 'pick', index: 0 });
        else if (h.kind === 'ferry') { const i = w.ferry.offers.findIndex((o) => !o.sold && o.price <= w.glass && o.kind !== FERRY_KINDS.relic); decide(w, i >= 0 ? { kind: 'buy', index: i } : { kind: 'done' }); }
        else if (h.kind === 'draft') decide(w, { kind: 'pick', index: 0 });
        else if (h.kind === 'chest') decide(w, { kind: 'ok' });
        else if (h.kind === 'rune') decide(w, { kind: 'discard' });
        else if (h.kind === 'ascend') decide(w, { kind: 'keep' });
        else decide(w, { kind: 'leave' });
      }
      stepWorld(w, frames.at());
    }
    return w;
  };
  const a = play(), b = play();
  assert.equal(hashWorld(a), hashWorld(b));
  const r = a.result;
  assert.ok(r.lampsLit >= 1 && r.ferryBought >= 1 && r.reliquaries >= 1, `each happened: ${JSON.stringify({ r: r.reliquaries, f: r.ferryBought, l: r.lampsLit })}`);
});
