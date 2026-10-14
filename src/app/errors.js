// Capture uncaught errors into a ring buffer: shown in the debug overlay, written into bug
// reports, and checked by the smoke test. Never throws.
// Notices (a save restored from a backup, storage fell back to localStorage) are kept separately:
// they are worth showing and reporting, but they are not errors and never fail a smoke test.

const MAX = 50;

export function createErrorLog() {
  const items = [];
  const notices = [];
  const listeners = [];
  function add(kind, message, stack = '') {
    const e = { kind, message: String(message).slice(0, 500), stack: String(stack || '').slice(0, 2000), at: new Date().toISOString() };
    items.push(e);
    if (items.length > MAX) items.shift();
    for (const f of listeners) { try { f(e); } catch { /* ignore */ } }
  }
  function note(kind, message) {
    notices.push({ kind, message: String(message).slice(0, 500), at: new Date().toISOString() });
    if (notices.length > MAX) notices.shift();
  }
  return {
    add,
    note,
    get items() { return items.slice(); },
    get count() { return items.length; },
    get last() { return items.length ? items[items.length - 1] : null; },
    get notices() { return notices.slice(); },
    get lastNotice() { return notices.length ? notices[notices.length - 1] : null; },
    onError(f) { listeners.push(f); },
    /** Install global handlers on a window. */
    attach(win) {
      win.addEventListener('error', (ev) => add('error', ev.message || ev.error?.message || 'error', ev.error?.stack));
      win.addEventListener('unhandledrejection', (ev) => add('rejection', ev.reason?.message || String(ev.reason), ev.reason?.stack));
    },
  };
}
