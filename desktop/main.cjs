// Lamplight desktop shell (Electron main process).
//
// - Serves the game from a custom app:// scheme (not file://), so ES modules and fetch behave as
//   they do on the web.
// - Owns the save files; the page talks to it only through the narrow bridge in preload.cjs, and
//   every IPC call is checked to come from the game page itself.
// - Display modes (settings): fullscreen (default; Chromium's fullscreen is borderless, there is
//   no exclusive mode), borderless window (frameless, covers the display, not flagged
//   fullscreen), windowed (a whole multiple of 640x360). Switching to or from borderless opens a
//   new window, which reloads the page: the settings screen only offers it at the title or hub.
// - --smoke[=seconds] runs the scripted smoke test and exits (see tools/smoke). With
//   --smoke-userdata=<dir> it uses a throwaway save folder.
'use strict';

const { app, BrowserWindow, protocol, ipcMain, shell, Menu, screen, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const savefs = require('./savefs.cjs');
const S = require('./shell.cjs');

const GAME_DIR = path.join(__dirname, 'game');   // the desktop Vite build is copied here
const argv = process.argv.slice(1);
const argValue = (name) => { const a = argv.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : null; };
const smokeArg = argv.find((a) => a === '--smoke' || a.startsWith('--smoke='));
const SMOKE = smokeArg ? Number(smokeArg.split('=')[1]) || 30 : 0;
const SMOKE_OUT = argValue('smoke-out');
const SMOKE_USERDATA = argValue('smoke-userdata');

// Must happen before the app is ready.
protocol.registerSchemesAsPrivileged([
  { scheme: S.SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } },
]);

if (SMOKE) {
  // The smoke test runs in a headless container: software WebGL, a throwaway save folder.
  app.commandLine.appendSwitch('use-gl', 'angle');
  app.commandLine.appendSwitch('use-angle', 'swiftshader');
  app.commandLine.appendSwitch('enable-unsafe-swiftshader');
  app.commandLine.appendSwitch('ignore-gpu-blocklist');
  if (SMOKE_USERDATA) app.setPath('userData', path.resolve(SMOKE_USERDATA));
}
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// One copy at a time; a second launch focuses the first.
if (!SMOKE && !app.requestSingleInstanceLock()) {
  app.quit();
}

let win = null;
let currentMode = 'fullscreen';
let lastAutoReloadAt = null;   // when the game was last reloaded automatically after a crash
let readySince = null;         // when the page last reported a healthy boot
let unsaved = false;           // the page says a save still fails (app/keeper.js), until one works
let quitting = false;          // the game's own Quit, which already asked if it had to
const userDir = () => app.getPath('userData');

function buildTitle() {
  let text = '';
  try { text = fs.readFileSync(path.join(GAME_DIR, 'version.json'), 'utf8'); } catch { /* fallback */ }
  return S.titleFor(text, app.getVersion());
}

async function serveGame(request) {
  const url = new URL(request.url);
  if (url.host !== S.HOST) return new Response('not found', { status: 404 });
  const r = S.resolveGamePath(GAME_DIR, url.pathname);
  if (!r.file) return new Response(r.status === 400 ? 'bad request' : 'forbidden', { status: r.status });
  try {
    const data = await fs.promises.readFile(r.file);
    return new Response(data, { status: 200, headers: { 'content-type': S.mimeFor(r.file), 'cache-control': 'no-store' } });
  } catch {
    return new Response('not found', { status: 404 });
  }
}

function smokeExit(code, info) {
  const out = SMOKE_OUT || path.join(userDir(), 'smoke.json');
  try { fs.writeFileSync(out, JSON.stringify({ ok: false, ...info }, null, 2)); } catch { /* exit code still reports */ }
  app.exit(code);
}

function createWindow(mode) {
  currentMode = S.normalizeMode(mode);
  const display = win ? screen.getDisplayMatching(win.getBounds()) : screen.getPrimaryDisplay();
  const g = S.windowGeometry(SMOKE ? 'windowed' : currentMode, display);
  const next = new BrowserWindow({
    title: buildTitle(),
    x: g.x, y: g.y, width: g.width, height: g.height,
    useContentSize: g.useContentSize,
    frame: g.frame,
    resizable: g.resizable,
    fullscreen: g.fullscreen,
    minWidth: g.minWidth,
    minHeight: g.minHeight,
    backgroundColor: '#07080d',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      spellcheck: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  next.on('page-title-updated', (e) => e.preventDefault()); // keep the build stamp in the title
  next.once('ready-to-show', () => next.show());

  // F11 and Alt+Enter toggle fullscreen (in the framed modes).
  next.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if ((input.key === 'F11' || (input.key === 'Enter' && input.alt)) && currentMode !== 'borderless') {
      next.setFullScreen(!next.isFullScreen());
      event.preventDefault();
    }
  });
  // However fullscreen changed (F11, Alt+Enter, the OS), the mode follows it and the page is told,
  // so settings show the truth and the next launch opens the same way.
  const onFullscreen = () => {
    if (next.isDestroyed() || win !== next) return;
    const m = S.modeAfterFullscreenChange(currentMode, next.isFullScreen());
    if (m === currentMode) return;
    currentMode = m;
    next.webContents.send('app:displayModeChanged', m);
  };
  next.on('enter-full-screen', onFullscreen);
  next.on('leave-full-screen', onFullscreen);
  // Closing the window (its X, Alt+F4) while a save still fails asks the question the game's Quit
  // asks, from here (a page can hold a close only after a mouse or keyboard press); the page's own
  // hold (app/flow.js beforeLeaving) is answered the same way, once.
  S.askBeforeClosing(next, dialog, () => ({ unsaved, quitting }));
  // Links never open inside or outside the game window; the page never navigates away.
  next.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  next.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(S.ORIGIN)) e.preventDefault(); });

  // A page that fails to load, or a renderer that dies, must never leave an invisible process.
  // (A window being replaced by a new one is neither: those events are ignored.)
  next.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (next.isDestroyed() || win !== next || !S.isRealLoadFailure(code, isMainFrame)) return;
    if (SMOKE) { smokeExit(3, { stage: 'load', error: `${code} ${desc} ${url}` }); return; }
    next.loadURL(S.errorPageUrl('Lamplight could not load its files.', `${desc} (${code})`));
    next.show();
  });
  next.webContents.on('render-process-gone', (_e, details) => {
    if (next.isDestroyed() || win !== next) return;
    if (SMOKE) { smokeExit(4, { stage: 'renderer', error: details.reason }); return; }
    if (S.afterRendererGone({ reason: details.reason, lastAutoReloadAt, readySince, now: Date.now() }) === 'reload') {
      lastAutoReloadAt = Date.now();
      readySince = null;
      next.loadURL(`${S.ORIGIN}index.html`);
      return;
    }
    next.loadURL(S.errorPageUrl('Lamplight stopped unexpectedly.', `The game process ended (${details.reason}).`));
    next.show();
  });

  const query = SMOKE ? `?smoke=${SMOKE}` : '';
  next.loadURL(`${S.ORIGIN}index.html${query}`);
  const old = win;
  win = next;
  next.on('closed', () => { if (win === next) win = null; });
  if (old) old.destroy();
}

/** Register an IPC handler that only answers our own game page. */
function handle(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    const url = event.senderFrame ? event.senderFrame.url : '';
    if (!S.isTrustedSender(url)) throw new Error('Refused: this request did not come from the game.');
    return fn(...args);
  });
}

function registerIpc() {
  const dir = () => userDir();
  handle('save:read', (kind) => savefs.readCandidates(dir(), kind));
  handle('save:write', (kind, text, opts) => { savefs.writeSave(dir(), kind, text, { rotate: !!(opts && opts.rotate) }); });
  handle('save:quarantine', (kind) => savefs.quarantine(dir(), kind));
  handle('replay:write', (name, bytes) => savefs.writeBlob(dir(), 'replays', name, S.toBytes(bytes, 'Replay data'), 3));
  handle('report:write', (name, text) => savefs.writeBlob(dir(), 'reports', name, String(text), 20));
  handle('app:openSaves', () => shell.openPath(dir()));
  handle('app:fullscreen', (on) => {
    if (!win || currentMode === 'borderless') return false;
    win.setFullScreen(on === undefined ? !win.isFullScreen() : !!on);
    return win.isFullScreen();
  });
  handle('app:displayMode', (mode) => {
    const m = S.normalizeMode(mode);
    if (!win) return m;
    if (S.needsNewWindow(currentMode, m)) { createWindow(m); return m; }
    currentMode = m;
    const g = S.windowGeometry(m, screen.getDisplayMatching(win.getBounds()));
    win.setFullScreen(g.fullscreen);
    if (!g.fullscreen) win.setContentBounds({ x: g.x, y: g.y, width: g.width, height: g.height });
    return m;
  });
  handle('app:quit', () => { quitting = true; app.quit(); });
  handle('app:ready', () => { readySince = Date.now(); unsaved = false; });   // a fresh page, a fresh keeper
  handle('app:unsaved', (on) => { unsaved = on === true; });
  handle('app:info', () => ({ version: app.getVersion(), title: buildTitle(), electron: process.versions.electron, chrome: process.versions.chrome, userData: dir(), displayMode: currentMode }));
  handle('smoke:done', (result) => {
    if (!SMOKE) return;
    // Check on disk that the bridge really wrote what the page says it wrote.
    const d = dir();
    const exists = (p) => fs.existsSync(path.join(d, p));
    const files = {
      profile: exists('profile.json'),
      profileBackup: exists('profile.bak1.json'),
      settings: exists('settings.json'),
      replay: fs.existsSync(path.join(d, 'replays')) && fs.readdirSync(path.join(d, 'replays')).length > 0,
      report: fs.existsSync(path.join(d, 'reports')) && fs.readdirSync(path.join(d, 'reports')).length > 0,
    };
    const filesOk = Object.values(files).every(Boolean);
    const out = SMOKE_OUT || path.join(d, 'smoke.json');
    const final = { ...result, ok: !!(result && result.ok) && filesOk, files, electron: process.versions.electron, title: buildTitle() };
    try { fs.writeFileSync(out, JSON.stringify(final, null, 2)); } catch { /* exit code still reports */ }
    setTimeout(() => app.exit(final.ok ? 0 : 1), 100);
  });
}

app.on('second-instance', () => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  protocol.handle(S.SCHEME, serveGame);
  registerIpc();
  const settings = savefs.readSettingsSync(userDir());
  createWindow(settings && settings.display ? settings.display.mode : 'fullscreen');
  if (SMOKE) {
    // Hard stop if the page never reports (a boot hang is a failure, not a wait-forever).
    setTimeout(() => smokeExit(2, { stage: 'timeout' }), (SMOKE + 90) * 1000);
  }
});

app.on('window-all-closed', () => app.quit());
