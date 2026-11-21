// Ruling 19 RB: a Rare or Epic line changes what a weapon does. One whose effect is only numbers
// (stats, or an emitter's numbers) belongs on an Uncommon card, and fails here.

import test from 'node:test';
import assert from 'node:assert/strict';
import { DATA } from '../src/data/index.js';

// (A line that changes how far it throws what it hits, Moth Draw or Heavy Sea, changes what happens to
// the enemy, and counts as behavior.)
const behavior = (b) => (b.onHit && b.onHit.length > 0) || (b.fx && Object.keys(b.fx).length > 0)
  || Object.values(b.emit || {}).some((v) => typeof v !== 'number') || (b.stats?.knockbackMul ?? 1) !== 1;

test('lines (RB): every drafted weapon\'s Rare and Epic line does something, not only numbers', () => {
  const bare = [];
  for (const w of DATA.weapons.filter((x) => !x.innate && !x.signature)) {
    for (const l of w.lines || []) if ((l.rarity === 'rare' || l.rarity === 'epic') && !behavior(l.boost || {})) bare.push(`${w.id}: ${l.name}`);
  }
  assert.deepEqual(bare, []);
});
