// Scene manager. One scene is active at a time: boot, title, hub, run, results.
//
// A scene is an object with any of:
//   enter(params)  may be async (asset loads); the previous scene has already exited
//   exit()
//   step(dt, tick) one fixed sim tick (only called while the loop isn't paused)
//   frame(alpha, frameMs, input) once per rendered frame
//   safePoint      true if the game may reload here (the title; the hub while nothing is open),
//                  false during a run (a getter works: the hub's changes as screens open and close)
//
// Transitions are serialized: calling go() while another transition is in flight queues it.

export function createSceneManager({ onError = (e) => { throw e; } } = {}) {
  const scenes = new Map();
  let current = null;
  let currentName = null;
  let transitions = 0;       // transitions queued or in flight; never a safe point while > 0
  let chain = Promise.resolve();
  const listeners = [];

  async function doGo(name, params) {
    const next = scenes.get(name);
    if (!next) throw new Error(`Unknown scene: ${name}`);
    const prevName = currentName;
    if (current?.exit) await current.exit();
    current = null;
    currentName = null;
    await next.enter?.(params);
    current = next;
    currentName = name;
    return prevName;
  }

  return {
    register(name, scene) {
      if (scenes.has(name)) throw new Error(`Scene already registered: ${name}`);
      scenes.set(name, scene);
    },
    /** Switch scenes. Resolves when the new scene has entered. */
    go(name, params) {
      transitions++;
      chain = chain.then(() => doGo(name, params)).then(
        (prevName) => {
          transitions--;
          // Listeners run after the counter drops, so a listener asking isSafePoint() sees the
          // settled state (true in the hub or title once nothing else is queued).
          for (const f of listeners) { try { f(name, prevName); } catch (e) { onError(e); } }
        },
        (e) => { transitions--; onError(e); },
      );
      return chain;
    },
    step(dt, tick) { current?.step?.(dt, tick); },
    frame(alpha, ms, input) { current?.frame?.(alpha, ms, input); },
    get name() { return currentName; },
    get scene() { return current; },
    /**
     * True only when no transition is queued or running and the current scene allows it (title,
     * hub). A run -> results transition in flight is never safe: its result isn't saved yet.
     */
    isSafePoint() { return transitions === 0 && current !== null && current.safePoint === true; },
    /** True when no transition is queued or running and the current scene is one of `names`. */
    settledIn(...names) { return transitions === 0 && current !== null && names.includes(currentName); },
    onChange(f) { listeners.push(f); },
  };
}
