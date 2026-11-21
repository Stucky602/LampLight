// Forms as choices (ruling 14, C1: three axes, two options each, one held an axis), the deeds that
// open capstones, Embers (sim/ascend.js; the Forms themselves: tests/forms.test.js) and the stats screen's numbers (the
// harbor's guide and walk-off: tests/guide.test.js; the minimap: tests/minimap.test.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA } from '../src/data/index.js';
import { weaponLook } from '../src/data/ascensions.js';
import { decide, currentHalt, stepWorld, hashWorld, buildRunResult } from '../src/sim/world.js';
import { EV } from '../src/sim/events.js';
import { EF, PK, EMIT } from '../src/sim/constants.js';
import { spawnPickup, PICKUP_RESERVE } from '../src/sim/pickups.js';
import { createRecordedRun, playReplay } from '../src/sim/replay.js';
import { axisState, optionChoices, giveUpgrade, offerAxis, signatureSlot } from '../src/sim/ascend.js';
import { numberAt } from '../src/sim/weaponups.js';
import { deedKill, deedState } from '../src/sim/deeds.js';
import { haltView, statsView, pauseBuild, noticeFor, dpsText, materialsFound } from '../src/app/runlogic.js';
import { makeWorld, give, givePassive, run, spawnAt, eventsOf, IDLE } from './helpers/simworld.js';

const lineOf = (id) => DATA.ascensions.find((l) => l.weapons.includes(id));

/** Drop an Ember at your feet and step once (it's picked up). */
function ember(w) {
  spawnPickup(w, PK.EMBER, w.player.x, w.player.y, 0, 0);
  stepWorld(w, IDLE);
}

const ids = (list) => list.map((x) => x.id);
const levelTo = (w, s, n) => { while (w.slots[s].ups.length < n) { giveUpgrade(w, s, { up: 'damage', ...numberAt(w, 'damage', 'common') }); while (currentHalt(w)) decide(w, { kind: 'keep' }); } };

test('forms: a weapon has three axes and two options on each; leveling opens the first two (its 5th and 10th upgrade), and the run stops for the choice', () => {
  const w = makeWorld({ invulnerable: true });
  give(w, 'flare_gun', { level: 1 });
  const st = axisState(w, 0);
  assert.deepEqual(st.map((a) => [a.axis, a.open, a.at, ids(a.options)]), [['delivery', false, 5, ['salvo', 'muzzle_flash']], ['flight', false, 10, ['mortar', 'star_shell']], ['payoff', false, null, ['hanging_flare', 'phosphor']]]);
  assert.deepEqual(st[2].deed, { have: 0, need: DATA.weapons.find((x) => x.id === 'flare_gun').deed.count, done: false, text: DATA.weapons.find((x) => x.id === 'flare_gun').deed.text });
  for (let n = 1; n < 5; n++) giveUpgrade(w, 0, { up: 'damage', ...numberAt(w, 'damage', 'common') });
  assert.equal(currentHalt(w), null, 'nothing opens before the 5th');
  giveUpgrade(w, 0, { up: 'damage', ...numberAt(w, 'damage', 'common') });
  assert.deepEqual(currentHalt(w), { kind: 'ascend', slot: 0, axis: 'delivery', why: 'level' });
  const v = haltView(w, currentHalt(w), DATA);
  assert.equal(v.direct, true);
  assert.deepEqual(v.weapons[0].forms.map((f) => [f.id, f.cost, f.price]), [['salvo', 'free', '+10% Cooldown'], ['muzzle_flash', 'free', '-25% Range']], 'that axis\'s two, each with its price');
  assert.throws(() => decide(w, { kind: 'ascend', slot: 0, id: 'mortar' }), /no Ember to spend/, 'the next axis is still shut: only an Ember opens it');
  decide(w, { kind: 'ascend', slot: 0, id: 'salvo' });
  assert.equal(w.build.embers, 0, 'free: the axis was open');
  assert.deepEqual(ids(w.slots[0].ascensions), ['salvo']);
  assert.ok(w.slots[0].fx.salvo);
  assert.equal(eventsOf(w, EV.ASCEND).length, 1);
  assert.equal(noticeFor(w.events, w.events.type.indexOf(EV.ASCEND), w), null, 'a Form taken says nothing mid-fight (C3, ruling 14 E)');
  assert.throws(() => decide(w, { kind: 'ascend', slot: 0, id: 'muzzle_flash' }), /Nothing to decide|can't take/, 'one option an axis: the other is an Ember\'s switch');
  levelTo(w, 0, 10);
  assert.equal(w.slots[0].axes & 2, 2, 'how its shots travel opens at the 10th');
  // A choice kept for later waits on the pause menu's Forms.
  assert.equal(pauseBuild(w).canAscend, true);
  decide(w, { kind: 'ember' });
  decide(w, { kind: 'ascend', slot: 0, id: 'star_shell' });
  assert.deepEqual(ids(w.slots[0].ascensions), ['salvo', 'star_shell']);
  assert.equal(w.slots[0].stats.pierce, 3, 'Star Shell passes through 3 (ruling 19 RA)');
  // A character's own weapon is out of this: its level opens nothing (its track does: section 8).
  const lamp = makeWorld({ character: 'lamplighter', invulnerable: true });
  const sig = signatureSlot(lamp);
  assert.ok(sig >= 0);
  for (let n = 0; n < 6; n++) giveUpgrade(lamp, sig, { up: 'damage', ...numberAt(lamp, 'damage', 'common') });
  assert.equal(currentHalt(lamp), null);
  assert.ok(offerAxis(lamp, sig, 'delivery'), 'its track offers the choice');
  assert.deepEqual(currentHalt(lamp), { kind: 'ascend', slot: sig, axis: 'delivery', why: 'track' });
});

test('forms: the capstone opens by its deed, unless the profile lacks it; its partner passive makes it hit harder', () => {
  const w = makeWorld({ invulnerable: true });
  give(w, 'oil_flask');
  const d = DATA.weapons.find((x) => x.id === 'oil_flask').deed;
  w.slots[0].deed = d.count - 1;
  const e = spawnAt(w, 'drowned_sailor', 20, 0);
  w.enemies.burnT[e] = 2;
  deedKill(w, w.slots[0], e);
  assert.equal(deedState(w, 0).done, true);
  stepWorld(w, IDLE);
  assert.deepEqual(currentHalt(w), { kind: 'ascend', slot: 0, axis: 'payoff', why: 'deed' });
  decide(w, { kind: 'ascend', slot: 0, id: 'pitch' });
  assert.deepEqual(ids(w.slots[0].ascensions), ['pitch']);
  assert.equal(w.result.ascensions[0].capstone, true);
  assert.deepEqual(buildRunResult(w).capstones, ['oil_flask']);
  // Its partner: each level makes the capstone hit harder (it gates nothing).
  const d0 = w.slots[0].stats.damage;
  givePassive(w, 'wick_oil', 3);
  const fireMul = (1 + 3 * 0.12) * (1 + DATA.tuning.weaponUps.kindred.per);   // (Wick Oil's own +12% Damage (Fire) a level, and it is Fire kin: Kindred)
  assert.ok(Math.abs(w.slots[0].stats.damage / d0 - fireMul * (1 + 3 * DATA.tuning.forms.partnerPer)) < 1e-6, 'partner bonus on a capstone');
  // A line with a capstoneUnlock the profile lacks keeps the capstone shut, and says what opens it.
  const locked = makeWorld({ invulnerable: true, forms: [] });
  give(locked, 'lantern_orb');
  assert.equal(axisState(locked, 0).find((a) => a.axis === 'payoff').locked, 'research:orbwright');
  locked.slots[0].deed = 9999; locked.deedsDone.push(0);
  stepWorld(locked, IDLE);
  assert.equal(locked.slots[0].axes & 4, 0, 'shut');
  assert.equal(currentHalt(locked), null);
  // The capstone takes its look.
  const f = makeWorld({ invulnerable: true });
  give(f, 'flare_gun', { forms: ['hanging_flare'] });
  assert.deepEqual(weaponLook(f.slots[0].def, f.slots[0].ascensions), DATA.ascensions.find((l) => l.line === 'flare_gun').options.find((o) => o.id === 'hanging_flare').look);
});

test('embers: one opens a weapon\'s next axis early or switches an option it holds; bosses, the muster\'s captain, and some elites drop them', () => {
  const w = makeWorld({ invulnerable: true });
  give(w, 'flare_gun', { level: 3 });
  ember(w);
  assert.equal(w.build.embers, 1);
  assert.equal(currentHalt(w)?.kind, 'ascend');
  assert.equal(eventsOf(w, EV.PICKUP).filter((e) => e.a === PK.EMBER).length, 1);
  const v = haltView(w, currentHalt(w), DATA);
  assert.deepEqual(v.weapons[0].forms.filter((f) => !f.why).map((f) => [f.id, f.cost]), [['salvo', 'ember'], ['muzzle_flash', 'ember']], 'its next shut axis, for the Ember');
  assert.ok(v.weapons[0].forms.find((f) => f.id === 'mortar').why.startsWith('New Form at Lv 11'), 'what opens the rest, truthfully');
  assert.throws(() => decide(w, { kind: 'ok' }), /expected "ascend" or "keep"/);
  decide(w, { kind: 'ascend', slot: 0, id: 'muzzle_flash' });
  assert.equal(w.build.embers, 0);
  assert.equal(w.slots[0].axes & 1, 1, 'the axis is open now');
  // A second: switch the option on it, or open the next.
  ember(w);
  const c = optionChoices(w, 0);
  assert.deepEqual(c.map((x) => [x.option.id, x.cost, x.switches?.id ?? null]), [['salvo', 'ember', 'muzzle_flash'], ['mortar', 'ember', null], ['star_shell', 'ember', null]]);
  decide(w, { kind: 'ascend', slot: 0, id: 'salvo' });
  assert.deepEqual(ids(w.slots[0].ascensions), ['salvo'], 'switched');
  assert.equal(w.result.ascensions.at(-1).switched, 'muzzle_flash');
  assert.equal(eventsOf(w, EV.ASCEND)[0].c, 1, 'the event says it switched');
  // An Ember never opens the capstone before both others are held; never goes on a character's own weapon.
  ember(w);
  assert.ok(!optionChoices(w, 0).some((x) => x.option.axis === 'payoff'));
  decide(w, { kind: 'ascend', slot: 0, id: 'mortar' });
  ember(w);
  assert.ok(optionChoices(w, 0).some((x) => x.option.axis === 'payoff' && x.cost === 'ember'), 'with both held, the capstone early');
  decide(w, { kind: 'keep' });
  const lamp = makeWorld({ character: 'lamplighter', invulnerable: true });
  assert.ok(optionChoices(lamp, signatureSlot(lamp)).every((x) => x.cost === 'free'));
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
  // The hash sees Embers and options.
  const x = makeWorld({ invulnerable: true }), y = makeWorld({ invulnerable: true });
  give(x, 'flare_gun'); give(y, 'flare_gun');
  ember(x); ember(y);
  decide(x, { kind: 'keep' }); decide(y, { kind: 'ascend', slot: 0, id: 'salvo' });
  assert.notEqual(hashWorld(x), hashWorld(y));
});

test('stats: the screen\'s numbers are the run\'s own', () => {
  // (The harbor's pace, run.materialMul, at 1 here: the counts below are the run's own whatever it is tuned to.)
  const w = makeWorld({ invulnerable: true, tuning: { run: { materialMul: 1 } } });
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
  w.result.realBySlot[0] = 600;   // (the health it took: no overkill)
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
  // What it shows is what will come home: the run's haul multiplier applies (a short run's share).
  w.config.mode = 'short';
  w.result.materialsRaw[w.materialIndex.get('rope')] = 10;
  assert.deepEqual(materialsFound(w).map((m) => [m.id, m.count]), [['rope', Math.floor(10 * w.tuning.run.shortRewardMul)]]);
  w.config.mode = 'standard';
  // The items you carry: the passives with their levels, then the relics.
  assert.deepEqual(v.items.map((x) => [x.kind, x.name, x.level]), [['passive', 'Tallow Candle', 1], ['passive', 'Wick Oil', 1]]);
  assert.ok(v.items.every((x) => x.desc && x.icon));
  // A character's own weapon is there too, marked as hers.
  const lamp = makeWorld({ character: 'lamplighter', invulnerable: true });
  const own = statsView(lamp).weapons.find((x) => x.signature);   // (0.9.0, W2: her lamp is her signature weapon)
  assert.ok(own && own.lines.length, 'the Lamplighter\'s light has its numbers');
});

test('embers: a run that takes, keeps, and spends them replays exactly; one that finds the pickup pool full is picked up at once', () => {
  const rec = createRecordedRun({ seed: 'ember-replay', map: 'drowned_docks', character: 'lamplighter', invulnerable: true }, DATA, 'b1');
  for (let t = 0; t < 900; t++) {
    if (t === 100 || t === 300 || t === 500) rec.decide({ kind: 'dev', cmd: 'ember' });
    if (t === 600 && rec.world.build.embers > 0 && !currentHalt(rec.world)) rec.decide({ kind: 'ember' });
    rec.step({ mx: (t % 240) < 120 ? 90 : -90, my: 30, buttons: 0 });
    while (currentHalt(rec.world)) {
      const h = currentHalt(rec.world);
      if (h.kind === 'ascend') {
        const v = haltView(rec.world, h, DATA);
        const f = v.weapons[0]?.forms.find((x) => !x.taken && !x.why);
        rec.decide(f && rec.world.tick > 200 ? { kind: 'ascend', slot: v.weapons[0].slot, id: f.id } : { kind: 'keep' });
      } else rec.decide(h.kind === 'draft' ? { kind: 'pick', index: 0 } : h.kind === 'overtime' ? { kind: 'leave' } : { kind: 'ok' });
    }
  }
  const replay = rec.toReplay();
  assert.ok(replay.decisions.some((d) => d.kind === 'ascend') && replay.decisions.some((d) => d.kind === 'keep'));
  const back = playReplay(replay, DATA, { buildId: 'b1' });
  assert.equal(hashWorld(back), replay.hash);
  for (let s = 0; s < 4; s++) assert.deepEqual(back.slots[s]?.ascensions?.map((a) => a.id), rec.world.slots[s]?.ascensions?.map((a) => a.id));
  // A full pool: materials up to the reserve, then chests to the last slot; an Ember then goes
  // straight to you rather than being lost.
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

test('embers: two picked up on one tick with one choice left: the second is kept, and no empty screen opens', () => {
  const w = makeWorld({ invulnerable: true });
  give(w, 'tide_bell', { forms: ['great_toll', 'breakers'] });
  w.slots[0].deed = 9999;   // (its capstone axis is the one choice left: an Ember opens it)
  spawnPickup(w, PK.EMBER, w.player.x, w.player.y, 0, 0);
  spawnPickup(w, PK.EMBER, w.player.x, w.player.y, 0, 0);
  stepWorld(w, IDLE);
  assert.deepEqual(w.halts.map((h) => h.kind), ['ascend', 'ascend']);
  decide(w, { kind: 'ascend', slot: 0, id: 'riptide' });
  assert.equal(currentHalt(w)?.kind, 'ascend', 'switches are left for the second');
  decide(w, { kind: 'keep' });
  assert.equal(w.build.embers, 1, 'that Ember is kept');
});
