// Controller navigation (ARCHITECTURE §8): every interactive element on a screen registers with
// the screen's focus scope. A direction moves focus to the nearest element that way (explicit
// overrides where the layout needs them), focus is always visible, confirm presses the focused
// element, and back always backs out. The mouse works too: hovering moves focus.
//
// The geometry (pickInDirection) is pure and tested; the scope wraps it around DOM elements.

/**
 * The index of the best candidate in direction `dir` from `from`, or -1.
 * Rects are { x, y, w, h }. A candidate must lie in that direction (its center past the
 * current center); among those, the nearest wins, with sideways distance counting double so
 * that "down" prefers the element straight below over one far off to the side.
 */
export function pickInDirection(from, rects, dir) {
  const fx = from.x + from.w / 2, fy = from.y + from.h / 2;
  let best = -1, bestScore = Infinity;
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    if (r === from) continue;
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    const dx = cx - fx, dy = cy - fy;
    let along, side;
    switch (dir) {
      case 'up': along = -dy; side = Math.abs(dx); break;
      case 'down': along = dy; side = Math.abs(dx); break;
      case 'left': along = -dx; side = Math.abs(dy); break;
      case 'right': along = dx; side = Math.abs(dy); break;
      default: throw new Error(`pickInDirection: unknown direction "${dir}"`);
    }
    if (along <= 1) continue;
    // Overlapping spans on the cross axis (a row of cards, a column of buttons) count as aligned.
    const overlap = dir === 'up' || dir === 'down'
      ? Math.min(from.x + from.w, r.x + r.w) - Math.max(from.x, r.x)
      : Math.min(from.y + from.h, r.y + r.h) - Math.max(from.y, r.y);
    const score = along + (overlap > 0 ? 0 : side * 2);
    if (score < bestScore) { bestScore = score; best = i; }
  }
  return best;
}

const DIRS = ['up', 'down', 'left', 'right'];

/**
 * A focus scope over one screen's element. Focusable elements carry `data-focus`; an element
 * can name its neighbors with data-nav-up / -down / -left / -right (the other element's
 * data-focus value). Disabled elements (aria-disabled="true") can hold focus but don't press.
 */
export function createFocusScope(root, { initial = null, onFocus = null } = {}) {
  let current = null;
  const list = () => [...root.querySelectorAll('[data-focus]')].filter((el) => !el.hidden && el.offsetParent !== null);
  function set(el) {
    if (!el || el === current) return;
    current?.classList.remove('focused');
    current = el;
    el.classList.add('focused');
    el.scrollIntoView?.({ block: 'nearest' });
    onFocus?.(el);
  }
  function onHover(e) {
    const el = e.target.closest?.('[data-focus]');
    if (el && root.contains(el)) set(el);
  }
  root.addEventListener('mousemove', onHover);
  const scope = {
    get current() { return current; },
    focus(el) { set(el); },
    focusKey(key) { const el = root.querySelector(`[data-focus="${CSS.escape(key)}"]`); if (el) set(el); return !!el; },
    /**
     * Keep the focus where it was: the same element, or (a screen that redrew itself) the one with
     * the same data-focus key. Otherwise the first element (or `initial`).
     */
    refresh() {
      const els = list();
      if (current && els.includes(current)) return;
      const key = current?.dataset.focus;
      current = null;
      const next = (key && els.find((e) => e.dataset.focus === key)) || (initial && els.find((e) => e.dataset.focus === initial)) || els[0];
      if (next) set(next);
    },
    move(dir) {
      if (!DIRS.includes(dir)) return false;
      const els = list();
      if (!els.length) return false;
      if (!current || !els.includes(current)) { set(els[0]); return true; }
      const named = current.dataset[`nav${dir[0].toUpperCase()}${dir.slice(1)}`];
      if (named) {
        const t = els.find((e) => e.dataset.focus === named);
        if (t) { set(t); return true; }
      }
      const rects = els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
      const i = pickInDirection(rects[els.indexOf(current)], rects, dir);
      if (i < 0) return false;
      set(els[i]);
      return true;
    },
    /** Press the focused element. Returns false when there is nothing to press. */
    press() {
      if (!current || current.getAttribute('aria-disabled') === 'true') return false;
      current.click();
      return true;
    },
    destroy() { root.removeEventListener('mousemove', onHover); },
  };
  return scope;
}
