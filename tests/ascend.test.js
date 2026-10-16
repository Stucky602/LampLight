// Embers and ascensions (sim/ascend.js, data/ascensions.js) and the stats screen's numbers (the
// harbor's guide and walk-off: tests/guide.test.js; the minimap: tests/minimap.test.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA } from '../src/data/index.js';
import { decide, currentHalt, stepWorld, hashWorld, buildRunResult } from '../src/sim/world.js';
import { buildSlot, runeFits, MIRRORED_EMITS } from '../src/sim/weapons.js';
import { EV } from '../src/sim/events.js';
import { EF, PK, EMIT } from '../src/sim/constants.js';
import { spawnPickup, PICKUP_RESERVE } from '../src/sim/pickups.js';
import { createRecordedRun, playReplay } from '../src/sim/replay.js';
import { openAscensions, canAscend } from '../src/sim/ascend.js';
import { haltView, statsView, pauseBuild, noticeFor } from '../src/app/runlogic.js';
import { makeWorld, give, run, spawnAt, eventsOf, IDLE } from './helpers/simworld.js';

const lineOf = (id) => DATA.ascensions.find((l) => l.weapons.includes(id));

/** Drop an Ember at your feet and step once (it's picked up). */
function ember(w) {
  spawnPickup(w, PK.EMBER, w.player.x, w.player.y, 0, 0);
  stepWorld(w, IDLE);
}

test('ascensions: every line names real weapons and three options with plain words; each one changes its weapon', () => {
  const ids = new Set();
  for (const line of DATA.ascensions) {
    assert.equal(line.options.length, 3, `${line.line}: three options`);
    for (const wid of line.weapons) {
      const def = DATA.weapons.find((w) => w.id === wid);
      assert.ok(def && !def.innate, `${line.line}: weapon ${wid}`);
      assert.equal(DATA.ascensions.filter((l) => l.weapons.includes(wid)).length, 1, `${wid} is in one line`);
    }
    for (const o of line.options) {
      assert.ok(/^[a-z][a-z0-9_]*$/.test(o.id) && !ids.has(o.id), `ascension id ${o.id}`); ids.add(o.id);
      assert.ok(typeof o.name === 'string' && o.name.length > 2 && !/^The /.test(o.name), `${o.id}: a name`);
      assert.ok(typeof o.desc === 'string' && o.desc.length > 5 && o.desc.length < 80 && o.desc.endsWith('.'), `${o.id}: a plain sentence`);
      assert.ok(Object.keys(o).every((k) => ['id', 'name', 'desc', 'add', 'onHitAdd', 'emitAdd', 'mirror'].includes(k)), `${o.id}: only known patch fields`);
    }
  }
  // Every base weapon that's drafted has a line.
  for (const w of DATA.weapons.filter((x) => x.unlock !== 'evolution' && !x.innate)) assert.ok(lineOf(w.id), `${w.id} can ascend`);
  // Each ascension, on each weapon of its line at its last level, runs cleanly, never changes the
  // emitter, and does something: the damage over 10 s on the same crowd differs from the bare weapon's.
  for (const line of DATA.ascensions) for (const wid of line.weapons) {
    const def = DATA.weapons.find((w) => w.id === wid);
    const dealt = (asc) => {
      const w = makeWorld({ seed: 7, invulnerable: true });
      for (let k = 0; k < 18; k++) {
        const a = (k / 18) * Math.PI * 2;
        const i = spawnAt(w, k % 3 ? 'drowned_sailor' : 'mud_crab', Math.cos(a) * (50 + (k % 4) * 25), Math.sin(a) * (50 + (k % 3) * 25));
        w.enemies.hp[i] = w.enemies.maxHp[i] = 500;
      }
      const slot = give(w, wid, { level: def.maxLevel });
      if (asc) {
        w.slots[0] = buildSlot(w, 0, def, def.maxLevel, slot.runes, { ...slot, ascensions: [asc] });
        assert.equal(w.slots[0].emitType, EMIT[def.pipeline.emit.type], `${asc.id} on ${wid}: the same emitter`);
      }
      run(w, 600, { mx: 40, my: 20, buttons: 0 }, { halts: 'pass' });
      let where = 0;
      for (const f of ['x', 'y', 'hp']) for (let i = 0; i < w.enemies.count; i++) { assert.ok(Number.isFinite(w.enemies[f][i]), `${asc?.id} on ${wid}: finite ${f}`); if (f !== 'hp') where += w.enemies[f][i]; }
      // What it did: the damage dealt, and where the crowd ended up (a pull or a slow moves it).
      return `${w.result.damageBySlot[0].toFixed(2)} ${where.toFixed(1)}`;
    };
    const bare = dealt(null);
    for (const o of line.options) assert.notEqual(dealt(o), bare, `${o.id} on ${wid} changes nothing`);
  }
});

test('ascensions: joined onto a weapon\'s own effect, amounts add, reaches take the larger, a chain\'s per-hop multiplier never adds', () => {
  const w = makeWorld({ invulnerable: true });
  const opt = (id) => DATA.ascensions.flatMap((l) => l.options).find((o) => o.id === id);
  const listOf = (wid, ids) => {
    const def = DATA.weapons.find((x) => x.id === wid);
    const slot = buildSlot(w, 0, def, 1, [], { ascensions: ids.map(opt), aimX: 1, aimY: 0, cd: 0, burst: 0, burstT: 0, volley: 0, volleyTargets: new Int32Array(24), angle: 0, auraHandle: -1, lastZoneTicks: new Float64Array(4), fired: 0 });
    return w.fxLists[slot.list];
  };
  const find = (list, type, status) => list.filter((e) => e.type === type && (type !== 'status' || e.status === status));
  // Barbed Line on the Kraken Line's chain: one more hop, its own reach and per-hop share kept.
  const kraken = find(listOf('kraken_line', ['barbed_line']), 'chain');
  assert.equal(kraken.length, 1);
  assert.deepEqual([kraken[0].hops, kraken[0].range, kraken[0].damageMul], [4, 90, 0.7]);
  // On the Harpoon Chain (no chain of its own) it's appended as written.
  assert.deepEqual(find(listOf('harpoon_chain', ['barbed_line']), 'chain').map((e) => [e.hops, e.range, e.damageMul]), [[1, 80, 0.5]]);
  // Starburst on the Flare Barrage's burst: 40% more of the hit, at the larger radius.
  const burst = find(listOf('flare_barrage', ['starburst']), 'explode');
  assert.equal(burst.length, 1);
  assert.ok(Math.abs(burst[0].damageMul - 1.0) < 1e-9 && burst[0].radius === 22, JSON.stringify(burst[0]));
  // Cold Water on the Storm Bell's freeze: longer; Black Wick on the candles' rot: 50%.
  assert.ok(Math.abs(find(listOf('storm_bell', ['cold_water']), 'status', 'freeze')[0].duration - 1.3) < 1e-9);
  assert.equal(find(listOf('corpse_candles', ['black_wick']), 'status', 'rot')[0].amp, 0.5);
  // Greek Fire: the flask's oil twice as hard and twice as long, at its own pace.
  const oil = find(listOf('oil_flask', ['greek_fire']), 'zone')[0];
  assert.deepEqual([oil.damage, oil.duration, oil.radius, oil.interval, oil.every], [8, 6, 22, 0.4, 0.25]);
  // On every weapon of every line: no chain hop stronger than the hit, no slow past 80%, no reach
  // past the larger of the two, and every effect the ascension names is there.
  for (const line of DATA.ascensions) for (const wid of line.weapons) for (const o of line.options) {
    const list = listOf(wid, [o.id]);
    const own = DATA.weapons.find((x) => x.id === wid).pipeline.onHit;
    for (const e of list) {
      if (e.type === 'chain') assert.ok(e.damageMul === undefined || e.damageMul <= 1, `${o.id} on ${wid}: chain hops ${e.damageMul}`);
      if (e.type === 'status' && e.status === 'slow') assert.ok(e.pct <= 0.8, `${o.id} on ${wid}: slow ${e.pct}`);
      for (const k of ['radius', 'range']) {
        if (e[k] === undefined) continue;
        const from = [...own, ...(o.onHitAdd || [])].filter((x) => x.type === e.type && (x.type !== 'status' || x.status === e.status)).map((x) => x[k] ?? 0);
        assert.ok(e[k] <= Math.max(...from), `${o.id} on ${wid}: ${e.type} ${k} ${e[k]}`);
      }
    }
    for (const add of o.onHitAdd || []) assert.ok(find(list, add.type, add.status).length >= 1, `${o.id} on ${wid}: has its ${add.type}`);
  }
});

test('ascensions and runes never cancel each other: an ascension is offered only where all of it works, a rune fits only if every ascension still does', () => {
  const opt = (id) => DATA.ascensions.flatMap((l) => l.options).find((o) => o.id === id);
  const rune = (id) => DATA.runes.find((r) => r.id === id);
  const flare = DATA.weapons.find((x) => x.id === 'flare_gun');
  // Signal Pair already fires backward: Backfire would add nothing, Orbiting would cancel it.
  assert.equal(runeFits(rune('backfire'), flare, [null, null], [opt('signal_pair')]), false);
  assert.equal(runeFits(rune('orbiting'), flare, [null, null], [opt('signal_pair')]), false);
  assert.equal(runeFits(rune('splitting'), flare, [null, null], [opt('signal_pair')]), true);
  // Heavy pierce on an Orbiting weapon (it pierces everything): Heavy Iron, White Phosphor kept off.
  assert.equal(runeFits(rune('orbiting'), flare, [null, null], [opt('white_phosphor')]), false);
  // The other way round: a Backfire Flare Gun isn't offered Signal Pair; an Orbiting one, neither
  // Signal Pair nor White Phosphor.
  const w = makeWorld({ invulnerable: true, all: true });
  give(w, 'flare_gun', { runes: ['backfire'] });
  assert.deepEqual(openAscensions(w, 0).map((o) => o.id), ['starburst', 'white_phosphor']);
  w.slots[0] = null;
  give(w, 'flare_gun', { slot: 0, runes: ['orbiting'] });
  assert.deepEqual(openAscensions(w, 0).map((o) => o.id), ['starburst']);
  // Every rune with every ascension on every weapon of its line, whichever came first: where the
  // pair is allowed, each still changes the weapon over the other alone (a structural check: the
  // slot's emitter, motion, mirror, numbers, and on-hit list).
  const sig = (slot) => JSON.stringify([slot.emit, slot.motion, slot.mirror, slot.stats, w.fxLists[slot.list]]);
  const blank = { aimX: 1, aimY: 0, cd: 0, burst: 0, burstT: 0, volley: 0, volleyTargets: new Int32Array(24), angle: 0, auraHandle: -1, lastZoneTicks: new Float64Array(4), fired: 0 };
  let pairs = 0;
  for (const line of DATA.ascensions) for (const wid of line.weapons) {
    const def = DATA.weapons.find((x) => x.id === wid);
    if (!def.runeSlots) continue;
    for (const o of line.options) for (const r of DATA.runes) {
      if (!runeFits(r, def, new Array(def.runeSlots).fill(null), [o])) continue;
      const runes = [r, ...new Array(def.runeSlots - 1).fill(null)];
      const both = sig(buildSlot(w, 0, def, 1, runes, { ...blank, ascensions: [o] }));
      assert.notEqual(both, sig(buildSlot(w, 0, def, 1, runes, { ...blank, ascensions: [] })), `${o.id} does nothing on a ${r.id} ${wid}`);
      assert.notEqual(both, sig(buildSlot(w, 0, def, 1, new Array(def.runeSlots).fill(null), { ...blank, ascensions: [o] })), `${r.id} does nothing on ${o.id} ${wid}`);
      const built = buildSlot(w, 0, def, 1, runes, { ...blank, ascensions: [o] });
      if (o.mirror) assert.ok(built.mirror && MIRRORED_EMITS.includes(built.emit.type), `${o.id} on a ${r.id} ${wid} fires backward`);
      if (o.add?.pierce) assert.ok(built.stats.pierce >= 0, `${o.id} on a ${r.id} ${wid}: its pierce counts`);
      pairs++;
    }
  }
  assert.ok(pairs > 40, `${pairs} pairs checked`);
  // The Backfire rune is valid exactly where firing backward means something.
  assert.deepEqual([...rune('backfire').validOn.emit].sort(), [...MIRRORED_EMITS].sort());
});

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
  assert.deepEqual(v.weapons[0].options.map((o) => o.id), lineOf('flare_gun').options.map((o) => o.id));
  assert.throws(() => decide(w, { kind: 'ascend', slot: 0, id: 'nope' }), /can't take "nope"/);
  assert.throws(() => decide(w, { kind: 'ascend', slot: 4, id: 'signal_pair' }), /can't take/);
  assert.throws(() => decide(w, { kind: 'ok' }), /expected "ascend" or "keep"/);
  decide(w, { kind: 'ascend', slot: 0, id: 'signal_pair' });
  assert.equal(w.build.embers, 0);
  assert.equal(currentHalt(w), null);
  const s = w.slots[0];
  assert.deepEqual(s.ascensions.map((a) => a.id), ['signal_pair']);
  assert.equal(s.stats.amount, before.amount + 1, '+1 Projectile');
  assert.equal(s.mirror, true, 'fires backward too');
  assert.deepEqual(w.result.ascensions.map((a) => [a.weapon, a.id]), [['flare_gun', 'signal_pair']]);
  assert.equal(eventsOf(w, EV.ASCEND).length, 1);
  assert.equal(noticeFor(w.events, w.events.type.indexOf(EV.ASCEND), w), 'Ascended: Flare Gun');
  // A level-up keeps it (the slot is rebuilt from its definition and keeps its ascensions).
  decide(w, { kind: 'dev', cmd: 'level', count: 1 });
  stepWorld(w, IDLE);
  while (currentHalt(w)) decide(w, { kind: 'pick', index: 0 });
  assert.deepEqual(w.slots[0].ascensions.map((a) => a.id), ['signal_pair']);
  // They stack: a second Ember, a second ascension on the same weapon.
  ember(w);
  decide(w, { kind: 'ascend', slot: 0, id: 'starburst' });
  assert.deepEqual(w.slots[0].ascensions.map((a) => a.id), ['signal_pair', 'starburst']);
  assert.ok(w.fxLists[w.slots[0].list].some((e) => e.type === 'explode'), 'flares burst');
  const view = haltView(w, { kind: 'ascend' }, DATA);
  assert.deepEqual(view.weapons[0].options.map((o) => o.id), ['white_phosphor'], 'what is taken is not offered again');
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
  decide(w, { kind: 'ascend', slot: 0, id: 'heavy_iron' });
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
  decide(a, { kind: 'keep' }); decide(b, { kind: 'ascend', slot: 0, id: 'starburst' });
  assert.notEqual(hashWorld(a), hashWorld(b));
});

test('embers: an evolution keeps its weapon\'s ascensions; bosses, the muster\'s captain, and some elites drop them', () => {
  const w = makeWorld({ invulnerable: true });
  give(w, 'flare_gun', { level: 8 });
  ember(w);
  decide(w, { kind: 'ascend', slot: 0, id: 'white_phosphor' });
  decide(w, { kind: 'dev', cmd: 'give', what: 'passive', id: 'wick_oil' });
  for (let k = 0; k < 4; k++) decide(w, { kind: 'dev', cmd: 'give', what: 'passive', id: 'wick_oil' });
  decide(w, { kind: 'dev', cmd: 'chest', boss: true });
  while (currentHalt(w)) decide(w, currentHalt(w).kind === 'rune' ? { kind: 'discard' } : { kind: 'ok' });
  assert.equal(w.slots[0].def.id, 'flare_barrage', 'evolved');
  assert.deepEqual(w.slots[0].ascensions.map((x) => x.id), ['white_phosphor'], 'kept through the evolution');
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
  assert.equal(get(v.weapons[0].lines, 'Dealt this run'), '0');
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
        rec.decide(rec.world.tick < 400 && rec.world.build.embers === 1 && !rec.world.slots[0].ascensions.length ? { kind: 'ascend', slot: v.weapons[0].slot, id: v.weapons[0].options[0].id } : rec.world.tick < 400 ? { kind: 'keep' } : { kind: 'ascend', slot: v.weapons[0].slot, id: v.weapons[0].options[0].id });
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

