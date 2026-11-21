// The Salt Marsh's fight (ARCHITECTURE §5.17; docs/design/SALT_MARSH_BUILD.md): its enemies (the
// Salted Dead's crust, the Mire Toad's hop, the Creek Eel in its water, the Leech's latch), its
// bosses (the Old Grey's stab and leap, the Salt Widow's march and kneel, and the minFight floor
// under their weak windows), its weapons and their pieces (one puddle per spout, two freeze, the
// thaw, the crowd pick, shatters, spikes on hops, Copper Wire, both ways, armor damage, caltrops
// while moving), its runes (spill, tar, fever, Familiar), its relics (and each given to the Well
// leaving the run as it was), its characters, and no Forms for its weapons.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DATA, testData, makeWorld, spawnAt, give, givePassive, run, runCollect, IDLE, TEST_BOLT } from './helpers/simworld.js';
import { createWorld, stepWorld, decide, currentHalt } from '../src/sim/world.js';
import { damageEnemy, applyStatus } from '../src/sim/enemies.js';
import { dazeEnemy } from '../src/sim/holds.js';
import { registerBoss, BOSS_STATE } from '../src/sim/bosses.js';
import { crowdPoint } from '../src/sim/holds.js';
import { strikeAt } from '../src/sim/storm.js';
import { addRelic, removeRelic, rebuildStats, markStatsDirty } from '../src/sim/build.js';
import { makeOffer } from '../src/sim/draft.js';
import { buildSlot } from '../src/sim/weapons.js';
import { HOOKS } from '../src/sim/hooks.js';
import { EV, STATUS, TELE, STRIKE_SRC } from '../src/sim/events.js';
import { EF, EF_GONE, ZONE, TPS, LEECH, EEL, RELIC_SLOT } from '../src/sim/constants.js';
import { GROUND, TILE } from '../src/sim/terrain.js';
import { BTN_DASH } from '../src/lib/inputframe.js';

const DATA_T = testData();
const COLS = 256;
const MARSH = DATA.maps.find((m) => m.id === 'salt_marsh');
const MARSH_WEAPONS = DATA.weapons.filter((w) => w.map === 'salt_marsh').map((w) => w.id);

function marsh(cfg = {}) {
  const w = createWorld({ seed: 5, map: 'salt_marsh', character: 'tester', densityCap: 0, invulnerable: true, ...cfg }, DATA_T);
  w.director.eventIdx = w.director.events.length;
  return w;
}
function place(w, i) { w.player.x = w.player.px = (i % COLS + 0.5) * TILE; w.player.y = w.player.py = (Math.floor(i / COLS) + 0.5) * TILE; }
const still = (w, e) => { w.enemies.speed[e] = 0; return e; };
const tough = (w, e, hp = 1e6) => { w.enemies.hp[e] = w.enemies.maxHp[e] = hp; return e; };
const eventsIn = (w, type) => { const out = []; for (let i = 0; i < w.events.count; i++) if (w.events.type[i] === type) out.push({ x: w.events.x[i], y: w.events.y[i], a: w.events.a[i], b: w.events.b[i], c: w.events.c[i], d: w.events.d[i] }); return out; };

/** A boss on the open test field, its fight-length floor already behind it unless `fresh`. */
function boss(id, { fresh = false, dx = 120, at = null } = {}) {
  const w = at ?? makeWorld({ invulnerable: false });
  const e = spawnAt(w, id, dx, 0);
  const b = registerBoss(w, e, false);
  if (!fresh) b.spawnTick = -1e6;
  w.player.hp = 1e5; w.stats.maxHp = 1e5;
  return { w, e, b };
}
/** Start the boss's attack number `k` (its first phase's list) now. */
function attack(w, b, k) { b.next = k; b.timer = 0; b.state = BOSS_STATE.WALK; }

// ---------------------------------------------------------------- the enemies

test('the Salted Dead: half damage until a Frost, Sea, or Steel hit cracks the crust; then whole', () => {
  const w = makeWorld({ invulnerable: true });
  give(w, 'flare_gun', { slot: 0 });     // Fire, Light
  give(w, 'ice_picks', { slot: 1 });     // Steel, Frost
  const e = tough(w, still(w, spawnAt(w, 'salted_dead', 200, 0)), 1000);
  assert.equal(w.enemies.crust[e], 1);
  damageEnemy(w, e, 10, 0);
  assert.equal(w.enemies.hp[e], 995, 'a fire hit: half');
  damageEnemy(w, e, 10, 1);
  assert.equal(w.enemies.hp[e], 985, 'the cracking hit lands whole');
  assert.equal(w.enemies.crust[e], 0);
  damageEnemy(w, e, 10, 0);
  assert.equal(w.enemies.hp[e], 975, 'and every hit after');
});

test('the Mire Toad: a ring shows where it lands (at least 0.8s); in the air it can\'t be hit or found; it lands in the ring', () => {
  const w = makeWorld({ invulnerable: false });
  w.player.hp = 1000;
  const e = spawnAt(w, 'mire_toad', 100, 0);
  w.enemies.aiTimer[e] = 0;
  const ring = runCollect(w, 10, EV.TELEGRAPH)[0];
  assert.equal(ring.a, TELE.RING);
  assert.ok(ring.b >= 0.8 * TPS && ring.b === Math.round(0.9 * TPS), `${ring.b} ticks`);
  assert.equal([ring.x, ring.y].map(Math.round).join(), [w.player.x, w.player.y].map(Math.round).join(), 'where you stood');
  assert.ok((w.enemies.flags[e] & EF.AIR) !== 0);
  assert.equal(damageEnemy(w, e, 50, 0), 0, 'untouchable in the air');
  assert.equal(w.enemyHash.nearest(w.player.x, w.player.y, 500, w.enemies.flags, EF_GONE, -1), -1, 'skipped by every search');
  const hp = w.player.hp;
  run(w, ring.b);
  assert.equal(w.enemies.flags[e] & EF.AIR, 0, 'down');
  assert.ok(Math.hypot(w.enemies.x[e] - ring.x, w.enemies.y[e] - ring.y) < 1e-3, 'in its ring');
  assert.ok(w.player.hp < hp, 'you stood in it');
});

/** A salt bank tile beside a creek at least 4 wide on the Marsh, the way into the water, and the world at high water with you on it. */
function bankAtHigh(cfg = {}) {
  const w = marsh(cfg);
  const g = w.marsh.g;
  let bank = -1, dir = 0;
  for (let i = 30 * COLS; i < g.kinds.length && bank < 0; i++) {
    if (g.kinds[i] !== GROUND.SALT) continue;
    for (const d of [1, -1, COLS, -COLS]) if ([1, 2, 3, 4].every((k) => g.kinds[i + d * k] === GROUND.MUD) && [-1, -2].every((k) => g.kinds[i + d * k] === GROUND.SALT)) { bank = i; dir = d; break; }
  }
  place(w, bank);
  w.tick = 195 * 60;
  run(w, 20);
  return { w, bank, dir };
}
const tileOffset = (a, b) => [((b % COLS) - (a % COLS)) * TILE, (Math.floor(b / COLS) - Math.floor(a / COLS)) * TILE];

test('the Creek Eel lives in the water: its warned line is exactly its lunge, which carries at most 24px onto the bank and slides back; it sinks when the creek drains', () => {
  const { w, bank, dir } = bankAtHigh();
  assert.equal(w.marsh.level, 101);
  place(w, bank - 2 * dir);   // 2 tiles back from the bank (out of its reach, so no lunge ends early)
  const [ox, oy] = tileOffset(bank - 2 * dir, bank + 3 * dir);
  const e = spawnAt(w, 'creek_eel', ox, oy);
  const lines = [], lunges = [];
  let start = null, outTicks = 0;
  for (let k = 0; k < 6 * 60; k++) {
    const st0 = w.enemies.aiState[e];
    run(w, 1);
    for (const t of eventsIn(w, EV.TELEGRAPH)) if (t.a === TELE.LINE) lines.push(t.c);
    const st = w.enemies.aiState[e];
    if (st0 !== EEL.LUNGE && st === EEL.LUNGE) start = [w.enemies.ax[e], w.enemies.ay[e]];
    if (st0 === EEL.LUNGE && st === EEL.BACK) lunges.push(Math.hypot(w.enemies.x[e] - start[0], w.enemies.y[e] - start[1]));
    const tx = Math.floor(w.enemies.x[e] / TILE), ty = Math.floor(w.enemies.y[e] / TILE);
    if (!w.terrain.waterAt(tx, ty)) {
      outTicks++;
      assert.ok(st === EEL.LUNGE || st === EEL.BACK, `out of the water only in a lunge (${k})`);
      // Its leading edge at most 24 px past the water's edge (the bank tile's far side from you).
      const edge = dir === 1 ? (bank % COLS + 1) * TILE : dir === -1 ? (bank % COLS) * TILE : dir === COLS ? (Math.floor(bank / COLS) + 1) * TILE : Math.floor(bank / COLS) * TILE;
      // (The front of its body along its line: its middle plus its radius along the lunge.)
      const r = w.enemies.radius[e];
      const along = dir === 1 || dir === -1 ? w.enemies.x[e] + w.enemies.dx[e] * r : w.enemies.y[e] + w.enemies.dy[e] * r;
      const past = dir === 1 || dir === COLS ? edge - along : along - edge;
      assert.ok(past <= 24 + 1e-3, `${past.toFixed(1)} px onto the bank`);
    }
    if (st === EEL.WAIT && k > 60) assert.equal(w.terrain.waterAt(tx, ty), true, 'back in the water');
  }
  assert.ok(lines.length >= 2 && lunges.length >= 2, `${lines.length} warnings, ${lunges.length} lunges`);
  for (let k = 0; k < lunges.length; k++) assert.ok(Math.abs(lunges[k] - lines[k]) < 0.5, `the line showed ${lines[k]}, the lunge went ${lunges[k].toFixed(2)}`);
  assert.ok(outTicks > 0, 'it came out onto the bank');
  // The creek drains: it sinks into the mud, no kill.
  const kills = w.result.totalKills;
  w.tick = 488 * 60;
  run(w, 15 * 60);
  for (let i = 0; i < w.enemies.count; i++) assert.notEqual(w.enemyDefs[w.enemies.type[i]].id, 'creek_eel');
  assert.equal(w.result.totalKills, kills);
});

test('the Creek Eel hurts you standing mid-bank, never 2 tiles back; held in its warning it can\'t be (it lunges when the line said)', () => {
  const hurts = (back) => {
    const { w, bank, dir } = bankAtHigh({ invulnerable: false });
    place(w, bank - back * dir);
    w.player.hp = 1e5; w.stats.maxHp = 1e5;
    const [ox, oy] = tileOffset(bank - back * dir, bank + 2 * dir);
    spawnAt(w, 'creek_eel', ox, oy);
    let n = 0;
    for (let k = 0; k < 8 * 60; k++) { run(w, 1); n += eventsIn(w, EV.PLAYER_HURT).length; w.player.iframes = 0; }
    return n;
  };
  assert.ok(hurts(0) >= 1, 'mid-bank: bitten');
  assert.equal(hurts(2), 0, '2 tiles back: safe');
  // A freeze 10 ticks into its warning doesn't hold it: it lunges when the warning ends.
  const { w, bank, dir } = bankAtHigh();
  const [ox, oy] = tileOffset(bank, bank + 3 * dir);
  const e = spawnAt(w, 'creek_eel', ox, oy);
  let warnAt = -1, warnTicks = 0, lungeAt = -1;
  for (let k = 0; k < 10 * 60 && lungeAt < 0; k++) {
    run(w, 1);
    for (const t of eventsIn(w, EV.TELEGRAPH)) if (t.a === TELE.LINE && warnAt < 0) { warnAt = w.tick; warnTicks = t.b; }
    if (warnAt > 0 && w.tick === warnAt + 10) {
      applyStatus(w, e, { status: 'freeze', duration: 1.5 }, RELIC_SLOT);
      w.scratch.hold[0] = 1; dazeEnemy(w, e);
      assert.equal(w.enemies.freezeT[e], 0, 'no freeze mid-warning');
      assert.equal(w.enemies.dazeT[e], 0, 'no daze mid-warning');
    }
    if (w.enemies.aiState[e] === EEL.LUNGE && lungeAt < 0) lungeAt = w.tick;
  }
  assert.ok(warnAt > 0 && Math.abs(lungeAt - warnAt - warnTicks) <= 1, `warned ${warnTicks} ticks, lunged ${lungeAt - warnAt} after`);
});

test('the Leech: at most 3 latch on and drain 1 HP every 2s each; a fourth never bites, it waits beside you and takes a freed place; it never slows you; a dash throws them all off, a freeze one', () => {
  const w = makeWorld({ invulnerable: false });
  w.player.hp = 100;
  const L = [0, 1, 2, 3].map((k) => spawnAt(w, 'leech', 4 * Math.cos(k * 1.7), 4 * Math.sin(k * 1.7)));
  run(w, 2);
  assert.equal(w.latched, 3);
  assert.equal(L.filter((e) => w.enemies.aiState[e] === LEECH.LATCHED).length, 3);
  const fourth = L.find((e) => w.enemies.aiState[e] !== LEECH.LATCHED);
  run(w, 2);
  const hp = w.player.hp;
  run(w, 4 * 60);
  assert.equal(hp - w.player.hp, 6, '3 leeches, 2 drains each in 4s; the fourth never bites');
  assert.ok(Math.hypot(w.enemies.x[fourth] - w.player.x, w.enemies.y[fourth] - w.player.y) < 16, 'the fourth waits beside you');
  const held = L.filter((e) => w.enemies.aiState[e] === LEECH.LATCHED);
  applyStatus(w, held[0], { status: 'freeze', duration: 1 }, RELIC_SLOT);
  run(w, 3);
  assert.notEqual(w.enemies.aiState[held[0]], LEECH.LATCHED, 'a freeze throws one off');
  assert.equal(w.enemies.aiState[fourth], LEECH.LATCHED, 'and the fourth takes its place');
  assert.equal(w.latched, 3);
  const x0 = w.player.x;
  run(w, 30, { mx: 127, my: 0, buttons: 0 });
  assert.ok(Math.abs((w.player.x - x0) - DATA.tuning.player.speed * 0.5) < 1, 'full speed with leeches on');
  w.player.iframes = 0;
  run(w, 1, { mx: 0, my: 0, buttons: BTN_DASH });
  run(w, 1);
  assert.equal(w.latched, 0, 'a dash throws them all off');
});

// ---------------------------------------------------------------- the bosses

test('the Old Grey: its stab hits along the warned line only; its leap warns a shadow ring, is untouchable, and lands in it', () => {
  // The stab: you on the line; then stepping off it during the warning.
  for (const step of [false, true]) {
    const { w, b } = boss('old_grey');
    attack(w, b, 0);
    const tele = runCollect(w, 2, EV.TELEGRAPH).find((t) => t.a === TELE.LINE);
    assert.equal(tele.b, Math.round(0.9 * TPS));
    assert.equal(b.attack.type, 'stab_line');
    const hp = w.player.hp;
    if (step) run(w, 40, { mx: 0, my: 127, buttons: 0 }); else run(w, 40);
    run(w, 20);
    if (step) assert.equal(w.player.hp, hp, 'off the line: untouched'); else assert.ok(w.player.hp <= hp - 19, 'on the line: stabbed');
  }
  const { w, e, b } = boss('old_grey');
  attack(w, b, 1);
  const ring = runCollect(w, 2, EV.TELEGRAPH).find((t) => t.a === TELE.RING);
  assert.ok(ring.b >= 1.2 * TPS);
  assert.ok((w.enemies.flags[e] & EF.AIR) !== 0, 'up');
  assert.equal(damageEnemy(w, e, 500, 0), 0, 'untouchable in the air');
  const hp = w.player.hp;
  const landed = runCollect(w, ring.b, EV.PLAYER_HURT);
  assert.equal(w.enemies.flags[e] & EF.AIR, 0);
  assert.ok(Math.hypot(w.enemies.x[e] - ring.x, w.enemies.y[e] - ring.y) < 1e-3, 'down in its ring');
  assert.equal(b.stuckUntil, -1, 'on firm ground it doesn\'t stick');
  const leap = DATA.bosses.find((x) => x.id === 'old_grey').attacks.leap;
  assert.ok(landed.some((h) => Math.abs(h.x - ring.x) < 1e-3 && Math.abs(h.y - ring.y) < 1e-3), 'you stood in the ring: the landing hurts you');
  assert.ok(hp - w.player.hp >= leap.damage - w.stats.armor - 1e-6);
  // Out of the ring when it lands: untouched. And in the air it never hurts by touch, even right on you.
  const o = boss('old_grey');
  attack(o.w, o.b, 1);
  const r2 = runCollect(o.w, 2, EV.TELEGRAPH).find((t) => t.a === TELE.RING);
  const hp2 = o.w.player.hp;
  for (let k = 0; k < r2.b - 12; k++) {
    o.w.player.x = o.w.player.px = o.w.enemies.x[o.e]; o.w.player.y = o.w.player.py = o.w.enemies.y[o.e];
    o.w.player.iframes = 0;
    run(o.w, 1);
  }
  assert.equal(o.w.player.hp, hp2, 'no touch from the air');
  o.w.player.x = o.w.player.px = r2.x + leap.radius + 60; o.w.player.y = o.w.player.py = r2.y;
  run(o.w, 14);
  assert.equal(o.w.enemies.flags[o.e] & EF.AIR, 0, 'down');
  assert.equal(o.w.player.hp, hp2, 'outside the ring: untouched');
});

test('the Old Grey\'s leap onto mud sticks it for 3s, still and weak (double damage); on the Marsh it calls eels only where there\'s water', () => {
  const w = marsh({ invulnerable: false });
  const g = w.marsh.g;
  let mud = -1;
  for (let i = 40 * COLS; i < g.kinds.length && mud < 0; i++) if (g.kinds[i] === GROUND.MUD && [1, -1, COLS, -COLS, 2, -2].every((d) => g.kinds[i + d] === GROUND.MUD || g.kinds[i + d] === GROUND.SALT)) mud = i;
  place(w, mud);
  const { e, b } = boss('old_grey', { at: w, dx: 150 });
  attack(w, b, 1);
  run(w, Math.round(1.2 * TPS) + 3); // you stay on the mud: it lands there
  assert.equal(Math.floor(w.enemies.y[e] / TILE) * COLS + Math.floor(w.enemies.x[e] / TILE), mud);
  assert.ok(b.stuckUntil > w.tick && b.stuckUntil - w.tick <= 3 * TPS && b.stuckUntil - w.tick >= 3 * TPS - 4, 'stuck 3s');
  const x = w.enemies.x[e];
  const before = w.enemies.hp[e];
  damageEnemy(w, e, 100, 0);
  assert.equal(before - w.enemies.hp[e], 200, 'double damage while stuck');
  run(w, 2 * TPS);
  assert.equal(w.enemies.x[e], x, 'it doesn\'t move');
  run(w, TPS + 2);
  const after = w.enemies.hp[e];
  damageEnemy(w, e, 100, 0);
  assert.equal(after - w.enemies.hp[e], 100, 'unstuck: whole damage only');
  // Eels: the call brings them only where there's water within 3 tiles.
  const dry = boss('old_grey');
  attack(dry.w, dry.b, 4);
  run(dry.w, 60);
  let eels = 0;
  for (let i = 0; i < dry.w.enemies.count; i++) if (dry.w.enemyDefs[dry.w.enemies.type[i]].id === 'creek_eel') eels++;
  assert.equal(eels, 0, 'no water on the test field: no eels');
});

test('the Salt Widow: her lightning marches at you in warned rings, raises glass on salt, never hurts her; she kneels after, weak', () => {
  const w = marsh({ invulnerable: false });
  place(w, 100 * COLS + 100);
  while (w.marsh.g.kinds[Math.floor(w.player.y / TILE) * COLS + Math.floor(w.player.x / TILE)] !== GROUND.SALT) w.player.x += TILE;
  const { e, b } = boss('salt_widow', { at: w, dx: 200 });
  attack(w, b, 0);
  const tele = runCollect(w, 2, EV.TELEGRAPH).filter((t) => t.a === TELE.RING);
  assert.deepEqual(tele.map((t) => t.b), [60, 75, 90, 105, 120], 'five rings, each a beat after the last');
  for (let k = 1; k < tele.length; k++) assert.ok(Math.abs(Math.hypot(tele[k].x - tele[k - 1].x, tele[k].y - tele[k - 1].y) - 44) < 1e-3, 'marching 44 px apart');
  // A strike right on her: it spares her. Her first ring lands on a sailor standing there: it's hurt.
  strikeAt(w, w.enemies.x[e], w.enemies.y[e], 30, 0.8, 999, 0, STRIKE_SRC.WIDOW, 0);
  const s0 = tough(w, still(w, spawnAt(w, 'drowned_sailor', tele[0].x - w.player.x, tele[0].y - w.player.y)), 1000);
  const hp = w.enemies.hp[e];
  const strikes = runCollect(w, 130, EV.STRIKE);
  assert.equal(w.enemies.hp[e], hp, 'never her');
  const march = DATA.bosses.find((x) => x.id === 'salt_widow').attacks.march;
  assert.ok(1000 - w.enemies.hp[s0] >= march.enemyDamage, `her lightning hurts other enemies (${1000 - w.enemies.hp[s0]})`);
  assert.equal(strikes.length, 6);
  assert.ok(strikes.filter((s) => s.b === STRIKE_SRC.WIDOW && s.d === 1).length >= 1, 'a pillar where one landed on salt');
  // She kneels once the last ring has landed: weak for 2s.
  assert.ok(w.tick >= b.weakFrom && w.tick < b.weakUntil && b.weakUntil - b.weakFrom === 2 * TPS);
  const h0 = w.enemies.hp[e];
  damageEnemy(w, e, 100, 0);
  assert.equal(h0 - w.enemies.hp[e], 200, 'double damage while she kneels');
  // Salt shards only under half health (her second phase).
  assert.ok(!DATA.bosses.find((x) => x.id === 'salt_widow').phases[0].attacks.includes('fan'));
});

test('a weak window doubles what lands and skips the 15 s floor; the phase gates still hold until each signature is thrown', () => {
  for (const id of ['old_grey', 'salt_widow']) {
    const { w, e, b } = boss(id, { fresh: true });
    const max = w.enemies.maxHp[e];
    b.weakFrom = w.tick; b.weakUntil = w.tick + 1e6; b.weakMul = 2;
    damageEnemy(w, e, max * 0.1, 0);
    assert.ok(Math.abs(w.enemies.hp[e] - max * 0.8) < 1e-3 * max, `${id}: a tenth, doubled, lands whole on its first tick (no floor)`);
    damageEnemy(w, e, 1e9, 0);
    assert.ok(w.enemies.hp[e] > max * b.notches[0], `${id}: held above its notch until its signature`);
    assert.ok(b.held && (w.enemies.flags[e] & EF.DEAD) === 0);
    b.sigDone = true;                       // its phase's signature thrown (tests/fights.test.js throws it for real)
    damageEnemy(w, e, 1e9, 0);
    assert.equal(w.enemies.hp[e], 1, `${id}: down to its last phase's gate: alive at 1`);
    b.phase = b.def.phases.length - 1; b.sigDone = true;
    damageEnemy(w, e, 1e9, 0);
    assert.ok((w.enemies.flags[e] & EF.DEAD) !== 0, `${id}: dies once its last signature has been thrown`);
  }
});

test('a daze spares bosses and an enemy in the middle of a warned attack; anything else is dazed, and it never adds up', () => {
  const { w, e } = boss('old_grey');
  const hold = w.scratch.hold;
  hold[0] = 1; dazeEnemy(w, e);
  assert.equal(w.enemies.dazeT[e], 0, 'never a boss');
  const crab = spawnAt(w, 'mud_crab', 60, 0);
  w.enemies.aiState[crab] = 1;              // CHARGER.WINDUP: showing its warning
  hold[0] = 1; dazeEnemy(w, crab);
  assert.equal(w.enemies.dazeT[crab], 0, 'never mid-attack');
  const s = spawnAt(w, 'drowned_sailor', -60, 0);
  hold[0] = 0.5; dazeEnemy(w, s);
  assert.equal(w.enemies.dazeT[s], 0.5);
  hold[0] = 0.25; dazeEnemy(w, s);
  assert.equal(w.enemies.dazeT[s], 0.5, 'a shorter daze doesn\'t shorten it, and nothing adds');
});

// ---------------------------------------------------------------- the weapons

function crowd(w, n, dx = 120) {
  const out = [];
  for (let k = 0; k < n; k++) out.push(tough(w, still(w, spawnAt(w, 'drowned_sailor', dx + (k % 6) * 6, ((k / 6) | 0) * 6 - 12))));
  return out;
}

test('Brine Spring: one puddle per spout however many it hits; two puddles on one pulse freeze; a thawed enemy can\'t freeze again for 2s', () => {
  for (const [id, n] of [['brine_spring', 1], ['salt_pan', 2]]) {
    const w = makeWorld({ invulnerable: true });
    crowd(w, 30); crowd(w, 12, -140);
    give(w, id, { slot: 0 });
    run(w, 2);
    let puddles = 0;
    for (let z = 0; z < w.zones.count; z++) if (w.zones.kind[z] === ZONE.PUDDLE) puddles++;
    assert.equal(puddles, n, `${id}: ${n} spout(s), ${n} puddle(s)`);
  }
  const w = makeWorld({ invulnerable: true });
  give(w, 'brine_spring', { slot: 0 });
  w.slots[0].cd = 1e9;
  const a = tough(w, still(w, spawnAt(w, 'drowned_sailor', 150, 0)));
  const b = tough(w, still(w, spawnAt(w, 'drowned_sailor', 150, 90)));
  const puddle = (x, y) => { const Z = w.zones, z = Z.alloc(); Z.x[z] = w.player.x + x; Z.y[z] = w.player.y + y; Z.kind[z] = ZONE.PUDDLE; Z.slot[z] = 0; Z.radius[z] = 30; Z.life[z] = 10; Z.interval[z] = 15; };
  puddle(140, 0); puddle(160, 0); puddle(150, 90);
  run(w, 16);
  assert.ok(w.enemies.freezeT[a] > 0, 'in two puddles: frozen');
  assert.equal(w.enemies.freezeT[b], 0, 'in one: only slowed');
  assert.ok(w.enemies.slowT[b] > 0);
  run(w, 60);
  assert.ok(w.enemies.thawT[a] > 0, 'thawing');
  const t0 = w.enemies.thawT[a];
  run(w, 15);
  assert.equal(w.enemies.freezeT[a], 0, 'no freeze while it thaws');
  assert.ok(t0 <= DATA.tuning.status.thaw);
});

test('the spout finds the thickest crowd on a top-heavy screen (sampled across the whole screen)', () => {
  const w = makeWorld({ invulnerable: true });
  // A thin line of enemies across the top first, then a tight clump low on the screen.
  for (let k = 0; k < 40; k++) still(w, spawnAt(w, 'drowned_sailor', -300 + k * 15, -160));
  const clump = [];
  for (let k = 0; k < 14; k++) clump.push(still(w, spawnAt(w, 'drowned_sailor', 90 + (k % 4) * 7, 130 + ((k / 4) | 0) * 7)));
  run(w, 1);
  const out = new Float64Array(2), picks = new Float64Array(8);
  const e = crowdPoint(w, out, 40, 32, picks, 0, 60, null);
  assert.ok(clump.includes(e), `picked the clump (${out[1] - w.player.y} px down)`);
});

test('shatters: Salt Pan\'s frozen kills burst into 6 shards (ruling 19 RC), a kill that wasn\'t frozen first doesn\'t; Cold Iron shatters a held Steel kill into 4', () => {
  const w = makeWorld({ invulnerable: true });
  give(w, 'salt_pan', { slot: 0 });
  const a = spawnAt(w, 'drowned_sailor', 300, 0), b = spawnAt(w, 'drowned_sailor', 300, 60);
  w.enemies.freezeT[a] = 1;
  w.enemies.hp[a] = w.enemies.hp[b] = 1;
  damageEnemy(w, a, 5, 0); damageEnemy(w, b, 5, 0);
  const shatters = runCollect(w, 1, EV.SHATTER);
  assert.deepEqual(shatters.map((s) => s.a), [6]);
  // Only the spout's own kills: a frozen enemy a shard kills doesn't shatter again (no chain through a frozen crowd).
  const ch = makeWorld({ invulnerable: true });
  give(ch, 'salt_pan', { slot: 0 });
  ch.slots[0].cd = 1e9;
  const first = spawnAt(ch, 'drowned_sailor', 200, 0);
  const ring = [];
  for (let k = 0; k < 12; k++) { const e = spawnAt(ch, 'drowned_sailor', 200 + 14 * Math.cos(k * 0.5236), 14 * Math.sin(k * 0.5236)); ring.push(e); }
  for (const e of [first, ...ring]) { still(ch, e); ch.enemies.freezeT[e] = 5; ch.enemies.hp[e] = 1; }
  run(ch, 1);
  damageEnemy(ch, first, 5, 0);
  const burst = runCollect(ch, 40, EV.SHATTER);
  assert.equal(burst.length, 1, 'one shatter, from the spout\'s kill');
  assert.ok(ch.result.totalKills >= 3, `its shards killed frozen neighbors (${ch.result.totalKills} kills)`);
  const c = makeWorld({ invulnerable: true, relics: ['cold_iron'] });
  give(c, 'ice_picks', { slot: 0 });
  give(c, 'flare_gun', { slot: 1 });
  const s1 = spawnAt(c, 'drowned_sailor', 300, 0), s2 = spawnAt(c, 'drowned_sailor', 300, 60), s3 = spawnAt(c, 'drowned_sailor', 300, 120);
  for (const e of [s1, s2, s3]) c.enemies.hp[e] = 1;
  c.enemies.slowT[s1] = 1; c.enemies.slowT[s3] = 1;
  damageEnemy(c, s1, 5, 0); damageEnemy(c, s2, 5, 0); damageEnemy(c, s3, 5, 1);
  assert.deepEqual(runCollect(c, 1, EV.SHATTER).map((s) => s.a), [4], 'only the slowed Steel kill');
});

test('The Fulgurite (the Rod\'s Legendary, ruling 18 WD) leaves spikes only where its lightning jumps, never at the strike itself; Copper Wire adds hops', () => {
  const lone = makeWorld({ invulnerable: true });
  give(lone, 'lightning_rod', { slot: 0, specials: ['chain_reaction'] });
  tough(lone, still(lone, spawnAt(lone, 'drowned_sailor', 60, 0)));
  run(lone, 60);
  let spikes = 0;
  for (let z = 0; z < lone.zones.count; z++) if (lone.zones.kind[z] === ZONE.SPIKE) spikes++;
  assert.equal(spikes, 0, 'nothing to jump to: no spike');
  const w = makeWorld({ invulnerable: true });
  give(w, 'lightning_rod', { slot: 0, specials: ['chain_reaction'] });
  for (let k = 0; k < 6; k++) tough(w, still(w, spawnAt(w, 'drowned_sailor', 40 + k * 20, 0)));
  run(w, 60);
  for (let z = 0; z < w.zones.count; z++) if (w.zones.kind[z] === ZONE.SPIKE) spikes++;
  assert.ok(spikes >= 1 && spikes <= 10, `${spikes} spikes`);
  // A bolt and its hops: 1 + 3 (the test bolt, the Fulgurite's old numbers), and +1 with Copper Wire Lv 1.
  const hit = (wire) => {
    const v = makeWorld({ invulnerable: true }, { extraWeapons: [TEST_BOLT] });
    give(v, 'test_bolt', { slot: 0 });
    if (wire) givePassive(v, 'copper_wire', 1);
    const es = [];
    for (let k = 0; k < 8; k++) es.push(tough(v, still(v, spawnAt(v, 'drowned_sailor', 60 + k * 40, 0))));
    v.slots[0].cd = 0;
    run(v, 50);
    return es.filter((e) => v.enemies.hp[e] < 1e6).length;
  };
  assert.deepEqual([hit(false), hit(true)], [4, 5]);
});

test('Ice Picks hit on the way out and again on the way back; Sea Anchor adds 3 Damage a point of Armor; Glass Caltrops drop only while you move', () => {
  const w = makeWorld({ invulnerable: true });
  give(w, 'ice_picks', { slot: 0 });
  const e = tough(w, still(w, spawnAt(w, 'drowned_sailor', 40, 0)));
  const hits = runCollect(w, 75, EV.HIT).filter((h) => h.d === 0);
  assert.equal(hits.length, 2, 'out and back');
  assert.ok(w.enemies.slowT[e] > 0);
  const a = makeWorld({ invulnerable: true });
  give(a, 'sea_anchor', { slot: 0 });
  const base = a.slots[0].stats.damage;
  givePassive(a, 'thick_coat', 5);
  // (Thick Coat is the Anchor's partner: each level makes its capstone 6% harder too.)
  assert.ok(Math.abs(a.slots[0].stats.damage - base * (1 + 5 * DATA.tuning.forms.partnerPer) - 3 * a.stats.armor) < 1e-6);   // (ruling 19 RA: +3 a point, was +5)
  assert.equal(a.stats.armor, 2);
  // The armor that comes and goes (the Harpooner's crowd armor) counts too, at the hit.
  a.player.bonusArmor = 4;
  const reach = a.slots[0].emit.radius * a.slots[0].stats.area;   // (the capstone's +25% Area swings it wider)
  tough(a, still(a, spawnAt(a, 'drowned_sailor', reach, 0)));
  const swing = runCollect(a, 4 * 60, EV.HIT).filter((h) => h.d === 0);
  assert.ok(swing.length >= 1);
  assert.ok(Math.abs(swing[0].a - (a.slots[0].stats.damage + 3 * 4)) < 1e-3, `${swing[0].a}: +3 a point of crowd armor too`);
  const c = makeWorld({ invulnerable: true });
  give(c, 'glass_caltrops', { slot: 0 });
  run(c, 120);
  assert.equal(c.projectiles.count, 0, 'standing still: none');
  run(c, 60, { mx: 127, my: 0, buttons: 0 });
  assert.ok(c.projectiles.count >= 2);
});

test('a spout volley spouts every shot: past 4 Amount, up to the most a build can reach', () => {
  const w = makeWorld({ invulnerable: true });
  for (let c = 0; c < 9; c++) for (let k = 0; k < 6; k++) tough(w, still(w, spawnAt(w, 'drowned_sailor', -280 + c * 70 + (k % 3) * 4, (c % 2 ? -120 : 120) + ((k / 3) | 0) * 4)));
  give(w, 'brine_spring', { slot: 0, level: 8 });
  const slot = w.slots[0];
  const most = DATA.weapons.find((x) => x.id === 'brine_spring').base.amount + DATA.tuning.caps.weapon.maxExtraAmount;
  assert.ok(slot.picks.length >= 2 * most, `room for ${slot.picks.length / 2} spouts`);
  slot.stats.amount = 7; slot.cd = 0;
  run(w, 1);
  let puddles = 0;
  for (let z = 0; z < w.zones.count; z++) if (w.zones.kind[z] === ZONE.PUDDLE) puddles++;
  assert.equal(puddles, 7, '7 spouts, 7 puddles');
});

// ---------------------------------------------------------------- the runes and their statuses

test('what the runes became: a spill line carries a kill\'s overflow on; the Tarred relic goes off at another weapon\'s hit and burns off alone for half; the Marsh Fever relic adds 10% and spreads once; Conger dazes', async () => {
  const { applyHit } = await import('../src/sim/weapons.js');
  const hitFrom = (w) => (slot, e, dmg) => { const h = w.scratch.hit; h[0] = dmg; h[1] = 0; h[2] = 1; h[3] = 0; h[4] = w.enemies.x[e]; h[5] = w.enemies.y[e]; applyHit(w, w.slots[slot], w.slots[slot].list, e, -1); };
  // The spill (no line carries it since ruling 17 W3; the effect stays in the sim): a kill's leftover carries on.
  const { spill } = await import('../src/sim/holds.js');
  const w = makeWorld({ invulnerable: true });
  give(w, 'harpoon_chain', { slot: 0 });
  w.slots[0].cd = 1e9;
  const a = still(w, spawnAt(w, 'drowned_sailor', 200, 0)), b = tough(w, still(w, spawnAt(w, 'drowned_sailor', 220, 0)), 100);
  run(w, 1);
  w.enemies.hp[a] = -25; w.enemies.flags[a] |= 1;   // (dead, 25 left over)
  spill(w, w.slots[0], a, { range: 80, hops: 8, mul: 2, least: 0.4 }, 30);
  assert.equal(w.enemies.hp[b], 50, 'the 25 left over carried on, doubled (more than 40% of the 30 hit)');
  // Tarred, a relic: every weapon's hits tar; another weapon's hit sets it off.
  const t2 = makeWorld({ invulnerable: true, relics: ['tarred'] });
  give(t2, 'flare_gun', { slot: 0 }); give(t2, 'ice_picks', { slot: 1 });
  for (let s2 = 0; s2 < 2; s2++) t2.slots[s2].cd = 1e9;
  const t = tough(t2, still(t2, spawnAt(t2, 'drowned_sailor', -200, 0)), 1000), n = tough(t2, still(t2, spawnAt(t2, 'drowned_sailor', -215, 0)), 1000);
  run(t2, 1);
  hitFrom(t2)(1, t, 20);
  assert.ok(t2.enemies.tarT[t] > 3.9);
  assert.equal(t2.enemies.hp[n], 1000);
  hitFrom(t2)(0, t, 1);
  assert.equal(1000 - t2.enemies.hp[n], 10, 'a blast of what it held (half the 20-damage hit)');
  const lone = tough(t2, still(t2, spawnAt(t2, 'drowned_sailor', -200, 150)), 1000), by = tough(t2, still(t2, spawnAt(t2, 'drowned_sailor', -215, 150)), 1000);
  run(t2, 1);
  hitFrom(t2)(1, lone, 20);
  run(t2, 4 * 60 + 2);
  assert.equal(1000 - t2.enemies.hp[by], 5, 'left alone, it burns off for half');
  // Marsh Fever, a relic.
  const v = makeWorld({ invulnerable: true, relics: ['marsh_fever'] });
  give(v, 'eel_pot', { slot: 0 });
  v.slots[0].cd = 1e9;
  const f = tough(v, still(v, spawnAt(v, 'drowned_sailor', 0, 200)), 1000);
  run(v, 1);
  hitFrom(v)(0, f, 10);
  const h0 = v.enemies.hp[f];
  damageEnemy(v, f, 100, 0);
  assert.ok(Math.abs(h0 - v.enemies.hp[f] - 110 * (1 + v.enemies.rotAmp[f])) < 1e-3, '+10% damage taken (and the rot it carries)');
  v.enemies.burnT[f] = 2; v.enemies.burnDps[f] = 4;
  const g = tough(v, spawnAt(v, 'drowned_sailor', 4, 200), 1000);
  run(v, 3);
  assert.ok(v.enemies.feverT[g] > 0 && v.enemies.feverT[g] < 1.6, 'spread at half the time left');
  assert.ok(v.enemies.burnT[g] > 0.8 && v.enemies.burnT[g] <= 1.0, 'with the burn, at half');
  assert.equal(v.enemies.feverDone[f], 1, 'once');
  // Conger (the Eel Pot's capstone): bites daze.
  const c = makeWorld({ invulnerable: true });
  give(c, 'eel_pot', { slot: 0, forms: ['conger'] });
  c.slots[0].cd = 1e9;
  const d = tough(c, spawnAt(c, 'drowned_sailor', 0, -200));
  hitFrom(c)(0, d, 10);
  assert.ok(Math.abs(c.enemies.dazeT[d] - 0.5) < 1e-6);
});

// ---------------------------------------------------------------- the relics

test('the Brine Vat: slows add up to 80%; held there 1s an enemy turns to salt (still, harmless), then crumbles', () => {
  const w = makeWorld({ invulnerable: false, relics: ['brine_vat'] });
  w.player.hp = 1000;
  const e = spawnAt(w, 'drowned_sailor', 40, 0);
  for (let k = 0; k < 3; k++) applyStatus(w, e, { status: 'slow', pct: 0.35, duration: 3 }, RELIC_SLOT);
  assert.ok(Math.abs(w.enemies.slowPct[e] - 0.8) < 1e-6);
  run(w, 61);
  assert.ok(w.enemies.saltT[e] > 3.9, 'salt');
  // Right against you, a walker at full speed: it doesn't move or hurt you.
  w.enemies.x[e] = w.player.x + 4; w.enemies.y[e] = w.player.y;
  const x = w.enemies.x[e], y = w.enemies.y[e];
  assert.ok(w.enemies.speed[e] > 0);
  const hp = w.player.hp;
  run(w, 60);
  assert.equal(w.player.hp, hp, 'it can\'t hurt you');
  assert.deepEqual([w.enemies.x[e], w.enemies.y[e]], [x, y], 'it can\'t move');
  run(w, 3 * 60 + 2);
  assert.equal(w.result.killsByType[w.enemyIndex.get('drowned_sailor')], 1, 'crumbled');
  // A Salted Dead whose crust is whole (slowed only by what never cracks it) crumbles all the same.
  const c = makeWorld({ invulnerable: true, relics: ['brine_vat'] });
  const sd = still(c, spawnAt(c, 'salted_dead', 150, 0));
  for (let k = 0; k < 3; k++) applyStatus(c, sd, { status: 'slow', pct: 0.35, duration: 3 }, RELIC_SLOT);
  run(c, 70);
  assert.ok(c.enemies.saltT[sd] > 0 && c.enemies.crust[sd] === 1, 'salted, its crust whole');
  run(c, 4 * 60 + 5);
  assert.equal(c.result.killsByType[c.enemyIndex.get('salted_dead')], 1, 'crust or not, it crumbles');
  // A toad slowed to the cap that hops: no salt builds in the air, and it lands on its own clock, in its ring.
  for (const pre of [20, 50]) {
    const t = makeWorld({ invulnerable: true, relics: ['brine_vat'] });
    const toad = spawnAt(t, 'mire_toad', 100, 0);
    t.enemies.aiTimer[toad] = 99;
    for (let k = 0; k < 3; k++) applyStatus(t, toad, { status: 'slow', pct: 0.35, duration: 10 }, RELIC_SLOT);
    run(t, pre);
    t.enemies.aiTimer[toad] = 0;
    const ring = runCollect(t, 2, EV.TELEGRAPH).find((r) => r.a === TELE.RING);
    let air = 2;
    while ((t.enemies.flags[toad] & EF.AIR) !== 0 && air < 600) { assert.equal(t.enemies.saltT[toad], 0, 'no salt in the air'); run(t, 1); air++; }
    assert.ok(air <= ring.b + 2, `${pre}: down after ${air} ticks (its ring warned ${ring.b})`);
    assert.ok(Math.hypot(t.enemies.x[toad] - ring.x, t.enemies.y[toad] - ring.y) < 1e-3, 'in its ring');
  }
  // Given to the Well: its salt ends (nothing crumbles) and its stacked slows with it.
  const g = makeWorld({ invulnerable: true, relics: ['brine_vat'] });
  const gs = still(g, spawnAt(g, 'drowned_sailor', 150, 0)), gt = still(g, spawnAt(g, 'drowned_sailor', 150, 40));
  for (let k = 0; k < 3; k++) { applyStatus(g, gs, { status: 'slow', pct: 0.35, duration: 3 }, RELIC_SLOT); applyStatus(g, gt, { status: 'slow', pct: 0.35, duration: 3 }, RELIC_SLOT); }
  run(g, 61);
  assert.ok(g.enemies.saltT[gs] > 0);
  removeRelic(g, DATA.relics.find((r) => r.id === 'brine_vat'));
  assert.deepEqual([g.enemies.saltT[gs], g.enemies.slowPct[gt]], [0, 0]);
  run(g, 5 * 60);
  assert.equal(g.result.totalKills, 0, 'nothing crumbles');
  const plain = makeWorld({ invulnerable: true });
  const p = spawnAt(plain, 'drowned_sailor', 40, 0);
  for (let k = 0; k < 3; k++) applyStatus(plain, p, { status: 'slow', pct: 0.35, duration: 3 }, RELIC_SLOT);
  assert.ok(Math.abs(plain.enemies.slowPct[p] - 0.35) < 1e-6, 'without it, the strongest slow');
});

test('the Quench Bucket puts a Sea or Frost hit\'s burning enemy out, all its burn at once on it and its neighbors; the hit counts for the Quencher either way', () => {
  for (const relic of [true, false]) {
    const w = makeWorld({ invulnerable: true, relics: relic ? ['quench_bucket'] : [] });
    give(w, 'tide_bell', { slot: 0 });
    w.slots[0].cd = 1e9;
    const e = tough(w, still(w, spawnAt(w, 'drowned_sailor', 60, 0)), 1000), n = tough(w, still(w, spawnAt(w, 'drowned_sailor', 66, 0)), 1000);
    w.enemies.burnT[e] = 2; w.enemies.burnDps[e] = 10;
    w.slots[0].cd = 0;
    run(w, 30);
    assert.equal(w.result.quenched, 1);
    if (relic) {
      assert.equal(w.enemies.burnT[e], 0, 'put out');
      assert.ok(1000 - w.enemies.hp[n] >= 15, 'what was left of its 20 burn, on the neighbor');
    } else assert.ok(w.enemies.burnT[e] > 0 || w.enemies.hp[e] < 1000);
  }
});

test('the Watchman\'s Rattle: its count close for 2s and every weapon fires at once; one fewer never; again only once the crowd drops under its reset', () => {
  const P = DATA.relics.find((r) => r.id === 'watchmans_rattle').params;
  const crowdOf = (n) => {
    const w = makeWorld({ invulnerable: true, relics: ['watchmans_rattle'] });
    give(w, 'flare_gun', { slot: 0 });
    w.slots[0].cd = 1e9;
    for (let k = 0; k < n; k++) tough(w, still(w, spawnAt(w, 'drowned_sailor', 30 * Math.cos(k), 30 * Math.sin(k))));
    return w;
  };
  assert.equal(runCollect(crowdOf(P.count - 1), 3 * 60, EV.RATTLE).length, 0, `${P.count - 1} close: no rattle`);
  const w = crowdOf(P.count);
  assert.equal(runCollect(w, 3 * 60, EV.RATTLE).length, 1, `${P.count} close: one rattle`);
  assert.ok(w.slots[0].cd < 2, 'the flare gun fired');
  assert.equal(runCollect(w, 3 * 60, EV.RATTLE).length, 0, 'the same crowd: not again');
  // Walk away (the crowd near you drops under the reset), then back: it rattles again.
  const x0 = w.player.x;
  w.player.x += 400; run(w, 30);
  w.player.x = x0; w.player.px = x0;
  assert.equal(runCollect(w, 3 * 60, EV.RATTLE).length, 1, `under ${P.reset} and back: again`);
});

test('the Sea Urchin: an enemy that hits you takes 6 times your Armor', () => {
  const w = makeWorld({ invulnerable: false, relics: ['sea_urchin'], mods: [{ stat: 'armor', op: 'add', value: 3 }] });
  w.player.hp = 1000;
  const e = tough(w, spawnAt(w, 'drowned_sailor', 3, 0), 1000);
  run(w, 2);
  assert.equal(1000 - w.enemies.hp[e], 18);
});

test('the Try-Pot: after a skip the next offer is only what you own, and the pick gains 2 levels; with nothing owned to offer, the usual offer (never locked)', () => {
  const w = makeWorld({ invulnerable: true, relics: ['try_pot'] });
  give(w, 'flare_gun', { slot: 0, level: 2 });
  givePassive(w, 'wick_oil', 1);
  w.halts.push({ kind: 'draft', offer: null, level: 2 });
  stepWorld(w, IDLE);
  w.halts[0].offer = makeOffer(w);
  w.charges.skip = 2;
  decide(w, { kind: 'skip' });
  assert.equal(w.tryPot.armed, 1);
  w.halts.push({ kind: 'draft', offer: null, level: 3 });
  w.halts[0].offer = makeOffer(w);
  assert.ok(w.halts[0].offer.every((c) => !c.isNew), 'only what you own');
  const pick = w.halts[0].offer.findIndex((c) => c.id === 'flare_gun');
  decide(w, { kind: 'pick', index: pick });
  assert.equal(w.slots[0].level, 4, '+2 levels');
  assert.equal(w.tryPot.armed, 0);
  // A well-levelled weapon never tops out (ruling 10): its rolled upgrades, and the pick gains 2 levels.
  const f = makeWorld({ invulnerable: true, relics: ['try_pot'] });
  give(f, 'flare_gun', { slot: 0, level: 8 });
  f.tryPot.armed = 1;
  f.halts.push({ kind: 'draft', offer: makeOffer(f), level: 3 });
  assert.ok(f.halts[0].offer.every((c) => c.kind === 'weapon' && c.id === 'flare_gun' && c.up), 'only the weapon it owns, each card its own roll');
  decide(f, { kind: 'pick', index: 0 });
  assert.equal(f.slots[0].level, 10, 'two levels');
  // Nothing owned can go further (every upgrade banished): the usual offer.
  const v = makeWorld({ invulnerable: true, relics: ['try_pot'] });
  const vs = give(v, 'flare_gun', { slot: 0, level: 8 });
  for (const t of vs.def.numbers) v.build.banished.add(`up:flare_gun:${t}`);
  for (const l of vs.def.lines) v.build.banished.add(`up:flare_gun:line:${l.id}`);
  for (const x of vs.def.specials) v.build.banished.add(`up:flare_gun:special:${x.id}`);
  v.tryPot.armed = 1;
  const offer = makeOffer(v);
  assert.ok(offer.length > 0 && offer.every((c) => c.isNew), 'new things, not nothing');
});

test('the Bog Torc: once a run, instead of dying you sink 4s (still, untouchable), rotting what touches you, and rise at 40%', () => {
  const w = makeWorld({ invulnerable: false, relics: ['bog_torc'] });
  const e = tough(w, spawnAt(w, 'drowned_sailor', 4, 0), 1000);
  w.player.hp = 1;
  const sinks = runCollect(w, 3, EV.SINK);
  assert.deepEqual(sinks.map((s) => s.a), [1]);
  assert.equal(w.over, null);
  const x = w.player.x;
  const leeches = [0, 1].map((k) => spawnAt(w, 'leech', 3, 2 - 4 * k));   // (no leech latches on while you're sunk)
  run(w, 60, { mx: 127, my: 0, buttons: 0 });
  assert.equal(w.player.x, x, 'still');
  assert.ok(w.enemies.rotT[e] > 0, 'what touches you rots');
  assert.equal(w.latched, 0, 'nothing latches while you\'re sunk');
  for (const l of leeches) w.enemies.flags[l] |= EF.DEAD;
  run(w, 3 * 60);
  assert.ok(Math.abs(w.player.hp - w.stats.maxHp * 0.4) < 1e-6, 'up at 40%');
  w.player.hp = 1; w.player.iframes = 0;
  run(w, 3);
  assert.notEqual(w.over, null, 'once a run');
});

test('every relic given to the Salt Well leaves the run as it would be without it', () => {
  const view = (w) => JSON.stringify({
    stats: w.stats, hooks: Object.fromEntries(Object.entries(w.hooks).map(([k, v]) => [k, v.length])), entries: w.hookEntries.map((h) => h.id),
    slowStack: w.slowStack, quench: w.quench, coldIron: w.coldIron, tryPot: w.tryPot, torc: w.torc, relicTierBonus: w.relicTierBonus,
    knockbackPulls: w.knockbackPulls, embers: [w.emberEliteMul, w.emberBossExtra], relics: w.build.relics.map((r) => r.id),
    slots: w.slots.map((s) => (s && s.stats ? s.stats.damage : null)),
  });
  for (const r of DATA.relics) {
    const a = makeWorld({ invulnerable: true, relics: [r.id] });
    give(a, 'flare_gun', { slot: 0 });
    removeRelic(a, r);
    rebuildStats(a);
    const b = makeWorld({ invulnerable: true });
    give(b, 'flare_gun', { slot: 0 });
    assert.equal(view(a), view(b), r.id);
    // And the run plays on as if it had never had it.
    for (const w of [a, b]) for (let k = 0; k < 6; k++) tough(w, spawnAt(w, 'drowned_sailor', 50 + k * 12, 20), 200);
    run(a, 120, IDLE, { halts: 'pass' }); run(b, 120, IDLE, { halts: 'pass' });
    assert.deepEqual(Array.from(a.enemies.hp.subarray(0, a.enemies.count)), Array.from(b.enemies.hp.subarray(0, b.enemies.count)), `${r.id}: the fight goes the same`);
  }
  // Every hook whose start changes the world takes it back.
  for (const [id, h] of Object.entries(HOOKS)) if (h.init && /world\.\w+ = /.test(String(h.init))) assert.ok(h.undo, `${id} has an undo`);
});

// ---------------------------------------------------------------- the characters, and no Forms

test('the Punter: no Momentum costs him a quarter of his damage; his dash is his own item, Long Push (ruling 16)', () => {
  const w = createWorld({ seed: 1, map: 'test_field', character: 'punter', invulnerable: true }, DATA_T);
  stepWorld(w, { mx: 0, my: 0, buttons: 0 });
  assert.equal(w.dash.def.id, 'long_push');
  assert.equal(w.stats.dashCooldown, 1, 'nothing of his touches the dash\'s numbers');
  const P = DATA.characters.find((c) => c.id === 'punter').mechanic.params;
  assert.ok(P.empty < 0 && P.steps === 4, 'the cost and the meter (tests/characters.test.js plays them)');
});

test('the Bog Warden: an enemy that dies rotting rises for her for 6s (6 at most) and bites what it reaches', () => {
  const w = createWorld({ seed: 1, map: 'test_field', character: 'bog_warden', invulnerable: true, densityCap: 0 }, DATA_T);
  w.slots[0].cd = 1e9;
  const es = [];
  for (let k = 0; k < 8; k++) { const e = spawnAt(w, 'drowned_sailor', 100 + k * 10, 0); w.enemies.rotT[e] = 2; w.enemies.hp[e] = 1; es.push(e); }
  const target = w.enemies.handle(tough(w, still(w, spawnAt(w, 'drowned_sailor', 100, 60)), 1000));
  for (const e of es) damageEnemy(w, e, 5, 9);
  const rises = runCollect(w, 2, EV.THRALL);
  assert.equal(rises.filter((r) => r.a === 1).length, 6, 'six at most');
  assert.equal(w.allies.n, 6);
  run(w, 3 * 60);
  assert.ok(w.enemies.hp[w.enemies.resolve(target)] < 1000, 'they bite');
  run(w, 3 * 60 + 2);
  assert.equal(w.allies.n, 0, 'gone after 6s');
  assert.equal(w.result.thralls, 6);
});

test('every Salt Marsh weapon has a Form line (0.9.0, the lead\'s ruling 1 overturns decision 2); the Ferryman sells an Ember for one', async () => {
  assert.equal(MARSH_WEAPONS.length, 6, 'its six weapons (its four evolutions are retired)');
  for (const id of MARSH_WEAPONS) assert.ok(DATA.ascensions.some((l) => l.weapons.includes(id)), `${id} has a line`);
  const { emberFits } = await import('../src/sim/relics.js');
  const w = makeWorld({ invulnerable: true });
  give(w, 'brine_spring', { slot: 0 });
  assert.equal(emberFits(w, 0), true);
  void MARSH;
});
