// Every event code the source names is defined in sim/events.js (C3, Nov 17: EV.DEED and five
// more were pushed for a day as `undefined`, so they arrived as type 0 and nothing could read them).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanJs } from './helpers/jsscan.js';
import { EV } from '../src/sim/events.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.m?js$/.test(name)) out.push(p);
  }
  return out;
}

test('events: every EV.<name> used in src/ and tests/ is defined in sim/events.js', () => {
  const missing = [];
  for (const dir of ['src', 'tests']) {
    for (const f of walk(join(ROOT, dir))) {
      const code = scanJs(readFileSync(f, 'utf8')).codeOnly;
      for (const m of code.matchAll(/\bEV\.([A-Z_][A-Z0-9_]*)/g)) {
        if (!(m[1] in EV)) missing.push(`${relative(ROOT, f)}: EV.${m[1]}`);
      }
    }
  }
  assert.deepEqual([...new Set(missing)], [], 'event names used but not defined in src/sim/events.js');
});

test('events: no two event names share a code, and each fits in a byte', () => {
  const seen = new Map();
  for (const [k, v] of Object.entries(EV)) {
    assert.ok(Number.isInteger(v) && v > 0 && v < 256, `EV.${k} = ${v}`);
    assert.ok(!seen.has(v), `EV.${k} and EV.${seen.get(v)} share ${v}`);
    seen.set(v, k);
  }
});
