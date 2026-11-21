// The run's damage by weapon (0.9.0, the veteran round: "the end of a run is thin"; Vampire
// Survivors' damage-by-weapon table is a staple). damageRows works out the table from a run's
// result (or a live world) and is tested in Node; damageTableEl builds it for the menus: each
// weapon's icon, name and level, a bar as long as its share of the best weapon's damage, its total,
// and its share of the run's damage.
//
// The run-end screen and the harbor's Results place it (src/ui, W7's); its look is ui.css's
// .damage-table block (below, for W7 to paste in):
//
//   .damage-table { display: grid; grid-template-columns: auto auto 1fr auto auto; gap: calc(var(--u) * 2) calc(var(--u) * 4); align-items: center; margin: calc(var(--u) * 4) 0; }
//   .damage-table .dmg-name { color: var(--fog-5); white-space: nowrap; }
//   .damage-table .dmg-lv { color: var(--fog-3); }
//   .damage-table .dmg-bar { height: calc(var(--u) * 4); background: var(--night-3); border: var(--u) solid var(--night-0); min-width: calc(var(--u) * 60); }
//   .damage-table .dmg-fill { height: 100%; background: var(--lamp-4); }
//   .damage-table .dmg-row-top .dmg-fill { background: var(--lamp-5); }
//   .damage-table .dmg-num { color: var(--fog-5); text-align: right; }
//   .damage-table .dmg-pct { color: var(--fog-3); text-align: right; min-width: calc(var(--u) * 18); }

import { formatCount } from './hudtext.js';
import { weaponLook } from '../data/ascensions.js';

/**
 * The table's rows, most damage first: { id, name, icon, level, damage, share (0..1 of the best
 * weapon's), pct (whole percent of the run's total) }. `src` is a RunResult ({ weapons: [{ id,
 * level, damage }] }) or a live world (its slots and result.damageBySlot). Weapons that dealt
 * nothing are kept, at the bottom, so the table lists the whole build. The character's own weapon
 * counts like any other.
 */
export function damageRows(src, data) {
  const byId = new Map((data.weapons || []).map((w) => [w.id, w]));
  const list = [];
  if (src && Array.isArray(src.slots)) {
    const dmg = src.result?.damageBySlot || [];
    for (let s = 0; s < src.slots.length; s++) {
      const slot = src.slots[s];
      if (!slot || !slot.def) continue;
      list.push({ id: slot.def.id, name: slot.def.name, icon: weaponLook(slot.def, slot.ascensions || []).icon, level: slot.level, damage: Math.round(dmg[s] || 0) });
    }
  } else {
    for (const w of src?.weapons || []) {
      const def = byId.get(w.id);
      list.push({ id: w.id, name: def?.name ?? w.id, icon: w.icon || def?.icon || '', level: w.level ?? 1, damage: Math.round(w.damage || 0) });
    }
  }
  list.sort((a, b) => b.damage - a.damage || a.name.localeCompare(b.name));
  const best = list.length ? list[0].damage : 0;
  const total = list.reduce((t, r) => t + r.damage, 0);
  for (const r of list) {
    r.share = best > 0 ? r.damage / best : 0;
    r.pct = total > 0 ? Math.round((r.damage / total) * 100) : 0;
  }
  return list;
}

/**
 * The table as a DOM element (a grid: icon, name and level, bar, total, share). `ctx.icon` is the
 * menus' atlas icon factory (app/icons.js). Text goes in as text, never markup.
 */
export function damageTableEl(ctx, rows, doc = document) {
  const el = doc.createElement('div');
  el.className = 'damage-table';
  const cell = (cls, text) => { const c = doc.createElement('span'); c.className = cls; if (text !== undefined) c.textContent = text; return c; };
  rows.forEach((r, k) => {
    const icon = ctx?.icon ? ctx.icon(r.icon, 1) : cell('icon icon-blank');
    icon.classList?.add('dmg-icon');
    const name = cell('dmg-name', r.name);
    if (r.level > 1) { name.append(' '); name.append(cell('dmg-lv', `Lv ${r.level}`)); }
    const bar = cell('dmg-bar');
    const fill = cell('dmg-fill');
    fill.style.width = `${Math.round(r.share * 100)}%`;
    bar.append(fill);
    const num = cell('dmg-num', formatCount(r.damage));
    const pct = cell('dmg-pct', `${r.pct}%`);
    for (const c of [icon, name, bar, num, pct]) { if (k === 0) c.classList?.add('dmg-row-top'); el.append(c); }
  });
  return el;
}
