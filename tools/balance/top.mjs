// tools/balance/top.mjs: copied from work/cw/C1/top.mjs (X6, Nov 20) so the balance benches and their test
// fixtures can be rebuilt from the repo. Run from the repo root (docs/HANDOFF.md has the commands).
// C1b: each run's top weapon over the next (real damage), with its Forms. node top.mjs rows.jsonl [min ratio]
import { readFileSync } from 'node:fs';
const R = readFileSync(process.argv[2], 'utf8').trim().split('\n').filter((l) => l[0] === '{').map((l) => JSON.parse(l));
const min = +(process.argv[3] ?? 0); let n = 0;
for (const r of R) {
  const w = r.weapons.map((x) => ({ id: x.id, real: x.real || 0, f: x.forms || [], lv: x.lv, l: x.lines, s: x.specials })).sort((a, b) => b.real - a.real);
  const q = w[0].real / Math.max(1, w[1]?.real ?? 0);
  if (q > 3) n++;
  if (q >= min) console.log(`${r.ch} ${r.k} ${r.end} x${q.toFixed(1)} ${w[0].id} L${w[0].lv} [${w[0].f.join('+')}] lines ${w[0].l} sp ${w[0].s} | next ${w[1]?.id}`);
}
console.log(`${R.length} runs, over 3x in ${n}`);
