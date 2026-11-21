// Which build is this, and where do saves go?

import { createStore } from '../save/store.js';
import { createKvBackend, createDesktopBackend, indexedDbKv, localStorageKv, memoryKv } from '../save/backends.js';

/* global __TARGET__, __BUILD_ID__, __VERSION__ */
export const TARGET = typeof __TARGET__ !== 'undefined' ? __TARGET__ : 'web';
export const BUILD_ID = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev';
export const VERSION = typeof __VERSION__ !== 'undefined' ? __VERSION__ : '0.0.0';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The build stamp as the title shows it (0.7.3): "Build 0.7.3, Oct 20, 14:30" from a build id
 * like "0.7.3+20261020T143000Z" (vite.config.js: the version and the UTC time it was built), the
 * time in the player's own clock (`utc: true` keeps UTC, for tests). An id of another shape reads
 * as it is ("Build dev").
 */
export function buildStampText(id, { utc = false } = {}) {
  const m = /^(.+)\+(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(String(id));
  if (!m) return `Build ${id}`;
  const d = new Date(Date.UTC(+m[2], +m[3] - 1, +m[4], +m[5], +m[6], +m[7]));
  const [mo, day, hr, min] = utc ? [d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes()] : [d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()];
  return `Build ${m[1]}, ${MONTHS[mo]} ${day}, ${String(hr).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** The desktop bridge, if the preload script installed one. */
export function nativeBridge(win = globalThis) {
  return win.lamplightNative && win.lamplightNative.platform === 'desktop' ? win.lamplightNative : null;
}

// Set in localStorage once a profile has been saved in IndexedDB (or found there). If IndexedDB
// later fails to open (it happens: a one-off "UnknownError opening backing store"), the marker
// says a real save exists there, so the game must not quietly start a fresh profile somewhere
// else. A first launch that never saved leaves no marker, so it can still fall back normally.
export const IDB_MARKER = 'lamplight:profile-in-indexeddb';

/**
 * Pick the best available storage and return { store, note, loud }: the store, a note on what
 * was chosen (or null), and loud = true when progress will not be kept (the game must show that
 * on screen, not just in the debug overlay).
 * Desktop: files through the bridge. Web: IndexedDB, else localStorage, else memory (and say so:
 * progress in memory is lost when the tab closes).
 * @param {object} win window-like object (tests pass doubles; a missing or null property means absent)
 * @param {object} [o]
 * @param {string|null} [o.namespace] a separate save space (the web smoke test uses 'smoke' so it
 *   never touches the real profile)
 */
export async function openStore(win = globalThis, { namespace = null } = {}) {
  const native = nativeBridge(win);
  if (native) return { store: createStore({ backend: createDesktopBackend(native), build: BUILD_ID }), note: null, loud: false };
  const ns = namespace ? `lamplight-${namespace}` : 'lamplight';
  const ls = win.localStorage ?? null;
  // Web playtest build: ask the browser not to evict the save under storage pressure (best effort).
  try { await win.navigator?.storage?.persist?.(); } catch { /* not supported: fine */ }
  try {
    const kv = indexedDbKv(ns, 'kv', win.indexedDB ?? null);
    await kv.ready();
    const backend = createKvBackend(kv, 'web');
    if (!namespace) {
      const mark = () => { try { ls?.setItem(IDB_MARKER, '1'); } catch { /* fine */ } };
      if (typeof (await kv.get('profile')) === 'string') mark();
      const write = backend.write;
      backend.write = async (kind, text, opts) => { await write(kind, text, opts); if (kind === 'profile') mark(); };
    }
    return { store: createStore({ backend, build: BUILD_ID }), note: null, loud: false };
  } catch { /* fall through */ }
  let marker = null;
  try { marker = ls?.getItem(IDB_MARKER) ?? null; } catch { /* blocked */ }
  if (marker && !namespace) {
    return {
      store: createStore({ backend: createKvBackend(memoryKv(), 'memory'), build: BUILD_ID }),
      note: 'The save couldn\'t be opened (the browser\'s database failed). Close this tab and open the game again. Progress won\'t be saved this session.',
      loud: true,
    };
  }
  try {
    const kv = localStorageKv(`${ns}:`, ls);
    await kv.set('__probe', '1');
    await kv.del('__probe');
    return { store: createStore({ backend: createKvBackend(kv, 'web-local'), build: BUILD_ID }), note: 'Saving to local storage (IndexedDB is blocked).', loud: false };
  } catch { /* fall through */ }
  return { store: createStore({ backend: createKvBackend(memoryKv(), 'memory'), build: BUILD_ID }), note: 'This browser blocks storage. Progress is lost when the tab closes.', loud: true };
}
