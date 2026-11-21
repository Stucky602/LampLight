// tools/balance/pair.mjs: copied from work/cw/C1/pair.mjs (X6, Nov 20) so the balance benches and their test
// fixtures can be rebuilt from the repo. Run from the repo root (docs/HANDOFF.md has the commands).
// C1b: careful against random run by run on the same seeds and characters (runc1.mjs rows).
// node pair.mjs careful.jsonl random.jsonl  -> per pair: who cleared, when the loser died and to what,
// and what each held (weapons with levels, passives with levels, level, damage taken by kind).
import { readFileSync } from 'node:fs';
const rd = (f) => readFileSync(f, 'utf8').trim().split('\n').filter((l) => l[0] === '{').map((l) => JSON.parse(l));
const [cf, rf] = process.argv.slice(2);
const C = rd(cf), R = rd(rf), key = (r) => `${r.ch}:${r.k}`, rm = new Map(R.map((r) => [key(r), r]));
const mm = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const desc = (r) => `L${r.level} ${r.end === 'cleared' ? 'clear' : 'died ' + mm(r.sec)} taken ${Math.round(r.taken)} | W ${r.weapons.filter((w) => w.id !== r.sig).map((w) => `${w.id.slice(0, 8)}${w.lv}`).join(' ')} | P ${(r.passives || []).map((p) => `${(p.id || p).slice(0, 7)}${p.level ?? ''}`).join(' ')}`;
const top = (h) => Object.entries(h || {}).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${v}`).join(', ');
for (const c of C) {
  const r = rm.get(key(c)); if (!r) continue;
  const tag = c.cleared === r.cleared ? (c.cleared ? 'both' : 'neither') : c.cleared ? 'CAREFUL only' : 'RANDOM only';
  if (tag === 'both') continue;
  console.log(`${key(c)} ${tag}\n  careful ${desc(c)}\n     hurt: ${top(c.hurtBy)}\n  random  ${desc(r)}\n     hurt: ${top(r.hurtBy)}`);
}
