// The save code (ARCHITECTURE §12.3; brief §9.5): export the profile as text, or import one, from
// the title's menu and the harbor's. Export writes the code to a file (the desktop's saves folder,
// or the browser's downloads) and puts it on the clipboard. Import reads a text file the player
// picks, says what the code holds, and asks before replacing anything; the old save goes into the
// backups first (the keeper's rotating save). A cancelled file picker does nothing and says
// nothing; a bad code says what's wrong in plain words.

import { saveCodeScreen, confirmScreen } from '../ui/menus.js';
import { reconcileProfile } from '../meta/reconcile.js';
import { stampName } from '../save/store.js';

/**
 * What a code holds, as a line for the question before an import: "12 runs, 3.4 hours played, 5
 * buildings restored (14 levels), 2 characters". summary: save/codec.js summarize().
 */
export function importSummaryText(summary) {
  const n = (k, one, many) => `${k.toLocaleString('en-US')} ${k === 1 ? one : many}`;
  const parts = [n(summary.runs ?? 0, 'run', 'runs'), `${summary.hours ?? 0} hours played`];
  parts.push(summary.buildings ? `${n(summary.buildings, 'building', 'buildings')} restored (${n(summary.buildingLevels ?? 0, 'level', 'levels')})` : 'no buildings restored');
  parts.push(n(summary.characters ?? 0, 'character', 'characters'));
  return parts.join(', ');
}

/** Why an import failed, as the screen says it: the code's own sentence, or a plain one. */
export function importErrorText(e) {
  if (e && (e.name === 'CodeError' || e.name === 'SaveTooNewError') && e.message) return e.message;
  return "That file doesn't hold a Lamplight save code.";
}

/**
 * Ask the player for a text file and resolve to its text, or null when they cancel. A cancel
 * resolves cleanly however the browser reports it: the input's own 'cancel' event where there is
 * one, else the window getting its focus back with no file chosen.
 */
export function pickTextFile({ doc = globalThis.document, win = globalThis.window, waitMs = 700 } = {}) {
  return new Promise((resolve) => {
    const input = doc.createElement('input');
    input.setAttribute('type', 'file');
    input.setAttribute('accept', '.txt,text/plain');
    input.hidden = true;
    let done = false, timer = null;
    const finish = (v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      win?.removeEventListener?.('focus', onFocus);
      input.remove();
      resolve(v);
    };
    const onFocus = () => { timer = setTimeout(() => { if (!input.files?.length) finish(null); }, waitMs); };
    input.addEventListener('change', () => {
      const f = input.files?.[0];
      if (!f) { finish(null); return; }
      Promise.resolve().then(() => f.text()).then((t) => finish(String(t)), () => finish(''));
    });
    input.addEventListener('cancel', () => finish(null));
    win?.addEventListener?.('focus', onFocus);
    doc.body.appendChild(input);
    input.click();
  });
}

/**
 * @param {object} o
 * @param {object} o.ui the menu layer
 * @param {object} o.menuCtx
 * @param {object} o.store save/store.js (exportCode, previewImport)
 * @param {object} o.keeper app/keeper.js (the profile, kept and saved)
 * @param {object} o.data DATA
 * @param {(name, text, type)=>Promise<string>} o.deliverFile writes a file; resolves to where it went
 * @param {(text)=>Promise<boolean>} o.copy puts text on the clipboard; resolves to whether it did
 * @param {()=>Promise<string|null>} o.pickText a text file's contents, or null when cancelled
 * @param {()=>Promise<string>} [o.readClipboard] the clipboard's text (0.9.0: Paste code); rejects
 *   when the clipboard can't be read, and the screen opens a box to paste into instead
 * @param {()=>void} o.onImported the profile was replaced (the scene shows the new one)
 */
export function createSaveCodes({ ui, menuCtx, store, keeper, data, deliverFile, copy, pickText = pickTextFile, readClipboard = null, onImported }) {
  let screen = null;
  const say = (t) => screen?.say(t);

  async function exportCode() {
    try {
      const code = store.exportCode(keeper.profile);
      say('Saving...');
      const where = await deliverFile(stampName('save-code.txt'), code, 'text/plain');
      const copied = await copy(code).catch(() => false);
      say(`Save code saved to ${where}.${copied ? ' It is on the clipboard too.' : ''}`);
    } catch (e) {
      say(`Couldn't save the code: ${e?.message || e}`);
    }
  }

  async function importCode() {
    say('');
    const text = await pickText();
    if (text === null || text === undefined) return;   // cancelled: nothing happened, nothing to say
    importText(text);
  }

  /** Paste code (0.9.0): the clipboard's text, or a box to paste into when it can't be read. */
  async function pasteCode() {
    say('');
    let text = null;
    try { text = readClipboard ? await readClipboard() : null; } catch { text = null; }
    if (typeof text !== 'string') {
      screen?.showPasteBox?.();
      say('The clipboard couldn\'t be read here. Paste the code into the box with Ctrl+V.');
      return;
    }
    if (!text.trim()) { say('The clipboard is empty. Copy the whole code, then press Paste code again.'); ctxSound('ui_back'); return; }
    importText(text);
  }

  /** A code's text, from the clipboard, the box, or a file: what it holds, then the question. */
  function importText(text) {
    // A second tab of the web build saves nothing (app/tabguard.js): an import there would be lost.
    if (store.readOnly) { say('The game is open in another tab, so this one can\'t import. Import in the other tab.'); ctxSound('ui_back'); return; }
    let preview;
    try { preview = store.previewImport(text); } catch (e) { say(importErrorText(e)); ctxSound('ui_back'); return; }
    const ask = confirmScreen(menuCtx, {
      title: 'Replace progress?',
      text: `This code holds ${importSummaryText(preview.summary)}. Importing it replaces the progress here. The current save goes into the backups first.`,
      yes: 'Import', no: 'Cancel',
      onYes: async () => {
        ui.close(ask);
        const fitted = reconcileProfile(preview.doc, data).doc;
        const saved = await keeper.keep(fitted, { rotate: true });
        say(saved ? 'Imported.' : 'Imported. The save failed, so it is kept while the game is open and saves with the next change.');
        onImported?.();
      },
      onNo: () => { ui.close(ask); say(''); },
    });
    ui.push(ask);
  }

  const ctxSound = (n) => menuCtx.sound?.(n);

  return {
    /** Open the save code screen. */
    open() {
      screen = saveCodeScreen(menuCtx, {
        onExport: () => exportCode(),
        onImport: () => importCode(),
        onPaste: () => pasteCode(),
        onPasted: (text) => { if (typeof text === 'string' && text.trim()) importText(text); },
        onBack: () => { ui.close(screen); screen = null; },
      });
      ui.push(screen);
      return screen;
    },
    exportCode,
    importCode,
    pasteCode,
    importText,
    get screen() { return screen; },
  };
}
