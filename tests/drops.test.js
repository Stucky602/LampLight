// Drop tables (ARCHITECTURE §10.3, §14.1): valid, and seeded expected values land within
// tolerance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DATA } from '../src/data/index.js';
import { createWorld, stepWorld } from '../src/sim/world.js';
import { spawnEnemy, damageEnemy } from '../src/sim/enemies.js';
import { rollDrops, spawnPickup, PICKUP_RESERVE } from '../src/sim/pickups.js';
import { PK } from '../src/sim/constants.js';
import { currentHalt } from '../src/sim/world.js';

const MATERIAL_IDS = new Set(DATA.materials.map((m) => m.id));

function checkTable(where, table) {
  for (const d of table || []) {
    assert.ok(MATERIAL_IDS.has(d.material), `${where}: unknown material "${d.material}"`);
    assert.ok(d.chance > 0 && d.chance <= 1, `${where}: chance ${d.chance} for ${d.material}`);
    if (d.amount) {
      assert.ok(Array.isArray(d.amount) && d.amount.length === 2 && Number.isInteger(d.amount[0]) && Number.isInteger(d.amount[1]) && d.amount[0] >= 1 && d.amount[1] >= d.amount[0], `${where}: amount ${d.amount}`);
    }
  }
}

test('drops: every table names real materials with sane chances and amounts', () => {
  for (const e of DATA.enemies) checkTable(`enemy ${e.id}`, e.drops);
  for (const m of DATA.maps) {
    checkTable(`map ${m.id} common`, m.commonDrops);
    checkTable(`map ${m.id} elite`, m.eliteDrops);
    for (const id of m.materials) assert.ok(MATERIAL_IDS.has(id), `map ${m.id} lists ${id}`);
    if (m.pickups) assert.ok(m.pickups.heal >= 0 && m.pickups.heal < 0.05 && m.pickups.magnet >= 0 && m.pickups.magnet < 0.01);
  }
  // Every material a map says it drops really drops somewhere on that map.
  for (const m of DATA.maps) {
    const dropped = new Set([...(m.commonDrops || []), ...(m.eliteDrops || [])].map((d) => d.material));
    for (const e of DATA.enemies) for (const d of e.drops || []) dropped.add(d.material);
    for (const id of m.materials) assert.ok(dropped.has(id), `map ${m.id}: ${id} never drops`);
  }
});

/** Roll drops for n kills of one enemy type and total what landed, by material. */
function rollMany(n, enemyId, { luck = 1, elite = false } = {}) {
  const w = createWorld({ seed: 'drops', map: 'drowned_docks' }, DATA);
  w.stats.luck = luck;
  const type = w.enemyIndex.get(enemyId);
  const def = w.enemyDefs[type];
  const totals = {};
  const heals = { heal: 0, magnet: 0 };
  for (let k = 0; k < n; k++) {
    const e = spawnEnemy(w, type, w.player.x + 300, w.player.y, elite ? { elite: true } : null);
    rollDrops(w, e, def, w.enemies.flags[e]);
    for (let i = w.pickups.count - 1; i >= 0; i--) {
      if (w.pickups.kind[i] === PK.MATERIAL) {
        const id = w.materialDefs[w.pickups.a[i]].id;
        totals[id] = (totals[id] || 0) + w.pickups.b[i];
      } else if (w.pickups.kind[i] === PK.HEAL) heals.heal++;
      else if (w.pickups.kind[i] === PK.MAGNET) heals.magnet++;
      w.pickups.remove(i);
    }
    w.enemies.remove(e);
  }
  return { totals, heals };
}

function within(label, got, n, p) {
  const mean = n * p, sd = Math.sqrt(n * p * (1 - p));
  assert.ok(Math.abs(got - mean) <= 4 * sd + 1, `${label}: ${got} vs expected ${mean.toFixed(1)} ± ${(4 * sd).toFixed(1)}`);
}

test('drops: seeded expected values land within tolerance (common drops, the enemy\'s own, luck)', () => {
  const N = 20000;
  const map = DATA.maps.find((m) => m.id === 'drowned_docks');
  const sailor = DATA.enemies.find((e) => e.id === 'drowned_sailor');
  const { totals, heals } = rollMany(N, 'drowned_sailor');
  for (const d of map.commonDrops) within(`common ${d.material}`, totals[d.material] || 0, N, d.chance + (sailor.drops.find((x) => x.material === d.material)?.chance || 0));
  within('rope', totals.rope || 0, N, sailor.drops.find((d) => d.material === 'rope').chance);
  within('heal pickups', heals.heal, N, map.pickups.heal);
  const lucky = rollMany(N, 'drowned_sailor', { luck: 2 }).totals;
  within('coin at luck 2', lucky.coin || 0, N, map.commonDrops.find((d) => d.material === 'coin').chance * 2);
});

test('drops: guaranteed drops always land, with amounts in range; swarmers drop nothing', () => {
  const boss = DATA.enemies.find((e) => e.id === 'harbor_maw');
  const { totals } = rollMany(50, 'harbor_maw');
  for (const d of boss.drops) {
    assert.ok(totals[d.material] >= 50 * d.amount[0] && totals[d.material] <= 50 * d.amount[1], `${d.material}: ${totals[d.material]}`);
  }
  const elite = rollMany(200, 'drowned_bosun', { elite: true }).totals;
  assert.ok(elite.iron >= 200 && elite.iron <= 400, `elites always drop iron (${elite.iron})`);
  const w = createWorld({ seed: 1, map: 'drowned_docks' }, DATA);
  const gull = w.enemyIndex.get('gull');
  let materials = 0;
  for (let k = 0; k < 500; k++) {
    const e = spawnEnemy(w, gull, w.player.x + 300, w.player.y, { swarmDir: [1, 0] });
    rollDrops(w, e, w.enemyDefs[gull], w.enemies.flags[e]);
    materials += w.pickups.count;
    while (w.pickups.count) w.pickups.remove(0);
    w.enemies.remove(e);
  }
  assert.equal(materials, 0);
});

test('drops: a kill in a real tick drops through the same path (gem plus rolled materials)', () => {
  const w = createWorld({ seed: 5, map: 'drowned_docks', invulnerable: true }, DATA);
  const type = w.enemyIndex.get('drowned_bosun');
  const e = spawnEnemy(w, type, w.player.x + 250, w.player.y, { elite: true });
  damageEnemy(w, e, 1e9, 0);
  stepWorld(w, { mx: 0, my: 0, buttons: 0 });
  assert.equal(w.gems.count, 1);
  const kinds = [...Array(w.pickups.count).keys()].map((i) => w.pickups.kind[i]);
  assert.ok(kinds.includes(PK.CHEST), 'the elite chest');
  assert.ok(kinds.filter((k) => k === PK.MATERIAL).length >= 2, 'iron and rope at least');
});

test('drops: a full pickup pool never loses materials or chests, and keeps room for heals', () => {
  const w = createWorld({ seed: 9, map: 'drowned_docks', invulnerable: true }, DATA);
  const P = w.pickups, coin = w.materialIndex.get('coin');
  const far = (k) => [w.player.x + 200 + (k % 16) * 4, w.player.y + 200 + Math.floor(k / 16) * 4];
  // Materials stop at the reserve line; the rest go straight into the haul.
  for (let k = 0; k < P.capacity; k++) spawnPickup(w, PK.MATERIAL, ...far(k), coin, 1);
  assert.equal(P.count, P.capacity - PICKUP_RESERVE);
  assert.equal(w.result.materialsRaw[coin], PICKUP_RESERVE, 'the overflow is already counted');
  // Heals and magnets still fit in the reserve.
  for (let k = 0; k < PICKUP_RESERVE; k++) assert.ok(spawnPickup(w, k % 2 ? PK.MAGNET : PK.HEAL, ...far(k), 30, 0) >= 0);
  assert.equal(P.count, P.capacity);
  // Full: a new heal takes the place of the farthest heal or magnet, and lands where it fell.
  const near = [w.player.x + 150, w.player.y];
  const i = spawnPickup(w, PK.HEAL, ...near, 30, 0);
  assert.ok(i >= 0 && P.kind[i] === PK.HEAL && P.x[i] === near[0]);
  assert.equal(P.count, P.capacity);
  // Full: a chest opens where it fell instead of vanishing.
  assert.equal(spawnPickup(w, PK.CHEST, ...near, 1, 0), -1);
  assert.equal(w.result.chests, 1, 'opened at once');
  assert.ok(currentHalt(w), 'its reel is waiting');
});
