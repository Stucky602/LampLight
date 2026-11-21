// The harbor's screens (ARCHITECTURE §10.4, §10.2 step 5): a building's panel (restore its next
// level; the Lamp Post's upgrades, the Library's research, who has come to the Tavern), the gate
// (choose who sets out), the results after a run, and the harbor's menu. Each builds a screen for
// ui.push() from plain data and callbacks; the app layer does the buying and saving.
//
// Something you can't do yet still takes focus and a press: it shows dimmed with the reason under
// it, and pressing it says the reason (with the menu's "no" sound) instead of doing nothing.
//
// ctx: { ui, icon(id, scale) -> element, sound(name) }.

import { TROPHY_DAMAGE } from '../data/trophies.js';   // (round 4: the Hunts row says its own number; the glossary entry folded into Harbor Orders)
import { h, fill } from './dom.js';
import { createFocusScope } from './focus.js';
import { hintRow, bandList } from './hints.js';
import { tagName } from './describe.js';
import { levelEffects, researchState, upgradeState, runsText, changeLines, optionText, joinsTexts, rewardText, tideText, countText, researchRunsText, mapIn, listText, killsText, readyNow, purchaseWarning, tierName } from './hubtext.js';
import { codexEntries, codexCount, weaponPage } from '../meta/codex.js';
import { weaponPageScreen } from './weaponpage.js';
import { ORDER_GROUPS } from '../data/feats.js';
import { rarityOfTier } from '../data/rarity.js';
import { levelOf, contentFrom, levelEffect, cursesAvailable, masteryOf, heldOf, resolveContent, featsDone, secretsOf, masteryRanks, tidesOpened, mapsOpen, orderPosted, killsOf } from '../meta/state.js';
import { nextLevelCost, nextRankCost, whyNotRestore, whyNotUpgrade, whyNotResearch, restoreBuilding, buyUpgrade, startResearch } from '../meta/actions.js';
import {
  gearItems, gearEquipped, gearSlotsOpen, whyNotCraft, whyNotBuyConsumable, consumableSlots,
  kitsOf, tradeTerms, whyNotTrade, marketRates, affixText, upgradeCost, whyNotUpgradeGear, whyNotEquip, whyNotReroll, rerollOffer, rerollCost,
  payOptions, raresLeft, raresCap, craftGear, buyConsumable, marketTrade,
} from '../meta/workshop.js';
import { featShown } from '../meta/feats.js';
import { skillPoints, skillsOf } from '../meta/skills.js';
import { SLOT_NAMES, GEAR_SLOTS } from '../data/gear.js';
import { term, termShort } from '../data/glossary.js';

/** A gear tier as its rarity (ruling 10): the word in a frame of its color (the word carries the meaning). */
export function rarityTag(tier) {
  const r = rarityOfTier(tier);
  return h('span', { class: `rarity rarity-${r.id}` }, r.name);
}

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

/** The hint row every screen shares (ui/hints.js). */
const hint = (ctx, ...parts) => hintRow(ctx, ...parts.filter((p) => p !== '   '));

/** Tag chips ("Fire", "Light"), as the level-up cards show them; null for none. */
function tagChips(tags) {
  if (!tags.length) return null;
  return h('div', { class: 'tags' }, ...tags.map((t) => h('span', { class: `tag tag-${t}` }, tagName(t))));
}

/** The tags of what a key brings (a project's weapons, passives, relics), each once. */
function tagsFrom(data, key) {
  const out = [];
  for (const c of contentFrom(data, key)) {
    const list = { weapon: data.weapons, passive: data.passives, relic: data.relics }[c.what] || [];
    for (const t of list.find((x) => x.id === c.id)?.tags || []) if (!out.includes(t)) out.push(t);
  }
  return out;
}


/** A cost as icons and counts; what you can't cover yet is marked. */
export function costRow(ctx, data, cost, have) {
  return h('div', { class: 'cost' }, ...Object.entries(cost).map(([id, n]) => {
    const m = data.materials.find((x) => x.id === id);
    const short = (have?.[id] ?? 0) < n;
    return h('span', { class: `cost-item${short ? ' short' : ''}`, title: m?.name ?? id }, ctx.icon(m?.icon ?? '', 1), ` ${Number(n).toLocaleString('en-US')}`);
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
 * 'buy', 'trade', 'train'), and onGear(uid): open an item at the Smithy.
 */
export function buildingScreen(ctx, { data, building, get, onRestore, onUpgrade, onResearch, onAct = () => {}, onGear = () => {}, onSkills = null, onOrders = null, onCodex = null, onClose }) {
  const b = data.buildings.find((x) => x.id === building);
  const head = h('div', { class: 'bld-head' });
  const left = h('div', { class: 'bld-col bld-next' });
  const right = h('div', { class: 'bld-col bld-list' });
  const note = h('div', { class: 'bld-note' });
  const body = h('div', { class: 'bld-body' }, left, right);
  const hints = h('div');
  const el = h('div', { class: `screen building-screen bld-${building}` },
    h('div', { class: 'panel' }, head, body, note, hints));
  // A purchase that would take a Ready level out of reach asks first (0.9.0, V4): its row says so,
  // and the first press only says it again; a second press on the same row buys.
  let armed = null;
  const scope = createFocusScope(el, { initial: 'restore', onFocus: (t) => { if (armed && t.dataset.focus !== armed) armed = null; } });
  const say = (text) => { note.textContent = text || ''; };
  const refuse = (why) => { say(why); ctx.sound?.('ui_back'); };
  /** The warning for a purchase (`make`: the profile it would leave), or null. */
  const warnOf = (doc, make, self = null) => { try { return purchaseWarning(doc, data, make(), self); } catch { return null; } };
  /** A press on a row with a warning: the first says it, the second buys. */
  const guarded = (key, warn, fn) => () => {
    if (!warn || armed === key) { armed = null; fn(); return; }
    armed = key;
    say(`${warn}. Press again to buy anyway.`);
    ctx.sound?.('ui_back');
  };
  /** A Phase 7 purchase's row press, through the warning (the workshop's own rule says what it leaves). */
  const SPEND = { craft: craftGear, trade: marketTrade, buy: buyConsumable };
  const actPress = (doc, key, why, name, ...args) => {
    const warn = why || !SPEND[name] ? null : warnOf(doc, () => SPEND[name](doc, data, ...args).doc);
    return guarded(key, warn, () => onAct(name, ...args));
  };
  /** The warning's line on a row (the warning color). */
  const warnLine = (warn) => (warn ? h('div', { class: 'warn' }, warn) : null);

  function draw() {
    const { doc } = get();
    const have = doc.profile.materials;
    const lv = levelOf(doc, building, data);
    // A purchase redraws both columns: the list keeps its scroll, and the focus its row (by key).
    const scroll = right.querySelector('.list')?.scrollTop ?? 0;
    // The Lighthouse (0.9.0) counts stages, not levels.
    const staged = Array.isArray(b.stages);
    fill(head, h('h1', null, b.name), h('div', { class: 'bld-level' }, lv === 0 ? 'Ruined' : staged ? `Stage ${lv} of ${b.levels.length}` : `Lv ${lv}/${b.levels.length}`), h('p', { class: 'bld-desc' }, b.desc));
    // The next level.
    const cost = nextLevelCost(doc, data, building);
    // Fully restored: no next level to show, so the list takes the whole width (0.7.3).
    body.classList.toggle('full', !cost);
    fill(hints, building === 'market' && marketRates(doc, data) ? hint(ctx, ['confirm', 'Trade'], ['sides', 'Pay with'], ['back', 'Back']) : hint(ctx, ['confirm', 'Select'], ['back', 'Back']));
    if (!cost) fill(left);
    else {
      const why = whyNotRestore(doc, data, building);
      const warn = why ? null : warnOf(doc, () => restoreBuilding(doc, data, building).doc, building);
      fill(left,
        h('h2', null, staged ? `Next: ${b.stages[lv]}` : lv === 0 ? 'Restore' : `Next: Lv ${lv + 1}`),
        h('ul', { class: 'effects' }, ...levelEffects(data, building, lv + 1).map((e) => h('li', null, e.text))),
        costRow(ctx, data, cost, have),
        pressable('button', { cls: 'btn wide', key: 'restore', why, onClick: guarded('restore', warn, () => onRestore()), refuse }, 'Restore'),
        why ? h('div', { class: 'why' }, why) : warnLine(warn));
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
    else if (Array.isArray(b.stages)) drawStages(doc);
    else drawLevels(doc);
    const list = right.querySelector('.list');
    if (list) list.scrollTop = scroll;
    // Right from Restore goes to the list's first row in view (0.9.0, V4: it landed on the second).
    const restoreBtn = left.querySelector('[data-focus="restore"]');
    const firstRow = [...right.querySelectorAll('[data-focus]')].find((r) => !list || (r.offsetTop ?? 0) >= (list.scrollTop || 0)) ?? right.querySelector('[data-focus]');
    if (restoreBtn && firstRow) restoreBtn.dataset.navRight = firstRow.dataset.focus;
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
      const warn = why ? null : warnOf(doc, () => buyUpgrade(doc, data, u.id).doc);
      return row(`u:${u.id}`, why, guarded(`u:${u.id}`, warn, () => onUpgrade(u.id)),
        h('div', { class: 'row-top' }, h('span', { class: 'row-name' }, u.name), h('span', { class: 'row-rank' }, `${st.rank}/${st.ranks}`)),
        h('div', { class: 'row-desc' }, u.desc),
        !st.open ? h('div', { class: 'why' }, st.why)
          : !cost ? h('div', { class: 'row-done' }, 'All ranks bought')
            : [costRow(ctx, data, cost, have), why ? h('div', { class: 'why' }, why) : warnLine(warn)]);
    });
    fill(right, h('h2', null, 'Harbor upgrades'), bandList({ class: 'list' }, ...rows));
  }

  function drawResearch(doc, have) {
    const rows = data.research.map((r) => {
      const st = researchState(doc, data, r);
      // Every row can say why it can't start: done, under way, locked, the Library busy, short.
      const why = whyNotResearch(doc, data, r.id);
      const warn = why ? null : warnOf(doc, () => startResearch(doc, data, r.id).doc);
      const status = st.state === 'done' ? h('div', { class: 'row-done' }, 'Complete')
        : st.state === 'active' ? h('div', { class: 'row-active' }, `In progress: ${researchRunsText(data, r, st.runsLeft)}`)
          : st.state === 'locked' ? h('div', { class: 'why' }, st.why)
            : [costRow(ctx, data, r.cost, have), why ? h('div', { class: 'why' }, why) : warnLine(warn)];
      const adds = joinsTexts(contentFrom(data, `research:${r.id}`));
      // (0.9.0, V4: a project's flavor line is the writerly fragment WRITING.md §5 keeps off a
      // screen where you choose; the row says what it adds. The line stays in the data for a codex.)
      return row(`r:${r.id}`, why, guarded(`r:${r.id}`, warn, () => onResearch(r.id)),
        h('div', { class: 'row-top' }, h('span', { class: 'row-name' }, r.name), h('span', { class: 'row-rank' }, runsText(r.runs))),   // (RULING-L1: tier keeps one meaning)
        // 0.8.0: a project that counts only runs on one map.
        r.runsOn ? h('div', { class: 'row-adds' }, `Counts only runs on ${mapIn(data, r.runsOn)}`) : null,
        ...adds.map((line) => h('div', { class: 'row-adds' }, line)),
        tagChips(tagsFrom(data, `research:${r.id}`)),
        status);
    });
    // 0.9.0: the codex is read here (meta/codex.js), its count on the first row.
    const cc = codexCount(doc, data);
    const codexRow = onCodex ? row('codex', null, () => onCodex(),
      h('div', { class: 'row-top' }, h('span', { class: 'row-name' }, 'Codex'), h('span', { class: 'row-rank' }, `${cc.seen} of ${cc.of} seen`)),
      h('div', { class: 'row-desc' }, 'Every weapon, passive, relic, enemy, boss, and map, and where to find the ones you haven\'t seen.')) : null;
    fill(right, h('h2', null, 'Research'), h('p', { class: 'row-desc' }, 'A run counts toward research if you survive 5:00 or kill a boss.'), bandList({ class: 'list' }, ...(codexRow ? [codexRow] : []), ...rows));
  }

  /** Level by level, what the building opens (`kinds`: which effects; all when null). */
  function levelRows(doc, kinds = null) {
    const lines = [];
    const at = levelOf(doc, building, data), shownLeft = !!nextLevelCost(doc, data, building);
    for (let lv = 1; lv <= b.levels.length; lv++) {
      const reached = at >= lv;
      // (Round 2, L1 29b: the next level is on the left under its Restore button; the list doesn't say it twice.)
      if (lv === at + 1 && shownLeft) continue;
      const eff = levelEffects(data, building, lv).filter((e) => (kinds ? kinds.includes(e.kind) : e.kind !== 'more'));
      if (!eff.length) continue;
      lines.push(h('div', { class: `list-row static${reached ? '' : ' off'}`, data: { focus: `lv:${lv}` }, 'aria-disabled': 'true' }, h('div', { class: 'row-top' }, h('span', { class: 'row-name' }, `Lv ${lv}`), h('span', { class: 'row-rank' }, reached ? 'Restored' : lv === levelOf(doc, building, data) + 1 ? 'Next' : '')), ...eff.map((e) => h('div', { class: 'row-desc' }, e.text))));
    }
    return lines;
  }

  function drawLevels(doc) { fill(right, h('h2', null, 'Levels'), bandList({ class: 'list' }, ...levelRows(doc))); }

  /** The Lighthouse (0.9.0): its ten stages, each named, with what it shows and opens. */
  function drawStages(doc) {
    const at = levelOf(doc, building, data);
    const rows = b.levels.map((_, i) => {
      const n = i + 1;
      const eff = levelEffects(data, building, n).filter((e) => !(e.kind === 'rule' && e.text.startsWith('Stage ')));
      return h('div', { class: `list-row static${at >= n ? '' : ' off'}`, data: { focus: `st:${n}` }, 'aria-disabled': 'true' },
        h('div', { class: 'row-top' }, h('span', { class: 'row-name' }, `${n}. ${b.stages[i]}`), h('span', { class: 'row-rank' }, at >= n ? 'Done' : n === at + 1 ? 'Next' : '')),
        ...eff.map((e) => h('div', { class: 'row-desc' }, e.text)));
    });
    fill(right, h('h2', null, `Stages: ${at} of ${b.levels.length}`), bandList({ class: 'list' }, ...rows));
  }

  /**
   * A static row: a name, a note on the right, and lines under it. It takes focus like any row
   * (pressing it does nothing and makes no sound: aria-disabled), so a pad scrolls the list to
   * every row, not just the last one it could buy (§8: everything usable with a controller alone).
   * Its key is its name's (no two rows on one panel share a name: tests/hubscene.test.js).
   */
  function info(name, note, ...lines) {
    return h('div', { class: 'list-row static', data: { focus: `i:${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}` }, 'aria-disabled': 'true' }, h('div', { class: 'row-top' }, h('span', { class: 'row-name' }, name), h('span', { class: 'row-rank' }, note ?? '')), ...lines.filter(Boolean).map((l) => h('div', { class: 'row-desc' }, l)));
  }

  /**
   * The Tavern in three parts (0.7.3): Levels (who and what each level brings back, its keeper too;
   * gone once it's fully restored), Mastery (each character's rank, kits, and the way into their
   * skill tree), and Feats.
   */
  function drawTavern(doc, have) {
    const rows = [];
    const full = levelOf(doc, building, data) >= b.levels.length;
    if (!full) {
      rows.push(h('h2', null, 'Levels'));
      rows.push(...levelRows(doc, ['arrival', 'rule', 'joins', 'keeper']));
    }
    // 0.9.0 (W2): who hasn't come yet, and how they come (brief §6.5: the way shows at the Tavern).
    const coming = data.characters.filter((c) => c.find && !resolveContent(doc, data).characters.includes(c.id));
    if (coming.length && levelOf(doc, building, data) >= 1) {
      rows.push(h('h2', null, 'Still to come'));
      for (const c of coming) rows.push(info(c.name, null, c.find));
    }
    if (levelEffect(doc, data, building, 'mastery')) {
      rows.push(h('h2', null, 'Mastery'));
      const MT = data.tuning.mastery;
      rows.push(h('p', { class: 'row-desc' }, `A character earns ${MT.perMinute} mastery ${MT.perMinute === 1 ? 'point' : 'points'} a minute and ${MT.perBoss} for each boss killed. Ranks go up to ${masteryRanks(data).length}. ${termShort('skills')}`));
      for (const id of resolveContent(doc, data).characters) {
        const c = data.characters.find((x) => x.id === id), m = masteryOf(doc, data, id);
        const kits = kitsOf(doc, data, id).filter((k) => k.id);
        const wName = (id) => data.weapons.find((w) => w.id === id)?.name ?? id;
        rows.push(info(`${c.name}'s mastery`, `Rank ${m.rank}`, m.next ? `${m.xp} of ${m.next} points to rank ${m.rank + 1}` : `${m.xp} points, the top rank`,
          c.signature ? `Signature weapon: ${wName(c.signature)}` : null,
          ...kits.filter((k) => k.rank !== undefined).map((k) => `Start with the ${wName(k.start)}: ${k.open ? 'pick it at the gate' : `opens at rank ${k.rank}`}`),
          // The weapon orders' kits (0.9.0) are anyone's: one line for them all.
          kits.some((k) => k.rank === undefined) ? `Starting weapons from Harbor Orders: ${kits.filter((k) => k.rank === undefined && k.open).length} of ${kits.filter((k) => k.rank === undefined).length} open` : null));
        // Ruling 15: the character's skill tree, a screen of its own (ui/skillscreen.js).
        const pts = skillPoints(doc, data, id), names = skillsOf(doc, data, id).map((k) => data.skills.find((x) => x.id === k).name);
        rows.push(row(`k:${id}`, null, () => onSkills?.(id),
          h('div', { class: 'row-top' }, h('span', { class: 'row-name' }, `${c.name}'s skills`), h('span', { class: 'row-rank' }, `${pts.spent} of ${pts.earned} ${pts.earned === 1 ? 'point' : 'points'} spent`)),
          h('div', { class: 'row-desc' }, names.length ? `In play: ${listText(names)}.` : 'No skills taken yet.'),
          pts.left > 0 ? h('div', { class: 'row-ready' }, `${pts.left} to spend`) : null));
      }
    }
    if (levelEffect(doc, data, building, 'feats')) {
      // 0.9.0: the feats are the Harbor Orders, on a board of their own (ordersScreen).
      const done = featsDone(doc, data), found = new Set(doc.profile.featsFound || []);
      const open = data.feats.filter((f) => !done.has(f.id) && featShown(f, done, found)).sort((a, z) => (a.tier ?? 1) - (z.tier ?? 1)).slice(0, 3);
      rows.unshift(row('orders', null, () => onOrders?.(),
        h('div', { class: 'row-top' }, h('span', { class: 'row-name' }, 'Harbor Orders'), h('span', { class: 'row-rank' }, (() => { const posted = data.feats.filter((f) => orderPosted(doc, data, f)); return `${posted.filter((f) => done.has(f.id)).length} of ${posted.length} done`; })())),
        h('div', { class: 'row-desc' }, termShort('feat')),
        ...open.map((f) => h('div', { class: 'row-adds' }, `${f.name}: ${f.desc}`))));
    }
    if (!rows.length) { drawLevels(doc); return; }
    fill(right, bandList({ class: 'list' }, ...rows));
  }

  /** The Smithy: gear to make, the gear you have (press for an item), and what its levels do for the weapon you set out with. */
  function drawSmithy(doc, have) {
    const rows = [];
    const open = gearSlotsOpen(doc, data), eq = gearEquipped(doc);
    rows.push(info('Wearing', `${Object.keys(eq).filter((k) => open.includes(k)).length} of ${open.length} slots`,
      ...GEAR_SLOTS.map((slot) => {
        const it = gearItems(doc).find((x) => x.uid === eq[slot]);
        if (!open.includes(slot)) return null;
        return `${SLOT_NAMES[slot]}: ${it ? `${data.recipes.find((r) => r.id === it.id)?.name ?? it.id}, ${tierName(it.tier)}` : 'nothing'}`;
      })));
    for (const it of gearItems(doc)) {
      const r = data.recipes.find((x) => x.id === it.id);
      if (!r) continue;
      const worn = eq[r.slot] === it.uid;
      rows.push(row(`g:${it.uid}`, null, () => onGear(it.uid),
        h('div', { class: 'row-top' }, ctx.icon(r.icon, 1), h('span', { class: 'row-name' }, ` ${r.name}`), h('span', { class: 'row-rank' }, rarityTag(it.tier), worn ? ', worn' : '')),
        h('div', { class: 'row-desc' }, it.affixes.map((a) => { const af = data.affixes.find((x) => x.id === a); return af ? affixText(af, it.tier) : a; }).join(', '))));
    }
    rows.push(h('h2', null, 'Make new gear'));
    const known = resolveContent(doc, data).recipes;
    for (const r of data.recipes.filter((x) => known.includes(x.id))) {
      const why = whyNotCraft(doc, data, r.id);
      const base = data.affixes.find((x) => x.id === r.base);
      rows.push(row(`c:${r.id}`, why, actPress(doc, `c:${r.id}`, why, 'craft', r.id),
        h('div', { class: 'row-top' }, ctx.icon(r.icon, 1), h('span', { class: 'row-name' }, ` ${r.name}`), h('span', { class: 'row-rank' }, SLOT_NAMES[r.slot])),
        h('div', { class: 'row-desc' }, `${affixText(base, 1)}, plus 1 random bonus`),
        costRow(ctx, data, r.cost, have), why ? h('div', { class: 'why' }, why) : null));
    }
    if (!known.length) rows.push(info('Nothing to make yet', '', term('gear').where));
    if (levelEffect(doc, data, building, 'tempering')) {
      rows.push(h('h2', null, 'Tempering'));
      rows.push(h('p', { class: 'row-desc' }, termShort('tempering')));
    }
    fill(right, h('h2', null, 'Your gear'), wholeRows(bandList({ class: 'list' }, ...rows)));
  }

  /**
   * The Chapel: the Tides and the curses (chosen at the gate), each with what opens it. 0.8.0: each
   * map has its own Tides (a Tide opens on a map by killing that map's last boss at the one below),
   * and the Chapel caps them all alike.
   */
  function drawChapel(doc) {
    const cap = levelEffect(doc, data, building, 'tideMax');
    const needLv = (key, n) => `Opens at Chapel Lv ${b.levels.findIndex((l) => (l[key] ?? 0) >= n) + 1}`;
    const open = mapsOpen(doc, data);
    const several = open.length > 1;
    const rows = data.tides.map((t) => {
      const on = open.filter((id) => tidesOpened(doc, id) >= t.level).map((id) => data.maps.find((m) => m.id === id).name);
      const state = t.level > cap ? needLv('tideMax', t.level)
        : on.length ? (several ? `Open on ${listText(on)}` : 'Open')
          : t.level === 1 ? 'Kill the last boss to open it' : `Kill the last boss at Tide ${t.level - 1} to open it`;
      return info(`Tide ${t.level}`, state, tideText(t), t.rule?.desc ? `New rule: ${t.rule.desc}` : null);
    });
    const cs = cursesAvailable(doc, data).map((c) => c.id);
    rows.push(h('h2', null, 'Curses'));
    data.curses.forEach((c, i) => rows.push(info(c.name, cs.includes(c.id) ? 'Open' : needLv('curses', i + 1), c.desc, `Pays ${Math.round(c.rewardMul * 100)}% more materials`)));
    fill(right, h('h2', null, 'Tides'), h('p', { class: 'row-desc' }, `Kill the last boss at your highest Tide to open the next one.${several ? ' Each map has its own Tides.' : ''} From Tide 2 each Tide adds a rule, and keeps the ones below it. Curses can be added to any run.`), bandList({ class: 'list' }, ...rows));
  }

  /**
   * The Market (0.7.3): an Amount row (how many trades one press makes), then one row a material,
   * each saying what you get and what it costs, with what you pay with chosen on the row (left and
   * right; it starts on the common material you hold the most of). Rares are capped between runs.
   */
  function drawMarket(doc, have) {
    const rates = marketRates(doc, data);
    if (!rates) { drawLevels(doc); return; }
    const all = [...data.market.common, ...data.market.rare];
    const amountRow = h('div', { class: 'set-row', data: { focus: 'amt' }, onclick: () => stepAmount(1) },
      h('span', { class: 'set-label' }, 'Amount'), h('span', { class: 'set-value' }, '< ', `${market.times}x`, ' >'));
    const rows = all.map((get) => {
      const give = payWith(doc, get);
      const t = give ? tradeTerms(doc, data, give, get) : null;
      const why = give ? whyNotTrade(doc, data, give, get, market.times) : 'Nothing to trade';
      const m = data.materials.find((x) => x.id === get), g = give && data.materials.find((x) => x.id === give);
      return row(`t:${get}`, why, actPress(doc, `t:${get}`, why, 'trade', give, get, market.times),
        h('div', { class: 'row-top' }, ctx.icon(m.icon, 1), h('span', { class: 'row-name' }, ` ${t ? t.get * market.times : market.times} ${m.name}`), h('span', { class: 'row-rank' }, g ? `for ${t.give * market.times} ${g.name}` : '')),
        g ? h('div', { class: 'row-desc' }, '< Pay with', ctx.icon(g.icon, 1), ` ${g.name} (you have ${countText(have[give] ?? 0)}) >`) : null,
        why ? h('div', { class: 'why' }, why) : null);
    });
    const left = raresLeft(doc, data);
    const cap = Number.isFinite(raresCap(doc, data)) ? h('p', { class: 'row-desc' }, `${listText(data.market.rare.map((id) => data.materials.find((x) => x.id === id).name), 'and')} left to buy before your next run: ${left} of ${raresCap(doc, data)}`) : null;
    fill(right, h('h2', null, 'Trades'), cap, bandList({ class: 'list' }, amountRow, ...rows));
  }

  /** The Market's choices on this panel: how many trades a press makes, and what each row pays with. */
  const market = { times: 1, pay: {} };
  const AMOUNTS = [1, 5, 10, 25];
  /** What a row pays with: the player's choice, else the common they hold most of (a rare only when no common covers one trade). */
  function payWith(doc, get) {
    const opts = payOptions(doc, data, get);
    if (market.pay[get] && opts.includes(market.pay[get])) return market.pay[get];
    const have = doc.profile.materials;
    let best = null;
    for (const pool of [data.market.common, data.market.rare]) {
      for (const give of pool) {
        const t = tradeTerms(doc, data, give, get);
        if (!t) continue;
        const n = Math.floor((have[give] ?? 0) / t.give);
        if (!best || n > best.n || (best.n === 0 && n === 0 && pool === data.market.common)) best = { give, n };
      }
      if (best && best.n > 0) break;
    }
    return best?.give ?? null;
  }
  function stepAmount(dir) {
    const i = AMOUNTS.indexOf(market.times);
    market.times = AMOUNTS[(i + dir + AMOUNTS.length) % AMOUNTS.length];
    ctx.sound?.('ui_move');
    draw();
  }
  function stepPay(get, dir) {
    const { doc } = get_();
    const opts = payOptions(doc, data, get);
    if (opts.length < 2) return;
    const i = opts.indexOf(payWith(doc, get));
    market.pay[get] = opts[(i + dir + opts.length) % opts.length];
    ctx.sound?.('ui_move');
    draw();
  }
  const get_ = get;

  /** The Apothecary: the run tools you can buy, how many you hold, the slots a run has, and its healing side. */
  function drawApothecary(doc, have) {
    const known = resolveContent(doc, data).consumables;
    const rows = data.consumables.filter((c) => known.includes(c.id)).map((c) => {
      const why = whyNotBuyConsumable(doc, data, c.id);
      return row(`b:${c.id}`, why, actPress(doc, `b:${c.id}`, why, 'buy', c.id),
        h('div', { class: 'row-top' }, ctx.icon(c.icon, 1), h('span', { class: 'row-name' }, ` ${c.name}`), h('span', { class: 'row-rank' }, `You have ${heldOf(doc, c.id)}`)),
        h('div', { class: 'row-desc' }, c.desc),
        costRow(ctx, data, c.cost, have), why ? h('div', { class: 'why' }, why) : null);
    });
    const n = consumableSlots(doc, data);
    if (!n) { drawLevels(doc); return; }
    const food = levelEffect(doc, data, building, 'foodHeal');
    const more = data.consumables.length - known.length;
    fill(right, h('h2', null, 'Run tools'),
      h('p', { class: 'row-desc' }, `${termShort('consumable')} You can take ${n} into each run.`),
      food ? h('p', { class: 'row-desc' }, `Food heals ${Math.round(food * 100)}% more in your runs.`) : null,
      rows.length ? bandList({ class: 'list' }, ...rows) : h('p', { class: 'row-desc' }, 'Nothing on the shelf yet.'),
      more > 0 ? h('p', { class: 'row-desc' }, `${more} more ${more === 1 ? 'tool comes' : 'tools come'} from Harbor Orders, research, and this building's levels.`) : null);
  }

  /** The Cartographer: what the charts mark on your minimap, and the hints for the big secrets. */
  function drawCartographer(doc) {
    const rows = [];
    const marks = [['tasksOnMap', 'Reliquaries, wherever they drop'], ['findsOnMap', 'Small secrets'], ['secretsOnMap', 'Big secrets']];
    const hasAll = levelEffect(doc, data, building, 'secretsOnMap') > 0;
    rows.push(info('On your minimap', '', 'Wayside Lamps, Fog Bells, the Ferryman, chests, and elites, for everyone.',
      ...marks.map(([key, words]) => `${words}: ${levelEffect(doc, data, building, key) || (key === 'findsOnMap' && hasAll) ? 'marked' : `at Lv ${b.levels.findIndex((l) => l[key]) + 1}`}`)));
    if (levelEffect(doc, data, building, 'challenges')) {
      const runs = data.feats.filter((f) => f.rules && orderPosted(doc, data, f)), done = featsDone(doc, data);
      rows.push(info('Challenge runs', `${runs.filter((f) => done.has(f.id)).length} of ${runs.length} done`, `${termShort('challenge')} Start one from the Harbor Orders board at the ${data.buildings.find((x) => x.id === 'tavern').name}.`));
    }
    if (hasAll) {
      rows.push(h('h2', null, 'Secrets'));
      for (const sc of secretsOf(data)) if (sc.hint) rows.push(info(sc.name, (doc.profile.codex || []).includes(`secret:${sc.id}`) ? 'Found' : '', sc.hint));
    }
    if (!levelOf(doc, building, data)) { drawLevels(doc); return; }
    fill(right, h('h2', null, 'Charts'), bandList({ class: 'list' }, ...rows));
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
    /** The Market's rows: left and right change the amount, or what a row pays with. */
    onNav(d) {
      if (d !== 'left' && d !== 'right') return false;
      const key = scope.current?.dataset.focus ?? '';
      const dir = d === 'left' ? -1 : 1;
      if (key === 'amt') { stepAmount(dir); return true; }
      if (building === 'market' && key.startsWith('t:')) { stepPay(key.slice(2), dir); return true; }
      return false;
    },
    refresh: draw,
    /** A line under the panel (what just happened, or why not). */
    say,
  };
}

/**
 * A banded list that ends on a whole row (0.9.0, V5: the Smithy's list cut a card in half behind
 * its "15 more" band, so a cost row showed half): each time the list is updated (focus, scroll),
 * its height is trimmed to the bottom of the last row that fits whole, and the band under it counts
 * the rest. Measured in the page, so it does nothing where there's no layout (the tests' DOM).
 */
function wholeRows(banded) {
  const B = banded.bands, list = B.list, update = B.update;
  const trim = () => {
    list.style.maxHeight = '';
    const view = list.getBoundingClientRect?.();
    if (!view || !(view.height > 0)) return;
    let cut = 0;
    for (const r of list.children) {
      const b = r.getBoundingClientRect();
      if (b.height <= 0) continue;
      if (b.bottom <= view.bottom + 0.5) cut = Math.max(cut, b.bottom - view.top);
      else if (b.top < view.bottom) break;
    }
    if (cut > 0 && cut < view.height - 0.5) list.style.maxHeight = `${Math.floor(cut) + 1}px`;
  };
  B.update = (focused = null) => { trim(); update(focused); trim(); update(null); };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => B.update());
  return banded;
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
      h('div', { class: 'row-top' }, h('span', { class: 'row-name' }, it.tier < 5 ? `Improve to ${tierName(it.tier + 1)}` : 'Improve'), h('span', { class: 'row-rank' }, it.tier < 5 ? rarityTag(it.tier + 1) : 'Legendary is the top')),
      upCost && it.tier < 5 ? costRow(ctx, data, upCost, have) : null, upWhy ? h('div', { class: 'why' }, upWhy) : null));
    it.affixes.forEach((a, k) => {
      if (k === 0) { rows.push(h('div', { class: 'list-row static', data: { focus: 'a0' }, 'aria-disabled': 'true' }, h('div', { class: 'row-top' }, h('span', { class: 'row-name' }, affixName(a)), h('span', { class: 'row-rank' }, 'Always kept')))); return; }
      const why = whyNotReroll(doc, data, uid, k);
      rows.push(pressable('div', { cls: 'list-row', key: `a${k}`, why, onClick: () => { picking = k; draw(); scope.focusKey('o0'); }, refuse },
        h('div', { class: 'row-top' }, h('span', { class: 'row-name' }, affixName(a)), h('span', { class: 'row-rank' }, 'Reroll it')),
        costRow(ctx, data, rerollCost(it), have), why ? h('div', { class: 'why' }, why) : null));
      if (picking === k) {
        rerollOffer(doc, data, uid, k).forEach((o, j) => rows.push(pressable('div', { cls: 'list-row pick', key: `o${j}`, why: null, onClick: () => { picking = null; onAct('reroll', uid, k, o); }, refuse },
          h('div', { class: 'row-top' }, h('span', { class: 'row-name' }, `Change to ${affixName(o)}`)))));
      }
    });
    fill(panelEl, h('div', { class: 'bld-head' }, ctx.icon(r.icon, 2), h('h1', null, r.name), h('div', { class: 'bld-level' }, `${SLOT_NAMES[r.slot]}, `, rarityTag(it.tier), worn ? ', worn' : '')),
      bandList({ class: 'list' }, ...rows), note, hint(ctx, ['confirm', 'Select'], '   ', ['back', 'Back']));
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

/**
 * The gate's first step once a second map is open (0.8.0): where first, a card per map (ui/hubtext.js
 * mapCard: what drops there alone, which of Next up's three it moves, the research counting there,
 * the Tides open there). cards: [{ id, name, desc, lines }]; initial: the map last chosen.
 */
export function mapScreen(ctx, { cards, initial = null, onPick, onBack }) {
  const els = cards.map((c, i) => h('div', { class: 'card map-card', data: { focus: `m${i}` }, onclick: () => onPick(c.id) },
    h('div', { class: 'card-title' }, c.name),
    h('div', { class: 'card-desc' }, c.desc),
    ...c.lines.map((l) => h('div', { class: 'map-line' }, l))));
  const big = (ctx.ui?.textScale ?? 1) > 1;   // (larger text: the tighter spacing of gateScreen's, C3)
  const el = h('div', { class: `screen gate-screen map-screen${big ? ' big' : ''}` }, h('div', { class: 'panel' },
    h('h1', null, 'Gate'),
    h('h2', null, 'Choose a map'),
    h('div', { class: 'cards' }, ...els),
    hint(ctx, ['confirm', 'Select'], '   ', ['back', 'Back'])));
  const at = Math.max(0, cards.findIndex((c) => c.id === initial));
  return { el, scope: createFocusScope(el, { initial: `m${at}` }), onBack };
}

/** A text's first sentence (to its first ". "), kept whole: a card's one line. */
function firstSentence(text) {
  if (!text) return '';
  const k = text.indexOf('. ');
  return k < 0 ? text : text.slice(0, k + 1);
}

/**
 * characters: [{ id, name, who, desc, sprite, startName, signatureName, dashName, gives, costs }];
 * map: { name, desc }.
 * C3 (ruling 14 E: a short character select): each card is the character's picture, name, and four
 * lines in one size and color: who they are, what they do (its first sentence), what it costs (the
 * same size as the rest, never the dimmest line), and the dash they start with. The rest (the whole
 * of what they do, what only they do on the map, their own weapon and their first one) shows under
 * the cards for the one in focus, so six cards fit a 1080p screen at any text size.
 */
export function gateScreen(ctx, { characters, map, onSetOut, onBack, marsh = true }) {
  // RULING-L1: each card is three short lines (what they do, their drawback, their dash), the strip
  // under the cards says who they are and their weapons, and the rules in full are on a Details page
  // (one rule a row; the Salt Marsh's rows only once the Marsh is open). Larger text (125%, 150%:
  // rulings 18 P2 and 19 PB): the strip goes to two columns; at any size it scrolls inside the panel,
  // so the hint row stays in view.
  const big = (ctx.ui?.textScale ?? 1) > 1;
  const cards = characters.map((c, i) => h('div', { class: 'card char-card', data: { focus: `c${i}` }, onclick: () => onSetOut(c.id) },
    h('div', { class: 'card-art' }, ctx.icon(c.sprite, characters.length > 4 || big ? 2 : 3)),
    h('div', { class: 'card-title' }, c.name),
    h('div', { class: 'char-line' }, c.card?.does ?? firstSentence(c.desc)),
    c.costs ? h('div', { class: 'char-line' }, `Drawback: ${c.card?.costs ?? firstSentence(c.costs)}`) : null,
    c.dashName ? h('div', { class: 'char-line' }, `Dash: ${c.dashName}`) : null));
  const detail = h('div', { class: 'char-detail' });
  let focused = characters[0] ?? null;
  const showDetail = (el) => {
    const key = String(el?.dataset?.focus ?? 'c0');
    if (!/^c\d+$/.test(key)) return;   // (a line of the strip in focus: the strip stays)
    const c = characters[Number(key.slice(1))] ?? characters[0];
    if (!c) return;
    focused = c;
    // Each line takes the pad's focus (read only), so focus walking down the strip scrolls it, and
    // up from any line goes back to the character's card (ruling 19 PB).
    let k = 0;
    const line = (text) => (text ? h('div', { class: 'row-desc strip-line', data: { focus: `d${k++}` }, 'aria-disabled': 'true' }, text) : null);
    const weapons = [c.signatureName && `Signature weapon: ${c.signatureName}`, c.startName && `Starting weapon: ${c.startName}`].filter(Boolean).join('. ');
    // The character's ledger (ruling 19 PF): what they have done, one line, off the tree screen too.
    const ledger = c.ledger?.length ? `Ledger: ${c.ledger.join('. ')}.` : null;
    if (big) fill(detail, h('div', { class: 'card-title' }, c.name), h('div', { class: 'char-col' }, line(c.who), line(ledger)), h('div', { class: 'char-col' }, line(weapons)));
    else fill(detail, h('div', { class: 'card-title' }, c.name), line(c.who), line(weapons), line(ledger));
    for (const col of big ? detail.querySelectorAll('.char-col') : [detail]) {
      const top = col.querySelector('[data-focus]');
      if (top) top.dataset.navUp = key;
    }
    detail.scrollTop = 0;
    detail.querySelector('.card-title')?.appendChild(more);
    moreCheck();
  };
  // "More below" beside the strip's name while it holds more than it shows (the pad's down walks it).
  const more = h('div', { class: 'strip-more', hidden: true }, 'More below');
  const moreCheck = () => {
    const raf = globalThis.requestAnimationFrame;
    const run = () => { more.hidden = !(detail.scrollHeight > detail.clientHeight + 1 && detail.scrollTop + detail.clientHeight < detail.scrollHeight - 1); };
    if (raf) raf(run); else run();
  };
  detail.addEventListener?.('scroll', moreCheck);
  const openDetails = () => { if (focused && ctx.ui?.push) { const d = characterDetailsScreen(ctx, { c: focused, marsh, onBack: () => ctx.ui.close(d) }); ctx.ui.push(d); } };
  const el = h('div', { class: `screen gate-screen${big ? ' big' : ''}` }, h('div', { class: 'panel' },
    h('h1', null, map.name),
    map.desc && !big ? h('p', { class: 'card-desc center' }, map.desc) : null,   // (larger text: the map's card said it)
    h('h2', null, 'Choose a character'),
    h('div', { class: `cards char-cards${characters.length > 4 ? ' many' : ''}` }, ...cards),
    detail,
    hint(ctx, ['confirm', 'Select'], '   ', ['reroll', 'Details'], '   ', ['back', 'Back'])));
  showDetail(null);
  return { el, scope: createFocusScope(el, { onFocus: showDetail }), onBack, onAction: (a) => { if (a === 'reroll') { openDetails(); return true; } return false; } };
}

/**
 * A character's Details page (RULING-L1): every rule in full, one a row, in three groups: on the map,
 * the drawback, and the dash; then their weapons. The Salt Marsh's rows wait until the Marsh is open.
 * c: a gate character (gateScreen); marsh: the Marsh is open.
 */
export function characterDetailsScreen(ctx, { c, marsh = true, onBack }) {
  const rules = (text) => String(text || '').split(/(?<=\.)\s+/).map((x) => x.trim()).filter(Boolean).filter((x) => marsh || !/\bMarsh\b/.test(x));
  let k = 0;
  const row = (text) => h('div', { class: 'list-row static', data: { focus: `r${k++}` }, 'aria-disabled': 'true' }, h('div', { class: 'row-desc' }, text));
  const group = (title, list) => (list.length ? [h('h2', null, title), ...list.map(row)] : []);
  const el = h('div', { class: 'screen char-details' }, h('div', { class: 'panel' },
    h('h1', null, c.name),
    c.who ? h('p', { class: 'card-desc center' }, c.who) : null,
    bandList({ class: 'list' },
      ...group('What they do', [...rules(c.desc), ...rules(c.gives)]),
      ...group('Drawback', rules(c.costs)),
      ...group('Dash', c.dashName ? [`${c.dashName}: ${c.dashDesc ?? ''}`.trim()] : []),
      ...group('Weapons', [c.signatureName && `Signature weapon: ${c.signatureName}`, c.startName && `Starting weapon: ${c.startName}`].filter(Boolean))),
    h('div', { class: 'action-row' }, h('button', { class: 'btn', type: 'button', data: { focus: 'back' }, onclick: () => onBack() }, 'Back')),
    hint(ctx, ['back', 'Back'])));
  return { el, scope: createFocusScope(el, { initial: 'r0' }), onBack };
}

/**
 * The gate's second step: how the run sets out. rows(): the rows now (app/setup.js setupRows),
 * redrawn after every change since one choice can open or close others. title(): who sets out.
 * summary(): a line under them (what the choice adds to the haul), or null. The focused row's
 * detail (what its value does) shows under the list. onChange(key, value), onStart() (returns a
 * refusal to show, or nothing), onBack().
 *
 * Two kinds of row (the sweep, X2: six rows where there were fourteen). A `choice` row steps its
 * value with left and right. A `multi` row holds several items in one line (the run tools; the
 * Tide and the curses): left and right move along its items, and confirm changes the one in focus
 * (a switch flips, Lower and Raise step the Tide). An item that can't be pressed says why.
 */
export function setupScreen(ctx, { title, rows, summary, onChange, onStart, onBack }) {
  const banded = bandList({ class: 'settings-list' });
  const list = banded.bands.list;
  const heading = h('h1', null, '');
  const detail = h('div', { class: 'setup-detail' });
  const note = h('div', { class: 'bld-note' });
  const start = button('Start run', 'start', () => { const why = onStart(); if (why) { note.textContent = why; ctx.sound?.('ui_back'); } }, { cls: 'wide' });
  const hints = h('div');
  const el = h('div', { class: 'screen settings-screen setup-screen' }, h('div', { class: 'panel' },
    heading, banded, detail, note, h('div', { class: 'menu-col' }, start), hints));
  let current = [];
  /** The item in focus on each multi row, by the row's key. */
  const at = {};
  const itemAt = (r) => r.items[Math.max(0, Math.min(r.items.length - 1, at[r.key] ?? 0))];
  const rowOf = (el2) => current.find((x) => x.key === el2?.dataset.focus);
  const showDetail = (el2) => {
    const r = rowOf(el2);
    const lines = r?.kind === 'multi' ? [...(itemAt(r)?.detail || []), itemAt(r)?.why] : (r?.detail || []);
    fill(detail, ...(r?.icon ? [ctx.icon(r.icon, 1)] : []), ...lines.filter(Boolean).map((line) => h('div', { class: 'row-desc' }, line)));
    fill(hints, r?.kind === 'multi'
      ? hint(ctx, ['sides', 'Pick'], '   ', ['confirm', 'Change'], '   ', ['back', 'Back'])
      : hint(ctx, ['sides', 'Change'], '   ', ['confirm', 'Select'], '   ', ['back', 'Back']));
  };
  const scope = createFocusScope(el, { initial: 'start', onFocus: (t) => { drawItems(); showDetail(t); } });
  const valueText = (r) => (r.choices.find((c) => c[0] === r.value) || [null, String(r.value)])[1];
  /** A multi row's items: a switch shows its state in words ("On", "Off"), never by color alone. */
  const itemEl = (r, it, k) => h('span', { class: `set-item${it.on ? ' on' : ''}${it.why ? ' off' : ''}`, data: { item: String(k) }, onclick: (e) => { e.stopPropagation(); at[r.key] = k; scope.focusKey(r.key); press(r); } },
    it.on === undefined ? it.label : `${it.label}: ${it.on ? 'On' : 'Off'}`);
  /** Mark the item in focus on the focused multi row (and none on the others). */
  function drawItems() {
    for (const rowEl of list.children) {
      const r = current.find((x) => x.key === rowEl.dataset.focus);
      if (r?.kind !== 'multi') continue;
      const focused = scope.current === rowEl;
      rowEl.querySelectorAll('.set-item').forEach((n, k) => n.classList.toggle('at', focused && k === Math.max(0, Math.min(r.items.length - 1, at[r.key] ?? 0))));
    }
  }
  function draw() {
    current = rows();
    heading.textContent = title();
    fill(list, ...current.map((r) => (r.kind === 'multi'
      ? h('div', { class: 'set-row set-multi', data: { focus: r.key } },
        h('span', { class: 'set-label' }, r.label, h('span', { class: 'set-sum' }, ` ${r.summary}`)),
        h('span', { class: 'set-items' }, ...r.items.map((it, k) => itemEl(r, it, k))))
      : h('div', { class: 'set-row', data: { focus: r.key }, onclick: () => step(r, 1) },
        h('span', { class: 'set-label' }, r.label), h('span', { class: 'set-value' }, r.choices.length > 1 ? '< ' : '', valueText(r), r.choices.length > 1 ? ' >' : '')))));
    note.textContent = summary() ?? '';
    scope.refresh();
    drawItems();
    showDetail(scope.current);
  }
  function redraw(key) {
    draw();
    scope.focusKey(key);
    drawItems();
    showDetail(scope.current);
  }
  function step(r, dir) {
    if (r.choices.length < 2) return;
    const i = r.choices.findIndex((c) => c[0] === r.value);
    const v = r.choices[((i < 0 ? 0 : i) + dir + r.choices.length) % r.choices.length][0];
    if (v === r.value) return;
    ctx.sound?.('ui_move');
    onChange(r.key, v);
    redraw(r.key);
  }
  /** Move along a multi row's items (it stops at the ends, so the stick can't wrap past them unseen). */
  function move(r, dir) {
    const k = Math.max(0, Math.min(r.items.length - 1, (at[r.key] ?? 0) + dir));
    if (k === (at[r.key] ?? 0)) return;
    at[r.key] = k;
    ctx.sound?.('ui_move');
    drawItems();
    showDetail(scope.current);
  }
  /** Change the item in focus on a multi row. */
  function press(r) {
    const it = itemAt(r);
    if (!it) return;
    if (it.why) { ctx.sound?.('ui_back'); showDetail(scope.current); return; }
    ctx.sound?.('ui_move');
    onChange(it.press[0], it.press[1]);
    redraw(r.key);
  }
  draw();
  return {
    el, scope, onBack,
    onNav(d) {
      const r = rowOf(scope.current);
      if (!r || (d !== 'left' && d !== 'right')) return false;
      if (r.kind === 'multi') move(r, d === 'left' ? -1 : 1); else step(r, d === 'left' ? -1 : 1);
      return true;
    },
    onAction(a) {
      if (a !== 'confirm') return false;
      const r = rowOf(scope.current);
      if (!r) return false;
      if (r.kind === 'multi') press(r); else step(r, 1);
      return true;
    },
    refresh: draw,
  };
}

// ---------------------------------------------------------------- after a run

/**
 * changes: applyRunResult's list; next: nextAffordable(); summary: { title, line } (how the run
 * ended); doc: the profile now (the lines leave out what it can't use yet, ui/hubtext.js
 * changeLines). onContinue: back to the harbor; onSetOut: straight to the gate.
 *
 * 0.7.3: the heading and how the run ended stay pinned while the news scrolls under them; the news
 * comes most important first; and a press is ignored for its first 800 ms, so a button still held
 * from the run's end screen can't skip it.
 */
export function resultsScreen(ctx, { data, changes, next, summary, doc = null, extra = null, onContinue, onSetOut }) {
  const lines = changeLines(data, changes, doc);
  const mats = lines.filter((l) => l.kind === 'material');
  const news = lines.filter((l) => l.kind !== 'material');
  // What you can do now leads (0.9.0, V4: the one thing to do showed only in Next up): what's
  // Ready, and where.
  const ready = doc ? readyNow(doc, data) : [];
  const el = h('div', { class: 'screen results-screen' }, h('div', { class: 'panel' },
    h('div', { class: 'results-head' }, h('h1', null, summary.title), summary.line ? h('p', { class: 'card-desc center' }, summary.line) : null),
    // (X6, S3b F12: what the run brought scrolls under the heading, never squeezed under the next
    // part; the damage table and Next up each take the focus as one block, so a pad brings them into view.)
    h('div', { class: 'results-mid give' },
      ready.length ? h('div', { class: 'ready-block' }, h('h2', null, 'Ready now'),
        ...ready.map((r) => h('div', { class: 'ready-line' }, h('span', { class: 'row-name' }, r.title), h('span', { class: 'row-ready' }, r.at)))) : null,
      h('div', { class: 'results-body' },
        h('div', { class: 'results-col' }, h('h2', null, 'Materials'),
          mats.length ? h('div', { class: 'mat-list' }, ...mats.map((m) => h('div', { class: 'mat' }, m.icon ? ctx.icon(m.icon, 1) : null, ` ${m.text}`))) : h('p', null, 'None')),
        h('div', { class: 'results-col' }, h('h2', null, 'Progress'),
          news.length ? bandList({ class: 'results-news' }, ...news.map((l, i) => h('div', { class: `news-line news-${l.kind}`, data: { focus: `n${i}` }, 'aria-disabled': 'true' }, l.text))) : h('p', null, 'None'))),
      focusBlock(extra, 'damage'),
      next.length ? focusBlock(h('div', { class: 'next-block' }, h('h2', null, 'Next up'), ...next.map((o) => nextLine(data, o))), 'next') : null),
    h('div', { class: 'action-row' }, button('Continue', 'continue', onContinue), button('Start run', 'again', onSetOut)),
    hint(ctx, ['confirm', 'Select'], ['back', 'Continue'])));
  return { el, scope: createFocusScope(el, { initial: 'continue' }), onBack: onContinue, ignoreMs: RESULTS_INPUT_DELAY_MS };
}

/** A block of text that takes the focus as a whole (read-only), so moving onto it brings it into view. */
function focusBlock(el, key) {
  if (!el) return null;
  el.dataset.focus = key;
  el.setAttribute('aria-disabled', 'true');
  el.classList.add('focus-block');
  return el;
}

/** How long the results ignore input as they come up (ms). */
export const RESULTS_INPUT_DELAY_MS = 800;

/** One of the next-3, with its bar, and what it opens on a line of its own when it does. */
export function nextLine(data, o) {
  const t = optionText(data, o);
  return h('div', { class: 'next-line' },
    h('div', { class: 'row-top' }, h('span', { class: 'row-name' }, t.title), o.kind === 'building' ? null : h('span', { class: 'row-rank' }, t.where)),
    t.opens ? h('div', { class: 'row-adds' }, t.opens) : null,
    t.runs ? h('div', { class: 'row-adds' }, t.runs) : null,
    t.waits ? h('div', { class: 'row-adds' }, t.waits) : null,
    progressBar(t.progress),
    h('div', { class: t.need ? 'why' : 'row-ready' }, t.need ?? 'Ready'));
}

// ---------------------------------------------------------------- the Harbor Orders and the codex (0.9.0)

/**
 * The Harbor Orders' board (the Tavern's; 0.9.0): each order's goal, what it opens, and who posted
 * it, by section, the ones done marked. Hidden ones show nothing until done.
 *
 * The sweep, ruling 13 (one board): set runs and Hunts are sections here. A set run not yet done is
 * a row you press to start it (onSetRun(order); `whyNotSetRun(order)` says why it can't start: its
 * character hasn't arrived, its map isn't open), and one not posted yet doesn't show. A Hunt shows
 * its count so far.
 */
export function ordersScreen(ctx, { data, get, onBack, onSetRun = null, whyNotSetRun = () => null }) {
  const { doc } = get();
  const done = featsDone(doc, data), found = new Set(doc.profile.featsFound || []);
  const posted = data.feats.filter((f) => orderPosted(doc, data, f));
  const shown = posted.filter((f) => featShown(f, done, found));
  const who = (id) => { const n = data.npcs.find((x) => x.id === id); return n ? `Posted by ${n.name}, the ${n.role}` : null; };
  const note = h('div', { class: 'bld-note' });
  const refuse = (why) => { note.textContent = why; ctx.sound?.('ui_back'); };
  const rows = [];
  for (const [group, name] of ORDER_GROUPS) {
    const g = shown.filter((f) => f.group === group).sort((a, z) => (done.has(a.id) - done.has(z.id)) || ((a.tier ?? 1) - (z.tier ?? 1)));
    if (!g.length) continue;
    const all = posted.filter((f) => f.group === group);
    rows.push(h('h2', null, `${name}: ${all.filter((f) => done.has(f.id)).length} of ${all.length}`));
    if (group === 'run') rows.push(h('p', { class: 'row-desc' }, termShort('challenge')));
    if (group === 'hunt') rows.push(h('p', { class: 'row-desc' }, `Kill a set number of one enemy, counting every run. Each opens +${Math.round(TROPHY_DAMAGE * 100)}% Damage against that enemy.`));
    for (const f of g) {
      const isDone = done.has(f.id);
      const body = [
        h('div', { class: 'row-top' }, h('span', { class: 'row-name' }, f.name), h('span', { class: 'row-rank' }, isDone ? 'Done' : 'Open')),   // (RULING-L1, L1: an order's tier meant nothing to a player)
        h('div', { class: 'row-desc' }, f.desc),
        // A Hunt's count so far (the codex's enemy page has the same number).
        ...Object.entries(f.when?.enemyTotal || {}).filter(() => !isDone).map(([id, n]) => h('div', { class: 'row-desc' }, `${killsText(Math.min(killsOf(doc, id), n))} of ${n.toLocaleString('en-US')}`)),
        h('div', { class: isDone ? 'row-done' : 'row-adds' }, rewardText(data, 'feat', f)),
        h('div', { class: 'row-desc' }, who(f.by)),
      ];
      if (f.rules && onSetRun) {
        // A set run starts here (a done one can be played again; its reward opened once).
        const why = whyNotSetRun(f);
        rows.push(pressable('div', { cls: `list-row${isDone ? ' done' : ''}`, key: `o:${f.id}`, why, onClick: () => onSetRun(f), refuse }, ...body,
          why ? h('div', { class: 'why' }, why) : h('div', { class: 'row-ready' }, isDone ? 'Start this run again' : 'Start this run')));
      } else rows.push(h('div', { class: `list-row static${isDone ? ' done' : ''}`, data: { focus: `o:${f.id}` }, 'aria-disabled': 'true' }, ...body));
    }
  }
  const hidden = posted.length - shown.length;
  const first = rows.find((r) => r.dataset?.focus);
  const el = h('div', { class: 'screen bestiary-screen orders-screen' }, h('div', { class: 'panel' },
    h('h1', null, 'Harbor Orders'),
    h('p', { class: 'card-desc center' }, `${posted.filter((f) => done.has(f.id)).length} of ${posted.length} done. ${termShort('feat')}${hidden ? ` ${hidden} more show once you find them.` : ''}`),
    wholeRows(bandList({ class: 'list' }, ...rows)),
    note,
    h('div', { class: 'action-row' }, button('Back', 'back', onBack)),
    hint(ctx, ['confirm', 'Select'], '   ', ['back', 'Back'])));
  const scope = createFocusScope(el, { initial: first?.dataset?.focus ?? 'back' });
  return {
    el, scope, onBack,
    /** Confirm on a set run that can't start says why. */
    onAction(action) {
      const why = action === 'confirm' ? scope.current?.dataset.why : null;
      if (!why) return false;
      refuse(why);
      return true;
    },
  };
}

/**
 * The codex (0.9.0): what you've found, by kind, and blanks with where each comes from. It opens at
 * the Library and from the harbor's menu, whole. The sweep, ruling 13 (two books): an enemy's and a
 * boss's page counts your kills over every run, with its Hunt's count when it has one (the bestiary
 * screen went); and with `map` it is the codex for that map, in a run's pause menu: what that map
 * has shown you (meta/codex.js mapCodex), read from the same entries.
 */
export function codexScreen(ctx, { data, get, onBack, map = null, initialGroup = null }) {
  const { doc } = get();
  const all = codexEntries(doc, data, map), count = codexCount(doc, data, map);
  const M = map ? data.maps.find((m) => m.id === map) : null;
  const rows = [];
  let firstOf = null;
  for (const g of count.groups) {
    rows.push(h('h2', null, `${g.name}: ${g.seen} of ${g.of}`));
    for (const e of all.filter((x) => x.group === g.group)) {
      const key = `x:${e.group}:${e.id}`;
      if (g.group === initialGroup && !firstOf) firstOf = key;
      // A weapon seen opens its page (C3, ruling 18 P1): its options, Legendaries, lines, ticks, orders.
      const page = e.group === 'weapon' && e.seen ? weaponPage(doc, data, e.id) : null;
      const open = page ? () => { const s2 = weaponPageScreen(ctx, { page, onBack: () => ctx.ui.close(s2) }); ctx.ui.push(s2); } : null;
      rows.push(h('div', { class: `list-row${open ? '' : ' static'}${e.seen ? '' : ' off'}`, data: { focus: key }, 'aria-disabled': open ? null : 'true', onclick: open },
        h('div', { class: 'row-top' }, e.seen && e.icon && !['map', 'secret', 'place'].includes(e.group) ? ctx.icon(e.icon, 1) : null, h('span', { class: 'row-name' }, e.seen ? ` ${e.name}` : '???'),
          e.seen && e.kills !== undefined ? h('span', { class: 'row-rank' }, killsText(e.kills)) : null),
        e.seen ? h('div', { class: 'row-desc' }, e.desc) : h('div', { class: 'why' }, e.hint),
        e.seen && e.hunt ? h('div', { class: e.hunt.done ? 'row-done' : 'row-adds' }, e.hunt.done ? `${e.hunt.name}: done` : `${e.hunt.name}: ${Math.min(e.kills, e.hunt.count).toLocaleString('en-US')} of ${e.hunt.count.toLocaleString('en-US')}`) : null,
        e.seen && e.lore ? h('div', { class: 'row-adds' }, e.lore) : null,
        page ? h('div', { class: 'row-adds' }, `Taken in a run: ${page.taken} of ${page.of} Forms and traits. Harbor Orders done: ${page.orders.filter((o) => o.done).length} of ${page.orders.length}.`) : null));
    }
  }
  const pct = count.of ? Math.floor((count.seen / count.of) * 100) : 0;
  const el = h('div', { class: 'screen bestiary-screen codex-screen' }, h('div', { class: 'panel' },
    h('h1', null, M ? `Codex: ${M.name}` : 'Codex'),
    h('p', { class: 'card-desc center' }, M
      ? `${count.seen} of ${count.of} seen on this map. The whole codex is at the Library and in the harbor's menu.`
      : `${count.seen} of ${count.of} seen (${pct}%). A thing shows here once a run has carried it, killed it, or opened it.`),
    rows.length ? wholeRows(bandList({ class: 'list' }, ...rows)) : h('p', { class: 'card-desc center' }, 'Nothing seen here yet.'),
    h('div', { class: 'action-row' }, button('Back', 'back', onBack)),
    hint(ctx, ['back', 'Back'])));
  const first = rows.find((r) => r.dataset?.focus);
  return { el, scope: createFocusScope(el, { initial: firstOf ?? first?.dataset?.focus ?? 'back' }), onBack };
}

// ---------------------------------------------------------------- the harbor's menu

export function hubMenuScreen(ctx, { onResume, onSetOut, onCodex = null, onGlossary = null, onSettings, onSaveCode = null, onTitle, onQuit = null }) {
  const el = h('div', { class: 'screen hub-menu' }, h('div', { class: 'panel' },
    h('h1', null, 'Harbor'),
    h('div', { class: 'menu-col' },
      button('Resume', 'resume', onResume),
      button('Start run', 'setout', onSetOut),
      onCodex ? button('Codex', 'codex', onCodex) : null,
      onGlossary ? button('Glossary', 'glossary', onGlossary) : null,
      button('Settings', 'settings', onSettings),
      onSaveCode ? button('Save code', 'savecode', onSaveCode) : null,
      button('Main menu', 'title', onTitle),
      onQuit ? button('Quit game', 'quit', onQuit) : null),
    hint(ctx, ['confirm', 'Select'], ['back', 'Resume'])));
  return {
    el, scope: createFocusScope(el, { initial: 'resume' }), onBack: onResume, isPause: true,
    // The button that opened it closes it, as the run's pause menu does.
    onAction(action) { if (action !== 'pause') return false; onResume(); return true; },
  };
}

