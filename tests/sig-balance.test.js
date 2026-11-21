// Ruling 19 KH and KI (C2): the six signatures, held to the drafted weapons' rules.
// - KH: every whole set (one option on each axis, 8 a signature) is at most 2.5x its signature's
//   median set, benched by work/cw/C2/tools/sigsets.mjs (the character with only its signature at
//   level 20, 15:00 to 17:00 of a Docks run, kite bot; the median of 3 seeds a set, since one
//   seed can read a set 2 to 4 times another), checked in as fixtures/sig-sets.json.
// - KH: a signature's trade pays at most two upgrades in any `span` s, whatever the deeds.
// - KI: with option B on every axis of the signature (drafted weapons left on A), the signature
//   holds at least 12% of the character's health removed at 20:00 (median of the bench's seeds,
//   CW2's run.mjs on the careful picker, Docks Tide 0), checked in as fixtures/sig-bshare.json.
// Each fixture carries the stamp of the options it read; rebench when an option's numbers change.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DATA } from '../src/data/index.js';
import { createWorld } from '../src/sim/world.js';
import { tradeDeed } from '../src/sim/trades.js';

const sigs = DATA.characters.map((c) => ({ ch: c.id, id: c.signature, line: DATA.ascensions.find((l) => l.weapons.includes(c.signature)) }));
const optionStamp = (opts) => JSON.stringify(opts.map((o) => [o.id, o.form ?? null, o.boost ?? null]));
const load = (f) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'));

test('signatures (KH): every whole option set benched, none over 2.5x its signature\'s median set', () => {
  const fx = load('sig-sets.json'), over = [], missing = [], stale = [];
  for (const { ch, line } of sigs) {
    if (fx.stamp[ch] !== optionStamp(line.options)) stale.push(ch);
    const by = ['delivery', 'flight', 'payoff'].map((a) => line.options.filter((o) => o.axis === a).map((o) => o.id));
    const vals = [];
    for (const a of by[0]) for (const b of by[1]) for (const c of by[2]) {
      const v = fx.sets[ch]?.[`${a}+${b}+${c}`];
      if (!(v > 0)) missing.push(`${ch} ${a}+${b}+${c}`); else vals.push([`${a}+${b}+${c}`, v]);
    }
    const sorted = vals.map((x) => x[1]).sort((x, y) => x - y), med = (sorted[3] + sorted[4]) / 2;
    for (const [k, v] of vals) if (v / med > 2.5) over.push(`${ch} ${k} x${(v / med).toFixed(2)}`);
  }
  assert.deepEqual(stale, [], 'signatures whose options changed since the bench (rerun work/cw/C2/tools/sigsets.mjs, then sigfixture.mjs)');
  assert.deepEqual(missing, [], 'sets with no bench row');
  assert.deepEqual(over, [], 'sets over 2.5x their signature\'s median set');
});

test('signatures (KI): with option B on every axis, each signature holds 12% or more of the character\'s damage at 20:00', () => {
  const fx = load('sig-bshare.json'), low = [], stale = [];
  for (const { ch, line } of sigs) {
    if (fx.stamp[ch] !== optionStamp(line.options)) stale.push(ch);
    if (!(fx.share[ch] >= 12)) low.push(`${ch} ${fx.share[ch]}%`);
  }
  assert.deepEqual(stale, [], 'signatures whose options changed since the B bench (rerun it, then sigfixture.mjs)');
  assert.deepEqual(low, [], 'B sets under 12%');
});

test('signatures (KH): the trade pays at most two upgrades in any span, however many deeds it does', () => {
  for (const c of DATA.characters) {
    const w = createWorld({ seed: `cap ${c.id}`, character: c.id, invulnerable: true }, DATA);
    const P = w.trade.P, s = w.trade.s;
    assert.ok(P.span > 0, `${c.id}: a span`);
    const ups = [];
    for (let t = 0; t < 3 * P.span * 60; t++) {
      const was = s.sigN;
      w.tick = t;
      tradeDeed(w, s.sigNeed);
      if (s.sigN > was) ups.push(t);
      while (w.halts && w.halts.length) w.halts.pop();
    }
    for (let k = 2; k < ups.length; k++) assert.ok(ups[k] - ups[k - 2] >= P.span * 60, `${c.id}: three trade upgrades inside ${P.span}s (${ups.slice(k - 2, k + 1)})`);
    assert.ok(ups.length >= 4, `${c.id}: the trade still pays (${ups.length} in ${3 * P.span}s)`);
  }
});
