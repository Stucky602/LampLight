// Two pieces every screen shares (0.7.3): the hint row of button prompts along a screen's foot,
// and the "N more" bands over a list that scrolls.
//
// The hint row: one helper, so every screen says its buttons the same way, with the glyph of the
// controller in use (ui.glyph follows it) and the same spacing: hintRow(ctx, ['confirm', 'Select'],
// ['back', 'Back']). A plain string is a label without a button.
//
// The bands: a list that scrolls snaps to whole rows (the focused row never sits half out of view,
// and the top row is always whole), and a solid band above and below says how many rows are out
// of view that way ("3 more"). No gradient fades: a band is a plain bar. The focus scope calls the
// list's update when it moves (ui/focus.js), and a scroll by the mouse wheel updates the counts.

import { h } from './dom.js';

/** The hint row: [action, label] pairs (a button's glyph, then what it does) and plain strings. */
export function hintRow(ctx, ...parts) {
  const out = [];
  parts.filter(Boolean).forEach((p, i) => {
    if (i > 0) out.push('   ');
    out.push(Array.isArray(p) ? [ctx.ui.glyph(p[0]), ` ${p[1]}`] : p);
  });
  return h('div', { class: 'hint' }, ...out);
}

/** The rows a band counts: a list's children that take focus or are list rows (not its headings). */
function rowsOf(list) {
  return [...list.children].filter(isRow);
}
function isRow(el) {
  return !el.hidden && (el.dataset?.focus !== undefined || el.classList?.contains('list-row') || el.classList?.contains('set-row'));
}

/**
 * How many rows sit out of view above and below, from rects ({ top, bottom }): a row counts as out
 * when any part of it is (half a row is not a row you can read). Pure; tested.
 */
export function bandCounts(view, rows) {
  let above = 0, below = 0;
  for (const r of rows) {
    if (r.bottom - r.top <= 0) continue;
    if (r.top < view.top - 0.5) above++;
    else if (r.bottom > view.bottom + 0.5) below++;
  }
  return { above, below };
}

/**
 * Where to scroll a list so `focused` (a rect) is whole in view and the top row is whole: the
 * change in scrollTop (0 when nothing moves). `rows`: every row's rect, in order. Pure; tested.
 */
export function snapScroll(view, rows, focused) {
  let dy = 0;
  if (focused.top < view.top - 0.5) dy = focused.top - view.top;
  else if (focused.bottom > view.bottom + 0.5) dy = focused.bottom - view.bottom;
  else return 0;
  // After the move, a row cut by the top edge scrolls out whole (down) or in whole (up).
  const top = view.top + dy;
  const cut = rows.find((r) => r.top < top - 0.5 && r.bottom > top + 0.5);
  if (cut) dy = dy > 0 ? cut.bottom - view.top : cut.top - view.top;
  return dy;
}

/**
 * A scrolling list with its bands: returns the wrapper to put on the screen (the list keeps its
 * class, so a redraw can find it). attrs: the list's attributes ({ class: 'list' }).
 */
export function bandList(attrs, ...rows) {
  const list = h('div', attrs, ...rows);
  const up = h('div', { class: 'list-band up' });
  const down = h('div', { class: 'list-band down' });
  const wrap = h('div', { class: 'banded', data: { bands: '1' } }, up, list, down);
  const rect = (el) => el.getBoundingClientRect();
  const update = (focused = null) => {
    const view = rect(list);
    if (focused && list.contains(focused)) {
      const dy = snapScroll(view, rowsOf(list).map(rect), rect(focused));
      if (dy) list.scrollTop = Math.max(0, (list.scrollTop || 0) + dy);
    }
    const v = rect(list);
    // A heading (not a row) the list's edge cuts through is hidden until it scrolls in whole (C3:
    // at 150% text the Settings list left a group's heading half showing over its band).
    for (const el of list.children) {
      if (isRow(el) || el.hidden) continue;
      const r = rect(el);
      el.classList?.toggle('band-cut', (r.top < v.top - 0.5 && r.bottom > v.top + 0.5) || (r.top < v.bottom - 0.5 && r.bottom > v.bottom + 0.5));
    }
    const { above, below } = bandCounts(v, rowsOf(list).map(rect));
    up.textContent = above ? `${above} more` : '';
    down.textContent = below ? `${below} more` : '';
    up.classList.toggle('on', above > 0);
    down.classList.toggle('on', below > 0);
  };
  wrap.bands = { list, update };
  list.addEventListener('scroll', () => update());
  // Once it's on the screen and laid out (a first update can come before that, with no sizes): the
  // counts and any cut heading, again (C3).
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(() => update()));
  return wrap;
}

/**
 * A part that scrolls as one focus stop (the sweep, X6: the Stats screen's columns and the run end's
 * numbers, text with nothing in it to focus): it takes focus as a whole, Up and Down scroll it while
 * it can (ui/screens.js, `data-scroll`), and its bands count the lines out of view ("4 more"). Returns
 * the wrapper to put on the screen; `key` is its focus key.
 */
export function scrollBox(key, attrs, ...children) {
  const list = h('div', { ...attrs, class: `${attrs?.class ?? ''} scroll-box`.trim(), data: { focus: key, scroll: '1' }, 'aria-disabled': 'true' }, ...children);
  const up = h('div', { class: 'list-band up' });
  const down = h('div', { class: 'list-band down' });
  const wrap = h('div', { class: 'banded', data: { bands: '1' } }, up, list, down);
  const update = () => {
    if (typeof list.getBoundingClientRect !== 'function' || typeof list.querySelectorAll !== 'function') return;
    const v = list.getBoundingClientRect();
    if (!(v.height > 0)) return;   // (not laid out: nothing to count)
    const lines = [...list.querySelectorAll(SCROLL_LINES)].map((e) => e.getBoundingClientRect());
    const { above, below } = bandCounts(v, lines);
    up.textContent = above ? `${above} more` : '';
    down.textContent = below ? `${below} more` : '';
    up.classList.toggle('on', above > 0);
    down.classList.toggle('on', below > 0);
  };
  wrap.bands = { list, update };
  list.addEventListener('scroll', () => update());
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(() => update()));
  return wrap;
}
/** What a scroll box's bands count as a line. */
const SCROLL_LINES = 'dt, h2, .mat, .card-title, .card-desc, .card-note, .recap-line, .recap-killer, .dmg-name';

/**
 * Scroll a focused scroll box (scrollBox) one step up or down. Returns true when it moved (the press
 * is used up), false at its end (the focus moves on, as from any other element).
 */
export function scrollStep(el, dir) {
  if (!el || (dir !== 'up' && dir !== 'down')) return false;
  if (el.dataset?.scroll === '1') {
    if (!(el.scrollHeight > el.clientHeight + 1)) return false;
    const before = el.scrollTop;
    const step = Math.max(16, Math.round(el.clientHeight * 0.6));
    el.scrollTop = Math.max(0, before + (dir === 'down' ? step : -step));
    if (el.scrollTop === before) return false;
    el.closest?.('[data-bands]')?.bands?.update();
    return true;
  }
  // In a list or part that scrolls: a row taller than the view (a weapon's numbers on Stats at a big
  // text size) is read to its end, a step at a time, before the focus moves on; and from the last row
  // (or the first) the rest of the part (a heading, a "None" under it) scrolls into view.
  // (The list first, then a part that scrolls around it: the results' news inside what the run brought.)
  const B = el.closest?.('[data-bands]')?.bands;
  if (B?.list && scrollIn(el, B.list, dir)) { B.update(); return true; }
  const give = el.closest?.('.give');
  return !!give && scrollIn(el, give, dir);
}

/** scrollStep's move in one container (a banded list or a .give part). */
function scrollIn(el, list, dir) {
  if (typeof el.getBoundingClientRect !== 'function' || !(list.scrollHeight > list.clientHeight + 1)) return false;
  const v = list.getBoundingClientRect(), r = el.getBoundingClientRect();
  const step = Math.max(16, Math.round(list.clientHeight * 0.6));
  const rows = [...list.querySelectorAll('[data-focus]')].filter((e) => !e.hidden && e.offsetParent !== null);
  const k = rows.indexOf(el);
  const edge = dir === 'down' ? k === rows.length - 1 : k === 0;
  let dy = 0;
  if (dir === 'down' && r.bottom > v.bottom + 1) dy = Math.min(step, r.bottom - v.bottom);
  else if (dir === 'up' && r.top < v.top - 1) dy = -Math.min(step, v.top - r.top);
  else if (edge) dy = dir === 'down' ? step : -step;
  if (!dy) return false;
  const before = list.scrollTop;
  list.scrollTop = Math.max(0, Math.min(list.scrollHeight - list.clientHeight, before + dy));
  return list.scrollTop !== before;
}
