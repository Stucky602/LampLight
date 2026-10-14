// Rewrites the frozen copy of the game data that the golden determinism run uses
// (tests/fixtures/sim-golden-data.json). Run it when the sim starts reading a tuning or content
// field the frozen copy lacks (the golden test says so), then set GOLDEN.hash in
// tests/helpers/golden.js to the hash the test reports.
//
//   node tools/golden/freeze.mjs
import { writeFileSync } from 'node:fs';
import { DATA } from '../../src/data/index.js';

const out = new URL('../../tests/fixtures/sim-golden-data.json', import.meta.url);
writeFileSync(out, JSON.stringify(DATA));
console.log(`wrote ${out.pathname}`);
