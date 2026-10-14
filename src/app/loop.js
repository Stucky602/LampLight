// The loop driver: a fixed 60 Hz simulation under a variable-rate renderer.
//
// - step(dt) runs zero or more times per frame at exactly dt seconds each.
// - render(alpha, frameMs, rawMs) runs once per frame. alpha in [0,1] is how far the clock is
//   between the previous tick and the next one, for interpolating positions on high-refresh
//   monitors (1 while paused or held: show the latest state). frameMs is the clamped frame time;
//   rawMs is the real one (for the debug overlay).
// - Pausing has named reasons (menu, level-up, blur, controller, error). The sim runs only when
//   no reason is active. Rendering and input polling never stop.
// - Hit-stop holds the sim for a few milliseconds while rendering continues. The sequence of
//   ticks is unchanged, so replays stay exact. Pausing cancels any hold in progress: after a
//   level-up card is picked, the game resumes at once instead of finishing an old freeze.
// - At most maxSteps ticks run per frame. A long stall (a breakpoint, a hidden tab) drops the
//   backlog instead of fast-forwarding through it.
// - Errors never kill the loop silently. A throwing step pauses the sim (reason 'error') and is
//   reported; input and rendering keep going so the game can show the error and save a report.
//   A render that throws three frames in a row stops the loop (start() revives it).
//
// The loop's `tick` counts every sim tick since the loop was created (or reset). A run keeps its
// own tick counter for replays; don't use this one for that. After a step throws, resuming from
// the 'error' pause re-runs the same tick number on whatever state the failed step left, so a
// run that hit an error pause is not replay-exact (bug reports say so).

export const TICK_HZ = 60;
export const TICK_DT = 1 / TICK_HZ;
export const TICK_MS = 1000 / TICK_HZ;
const RENDER_ERROR_LIMIT = 3;

/**
 * @param {object} o
 * @param {(dt:number, tick:number)=>void} o.step
 * @param {(alpha:number, frameMs:number, rawMs:number)=>void} o.render
 * @param {(frameMs:number)=>void} [o.beforeSteps] runs first each frame (poll input here, so the
 *   ticks about to run sample this frame's input)
 * @param {(err:Error, where:'step'|'render'|'beforeSteps')=>void} [o.onError]
 * @param {(reason:string)=>void} [o.onStopped] called when the loop stops itself (render failures)
 * @param {()=>number} [o.now] milliseconds, monotonic
 * @param {(cb:(t:number)=>void)=>any} [o.raf]
 * @param {(id:any)=>void} [o.cancelRaf]
 * @param {number} [o.maxSteps]
 * @param {number} [o.maxFrameMs] frame deltas are clamped to this before accumulating
 */
export function createLoop({
  step,
  render,
  beforeSteps = () => {},
  onError = (err, where) => { console.error(`[loop:${where}]`, err); },
  onStopped = () => {},
  now = () => performance.now(),
  raf = (cb) => requestAnimationFrame(cb),
  cancelRaf = (id) => cancelAnimationFrame(id),
  maxSteps = 5,
  maxFrameMs = 250,
}) {
  if (typeof step !== 'function' || typeof render !== 'function') throw new Error('createLoop needs step and render functions');
  let running = false;
  let gen = 0;          // bumps on every start(); a frame from an older start() does nothing
  let rafId = null;
  let last = 0;
  let acc = 0;
  let tick = 0;
  let holdMs = 0;
  let droppedMs = 0;
  let stepsLastFrame = 0;
  let renderErrors = 0;
  let frameCb = null;   // one callback per start(), carrying its generation
  const pauseReasons = new Set();

  function report(err, where) {
    try { onError(err, where); } catch { /* an error handler must never take the loop down */ }
  }

  function frame(t, myGen) {
    if (!running || myGen !== gen) return;
    const tNow = typeof t === 'number' ? t : now();
    const raw = tNow - last;
    let delta = raw;
    last = tNow;
    if (!(delta >= 0)) delta = 0;          // clocks can hiccup backwards
    if (delta > maxFrameMs) { droppedMs += delta - maxFrameMs; delta = maxFrameMs; }

    stepsLastFrame = 0;
    try { beforeSteps(delta); } catch (e) { report(e, 'beforeSteps'); }
    if (!running || myGen !== gen) return; // beforeSteps stopped (or restarted) the loop

    if (pauseReasons.size > 0) {
      acc = 0;                               // never bank time while paused
    } else if (holdMs > 0) {
      holdMs -= delta;
      if (holdMs < 0) { acc += -holdMs; holdMs = 0; } // resume mid-frame with the leftover
    } else {
      acc += delta;
    }

    if (pauseReasons.size === 0 && holdMs === 0) {
      while (acc >= TICK_MS && stepsLastFrame < maxSteps) {
        let threw = false;
        try {
          step(TICK_DT, tick);
        } catch (e) {
          threw = true;
          pauseReasons.add('error');
          acc = 0;
          report(e, 'step');
        }
        if (threw) break;
        tick++;
        acc -= TICK_MS;
        stepsLastFrame++;
        if (!running || myGen !== gen) return; // the step stopped (or restarted) the loop
        // A step can pause the loop (a level-up) or start a hit-stop: stop stepping at once.
        if (pauseReasons.size > 0 || holdMs > 0) { acc = 0; break; }
      }
      if (stepsLastFrame === maxSteps && acc >= TICK_MS) { droppedMs += acc; acc = 0; }
    }

    const a = pauseReasons.size > 0 || holdMs > 0 ? 1 : acc / TICK_MS;
    try {
      render(a < 0 ? 0 : a > 1 ? 1 : a, delta, raw);
      renderErrors = 0;
    } catch (e) {
      renderErrors++;
      report(e, 'render');
      if (renderErrors >= RENDER_ERROR_LIMIT) {
        running = false;
        rafId = null;
        try { onStopped('render-errors'); } catch { /* never throw out of the loop */ }
        return;
      }
    }
    if (running && myGen === gen) rafId = raf(frameCb);
  }

  return {
    start() {
      if (running) return;
      running = true;
      gen++;
      const myGen = gen;
      frameCb = (t) => frame(t, myGen);
      renderErrors = 0;
      last = now();
      acc = 0;
      rafId = raf(frameCb);
    },
    stop() {
      running = false;
      gen++;
      if (rafId !== null) cancelRaf(rafId);
      rafId = null;
    },
    /** Zero the tick counter and timing state (between runs, say). Pause reasons are kept. */
    reset() {
      tick = 0; acc = 0; holdMs = 0; droppedMs = 0; stepsLastFrame = 0;
      last = now();
    },
    /** Pause for a named reason. The sim runs again only when every reason is cleared. */
    pause(reason) { pauseReasons.add(String(reason)); holdMs = 0; },
    resume(reason) { pauseReasons.delete(String(reason)); },
    isPaused(reason) { return reason === undefined ? pauseReasons.size > 0 : pauseReasons.has(String(reason)); },
    pauseReasons() { return [...pauseReasons]; },
    /** Hold the sim for ms milliseconds (hit-stop). Overlapping holds keep the longer one. Ignored while paused. */
    hitStop(ms) { if (pauseReasons.size === 0 && ms > holdMs) holdMs = ms; },
    get holdMs() { return holdMs; },
    get tick() { return tick; },
    get running() { return running; },
    /** Time thrown away by clamping or the step cap, for the debug overlay. */
    get droppedMs() { return droppedMs; },
    get stepsLastFrame() { return stepsLastFrame; },
  };
}
