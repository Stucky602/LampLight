// Embers and the Forms they buy (sim/ascend.js; the Forms themselves: tests/forms.test.js) and the stats screen's numbers (the
// harbor's guide and walk-off: tests/guide.test.js; the minimap: tests/minimap.test.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA } from '../src/data/index.js';
import { decide, currentHalt, stepWorld, hashWorld, buildRunResult } from '../src/sim/world.js';
import { EV } from '../src/sim/events.js';
import { EF, PK, EMIT } from '../src/sim/constants.js';
import { spawnPickup, PICKUP_RESERVE } from '../src/sim/pickups.js';
import { createRecordedRun, playReplay } from '../src/sim/replay.js';
import { openAscensions, canAscend } from '../src/sim/ascend.js';
import { haltView, statsView, pauseBuild, noticeFor, dpsText, materialsFound } from '../src/app/runlogic.js';
import { makeWorld, give, run, spawnAt, eventsOf, IDLE } from './helpers/simworld.js';

const lineOf = (id) => DATA.ascensions.find((l) => l.weapons.includes(id));

/** Drop an Ember at your feet and step once (it's picked up). */
function ember(w) {
  spawnPickup(w, PK.EMBER, w.player.x, w.player.y, 0, 0);
  stepWorld(w, IDLE);
}

test('embers: one picked up stops the run for the choice; ascending spends it and changes the weapon', () => {
  const w = makeWorld({ invulnerable: true });
  give(w, 'flare_gun', { level: 3 });
  const before = { ...w.slots[0].stats };
  ember(w);
  assert.equal(w.build.embers, 1);
  assert.equal(currentHalt(w)?.kind, 'ascend');
  assert.equal(eventsOf(w, EV.PICKUP).filter((e) => e.a === PK.EMBER).length, 1);
  const v = haltView(w, currentHalt(w), DATA);
  assert.equal(v.kind, 'ascend');
  assert.deepEqual(v.weapons.map((x) => x.slot), [0]);
  // The weapon, with its line's three Forms in the order of their kinds, none taken.
  assert.deepEqual(v.weapons[0].forms.map((o) => [o.id, o.axis, o.taken, o.why]), [['salvo', 'delivery', false, null], ['mortar', 'flight', false, null], ['hanging_flare', 'payoff', false, null]]);
  assert.throws(() => decide(w, { kind: 'ascend', slot: 0, id: 'nope' }), /can't take "nope"/);
  assert.throws(() => decide(w, { kind: 'ascend', slot: 4, id: 'salvo' }), /can't take/);
  assert.throws(() => decide(w, { kind: 'ok' }), /expected "ascend" or "keep"/);
  decide(w, { kind: 'ascend', slot: 0, id: 'salvo' });
  assert.equal(w.build.embers, 0);
  assert.equal(currentHalt(w), null);
  const s = w.slots[0];
  assert.deepEqual(s.ascensions.map((a) => a.id), ['salvo']);
  assert.ok(s.fx.salvo, 'the Form is on the slot, by its mechanic');
  assert.equal(s.stats.amount, before.amount, 'Salvo changes when it fires, not its numbers');
  assert.deepEqual(w.result.ascensions.map((a) => [a.weapon, a.id]), [['flare_gun', 'salvo']]);
  assert.equal(eventsOf(w, EV.ASCEND).length, 1);
  assert.equal(noticeFor(w.events, w.events.type.indexOf(EV.ASCEND), w), 'Ascended: Flare Gun');
  // A level-up keeps it (the slot is rebuilt from its definition and keeps its ascensions).
  decide(w, { kind: 'dev', cmd: 'level', count: 1 });
  stepWorld(w, IDLE);
  while (currentHalt(w)) decide(w, { kind: 'pick', index: 0 });
  assert.deepEqual(w.slots[0].ascensions.map((a) => a.id), ['salvo']);
  // They stack: a second Ember, a second Form on the same weapon, working alongside the first.
  ember(w);
  decide(w, { kind: 'ascend', slot: 0, id: 'mortar' });
  assert.deepEqual(w.slots[0].ascensions.map((a) => a.id), ['salvo', 'mortar']);
  assert.equal(w.slots[0].motion.type, 'arc', 'flares are lobbed');
  assert.ok(w.slots[0].fx.salvo, 'and the Salvo is still there');
  const view = haltView(w, { kind: 'ascend' }, DATA);
  assert.deepEqual(view.weapons[0].forms.map((o) => o.taken), [true, true, false], 'what is taken is shown, not offered again');
  assert.deepEqual(openAscensions(w, 0).map((o) => o.id), ['hanging_flare']);
  const r = buildRunResult(w);
  assert.equal(r.embers, 2);
  assert.equal(r.ascensions.length, 2);
});

test('embers: kept for later, spent from the pause menu; with nothing to ascend, kept without stopping', () => {
  const w = makeWorld({ invulnerable: true });
  give(w, 'harpoon_chain');
  ember(w);
  decide(w, { kind: 'keep' });
  assert.equal(w.build.embers, 1);
  assert.equal(currentHalt(w), null);
  assert.equal(pauseBuild(w).canAscend, true);
  assert.equal(pauseBuild(w).embers, 1);
  decide(w, { kind: 'ember' });
  assert.equal(currentHalt(w)?.kind, 'ascend');
  assert.throws(() => decide(w, { kind: 'ember' }), /spent with nothing else waiting/, 'not twice while it waits');
  assert.equal(pauseBuild(w).canAscend, false, 'and the pause doesn\'t offer it over the screen');
  decide(w, { kind: 'ascend', slot: 0, id: 'tether' });
  assert.throws(() => decide(w, { kind: 'ember' }), /no Ember kept/);
  // A weapon with every ascension taken: an Ember is kept, the run goes on.
  const full = makeWorld({ invulnerable: true });
  give(full, 'tide_bell');
  for (const o of lineOf('tide_bell').options) { ember(full); decide(full, { kind: 'ascend', slot: 0, id: o.id }); }
  assert.equal(canAscend(full), false);
  assert.deepEqual(openAscensions(full, 0), []);
  ember(full);
  assert.equal(currentHalt(full), null);
  assert.equal(full.build.embers, 1);
  assert.throws(() => decide(full, { kind: 'ember' }), /no weapon can ascend/);
  // The hash sees Embers and ascensions.
  const a = makeWorld({ invulnerable: true }), b = makeWorld({ invulnerable: true });
  give(a, 'flare_gun'); give(b, 'flare_gun');
  ember(a); ember(b);
  decide(a, { kind: 'keep' }); decide(b, { kind: 'ascend', slot: 0, id: 'mortar' });
  assert.notEqual(hashWorld(a), hashWorld(b));
});

test('embers: an evolution keeps its weapon\'s ascensions; bosses, the muster\'s captain, and some elites drop them', () => {
  const w = makeWorld({ invulnerable: true });
  give(w, 'flare_gun', { level: 8 });
  ember(w);
  decide(w, { kind: 'ascend', slot: 0, id: 'hanging_flare' });
  decide(w, { kind: 'dev', cmd: 'give', what: 'passive', id: 'wick_oil' });
  for (let k = 0; k < 4; k++) decide(w, { kind: 'dev', cmd: 'give', what: 'passive', id: 'wick_oil' });
  decide(w, { kind: 'dev', cmd: 'chest', boss: true });
  while (currentHalt(w)) decide(w, currentHalt(w).kind === 'rune' ? { kind: 'discard' } : { kind: 'ok' });
  assert.equal(w.slots[0].def.id, 'flare_barrage', 'evolved');
  assert.deepEqual(w.slots[0].ascensions.map((x) => x.id), ['hanging_flare'], 'kept through the evolution');
  assert.ok(w.slots[0].fx.hang && w.fxLists[w.slots[0].list].some((e) => e.type === 'hang'), 'and working on it');
  // Drops: a boss always; an elite at tuning.embers.eliteChance (0 or 1 here, to be sure).
  const embersOnGround = (x) => [...Array(x.pickups.count).keys()].filter((i) => x.pickups.kind[i] === PK.EMBER).length;
  const b = makeWorld({ invulnerable: true }, { events: [{ at: 0, event: 'boss', enemy: 'harbor_maw' }] });
  run(b, 1);
  b.enemies.flags[b.enemies.resolve(b.bosses[0].handle)] |= EF.DEAD;
  stepWorld(b, IDLE);
  assert.equal(embersOnGround(b), 1, 'a boss');
  for (const [chance, n] of [[0, 0], [1, 1]]) {
    const e = makeWorld({ invulnerable: true, tuning: { embers: { eliteChance: chance } } });
    const i = spawnAt(e, 'drowned_bosun', 200, 0, { elite: true });
    e.enemies.flags[i] |= EF.DEAD;
    stepWorld(e, IDLE);
    assert.equal(embersOnGround(e), n, `an elite at chance ${chance}`);
  }
});

test('stats: the screen\'s numbers are the run\'s own', () => {
  const w = makeWorld({ invulnerable: true });
  give(w, 'flare_gun', { level: 4 });
  decide(w, { kind: 'dev', cmd: 'give', what: 'passive', id: 'tallow_candle' });
  decide(w, { kind: 'dev', cmd: 'give', what: 'passive', id: 'wick_oil' });
  const v = statsView(w);
  const get = (lines, k) => lines.find(([a]) => a === k)?.[1];
  assert.equal(get(v.character, 'HP'), `${Math.ceil(w.player.hp)}/${Math.round(w.stats.maxHp)}`);
  assert.equal(get(v.allWeapons, 'Cooldown'), '-6%', 'Tallow Candle reaches every weapon');
  assert.equal(get(v.allWeapons, 'Damage'), '0%', 'Wick Oil is for fire weapons only, so not here');
  assert.equal(v.weapons.length, 1);
  assert.equal(v.weapons[0].name, 'Flare Gun');
  assert.equal(get(v.weapons[0].lines, 'Damage'), String(Math.round(w.slots[0].stats.damage * 10) / 10));
  assert.equal(get(v.weapons[0].lines, 'Total Damage'), '0');
  assert.equal(get(v.weapons[0].lines, 'DPS'), '0');
  // DPS: its total over the seconds since it was taken (a first second counts whole).
  assert.deepEqual([dpsText(1000, 10), dpsText(55, 10), dpsText(10, 0.2), dpsText(123456, 60), dpsText(253, 10), dpsText(99, 10)], ['100', '5.5', '10', '2,058', '25', '9.9']);
  const t0 = w.slots[0].since;
  for (let k = 0; k < 120; k++) stepWorld(w, IDLE);
  w.result.damageBySlot[0] = 600;
  assert.equal(get(statsView(w).weapons[0].lines, 'DPS'), dpsText(600, (w.tick - t0) / 60));
  decide(w, { kind: 'dev', cmd: 'level', count: 1 });
  while (currentHalt(w)) decide(w, { kind: 'pick', index: 0 });
  assert.equal(w.slots[0].since, t0, 'a rebuilt slot keeps when it was taken');
  // Materials found: on the pause menu and Stats (not the HUD), whole counts, no rounding dust.
  w.result.materialsRaw[w.materialIndex.get('rope')] = 3.9999999999;
  w.result.materialsRaw[w.materialIndex.get('coin')] = 0.5;
  assert.deepEqual(materialsFound(w).map((m) => [m.id, m.count]), [['rope', 4]]);
  assert.deepEqual(pauseBuild(w).materials, materialsFound(w));
  assert.deepEqual(statsView(w).materials, materialsFound(w));
  // The items you carry: the passives with their levels, then the relics.
  assert.deepEqual(v.items.map((x) => [x.kind, x.name, x.level]), [['passive', 'Tallow Candle', 1], ['passive', 'Wick Oil', 1]]);
  assert.ok(v.items.every((x) => x.desc && x.icon));
  // A character's own weapon is there too, marked as hers.
  const lamp = makeWorld({ character: 'lamplighter', invulnerable: true });
  const own = statsView(lamp).weapons.find((x) => x.innate);
  assert.ok(own && own.lines.length, 'the Lamplighter\'s light has its numbers');
});

test('embers: a run that takes, keeps, and spends them replays exactly; one that finds the pickup pool full is picked up at once', () => {
  const rec = createRecordedRun({ seed: 'ember-replay', map: 'drowned_docks', character: 'lamplighter', invulnerable: true }, DATA, 'b1');
  for (let t = 0; t < 900; t++) {
    if (t === 100 || t === 300 || t === 500) rec.decide({ kind: 'dev', cmd: 'ember' });
    if (t === 600) rec.decide({ kind: 'ember' });
    rec.step({ mx: (t % 240) < 120 ? 90 : -90, my: 30, buttons: 0 });
    while (currentHalt(rec.world)) {
      const h = currentHalt(rec.world);
      if (h.kind === 'ascend') {
        const v = haltView(rec.world, h, DATA);
        const pick = { kind: 'ascend', slot: v.weapons[0].slot, id: v.weapons[0].forms.find((f) => !f.taken && !f.why).id };
        rec.decide(rec.world.tick < 400 && rec.world.build.embers === 1 && !rec.world.slots[0].ascensions.length ? pick : rec.world.tick < 400 ? { kind: 'keep' } : pick);
      } else rec.decide(h.kind === 'draft' ? { kind: 'pick', index: 0 } : h.kind === 'rune' ? { kind: 'discard' } : h.kind === 'overtime' ? { kind: 'leave' } : { kind: 'ok' });
    }
  }
  const replay = rec.toReplay();
  assert.ok(replay.decisions.some((d) => d.kind === 'ascend') && replay.decisions.some((d) => d.kind === 'keep') && replay.decisions.some((d) => d.kind === 'ember'));
  const back = playReplay(replay, DATA, { buildId: 'b1' });
  assert.equal(hashWorld(back), replay.hash);
  assert.deepEqual(back.slots[0].ascensions.map((a) => a.id), rec.world.slots[0].ascensions.map((a) => a.id));
  // A full pool: 224 materials (up to the reserve), then chests to the last slot; an Ember then
  // goes straight to you rather than being lost.
  const w = makeWorld({ invulnerable: true });
  give(w, 'flare_gun');
  const P = w.pickups;
  while (P.count < P.capacity - PICKUP_RESERVE) spawnPickup(w, PK.MATERIAL, w.player.x + 300, w.player.y + 300, 0, 1);
  while (P.count < P.capacity) spawnPickup(w, PK.CHEST, w.player.x + 300, w.player.y - 300, 1, 0);
  assert.equal(spawnPickup(w, PK.EMBER, w.player.x + 300, w.player.y, 0, 0), -1);
  assert.equal(w.build.embers, 1, 'picked up at once');
  assert.equal(currentHalt(w)?.kind, 'ascend');
  assert.equal(P.refused, 0);
});

test('embers: a Form a rune rules out is shown, marked with the rune, and refused', () => {
  const w = makeWorld({ invulnerable: true });
  give(w, 'harpoon_chain', { runes: ['orbiting'] });
  ember(w);
  const v = haltView(w, currentHalt(w), DATA);
  assert.deepEqual(v.weapons[0].forms.map((f) => [f.id, f.why]), [['lunge', 'Not with Orbiting'], ['skewer', 'Not with Orbiting'], ['tether', null]]);
  assert.throws(() => decide(w, { kind: 'ascend', slot: 0, id: 'skewer' }), /can't take "skewer"/);
  decide(w, { kind: 'ascend', slot: 0, id: 'tether' });
  assert.deepEqual(w.slots[0].ascensions.map((a) => a.id), ['tether']);
});

test('embers: two picked up on one tick with one ascension left open: the second is kept, and no empty screen opens', () => {
  const w = makeWorld({ invulnerable: true });
  give(w, 'tide_bell');
  const [a, b, c] = lineOf('tide_bell').options;
  for (const o of [a, b]) { ember(w); decide(w, { kind: 'ascend', slot: 0, id: o.id }); }
  spawnPickup(w, PK.EMBER, w.player.x, w.player.y, 0, 0);
  spawnPickup(w, PK.EMBER, w.player.x, w.player.y, 0, 0);
  stepWorld(w, IDLE);
  assert.deepEqual(w.halts.map((h) => h.kind), ['ascend', 'ascend']);
  decide(w, { kind: 'ascend', slot: 0, id: c.id });
  assert.equal(currentHalt(w), null, 'nothing left to take: no second screen');
  assert.equal(w.build.embers, 1, 'that Ember is kept');
  assert.equal(pauseBuild(w).canAscend, false);
});

