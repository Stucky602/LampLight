// The pacing drift check: `npm run pacing:check` (ARCHITECTURE §14).
//
// Are the committed yields (tools/pacing/yields.json, yields-skilled.json) measured on today's sim
// code and played data? Exits 0 when every set is fresh, 1 when any is stale or missing, naming
// them and the command that measures them again. Run it before a release and after any sim or
// balance change you mean to ship; it is not part of `npm test` (the deploy gate), which only
// checks that the yields files exist and parse.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkYields, REMEASURE } from './yields.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { ok, said } = await checkYields(ROOT);
if (ok) console.log('pacing: every committed set, for the three players, was measured on today\'s code and data.');
else {
  for (const line of said) console.error(line);
  console.error(`\nThe pacing report (node tools/pacing/pacing.mjs) may not hold until they are measured again: ${REMEASURE}`);
}
process.exit(ok ? 0 : 1);
