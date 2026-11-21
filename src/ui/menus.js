// The menu screens (ARCHITECTURE §8): title, level-up, chest reel, Forms
// choices, the overtime choice, pause, run end, settings, confirmations, and the error screen;
// 0.8.0 adds the Salt Well. (The pause menu's Codex button opens ui/hubscreens.js codexScreen for the run's map.)
// Each function builds a screen for ui.push(). Screens get plain data and callbacks; they never
// touch the sim (the app layer turns their callbacks into decisions).
//
// ctx: { ui, icon(id) -> element, sound(name) } (icons come from the atlas, sounds from audio).

import { h, fill } from './dom.js';
import { createFocusScope } from './focus.js';
import { tagName } from './describe.js';
import { hintRow, bandList, scrollBox } from './hints.js';

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

/** The hint row every screen shares (ui/hints.js). */
const hint = (ctx, ...parts) => hintRow(ctx, ...parts.filter((p) => p !== '   '));

/** A card's tag chips. On a level-up card (`card`: its focus key) each chip is a focus stop of its own, so the glossary's button opens that tag's entry (round 2, L3 2); confirm on a chip picks its card. */
function tagList(tags, card = null) {
  if (!tags.length) return null;
  return h('div', { class: 'tags' }, ...tags.map((t) => h('span', { class: `tag tag-${t.tag}`, ...(card ? { data: { focus: `${card}:${t.tag}`, term: `tag_${t.tag}` } } : {}) }, tagName(t.tag) + (t.have ? ` (${t.have})` : ''))));
}

function simpleScreen(el, scope, extra = {}) {
  return { el, scope, ...extra };
}

/**
 * A card's "now → after" line (ruling 14 A2): the number now in a quieter color, a drawn arrow (the
 * menus' typeface has none, and a fallback font would break the one typeface), and the number after
 * in the bright one. Any other line is returned as it is.
 */
export function changeLine(text) {
  const k = typeof text === 'string' ? text.indexOf(' → ') : -1;
  if (k < 0) return text;
  const head = text.slice(0, k), after = text.slice(k + 3);
  const sp = head.lastIndexOf(' ');
  const name = sp >= 0 ? head.slice(0, sp + 1) : '', now = sp >= 0 ? head.slice(sp + 1) : head;
  return h('span', { class: 'change' }, name, h('span', { class: 'change-now' }, now), h('span', { class: 'arrow', 'aria-label': 'to' }), h('span', { class: 'change-after' }, after));
}

/** How long a pick that is an event holds on its card before the screen closes (ruling 14 E: a held beat). */
export const BEAT_MS = Object.freeze({ legendary: 700, form: 450, capstone: 600 });

/** Hold a screen on its picked card for a beat: the card lit, the rest dimmed, every input ignored. */
function holdBeat(el, cardEl, kind) {
  el.classList.add('beat', `beat-${kind}`);
  cardEl?.classList.add('picked');
}

// ---------------------------------------------------------------- title and start

/**
 * The title. `build`: the build stamp as it reads ("Build 0.7.3, Oct 20, 14:30"; app/platform.js
 * buildStampText). onSaveCode: the save code screen (export and import a save as text).
 */
export function titleScreen(ctx, { build, onStart, onSettings, onCredits, onSaveCode = null, onQuit = null, onGlossary = null, onResume = null, resumeNote = null, note = null, startLabel = 'Start', completion = null }) {
  const buttons = [
    // 0.9.0: a run the game closed in the middle of (a crash, a closed tab) can go on from its
    // last minute (app/resume.js).
    onResume ? button('Resume run', 'resume', onResume) : null,
    button(startLabel, 'start', onStart),
    onGlossary ? button('Glossary', 'glossary', onGlossary) : null,
    button('Settings', 'settings', onSettings),
    onSaveCode ? button('Save code', 'savecode', onSaveCode) : null,
    button('Credits', 'credits', onCredits),
    onQuit ? button('Quit game', 'quit', onQuit) : null,
  ];
  const el = h('div', { class: 'screen title-screen' },
    h('div', { class: 'title-block' }, h('div', { class: 'game-title' }, 'Lamplight'), h('div', { class: 'build' }, build),
      // 0.9.0 (brief §6.8): how much of the game this profile has done, and its codex.
      completion ? h('div', { class: 'title-completion' }, completion) : null),
    h('div', { class: 'menu-col' }, ...buttons),
    resumeNote ? h('div', { class: 'title-note' }, resumeNote) : null,
    note ? h('div', { class: 'title-note' }, note) : null,
    hint(ctx, ['confirm', 'Select']),
  );
  return simpleScreen(el, createFocusScope(el, { initial: onResume ? 'resume' : 'start' })); // the title has nothing to back out to
}

// ---------------------------------------------------------------- level-up draft

/**
 * cards: cardInfo() results; charges: { reroll, banish, skip }.
 * Returns a screen with setOffer(cards, charges) for after a reroll or banish.
 */
export function levelUpScreen(ctx, { level, cards, charges, skipPays = null, onPick, onReroll, onBanish, onSkip, skipHoldMs = 500 }) {
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
  const el = panel('levelup-screen', `Level ${level}`, banner, cardRow, h('div', { class: 'action-row' }, rerollBtn, banishBtn, skipBtn), hint(ctx, ['confirm', 'Pick'], ['pause', 'Pause'], ['glossary', 'Glossary']));   // (RULING-L1: the G hint on the level-up screen)
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
    // A weapon's rolled upgrade: a plain frame in its rarity's color and the rarity's word beside its
    // level (the word says it; the color never carries it alone), its number now and after, and its
    // Form line under that. A Legendary special's card is thicker (`event-legendary`).
    fill(cardRow, ...cs.map((c, i) => h('div', { class: `card draft-card kind-${c.kind}${c.rarity ? ` frame-${c.rarity.id}` : ''}${c.event ? ` event-${c.event}` : ''}`, data: { focus: `c${i}`, navLeft: i > 0 ? `c${i - 1}` : undefined, navRight: i < cs.length - 1 ? `c${i + 1}` : undefined }, onclick: () => choose(i) },   // (round 2: left and right go card to card; down reaches its tag chips)
      h('div', { class: 'card-head' }, c.icon ? ctx.icon(c.icon, 2) : h('span', { class: 'icon-blank' }), h('div', null, h('div', { class: 'card-title' }, c.title),
        h('div', { class: 'card-sub' }, c.sub, c.rarity ? ' ' : null, c.rarity ? h('span', { class: `rarity rarity-${c.rarity.id}` }, c.rarity.name) : null, c.shared ? ' ' : null, c.shared ? h('span', { class: 'tag tag-shared', data: { focus: `c${i}:shared`, term: 'trait' } }, c.shared) : null))),   // (Ruling 23 PA)
      h('div', { class: `card-desc${typeof c.desc === 'string' && c.desc.includes(' → ') ? ' card-change' : ''}` }, changeLine(c.desc)),
      c.rule ? h('div', { class: 'card-form' }, c.rule) : null,
      c.form ? h('div', { class: `card-form${/^Opens:/.test(c.form) ? ' opens' : ''}` }, c.form) : null,
      tagList(c.tags, `c${i}`),
      c.step ? h('div', { class: 'card-note' }, c.step) : null,
      c.kin ? h('div', { class: 'card-note' }, c.kin) : null,
      c.note ? h('div', { class: 'card-note' }, c.note) : null,
    )));
    fill(rerollBtn, ctx.ui.glyph('reroll'), ` Reroll (${ch.reroll})`);
    fill(banishBtn, ctx.ui.glyph('banish'), ` Banish (${ch.banish})`);
    // A skip pays something (W1, 0.9.0): the button says what.
    fill(skipBtn, skipFill, ctx.ui.glyph('skip'), ` Skip (${ch.skip})${skipPays ? `: ${skipPays}` : ''}`);
    rerollBtn.setAttribute('aria-disabled', ch.reroll > 0 ? 'false' : 'true');
    banishBtn.setAttribute('aria-disabled', ch.banish > 0 ? 'false' : 'true');
    skipBtn.setAttribute('aria-disabled', ch.skip > 0 ? 'false' : 'true');
  }

  let held = false;
  function choose(i) {
    if (held) return;
    if (banishing) {
      const c = current.cards[i];
      if (c.kind === 'heal' || c.kind === 'coin') return;
      banishing = false; el.classList.remove('banishing'); banner.hidden = true;
      onBanish(i);
      return;
    }
    // A Legendary special is an event (ruling 14 E): the card holds, lit, for a beat while its sound
    // and rumble play (the sim's event), then the screen closes. onPick(i, beatMs).
    if (current.cards[i]?.event === 'legendary') {
      held = true;
      scope.focusKey(`c${i}`);   // (a click on another card than the focused one: the focus follows it)
      holdBeat(el, cardRow.children[i], 'legendary');
      onPick(i, BEAT_MS.legendary);
      return;
    }
    onPick(i, 0);
  }

  render();
  return {
    el, scope, ignoreMs: 300,
    setOffer(cs, ch) { current = { cards: cs, charges: ch }; render(); scope.refresh(); if (!scope.current || !el.contains(scope.current)) scope.focusKey('c0'); },
    // (Back only cancels a banish; otherwise it does nothing here, so Esc may pause: ui/screens.js.)
    onBack() { if (banishing && !held) { toggleBanish(); return true; } return false; },
    onAction(a) {
      if (held) return true;
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
export function chestScreen(ctx, { boss, secret = false, dawn = false, items, pool, onDone, spinMs = 900, staggerMs = 350 }) {
  const slots = items.map(() => h('div', { class: 'reel' }));
  const labels = items.map(() => h('div', { class: 'reel-label' }));
  const cont = button('Continue', 'go', () => finish(), { cls: 'wide' });
  const el = panel(`chest-screen ${boss || secret ? 'boss' : ''}`, dawn || boss ? 'Boss chest' : 'Chest',
    h('div', { class: 'reels' }, ...items.map((_, i) => h('div', { class: 'reel-col' }, slots[i], labels[i]))),
    h('div', { class: 'menu-col' }, cont), hint(ctx, ['confirm', 'Continue']));
  let t = 0, landed = 0, done = false, tickAcc = 0;
  const total = spinMs + staggerMs * (items.length - 1);
  function land(i) {
    const it = items[i];
    fill(slots[i], it.icon ? ctx.icon(it.icon, 2) : h('span', { class: 'icon-blank' }));
    slots[i].classList.add('landed', `kind-${it.kind}`);
    fill(labels[i], h('div', { class: 'card-title' }, it.title), h('div', { class: 'card-sub' }, it.sub, it.rarity ? ' ' : null, it.rarity ? h('span', { class: `rarity rarity-${it.rarity.id}` }, it.rarity.name) : null), h('div', { class: 'card-desc reel-desc' }, it.desc));
    ctx.sound(it.kind === 'relic' ? 'reel_big' : 'reel_land');
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

// ---------------------------------------------------------------- spoils (0.9.0)

/**
 * Spoils (0.9.0, V4: a boss chest chained 3 to 5 screens): one screen for a chest and what follows
 * from it. The reel lands at the top as a chest's does; under it, in the same place, an Ember to
 * spend (a weapon, then its Forms) or keep. What's done stays listed.
 * items, pool: as chestScreen. after: what follows ("an Ember to spend"), said under the reel
 * until Continue. onContinue(): the chest seen (the app then calls setStep for what follows, or
 * closes the screen).
 * setStep(step): { kind: 'ember', embers, weapons, onPick(w), onKeep() } | { kind: 'forms', weapon, onAscend(id), onBack() }
 * done(text): a line for what was just done ("Flare Gun: Mortar").
 */
export function spoilsScreen(ctx, { boss = true, secret = false, dawn = false, items, pool, after = '', onContinue, spinMs = 900, staggerMs = 350 }) {
  const slots = items.map(() => h('div', { class: 'reel' }));
  const labels = items.map(() => h('div', { class: 'reel-label' }));
  const doneList = h('div', { class: 'spoils-done' });
  const stepEl = h('div', { class: 'spoils-step' });   // (X6: its parts are the panel's own; its list gives way, never the title or the hints)
  const hints = h('div');
  const el = panel(`chest-screen spoils-screen ${boss || secret ? 'boss' : ''}`, dawn || boss ? 'Boss chest' : 'Chest',   // (RULING-L1: Spoils is the Boss chest)
    h('div', { class: 'reels' }, ...items.map((_, i) => h('div', { class: 'reel-col' }, slots[i], labels[i]))),
    doneList, stepEl, hints);
  let t = 0, landed = 0, tickAcc = 0, step = null, seen = false;
  const total = spinMs + staggerMs * (items.length - 1);
  const scope = createFocusScope(el, { initial: 'go' });
  function land(i) {
    const it = items[i];
    fill(slots[i], it.icon ? ctx.icon(it.icon, 2) : h('span', { class: 'icon-blank' }));
    slots[i].classList.add('landed', `kind-${it.kind}`);
    fill(labels[i], h('div', { class: 'card-title' }, it.title), h('div', { class: 'card-sub' }, it.sub, it.rarity ? ' ' : null, it.rarity ? h('span', { class: `rarity rarity-${it.rarity.id}` }, it.rarity.name) : null), h('div', { class: 'card-desc reel-desc' }, it.desc));
    ctx.sound(it.kind === 'relic' ? 'reel_big' : 'reel_land');
  }
  function firstStep() {
    fill(stepEl, after ? h('div', { class: 'card-desc center' }, `Then: ${after}`) : null, h('div', { class: 'action-row' }, button('Continue', 'go', () => press())));
    fill(hints, hint(ctx, ['confirm', 'Continue']));
  }
  function press() {
    if (landed < items.length) { while (landed < items.length) land(landed++); t = total; return; }
    if (seen) return;
    seen = true;
    onContinue();
  }
  const card = (key, onClick, ...body) => h('div', { class: 'card spoils-option', data: { focus: key }, onclick: onClick }, ...body);
  function draw() {
    // (X6, S3b F1: the Forms step hides the reel above it; what's done stays listed.)
    el.classList.toggle('step-forms', step?.kind === 'forms');
    el.classList.toggle('step-ember', step?.kind === 'ember');
    if (!step) { firstStep(); scope.refresh(); return; }
    if (step.kind === 'ember') {
      fill(stepEl,
        h('h2', null, 'Ember'),
        h('div', { class: 'card-desc center' }, `You have ${step.embers} ${step.embers === 1 ? 'Ember' : 'Embers'}. An Ember opens a weapon's next Form early, or swaps a Form it has for the other one.`),
        bandList({ class: 'cards spoils-weapons' }, ...step.weapons.map((w, r) => card(`e${r}`, () => step.onPick(w),
          h('div', { class: 'card-head' }, ctx.icon(w.icon, 2), h('div', null, h('div', { class: 'card-title' }, w.name), h('div', { class: 'card-sub' }, `${w.taken.length} of 3 Forms`)))))),
        h('div', { class: 'action-row' }, button('Keep for later', 'keep', () => step.onKeep(), { cls: 'quiet' })));
      fill(hints, hint(ctx, ['confirm', 'Select'], ['back', 'Keep for later']));
      scope.refresh(); scope.focusKey(step.weapons.length ? 'e0' : 'keep');
    } else if (step.kind === 'forms') {
      const w = step.weapon;
      const first = Math.max(0, w.forms.findIndex((f) => !f.taken && !f.why));
      fill(stepEl,
        h('h2', null, w.name),
        bandList({ class: `ascend-forms${w.forms.length > 3 ? ' six' : ''}` }, ...w.forms.map((f, c) => formCard(ctx, f, `f${c}`, (id) => step.onAscend(id)))),
        h('div', { class: 'action-row' }, button('Back', 'fback', () => step.onBack(), { cls: 'quiet' })));
      fill(hints, hint(ctx, ['confirm', 'Take it'], ['back', 'Back']));
      scope.refresh(); scope.focusKey(`f${first}`);
    }
  }
  firstStep();
  return {
    el, scope, ignoreMs: 250,
    setStep(next) { step = next; draw(); },
    done(text) { doneList.appendChild(h('div', { class: 'spoils-line' }, text)); },
    get step() { return step; },
    onBack() {
      if (!step) { press(); return; }
      if (step.kind === 'ember') scope.focusKey('keep');
      else if (step.kind === 'forms') step.onBack();
    },
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

// ---------------------------------------------------------------- Forms and overtime

/** How each axis of a weapon's Forms reads (ui/describe.js AXIS_LABEL). */
export const AXIS_LABEL = Object.freeze({ delivery: 'First Form', flight: 'Second Form', payoff: 'Final Form' });

/** One Form option as a card: its axis, its name, what it does, its price, and what taking it costs or what opens it. */
function formCard(ctx, f, key, onTake) {
  const off = f.taken || f.why;
  // One that can't be taken still takes focus; pressing it plays the menu's "no".
  return h('div', { class: `card ascend-option${off ? ' off' : ''}${f.capstone ? ' capstone' : ''}`, data: { focus: key }, 'aria-disabled': off ? 'true' : null,
    onclick: () => { if (off) ctx.sound?.('ui_back'); else onTake(f.id); } },
  f.label === null ? null : h('div', { class: 'card-sub' }, f.label ?? AXIS_LABEL[f.axis] ?? ''),
  h('div', { class: 'card-title' }, f.name),
  h('div', { class: 'card-desc' }, f.desc),
  f.price ? h('div', { class: 'card-form' }, `Drawback: ${f.price}`) : null,   // (RULING-L1: one word, Drawback)
  f.taken ? h('div', { class: 'card-note' }, 'Taken')
    : f.why ? h('div', { class: 'card-note' }, f.why)
      : f.cost === 'ember' ? h('div', { class: 'card-note' }, f.switches ? `1 Ember: swaps ${f.switches} for this` : '1 Ember: opens it now') : null);
}

/**
 * Forms, step 1 (an Ember picked up, or the pause menu's Forms): the weapons with something to
 * take, each with the options it holds; pick one to see its Forms. Or keep it for later.
 * weapons: [{ slot, name, icon, level, taken: [names], forms: [...] (see formsScreen) }]
 */
export function ascendScreen(ctx, { embers, weapons, onPick, onKeep }) {
  const rows = weapons.map((w, r) => h('div', { class: 'card ascend-weapon', data: { focus: `w${r}` }, onclick: () => onPick(w) },
    ctx.icon(w.icon, 2),
    h('div', null,
      h('div', { class: 'card-title' }, w.name),
      h('div', { class: 'card-sub' }, w.forms.some((f) => f.cost === 'free') ? 'A Form is ready' : `${w.taken.length} of 3 Forms`),
      w.taken.length ? h('div', { class: 'card-note' }, w.taken.join(', ')) : null)));
  const el = panel('ascend-screen', 'Forms',
    h('div', { class: 'card-desc center' }, `You have ${embers} ${embers === 1 ? 'Ember' : 'Embers'}. An Ember opens a weapon's next Form early, or swaps a Form it has for the other one.`),
    bandList({ class: `ascend-rows${rows.length === 1 ? ' one' : ''}` }, ...rows),
    h('div', { class: 'menu-col' }, button('Keep for later', 'keep', () => onKeep(), { cls: 'wide quiet' })),
    hint(ctx, ['confirm', 'Select'], ['back', 'Keep for later']));
  const scope = createFocusScope(el, { initial: 'w0' });
  return simpleScreen(el, scope, {
    ignoreMs: 250,
    onBack: () => scope.focusKey('keep'),
    onAction: (a) => { if (a === 'pause' && ctx.pause) { ctx.pause(); return true; } return false; },
  });
}

/**
 * Forms, step 2, and the choice an axis opens with (`direct`): one weapon's options, in the order
 * of their axes, each with its price. One it holds says so; one it can't take says what opens it;
 * both are shown, not offered. Back returns to the weapons (direct: keeps the choice for later).
 * weapon: { name, icon, forms: [{ id, name, desc, price, axis, label, taken, cost, switches, why }] }
 */
export function formsScreen(ctx, { weapon, onAscend, onBack, direct = false, axis = null, why = null }) {
  // Taking an option is an event (ruling 14 E): the card holds, lit, for a beat (longer for a
  // capstone) while its sound and rumble play, then the screen closes. onAscend(id, beatMs).
  let held = false;
  const take = (id) => {
    if (held) return;
    held = true;
    const k = weapon.forms.findIndex((f) => f.id === id), f = weapon.forms[k];
    const kind = f?.capstone ? 'capstone' : 'form';
    scope.focusKey(`f${k}`);
    holdBeat(el, cards[k], kind);
    onAscend(id, BEAT_MS[kind]);
  };
  const cards = weapon.forms.map((f, c) => formCard(ctx, direct ? { ...f, label: null } : f, `f${c}`, take));   // (one axis: the head names it)
  const first = Math.max(0, weapon.forms.findIndex((f) => !f.taken && !f.why));
  const head = direct
    ? `${axis === 'payoff' ? 'Its Final Form is open' : `${weapon.name}: ${AXIS_LABEL[axis] ?? 'a new Form'}`}. Choose one of 2. You can swap later with an Ember.`   // (round 2, L2 1: First, Second, Final; 14 of 20 weapons don't fire shots)
    : 'Choose one Form. A weapon holds one of each pair.';
  const el = panel(`ascend-screen forms-screen${direct ? ' direct' : ''}`, weapon.name,
    h('div', { class: 'ascend-head' }, ctx.icon(weapon.icon, 2), h('div', { class: 'card-desc' }, head.replace('  ', ' '))),
    bandList({ class: `ascend-forms${weapon.forms.length > 3 ? ' six' : ''}` }, ...cards),
    h('div', { class: 'menu-col' }, button(direct ? 'Keep for later' : 'Back', 'back', () => { if (!held) onBack(); }, { cls: 'wide quiet' })),
    hint(ctx, ['confirm', 'Take it'], ['back', direct ? 'Keep for later' : 'Back']));
  const scope = createFocusScope(el, { initial: `f${first}` });
  return simpleScreen(el, scope, {
    ignoreMs: direct ? 300 : 0,
    // (A choice an axis opened is never thrown away by a stray Back: Back moves to the button.)
    onBack: () => { if (held) return; if (direct) scope.focusKey('back'); else onBack(); },
    onAction: (a) => { if (held) return true; if (a === 'pause' && ctx.pause) { ctx.pause(); return true; } return false; },
  });
}

/**
 * A Reliquary or the vault: one relic of three, each with its tier. relics: [{ name, desc, icon,
 * tierName, downside? }]. pool (0.8.2): { found, total } of the run's relic pool, or null.
 * 0.9.0 (W1's relic slots): with the slots full (`full`, `slots`: { used, total }), a pick asks which
 * carried relic to give up for it (`carried`, cards as above), and Pass keeps what you carry.
 * onPick(index, swapId|null), onPass().
 */
export function relicScreen(ctx, { vault, relics, pool = null, full = false, slots = null, carried = [], onPick, onPass = null }) {
  const relicCard = (r, key, onClick) => h('div', { class: 'card draft-card kind-relic', data: { focus: key }, onclick: onClick },
    h('div', { class: 'card-head' }, ctx.icon(r.icon, 2), h('div', null, h('div', { class: 'card-title' }, r.name), h('div', { class: 'card-sub' }, r.tierName))),
    h('div', { class: 'card-desc' }, r.desc),
    r.downside ? h('div', { class: 'warn' }, r.downside) : null);
  let chosen = -1;
  // (X6: six carried relics in one row ran past the panel at 150% text: the row wraps and gives way.)
  const banded = bandList({ class: 'cards draft-cards relic-cards' });
  const row = banded.bands.list;
  const lead = h('div', { class: 'card-desc center' });
  const passRow = h('div', { class: 'action-row' });
  const hints = h('div');
  // The vault's relics are drawn a tier better (0.8.2: its screen says so), and both say how much
  // of the run's pool is found.
  const el = panel('relic-screen', vault ? 'Vault' : 'Reliquary', lead,
    pool ? h('div', { class: 'card-sub center' }, `Relics: ${pool.found} of ${pool.total} found`) : null,
    banded, passRow, hints);
  const scope = createFocusScope(el, { initial: 'c0' });
  function draw() {
    if (chosen < 0) {
      lead.textContent = full
        ? `Relic slots full (${slots?.used ?? carried.length} of ${slots?.total ?? carried.length}). Pick one, then the relic it replaces. The one given up goes back to the Ferryman.`
        : vault ? 'Pick one relic, one rarity higher than a Reliquary\'s. It lasts for the rest of the run.' : 'Pick one relic. It lasts for the rest of the run.';
      fill(row, ...relics.map((r, i) => relicCard(r, `c${i}`, () => { if (full) { chosen = i; draw(); } else onPick(i, null); })));
      fill(passRow, full && onPass ? button('Pass', 'pass', () => onPass(), { cls: 'quiet' }) : null);
      fill(hints, hint(ctx, ['confirm', 'Take'], full ? ['back', 'Pass'] : null, ['pause', 'Pause']));
      scope.refresh(); scope.focusKey('c0');
    } else {
      lead.textContent = `Give up which relic for ${relics[chosen].name}?`;
      fill(row, ...carried.map((r, i) => relicCard(r, `g${i}`, () => onPick(chosen, r.id))));
      fill(passRow, button('Back', 'back', () => { chosen = -1; draw(); }, { cls: 'quiet' }));
      fill(hints, hint(ctx, ['confirm', 'Give up'], ['back', 'Back']));
      scope.refresh(); scope.focusKey('g0');
    }
  }
  draw();
  return simpleScreen(el, scope, {
    ignoreMs: 300,
    // A pick: Back stays on the cards; with the slots full it backs out of the second step, then passes.
    onBack: () => { if (chosen >= 0) { chosen = -1; draw(); return true; } if (full && onPass) { scope.focusKey('pass'); return true; } scope.focusKey('c0'); return false; },
    onAction: (a) => { if (a === 'pause' && ctx.pause) { ctx.pause(); return true; } return false; },
  });
}

/**
 * The relic slots full at the Ferryman's (W1's contract §5): which carried relic to give up for
 * the one being bought. carried: relic cards; onSwap(id), onCancel().
 */
export function relicSwapScreen(ctx, { buying, carried, onSwap, onCancel }) {
  const cards = carried.map((r, i) => h('div', { class: 'card draft-card kind-relic', data: { focus: `g${i}` }, onclick: () => onSwap(r.id) },
    h('div', { class: 'card-head' }, ctx.icon(r.icon, 2), h('div', null, h('div', { class: 'card-title' }, r.name), h('div', { class: 'card-sub' }, r.tierName))),
    h('div', { class: 'card-desc' }, r.desc)));
  const el = panel('relic-screen', 'Relic slots full', h('div', { class: 'card-desc center' }, `Give up which relic for ${buying}? It goes back to the Ferryman's stock.`),
    bandList({ class: 'cards draft-cards relic-cards' }, ...cards),
    h('div', { class: 'action-row' }, button('Cancel', 'cancel', () => onCancel(), { cls: 'quiet' })),
    hint(ctx, ['confirm', 'Give up'], ['back', 'Cancel']));
  return simpleScreen(el, createFocusScope(el, { initial: 'g0' }), { onBack: onCancel, ignoreMs: 200 });
}

/**
 * The Fog Bell's chest (0.8.2, proposal idea 3): pick one weapon or passive you carry to gain its
 * levels. Laid out as the other picks are (a Reliquary's, a level-up's): cards in a row, the
 * controller moves between them, Confirm takes one. options: [{ index, name, icon, sub, desc }]
 * (app/runlogic.js haltView 'bellpick'); levels: how many each gains. Back stays on the cards (a
 * pick, like a Reliquary's).
 */
export function bellPickScreen(ctx, { levels, options, onPick }) {
  const cards = options.map((o, i) => h('div', { class: `card draft-card kind-${o.kind}`, data: { focus: `c${i}` }, onclick: () => onPick(o.index) },
    h('div', { class: 'card-head' }, o.icon ? ctx.icon(o.icon, 2) : h('span', { class: 'icon-blank' }), h('div', null, h('div', { class: 'card-title' }, o.name), h('div', { class: 'card-sub' }, o.sub))),
    h('div', { class: 'card-desc' }, o.desc)));
  const el = panel('relic-screen bellpick-screen', 'Fog Bell',
    h('div', { class: 'card-desc center' }, `Pick one to gain ${levels} levels.`),
    // (X6, S3b F4: a full build's 13 cards go five to a row, in a list that scrolls under the title.)
    bandList({ class: `cards draft-cards${cards.length > 4 ? ' many' : ''}${cards.length > 10 ? ' lots' : ''}` }, ...cards), hint(ctx, ['confirm', 'Take'], ['pause', 'Pause']));
  const scope = createFocusScope(el, { initial: 'c0' });
  return simpleScreen(el, scope, {
    ignoreMs: 300,
    onBack: () => { scope.focusKey('c0'); return false; },   // (nothing to back out of: Esc may pause)
    onAction: (a) => { if (a === 'pause' && ctx.pause) { ctx.pause(); return true; } return false; },
  });
}

/**
 * The Ferryman's trade: his offers for Pearls, bought one at a time while the screen stays;
 * Done closes it. view(): { glass, offers: [{ name, desc, icon, tierName?, price, sold, why }] },
 * read again after each purchase.
 */
export function ferryScreen(ctx, { view, onBuy, onDone }) {
  const banded = bandList({ class: 'list ferry-list' });
  const list = banded.bands.list;
  const head = h('div', { class: 'card-desc center' });
  const note = h('div', { class: 'bld-note' });
  const el = panel('ferry-screen', 'The Ferryman', head, banded, note, h('div', { class: 'menu-col' }, button('Done', 'done', () => onDone(), { cls: 'wide' })),
    hint(ctx, ['confirm', 'Buy'], '   ', ['back', 'Done']));
  const scope = createFocusScope(el, { initial: 'o0' });
  function draw() {
    const v = view();
    head.textContent = `You have ${v.glass} ${v.glass === 1 ? 'Pearl' : 'Pearls'}. What you buy lasts for this run.`;
    fill(list, ...v.offers.map((o, i) => h('div', {
      class: `list-row${o.why ? ' off' : ''}`, data: { focus: `o${i}`, why: o.why },
      onclick: () => { if (o.why) { note.textContent = o.why; ctx.sound?.('ui_back'); } else onBuy(i); },
    },
    h('div', { class: 'row-top' }, ctx.icon(o.icon, 1), h('span', { class: 'row-name' }, ` ${o.name}${o.tierName ? ` (${o.tierName})` : ''}`), h('span', { class: 'row-rank' }, o.sold ? 'Sold' : `${o.price} ${o.price === 1 ? 'Pearl' : 'Pearls'}`)),
    h('div', { class: 'row-desc' }, o.desc))));
    scope.refresh();
  }
  draw();
  const screen = simpleScreen(el, scope, {
    ignoreMs: 300,
    onBack: () => onDone(),
    onAction: (a) => { if (a === 'pause' && ctx.pause) { ctx.pause(); return true; } return false; },
  });
  return { ...screen, refresh: draw, say: (t) => { note.textContent = t || ''; } };
}

/** What the Salt Well asks, in plain words (0.8.0; docs/design/SALT_MARSH.md, the elite event). */
export const WELL_TEXT = 'Give up one relic. It is gone for the rest of this run, and the Ferryman offers it on every map from then on.';

/**
 * The Salt Well (0.8.0): give up one relic you carry, or keep them all. relics: [{ id, name, desc,
 * icon, tierName }]. onGive(id), onKeep(). Back keeps (ignoring the well costs nothing).
 */
export function wellScreen(ctx, { relics, onGive, onKeep }) {
  const cards = relics.map((r, i) => h('div', { class: 'card draft-card kind-relic', data: { focus: `c${i}` }, onclick: () => onGive(r.id) },
    h('div', { class: 'card-head' }, ctx.icon(r.icon, 2), h('div', null, h('div', { class: 'card-title' }, r.name), h('div', { class: 'card-sub' }, r.tierName))),
    h('div', { class: 'card-desc' }, r.desc)));
  const el = panel('well-screen', 'Salt Well', h('div', { class: 'card-desc center' }, WELL_TEXT),
    bandList({ class: 'cards draft-cards' }, ...cards),
    h('div', { class: 'menu-col' }, button('Keep them', 'keep', () => onKeep(), { cls: 'wide' })),
    hint(ctx, ['confirm', 'Give'], '   ', ['back', 'Keep'], ['pause', 'Pause']));
  const scope = createFocusScope(el, { initial: 'keep' });
  return simpleScreen(el, scope, {
    ignoreMs: 300,
    onBack: () => onKeep(),
    onAction: (a) => { if (a === 'pause' && ctx.pause) { ctx.pause(); return true; } return false; },
  });
}

export function overtimeScreen(ctx, { bossName, onStay, onLeave }) {
  const el = panel('overtime-screen', `${bossName} defeated`,
    h('p', null, 'Overtime: enemies get stronger every minute and drop more materials. New lamps and bells come out, a boss comes back, and then the Long Night brings the bosses back together. Kill them all and dawn breaks: the run ends with a dawn chest. Quit run from the pause menu any time; the map stays cleared.'),
    h('div', { class: 'menu-col' },
      button('Keep going', 'stay', () => onStay()),
      button('Leave', 'leave', () => onLeave())),
    hint(ctx, ['confirm', 'Select']));
  const scope = createFocusScope(el, { initial: 'leave' });
  return simpleScreen(el, scope, {
    ignoreMs: 400,
    onBack: () => scope.focusKey('leave'), // a choice, so Back only moves to the safe answer
    onAction: (a) => { if (a === 'pause' && ctx.pause) { ctx.pause(); return true; } return false; },
  });
}

// ---------------------------------------------------------------- pause and run end

/** Materials as icons with counts ([{ icon, name, count }]), or "None". */
function matList(ctx, mats = []) {
  return mats.length
    ? h('div', { class: 'mat-list' }, ...mats.map((m) => h('div', { class: 'mat', title: m.name }, ctx.icon(m.icon, 1), ` ${m.count} ${m.name}`)))
    : h('div', { class: 'card-desc' }, 'None');
}

/**
 * The map's ledger on one line (0.8.2, proposal idea 10): "Lamps 4/5, Bells 2/3, Ferryman trades
 * 3, Relics 4 of 5 found, Secret: not found". rows: [[label, value]] (app/runlogic.js ledgerLines).
 */
export function ledgerText(rows) {
  return rows.map(([k, v]) => (/^\d/.test(v) ? `${k} ${v}` : `${k}: ${v.charAt(0).toLowerCase()}${v.slice(1)}`)).join(', ');
}

/**
 * build: { time, weapons: [{ name, icon, level, max, ascensions, marks, form }], passives: [...], relics: [{ name, icon }], materials: [{ icon, name, count }] }
 * (a weapon's `form`: its Form progress line, ui/describe.js formLine; W1b)
 */
export function pauseScreen(ctx, { build, onResume, onSettings, onStats = null, onGuide = null, onGlossary = null, onAscend = null, onReport, onLeave, reportNote = null }) {
  // Every item in the build can take focus; the line under the rows says what it is and does.
  const detail = h('div', { class: 'build-detail' }, 'Select an item for details.');
  const describe = (w) => [
    h('div', { class: 'card-title' }, `${w.name}${w.level ? `  Lv ${w.level}${w.max ? ' MAX' : ''}` : ''}`),
    w.form ? h('div', { class: 'card-note' }, w.form) : null,
    w.ascensions?.length ? h('div', { class: 'card-note' }, `Forms: ${w.ascensions.join(', ')}`) : null,
    w.marks?.length ? h('div', { class: 'card-note' }, `Traits: ${w.marks.join(', ')}`) : null,
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
        // The column wraps (0.9.0, V4: down past Quit run jumped into the relics on the right).
        button('Resume', 'resume', onResume, { nav: { up: 'leave' } }),
        onAscend ? button(`Forms (${build.embers} ${build.embers === 1 ? 'Ember' : 'Embers'})`, 'ascend', onAscend) : null,
        onStats ? button('Stats', 'stats', onStats) : null,
        onGuide ? button('Codex', 'guide', onGuide) : null,
        onGlossary ? button('Glossary', 'glossary', onGlossary) : null,
        button('Settings', 'settings', onSettings),
        button('Save bug report', 'report', () => onReport(note)),
        button('Quit run', 'leave', onLeave, { cls: 'quiet', nav: { down: 'resume' } })),
      h('div', { class: 'build-col' },
        h('div', { class: 'card-sub' }, `Time: ${build.time}`),
        h('h2', null, 'Weapons'), iconRow(build.weapons),
        h('h2', null, 'Passives'), iconRow(build.passives),
        build.relics.length ? [h('h2', null, 'Relics'), iconRow(build.relics)] : null,
        h('h2', null, 'Materials found'), matList(ctx, build.materials),
        // The map's ledger (0.8.2, idea 10): what the map holds and what this run has done with it.
        build.ledger?.length ? [h('h2', null, 'This map'), h('div', { class: 'card-desc ledger' }, ledgerText(build.ledger))] : null,
        detail)),
    note,
    hint(ctx, ['confirm', 'Select'], ['back', 'Resume']));
  const onFocus = (target) => {
    const m = /^b(\d+)$/.exec(target.dataset.focus || '');
    if (m) fill(detail, ...describe(items[Number(m[1])]));
  };
  return simpleScreen(el, createFocusScope(el, { initial: 'resume', onFocus }), {
    onBack: onResume,
    onAction: (a) => { if (a === 'pause') { onResume(); return true; } return false; },
  });
}

/**
 * Stats (from the pause menu): your character, what reaches every weapon, and each weapon's own
 * numbers. view: app/runlogic.js statsView. Back returns to the pause menu.
 */
export function statsScreen(ctx, { view, onBack }) {
  const dl = (lines) => h('dl', { class: 'stats' }, ...lines.map(([k, v]) => [h('dt', null, k), h('dd', null, v)]));
  // Up and Down go row to row in order (X6: at a big text size a row is taller than the list, and the
  // nearest element below could be Back, past the rows still to come).
  const order = [...view.weapons.map((_, k) => `w${k}`), ...view.items.map((_, k) => `i${k}`)];
  const nav = (key) => { const i = order.indexOf(key); return { focus: key, navUp: i > 0 ? order[i - 1] : undefined, navDown: i < order.length - 1 ? order[i + 1] : 'back' }; };
  const weapon = (w, k) => h('div', { class: 'stats-weapon', data: nav(`w${k}`) },
    h('div', { class: 'stats-weapon-head' }, ctx.icon(w.icon, 1), h('span', { class: 'card-title' }, `${w.name}  Lv ${w.level}${w.max ? ' MAX' : ''}${w.signature ? '  Signature' : ''}`)),
    w.desc ? h('div', { class: 'card-desc' }, w.desc) : null,
    w.ascensions.length ? h('div', { class: 'card-note' }, `Forms: ${w.ascensions.join(', ')}`) : null,
    w.marks?.length ? h('div', { class: 'card-note' }, `Traits: ${w.marks.join(', ')}`) : null,
    w.ups?.length ? h('div', { class: 'card-note' }, `Biggest level-ups: ${w.ups.join(', ')}`) : null,
    w.form ? h('div', { class: 'card-note' }, w.form) : null,
    // C3: the signature's own track, then its three axes, each what it holds or what opens it.
    ...[].concat(w.track ?? []).map((t) => h('div', { class: 'card-note' }, t)),
    ...(w.axes || []).map((a) => h('div', { class: 'card-note stats-axis' }, a)),
    dl(w.lines));
  const item = (it, k) => h('div', { class: 'stats-weapon stats-item', data: nav(`i${k}`) },
    h('div', { class: 'stats-weapon-head' }, ctx.icon(it.icon, 1), h('span', { class: 'card-title' }, it.kind === 'relic' ? `${it.name} (relic)` : `${it.name}  Lv ${it.level}${it.max ? ' MAX' : ''}`)),
    h('div', { class: 'card-desc' }, it.desc));
  const el = panel('stats-screen', 'Stats',
    h('div', { class: 'stats-grid' },
      // (X6, S3b F2: the first two columns scroll as one focus stop each when the text is big.)
      scrollBox('col0', { class: 'stats-col' }, h('h2', null, 'Character'),
        view.who ? [h('div', { class: 'card-title' }, view.who.name), view.who.gives ? h('div', { class: 'card-desc' }, view.who.gives) : null, view.who.costs ? h('div', { class: 'card-desc' }, `Drawback: ${view.who.costs}`) : null] : null,
        view.skills?.length ? h('div', { class: 'card-note' }, `Skills: ${view.skills.join(', ')}`) : null,
        dl(view.character)),
      scrollBox('col1', { class: 'stats-col' }, h('h2', null, 'All weapons'), dl(view.allWeapons),
        // C3: the Dash slot (ruling 16): the item it holds, what it does, its numbers now.
        view.dash ? [h('h2', null, 'Dash slot'), h('div', { class: 'stats-weapon-head' }, view.dash.icon ? ctx.icon(view.dash.icon, 1) : null, h('span', { class: 'card-title' }, view.dash.name)),
          h('div', { class: 'card-desc' }, view.dash.desc), dl(view.dash.lines)] : null,
        h('h2', null, 'Materials found'), matList(ctx, view.materials)),
      h('div', { class: 'stats-col' }, h('h2', null, 'Weapons'),
        bandList({ class: 'stats-weapons' },
          view.weapons.length ? view.weapons.map(weapon) : h('div', { class: 'card-desc' }, 'None'),
          h('h2', null, 'Items'),
          view.items.length ? view.items.map(item) : h('div', { class: 'card-desc' }, 'None')))),
    // A plain button, its own width (0.7.3: it stretched across the whole panel).
    h('div', { class: 'action-row' }, button('Back', 'back', onBack)),
    hint(ctx, ['confirm', 'Select'], ['back', 'Back']));
  return simpleScreen(el, createFocusScope(el, { initial: 'back' }), { onBack });
}

/**
 * result: { title, lines: [[label, value]], materials: [{ icon, name, count }], payLine? }.
 * recap (0.9.0, a death): { killer, lines } (app/runtips.js deathRecap), or null. extra: an element
 * to put under the grid (W6's damage table), or null.
 */
export function endScreen(ctx, { result, recap = null, extra = null, onHarbor, onAgain }) {
  const el = panel('end-screen', result.title,
    recap ? h('div', { class: 'recap' },
      h('div', { class: 'recap-killer' }, `Killed by ${recap.killer}`),
      recap.lines.length ? h('div', { class: 'recap-sub' }, 'The last 5s:') : null,
      ...recap.lines.map((l) => h('div', { class: 'recap-line' }, l))) : null,
    // (X6, S3b F3 and F3b: the numbers and the damage table scroll under the title and the recap,
    // which stay in view, as do the buttons and the hint row. Up from the buttons reaches them.)
    scrollBox('numbers', { class: 'end-mid' },
      h('div', { class: 'end-grid' },
        h('dl', { class: 'stats' }, ...result.lines.map(([k, v]) => [h('dt', null, k), h('dd', null, v)])),
        h('div', null, h('h2', null, 'Materials'),
          result.materials.length
            ? h('div', { class: 'mat-list' }, ...result.materials.map((m) => h('div', { class: 'mat' }, ctx.icon(m.icon, 1), ` ${m.count.toLocaleString('en-US')} ${m.name}`)))
            : h('p', { class: 'card-desc' }, 'None'),
          result.payLine ? h('div', { class: 'card-note' }, result.payLine) : null)),
      extra),
    h('div', { class: 'menu-col' }, button('Return to harbor', 'harbor', onHarbor), button('Run again', 'again', onAgain)),
    hint(ctx, ['confirm', 'Select'], ['back', 'Return to harbor']));
  return simpleScreen(el, createFocusScope(el, { initial: 'harbor' }), { ignoreMs: 600, onBack: onHarbor });
}

// ---------------------------------------------------------------- settings

/**
 * rows: [{ key, label, kind: 'toggle' | 'choice' | 'slider' | 'open', value, choices?: [[value, label]],
 *   min?, max?, step?, format?(v), note?: string (shown under the label, e.g. why a change was refused),
 *   desc?: string (0.9.0: what the row does, shown under the list while it has focus), run?() (an
 *   'open' row: Confirm opens another screen), group?: string (a heading above the row) }]
 * onChange(key, value) applies and saves; the screen redraws the row.
 */
export function settingsScreen(ctx, { rows, onChange, onBack, title = 'Settings' }) {
  const banded = bandList({ class: 'settings-list' });
  const list = banded.bands.list;
  const detail = h('div', { class: 'set-detail' });
  const els = new Map();
  function valueText(r) {
    if (r.kind === 'open') return r.value ?? '';
    if (r.kind === 'toggle') return r.value ? 'On' : 'Off';
    if (r.kind === 'choice') return (r.choices.find((c) => c[0] === r.value) || [null, String(r.value)])[1];
    return r.format ? r.format(r.value) : String(r.value);
  }
  function step(r, dir) {
    if (r.kind === 'open') { r.run?.(); return; }
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
    fill(row, h('span', { class: 'set-label' }, r.label, r.note ? h('span', { class: 'set-why' }, r.note) : null),
      r.kind === 'open' ? h('span', { class: 'set-value' }, valueText(r)) : h('span', { class: 'set-value' }, '< ', valueText(r), ' >', bar));
  }
  const showDetail = (el) => {
    const r = rows.find((x) => x.key === el?.dataset.focus);
    detail.textContent = r?.desc ?? '';
  };
  for (const r of rows) {
    if (r.group) list.appendChild(h('h2', { class: 'set-group' }, r.group));
    // A click on the left half of the row steps back, on the right half forward.
    const row = h('div', { class: 'set-row', data: { focus: r.key }, onclick: (e) => { const b = row.getBoundingClientRect(); step(r, e.clientX < b.left + b.width / 2 ? -1 : 1); } });
    els.set(r.key, row);
    list.appendChild(row);
    draw(r);
  }
  const back = button('Back', 'done', onBack, { cls: 'wide' });
  // 0.9.0 (V4): the prompts say how a row changes (◀ ▶), and the focused row says what it does.
  const el = panel('settings-screen', title, banded, detail, h('div', { class: 'menu-col' }, back), hint(ctx, ['sides', 'Change'], ['confirm', 'Select'], ['back', 'Back']));
  const scope = createFocusScope(el, { onFocus: showDetail });
  return {
    el, scope,
    onBack,
    onNav(d) {
      const k = scope.current?.dataset.focus;
      const r = rows.find((x) => x.key === k);
      if (r && r.kind !== 'open' && (d === 'left' || d === 'right')) { step(r, d === 'left' ? -1 : 1); return true; }
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
    /** What the line under the list says now (the focused row's description). */
    get detail() { return detail.textContent; },
  };
}

// ---------------------------------------------------------------- controls (0.9.0)

/**
 * Controls (Settings, 0.9.0; V4: no remapping, and ✕ was both confirm and dash): each action with
 * its controller button and its key. Press a cell, then the button or key to give it (5s to
 * answer, or nothing changes). Rows say whether Dash also takes Confirm's button in a run.
 * view(): { rows: [{ action, label, pad, keys }], dashPad, dashKeys, waiting: null | { action,
 * device } }; onRebind(action, device) starts the wait (the app's), onDashOnConfirm(device, on),
 * onReset(), onBack(). refresh() redraws.
 */
export function controlsScreen(ctx, { view, onRebind, onDashOnConfirm, onReset, onBack, padName = 'Controller' }) {
  const banded = bandList({ class: 'list controls-list' });
  const list = banded.bands.list;
  const note = h('div', { class: 'set-detail' });
  const el = panel('settings-screen controls-screen', 'Controls',
    h('div', { class: 'controls-head' }, h('span', null, 'Action'), h('span', null, padName), h('span', null, 'Keyboard')),
    banded, note,
    h('div', { class: 'action-row' }, button('Reset to defaults', 'reset', () => onReset(), { cls: 'quiet' }), button('Back', 'done', () => onBack())),
    hint(ctx, ['confirm', 'Change'], ['back', 'Back']));
  const scope = createFocusScope(el, { initial: 'p:dash' });
  function draw() {
    const v = view();
    const cell = (r, device) => {
      const waiting = v.waiting && v.waiting.action === r.action && v.waiting.device === device;
      return h('div', { class: `ctl-cell${waiting ? ' waiting' : ''}`, data: { focus: `${device === 'pad' ? 'p' : 'k'}:${r.action}` }, onclick: () => onRebind(r.action, device) },
        waiting ? (device === 'pad' ? 'Press a button' : 'Press a key') : r[device]);
    };
    fill(list,
      ...v.rows.map((r) => h('div', { class: 'list-row ctl-row' }, h('span', { class: 'row-name' }, r.label), cell(r, 'pad'), cell(r, 'keys'))),
      h('div', { class: 'list-row ctl-row' }, h('span', { class: 'row-name' }, 'Dash on Confirm in runs'),
        h('div', { class: 'ctl-cell', data: { focus: 'dp' }, onclick: () => onDashOnConfirm('pad', !v.dashPad) }, v.dashPad ? 'On' : 'Off'),
        h('div', { class: 'ctl-cell', data: { focus: 'dk' }, onclick: () => onDashOnConfirm('keys', !v.dashKeys) }, v.dashKeys ? 'On' : 'Off')));
    note.textContent = v.waiting ? 'Press the button to use. Nothing changes if you wait 5s.'
      : v.why ? v.why   // (a change refused: why, until the next one)
      : 'Giving a button to an action swaps it with the action that had it. Dash and Confirm can share one: it dashes in a run and confirms in menus and the harbor.';
    scope.refresh();
  }
  draw();
  return { el, scope, onBack: () => onBack(), refresh: draw, noGlossary: true, get note() { return note.textContent; } };
}

// ---------------------------------------------------------------- the save code

/**
 * Export and import a save as text (brief §9.5): to move progress between the playtest build and
 * the PC release, or keep a backup. onExport(), onPaste() (0.9.0, V4/V5: import by paste, which a
 * pad can finish: the code from the clipboard), onImport() (from a text file): the app does the
 * work and says how it went with say(text). When the clipboard can't be read, showPasteBox() opens
 * a box to paste the code into with Ctrl+V; onPasted(text) takes it. The title's menu and the
 * harbor's open it.
 */
export function saveCodeScreen(ctx, { onExport, onImport, onPaste = null, onPasted = null, onBack }) {
  const note = h('div', { class: 'bld-note save-note' });
  const box = h('textarea', { class: 'paste-box', rows: '2', spellcheck: 'false', placeholder: 'Paste the code here (Ctrl+V)', hidden: true });
  const use = button('Use pasted code', 'usepaste', () => { onPasted?.(box.value); }, { cls: 'wide' });
  use.hidden = true;
  box.addEventListener('paste', (e) => {
    const t = e.clipboardData?.getData?.('text');
    if (t) { e.preventDefault?.(); box.value = t; onPasted?.(t); }
  });
  // The box has the keyboard while it has the cursor, and the game hears no key then (input/input.js).
  // So the keys the hint names work from it too (the sweep, S3b F11): Esc gives the cursor back (a
  // second Esc backs out), Up and Down give it back and move the focus, Enter presses what has focus.
  box.addEventListener('keydown', (e) => {
    const k = e.code || e.key;
    const dir = k === 'ArrowUp' ? 'up' : k === 'ArrowDown' ? 'down' : null;
    if (k !== 'Escape' && k !== 'Enter' && k !== 'NumpadEnter' && !dir) return;
    e.preventDefault?.();
    box.blur?.();
    if (dir) { if (scope.move(dir)) ctx.sound?.('ui_move'); } else if (k !== 'Escape' && scope.press()) ctx.sound?.('ui_confirm');
  });
  const el = panel('savecode-screen', 'Save code',
    h('p', null, 'A save code is your progress as text. Export one to keep a backup or to move it to the other build of the game. Paste one, or import one from a text file, to replace the progress here.'),
    h('div', { class: 'menu-col' },
      button('Export', 'export', () => onExport()),
      onPaste ? button('Paste code', 'paste', () => onPaste()) : null,
      button('Import from file', 'import', () => onImport()),
      box, use,
      button('Back', 'back', () => onBack(), { cls: 'quiet' })),
    note,
    hint(ctx, ['confirm', 'Select'], ['back', 'Back']));
  const scope = createFocusScope(el, { initial: 'export' });
  return {
    el, scope, onBack,
    say(text) { note.textContent = text || ''; },
    /** What the line under the buttons says now. */
    get note() { return note.textContent; },
    /** The clipboard couldn't be read: a box to paste into, focused for the keyboard. */
    showPasteBox() { box.hidden = false; use.hidden = false; box.value = ''; scope.refresh(); scope.focusKey('usepaste'); box.focus?.(); },
    get pasteBox() { return box; },
  };
}

// ---------------------------------------------------------------- small dialogs

/** credits: [{ what, who, license }] */
export function creditsScreen(ctx, { credits, onBack }) {
  const el = panel('credits-screen', 'Credits',
    h('dl', { class: 'stats credits' }, ...credits.map((c) => [h('dt', null, c.what), h('dd', null, `${c.who} (${c.license})`)])),
    h('div', { class: 'menu-col' }, button('Back', 'back', onBack)),
    hint(ctx, ['back', 'Back']));
  return simpleScreen(el, createFocusScope(el), { onBack });
}

export function confirmScreen(ctx, { title, text, yes, no, onYes, onNo }) {
  const el = panel('confirm-screen', title, text ? h('p', null, text) : null,
    h('div', { class: 'menu-col' }, button(yes, 'yes', onYes), button(no, 'no', onNo)),
    hint(ctx, ['confirm', 'Select'], ['back', no]));
  return simpleScreen(el, createFocusScope(el, { initial: 'no' }), { onBack: onNo, ignoreMs: 200 });
}

/**
 * A question with its own answers (0.9.0: the window's close mid-run, on the game's own screen so a
 * pad can answer it). buttons: [[label, key, onPress]]; initial: the key focused first (the safe
 * answer); onBack: what Back does (the safe answer too).
 */
export function questionScreen(ctx, { title, text, buttons, initial, onBack, cls = '' }) {
  const el = panel(`confirm-screen ${cls}`, title, text ? h('p', null, text) : null,
    h('div', { class: 'menu-col' }, ...buttons.map(([label, key, fn]) => button(label, key, fn))),
    hint(ctx, ['confirm', 'Select'], ['back', buttons.find((b) => b[1] === initial)?.[0] ?? 'Back']));
  return simpleScreen(el, createFocusScope(el, { initial }), { onBack, ignoreMs: 200, isPause: true });
}

export function messageScreen(ctx, { title, text, ok = 'OK', onOk }) {
  const el = panel('message-screen', title, h('p', null, text), h('div', { class: 'menu-col' }, button(ok, 'ok', onOk)), hint(ctx, ['confirm', ok]));
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

// ---------------------------------------------------------------- a first run's tips

/**
 * How to play, for a first run (glyph: the button prompt for an action, ui.glyph): a small card in
 * the bottom left, over the run, never taking input (the run scene removes it after its first
 * seconds). 0.9.0 (V4: nine lines, most meaning nothing for minutes): only Move and Dash. The
 * rest come as one line over each thing the first time it's on screen (app/runtips.js).
 */
export function runTips(glyph, root, extra = null) {
  const row = (...parts) => h('div', { class: 'tips-row' }, ...parts);
  const el = h('div', { class: 'run-tips' },
    row(glyph('move'), ' Move'),
    row(glyph('dash'), ' Dash'),
    row('Weapons fire on their own'),
    extra ? row(extra) : null);   // (the character's own meter, taught in run 1: RULING-L1's Fuel)
  root.append(el);
  return el;
}
