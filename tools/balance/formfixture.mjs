// tools/balance/formfixture.mjs: copied from work/cw/C1/formfixture.mjs (X6, Nov 20) so the balance benches and their test
// fixtures can be rebuilt from the repo. Run from the repo root (docs/HANDOFF.md has the commands).
// Ruling 17 W2: writes tests/fixtures/form-bench.json from the bench rows: each drafted weapon's Form
// option, x its bare weapon, on the option's own ruler (kite: health removed with the kiting bot;
// plant: health removed with a player who stands and turns; circle: one who walks a small circle;
// tank: damage taken, bare's over the option's, for options whose worth is control).
// Usage: node formfixture.mjs kite.jsonl[,..] plant.jsonl tank.jsonl circle.jsonl > form-bench.json
import { readFileSync, existsSync } from 'node:fs';
export const RULER = {
  plant: ['bow_lantern', 'heliograph', 'drop_anchor', 'bell_buoy', 'ground_rod', 'artesian', 'procession', 'bow_horn'],
  tank: ['dazzle', 'brinicle', 'drag_under', 'dredge', 'hamstring', 'fog_bank', 'rime', 'ice_wall'],   // (ruling 18 WC: control options, their damage riders capped, read on damage taken at 4 seeds)
  circle: ['glass_ring', 'kicked_glass'],
};
const rulerOf = (id) => Object.keys(RULER).find((k) => RULER[k].includes(id)) ?? 'kite';
// Several files a ruler (comma-separated): each is read on its own (its own bare rows), and a later file's
// option overrides an earlier one's (a rebench of changed options).
const read = (f) => f.split(',').filter((x) => x && existsSync(x)).map((x) => readFileSync(x, 'utf8').trim().split('\n').filter((l) => l[0] === '{').map((l) => JSON.parse(l)));
const args = process.argv.slice(2).filter((a, i, l) => a !== '--sets' && l[i - 1] !== '--sets');
const setsFile = process.argv.includes('--sets') ? process.argv[process.argv.indexOf('--sets') + 1] : null;
const [kite, plant, tank, circle] = args.map((f) => read(f || ''));
const sets = { kite, plant, tank, circle };
const out = { method: 'C1 bench.mjs: one weapon at level 10, Docks 6:00 to 8:30, 2 seeds, mean over seeds; tank = bare damage taken / the option\'s', ruler: {}, ratio: {} };
const mean = (a) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
for (const [ruler, files] of Object.entries(sets)) for (const rows of files) {
  const bare = new Map();
  for (const r of rows) if (!r.forms.length && !r.lines.length && !r.specials.length) bare.set(r.id, [...(bare.get(r.id) ?? []), r]);
  for (const r of rows) {
    if (r.forms.length !== 1 || r.lines.length || r.specials.length) continue;
    const id = r.forms[0];
    if (rulerOf(id) !== ruler) continue;
    const b = bare.get(r.id) ?? [];
    const opt = rows.filter((x) => x.id === r.id && x.forms.length === 1 && x.forms[0] === id && !x.lines.length && !x.specials.length);
    const v = ruler === 'tank' ? mean(b.map((x) => x.taken)) / Math.max(1e-9, mean(opt.map((x) => x.taken))) : mean(opt.map((x) => x.real)) / Math.max(1e-9, mean(b.map((x) => x.real)));
    out.ruler[id] = ruler; out.ratio[id] = Math.round(v * 100) / 100;
  }
}
if (setsFile) { out.setsMethod = 'C1 bench.mjs --sets 1: each weapon alone, level 35, 15:00 to 17:00, 3 seeds; each set x its weapon\'s median set on each ruler (setstable.mjs)'; out.sets = JSON.parse(readFileSync(setsFile, 'utf8')); }
console.log(JSON.stringify(out, null, 1));
