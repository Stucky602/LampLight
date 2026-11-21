// Behavior tests for sim/bosses.js that a mutation run let through (the sweep, S4 D4): where an
// attack lands and whom it hurts, fired at a known pose. The Salt Widow's lightning is laid in
// front of her, toward you; the Old Grey's stab hits along its warned line at any angle, and not
// beside it or past its end; its call brings eels up in the water nearest each point of its ring;
// and a boss's warning is never dimmed by a crowd's.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DATA, testData, makeWorld, spawnAt, run, runCollect } from './helpers/simworld.js';
import { createWorld } from '../src/sim/world.js';
import { registerBoss, BOSS_STATE } from '../src/sim/bosses.js';
import { EV, TELE, TIER } from '../src/sim/events.js';
import { EF, TPS } from '../src/sim/constants.js';
import { TILE } from '../src/sim/terrain.js';
import { sincosInto, TAU } from '../src/lib/fmath.js';

const DATA_T = testData();
const COLS = 256;
function marsh(cfg = {}) {
  const w = createWorld({ seed: 5, map: 'salt_marsh', character: 'tester', densityCap: 0, invulnerable: true, ...cfg }, DATA_T);
  w.director.eventIdx = w.director.events.length;
  return w;
}
const place = (w, x, y) => { w.player.x = w.player.px = x; w.player.y = w.player.py = y; };
/** A boss at an offset from you, its fight-length floor behind it; you with health to spare. */
function boss(id, { dx = 120, dy = 0, at = null } = {}) {
  const w = at ?? makeWorld({ invulnerable: false });
  const e = spawnAt(w, id, dx, dy);
  const b = registerBoss(w, e, false);
  b.spawnTick = -1e6;
  w.player.hp = 1e5; w.stats.maxHp = 1e5;
  return { w, e, b };
}
/** Start the boss's attack number `k` (its first phase's list) now. */
const attack = (w, b, k) => { b.next = k; b.timer = 0; b.state = BOSS_STATE.WALK; };
const def = (id) => DATA.bosses.find((x) => x.id === id);
const attackIndex = (id, key) => { const k = def(id).phases[0].attacks.indexOf(key); assert.ok(k >= 0, `${id} throws ${key} in its first phase`); return k; };

test('bosses (mutation): the Salt Widow\'s lightning is laid in front of her, toward you, ring by ring, from any side', () => {
  const march = def('salt_widow').attacks.march;
  for (const [dx, dy] of [[200, 0], [-200, 0], [0, 200], [-120, -160]]) {
    const w = marsh({ invulnerable: false });
    place(w, (100 + 0.5) * TILE, (100 + 0.5) * TILE);
    const { e, b } = boss('salt_widow', { at: w, dx, dy });
    const bx = w.enemies.x[e], by = w.enemies.y[e];
    attack(w, b, attackIndex('salt_widow', 'march'));
    const rings = runCollect(w, 2, EV.TELEGRAPH).filter((t) => t.a === TELE.RING);
    assert.equal(rings.length, march.count);
    const d = Math.hypot(w.player.x - bx, w.player.y - by), ux = (w.player.x - bx) / d, uy = (w.player.y - by) / d;
    rings.forEach((r, k) => {
      const want = [bx + ux * march.step * (k + 1), by + uy * march.step * (k + 1)];
      assert.ok(Math.hypot(r.x - want[0], r.y - want[1]) < 1.5, `ring ${k + 1} from (${dx}, ${dy}): at ${r.x.toFixed(0)},${r.y.toFixed(0)}, wanted ${want[0].toFixed(0)},${want[1].toFixed(0)}`);
      // In front of her: nearer you than she is (the rings past you are behind you, not behind her).
      assert.ok((r.x - bx) * ux + (r.y - by) * uy > 0, `ring ${k + 1} is on your side of her`);
    });
    assert.ok(Math.hypot(rings[0].x - w.player.x, rings[0].y - w.player.y) < d, 'the first ring is between her and you');
  }
});

test('bosses (mutation): the Salt Widow\'s lightning hurts you where its rings are, and not beside the line', () => {
  const march = def('salt_widow').attacks.march;
  const k = attackIndex('salt_widow', 'march');
  // You stand still, 88 px in front of her: the second ring is on you.
  for (const [where, hit] of [['on the line', true], ['beside it', false]]) {
    const w = marsh({ invulnerable: false });
    place(w, (100 + 0.5) * TILE, (100 + 0.5) * TILE);
    const { e, b } = boss('salt_widow', { at: w, dx: march.step * 2, dy: 0 });
    w.enemies.speed[e] = 0;
    attack(w, b, k);
    run(w, 2);
    if (!hit) place(w, w.player.x, w.player.y + march.radius + w.tuning.player.radius + 30);
    const hp = w.player.hp;
    run(w, Math.ceil((march.warn + march.count * march.stagger + 0.5) * TPS));
    if (hit) assert.ok(hp - w.player.hp >= march.damage * 0.5, `${where}: struck (${hp - w.player.hp})`);
    else assert.equal(w.player.hp, hp, `${where}: untouched`);
  }
});

test('bosses (mutation): the Old Grey\'s stab hits along its warned line at an angle, not beside it, and not past its end', () => {
  const stab = def('old_grey').attacks.stab;
  const k = attackIndex('old_grey', 'stab');
  // The line runs from it toward where you stood when it warned: 3-4-5, so neither axis is 0 or 1.
  const pose = (alongPx, sidePx) => {
    const { w, e, b } = boss('old_grey', { dx: 80, dy: 60 });
    const bx = w.enemies.x[e], by = w.enemies.y[e];
    attack(w, b, k);
    const tele = runCollect(w, 2, EV.TELEGRAPH).find((t) => t.a === TELE.LINE);
    assert.ok(tele, 'the line is warned');
    assert.ok(Math.abs(b.adx - (-0.8)) < 0.02 && Math.abs(b.ady - (-0.6)) < 0.02, `aimed at you (${b.adx.toFixed(2)}, ${b.ady.toFixed(2)})`);
    // Move to a point `alongPx` down the line and `sidePx` off it, and wait for the stab.
    place(w, bx + b.adx * alongPx - b.ady * sidePx, by + b.ady * alongPx + b.adx * sidePx);
    const hp = w.player.hp;
    const hurts = runCollect(w, Math.ceil((stab.warn + 0.3) * TPS), EV.PLAYER_HURT);
    assert.equal(w.enemies.x[e], bx, '(it stands for the stab)');
    return { lost: hp - w.player.hp, hurts };
  };
  const reach = stab.width / 2 + DATA.tuning.player.radius;
  assert.ok(pose(100, 0).lost >= stab.damage * 0.5, 'where you stood: stabbed');
  assert.ok(pose(40, 0).lost >= stab.damage * 0.5, 'near it, on the line: stabbed');
  assert.ok(pose(stab.length - 6, 0).lost >= stab.damage * 0.5, 'at the line\'s far end: stabbed');
  assert.ok(pose(100, reach - 2).lost >= stab.damage * 0.5, 'at the line\'s edge: stabbed');
  assert.equal(pose(100, reach + 6).lost, 0, 'just beside the line: untouched');
  assert.equal(pose(100, -(reach + 6)).lost, 0, 'just beside it, the other side: untouched');
  assert.equal(pose(stab.length + reach + 8, 0).lost, 0, 'past its end: untouched');
  assert.equal(pose(-70, 0).lost, 0, 'behind it (clear of its body): untouched');
});

test('bosses (mutation): the Old Grey\'s call brings eels up in the water nearest each point of its ring', () => {
  const eels = def('old_grey').attacks.eels;
  const w = marsh({ invulnerable: false });
  const T = w.terrain;
  // Open ground for it to stand on with water inside its ring's reach.
  let spot = null;
  for (let ty = 30; ty < 220 && !spot; ty++) for (let tx = 30; tx < 220 && !spot; tx++) {
    if (T.waterAt(tx, ty) || T.blockedAt((tx + 0.5) * TILE, (ty + 0.5) * TILE)) continue;
    const ringTx = Math.floor(((tx + 0.5) * TILE + eels.radius) / TILE);
    if ([-2, -1, 0, 1, 2].some((d) => T.waterAt(ringTx + d, ty)) && !T.blockedAt((tx - 6 + 0.5) * TILE, (ty + 0.5) * TILE) && !T.waterAt(tx - 6, ty)) spot = [tx, ty];
  }
  assert.ok(spot, 'the Marsh has ground beside water');
  place(w, (spot[0] - 6 + 0.5) * TILE, (spot[1] + 0.5) * TILE);
  const { e, b } = boss('old_grey', { at: w, dx: 6 * TILE, dy: 0 });
  w.enemies.speed[e] = 0;
  const x = w.enemies.x[e], y = w.enemies.y[e];
  const isEel = (i) => w.enemyDefs[w.enemies.type[i]].id === 'creek_eel' && (w.enemies.flags[i] & EF.DEAD) === 0;
  const count = () => { let n = 0; for (let i = 0; i < w.enemies.count; i++) if (isEel(i)) n++; return n; };
  assert.equal(count(), 0);
  attack(w, b, attackIndex('old_grey', 'eels'));
  // What the ring should give, worked out here: for each of its points, the nearest water tile within `water` tiles (none: no eel).
  const sc = [0, 0], want = [];
  for (let k = 0; k < eels.count; k++) {
    sincosInto((k / eels.count) * TAU, sc, 0);
    const tx = Math.floor((x + sc[1] * eels.radius) / TILE), ty = Math.floor((y + sc[0] * eels.radius) / TILE);
    let best = -1, at = null;
    for (let dy = -eels.water; dy <= eels.water; dy++) for (let dx = -eels.water; dx <= eels.water; dx++) {
      if (!T.waterAt(tx + dx, ty + dy)) continue;
      const d = dx * dx + dy * dy;
      if (best < 0 || d < best) { best = d; at = [tx + dx, ty + dy]; }
    }
    if (at) want.push(at);
  }
  assert.ok(want.length >= 1, 'at least one point of the ring has water near it');
  let guard = 0;
  while (count() === 0 && guard++ < Math.ceil((eels.warn + 0.5) * TPS)) run(w, 1);
  const got = [];
  for (let i = 0; i < w.enemies.count; i++) if (isEel(i)) got.push([Math.floor(w.enemies.x[i] / TILE), Math.floor(w.enemies.y[i] / TILE)]);
  assert.equal(got.length, want.length, `an eel for each point with water near it (${got.length} of ${want.length})`);
  const key = (p) => `${p[0]},${p[1]}`;
  assert.deepEqual(got.map(key).sort(), want.map(key).sort(), 'each in the nearest water to its point');
  for (const [tx, ty] of got) assert.ok(T.waterAt(tx, ty), 'in water');
});

test('bosses (mutation): every boss attack\'s warning is drawn at full strength, however many ordinary warnings are showing', () => {
  for (const B of DATA.bosses) {
    const first = B.phases[0].attacks;
    for (let k = 0; k < first.length; k++) {
      const a = B.attacks[first[k]];
      const { w, b } = boss(B.id, { dx: a.type === 'lure' ? 30 : 120 });
      // A crowd's warnings have every full place taken for a long while.
      w.attack.fullEnds.fill(w.tick + 100000);
      attack(w, b, k);
      const tiers = runCollect(w, 3, EV.TELE_TIER);
      if (b.attack !== a) continue;   // (an attack that can't start from this pose: the next in its list went instead)
      if (a.type === 'hazard_pools' || a.type === 'lightning_march') continue;   // their pools and strikes are their own warnings (other modules)
      assert.ok(tiers.length >= 1, `${B.id} ${first[k]}: warned`);
      for (const t of tiers) assert.equal(t.a, TIER.MAJOR, `${B.id} ${first[k]} (${a.type}): its warning is a boss's, never dimmed`);
    }
  }
  // The Maw's lure by name (the one a mutation got through): its bite's ring, and the pull toward it.
  const maw = def('harbor_maw');
  const { w, e, b } = boss('harbor_maw', { dx: 30 });
  w.attack.fullEnds.fill(w.tick + 100000);
  attack(w, b, maw.phases[0].attacks.indexOf('lure'));
  const ev = runCollect(w, 2, EV.TELE_TIER);
  if (b.attack === maw.attacks.lure) {
    assert.equal(ev[0].a, TIER.MAJOR);
    assert.ok(w.pull.ticks > 0 && Math.hypot(w.pull.x - w.enemies.x[e], w.pull.y - w.enemies.y[e]) < 1, 'you are drawn toward it');
  } else assert.ok(maw.phases.some((p) => p.attacks.includes('lure') || p.signature === 'lure'), 'the Maw has a lure somewhere');
});
