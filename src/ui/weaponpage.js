// A weapon's codex page (C3, ruling 18 P1; meta/codex.js weaponPage): everything it can take in a
// run (its two options on each axis, its Legendaries, its Rare and Epic traits), each marked "Taken"
// once a run has taken it, and its three Harbor Orders with what each opens. One scrolling list,
// every row in reach of the pad; Back returns to the codex.
//
// ctx: { ui, icon, sound }.

import { h } from './dom.js';
import { createFocusScope } from './focus.js';
import { hintRow, bandList } from './hints.js';

const RARITY = Object.freeze({ rare: 'Rare', epic: 'Epic' });

/** page: meta/codex.js weaponPage. */
export function weaponPageScreen(ctx, { page, onBack }) {
  let k = 0;
  const row = (cls, ...kids) => h('div', { class: `list-row static wpage-row ${cls}`, data: { focus: `r${k++}` }, 'aria-disabled': 'true' }, ...kids);
  const mark = (taken) => h('span', { class: `row-rank${taken ? ' taken' : ''}` }, taken ? 'Taken' : 'Not yet');
  const rows = [];
  for (const a of page.axes) {
    rows.push(h('h2', null, a.label));
    for (const o of a.options) {
      rows.push(row(o.taken ? 'done' : '',
        h('div', { class: 'row-top' }, h('span', { class: 'row-name' }, o.name), mark(o.taken)),
        h('div', { class: 'row-desc' }, o.desc),
        o.price ? h('div', { class: 'row-adds' }, `Drawback: ${o.price}`) : null));
    }
  }
  if (page.specials.length) {
    rows.push(h('h2', null, 'Legendary traits'));
    for (const x of page.specials) rows.push(row(x.taken ? 'done' : '', h('div', { class: 'row-top' }, h('span', { class: 'row-name' }, x.name), mark(x.taken)), h('div', { class: 'row-desc' }, x.desc)));
  }
  if (page.lines.length) {
    rows.push(h('h2', null, 'Rare and Epic traits'));
    for (const x of page.lines) {
      rows.push(row(x.taken ? 'done' : '',
        h('div', { class: 'row-top' }, h('span', { class: 'row-name' }, `${x.name} `, h('span', { class: `rarity rarity-${x.rarity}` }, RARITY[x.rarity] ?? x.rarity)), mark(x.taken)),
        h('div', { class: 'row-desc' }, x.shared ? `${x.desc} Other weapons can also roll ${x.name}.` : x.desc)));
    }
  }
  if (page.orders.length) {
    rows.push(h('h2', null, 'Harbor Orders'));
    for (const o of page.orders) {
      rows.push(row(o.done ? 'done' : '',
        h('div', { class: 'row-top' }, h('span', { class: 'row-name' }, o.name), h('span', { class: `row-rank${o.done ? ' taken' : ''}` }, o.done ? 'Done' : 'Open')),
        h('div', { class: 'row-desc' }, o.desc),
        o.opens ? h('div', { class: 'row-adds' }, `Opens: ${o.opens}`) : null));
    }
  }
  const back = h('button', { class: 'btn', type: 'button', data: { focus: 'back' }, onclick: () => onBack() }, 'Back');
  const el = h('div', { class: 'screen bestiary-screen codex-screen weapon-page' }, h('div', { class: 'panel' },
    h('div', { class: 'ascend-head' }, ctx.icon(page.icon, 2), h('div', null, h('h1', null, page.name), h('div', { class: 'card-desc' }, page.desc))),
    h('p', { class: 'card-desc center' }, `Taken in a run: ${page.taken} of ${page.of} Forms and traits.`),
    bandList({ class: 'list' }, ...rows),
    h('div', { class: 'action-row' }, back),
    hintRow(ctx, ['back', 'Back'])));
  return { el, scope: createFocusScope(el, { initial: 'r0' }), onBack };
}
