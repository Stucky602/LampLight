// Kevin's deploy workflow, pinned. Each of these has broken a deploy on one of his projects before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripJsonc } from './helpers/jsscan.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const pkg = JSON.parse(read('package.json'));

test('workflow: the build runs the tests first, and the test glob is quoted (Node expands it, not the shell)', () => {
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.scripts.test, 'node --test "tests/**/*.test.js"');
  assert.match(pkg.scripts.build, /^npm test && vite build --mode web$/);
});

function walkTests(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walkTests(p));
    else if (name.endsWith('.test.js')) out.push(p);
  }
  return out;
}

test('workflow: every test file the glob reaches (subfolders included) is a real node:test file', () => {
  const files = walkTests(join(ROOT, 'tests'));
  assert.ok(files.length >= 8, `found ${files.length} test files`);
  for (const f of files) assert.match(readFileSync(f, 'utf8'), /from 'node:test'/, `${relative(ROOT, f)} uses node:test`);
});

test('workflow: runtime dependencies stay minimal; Electron and the tools are never installed by Cloudflare', () => {
  assert.deepEqual(Object.keys(pkg.dependencies).sort(), ['fflate', 'pixi.js']);
  assert.deepEqual(Object.keys(pkg.devDependencies).sort(), ['vite', 'wrangler']);
  const all = JSON.stringify(pkg);
  assert.equal(/electron/.test(all), false);
  assert.equal(/playwright|pngjs|maxrects/.test(all), false);
});

test('workflow: wrangler serves dist/ as static assets on workers.dev', () => {
  const cfg = JSON.parse(stripJsonc(read('wrangler.jsonc')));
  assert.equal(cfg.name, 'lamplight');
  assert.equal(cfg.workers_dev, true);
  assert.equal(cfg.assets.directory, './dist');
  assert.match(cfg.compatibility_date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(cfg.assets.not_found_handling, 'none', 'a missing asset is a 404, never index.html');
});

test('workflow: the JSONC reader handles the comment forms wrangler.jsonc may use', () => {
  const text = '{\n  // line comment\n  "a": "http://x", /* block */ "b": [1, 2,],\n  "c": "/* not a comment */", // trailing\n}';
  assert.deepEqual(JSON.parse(stripJsonc(text)), { a: 'http://x', b: [1, 2], c: '/* not a comment */' });
});

test('workflow: the page and version marker are never cached; hashed bundles are', () => {
  const h = read('public/_headers');
  for (const path of ['/', '/index.html', '/version.json']) {
    const block = h.split(/\n(?=\/)/).find((b) => b.split('\n')[0].trim() === path);
    assert.ok(block, `_headers has a block for ${path}`);
    assert.match(block, /Cache-Control: no-store/);
  }
  assert.match(h, /\/assets\/\*\n\s+Cache-Control: public, max-age=31536000, immutable/);
});

test('workflow: Node 22 or newer, said where an upload can\'t lose it; nothing the gate needs is a dotfile', () => {
  // GitHub's drag-and-drop upload can drop files whose names start with a dot, and it did:
  // 0.5.1's first deploy had no .node-version, so this test read a missing file and failed the
  // build (Cloudflare built on Node 24 otherwise fine). The floor lives in package.json's
  // engines; .node-version still pins Cloudflare to 22 when it arrives, and is optional here.
  assert.equal(pkg.engines?.node, '>=22');
  assert.ok(Number(process.versions.node.split('.')[0]) >= 22, `running on Node ${process.versions.node}`);
  if (existsSync(join(ROOT, '.node-version'))) assert.equal(read('.node-version').trim(), '22');
  // Every file a test reads with read() is an ordinary name, so no gate check hangs on a dotfile.
  const reads = [];
  for (const f of readdirSync(join(ROOT, 'tests')).filter((n) => n.endsWith('.test.js'))) {
    for (const m of readFileSync(join(ROOT, 'tests', f), 'utf8').matchAll(/\bread\('([^']+)'\)/g)) reads.push([f, m[1]]);
  }
  assert.ok(reads.length > 5, `${reads.length} reads found`);
  assert.deepEqual(reads.filter(([, path]) => path.split('/').some((part) => part.startsWith('.') && part !== '..') && path !== '.node-version'), [], 'no dotfile the gate needs');
});

test('workflow: desktop and tools keep their own package.json files', () => {
  assert.ok(existsSync(join(ROOT, 'desktop', 'package.json')));
  assert.ok(existsSync(join(ROOT, 'tools', 'package.json')));
  const desk = JSON.parse(read('desktop/package.json'));
  assert.equal(desk.main, 'main.cjs');
  assert.equal(desk.version, pkg.version, 'desktop version matches the game version');
});

test('workflow: the page loads PixiJS under a strict Content-Security-Policy', () => {
  const html = read('index.html');
  assert.match(html, /Content-Security-Policy/);
  assert.equal(/unsafe-eval/.test(html), false, 'no eval allowed');
  assert.match(read('src/main.js'), /import 'pixi\.js\/unsafe-eval'/);
});
