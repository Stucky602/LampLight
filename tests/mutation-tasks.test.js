// Behavior tests for sim/tasks.js that a mutation run let through (the sweep, S4 D4): the lamp
// ward reaches as far as the Lamplighter's trade says and no further, only a lit lamp wards
// (never an unlit lamp or a bell), and a map's card counts its bells as bells.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, spawnAt, run, DATA, IDLE } from './helpers/simworld.js';
import { ward, wardAt, mapHolds } from '../src/sim/tasks.js';
import { TPS, TASK, TASK_STATE } from '../src/sim/constants.js';
import { TILE } from '../src/sim/terrain.js';

const T = DATA.tuning;
const tileAt = (w, dx = 0, dy = 0) => [Math.floor(w.player.x / TILE) + dx, Math.floor(w.player.y / TILE) + dy];
function field(tasks, config = {}) {
  const [cx, cy] = tileAt(makeWorld());
  return makeWorld({ invulnerable: true, ...config }, { mapExtra: { tasks: tasks.map(([kind, dx, dy]) => ({ kind, at: [cx + dx, cy + dy] })) } });
}
const goTo = (w, x, y) => { w.player.x = w.player.px = x; w.player.y = w.player.py = y; };
/** An enemy that stands still, with health no stray hit ends. */
const post = (w, id, x, y) => { const e = spawnAt(w, id, x - w.player.x, y - w.player.y); w.enemies.speed[e] = 0; w.enemies.hp[e] = w.enemies.maxHp[e] = 1e6; return w.enemies.handle(e); };
const lost = (w, h) => { const e = w.enemies.resolve(h); return e < 0 ? 1 : (w.enemies.maxHp[e] - w.enemies.hp[e]) / w.enemies.maxHp[e]; };
const light = (w, lamp) => { goTo(w, lamp.x, lamp.y); run(w, Math.ceil(TPS * (T.tasks.lamp.baseSec + 0.5)), IDLE, { halts: 'pass' }); assert.equal(lamp.state, TASK_STATE.DONE, 'the lamp is lit'); };

test('tasks (mutation): only a lit lamp wards: an unlit lamp and a bell burn nothing that stands by them', () => {
  const w = field([['lamp', 0, 0], ['lamp', 14, 0], ['bell', 0, 14]]);
  const [lit, unlit, bell] = w.tasks;
  assert.deepEqual([lit.kind, unlit.kind, bell.kind], [TASK.LAMP, TASK.LAMP, TASK.BELL]);
  light(w, lit);
  // Stand between them, in none of their rings, well within the wards' reach of you.
  goTo(w, lit.x + 110, lit.y + 110);
  assert.notEqual(unlit.state, TASK_STATE.DONE);
  const W = T.tasks.ward;
  const byLit = post(w, 'drowned_sailor', lit.x + W.radius * 0.5, lit.y);
  const byUnlit = post(w, 'drowned_sailor', unlit.x + W.radius * 0.5, unlit.y);
  const byBell = post(w, 'drowned_sailor', bell.x, bell.y + W.radius * 0.5);
  run(w, 2 * TPS, IDLE, { halts: 'pass' });
  assert.ok(lost(w, byLit) > 0.5 * (2 / W.killSec), `the lit lamp burns (${lost(w, byLit).toFixed(3)})`);
  assert.equal(lost(w, byUnlit), 0, 'an unlit lamp wards nothing');
  assert.equal(lost(w, byBell), 0, 'a bell wards nothing');
  assert.notEqual(unlit.state, TASK_STATE.DONE, '(still unlit)');
  // The reach others read agrees: no ward at the unlit lamp or the bell.
  assert.equal(ward(w, 1), 0);
  assert.equal(ward(w, 2), 0);
  assert.equal(wardAt(w, unlit.x, unlit.y), 0);
  assert.equal(wardAt(w, lit.x + W.radius * 0.5, lit.y), 1, 'the lit lamp\'s (its index plus one)');
});

test('tasks (mutation): the ward burns out to its radius; the Lamplighter\'s out to twice that, and no further', () => {
  const W = T.tasks.ward;
  const mul = DATA.characters.find((c) => c.id === 'lamplighter').trade.params.wardMul;
  assert.equal(mul, 2);
  for (const [character, reach] of [['tester', W.radius], ['lamplighter', W.radius * mul]]) {
    const w = field([['lamp', 0, 0]], { character });
    const lamp = w.tasks[0];
    light(w, lamp);
    assert.equal(ward(w, 0), reach, `${character}: the ward's reach`);
    // You stand far to the side (the ward burns on its own; her weapons reach none of these evenly).
    goTo(w, lamp.x, lamp.y + 700);
    const inner = post(w, 'drowned_sailor', lamp.x + W.radius * 0.5, lamp.y);
    const mid = post(w, 'drowned_sailor', lamp.x - W.radius * 1.5, lamp.y);      // inside only a doubled ward
    const outer = post(w, 'drowned_sailor', lamp.x, lamp.y - W.radius * 2.5);    // outside either
    run(w, TPS, IDLE, { halts: 'pass' });
    const share = 1 / W.killSec;
    assert.ok(lost(w, inner) >= share * 0.9 && lost(w, inner) <= share * 1.6, `${character}: inside burns (${lost(w, inner).toFixed(3)})`);
    if (character === 'lamplighter') assert.ok(lost(w, mid) >= share * 0.9 && lost(w, mid) <= share * 1.6, `her ward reaches one and a half radii (${lost(w, mid).toFixed(3)})`);
    else assert.equal(lost(w, mid), 0, 'one and a half radii out: untouched');
    assert.equal(lost(w, outer), 0, `${character}: two and a half radii out: untouched`);
  }
});

test('tasks (mutation): a map\'s card counts its lamps as lamps and its bells as bells', () => {
  const tasks = [{ kind: 'lamp', at: [1, 1] }, { kind: 'lamp', at: [2, 2] }, { kind: 'lamp', at: [3, 3] }, { kind: 'bell', at: [4, 4] }];
  const h = mapHolds({ tasks });
  assert.deepEqual([h.lamps, h.bells, h.acts], [3, 1, 1]);
  assert.deepEqual([mapHolds({}).lamps, mapHolds({}).bells], [0, 0]);
  // A map in acts shows its first act's.
  const acted = mapHolds({ tasks, acts: [{ lamps: 2, bells: 5 }, { lamps: 9, bells: 9 }] });
  assert.deepEqual([acted.lamps, acted.bells, acted.acts], [2, 5, 2]);
  // And the real maps: what the card says is what the map's first act (or its task list) holds.
  for (const m of DATA.maps) {
    const got = mapHolds(m);
    const bells = m.acts ? m.acts[0].bells : (m.tasks || []).filter((t) => t.kind === 'bell').length;
    assert.equal(got.bells, bells, m.id);
    assert.ok(got.bells !== got.lamps || bells === (m.acts ? m.acts[0].lamps : (m.tasks || []).filter((t) => t.kind === 'lamp').length), m.id);
  }
});
