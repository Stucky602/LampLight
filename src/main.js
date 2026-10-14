// Boot: storage, settings, renderer, art, input, sound, menus, scenes, loop. Then the version
// check (web build only).
//
// Flow: title (the lampyard behind the menu) -> the harbor -> set out from the gate -> a run ->
// the run's end screen -> the results over the harbor (Phase 5).

import 'pixi.js/unsafe-eval'; // lets PixiJS run under a strict Content-Security-Policy (no eval)
import './ui/ui.css';
import { createLoop } from './app/loop.js';
import { createSceneManager } from './app/scenes.js';
import { createErrorLog } from './app/errors.js';
import { openStore, nativeBridge, TARGET, BUILD_ID } from './app/platform.js';
import { createVersionCheck, attachVersionCheck, fetchVersionJson, sessionStore } from './app/version-check.js';
import { createUpdateMarker, UPDATE_TEXT } from './ui/update-marker.js';
import { createRenderer, VIEW_W, VIEW_H } from './render/renderer.js';
import { createAtlas } from './render/atlas.js';
import { loadAtlasImage } from './render/atlasimage.js';
import atlasUrl from './assets/atlas.png';
import atlasJson from './assets/atlas.json';
import { createRunView } from './render/runview.js';
import { createHud } from './render/hud.js';
import { createInput } from './input/input.js';
import { createDebugOverlay } from './ui/overlay.js';
import { createUi } from './ui/screens.js';
import { titleScreen, errorScreen, creditsScreen, confirmScreen } from './ui/menus.js';
import { CREDITS } from './data/credits.js';
import { createAudio } from './audio/audio.js';
import { createLampyardScene } from './app/scenes/lampyard.js';
import { createRunScene } from './app/scenes/run.js';
import { createHubScene } from './app/scenes/hub.js';
import { createHubView } from './render/hubview.js';
import { createHubTuning } from './hub/tuning.js';
import { profileFromLoad } from './app/profileboot.js';
import { createProgressKeeper } from './app/keeper.js';
import { createGameFlow } from './app/flow.js';
import { titleStartLabel } from './app/hublogic.js';
import { createIconFactory } from './app/icons.js';
import { openSettings } from './app/settings-flow.js';
import { runSmoke } from './app/smoke.js';
import { wirePauses } from './app/pauses.js';
import { stampName } from './save/store.js';
import { encodeReplay, buildReport } from './save/replay.js';
import { tuningDiff } from './ui/tuningmodel.js';
import { DATA } from './data/index.js';

const uiRoot = document.getElementById('ui');
const params = new URLSearchParams(location.search);

function bootMessage(text, isError = false) {
  const el = document.createElement('div');
  el.className = `boot-message${isError ? ' error' : ''}`;
  el.textContent = text;
  uiRoot.appendChild(el);
  return el;
}

/** Count WebGL draw calls per frame for the debug overlay. */
function countDrawCalls(renderer) {
  const gl = renderer.app.renderer.gl;
  const counter = { frame: 0, last: 0 };
  if (!gl) return counter;
  for (const fn of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
    const orig = gl[fn];
    if (typeof orig !== 'function') continue;
    gl[fn] = function counted(a, b, c, d, e) { counter.frame++; return orig.call(this, a, b, c, d, e); };
  }
  return counter;
}

async function boot() {
  const t0 = performance.now();
  const errors = createErrorLog();
  errors.attach(window);
  const native = nativeBridge(window);

  // The web smoke test (?smoke) uses its own save space so it can never touch the real profile.
  // The desktop smoke test gets a throwaway save folder from the main process instead.
  const { store, note, loud } = await openStore(window, { namespace: params.has('smoke') && !native ? 'smoke' : null });
  const settings = await store.loadSettings();
  // The profile, fitted to this build (app/profileboot.js). A save from a newer build stops here.
  const start = profileFromLoad(await store.loadProfile(), DATA);
  for (const w of start.notes) errors.note('save', w);   // notices, not errors
  if (note) errors.note('save', note);
  if (start.stop) { stopForNewerSave(start.stop, native); return null; }

  const renderer = await createRenderer(document.getElementById('game'), { fillScreen: settings.display.fillScreen });
  const drawCalls = countDrawCalls(renderer);
  const atlas = createAtlas({ image: await loadAtlasImage(atlasUrl), json: atlasJson, url: atlasUrl });
  const input = createInput({ settings: settings.controls });
  // A scene that can't start (or a listener that throws) goes to the error screen, as a crash does.
  const scenes = createSceneManager({ onError: (e) => { errors.add('scene', e?.message || String(e), e?.stack); showError(e); } });
  const overlay = createDebugOverlay(uiRoot, { build: BUILD_ID, target: TARGET });
  if (!params.has('debug')) overlay.toggle(); // hidden until F3 (the smoke and shot tools show it)
  const marker = createUpdateMarker(uiRoot, document);
  if (note && loud) marker.show(note, 'storage');
  // The profile in memory, saved at every change; a failed save is shown and never left behind (app/keeper.js).
  // The desktop shell is told while a save fails, so closing its window asks first (desktop/main.cjs).
  const keeper = createProgressKeeper({
    store, notice: marker, log: (m) => errors.add('save', m), profile: start.profile,
    onFailing: (f) => { native?.setUnsaved?.(f)?.catch?.(() => {}); },
  });
  let loop = null;
  let errorShown = false;   // the error screen shows once (showError, below)
  let runScene = null; // made below; the audio's feel getter and reports read it once it exists
  const ui = createUi({ root: uiRoot, input, sound: (name) => audio.play(name) });
  const audio = createAudio({ sfx: DATA.sfx, voiceCap: DATA.sfxVoiceCap, volumes: settings.audio, feel: () => runScene?.world?.tuning.feel ?? DATA.tuning.feel });
  const unlockAudio = () => audio.unlock();
  for (const ev of ['keydown', 'mousedown', 'pointerdown', 'touchstart']) window.addEventListener(ev, unlockAudio, { passive: true });
  input.on('device', unlockAudio);
  const icon = createIconFactory(atlas);
  const menuCtx = { ui, icon, sound: (name) => audio.play(name) };
  const access = settings.access; // live: the run view reads shake, numbers, and flash settings from it
  const view = createRunView({ renderer, atlas, data: DATA, access });
  // The harbor's live tuning (hub/tuning.js): its tuning panel changes it, the view and the world read it.
  const hubTuning = createHubTuning(DATA.hubTuning);
  const hubView = createHubView({ renderer, atlas, data: DATA, tuning: hubTuning });
  const hud = createHud({ renderer, atlas, data: DATA });

  // Settings save a moment after the last change (a slider held down is one save), or at once
  // when asked (before the window is replaced, before quitting, before an update reloads).
  let saveSettingsTimer = null;
  const writeSettings = () => store.saveSettings(settings).catch((e) => errors.add('save', `Could not save settings: ${e?.message || e}`));
  const saveSettings = (now = false) => {
    clearTimeout(saveSettingsTimer);
    saveSettingsTimer = null;
    if (now) return writeSettings();
    saveSettingsTimer = setTimeout(() => { saveSettingsTimer = null; writeSettings(); }, 400);
    return Promise.resolve();
  };
  const flushSettings = () => (saveSettingsTimer ? saveSettings(true) : store.flush());

  const lampyard = createLampyardScene({ renderer, input, atlas, attract: true });

  // ------------------------------------------------------------ reports and replays

  async function deliverFile(name, text, type = 'application/json') {
    if (native) return store.writeReport(name, text);
    // Web: a download Kevin can attach (IndexedDB can't be reached from outside the browser).
    const blob = new Blob([text], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    return `your Downloads folder as ${name}`;
  }

  function reportText(noteText = '') {
    const run = scenes.name === 'run' ? runScene : null;
    const w = run?.world;
    // Every part is a function: buildReport gathers each one on its own, so a run left broken by
    // an error still gets a report with everything else in it.
    return buildReport({
      build: BUILD_ID, target: TARGET, createdAt: new Date().toISOString(), note: noteText,
      replay: () => (run?.recorded ? run.recorded.toReplay() : null),
      // The run's changes, and the harbor's (under "hub.") for as long as the game has been open.
      tuning: () => [...(w ? tuningDiff(DATA.tuning, w.tuning) : []), ...tuningDiff({ hub: DATA.hubTuning }, { hub: hubTuning })],
      settings,
      events: () => (run ? run.eventLog.list() : []),
      errors: () => errors.items, notices: () => errors.notices,
      state: () => (w ? {
        scene: scenes.name, tick: w.tick, seed: w.config.seed, character: w.character.id, level: w.player.level,
        hp: Math.round(w.player.hp), enemies: w.enemies.count, shots: w.projectiles.count, gems: w.gems.count,
        halts: w.halts.map((x) => x.kind), over: w.over, god: w.god, paused: loop?.pauseReasons() ?? [],
      } : { scene: scenes.name, devTools: keeper.profile?.profile?.flags?.devTools === true }),
    });
  }

  async function saveReport(noteEl) {
    try {
      if (noteEl) noteEl.textContent = 'Saving...';
      const where = await deliverFile(stampName('report.json'), reportText());
      if (noteEl) noteEl.textContent = `Bug report saved to ${where}.`;
    } catch (e) {
      errors.add('report', e?.message || String(e), e?.stack);
      if (noteEl) noteEl.textContent = `Couldn't save the bug report: ${e?.message || e}`;
    }
  }

  /** "Copy tuning": the clipboard, or a file when the clipboard refuses. Resolves to what happened. */
  async function copyText(text) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('no clipboard');
      await navigator.clipboard.writeText(text);
      return 'Copied to the clipboard.';
    } catch {
      try {
        const where = await deliverFile(stampName('tuning.txt'), text, 'text/plain');
        return `Clipboard blocked. Saved to ${where} instead.`;
      } catch (e) {
        return `Could not copy it or save it: ${e?.message || e}`;
      }
    }
  }

  /** Ask before leaving with progress a save couldn't keep. Resolves true to leave anyway. */
  function askToLeave(yes) {
    return new Promise((resolve) => {
      const s = confirmScreen(menuCtx, {
        title: 'Unsaved progress',
        text: 'The last save failed, and a second try failed too. Quitting now loses everything since the last successful save.',
        yes, no: 'Stay',
        onYes: () => { ui.close(s); resolve(true); },
        onNo: () => { ui.close(s); resolve(false); },
      });
      ui.push(s);
    });
  }
  // The flow between screens (app/flow.js): a run's end folded in and saved, the results for the
  // harbor, a run's config, and every way off the page, through the keeper.
  const flow = createGameFlow({
    keeper, scenes, data: DATA, native, askToLeave, flushSettings,
    saveSettingsNow: () => saveSettings(true),
    reload: () => location.reload(),
    saveReplay: async (replay) => {
      try { await store.writeReplay(stampName('run.lamprep'), encodeReplay(replay)); } catch (e) { errors.add('replay', `Could not save the replay: ${e?.message || e}`); }
    },
  });
  const quit = flow.quit;
  // Closing the page any other way asks first while a save still fails (the browser or the shell asks).
  window.addEventListener('beforeunload', (e) => flow.beforeLeaving(e));

  // ------------------------------------------------------------ scenes

  const showSettings = () => openSettings({
    ui, menuCtx, settings, desktop: !!native, native, input, audio, renderer, save: saveSettings,
    // Reopening the window (to or from borderless) reloads the page: only at the title or in the
    // harbor, and never over progress that isn't saved.
    atTitleOrHarbor: () => flow.atTitleOrHarbor(),
    reopen: (go) => flow.reopenWindow(go),
  });

  function startRun(cfg) { scenes.go('run', cfg); }

  /**
   * The error screen (Save report, Reload the game), once: a crash in the sim, a scene that
   * couldn't start, a run's end that couldn't be folded in. The sim stays paused under it.
   */
  function showError(e) {
    if (errorShown) return;
    errorShown = true;
    loop?.pause('error');
    ui.push(errorScreen(menuCtx, {
      message: `${e?.message || e}`, inRun: scenes.name === 'run', onReport: (el) => saveReport(el),
      onReload: () => flow.reloadAfterError(),
    }));
  }

  runScene = createRunScene({
    view, hud, input, get loop() { return loop; }, ui, menuCtx, audio, data: DATA, buildId: BUILD_ID, renderer,
    onTitle: () => scenes.go('title'),
    onHarbor: () => flow.toHarbor(),
    configFor: (choice) => flow.configFor(choice),
    onRunSaved: (replay, result) => flow.onRunSaved(replay, result),
    onError: (e) => { errors.add('run end', e?.message || String(e), e?.stack); showError(e); },
    onSettings: showSettings, saveReport, copyText, startRun,
  });

  let versionCheck = null;   // the web build's (below)
  const hubScene = createHubScene({
    view: hubView, input, ui, menuCtx, audio, data: DATA, hubTuning, buildId: BUILD_ID, copyText,
    profile: { get: () => keeper.profile, save: (doc) => { keeper.keep(doc); } },
    startRun, onTitle: () => scenes.go('title'), onSettings: showSettings, onQuit: quit,
    // The harbor with nothing on screen and no set piece running: a waiting update can load now.
    onIdle: () => versionCheck?.atSafePoint(),
  });

  function showTitle() {
    const s = titleScreen(menuCtx, {
      build: BUILD_ID,
      startLabel: titleStartLabel(keeper.profile),
      onStart: () => { ui.close(s); flow.fromTitle(); },
      onSettings: showSettings,
      onCredits: () => { const c = creditsScreen(menuCtx, { credits: CREDITS, onBack: () => ui.close(c) }); ui.push(c); },
      onQuit: quit,
      note: audio.ok && audio.state === 'suspended' && !native ? 'Sound starts after your first key press or click.' : null,
    });
    ui.push(s);
  }

  scenes.register('title', {
    safePoint: true,
    enter() { lampyard.enter(); showTitle(); },
    exit() { ui.closeAll(); lampyard.exit(); },
    step: (dt) => lampyard.step(dt),
    frame: (a) => lampyard.frame(a),
  });
  scenes.register('run', runScene);
  scenes.register('hub', {
    // Only while nothing is open (the results, a panel, a menu) and no set piece is running.
    get safePoint() { return hubScene.idle; },
    enter: (params) => hubScene.enter(params),
    exit: () => hubScene.exit(),
    step: (dt) => hubScene.step(dt),
    frame: (a, ms) => hubScene.frame(a, ms),
  });

  let frameCpu = 0;
  loop = createLoop({
    // A crash in the sim pauses it (reason "error") and opens the error screen with Save report.
    onError: (e, where) => {
      errors.add(`loop:${where}`, e?.message || String(e), e?.stack);
      if (where === 'step') showError(e);
    },
    onStopped: () => {
      bootMessage(`Lamplight crashed.\n\n${errors.last?.message || ''}\n\nClose the game and open it again. If it keeps happening, send a screenshot of this screen.`, true);
    },
    beforeSteps: (ms) => {
      input.update(ms);
      if (input.fired('debug')) overlay.toggle();
    },
    step: (dt, tick) => scenes.step(dt, tick),
    render: (alpha, ms) => {
      ui.layout(renderer.place, VIEW_W, VIEW_H);
      // Say why the game stopped when it isn't the player's own doing.
      if (loop.isPaused('controller')) marker.show('Paused: controller disconnected. Reconnect it or press any key.', 'paused');
      else if (loop.isPaused('blur') && scenes.name === 'run') marker.show('Paused: the game is in the background.', 'paused');
      else marker.clear('paused');
      const f0 = performance.now();
      scenes.frame(alpha, ms, input);
      frameCpu = frameCpu * 0.9 + (performance.now() - f0) * 0.1;
      ui.update(ms);
      const w = runScene.world;
      const extra = !overlay.visible ? '' : scenes.name === 'run' && w
        ? `Sim ${runScene.tickMs.toFixed(2)} ms/tick · view ${view.stats.jsMs.toFixed(2)} ms (scene ${frameCpu.toFixed(1)}) · draws ${drawCalls.last} · seed ${w.config.seed}\n` +
          `Enemies ${w.enemies.count} · shots ${w.projectiles.count} · gems ${w.gems.count} · sparks ${view.stats.particles} · lights ${view.stats.lights} · numbers ${view.stats.numbers}\n` +
          `Dropped events ${w.events.droppedTotal} · sound ${audio.state} (${audio.voices} voices)`
        : `Draws ${drawCalls.last} · sound ${audio.state}`;
      overlay.update(ms, { input, loop, errors, scene: scenes.name, extra });
      renderer.draw();
      drawCalls.last = drawCalls.frame;
      drawCalls.frame = 0;
    },
  });

  // Losing focus or the controller pauses the sim. Nothing is lost; rendering continues.
  wirePauses({ loop, input, win: window });

  await scenes.go('title');
  loop.start();
  if (!document.hasFocus() && !params.has('smoke')) loop.pause('blur');

  // Web playtest build: always run the newest deploy (never mid-run, never over the results or a
  // panel, never over progress that isn't saved: a failed save is tried again first, and the page
  // stays if it still fails; the next safe point tries again).
  if (TARGET === 'web' && !params.has('smoke')) {
    const vc = createVersionCheck({
      currentBuild: BUILD_ID,
      fetchVersion: () => fetchVersionJson('./version.json'),
      isSafePoint: () => scenes.isSafePoint(),
      reload: () => flow.reloadForUpdate(),
      onUpdateReady: (info) => marker.show(info.stuck ? UPDATE_TEXT.stuck : UPDATE_TEXT.ready),
      onClear: () => marker.clear('update'),
      session: sessionStore(window),
    });
    versionCheck = vc;
    attachVersionCheck(vc, window, document);
    scenes.onChange(() => { if (scenes.isSafePoint()) vc.atSafePoint(); });
  }

  // Desktop: F11 or Alt+Enter changes the display mode; keep settings in step so the next launch
  // opens the same way. Then tell the shell the boot was healthy.
  if (native) {
    native.onDisplayModeChanged?.((mode) => {
      settings.display.mode = mode;
      store.saveSettings(settings).catch((e) => errors.add('save', `Could not save settings: ${e?.message || e}`));
    });
    native.ready?.();
  }

  const game = {
    loop, scenes, input, store, renderer, errors, settings, ui, audio, atlas, view, runScene, hubScene, hubView,
    get profile() { return keeper.profile; }, bootMs: performance.now() - t0, startRun, saveReport, reportText,
    /** The smoke and screenshot tools' throwaway profile (kept in memory, not saved). */
    useProfileForTools(doc) { keeper.useForTools(doc); },
  };
  window.__lamplight = game; // for tools/shots and the smoke test
  if (params.has('smoke')) runSmoke(game, { native, seconds: Number(params.get('smoke')) || 30, params });
  return game;
}

/**
 * A save from a newer version: this build can't read it and won't write over it (save/store.js).
 * Say so and start nothing else. The web build keeps looking for the newer version and reloads
 * into it once it's up; the desktop one says to open the newest Lamplight.
 */
function stopForNewerSave(text, native) {
  bootMessage(`${text}\n\n${native ? 'Open the newest Lamplight instead.' : 'The game reloads when the update is available.'}`, true);
  if (params.has('smoke')) {
    const result = { ok: false, stage: 'boot', error: text };
    if (native) native.smokeDone(result);
    window.__smokeResult = result;
    return;
  }
  if (!native && TARGET === 'web') {
    attachVersionCheck(createVersionCheck({
      currentBuild: BUILD_ID, fetchVersion: () => fetchVersionJson('./version.json'),
      isSafePoint: () => true, reload: () => location.reload(), session: sessionStore(window),
    }), window, document);
  }
}

boot().catch((e) => {
  console.error(e);
  bootMessage(`Lamplight couldn't start.\n\n${e?.message || e}\n\nIf it keeps happening, send a screenshot of this screen.`, true);
  const native = nativeBridge(window);
  if (params.has('smoke') && native) native.smokeDone({ ok: false, stage: 'boot', error: String(e?.message || e) });
  window.__smokeResult = { ok: false, stage: 'boot', error: String(e?.message || e) };
});
