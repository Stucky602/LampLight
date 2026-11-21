// A character's skill tree, at the Tavern (ruling 15; meta/skills.js treeView). One plain screen:
// four rows (the builds fork with each build's follow-up under it, the tree's two named forks, the
// free skills), one line under the tree for the skill in focus (what it changes, what it closes,
// why it can't be taken), the character's ledger, and Reset. Controller-first: the stick moves
// between skills, confirm held for half a second takes the one in focus (a tap says so; a click
// asks to be clicked again), and back leaves.
//
// ctx: { ui, icon, sound }. get() -> { doc }. onAct(name, ...args) runs a harbor action (app/scenes/hub.js).

import { h, fill } from './dom.js';
import { createFocusScope } from './focus.js';
import { hintRow } from './hints.js';
import { costRow } from './hubscreens.js';
import { treeView, whyNotReset } from '../meta/skills.js';
import { masteryOf } from '../meta/state.js';
import { ledgerLines } from './hubtext.js';

const HOLD_MS = 500;
const STATE_WORD = { held: 'Taken', closed: 'Closed', locked: 'Locked', needs: 'Needs another', points: '', open: '' };

export function skillsScreen(ctx, { data, character, get, onAct, onClose }) {
  const panelEl = h('div', { class: 'panel' });
  const el = h('div', { class: 'screen building-screen skills-screen' }, panelEl);
  const about = h('div', { class: 'skill-about' });
  const note = h('div', { class: 'bld-note' });
  const fillBar = h('span', { class: 'hold-fill' });
  let view = null, armed = null, held = 0, took = false;
  const say = (text) => { note.textContent = text || ''; };
  const find = (id) => view.rows.flatMap((r) => r.skills).find((s) => s.id === id) ?? null;

  /** The line under the tree for the thing in focus. */
  function describe(key) {
    armed = null; held = 0; fillBar.style.width = '0';
    const s = key?.startsWith('s:') ? find(key.slice(2)) : null;
    if (!s) { fill(about, h('div', { class: 'row-desc' }, key === 'reset' ? 'Give every point back, to spend again.' : '')); return; }
    fill(about,
      h('div', { class: 'row-top' }, h('span', { class: 'row-name' }, s.name), h('span', { class: 'row-rank' }, STATE_WORD[s.state])),
      h('div', { class: 'row-desc' }, s.desc),
      s.closes.length && !s.held ? h('div', { class: 'row-adds' }, `Taking it closes ${s.closes.join(' and ')}.`) : null,
      s.needs && !s.held ? h('div', { class: 'row-adds' }, `Needs ${find(s.needs)?.name}.`) : null,
      s.why ? h('div', { class: 'why' }, `${s.why}.`) : (s.held ? null : h('div', { class: 'row-ready hold' }, fillBar, 'Hold to take')));
  }

  function take(id) {
    took = true;
    onAct('skill', id);
    draw();
    scope.focusKey(`s:${id}`);
  }

  function box(s) {
    return h('div', {
      class: `skill-box ${s.state}`, data: { focus: `s:${s.id}`, why: s.why },
      onclick: () => {
        if (s.held) return;
        if (s.why) { say(`${s.why}.`); ctx.sound?.('ui_back'); return; }
        if (armed === s.id) take(s.id); else { armed = s.id; say('Click again to take it.'); }
      },
    }, h('span', { class: 'skill-name' }, s.name), STATE_WORD[s.state] ? h('span', { class: 'skill-state' }, STATE_WORD[s.state]) : null);
  }

  function draw() {
    const { doc } = get();
    view = treeView(doc, data, character);
    const c = data.characters.find((x) => x.id === character), m = masteryOf(doc, data, character), P = view.points;
    const rows = [];
    for (const r of view.rows) {
      const line = h('div', { class: 'skill-line' });
      if (r.row === 'build') {
        // Two builds side by side, a double bar between them, each with its follow-up under it.
        const tops = r.skills.filter((s) => s.rival), cols = tops.map((t) => h('div', { class: 'skill-col' }, box(t), h('div', { class: 'skill-stem' }), ...r.skills.filter((s) => s.needs === t.id).map(box)));
        fill(line, cols[0], h('div', { class: 'skill-fork' }, 'or'), cols[1]);
      } else if (r.row === 'free') {
        // Free skills; one that needs another sits right after it, joined by a bar.
        const firsts = r.skills.filter((s) => !s.needs);
        fill(line, ...firsts.flatMap((s) => { const next = r.skills.filter((x) => x.needs === s.id); return next.length ? [h('div', { class: 'skill-chain' }, box(s), h('div', { class: 'skill-link' }), ...next.map(box))] : [box(s)]; }));
      } else fill(line, box(r.skills[0]), h('div', { class: 'skill-fork' }, 'or'), box(r.skills[1]));
      rows.push(h('div', { class: 'skill-row' }, h('div', { class: 'skill-label' }, r.label), line));
    }
    const resetWhy = whyNotReset(doc, data, character);
    const ledger = ledgerLines(doc, data, character);
    fill(panelEl,
      h('div', { class: 'bld-head' }, h('h1', null, `${c.name}: skills`),
        h('div', { class: 'bld-level' }, `Mastery rank ${m.rank}. ${P.spent} of ${P.earned} ${P.earned === 1 ? 'point' : 'points'} spent${nextLine(P)}.`)),
      h('div', { class: 'skill-tree' }, ...rows),
      about,
      ledger.length ? h('div', { class: 'skill-ledger' }, h('div', { class: 'skill-label' }, 'Ledger'), ...ledger.map((l) => h('div', { class: 'row-desc' }, l))) : null,
      h('div', { class: 'action-row' },
        h('button', { class: `btn${resetWhy ? ' off' : ''}`, type: 'button', data: { focus: 'reset', why: resetWhy }, onclick: () => { if (resetWhy) { say(`${resetWhy}.`); ctx.sound?.('ui_back'); } else { onAct('skillReset', character); draw(); scope.focusKey('reset'); } } },
          'Reset the tree', P.spent ? costRow(ctx, data, view.reset, doc.profile.materials) : null),
        h('button', { class: 'btn', type: 'button', data: { focus: 'back' }, onclick: () => onClose() }, 'Back')),
      note,
      hintRow(ctx, ['confirm', 'Hold to take'], ['back', 'Back']));
    scope.refresh();
    describe(scope.current?.dataset.focus);
  }

  const scope = createFocusScope(el, { initial: null, onFocus: (f) => { if (view) describe(f.dataset.focus); } });
  draw();
  const first = view.rows[0].skills[0];
  scope.focusKey(`s:${first.id}`);
  return {
    el, scope, onBack: onClose, refresh: draw, say,
    /** Confirm held on a skill that can be taken takes it; the bar under the tree fills meanwhile. */
    update(frameMs, input) {
      const key = scope.current?.dataset.focus, s = key?.startsWith('s:') ? find(key.slice(2)) : null;
      if (!input.down('confirm')) { took = false; held = 0; fillBar.style.width = '0'; return; }
      if (!s || s.held || s.why || took) return;
      held += frameMs;
      fillBar.style.width = `${Math.min(100, Math.round((held / HOLD_MS) * 100))}%`;
      if (held >= HOLD_MS) take(s.id);
    },
    onAction(action) {
      if (action !== 'confirm') return false;
      const key = scope.current?.dataset.focus;
      if (!key?.startsWith('s:')) return false;        // Reset and Back press as buttons do
      const s = find(key.slice(2));
      if (s?.why) { say(`${s.why}.`); ctx.sound?.('ui_back'); }
      return true;                                      // a tap never takes: the hold does (update)
    },
  };
}

/** The rank the next skill point comes at, as the end of the screen's first line. */
function nextLine(P) { return P.nextRank === null ? '' : `. The next point comes at rank ${P.nextRank}`; }
