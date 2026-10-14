// The menu screens (ARCHITECTURE §8): title, level-up, chest reel, rune
// placement, the overtime choice, pause, run end, settings, confirmations, and the error screen.
// Each function builds a screen for ui.push(). Screens get plain data and callbacks; they never
// touch the sim (the app layer turns their callbacks into decisions).
//
// ctx: { ui, icon(id) -> element, sound(name) } (icons come from the atlas, sounds from audio).

import { h, fill } from './dom.js';
import { createFocusScope } from './focus.js';
import { tagName } from './describe.js';

// ---------------------------------------------------------------- pieces

function button(label, key, onClick, { cls = '', disabled = false, nav = null } = {}) {
  const data = { focus: key };
  if (nav) for (const [d, t] of Object.entries(nav)) data[`nav${d[0].toUpperCase()}${d.slice(1)}`] = t;
  const el = h('button', { class: `btn ${cls}`, type: 'button', data, 'aria-disabled': disabled ? 'true' : null, onclick: () => { if (el.getAttribute('aria-disabled') !== 'true') onClick(); } }, label);
  return el;
}

function panel(cls, title, ...body) {
  return h('div', { class: `screen ${cls}` }, h('div', { class: 'panel' }, title ? h('h1', null, title) : null, ...body));
}

function hint(ctx, ...parts) {
  return h('div', { class: 'hint' }, ...parts.map((p) => (Array.isArray(p) ? [ctx.ui.glyph(p[0]), ` ${p[1]}`] : p)));
}

function tagList(tags) {
  if (!tags.length) return null;
  return h('div', { class: 'tags' }, ...tags.map((t) => h('span', { class: `tag tag-${t.tag}` }, tagName(t.tag) + (t.have ? ` (${t.have})` : ''))));
}

function simpleScreen(el, scope, extra = {}) {
  return { el, scope, ...extra };
}

// ---------------------------------------------------------------- title and start

export function titleScreen(ctx, { build, onStart, onSettings, onCredits, onQuit = null, note = null, startLabel = 'Start' }) {
  const buttons = [
    button(startLabel, 'start', onStart),
    button('Settings', 'settings', onSettings),
    button('Credits', 'credits', onCredits),
    onQuit ? button('Quit game', 'quit', onQuit) : null,
  ];
  const el = h('div', { class: 'screen title-screen' },
    h('div', { class: 'title-block' }, h('div', { class: 'game-title' }, 'Lamplight'), h('div', { class: 'build' }, `Build ${build}`)),
    h('div', { class: 'menu-col' }, ...buttons),
    note ? h('div', { class: 'title-note' }, note) : null,
  );
  return simpleScreen(el, createFocusScope(el, { initial: 'start' })); // the title has nothing to back out to
}

// ---------------------------------------------------------------- level-up draft

/**
 * cards: cardInfo() results; charges: { reroll, banish, skip }.
 * Returns a screen with setOffer(cards, charges) for after a reroll or banish.
 */
export function levelUpScreen(ctx, { level, cards, charges, onPick, onReroll, onBanish, onSkip, skipHoldMs = 500 }) {
  let banishing = false;
  let current = { cards, charges };
  const cardRow = h('div', { class: 'cards draft-cards' });
  const rerollBtn = button('', 'reroll', () => { if (current.charges.reroll > 0) onReroll(); }, { cls: 'small' });
  const banishBtn = button('', 'banish', () => toggleBanish(), { cls: 'small' });
  // Pressing the focused Skip button (or clicking it) is as deliberate as holding the skip
  // button, so it skips; the hold is there so the shoulder button can't skip by accident.
  const skipBtn = button('', 'skip', () => { if (current.charges.skip > 0) onSkip(); }, { cls: 'small skip' });
  const skipFill = h('span', { class: 'hold-fill' });
  const banner = h('div', { class: 'banish-banner', hidden: true }, 'Choose a card to banish. It won\'t appear again this run. ', ctx.ui.glyph('back'), ' Cancel');
  const el = panel('levelup-screen', `Level ${level}`, banner, cardRow, h('div', { class: 'action-row' }, rerollBtn, banishBtn, skipBtn));
  const scope = createFocusScope(el, { initial: 'c0' });

  function toggleBanish() {
    if (!banishing && current.charges.banish <= 0) return;
    banishing = !banishing;
    el.classList.toggle('banishing', banishing);
    banner.hidden = !banishing;
    if (banishing) scope.focusKey('c0');
  }

  function render() {
    const { cards: cs, charges: ch } = current;
    fill(cardRow, ...cs.map((c, i) => h('div', { class: `card draft-card kind-${c.kind}`, data: { focus: `c${i}` }, onclick: () => choose(i) },
      h('div', { class: 'card-head' }, c.icon ? ctx.icon(c.icon, 2) : h('span', { class: 'icon-blank' }), h('div', null, h('div', { class: 'card-title' }, c.title), h('div', { class: 'card-sub' }, c.sub))),
      h('div', { class: 'card-desc' }, c.desc),
      tagList(c.tags),
      c.note ? h('div', { class: 'card-note' }, c.note) : null,
    )));
    fill(rerollBtn, ctx.ui.glyph('reroll'), ` Reroll (${ch.reroll})`);
    fill(banishBtn, ctx.ui.glyph('banish'), ` Banish (${ch.banish})`);
    fill(skipBtn, skipFill, ctx.ui.glyph('skip'), ` Skip (${ch.skip})`);
    rerollBtn.setAttribute('aria-disabled', ch.reroll > 0 ? 'false' : 'true');
    banishBtn.setAttribute('aria-disabled', ch.banish > 0 ? 'false' : 'true');
    skipBtn.setAttribute('aria-disabled', ch.skip > 0 ? 'false' : 'true');
  }

  function choose(i) {
    if (banishing) {
      const c = current.cards[i];
      if (c.kind === 'heal' || c.kind === 'coin') return;
      banishing = false; el.classList.remove('banishing'); banner.hidden = true;
      onBanish(i);
      return;
    }
    onPick(i);
  }

  render();
  return {
    el, scope, ignoreMs: 300,
    setOffer(cs, ch) { current = { cards: cs, charges: ch }; render(); scope.refresh(); if (!scope.current || !el.contains(scope.current)) scope.focusKey('c0'); },
    onBack() { if (banishing) toggleBanish(); },
    onAction(a) {
      if (a === 'reroll' && current.charges.reroll > 0) { ctx.sound('ui_confirm'); onReroll(); return true; }
      if (a === 'banish') { toggleBanish(); return true; }
      if (a === 'skip' && current.charges.skip > 0) { onSkip(); return true; }
      if (a === 'pause' && ctx.pause) { ctx.pause(); return true; }
      return false;
    },
    update(ms, input) {
      // The hold for Skip shows as the button filling up.
      const held = input.down('skip') && current.charges.skip > 0 ? Math.min(1, input.heldMs('skip') / skipHoldMs) : 0;
      skipFill.style.width = `${Math.round(held * 100)}%`;
    },
  };
}

// ---------------------------------------------------------------- chest reel

/** items: cardInfo() results for what the chest gave. pool: icon ids to spin through. */
export function chestScreen(ctx, { boss, items, pool, onDone, spinMs = 900, staggerMs = 350 }) {
  const slots = items.map(() => h('div', { class: 'reel' }));
  const labels = items.map(() => h('div', { class: 'reel-label' }));
  const cont = button('Continue', 'go', () => finish(), { cls: 'wide' });
  const el = panel(`chest-screen ${boss ? 'boss' : ''}`, boss ? 'Boss chest' : 'Chest',
    h('div', { class: 'reels' }, ...items.map((_, i) => h('div', { class: 'reel-col' }, slots[i], labels[i]))),
    h('div', { class: 'menu-col' }, cont));
  let t = 0, landed = 0, done = false, tickAcc = 0;
  const total = spinMs + staggerMs * (items.length - 1);
  function land(i) {
    const it = items[i];
    fill(slots[i], it.icon ? ctx.icon(it.icon, 2) : h('span', { class: 'icon-blank' }));
    slots[i].classList.add('landed', `kind-${it.kind}`);
    fill(labels[i], h('div', { class: 'card-title' }, it.title), h('div', { class: 'card-sub' }, it.sub), h('div', { class: 'card-desc reel-desc' }, it.desc));
    ctx.sound(it.kind === 'evolution' || it.kind === 'relic' ? 'reel_big' : 'reel_land');
  }
  function finish() {
    if (done) return;
    if (landed < items.length) { while (landed < items.length) land(landed++); t = total; return; }
    done = true;
    onDone();
  }
  return {
    el, scope: createFocusScope(el), ignoreMs: 250,
    onBack: () => finish(),
    onAction: (a) => { if (a === 'pause' && ctx.pause) { ctx.pause(); return true; } return false; },
    update(ms) {
      if (landed >= items.length) return;
      t += ms; tickAcc += ms;
      for (let i = landed; i < items.length; i++) {
        if (t >= spinMs + staggerMs * i) { land(i); landed = i + 1; } else if (tickAcc > 70) {
          const id = pool[Math.floor(Math.random() * pool.length)];
          fill(slots[i], ctx.icon(id, 2));
        }
      }
      if (tickAcc > 70) { tickAcc = 0; ctx.sound('reel_tick'); }
    },
  };
}

// ---------------------------------------------------------------- runes and overtime

/** options: [{ slot, name, icon, runes: [names] }] weapons with an open socket this rune fits. */
export function runeScreen(ctx, { rune, options, onPlace, onDiscard }) {
  const opts = options.map((o, i) => h('div', { class: 'card rune-option', data: { focus: `w${i}` }, onclick: () => onPlace(o.slot) },
    h('div', { class: 'card-head' }, ctx.icon(o.icon, 2), h('div', null, h('div', { class: 'card-title' }, o.name), h('div', { class: 'card-sub' }, o.runes.length ? `Runes: ${o.runes.join(', ')}` : 'No runes')))));
  const el = panel('rune-screen', `Rune: ${rune.title}`,
    h('div', { class: 'card-desc center' }, rune.desc),
    h('div', { class: 'cards' }, ...opts),
    h('div', { class: 'menu-col' }, button('Discard', 'discard', () => onDiscard(), { cls: 'wide quiet' })),
    hint(ctx, 'Choose a weapon'));
  const scope = createFocusScope(el, { initial: 'w0' });
  return simpleScreen(el, scope, {
    ignoreMs: 250,
    // Back doesn't throw a rune away by itself: it moves to the button that does.
    onBack: () => scope.focusKey('discard'),
    onAction: (a) => { if (a === 'pause' && ctx.pause) { ctx.pause(); return true; } return false; },
  });
}

export function overtimeScreen(ctx, { bossName, onStay, onLeave }) {
  const el = panel('overtime-screen', `${bossName} defeated`,
    h('p', null, 'Overtime: enemies get stronger every minute and drop more materials. Leave any time from the pause menu.'),
    h('div', { class: 'menu-col' },
      button('Keep going', 'stay', () => onStay()),
      button('Leave', 'leave', () => onLeave())));
  const scope = createFocusScope(el, { initial: 'leave' });
  return simpleScreen(el, scope, {
    ignoreMs: 400,
    onBack: () => scope.focusKey('leave'), // a choice, so Back only moves to the safe answer
    onAction: (a) => { if (a === 'pause' && ctx.pause) { ctx.pause(); return true; } return false; },
  });
}

// ---------------------------------------------------------------- pause and run end

/**
 * build: { time, weapons: [{ name, icon, level, max, runes }], passives: [...], relics: [{ name, icon }] }
 */
export function pauseScreen(ctx, { build, onResume, onSettings, onReport, onLeave, reportNote = null }) {
  // Every item in the build can take focus; the line under the rows says what it is and does.
  const detail = h('div', { class: 'build-detail' }, 'Select an item for details.');
  const describe = (w) => [
    h('div', { class: 'card-title' }, `${w.name}${w.level ? `  Lv ${w.level}${w.max ? ' MAX' : ''}` : ''}`),
    w.runes?.length ? h('div', { class: 'card-note' }, `Runes: ${w.runes.join(', ')}`) : null,
    w.desc ? h('div', { class: 'card-desc' }, w.desc) : null,
  ];
  let k = 0;
  const iconRow = (list) => (list.length
    ? h('div', { class: 'icon-row' }, ...list.map((w) => h('div', { class: 'icon-cell', title: w.name, data: { focus: `b${k++}` }, onclick: () => fill(detail, ...describe(w)) }, ctx.icon(w.icon, 1), w.level ? h('span', { class: `lv ${w.max ? 'max' : ''}` }, String(w.level)) : null)))
    : h('div', { class: 'card-desc' }, 'None'));
  const note = h('div', { class: 'card-note' }, reportNote || '');
  const items = [...build.weapons, ...build.passives, ...build.relics];
  const el = panel('pause-screen', 'Paused',
    h('div', { class: 'pause-grid' },
      h('div', { class: 'menu-col' },
        button('Resume', 'resume', onResume),
        button('Settings', 'settings', onSettings),
        button('Save bug report', 'report', () => onReport(note)),
        button('Quit run', 'leave', onLeave, { cls: 'quiet' })),
      h('div', { class: 'build-col' },
        h('div', { class: 'card-sub' }, `Time: ${build.time}`),
        h('h2', null, 'Weapons'), iconRow(build.weapons),
        h('h2', null, 'Passives'), iconRow(build.passives),
        build.relics.length ? [h('h2', null, 'Relics'), iconRow(build.relics)] : null,
        detail)),
    note);
  const onFocus = (target) => {
    const m = /^b(\d+)$/.exec(target.dataset.focus || '');
    if (m) fill(detail, ...describe(items[Number(m[1])]));
  };
  return simpleScreen(el, createFocusScope(el, { initial: 'resume', onFocus }), {
    onBack: onResume,
    onAction: (a) => { if (a === 'pause') { onResume(); return true; } return false; },
  });
}

/** result: { title, lines: [[label, value]], materials: [{ icon, name, count }] } */
export function endScreen(ctx, { result, onHarbor, onAgain }) {
  const el = panel('end-screen', result.title,
    h('div', { class: 'end-grid' },
      h('dl', { class: 'stats' }, ...result.lines.map(([k, v]) => [h('dt', null, k), h('dd', null, v)])),
      h('div', null, h('h2', null, 'Materials'),
        result.materials.length
          ? h('div', { class: 'mat-list' }, ...result.materials.map((m) => h('div', { class: 'mat' }, ctx.icon(m.icon, 1), ` ${m.count} ${m.name}`)))
          : h('p', { class: 'card-desc' }, 'None'))),
    h('div', { class: 'menu-col' }, button('Return to harbor', 'harbor', onHarbor), button('Run again', 'again', onAgain)));
  return simpleScreen(el, createFocusScope(el, { initial: 'harbor' }), { ignoreMs: 600, onBack: onHarbor });
}

// ---------------------------------------------------------------- settings

/**
 * rows: [{ key, label, kind: 'toggle' | 'choice' | 'slider', value, choices?: [[value, label]],
 *   min?, max?, step?, format?(v), note?: string (shown under the label, e.g. why a change was refused) }]
 * onChange(key, value) applies and saves; the screen redraws the row.
 */
export function settingsScreen(ctx, { rows, onChange, onBack }) {
  const list = h('div', { class: 'settings-list' });
  const els = new Map();
  function valueText(r) {
    if (r.kind === 'toggle') return r.value ? 'On' : 'Off';
    if (r.kind === 'choice') return (r.choices.find((c) => c[0] === r.value) || [null, String(r.value)])[1];
    return r.format ? r.format(r.value) : String(r.value);
  }
  function step(r, dir) {
    let v = r.value;
    if (r.kind === 'toggle') v = !v;
    else if (r.kind === 'choice') {
      const i = r.choices.findIndex((c) => c[0] === r.value);
      v = r.choices[(i + dir + r.choices.length) % r.choices.length][0];
    } else {
      v = Math.round(Math.min(r.max, Math.max(r.min, r.value + dir * r.step)) * 1000) / 1000;
    }
    if (v === r.value) return;
    r.value = v;
    r.note = null;
    ctx.sound('ui_move');
    onChange(r.key, v);
    draw(r);
  }
  function draw(r) {
    const row = els.get(r.key);
    const bar = r.kind === 'slider' ? h('span', { class: 'slider' }, h('span', { class: 'slider-fill', style: { width: `${Math.round(((r.value - r.min) / (r.max - r.min)) * 100)}%` } })) : null;
    fill(row, h('span', { class: 'set-label' }, r.label, r.note ? h('span', { class: 'set-why' }, r.note) : null), h('span', { class: 'set-value' }, '< ', valueText(r), ' >', bar));
  }
  for (const r of rows) {
    // A click on the left half of the row steps back, on the right half forward.
    const row = h('div', { class: 'set-row', data: { focus: r.key }, onclick: (e) => { const b = row.getBoundingClientRect(); step(r, e.clientX < b.left + b.width / 2 ? -1 : 1); } });
    els.set(r.key, row);
    list.appendChild(row);
    draw(r);
  }
  const back = button('Back', 'done', onBack, { cls: 'wide' });
  const el = panel('settings-screen', 'Settings', list, h('div', { class: 'menu-col' }, back), hint(ctx, ['confirm', 'Change'], '   ', ['back', 'Back']));
  const scope = createFocusScope(el);
  return {
    el, scope,
    onBack,
    onNav(d) {
      const k = scope.current?.dataset.focus;
      const r = rows.find((x) => x.key === k);
      if (r && (d === 'left' || d === 'right')) { step(r, d === 'left' ? -1 : 1); return true; }
      return false;
    },
    onAction(a) {
      if (a !== 'confirm') return false;
      const k = scope.current?.dataset.focus;
      const r = rows.find((x) => x.key === k);
      if (r) { step(r, 1); return true; }
      return false;
    },
    /** Change a row's value or note from outside (a display mode that can't switch here). */
    setRow(key, patch) { const r = rows.find((x) => x.key === key); if (r) { Object.assign(r, patch); draw(r); } },
  };
}

// ---------------------------------------------------------------- small dialogs

/** credits: [{ what, who, license }] */
export function creditsScreen(ctx, { credits, onBack }) {
  const el = panel('credits-screen', 'Credits',
    h('dl', { class: 'stats credits' }, ...credits.map((c) => [h('dt', null, c.what), h('dd', null, `${c.who} (${c.license})`)])),
    h('div', { class: 'menu-col' }, button('Back', 'back', onBack)));
  return simpleScreen(el, createFocusScope(el), { onBack });
}

export function confirmScreen(ctx, { title, text, yes, no, onYes, onNo }) {
  const el = panel('confirm-screen', title, text ? h('p', null, text) : null,
    h('div', { class: 'menu-col' }, button(yes, 'yes', onYes), button(no, 'no', onNo)));
  return simpleScreen(el, createFocusScope(el, { initial: 'no' }), { onBack: onNo, ignoreMs: 200 });
}

export function messageScreen(ctx, { title, text, ok = 'OK', onOk }) {
  const el = panel('message-screen', title, h('p', null, text), h('div', { class: 'menu-col' }, button(ok, 'ok', onOk)));
  return simpleScreen(el, createFocusScope(el), { onBack: onOk, ignoreMs: 200 });
}

/** The error screen. `inRun`: the error came during a run (whose report carries its replay). */
export function errorScreen(ctx, { message, inRun = true, onReport, onReload }) {
  const note = h('div', { class: 'card-note' });
  const el = panel('error-screen', 'Error',
    h('p', null, inRun
      ? 'The run stopped because of an error. Save a bug report, then reload.'
      : 'The game stopped because of an error. Save a bug report, then reload.'),
    h('pre', { class: 'error-text' }, message),
    h('div', { class: 'menu-col' }, button('Save bug report', 'report', () => onReport(note)), button('Reload', 'reload', onReload)),
    note);
  return simpleScreen(el, createFocusScope(el, { initial: 'report' })); // nothing to back out to
}
