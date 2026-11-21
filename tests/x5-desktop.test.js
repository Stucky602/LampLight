// The desktop shell's rules that had no test (the sweep, S4 D5, E1 to E4): desktop/main.cjs itself,
// loaded here against a stand-in for Electron, so these are what the file does, not what it reads
// like. One copy at a time, with nothing set up in a copy without the lock; the window's
// isolation; the smoke run's own save folder; the close question after a page goes away; what
// the page may be granted; blob names and trimming.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Module from 'node:module';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { wrap } from '../src/save/envelope.js';

const require = createRequire(import.meta.url);
const S = require('../desktop/shell.cjs');
const savefs = require('../desktop/savefs.cjs');
const MAIN = require.resolve('../desktop/main.cjs');
const REAL_USERDATA = join(tmpdir(), 'x5-the-real-save-folder-never-made');

/** desktop/main.cjs loaded against a stand-in Electron. `lock`: what requestSingleInstanceLock answers. */
function loadMain({ lock = true, args = [] } = {}) {
  const log = [];            // what happened, in order
  const paths = { userData: REAL_USERDATA };
  const E = { windows: [], handlers: new Map(), appOn: {}, ready: null, permission: null, quit: 0, protocolHandled: 0, sent: [] };
  class BrowserWindow extends EventEmitter {
    constructor(opts) {
      super();
      this.opts = opts; this.destroyed = false;
      log.push('window');
      E.windows.push(this);
      const win = this;
      this.webContents = Object.assign(new EventEmitter(), { id: E.windows.length, send: (ch, ...a) => E.sent.push([ch, ...a]), setWindowOpenHandler() {}, getURL: () => win.url });
    }
    loadURL(u) { this.url = u; log.push('load'); }
    show() {} focus() {} restore() {} isMinimized() { return false; } isFullScreen() { return false; } setFullScreen() {}
    isDestroyed() { return this.destroyed; }
    getBounds() { return { x: 0, y: 0, width: 1280, height: 720 }; }
    destroy() { this.destroyed = true; }
    /** The window's X: closes unless a 'close' listener holds it. */
    close() { const e = { held: false, preventDefault() { this.held = true; } }; this.emit('close', e); if (!e.held) this.destroyed = true; return !e.held; }
  }
  const display = { bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 }, scaleFactor: 1 };
  const electron = {
    app: {
      commandLine: { appendSwitch() {} },
      requestSingleInstanceLock() { log.push('lock'); return lock; },
      quit() { E.quit++; log.push('quit'); }, exit() { E.quit++; log.push('exit'); },
      on(ev, f) { (E.appOn[ev] ||= []).push(f); },
      whenReady() { log.push('whenReady'); return { then(f) { E.ready = f; } }; },
      getPath: (k) => paths[k], setPath(k, v) { paths[k] = v; log.push(`setPath:${k}`); },
      getVersion: () => '0.0.0',
    },
    BrowserWindow,
    protocol: { registerSchemesAsPrivileged() {}, handle() { E.protocolHandled++; log.push('protocol'); } },
    ipcMain: { handle(ch, f) { E.handlers.set(ch, f); } },
    shell: { openPath() {} }, Menu: { setApplicationMenu() {} },
    screen: { getPrimaryDisplay: () => display, getDisplayMatching: () => display },
    dialog: { showMessageBoxSync: () => { log.push('system dialog'); return 1; } },
    clipboard: { readText: () => '' },
    session: { defaultSession: { setPermissionRequestHandler(f) { E.permission = f; } } },
  };
  const realLoad = Module._load, realArgv = process.argv;
  Module._load = function (request, ...rest) { return request === 'electron' ? electron : realLoad.call(this, request, ...rest); };
  process.argv = ['electron', MAIN, ...args];
  delete require.cache[MAIN];
  try { require(MAIN); } finally { Module._load = realLoad; process.argv = realArgv; delete require.cache[MAIN]; }
  /** An IPC call from the game's own page in window `w`. */
  const call = (ch, w, ...a) => E.handlers.get(ch)({ senderFrame: { url: `${S.ORIGIN}index.html` }, sender: { id: w.webContents.id } }, ...a);
  return { E, log, paths, call };
}

test('desktop: a second copy takes no lock, so it sets nothing up: no window, no protocol, no IPC, no save read', () => {
  const { E, log } = loadMain({ lock: false });
  assert.deepEqual(log, ['lock', 'quit'], 'asks for the lock, quits, and nothing else');
  assert.equal(E.ready, null, 'nothing waits for the app to be ready');
  assert.equal(E.windows.length, 0);
  assert.equal(E.protocolHandled, 0);
  assert.equal(E.handlers.size, 0);
  assert.deepEqual(Object.keys(E.appOn), [], 'no second-instance or window-all-closed listener either');
});

test('desktop: the first copy takes the lock before any window is made, and a second launch focuses it', () => {
  const { E, log } = loadMain({ lock: true });
  assert.deepEqual(log, ['lock', 'whenReady']);
  assert.equal(E.windows.length, 0, 'no window before the app is ready');
  E.ready();
  assert.equal(E.windows.length, 1);
  assert.ok(log.indexOf('lock') < log.indexOf('window'));
  assert.ok(log.indexOf('protocol') < log.indexOf('window'), 'the game\'s scheme is served before the page loads');
  assert.equal(E.windows[0].url, `${S.ORIGIN}index.html`);
  let focused = 0;
  E.windows[0].focus = () => focused++;
  E.appOn['second-instance'][0]();
  assert.equal(focused, 1);
});

test('desktop: the game\'s window is isolated: contextIsolation on, nodeIntegration off, sandbox on, the narrow preload only', () => {
  const { E } = loadMain();
  E.ready();
  const wp = E.windows[0].opts.webPreferences;
  assert.equal(wp.contextIsolation, true);
  assert.equal(wp.nodeIntegration, false);
  assert.equal(wp.sandbox, true);
  assert.equal(wp.preload, resolve(MAIN, '..', 'preload.cjs'));
  for (const k of ['webSecurity', 'allowRunningInsecureContent', 'nodeIntegrationInWorker', 'nodeIntegrationInSubFrames', 'webviewTag', 'enableRemoteModule']) assert.equal(wp[k], undefined, `${k} is left at Electron's safe default`);
});

test('desktop: --smoke never uses the real save folder: the folder named, else a new temp folder; and it takes no lock', () => {
  const bare = loadMain({ args: ['--smoke'] });
  try {
    assert.notEqual(bare.paths.userData, REAL_USERDATA);
    assert.ok(bare.paths.userData.startsWith(join(tmpdir(), 'lamplight-smoke-')), bare.paths.userData);
    assert.ok(existsSync(bare.paths.userData));
    assert.ok(!bare.log.includes('lock'));
    assert.ok(bare.log.indexOf('setPath:userData') < bare.log.indexOf('whenReady'), 'before anything reads a save');
  } finally { rmSync(bare.paths.userData, { recursive: true, force: true }); }
  const named = loadMain({ args: ['--smoke=5', '--smoke-userdata=/somewhere/else'] });
  assert.equal(named.paths.userData, resolve('/somewhere/else'));
  // A normal launch leaves the folder alone.
  assert.equal(loadMain().paths.userData, REAL_USERDATA);
});

test('desktop: the window\'s X asks again after the page that had the question reloads, dies, or starts fresh', () => {
  for (const [how, gone] of [
    ['a reload', (w) => w.webContents.emit('did-start-loading')],
    ['the renderer dying', (w) => w.webContents.emit('render-process-gone', {}, { reason: 'clean-exit' })],
    ['a fresh page reporting in', (w, call) => call('app:ready', w)],
  ]) {
    const { E, call } = loadMain();
    E.ready();
    const w = E.windows[0];
    const asked = () => E.sent.filter((m) => m[0] === 'app:closeAsked').length;
    call('app:inRun', w, true);
    assert.equal(w.close(), false, 'mid-run: held');
    assert.equal(asked(), 1);
    call('app:closeAck', w);
    w.close();
    assert.equal(asked(), 1, 'one question at a time while the page has it');
    gone(w, call);
    call('app:inRun', w, true);   // the next run
    assert.equal(w.close(), false);
    assert.equal(asked(), 2, `${how}: the X asks again`);
    call('app:closeAck', w);
    call('app:closeAnswer', w, false);
    w.close();
    assert.equal(asked(), 3, 'and again after Stay');
  }
});

test('desktop: the page\'s close question: Stay lets the next close ask again; a dropped question is Stay; a late answer still counts', () => {
  const rig = (state = { unsaved: false, inRun: true, quitting: false }) => {
    const win = new EventEmitter();
    win.webContents = new EventEmitter();
    win.destroyed = false;
    win.isDestroyed = () => win.destroyed;
    win.close = () => { const e = { held: false, preventDefault() { this.held = true; } }; win.emit('close', e); if (!e.held) win.destroyed = true; };
    const sent = [], timers = [];
    let sys = 0;
    const q = S.createPageQuestion((k) => sent.push(k), { ackMs: 1500, timers: { setTimeout: (f) => { timers.push(f); return timers.length; }, clearTimeout: (h) => { timers[h - 1] = null; } } });
    S.askBeforeClosing(win, { showMessageBoxSync: () => { sys++; return 1; } }, () => state, (f) => f(), q);
    return { win, q, sent, timers, sys: () => sys };
  };
  // Stay, through the page, then the X again: asked again (not stuck waiting).
  const a = rig();
  a.win.close(); a.q.ack(); a.q.answer(false);
  assert.equal(a.q.waiting, false);
  a.win.close();
  assert.equal(a.sent.length, 2);
  a.q.ack(); a.q.answer(true);
  assert.equal(a.win.destroyed, true, 'Quit anyway closes it');
  // Dropped (the page went away): it ends as Stay, the window stays, and the next close asks.
  const b = rig();
  b.win.close(); b.q.ack();
  b.q.drop();
  assert.deepEqual([b.q.waiting, b.win.destroyed, b.sys()], [false, false, 0]);
  b.win.close();
  assert.equal(b.sent.length, 2);
  b.q.drop(); b.q.drop();   // dropping with nothing waiting does nothing
  // The page took too long to take it: the system's dialog asked (Stay). The page then shows its
  // question after all, and Quit anyway there still closes the window.
  const c = rig();
  c.win.close();
  c.timers[0]();
  assert.deepEqual([c.sys(), c.win.destroyed], [1, false]);
  c.q.ack();
  c.q.answer(true);
  assert.equal(c.win.destroyed, true);
  // ...and a late Stay changes nothing.
  const d = rig();
  d.win.close(); d.timers[0](); d.q.answer(false);
  assert.equal(d.win.destroyed, false);
  d.win.close();
  assert.equal(d.sent.length, 2);
});

test('desktop: the page is granted only what the game uses, and only the game\'s own page', () => {
  const page = `${S.ORIGIN}index.html`;
  assert.deepEqual([...S.PERMISSIONS].sort(), ['clipboard-sanitized-write', 'fullscreen']);
  for (const p of S.PERMISSIONS) {
    assert.equal(S.allowsPermission(p, page), true, p);
    assert.equal(S.allowsPermission(p, 'https://example.com/'), false, `${p} from elsewhere`);
    assert.equal(S.allowsPermission(p, ''), false);
  }
  for (const p of ['media', 'geolocation', 'notifications', 'midi', 'midiSysex', 'pointerLock', 'openExternal', 'clipboard-read', 'display-capture', 'hid', 'serial', 'usb', 'window-management', 'unknown', '', undefined]) {
    assert.equal(S.allowsPermission(p, page), false, String(p));
  }
  // main.cjs answers every request with it.
  const { E } = loadMain();
  E.ready();
  const ask = (permission, url) => { let got = null; E.permission({ getURL: () => url }, permission, (ok) => { got = ok; }, { requestingUrl: url }); return got; };
  assert.equal(ask('media', page), false);
  assert.equal(ask('clipboard-sanitized-write', page), true);
  assert.equal(ask('clipboard-sanitized-write', 'https://example.com/'), false);
});

test('desktop: blob names refuse Windows device names, and the 21st report never deletes a save code', () => {
  const dir = mkdtempSync(join(tmpdir(), 'x5-blob-'));
  try {
    for (const bad of ['aux', 'AUX', 'con.txt', 'nul.json', 'COM1', 'lpt9.lamprep', 'prn.', 'report.json.', '../x', 'a/b', 'a\\b', '']) {
      assert.throws(() => savefs.writeBlob(dir, 'reports', bad, 'x', 20), /Bad file name/, bad);
    }
    assert.equal(readdirSync(dir).length, 0, 'nothing written for a refused name');
    for (const fine of ['console.txt', 'auxiliary.json', 'com10.txt']) savefs.writeBlob(dir, 'other', fine, 'x', 20);
    // A save code and a tuning file exported first (the oldest names in the folder), then 25 reports.
    savefs.writeBlob(dir, 'reports', '20260101-000000-save-code.txt', 'LAMP1.x.y', 20);
    savefs.writeBlob(dir, 'reports', '20260101-000001-tuning.txt', 't', 20);
    for (let i = 0; i < 25; i++) savefs.writeBlob(dir, 'reports', `202609${String(i + 1).padStart(2, '0')}-101500-report.json`, '{}', 20);
    const names = readdirSync(join(dir, 'reports')).sort();
    assert.ok(names.includes('20260101-000000-save-code.txt'), 'the save code is still there');
    assert.ok(names.includes('20260101-000001-tuning.txt'));
    const reports = names.filter((n) => n.endsWith('-report.json'));
    assert.equal(reports.length, 20, 'reports are still kept to 20');
    assert.equal(reports[0], '20260906-101500-report.json', 'the oldest reports went');
    // Save codes are kept to 20 of their own.
    for (let i = 0; i < 22; i++) savefs.writeBlob(dir, 'reports', `202610${String(i + 1).padStart(2, '0')}-101500-save-code.txt`, 'c', 20);
    assert.equal(readdirSync(join(dir, 'reports')).filter((n) => n.endsWith('-save-code.txt')).length, 20);
    assert.equal(readdirSync(join(dir, 'reports')).filter((n) => n.endsWith('-report.json')).length, 20);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('desktop: settings read at startup are refused on a wrong checksum (a real envelope, one word changed)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'x5-settings-'));
  try {
    const text = wrap('settings', { v: 1, display: { mode: 'windowed', fillScreen: false } }, { build: 't' });
    writeFileSync(join(dir, 'settings.json'), text);
    assert.equal(savefs.readSettingsSync(dir).display.mode, 'windowed', 'the good file is read');
    const env = JSON.parse(text);
    env.data = env.data.replace('windowed', 'borderless');   // still JSON, still a mode, wrong checksum
    writeFileSync(join(dir, 'settings.json'), JSON.stringify(env));
    assert.equal(savefs.readSettingsSync(dir), null, 'a changed file falls back to the defaults');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
