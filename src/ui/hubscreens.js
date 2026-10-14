// The harbor's screens (ARCHITECTURE §10.4, §10.2 step 5): a building's panel (restore its next
// level; the Lamp Post's upgrades, the Library's research, who has come to the Tavern), the gate
// (choose who sets out), the results after a run, and the harbor's menu. Each builds a screen for
// ui.push() from plain data and callbacks; the app layer does the buying and saving.
//
// Something you can't do yet still takes focus and a press: it shows dimmed with the reason under
// it, and pressing it says the reason (with the menu's "no" sound) instead of doing nothing.
//
// ctx: { ui, icon(id, scale) -> element, sound(name) }.

import { h, fill } from './dom.js';
import { createFocusScope } from './focus.js';
import { levelEffects, researchState, upgradeState, runsText, changeLines, optionText, joinsTexts } from './hubtext.js';
import { levelOf, contentFrom } from '../meta/state.js';
import { nextLevelCost, nextRankCost, whyNotRestore, whyNotUpgrade, whyNotResearch } from '../meta/actions.js';

function button(label, key, onClick, { cls = '' } = {}) {
  return h('button', { class: `btn ${cls}`, type: 'button', data: { focus: key }, onclick: () => onClick() }, label);
}

/**
 * A button or a list row you press. With `why` (the sentence for why it can't be done now) it
 * shows dimmed, carries the sentence (data-why), and pressing it calls refuse(why) instead.
 */
function pressable(tag, { cls, key, why, onClick, refuse }, ...children) {
  return h(tag, {
    class: `${cls}${why ? ' off' : ''}`, type: tag === 'button' ? 'button' : null, data: { focus: key, why },
    onclick: () => (why ? refuse(why) : onClick()),
  }, ...children);
}

function hint(ctx, ...parts) {
  return h('div', { class: 'hint' }, ...parts.map((p) => (Array.isArray(p) ? [ctx.ui.glyph(p[0]), ` ${p[1]}`] : p)));
}

/** A cost as icons and counts; what you can't cover yet is marked. */
export function costRow(ctx, data, cost, have) {
  return h('div', { class: 'cost' }, ...Object.entries(cost).map(([id, n]) => {
    const m = data.materials.find((x) => x.id === id);
    const short = (have?.[id] ?? 0) < n;
    return h('span', { class: `cost-item${short ? ' short' : ''}`, title: m?.name ?? id }, ctx.icon(m?.icon ?? '', 1), ` ${n}`);
  }));
}

/** A thin bar for how close a cost is (0..1). */
function progressBar(p) {
  return h('span', { class: 'meter' }, h('span', { class: 'meter-fill', style: { width: `${Math.round(Math.max(0, Math.min(1, p)) * 100)}%` } }));
}

// ---------------------------------------------------------------- a building's panel

/**
 * The panel at a building's door. get(): { doc } the profile now (it changes as you buy).
 * onRestore(), onUpgrade(id), onResearch(id): do it (the app saves); the panel redraws itself
 * with refresh() after.
 */
export function buildingScreen(ctx, { data, building, get, onRestore, onUpgrade, onResearch, onClose }) {
  const b = data.buildings.find((x) => x.id === building);
  const head = h('div', { class: 'bld-head' });
  const left = h('div', { class: 'bld-col bld-next' });
  const right = h('div', { class: 'bld-col bld-list' });
  const note = h('div', { class: 'bld-note' });
  const el = h('div', { class: `screen building-screen bld-${building}` },
    h('div', { class: 'panel' }, head, h('div', { class: 'bld-body' }, left, right), note, hint(ctx, ['confirm', 'Select'], '   ', ['back', 'Back'])));
  const scope = createFocusScope(el, { initial: 'restore' });
  const say = (text) => { note.textContent = text || ''; };
  const refuse = (why) => { say(why); ctx.sound?.('ui_back'); };

  function draw() {
    const { doc } = get();
    const have = doc.profile.materials;
    const lv = levelOf(doc, building, data);
    // A purchase redraws both columns: the list keeps its scroll, and the focus its row (by key).
    const scroll = right.querySelector('.list')?.scrollTop ?? 0;
    fill(head, h('h1', null, b.name), h('div', { class: 'bld-level' }, lv === 0 ? 'Ruined' : `Lv ${lv}/${b.levels.length}`), h('p', { class: 'bld-desc' }, b.desc));
    // The next level.
    const cost = nextLevelCost(doc, data, building);
    if (!cost) fill(left, h('h2', null, 'Fully restored'));
    else {
      const why = whyNotRestore(doc, data, building);
      fill(left,
        h('h2', null, lv === 0 ? 'Restore' : `Next: Lv ${lv + 1}`),
        h('ul', { class: 'effects' }, ...levelEffects(data, building, lv + 1).map((e) => h('li', null, e.text))),
        costRow(ctx, data, cost, have),
        pressable('button', { cls: 'btn wide', key: 'restore', why, onClick: () => onRestore(), refuse }, 'Restore'),
        why ? h('div', { class: 'why' }, why) : null);
    }
    // What the building does.
    if (building === 'lamp_post') drawUpgrades(doc, have);
    else if (building === 'library') drawResearch(doc, have);
    else drawTavern(doc);
    const list = right.querySelector('.list');
    if (list) list.scrollTop = scroll;
    scope.refresh();
  }

  function row(key, why, onClick, ...body) {
    return pressable('div', { cls: 'list-row', key, why, onClick, refuse }, ...body);
  }

  function drawUpgrades(doc, have) {
    const rows = data.upgrades.map((u) => {
      const st = upgradeState(doc, data, u);
      const cost = nextRankCost(doc, data, u.id);
      const why = whyNotUpgrade(doc, data, u.id);
      return row(`u:${u.id}`, why, () => onUpgrade(u.id),
        h('div', { class: 'row-top' }, h('span', { class: 'row-name' }, u.name), h('span', { class: 'row-rank' }, `${st.rank}/${st.ranks}`)),
        h('div', { class: 'row-desc' }, u.desc),
        !st.open ? h('div', { class: 'why' }, st.why)
          : !cost ? h('div', { class: 'row-done' }, 'MAX')
            : [costRow(ctx, data, cost, have), why ? h('div', { class: 'why' }, why) : null]);
    });
    fill(right, h('h2', null, 'Upgrades'), h('div', { class: 'list' }, ...rows));
  }

  function drawResearch(doc, have) {
    const rows = data.research.map((r) => {
      const st = researchState(doc, data, r);
      // Every row can say why it can't start: done, under way, locked, the Library busy, short.
      const why = whyNotResearch(doc, data, r.id);
      const status = st.state === 'done' ? h('div', { class: 'row-done' }, 'Complete')
        : st.state === 'active' ? h('div', { class: 'row-active' }, `In progress: ${runsText(st.runsLeft)} left`)
          : st.state === 'locked' ? h('div', { class: 'why' }, st.why)
            : [costRow(ctx, data, r.cost, have), why ? h('div', { class: 'why' }, why) : null];
      const adds = joinsTexts(contentFrom(data, `research:${r.id}`));
      return row(`r:${r.id}`, why, () => onResearch(r.id),
        h('div', { class: 'row-top' }, h('span', { class: 'row-name' }, r.name), h('span', { class: 'row-rank' }, `Tier ${r.tier} · ${runsText(r.runs)}`)),
        ...adds.map((line) => h('div', { class: 'row-adds' }, line)),
        status);
    });
    fill(right, h('h2', null, 'Research'), h('p', { class: 'row-desc' }, 'A run counts toward research if you survive 5:00 or kill a boss.'), h('div', { class: 'list' }, ...rows));
  }

  /** Who and what comes back, level by level (its keeper too): the level effects of those kinds. */
  function drawTavern(doc) {
    const lines = [];
    for (let lv = 1; lv <= b.levels.length; lv++) {
      const reached = levelOf(doc, building, data) >= lv;
      const eff = levelEffects(data, building, lv).filter((e) => e.kind === 'arrival' || e.kind === 'joins' || e.kind === 'keeper');
      if (!eff.length) continue;
      lines.push(h('div', { class: `list-row static${reached ? '' : ' off'}` }, h('div', { class: 'row-top' }, h('span', { class: 'row-name' }, `Lv ${lv}`), h('span', { class: 'row-rank' }, reached ? 'Unlocked' : '')), ...eff.map((e) => h('div', { class: 'row-desc' }, e.text))));
    }
    fill(right, h('h2', null, 'Unlocks'), h('div', { class: 'list' }, ...lines));
  }

  draw();
  return {
    el, scope,
    onBack: onClose,
    /** Confirm on something that can't be done says why (and presses nothing). */
    onAction(action) {
      const why = action === 'confirm' ? scope.current?.dataset.why : null;
      if (!why) return false;
      refuse(why);
      return true;
    },
    refresh: draw,
    /** A line under the panel (what just happened, or why not). */
    say,
  };
}

// ---------------------------------------------------------------- the gate

/** characters: [{ id, name, desc, sprite, startName }]; map: { name, desc }. */
export function gateScreen(ctx, { characters, map, onSetOut, onBack }) {
  const cards = characters.map((c, i) => h('div', { class: 'card char-card', data: { focus: `c${i}` }, onclick: () => onSetOut(c.id) },
    h('div', { class: 'card-art' }, ctx.icon(c.sprite, 3)),
    h('div', { class: 'card-title' }, c.name),
    h('div', { class: 'card-desc' }, c.desc),
    c.startName ? h('div', { class: 'card-note' }, `Starting weapon: ${c.startName}`) : null));
  const el = h('div', { class: 'screen gate-screen' }, h('div', { class: 'panel' },
    h('h1', null, map.name),
    map.desc ? h('p', { class: 'card-desc center' }, map.desc) : null,
    h('h2', null, 'Choose a character'),
    h('div', { class: 'cards' }, ...cards),
    hint(ctx, ['confirm', 'Start run'], '   ', ['back', 'Back'])));
  return { el, scope: createFocusScope(el), onBack };
}

// ---------------------------------------------------------------- after a run

/**
 * changes: applyRunResult's list; next: nextAffordable(); summary: { title, line } (how the run
 * ended). onContinue: back to the harbor; onSetOut: straight to the gate.
 */
export function resultsScreen(ctx, { data, changes, next, summary, onContinue, onSetOut }) {
  const lines = changeLines(data, changes);
  const mats = lines.filter((l) => l.kind === 'material');
  const news = lines.filter((l) => l.kind !== 'material');
  const el = h('div', { class: 'screen results-screen' }, h('div', { class: 'panel' },
    h('h1', null, summary.title),
    summary.line ? h('p', { class: 'card-desc center' }, summary.line) : null,
    h('div', { class: 'results-body' },
      h('div', { class: 'results-col' }, h('h2', null, 'Materials'),
        mats.length ? h('div', { class: 'mat-list' }, ...mats.map((m) => h('div', { class: 'mat' }, m.icon ? ctx.icon(m.icon, 1) : null, ` ${m.text}`))) : h('p', null, 'None')),
      h('div', { class: 'results-col' }, h('h2', null, 'Progress'),
        news.length ? h('ul', { class: 'effects' }, ...news.map((l) => h('li', { class: `news-${l.kind}` }, l.text))) : h('p', null, 'None'))),
    next.length ? h('div', { class: 'next-block' }, h('h2', null, 'Next up'), ...next.map((o) => nextLine(data, o))) : null,
    h('div', { class: 'action-row' }, button('Continue', 'continue', onContinue), button('Start run', 'again', onSetOut)),
    hint(ctx, ['confirm', 'Select'])));
  return { el, scope: createFocusScope(el, { initial: 'continue' }), onBack: onContinue, ignoreMs: 400 };
}

/** One of the next-3, with its bar. */
export function nextLine(data, o) {
  const t = optionText(data, o);
  return h('div', { class: 'next-line' },
    h('div', { class: 'row-top' }, h('span', { class: 'row-name' }, t.title), o.kind === 'building' ? null : h('span', { class: 'row-rank' }, t.where)),
    progressBar(t.progress),
    h('div', { class: t.need ? 'why' : 'row-ready' }, t.need ?? 'Ready'));
}

// ---------------------------------------------------------------- the harbor's menu

export function hubMenuScreen(ctx, { onResume, onSetOut, onSettings, onTitle, onQuit = null }) {
  const el = h('div', { class: 'screen hub-menu' }, h('div', { class: 'panel' },
    h('h1', null, 'Harbor'),
    h('div', { class: 'menu-col' },
      button('Resume', 'resume', onResume),
      button('Start run', 'setout', onSetOut),
      button('Settings', 'settings', onSettings),
      button('Main menu', 'title', onTitle),
      onQuit ? button('Quit game', 'quit', onQuit) : null)));
  return {
    el, scope: createFocusScope(el, { initial: 'resume' }), onBack: onResume, isPause: true,
    // The button that opened it closes it, as the run's pause menu does.
    onAction(action) { if (action !== 'pause') return false; onResume(); return true; },
  };
}

