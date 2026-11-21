// The weapons' codex pages and their three Harbor Orders (C3, ruling 18 P1): what a page lists and
// ticks, what each order opens, and the early Legendary the third opens (RunConfig.legendaryEarly).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA } from '../src/data/index.js';
import { makeWorld, give } from './helpers/simworld.js';
import { rollUpgrade } from '../src/sim/weaponups.js';
import { createRng } from '../src/lib/rng.js';
import { contentFrom, codexKeys, weaponPieces } from '../src/meta/state.js';
import { featMet } from '../src/meta/feats.js';
import { applyRunResult } from '../src/meta/apply.js';
import { weaponPage } from '../src/meta/codex.js';
import { defaultProfile } from '../src/save/schema.js';

const T = DATA.tuning.weaponUps;
const drafted = DATA.weapons.filter((w) => !w.signature && !w.innate);

test('legendaryEarly: a listed weapon\'s first Legendary comes at its legendaryFrom-th upgrade; an unlisted one\'s at its legendary-th', () => {
  const at = (config, n) => {
    const w = makeWorld(config);
    give(w, 'flare_gun', { level: n });   // n - 1 upgrades: the next is its n-th
    const rng = createRng(7);
    let leg = 0;
    for (let k = 0; k < 40; k++) if (rollUpgrade(w, 0, rng)?.rarity === 'legendary') leg++;
    return leg;
  };
  assert.equal(at({ legendaryEarly: ['flare_gun'] }, T.legendaryFrom), 40, 'listed: its 6th is a Legendary every time');
  assert.equal(at({}, T.legendaryFrom), 0, 'unlisted: never at its 6th');
  assert.equal(at({ legendaryEarly: ['oil_flask'] }, T.legendaryFrom), 0, 'another weapon listed: not this one');
  assert.equal(at({}, T.legendary), 40, 'unlisted: its 10th');
  assert.throws(() => makeWorld({ legendaryEarly: 'flare_gun' }), /legendaryEarly/);
});

test('weapon orders: three a drafted weapon, each opening exactly one real thing, each one a run can do', () => {
  for (const w of drafted) {
    const ids = [`kit_${w.id}`, `${w.id}_both`, `${w.id}_master`];
    for (const id of ids) {
      const f = DATA.feats.find((x) => x.id === id);
      assert.ok(f && f.group === 'weapon', `${id}: an order on the board`);
      assert.equal(contentFrom(DATA, `feat:${id}`).length, 1, `${id}: opens one thing`);
    }
    assert.equal(contentFrom(DATA, `feat:${w.id}_both`)[0].what, 'temper');
    assert.equal(contentFrom(DATA, `feat:${w.id}_master`)[0].what, 'early');
  }
  const top = DATA.feats.find((x) => x.id === 'flare_gun_master').when;
  const run = (weapons, extra = {}) => ({ end: 'cleared', cleared: true, tide: 3, weapons, ...extra });
  assert.ok(featMet(top, run([{ id: 'flare_gun', damage: 900 }, { id: 'oil_flask', damage: 100 }]), {}));
  assert.ok(!featMet(top, run([{ id: 'flare_gun', damage: 90 }, { id: 'oil_flask', damage: 100 }]), {}), 'not the top weapon');
  assert.ok(!featMet(top, run([{ id: 'flare_gun', damage: 900 }], { tide: 2 }), {}), 'below Tide 3');
});

test('weapon codex page: options by axis, Legendaries, and lines, ticked once a run took them; its three orders', () => {
  const doc = defaultProfile();
  const p0 = weaponPage(doc, DATA, 'flare_gun');
  assert.equal(p0.axes.length, 3);
  for (const a of p0.axes) assert.equal(a.options.length, 2, `${a.axis}: two options`);
  assert.ok(p0.specials.length >= 2 && p0.lines.length >= 2);
  assert.equal(p0.taken, 0);
  assert.equal(p0.orders.length, 3);
  for (const o of p0.orders) assert.ok(o.opens, `${o.name}: says what it opens`);
  const pieces = weaponPieces(DATA, 'flare_gun');
  for (const x of pieces) assert.ok(codexKeys(DATA).includes(`took:flare_gun:${x.id}`), `${x.id}: a codex key`);
  // A run that took Salvo, a line, and a Legendary on it: ticked, and no line on the results for it.
  const line = DATA.weapons.find((w) => w.id === 'flare_gun').lines[0].id, sp = DATA.weapons.find((w) => w.id === 'flare_gun').specials[0].id;
  const result = { character: 'lamplighter', map: DATA.maps[0].id, timeSurvived: 30, end: 'left', weapons: [{ id: 'flare_gun', level: 7, forms: ['salvo'], lines: [line], specials: [sp], damage: 10 }], passives: [], relics: [], bossesKilled: [], kills: {} };
  const { doc: after, changes } = applyRunResult(doc, result, DATA);
  const p1 = weaponPage(after, DATA, 'flare_gun');
  assert.equal(p1.taken, 3);
  assert.ok(p1.axes[0].options.find((o) => o.id === 'salvo').taken);
  assert.ok(!changes.some((c) => c.kind === 'codex' && String(c.key).startsWith('took:')), 'quiet on the results');
});

test('Both Ways (ruling 19 PD): both options of one axis across runs opens the Tempering; an old save that did Proven keeps it', async () => {
  const { featsDone, contentOpen } = await import('../src/meta/state.js');
  const line = DATA.ascensions.find((l) => l.weapons.includes('flare_gun'));
  const axis = line.options[0].axis, [a, b] = line.options.filter((o) => o.axis === axis).map((o) => o.id);
  const run = (form) => ({ character: 'lamplighter', map: DATA.maps[0].id, timeSurvived: 30, end: 'left', weapons: [{ id: 'flare_gun', level: 7, forms: [form], lines: [], specials: [], damage: 10 }], passives: [], relics: [], bossesKilled: [], kills: {} });
  let doc = defaultProfile();
  doc.profile.buildings = { ...(doc.profile.buildings || {}), tavern: 1 };
  doc = applyRunResult(doc, run(a), DATA).doc;
  assert.ok(!featsDone(doc, DATA).has('flare_gun_both'), 'one option: not yet');
  doc = applyRunResult(doc, run(a), DATA).doc;
  assert.ok(!featsDone(doc, DATA).has('flare_gun_both'), 'the same one again: not yet');
  doc = applyRunResult(doc, run(b), DATA).doc;
  assert.ok(featsDone(doc, DATA).has('flare_gun_both'), 'the other one, a later run: done');
  assert.ok(contentOpen(doc, DATA, 'feat:flare_gun_both'));
  // A save from before: Proven done, under its old id.
  const old = defaultProfile();
  old.profile.feats = ['flare_gun_capstone'];
  assert.ok(featsDone(old, DATA).has('flare_gun_both') && contentOpen(old, DATA, 'feat:flare_gun_both'), 'Tempered stays open');
});
