// The run scene: one run of the sim, drawn, heard, and steered through the menus.
//
// Each sim tick: sample the InputFrame, step the recorded run, and hold the sim for big events
// (hit-stop). When the sim halts for a decision (a level-up, a chest, a Form, the overtime
// choice) the loop pauses and the matching screen opens; the screen's answer becomes a logged
// decision. Each rendered frame: read the events (view, sound, report log), draw, and clear the
// buffer. The pause button, the tuning panel, the error screen, and the end of the run live here
// too. Everything the player decides goes through the recorded run, so every run can be
// replayed exactly from its file. The run's end is saved through deps.onRunSaved the moment it
// ends; if that fails, deps.onError gets the error (main.js shows the error screen).

import { createRecordedRun } from '../../sim/replay.js';
import { currentHalt, buildRunResult } from '../../sim/world.js';
import { tuningDiff, tuningCopyText } from '../../ui/tuningmodel.js';
import { relicSwapScreen, spoilsScreen, levelUpScreen, chestScreen, overtimeScreen, pauseScreen, endScreen, confirmScreen, runTips, statsScreen, ascendScreen, formsScreen, relicScreen, ferryScreen, wellScreen, bellPickScreen } from '../../ui/menus.js';
import { codexScreen } from '../../ui/hubscreens.js';
import { tuningScreen } from '../../ui/tuning.js';
import { hitStopFor, soundFor, pitchFor, noticeFor, quietNotice, createGiftNotices, haltView, pauseBuild, runSummary, createEventLog, panelTuning, statsView, withSights } from '../runlogic.js';
import { EV } from '../../sim/events.js';
import { formatClock } from '../../render/hudtext.js';
import { VIEW_W, VIEW_H } from '../../render/layout.js';
import { minimapFade } from '../../render/minimapmodel.js';
import * as draftMod from '../../sim/draft.js';
import * as playerMod from '../../sim/player.js';
import { createWorldTips, worldTips, tipsSeeEvents, createSightings, sightKey, createHurtLog, deathRecap } from '../runtips.js';
import { termsIn, glossaryEntry } from '../../ui/glossary.js';
import { h as el, fill } from '../../ui/dom.js';
import { catchUp, CHECKPOINT_TICKS, runAgainChoice } from '../resume.js';
import { CLOSE_REASON } from '../closequestion.js';
import { damageRows, damageTableEl } from '../../render/damagetable.js';

const END_SCREEN_DELAY_MS = 1400;
/** How long after a notice the glossary's button opens its term (ms). */
const NOTE_TERM_MS = 6000;

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
  let endSaving = null;    // the run's end being saved (a promise), for Save and quit
  let catching = null;     // a resumed run catching up (app/resume.js catchUp), until it's where it stopped
  let catchEl = null;
  let fuelTold = false;    // a first run's Fuel line, said once, when her Fuel first runs out (round 3, L1 6)
  let firstRun = false;    // this run is the profile's first (its notices leave out district names)
  let tips = null;         // a first run's how-to-play card (ui/menus.js runTips), until tuning.feel.firstRunTipsSec
  let stepMs = 0;
  let gifts = createGiftNotices();   // a level's gift, collapsed over levels in a row (runlogic.js)
  // What earlier runs showed this profile (0.8.0): on any map (a first sighting of it says
  // nothing), and on this run's map (the pause menu's Field guide). Read as the run starts.
  let knownSights = null, mapSights = [];
  // Whether this profile has taken a Form before (its codex's 'took:<weapon>:<option>' ticks): a new
  // weapon's card names its Final Form only after that (RULING-L1). Read once, at the first card.
  let formSeen = null;
  const seen = () => {
    if (formSeen === null) {
      const forms = new Set((data.ascensions || []).flatMap((l) => l.options.map((o) => o.id)));
      const codex = deps.profile?.()?.profile?.codex;
      formSeen = Array.isArray(codex) && codex.some((k) => typeof k === 'string' && k.startsWith('took:') && forms.has(k.split(':')[2]));
    }
    return { formSeen };
  };
  // 0.9.0 (W7): tips over the things themselves, first sightings held until their enemy is on
  // screen, the hurts for the death recap, and the last notice (the glossary's button opens its term).
  let wtips = null, sightings = createSightings(), hurts = createHurtLog();
  let tipLayer = null;
  const tipEls = new Map();
  let lastNote = { text: '', at: -1e9 };
  let glossHint = null, glossHintText = '';
  const eventLog = createEventLog(300);
  // The camera's view for the sounds (a chest that lands out of sight knocks), reused frame to frame.
  const soundView = { x: 0, y: 0, halfW: VIEW_W / 2, halfH: VIEW_H / 2 };
  const tickMsAvg = { v: 0 };

  function resumeAll() { for (const r of ['decision', 'menu', 'tuning', CLOSE_REASON]) deps.loop.resume(r); }   // (CLOSE_REASON: the window's close question, app/closequestion.js)

  function decide(d) { return rec.decide(d); }

  // ---------------------------------------------------------------- halts

  const autoNotes = [];
  function openHalt() {
    const h = currentHalt(world);
    if (!h || haltScreen) return;
    deps.loop.pause('decision');
    const v = haltView(world, h, data, seen());
    const next = () => {
      ui.close(haltScreen);
      haltScreen = null;
      if (currentHalt(world)) openHalt();
      else deps.loop.resume('decision');
    };
    switch (v.kind) {
      case 'draft': {
        // A full build's level-up (W1b: every card a weapon's rolled upgrade) picks itself when
        // Settings says so (Full build level-ups: Pick for me), as a logged decision, and says so
        // quietly: "Level 31: Flare Gun, +1 Projectile (Rare)".
        if (deps.settings?.play?.fullBuild === 'auto' && typeof draftMod.draftFull === 'function' && draftMod.draftFull(world, h)) {
          const index = draftMod.autoPick(world, h);
          const card = v.cards[index];
          decide({ kind: 'pick', index });
          if (card) autoNotes.push(`Level ${v.level}: ${card.title}${card.desc ? `, ${card.desc}` : ''}${card.rarity ? ` (${card.rarity.name})` : ''}`);
          if (currentHalt(world)) { openHalt(); } else deps.loop.resume('decision');
          return;
        }
        const s = levelUpScreen(menuCtx, {
          level: v.level, cards: v.cards, charges: v.charges, skipPays: v.skipPays,
          // A Legendary's pick holds its card for a beat (ruling 14 E): the decision is made at once
          // (its sound and rumble come from the sim's event on the next frame), the screen closes after.
          onPick: (i, beat = 0) => { decide({ kind: 'pick', index: i }); if (beat > 0 && deps.beats === true) setTimeout(next, beat); else next(); },
          onReroll: () => { decide({ kind: 'reroll' }); refreshDraft(s); },
          onBanish: (i) => { decide({ kind: 'banish', index: i }); refreshDraft(s); },
          onSkip: () => { decide({ kind: 'skip' }); next(); },
        });
        haltScreen = ui.push(s);
        break;
      }
      case 'chest': {
        const pool = [...data.weapons.map((w) => w.icon), ...data.passives.map((p) => p.icon), ...data.relics.map((r) => r.icon)];
        // A boss chest, a secret's cache, or any chest with an Ember after it: one Spoils
        // screen for the lot (0.9.0, V4: 3 to 5 screens in a row).
        const chain = chainAfter(world);
        if (v.boss || v.secret || chain.length) { openSpoils(v, chain, pool); break; }
        haltScreen = ui.push(chestScreen(menuCtx, { boss: v.boss, secret: v.secret, dawn: v.dawn, items: v.items, pool, onDone: () => { decide({ kind: 'ok' }); next(); } }));
        break;
      }
      case 'ascend':
        // An axis that just opened (a 5th or 10th upgrade, a deed done, the signature's track): its
        // two options at once, as the contract's halt asks (C1-CONTRACT 7.2). Keep for later is a keep.
        if (v.direct && v.weapons.length === 1) {
          const w = v.weapons[0];
          haltScreen = ui.push(formsScreen(menuCtx, {
            weapon: w, direct: true, axis: v.axis, why: v.why,
            onAscend: (id, beat = 0) => { decide({ kind: 'ascend', slot: w.slot, id }); if (beat > 0 && deps.beats === true) setTimeout(next, beat); else next(); },
            onBack: () => { decide({ kind: 'keep' }); next(); },
          }));
          break;
        }
        haltScreen = ui.push(ascendScreen(menuCtx, {
          embers: v.embers, weapons: v.weapons,
          // A weapon, then its Forms (a screen over this one; Back returns here). Taking one holds
          // its card for a beat (ruling 14 E) before both screens close.
          onPick: (w) => {
            const fs = ui.push(formsScreen(menuCtx, {
              weapon: w,
              onAscend: (id, beat = 0) => {
                decide({ kind: 'ascend', slot: w.slot, id });
                const done = () => { ui.close(fs); next(); };
                if (beat > 0 && deps.beats === true) setTimeout(done, beat); else done();
              },
              onBack: () => ui.close(fs),
            }));
          },
          onKeep: () => { decide({ kind: 'keep' }); next(); },
        }));
        break;
      case 'well':
        // The Salt Well (0.8.0): give up a relic, or keep them all.
        haltScreen = ui.push(wellScreen(menuCtx, {
          relics: v.relics,
          onGive: (id) => { decide({ kind: 'give', id }); next(); },
          onKeep: () => { decide({ kind: 'keep' }); next(); },
        }));
        break;
      case 'bellpick':
        // The Fog Bell's chest (0.8.2): one weapon or passive gains its levels.
        haltScreen = ui.push(bellPickScreen(menuCtx, {
          levels: v.levels, options: v.options,
          onPick: (index) => { decide({ kind: 'pick', index }); next(); },
        }));
        break;
      case 'relic':
        haltScreen = ui.push(relicScreen(menuCtx, {
          vault: v.vault, relics: v.relics, pool: v.pool, full: v.full, slots: v.slots, carried: v.carried,
          onPick: (i, swap) => { decide(swap ? { kind: 'pick', index: i, swap } : { kind: 'pick', index: i }); next(); },
          onPass: () => { decide({ kind: 'pass' }); next(); },
        }));
        break;
      case 'ferry': {
        const s = ferryScreen(menuCtx, {
          view: () => haltView(world, currentHalt(world) ?? h, data, seen()),
          onBuy: (i) => {
            // A relic with the slots full: which carried one to give up for it (W1's contract §5).
            const fv = haltView(world, currentHalt(world) ?? h, data, seen());
            const o = fv.offers.find((x) => x.index === i);
            if (o?.relic && fv.full) {
              const sw = ui.push(relicSwapScreen(menuCtx, {
                buying: o.name, carried: fv.carried,
                onSwap: (id) => { ui.close(sw); decide({ kind: 'buy', index: i, swap: id }); s.refresh(); },
                onCancel: () => ui.close(sw),
              }));
              return;
            }
            decide({ kind: 'buy', index: i }); s.refresh();
          },
          onDone: () => { decide({ kind: 'done' }); next(); },
        });
        haltScreen = ui.push(s);
        break;
      }
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

  /** The Ember halts queued right after the chest (what its Spoils screen will hold). */
  function chainAfter(w) {
    const out = [];
    for (let k = 1; k < w.halts.length; k++) { const kind = w.halts[k].kind; if (kind !== 'ascend') break; out.push(kind); }
    return out;
  }

  /** The Spoils screen: the chest's reel, then the Ember in the same place. */
  function openSpoils(v, chain, pool) {
    const embers = chain.filter((k) => k === 'ascend').length;
    const parts = [];
    if (embers) parts.push('an Ember to spend');
    const sp = spoilsScreen(menuCtx, {
      boss: v.boss, secret: v.secret, dawn: v.dawn, items: v.items, pool, after: parts.join(' and '),
      onContinue: () => { decide({ kind: 'ok' }); advance(); },
    });
    haltScreen = ui.push(sp);
    function finish() {
      ui.close(sp);
      if (haltScreen === sp) haltScreen = null;
      if (currentHalt(world)) openHalt(); else deps.loop.resume('decision');
    }
    function advance() {
      const h = currentHalt(world);
      if (!h || h.kind !== 'ascend') { finish(); return; }
      const hv = haltView(world, h, data, seen());
      const emberStep = () => sp.setStep({
        kind: 'ember', embers: hv.embers, weapons: hv.weapons,
        onPick: (w) => sp.setStep({
          kind: 'forms', weapon: w,
          onAscend: (id) => { const f = w.forms.find((x) => x.id === id); decide({ kind: 'ascend', slot: w.slot, id }); sp.done(`${w.name}: ${f?.name ?? 'a new Form'}`); advance(); },
          onBack: () => emberStep(),
        }),
        onKeep: () => { decide({ kind: 'keep' }); sp.done('Ember kept for later'); advance(); },
      });
      emberStep();
    }
  }

  function refreshDraft(screen) {
    const h = currentHalt(world);
    if (!h || h.kind !== 'draft') return;
    const v = haltView(world, h, data, seen());
    screen.setOffer(v.cards, v.charges);
  }

  /** Is your figure under the How to play card (in the view's pixels, as the minimap fades)? */
  function tipsUnderYou() {
    const cam = deps.renderer?.camera, u = parseFloat(ui.view.style.getPropertyValue('--u')) || 1;
    if (!cam || !tips) return false;
    const r = tips.getBoundingClientRect(), v = ui.view.getBoundingClientRect();
    if (!(r.width > 0)) return false;
    const box = { x: (r.left - v.left) / u, y: (r.top - v.top) / u, w: r.width / u, h: r.height / u };
    const feet = { x: world.player.x - cam.x + VIEW_W / 2, y: world.player.y - cam.y + VIEW_H / 2 };
    return minimapFade(box, feet) < 1;
  }

  // ---------------------------------------------------------------- pause, tuning, end

  function openPause() {
    deps.loop.pause('menu');
    const s = pauseScreen(menuCtx, {
      build: pauseBuild(world),
      // An Ember kept for later: spend it now (the run stops for the choice when the pause closes).
      onAscend: pauseBuild(world).canAscend ? () => { ui.close(s); deps.loop.resume('menu'); decide({ kind: 'ember' }); openHalt(); } : null,
      onResume: () => { ui.close(s); deps.loop.resume('menu'); },
      onSettings: () => onSettings(),
      onStats: () => { const t = statsScreen(menuCtx, { view: statsView(world), onBack: () => ui.close(t) }); ui.push(t); },
      // The codex for this map: what it has shown, one line each, and the kill counts.
      onGuide: () => openGuide(),
      onGlossary: menuCtx.glossary ? () => menuCtx.glossary() : null,
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

  /** The codex for this map: what it has shown, in earlier runs and this one. */
  function openGuide() {
    // The codex for this map (the sweep, ruling 13: the field guide was a second book of the same
    // entries): the profile's, with what this run has shown so far.
    const doc = withSights(deps.profile?.() ?? { profile: {}, stats: {} }, world.map.id, [...mapSights, ...(world.result?.sighted || [])]);
    const t = codexScreen(menuCtx, { data, get: () => ({ doc }), map: world.map.id, onBack: () => ui.close(t) });
    ui.push(t);
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
        case 'give': return 'Given.';
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
      { key: 'ember', label: 'Give an Ember', run: () => dev({ cmd: 'ember' }) },
      ...(world.secrets.length ? [{ key: 'warp', label: 'Warp to the secret', run: () => dev({ cmd: 'warp', secret: 0 }) }] : []),
      { key: 'giveW', label: 'Give weapon', items: named(data.weapons.filter((w) => !w.innate)), run: (it) => dev({ cmd: 'give', what: 'weapon', id: it.id }) },
      { key: 'giveP', label: 'Give passive', items: named(data.passives), run: (it) => dev({ cmd: 'give', what: 'passive', id: it.id }) },
      { key: 'giveR', label: 'Give relic', items: named(data.relics), run: (it) => dev({ cmd: 'give', what: 'relic', id: it.id }) },
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

  function damageTable(src) {
    try { const rows = damageRows(src, data); if (!rows.length) return null; const box = el('div', { class: 'dmg-block' }, el('h2', { class: 'dmg-head' }, 'Damage by weapon')); box.appendChild(damageTableEl(menuCtx, rows)); return box; } catch { return null; }
  }

  function showEnd(result) {
    // How it ended, for a death (0.9.0, V4: "Defeated" with nothing about what did it): the sim's
    // hurt log when it keeps one (W3), else what the scene saw.
    const log = world?.hurtLog && typeof playerMod.hurtLogList === 'function' ? playerMod.hurtLogList(world) : hurts.list();
    const recap = result.end === 'died' && !result.cleared ? deathRecap(world.enemyDefs, log, world.tick) : null;
    const s = endScreen(menuCtx, {
      result: runSummary(result, data), recap,
      // W6's damage by weapon (0.9.0): what each weapon did this run.
      extra: damageTable(result),
      onHarbor: () => { ui.close(s); deps.onHarbor(); },
      onAgain: () => { ui.close(s); deps.startRun(lastConfig); },
    });
    ui.push(s);
  }

  // ---------------------------------------------------------------- tips over the world (0.9.0)

  /** World px to the view's px (the camera's middle is the view's). */
  const toView = (cam, x, y) => ({ x: x - cam.x + VIEW_W / 2, y: y - cam.y + VIEW_H / 2 });

  function drawWorldTips(cam) {
    if (!tipLayer || !wtips) return;
    const list = ui.open || world.over ? [] : worldTips(wtips, world, cam, world.tick / 60);
    const live = new Set();
    for (const t of list) {
      live.add(t.kind);
      let node = tipEls.get(t.kind);
      if (!node) { node = el('div', { class: 'world-tip' }, t.text); tipEls.set(t.kind, node); tipLayer.appendChild(node); }
      const p = toView(cam, t.x, t.y - 18);
      node.style.left = `calc(var(--u) * ${Math.round(p.x)})`;
      node.style.top = `calc(var(--u) * ${Math.round(p.y)})`;
      node.hidden = false;
    }
    for (const [k, node] of tipEls) if (!live.has(k)) node.hidden = true;
  }

  function drawGlossHint() {
    if (!glossHint) return;
    const fresh = !ui.open && !world.over && view.now - lastNote.at < NOTE_TERM_MS;
    const id = fresh ? termsIn(lastNote.text, data)[0] ?? null : null;
    const e = id ? glossaryEntry(data, id) : null;
    const text = e ? e.name : '';
    if (text !== glossHintText) {
      glossHintText = text;
      if (e) fill(glossHint, ui.glyph('glossary'), ` Glossary: ${e.name}`);
    }
    glossHint.hidden = !e;
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
    /**
     * The controller in use was unplugged mid-run (app/pauses.js): the pause menu opens, so the
     * run waits for a press of Resume once a controller (or the keyboard) is back, never springing
     * back to life on its own (0.7.3). Nothing opens over the end of a run or a pause already up.
     */
    /**
     * Leave the run as Quit run does, and resolve once its end is folded in and saved (0.9.0: the
     * window's close mid-run, "Save and quit"). Resolves false when there's no run to leave.
     */
    async leaveAndSave() {
      if (!world || world.over) { if (endSaving) await endSaving.catch(() => {}); return !!endSaving; }
      ui.closeAll();
      resumeAll();
      decide({ kind: 'leave' });
      // The end is saved on the next frame (frame(), world.over): wait for it.
      for (let k = 0; k < 600 && !endSaving; k++) await new Promise((r) => setTimeout(r, 16));
      if (endSaving) await endSaving.catch(() => {});
      return !!endSaving;
    },
    controllerLost() {
      if (!world || world.over || ui.has((x) => x.isPause)) return;
      openPause();
    },
    openStatsForTools: () => { const t = statsScreen(menuCtx, { view: statsView(world), onBack: () => ui.close(t) }); ui.push(t); },
    openGuideForTools: () => openGuide(),
    toggleTuningForTools: () => toggleTuning(),
    openSettingsForTools: () => deps.onSettings(),
    openChestForTools: () => rec.decide({ kind: 'dev', cmd: 'chest', boss: true }),
    enter({ character, seed, all = false, resume = null, ...choice }) {
      if (resume) {
        // A run resumed from its checkpoint (0.9.0, app/resume.js): played back to where it
        // stopped, a chunk a frame, then the player has it.
        catching = catchUp(resume.replay, data, buildId);
        rec = catching.rec;
        // Run again sets out as this run did: the gate's choice its checkpoint kept (S4 B3).
        lastConfig = runAgainChoice(resume);
        catchEl?.remove();
        catchEl = el('div', { class: 'catch-up' }, 'Resuming the run');
        ui.view.appendChild(catchEl);
      } else {
        catching = null;
        // Run again sets out the same way, without the consumables (used up).
        lastConfig = { ...choice, character, seed: undefined, all, consumables: [], rune: '' };
        const s = seed ?? `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
        // The profile's pools and upgrades, and the gate's choices (the app's configFor); tools
        // without one get everything.
        const config = deps.configFor ? deps.configFor({ ...choice, character, seed: s, all }) : { seed: s, character, map: data.maps[0].id };
        rec = createRecordedRun(config, data, buildId);
      }
      world = rec.world;
      world.eventsPerTick = false;
      // A checkpoint as the run sets out (S4 B5): what it used up is already saved, so a crash in
      // the first minute can still resume it.
      if (!resume) deps.onCheckpoint?.(rec, world, lastConfig);
      view.attach(world);
      hud.attach();
      eventLog.clear();
      haltScreen = null; tuningOpen = null; endShownAt = -1; overAt = -1; endResult = null; endFailed = false; endSaving = null;
      gifts = createGiftNotices();
      knownSights = deps.seen?.any?.() ?? null;
      mapSights = deps.seen?.on?.(world.map.id) ?? [];
      // The level-up, chest, Form, and overtime screens can open the pause menu over themselves.
      menuCtx.pause = () => { if (!ui.has((x) => x.isPause)) openPause(); };
      // A first run: Move and Dash in the corner for its first seconds (deps.isFirstRun); the rest
      // come as tips over the things themselves when they're on screen (app/runtips.js).
      const first = !!deps.isFirstRun?.();
      firstRun = first;
      tips?.remove(); tips = first ? runTips((a) => ui.glyph(a), ui.view) : null;   // (round 3: the Fuel line waits until her Fuel first runs low)
      fuelTold = false;
      wtips = createWorldTips({ known: knownSights, firstRun: first });
      sightings = createSightings();
      hurts.clear();
      lastNote = { text: '', at: -1e9 };
      autoNotes.length = 0;
      tipLayer?.remove(); tipEls.clear();
      tipLayer = el('div', { class: 'world-tips' });
      ui.view.prepend(tipLayer);
      glossHint?.remove(); glossHintText = '';
      glossHint = el('div', { class: 'gloss-hint run', hidden: true });
      ui.view.appendChild(glossHint);
      deps.loop.reset();
      resumeAll();
      // A run under way: closing the desktop window now asks first (its materials aren't home yet).
      deps.onRunLive?.(true);
    },
    exit() {
      deps.onRunLive?.(false);
      menuCtx.pause = null;
      tips?.remove(); tips = null;
      catchEl?.remove(); catchEl = null; catching = null;
      tipLayer?.remove(); tipLayer = null; tipEls.clear();
      glossHint?.remove(); glossHint = null;
      ui.closeAll();
      view.detach();
      hud.detach();
      resumeAll();
      world = null; rec = null;
    },
    step() {
      if (!world || catching || world.over || world.halts.length) return;
      const ev = world.events, n0 = ev.count;
      const t0 = performance.now();
      rec.step(input.sampleFrame());
      stepMs = performance.now() - t0;
      tickMsAvg.v = tickMsAvg.v * 0.95 + stepMs * 0.05;
      eventLog.add(ev, n0, ev.count, world.tick);
      view.markTick(ev.count, world.tick);
      const hs = hitStopFor(ev, n0, ev.count, world.tuning.feel.hitStop);
      if (hs > 0) deps.loop.hitStop(hs);
      // Every minute, the run so far, so a crash can resume it (0.9.0, app/resume.js).
      if (world.tick % CHECKPOINT_TICKS === 0 && !world.over) deps.onCheckpoint?.(rec, world, lastConfig);
      if (currentHalt(world)) openHalt();
    },
    /** The checkpoint now (the page is going away: a closed tab), as the minute's is. */
    checkpointNow() { if (world && rec && !world.over && !catching) deps.onCheckpoint?.(rec, world, lastConfig); },
    frame(alpha, frameMs) {
      if (!world) return;
      if (catching) {
        // Catching up: as many ticks as fit in about 10 ms a frame, nothing drawn or heard.
        const t0 = performance.now();
        let done = false;
        try {
          while (!done && performance.now() - t0 < 10) done = catching.step(120);
        } catch (e) {
          // A player reads a plain line; the bug report keeps the tick and the halt names (its stack). (RULING-L1, L1 fix 30)
          catching = null; catchEl?.remove(); catchEl = null;
          deps.onError?.(Object.assign(new Error("The saved run couldn't be resumed. Save a bug report from the title screen."), { detail: e.message, stack: e.stack }));
          return;
        }
        if (catchEl) catchEl.textContent = `Resuming the run: ${formatClock(world.tick / 60)}`;
        if (!done) return;
        catching = null;
        catchEl?.remove(); catchEl = null;
        world.events.clear();
        deps.loop.reset();
        if (currentHalt(world)) openHalt();
        return;
      }
      // Controls that work over the run itself (a screen on top has its own).
      if (!ui.open && !world.over) {
        if (input.fired('pause')) openPause();
        else if (input.fired('tuning')) toggleTuning();
        // The glossary's button over the run (0.9.0): the last notice's term, the run paused.
        else if (input.fired('glossary') && menuCtx.glossary) {
          deps.loop.pause('menu');
          const id = view.now - lastNote.at < NOTE_TERM_MS ? termsIn(lastNote.text, data)[0] ?? null : null;
          menuCtx.glossary(id, () => deps.loop.resume('menu'));
        }
        else if (currentHalt(world) && !haltScreen) openHalt();
      } else if (tuningOpen && ui.top === tuningOpen && input.fired('tuning')) toggleTuning();
      // Events: sound and HUD notices, then the view (which keeps what it needs), then clear.
      const ev = world.events;
      const cx = deps.renderer.camera.x;
      soundView.x = cx; soundView.y = deps.renderer.camera.y;
      const notes = [], quiet = [];
      // A level with nothing left to level pays a gift without stopping (LEVEL_GIFT): no level-up
      // chime for it, the gift's quiet line says it.
      let dry = null;
      if (EV.LEVEL_GIFT !== undefined) for (let i = 0; i < ev.count; i++) if (ev.type[i] === EV.LEVEL_GIFT) (dry ??= new Set()).add(ev.c[i]);
      for (let i = 0; i < ev.count; i++) {
        // A level's gift (0.7.3, the sim's LEVEL_GIFT: a kind, b amount, c the level): collapsed.
        if (EV.LEVEL_GIFT !== undefined && ev.type[i] === EV.LEVEL_GIFT) gifts.add(ev.a[i], ev.b[i], ev.c[i], view.now);
        else if (ev.type[i] === EV.FIRST_SIGHT) {
          // One line, held until its enemy is on screen (things show at once).
          const k = sightKey(world, ev, i);
          if (k && !knownSights?.has(k.key)) sightings.add(k.key, world, k.type);
        } else {
          if (ev.type[i] === EV.PLAYER_HURT) hurts.add(world, ev, i);
          const note = noticeFor(ev, i, world, knownSights, { firstRun });
          if (note) (quietNotice(ev, i) ? quiet : notes).push(...[].concat(note));
          if (firstRun && !fuelTold && ev.type[i] === EV.OIL && ev.b[i] === 0 && ev.a[i] < 3) { fuelTold = true; notes.push(`Fuel: away from lit lamps it runs out after ${world.character?.mechanic?.params?.oilFull ?? 60}s, and your light dims. Light a lamp to refill it`); }
        }
        if (!audio.ok) continue;
        if (dry && ev.type[i] === EV.LEVEL_UP && dry.has(ev.a[i])) continue;
        const name = soundFor(ev, i, world.slots, soundView, world.dash?.def?.id ?? null);
        if (name) audio.play(name, (ev.x[i] - cx) / 400, pitchFor(ev, i));
      }
      // The controller's rumble for what asked for one this frame (app/rumble.js; the controller
      // only, never the screen).
      deps.rumble?.events(ev, world, { stopped: !!ui.open || !!deps.loop.isPaused?.() });   // (no low-health pulse while stopped)
      quiet.push(...gifts.take(view.now));
      const cam = deps.renderer.camera;
      quiet.push(...sightings.ready(world, cam));
      if (autoNotes.length) quiet.push(...autoNotes.splice(0, autoNotes.length));
      tipsSeeEvents(wtips, ev);
      // The glossary's button names the last notice's term (in the corner while it's fresh).
      for (const n of [...notes, ...quiet]) if (termsIn(n, data).length) lastNote = { text: n, at: view.now };
      // One frame's notices show in turn, never the last alone; the first Pearls' line goes
      // after the lamp or bell that gave it (its event comes first). What asks nothing of the
      // player goes to the quiet line in the lower third.
      if (notes.length) hud.notice(notes.filter((n) => !n.startsWith('Pearls:')).concat(notes.filter((n) => n.startsWith('Pearls:'))), 2400, view.now);
      if (quiet.length) hud.notice(quiet, 2400, view.now, { quiet: true });
      view.consume();
      view.draw(alpha, frameMs);
      hud.draw(world, view.now, view.screenFlash(), !!ui.open);   // a menu over the run: notices wait
      drawWorldTips(cam);
      drawGlossHint();
      if (tips) {
        tips.hidden = !!(ui.open || world.over);
        if (world.tick / 60 > world.tuning.feel.firstRunTipsSec) { tips.remove(); tips = null; }
        else tips.style.opacity = tipsUnderYou() ? '0.25' : '';
      }
      ev.clear();
      // The end: let the moment land (the player falls, the last boss bursts), then the summary.
      if (world.over && endShownAt < 0) {
        if (overAt < 0) {
          // Saved the moment the run ends, not when the summary appears: closing the game in
          // between loses nothing.
          overAt = view.now;
          deps.onRunLive?.(false);
          ui.closeAll();
          endResult = buildRunResult(world);
          // A fold-in that fails (it shouldn't) goes to the error screen, which stays up: its
          // report has the run, and the end screen's buttons would go on as if it were saved.
          const failed = (e) => { endFailed = true; deps.onError?.(e); };
          try {
            const saving = onRunSaved(rec.toReplay(), endResult);
            endSaving = Promise.resolve(saving);
            if (typeof saving?.catch === 'function') saving.catch(failed);
          } catch (e) { failed(e); }
        }
        if (!endFailed && view.now - overAt >= END_SCREEN_DELAY_MS) { endShownAt = view.now; showEnd(endResult); }
      }
    },
  };
}

