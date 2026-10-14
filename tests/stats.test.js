// Stats and tags (ARCHITECTURE §5.9), against hand-computed values.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  combine, computeWeaponStats, computePlayerStats, weaponLevelBase, modAppliesToWeapon, checkModifier, WEAPON_STAT_OF, STAT_IDS,
} from '../src/sim/stats.js';
import { TUNING } from '../src/data/tuning.js';

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg ?? ''} ${a} vs ${b}`);

test('stats: the one formula, (base + Σadd) × (1 + Σpct) × Π(1 + more)', () => {
  const mods = [
    { stat: 'might', op: 'add', value: 2 }, { stat: 'might', op: 'add', value: 3 },
    { stat: 'might', op: 'pct', value: 0.1 }, { stat: 'might', op: 'pct', value: 0.2 },
    { stat: 'might', op: 'more', value: 0.5 }, { stat: 'might', op: 'more', value: 0.2 },
    { stat: 'area', op: 'pct', value: 5 }, // another stat: ignored
  ];
  close(combine(10, mods, 'might'), 15 * 1.3 * 1.5 * 1.2, 'hand computed: 35.1');
  close(combine(10, [], 'might'), 10);
  close(combine(10, [{ stat: 'might', op: 'pct', value: -0.5 }], 'might'), 5, 'negative percentages reduce');
});

test('stats: tags scope modifiers to weapons that share at least one; weapon scopes to one id', () => {
  const fire = { stat: 'might', op: 'pct', value: 0.5, tags: ['fire'] };
  assert.equal(modAppliesToWeapon(fire, ['fire', 'light'], 'x'), true);
  assert.equal(modAppliesToWeapon(fire, ['tide'], 'x'), false);
  assert.equal(modAppliesToWeapon({ stat: 'might', op: 'pct', value: 1 }, ['tide'], 'x'), true, 'untagged applies to every weapon');
  assert.equal(modAppliesToWeapon({ stat: 'might', op: 'pct', value: 1, tags: [] }, ['tide'], 'x'), true, 'an empty tag list is untagged');
  const one = { stat: 'area', op: 'pct', value: 1, weapon: 'lamplight' };
  assert.equal(modAppliesToWeapon(one, ['light'], 'lamplight'), true);
  assert.equal(modAppliesToWeapon(one, ['light'], 'lantern_orb'), false, 'weapon scoping beats tags');
});

const W = {
  id: 'test_gun', tags: ['fire'], maxLevel: 4,
  base: { damage: 10, cooldown: 1, amount: 1, area: 1, speed: 1, duration: 2, pierce: 2, knockback: 1 },
  levels: [null, { damage: 5 }, { amount: 1, cooldown: -0.2 }, { damage: 5, pierce: 1 }],
};

test('stats: weapon levels add up cumulatively (levels[L - 1] is what level L adds)', () => {
  assert.deepEqual([weaponLevelBase(W, 1).damage, weaponLevelBase(W, 2).damage, weaponLevelBase(W, 4).damage], [10, 15, 20]);
  close(weaponLevelBase(W, 3).cooldown, 0.8);
  assert.equal(weaponLevelBase(W, 3).amount, 2);
  assert.equal(weaponLevelBase(W, 99).damage, 20, 'levels past the max clamp');
  assert.equal(weaponLevelBase(W, 0).damage, 10, 'below 1 clamps to 1');
});

test('stats: weapon stats combine level, tags, and caps', () => {
  const mods = [
    { stat: 'might', op: 'pct', value: 0.5, tags: ['fire'] },       // applies
    { stat: 'might', op: 'pct', value: 10, tags: ['tide'] },        // doesn't
    { stat: 'amount', op: 'add', value: 2 },
    { stat: 'cooldown', op: 'pct', value: -0.25 },
    { stat: 'pierce', op: 'add', value: 1, tags: ['fire'] },
  ];
  const s = computeWeaponStats(TUNING, W, 2, mods);
  close(s.damage, 15 * 1.5);
  assert.equal(s.amount, 3);
  close(s.cooldown, 0.75);
  assert.equal(s.pierce, 3);
});

test('stats: caps hold (cooldown floor, amount ceiling, area range, crit range), and -1 pierce stays infinite', () => {
  const c = TUNING.caps.weapon;
  const s = computeWeaponStats(TUNING, W, 1, [
    { stat: 'cooldown', op: 'pct', value: -0.99 },
    { stat: 'amount', op: 'add', value: 500 },
    { stat: 'area', op: 'more', value: 100 },
    { stat: 'crit', op: 'add', value: 5 },
    { stat: 'critMult', op: 'add', value: -10 },
    { stat: 'might', op: 'pct', value: -5 },
  ]);
  close(s.cooldown, Math.max(1 * c.minCooldownFraction, c.minCooldown), 'cooldown floor');
  assert.equal(s.amount, 1 + c.maxExtraAmount);
  assert.equal(s.area, c.area[1]);
  assert.equal(s.crit, 1);
  assert.equal(s.critMult, 1);
  assert.equal(s.damage, 0, 'damage never goes negative');
  const orb = { ...W, base: { ...W.base, pierce: -1 } };
  assert.equal(computeWeaponStats(TUNING, orb, 1, [{ stat: 'pierce', op: 'add', value: 3 }]).pierce, -1);
});

test('stats: player stats take untagged modifiers only, start from the character, and cap', () => {
  const s = computePlayerStats(TUNING, { maxHp: 120 }, [
    { stat: 'maxHp', op: 'add', value: 30 },
    { stat: 'moveSpeed', op: 'pct', value: 10 },           // capped
    { stat: 'armor', op: 'add', value: 5, tags: ['fire'] }, // tagged: never a player stat
    { stat: 'reroll', op: 'add', value: 1.9 },
  ]);
  assert.equal(s.maxHp, 150);
  assert.equal(s.moveSpeed, TUNING.caps.player.moveSpeed[1]);
  assert.equal(s.armor, 0);
  assert.equal(s.reroll, TUNING.player.stats.reroll + 1, 'charges are whole numbers');
  assert.equal(s.luck, TUNING.player.stats.luck);
});

test('stats: modifier checks catch bad data with a plain message', () => {
  assert.equal(checkModifier({ stat: 'might', op: 'pct', value: 0.1, tags: ['fire'] }), null);
  assert.match(checkModifier({ stat: 'power', op: 'pct', value: 1 }), /unknown stat/);
  assert.match(checkModifier({ stat: 'might', op: 'times', value: 1 }), /unknown op/);
  assert.match(checkModifier({ stat: 'might', op: 'add', value: NaN }), /finite/);
  assert.match(checkModifier({ stat: 'maxHp', op: 'add', value: 1, tags: ['fire'] }), /player stat/);
  assert.match(checkModifier({ stat: 'might', op: 'more', value: -1 }), /above -1/);
  assert.ok(Object.keys(WEAPON_STAT_OF).every((k) => STAT_IDS.includes(k)));
});

test('stats: speed and duration caps, a negative "more", and an unknown op refused', () => {
  const c = TUNING.caps.weapon;
  const s = computeWeaponStats(TUNING, W, 1, [
    { stat: 'speed', op: 'more', value: 50 },
    { stat: 'duration', op: 'pct', value: -0.999 },
    { stat: 'might', op: 'more', value: -0.5 },
  ]);
  assert.equal(s.speed, c.speed[1]);
  assert.equal(s.duration, c.duration[0], 'duration floor, in seconds');
  close(s.damage, W.base.damage * 0.5, '"more" of -0.5 halves');
  assert.throws(() => combine(1, [{ stat: 'might', op: 'mul', value: 2 }], 'might'), /unknown op "mul"/);
});

// Through the real build path: passives stack level by level, scoped by tag, and the run's own
// stats follow (max HP, revivals, charges gained mid-run).
test('stats: a passive stacks every level it has reached, only on weapons with its tag', async () => {
  const { makeWorld, give, givePassive } = await import('./helpers/simworld.js');
  const w = makeWorld({ invulnerable: true });
  const flare = give(w, 'flare_gun');        // fire, light
  const bell = give(w, 'tide_bell');         // tide, echo
  const flare0 = flare.stats.damage, bell0 = w.slots[bell.index].stats.damage;
  for (let L = 1; L <= 5; L++) {
    givePassive(w, 'wick_oil', L);           // +12% might on fire, per level
    close(w.slots[flare.index].stats.damage, flare0 * (1 + 0.12 * L), `wick oil ${L}`);
    close(w.slots[bell.index].stats.damage, bell0, 'no fire tag, no change');
  }
});

test('stats: max HP, revivals, and charges gained mid-run apply at once; less max HP clamps', async () => {
  const { makeWorld, givePassive } = await import('./helpers/simworld.js');
  const { createWorld } = await import('../src/sim/world.js');
  const { DATA } = await import('../src/data/index.js');
  const { markStatsDirty, rebuildStats } = await import('../src/sim/build.js');
  const w = makeWorld({ invulnerable: true });
  w.player.hp = 50;
  givePassive(w, 'thick_coat', 1);           // +15 max HP
  assert.equal(w.stats.maxHp, 115);
  assert.equal(w.player.hp, 65, 'the new health comes filled');
  const skip0 = w.charges.skip, rev0 = w.player.revivals;
  w.build.relics.push({ id: 'test_relic', mods: [{ stat: 'revival', op: 'add', value: 1 }, { stat: 'skip', op: 'add', value: 3 }] });
  markStatsDirty(w); rebuildStats(w);
  assert.equal(w.player.revivals, rev0 + 1);
  assert.equal(w.charges.skip, skip0 + 3);
  w.player.hp = 115;
  w.build.passives.length = 0;
  markStatsDirty(w); rebuildStats(w);
  assert.equal(w.player.hp, 100, 'max HP back to 100 clamps health');
  assert.throws(() => createWorld({ seed: 1, mods: [{ stat: 'might', op: 'mul', value: 2 }] }, DATA), /RunConfig mods: unknown op/);
});

test('stats: pierce stops at the cap (what a shot can remember)', () => {
  const s = computeWeaponStats(TUNING, W, 1, [{ stat: 'pierce', op: 'add', value: 50 }]);
  assert.equal(s.pierce, TUNING.caps.weapon.maxPierce);
});
