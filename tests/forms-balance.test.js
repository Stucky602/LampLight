// Ruling 17 W2: on every drafted weapon's axis the two Form options are within x2 of each other on
// their own ruler, and none is under x1.15 of the bare weapon. The numbers come from C1's bench
// (work/cw/C1/bench.mjs, formfixture.mjs), checked in as tests/fixtures/form-bench.json: rebench
// and rewrite it whenever an option's numbers change (the test fails on an option it hasn't seen).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DATA } from '../src/data/index.js';

const bench = JSON.parse(readFileSync(new URL('./fixtures/form-bench.json', import.meta.url), 'utf8'));
const drafted = DATA.weapons.filter((w) => !w.innate && !w.signature);

test('forms balance (W2): every option benched, none under x1.15 (a control option no loss), and the two on an axis within x2 of each other', () => {
  const low = [], wide = [], missing = [];
  for (const w of drafted) {
    const line = DATA.ascensions.find((l) => l.weapons.includes(w.id));
    for (const axis of ['delivery', 'flight', 'payoff']) {
      const opts = line.options.filter((o) => o.axis === axis);
      assert.equal(opts.length, 2, `${w.id} ${axis}: two options`);
      // (A control option is read at the better of safety and damage, here and in the axis's x2.)
      const r = opts.map((o) => (o.control && bench.ratio[o.id] !== undefined ? Math.max(bench.ratio[o.id], bench.alt?.[o.id] ?? 0) : bench.ratio[o.id]));
      // A control option (ruling 18 WC: its damage rider capped) is held to safety on the tank ruler,
      // and may not be a loss: x1 or better there or on damage (kite, `alt`), whichever is higher.
      opts.forEach((o, k) => {
        if (r[k] === undefined) missing.push(o.id);
        else if (o.control ? r[k] < 1 : r[k] < 1.15) low.push(`${o.id} x${r[k]} (${bench.ruler[o.id]})`);
      });
      if (r.every((x) => x !== undefined) && Math.max(...r) / Math.min(...r) > 2) wide.push(`${w.id} ${axis}: ${opts.map((o, k) => `${o.id} x${r[k]}`).join(' against ')}`);
    }
  }
  // (All three at once, so one kind of failure doesn't hide another.)
  assert.deepEqual({ missing, low, wide }, { missing: [], low: [], wide: [] }, 'options with no bench row; under x1.15 (a control option: under x1); axes more than x2 apart');
});

// Ruling 18 WA: whole sets, not single pieces. Every set of one option on each axis (8 a weapon),
// benched whole late in a run (level 35, 15:00 to 17:00; work/cw/C1/bench.mjs --sets 1, setstable.mjs),
// is at most 2.5x its weapon's median set on each ruler it is read on (kite for all, leaving out a
// set with an option the kiting bot can't play; plant, every set of a weapon with an option that
// wants you still; circle, every set of the Glass Caltrops, whose glass drops while you move). A trio no single piece shows (the Signal Mirror's and the Flare Gun's, round 3)
// fails here.
test('forms balance (WA): every whole set benched, none over 2.5x its weapon\'s median set', () => {
  const over = [], missing = [];
  for (const w of drafted) {
    const line = DATA.ascensions.find((l) => l.weapons.includes(w.id));
    const by = ['delivery', 'flight', 'payoff'].map((a) => line.options.filter((o) => o.axis === a).map((o) => o.id));
    const ex = (x, y) => { const ox = line.options.find((o) => o.id === x), oy = line.options.find((o) => o.id === y); return (ox.excludes || []).includes(y) || (oy.excludes || []).includes(x); };
    for (const a of by[0]) for (const b of by[1]) for (const c of by[2]) {
      if (ex(a, b) || ex(a, c) || ex(b, c)) continue;   // (a set that can't be held: ruling 21 WA)
      const key = `${a}+${b}+${c}`, r = bench.sets?.[key];
      if (!r) { missing.push(`${w.id} ${key}`); continue; }
      for (const [ruler, v] of Object.entries(r)) if (v > 2.5) over.push(`${w.id} ${key} x${v} (${ruler})`);
    }
  }
  assert.deepEqual(missing, [], 'sets with no bench row (rebench: work/cw/C1/bench.mjs --sets 1)');
  assert.deepEqual(over, [], 'sets over 2.5x their weapon\'s median set');
});
