// The golden run (ARCHITECTURE §5.2): a fixed 60-second run on a frozen copy of the data
// (tests/fixtures/sim-golden-data.json), with inputs made by the sim's own math so they are the
// same in every engine. tests/determinism.test.js checks its hash in Node on every deploy, and
// tools/smoke/engine-check.mjs runs the same function inside the packaged Electron.
//
// When a deliberate sim change moves the hash, set GOLDEN.hash to the one the test reports. When
// the sim starts reading a data field the frozen copy lacks, run node tools/golden/freeze.mjs
// first (the test says so).
import { readFileSync } from 'node:fs';
import { createWorld, stepWorld, decide, currentHalt, hashWorld } from '../../src/sim/world.js';
import { fsin, fcos } from '../../src/lib/fmath.js';

export const GOLDEN = { ticks: 3600, hash: 'db237aa0' };

export function frozenData() {
  return JSON.parse(readFileSync(new URL('../fixtures/sim-golden-data.json', import.meta.url), 'utf8'));
}

/** Play the golden run on `data` (the frozen copy) and return the world at the end. */
export function playGolden(data, ticks = GOLDEN.ticks) {
  const w = createWorld({ seed: 'golden', character: 'lamplighter' }, data);
  for (let t = 0; t < ticks; t++) {
    // A slow figure eight, with a dash every 5 seconds.
    const a = t * 0.013;
    stepWorld(w, { mx: Math.round(100 * fcos(a)), my: Math.round(100 * fcos(a) * fsin(a) * 1.6), buttons: t % 300 === 0 ? 1 : 0 });
    while (currentHalt(w)) {
      const h = currentHalt(w);
      const answer = { draft: { kind: 'pick', index: 0 }, relic: { kind: 'pick', index: 0 }, rune: { kind: 'discard' }, overtime: { kind: 'leave' }, ferry: { kind: 'done' }, ascend: { kind: 'keep' } };
      decide(w, answer[h.kind] ?? { kind: 'ok' });
    }
    if (w.over) break;
  }
  return w;
}

export { hashWorld };
