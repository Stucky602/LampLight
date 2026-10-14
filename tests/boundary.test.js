// Enforces ARCHITECTURE.md §4: the import rules that keep the simulation pure.
// sim/, meta/, data/, and lib/ must run in Node with no screen, so the tests, bots, and replays
// can use them. And sim/meta must be deterministic across JavaScript engines.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanJs, importsOf } from './helpers/jsscan.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');

function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(m?js)$/.test(name)) out.push(p);
  }
  return out;
}

// Which src/ folders each layer may import from, and which npm packages.
export const LAYERS = {
  data: { may: ['data'], packages: [] },
  lib: { may: ['lib'], packages: [] },
  sim: { may: ['sim', 'data', 'lib'], packages: [] },
  meta: { may: ['meta', 'data', 'lib'], packages: [] },
  // The harbor you walk around (Phase 5): pure like the sim, and it borrows the sim's tile collision.
  hub: { may: ['hub', 'sim', 'data', 'lib'], packages: [] },
  input: { may: ['input', 'lib'], packages: [] },
  save: { may: ['save', 'lib', 'data'], packages: ['fflate'] },
  // The view reads the meta layer's derived state (a building's stage at its level) as it reads the sim's.
  render: { may: ['render', 'sim', 'hub', 'meta', 'data', 'lib'], packages: ['pixi.js'] },
  audio: { may: ['audio', 'data', 'lib'], packages: [] },
  ui: { may: ['ui', 'input', 'data', 'lib', 'meta'], packages: [] },
  // app/ and src/main.js wire everything together and may import anything.
};
const PURE = ['sim', 'meta', 'hub', 'data', 'lib'];
const FORBIDDEN_GLOBALS = [
  [/\bMath\.random\b/, 'Math.random (use lib/rng.js)'],
  [/\bDate\b/, 'Date (the sim has no clock; pass time in)'],
  [/\bperformance\s*\.\s*now\b/, 'performance.now'],
  [/\bMath\.(sin|cos|tan|asin|acos|atan|atan2|exp|expm1|pow|log|log2|log10|log1p|hypot|cbrt|sinh|cosh|tanh)\b/, 'engine math that can differ between JavaScript engines (use lib/fmath.js)'],
  [/\b(window|document|navigator|localStorage|indexedDB|requestAnimationFrame|setTimeout|setInterval|fetch)\b/, 'browser or timer globals'],
  [/\*\*/, 'the ** operator (Math.pow by another name: multiply, or use lib/fmath.js)'],
];

function checkImports(layer, file, spec, rules) {
  if (!spec.startsWith('.')) {
    const pkg = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
    return rules.packages.includes(pkg) ? null : `imports package "${spec}"`;
  }
  const target = relative(SRC, resolve(dirname(file), spec)).split(/[\\/]/)[0];
  return rules.may.includes(target) ? null : `imports ${spec} (${layer}/ may import only ${rules.may.join(', ')})`;
}

test('boundary: every layer imports only what ARCHITECTURE §4 allows', () => {
  const problems = [];
  for (const [layer, rules] of Object.entries(LAYERS)) {
    for (const file of walk(join(SRC, layer))) {
      const { importText } = scanJs(readFileSync(file, 'utf8'));
      for (const spec of importsOf(importText)) {
        const why = checkImports(layer, file, spec, rules);
        if (why) problems.push(`${relative(ROOT, file)} ${why}`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

test('boundary: sim, meta, data, and lib use no clocks, engine-variable math, or browser globals', () => {
  const problems = [];
  for (const layer of PURE) {
    for (const file of walk(join(SRC, layer))) {
      const { codeOnly } = scanJs(readFileSync(file, 'utf8'));
      for (const [re, why] of FORBIDDEN_GLOBALS) {
        const m = codeOnly.match(re);
        if (m) problems.push(`${relative(ROOT, file)}: ${m[0]} -> ${why}`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

test('boundary: the checks actually look at files (a renamed folder cannot make them pass by checking nothing)', () => {
  for (const layer of Object.keys(LAYERS)) {
    const dir = join(SRC, layer);
    if (existsSync(dir)) assert.ok(walk(dir).length > 0, `src/${layer}/ exists but no .js files were found`);
  }
  for (const layer of ['lib', 'input', 'save', 'render', 'ui']) assert.ok(existsSync(join(SRC, layer)), `src/${layer}/ should exist by Phase 1`);
});

test('boundary: the scanner separates code from comments, strings, templates, and regexes', () => {
  const src = [
    "import { Sprite } from 'pixi.js';",
    "export function fatan(x) {",
    "  // adapted from 'Cephes' via \"netlib\"",
    "  return x; }",
    "export const NOTE = 1; // values taken from \"Vampire Survivors\"",
    "const desc = `A boarded window in the fog. ${window.innerWidth}`;",
    "const re = /['\"]window/g;",
    "const s = 'Math.random in a string is fine';",
    "/* Date.now() in a block comment */",
    "const r = Math.random() + Math.sin(1);",
    "export { a } from './a.js';",
    "const lazy = import('./lazy.js');",
    "/*",
    "import { Graphics } from 'pixi.js';",
    "*/",
    "const gen = `",
    "import x from './generated.js';",
    "`;",
    "if (ok) /window/.test(s);",
  ].join('\n');
  const { importText, codeOnly } = scanJs(src);
  assert.deepEqual(importsOf(importText), ['pixi.js', './a.js', './lazy.js'], 'imports in comments or template text never count');
  assert.equal((codeOnly.match(/\bwindow\b/g) || []).length, 1, 'only the ${} expression is code, not the template text or the regexes');
  assert.ok(FORBIDDEN_GLOBALS[0][0].test(codeOnly), 'real Math.random is caught');
  assert.ok(FORBIDDEN_GLOBALS[3][0].test(codeOnly), 'real Math.sin is caught');
  const pow = FORBIDDEN_GLOBALS[5][0];
  assert.ok(pow.test(scanJs('const d = (x - y) ** 2;').codeOnly) && pow.test(scanJs('v **= 0.5;').codeOnly), 'the ** operator is caught');
  assert.equal(pow.test(scanJs('/** A doc comment. */\nconst s = "a ** b";').codeOnly), false, 'but not in a doc comment or a string');
  assert.equal(/\bDate\b/.test(codeOnly), false, 'Date in a block comment is ignored');
  assert.equal(codeOnly.length, src.length, 'positions preserved');
  const div = scanJs('const a = b / c / d; const e = "x"; const f = (g + h) / 2 / k;').codeOnly;
  assert.ok(div.includes('b / c / d'), 'division is not mistaken for a regex');
  assert.ok(div.includes('(g + h) / 2 / k'), 'division after a closing paren stays division');
  // Accepted limit, pinned so a change can't widen it silently: a regex that starts a statement
  // after an automatic-semicolon line break reads as division, so its body counts as code. The
  // cost is a false alarm (a word like `window` inside such a regex), never a missed import.
  const asi = scanJs('const n = list[0]\n/window/.test(x)').codeOnly;
  assert.ok(asi.includes('/window/'), 'known: statement-start regex after ASI is read as division');
});

test('boundary: the import rules reject what they should', () => {
  const f = join(SRC, 'sim', 'x.js');
  assert.match(checkImports('sim', f, 'pixi.js', LAYERS.sim), /package/);
  assert.match(checkImports('sim', f, '../render/renderer.js', LAYERS.sim), /may import only/);
  assert.equal(checkImports('sim', f, '../lib/rng.js', LAYERS.sim), null);
  assert.equal(checkImports('data', join(SRC, 'data', 'index.js'), './weapons.js', LAYERS.data), null, 'data/index.js may gather data files');
  assert.match(checkImports('ui', join(SRC, 'ui', 'x.js'), '../sim/world.js', LAYERS.ui), /may import only/);
  assert.match(checkImports('render', join(SRC, 'render', 'x.js'), '../ui/overlay.js', LAYERS.render), /may import only/);
  assert.equal(checkImports('render', join(SRC, 'render', 'x.js'), 'pixi.js', LAYERS.render), null);
});
