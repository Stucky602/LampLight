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
import { levelEffects, researchState, upgradeState, runsText, changeLines, optionText, joinsTexts, rewardText, tideText, claimText } from './hubtext.js';
import { levelOf, contentFrom, levelEffect, tideAvailable, cursesAvailable, masteryOf, perksOf, heldOf, resolveContent, featsDone, secretsOf } from '../meta/state.js';
import { nextLevelCost, nextRankCost, whyNotRestore, whyNotUpgrade, whyNotResearch } from '../meta/actions.js';
import {
  gearItems, gearEquipped, gearSlotsOpen, whyNotCraft, whyNotCutRune, whyNotBuyConsumable, consumableSlots, bestiaryRows, whyNotClaim,
  whyNotTrain, kitsOf, tradeTerms, whyNotTrade, marketRates, affixText, upgradeCost, whyNotUpgradeGear, whyNotEquip, whyNotReroll, rerollOffer, rerollCost,
} from '../meta/workshop.js';
import { featShown } from '../meta/feats.js';
import { RUNE_STONE_COST, SLOT_NAMES, GEAR_SLOTS } from '../data/gear.js';

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
 * with refresh() after. onAct(action, ...args): the Phase 7 buildings' purchases ('craft',
 * 'cutRune', 'buy', 'trade', 'claim', 'train'), and onGear(uid): open an item at the Smithy.
 */
export function buildingScreen(ctx, { data, building, get, onRestore, onUpgrade, onResearch, onAct = () => {}, onGear = () => {}, onClose }) {
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
    else if (building === 'tavern') drawTavern(doc, have);
    else if (building === 'smithy') drawSmithy(doc, have);
    else if (building === 'chapel') drawChapel(doc);
    else if (building === 'market') drawMarket(doc, have);
    else if (building === 'apothecary') drawApothecary(doc, have);
    else if (building === 'cartographer') drawCartographer(doc);
    else drawLevels(doc);
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

  /** Level by level, what the building opens (`kinds`: which effects; all when null). */
  function levelRows(doc, kinds = null) {
    const lines = [];
    for (let lv = 1; lv <= b.levels.length; lv++) {
      const reached = levelOf(doc, building, data) >= lv;
      const eff = levelEffects(data, building, lv).filter((e) => (kinds ? kinds.includes(e.kind) : e.kind !== 'more'));
      if (!eff.length) continue;
      lines.push(h('div', { class: `list-row static${reached ? '' : ' off'}`, data: { focus: `lv:${lv}` }, 'aria-disabled': 'true' }, h('div', { class: 'row-top' }, h('span', { class: 'row-name' }, `Lv ${lv}`), h('span', { class: 'row-rank' }, reached ? 'Unlocked' : '')), ...eff.map((e) => h('div', { class: 'row-desc' }, e.text))));
    }
    return lines;
  }

  function drawLevels(doc) { fill(right, h('h2', null, 'Unlocks'), h('div', { class: 'list' }, ...levelRows(doc))); }

  /**
   * A static row: a name, a note on the right, and lines under it. It takes focus like any row
   * (pressing it does nothing and makes no sound: aria-disabled), so a pad scrolls the list to
   * every row, not just the last one it could buy (§8: everything usable with a controller alone).
   * Its key is its name's (no two rows on one panel share a name: tests/hubscene.test.js).
   */
  function info(name, note, ...lines) {
    return h('div', { class: 'list-row static', data: { focus: `i:${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}` }, 'aria-disabled': 'true' }, h('div', { class: 'row-top' }, h('span', { class: 'row-name' }, name), h('span', { class: 'row-rank' }, note ?? '')), ...lines.filter(Boolean).map((l) => h('div', { class: 'row-desc' }, l)));
  }

  /** Who and what comes back (its keeper too), each character's mastery and perks, and the feats. */
  function drawTavern(doc, have) {
    const rows = [...levelRows(doc, ['arrival', 'joins', 'keeper'])];
    if (levelEffect(doc, data, building, 'mastery')) {
      for (const id of resolveContent(doc, data).characters) {
        const c = data.characters.find((x) => x.id === id), m = masteryOf(doc, data, id);
        const kits = kitsOf(doc, data, id).filter((k) => k.id);
        rows.push(info(`${c.name}: mastery`, `Rank ${m.rank}`, m.next ? `${m.xp}/${m.next} XP` : `${m.xp} XP`,
          ...kits.map((k) => `${k.name}: ${k.open ? 'open at the gate' : `rank ${k.rank}`}`)));
        for (const p of data.perks.filter((x) => x.character === id)) {
          const trained = perksOf(doc, id).has(p.id);
          const why = trained ? null : whyNotTrain(doc, data, p.id);
          rows.push(row(`p:${p.id}`, trained ? 'Already trained' : why, () => onAct('train', p.id),
            h('div', { class: 'row-top' }, h('span', { class: 'row-name' }, p.name), h('span', { class: 'row-rank' }, `Rank ${p.rank}`)),
            h('div', { class: 'row-desc' }, p.desc),
            trained ? h('div', { class: 'row-done' }, 'Trained') : [costRow(ctx, data, p.cost, have), why ? h('div', { class: 'why' }, why) : null]));
        }
      }
    }
    if (levelEffect(doc, data, building, 'feats')) {
      const done = featsDone(doc), found = new Set(doc.profile.featsFound || []);
      const shown = data.feats.filter((f) => featShown(f, done, found));
      rows.push(h('h2', null, `Feats: ${data.feats.filter((f) => done.has(f.id)).length}/${data.feats.length}`));
      for (const f of shown) rows.push(info(f.name, done.has(f.id) ? 'Done' : '', f.desc, rewardText(data, 'feat', f)));
    }
    fill(right, h('h2', null, 'Unlocks'), h('div', { class: 'list' }, ...rows));
  }

  /** The Smithy: gear to make, the gear you have (press for an item), and rune stones. */
  function drawSmithy(doc, have) {
    const rows = [];
    const open = gearSlotsOpen(doc, data), eq = gearEquipped(doc);
    rows.push(info('Worn', `${Object.keys(eq).filter((k) => open.includes(k)).length}/${open.length}`,
      ...GEAR_SLOTS.map((slot) => {
        const it = gearItems(doc).find((x) => x.uid === eq[slot]);
        if (!open.includes(slot)) return null;
        return `${SLOT_NAMES[slot]}: ${it ? `${data.recipes.find((r) => r.id === it.id)?.name ?? it.id} T${it.tier}` : 'None'}`;
      })));
    for (const it of gearItems(doc)) {
      const r = data.recipes.find((x) => x.id === it.id);
      if (!r) continue;
      const worn = eq[r.slot] === it.uid;
      rows.push(row(`g:${it.uid}`, null, () => onGear(it.uid),
        h('div', { class: 'row-top' }, ctx.icon(r.icon, 1), h('span', { class: 'row-name' }, ` ${r.name}`), h('span', { class: 'row-rank' }, `T${it.tier}${worn ? '  Worn' : ''}`)),
        h('div', { class: 'row-desc' }, it.affixes.map((a) => { const af = data.affixes.find((x) => x.id === a); return af ? affixText(af, it.tier) : a; }).join(', '))));
    }
    rows.push(h('h2', null, 'Make'));
    const known = resolveContent(doc, data).recipes;
    for (const r of data.recipes.filter((x) => known.includes(x.id))) {
      const why = whyNotCraft(doc, data, r.id);
      const base = data.affixes.find((x) => x.id === r.base);
      rows.push(row(`c:${r.id}`, why, () => onAct('craft', r.id),
        h('div', { class: 'row-top' }, ctx.icon(r.icon, 1), h('span', { class: 'row-name' }, ` ${r.name}`), h('span', { class: 'row-rank' }, SLOT_NAMES[r.slot])),
        h('div', { class: 'row-desc' }, `${affixText(base, 1)}, and 1 more`),
        costRow(ctx, data, r.cost, have), why ? h('div', { class: 'why' }, why) : null));
    }
    if (!known.length) rows.push(info('No gear patterns', '', 'Research at the Library opens them.'));
    if (levelEffect(doc, data, building, 'runeCrafting')) {
      rows.push(h('h2', null, 'Rune stones'));
      for (const id of resolveContent(doc, data).runes) {
        const rn = data.runes.find((x) => x.id === id), why = whyNotCutRune(doc, data, id);
        rows.push(row(`s:${id}`, why, () => onAct('cutRune', id),
          h('div', { class: 'row-top' }, ctx.icon(rn.icon, 1), h('span', { class: 'row-name' }, ` ${rn.name}`), h('span', { class: 'row-rank' }, `Held: ${heldOf(doc, `rune:${id}`)}`)),
          h('div', { class: 'row-desc' }, rn.desc),
          costRow(ctx, data, RUNE_STONE_COST, have), why ? h('div', { class: 'why' }, why) : null));
      }
    }
    fill(right, h('h2', null, 'Gear'), h('div', { class: 'list' }, ...rows));
  }

  /** The Chapel: the Tides and the curses (chosen at the gate), each with what opens it. */
  function drawChapel(doc) {
    const max = tideAvailable(doc, data), cap = levelEffect(doc, data, building, 'tideMax');
    const needLv = (key, n) => `Requires Chapel Lv ${b.levels.findIndex((l) => (l[key] ?? 0) >= n) + 1}`;
    const rows = data.tides.map((t) => info(`Tide ${t.level}`,
      t.level <= max ? 'Open' : t.level > cap ? needLv('tideMax', t.level) : t.level === 1 ? 'Clear the map' : `Clear at Tide ${t.level - 1}`,
      tideText(t)));
    const cs = cursesAvailable(doc, data).map((c) => c.id);
    rows.push(h('h2', null, 'Curses'));
    data.curses.forEach((c, i) => rows.push(info(c.name, cs.includes(c.id) ? 'Open' : needLv('curses', i + 1), c.desc, `+${Math.round(c.rewardMul * 100)}% Materials`)));
    fill(right, h('h2', null, 'Tides'), h('p', { class: 'row-desc' }, 'Chosen at the gate.'), h('div', { class: 'list' }, ...rows));
  }

  /** The Market: one row a material, paid for with what you hold most of. */
  function drawMarket(doc, have) {
    const rates = marketRates(doc, data);
    if (!rates) { drawLevels(doc); return; }
    const all = [...data.market.common, ...data.market.rare];
    const rows = all.map((get) => {
      // Pay with the common material you hold the most of (a rare one only when no common can
      // cover a trade: spending Iron on Coin is rarely what you want).
      let best = null;
      for (const pool of [data.market.common, data.market.rare]) {
        for (const give of pool) {
          const t = tradeTerms(doc, data, give, get);
          if (!t) continue;
          const n = Math.floor((have[give] ?? 0) / t.give);
          if (!best || n > best.n || (best.n === 0 && n === 0 && pool === data.market.common)) best = { give, t, n };
        }
        if (best && best.n > 0) break;
      }
      const why = best ? whyNotTrade(doc, data, best.give, get) : 'Nothing to trade';
      const m = data.materials.find((x) => x.id === get), g = best && data.materials.find((x) => x.id === best.give);
      return row(`t:${get}`, why, () => onAct('trade', best.give, get),
        h('div', { class: 'row-top' }, ctx.icon(m.icon, 1), h('span', { class: 'row-name' }, ` ${best ? best.t.get : 1} ${m.name}`), h('span', { class: 'row-rank' }, g ? `for ${best.t.give} ${g.name}` : '')),
        why ? h('div', { class: 'why' }, why) : null);
    });
    fill(right, h('h2', null, 'Trades'), h('div', { class: 'list' }, ...rows));
  }

  /** The Apothecary: what you can buy, how many you hold, and the slots a run has. */
  function drawApothecary(doc, have) {
    const known = resolveContent(doc, data).consumables;
    const rows = data.consumables.filter((c) => known.includes(c.id)).map((c) => {
      const why = whyNotBuyConsumable(doc, data, c.id);
      return row(`b:${c.id}`, why, () => onAct('buy', c.id),
        h('div', { class: 'row-top' }, ctx.icon(c.icon, 1), h('span', { class: 'row-name' }, ` ${c.name}`), h('span', { class: 'row-rank' }, `Held: ${heldOf(doc, c.id)}`)),
        h('div', { class: 'row-desc' }, c.desc),
        costRow(ctx, data, c.cost, have), why ? h('div', { class: 'why' }, why) : null);
    });
    if (!rows.length) { drawLevels(doc); return; }
    fill(right, h('h2', null, `Wares (slots: ${consumableSlots(doc, data)})`), h('div', { class: 'list' }, ...rows));
  }

  /** The Cartographer: secret hints, bestiary milestones to claim, and the challenge runs. */
  function drawCartographer(doc) {
    const rows = [];
    if (levelEffect(doc, data, building, 'secretsOnMap')) for (const sc of secretsOf(data)) if (sc.hint) rows.push(info(sc.name, (doc.profile.codex || []).includes(`secret:${sc.id}`) ? 'Found' : '', sc.hint));
    if (levelEffect(doc, data, building, 'bestiary')) {
      rows.push(h('h2', null, 'Bestiary'));
      for (const r of bestiaryRows(doc, data)) {
        const why = whyNotClaim(doc, data, r.id);
        rows.push(row(`k:${r.id}`, why, () => onAct('claim', r.id),
          h('div', { class: 'row-top' }, h('span', { class: 'row-name' }, r.name), h('span', { class: 'row-rank' }, `${r.kills.toLocaleString('en-US')} kills`)),
          r.next ? h('div', { class: 'row-desc' }, claimText(data, r.next)) : h('div', { class: 'row-done' }, 'All claimed'),
          why && r.next ? h('div', { class: 'why' }, why) : null));
      }
    }
    if (levelEffect(doc, data, building, 'challenges')) {
      rows.push(h('h2', null, 'Challenge runs'));
      const won = new Set(doc.profile.challenges || []);
      for (const c of data.challenges) rows.push(info(c.name, won.has(c.id) ? 'Won' : '', c.desc, rewardText(data, 'challenge', c)));
    }
    if (!rows.length) { drawLevels(doc); return; }
    fill(right, h('h2', null, 'Charts'), h('div', { class: 'list' }, ...rows));
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

// ---------------------------------------------------------------- an item at the Smithy

/**
 * One item: wear it, raise its tier, or re-roll one of its affixes (the recipe's own, the first,
 * stays): pick the affix, then one of the three offered. get(): { doc }. onAct(action, ...args):
 * 'equip' uid, 'unequip' slot, 'upgradeGear' uid, 'reroll' uid at choice. The screen redraws with
 * refresh() after.
 */
export function gearScreen(ctx, { data, uid, get, onAct, onClose }) {
  const panelEl = h('div', { class: 'panel' });
  const note = h('div', { class: 'bld-note' });
  const el = h('div', { class: 'screen building-screen gear-screen' }, panelEl);
  const scope = createFocusScope(el, { initial: 'wear' });
  const say = (text) => { note.textContent = text || ''; };
  const refuse = (why) => { say(why); ctx.sound?.('ui_back'); };
  let picking = null; // the affix being re-rolled, while its offers show

  function draw() {
    const { doc } = get();
    const have = doc.profile.materials;
    const it = gearItems(doc).find((x) => x.uid === uid);
    if (!it) { onClose(); return; }
    const r = data.recipes.find((x) => x.id === it.id);
    const worn = gearEquipped(doc)[r.slot] === uid;
    const affixName = (id) => { const a = data.affixes.find((x) => x.id === id); return a ? affixText(a, it.tier) : id; };
    const rows = [];
    const wearWhy = worn ? null : whyNotEquip(doc, data, uid);
    rows.push(pressable('button', { cls: 'btn wide', key: 'wear', why: wearWhy, onClick: () => onAct(worn ? 'unequip' : 'equip', worn ? r.slot : uid), refuse }, worn ? 'Take off' : 'Wear'));
    const upCost = upgradeCost(data, it), upWhy = whyNotUpgradeGear(doc, data, uid);
    rows.push(pressable('div', { cls: 'list-row', key: 'tier', why: upWhy, onClick: () => onAct('upgradeGear', uid), refuse },
      h('div', { class: 'row-top' }, h('span', { class: 'row-name' }, 'Raise tier'), h('span', { class: 'row-rank' }, `T${it.tier} to T${Math.min(5, it.tier + 1)}`)),
      upCost && it.tier < 5 ? costRow(ctx, data, upCost, have) : null, upWhy ? h('div', { class: 'why' }, upWhy) : null));
    it.affixes.forEach((a, k) => {
      if (k === 0) { rows.push(h('div', { class: 'list-row static', data: { focus: 'a0' }, 'aria-disabled': 'true' }, h('div', { class: 'row-top' }, h('span', { class: 'row-name' }, affixName(a)), h('span', { class: 'row-rank' }, 'Fixed')))); return; }
      const why = whyNotReroll(doc, data, uid, k);
      rows.push(pressable('div', { cls: 'list-row', key: `a${k}`, why, onClick: () => { picking = k; draw(); scope.focusKey('o0'); }, refuse },
        h('div', { class: 'row-top' }, h('span', { class: 'row-name' }, affixName(a)), h('span', { class: 'row-rank' }, 'Re-roll')),
        costRow(ctx, data, rerollCost(it), have), why ? h('div', { class: 'why' }, why) : null));
      if (picking === k) {
        rerollOffer(doc, data, uid, k).forEach((o, j) => rows.push(pressable('div', { cls: 'list-row pick', key: `o${j}`, why: null, onClick: () => { picking = null; onAct('reroll', uid, k, o); }, refuse },
          h('div', { class: 'row-top' }, h('span', { class: 'row-name' }, `Into: ${affixName(o)}`)))));
      }
    });
    fill(panelEl, h('div', { class: 'bld-head' }, ctx.icon(r.icon, 2), h('h1', null, r.name), h('div', { class: 'bld-level' }, `${SLOT_NAMES[r.slot]}  T${it.tier}${worn ? '  Worn' : ''}`)),
      h('div', { class: 'list' }, ...rows), note, hint(ctx, ['confirm', 'Select'], '   ', ['back', 'Back']));
    scope.refresh();
  }
  draw();
  return {
    el, scope,
    onBack: () => { if (picking !== null) { picking = null; draw(); scope.focusKey('wear'); } else onClose(); },
    onAction(action) {
      const why = action === 'confirm' ? scope.current?.dataset.why : null;
      if (!why) return false;
      refuse(why);
      return true;
    },
    refresh: draw,
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
    hint(ctx, ['confirm', 'Select'], '   ', ['back', 'Back'])));
  return { el, scope: createFocusScope(el), onBack };
}

/**
 * The gate's second step: how the run sets out. rows(): the rows now (app/setup.js setupRows),
 * redrawn after every change since one choice can open or close others (a challenge has no
 * Tide). title(): who sets out (a challenge sets its own). summary(): a line under them (what the
 * choice adds to the haul), or null. The focused row's detail (what its value does) shows under
 * the list. onChange(key, value), onStart() (returns a refusal to show, or nothing), onBack().
 */
export function setupScreen(ctx, { title, rows, summary, onChange, onStart, onBack }) {
  const list = h('div', { class: 'settings-list' });
  const heading = h('h1', null, '');
  const detail = h('div', { class: 'setup-detail' });
  const note = h('div', { class: 'bld-note' });
  const start = button('Start run', 'start', () => { const why = onStart(); if (why) { note.textContent = why; ctx.sound?.('ui_back'); } }, { cls: 'wide' });
  const el = h('div', { class: 'screen settings-screen setup-screen' }, h('div', { class: 'panel' },
    heading, list, detail, note, h('div', { class: 'menu-col' }, start),
    hint(ctx, ['sides', 'Change'], '   ', ['confirm', 'Select'], '   ', ['back', 'Back'])));
  let current = [];
  const showDetail = (el2) => {
    const r = current.find((x) => x.key === el2?.dataset.focus);
    fill(detail, ...(r?.icon ? [ctx.icon(r.icon, 1)] : []), ...(r?.detail || []).filter(Boolean).map((line) => h('div', { class: 'row-desc' }, line)));
  };
  const scope = createFocusScope(el, { initial: 'start', onFocus: showDetail });
  const valueText = (r) => (r.kind === 'toggle' ? (r.value ? 'On' : 'Off') : (r.choices.find((c) => c[0] === r.value) || [null, String(r.value)])[1]);
  function draw() {
    current = rows();
    heading.textContent = title();
    fill(list, ...current.map((r) => h('div', { class: 'set-row', data: { focus: r.key }, onclick: () => step(r, 1) },
      h('span', { class: 'set-label' }, r.label), h('span', { class: 'set-value' }, '< ', valueText(r), ' >'))));
    note.textContent = summary() ?? '';
    scope.refresh();
    showDetail(scope.current);
  }
  function step(r, dir) {
    let v;
    if (r.kind === 'toggle') v = !r.value;
    else {
      if (!r.choices.length) return;
      const i = r.choices.findIndex((c) => c[0] === r.value);
      v = r.choices[((i < 0 ? 0 : i) + dir + r.choices.length) % r.choices.length][0];
    }
    if (v === r.value) return;
    ctx.sound?.('ui_move');
    onChange(r.key, v);
    const key = r.key;
    draw();
    scope.focusKey(key);
    showDetail(scope.current);
  }
  draw();
  return {
    el, scope, onBack,
    onNav(d) {
      const r = current.find((x) => x.key === scope.current?.dataset.focus);
      if (r && (d === 'left' || d === 'right')) { step(r, d === 'left' ? -1 : 1); return true; }
      return false;
    },
    onAction(a) {
      if (a !== 'confirm') return false;
      const r = current.find((x) => x.key === scope.current?.dataset.focus);
      if (r) { step(r, 1); return true; }
      return false;
    },
    refresh: draw,
  };
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

