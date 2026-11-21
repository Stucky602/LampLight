// tools/balance/sigfixture.mjs: copied from work/cw/C2/tools/sigfixture.mjs (X6, Nov 20) so the balance benches and their test
// fixtures can be rebuilt from the repo. Run from the repo root (docs/HANDOFF.md has the commands).
// C2: writes tests/fixtures/sig-sets.json (from sigsets.mjs rows: median over seeds of each set) and
// tests/fixtures/sig-bshare.json (from signature-only-B run rows: median share at 20:00), each with
// the stamp of the options it read. node sigfixture.mjs sigsets.jsonl B.jsonl
import { readFileSync, writeFileSync } from 'node:fs';
const R = process.env.TREE || new URL('../..', import.meta.url).pathname.replace(/\/$/, '');   // (the repo this file is in; TREE=<a snapshot> benches that one)
const { DATA } = await import(`${R}/src/data/index.js`);
const stamp = {};
for (const c of DATA.characters) { const l = DATA.ascensions.find((x) => x.weapons.includes(c.signature)); stamp[c.id] = JSON.stringify(l.options.map((o) => [o.id, o.form ?? null, o.boost ?? null])); }
const rows = (f) => readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const med = (a) => { a = a.slice().sort((x, y) => x - y); return a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2; };
const sets = {};
const by = {};
for (const r of rows(process.argv[2])) if (typeof r.real === 'number') ((by[r.ch] ??= {})[r.set] ??= []).push(r.real);
for (const ch in by) { sets[ch] = {}; for (const k in by[ch]) sets[ch][k] = med(by[ch][k]); }
writeFileSync(`${R}/tests/fixtures/sig-sets.json`, JSON.stringify({ stamp, sets }, null, 1) + '\n');
const share = {}, sh = {};
for (const r of rows(process.argv[3])) {
  const pm = r.permin[Math.min(r.permin.length, 20) - 1].real; delete pm.thralls;
  const t = Object.values(pm).reduce((a, b) => a + b, 0); (sh[r.ch] ??= []).push(t ? 100 * (pm[r.sig] ?? 0) / t : 0);
}
for (const ch in sh) share[ch] = Math.round(med(sh[ch]));
writeFileSync(`${R}/tests/fixtures/sig-bshare.json`, JSON.stringify({ stamp, share }, null, 1) + '\n');
console.log(JSON.stringify(share));
