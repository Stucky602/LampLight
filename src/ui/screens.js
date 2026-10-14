// The menu layer (ARCHITECTURE §8): DOM screens stacked over the game, sized to the game view
// in game pixels, driven by the controller through the focus framework, with menu sounds.
//
// A screen is { el, scope?, onBack?(), onAction?(name, ui), update?(frameMs, input), onClose?(),
// ignoreMs? } where scope comes from createFocusScope. The top screen gets the input each frame:
// directions move focus, confirm presses, back backs out, and the other actions (reroll, banish,
// skip, pause, dash) go to onAction. Opening or closing a screen releases every held button, so a
// press can't carry over (and a screen can ask to ignore input for a moment, like the level-up
// cards' 300 ms).

import { h } from './dom.js';
import { glyphFor } from '../input/glyphs.js';

export function createUi({ root, input, doc = globalThis.document, sound = () => {} }) {
  const view = doc.createElement('div');
  view.className = 'ui-view';
  root.appendChild(view);
  const stack = [];
  let ignoreMs = 0;
  let promptStyle = null;
  let lastLayout = '';
  const listeners = new Set();

  function relabel() {
    const style = input.promptStyle;
    promptStyle = style;
    for (const el of view.querySelectorAll('[data-glyph]')) el.textContent = glyphFor(style, el.dataset.glyph);
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
    get top() { return stack.at(-1) || null; },
    get open() { return stack.length > 0; },
    has(pred) { return stack.some(pred); },
    onChange(f) { listeners.add(f); return () => listeners.delete(f); },
    /** Run the top screen for one frame. Returns true if a screen had the input. */
    update(frameMs) {
      if (input.promptStyle !== promptStyle) relabel();
      const s = stack.at(-1);
      if (!s) return false;
      s.update?.(frameMs, input);
      if (ignoreMs > 0) { ignoreMs -= frameMs; return true; }
      if (stack.at(-1) !== s) return true; // update() closed it
      // Menu sounds for every screen: a move that went somewhere, a press that pressed, a back.
      for (const d of ['up', 'down', 'left', 'right']) {
        if (input.nav(d) && !s.onNav?.(d) && s.scope?.move(d)) sound('ui_move');
      }
      let backed = false;
      if (input.fired('confirm')) {
        if (!s.onAction?.('confirm', ui) && s.scope?.press()) sound('ui_confirm');
      } else if (input.fired('back') && s.onBack) {
        sound('ui_back');
        s.onBack();
        backed = true;
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
    glyph(action) { return h('span', { class: 'glyph', data: { glyph: action } }, glyphFor(input.promptStyle, action)); },
    doc,
  };
  return ui;
}
