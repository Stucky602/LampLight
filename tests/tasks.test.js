// Phase 7 in a run (ARCHITECTURE §10.8), as 0.8.2 reworked it (§5.18): Wayside Lamps that light
// into wards, Lantern Night banked for the crowd and its vault ahead of you, the fog taking the
// lamps back at a boss, Fog Bells that call their crew and pay a pick, Reliquaries and the relic
// pool, Pearls, the Ferryman on his schedule; and what the harbor's gate sends into a run: a Tide,
// curses, an arcana, a rune stone, a kit, the bestiary's bonus, gear's hooks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, spawnAt, give, givePassive, run, runCollect, eventsOf, DATA, IDLE } from './helpers/simworld.js';
import { createWorld, stepWorld, decide, currentHalt, hashWorld, buildRunResult } from '../src/sim/world.js';
import { damageEnemy } from '../src/sim/enemies.js';
import { maybeReliquary, drawRelics, glassFor, relicPool, FERRY_KINDS } from '../src/sim/relics.js';
import { hurtPlayer } from '../src/sim/player.js';
import { spawnGem, spawnPickup } from '../src/sim/pickups.js';
import { taskRadius, isNight, nightBanked, ward, crowdArrives, mapHolds, runLedger } from '../src/sim/tasks.js';
import { collectRings, collectArrows, rewardOf, RING, ARROW, REWARD } from '../src/sim/signs.js';
import { CHEST_BELL } from '../src/sim/chests.js';
import { EV } from '../src/sim/events.js';
import { TPS, PK, TASK, TASK_STATE, EF } from '../src/sim/constants.js';
import { TILE } from '../src/sim/terrain.js';
import { addRelic } from '../src/sim/build.js';

const T = DATA.tuning;
/** The tile the player stands on, offset by (dx, dy) tiles. */
const tileAt = (w, dx = 0, dy = 0) => [Math.floor(w.player.x / TILE) + dx, Math.floor(w.player.y / TILE) + dy];
/** A test field with tasks; the player at its middle. With the Docks (config.harbor.ferry), a mooring 30 tiles east. */
function field(tasks, config = {}) {
  const probe = makeWorld();
  const [cx, cy] = tileAt(probe);
  const ferry = config.harbor?.ferry ? { ferry: { at: [cx + 30, cy] } } : {};
  return makeWorld({ invulnerable: true, ...config }, { mapExtra: { tasks: tasks.map(([kind, dx, dy]) => ({ kind, at: [cx + dx, cy + dy] })), ...ferry } });
}
const goTo = (w, x, y) => { w.player.x = x; w.player.y = y; };
const kill = (w, e) => { damageEnemy(w, e, 1e9, 0); };
const pickupsOf = (w, kind) => { const P = w.pickups, out = []; for (let i = 0; i < P.count; i++) if (P.kind[i] === kind) out.push(i); return out; };
/** An enemy that stands still and won't die of a stray hit. */
const post = (w, id, x, y, opts = null) => { const e = spawnAt(w, id, x - w.player.x, y - w.player.y, opts); w.enemies.speed[e] = 0; return e; };
/** Stand in a bell's start ring until it tolls. */
const toll = (w, bell) => { goTo(w, bell.x, bell.y); return runCollect(w, Math.ceil(T.tasks.bell.openSec * TPS) + 1, EV.TASK, IDLE, { halts: 'pass' }); };

// ---------------------------------------------------------------- Wayside Lamps and their wards

test('tasks: a Wayside Lamp lights only while you stay in its ring, waits when you leave, and lights into a ward with Pearls', () => {
  const w = field([['lamp', 0, 0], ['lamp', 30, 0]], { harbor: { ferry: 1 } });
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
  for (let k = 0; k < TPS; k++) stepWorld(w, { mx: k % 12 < 6 ? 127 : -127, my: 0, buttons: 0 });   // a second in it, walking: moving is fine
  goTo(w, lamp.x + 300, lamp.y);
  run(w, 10 * TPS);
  assert.ok(Math.abs(lamp.progress - 1 - 1 / TPS) < 0.02 && lamp.state === TASK_STATE.ACTIVE, `held where it was: ${lamp.progress}`);
  goTo(w, lamp.x, lamp.y);
  const done = runCollect(w, Math.ceil(TPS * lamp.need), EV.TASK).filter((e) => e.b === 2);
  assert.equal(done.length, 1, 'lit');
  assert.equal(lamp.state, TASK_STATE.DONE);
  assert.equal(w.glass, lamp.glass, 'its Pearls');
  assert.ok(lamp.glass > 0);
  assert.equal(w.result.lampsLit, 1);
  assert.ok(!w.mods.some((m) => m.stat === 'growth' || m.stat === 'area'), 'no Kindled (0.8.2): a lamp is a ward');
  assert.equal(ward(w, 0), T.tasks.ward.radius);
  assert.ok(!isNight(w) && !nightBanked(w), 'one of two: no Lantern Night yet');
  // A second lamp: the most lit at once.
  const second = w.tasks[1];
  goTo(w, second.x, second.y);
  run(w, Math.ceil(TPS * (T.tasks.lamp.baseSec + 0.5)), IDLE, { halts: 'pass' });
  assert.equal(w.result.lampsMost, 2);
  // Without the Ferryman, a lamp pays no Pearls (none drop before the Docks).
  const bare = field([['lamp', 0, 0]]);
  goTo(bare, bare.tasks[0].x, bare.tasks[0].y);
  run(bare, Math.ceil(TPS * (T.tasks.lamp.baseSec + 0.5)), IDLE, { halts: 'pass' });
  assert.equal(bare.tasks[0].state, TASK_STATE.DONE);
  assert.deepEqual([bare.tasks[0].glass, bare.glass], [0, 0]);
});

test('tasks: a lit lamp\'s ward burns what stands in it: an ordinary enemy in about killSec, an elite at its share; nothing outside', () => {
  const w = field([['lamp', 0, 0]]);
  const lamp = w.tasks[0];
  goTo(w, lamp.x, lamp.y);
  run(w, Math.ceil(TPS * (T.tasks.lamp.baseSec + 0.2)), IDLE, { halts: 'pass' });
  goTo(w, lamp.x + 600, lamp.y);   // (you away: the ward burns on its own)
  const W = T.tasks.ward;
  const e = post(w, 'drowned_sailor', lamp.x + W.radius * 0.6, lamp.y);
  const elite = post(w, 'drowned_sailor', lamp.x - W.radius * 0.6, lamp.y, { elite: true });
  const out = post(w, 'drowned_sailor', lamp.x, lamp.y + W.radius + 20);
  const max = w.enemies.maxHp[e], eliteMax = w.enemies.maxHp[elite];
  run(w, TPS, IDLE, { halts: 'pass' });
  const lost = max - w.enemies.hp[e];
  assert.ok(lost >= max * (1 / W.killSec) * 0.9 && lost <= max * (1 / W.killSec) * 1.6, `a second: ${(lost / max).toFixed(3)} of its health`);
  const eliteLost = (eliteMax - w.enemies.hp[w.enemies.resolve(w.enemies.handle(elite))]) / eliteMax;
  assert.ok(Math.abs(eliteLost - (lost / max) * W.eliteShare) < 0.01, `an elite at its share: ${eliteLost.toFixed(4)}`);
  assert.equal(w.enemies.hp[out], w.enemies.maxHp[out], 'outside the light: untouched');
  const killed = runCollect(w, Math.ceil((W.killSec + 0.5) * TPS), EV.KILL, IDLE, { halts: 'pass' });
  assert.ok(killed.length >= 1, 'the ordinary one died in its light');
  // What drops in a lit lamp's light is marked: the lamp watches the ground.
  w.events.clear();
  spawnPickup(w, PK.CHEST, lamp.x + 10, lamp.y, 1, 0);
  spawnPickup(w, PK.CHEST, lamp.x + 400, lamp.y, 1, 0);
  assert.deepEqual(eventsOf(w, EV.DROP).map((d) => [d.a, d.b]), [[PK.CHEST, 1], [PK.CHEST, 0]]);
});

test('tasks: one put off costs more and pays more, by the minute it starts', () => {
  const early = field([['lamp', 0, 0], ['bell', 0, 20]], { harbor: { ferry: 1 } });
  const late = field([['lamp', 0, 0], ['bell', 0, 20]], { harbor: { ferry: 1 } });
  late.tick = 10 * 60 * TPS;
  late.ferry.nextCall = 1e9; early.ferry.nextCall = 1e9;   // (the Ferryman stays away)
  for (const w of [early, late]) { goTo(w, w.tasks[0].x, w.tasks[0].y); run(w, 1); toll(w, w.tasks[1]); }
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

// ---------------------------------------------------------------- Lantern Night

test('tasks: every lamp lit banks Lantern Night; it falls when the crowd closes in; it burns, ends, and the vault drops ahead of you', () => {
  const w = field([['lamp', 0, 0]]);
  const lamp = w.tasks[0];
  goTo(w, lamp.x, lamp.y);
  const banked = runCollect(w, Math.ceil(TPS * (T.tasks.lamp.baseSec + 0.2)), EV.NIGHT, IDLE, { halts: 'stop' });
  assert.deepEqual(banked.map((e) => e.a), [2], 'banked');
  assert.ok(nightBanked(w) && !isNight(w), 'it waits');
  run(w, 2 * TPS);
  assert.ok(!isNight(w), 'an empty screen: still waiting');
  // The crowd: enough enemies close enough.
  const N = T.tasks.night;
  for (let k = 0; k < N.crowd; k++) { const e = spawnAt(w, 'drowned_sailor', 40 + (k % 5) * 12, -40 + Math.floor(k / 5) * 20); w.enemies.speed[e] = 0; w.enemies.hp[e] = w.enemies.maxHp[e] = 1e6; }
  const falls = runCollect(w, 8, EV.NIGHT, IDLE, { halts: 'stop' });
  assert.deepEqual(falls.map((e) => [e.a, e.b, e.c]), [[1, 1, 1]], 'it falls on the crowd');
  assert.ok(isNight(w) && !nightBanked(w) && w.result.lanternNight);
  assert.equal(pickupsOf(w, PK.VAULT).length, 0, 'no vault yet: it comes at the end');
  // The light burns what stands in it, every pulse.
  const e = spawnAt(w, 'drowned_sailor', 60, 0);
  w.enemies.speed[e] = 0; w.enemies.hp[e] = w.enemies.maxHp[e] = 1e6;
  const far = spawnAt(w, 'drowned_sailor', N.light + 120, 0);
  w.enemies.speed[far] = 0; w.enemies.hp[far] = w.enemies.maxHp[far] = 1e6;
  run(w, TPS);
  const pulses = Math.round(1 / N.every);
  assert.ok(1e6 - w.enemies.hp[e] >= w.night.burn * (pulses - 1), `burned ${1e6 - w.enemies.hp[e]}`);
  assert.ok(Math.abs(w.night.burn - N.burn * w.tuning.pace.hp) < N.burn * 0.02, 'its burn: the tuning\'s times the pace dial\'s health (near 0:00)');
  assert.equal(w.enemies.hp[far], 1e6, 'beyond the light: untouched');
  // It ends on time; the vault drops a moment later, ahead of you.
  w.player.fx = 0; w.player.fy = 1;
  const ends = [];
  for (let k = 0; k < N.sec * TPS && isNight(w); k++) { stepWorld(w, IDLE); ends.push(...eventsOf(w, EV.NIGHT)); }
  assert.deepEqual(ends.map((x) => x.a), [0]);
  assert.ok(!isNight(w));
  const drops = runCollect(w, Math.ceil(N.vaultDelay * TPS) + 1, EV.DROP, IDLE, { halts: 'stop' });
  assert.deepEqual(drops.map((d) => d.a), [PK.VAULT]);
  assert.ok(Math.abs(drops[0].x - w.player.x) < 2 && Math.abs(drops[0].y - w.player.y - N.vaultAhead) < TILE, `ahead of you: ${drops[0].x - w.player.x}, ${drops[0].y - w.player.y}`);
  // A muster or a boss arriving sets a banked night off too.
  const m = field([['lamp', 0, 0]]);
  goTo(m, m.tasks[0].x, m.tasks[0].y);
  run(m, Math.ceil(TPS * (T.tasks.lamp.baseSec + 0.2)), IDLE, { halts: 'stop' });
  m.events.clear();
  crowdArrives(m, false);
  assert.deepEqual(eventsOf(m, EV.NIGHT).map((x) => [x.a, x.b]), [[1, 2]]);
});

test('tasks: lamps stay lit when a boss comes (ruling 6); on a map in acts its first boss begins act 2 with new lamps', () => {
  const w = field([['lamp', 0, 0], ['lamp', 30, 0]], { harbor: { ferry: 1 } });
  w.ferry.nextCall = 1e9;
  for (const t of w.tasks) { goTo(w, t.x, t.y); run(w, Math.ceil(TPS * (T.tasks.lamp.baseSec + 0.2)), IDLE, { halts: 'pass' }); }
  crowdArrives(w, false);   // (the first night falls)
  run(w, Math.ceil((T.tasks.night.sec + 2) * TPS), IDLE, { halts: 'pass' });
  assert.equal(w.night.count, 1);
  w.tick = 10 * 60 * TPS;
  crowdArrives(w, true);    // the 10:00 boss
  const outs = runCollect(w, 3 * TPS, EV.TASK, IDLE, { halts: 'pass' }).filter((e) => e.b === 3);
  assert.equal(outs.length, 0, 'none goes out');
  assert.ok(w.tasks.every((t) => t.state === TASK_STATE.DONE) && ward(w, 0) === T.tasks.ward.radius, 'still lit, still wards');
  // The Docks: the first boss's arrival is act 2, with its own lamps at new sites.
  const d = createWorld({ seed: 3, character: 'lamplighter', invulnerable: true }, DATA);
  const docks = DATA.maps.find((m) => m.id === 'drowned_docks');
  const act1 = d.tasks.filter((t) => t.kind === TASK.LAMP);
  assert.equal(act1.length, docks.acts[0].lamps);
  assert.equal(d.acts.act, 1);
  for (const t of act1) t.state = TASK_STATE.DONE;
  crowdArrives(d, true);
  assert.equal(d.acts.act, 2);
  const lamps = d.tasks.filter((t) => t.kind === TASK.LAMP);
  assert.equal(lamps.length, docks.acts[0].lamps + docks.acts[1].lamps);
  assert.ok(act1.every((t) => t.state === TASK_STATE.DONE), 'act 1\'s stay lit');
  const key = (t) => `${Math.round(t.x)},${Math.round(t.y)}`;
  assert.equal(new Set(lamps.map(key)).size, lamps.length, 'every lamp at its own place');
  crowdArrives(d, true);
  assert.equal(d.acts.act, 2, 'the last boss begins nothing (act 3 is overtime)');
});

// ---------------------------------------------------------------- the vault and the relic pick

test('tasks: the vault offers three relics a tier better; a Reliquary offers three for the minute; the pick takes one; an empty vault gives an Ember', () => {
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
  // Every relic carried: a vault gives an Ember instead, and says so.
  for (const r of DATA.relics) if (!w.build.relics.includes(r)) addRelic(w, r);
  const r2 = w.pickups.alloc();
  w.pickups.x[r2] = w.pickups.px[r2] = w.player.x; w.pickups.y[r2] = w.pickups.py[r2] = w.player.y; w.pickups.kind[r2] = PK.VAULT;
  const said = runCollect(w, 2, EV.VAULT_EMPTY, IDLE, { halts: 'stop' });
  assert.deepEqual(said.map((e) => e.a), [1]);
  assert.equal(w.result.embers + w.build.embers + pickupsOf(w, PK.EMBER).length > 0, true, 'an Ember');
  assert.equal(w.glass, 0, 'no Pearls in its place');
});

// ---------------------------------------------------------------- Fog Bells

test('tasks: a Fog Bell tolls from its small ring; its crew gathers, then walks in; kills in its ring count down; rung, it dazes and drops a chest', () => {
  const w = field([['bell', 0, 0]], { harbor: { ferry: 1 } });
  w.ferry.nextCall = 1e9;
  const bell = w.tasks[0], B = T.tasks.bell, r = taskRadius(w, bell);
  // Walking through the kill ring doesn't wake it, and a kill there before it tolls doesn't count.
  goTo(w, bell.x + r * 0.7, bell.y);
  const e0 = post(w, 'fog_wisp', bell.x + 10, bell.y);
  kill(w, e0); run(w, TPS);
  assert.deepEqual([bell.state, bell.progress], [TASK_STATE.IDLE, 0]);
  // Its start ring fills while you're in it (moving is fine), and empties when you leave.
  goTo(w, bell.x, bell.y);
  run(w, Math.floor(B.openSec * TPS / 2));
  assert.ok(bell.touch > 0 && bell.state === TASK_STATE.IDLE);
  goTo(w, bell.x + 100, bell.y); run(w, 1);
  assert.equal(bell.touch, 0, 'left: empty again');
  const tolled = toll(w, bell);
  assert.deepEqual(tolled.map((e) => [e.a, e.b]), [[TASK.BELL, 1]], 'tolled');
  assert.equal(bell.state, TASK_STATE.ACTIVE);
  assert.equal(bell.need, B.baseKills);
  assert.equal(bell.crewN, bell.need, 'a crew as big as the kills it needs');
  for (let k = 0; k < bell.crewN; k++) { const d = Math.hypot(bell.crewX[k] - bell.x, bell.crewY[k] - bell.y); assert.ok(d > B.crewRadius * 0.55 && d < B.crewRadius * 1.25, `gathers in the fog round it: ${d}`); }
  const before = w.enemies.count;
  const walk = runCollect(w, Math.ceil(B.gatherSec * TPS) + 1, EV.TASK, IDLE, { halts: 'pass' }).filter((e) => e.b === 4);
  assert.equal(walk.length, 1, 'then walks in');
  assert.equal(w.enemies.count - before, bell.crewN);
  // Kills in the ring count down; one outside doesn't.
  w.enemies.count = 0;
  for (let k = 0; k < bell.need - 1; k++) kill(w, post(w, 'fog_wisp', bell.x + (k % 2 ? 1 : -1) * r * 0.5, bell.y));
  kill(w, post(w, 'fog_wisp', bell.x + r + 30, bell.y));
  const counts = runCollect(w, 1, EV.BELL_COUNT);
  assert.equal(bell.progress, bell.need - 1, 'one outside the ring didn\'t count');
  assert.equal(counts.at(-1).a, 1, 'one left, said');
  const inside = post(w, 'drowned_sailor', bell.x + 30, bell.y);
  w.enemies.hp[inside] = w.enemies.maxHp[inside] = 1e6;
  goTo(w, bell.x - r * 0.6, bell.y);   // (in its ring, clear of where the chest lands)
  kill(w, post(w, 'fog_wisp', bell.x, bell.y));
  const rung = runCollect(w, 1, EV.TASK);
  assert.deepEqual(rung.map((x) => [x.a, x.b]), [[TASK.BELL, 2]]);
  assert.equal(bell.state, TASK_STATE.DONE);
  assert.equal(w.glass, bell.glass);
  assert.equal(w.result.bellsRung, 1);
  assert.ok(w.enemies.dazeT[w.enemies.resolve(w.enemies.handle(inside))] > 0, 'what\'s inside is dazed');
  const chests = pickupsOf(w, PK.CHEST);
  assert.equal(chests.length, 1, 'and a chest at the bell');
  assert.equal(w.pickups.a[chests[0]], CHEST_BELL);
  assert.ok(Math.hypot(w.pickups.x[chests[0]] - bell.x, w.pickups.y[chests[0]] - bell.y) < r, 'inside its ring');
  // The Chapel widens the kill ring.
  const wide = field([['bell', 0, 0]], { harbor: { bellRing: 0.25 } });
  assert.equal(taskRadius(wide, wide.tasks[0]), T.tasks.bell.radius * 1.25);
});

test('tasks: the bell\'s chest is a pick: a weapon or passive gains 2 levels (a weapon\'s rolled); with nothing to level, Coin or food', () => {
  const open = (w) => { spawnPickup(w, PK.CHEST, w.player.x, w.player.y, CHEST_BELL, 0); run(w, 1, IDLE, { halts: 'stop' }); return currentHalt(w); };
  const w = field([]);
  give(w, 'flare_gun', { level: 2 });
  givePassive(w, 'wick_oil', 4);
  const h = open(w);
  assert.equal(h?.kind, 'bellpick');
  assert.deepEqual(h.options.map((o) => [o.kind, o.id, o.from, o.to]), [['weapon', 'flare_gun', 2, 4], ['passive', 'wick_oil', 4, 5]]);
  assert.throws(() => decide(w, { kind: 'ok' }), /expected "pick"/);
  assert.throws(() => decide(w, { kind: 'pick', index: 7 }), /no option 7/);
  decide(w, { kind: 'pick', index: 0 });
  assert.equal(currentHalt(w), null);
  assert.equal(w.slots[0].level, 4);
  assert.equal(w.result.chests, 1);
  assert.equal(w.slots[0].ups.length, 3, 'a weapon\'s levels are rolled upgrades (ruling 10)');
  // A well-levelled weapon has no top (ruling 10): 2 more levels.
  const evo = field([]);
  give(evo, 'flare_gun', { level: 8 });
  const he = open(evo);
  assert.equal(he?.kind, 'bellpick');
  assert.deepEqual(he.options.map((o) => [o.kind, o.id, o.from, o.to]), [['weapon', 'flare_gun', 8, 10]]);
  decide(evo, { kind: 'pick', index: 0 });
  assert.equal(evo.slots[0].level, 10);
  // Nothing to level: a chest's fallback.
  const max = field([]);
  const h2 = open(max);
  assert.equal(h2?.kind, 'chest');
  assert.ok(['coin', 'heal'].includes(h2.items[0].kind), h2.items[0].kind);
});

// ---------------------------------------------------------------- Reliquaries and Pearls

test('relics: a Reliquary needs the gap since the last; the pity count makes one certain; none with nothing left to find, said once', () => {
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
  // Nothing left to find: nothing drops, and the run says so once.
  const all = makeWorld({ invulnerable: true, tuning: { relics: { reliquaryChance: 1 } } });
  for (const r of DATA.relics) addRelic(all, r);
  all.events.clear();
  maybeReliquary(all, all.player.x + 100, all.player.y);
  maybeReliquary(all, all.player.x + 100, all.player.y);
  assert.equal(all.result.reliquaries, 0);
  assert.equal(all.pickups.count, 0, 'not a Reliquary, and no Pearls in its place');
  assert.equal(eventsOf(all, EV.RELIC_POOL).length, 1);
  // Only ordinary kills count: an elite drops Pearls instead (with the Ferryman in the run).
  const g = makeWorld({ invulnerable: true, harbor: { ferry: 1 } }, { mapExtra: { ferry: { at: [70, 64] } } });
  assert.equal(glassFor(g, 0), 0);
  assert.equal(glassFor(g, EF.BOSS), T.glass.boss);
  for (let k = 0; k < 20; k++) { const v = glassFor(g, EF.ELITE); assert.ok(v >= T.glass.elite[0] && v <= T.glass.elite[1]); }
  assert.equal(glassFor(makeWorld(), EF.BOSS), 0, 'no Pearls before the Docks');
});

test('relics: a small pool is spread over the run; a Reliquary from a far kill lands nearer you, toward it, and says so', () => {
  const four = ['gull_feather', 'brass_button', 'spark_flint', 'tide_clock'];
  const w = createWorld({ seed: 1, character: 'lamplighter', invulnerable: true, tuning: { relics: { reliquaryChance: 1 } }, pools: { weapons: ['flare_gun'], passives: [], relics: four, runes: [] } }, DATA);
  const pool = {};
  assert.equal(relicPool(w, pool), 4);
  assert.deepEqual(pool, { total: 4, found: 0 });
  w.tick = 1;
  maybeReliquary(w, w.player.x + 400, w.player.y);
  assert.equal(w.result.reliquaries, 1);
  const drops = eventsOf(w, EV.DROP).filter((d) => d.a === PK.RELIQUARY);
  assert.equal(drops.length, 1);
  assert.equal(drops[0].c, 1, 'pulled in');
  assert.ok(Math.abs(Math.hypot(drops[0].x - w.player.x, drops[0].y - w.player.y) - T.relics.pullTo) < TILE && drops[0].x > w.player.x, 'toward the kill');
  // The next waits for the time left to the last boss over the relics still to find after it plus one: past the tuning's gap.
  const last = w.director.events[w.director.lastBossEvent].at;
  const spread = (last - w.tick / TPS) / 4;
  assert.ok(Math.abs(w.reliquary.wait - spread) < 1e-6);
  assert.ok(spread > T.relics.reliquaryGap);
  w.tick += Math.floor((spread - 5) * TPS);
  maybeReliquary(w, w.player.x, w.player.y);
  assert.equal(w.result.reliquaries, 1, 'not yet');
  w.tick += 10 * TPS;
  maybeReliquary(w, w.player.x, w.player.y);
  assert.equal(w.result.reliquaries, 2, 'then');
});

test('relics: Pearls from an elite fly to you; what was earned and the most held are on the result', () => {
  // (Skips pay nothing here: the passed drafts would pay Pearls, 0.9.0.)
  const w = makeWorld({ invulnerable: true, harbor: { ferry: 1 }, tuning: { draft: { skipPays: false } } }, { mapExtra: { ferry: { at: [70, 64] } } });
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
/** The world on his first call, tied up, with you away from him. */
function called(w) { w.tick = w.ferry.nextCall; run(w, 1); w.tick = w.ferry.tiedTick; return w; }

test('ferry: none without the Docks; not there at 0:00; he calls on his schedule with stock by the Docks\' level', () => {
  assert.equal(makeWorld({}, { mapExtra: { ferry: { at: [60, 60] } } }).ferry, null, 'no Docks, no Ferryman');
  assert.equal(makeWorld({ harbor: { ferry: 1 } }).ferry, null, 'a map without a mooring: no Ferryman');
  const one = ferryWorld(1);
  run(one, 1);
  assert.equal(one.ferry.moored, false, 'not at 0:00');
  assert.deepEqual(one.ferry.offers, []);
  assert.equal(one.ferry.nextCall, T.ferry.firstCall * TPS);
  one.tick = one.ferry.nextCall - 1;
  const calls = runCollect(one, 2, EV.FERRY);
  assert.deepEqual(calls.map((e) => e.a), [1, 3], 'a new stock as he calls');
  assert.ok(one.ferry.moored && one.ferry.calls === 1);
  assert.equal(one.ferry.tiedTick - one.ferry.callTick, T.ferry.rowSec * TPS, 'rowing in');
  const kinds = (w) => w.ferry.offers.map((o) => o.kind);
  assert.deepEqual(kinds(one), [FERRY_KINDS.relic, FERRY_KINDS.food, FERRY_KINDS.reroll, FERRY_KINDS.ember]);
  const P = T.ferry.prices;
  assert.deepEqual(one.ferry.offers.slice(1).map((o) => o.price), [P.food, P.reroll, P.ember]);
  const two = called(ferryWorld(2));
  assert.equal(kinds(two).filter((k) => k === FERRY_KINDS.relic).length, 2, 'two relics from the Docks\' level 2');
  const three = called(ferryWorld(3));
  assert.equal(three.ferry.offers.at(-1).price, Math.round(P.ember * (1 - T.ferry.discount)), 'cheaper from level 3');
  const four = called(ferryWorld(4));
  assert.equal(kinds(four).filter((k) => k === FERRY_KINDS.relic).length, 3, 'a third relic from the Docks\' level 4');
  // The next call, callEvery later: a new stock.
  assert.equal(one.ferry.nextCall, (T.ferry.firstCall + T.ferry.callEvery) * TPS);
  one.tick = one.ferry.nextCall;
  const again = runCollect(one, 1, EV.FERRY);
  assert.deepEqual(again.map((e) => [e.a, e.b]), [[4, 0], [1, 1], [3, 0]], 'casts off, restocks, calls');
  // A short run's calls follow its clock.
  const short = ferryWorld(1, { mode: 'short' });
  assert.equal(short.ferry.nextCall, Math.round(T.ferry.firstCall * T.run.shortTimeScale * TPS));
});

test('ferry: he ties up at the mooring nearest you that\'s at least minAway, rowing in from beyond it', () => {
  const w = createWorld({ seed: 1, character: 'lamplighter', invulnerable: true, harbor: { ferry: 1 } }, DATA);
  const M = w.ferry.moorings, p = w.player;
  assert.ok(M.length >= 4);
  w.tick = w.ferry.nextCall;
  w.ferry.nextCall = w.tick;
  run(w, 1, IDLE, { halts: 'pass' });
  const F = w.ferry, d = (m) => Math.hypot(m.x - p.x, m.y - p.y);
  assert.ok(d(F) >= T.ferry.minAway, `${d(F)} px away`);
  for (const m of M) assert.ok(d(m) < T.ferry.minAway || d(m) >= d(F) - 1e-9, 'the nearest that far');
  assert.ok(Math.hypot(F.fromX - p.x, F.fromY - p.y) > Math.hypot(F.bx - p.x, F.by - p.y), 'from the fog beyond the skiff');
});

test('ferry: his ring opens the trade once he\'s tied up (moving allowed); buying spends Pearls; leave the ring and come back for another', () => {
  const w = ferryWorld(2, { startGlass: 200 });
  w.tick = w.ferry.nextCall; run(w, 1);
  const F = w.ferry;
  goTo(w, F.x, F.y);
  run(w, Math.ceil(T.ferry.openSec * TPS) + 2, IDLE, { halts: 'stop' });
  assert.equal(currentHalt(w), null, 'not while he rows in');
  w.tick = F.tiedTick;
  const sway = (k) => ({ mx: k % 12 < 6 ? 127 : -127, my: 0, buttons: 0 });
  let k = 0;
  for (; k < Math.ceil(T.ferry.openSec * TPS) - 2; k++) { goTo(w, F.x, F.y); stepWorld(w, sway(k)); }
  assert.equal(currentHalt(w), null, 'not before openSec');
  for (let j = 0; j < 4 && !currentHalt(w); j++, k++) { goTo(w, F.x + 4, F.y); stepWorld(w, sway(k)); }
  assert.equal(currentHalt(w)?.kind, 'ferry', 'walking inside it is fine');
  assert.equal(w.result.ferryTrades, 1);
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
  assert.equal(currentHalt(w), null, 'once: staying in it doesn\'t reopen it');
  // A relic he stocked that you've found since: gone from the trade, and refused.
  addRelic(w, DATA.relics.find((r) => r.id === F.offers[1].id));
  goTo(w, F.x + 200, F.y); run(w, 2);
  goTo(w, F.x, F.y); run(w, TPS, IDLE, { halts: 'stop' });
  assert.equal(currentHalt(w)?.kind, 'ferry', 'back again: open again');
  assert.equal(F.offers[1].gone, true);
  assert.throws(() => decide(w, { kind: 'buy', index: 1 }), /no longer stocked/);
  // What can't be bought is refused.
  const poor = ferryWorld(1);
  called(poor);
  goTo(poor, poor.ferry.x, poor.ferry.y);
  run(poor, TPS, IDLE, { halts: 'stop' });
  assert.throws(() => decide(poor, { kind: 'buy', index: 3 }), /needs \d+ Pearls/);
  assert.throws(() => decide(poor, { kind: 'buy', index: 9 }), /no offer 9/);
});

// ---------------------------------------------------------------- what the gate sends into a run

test('run config: a Tide\'s and curses\' multipliers reach the enemies; Hunger drops no food', () => {
  const plain = makeWorld({ invulnerable: true });
  const hard = makeWorld({ invulnerable: true, hpMul: 1.5, enemySpeedMul: 1.2, enemyDamageMul: 1.3 });
  run(plain, 1); run(hard, 1);
  assert.ok(Math.abs(hard.director.bossHpMul / plain.director.bossHpMul - Math.sqrt(1.5)) < 1e-6, 'bosses too, as its square root (0.9.0: tuning.director.bossTideExp)');
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

test('run config: an Heirloom is a relic carried from 0:00, with its hook and its price; an old rune stone is passed over; a kit starts with its weapon', () => {
  // (The sweep, ruling 11: arcana were relics picked at the gate. The five with code of their own are relics.)
  for (const id of ['moon_pull', 'brine', 'kindling', 'glassblower', 'long_beam']) {
    const w = createWorld({ seed: 2, character: 'lamplighter', relics: [id], heirloom: id }, DATA);
    assert.ok(w.hookEntries.some((h) => h.source === `relic:${id}`) && w.build.relics.some((r) => r.id === id), id);
  }
  const glass = createWorld({ seed: 2, character: 'lamplighter', relics: ['glassblower'] }, DATA);
  const base = createWorld({ seed: 2, character: 'lamplighter' }, DATA);
  assert.ok(Math.abs(glass.stats.maxHp / base.stats.maxHp - 0.85) < 1e-6, 'its price');
  assert.equal(glass.relicTierBonus, 1);
  assert.throws(() => createWorld({ seed: 2, character: 'lamplighter', relics: ['nope'] }, DATA), /unknown relic "nope"/);
  assert.throws(() => createWorld({ seed: 2, character: 'lamplighter', heirloom: 5 }, DATA), /heirloom must be an id/);
  assert.throws(() => createWorld({ seed: 2, character: 'lamplighter', startEmbers: -1 }, DATA), /startEmbers/);
  // A rune stone (ruling 14: runes are gone): a config that still names one starts as any run does.
  const rune = createWorld({ seed: 2, character: 'lamplighter', startRune: 'splitting' }, DATA);
  assert.equal(currentHalt(rune), null);
  // A kit: the character's other start.
  const kit = DATA.kits[0];
  const k = createWorld({ seed: 2, character: kit.character, startWeapon: kit.start }, DATA);
  assert.equal(k.slots[1].def.id, kit.start, 'beside the signature weapon');
  assert.throws(() => createWorld({ seed: 2, character: 'lamplighter', startWeapon: 'nope' }, DATA), /unknown weapon "nope"/);
  // Starting Pearls (the Pearl Pouch), with the Ferryman in the run; none without him.
  assert.equal(createWorld({ seed: 2, character: 'lamplighter', startGlass: 20, harbor: { ferry: 1 } }, DATA).glass, 20);
  assert.equal(createWorld({ seed: 2, character: 'lamplighter', startGlass: 20 }, DATA).glass, 0);
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
  // Oil Wake: walking leaves burning ground behind, a pool each `every` seconds (ruling 16: not the dash).
  const wake = DATA.affixes.find((a) => a.id === 'oil_wake');
  const w = makeWorld({ invulnerable: true, gearHooks: [{ hook: wake.hook, params: wake.params, affix: wake.id }] });
  assert.ok(w.hookEntries.some((h) => h.source === 'gear:oil_wake'));
  const zones0 = w.zones.count;
  run(w, Math.round(wake.params.every * 2.5 * TPS), { mx: 127, my: 0, buttons: 0 });
  assert.ok(w.zones.count - zones0 >= 2, `pools along the walk: ${w.zones.count - zones0}`);
  const still = makeWorld({ invulnerable: true, gearHooks: [{ hook: wake.hook, params: wake.params, affix: wake.id }] });
  run(still, 6, { mx: 0, my: 0, buttons: 1 });
  const oil = [...Array(still.zones.count).keys()].filter((z) => still.zones.damage[z] > 0).length;
  assert.equal(oil, 0, 'a dash alone lays no oil (only its dash item\'s own mark, which never hurts)');
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
      // His call number stock + 1 (each call is a new stock).
      w.tick = Math.round((T.ferry.firstCall + T.ferry.callEvery * stock) * TPS);
      w.ferry.calls = stock; w.ferry.nextCall = w.tick;
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
  const w = called(ferryWorld(1, { startGlass: 200 }));
  give(w, 'flare_gun');
  goTo(w, w.ferry.x, w.ferry.y);
  run(w, TPS, IDLE, { halts: 'stop' });
  decide(w, { kind: 'buy', index: 3 });
  decide(w, { kind: 'done' });
  assert.equal(w.glass, 200 - T.ferry.prices.ember);
  run(w, 1, IDLE, { halts: 'stop' });
  assert.equal(currentHalt(w)?.kind, 'ascend', 'its Ember opens the Ascend screen');
  // A relic already carried (found since he stocked it) can't be bought twice.
  const c = called(ferryWorld(1, { startGlass: 200 }));
  goTo(c, c.ferry.x, c.ferry.y);
  run(c, TPS, IDLE, { halts: 'stop' });
  addRelic(c, DATA.relics.find((r) => r.id === c.ferry.offers[0].id));
  assert.throws(() => decide(c, { kind: 'buy', index: 0 }), /already carried/);
});

// ---------------------------------------------------------------- the relics' and arcana's rules

const withRelic = (id, config = {}) => { const w = makeWorld({ ...config }); addRelic(w, DATA.relics.find((r) => r.id === id)); return w; };
const tough = (w, dx, dy = 0) => { const e = spawnAt(w, 'drowned_sailor', dx, dy); w.enemies.speed[e] = 0; w.enemies.hp[e] = w.enemies.maxHp[e] = 1e6; return e; };

test('relics: Spark Flint bursts every few seconds while you keep moving, never from the dash; Barnacle Shell answers a hit, once a cooldown, shielded or not', () => {
  const w = withRelic('spark_flint', { invulnerable: true });
  const P0 = DATA.relics.find((r) => r.id === 'spark_flint').params;
  const near = tough(w, 20), far = tough(w, -200);
  assert.equal(runCollect(w, 20, EV.EXPLODE, { mx: 0, my: 0, buttons: 1 }).length, 0, 'a dash from standing: nothing');
  const bursts = runCollect(w, Math.round(P0.every * 2 * TPS), EV.EXPLODE, { mx: 30, my: 0, buttons: 0 });
  assert.equal(bursts.length, 2, 'one each `every` seconds of walking');
  assert.ok(w.enemies.hp[near] < 1e6 && w.enemies.hp[far] === 1e6, 'what stood close, only');
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

test('relics: Bloodied Hook: a crowd close and Damage rises, then falls; Drowned Bell tolls on its own clock (W4: nothing from kills)', () => {
  const P = DATA.relics.find((r) => r.id === 'bloodied_hook').params;
  const w = withRelic('bloodied_hook', { invulnerable: true });
  const fury = () => w.mods.some((m) => m.stat === 'might' && m.value === P.damage);
  const near = [];
  for (let k = 0; k < P.count - 1; k++) near.push(tough(w, 20 + (k % 5) * 6, 20 + Math.floor(k / 5) * 6));
  run(w, 8);
  assert.ok(!fury(), 'one short of the crowd');
  near.push(tough(w, -20, -20));
  run(w, 8);
  assert.ok(fury(), 'the crowd is close');
  for (const e of near) w.enemies.flags[e] |= EF.DEAD;
  run(w, 8);
  assert.ok(!fury(), 'and it ends when they are gone');
  // Drowned Bell: every `every` seconds, kills or none.
  const D = DATA.relics.find((r) => r.id === 'drowned_bell').params;
  const b = withRelic('drowned_bell', { invulnerable: true });
  const e = tough(b, 60, 0);
  const tolls = runCollect(b, Math.round(D.every * 2 * TPS) + 2, EV.WAVE).length;
  assert.equal(tolls, 2);
  assert.ok(b.enemies.hp[e] < 1e6);
});

test('relics that were arcana: Moon Pull pulls every gem in; Sea Rite heals on Sea kills, capped a second; Kindling doubles elites\' Embers', () => {
  const hw = DATA.relics.find((a) => a.id === 'moon_pull');
  const w = makeWorld({ invulnerable: true, relics: ['moon_pull'] }, {});
  w.player.xpNext = 1e9;
  spawnGem(w, w.player.x + 600, w.player.y, 1);
  run(w, (hw.params.every - 1) * TPS);
  assert.equal(w.gems.count, 1, 'not before its time');
  run(w, 4 * TPS);
  assert.equal(w.gems.count, 0, 'then every gem flies in');
  // Brine.
  const br = makeWorld({ relics: ['brine'] });
  give(br, 'tide_bell');
  give(br, 'flare_gun');
  const BP = DATA.relics.find((a) => a.id === 'brine').params;
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
  const embers = (relic) => {
    let n = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const k = makeWorld({ seed, invulnerable: true, ...(relic ? { relics: [relic] } : {}), tuning: { embers: { eliteChance: 0.5 } } });
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
  assert.equal(makeWorld({ relics: ['kindling'] }).emberBossExtra, 1, 'and a boss drops 2');
});

// ---------------------------------------------------------------- replays

test('tasks: a run with lamps, a bell, the Ferryman, and a Reliquary replays to the same state', () => {
  const play = () => {
    const w = createWorld({ seed: 77, character: 'lamplighter', invulnerable: true, harbor: { ferry: 3 }, startGlass: 120, tuning: { relics: { reliquaryChance: 0.05 }, ferry: { firstCall: 20 } } }, DATA);
    // Walk to the first lamp and light it, then to the skiff once he's called, then toll the first
    // bell (0.9.0: the act's sites are farther out) (the input is a function of the state, so both plays steer the same).
    const steer = (tx, ty) => {
      const dx = tx - w.player.x, dy = ty - w.player.y, d = Math.hypot(dx, dy);
      return d < 6 ? IDLE : { mx: Math.round((127 * dx) / d), my: Math.round((127 * dy) / d), buttons: 0 };
    };
    const bell = w.tasks.findIndex((t) => t.kind === TASK.BELL), lamp = w.tasks.findIndex((t) => t.kind === TASK.LAMP);
    const frames = { length: 4800, at: () => (w.tasks[lamp].state !== TASK_STATE.DONE ? steer(w.tasks[lamp].x, w.tasks[lamp].y) : w.ferry.moored && w.result.ferryBought === 0 ? steer(w.ferry.x, w.ferry.y) : w.tasks[bell].state === TASK_STATE.IDLE ? steer(w.tasks[bell].x, w.tasks[bell].y) : IDLE) };
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
        else if (h.kind === 'bellpick') decide(w, { kind: 'pick', index: 0 });
        else decide(w, { kind: 'leave' });
      }
      stepWorld(w, frames.at());
    }
    return w;
  };
  const a = play(), b = play();
  assert.equal(hashWorld(a), hashWorld(b));
  const r = a.result;
  assert.ok(r.lampsLit >= 1 && r.ferryBought >= 1 && r.reliquaries >= 1 && a.tasks[a.tasks.findIndex((t) => t.kind === TASK.BELL)].state !== TASK_STATE.IDLE, `each happened: ${JSON.stringify({ r: r.reliquaries, f: r.ferryBought, l: r.lampsLit })}`);
});

// ---------------------------------------------------------------- what the view reads (0.8.2)

test('signs: every task ring is dashed in its own color, with its fill or its count; the Ferryman\'s and the Well\'s once they can open', () => {
  const w = field([['lamp', 0, 0], ['bell', 30, 0]], { harbor: { ferry: 1 } });
  const out = [];
  const rings = () => out.slice(0, collectRings(w, out)).map((r) => ({ ...r }));
  let r = rings();
  assert.deepEqual(r.map((x) => [x.kind, x.color, x.style]), [[RING.LAMP, 'lamp', 'dashed'], [RING.BELL_START, 'bell', 'dashed']]);
  assert.deepEqual([r[0].r, r[0].fill, r[1].r, r[1].fill], [T.tasks.lamp.radius, 0, T.tasks.bell.startRadius, 0]);
  goTo(w, w.tasks[0].x, w.tasks[0].y);
  run(w, TPS);
  assert.ok(Math.abs(rings()[0].fill - 1 / T.tasks.lamp.baseSec) < 0.02, 'a part-lit lamp shows how far');
  run(w, 3 * TPS, IDLE, { halts: 'pass' });
  assert.deepEqual(rings()[0].kind, RING.WARD, 'lit: its ward');
  assert.equal(rings()[0].r, T.tasks.ward.radius);
  toll(w, w.tasks[1]);
  r = rings();
  assert.deepEqual([r[1].kind, r[1].count, r[1].r], [RING.BELL, w.tasks[1].need, taskRadius(w, w.tasks[1])], 'tolled: the kill ring with its number');
  assert.ok(!r.some((x) => x.kind === RING.FERRY), 'no ring before he ties up');
  w.tick = w.ferry.nextCall; run(w, 1, IDLE, { halts: 'pass' }); w.tick = w.ferry.tiedTick;
  r = rings();
  assert.deepEqual(r.filter((x) => x.kind === RING.FERRY).map((x) => [x.x, x.y, x.r, x.color]), [[w.ferry.x, w.ferry.y, T.ferry.radius, 'ferry']]);
  // Reused records: a second call allocates nothing new when out is long enough.
  const len = out.length; collectRings(w, out);
  assert.equal(out.length, len);
});

test('signs: an arrow for the nearest of each kind, none for one on screen; what a task pays, shown before you go', () => {
  const w = field([['lamp', 40, 0], ['lamp', 60, 0], ['bell', 0, 40]], { harbor: { ferry: 1 } });
  const out = [];
  const arrows = (hw = 160, hh = 90) => out.slice(0, collectArrows(w, out, w.player.x, w.player.y, hw, hh)).map((a) => [a.kind, a.task]);
  assert.deepEqual(arrows(), [[ARROW.LAMP, 0], [ARROW.BELL, 2]], 'the nearest lamp only, and the bell');
  assert.deepEqual(arrows(2000, 2000), [], 'all on screen: none');
  spawnPickup(w, PK.RELIQUARY, w.player.x + 500, w.player.y, 0, 0);
  spawnPickup(w, PK.CHEST, w.player.x - 500, w.player.y, 1, 0);
  w.tick = w.ferry.nextCall; run(w, 1, IDLE, { halts: 'pass' });
  const kinds = arrows().map((a) => a[0]);
  for (const k of [ARROW.FERRY, ARROW.RELIQUARY, ARROW.CHEST]) assert.ok(kinds.includes(k), `arrow ${k}`);
  const pay = {};
  assert.ok(rewardOf(w, 0, pay));
  assert.deepEqual(pay, { kind: REWARD.WARD, pearls: Math.round(T.tasks.lamp.glass[0] + T.tasks.lamp.glass[1] * (w.tick / TPS / 60)), chest: false });
  assert.ok(rewardOf(w, 2, pay));
  assert.equal(pay.kind, REWARD.PICK);
  const bare = field([['lamp', 0, 0]]);
  rewardOf(bare, 0, pay);
  assert.equal(pay.pearls, 0, 'no Pearls to show before the Docks');
});

test('ledger: what the map holds, and the run against it, in the result', () => {
  const docks = DATA.maps.find((m) => m.id === 'drowned_docks');
  assert.deepEqual(mapHolds(docks), { lamps: 5, bells: 3, acts: 3, cranes: 4, cairns: 0, places: docks.places.length, longNight: true, ferry: true, secrets: [{ id: 'wreck_cache', name: 'Wreck Hold' }], finds: docks.secrets.length - 1 });
  const w = field([['lamp', 0, 0], ['bell', 30, 0]], { harbor: { ferry: 1 } });
  goTo(w, w.tasks[0].x, w.tasks[0].y);
  run(w, 4 * TPS, IDLE, { halts: 'pass' });
  const L = runLedger(w);
  assert.deepEqual([L.lamps, L.bells, L.ferry, L.nights], [{ lit: 1, most: 1, total: 1 }, { rung: 0, total: 1 }, { calls: 0, trades: 0, bought: 0 }, 0]);
  assert.ok(L.relics.total > 0 && L.relics.found === 0);
  crowdArrives(w, false);
  w.over = { reason: 1, tick: w.tick };
  const res = buildRunResult(w);
  assert.equal(res.ledger.nights, 1);
  assert.equal(res.lanternNights, 1);
});

test('first sightings: a lamp and a bell when first in view, the Ferryman at his first call, a Reliquary when one drops (the field guide)', () => {
  const w = field([['lamp', 3, 0], ['bell', 60, 0]], { harbor: { ferry: 1 } });
  run(w, 31);
  assert.ok(w.result.sighted.includes('lamp') && !w.result.sighted.includes('bell'));
  w.tick = w.ferry.nextCall; run(w, 1, IDLE, { halts: 'pass' });
  assert.ok(w.result.sighted.includes('ferry'));
  for (const k of ['lamp', 'bell', 'ferry', 'reliquary']) assert.ok(DATA.glossary.find((e) => e.id === DATA.meta.fieldGuide[k]?.term)?.short, `${k}: a field guide line (its glossary entry's)`);
});

test('the Well: its ring fills while you\'re inside, moving allowed; it asks once on its own; after that only standing still in it asks again (ruling 16: never a dash); not with no relic', async () => {
  const { openWell } = await import('../src/sim/well.js');
  const w = makeWorld({ invulnerable: true, layers: { storm: false, well: true, secret: false } });
  openWell(w, w.player.x, w.player.y);
  run(w, TPS, IDLE, { halts: 'stop' });
  assert.equal(currentHalt(w), null, 'no relic: it doesn\'t fill');
  assert.equal(w.well.touch, 0);
  addRelic(w, DATA.relics.find((r) => r.id === 'brass_button'));
  let k = 0;
  for (; k < TPS && !currentHalt(w); k++) { stepWorld(w, { mx: k % 10 < 5 ? 127 : -127, my: 0, buttons: 0 }); }
  assert.equal(currentHalt(w)?.kind, 'well', 'opened while walking in its ring');
  assert.ok(Math.abs(k - T.well.openSec * TPS) <= 1, `${k} ticks`);
  decide(w, { kind: 'keep' });
  goTo(w, w.well.x, w.well.y);
  run(w, 2 * TPS, IDLE, { halts: 'stop' });
  assert.equal(currentHalt(w), null, 'once');
  goTo(w, w.well.x + 100, w.well.y); run(w, 1);
  goTo(w, w.well.x - 30, w.well.y); run(w, 1);
  w.player.dashCd = 0;
  for (k = 0; k < 30 && !currentHalt(w); k++) stepWorld(w, { mx: 127, my: 0, buttons: k === 0 ? 1 : 0 });
  assert.equal(currentHalt(w), null, 'a dash into its ring asks nothing (ruling 16)');
  goTo(w, w.well.x, w.well.y); run(w, TPS, IDLE, { halts: 'stop' });
  assert.equal(currentHalt(w)?.kind, 'well', 'left and came back to stand in it: asked again');
});

test('tasks: a bell\'s own crew counts for it wherever it falls; another enemy only inside the ring', () => {
  const w = field([['bell', 0, 0]]);
  const bell = w.tasks[0], r = taskRadius(w, bell);
  toll(w, bell);
  run(w, Math.ceil(T.tasks.bell.gatherSec * TPS) + 1, IDLE, { halts: 'pass' });
  const E = w.enemies;
  const crew = [];
  for (let i = 0; i < E.count; i++) if (E.crew[i] === 1) crew.push(E.handle(i));
  assert.equal(crew.length, bell.crewN, 'tagged');
  goTo(w, bell.x + 1000, bell.y);
  const c = E.resolve(crew[0]);
  E.x[c] = bell.x + r * 3; E.y[c] = bell.y;
  kill(w, c);
  kill(w, post(w, 'fog_wisp', bell.x + r * 3, bell.y + 40));
  run(w, 1, IDLE, { halts: 'pass' });
  assert.equal(bell.progress, 1, 'the crew\'s far kill counted; the stranger\'s didn\'t');
});
