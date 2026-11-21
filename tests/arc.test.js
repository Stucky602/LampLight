// The run's arc and the maps (0.9.0, W4; ARCHITECTURE §5.20; work/veteran/W4-NOTES.md): three
// acts with tasks at sites drawn per run (lamps stay lit), bells waking through an act, twists,
// the map's event deck, the Docks' cranes and the Marsh's salt cairns, small finds, overtime's
// shape (elite pairs, a boss back, the Long Night) and its ending at dawn.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DATA, IDLE, run, runCollect, spawnAt, pastGates } from './helpers/simworld.js';
import { createWorld, stepWorld, decide, currentHalt, hashWorld, buildRunResult } from '../src/sim/world.js';
import { overtimeDecide, checkTimeline } from '../src/sim/director.js';
import { crowdArrives } from '../src/sim/tasks.js';
import { actsStep, checkActs, openFind } from '../src/sim/acts.js';
import { damageEnemy } from '../src/sim/enemies.js';
import { EV, TIER, STRIKE_SRC, TWIST, FIND_GIFT, END } from '../src/sim/events.js';
import { TPS, TASK, TASK_STATE, EF, PK } from '../src/sim/constants.js';
import { TILE } from '../src/sim/terrain.js';
import { addRelic } from '../src/sim/build.js';
import { GLOSSARY } from '../src/data/glossary.js';

const T = DATA.tuning.tasks;
const DOCKS = DATA.maps.find((m) => m.id === 'drowned_docks'), MARSH = DATA.maps.find((m) => m.id === 'salt_marsh');
const world = (map = 'drowned_docks', seed = 3, extra = {}) => createWorld({ seed, map, character: 'lamplighter', invulnerable: true, ...extra }, DATA);
const of = (w, kind, act = null) => w.tasks.filter((t) => t.kind === kind && (act === null || t.act === act));
const goTo = (w, x, y) => { w.player.x = w.player.px = x; w.player.y = w.player.py = y; };

test('acts: each act\'s lamps at sites drawn for the run, spread over the places, never one used twice; the same seed the same sites', () => {
  for (const map of [DOCKS, MARSH]) {
    const w = world(map.id, 5), lamps = of(w, TASK.LAMP, 1);
    assert.equal(lamps.length, map.acts[0].lamps, `${map.id}: act 1's lamps`);
    assert.ok(new Set(lamps.map((t) => t.place)).size >= Math.min(lamps.length, 3), `${map.id}: over several places`);
    const p = w.player;
    for (const t of lamps) assert.ok(Math.hypot(t.x - p.x, t.y - p.y) >= (T.acts.lampAway - 2) * TILE, `${map.id}: a lamp away from the start`);
    assert.deepEqual(of(world(map.id, 5), TASK.LAMP).map((t) => [t.x, t.y]), lamps.map((t) => [t.x, t.y]), 'the same seed, the same sites');
    const other = of(world(map.id, 6), TASK.LAMP).map((t) => `${t.x},${t.y}`).join(' ');
    assert.notEqual(other, lamps.map((t) => `${t.x},${t.y}`).join(' '), 'another seed, another draw');
    // Act 2 at the first boss: new lamps, none at a site act 1 used; act 1's stay lit.
    for (const t of lamps) t.state = TASK_STATE.DONE;
    crowdArrives(w, true);
    const act2 = of(w, TASK.LAMP, 2);
    assert.equal(act2.length, map.acts[1].lamps);
    const used = new Set(lamps.map((t) => `${t.x},${t.y}`));
    assert.ok(act2.every((t) => !used.has(`${t.x},${t.y}`)), 'never a site used twice');
    assert.ok(lamps.every((t) => t.state === TASK_STATE.DONE));
    // Act 3 when you stay for overtime.
    overtimeDecide(w, { kind: 'stay' });
    assert.equal(w.acts.act, 3);
    assert.equal(of(w, TASK.LAMP, 3).length, map.acts[2].lamps);
    assert.equal(w.result.act, 3);
  }
});

test('acts: an act\'s bells wake one at a time (no countdown on any), each away from you, each said with its place', () => {
  const w = world('drowned_docks', 9);
  const A = DOCKS.acts[0];
  assert.equal(of(w, TASK.BELL).length, A.bellAt.filter((s) => s === 0).length, 'the first wakes at once');
  const woke = runCollect(w, Math.round(A.bellAt[1] * TPS) + 2, EV.ARM, IDLE, { halts: 'pass' }).filter((e) => e.a === TASK.BELL);
  assert.equal(woke.length, 1, 'the second at its second');
  assert.ok(woke[0].d >= 0 && DOCKS.places[woke[0].d], 'it names a place');
  const b = of(w, TASK.BELL)[1];
  assert.equal(b.state, TASK_STATE.IDLE, 'a waking bell waits for you');
  assert.ok(Math.hypot(b.x - w.player.x, b.y - w.player.y) >= (T.acts.bellAway - 2) * TILE);
});

test('acts: twists from act 2: a held lamp takes longer, a crowd gathers round it while you light it, and it pays a chest; an elite leads a bell\'s crew', () => {
  const w = world('drowned_docks', 11, { character: 'harpooner' });   // (0.9.0, W2: the Lamplighter lights a held lamp 4 times as fast)
  for (const t of of(w, TASK.LAMP)) t.state = TASK_STATE.DONE;
  w.acts.rng.next();   // (any draw: act 2 brings one twist of two)
  crowdArrives(w, true);
  // Make the held lamp and the elite crew certain for the test, whichever was drawn.
  const lamp = of(w, TASK.LAMP, 2)[0];
  lamp.twist = TWIST.HELD;
  if (!lamp.crewX) { lamp.crewX = new Float32Array(64); lamp.crewY = new Float32Array(64); }
  goTo(w, lamp.x, lamp.y);
  run(w, 1, IDLE, { halts: 'pass' });
  assert.equal(lamp.state, TASK_STATE.ACTIVE);
  const m = Math.floor(w.tick / TPS / 60);
  assert.ok(Math.abs(lamp.need - (T.lamp.baseSec + T.lamp.perMinSec * m) * T.held.mul) < 1e-6, 'held: it takes heldMul as long');
  const tells = runCollect(w, Math.round((T.held.every + 1.5) * TPS), EV.TELE_TIER, IDLE, { halts: 'pass' }).filter((e) => e.x === lamp.x);
  assert.ok(tells.length >= 1 && tells.every((e) => e.a === TIER.DIM), 'its crowds are ordinary dim tells');
  assert.ok(lamp.wave >= 2, 'a crowd every few seconds while you stay');
  const before = w.result.heldLamps;
  run(w, Math.ceil(lamp.need * TPS), IDLE, { halts: 'pass' });
  assert.equal(lamp.state, TASK_STATE.DONE);
  assert.equal(w.result.heldLamps, before + 1, 'and it paid its chest');
  // The elite crew.
  const bell = of(w, TASK.BELL).find((t) => t.state === TASK_STATE.IDLE) ?? of(world('drowned_docks', 11), TASK.BELL)[0];
  bell.twist = TWIST.ELITE_CREW;
  goTo(w, bell.x, bell.y);
  const spawned = runCollect(w, Math.round((T.bell.openSec + T.bell.gatherSec) * TPS) + 3, EV.ELITE_SPAWN, IDLE, { halts: 'pass' });
  assert.ok(spawned.length >= 1, 'an elite walks in with the crew');
});

test('the deck: each act draws its events into the timeline within its span, only from those the profile opened, each said once with its name', () => {
  const w = world('drowned_docks', 2);
  const deckEvents = w.director.events.filter((e) => e.deck !== undefined);
  const firsts = deckEvents.filter((e) => e.first);
  assert.equal(firsts.length, DOCKS.acts[0].deck, 'act 1\'s draw');
  for (const e of firsts) assert.ok(e.at >= DOCKS.acts[0].span[0] && e.at <= DOCKS.acts[0].span[1], `in the span (${e.at})`);
  // Only what the profile opened.
  const closed = world('drowned_docks', 2, { mapEvents: ['gulls_rise'] });
  assert.deepEqual([...new Set(closed.director.events.filter((e) => e.deck !== undefined).map((e) => DOCKS.deck[e.deck].id))], ['gulls_rise']);
  assert.throws(() => world('drowned_docks', 2, { mapEvents: 'all' }), /mapEvents must be a list/);
  // Each fires as the director comes to it: the result names it, a notice event says so.
  const first = firsts[0];
  w.tick = Math.round(first.at * TPS) - 1;
  const said = runCollect(w, 3, EV.MAP_EVENT, IDLE, { halts: 'pass' }).filter((e) => e.a === 1);
  assert.equal(said.length, 1);
  assert.deepEqual(w.result.mapEvents, [DOCKS.deck[first.deck].id]);
  // Every deck entry's data checks (and a wrong one says so).
  for (const map of DATA.maps) checkTimeline(map, w.enemyIndex, w.enemyDefs);
  const bad = { ...DOCKS, deck: [{ id: 'x', name: 'X', acts: [1], events: [{ event: 'cache', chest: 'gold' }] }] };
  assert.throws(() => checkTimeline(bad, w.enemyIndex, w.enemyDefs), /chest is 'elite' or 'boss'/);
  assert.match(checkActs({ ...DOCKS, acts: DOCKS.acts.slice(0, 2) }, () => null), /a list of 3/);
});

test('the deck: a cache lies away from you and its guard rises when you come near; a trail of gems leads to one; a rising leaves its spoils; a fire marches warned rings', async () => {
  const { placeCache } = await import('../src/sim/acts.js');
  const w = world('drowned_docks', 4);
  const chestsBefore = [];
  for (let i = 0; i < w.pickups.count; i++) if (w.pickups.kind[i] === PK.CHEST) chestsBefore.push(i);
  const [cx, cy] = placeCache(w, { chest: 'elite', guard: { enemy: 'drowned_sailor', count: 10 }, act: 1, deck: 1 });
  assert.ok(Math.hypot(cx - w.player.x, cy - w.player.y) >= (T.acts.cacheAway - 2) * TILE, 'away from you');
  let chests = 0;
  for (let i = 0; i < w.pickups.count; i++) if (w.pickups.kind[i] === PK.CHEST) chests++;
  assert.equal(chests, chestsBefore.length + 1, 'its chest');
  const alive0 = w.enemies.count;
  goTo(w, cx + T.acts.guardWake - 20, cy);
  const rose = runCollect(w, 8, EV.MAP_EVENT, IDLE, { halts: 'pass' }).filter((e) => e.a === 2);
  assert.equal(rose.length, 1, 'the guard rises');
  assert.ok(w.enemies.count >= alive0 + 8);
  // The other kinds fire through the director.
  const d = world('salt_marsh', 4);
  const deckIdx = (id) => MARSH.deck.findIndex((e) => e.id === id);
  d.director.events.splice(d.director.eventIdx, 0,
    { ...MARSH.deck[deckIdx('bog_lights')].events[0], at: 0, deck: deckIdx('bog_lights'), act: 1, first: true, index: -101 },
    { ...MARSH.deck[deckIdx('peat_fire')].events[0], at: 0, deck: deckIdx('peat_fire'), act: 2, first: true, index: -102 });
  const g0 = d.gems.count;
  const strikes = runCollect(d, 2, EV.TELEGRAPH, IDLE, { halts: 'pass' });
  assert.ok(d.gems.count >= g0 + 10, 'a trail of gems');
  assert.ok(strikes.length >= 5, `the fire's rings, each warned (${strikes.length}; those off the map's edge are left out)`);
  assert.deepEqual(d.result.mapEvents, ['bog_lights', 'peat_fire']);
});

test('the Docks\' cranes and the Marsh\'s cairns: the ring fills, then loads (or the storm) fall on the crowd near it, warned, never hurting you; ready again next act', () => {
  for (const [map, kind, src] of [['drowned_docks', TASK.CRANE, STRIKE_SRC.CRANE], ['salt_marsh', TASK.CAIRN, STRIKE_SRC.CAIRN]]) {
    const w = world(map, 8, { invulnerable: false });
    const t = of(w, kind)[0];
    assert.ok(t, `${map}: its own task`);
    const own = kind === TASK.CRANE ? T.crane : T.cairn;
    for (let k = 0; k < 12; k++) { const e = spawnAt(w, map === 'drowned_docks' ? 'drowned_sailor' : 'salted_dead', t.x - w.player.x + 90 + (k % 4) * 8, t.y - w.player.y + Math.floor(k / 4) * 8); w.enemies.speed[e] = 0; }
    goTo(w, t.x, t.y);
    const hp0 = w.player.hp;
    const evs = [];
    for (let k = 0; k < Math.round((own.openSec + 6) * TPS); k++) {
      run(w, 1, IDLE, { halts: 'pass' });
      const ev = w.events;
      for (let i = 0; i < ev.count; i++) if (ev.type[i] === EV.STRIKE || (ev.type[i] === EV.TELE_TIER && ev.b[i] === -1)) evs.push({ t: ev.type[i], a: ev.a[i], b: ev.b[i] });
    }
    assert.equal(t.state, TASK_STATE.DONE, `${map}: used`);
    const landed = evs.filter((e) => e.t === EV.STRIKE && e.b === src);
    assert.ok(landed.length >= 2, `${map}: its strikes land (${landed.length})`);
    const tells = evs.filter((e) => e.t === EV.TELE_TIER);
    assert.ok(tells.length >= landed.length && tells.every((e) => e.a === TIER.DIM), 'each warned, a dim tell (they can\'t hurt you)');
    assert.equal(w.player.hp, hp0, `${map}: never you`);
    assert.equal(w.result.works, 1);
    crowdArrives(w, true);
    // (X4: one still at work when the act turns finishes first: a cairn's storm runs 20 s.)
    if (t.wave < t.need) {
      assert.equal(t.state, TASK_STATE.DONE, `${map}: still at work when act 2 begins`);
      for (let k = 0; k < Math.round(own.sec * TPS) && t.state === TASK_STATE.DONE; k++) run(w, 1, IDLE, { halts: 'pass' });
      assert.equal(t.wave, t.need, `${map}: its work was finished first`);
    }
    assert.equal(t.state, TASK_STATE.IDLE, 'ready again in act 2');
  }
});

test('finds: hidden at the edges, out from their act, each gives its gift once and joins the result (the codex reads secretsFound)', () => {
  const w = world('drowned_docks', 1, { harbor: { ferry: 1 } });
  const finds = w.secrets.filter((s) => s.gift);
  assert.equal(finds.length, DOCKS.secrets.filter((s) => s.gift).length);
  const later = w.secrets.find((s) => s.id === 'breakwater_point');
  goTo(w, later.x, later.y);
  run(w, 2, IDLE, { halts: 'pass' });
  assert.equal(later.open, false, 'not out before act 2');
  const purse = w.secrets.findIndex((s) => s.id === 'net_bottle');
  const glass0 = w.glass;
  goTo(w, w.secrets[purse].x, w.secrets[purse].y);
  const got = runCollect(w, 2, EV.FIND, IDLE, { halts: 'pass' });
  assert.equal(got.length, 1);
  assert.equal(got[0].a, FIND_GIFT.PEARLS);
  assert.equal(w.glass, glass0 + 25);
  run(w, 5, IDLE, { halts: 'pass' });
  assert.equal(w.glass, glass0 + 25, 'once');
  for (const t of of(w, TASK.LAMP)) t.state = TASK_STATE.DONE;
  crowdArrives(w, true);
  goTo(w, later.x, later.y);
  run(w, 2, IDLE, { halts: 'pass' });
  assert.equal(later.open, true, 'out from act 2');
  const r = buildRunResult(w);
  assert.deepEqual(r.finds, ['net_bottle', 'breakwater_point']);
  assert.ok(r.secretsFound.includes('breakwater_point'), 'the codex key (secret:breakwater_point) opens the character');
  assert.equal(r.act, 2);
});

test('overtime: elite pairs each minute, a boss back at 5:00, the Long Night at 10:00; kill its bosses and dawn: spawns stop, the horde crumbles, the dawn chest, the run ends cleared', () => {
  const w = world('drowned_docks', 12);
  w.tick = 20 * 60 * TPS;
  const D = w.director;
  D.eventIdx = D.events.length;   // (the timeline before overtime isn't this test's)
  overtimeDecide(w, { kind: 'stay' });
  // A pair of elites at the first minute.
  const elites = runCollect(w, 60 * TPS + 2, EV.ELITE_SPAWN, IDLE, { halts: 'pass' });
  assert.ok(elites.length >= 2, 'a pair');
  const pair0 = DOCKS.overtime.repeat[0].pairs[0].map((id) => w.enemyIndex.get(id));
  assert.deepEqual(elites.slice(0, 2).map((e) => e.a), pair0);
  // The first boss back: bring its time forward.
  D.otOnce[0].tick = w.tick + 1;
  const back = runCollect(w, 3, EV.BOSS_SPAWN, IDLE, { halts: 'pass' });
  assert.equal(back.length, 1);
  assert.equal(w.enemyDefs[back[0].a].id, 'harbor_maw');
  for (const b of w.bosses) if (b.alive) { pastGates(b); const e = w.enemies.resolve(b.handle); damageEnemy(w, e, 1e12, 0); }
  run(w, 2, IDLE, { halts: 'pass' });
  // The Long Night: both bosses, the second `gap` s behind.
  D.otOnce[1].tick = w.tick + 1;
  const night = runCollect(w, Math.round((DOCKS.overtime.events[1].gap + 1) * TPS), EV.BOSS_SPAWN, IDLE, { halts: 'pass' });
  assert.deepEqual(night.map((e) => w.enemyDefs[e.a].id), ['harbor_maw', 'the_tidecaller']);
  assert.ok(night[1].tick - night[0].tick >= DOCKS.overtime.events[1].gap * TPS - 1, 'the second behind the first');
  assert.equal(w.result.longNight, true);
  for (const b of w.acts.finale.bosses) { pastGates(b); damageEnemy(w, w.enemies.resolve(b.handle), 1e12, 0); }
  // Dawn.
  let chest = null;
  for (let k = 0; k < 5 * TPS && !chest; k++) {
    if (currentHalt(w)?.kind === 'chest' && currentHalt(w).dawn) { chest = currentHalt(w); break; }
    if (currentHalt(w)) decide(w, currentHalt(w).kind === 'chest' ? { kind: 'ok' } : currentHalt(w).kind === 'draft' ? { kind: 'pick', index: 0 } : currentHalt(w).kind === 'relic' ? { kind: 'pick', index: 0 } : currentHalt(w).kind === 'rune' ? { kind: 'discard' } : { kind: 'keep' });
    else stepWorld(w, IDLE);
  }
  assert.ok(chest, 'the dawn chest opens');
  assert.equal(w.result.dawn, true);
  assert.equal(D.dawn, true);
  let alive = 0;
  for (let i = 0; i < w.enemies.count; i++) if ((w.enemies.flags[i] & EF.DEAD) === 0) alive++;
  assert.equal(alive, 0, 'the horde crumbles');
  let k = 0;
  while (!w.over && k++ < 30 * TPS) { if (currentHalt(w)) decide(w, currentHalt(w).kind === 'chest' ? { kind: 'ok' } : currentHalt(w).kind === 'draft' ? { kind: 'pick', index: 0 } : currentHalt(w).kind === 'rune' ? { kind: 'discard' } : currentHalt(w).kind === 'relic' ? { kind: 'pick', index: 0 } : { kind: 'keep' }); else stepWorld(w, IDLE); }
  assert.equal(w.over?.reason, END.CLEARED, 'the run ends, cleared');
  const r = buildRunResult(w);
  assert.equal(r.dawn, true);
  assert.ok(Array.isArray(r.dawnItems) && r.dawnItems.length >= 1);
});

test('a run in acts replays to the same state (sites, bells, the deck, a crane, overtime)', () => {
  const play = () => {
    const w = world('drowned_docks', 21);
    const crane = w.tasks.findIndex((t) => t.kind === TASK.CRANE);
    for (let k = 0; k < 2400; k++) {
      while (currentHalt(w)) { const h = currentHalt(w); decide(w, h.kind === 'draft' ? { kind: 'pick', index: 0 } : h.kind === 'chest' ? { kind: 'ok' } : h.kind === 'rune' ? { kind: 'discard' } : h.kind === 'relic' ? { kind: 'pick', index: 0 } : h.kind === 'bellpick' ? { kind: 'pick', index: 0 } : { kind: 'keep' }); }
      const t = w.tasks[crane], dx = t.x - w.player.x, dy = t.y - w.player.y, d = Math.hypot(dx, dy);
      stepWorld(w, d > 8 && t.state === TASK_STATE.IDLE ? { mx: Math.round((127 * dx) / d), my: Math.round((127 * dy) / d), buttons: 0 } : IDLE);
      if (k === 1200) { for (const l of of(w, TASK.LAMP)) l.state = TASK_STATE.DONE; crowdArrives(w, true); }
    }
    return w;
  };
  const a = play(), b = play();
  assert.equal(hashWorld(a), hashWorld(b));
  assert.equal(a.acts.act, 2);
});

test('the glossary explains every new term (acts, the held lamp, cranes, cairns, finds, caches, map events, the Long Night, dawn), and the lamp\'s line says lamps stay lit', () => {
  const ids = new Set(GLOSSARY.map((g) => g.id));
  for (const id of ['act', 'held_lamp', 'crane', 'cairn', 'map_event', 'long_night', 'dawn', 'district']) assert.ok(ids.has(id), id);
  const lamp = GLOSSARY.find((g) => g.id === 'lamp');
  assert.ok(!/puts the lamps out/.test(lamp.desc) && /stays lit/.test(lamp.desc), lamp.desc);
});
