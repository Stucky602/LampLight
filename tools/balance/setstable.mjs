// tools/balance/setstable.mjs: copied from work/cw/C1/setstable.mjs (X6, Nov 20) so the balance benches and their test
// fixtures can be rebuilt from the repo. Run from the repo root (docs/HANDOFF.md has the commands).
// Ruling 18 WA: whole option sets (bench.mjs --sets 1), each x its weapon's median set, on each ruler.
// Usage: node setstable.mjs kite.jsonl plant.jsonl   (prints the table; --json for the fixture's shape)
import { readFileSync, existsSync } from 'node:fs';
import { RULER } from './formfixture-ruler.mjs';
// On the kite ruler, a set with an option that wants you still (plant) or walking a loop (circle) is
// not read: the kiting bot can't play it. Plant and circle read every set of the weapons benched there.
const offKite = new Set([...RULER.plant, ...RULER.circle]);
const files = process.argv.slice(2).filter((f) => !f.startsWith('--'));
const json = process.argv.includes('--json');
const med = (a) => { const b = [...a].sort((x, y) => x - y); const n = b.length; return n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2; };
const out = {};
for (const f of files) {
  if (!existsSync(f)) continue;
  const rows = readFileSync(f, 'utf8').trim().split('\n').filter((l) => l[0] === '{').map((l) => JSON.parse(l)).filter((r) => !r.error);
  const ruler = rows[0]?.move ?? 'kite';
  const by = new Map();
  for (const r of rows) {
    if (r.forms.length !== 3) continue;
    if (ruler === 'kite' && r.forms.some((f) => offKite.has(f))) continue;
    const k = `${r.id}|${r.forms.join('+')}`;
    by.set(k, [...(by.get(k) ?? []), r.real]);
  }
  const weapons = new Map();
  for (const [k, v] of by) { const [id, set] = k.split('|'); if (!weapons.has(id)) weapons.set(id, []); weapons.get(id).push([set, v.reduce((s, x) => s + x, 0) / v.length]); }
  for (const [id, sets] of weapons) {
    const m = med(sets.map((x) => x[1]));
    for (const [set, v] of sets) { (out[set] ??= {})[ruler] = Math.round(v / m * 100) / 100; }
    if (!json) console.log(`${ruler} ${id.padEnd(15)} ` + sets.map(([s, v]) => `${s.split('+').map((x) => x.slice(0, 6)).join('+')} ${(v / m).toFixed(2)}${v / m > 2.5 ? ' !!' : ''}`).join('  '));
  }
}
if (json) console.log(JSON.stringify(out));
