// Combat and enemies, 0.9.0 (W3; work/veteran/W3-CONTRACT.md; ARCHITECTURE §5.6, §5.7, §5.13):
// warning tiers, hit-stop requests, what hurt you, phase gates, elite affixes, champions, the
// pounce and the sting, the fast kind, the threat that follows your power, set pieces, and the
// early bands.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DATA, makeWorld, spawnAt, run, eventsOf, IDLE, testData } from './helpers/simworld.js';
import { createWorld, stepWorld, hashWorld } from '../src/sim/world.js';
import { damageEnemy, spawnEnemy, midAttack, POUNCE } from '../src/sim/enemies.js';
import { giveAffixes, AFFIX } from '../src/sim/affixes.js';
import { tellTier, hazardLook, HAZARD_LOOK, hurtSource, setSource, spawnHazard } from '../src/sim/attacks.js';
import { ATTACK_CODE } from '../src/sim/bosses.js';
import { refDps } from '../src/sim/threat.js';
import { hurtLogList } from '../src/sim/player.js';
import { EV, TELE, TIER, HURT, HITSTOP, HIT_GATED, HIT_CAPPED } from '../src/sim/events.js';
import { EF, TPS, ZONE, PK } from '../src/sim/constants.js';
import { ELITE_AFFIXES } from '../src/data/enemies.js';
import { CHEST_ELITE } from '../src/sim/chests.js';

const T = DATA.tuning;
const typeOf = (id) => DATA.enemies.findIndex((e) => e.id === id);

/** Every event, in order, over n ticks (halts passed by their first answer). */
function collect(w, n, frame = IDLE) {
  const out = [];
  for (let k = 0; k < n && !w.over; k++) {
    run(w, 1, frame, { halts: 'pass' });
    const b = w.events;
    for (let i = 0; i < b.count; i++) out.push({ type: b.type[i], x: b.x[i], y: b.y[i], a: b.a[i], b: b.b[i], c: b.c[i], d: b.d[i], tick: w.tick - 1 });
  }
  return out;
}
const only = (evs, type) => evs.filter((e) => e.type === type);

/** A boss beside you (dx px east), standing still, its turn about to come. */
function bossNear(id, dx = 90, cfg = {}) {
  const w = makeWorld({ invulnerable: true, ...cfg }, { events: [{ at: 0, event: 'boss', enemy: id }] });
  run(w, 1);
  const b = w.bosses[0], e = w.enemies.resolve(b.handle);
  w.enemies.speed[e] = 0;
  w.enemies.x[e] = w.enemies.px[e] = w.player.x + dx; w.enemies.y[e] = w.enemies.py[e] = w.player.y;
  return { w, b, e };
}
function nextAttack(b, key) { const ph = b.def.phases[b.phase]; b.next = Math.max(0, ph.attacks.indexOf(key)); b.timer = 0; b.state = 0; }

// ---------------------------------------------------------------- warning tiers

test('warnings: every TELEGRAPH is followed by its TELE_TIER; ordinary ones that threaten you are FULL up to the cap, the rest DIM; a boss\'s MAJOR', () => {
  const w = makeWorld({ invulnerable: true });
  const crabs = [[100, 0], [-100, 0], [0, 100], [0, -100], [71, 71]].map(([dx, dy]) => { const c = spawnAt(w, 'mud_crab', dx, dy); w.enemies.speed[c] = 0; return c; });
  const evs = collect(w, 1);
  const tele = evs.map((e, i) => [e, evs[i + 1]]).filter(([e]) => e.type === EV.TELEGRAPH);
  assert.equal(tele.length, 5, 'each crab winds up');
  for (const [t, tier] of tele) {
    assert.equal(tier.type, EV.TELE_TIER, 'its tier comes next');
    assert.deepEqual([tier.x, tier.y, tier.c], [t.x, t.y, t.b], 'same place, same ticks');
    assert.ok(crabs.map((c) => w.enemies.handle(c)).includes(tier.b) && tier.d === typeOf('mud_crab'), 'the crab that made it');
  }
  assert.deepEqual(tele.map(([, t]) => t.a).sort(), [TIER.FULL, TIER.FULL, TIER.FULL, TIER.FULL, TIER.DIM], `at most ${T.enemies.tellFullMax} full at once`);
  assert.equal(tellTier(w, false, false, 60), TIER.DIM, 'one that misses you is a short tell');
  w.tick += 120;
  assert.equal(tellTier(w, false, true, 60), TIER.FULL, 'a place frees once a warning ends');
  const { w: bw, b } = bossNear('the_tidecaller');
  nextAttack(b, 'slam');
  const bt = only(collect(bw, 2), EV.TELE_TIER);
  assert.equal(bt[0].a, TIER.MAJOR, 'a boss\'s warning is the full shape');
});

// ---------------------------------------------------------------- hit-stop and what hurt you

test('hit-stop is asked for only on real hits: a touch, a slam that lands, an elite or boss kill; never a missed slam or a drain', () => {
  const touch = makeWorld();
  spawnAt(touch, 'drowned_sailor', 0, 0);
  const t = collect(touch, 2);
  const hurt = only(t, EV.PLAYER_HURT)[0];
  assert.deepEqual([hurt.c, hurt.d], [HURT.CONTACT, typeOf('drowned_sailor')], 'a touch, and whose');
  assert.equal(only(t, EV.HIT_STOP)[0].a, HITSTOP.HURT);
  // A slam that misses: the boom, no stop. One that lands: a boss hit.
  for (const [dx, lands] of [[200, false], [60, true]]) {
    const { w, b } = bossNear('the_tidecaller', dx, { invulnerable: false });
    nextAttack(b, 'slam');
    const evs = collect(w, 80);
    assert.ok(only(evs, EV.EXPLODE).some((e) => e.b < 0), 'the slam goes off');
    const stops = only(evs, EV.HIT_STOP);
    if (!lands) assert.equal(stops.length, 0, 'a missed slam holds nothing');
    else {
      assert.ok(stops.some((s) => s.a === HITSTOP.BOSS_HIT), 'a landed slam is a boss hit');
      const h = only(evs, EV.PLAYER_HURT).find((x) => x.c === HURT.BOSS);
      assert.equal(h.d, typeOf('the_tidecaller'));
      assert.deepEqual([w.lastHurt.kind, w.lastHurt.attack, w.lastHurt.name], [HURT.BOSS, 'slam', 'slam']);
    }
  }
  // A leech's drain: a hurt that says so, and no stop.
  const d = makeWorld();
  spawnAt(d, 'leech', 0, 0);
  const de = collect(d, 3 * TPS);
  const drains = only(de, EV.PLAYER_HURT).filter((x) => x.c === HURT.DRAIN);
  assert.ok(drains.length >= 1 && drains.every((x) => x.d === typeOf('leech')));
  for (const dr of drains) assert.ok(!de.some((e) => e.type === EV.HIT_STOP && e.tick === dr.tick), 'no hit-stop on a drain');
  // Kills.
  const k = makeWorld({ invulnerable: true });
  const el = spawnAt(k, 'drowned_sailor', 150, 0, { elite: true });
  damageEnemy(k, el, 1e9, 0);
  run(k, 1, IDLE, { halts: 'pass' });
  assert.ok(eventsOf(k, EV.HIT_STOP).some((s) => s.a === HITSTOP.ELITE_KILL));
});

test('what hurt you: a gunner\'s shot, a Lantern Eater\'s pool, a boss\'s pools by name, a storm\'s strike; the last hits in order', () => {
  const w = makeWorld();
  const g = spawnAt(w, 'wreck_gunner', 150, 0); w.enemies.speed[g] = 0;
  const shot = only(collect(w, 8 * TPS), EV.PLAYER_HURT).find((h) => h.c === HURT.SHOT);
  assert.ok(shot && shot.d === typeOf('wreck_gunner'), 'a shot, and whose');
  const p = makeWorld();
  const le = spawnAt(p, 'lantern_eater', 100, 0); p.enemies.speed[le] = 0;
  const pool = only(collect(p, 9 * TPS), EV.PLAYER_HURT).find((h) => h.c === HURT.HAZARD);
  assert.ok(pool && pool.d === typeOf('lantern_eater'), 'a pool, and whose');
  // A boss's pool says which attack (the death recap's "the Tidecaller's tide line").
  const { w: bw, b, e } = bossNear('the_tidecaller', 200, { invulnerable: false });
  b.timer = 1e9;
  setSource(bw, HURT.BOSS, e, b.info.tide, HAZARD_LOOK.BOSS, true);
  const z = spawnHazard(bw, bw.player.x, bw.player.y, 18, 0.8, 2, 10);
  assert.equal(hazardLook(bw, z), HAZARD_LOOK.BOSS);
  const bh = only(collect(bw, 70), EV.PLAYER_HURT).find((h) => h.c === HURT.BOSS);
  assert.ok(bh && bh.d === typeOf('the_tidecaller') && bw.lastHurt.name === 'tide line');
  // A zone found by where it stands; nothing there: a ground hazard of no one's.
  const out = new Int32Array(2);
  assert.equal(hurtSource(bw, -5, -5, out), null);
  assert.deepEqual([...out], [HURT.HAZARD, -1]);
  const log = hurtLogList(bw);
  assert.ok(log.length >= 1 && log.at(-1).name === 'tide line' && log.every((r, i) => i === 0 || r.tick >= log[i - 1].tick), 'oldest first');
});

// ---------------------------------------------------------------- phase gates (ruling 5)

test('phase gates: a boss holds at each notch until it has thrown that phase\'s signature, throws it next, then dies only after its last', () => {
  const { w, b, e } = bossNear('harbor_maw', 60);
  const max = w.enemies.maxHp[e];
  assert.deepEqual([...b.notches], [0.5]);
  b.spawnTick -= b.minFightTicks;               // past its 15 s floor
  b.timer = 1e9;
  damageEnemy(w, e, 1e9, 0);
  assert.ok((eventsOf(w, EV.HIT)[0].c & HIT_GATED) !== 0, 'the HIT says a gate held it');
  assert.ok(Math.abs(w.enemies.hp[e] - (max * 0.5 + 1)) < 1e-3 * max, 'held just above its notch');
  assert.deepEqual(eventsOf(w, EV.BOSS_GATE).map((g) => [g.a, g.c]), [[1, 0]]);
  assert.ok(b.held);
  // Its next attack is its signature (the lure), whatever the rotation says.
  nextAttack(b, 'slam');
  let evs = collect(w, 2.5 * TPS);
  const first = only(evs, EV.BOSS_ATTACK)[0];
  assert.deepEqual([first.a, first.c], [ATTACK_CODE.lure, 1], 'the lure, its signature');
  assert.ok(only(evs, EV.BOSS_GATE).some((g) => g.a === 2), 'thrown: the gate opens');
  b.timer = 1e9;
  damageEnemy(w, w.enemies.resolve(b.handle), 1e9, 0);
  assert.equal(w.enemies.hp[w.enemies.resolve(b.handle)], 1, 'down to its death\'s gate');
  evs = collect(w, 1);
  assert.deepEqual(only(evs, EV.BOSS_PHASE).map((p) => p.a), [1]);
  damageEnemy(w, w.enemies.resolve(b.handle), 1e9, 0);
  assert.equal(w.enemies.hp[w.enemies.resolve(b.handle)], 1, 'it can\'t die before its last phase\'s signature');
  nextAttack(b, 'slam');
  evs = collect(w, 3 * TPS);
  assert.ok(only(evs, EV.BOSS_ATTACK).some((a) => a.a === ATTACK_CODE.charge_line && a.c === 1), 'the charge, its last signature');
  assert.ok(only(evs, EV.BOSS_GATE).some((g) => g.a === 2));
  damageEnemy(w, w.enemies.resolve(b.handle), 1e9, 0);
  run(w, 1, IDLE, { halts: 'pass' });
  assert.equal(w.director.bossesAlive, 0, 'dead');
});

test('phase gates: the 15 s floor still caps a fresh boss; a gate that waits too long opens anyway; every boss phase has a signature and every attack a name', () => {
  const { w, e } = bossNear('old_grey');
  damageEnemy(w, e, 1e9, 0);
  const hit = eventsOf(w, EV.HIT)[0];
  assert.ok((hit.c & HIT_CAPPED) !== 0 && w.enemies.hp[e] > 0, 'the floor');
  const s = bossNear('harbor_maw', 1200, { tuning: { bosses: { gateMaxHold: 0.5 } } });   // too far to attack
  s.b.spawnTick -= s.b.minFightTicks;
  damageEnemy(s.w, s.e, 1e9, 0);
  assert.ok(s.b.held);
  assert.ok(only(collect(s.w, 40), EV.BOSS_GATE).some((g) => g.a === 2), 'opened after gateMaxHold');
  for (const bd of DATA.bosses) {
    assert.equal(bd.minFight, 15, `${bd.id}: a 15 s floor`);
    for (const ph of bd.phases) assert.ok(ph.attacks.includes(ph.signature), `${bd.id}: a signature of its own`);
    for (const [k, a] of Object.entries(bd.attacks)) assert.ok(/^[a-z ]+$/.test(a.name), `${bd.id}.${k}: a name said mid-sentence`);
  }
});

// ---------------------------------------------------------------- elite affixes

test('affixes: Warded takes 3 hits to break; Herald brings 6; Tethered shares damage with its 2 links until they die', () => {
  const w = makeWorld({ invulnerable: true });
  const E = w.enemies;
  const a = spawnAt(w, 'drowned_sailor', 150, 0, { elite: true, affixes: 0 });
  giveAffixes(w, a, AFFIX.WARDED, spawnEnemy);
  const hp = E.hp[a];
  const wards = [];
  for (let k = 0; k < 4; k++) { damageEnemy(w, a, 100, 0); damageEnemy(w, a, 100, 0); wards.push(E.ward[a]); w.tick += 10; }
  assert.deepEqual(wards, [2, 1, 0, 0], 'one hit a moment strips one');
  assert.equal(E.hp[a], hp - 200, 'the ward took the first three hits; the fourth moment\'s two land');
  const before = E.count;
  const h = spawnAt(w, 'bilge_rat', -150, 0, { elite: true, affixes: 0 });
  giveAffixes(w, h, AFFIX.HERALD, spawnEnemy);
  assert.equal(E.count - before, 1 + T.affixes.herald, 'and its six');
  const t = spawnAt(w, 'drowned_sailor', 0, 160, { elite: true, affixes: 0 });
  giveAffixes(w, t, AFFIX.TETHERED, spawnEnemy);
  const tHandle = E.handle(t);
  const links = [E.link0[t], E.link1[t]].map((v) => E.resolve(v - 1));
  assert.ok(links.every((l) => l >= 0));
  for (const l of links) E.hp[l] = E.maxHp[l] = 1000;
  const th = E.hp[t];
  damageEnemy(w, t, 90, 0);
  assert.ok(Math.abs(E.hp[t] - (th - 30)) < 1e-3 && links.every((l) => Math.abs(E.hp[l] - 970) < 1e-3), 'a third each');
  for (const l of links) damageEnemy(w, l, 1e9, 0);
  const evs = collect(w, 2);
  assert.equal(only(evs, EV.TETHER).filter((x) => x.a === 0 && x.b === tHandle).length, 2, 'both links let go, said at once');
  const ti = E.resolve(tHandle);
  const left = E.hp[ti];
  damageEnemy(w, ti, 90, 0);
  assert.ok(Math.abs(E.hp[ti] - (left - 90)) < 1e-3, 'its links dead, it takes the whole hit');
});

test('affixes: Molten leaves warned fire that hurts as burning ground; Brine slows you 30% for 2s; one affix at Tide 0, two from Tide 2, none on a captain', () => {
  const w = makeWorld({ invulnerable: true });
  const m = spawnAt(w, 'drowned_sailor', 150, 0, { elite: true, affixes: 0 });
  w.enemies.speed[m] = 0;
  giveAffixes(w, m, AFFIX.MOLTEN, spawnEnemy);
  const evs = collect(w, Math.round(T.affixes.molten.every * TPS) + 2);
  const fire = evs.findIndex((e) => e.type === EV.TELEGRAPH && e.a === TELE.CIRCLE);
  assert.ok(fire >= 0 && evs[fire + 1].type === EV.TELE_TIER, 'a warned patch');
  const Z = w.zones;
  let z = -1;
  for (let i = 0; i < Z.count; i++) if (Z.kind[i] === ZONE.HAZARD) z = i;
  assert.equal(hazardLook(w, z), HAZARD_LOOK.FIRE);
  const out = new Int32Array(2);
  assert.equal(hurtSource(w, Z.x[z], Z.y[z], out).name, 'burning ground');
  assert.deepEqual([...out], [HURT.HAZARD, typeOf('drowned_sailor')]);
  // Brine: its touch slows you.
  const b = makeWorld();
  const be = spawnAt(b, 'drowned_sailor', 0, 0, { elite: true, affixes: 0 });
  giveAffixes(b, be, AFFIX.BRINE, spawnEnemy);
  run(b, 1, IDLE, { halts: 'pass' });
  b.enemies.x[be] = b.player.x + 600;
  const slow = only(collect(b, 2), EV.PLAYER_SLOW);
  assert.deepEqual(slow.map((s) => [Math.round(s.a * 100) / 100, s.b]), [[0.3, 2]]);
  const x0 = b.player.x;
  run(b, 30, { mx: 127, my: 0, buttons: 0 }, { halts: 'pass' });
  assert.ok(Math.abs(b.player.x - x0 - T.player.speed * 0.7 * 0.5) < 1.5, `walks at 70% (${(b.player.x - x0).toFixed(1)} px in 0.5s)`);
  run(b, 2 * TPS, IDLE, { halts: 'pass' });
  assert.equal(b.player.slowPct, 0, 'over after 2s');
  // How many.
  const bits = (tide) => {
    const c = makeWorld({ invulnerable: true, tide, tuning: { affixes: { perElite: 1, twoFromTide: 2 } } });
    const e = spawnAt(c, 'drowned_sailor', 150, 0, { elite: true });
    let n = 0;
    for (let v = c.enemies.affix[e]; v; v &= v - 1) n++;
    return n;
  };
  assert.deepEqual([bits(0), bits(1), bits(2), bits(5)], [1, 1, 2, 2]);
  const mu = makeWorld({ invulnerable: true, tuning: { affixes: { perElite: 1 } } }, { events: [{ at: 0, event: 'muster', name: 'M', enemy: 'drowned_bosun', escort: 'drowned_sailor', count: 4, radius: 30 }] });
  run(mu, 1);
  const cap = only(collect(mu, 1).concat(eventsOf(mu, EV.MUSTER).map((x) => ({ ...x, type: EV.MUSTER }))), EV.MUSTER);
  assert.ok(cap.length >= 0);
  let captain = -1;
  for (let i = 0; i < mu.enemies.count; i++) if ((mu.enemies.flags[i] & EF.ELITE) !== 0) captain = i;
  assert.equal(mu.enemies.affix[captain], 0, 'a captain has none');
  for (const a of ELITE_AFFIXES) {
    assert.ok(/^[A-Z][a-z]+$/.test(a.name) && a.desc.endsWith('.') && !/[!—]|\byour\b/i.test(a.desc), `${a.id}: plain words`);
    assert.equal(AFFIX[a.id.toUpperCase()], a.bit);
  }
});

// ---------------------------------------------------------------- champions

const champMap = (attack, chest = 'boss') => ({ events: [{ at: 0, event: 'muster', name: 'The Test Watch', enemy: 'drowned_sailor', escort: 'drowned_sailor', count: 2, radius: 36, champion: { name: 'The Test', chest, attack } }] });
function champNear(attack, dx = 60, cfg = {}, chest) {
  const w = makeWorld({ invulnerable: false, ...cfg }, champMap(attack, chest));
  const arrive = collect(w, 1);
  const c = w.champions[0], e = w.enemies.resolve(c.handle);
  w.enemies.speed[e] = 0;
  w.enemies.x[e] = w.enemies.px[e] = w.player.x + dx; w.enemies.y[e] = w.enemies.py[e] = w.player.y;
  for (let i = 0; i < w.enemies.count; i++) if (i !== e) w.enemies.x[i] = w.player.x + 900;   // its crew far off
  c.timer = 0;
  return { w, c, e, arrive };
}

test('champions: the 5:00 and 15:00 musters are named champions; one warns as a MAJOR shape, stands where it warned, can\'t be held, and its anchor lands where you stood', () => {
  for (const m of DATA.maps) {
    const champs = m.timeline.events.filter((e) => e.champion).map((e) => [e.at, e.champion.name]);
    assert.deepEqual(champs.map((c) => c[0]).filter((t) => t !== 1050), [300, 900], `${m.id}: at 5:00 and 15:00 (and the Docks' Quartermaster at 17:30, ruling 17 W7)`);
  }
  const anchor = { type: 'anchor', name: 'anchor', warn: 1, every: 3, reach: 400, radius: 30, damage: 10 };
  const { w, c, e, arrive } = champNear(anchor);
  assert.deepEqual(only(arrive, EV.CHAMPION).map((x) => x.a), [1]);
  assert.equal(c.name, 'The Test');
  let evs = collect(w, 1);
  const tele = evs.findIndex((x) => x.type === EV.TELEGRAPH && x.a === TELE.RING);
  assert.ok(tele >= 0 && evs[tele + 1].a === TIER.MAJOR, 'a MAJOR ring');
  assert.ok(Math.abs(evs[tele].x - w.player.x) < 2, 'where you stand');
  assert.ok((w.enemies.flags[e] & EF.WARNING) !== 0 && midAttack(w.enemies, e, w.bosses), 'warning: never held');
  const x0 = w.enemies.x[e];
  evs = collect(w, TPS);
  assert.equal(w.enemies.x[e], x0, 'it stood where it warned');
  const h = only(evs, EV.PLAYER_HURT).find((x) => x.c === HURT.ATTACK);
  assert.ok(h && h.d === typeOf('drowned_sailor') && w.lastHurt.name === 'anchor');
  assert.ok(only(evs, EV.HIT_STOP).some((s) => s.a === HITSTOP.BOSS_HIT), 'a champion\'s hit holds like a boss\'s');
  // Walk out of the ring and it misses.
  const m2 = champNear(anchor);
  collect(m2.w, 2);
  const miss = collect(m2.w, TPS, { mx: 0, my: 127, buttons: 0 });
  assert.equal(only(miss, EV.PLAYER_HURT).filter((x) => x.c === HURT.ATTACK).length, 0, 'out of the ring');
});

test('champions: a rope drag drags you along its line; a salt wall lays a row of brine across your way; a 5:00 champion pays an elite\'s chest', () => {
  const rope = { type: 'rope_drag', name: 'rope drag', warn: 1, every: 9, reach: 400, length: 220, width: 18, damage: 10, drag: 70, dragSec: 0.35 };
  const { w, e } = champNear(rope, 150);
  const evs = collect(w, TPS + 2);
  assert.ok(only(evs, EV.PLAYER_HURT).some((x) => x.c === HURT.ATTACK) && w.lastHurt.name === 'rope drag');
  const x0 = w.player.x;
  run(w, 10, IDLE, { halts: 'pass' });
  assert.ok(w.player.x > x0 + 10 && w.player.x < w.enemies.x[e], 'dragged toward him');
  const wall = { type: 'salt_wall', name: 'salt wall', warn: 1, every: 9, reach: 400, length: 300, spacing: 26, radius: 14, last: 6, damage: 8 };
  const s = champNear(wall, 150);
  collect(s.w, 1);
  const Z = s.w.zones;
  let brine = 0;
  for (let i = 0; i < Z.count; i++) if (Z.kind[i] === ZONE.HAZARD && hazardLook(s.w, i) === HAZARD_LOOK.BRINE) brine++;
  assert.equal(brine, Math.round(300 / 26));
  const anchor = { type: 'anchor', name: 'anchor', warn: 1, every: 3, reach: 400, radius: 30, damage: 10 };
  const k = champNear(anchor, 300, { invulnerable: true }, 'elite');
  damageEnemy(k.w, k.e, 1e9, 0);
  const fell = collect(k.w, 2);
  assert.ok(only(fell, EV.CHAMPION).some((x) => x.a === 0), 'it falls');
  const P = k.w.pickups;
  const chests = [];
  for (let i = 0; i < P.count; i++) if (P.kind[i] === PK.CHEST) chests.push(P.a[i]);
  assert.deepEqual(chests, [CHEST_ELITE], 'an elite\'s chest');
});

// ---------------------------------------------------------------- the pounce, the sting, the fast kind

test('a rat pounces once: it crouches (a warned line, held still), leaps along it at full speed, and bites what it reaches', () => {
  const w = makeWorld({ tuning: { pace: { speed: 0.5 } } });
  const r = spawnAt(w, 'bilge_rat', 70, 0);
  const E = w.enemies;
  let evs = collect(w, 1);
  assert.equal(E.aiState[r], POUNCE.CROUCH);
  assert.ok((E.flags[r] & EF.WARNING) !== 0 && midAttack(E, r));
  const line = evs.find((x) => x.type === EV.TELEGRAPH);
  assert.equal(line.a, TELE.LINE);
  const x0 = E.x[r];
  evs = collect(w, Math.round(T.enemies.telegraphMin * TPS) - 1);
  assert.equal(E.x[r], x0, 'held where it warned');
  evs = collect(w, 30);
  const bite = only(evs, EV.PLAYER_HURT)[0];
  assert.ok(bite && bite.c === HURT.CONTACT && bite.d === typeOf('bilge_rat'), 'it bit');
  assert.equal(E.aiState[r], POUNCE.DONE, 'once');
  // The fast kind keeps its speed under the pace dial; a sailor doesn't.
  const q = makeWorld({ invulnerable: true, tuning: { pace: { speed: 0.5 } } });
  const rat = spawnAt(q, 'bilge_rat', 600, 0), sailor = spawnAt(q, 'drowned_sailor', 0, 600);
  const rx = q.enemies.x[rat], sy = q.enemies.y[sailor];
  run(q, 60, IDLE, { halts: 'pass' });
  assert.ok(Math.abs((rx - q.enemies.x[rat]) - DATA.enemies[typeOf('bilge_rat')].speed) < 3, 'the rat at its full 52 px/s');
  assert.ok(Math.abs((sy - q.enemies.y[sailor]) - DATA.enemies[typeOf('drowned_sailor')].speed * 0.5) < 3, 'the sailor at half');
});

test('a midge\'s bite slows you 10% more each time, up to 30%, for 3s after the last', () => {
  const w = makeWorld({ tuning: { player: { contactIframes: 0.05 } } });
  const m = spawnAt(w, 'midge_cloud', 0, 0);
  w.enemies.aiState[m] = POUNCE.DONE;
  const seen = [];
  for (let k = 0; k < 40; k++) { run(w, 1, IDLE, { halts: 'pass' }); w.enemies.x[m] = w.player.x; w.enemies.y[m] = w.player.y; w.player.hp = 100; seen.push(w.player.slowPct); }
  assert.ok(seen.includes(0.1) && Math.max(...seen) === 0.3, `stacks to 30% (${[...new Set(seen)].join(', ')})`);
  w.enemies.x[m] = w.player.x + 800;
  run(w, 3 * TPS + 2, IDLE, { halts: 'pass' });
  assert.equal(w.player.slowPct, 0);
});

// ---------------------------------------------------------------- threat, the bands, set pieces

test('threat follows your power: damage a second over the last 30 s against the expected, to the power 0.4, held from 1 to its max, from 4:00; touches and new elites feel it', () => {
  const R = T.threat;
  assert.equal(refDps(R, 0), R.ref[0][1]);
  assert.equal(refDps(R, 99), R.ref.at(-1)[1]);
  assert.ok(Math.abs(refDps(R, 1) - (R.ref[0][1] + R.ref[1][1]) / 2) < 1e-9);
  const w = makeWorld({ tuning: { threat: { max: 1.5, from: 0 } } });
  for (let s = 0; s <= R.span + 1; s++) { w.threat.dealt = s * 2 * R.ref[0][1]; run(w, TPS, IDLE, { halts: 'pass' }); }
  assert.ok(Math.abs(w.threat.dps - 2 * R.ref[0][1]) < 1, `dps ${w.threat.dps}`);
  assert.ok(w.threat.mul > 1.1 && Math.abs(w.threat.mul - (2 * R.ref[0][1] / refDps(R, w.tick / 3600)) ** R.exp) < 0.02, `mul ${w.threat.mul}`);
  const mul = w.threat.mul;
  const el = spawnAt(w, 'drowned_sailor', 150, 0, { elite: true });
  const plain = DATA.enemies[typeOf('drowned_sailor')].hp * w.director.hpMul * T.enemies.eliteHp;
  assert.ok(Math.abs(w.enemies.maxHp[el] / plain - mul) < 1e-3, 'an elite\'s health');
  spawnAt(w, 'drowned_sailor', 0, 0);
  run(w, 1, IDLE, { halts: 'pass' });
  const hit = eventsOf(w, EV.PLAYER_HURT).find((h) => h.c === HURT.CONTACT);
  const want = DATA.enemies[typeOf('drowned_sailor')].contact * w.director.contactMul * mul;
  assert.ok(hit && Math.abs(hit.a - want) < 0.05, `a touch ${hit?.a} for ${want}`);
  const h0 = hashWorld(w); w.threat.mul += 0.01; assert.notEqual(hashWorld(w), h0, 'the hash sees it');
  const early = makeWorld({ tuning: { threat: { max: 1.5 } } });
  for (let s2 = 0; s2 <= 40; s2++) { early.threat.dealt = s2 * 100 * R.ref[0][1]; run(early, TPS, IDLE, { halts: 'pass' }); }
  assert.equal(early.threat.mul, 1, 'nothing before 4:00, however strong');
  const weak = makeWorld({ tuning: { threat: { max: 1.5 } } });
  run(weak, 40 * TPS, IDLE, { halts: 'pass' });
  assert.equal(weak.threat.mul, 1, 'a weak build is never eased');
});

test('the bands: a band\'s own pace multiplies the density dial; a Tide\'s density raises every floor; the early bands are busier than the dial alone', () => {
  const bands = [{ from: 0, to: 60, roster: { fog_wisp: 1 }, density: [100, 100], min: 10, pace: 2 }];
  const w = makeWorld({ invulnerable: true, tuning: { pace: { density: 0.3 } } }, { bands });
  run(w, 2);
  assert.ok(Math.abs(w.director.target - 60) < 1e-9, `100 x 0.3 x 2 (${w.director.target})`);
  const f = makeWorld({ invulnerable: true, densityMul: 1.5, tuning: { pace: { density: 0.01 }, director: { floorTide: 1 } } }, { bands: [{ from: 0, to: 60, roster: { fog_wisp: 1 }, density: [100, 100], min: 12 }] });
  run(f, 2);
  assert.equal(f.director.target, 18, 'the floor times the Tide\'s density');
  for (const m of DATA.maps) {
    const early = m.timeline.bands.filter((b) => b.to <= 300);
    assert.ok(early.length >= 3 && early.every((b) => b.pace > 1), `${m.id}: the first five minutes have their own pace`);
  }
  const rat = DATA.enemies[typeOf('bilge_rat')], midge = DATA.enemies[typeOf('midge_cloud')];
  assert.ok(rat.quick && midge.quick && rat.ai.pounce && midge.sting, 'one fast kind a map, the commonest with a threat of its own');
  assert.ok(DATA.maps[0].timeline.bands[0].roster.bilge_rat > 0, 'rats from 0:00 on the Docks');
});

test('a whole minute of a real Docks run: every warning has its tier, every hurt its kind, and nothing breaks', () => {
  const w = createWorld({ seed: 'w3', map: 'drowned_docks', character: 'lamplighter', invulnerable: true }, testData());
  w.tick = 4 * 3600;   // the 5:00 champion comes inside the minute
  const evs = collect(w, 75 * TPS, { mx: 60, my: -30, buttons: 0 });
  for (let i = 0; i < evs.length; i++) if (evs[i].type === EV.TELEGRAPH) assert.equal(evs[i + 1].type, EV.TELE_TIER, `the warning at ${evs[i].tick}`);
  for (const h of only(evs, EV.PLAYER_HURT)) assert.ok(h.c >= 1 && h.c <= 7, `a hurt of kind ${h.c}`);
  assert.ok(only(evs, EV.CHAMPION).some((c) => c.a === 1), 'the First Mate came');
});
