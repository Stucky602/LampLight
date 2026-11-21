// tools/balance/held.mjs: copied from work/cw/C1/held.mjs (X6, Nov 20) so the balance benches and their test
// fixtures can be rebuilt from the repo. Run from the repo root (docs/HANDOFF.md has the commands).
// C1b: what careful and random hold, split by cleared and died (runc1.mjs rows): passive levels by
// passive, weapon count, weapon levels, level, damage taken. node held.mjs a.jsonl [b.jsonl ...]
import { readFileSync } from 'node:fs';
for (const f of process.argv.slice(2)) {
  const X = readFileSync(f, 'utf8').trim().split('\n').filter((l) => l[0] === '{').map((l) => JSON.parse(l));
  for (const grp of [['cleared', X.filter((r) => r.cleared)], ['died', X.filter((r) => !r.cleared)]]) {
    const [name, R] = grp; if (!R.length) continue;
    const pl = {}; let w = 0, wl = 0, lv = 0, tk = 0, np = 0;
    for (const r of R) {
      for (const p of r.passives || []) pl[p.id] = (pl[p.id] ?? 0) + p.level / R.length;
      const ws = r.weapons.filter((x) => x.id !== r.sig); w += ws.length / R.length; wl += ws.reduce((s, x) => s + x.lv, 0) / R.length;
      lv += r.level / R.length; tk += r.taken / R.length; np += (r.passives || []).length / R.length;
    }
    console.log(`${f.split('/').pop()} ${name} n${R.length}: L${lv.toFixed(0)} weapons ${w.toFixed(1)} (levels ${wl.toFixed(0)}), passives ${np.toFixed(1)}, taken ${tk.toFixed(0)} | ` + Object.entries(pl).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(', '));
  }
}
