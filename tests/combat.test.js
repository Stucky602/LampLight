// Combat: enemies (§5.6), the weapon pipeline (§5.8), gems and pickups, bosses (§5.13).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, spawnAt, give, givePassive as givePassiveHere, run, runCollect, autoDecide } from './helpers/simworld.js';
import { EF, PF, ZONE, MOTION, TPS } from '../src/sim/constants.js';
import { EV, TELE } from '../src/sim/events.js';
import { impulse, damageEnemy, applyStatus } from '../src/sim/enemies.js';
import { spawnGem, spawnPickup } from '../src/sim/pickups.js';
import { stepWorld, currentHalt } from '../src/sim/world.js';
import { hurtPlayer } from '../src/sim/player.js';
import { markStatsDirty, rebuildStats } from '../src/sim/build.js';
import { registerBoss } from '../src/sim/bosses.js';

const dist = (w, e) => Math.hypot(w.enemies.x[e] - w.player.x, w.enemies.y[e] - w.player.y);
const alive = (w, e) => e >= 0 && e < w.enemies.count && (w.enemies.flags[e] & EF.DEAD) === 0;
const walkRight = { mx: 127, my: 0, buttons: 0 };
const IDLE_FRAME = { mx: 0, my: 0, buttons: 0 };

// ---------------------------------------------------------------- enemies

test('enemies: a chaser closes in at its own speed', () => {
  const w = makeWorld({ invulnerable: true });
  const e = spawnAt(w, 'drowned_sailor', 200, 0);
  const d0 = dist(w, e);
  run(w, 60);
  const moved = d0 - dist(w, e);
  const speed = w.enemyDefs[w.enemies.type[e]].speed;
  assert.ok(Math.abs(moved - speed) < 1.5, `moved ${moved.toFixed(2)} px in 1 s at speed ${speed}`);
});

test('enemies: slow, freeze, burn, and rot do what they say', () => {
  const w = makeWorld({ invulnerable: true });
  const a = spawnAt(w, 'drowned_sailor', 200, 0);
  const b = spawnAt(w, 'drowned_sailor', -200, 0);
  applyStatus(w, a, { status: 'slow', duration: 2, pct: 0.5 }, 0);
  applyStatus(w, b, { status: 'freeze', duration: 0.5 }, 0);
  const da = dist(w, a), db = dist(w, b);
  run(w, 30);
  const sp = w.enemyDefs[w.enemies.type[a]].speed;
  assert.ok(Math.abs((da - dist(w, a)) - sp * 0.5 * 0.5) < 1, 'slowed to half speed for half a second');
  assert.ok(Math.abs(db - dist(w, b)) < 0.01, 'frozen: no movement');
  run(w, 31);
  assert.ok(db - dist(w, b) > 0.5, 'thawed and moving again');
  // Burn: damage over time; the kill is credited to the burning weapon's slot.
  const c = spawnAt(w, 'fog_wisp', 0, 250);
  const hp = w.enemies.hp[c];
  applyStatus(w, c, { status: 'burn', duration: 3, dps: 4 }, 3);
  run(w, 60);
  const burnt = hp - w.enemies.hp[c];
  assert.ok(burnt >= 3.9 && burnt <= 4.1, `about 4 damage in 1 s (got ${burnt})`);
  assert.equal(w.result.damageBySlot[3] > 0, true);
  // Rot: more damage taken.
  const d = spawnAt(w, 'drowned_sailor', 0, -250);
  applyStatus(w, d, { status: 'rot', duration: 5, amp: 0.5 }, 0);
  const before = w.enemies.hp[d];
  damageEnemy(w, d, 4, 0);
  assert.equal(before - w.enemies.hp[d], 6);
});

test('enemies: knockback moves, decays, is capped, and barely moves a boss', () => {
  const w = makeWorld({ invulnerable: true });
  const e = spawnAt(w, 'drowned_sailor', 150, 0);
  w.enemies.speed[e] = 0;
  const x0 = w.enemies.x[e];
  impulse(w, e, 1, 0, 1);
  assert.equal(w.enemies.vx[e], 100, 'knockback 1 against mass 1 is 100 px/s');
  run(w, 60);
  const pushed = w.enemies.x[e] - x0;
  assert.ok(pushed > 5 && pushed < 12, `pushed ${pushed.toFixed(2)} px, then stopped`);
  assert.equal(w.enemies.vx[e], 0, 'fully decayed');
  impulse(w, e, 1, 0, 1000);
  assert.equal(w.enemies.vx[e], w.tuning.enemies.knockbackMax);
  const boss = spawnAt(w, 'harbor_maw', -150, 0);
  impulse(w, boss, 1, 0, 1);
  assert.ok(w.enemies.vx[boss] < 1, 'a boss shrugs it off');
});

test('enemies: a crowd on one spot spreads out instead of stacking', () => {
  const w = makeWorld({ invulnerable: true });
  const ids = [];
  for (let k = 0; k < 12; k++) ids.push(spawnAt(w, 'drowned_sailor', 120, 0));
  run(w, 40);
  let minGap = Infinity;
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const E = w.enemies;
    minGap = Math.min(minGap, Math.hypot(E.x[ids[i]] - E.x[ids[j]], E.y[ids[i]] - E.y[ids[j]]));
  }
  assert.ok(minGap > 3, `closest pair ${minGap.toFixed(2)} px apart`);
});

test('enemies: a wall is walked around, never through', () => {
  // A wall 21 tiles wide, 6 tiles above the player; the enemy starts straight above it.
  const layout = { kind: 'rects', rects: [[54, 57, 21, 1]] };
  const w = makeWorld({ invulnerable: true }, { layout });
  const e = spawnAt(w, 'drowned_sailor', 0, -14 * 16);
  const straight = dist(w, e);
  let ticks = 0;
  for (; ticks < 60 * 30 && dist(w, e) > 14; ticks++) {
    run(w, 1);
    assert.equal(w.terrain.blockedAt(w.enemies.x[e], w.enemies.y[e]), false, `inside the wall at tick ${ticks}`);
  }
  assert.ok(dist(w, e) <= 14, 'reached the player');
  const speed = w.enemyDefs[w.enemies.type[e]].speed;
  assert.ok(ticks / 60 > straight / speed + 1, 'took the long way around');
  assert.ok(ticks / 60 < (straight + 25 * 16) / speed, `but not lost: ${(ticks / 60).toFixed(1)} s`);
});

test('enemies: stragglers far behind jump ahead; swarm walls fly straight and vanish without a kill', () => {
  const w = makeWorld({ invulnerable: true });
  const e = spawnAt(w, 'drowned_sailor', -1200, 0);
  run(w, 2, walkRight);
  const d = dist(w, e);
  assert.ok(d > 380 && d < 460, `jumped to the ring (${d.toFixed(0)} px)`);
  assert.ok(w.enemies.x[e] > w.player.x, 'ahead of you (you are walking right)');
  const s = spawnAt(w, 'gull', -300, 40, { swarmDir: [1, 0] });
  const y0 = w.enemies.y[s];
  run(w, 30);
  assert.ok(Math.abs(w.enemies.y[s] - y0) < 0.01, 'a swarmer keeps its line');
  const kills = w.result.totalKills;
  for (let k = 0; k < 900 && alive(w, s); k++) run(w, 1);
  assert.equal(w.result.totalKills, kills, 'vanishing is not a kill');
});

test('enemies: chargers warn for at least 0.8 s, then dash', () => {
  const w = makeWorld({ invulnerable: true });
  const e = spawnAt(w, 'mud_crab', 100, 0);
  const tele = runCollect(w, 120, EV.TELEGRAPH);
  assert.ok(tele.length >= 1);
  assert.equal(tele[0].a, TELE.LINE);
  assert.ok(tele[0].b >= Math.round(w.tuning.enemies.telegraphMin * TPS), `warning ${tele[0].b} ticks`);
  assert.ok(w.enemies.aiState[e] >= 2, 'dashing or recovering after the warning');
});

test('enemies: hazard pools warn, then hurt; ranged enemies warn, then fire a slow shot that hurts', () => {
  const w = makeWorld();
  const hz = spawnAt(w, 'lantern_eater', 90, 0);
  w.enemies.aiTimer[hz] = 0;
  w.enemies.speed[hz] = 0;
  run(w, 1);
  const z = [...Array(w.zones.count).keys()].find((i) => w.zones.kind[i] === ZONE.HAZARD);
  assert.ok(z !== undefined, 'a hazard pool appeared under you');
  const hp0 = w.player.hp;
  run(w, Math.round(w.tuning.enemies.telegraphMin * TPS) - 2);
  assert.equal(w.player.hp, hp0, 'no damage during the warning');
  run(w, 30);
  assert.ok(w.player.hp < hp0, 'armed pool hurts');
  const w2 = makeWorld();
  const g = spawnAt(w2, 'wreck_gunner', 150, 0);
  w2.enemies.aiTimer[g] = 0;
  w2.enemies.speed[g] = 0;
  const tele = runCollect(w2, 3, EV.TELEGRAPH);
  assert.equal(tele.length, 1);
  assert.ok(tele[0].b >= 48);
  assert.equal([...Array(w2.projectiles.count).keys()].filter((i) => w2.projectiles.flags[i] & PF.HOSTILE).length, 0, 'not fired yet');
  run(w2, tele[0].b);
  assert.equal([...Array(w2.projectiles.count).keys()].filter((i) => w2.projectiles.flags[i] & PF.HOSTILE).length, 1, 'fired after the warning');
  const hp1 = w2.player.hp;
  run(w2, 200);
  assert.ok(w2.player.hp < hp1, 'the shot hit');
});

test('enemies: contact hurts by the worst touching enemy, then invulnerability; armor and dash apply', () => {
  const w = makeWorld();
  spawnAt(w, 'fog_wisp', 3, 0);
  spawnAt(w, 'drowned_sailor', -3, 0);
  for (let i = 0; i < w.enemies.count; i++) w.enemies.speed[i] = 0;
  run(w, 1);
  const contact = Math.max(...[0, 1].map((i) => w.enemies.contact[i]));
  assert.equal(w.stats.maxHp - w.player.hp, contact, 'one hit, the worst contact');
  const hp = w.player.hp;
  run(w, Math.round(w.tuning.player.contactIframes * TPS) - 2);
  assert.equal(w.player.hp, hp, 'invulnerable for a moment');
  // Armor, with a floor of 1.
  const w2 = makeWorld();
  w2.stats.armor = 100;
  hurtPlayer(w2, 5, 0, 0);
  assert.equal(w2.stats.maxHp - w2.player.hp, w2.tuning.player.minDamageTaken);
  // Dashing is invulnerable.
  const w3 = makeWorld();
  stepWorld(w3, { mx: 127, my: 0, buttons: 1 });
  assert.ok(w3.player.dashTicks > 0);
  assert.equal(hurtPlayer(w3, 50, 0, 0), 0);
});

test('enemies: deaths drop gems, count kills, split splitters, and elites drop a chest', () => {
  const w = makeWorld({ invulnerable: true });
  const e = spawnAt(w, 'bloater', 200, 0);
  damageEnemy(w, e, 1e6, 0);
  run(w, 1);
  assert.equal(w.result.totalKills, 1);
  assert.equal(w.result.killsByType[w.enemyIndex.get('bloater')], 1);
  assert.equal(w.gems.count, 1);
  assert.equal(w.gems.value[0], w.enemyDefs[w.enemyIndex.get('bloater')].xp);
  const rats = [...Array(w.enemies.count).keys()].filter((i) => w.enemies.type[i] === w.enemyIndex.get('bilge_rat'));
  assert.equal(rats.length, 3, 'burst into three rats');
  const el = spawnAt(w, 'drowned_bosun', 0, 200, { elite: true });
  assert.ok(w.enemies.flags[el] & EF.ELITE);
  assert.equal(w.enemies.maxHp[el], w.enemyDefs[w.enemyIndex.get('drowned_bosun')].hp * w.director.hpMul * w.tuning.enemies.eliteHp);
  damageEnemy(w, el, 1e9, 0);
  run(w, 1);
  assert.equal(w.result.elitesKilled, 1);
  assert.ok([...Array(w.pickups.count).keys()].some((i) => w.pickups.kind[i] === 4), 'a chest on the ground');
});

// ---------------------------------------------------------------- the weapon pipeline

test('weapons: nearest aims at the closest enemy; a volley spreads over several targets', () => {
  const w = makeWorld({ invulnerable: true });
  spawnAt(w, 'drowned_sailor', 60, 0);
  spawnAt(w, 'drowned_sailor', 0, 120);
  spawnAt(w, 'drowned_sailor', -200, 0);
  for (let i = 0; i < w.enemies.count; i++) w.enemies.speed[i] = 0;
  give(w, 'flare_gun', { level: 2 }); // 2 shots
  run(w, 1);
  const P = w.projectiles;
  assert.equal(P.count, 1);
  assert.ok(P.vx[0] > 0 && Math.abs(P.vy[0]) < 1e-3, 'first shot flies at the nearest');
  run(w, 7);
  const second = [...Array(P.count).keys()].find((i) => P.age[i] < 0.05);
  assert.ok(second !== undefined && P.vy[second] > 0, 'second shot goes to the next nearest');
});

test('weapons: nothing to aim at means no shot, and the weapon stays ready', () => {
  const w = makeWorld({ invulnerable: true });
  give(w, 'flare_gun');
  run(w, 30);
  assert.equal(w.projectiles.count, 0);
  spawnAt(w, 'drowned_sailor', 100, 0);
  run(w, 1);
  assert.equal(w.projectiles.count, 1, 'fires the moment something is in range');
});

test('weapons: a facing volley bends onto the nearest enemy within its assist cone, else flies straight', () => {
  // Harpoon Chain: facing, assist 40 degrees. The player faces right (+x).
  const aimOf = (placements, level = 1) => {
    const w = makeWorld({ invulnerable: true });
    for (const [dx, dy] of placements) { const e = spawnAt(w, 'drowned_sailor', dx, dy); w.enemies.speed[e] = 0; }
    w.player.fx = 1; w.player.fy = 0;
    give(w, 'harpoon_chain', { level });
    run(w, 1);
    const P = w.projectiles;
    return Math.atan2(P.vy[0], P.vx[0]) * 180 / Math.PI;
  };
  assert.ok(Math.abs(aimOf([]) - 0) < 1e-6, 'nothing near: straight ahead');
  assert.ok(Math.abs(aimOf([[100, 50]]) - 26.565) < 0.01, 'an enemy 27 degrees off: aimed at it');
  assert.ok(Math.abs(aimOf([[50, 100]]) - 0) < 1e-6, 'an enemy 63 degrees off: outside the cone, straight ahead');
  assert.ok(Math.abs(aimOf([[-60, 0], [150, -60]]) - -21.8) < 0.01, 'the nearest one inside the cone wins over a nearer one behind');
  assert.ok(Math.abs(aimOf([[400, 0]]) - 0) < 1e-6, 'beyond range (300 px): straight ahead');
  // A 3-shot volley fans evenly around the aim line (spread 12 degrees), even if you turn mid-volley.
  const w = makeWorld({ invulnerable: true });
  const e = spawnAt(w, 'drowned_sailor', 100, 50); w.enemies.speed[e] = 0; w.enemies.hp[e] = w.enemies.maxHp[e] = 1e6;
  w.player.fx = 1; w.player.fy = 0;
  give(w, 'harpoon_chain', { level: 7 }); // 3 harpoons
  const angles = [];
  for (let t = 0; t < 30 && angles.length < 3; t++) {
    run(w, 1, { mx: 0, my: t > 2 ? 127 : 0, buttons: 0 }); // turn to face down after the first shot
    const P = w.projectiles;
    for (let i = 0; i < P.count; i++) if (P.age[i] < 0.02) angles.push(Math.atan2(P.vy[i], P.vx[i]) * 180 / Math.PI);
  }
  assert.deepEqual(angles.map((a) => Math.round((a - 26.565) * 100) / 100), [-12, 0, 12]);
});

test('weapons: pierce counts hits; a shot never hits the same enemy twice', () => {
  const w = makeWorld({ invulnerable: true });
  const ids = [];
  for (let k = 0; k < 6; k++) ids.push(spawnAt(w, 'drowned_sailor', 40 + k * 14, 0));
  for (const i of ids) { w.enemies.speed[i] = 0; w.enemies.hp[i] = w.enemies.maxHp[i] = 1e6; w.enemies.mass[i] = 1e6; }
  const s = give(w, 'harpoon_chain'); // pierce 3, facing right
  w.player.fx = 1; w.player.fy = 0;
  const hits = runCollect(w, 60, EV.HIT);
  const fromHarpoon = hits.filter((h) => h.d === s.index);
  assert.equal(fromHarpoon.length, 3, `pierce ${s.stats.pierce}: 3 hits`);
  assert.equal(new Set(fromHarpoon.map((h) => h.b)).size, 3, 'three different enemies');
});

test('weapons: orbit bodies circle at their radius and share a hit cooldown per enemy', () => {
  const w = makeWorld({ invulnerable: true });
  const s = give(w, 'lantern_orb');
  run(w, 1);
  const P = w.projectiles;
  assert.equal(P.count, s.stats.amount);
  for (let i = 0; i < P.count; i++) {
    assert.equal(P.motion[i], MOTION.orbit);
    assert.ok(Math.abs(Math.hypot(P.x[i] - w.player.x, P.y[i] - w.player.y) - 38) < 0.01, 'orbit radius 38');
  }
  const e = spawnAt(w, 'drowned_sailor', 38, 0);
  w.enemies.speed[e] = 0; w.enemies.hp[e] = w.enemies.maxHp[e] = 1e6; w.enemies.mass[e] = 1e9;
  const hits = runCollect(w, 120, EV.HIT).filter((h) => h.d === s.index);
  const gaps = hits.slice(1).map((h, k) => h.tick - hits[k].tick);
  assert.ok(hits.length >= 2, `${hits.length} hits in 2 s (each body passes once a turn)`);
  assert.ok(gaps.every((g) => g >= s.hitCdTicks), `hits at least ${s.hitCdTicks} ticks apart (${gaps})`);
});

test('weapons: an aura hurts what is inside it every hit cooldown, and follows you', () => {
  const w = makeWorld({ invulnerable: true });
  const s = give(w, 'lamplight', { slot: 8 });
  const inside = spawnAt(w, 'drowned_sailor', 20, 0);
  const outside = spawnAt(w, 'drowned_sailor', 60, 0);
  for (const i of [inside, outside]) { w.enemies.speed[i] = 0; w.enemies.hp[i] = w.enemies.maxHp[i] = 1e6; w.enemies.mass[i] = 1e9; }
  const hits = runCollect(w, 61, EV.HIT).filter((h) => h.d === 8);
  assert.ok(hits.length >= 1 && hits.every((h) => Math.abs(h.x - w.enemies.x[inside]) < 1), 'only the enemy inside');
  assert.equal(hits.length, 1 + Math.floor(60 / s.hitCdTicks));
  run(w, 10, { mx: -127, my: 0, buttons: 0 });
  const z = w.zones;
  assert.equal(z.x[0], Math.fround(w.player.x), 'the aura moves with you');
});

test('weapons: a wave expands and hits each enemy once as it passes', () => {
  const w = makeWorld({ invulnerable: true });
  const s = give(w, 'tide_bell');
  const ids = [spawnAt(w, 'drowned_sailor', 30, 0), spawnAt(w, 'drowned_sailor', -70, 0), spawnAt(w, 'drowned_sailor', 0, 150)];
  for (const i of ids) { w.enemies.speed[i] = 0; w.enemies.hp[i] = w.enemies.maxHp[i] = 1e6; }
  const hits = runCollect(w, Math.round(s.stats.duration * TPS) + 2, EV.HIT).filter((h) => h.d === s.index);
  assert.equal(hits.length, 2, 'the two within reach, once each (the far one is out of range)');
  assert.ok(hits[0].tick < hits[1].tick, 'nearer first: the ring grows outward');
});

test('weapons: split makes two children that never split again; chain hops to new targets', () => {
  const w = makeWorld({ invulnerable: true });
  const ids = [];
  for (let k = 0; k < 8; k++) ids.push(spawnAt(w, 'drowned_sailor', 60 + (k % 4) * 20, (k < 4 ? -1 : 1) * 25));
  for (const i of ids) { w.enemies.speed[i] = 0; w.enemies.hp[i] = w.enemies.maxHp[i] = 1e6; w.enemies.mass[i] = 1e9; }
  const s = give(w, 'flare_gun', { runes: ['splitting'] });
  let children = 0;
  for (let t = 0; t < 40; t++) {
    run(w, 1);
    for (let i = 0; i < w.projectiles.count; i++) if (w.projectiles.flags[i] & PF.CHILD) children = Math.max(children, [...Array(w.projectiles.count).keys()].filter((j) => w.projectiles.flags[j] & PF.CHILD).length);
  }
  assert.ok(children >= 1 && children <= 2, `children alive at once: ${children}`);
  assert.equal(s.runes[0].id, 'splitting');
  const w2 = makeWorld({ invulnerable: true });
  const row = [];
  for (let k = 0; k < 5; k++) row.push(spawnAt(w2, 'drowned_sailor', 50 + k * 30, 0));
  for (const i of row) { w2.enemies.speed[i] = 0; w2.enemies.hp[i] = w2.enemies.maxHp[i] = 1e6; w2.enemies.mass[i] = 1e9; }
  const s2 = give(w2, 'flare_gun', { runes: ['chain_link'] });
  const hits = runCollect(w2, 40, EV.HIT).filter((h) => h.d === s2.index);
  assert.equal(new Set(hits.map((h) => h.b)).size, 4, 'the first target plus 3 hops, all different');
});

test('weapons: explode hurts everything nearby (not the target twice); pull drags toward you; zone pulses', () => {
  const w = makeWorld({ invulnerable: true });
  const a = spawnAt(w, 'drowned_sailor', 60, 0);
  const b = spawnAt(w, 'drowned_sailor', 70, 8);
  for (const i of [a, b]) { w.enemies.speed[i] = 0; w.enemies.hp[i] = w.enemies.maxHp[i] = 1e6; w.enemies.mass[i] = 1e9; }
  const s = give(w, 'flare_barrage');
  const hits = [], blasts = [];
  for (let t = 0; t < 20; t++) {
    run(w, 1);
    for (let i = 0; i < w.events.count; i++) {
      if (w.events.type[i] === EV.HIT && w.events.d[i] === s.index) hits.push({ x: w.events.x[i], a: w.events.a[i] });
      if (w.events.type[i] === EV.EXPLODE) blasts.push(w.events.a[i]);
    }
  }
  const onA = hits.filter((h) => Math.abs(h.x - w.enemies.x[a]) < 0.5);
  const onB = hits.filter((h) => Math.abs(h.x - w.enemies.x[b]) < 0.5);
  assert.ok(blasts.length >= 1 && blasts[0] > 20, `a blast, radius ${blasts[0]}`);
  assert.ok(onB.length >= 1, 'the neighbor caught the blast');
  // The flare hit A directly; A never takes the blast of its own hit on top (no double dip).
  const direct = s.stats.damage, splash = s.stats.damage * 0.6;
  assert.ok(onA.every((h) => Math.abs(h.a - direct) < 1e-3 || Math.abs(h.a - splash) < 1e-3));
  assert.equal(onA.filter((h) => Math.abs(h.a - splash) < 1e-3).length <= onB.filter((h) => Math.abs(h.a - direct) < 1e-3).length, true);
  // Pull.
  const w2 = makeWorld({ invulnerable: true });
  const e = spawnAt(w2, 'drowned_sailor', 80, 0);
  w2.enemies.speed[e] = 0; w2.enemies.hp[e] = w2.enemies.maxHp[e] = 1e6;
  give(w2, 'kraken_line');
  w2.player.fx = 1; w2.player.fy = 0;
  const d0 = dist(w2, e);
  run(w2, 30);
  assert.ok(dist(w2, e) < d0 - 3, 'pulled toward you');
  // Burning ground: rate-limited, pulses on its interval.
  const w3 = makeWorld({ invulnerable: true });
  const t = spawnAt(w3, 'drowned_sailor', 38, 0);
  w3.enemies.speed[t] = 0; w3.enemies.hp[t] = w3.enemies.maxHp[t] = 1e6; w3.enemies.mass[t] = 1e9;
  give(w3, 'lantern_orb', { runes: ['burning_ground'] });
  run(w3, 90);
  const ground = [...Array(w3.zones.count).keys()].filter((i) => w3.zones.kind[i] === ZONE.GROUND);
  assert.ok(ground.length >= 1 && ground.length <= 90 / (0.3 * 60) + 1, `ground zones ${ground.length}, rate-limited`);
});

test('weapons: runes patch the pipeline (orbiting replaces the emitter; backfire mirrors; invalid pairs refused)', async () => {
  const { runeValidOn } = await import('../src/sim/weapons.js');
  const w = makeWorld({ invulnerable: true });
  const orb = w.runeDefs.find((r) => r.id === 'orbiting');
  const s = give(w, 'flare_gun', { runes: ['orbiting'] });
  assert.equal(s.emit.type, 'orbit');
  assert.equal(s.motion.type, 'orbit');
  assert.equal(s.stats.pierce, -1);
  assert.equal(s.hitCdTicks, 30);
  run(w, 1);
  assert.equal(w.projectiles.count, s.stats.amount, 'orbit bodies right away, no target needed');
  assert.equal(runeValidOn(orb, w.weaponDefs[w.weaponIndex.get('tide_bell')]), false, 'orbiting a wave makes no sense: never offered');
  const w2 = makeWorld({ invulnerable: true });
  spawnAt(w2, 'drowned_sailor', 100, 0);
  w2.enemies.speed[0] = 0;
  give(w2, 'flare_gun', { runes: ['backfire'] });
  run(w2, 1);
  const P = w2.projectiles;
  assert.equal(P.count, 2);
  assert.ok(P.vx[0] * P.vx[1] < 0, 'one forward, one straight back');
});

test('weapons: rebuilding slots (every level-up does) reuses compiled on-hit lists instead of growing the table', () => {
  const w = makeWorld({ invulnerable: true });
  give(w, 'flare_gun', { runes: ['splitting', 'burning_ground'] });
  give(w, 'lantern_orb');
  const n = w.fxLists.length;
  const lists = w.slots.filter(Boolean).map((s) => s.list);
  for (let k = 0; k < 50; k++) { markStatsDirty(w); rebuildStats(w); }
  assert.equal(w.fxLists.length, n, 'no new lists');
  assert.deepEqual(w.slots.filter(Boolean).map((s) => s.list), lists, 'same list for the same pipeline');
  give(w, 'flare_gun', { slot: 0, runes: ['chain_link'] });
  assert.ok(w.fxLists.length > n, 'a different pipeline compiles its own list');
});

test('weapons: strike, drop, beam, summon, boomerang, arc, homing, and bounce all work', () => {
  const extra = [
    { id: 't_strike', name: 'T', desc: 'T', tags: ['light'], unlock: 'test', maxLevel: 1, weight: 0, base: { damage: 5, cooldown: 1, amount: 2, radius: 6, duration: 1 }, levels: [null], pipeline: { emit: { type: 'strike' }, motion: { type: 'stationary' }, onHit: [{ type: 'damage' }] }, runeSlots: 0 },
    { id: 't_drop', name: 'T', desc: 'T', tags: ['fire'], unlock: 'test', maxLevel: 1, weight: 0, base: { damage: 5, cooldown: 1, amount: 1, radius: 6, duration: 3, pierce: -1, hitCooldown: 0.5 }, levels: [null], pipeline: { emit: { type: 'drop' }, motion: { type: 'stationary' }, onHit: [{ type: 'damage' }] }, runeSlots: 0 },
    { id: 't_beam', name: 'T', desc: 'T', tags: ['light'], unlock: 'test', maxLevel: 1, weight: 0, base: { damage: 5, cooldown: 1, amount: 1, radius: 120, duration: 0.5, hitCooldown: 0.25 }, levels: [null], pipeline: { emit: { type: 'beam', width: 8 }, motion: { type: 'stationary' }, onHit: [{ type: 'damage' }] }, runeSlots: 0 },
    { id: 't_summon', name: 'T', desc: 'T', tags: ['echo'], unlock: 'test', maxLevel: 1, weight: 0, base: { damage: 5, cooldown: 5, amount: 1, radius: 5, duration: 4, pierce: -1, hitCooldown: 0.3 }, levels: [null], pipeline: { emit: { type: 'summon' }, motion: { type: 'homing', speed: 90, turn: 6 }, onHit: [{ type: 'damage' }] }, runeSlots: 0 },
    { id: 't_boom', name: 'T', desc: 'T', tags: ['steel'], unlock: 'test', maxLevel: 1, weight: 0, base: { damage: 5, cooldown: 5, amount: 1, radius: 5, duration: 1.2, pierce: -1 }, levels: [null], pipeline: { emit: { type: 'facing' }, motion: { type: 'boomerang', speed: 200 }, onHit: [{ type: 'damage' }] }, runeSlots: 0 },
    { id: 't_arc', name: 'T', desc: 'T', tags: ['fire'], unlock: 'test', maxLevel: 1, weight: 0, base: { damage: 5, cooldown: 5, amount: 1, radius: 16, duration: 1 }, levels: [null], pipeline: { emit: { type: 'facing' }, motion: { type: 'arc', range: 80, flight: 0.5 }, onHit: [{ type: 'damage' }] }, runeSlots: 0 },
    { id: 't_bounce', name: 'T', desc: 'T', tags: ['tide'], unlock: 'test', maxLevel: 1, weight: 0, base: { damage: 5, cooldown: 9, amount: 1, radius: 4, duration: 8, pierce: -1, hitCooldown: 0.5 }, levels: [null], pipeline: { emit: { type: 'facing' }, motion: { type: 'bounce', speed: 400, bounces: 3 }, onHit: [{ type: 'damage' }] }, runeSlots: 0 },
  ];
  const tough = (w, i) => { w.enemies.speed[i] = 0; w.enemies.hp[i] = w.enemies.maxHp[i] = 1e6; w.enemies.mass[i] = 1e9; };
  // strike: hits enemies on screen where they stand.
  let w = makeWorld({ invulnerable: true }, { extraWeapons: extra });
  const far = spawnAt(w, 'drowned_sailor', 250, 100); tough(w, far);
  let s = give(w, 't_strike');
  let hits = runCollect(w, 2, EV.HIT).filter((h) => h.d === s.index);
  assert.equal(hits.length, 1, 'strike found the one enemy on screen');
  // drop: a stationary shot where you stood.
  w = makeWorld({ invulnerable: true }, { extraWeapons: extra });
  s = give(w, 't_drop');
  run(w, 1);
  const px = w.player.x;
  run(w, 20, walkRight);
  assert.equal(w.projectiles.x[0], px, 'left behind');
  // beam: hits along a line toward the nearest enemy.
  w = makeWorld({ invulnerable: true }, { extraWeapons: extra });
  const t1 = spawnAt(w, 'drowned_sailor', 100, 0), t2 = spawnAt(w, 'drowned_sailor', 50, 3), off = spawnAt(w, 'drowned_sailor', 50, 40);
  [t1, t2, off].forEach((i) => tough(w, i));
  s = give(w, 't_beam');
  hits = runCollect(w, 5, EV.HIT).filter((h) => h.d === s.index);
  assert.equal(new Set(hits.map((h) => h.b)).size, 2, 'both enemies on the line, not the one beside it');
  // summon: a minion that homes in and keeps hitting.
  w = makeWorld({ invulnerable: true }, { extraWeapons: extra });
  const m = spawnAt(w, 'drowned_sailor', 120, -60); tough(w, m);
  s = give(w, 't_summon');
  hits = runCollect(w, 180, EV.HIT).filter((h) => h.d === s.index);
  assert.ok(hits.length >= 2, `the minion reached it and hit ${hits.length} times`);
  // boomerang: out and back to you.
  w = makeWorld({ invulnerable: true }, { extraWeapons: extra });
  w.player.fx = 1; w.player.fy = 0;
  s = give(w, 't_boom');
  run(w, 30);
  const out = w.projectiles.x[0] - w.player.x;
  run(w, 36);
  assert.ok(out > 40, `went out ${out.toFixed(0)} px`);
  assert.ok(w.projectiles.count === 0 || Math.abs(w.projectiles.x[0] - w.player.x) < out, 'came back');
  // arc: no hits in the air, one blast where it lands.
  w = makeWorld({ invulnerable: true }, { extraWeapons: extra });
  const mid = spawnAt(w, 'drowned_sailor', 40, 0), land = spawnAt(w, 'drowned_sailor', 80, 0);
  [mid, land].forEach((i) => tough(w, i));
  w.player.fx = 1; w.player.fy = 0;
  s = give(w, 't_arc');
  hits = runCollect(w, 40, EV.HIT).filter((h) => h.d === s.index);
  assert.equal(hits.length, 1, 'only the enemy where it lands');
  assert.ok(Math.abs(hits[0].x - w.enemies.x[land]) < 1);
  // bounce: turns around at the edge of the view.
  w = makeWorld({ invulnerable: true }, { extraWeapons: extra });
  w.player.fx = 1; w.player.fy = 0;
  give(w, 't_bounce');
  run(w, 1);
  let maxX = 0, turned = false;
  for (let k = 0; k < 120 && w.projectiles.count; k++) {
    run(w, 1);
    const dx = w.projectiles.x[0] - w.player.x;
    if (dx > maxX) maxX = dx;
    if (w.projectiles.vx[0] < 0) turned = true;
  }
  assert.ok(turned && maxX <= 330, `bounced off the view edge (max ${maxX.toFixed(0)} px out)`);
});

test('weapons: a crit multiplies damage and says so', () => {
  const w = makeWorld({ invulnerable: true, mods: [{ stat: 'crit', op: 'add', value: 1 }] });
  const e = spawnAt(w, 'drowned_sailor', 60, 0);
  w.enemies.speed[e] = 0; w.enemies.hp[e] = w.enemies.maxHp[e] = 1e6;
  const s = give(w, 'flare_gun');
  const hits = runCollect(w, 30, EV.HIT).filter((h) => h.d === s.index);
  assert.ok(hits.length >= 1);
  assert.equal(hits[0].c, 1);
  assert.ok(Math.abs(hits[0].a - s.stats.damage * s.stats.critMult) < 1e-3);
});

test('weapons: the four starter weapons each kill a small crowd on their own', () => {
  for (const id of ['flare_gun', 'lantern_orb', 'harpoon_chain', 'tide_bell']) {
    const w = makeWorld({ invulnerable: true });
    give(w, id, { level: 3 });
    w.player.fx = 1; w.player.fy = 0;
    for (let k = 0; k < 10; k++) spawnAt(w, 'fog_wisp', 120 + (k % 5) * 12, (Math.floor(k / 5) - 0.5) * 20);
    run(w, 60 * 12, undefined, { halts: 'pass' });
    // Orbs circle 38 px out, so an enemy already pressed against you is inside the ring (the
    // Lamplighter's own light handles those): the orb has to stop most of the crowd on the way in.
    const need = id === 'lantern_orb' ? 7 : 8;
    assert.ok(w.result.totalKills >= need, `${id}: ${w.result.totalKills} kills`);
  }
});

// ---------------------------------------------------------------- gems and pickups

test('gems: the magnet pulls from its radius (after a little pop), and collecting gives XP times growth', () => {
  const w = makeWorld({ invulnerable: true, mods: [{ stat: 'growth', op: 'pct', value: 1 }] });
  w.player.xpNext = 1e9; // no level-up in the way
  const r = w.tuning.xp.magnetRadius;
  spawnGem(w, w.player.x + r - 2, w.player.y, 3);
  spawnGem(w, w.player.x + r + 30, w.player.y, 5);
  run(w, 1);
  assert.equal(w.gems.state[0], 1, 'inside the radius: pulled');
  assert.ok(w.gems.x[0] > w.player.x + r - 2, 'pops away first');
  assert.equal(w.gems.state[1], 0, 'outside: stays');
  run(w, 60);
  assert.equal(w.gems.count, 1);
  assert.equal(w.player.xp, 6, 'growth 2x');
  assert.equal(w.result.gems, 1);
});

test('gems: past the merge limit, new experience goes into one big gem', () => {
  const w = makeWorld({ invulnerable: true, tuning: { xp: { gemMergeAt: 10 } } });
  for (let k = 0; k < 25; k++) spawnGem(w, w.player.x + 200 + k, w.player.y + 100, 2);
  assert.equal(w.gems.count, 11, '10 gems plus the big one');
  const big = [...Array(w.gems.count).keys()].find((i) => w.gems.big[i]);
  assert.equal(w.gems.value[big], 30, 'the other 15 gems worth 2 each');
});

test('pickups: materials, healing, the magnet, and chests do their thing', () => {
  const w = makeWorld();
  const coin = w.materialIndex.get('coin');
  spawnPickup(w, 1, w.player.x + 4, w.player.y, coin, 7);
  w.player.hp = 50;
  spawnPickup(w, 2, w.player.x - 4, w.player.y, 20, 0);
  spawnGem(w, w.player.x + 600, w.player.y, 1);
  spawnPickup(w, 3, w.player.x, w.player.y + 4, 0, 0);
  run(w, 1);
  assert.equal(w.result.materialsRaw[coin], 7);
  assert.equal(w.player.hp, 70);
  assert.ok(w.magnetAll > 0);
  run(w, 120);
  assert.equal(w.gems.count, 0, 'the magnet pulled a gem from across the map');
  spawnPickup(w, 4, w.player.x + 3, w.player.y, 1, 0);
  run(w, 1);
  assert.equal(currentHalt(w)?.kind, 'chest');
});

// ---------------------------------------------------------------- bosses

test('bosses: every attack warns first (0.8 s or more), in order, and phases change with HP', () => {
  // Spawned through the director's path: a boss event right away.
  const w2 = makeWorld({ invulnerable: true }, { events: [{ at: 0, event: 'boss', enemy: 'harbor_maw' }] });
  run(w2, 1);
  const boss = w2.bosses[0];
  assert.ok(boss && boss.alive);
  const e = w2.enemies.resolve(boss.handle);
  w2.enemies.x[e] = w2.player.x + 120; w2.enemies.y[e] = w2.player.y;
  const tele = runCollect(w2, 60 * 16, EV.TELEGRAPH);
  assert.ok(tele.length >= 4, `${tele.length} warnings in 16 s`);
  for (const t of tele) assert.ok(t.b >= Math.round(w2.tuning.enemies.telegraphMin * TPS), `warning ${t.b} ticks`);
  assert.deepEqual(tele.slice(0, 4).map((t) => t.a), [TELE.RING, TELE.RING, TELE.SUMMON, TELE.LINE], 'slam, lure, summon, charge');
  w2.enemies.hp[e] = w2.enemies.maxHp[e] * 0.4;
  run(w2, 1);
  assert.equal(boss.phase, 1, 'below half HP: phase two');
});

test('bosses: a slam only hurts inside its ring, after the warning; summons respect the minion cap', () => {
  const w = makeWorld({}, { events: [{ at: 0, event: 'boss', enemy: 'harbor_maw' }] });
  run(w, 1);
  const boss = w.bosses[0];
  const e = w.enemies.resolve(boss.handle);
  w.enemies.speed[e] = 0;
  w.enemies.x[e] = w.player.x + 50; w.enemies.y[e] = w.player.y + 50; // inside the 72 px slam, not touching
  boss.timer = 0;
  const hp0 = w.player.hp;
  run(w, Math.round(boss.def.attacks.slam.warn * TPS) - 1);
  assert.equal(w.player.hp, hp0, 'nothing during the warning');
  run(w, 3);
  assert.equal(hp0 - w.player.hp, boss.def.attacks.slam.damage, 'the slam landed');
  // Minion cap.
  const w2 = makeWorld({ invulnerable: true, tuning: { bosses: { minionCap: 5 } } }, { events: [{ at: 0, event: 'boss', enemy: 'harbor_maw' }] });
  run(w2, 1);
  const b2 = w2.bosses[0];
  const e2 = w2.enemies.resolve(b2.handle);
  w2.enemies.x[e2] = w2.player.x + 150; w2.enemies.y[e2] = w2.player.y;
  for (let k = 0; k < 8; k++) { b2.next = b2.def.phases[0].attacks.indexOf('summon'); b2.timer = 0; run(w2, 60); }
  const minions = [...Array(w2.enemies.count).keys()].filter((i) => w2.enemies.flags[i] & EF.MINION).length;
  assert.ok(minions <= 5, `${minions} minions alive, cap 5`);
});

test('bosses: death records the weapons by damage, drops a chest; the last boss opens its chest and offers overtime', () => {
  const w = makeWorld({ invulnerable: true }, { events: [{ at: 0, event: 'boss', enemy: 'harbor_maw' }, { at: 1, event: 'boss', enemy: 'the_tidecaller' }] });
  give(w, 'flare_gun');
  run(w, 70);
  assert.equal(w.bosses.length, 2);
  const [first, last] = w.bosses;
  assert.equal(last.final, true);
  assert.equal(first.final, false);
  const e1 = w.enemies.resolve(first.handle);
  first.damageBySlot[0] = 10;
  damageEnemy(w, e1, 1e9, 9); // a relic blast lands the killing blow
  run(w, 1);
  assert.equal(w.result.bossesKilled[0].id, 'harbor_maw');
  assert.deepEqual(w.result.bossesKilled[0].weapons, ['relic', 'flare_gun'], 'most damage first');
  assert.ok([...Array(w.pickups.count).keys()].some((i) => w.pickups.kind[i] === 4), 'boss chest on the ground');
  const e2 = w.enemies.resolve(last.handle);
  damageEnemy(w, e2, 1e9, 0);
  run(w, 1);
  assert.equal(w.halts[0].kind, 'chest', 'the chest first');
  assert.equal(w.halts.at(-1).kind, 'overtime', 'then (after any rune placements) stay or leave');
  autoDecide(w);
  assert.equal(w.over.reason, 3, 'left after the last boss: cleared');
});


// A boss next to you with its attack timer cleared, set to use one named attack.
function bossWith(attack, bossId = 'the_tidecaller', { invulnerable = false } = {}) {
  const w = makeWorld({ invulnerable }, { events: [{ at: 0, event: 'boss', enemy: bossId }] });
  run(w, 1);
  const b = w.bosses[0], e = w.enemies.resolve(b.handle);
  w.enemies.speed[e] = 0;
  w.enemies.x[e] = w.player.x + 90; w.enemies.y[e] = w.player.y;
  const phase = b.def.phases[0];
  b.next = phase.attacks.indexOf(attack);
  assert.ok(b.next >= 0, `${attack} is in the first phase`);
  b.timer = 0;
  return { w, b, e };
}

test('bosses: a fan fires slow shots after its warning; pools warn, then hurt; a slam never hurts outside its ring', () => {
  let { w, b } = bossWith('fan');
  run(w, 1);
  const warnTicks = Math.round(b.def.attacks.fan.warn * TPS);
  const hostile = () => [...Array(w.projectiles.count).keys()].filter((i) => w.projectiles.flags[i] & PF.HOSTILE).length;
  run(w, warnTicks - 2);
  assert.equal(hostile(), 0, 'no shots during the warning');
  run(w, 3);
  assert.equal(hostile(), b.def.attacks.fan.count, 'the whole fan');
  const hp0 = w.player.hp;
  run(w, 90);
  assert.ok(w.player.hp < hp0, 'a shot aimed at you hit');
  ({ w, b } = bossWith('pools'));
  run(w, 1);
  const hp1 = w.player.hp;
  run(w, Math.round(b.def.attacks.pools.warn * TPS) - 2);
  assert.equal(w.player.hp, hp1, 'pools only warn at first');
  run(w, 40);
  assert.ok(w.player.hp < hp1, 'then the pool under you hurts');
  const s = bossWith('slam');
  s.w.enemies.x[s.e] = s.w.player.x + 200; // well outside the 88 px ring
  run(s.w, 120);
  assert.equal(s.w.player.hp, s.w.stats.maxHp, 'outside the ring: untouched');
});

test('bosses: a charge runs the warned line and hurts once per charge; the third phase comes at 30%', () => {
  const { w, b, e } = bossWith('charge', 'harbor_maw');
  w.enemies.x[e] = w.player.x + 120;
  const hp0 = w.player.hp;
  run(w, Math.round(b.def.attacks.charge.warn * TPS) + 60);
  const lost = hp0 - w.player.hp;
  assert.ok(lost >= b.def.attacks.charge.damage && lost < 2 * b.def.attacks.charge.damage + w.enemies.contact[e], `charge hit once (${lost} lost)`);
  const t = bossWith('fan');
  t.w.enemies.hp[t.e] = t.w.enemies.maxHp[t.e] * 0.25;
  run(t.w, 1);
  assert.equal(t.b.phase, 2, 'below 30%: the last phase');
});

test('bosses keep their listed health at any minute; elites get their size, contact, XP, and mass', () => {
  const late = makeWorld({ invulnerable: true }, { events: [{ at: 900, event: 'boss', enemy: 'harbor_maw' }], bands: [{ from: 0, to: 1200, roster: { fog_wisp: 1 }, density: [0, 0] }] });
  run(late, 900 * TPS + 2);
  const e = late.enemies.resolve(late.bosses[0].handle);
  assert.equal(late.enemies.maxHp[e], late.enemyDefs[late.enemies.type[e]].hp, '15:00 boss, listed health');
  assert.ok(late.director.hpMul > 2, 'while regular enemies have grown');
  const w = makeWorld({ invulnerable: true });
  const T = w.tuning.enemies, def = w.enemyDefs[w.enemyIndex.get('drowned_sailor')];
  const el = spawnAt(w, 'drowned_sailor', 200, 0, { elite: true });
  assert.ok(Math.abs(w.enemies.radius[el] - def.radius * T.eliteSize) < 1e-5);
  assert.equal(w.enemies.xp[el], def.xp * T.eliteXp);
  assert.equal(w.enemies.mass[el], def.mass * T.eliteMass);
  assert.ok(Math.abs(w.enemies.contact[el] - def.contact * w.director.contactMul * T.eliteContact) < 1e-5);
  assert.ok(Math.abs(w.enemies.maxHp[el] - def.hp * w.director.hpMul * T.eliteHp) < 1e-3);
});

test('enemies: chargers and bosses walk around walls; a warned attack starts where it was drawn', () => {
  const layout = { kind: 'rects', rects: [[54, 57, 21, 1]] };
  const w = makeWorld({ invulnerable: true }, { layout });
  const c = spawnAt(w, 'mud_crab', 0, -14 * 16);
  let t = 0;
  for (; t < 60 * 40 && dist(w, c) > 118; t++) run(w, 1, IDLE_FRAME, { halts: 'stop' });
  assert.ok(dist(w, c) <= 118, `the crab got around the wall into charge range (${dist(w, c).toFixed(0)} px)`);
  // A boss is wider than a tile: its own field keeps it clear of the wall's edge and corner.
  const bw = makeWorld({ invulnerable: true }, { layout });
  const be = spawnAt(bw, 'harbor_maw', 0, -14 * 16);
  registerBoss(bw, be, false).timer = 1e9;
  let bt = 0;
  for (; bt < 60 * 40 && dist(bw, be) > 30; bt++) run(bw, 1, IDLE_FRAME, { halts: 'pass' });
  assert.ok(dist(bw, be) <= 30, `the boss got around the wall (${dist(bw, be).toFixed(0)} px)`);
  // Anchored while warning: crowd pushes and knockback don't move it off the drawn line.
  const a = makeWorld({ invulnerable: true });
  const m = spawnAt(a, 'mud_crab', 100, 0);
  let tele = [];
  for (let t = 0; t < 60 && tele.length === 0; t++) tele = runCollect(a, 1, EV.TELEGRAPH);
  assert.equal(tele.length, 1);
  assert.equal(a.enemies.aiState[m], 1, 'winding up');
  for (let k = 0; k < 12; k++) spawnAt(a, 'drowned_sailor', 100 + (k % 3) * 3, -6 + k);
  impulse(a, m, 0, 1, 5);
  run(a, 20);
  assert.equal(a.enemies.aiState[m], 1, 'still winding up');
  assert.equal(a.enemies.x[m], tele[0].x);
  assert.equal(a.enemies.y[m], tele[0].y);
});

test('enemies: a swarmer from a roster flies at you and on past; one leaving the map vanishes without a kill', () => {
  const w = makeWorld({ invulnerable: true });
  const g = spawnAt(w, 'gull', 300, 0);
  assert.ok(w.enemies.flags[g] & EF.SWARM);
  assert.ok(w.enemies.dx[g] < -0.99, 'heading at you');
  const x0 = w.enemies.x[g];
  run(w, 30);
  assert.ok(w.enemies.x[g] < x0 - 30, 'moving');
  const edge = makeWorld({ invulnerable: true });
  const s = spawnAt(edge, 'gull', 0, 0, { swarmDir: [1, 0] });
  edge.enemies.x[s] = edge.terrain.width - 4;
  const kills = edge.result.totalKills;
  run(edge, 5);
  assert.ok(!alive(edge, s), 'gone once off the map');
  assert.equal(edge.result.totalKills, kills);
});

test('gems: the magnet stat widens the pull; a collected big gem makes room for a new one', () => {
  const w = makeWorld({ invulnerable: true, mods: [{ stat: 'magnet', op: 'pct', value: 1 }] });
  w.player.xpNext = 1e9;
  const r = w.tuning.xp.magnetRadius;
  spawnGem(w, w.player.x + r * 1.8, w.player.y, 1);
  run(w, 1);
  assert.equal(w.gems.state[0], 1, 'at 1.8x the base radius, magnet 2x pulls it');
  const m = makeWorld({ invulnerable: true, tuning: { xp: { gemMergeAt: 3 } } });
  m.player.xpNext = 1e9;
  for (let k = 0; k < 6; k++) spawnGem(m, m.player.x + 2, m.player.y, 2);
  assert.equal(m.gems.count, 4, '3 gems and a big one');
  run(m, 2);
  assert.equal(m.gems.count, 0, 'all collected (they were at your feet)');
  assert.equal(m.player.xp, 12);
  for (let k = 0; k < 5; k++) spawnGem(m, m.player.x + 300, m.player.y, 1);
  assert.equal([...Array(m.gems.count).keys()].filter((i) => m.gems.big[i]).length, 1, 'a fresh big gem, not the collected one');
});

test('pickups: materials collected in overtime count the overtime multiplier', () => {
  const w = makeWorld({ invulnerable: true });
  w.director.materialMul = 1.5;
  const coin = w.materialIndex.get('coin');
  spawnPickup(w, 1, w.player.x + 2, w.player.y, coin, 4);
  run(w, 1);
  assert.equal(w.result.materialsRaw[coin], 6);
});

test('weapons: on-hit status and light effects happen; a chain never hits the same enemy twice', () => {
  const w = makeWorld({ invulnerable: true });
  const e = spawnAt(w, 'drowned_sailor', 46, 0);
  w.enemies.speed[e] = 0; w.enemies.hp[e] = w.enemies.maxHp[e] = 1e6; w.enemies.mass[e] = 1e9;
  const s = give(w, 'lighthouse_lens');       // orbit bodies that burn
  const st = runCollect(w, 120, EV.STATUS).filter((x) => x.b === w.enemies.handle(e));
  assert.ok(st.length >= 1 && st[0].a === 1, 'burn applied');
  assert.ok(w.enemies.burnT[e] > 0 || w.result.damageBySlot[s.index] > 0);
  const lights = makeWorld({ invulnerable: true });
  const t = spawnAt(lights, 'drowned_sailor', 60, 0); lights.enemies.speed[t] = 0;
  give(lights, 'flare_gun');
  assert.ok(runCollect(lights, 30, EV.LIGHT).length >= 1, 'a flare hit lights up');
  // Chain Link on a tight cluster: every enemy a volley's chain touches, once.
  for (let seed = 1; seed <= 20; seed++) {
    const c = makeWorld({ seed, invulnerable: true });
    for (let k = 0; k < 4; k++) { const i = spawnAt(c, 'drowned_sailor', 80 + (k % 2) * 14, (k >> 1) * 14); c.enemies.speed[i] = 0; c.enemies.hp[i] = c.enemies.maxHp[i] = 1e6; c.enemies.mass[i] = 1e9; }
    const g = give(c, 'flare_gun', { runes: ['chain_link'] });
    const hits = runCollect(c, 40, EV.HIT).filter((h) => h.d === g.index);
    assert.ok(hits.length >= 3, `seed ${seed}: the chain hopped (${hits.length} hits)`);
    assert.equal(new Set(hits.map((h) => h.b)).size, hits.length, `seed ${seed}: no enemy hit twice by one volley's chain`);
  }
});

test('evolutions do what they say: the Storm Bell freezes, the Lens burns, the Kraken Line chains and drags', () => {
  const ring = (id, n = 6) => {
    const w = makeWorld({ invulnerable: true });
    const ids = [];
    for (let k = 0; k < n; k++) { const i = spawnAt(w, 'drowned_sailor', 60 + (k % 3) * 12, (k >> 1) * 10 - 10); w.enemies.speed[i] = 0; w.enemies.hp[i] = w.enemies.maxHp[i] = 1e6; ids.push(i); }
    w.player.fx = 1; w.player.fy = 0;
    const s = give(w, id);
    return { w, s, ids };
  };
  let { w, ids } = ring('storm_bell');
  run(w, 40);
  assert.ok(ids.some((i) => w.enemies.freezeT[i] > 0), 'frozen');
  ({ w, ids } = ring('lighthouse_lens'));
  w.enemies.x[ids[0]] = w.player.x + 46;
  run(w, 120);
  assert.ok(ids.some((i) => w.enemies.burnT[i] > 0), 'burning');
  let s;
  ({ w, s, ids } = ring('kraken_line'));
  const hits = runCollect(w, 30, EV.HIT).filter((h) => h.d === s.index);
  assert.ok(new Set(hits.map((h) => h.b)).size >= 4, `the line went through and chained (${new Set(hits.map((h) => h.b)).size} hit)`);
});

test('weapons: an extra wave from Undertow lands its own hits (waves don\'t share a cooldown)', () => {
  const hitsWith = (undertow) => {
    const w = makeWorld({ invulnerable: true });
    for (let k = 0; k < 8; k++) { const i = spawnAt(w, 'drowned_sailor', 40 * Math.cos(k), 40 * Math.sin(k)); w.enemies.speed[i] = 0; w.enemies.hp[i] = w.enemies.maxHp[i] = 1e6; w.enemies.mass[i] = 1e9; }
    const s = give(w, 'tide_bell');
    if (undertow) givePassiveHere(w, 'undertow', 1);
    return runCollect(w, 60, EV.HIT).filter((h) => h.d === s.index).length;
  };
  assert.equal(hitsWith(true), 2 * hitsWith(false), 'two waves, twice the hits');
});

test('runes: an emitter-changing rune can\'t join runes it would strand; one copy of a rune per weapon', async () => {
  const { runeFits } = await import('../src/sim/weapons.js');
  const w = makeWorld({ invulnerable: true });
  const R = (id) => w.runeDefs.find((r) => r.id === id);
  const flare = w.weaponDefs[w.weaponIndex.get('flare_gun')];
  assert.equal(runeFits(R('orbiting'), flare, [R('backfire'), null]), false, 'Orbiting would strand Backfire');
  assert.equal(runeFits(R('backfire'), flare, [R('orbiting'), null]), false, 'Backfire does nothing on an orbit');
  assert.equal(runeFits(R('chain_link'), flare, [R('orbiting'), null]), true, 'Chain Link works on an orbit');
  assert.equal(runeFits(R('splitting'), flare, [R('splitting'), null]), false, 'no second copy');
});

test('weapons: chains on random clusters never revisit; chain hops ignore the parent slot\'s cooldown', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const c = makeWorld({ seed, invulnerable: true });
    let s = seed * 7919;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let k = 0; k < 10; k++) { const i = spawnAt(c, 'drowned_sailor', 70 + rnd() * 40, rnd() * 40 - 20); c.enemies.speed[i] = 0; c.enemies.hp[i] = c.enemies.maxHp[i] = 1e6; c.enemies.mass[i] = 1e9; }
    const g = give(c, 'flare_gun', { runes: ['chain_link'] });
    const byVolley = new Map();
    for (const h of runCollect(c, 60, EV.HIT).filter((x) => x.d === g.index)) {
      const v = Math.floor(h.tick / 66); // one volley per 1.1 s cooldown
      if (!byVolley.has(v)) byVolley.set(v, []);
      byVolley.get(v).push(h.b);
    }
    for (const [v, hs] of byVolley) assert.equal(new Set(hs).size, hs.length, `seed ${seed} volley ${v}: ${hs}`);
  }
  // An orb with Chain Link: the hop lands on an enemy the orb itself hit a moment ago.
  const o = makeWorld({ invulnerable: true });
  const a = spawnAt(o, 'drowned_sailor', 38, 0), b = spawnAt(o, 'drowned_sailor', 60, 0);
  for (const i of [a, b]) { o.enemies.speed[i] = 0; o.enemies.hp[i] = o.enemies.maxHp[i] = 1e6; o.enemies.mass[i] = 1e9; }
  const orb = give(o, 'lantern_orb', { runes: ['chain_link'] });
  o.enemies.nextHit[b * 10 + orb.index] = 1e9; // b is on the orb's cooldown for good
  const hits = runCollect(o, 120, EV.HIT).filter((h) => h.d === orb.index && h.b === o.enemies.handle(b));
  assert.ok(hits.length >= 1, 'the chain hop still hit it');
});

test('hooks: the Harpooner\'s own tug pulls even with a weapon that has no knockback', () => {
  const extraWeapons = [{ id: 't_poke', name: 'T', desc: 'Test poke.', tags: ['steel'], unlock: 'test', maxLevel: 1, weight: 0, base: { damage: 1, cooldown: 0.5, amount: 1, radius: 4, duration: 1, pierce: 1 }, levels: [null], pipeline: { emit: { type: 'nearest', range: 300 }, motion: { type: 'linear', speed: 300 }, onHit: [{ type: 'damage' }] }, runeSlots: 0 }];
  const w = makeWorld({ invulnerable: true, character: 'harpooner' }, { extraWeapons });
  w.slots[0] = null;
  const e = spawnAt(w, 'drowned_sailor', 80, 0);
  w.enemies.speed[e] = 0; w.enemies.hp[e] = w.enemies.maxHp[e] = 1e6;
  give(w, 't_poke');
  const x0 = w.enemies.x[e];
  run(w, 30);
  assert.ok(w.enemies.x[e] < x0 - 1, `tugged in ${(x0 - w.enemies.x[e]).toFixed(1)} px`);
});

test('hooks: a blast from the Harpooner\'s weapons pulls bystanders toward her; a Lamplighter blast pushes them out', () => {
  const push = (character) => {
    const w = makeWorld({ invulnerable: true, character });
    for (let k = 0; k < 8; k++) w.slots[k] = null;
    const target = spawnAt(w, 'drowned_sailor', 100, 0), by = spawnAt(w, 'drowned_sailor', 112, 0);
    for (const i of [target, by]) { w.enemies.speed[i] = 0; w.enemies.hp[i] = w.enemies.maxHp[i] = 1e6; }
    give(w, 'flare_barrage');
    const x0 = w.enemies.x[by];
    run(w, 40);                                   // the flare lands after about 23 ticks
    return w.enemies.x[by] - x0;
  };
  assert.ok(push('harpooner') < -1, 'toward her');
  assert.ok(push('lamplighter') > 1, 'away');
});
