// Always run the newest build (playtest web build only; the desktop .exe never self-reloads).
//
// On load, whenever the window regains focus, and whenever the tab becomes visible, fetch
// version.json with the cache bypassed. If the build id differs from the running one:
//   - at a safe point (title, hub, never mid-transition): reload now;
//   - during a run: never reload mid-run (that would throw the run away). Show "update ready"
//     and reload at the next safe point.
// A check that arrives inside the throttle window isn't dropped; it runs when the window ends.
// Reload-loop guard: before reloading for build X, remember X and the time for this browser
// session. If the page comes back still not running X (a half-propagated deploy, a cache in the
// way), don't reload again right away; say plainly that the update didn't load. That "stuck"
// state heals itself: once the recheck window (5 minutes) has passed, the next check tries X
// again (so at most one reload per window, only at a safe point), a different build is tried
// at once, and finding our own build again takes the notice down.

export const RELOAD_KEY = 'lamplight:reloadedFor';
export const RELOAD_AT_KEY = 'lamplight:reloadedAt';

export function createVersionCheck({
  currentBuild,
  fetchVersion,
  isSafePoint,
  reload,
  onUpdateReady = () => {},   // ({ build, stuck }) show "update ready" or "did not load"
  onClear = () => {},         // the notice no longer applies (the served build is ours again)
  now = () => Date.now(),
  minIntervalMs = 15000,
  stuckRecheckMs = 5 * 60 * 1000,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (h) => clearTimeout(h),
  session = null,             // { get(k), set(k, v) }, e.g. over sessionStorage
}) {
  let pending = null;         // the newer build id we're waiting to load
  let stuckBuild = null;      // the build we reloaded for that still didn't load
  let lastCheck = -Infinity;
  let inFlight = null;
  let deferred = null;        // timer handle for the check waiting out the throttle window
  let deferredSet = false;

  function doReload(build) {
    try { session?.set(RELOAD_KEY, build); session?.set(RELOAD_AT_KEY, String(now())); } catch { /* storage blocked: still reload */ }
    reload();
  }

  /** When this session last reloaded for `build`, or -Infinity. */
  function reloadedAt(build) {
    try {
      if ((session?.get(RELOAD_KEY) ?? null) !== build) return -Infinity;
      const at = Number(session?.get(RELOAD_AT_KEY));
      return Number.isFinite(at) ? at : -Infinity;
    } catch {
      return -Infinity; // storage blocked
    }
  }

  async function check({ force = false } = {}) {
    if (pending) { if (isSafePoint()) { doReload(pending); return 'reloading'; } return 'pending'; }
    const since = now() - lastCheck;
    if (stuckBuild && !force && since < stuckRecheckMs) return 'stuck'; // no polling while stuck
    const wait = minIntervalMs - since;
    if (!force && wait > 0) {
      // Run it when the window ends (forced, so it can never re-throttle itself).
      if (!deferredSet) {
        deferredSet = true;
        deferred = setTimer(() => { deferredSet = false; deferred = null; check({ force: true }); }, wait);
      }
      return 'throttled';
    }
    if (inFlight) return inFlight;
    lastCheck = now();
    inFlight = (async () => {
      try {
        const info = await fetchVersion();
        if (!info || typeof info.build !== 'string') return 'unknown';
        if (info.build === currentBuild) {
          if (stuckBuild) { stuckBuild = null; onClear(); }
          return 'current';
        }
        if (now() - reloadedAt(info.build) < stuckRecheckMs) {
          // We reloaded for this build moments ago and it still isn't what's running.
          if (stuckBuild !== info.build) { stuckBuild = info.build; onUpdateReady({ ...info, stuck: true }); }
          return 'stuck';
        }
        stuckBuild = null;    // a newer build, or the window has passed: (re)try it
        pending = info.build;
        if (isSafePoint()) { doReload(pending); return 'reloading'; }
        onUpdateReady({ ...info, stuck: false });
        return 'deferred';
      } catch {
        return 'offline'; // no network is not an error for a local game
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  return {
    check,
    /** Call when entering a safe point (hub, title). */
    atSafePoint() { if (pending && isSafePoint()) doReload(pending); },
    /** Drop a check that is waiting out the throttle window (detach calls this). */
    cancelDeferred() { if (deferredSet) { clearTimer(deferred); deferredSet = false; deferred = null; } },
    get pending() { return !!pending; },
    get stuck() { return stuckBuild !== null; },
  };
}

/** Wire the check to the page: load, focus, and becoming visible. Returns a detach function. */
export function attachVersionCheck(vc, win = window, doc = document) {
  vc.check({ force: true });
  const onFocus = () => vc.check();
  const onVis = () => { if (doc.visibilityState === 'visible') vc.check(); };
  win.addEventListener('focus', onFocus);
  doc.addEventListener('visibilitychange', onVis);
  return () => {
    win.removeEventListener('focus', onFocus);
    doc.removeEventListener('visibilitychange', onVis);
    vc.cancelDeferred?.();
  };
}

/** Fetch version.json with every cache bypassed. */
export function fetchVersionJson(url = './version.json', fetchImpl = globalThis.fetch, now = Date.now) {
  return fetchImpl(`${url}?t=${now()}`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null));
}

/** sessionStorage as the tiny { get, set } the check needs (null if blocked). */
export function sessionStore(win = globalThis) {
  try {
    const ss = win.sessionStorage;
    if (!ss) return null;
    return { get: (k) => ss.getItem(k), set: (k, v) => ss.setItem(k, v) };
  } catch {
    return null;
  }
}
