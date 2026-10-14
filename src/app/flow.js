// The game's flow between screens (ARCHITECTURE §10.2, §12.1, §13.1): a run's end folded into the
// profile and saved, the results waiting for the harbor (several runs' worth after Run again), a
// run's config from the profile, where the title's first button goes, where the window may be
// reopened, and every way off the page (Quit, reloading after an error, an update's reload,
// reopening the window for a display mode), each through the progress keeper, so a save that
// failed is tried again first; and the page closing any other way (a tab, the window's X, Alt+F4),
// which asks first while a save still fails. Apart from main.js so the gate tests it
// (tests/app.test.js).

import { applyRunResult, runConfigFor } from '../meta/index.js';
import { mergeRuns } from './hublogic.js';

/**
 * @param {object} o
 * @param {object} o.keeper app/keeper.js (the profile in memory, keep, leave)
 * @param {object} o.scenes app/scenes.js
 * @param {object} o.data DATA
 * @param {(replay)=>Promise} o.saveReplay writes a run's replay file (logs a failure; never throws)
 * @param {()=>Promise} o.flushSettings settings written now, before leaving the page
 * @param {()=>Promise} o.saveSettingsNow the same, for the display switch (a change just made)
 * @param {(yes: string)=>Promise<boolean>} o.askToLeave asks when a save still fails; true leaves anyway
 * @param {object|null} o.native the desktop bridge (Quit), or null on the web
 * @param {()=>void} o.reload reloads the page
 */
export function createGameFlow({ keeper, scenes, data, saveReplay, flushSettings, saveSettingsNow, askToLeave, native = null, reload }) {
  let lastRun = null;
  let leaving = false;   // a way off the page is going (the keeper already asked, if it had to)
  const takeResults = () => { const r = lastRun; lastRun = null; return r; };
  const off = (go) => () => { leaving = true; go(); };
  return {
    /**
     * A run's end, folded into the profile the moment it ends and saved (rotating the backups, so
     * the last five runs' saves are kept); then its replay. Run again without the harbor between
     * adds this run's news to the last one's.
     */
    async onRunSaved(replay, result) {
      const out = applyRunResult(keeper.profile, result, data);
      const run = { changes: out.changes, result, runs: 1 };
      lastRun = lastRun ? mergeRuns(lastRun, run, data) : run;
      await keeper.keep(out.doc, { rotate: true });
      await saveReplay(replay);
    },
    /** The results waiting for the harbor, taken once (null when there are none). */
    takeResults,
    /** From a run's end screen to the harbor, where the results come up. */
    toHarbor() { return scenes.go('hub', { results: takeResults() }); },
    /**
     * A run's config: the profile's pools and the Lamp Post's upgrades (meta/runconfig.js). The
     * smoke and screenshot tools can ask for everything instead (all: true), to show any character.
     */
    configFor(choice) {
      return choice.all ? { seed: choice.seed, character: choice.character, map: data.maps[0].id } : runConfigFor(keeper.profile, data, choice);
    },
    /** The title's first button (Start, or Continue): the harbor. */
    fromTitle() { return scenes.go('hub'); },
    /** Settled at the title or in the harbor: where reopening the window (a display switch) loses nothing. */
    atTitleOrHarbor() { return scenes.settledIn('title', 'hub'); },
    /** Quit the desktop game (null on the web). If a failed save still fails, the player is asked. */
    quit: native ? () => keeper.leave({ flush: flushSettings, confirm: () => askToLeave('Quit anyway'), go: off(() => native.quit()) }) : null,
    /** Reload after an error. If a failed save still fails, the player is asked. */
    reloadAfterError() { return keeper.leave({ flush: flushSettings, confirm: () => askToLeave('Reload anyway'), go: off(reload) }); },
    /** An update's reload (at a safe point). If a failed save still fails, the page stays; the next safe point tries again. */
    reloadForUpdate() { return keeper.leave({ flush: flushSettings, go: off(reload) }); },
    /** Reopen the window for a display mode (settings-flow.js); stays if a failed save still fails. */
    reopenWindow(go) { return keeper.leave({ flush: saveSettingsNow, go: off(go) }); },
    /**
     * The page closing some other way (a tab, the browser, the window's X, Alt+F4): `event` is its
     * beforeunload. While a save still fails, and no way off the page above has already asked, the
     * page asks to stay: the browser then asks the player in its own words, and the desktop shell
     * asks the same question the game's Quit does (desktop/main.cjs). Returns whether it asked.
     */
    beforeLeaving(event) {
      if (leaving || !keeper.failing) return false;
      event.preventDefault();
      event.returnValue = '';
      return true;
    },
  };
}
