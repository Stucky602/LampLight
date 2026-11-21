// tools/bots/forms.mjs (ARCHITECTURE §14.2): the Form measurement Phase 9 leans on, kept working.
// 0.7.2's first version handed out an Ember every pass while the world sat halted on the same
// tick, and ran out of memory; this plays past 1:00 and checks what it hands out and counts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formTrial } from '../tools/bots/forms.mjs';

test('form tool: a trial past 1:00 gives each Ember once, takes the Forms asked, and counts the weapon\'s own kills', () => {
  const none = formTrial({ weapon: 'flare_gun', forms: [], seed: 'gate', minutes: 1.1 });
  assert.deepEqual(none.taken, []);
  const two = formTrial({ weapon: 'flare_gun', forms: ['salvo', 'mortar'], seed: 'gate', minutes: 1.1 });
  assert.deepEqual(two.taken, ['salvo', 'mortar'], 'one Ember a Form, in order');
  for (const r of [none, two]) {
    assert.ok(Number.isInteger(r.kills) && r.kills > 0, 'the weapon killed something in 66 s');
    assert.ok(r.damage > 0);
  }
});
