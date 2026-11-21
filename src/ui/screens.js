// The menu layer (ARCHITECTURE §8): DOM screens stacked over the game, sized to the game view
// in game pixels, driven by the controller through the focus framework, with menu sounds.
//
// A screen is { el, scope?, onBack?(), onAction?(name, ui), update?(frameMs, input), onClose?(),
// ignoreMs? } where scope comes from createFocusScope. The top screen gets the input each frame:
// directions move focus, confirm presses, back backs out, and the other actions (reroll, banish,
// skip, pause, dash) go to onAction. Opening or closing a screen releases every held button, so a
// press can't carry over (and a screen can ask to ignore input for a moment, like the level-up
// cards' 300 ms).

import { h, fill } from './dom.js';
import { glyphFor } from '../input/glyphs.js';
import { termsIn, glossaryEntry, hardestTerm } from './glossary.js';
import { scrollStep } from './hints.js';

export function createUi({ root, input, doc = globalThis.document, sound = () => {} }) {
  const view = doc.createElement('div');
  view.className = 'ui-view';
  root.appendChild(view);
  const stack = [];
  let ignoreMs = 0;
  let promptStyle = null;
  let lastLayout = '';
  const listeners = new Set();
  let textScale = 1;
  // The glossary (0.9.0): the app says how to open it (setGlossary); the focused element's words
  // say which entry (ui/glossary.js termsIn), and a line in the corner says the button and the term.
  let glossary = null;          // { data, open(id|null) }
  const glossHint = doc.createElement('div');
  glossHint.className = 'gloss-hint';
  glossHint.hidden = true;
  view.appendChild(glossHint);
  let hintFor = null, hintTerm = null, hintHost = null;
  /** The term an element names (the first one in its words), or null. */
  // (Round 2, L3 2: an element that is one term, a card's tag chip, names its entry itself.)
  // (innerText where there is one: textContent runs a card's lines together, "SteelTag bonus", and no term matches across that.)
  const wordsOf = (el) => (typeof el.innerText === 'string' && el.innerText ? el.innerText : el.textContent || '');
  const termOf = (el) => (glossary && el ? (el.dataset?.term && glossaryEntry(glossary.data, el.dataset.term) ? el.dataset.term : hardestTerm(wordsOf(el), glossary.data)) : null);
  // Where the line goes (X6: in the view's corner it lay over a panel's corner): a line of the top
  // screen's own hint row, under its prompts, always there so the row never changes height as the
  // focus moves; the corner only for a screen with no hint row.
  function placeGlossHint(s) {
    const on = s && !s.isGlossary && !s.noGlossary;
    const el = on ? (s.scope?.current ?? null) : null;
    const host = on ? (s.el.querySelector?.('.hint') ?? null) : null;
    if (el === hintFor && host === hintHost && glossHint.parentNode === (host ?? view) && glossHint.dataset.style === String(promptStyle)) return;
    hintFor = el;
    hintHost = host;
    if (glossHint.parentNode !== (host ?? view)) (host ?? view).appendChild(glossHint);
    glossHint.classList.toggle('in-row', !!host);
    hintTerm = termOf(el);
    glossHint.dataset.style = String(promptStyle);
    const e = hintTerm ? glossaryEntry(glossary.data, hintTerm) : null;
    glossHint.classList.toggle('blank', !e);
    if (!e) { if (host) { glossHint.textContent = ' '; glossHint.hidden = false; } else glossHint.hidden = true; return; }
    fill(glossHint, ui.glyph('glossary'), ` Glossary: ${e.name}`);
    glossHint.hidden = false;
  }

  /** An action's button as the prompts print it: the bindings' (input.glyph), else the fixed table. */
  const glyphText = (style, action) => (typeof input.glyph === 'function' ? input.glyph(action, style) : glyphFor(style, action));
  let bindingsSeen = input.bindings ?? null;
  function relabel() {
    const style = input.promptStyle;
    promptStyle = style;
    bindingsSeen = input.bindings ?? null;
    for (const el of view.querySelectorAll('[data-glyph]')) el.textContent = glyphText(style, el.dataset.glyph);
  }

  function notify() { for (const f of listeners) f(stack.length ? stack[stack.length - 1] : null); }

  const ui = {
    view,
    /** Size the menu layer to the game view: `place` from the renderer (CSS px). */
    layout(place, viewW, viewH) {
      const key = `${place.x},${place.y},${place.scale},${viewW},${viewH}`;
      if (key === lastLayout) return;
      lastLayout = key;
      view.style.left = `${place.x}px`;
      view.style.top = `${place.y}px`;
      view.style.width = `${viewW * place.scale}px`;
      view.style.height = `${viewH * place.scale}px`;
      view.style.setProperty('--u', `${place.scale}px`);
      // Text scale (Settings, 0.9.0): the menus' type is sized in --uf, their boxes in --u.
      view.style.setProperty('--uf', `${place.scale * textScale}px`);
      // The same on the layer's root, for what sits beside the view (the status notice keeps
      // clear of the harbor's bottom-left panel with them).
      root.style?.setProperty?.('--u', `${place.scale}px`);
      root.style?.setProperty?.('--view-left', `${place.x}px`);
    },
    push(screen) {
      if (!screen || !screen.el) throw new Error('ui.push needs a screen with an element');
      stack.at(-1)?.el.classList.add('under');
      view.appendChild(screen.el);
      stack.push(screen);
      input.releaseAll();
      ignoreMs = screen.ignoreMs || 0;
      relabel();
      screen.scope?.refresh();
      notify();
      return screen;
    },
    /** Close the top screen (or a given one, wherever it is in the stack). */
    close(screen = stack.at(-1)) {
      const i = stack.indexOf(screen);
      if (i < 0) return;
      stack.splice(i, 1);
      screen.scope?.destroy();
      screen.el.remove();
      screen.onClose?.();
      stack.at(-1)?.el.classList.remove('under');
      input.releaseAll();
      ignoreMs = 0;
      stack.at(-1)?.scope?.refresh();
      notify();
    },
    closeAll() { while (stack.length) ui.close(); },
    /** The menus' text size: 1, 1.25, or 1.5 times (Settings, Text size). */
    setTextScale(n) {
      const v = [1, 1.25, 1.5].includes(Number(n)) ? Number(n) : 1;
      if (v === textScale) return;
      textScale = v;
      const u = parseFloat(view.style.getPropertyValue('--u')) || 0;
      if (u) view.style.setProperty('--uf', `${u * textScale}px`);
      root.style?.setProperty?.('--ts', String(textScale));
      view.classList.toggle('text-big', textScale > 1);
    },
    get textScale() { return textScale; },
    /**
     * How the glossary opens: data (the bundle with its glossary) and open(id), the app's (it
     * pushes the screen). Any screen's focused element that names a term opens its entry.
     */
    setGlossary(g) { glossary = g; hintFor = undefined; },
    /** Open the glossary at the first term in `text` (or its first entry). */
    openGlossary(text = '') {
      if (!glossary || stack.some((x) => x.isGlossary)) return false;
      glossary.open(typeof text === 'string' ? termsIn(text, glossary.data)[0] ?? null : null);
      return true;
    },
    get top() { return stack.at(-1) || null; },
    get open() { return stack.length > 0; },
    has(pred) { return stack.some(pred); },
    onChange(f) { listeners.add(f); return () => listeners.delete(f); },
    /** Run the top screen for one frame. Returns true if a screen had the input. */
    update(frameMs) {
      if (input.promptStyle !== promptStyle || (input.bindings ?? null) !== bindingsSeen) relabel();
      const s = stack.at(-1);
      if (glossary) placeGlossHint(s);
      if (!s) return false;
      s.update?.(frameMs, input);
      if (ignoreMs > 0) { ignoreMs -= frameMs; return true; }
      if (stack.at(-1) !== s) return true; // update() closed it
      // Menu sounds for every screen: a move that went somewhere, a press that pressed, a back.
      for (const d of ['up', 'down', 'left', 'right']) {
        // (A focused scroll box scrolls before the focus leaves it: ui/hints.js scrollStep.)
        if (input.nav(d) && !s.onNav?.(d) && (scrollStep(s.scope?.current, d) || s.scope?.move(d))) sound('ui_move');
      }
      let backed = false;
      if (input.fired('confirm')) {
        if (!s.onAction?.('confirm', ui) && s.scope?.press()) sound('ui_confirm');
      } else if (input.fired('back') && s.onBack) {
        // A screen's onBack returns false when Back does nothing there (a pick whose Back only
        // keeps the focus on the cards): then the same press may still pause (Esc is both on the
        // keyboard; the sweep, S3b F6). Anything else counts as handled.
        backed = s.onBack() !== false;
        if (backed) sound('ui_back');
      }
      // The glossary's button: the focused element's term, else the screen's first.
      if (glossary && !s.isGlossary && input.fired('glossary') && !s.onAction?.('glossary', ui)) {
        const id = hintTerm ?? hardestTerm(wordsOf(s.el), glossary.data);
        sound('ui_confirm');
        glossary.open(id);
        return true;
      }
      for (const a of ['reroll', 'banish', 'skip', 'pause']) {
        if (stack.at(-1) !== s) break;
        // Esc is both Back and Pause on the keyboard: one press does one thing.
        if (a === 'pause' && backed) continue;
        if (input.fired(a)) s.onAction?.(a, ui);
      }
      return true;
    },
    /** Rewrite button prompts (after a settings change). */
    relabel,
    /** A button prompt that follows the controller: <span class="glyph">✕</span>. */
    glyph(action) { return h('span', { class: 'glyph', data: { glyph: action } }, glyphText(input.promptStyle, action)); },
    doc,
  };
  return ui;
}
