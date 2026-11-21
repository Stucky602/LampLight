// Menu logic that doesn't need a browser: controller navigation geometry, card text, and the
// tuning panel's model (ARCHITECTURE §8, §15).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA } from '../src/data/index.js';
import { TUNING } from '../src/data/tuning.js';
import { pickInDirection } from '../src/ui/focus.js';
import { cardInfo, capstoneFor, weaponLevelText, passiveLevelText, modifierText, upgradeText, rarityOf, formLine } from '../src/ui/describe.js';
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

test('card text: level-ups say what that level adds, as stat lines (docs/WRITING.md §3); a weapon\'s, its rolled upgrade as now and after (ruling 14)', () => {
  const flare = DATA.weapons.find((w) => w.id === 'flare_gun');
  const up = (u, value, extra = {}) => upgradeText(DATA, flare, { up: u, value, ...extra });
  // Without the weapon's numbers (a record, a chest's item seen later): its size.
  assert.equal(up('damage', 0.27), '+27% Damage');
  assert.equal(up('cooldown', 0.075), '-8% Cooldown');
  assert.equal(up('area', 0.12), '+12% Area');
  assert.equal(up('amount', 1), '+1 Flare', 'its count by its own unit');
  assert.equal(up('amount', 2), '+2 Flares');
  assert.equal(up('pierce', 1), '+1 Pierce');
  assert.equal(up('crit', 0.05), '+5% Crit Chance');
  assert.equal(up('hit_cooldown', 0.12), '-12% Hit Delay');
  // On a card: the weapon's real number now and after (the menus' typeface has no arrow: "to").
  assert.equal(up('damage', 0.2, { now: 24, after: 28.8 }), 'Damage 24 → 28.8');
  assert.equal(up('cooldown', 0.08, { now: 1.1, after: 1.012 }), 'Cooldown 1.10s → 1.01s');
  assert.equal(up('amount', 1, { now: 2, after: 3 }), 'Flares 2 → 3');
  assert.equal(up('crit', 0.1, { now: 0, after: 0.1 }), 'Crit Chance 0% → 10%');
  // A line and a special: the name and its sentence.
  const l = flare.lines[0], x = flare.specials[0];
  assert.equal(up('line', 0, { line: l.id }), `${l.name}: ${l.desc}`);
  assert.equal(up('special', 0, { special: x.id }), `${x.name}: ${x.desc}`);
  assert.equal(weaponLevelText(flare, 1), flare.desc, 'no level table: the weapon itself');
  assert.deepEqual(rarityOf(DATA, 'epic'), { id: 'epic', name: 'Epic' });
  // The Form line: the axis it opens, the next one and how far, or its capstone's deed (truthful about what's locked).
  assert.equal(formLine(DATA, { opens: 'delivery' }), 'New Form at this level');   // (RULING-L1: one count, its level)
  assert.equal(formLine(DATA, { next: { axis: 'flight', at: 10, left: 2 } }), 'New Form at Lv 11 (2 to go)');
  assert.equal(formLine(DATA, { next: { axis: 'delivery', at: 5, left: 1 } }), 'New Form at Lv 6 (1 to go)');
  assert.equal(formLine(DATA, { deed: { have: 41.6, need: 60, done: false, text: flare.deed.text } }), `Final Form goal: ${flare.deed.text} (41/60)`);
  assert.equal(formLine(DATA, { deed: { have: 60, need: 60, done: true, text: flare.deed.text } }), 'Final Form ready');
  assert.equal(formLine(DATA, { deed: { locked: 'research:orbwright' } }), `Final Form locked: needs ${DATA.research.find((r) => r.id === 'orbwright').name} (Library)`);
  // Every number type at every rarity it rolls at, on every weapon that has it, reads as a stat line.
  for (const w of DATA.weapons) for (const u of w.numbers) {
    const t = DATA.weaponUps.find((y) => y.id === u);
    for (let r = t.min; r < 5; r++) {
      const v = DATA.tuning.weaponUps.value[u] * DATA.tuning.weaponUps.mul[r] / DATA.tuning.weaponUps.mul[t.min];
      assert.match(upgradeText(DATA, w, { up: u, value: t.whole ? Math.max(1, Math.round(v)) : v }), /^[+-][\d.]+(%|x)? [A-Z][A-Za-z ]+$/, `${w.id} ${u}`);
    }
  }
  const ballast = DATA.passives.find((p) => p.id === 'ballast');
  assert.equal(passiveLevelText(ballast, 1), '+1 Pierce (Steel), +12% Knockback (Steel)');
  assert.equal(modifierText({ stat: 'cooldown', op: 'pct', value: -0.06 }), '-6% Cooldown');
  assert.equal(modifierText({ stat: 'amount', op: 'add', value: 1, tags: ['tide'] }), '+1 Projectile (Tide)');
  assert.equal(modifierText({ stat: 'amount', op: 'add', value: 2 }), '+2 Projectiles');
  assert.equal(modifierText({ stat: 'dashCooldown', op: 'pct', value: -0.1 }), '-10% Dash Cooldown');
  assert.equal(modifierText({ stat: 'revival', op: 'add', value: 1 }), '+1 Revival');
  assert.equal(modifierText({ stat: 'cooldown', op: 'add', value: -0.25 }), '-0.25s Cooldown');
  const texts = Object.fromEntries(DATA.passives.map((p) => [p.id, p.levels.map((_, i) => passiveLevelText(p, i + 1))]));
  assert.deepEqual(texts.undertow, ['+1 Projectile (Sea)', '+10% Damage (Sea)', '+15% Duration (Sea)', '+10% Damage (Sea)', '+1 Projectile (Sea)']);
  assert.deepEqual(texts.thick_coat, ['+15 Max HP', '+15 Max HP', '+15 Max HP, +1 Armor', '+15 Max HP', '+15 Max HP, +1 Armor']);
  assert.deepEqual(texts.tallow_candle[0], '-6% Cooldown');
  assert.deepEqual(texts.waders[0], '+4% Move Speed, +8% Area (Frost)', 'ruling 16: no passive touches the dash');
  for (const line of Object.values(texts).flat()) for (const part of line.split(', ')) assert.match(part, /^[+\-x][\d.]+(%|s|x)? [A-Z][A-Za-z ]+( \([A-Z][a-z]*(, [A-Z][a-z]*)*\))?$/, part);
  for (const t of Object.values(texts).flat()) assert.doesNotMatch(t, /\b1 (Projectiles|Revivals|Rerolls)\b|undefined|NaN|\.$/, t);
  assert.equal(modifierText({ stat: 'moveSpeed', op: 'pct', value: 0.08 }), '+8% Move Speed');
  assert.equal(modifierText({ stat: 'might', op: 'more', value: 0.2, tags: ['fire'] }), 'x1.2 Damage (Fire)');
});

test('card text: tags with what you have, partner passives, keystones, capstone notes that tell the truth, the Dash slot\'s cards', () => {
  const build = { tags: { fire: 2, light: 1 }, weapons: ['flare_gun'], passives: [] };
  const per = Math.round(DATA.tuning.forms.partnerPer * 100);
  const c = cardInfo({ kind: 'passive', id: 'wick_oil', level: 1, isNew: true }, DATA, build);
  assert.equal(c.title, 'Wick Oil');
  assert.equal(c.sub, 'New passive');
  assert.deepEqual(c.tags, [{ tag: 'fire', have: 2 }]);
  assert.equal(c.note, `Flare Gun Final Form: +${per}% Damage per level`);
  assert.equal(c.rule, `Lv 5 bonus: ${DATA.passives.find((p) => p.id === 'wick_oil').keystone.desc}`, 'a new passive says what its last level adds');
  const last = cardInfo({ kind: 'passive', id: 'wick_oil', level: 5, isNew: false }, DATA, build);
  assert.equal(last.sub, 'Lv 5 MAX');
  assert.match(last.rule, /^Lv 5 bonus: /);
  assert.equal(cardInfo({ kind: 'passive', id: 'wick_oil', level: 1, isNew: true }, DATA, { tags: {}, weapons: [], passives: [] }).note, null, 'no partner carried: no system words on a first card');
  const cap = capstoneFor(DATA, 'flare_gun');
  assert.ok(cap && cap.passive.id === 'wick_oil' && cap.forms.length === 2, 'two capstone options, Wick Oil its partner');
  const w = cardInfo({ kind: 'weapon', id: 'flare_gun', level: 8, isNew: false, up: 'amount', rarity: 'rare', value: 1, now: 1, after: 2, next: { axis: 'flight', at: 10, left: 3 } }, DATA, { tags: {}, weapons: [], passives: ['wick_oil'] });
  assert.deepEqual([w.sub, w.desc, w.rarity, w.form], ['Lv 8', 'Flares 1 → 2', { id: 'rare', name: 'Rare' }, 'New Form at Lv 11 (3 to go)'], 'no MAX: weapons never top out');
  const lg = cardInfo({ kind: 'weapon', id: 'flare_gun', level: 10, isNew: false, up: 'special', special: 'magnesium', rarity: 'legendary', value: 0 }, DATA);
  assert.equal(lg.event, 'legendary', 'a Legendary is an event');
  // A new weapon's Final Form line (RULING-L1): none before the player has seen a Form screen; then
  // short: its goal, or the project that opens it.
  assert.equal(cardInfo({ kind: 'weapon', id: 'flare_gun', level: 1, isNew: true }, DATA, { tags: {}, weapons: [], passives: [] }).note, null, 'not before a Form screen');
  const fresh = cardInfo({ kind: 'weapon', id: 'flare_gun', level: 1, isNew: true }, DATA, { tags: {}, weapons: [], passives: [], formSeen: true });
  assert.equal(fresh.note, `Final Form goal: ${DATA.weapons.find((x) => x.id === 'flare_gun').deed.text}`);
  const shut = cardInfo({ kind: 'weapon', id: 'lantern_orb', level: 1, isNew: true }, DATA, { tags: {}, weapons: [], passives: [], forms: [], formSeen: true });
  const orb = DATA.ascensions.find((l) => l.weapons.includes('lantern_orb')).capstoneUnlock;
  assert.equal(shut.note, `Final Form locked: needs ${DATA.research.find((r) => `research:${r.id}` === orb).name} (Library)`, 'a Final Form the run can\'t open names its project');
  // The Dash slot (ruling 16): another item swaps in; a card for the held one is a plain number, now and after.
  const d = DATA.dashes[0];
  const nd = cardInfo({ kind: 'dash', id: d.id, level: 1, isNew: true }, DATA);
  assert.deepEqual([nd.title, nd.sub, nd.desc], [d.name, 'New dash', d.desc]);
  assert.match(nd.note, /Replaces the dash you hold/);
  assert.equal(cardInfo({ kind: 'dash', id: d.id, level: 2, isNew: false, up: 'dash_recharge', value: 0.12, now: 2.5, after: 2.2 }, DATA).desc, 'Dash Recharge 2.50s → 2.20s');
  assert.equal(cardInfo({ kind: 'dash', id: d.id, level: 2, isNew: false, up: 'dash_charges', value: 1, now: 1, after: 2 }, DATA).desc, 'Dash Charges 1 → 2');
  assert.throws(() => cardInfo({ kind: 'form', id: 'flare_gun' }, DATA), /unknown card kind form/);
  assert.equal(cardInfo({ kind: 'relic', id: 'tide_clock' }, DATA).sub, 'Relic');
  assert.equal(cardInfo({ kind: 'heal', id: 'heal', amount: 40 }, DATA).sub, 'Item');
  assert.equal(cardInfo({ kind: 'coin', id: 'coin', amount: 25 }, DATA).desc, '+25 Coin');
  assert.equal(cardInfo({ kind: 'heal', id: 'heal', amount: 40 }, DATA).desc, 'Heals 40 HP.');
  assert.throws(() => cardInfo({ kind: 'weapon', id: 'nope' }, DATA), /unknown weapon/);
  assert.throws(() => cardInfo({ kind: 'hat', id: 'x' }, DATA), /unknown card kind/);
  // Every draftable card in the data describes itself without throwing.
  for (const wdef of DATA.weapons) {
    for (const u of wdef.numbers) assert.ok(cardInfo({ kind: 'weapon', id: wdef.id, level: 4, isNew: false, up: u, rarity: 'legendary', value: 1 }, DATA).desc.length > 3);
    for (const l of wdef.lines || []) assert.ok(cardInfo({ kind: 'weapon', id: wdef.id, level: 4, isNew: false, up: 'line', line: l.id, rarity: l.rarity, value: 0 }, DATA).desc.includes(l.name));
    for (const x of wdef.specials || []) assert.ok(cardInfo({ kind: 'weapon', id: wdef.id, level: 10, isNew: false, up: 'special', special: x.id, rarity: 'legendary', value: 0 }, DATA).desc.includes(x.name));
    assert.ok(cardInfo({ kind: 'weapon', id: wdef.id, level: 1, isNew: true }, DATA).desc.length > 3);
  }
  for (const p of DATA.passives) for (let L = 1; L <= p.maxLevel; L++) assert.ok(cardInfo({ kind: 'passive', id: p.id, level: L, isNew: L === 1 }, DATA).desc.length > 3);
});

test('tuning model: every number is a row, steps are sensible, and the copy text names only changes', () => {
  const rows = flattenTuning(TUNING);
  assert.ok(rows.length > 100, `${rows.length} values`);
  for (const r of rows) assert.equal(checkTune(TUNING, r.path, r.value), null, `${r.path} can be set to its own value`);
  assert.ok(rows.some((r) => r.path === 'feel.hitStop.playerHurt'));
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
