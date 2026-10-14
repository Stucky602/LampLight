// The run scene: one run of the sim, drawn, heard, and steered through the menus.
//
// Each sim tick: sample the InputFrame, step the recorded run, and hold the sim for big events
// (hit-stop). When the sim halts for a decision (a level-up, a chest, a rune, the overtime
// choice) the loop pauses and the matching screen opens; the screen's answer becomes a logged
// decision. Each rendered frame: read the events (view, sound, report log), draw, and clear the
// buffer. The pause button, the tuning panel, the error screen, and the end of the run live here
// too. Everything the player decides goes through the recorded run, so every run can be
// replayed exactly from its file. The run's end is saved through deps.onRunSaved the moment it
// ends; if that fails, deps.onError gets the error (main.js shows the error screen).

import { createRecordedRun } from '../../sim/replay.js';
import { currentHalt, buildRunResult } from '../../sim/world.js';
import { tuningDiff, tuningCopyText } from '../../ui/tuningmodel.js';
import { levelUpScreen, chestScreen, runeScreen, overtimeScreen, pauseScreen, endScreen, confirmScreen } from '../../ui/menus.js';
import { tuningScreen } from '../../ui/tuning.js';
import { hitStopFor, soundFor, noticeFor, haltView, pauseBuild, runSummary, createEventLog, panelTuning } from '../runlogic.js';
import { formatClock } from '../../render/hudtext.js';

const END_SCREEN_DELAY_MS = 1400;

export function createRunScene(deps) {
  const { view, hud, input, ui, menuCtx, audio, data, buildId, onRunSaved, onSettings, saveReport, copyText } = deps;
  let rec = null;
  let world = null;
  let lastConfig = null;
  let haltScreen = null;
  let tuningOpen = null;
  let endShownAt = -1;
  let overAt = -1;
  let endResult = null;
  let endFailed = false;   // the run's end couldn't be folded in: the error screen stays, no end screen over it
  let stepMs = 0;
  const eventLog = createEventLog(300);
  const tickMsAvg = { v: 0 };

  function resumeAll() { for (const r of ['decision', 'menu', 'tuning']) deps.loop.resume(r); }

  function decide(d) { return rec.decide(d); }

  // ---------------------------------------------------------------- halts

  function openHalt() {
    const h = currentHalt(world);
    if (!h || haltScreen) return;
    deps.loop.pause('decision');
    const v = haltView(world, h, data);
    const next = () => {
      ui.close(haltScreen);
      haltScreen = null;
      if (currentHalt(world)) openHalt();
      else deps.loop.resume('decision');
    };
    switch (v.kind) {
      case 'draft': {
        const s = levelUpScreen(menuCtx, {
          level: v.level, cards: v.cards, charges: v.charges,
          onPick: (i) => { decide({ kind: 'pick', index: i }); next(); },
          onReroll: () => { decide({ kind: 'reroll' }); refreshDraft(s); },
          onBanish: (i) => { decide({ kind: 'banish', index: i }); refreshDraft(s); },
          onSkip: () => { decide({ kind: 'skip' }); next(); },
        });
        haltScreen = ui.push(s);
        break;
      }
      case 'chest': {
        const pool = [...data.weapons.map((w) => w.icon), ...data.passives.map((p) => p.icon), ...data.relics.map((r) => r.icon)];
        haltScreen = ui.push(chestScreen(menuCtx, { boss: v.boss, items: v.items, pool, onDone: () => { decide({ kind: 'ok' }); next(); } }));
        break;
      }
      case 'rune':
        haltScreen = ui.push(runeScreen(menuCtx, {
          rune: v.rune, options: v.options,
          onPlace: (slot) => { decide({ kind: 'place', slot }); next(); },
          onDiscard: () => { decide({ kind: 'discard' }); next(); },
        }));
        break;
      case 'overtime':
        haltScreen = ui.push(overtimeScreen(menuCtx, {
          bossName: v.bossName,
          onStay: () => { decide({ kind: 'stay' }); next(); },
          onLeave: () => { decide({ kind: 'leave' }); ui.close(haltScreen); haltScreen = null; },
        }));
        break;
      default: break;
    }
  }

  function refreshDraft(screen) {
    const h = currentHalt(world);
    if (!h || h.kind !== 'draft') return;
    const v = haltView(world, h, data);
    screen.setOffer(v.cards, v.charges);
  }

  // ---------------------------------------------------------------- pause, tuning, end

  function openPause() {
    deps.loop.pause('menu');
    const s = pauseScreen(menuCtx, {
      build: pauseBuild(world),
      onResume: () => { ui.close(s); deps.loop.resume('menu'); },
      onSettings: () => onSettings(),
      onReport: (noteEl) => { saveReport(noteEl); },
      onLeave: () => {
        const c = confirmScreen(menuCtx, {
          title: 'Quit run?', text: 'You keep the materials you have collected.', yes: 'Quit run', no: 'Cancel',
          onYes: () => { ui.close(c); ui.close(s); deps.loop.resume('menu'); decide({ kind: 'leave' }); },
          onNo: () => ui.close(c),
        });
        ui.push(c);
      },
    });
    s.isPause = true;
    ui.push(s);
  }

  /** A dev command as a logged decision, and the panel's sentence for it. */
  function dev(d) {
    try {
      const n = decide({ kind: 'dev', ...d });
      switch (d.cmd) {
        case 'spawn': return `Spawned ${n}.`;
        case 'jump': return `Jumped to ${formatClock(d.to)}.`;
        case 'level': return 'Level-up queued: it opens when you close this.';
        case 'god': return d.on ? 'God mode on.' : 'God mode off.';
        case 'clear': return `Cleared ${n}.`;
        case 'give': return d.what === 'rune' ? 'Rune given: place it when you close this.' : 'Given.';
        default: return 'Done.';
      }
    } catch (e) { return e.message; }
  }

  /** The run's dev commands on the tuning panel (ARCHITECTURE §15). */
  function devCommands() {
    const named = (list) => list.map((x) => ({ id: x.id, name: x.name }));
    const godOn = () => world.god === true;
    return [
      { key: 'spawn500', label: 'Spawn 500 enemies', run: () => dev({ cmd: 'spawn', count: 500 }) },
      { key: 'spawn2000', label: 'Spawn 2,000 enemies', run: () => dev({ cmd: 'spawn', count: 2000 }) },
      { key: 'jump950', label: 'Jump to 9:50 (first boss)', run: () => dev({ cmd: 'jump', to: 590 }) },
      { key: 'jump1950', label: 'Jump to 19:50 (last boss)', run: () => dev({ cmd: 'jump', to: 1190 }) },
      { key: 'level', label: 'Level up', run: () => dev({ cmd: 'level', count: 1 }) },
      { key: 'god', label: () => `God mode: ${godOn() ? 'On' : 'Off'}`, run: () => dev({ cmd: 'god', on: !godOn() }) },
      { key: 'heal', label: 'Heal to full', run: () => dev({ cmd: 'heal' }) },
      { key: 'clear', label: 'Clear every enemy (no kills)', run: () => dev({ cmd: 'clear' }) },
      { key: 'giveW', label: 'Give weapon', items: named(data.weapons.filter((w) => !w.innate)), run: (it) => dev({ cmd: 'give', what: 'weapon', id: it.id }) },
      { key: 'giveP', label: 'Give passive', items: named(data.passives), run: (it) => dev({ cmd: 'give', what: 'passive', id: it.id }) },
      { key: 'giveR', label: 'Give relic', items: named(data.relics), run: (it) => dev({ cmd: 'give', what: 'relic', id: it.id }) },
      { key: 'giveU', label: 'Give rune', items: named(data.runes), run: (it) => dev({ cmd: 'give', what: 'rune', id: it.id }) },
    ];
  }

  function toggleTuning() {
    if (tuningOpen) { ui.close(tuningOpen); return; }
    deps.loop.pause('tuning');
    const panel = panelTuning(world, data);
    tuningOpen = tuningScreen(menuCtx, {
      defaults: panel.defaults, current: panel.current, commands: devCommands(),
      intro: 'Left and right change a value. The run is paused while this is open.',
      onTune: (path, value) => { try { decide({ kind: 'tune', path, value }); return null; } catch (e) { return e.message; } },
      onCopy: () => {
        const now = panelTuning(world, data);
        const text = tuningCopyText(tuningDiff(now.defaults, now.current), { build: buildId, when: formatClock(world.tick / 60) });
        return copyText(text);
      },
      onReset: () => {
        const now = panelTuning(world, data);
        for (const d of tuningDiff(now.defaults, now.current)) decide({ kind: 'tune', path: d.path, value: d.from });
      },
      onClose: () => ui.close(tuningOpen),
    });
    tuningOpen.onClose = () => { tuningOpen = null; deps.loop.resume('tuning'); };
    ui.push(tuningOpen);
  }

  function showEnd(result) {
    const s = endScreen(menuCtx, {
      result: runSummary(result, data),
      onHarbor: () => { ui.close(s); deps.onHarbor(); },
      onAgain: () => { ui.close(s); deps.startRun(lastConfig); },
    });
    ui.push(s);
  }

  // ---------------------------------------------------------------- scene

  return {
    safePoint: false,
    get world() { return world; },
    get recorded() { return rec; },
    get eventLog() { return eventLog; },
    get tickMs() { return tickMsAvg.v; },
    // For the smoke and screenshot tools (app/smoke.js).
    openPauseForTools: () => openPause(),
    toggleTuningForTools: () => toggleTuning(),
    openSettingsForTools: () => deps.onSettings(),
    openChestForTools: () => rec.decide({ kind: 'dev', cmd: 'chest', boss: true }),
    enter({ character, seed, all = false }) {
      lastConfig = { character, seed: undefined, all };
      const s = seed ?? `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
      // The profile's pools and upgrades (the app's configFor); tools without one get everything.
      const config = deps.configFor ? deps.configFor({ character, seed: s, all }) : { seed: s, character, map: data.maps[0].id };
      rec = createRecordedRun(config, data, buildId);
      world = rec.world;
      world.eventsPerTick = false;
      view.attach(world);
      hud.attach();
      eventLog.clear();
      haltScreen = null; tuningOpen = null; endShownAt = -1; overAt = -1; endResult = null; endFailed = false;
      // The level-up, chest, rune, and overtime screens can open the pause menu over themselves.
      menuCtx.pause = () => { if (!ui.has((x) => x.isPause)) openPause(); };
      deps.loop.reset();
      resumeAll();
    },
    exit() {
      menuCtx.pause = null;
      ui.closeAll();
      view.detach();
      hud.detach();
      resumeAll();
      world = null; rec = null;
    },
    step() {
      if (!world || world.over || world.halts.length) return;
      const ev = world.events, n0 = ev.count;
      const t0 = performance.now();
      rec.step(input.sampleFrame());
      stepMs = performance.now() - t0;
      tickMsAvg.v = tickMsAvg.v * 0.95 + stepMs * 0.05;
      eventLog.add(ev, n0, ev.count, world.tick);
      view.markTick(ev.count, world.tick);
      const hs = hitStopFor(ev, n0, ev.count, world.tuning.feel.hitStop);
      if (hs > 0) deps.loop.hitStop(hs);
      if (currentHalt(world)) openHalt();
    },
    frame(alpha, frameMs) {
      if (!world) return;
      // Controls that work over the run itself (a screen on top has its own).
      if (!ui.open && !world.over) {
        if (input.fired('pause')) openPause();
        else if (input.fired('tuning')) toggleTuning();
        else if (currentHalt(world) && !haltScreen) openHalt();
      } else if (tuningOpen && ui.top === tuningOpen && input.fired('tuning')) toggleTuning();
      // Events: sound and HUD notices, then the view (which keeps what it needs), then clear.
      const ev = world.events;
      const cx = deps.renderer.camera.x;
      for (let i = 0; i < ev.count; i++) {
        const note = noticeFor(ev, i, world);
        if (note) hud.notice(note, 2400, view.now);
        if (!audio.ok) continue;
        const name = soundFor(ev, i, world.slots);
        if (name) audio.play(name, (ev.x[i] - cx) / 400);
      }
      view.consume();
      view.draw(alpha, frameMs);
      hud.draw(world, view.now, view.screenFlash());
      ev.clear();
      // The end: let the moment land (the player falls, the last boss bursts), then the summary.
      if (world.over && endShownAt < 0) {
        if (overAt < 0) {
          // Saved the moment the run ends, not when the summary appears: closing the game in
          // between loses nothing.
          overAt = view.now;
          ui.closeAll();
          endResult = buildRunResult(world);
          // A fold-in that fails (it shouldn't) goes to the error screen, which stays up: its
          // report has the run, and the end screen's buttons would go on as if it were saved.
          const failed = (e) => { endFailed = true; deps.onError?.(e); };
          try {
            const saving = onRunSaved(rec.toReplay(), endResult);
            if (typeof saving?.catch === 'function') saving.catch(failed);
          } catch (e) { failed(e); }
        }
        if (!endFailed && view.now - overAt >= END_SCREEN_DELAY_MS) { endShownAt = view.now; showEnd(endResult); }
      }
    },
  };
}

