// The tuning panel (ARCHITECTURE §15): hold Create (View on Xbox) for a second, or F1. Every value
// it's given with left/right to change it live, "Copy tuning" for what changed, "Reset", and the
// scene's dev commands. A run opens it with the run's tuning and its commands (spawn, jump, give,
// level, god mode), paused; the harbor with the harbor's tuning and its own (add materials,
// unlock everything).
//
// The panel only reports what the player asked for (onTune, a command's run, onCopy, onReset);
// the scene makes the change (a run turns them into logged decisions, so a tuned run still
// replays exactly).

import { h, fill } from './dom.js';
import { createFocusScope } from './focus.js';
import { flattenTuning, stepFor, tidy, START_ONLY } from './tuningmodel.js';

function row(key, label, cls = '') {
  return h('div', { class: `set-row ${cls}`, data: { focus: key } });
}

/**
 * @param {object} o
 * @param {object} o.defaults the tuning as the data has it (data/tuning.js)
 * @param {object} o.current the live tuning, the same shape
 * @param {Array} o.commands the dev commands, in order: { key, label, run() }, a chooser
 *   { key, label, items: [{ id, name }], run(item) }, or a heading { heading }. `label` may be a
 *   function (redrawn after each press); `run` returns the sentence the panel shows.
 * @param {string} o.intro the panel's first line
 */
export function tuningScreen(ctx, { defaults, current, commands = [], intro, onTune, onCopy, onReset, onClose }) {
  const note = h('div', { class: 'tuning-note' });
  const list = h('div', { class: 'settings-list' });
  const rows = [];   // { key, kind, draw(), step(dir), press() }
  const defs = new Map(flattenTuning(defaults).map((r) => [r.path, r.value]));
  const live = current;

  function say(text) { note.textContent = text; }

  function action(key, label, fn) {
    const el = row(key, label);
    const text = () => (typeof label === 'function' ? label() : label);
    const draw = () => fill(el, h('span', { class: 'set-label' }, text()));
    draw();
    const press = () => { fn(); draw(); };
    el.addEventListener('click', press);
    rows.push({ key, el, press });
    return el;
  }

  function chooser(key, label, items, fn) {
    let i = 0;
    const el = row(key, label);
    const text = () => (typeof label === 'function' ? label() : label);
    const draw = () => fill(el, h('span', { class: 'set-label' }, text()), h('span', { class: 'set-value' }, '< ', items[i]?.name ?? '-', ' >'));
    draw();
    const press = () => { if (items[i]) fn(items[i]); draw(); };
    el.addEventListener('click', press);
    rows.push({ key, el, step(d) { if (!items.length) return; i = (i + d + items.length) % items.length; draw(); }, press });
    return el;
  }

  function valueRow(r) {
    const el = row(`t:${r.path}`, r.path);
    const def = defs.get(r.path);
    const step = typeof def === 'number' ? stepFor(def) : null;
    const draw = () => {
      const v = r.value;
      el.classList.toggle('changed', v !== def);
      fill(el, h('span', { class: 'set-label' }, START_ONLY.has(r.path) ? `${r.key} (next run)` : r.key), h('span', { class: 'set-value' }, typeof v === 'boolean' ? (v ? '< On >' : '< Off >') : `< ${v} >`));
    };
    draw();
    const change = (d) => {
      const v = typeof r.value === 'boolean' ? !r.value : tidy(r.value + d * step);
      const err = onTune(r.path, v);
      if (err) { say(err); return; }
      r.value = v;
      say(`${r.path}: ${v}${v !== def ? `   (default ${def})` : ''}`);
      draw();
    };
    el.addEventListener('click', (e) => change(e.offsetX < el.clientWidth * 0.55 ? -1 : 1));
    rows.push({ key: `t:${r.path}`, el, step: change, press: () => change(1), redraw: (v) => { r.value = v; draw(); } });
    return el;
  }

  // A command's answer: a sentence, or a promise of one.
  const answer = (r) => {
    if (r && typeof r.then === 'function') { say('Working...'); r.then(say, (e) => say(String(e?.message || e))); } else say(r);
  };
  // Actions and dev commands first, then every value by group.
  list.append(
    action('copy', 'Copy tuning (what you changed)', () => answer(onCopy())),
    action('reset', 'Reset every value to the default', () => { onReset(); for (const r of flattenTuning(defaults)) rows.find((x) => x.key === `t:${r.path}`)?.redraw?.(r.value); say('Back to the defaults.'); }),
    action('close', 'Close', () => onClose()),
    h('div', { class: 'tuning-group' }, 'Dev commands'),
  );
  for (const c of commands) {
    if (c.heading) list.append(h('div', { class: 'tuning-group' }, c.heading));
    else if (c.items) list.append(chooser(c.key, c.label, c.items, (it) => answer(c.run(it))));
    else list.append(action(c.key, c.label, () => answer(c.run())));
  }
  let group = null;
  for (const r of flattenTuning(live)) {
    if (r.group !== group) { group = r.group; list.append(h('div', { class: 'tuning-group' }, group)); }
    list.append(valueRow(r));
  }
  const el = h('div', { class: 'screen tuning-screen' }, h('div', { class: 'panel' }, h('h1', null, 'Tuning'), note, list));
  const scope = createFocusScope(el, { initial: 'copy' });
  const find = () => rows.find((x) => x.el === scope.current);
  say(intro ?? 'Left and right change a value.');
  return {
    el, scope,
    onBack: onClose,
    onNav(d) {
      const r = find();
      if (r?.step && (d === 'left' || d === 'right')) { r.step(d === 'left' ? -1 : 1); return true; }
      return false;
    },
    onAction(a) {
      if (a === 'confirm') { const r = find(); if (r?.press) { r.press(); return true; } }
      if (a === 'pause') { onClose(); return true; }
      return false;
    },
  };
}
