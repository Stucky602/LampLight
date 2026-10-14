// Keeping the player's progress (ARCHITECTURE §12.1, §13.1). The profile in memory is the truth,
// and every change is saved at once. A save that fails keeps the progress in memory and says so on
// screen until a save works. Nothing that leaves the page (an update's reload, Quit, reopening the
// window for a display mode, reloading after an error) goes while progress isn't on disk: it waits
// for writes in flight, saves again, and if that fails too it asks the player, or stays.

export const SAVE_FAILED_TEXT = 'Save failed. Progress is kept while the game is open and saves with the next change.';

/**
 * store: { saveProfile(doc, { rotate }), flush() } (save/store.js); notice: { show(text, key),
 * clear(key) } (ui/update-marker.js); log(message) for the error log; profile: the one loaded;
 * onFailing(failing) is told each time a save starts or stops failing (the desktop shell asks
 * before its window closes while one does).
 */
export function createProgressKeeper({ store, notice, log, profile, onFailing = null }) {
  let current = profile;
  let failing = false;
  const setFailing = (f) => { if (f !== failing) { failing = f; onFailing?.(f); } };

  /** Keep a new profile and save it. Resolves to whether it saved. */
  async function keep(doc, { rotate = false } = {}) {
    current = doc;
    try {
      await store.saveProfile(current, { rotate });
      setFailing(false);
      notice.clear('save');
      return true;
    } catch (e) {
      setFailing(true);
      log(`Could not save progress: ${e?.message || e}`);
      notice.show(SAVE_FAILED_TEXT, 'save');
      return false;
    }
  }

  /**
   * Leave the page without losing progress: wait for the writes in flight (`flush`, which may
   * itself save), then, if the last save failed, save again. If that fails too, `confirm()`
   * decides (resolve true to leave anyway); without one, stay. Resolves to whether it left.
   */
  async function leave({ go, flush = () => store.flush(), confirm = null }) {
    try { await flush(); } catch { /* a settings write failing doesn't hold the player here */ }
    if (failing && !(await keep(current)) && !(confirm && (await confirm()))) return false;
    go();
    return true;
  }

  return {
    get profile() { return current; },
    /** The last save failed and nothing has saved since. */
    get failing() { return failing; },
    keep,
    leave,
    /** A throwaway profile for the smoke and screenshot tools: kept in memory, not saved. */
    useForTools(doc) { current = doc; },
  };
}
