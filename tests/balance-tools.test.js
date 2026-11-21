// The balance tools (tools/balance/, X6: copied from the builders' work folders so a release carries
// them and tests/fixtures/form-bench.json, sig-sets.json, and sig-bshare.json can be rebuilt from the
// repo). Each loads from the repo with no path outside it; nothing here runs a bench (seeds 0, two rows).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync, mkdtempSync, mkdirSync, symlinkSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const DIR = join(ROOT, 'tools', 'balance');
const node = (args, env = {}) => spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', timeout: 60000, env: { ...process.env, TREE: '', ...env } });
const ROW = { ch: 'lamplighter', k: 0, end: 'cleared', cleared: true, level: 30, sec: 1380, taken: 400, sig: 'lamplight', hurtBy: { bilge_rat: 3 },
  weapons: [{ id: 'flare_gun', real: 9000, lv: 8, forms: ['salvo'], lines: 1, specials: 0 }, { id: 'oil_flask', real: 1000, lv: 5, forms: [], lines: 0, specials: 0 }], passives: [{ id: 'wick_oil', level: 3 }] };

test('balance tools: every one is in the repo, reads nothing outside it, and its imports resolve', () => {
  const files = readdirSync(DIR);
  for (const f of ['runc1.mjs', 'resume.sh', 'pair.mjs', 'top.mjs', 'held.mjs', 'bench.mjs', 'formfixture.mjs', 'formfixture-ruler.mjs', 'setstable.mjs', 'sigsets.mjs', 'run-cw2.mjs', 'sigfixture.mjs']) assert.ok(files.includes(f), `tools/balance/${f}`);
  for (const f of files) {
    const s = readFileSync(join(DIR, f), 'utf8');
    assert.doesNotMatch(s, /\/mnt\/|\/home\/|outputs\/work/, `${f} points outside the repo`);
    if (!f.endsWith('.mjs')) continue;
    assert.equal(node(['--check', join(DIR, f)]).status, 0, `${f} parses`);
    for (const [, p] of s.matchAll(/import\(`\$\{R\}\/([^`]+)`\)/g)) assert.ok(existsSync(join(ROOT, p)), `${f} imports ${p}`);
    for (const [, p] of s.matchAll(/from '(\.\/[^']+)'/g)) assert.ok(existsSync(join(DIR, p)), `${f} imports ${p}`);
  }
});

test('balance tools: the benches load from the repo root (0 seeds), and the readers read rows', () => {
  const t = mkdtempSync(join(tmpdir(), 'lamplight-bal-'));
  try {
    for (const f of ['runc1.mjs', 'bench.mjs', 'sigsets.mjs', 'run-cw2.mjs']) {
      const r = node([`tools/balance/${f}`, '--seeds', '0', '--out', join(t, `${f}.jsonl`)]);
      assert.equal(r.status, 0, `${f}: ${r.stderr.slice(0, 300)}`);
    }
    const rows = join(t, 'rows.jsonl');
    writeFileSync(rows, `${JSON.stringify(ROW)}\n${JSON.stringify({ ...ROW, k: 1, end: 'died', cleared: false })}\n`);
    const top = node(['tools/balance/top.mjs', rows]);
    assert.equal(top.status, 0, top.stderr);
    assert.match(top.stdout, /2 runs, over 3x in 2/);
    assert.equal(node(['tools/balance/pair.mjs', rows, rows]).status, 0);
    assert.match(node(['tools/balance/held.mjs', rows]).stdout, /cleared n1/);
    assert.equal(node(['tools/balance/setstable.mjs', join(t, 'none.jsonl')]).status, 0);
    // sigfixture writes the two signature fixtures: into a scratch tree (the repo's src, its own tests/fixtures).
    const tree = join(t, 'tree');
    mkdirSync(join(tree, 'tests', 'fixtures'), { recursive: true });
    symlinkSync(join(ROOT, 'src'), join(tree, 'src'));
    const sets = join(t, 'sigsets.jsonl'), b = join(t, 'b.jsonl');
    writeFileSync(sets, `${JSON.stringify({ ch: 'lamplighter', set: 'AAA', real: 100 })}\n`);
    writeFileSync(b, '');
    const fx = node(['tools/balance/sigfixture.mjs', sets, b], { TREE: tree });
    assert.equal(fx.status, 0, fx.stderr.slice(0, 300));
    assert.equal(JSON.parse(readFileSync(join(tree, 'tests', 'fixtures', 'sig-sets.json'), 'utf8')).sets.lamplighter.AAA, 100);
  } finally { rmSync(t, { recursive: true, force: true }); }
});
