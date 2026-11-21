// The web build's guard against two tabs (0.9.0, W7; V5: "Two browser tabs silently overwrite each
// other": each kept its own profile in memory and saved the whole of it, so the later save erased
// the other tab's progress). The first tab holds a Web Lock for as long as it's open; a second tab
// can't get it and goes read-only: it plays, but saves nothing, and says so in plain words. When
// the first tab closes, the lock passes to the second, which then asks for a reload (its profile in
// memory is older than the one on disk). The desktop build is one window (its single-instance lock)
// and never needs this.

export const TAB_TEXT = Object.freeze({
  readOnly: 'The game is open in another tab, so this tab won\'t save. Close this tab and play in the other one.',
  takeOver: 'The other tab closed. Reload this tab to play here and save.',
});

/**
 * Take the save's lock (navigator.locks), or find it held. Resolves to { owner: true } in the tab
 * that holds it, or { owner: false } with onFree(fn) called when the other tab lets it go (this tab
 * then holds it). Without Web Locks (an old browser) every tab is the owner, as before.
 * @param {object} o
 * @param {object|null} o.locks navigator.locks (or a stand-in)
 * @param {string} o.name the lock's name (one per save space: 'lamplight', 'lamplight-smoke')
 */
export function claimSaves({ locks = globalThis.navigator?.locks ?? null, name = 'lamplight-save' } = {}) {
  if (!locks || typeof locks.request !== 'function') return Promise.resolve({ owner: true, supported: false });
  return new Promise((resolve) => {
    let settled = false;
    const hold = () => new Promise(() => {});   // held until the tab closes
    locks.request(name, { ifAvailable: true }, (lock) => {
      if (lock) { settled = true; resolve({ owner: true, supported: true }); return hold(); }
      // Held by another tab: read-only, and wait for it to come free.
      let freeFn = null, freed = false;
      settled = true;
      resolve({ owner: false, supported: true, onFree(fn) { freeFn = fn; if (freed) fn(); } });
      locks.request(name, () => { freed = true; freeFn?.(); return hold(); }).catch(() => {});
      return null;
    }).catch(() => { if (!settled) resolve({ owner: true, supported: false }); });
  });
}

/**
 * A store that saves nothing (the read-only tab): every write resolves without writing, and
 * `readOnly` says why. Reads and exports work as before.
 */
export function readOnlyStore(store) {
  return {
    ...store,
    get label() { return store.label; },
    get loadedFrom() { return store.loadedFrom; },
    readOnly: true,
    saveProfile: async () => {},
    saveSettings: async () => {},
    saveCheckpoint: async () => {},
    clearCheckpoint: async () => {},
    applyImport: async () => { throw new Error(TAB_TEXT.readOnly); },
    writeReplay: async () => 'nowhere (this tab is read-only)',
    flush: () => Promise.resolve(),
  };
}
