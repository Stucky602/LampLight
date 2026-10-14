// Menu logic that doesn't need a browser: controller navigation geometry, card text, and the
// tuning panel's model (ARCHITECTURE §8, §15).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA } from '../src/data/index.js';
import { TUNING } from '../src/data/tuning.js';
import { pickInDirection } from '../src/ui/focus.js';
import { cardInfo, weaponLevelText, passiveLevelText, modifierText } from '../src/ui/describe.js';
import { flattenTuning, stepFor, tidy, tuningDiff, tuningCopyText, START_ONLY } from '../src/ui/tuningmodel.js';
import { checkTune } from '../src/sim/dev.js';

const R = (x, y, w = 10, h = 10) => ({ x, y, w, h });

test('focus: a row of cards and a row of buttons navigate the way they look', () => {
  // Three cards across the top, three buttons under them (the level-up screen).
  const rects = [R(0, 0, 100, 150), R(110, 0, 100, 150), R(220, 0, 100, 150), R(30, 170, 60, 20), R(130, 170, 60, 20), R(230, 170, 60, 20)];
  assert.equal(pickInDirection(rects[0], rects, 'right'), 1);
  assert.equal(pickInDirection(rects[1], rects, 'right'), 2);
  assert.equal(pickInDirection(rects[2], rects, 'right'), -1, 'nothing further right: stay');
  assert.equal(pickInDirection(rects[2], rects, 'left'), 1);
  assert.equal(pickInDirection(rects[1], rects, 'down'), 4, 'straight down to the button under it');
  assert.equal(pickInDirection(rects[5], rects, 'up'), 2);
  assert.equal(pickInDirection(rects[3], rects, 'up'), 0);
  assert.equal(pickInDirection(rects[0], rects, 'up'), -1);
  assert.throws(() => pickInDirection(rects[0], rects, 'sideways'), /unknown direction/);
});

test('focus: a column prefers the aligned neighbor over a closer one off to the side', () => {
  const rects = [R(100, 0, 100, 20), R(100, 60, 100, 20), R(0, 30, 40, 20)];
  assert.equal(pickInDirection(rects[0], rects, 'down'), 1, 'the button below, not the one diagonally nearer');
  assert.equal(pickInDirection(rects[1], rects, 'left'), 2);
});

test('card text: level-ups say what that level adds, as stat lines (docs/WRITING.md §3)', () => {
  const flare = DATA.weapons.find((w) => w.id === 'flare_gun');
  assert.equal(weaponLevelText(flare, 2), '+1 Projectile');
  assert.equal(weaponLevelText(flare, 4), '-0.15s Cooldown');
  assert.equal(weaponLevelText(flare, 8), '+1 Projectile, +6 Damage');
  assert.equal(weaponLevelText(flare, 1), flare.desc, 'level 1 is the weapon itself');
  assert.equal(weaponLevelText(DATA.weapons.find((w) => w.id === 'harpoon_chain'), 5), '+20% Projectile Speed', 'a share of the base as a percent');
  const ballast = DATA.passives.find((p) => p.id === 'ballast');
  assert.equal(passiveLevelText(ballast, 1), '+1 Pierce (Steel), +12% Knockback (Steel)');
  assert.equal(modifierText({ stat: 'cooldown', op: 'pct', value: -0.06 }), '-6% Cooldown');
  assert.equal(modifierText({ stat: 'amount', op: 'add', value: 1, tags: ['tide'] }), '+1 Projectile (Tide)');
  assert.equal(modifierText({ stat: 'amount', op: 'add', value: 2 }), '+2 Projectiles');
  assert.equal(modifierText({ stat: 'dashCooldown', op: 'pct', value: -0.1 }), '-10% Dash Cooldown');
  assert.equal(modifierText({ stat: 'revival', op: 'add', value: 1 }), '+1 Revival');
  assert.equal(modifierText({ stat: 'cooldown', op: 'add', value: -0.25 }), '-0.25s Cooldown');
  // Every passive level, word for word, so a wording slip shows up here.
  const texts = Object.fromEntries(DATA.passives.map((p) => [p.id, p.levels.map((_, i) => passiveLevelText(p, i + 1))]));
  assert.deepEqual(texts.undertow, ['+1 Projectile (Tide)', '+10% Damage (Tide)', '+15% Duration (Tide)', '+10% Damage (Tide)', '+1 Projectile (Tide)']);
  assert.deepEqual(texts.thick_coat, ['+15 Max HP', '+15 Max HP', '+15 Max HP, +1 Armor', '+15 Max HP', '+15 Max HP, +1 Armor']);
  assert.deepEqual(texts.tallow_candle[0], '-6% Cooldown');
  // Every stat line leads with its sign (or x for a multiplier), names a stat, and has no period.
  const lines = [...Object.values(texts).flat(), ...DATA.weapons.flatMap((w) => (w.levels ?? []).slice(1).map((_, i) => weaponLevelText(w, i + 2)))];
  for (const line of lines) for (const part of line.split(', ')) assert.match(part, /^[+\-x][\d.]+(%|s|x)? [A-Z][A-Za-z ]+( \([A-Z][a-z]*(, [A-Z][a-z]*)*\))?$/, part);
  for (const t of lines) assert.doesNotMatch(t, /\b1 (Projectiles|Revivals|Rerolls)\b|undefined|NaN|\.$/, t);
  assert.equal(modifierText({ stat: 'moveSpeed', op: 'pct', value: 0.08 }), '+8% Move Speed');
  assert.equal(modifierText({ stat: 'might', op: 'more', value: 0.2, tags: ['fire'] }), 'x1.2 Damage (Fire)');
});

test('card text: tags with what you have, and evolution partners', () => {
  const build = { tags: { fire: 2, light: 1 }, weapons: ['flare_gun'], passives: [] };
  const c = cardInfo({ kind: 'passive', id: 'wick_oil', level: 1, isNew: true }, DATA, build);
  assert.equal(c.title, 'Wick Oil');
  assert.equal(c.sub, 'New passive');
  assert.deepEqual(c.tags, [{ tag: 'fire', have: 2 }]);
  assert.equal(c.note, 'Evolves Flare Gun (owned)');
  const w = cardInfo({ kind: 'weapon', id: 'flare_gun', level: 8, isNew: false }, DATA, { tags: {}, weapons: [], passives: ['wick_oil'] });
  assert.equal(w.sub, 'Lv 8 MAX');
  assert.equal(w.note, 'Evolution: Lv 8 + Wick Oil Lv 5 (owned)', 'both halves: the weapon at its max, the passive at its level');
  assert.equal(cardInfo({ kind: 'weapon', id: 'flare_gun', level: 3, isNew: false }, DATA).note, 'Evolution: Lv 8 + Wick Oil Lv 5', 'without the passive, no "(owned)"');
  assert.equal(cardInfo({ kind: 'relic', id: 'tide_clock' }, DATA).sub, 'Relic');
  assert.equal(cardInfo({ kind: 'heal', id: 'heal', amount: 40 }, DATA).sub, 'Item');
  assert.equal(cardInfo({ kind: 'evolution', id: 'kraken_line' }, DATA).sub, 'Evolution');
  assert.equal(cardInfo({ kind: 'coin', id: 'coin', amount: 25 }, DATA).desc, '+25 Coin');
  assert.equal(cardInfo({ kind: 'heal', id: 'heal', amount: 40 }, DATA).desc, 'Restores 40 HP.');
  assert.throws(() => cardInfo({ kind: 'weapon', id: 'nope' }, DATA), /unknown weapon/);
  assert.throws(() => cardInfo({ kind: 'hat', id: 'x' }, DATA), /unknown card kind/);
  // Every draftable card in the data describes itself without throwing.
  for (const wdef of DATA.weapons) for (let L = 1; L <= wdef.maxLevel; L++) assert.ok(cardInfo({ kind: 'weapon', id: wdef.id, level: L, isNew: L === 1 }, DATA).desc.length > 3);
  for (const p of DATA.passives) for (let L = 1; L <= p.maxLevel; L++) assert.ok(cardInfo({ kind: 'passive', id: p.id, level: L, isNew: L === 1 }, DATA).desc.length > 3);
});

test('tuning model: every number is a row, steps are sensible, and the copy text names only changes', () => {
  const rows = flattenTuning(TUNING);
  assert.ok(rows.length > 100, `${rows.length} values`);
  for (const r of rows) assert.equal(checkTune(TUNING, r.path, r.value), null, `${r.path} can be set to its own value`);
  assert.ok(rows.some((r) => r.path === 'feel.shake.playerHurt'));
  assert.ok(!rows.some((r) => r.path.startsWith('chests.bossItems')), 'lists are edited in data, not the panel');
  assert.equal(stepFor(80), 10);
  assert.equal(stepFor(150), 20);
  assert.equal(stepFor(0.35), 0.05);
  assert.equal(stepFor(2.5), 0.2);
  assert.equal(stepFor(3), 1, 'whole numbers step by at least 1');
  assert.equal(stepFor(0), 0.1);
  assert.equal(tidy(0.1 + 0.2), 0.3);
  const cur = structuredClone(TUNING);
  cur.enemies.separation = 0.5;
  cur.feel.fog.density = 0.3;
  const diff = tuningDiff(TUNING, cur);
  assert.deepEqual(diff, [{ path: 'enemies.separation', from: TUNING.enemies.separation, to: 0.5 }, { path: 'feel.fog.density', from: TUNING.feel.fog.density, to: 0.3 }]);
  const text = tuningCopyText(diff, { build: 'b1', when: '12:00' });
  assert.match(text, /^Lamplight tuning changes \(build b1, 12:00\):/);
  assert.match(text, /enemies\.separation: 0\.5 {3}\(was 0\.35\)/);
  assert.match(tuningCopyText([], { build: 'b1' }), /no changes/);
  for (const p of START_ONLY) assert.ok(rows.some((r) => r.path === p), `${p} is a real tuning value`);
});
