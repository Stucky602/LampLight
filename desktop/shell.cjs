// Pure helpers for the Electron main process (no Electron import), so the gate can test the
// security-critical and layout-critical parts directly.
'use strict';

const nodePath = require('path');

const SCHEME = 'app';
const HOST = 'lamplight';
const ORIGIN = `${SCHEME}://${HOST}/`;
const VIEW_W = 640;
const VIEW_H = 360;
const DISPLAY_MODES = ['fullscreen', 'borderless', 'windowed'];

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

function mimeFor(file, p = nodePath) {
  return MIME[p.extname(file).toLowerCase()] || 'application/octet-stream';
}

// Windows device names: a path component named CON or COM1.txt opens a device, not a file.
const WIN_DEVICE_RE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

/**
 * Resolve an app:// URL path to a file inside gameDir. Returns { file } or { status } (400 for a
 * malformed path, 403 for anything that escapes gameDir). `p` is the path module (tests pass
 * path.win32 to check Windows semantics).
 * The game's own files never use backslashes, colons (drive letters, NTFS streams), or Windows
 * device names, so those are refused outright instead of being reasoned about per platform.
 */
function resolveGamePath(gameDir, urlPath, p = nodePath) {
  let decoded;
  try { decoded = decodeURIComponent(urlPath || '/'); } catch { return { status: 400 }; }
  if (/[\0\\:]/.test(decoded)) return { status: 400 };
  if (decoded.split('/').some((part) => WIN_DEVICE_RE.test(part))) return { status: 400 };
  if (decoded === '/' || decoded === '') decoded = '/index.html';
  const root = p.resolve(gameDir);
  const full = p.resolve(root, '.' + (decoded.startsWith('/') ? decoded : `/${decoded}`));
  if (full !== root && !full.startsWith(root + p.sep)) return { status: 403 };
  return { file: full };
}

/** True if an IPC message came from our own game page (not some other frame or origin). */
function isTrustedSender(url) {
  return typeof url === 'string' && url.startsWith(ORIGIN);
}

function normalizeMode(mode) {
  return DISPLAY_MODES.includes(mode) ? mode : 'fullscreen';
}

/**
 * Window geometry for a display mode. Electron sizes windows in device-independent pixels
 * (DIPs); the display's scaleFactor (Windows display scaling: 1.25, 1.5, ...) turns them into
 * real pixels, and pixel-perfect scaling is about real pixels.
 * windowed: the content area is the largest whole multiple of 640x360 real pixels that fits the
 *   work area with room for the frame, centered. The DIP size is rounded up, so the real size is
 *   never a pixel short of the multiple (a pixel short would drop the game a whole scale step).
 * borderless: a frameless window covering the whole display (not flagged fullscreen).
 * fullscreen: a framed window that goes fullscreen once shown (its windowed size is used when
 *   the player leaves fullscreen).
 * minWidth/minHeight: the 1x size in DIPs (640x360 real pixels).
 */
function windowGeometry(mode, display) {
  const m = normalizeMode(mode);
  const b = display.bounds;
  const w = display.workArea;
  const sf = display.scaleFactor > 0 ? display.scaleFactor : 1;
  const minWidth = Math.ceil(VIEW_W / sf);
  const minHeight = Math.ceil(VIEW_H / sf);
  if (m === 'borderless') {
    return { mode: m, frame: false, fullscreen: false, useContentSize: false, x: b.x, y: b.y, width: b.width, height: b.height, resizable: false, scale: null, minWidth, minHeight };
  }
  // Room for the frame: about 16 x 48 DIPs on Windows 11 at any scaling.
  const k = Math.max(1, Math.min(Math.floor(((w.width - 16) * sf) / VIEW_W), Math.floor(((w.height - 48) * sf) / VIEW_H)));
  const width = Math.ceil((VIEW_W * k) / sf);
  const height = Math.ceil((VIEW_H * k) / sf);
  return {
    mode: m,
    frame: true,
    fullscreen: m === 'fullscreen',
    useContentSize: true,
    x: w.x + Math.max(0, Math.floor((w.width - width) / 2)),
    y: w.y + Math.max(0, Math.floor((w.height - height) / 2)),
    width,
    height,
    resizable: true,
    scale: k,
    minWidth,
    minHeight,
  };
}

/** Chromium's ERR_ABORTED: a load that was replaced by another one (a reload, a new URL). Not a failure. */
const ERR_ABORTED = -3;

/** Should a did-fail-load event show the error page? */
function isRealLoadFailure(code, isMainFrame) {
  return !!isMainFrame && code !== ERR_ABORTED;
}

/**
 * The renderer died: reload it, or show the error page? One automatic reload; after that, another
 * only once the page has reported a healthy boot and then run for `healthyMs`. A crash during
 * boot (before "ready") never reloads twice, so a broken build can't loop forever.
 */
function afterRendererGone({ reason, lastAutoReloadAt = null, readySince = null, now = Date.now(), healthyMs = 60000 }) {
  if (reason === 'clean-exit') return 'error';
  if (lastAutoReloadAt === null) return 'reload';
  if (readySince !== null && readySince >= lastAutoReloadAt && now - readySince >= healthyMs) return 'reload';
  return 'error';
}

/**
 * The display mode after the window entered or left fullscreen by itself (F11, Alt+Enter, the
 * OS). Borderless never changes this way.
 */
function modeAfterFullscreenChange(current, isFullScreen) {
  const m = normalizeMode(current);
  if (m === 'borderless') return m;
  return isFullScreen ? 'fullscreen' : 'windowed';
}

/** Does switching between these modes need a new window? (The frame can't change on a live window.) */
function needsNewWindow(from, to) {
  return (normalizeMode(from) === 'borderless') !== (normalizeMode(to) === 'borderless');
}

/** Window title with the full build stamp, read from game/version.json. */
function titleFor(versionJsonText, fallbackVersion) {
  try {
    const v = JSON.parse(versionJsonText);
    if (v && typeof v.build === 'string' && v.build) return `Lamplight ${v.build}`;
  } catch { /* fall through */ }
  return `Lamplight ${fallbackVersion}`;
}

/** Turn whatever IPC delivered into bytes, or throw a plain error. */
function toBytes(data, what = 'Replay data') {
  if (data instanceof Uint8Array) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  throw new Error(`${what} must be bytes.`);
}

/** A plain, self-contained error page (no scripts). */
function errorPageUrl(title, detail) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const html = `<!doctype html><meta charset="utf-8"><title>Lamplight</title>
<body style="margin:0;background:#07080d;color:#bcc6d4;font:16px/1.5 Consolas,monospace;display:grid;place-items:center;height:100vh">
<div style="max-width:640px;padding:24px;border:1px solid #262f42"><h1 style="font-size:18px;margin:0 0 12px;color:#f3b049">${esc(title)}</h1>
<p style="margin:0 0 12px">${esc(detail)}</p><p style="margin:0">Close this window and start Lamplight again. If it keeps happening, send Claude a screenshot of this screen.</p></div></body>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

/**
 * The question when the window is closed (its X, Alt+F4) while the page says a save still fails
 * (asksBeforeClosing, and app/flow.js beforeLeaving): the game's own Quit question (main.js
 * askToLeave), less its "saving again didn't work either" (a close can't wait for another try).
 * "Stay" is the default and what Escape picks.
 */
const LEAVE_DIALOG = Object.freeze({
  type: 'warning', buttons: ['Quit anyway', 'Stay'], defaultId: 1, cancelId: 1, noLink: true, title: 'Lamplight',
  message: 'Unsaved progress',
  detail: 'The last save failed. Quitting now loses everything since the last successful save.',
});

/** Whether the answer to LEAVE_DIALOG closes the window anyway. */
function leavesAnyway(choice) {
  return choice === 0;
}

/**
 * Whether closing the window (its X, Alt+F4) asks LEAVE_DIALOG first. The main process decides,
 * from what the page last said (`unsaved`: a save still fails, app/keeper.js), because a page can
 * hold a close only once it has had a mouse or keyboard press, and a pad press may not count. It
 * doesn't ask when the game's own Quit already did (`quitting`), or twice for one close (`answered`).
 */
function asksBeforeClosing({ unsaved, quitting, answered }) {
  return unsaved === true && !quitting && !answered;
}

/**
 * Ask LEAVE_DIALOG before `win` closes while `state()` says a save still fails ({ unsaved,
 * quitting }): in the window's own close event (asksBeforeClosing), and when the page holds a close
 * itself (app/flow.js beforeLeaving, Electron's will-prevent-unload), once for one close. On "Quit
 * anyway" the window is closed again once this close is over (`later`, not from inside its own
 * handler). `dialog` is Electron's (tests pass stand-ins for both).
 */
function askBeforeClosing(win, dialog, state, later = setImmediate) {
  let answered = false;
  const ask = () => leavesAnyway(dialog.showMessageBoxSync(win, LEAVE_DIALOG));
  win.on('close', (event) => {
    const { unsaved, quitting } = state();
    if (!asksBeforeClosing({ unsaved, quitting, answered })) return;
    event.preventDefault();
    if (ask()) { answered = true; later(() => { if (!win.isDestroyed()) win.close(); }); }
  });
  win.webContents.on('will-prevent-unload', (event) => {
    if (win.isDestroyed()) return;
    if (answered || state().quitting || ask()) event.preventDefault();
  });
}

module.exports = {
  SCHEME, HOST, ORIGIN, DISPLAY_MODES, MIME, ERR_ABORTED, mimeFor, resolveGamePath, isTrustedSender, normalizeMode,
  windowGeometry, needsNewWindow, titleFor, toBytes, errorPageUrl, isRealLoadFailure, afterRendererGone,
  modeAfterFullscreenChange, LEAVE_DIALOG, leavesAnyway, asksBeforeClosing, askBeforeClosing,
};
