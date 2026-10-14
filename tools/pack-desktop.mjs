// Build and package the desktop game in Claude's workspace (never on GitHub Actions).
//
//   node tools/pack-desktop.mjs                  Windows x64 zip + Linux x64 build for the smoke test
//   node tools/pack-desktop.mjs --linux-only     just the Linux build (for tools/smoke)
//   node tools/pack-desktop.mjs --no-zip         package both, skip the Windows zip
//   node tools/pack-desktop.mjs --split-mb 95    also cut the Windows zip into 95 MB parts, if a
//                                                file-size limit ever blocks the delivery (the
//                                                parts are a standard split zip; Kevin rejoins
//                                                them with the free 7-Zip)
//
// Output: tools/out/Lamplight-win-x64-v<version>.zip  (what Kevin downloads)
//         tools/out/pack/Lamplight-linux-x64/          (what tools/smoke runs)
import { packager } from '@electron/packager';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, 'tools', 'out');
const STAGE = join(OUT, 'desktop-stage');
const ELECTRON_VERSION = '44.4.5';
const argv = process.argv.slice(2);
const args = new Set(argv);
const splitIdx = argv.indexOf('--split-mb');
const splitMb = splitIdx >= 0 ? Number(argv[splitIdx + 1]) : 0;

for (const [cmd, why] of [['zip', 'it builds the Windows download'], ['unzip', 'it checks the Windows download']]) {
  if (args.has('--linux-only') && cmd !== 'zip') continue;
  if (spawnSync('which', [cmd]).status !== 0) {
    console.error(`PACK CANNOT RUN: "${cmd}" is not installed in this workspace (${why}).`);
    process.exit(5);
  }
}

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const deskPkg = JSON.parse(readFileSync(join(ROOT, 'desktop', 'package.json'), 'utf8'));
if (deskPkg.version !== pkg.version) throw new Error(`desktop/package.json version ${deskPkg.version} != game ${pkg.version}`);

const run = (cmd, cmdArgs, cwd = ROOT) => execFileSync(cmd, cmdArgs, { cwd, stdio: 'inherit' });

console.log(`Lamplight ${pkg.version}: building the desktop bundle`);
run('npx', ['vite', 'build', '--mode', 'desktop']);

rmSync(STAGE, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });
// Every .cjs file in desktop/ ships (so a new helper can't be forgotten), plus package.json.
const deskFiles = readdirSync(join(ROOT, 'desktop')).filter((f) => f.endsWith('.cjs') || f === 'package.json');
for (const f of deskFiles) cpSync(join(ROOT, 'desktop', f), join(STAGE, f));
for (const must of ['main.cjs', 'preload.cjs', 'savefs.cjs', 'shell.cjs', 'package.json']) {
  if (!deskFiles.includes(must)) throw new Error(`desktop/${must} is missing`);
}
cpSync(join(ROOT, 'dist-desktop'), join(STAGE, 'game'), { recursive: true });

run('node', [join(ROOT, 'tools', 'icon', 'make-ico.mjs'), join(OUT, 'icon', 'lamplight.ico')]);

const common = {
  dir: STAGE,
  out: join(OUT, 'pack'),
  name: 'Lamplight',
  executableName: 'Lamplight',
  appVersion: pkg.version,
  buildVersion: pkg.version,
  electronVersion: ELECTRON_VERSION,
  asar: true,
  overwrite: true,
  prune: false,
  appCopyright: 'Kevin',
};

const targets = [{ platform: 'linux', arch: 'x64' }];
if (!args.has('--linux-only')) targets.unshift({ platform: 'win32', arch: 'x64' });
for (const t of targets) {
  const opts = { ...common, ...t };
  if (t.platform === 'win32') {
    opts.icon = join(OUT, 'icon', 'lamplight.ico');
    opts.win32metadata = { CompanyName: 'Kevin', FileDescription: 'Lamplight', ProductName: 'Lamplight', InternalName: 'Lamplight', OriginalFilename: 'Lamplight.exe' };
  }
  const paths = await packager(opts);
  console.log(`packaged ${t.platform}-${t.arch}:`, paths.join(', '));
}

if (!args.has('--no-zip') && !args.has('--linux-only')) {
  const folder = join(OUT, 'pack', 'Lamplight-win32-x64');
  const zip = join(OUT, `Lamplight-win-x64-v${pkg.version}.zip`);
  rmSync(zip, { force: true });
  writeFileSync(join(folder, 'READ ME FIRST.txt'), [
    `Lamplight ${pkg.version}`,
    '',
    '1. Unzip this folder anywhere (Desktop is fine).',
    '2. Double-click Lamplight.exe.',
    '3. The first time, Windows may say "Windows protected your PC". Click "More info", then "Run anyway".',
    '   (The game is not code-signed yet; that is the only reason for the warning.)',
    '',
    'Controls: left stick or WASD to move. F11 or Alt+Enter toggles fullscreen. F3 shows the debug overlay.',
    'Saves live in %APPDATA%\\Lamplight (the game keeps 5 backups).',
    '',
  ].join('\r\n'));
  run('zip', ['-qr9', zip, 'Lamplight-win32-x64'], join(OUT, 'pack'));
  // Check the download actually contains what Kevin needs.
  const listing = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).split('\n');
  for (const must of ['Lamplight-win32-x64/Lamplight.exe', 'Lamplight-win32-x64/resources/app.asar', 'Lamplight-win32-x64/READ ME FIRST.txt', 'Lamplight-win32-x64/ffmpeg.dll']) {
    if (!listing.includes(must)) throw new Error(`the Windows zip is missing ${must}`);
  }
  const mb = statSync(zip).size / 1048576;
  console.log(`windows zip: ${zip} (${mb.toFixed(1)} MB, contents checked)`);
  if (splitMb > 0) {
    const parts = join(OUT, `Lamplight-win-x64-v${pkg.version}-split.zip`);
    rmSync(parts, { force: true });
    run('zip', ['-q', '-s', `${splitMb}m`, zip, '--out', parts], OUT);
    console.log(`split into ${splitMb} MB parts: ${readdirSync(OUT).filter((f) => f.startsWith(`Lamplight-win-x64-v${pkg.version}-split`)).join(', ')}`);
  }
}
if (!existsSync(join(OUT, 'pack', 'Lamplight-linux-x64', 'Lamplight'))) throw new Error('linux build missing');
