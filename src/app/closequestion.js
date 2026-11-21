// The page's side of the desktop window's close question (0.9.0, V5; desktop/shell.cjs
// createPageQuestion): the window's X or Alt+F4 mid-run, or while a save fails, is asked here, on
// the game's own screen, so a pad can answer it. Apart from main.js so the gate tests it.
//
// The rule this file keeps (the sweep, S4 E2): every question the page takes gets an answer back.
// The shell waits on it with no time limit, so a path that ends without one leaves the window's X
// doing nothing. "Save and quit" answers even when saving throws (it answers "stay").

/**
 * @param {object} o
 * @param {object} o.native the desktop bridge (onCloseAsked, closeAck, closeAnswer)
 * @param {object} o.ui app ui (has, push, close)
 * @param {object} o.loop the loop (pause, resume)
 * @param {()=>boolean} o.inRunNow is a run on screen
 * @param {()=>Promise} o.saveRun leave the run as Quit run does, folded in and saved
 * @param {()=>Promise<boolean>} o.keepAll every save written; resolves false when one still fails
 * @param {(opts)=>object} o.makeScreen builds the question's screen from { title, text, buttons, initial, onBack }
 * @param {(e)=>void} [o.onError] a save that threw, for the log
 * Returns the handler it registered (for tests).
 */
/**
 * The question's own pause reason (the sweep, S3b F7): under the pause menu's 'menu', answering
 * Stay resumed 'menu' too, and the run went on under the pause menu. Reasons are a set.
 */
export const CLOSE_REASON = 'close';

export function wireCloseQuestion({ native, ui, loop, inRunNow, saveRun, keepAll, makeScreen, onError = () => {} }) {
  const onAsked = (kind) => {
    native.closeAck?.();
    // One question at a time: the one on screen answers for both.
    if (ui.has((x) => x.closeQuestion)) return;
    loop.pause(CLOSE_REASON);
    let q = null;
    let answered = false;
    const answer = (leave) => { if (answered) return; answered = true; native.closeAnswer?.(leave === true); };
    const done = (leave) => { ui.close(q); loop.resume(CLOSE_REASON); answer(leave); };
    const saveAndQuit = async () => {
      ui.close(q);
      loop.resume(CLOSE_REASON);
      let ok = false;
      try {
        await saveRun();
        ok = (await keepAll()) === true;
      } catch (e) { onError(e); } finally { answer(ok); }
    };
    try {
      q = makeScreen(kind === 'run' && inRunNow() ? {
        title: 'Quit in the middle of a run?',
        text: 'Save and quit ends the run here and keeps what you have collected. Quit anyway brings nothing from this run home.',
        buttons: [['Stay', 'no', () => done(false)], ['Save and quit', 'save', saveAndQuit], ['Quit anyway', 'yes', () => done(true)]],
        initial: 'no', onBack: () => done(false),
      } : {
        title: 'Unsaved progress',
        text: 'The last save failed. Quitting now loses everything since the last successful save.',
        buttons: [['Stay', 'no', () => done(false)], ['Quit anyway', 'yes', () => done(true)]],
        initial: 'no', onBack: () => done(false),
      });
      q.closeQuestion = true;
      ui.push(q);
    } catch (e) {
      // The question couldn't be shown: say "stay", so the next close asks again.
      loop.resume(CLOSE_REASON);
      onError(e);
      answer(false);
    }
  };
  native.onCloseAsked?.(onAsked);
  return onAsked;
}
