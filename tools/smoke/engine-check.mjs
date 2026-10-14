// Cross-engine determinism check (ARCHITECTURE §5.2): runs the gate's golden run (frozen data,
// fixed inputs) in whatever engine runs this file, and prints the state hash as JSON.
// tools/smoke runs it with the packaged Electron binary (ELECTRON_RUN_AS_NODE=1), so every
// smoke test also proves Electron's V8 plays runs back exactly like the Node that Claude
// replays bug reports in. Also: node tools/smoke/engine-check.mjs, or bun tools/smoke/engine-check.mjs.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { GOLDEN, frozenData, playGolden, hashWorld } = await import(join(ROOT, 'tests/helpers/golden.js'));
const hash = hashWorld(playGolden(frozenData()));
const engine = typeof globalThis.Bun !== 'undefined' ? `bun ${globalThis.Bun.version}` : `v8 ${process.versions.v8}`;
console.log(JSON.stringify({ ok: hash === GOLDEN.hash, hash, expected: GOLDEN.hash, engine }));
process.exit(hash === GOLDEN.hash ? 0 : 1);
