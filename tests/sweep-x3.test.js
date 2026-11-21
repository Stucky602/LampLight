// The sweep, X3: the harbor economy (work/sweep/X3.md; S2's E1, E2, E3, D4, D5).
//   E1  overtime pays at most 1.5x, and its elites drop their rare material half as often
//   E3  gear's Iron moved onto Timber, Rum, Drowned Pages, and Oil
//   D5  the harbor hands its systems over a few runs apart (a building level's `needs`)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA } from '../src/data/index.js';
import { createWorld } from '../src/sim/world.js';
import { spawnEnemy } from '../src/sim/enemies.js';
import { rollDrops } from '../src/sim/pickups.js';
import { checkTimeline } from '../src/sim/director.js';
import { PK } from '../src/sim/constants.js';
import { defaultProfile } from '../src/save/schema.js';
import { whyNotRestore, restoreBuilding, levelNeeds } from '../src/meta/actions.js';
import { purchaseOptions } from '../src/meta/next.js';
import { parseUnlock, levelOf } from '../src/meta/state.js';

/** Iron and Map Scraps from n elite kills of a Drowned Bosun, in or out of overtime. */
function eliteHaul(n, overtime) {
  const w = createWorld({ seed: 'x3-elites', map: 'drowned_docks' }, DATA);
  w.director.overtime = overtime;
  const type = w.enemyIndex.get('drowned_bosun');
  const t = {};
  for (let k = 0; k < n; k++) {
    const e = spawnEnemy(w, type, w.player.x + 300, w.player.y, { elite: true });
    rollDrops(w, e, w.enemyDefs[type], w.enemies.flags[e]);
    for (let i = w.pickups.count - 1; i >= 0; i--) {
      if (w.pickups.kind[i] === PK.MATERIAL) { const id = w.materialDefs[w.pickups.a[i]].id; t[id] = (t[id] ?? 0) + w.pickups.b[i]; }
      w.pickups.remove(i);
    }
    w.enemies.remove(e);
  }
  return t;
}

test('X3 E1: overtime grows materials to 1.5x at most, and its elites drop their rare material at half the chance', () => {
  for (const m of DATA.maps) {
    assert.equal(m.overtime.materialsCap, 1.5, `${m.id}: overtime pays at most 1.5x`);
    assert.equal(m.overtime.eliteRare, 0.5, `${m.id}: overtime's elites, half the rare chance`);
    // The Long Night still pays in its dawn chest and an order of its own on each map.
    assert.ok(m.overtime.events.some((e) => e.event === 'long_night'), m.id);
    assert.ok(DATA.feats.some((f) => f.when.dawnWon === true && f.when.map === m.id), `${m.id}: an order for the dawn`);
  }
  const N = 2000;
  const out = eliteHaul(N, false), ot = eliteHaul(N, true);
  // Out of overtime an elite's Iron is certain (1 to 2); in it, a coin flip. Rope (common) is untouched.
  assert.ok(out.iron >= N && out.iron <= 2 * N, `iron out of overtime ${out.iron}`);
  assert.ok(ot.iron > 0.4 * out.iron && ot.iron < 0.6 * out.iron, `iron in overtime ${ot.iron} vs ${out.iron}`);
  assert.ok(ot.map_scraps > 0.35 * out.map_scraps && ot.map_scraps < 0.65 * out.map_scraps, `scraps ${ot.map_scraps} vs ${out.map_scraps}`);
  assert.ok(Math.abs(ot.rope - out.rope) < 0.1 * out.rope, `rope ${ot.rope} vs ${out.rope}`);
  // The map check refuses a share outside 0 to 1.
  const docks = DATA.maps[0];
  assert.throws(() => checkTimeline({ ...docks, overtime: { ...docks.overtime, eliteRare: 2 } }, new Map(DATA.enemies.map((e, i) => [e.id, i])), DATA.enemies), /eliteRare must be from 0 to 1/);
});

test('X3 D5: three first levels wait on something besides their cost, said plainly, and Next up leaves them out until then', () => {
  const RICH = Object.fromEntries(DATA.materials.map((m) => [m.id, 999999]));
  const make = (levels = {}, bosses = {}) => { const d = defaultProfile(); Object.assign(d.profile.buildings, levels); Object.assign(d.profile.materials, RICH); Object.assign(d.profile.bestiary, bosses); return d; };
  const gated = DATA.buildings.flatMap((b) => b.levels.map((l, i) => ({ b, lv: i + 1, needs: l.needs })).filter((x) => x.needs));
  assert.deepEqual(gated.map((x) => `${x.b.id}:${x.lv}=${x.needs}`).sort(), ['apothecary:1=building:smithy:3', 'chapel:1=boss:salt_widow', 'smithy:1=building:tavern:2']);
  for (const { b, needs } of gated) {
    const u = parseUnlock(needs);
    assert.ok(u.kind === 'boss' ? DATA.enemies.some((e) => e.id === u.id) : DATA.buildings.some((x) => x.id === u.id && x.id !== b.id), `${b.id}: ${needs}`);
    assert.ok(!DATA.meta.mvpBuildings.includes(b.id), `${b.id}: the MVP harbor never waits on a gate`);
  }
  // The Chapel: out of the fog at the Lamp Post's level 3, it waits for the Salt Widow.
  const lp3 = make({ lamp_post: 3 });
  assert.equal(whyNotRestore(lp3, DATA, 'chapel'), 'Needs the Salt Widow killed');
  assert.equal(levelNeeds(lp3, DATA, 'chapel'), 'Needs the Salt Widow killed');
  assert.ok(!purchaseOptions(lp3, DATA).some((o) => o.kind === 'building' && o.id === 'chapel'), 'not in Next up while it waits');
  const widow = make({ lamp_post: 3 }, { salt_widow: 1 });
  assert.equal(whyNotRestore(widow, DATA, 'chapel'), null);
  assert.ok(purchaseOptions(widow, DATA).some((o) => o.kind === 'building' && o.id === 'chapel'));
  assert.equal(levelOf(restoreBuilding(widow, DATA, 'chapel').doc, 'chapel', DATA), 1);
  // The Smithy on the Tavern's level 2, the Apothecary on the Smithy's level 3; only the first level waits.
  assert.equal(whyNotRestore(make({ lamp_post: 4, tavern: 1 }), DATA, 'smithy'), 'Needs the Tavern at Lv 2');
  assert.equal(whyNotRestore(make({ lamp_post: 4, tavern: 2, smithy: 2 }), DATA, 'apothecary'), 'Needs the Smithy at Lv 3');
  assert.equal(whyNotRestore(make({ lamp_post: 4, tavern: 2, smithy: 3 }), DATA, 'apothecary'), null);
  assert.equal(whyNotRestore(make({ lamp_post: 4, tavern: 1, smithy: 1 }), DATA, 'smithy'), null, 'a save past the gate keeps going');
});

test('X3 round 2: in overtime an ordinary enemy\'s materials drop at 0.45 of their chance; the Drowned Bosun\'s Rope is 0.02 a kill', () => {
  for (const m of DATA.maps) assert.equal(m.overtime.dropMul, 0.45, m.id);
  assert.deepEqual(DATA.enemies.find((e) => e.id === 'drowned_bosun').drops, [{ material: 'rope', chance: 0.02 }]);
  const haul = (overtime) => {
    const w = createWorld({ seed: 'x3-crowd', map: 'drowned_docks' }, DATA);
    w.director.overtime = overtime;
    const type = w.enemyIndex.get('drowned_sailor');
    let n = 0;
    for (let k = 0; k < 20000; k++) {
      const e = spawnEnemy(w, type, w.player.x + 300, w.player.y, null);
      rollDrops(w, e, w.enemyDefs[type], w.enemies.flags[e]);
      for (let i = w.pickups.count - 1; i >= 0; i--) { if (w.pickups.kind[i] === PK.MATERIAL) n += w.pickups.b[i]; w.pickups.remove(i); }
      w.enemies.remove(e);
    }
    return n;
  };
  const out = haul(false), ot = haul(true);
  assert.ok(ot > 0.38 * out && ot < 0.52 * out, `${ot} in overtime vs ${out}`);
  const docks = DATA.maps[0];
  assert.throws(() => checkTimeline({ ...docks, overtime: { ...docks.overtime, dropMul: -1 } }, new Map(DATA.enemies.map((e, i) => [e.id, i])), DATA.enemies), /dropMul must be from 0 to 1/);
});
