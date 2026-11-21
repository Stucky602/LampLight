// Rolled weapon upgrades (ruling 14, C1; work/cw/C1-CONTRACT.md section 3): no level table and no max
// level, each level-up one upgrade at a rarity. Common and Uncommon are numbers that multiply what
// the weapon does now; Rare and Epic are the weapon's own lines; Legendary its own specials. Every
// 3rd upgrade is Rare or better, the 10th a Legendary for certain, and no card changes the weapon's
// output by less than the floor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, give, run, IDLE, DATA } from './helpers/simworld.js';
import { RARITY_IDS, UP_TYPES, rollRarity, rollUpgrade, upValue, upsOpen, upCapped, takeUpgrade, canLevelWeapon, cardWorth, numberAt, isMilestone } from '../src/sim/weaponups.js';
import { giveUpgrade } from '../src/sim/ascend.js';
import { weaponOwnNumbers } from '../src/sim/stats.js';
import { makeOffer } from '../src/sim/draft.js';
import { decide, currentHalt, stepWorld } from '../src/sim/world.js';
import { createRng } from '../src/lib/rng.js';

const U = DATA.tuning.weaponUps;
const solo = (id, extra = {}) => {
  const own = DATA.weapons.find((x) => x.id === id)?.signature;
  const w = makeWorld({ invulnerable: true, pools: { weapons: own ? [] : [id], passives: [], relics: [] }, ...extra });
  while (w.slots[0] && w.slots[0].def && w.slots[0].def.id !== id) w.slots[0] = null;
  if (!w.slots[0]) give(w, id, { slot: 0, level: 1 });
  return w;
};

test('weapon upgrades: the sim\'s rarities are the data\'s, in order; the tuning has a number for every number type', () => {
  assert.deepEqual([...RARITY_IDS], DATA.rarities.map((r) => r.id));
  assert.equal(U.odds.length, 5); assert.equal(U.mul.length, 5);
  assert.ok(U.mul.every((m, i) => i === 0 || m > U.mul[i - 1]), 'each rarity a bigger number');
  assert.ok(U.odds.every((o, i) => i === 0 || o < U.odds[i - 1]), 'each rarity rarer');
  for (const t of DATA.weaponUps) {
    assert.ok(t.min >= 0 && t.min <= 4, t.id);
    if (t.stat) assert.ok(Number.isFinite(U.value[t.id]) && U.value[t.id] > 0, `${t.id}: a Common value`);
    assert.ok(Number.isFinite(U.weight[t.id]) && U.weight[t.id] > 0, `${t.id}: a weight`);
  }
  const min = (id) => UP_TYPES.get(id).min;
  assert.deepEqual(['damage', 'cooldown', 'area', 'duration'].map(min), [0, 0, 0, 0], 'Common numbers');
  assert.deepEqual(['amount', 'pierce', 'crit', 'hit_cooldown'].map(min), [1, 1, 1, 1], 'Uncommon numbers');
  assert.deepEqual([min('line'), min('special')], [2, 4], 'lines at Rare, specials at Legendary');
  assert.equal(U.early, undefined, 'the early multiplier is gone (ruling 14 item 2)');
});

test('weapon upgrades: the odds are the tuning\'s, and Luck moves them up', () => {
  const count = (luck) => {
    const w = solo('flare_gun', { mods: [{ stat: 'luck', op: 'add', value: luck - 1 }] });
    const rng = createRng(9), n = [0, 0, 0, 0, 0];
    for (let k = 0; k < 20000; k++) n[rollRarity(w, rng)]++;
    return n.map((x) => x / 20000);
  };
  const plain = count(1), lucky = count(2.5);
  const sum = U.odds.reduce((a, b) => a + b, 0);
  plain.forEach((p, r) => assert.ok(Math.abs(p - U.odds[r] / sum) < 0.012, `rarity ${r}: ${p}`));
  assert.ok(lucky[0] < plain[0] && lucky[4] > plain[4] * 1.5, `Luck: ${lucky}`);
});

test('weapon upgrades: Common and Uncommon are numbers; Rare and Epic its own lines; a number multiplies what it does now; whole types round', () => {
  const w = solo('flare_gun');
  const rng = createRng(4);
  const def = w.slots[0].def;
  const lineIds = new Set(def.lines.map((l) => l.id));
  for (let k = 0; k < 3000; k++) {
    const u = rollUpgrade(w, 0, rng);
    const r = RARITY_IDS.indexOf(u.rarity);
    if (u.up === 'line') { assert.ok(r === 2 || r === 3, 'a line is Rare or Epic'); assert.ok(lineIds.has(u.line)); assert.equal(def.lines.find((l) => l.id === u.line).rarity, u.rarity); continue; }
    if (u.up === 'special') { assert.equal(r, 4); continue; }
    assert.ok(r >= UP_TYPES.get(u.up).min, `${u.up} at ${u.rarity}`);
    assert.equal(u.value, upValue(w, UP_TYPES.get(u.up), r));
    assert.ok(Number.isFinite(u.now) && Number.isFinite(u.after), `${u.up}: now and after`);
  }
  const t = UP_TYPES.get('damage');
  assert.deepEqual([0, 1, 2, 3, 4].map((r) => upValue(w, t, r)), U.mul.map((m) => Math.round(U.value.damage * m * 1e4) / 1e4));
  assert.deepEqual([1, 2, 3, 4].map((r) => upValue(w, UP_TYPES.get('amount'), r)), [1, 2, 2, 2], '+1 at Uncommon, +2 from Rare (W9: a Rare count reads differently)');
  // Damage multiplies what the weapon does now: the 11th +20% adds a fifth of the 10th's.
  const d = (n) => weaponOwnNumbers(def, Array.from({ length: n }, () => ({ up: 'damage', value: 0.2 }))).damage;
  assert.ok(Math.abs(d(11) / d(10) - 1.2) < 1e-9, '+20% is +20% at any level');
  assert.ok(Math.abs(d(1) / d(0) - 1.2) < 1e-9);
  // A card's now and after are the weapon's real numbers.
  const card = { up: 'damage', ...numberAt(w, 'damage', 'common') };
  takeUpgrade(w, 0, card); w.statsDirty = true; run(w, 1, IDLE, { halts: 'pass' });
  const u = rollUpgrade(w, 0, createRng(1), new Set(['cooldown', 'amount', 'pierce', 'crit']), { min: 0 });
  if (u.up === 'damage') assert.ok(Math.abs(u.now - w.slots[0].stats.damage) < 1e-9 && Math.abs(u.after / u.now - 1 - u.value) < 1e-6, 'Damage now to after');
});

test('weapon upgrades: no card changes its weapon\'s output by less than the floor; a capped type leaves the pool; damage never does', () => {
  const def = DATA.weapons.find((x) => x.id === 'flare_gun');
  const w = solo('flare_gun');
  const rng = createRng(7);
  for (let k = 0; k < 2000; k++) {
    const u = rollUpgrade(w, 0, rng);
    if (u.up !== 'line' && u.up !== 'special') assert.ok(u.worth >= U.floor - 1e-9, `${u.up} ${u.value}: worth ${u.worth}`);
  }
  const cd = Array.from({ length: 30 }, () => ({ up: 'cooldown', rarity: 'legendary', value: U.cooldownMax }));
  w.slots[0].ups = cd;
  assert.ok(upCapped(w, def, cd, UP_TYPES.get('cooldown')), 'at the floor');
  assert.ok(!upsOpen(w, w.slots[0]).some((t) => t.id === 'cooldown'), 'out of the pool');
  assert.ok(upsOpen(w, w.slots[0]).some((t) => t.id === 'damage'), 'damage stays');
  // Every weapon's pool, every type pushed to its cap, still has damage.
  for (const x of DATA.weapons.filter((v) => !v.innate)) {
    const ups = x.numbers.filter((u) => u !== 'damage').flatMap((u) => Array.from({ length: 60 }, () => ({ up: u, rarity: 'legendary', value: upValue(w, UP_TYPES.get(u), 4) })));
    const ww = solo(x.id);
    ww.slots[0].ups = ups;
    assert.deepEqual(upsOpen(ww, ww.slots[0]).map((t) => t.id), ['damage'], x.id);
    assert.ok(canLevelWeapon(ww, ww.slots[0]));
  }
  // The worth of a card is the measure the floor uses: damage its value, a count its share.
  assert.equal(cardWorth(w, w.slots[0], { up: 'damage', value: 0.2 }), 0.2);
});

test('weapon upgrades: every 3rd upgrade is Rare or better; the 10th a Legendary special; a line and a special once each', () => {
  const w = solo('flare_gun');
  const rng = createRng(11);
  assert.deepEqual([1, 2, 3, 4, 5, 6, 9].map((n) => isMilestone(w, n)), [false, false, true, false, false, true, true]);
  // Walk the weapon to its 30th upgrade with what it rolls: milestones never below Rare; the 10th and 20th Legendary.
  for (let n = 1; n <= 30; n++) {
    const since = (w.slots[0].legAt ?? 0) > n - 10;   // a Legendary already came in this ten
    const u = rollUpgrade(w, 0, rng);
    const r = RARITY_IDS.indexOf(u.rarity);
    if (n % U.milestone === 0) assert.ok(r >= 2, `upgrade ${n}: ${u.rarity}`);
    if ((n === 10 || n === 20) && !since && w.slots[0].specials.length < 2) assert.equal(u.up, 'special', `upgrade ${n} is a special while one is left`);
    if (n < U.legendaryFrom && n % U.legendary !== 0) assert.ok(r < 4, `upgrade ${n}: no Legendary before the ${U.legendaryFrom}th`);
    takeUpgrade(w, 0, u);
  }
  const s = w.slots[0];
  assert.equal(new Set(s.lines).size, s.lines.length, 'each line once');
  assert.equal(new Set(s.specials).size, s.specials.length, 'each special once');
  assert.equal(s.specials.length, 2, 'both its specials by its 20th');
  assert.throws(() => takeUpgrade(w, 0, { up: 'special', special: s.specials[0] }), /already holds/);
  assert.equal(s.level, 31);
});

test('weapon upgrades: a draft with one weapon is never short; a Legendary never sits beside a number for the same weapon; reroll rolls again; the run counts what it took', () => {
  const w = solo('flare_gun');
  for (let k = 0; k < 50; k++) {
    const o = makeOffer(w);
    assert.equal(o.length, 3);
    const keys = o.map((c) => (c.up === 'line' ? `line:${c.line}` : c.up === 'special' ? `special:${c.special}` : c.up));
    assert.equal(new Set(keys).size, 3, 'three different upgrades of one weapon');
  }
  // At the 10th upgrade the special shows alone for its weapon.
  const ten = solo('flare_gun');
  ten.slots[0].ups = Array.from({ length: 9 }, () => ({ up: 'damage', rarity: 'common', value: 0.2 }));
  for (let k = 0; k < 20; k++) {
    const o = makeOffer(ten);
    if (o.some((c) => c.up === 'special')) assert.equal(o.filter((c) => c.slot === 0 && c.up !== 'special').length, 0, 'nothing else for that weapon');
  }
  decide(w, { kind: 'dev', cmd: 'level', count: 1 });
  stepWorld(w, IDLE);
  const before = JSON.stringify(currentHalt(w).offer);
  w.charges.reroll = 5;
  let changed = false;
  for (let k = 0; k < 5 && !changed; k++) { decide(w, { kind: 'reroll' }); changed = JSON.stringify(currentHalt(w).offer) !== before; }
  assert.ok(changed, 'a reroll draws and rolls again');
  const c = currentHalt(w).offer[0];
  decide(w, { kind: 'pick', index: 0 });
  assert.equal(w.result.weaponUps, 1);
  assert.equal(w.result.upRolls[RARITY_IDS.indexOf(c.rarity)], 1);
  assert.equal(w.slots[0].ups[0].up, c.up);
  const a = solo('harpoon_chain', { seed: 31 }), b = solo('harpoon_chain', { seed: 31 });
  assert.deepEqual(makeOffer(a), makeOffer(b), 'the same seed, the same cards');
});

test('weapon upgrades: giveUpgrade (the call for one that came from no card) takes it, levels, and opens the axis its count reaches', () => {
  const w = solo('flare_gun');
  for (let n = 1; n <= 5; n++) giveUpgrade(w, 0, { up: 'damage', ...numberAt(w, 'damage', 'common') });
  assert.equal(w.slots[0].level, 6);
  assert.equal(w.slots[0].axes & 1, 1, 'how it fires opens at the 5th');
  assert.equal(currentHalt(w)?.kind, 'ascend');
  assert.throws(() => giveUpgrade(w, 0, { up: 'hit_cooldown', value: 0.1, rarity: 'uncommon' }), /can't take/, 'only its own numbers');
});

test('Kindred: each other weapon or passive held that shares a tag makes a weapon stronger, up to its cap (C1, Nov 17)', async () => {
  const { givePassive } = await import('./helpers/simworld.js');
  const { kinCount } = await import('../src/sim/weapons.js');
  const { markStatsDirty, rebuildStats } = await import('../src/sim/build.js');
  const K = DATA.tuning.weaponUps.kindred;
  const w = makeWorld({ invulnerable: true, weaponSlots: 6, passiveSlots: 6 });
  const s = give(w, 'flare_gun').index;                 // fire, light
  const alone = w.slots[s].stats.damage, n0 = kinCount(w, w.slots[s].def.tags, s);
  give(w, 'oil_flask');                                  // fire: kin
  give(w, 'harpoon_chain');                              // steel, sea: not kin
  givePassive(w, 'wick_oil');                            // fire: kin
  markStatsDirty(w); rebuildStats(w);
  assert.equal(kinCount(w, w.slots[s].def.tags, s) - n0, 2, 'the flask and Wick Oil, not the harpoon');
  const withKin = w.slots[s].stats.damage;
  assert.ok(withKin > alone, 'kin make it stronger');
  // The cap: never more than kindred.max of them count.
  for (const id of ['lantern_orb', 'corpse_candles', 'signal_mirror']) give(w, id);
  for (const id of ['lamp_glass', 'tallow_candle']) givePassive(w, id);
  markStatsDirty(w); rebuildStats(w);
  assert.ok(kinCount(w, w.slots[s].def.tags, s) > K.max);
  const own = w.slots[s];
  assert.ok(own.stats.damage <= alone * (1 + K.per * K.max) * 1.6 + 1e-6, 'capped (Wick Oil and Lamp Glass\'s own numbers aside)');
});
