// Desktop smoke test: launch the packaged Linux build (same code as the Windows .exe) under a
// virtual display with a throwaway save folder, let it play itself, and require a clean report:
// it booted, played a run (answering its menus), rendered, saved through the real preload bridge, reloaded the save, wrote a
// replay and a report, and the main process found those files on disk. Then the same Electron
// binary, run as Node, must reproduce the gate's golden run hash (engine-check.mjs).
//
//   node tools/smoke/smoke.mjs [--seconds 30]
// Requires: node tools/pack-desktop.mjs (or --linux-only) first.
// Exit code 0 = pass. The Windows .exe itself can't run here (no Windows, no Wine); Kevin's first
// launch is the Windows check.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = resolve(import.meta.dirname, '..', '..');
const APP = join(ROOT, 'tools', 'out', 'pack', 'Lamplight-linux-x64');
const i = process.argv.indexOf('--seconds');
const seconds = i > 0 ? Number(process.argv[i + 1]) : 30;
const outDir = join(ROOT, 'tools', 'out', 'smoke');
const report = join(outDir, 'smoke.json');

function need(cmd, why) {
  if (spawnSync('which', [cmd]).status !== 0) {
    console.error(`SMOKE CANNOT RUN: "${cmd}" is not installed in this workspace (${why}).`);
    process.exit(5);
  }
}
need('xvfb-run', 'it provides the virtual display');
if (!existsSync(join(APP, 'Lamplight'))) {
  console.error('SMOKE CANNOT RUN: no Linux build. Run: node tools/pack-desktop.mjs --linux-only');
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });
rmSync(report, { force: true });
const userData = mkdtempSync(join(tmpdir(), 'lamplight-smoke-'));

let code = 0;
let stderr = '';
try {
  execFileSync('xvfb-run', ['-a', '-s', '-screen 0 1920x1080x24', './Lamplight', '--no-sandbox',
    `--smoke=${seconds}`, `--smoke-out=${report}`, `--smoke-userdata=${userData}`], {
    cwd: APP,
    stdio: ['ignore', 'ignore', 'pipe'],
    timeout: (seconds + 120) * 1000,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, NODE_OPTIONS: '', ELECTRON_ENABLE_LOGGING: '0' },
  });
} catch (e) {
  code = typeof e.status === 'number' ? e.status : 3;
  stderr = String(e.stderr || '');
}

/** On failure: show the end of Electron's own log, and keep the save folder to look at. */
function failWith(message, exitCode) {
  console.error(`SMOKE FAIL: ${message}`);
  const tail = stderr.trim().split('\n').slice(-40).join('\n');
  if (tail) console.error(`--- last lines of the app's error output ---\n${tail}`);
  console.error(`Save folder kept for inspection: ${userData}`);
  process.exit(exitCode);
}

if (!existsSync(report)) failWith(`no report (exit ${code})`, code || 4);
const r = JSON.parse(readFileSync(report, 'utf8'));
const problems = [];
if (!r.ok) problems.push('reported not ok');
if (r.errors?.length) problems.push(`${r.errors.length} error(s): ${r.errors.map((e) => e.message).join(' | ')}`);
if (!(r.runTicks > 0)) problems.push('the run never ticked');
if (r.scene !== 'run') problems.push(`it ended on the ${r.scene} scene, not in a run`);
if (!(r.frames > 0)) problems.push('nothing rendered');
if (r.renderer !== 'webgl' && r.renderer !== 'webgpu') problems.push(`unexpected renderer ${r.renderer}`);
if (!r.storage?.ok) problems.push(`save round trip failed: ${JSON.stringify(r.storage)}`);
if (!r.files || !Object.values(r.files).every(Boolean)) problems.push(`files missing on disk: ${JSON.stringify(r.files)}`);
if (!/^Lamplight \d+\.\d+\.\d+\+\d{8}T\d{6}Z$/.test(r.title || '')) problems.push(`window title lacks the build stamp: ${r.title}`);
console.log(JSON.stringify(r, null, 2));
if (problems.length || code) failWith(problems.join('; ') || `exit ${code}`, code || 1);
rmSync(userData, { recursive: true, force: true });

// Same engine, headless: the golden run must hash exactly as it does in Node (replays are
// recorded in Electron and played back by Claude in Node).
const engine = spawnSync(join(APP, 'Lamplight'), [join(ROOT, 'tools', 'smoke', 'engine-check.mjs')], {
  encoding: 'utf8', timeout: 120000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '' },
});
let eng = null;
try { eng = JSON.parse(engine.stdout.trim().split('\n').pop()); } catch { /* reported below */ }
if (!eng || !eng.ok) {
  console.error(`SMOKE FAIL: Electron's engine plays the golden run differently: ${engine.stdout || ''}${engine.stderr || ''}`);
  process.exit(6);
}
console.log(`SMOKE PASS (Electron ${r.electron}, ${r.runTicks} run ticks, ${r.menuPresses} menu answers, ${r.frames} frames, saves verified on disk, software GPU; golden run hash ${eng.hash} in ${eng.engine}, same as Node)`);
