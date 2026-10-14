// The Electron main process's pure parts: path safety for app://, IPC sender checks, window
// geometry per display mode, and the title stamp. (main.cjs itself needs Electron; the smoke
// test covers it end to end.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const S = require('../desktop/shell.cjs');

test('app:// paths resolve inside the game folder (Linux paths)', () => {
  const root = '/opt/lamplight/resources/app.asar/game';
  assert.deepEqual(S.resolveGamePath(root, '/'), { file: `${root}/index.html` });
  assert.deepEqual(S.resolveGamePath(root, '/assets/index-abc.js'), { file: `${root}/assets/index-abc.js` });
  assert.deepEqual(S.resolveGamePath(root, '/assets/../index.html'), { file: `${root}/index.html` }, 'inner .. that stays inside is fine');
  for (const bad of ['/../secret', '/%2e%2e/secret', '/..%2fsecret', '/assets/../../x', '/%2E%2E/%2E%2E/etc/passwd']) {
    assert.equal(S.resolveGamePath(root, bad).status, 403, bad);
  }
  assert.equal(S.resolveGamePath(root, '/%E0%A4%A').status, 400, 'malformed escape');
  assert.equal(S.resolveGamePath(root, '/index.html%00.png').status, 400, 'null byte');
});

test('app:// paths resolve inside the game folder (Windows paths and backslashes)', () => {
  const root = 'C:\\Games\\Lamplight\\resources\\app.asar\\game';
  const w = path.win32;
  assert.deepEqual(S.resolveGamePath(root, '/index.html', w), { file: `${root}\\index.html` });
  assert.deepEqual(S.resolveGamePath(root, '/assets/atlas-0.png', w), { file: `${root}\\assets\\atlas-0.png` });
  // Backslashes, drive letters, NTFS streams, and device names never appear in the game's own
  // files, so they are refused before any path logic runs.
  const refused = {
    '/..\\..\\Windows\\win.ini': 400, '/%5c..%5c..%5cWindows': 400, '/..%5csecret': 400, '/..\\x': 400,
    '/C:/Windows/win.ini': 400, '/C%3A/Windows/win.ini': 400, '/index.html::$DATA': 400,
    '/CON': 400, '/assets/nul.png': 400, '/COM1.txt': 400, '/lpt9': 400,
    '/../secret': 403, '/assets/../../x': 403, '/%2e%2e/%2e%2e/Windows/win.ini': 403,
  };
  for (const [bad, status] of Object.entries(refused)) assert.deepEqual(S.resolveGamePath(root, bad, w), { status }, bad);
  assert.deepEqual(S.resolveGamePath(root, '/console.js', w), { file: `${root}\\console.js` }, 'only whole device names are refused');
});

test('only our own page may use the bridge', () => {
  assert.equal(S.isTrustedSender('app://lamplight/index.html'), true);
  assert.equal(S.isTrustedSender('app://lamplight/index.html?smoke=5'), true);
  for (const u of ['app://evil/index.html', 'https://lamplight/', 'file:///C:/x.html', 'data:text/html,hi', '', undefined, null]) {
    assert.equal(S.isTrustedSender(u), false, String(u));
  }
});

test('windowed mode picks the largest whole multiple of 640x360 that fits, centered', () => {
  const d1080 = { bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
  const g = S.windowGeometry('windowed', d1080);
  assert.equal(g.width, 1280); assert.equal(g.height, 720);
  assert.equal(g.useContentSize, true);
  assert.equal(g.frame, true);
  assert.equal(g.x, 320); assert.equal(g.y, 160);
  const d1440 = { bounds: { x: 1920, y: 0, width: 2560, height: 1440 }, workArea: { x: 1920, y: 0, width: 2560, height: 1400 } };
  const g2 = S.windowGeometry('windowed', d1440);
  assert.equal(g2.width, 1920); assert.equal(g2.x, 1920 + 320, 'second monitor offsets are kept');
  const tiny = { bounds: { x: 0, y: 0, width: 800, height: 600 }, workArea: { x: 0, y: 0, width: 800, height: 560 } };
  assert.equal(S.windowGeometry('windowed', tiny).width, 640, 'never below x1');
});

test('windowed mode counts real pixels under Windows display scaling', () => {
  // Electron reports displays in DIPs; scaleFactor turns them into real pixels.
  const cases = [
    // [scaleFactor, work area in DIPs, expected scale, expected content DIPs]
    [1.25, { width: 1536, height: 824 }, 2, [1024, 576]],    // 1920x1080 laptop at 125%
    [1.5, { width: 1707, height: 928 }, 3, [1280, 720]],     // 2560x1440 at 150%
    [1.75, { width: 2194, height: 1194 }, 5, [1829, 1029]],  // 3840x2160 at 175%
    [2, { width: 1920, height: 1040 }, 5, [1600, 900]],      // 3840x2160 at 200%
  ];
  for (const [sf, wa, k, [cw, ch]] of cases) {
    const d = { bounds: { x: 0, y: 0, width: wa.width, height: wa.height + 40 }, workArea: { x: 0, y: 0, ...wa }, scaleFactor: sf };
    const g = S.windowGeometry('windowed', d);
    assert.equal(g.scale, k, `scale at ${sf}`);
    assert.deepEqual([g.width, g.height], [cw, ch], `content size at ${sf}`);
    // Real pixels are never short of the multiple (a pixel short would drop a whole scale step).
    assert.ok(g.width * sf >= 640 * k && g.width * sf < 640 * k + sf, `real width at ${sf}`);
    assert.ok(g.height * sf >= 360 * k && g.height * sf < 360 * k + sf, `real height at ${sf}`);
    assert.ok(g.width <= wa.width && g.height <= wa.height, `fits at ${sf}`);
    assert.deepEqual([g.minWidth, g.minHeight], [Math.ceil(640 / sf), Math.ceil(360 / sf)], `1x minimum at ${sf}`);
  }
  const noSf = { bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
  assert.deepEqual([S.windowGeometry('windowed', noSf).width, S.windowGeometry('windowed', noSf).minWidth], [1280, 640], 'no scaleFactor means 1');
});

test('the shell ignores aborted loads and never restart-loops a broken build', () => {
  assert.equal(S.isRealLoadFailure(S.ERR_ABORTED, true), false, 'a load replaced by another is not a failure');
  assert.equal(S.isRealLoadFailure(-6, true), true, 'file not found is');
  assert.equal(S.isRealLoadFailure(-6, false), false, 'subframes are not the game');
  const t = 1_000_000;
  assert.equal(S.afterRendererGone({ reason: 'crashed', now: t }), 'reload', 'first crash: one automatic restart');
  assert.equal(S.afterRendererGone({ reason: 'crashed', lastAutoReloadAt: t, now: t + 5000 }), 'error', 'crashed again before booting: stop');
  assert.equal(S.afterRendererGone({ reason: 'crashed', lastAutoReloadAt: t, readySince: t + 3000, now: t + 30000 }), 'error', 'booted but crashed within a minute: stop');
  assert.equal(S.afterRendererGone({ reason: 'crashed', lastAutoReloadAt: t, readySince: t + 3000, now: t + 3000 + 60000 }), 'reload', 'healthy for a minute: restart again');
  assert.equal(S.afterRendererGone({ reason: 'oom', lastAutoReloadAt: null, now: t }), 'reload');
  assert.equal(S.afterRendererGone({ reason: 'clean-exit', now: t }), 'error');
});

test('display mode follows fullscreen changes made outside the settings screen', () => {
  assert.equal(S.modeAfterFullscreenChange('fullscreen', false), 'windowed', 'F11 out of fullscreen');
  assert.equal(S.modeAfterFullscreenChange('windowed', true), 'fullscreen', 'Alt+Enter into fullscreen');
  assert.equal(S.modeAfterFullscreenChange('fullscreen', true), 'fullscreen');
  assert.equal(S.modeAfterFullscreenChange('borderless', false), 'borderless', 'borderless is never flagged fullscreen');
  assert.equal(S.modeAfterFullscreenChange('nonsense', false), 'windowed');
});

test('borderless covers the whole display without a frame; fullscreen is a framed window gone fullscreen', () => {
  const d = { bounds: { x: 0, y: 0, width: 2560, height: 1440 }, workArea: { x: 0, y: 0, width: 2560, height: 1392 } };
  const b = S.windowGeometry('borderless', d);
  assert.deepEqual([b.frame, b.fullscreen, b.x, b.y, b.width, b.height], [false, false, 0, 0, 2560, 1440]);
  const f = S.windowGeometry('fullscreen', d);
  assert.equal(f.fullscreen, true);
  assert.equal(f.frame, true);
  assert.equal(S.windowGeometry('exclusive', d).mode, 'fullscreen', 'unknown modes fall back to fullscreen');
  assert.equal(S.needsNewWindow('fullscreen', 'borderless'), true);
  assert.equal(S.needsNewWindow('borderless', 'windowed'), true);
  assert.equal(S.needsNewWindow('fullscreen', 'windowed'), false);
  assert.deepEqual(S.DISPLAY_MODES, ['fullscreen', 'borderless', 'windowed']);
});

test('the window title carries the full build stamp', () => {
  assert.equal(S.titleFor('{"build":"0.1.0+20260927T200935Z","version":"0.1.0"}', '0.1.0'), 'Lamplight 0.1.0+20260927T200935Z');
  assert.equal(S.titleFor('not json', '0.1.0'), 'Lamplight 0.1.0');
  assert.equal(S.titleFor('', '0.1.0'), 'Lamplight 0.1.0');
});

test('IPC byte payloads are checked, with a plain error', () => {
  assert.deepEqual([...S.toBytes(new Uint8Array([1, 2, 3]))], [1, 2, 3]);
  assert.deepEqual([...S.toBytes(new Uint8Array([9, 1, 2, 3]).subarray(1))], [1, 2, 3], 'views keep their offset');
  assert.deepEqual([...S.toBytes(new Uint8Array([4, 5]).buffer)], [4, 5]);
  assert.throws(() => S.toBytes('abc'), /Replay data must be bytes/);
  assert.throws(() => S.toBytes(null, 'Report'), /Report must be bytes/);
});

test('content types cover what the game ships', () => {
  assert.equal(S.mimeFor('a.js'), 'text/javascript; charset=utf-8');
  assert.equal(S.mimeFor('x/y.WASM'), 'application/wasm');
  assert.equal(S.mimeFor('font.otf'), 'font/otf');
  assert.equal(S.mimeFor('atlas.webp'), 'image/webp');
  assert.equal(S.mimeFor('noext'), 'application/octet-stream');
});

test('the error page escapes whatever it shows', () => {
  const u = S.errorPageUrl('Oops <b>', 'code "5" & <script>alert(1)</script>');
  const html = decodeURIComponent(u.slice(u.indexOf(',') + 1));
  assert.ok(html.includes('Oops &lt;b&gt;'));
  assert.ok(!html.includes('<script>alert'));
});

test('closing the window while a save still fails asks the question the game\'s Quit asks, Stay by default', async () => {
  const { readFileSync } = await import('node:fs');
  const D = S.LEAVE_DIALOG;
  assert.deepEqual([D.buttons, D.defaultId, D.cancelId], [['Quit anyway', 'Stay'], 1, 1], 'Stay is the default, and what Escape picks');
  assert.deepEqual([S.leavesAnyway(0), S.leavesAnyway(1), S.leavesAnyway(-1)], [true, false, false]);
  // The game's own question (main.js askToLeave): its title, and what is lost, in the same words;
  // but no claim of a second try (a close can't wait for one; Quit makes it).
  const page = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.ok(page.includes(`title: '${D.message.replace(/'/g, "\\'")}'`), 'its title');
  const lost = 'Quitting now loses everything since the last successful save.';
  assert.ok(D.detail.endsWith(lost) && page.includes(lost), 'what is lost');
  assert.ok(!/again/.test(D.detail), 'no second try claimed');
  // The main process asks before the window closes while the page says a save fails, whatever
  // the page could do (a page holds a close only after a mouse or keyboard press); not when the
  // game's own Quit asked already, and once for one close.
  assert.equal(S.asksBeforeClosing({ unsaved: true, quitting: false, answered: false }), true);
  assert.equal(S.asksBeforeClosing({ unsaved: false, quitting: false, answered: false }), false, 'saved: it just closes');
  assert.equal(S.asksBeforeClosing({ unsaved: true, quitting: true, answered: false }), false, 'Quit asked already');
  assert.equal(S.asksBeforeClosing({ unsaved: true, quitting: false, answered: true }), false, 'answered: Quit anyway');
  assert.equal(S.asksBeforeClosing({ unsaved: 'yes', quitting: false, answered: false }), false, 'only a real true');
  // The wiring, on a stand-in window and dialog, closed as Electron closes one: its close event
  // first (held, or not), then the page's beforeunload (the page may hold the close; letting go
  // of that hold is what will-prevent-unload's preventDefault does), then it's gone.
  const { EventEmitter } = await import('node:events');
  const rig = (state, pageHolds) => {
    const win = new EventEmitter();
    win.webContents = new EventEmitter();
    win.destroyed = false;
    win.isDestroyed = () => win.destroyed;
    const held = () => ({ held: false, preventDefault() { this.held = true; } });
    win.close = () => {
      const e = held();
      win.emit('close', e);
      if (e.held) return;
      if (pageHolds) { const u = held(); win.webContents.emit('will-prevent-unload', u); if (!u.held) return; }
      win.destroyed = true;
    };
    const answers = [], asked = [], queued = [];
    const dialog = { showMessageBoxSync: (w, d) => { asked.push([w, d]); return answers.shift(); } };
    S.askBeforeClosing(win, dialog, () => state, (fn) => queued.push(fn));
    return { win, answers, asked, queued };
  };
  const saved = rig({ unsaved: false, quitting: false }, false);
  saved.win.close();
  assert.deepEqual([saved.win.destroyed, saved.asked.length], [true, 0], 'saved: it closes without a word');
  // A save failing, and the page holding the close too (it has had a press): asked once a close.
  const failing = rig({ unsaved: true, quitting: false }, true);
  failing.answers.push(1);
  failing.win.close();
  assert.deepEqual([failing.win.destroyed, failing.asked.length, failing.queued.length], [false, 1, 0], 'Stay: it stays');
  assert.deepEqual(failing.asked[0], [failing.win, S.LEAVE_DIALOG], 'asked over the window, in the game\'s words');
  failing.answers.push(0);
  failing.win.close();
  assert.deepEqual([failing.win.destroyed, failing.asked.length, failing.queued.length], [false, 2, 1], 'Quit anyway: closed again once this close is over');
  failing.queued[0]();
  assert.deepEqual([failing.win.destroyed, failing.asked.length], [true, 2], '...past the page\'s own hold, asking no more');
  // The page alone saying nothing (a pad-only player) doesn't matter: the window asks.
  const padOnly = rig({ unsaved: true, quitting: false }, false);
  padOnly.answers.push(1);
  padOnly.win.close();
  assert.deepEqual([padOnly.win.destroyed, padOnly.asked.length], [false, 1]);
  const quitting = rig({ unsaved: true, quitting: true }, false);
  quitting.win.close();
  assert.deepEqual([quitting.win.destroyed, quitting.asked.length], [true, 0], 'the game\'s Quit asked already');
  // The page holding a close the main process didn't know about (the news still on its way): asked there.
  const late = rig({ unsaved: false, quitting: false }, true);
  late.answers.push(1, 0);
  late.win.close();
  assert.deepEqual([late.win.destroyed, late.asked.length], [false, 1], 'Stay');
  late.win.close();
  assert.deepEqual([late.win.destroyed, late.asked.length], [true, 2], 'Quit anyway');
  const main = readFileSync(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
  const flat = main.replace(/\s+/g, '');
  for (const [piece, what] of [
    ['S.askBeforeClosing(next,dialog,()=>({unsaved,quitting}));', 'every window asks before it closes'],
    ["handle('app:quit',()=>{quitting=true;app.quit();});", 'the game\'s Quit asked already'],
    ["handle('app:unsaved',(on)=>{unsaved=on===true;});", 'the page says while a save fails'],
    ["handle('app:ready',()=>{readySince=Date.now();unsaved=false;});", 'a fresh page starts saved'],
  ]) assert.ok(flat.includes(piece), what);
  const preload = readFileSync(new URL('../desktop/preload.cjs', import.meta.url), 'utf8');
  assert.ok(preload.includes("setUnsaved: (on) => ipcRenderer.invoke('app:unsaved', on === true),"), 'the bridge carries it');
});
