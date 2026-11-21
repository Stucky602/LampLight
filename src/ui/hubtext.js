// What the harbor's panels and the results screen say (ARCHITECTURE §10.4, §10.2 step 5), built
// from the data and the meta layer's change lists, worded as docs/WRITING.md says: labels and
// short lines, not sentences about the player. Pure (no DOM); tested.

import { contentFrom, researchDone, researchActive, researchTier, rankOf, treeTier, secretsOf, levelOf, levelEffect, mapOwnMaterials, tidesOpened, slotsFor } from '../meta/state.js';
import { whyNotResearch, whyNotUpgrade, fogOver, levelNeeds, levelFor, mapKeysText, researchNeeds } from '../meta/actions.js';
import { clockText, midSentence } from '../lib/text.js';
import { GEAR_SLOTS, SLOT_NAMES, THIRD_AFFIX_TIER } from '../data/gear.js';
import { purchaseOptions } from '../meta/next.js';
import { featsDone } from '../meta/state.js';
import { gearItems, gearEquipped, gearSlotsOpen } from '../meta/workshop.js';
import { rarityOfTier } from '../data/rarity.js';
import { featShown } from '../meta/feats.js';
import { termLine, termShort, term, fieldGuideEntry } from '../data/glossary.js';

const nameOf = (list, id) => list.find((x) => x.id === id)?.name ?? id;
const matName = (data, id) => nameOf(data.materials, id);
/** A building's name as the data has it ("Library"). */
export function buildingName(data, id) {
  return nameOf(data.buildings, id);
}

/** A building's name inside a line (a leading "The" lowercased, should a name ever have one). */
export function buildingIn(data, id) {
  return midSentence(buildingName(data, id));
}

/** A material count where room is tight (the harbor's materials bar): 9,999 in full, then 12.3k, 4.5M. */
export function countText(n) {
  const v = Math.max(0, Math.floor(Number(n) || 0));
  if (v < 10000) return v.toLocaleString('en-US');
  if (v < 1e6) return `${Math.floor(v / 100) / 10}k`;
  return `${Math.floor(v / 1e5) / 10}M`;
}

/** "15 Oil, 15 Coin, 10 Timber". */
export function costText(data, cost) {
  const parts = Object.entries(cost).map(([id, n]) => `${Number(n).toLocaleString('en-US')} ${matName(data, id)}`);
  return parts.length ? parts.join(', ') : 'Free';
}

/**
 * What a level or project adds to runs, one line per kind, the kind named: "New weapon: Tide Bell",
 * "New relic: Tide Clock, Seventh Bell" (Tide Clock, Tide Bell, and Tide Charts all exist, so the
 * kind says which is which).
 */
export function joinsTexts(items) {
  const kinds = [];
  for (const x of items) { const k = kinds.find((g) => g.what === x.what); if (k) k.names.push(x.name); else kinds.push({ what: x.what, names: [x.name] }); }
  return kinds.map((k) => {
    if (!k.what) return `Unlocked: ${k.names.join(', ')}`;
    const [one, many] = KIND_WORD[k.what] ?? [k.what, `${k.what}s`];
    // A challenge run is an order on the board, and says so.
    if (k.what === 'challenge') return `New challenge run on the Harbor Orders board: ${listText(k.names)}`;
    // 0.9.0: a harbor prop is something new to see in town, not something for runs.
    if (k.what === 'prop') return `New in the harbor: ${listText(k.names)}`;
    return `New ${k.names.length > 1 ? many : one}: ${k.names.join(', ')}`;
  });
}

/**
 * An order's reward as labels (`kind`: 'feat'): what it opens, by kind ("New relic: Glassblower").
 */
export function rewardText(data, kind, item) {
  const parts = joinsTexts(contentFrom(data, `${kind}:${item.id}`));
  const mats = Object.entries(item.reward?.materials || {});
  if (mats.length) parts.push(mats.map(([id, n]) => `${Number(n).toLocaleString('en-US')} ${matName(data, id)}`).join(', '));
  return parts.join('. ');
}

/** What a Tide does, as stat labels: "+60% Enemy HP, +32% Enemy Damage, +20% Enemies, +6% Enemy Speed, +48% Materials". */
export function tideText(t) {
  const pct = (m) => Math.round((m - 1) * 100);
  return `+${pct(t.hpMul)}% Enemy HP, +${pct(t.damageMul)}% Enemy Damage, +${pct(t.densityMul)}% Enemies, +${Math.round((t.speedMul - 1) * 1000) / 10}% Enemy Speed, +${Math.round(t.rewardMul * 100)}% Materials`;
}

/** The rules a Tide plays with (0.7.3): its own and every one below it, as data/tide.js says them. */
export function tideRules(data, level) {
  return (data.tides || []).filter((t) => t.level <= level && t.rule?.desc).map((t) => t.rule.desc);
}

/** How each kind of content is named after "New", one and several ("New relic", "New relics"). */
const KIND_WORD = Object.freeze({
  temper: ['weapon tempered', 'weapons tempered'], early: ['early Legendary', 'early Legendaries'],   // C3 (ruling 18 P1)
  weapon: ['weapon', 'weapons'], passive: ['passive', 'passives'], relic: ['relic', 'relics'],
  character: ['character', 'characters'], recipe: ['gear', 'gear'], consumable: ['run tool', 'run tools'],
  // 0.9.0: what Harbor Orders, mastery ranks, and the Lighthouse open too.
  event: ['map event', 'map events'], kit: ['starting weapon', 'starting weapons'], challenge: ['challenge run', 'challenge runs'], trophy: ['trophy', 'trophies'], skill: ['skill', 'skills'], form: ['Final Form', 'Final Forms'],
});

/** A gear tier as its rarity's name (ruling 10: Smithy tiers 1 to 5 are Common to Legendary). */
export function tierName(tier) {
  return rarityOfTier(tier).name;
}

/** "5", "5 minutes", "4:30": a whole number of minutes said as minutes, anything else as a clock. */

/**
 * What a building's level brings: [{ kind, text }], in this order. The kinds:
 *   'tree'      the Lamp Post's upgrades it opens, by name
 *   'research'  the Library's research slots, and the research tier it opens
 *   'arrival'   a character who comes by boat
 *   'rule'      a Phase 7 building's system or number (the Ferryman, gear, Tides, trading)
 *   'joins'     what it adds to runs, by name (after the rule that says what those are)
 *   'fog'       the fog clearing from its streets, or off another building's plot
 *   'keeper'    its keeper coming back (level 4), then walking the streets (level 5)
 *   'more'      only when it brings none of those
 * Each line says what the player gets, in words a new player follows (docs/WRITING.md §2): the
 * first time a system appears its line says what it is for; a person comes with their job.
 * The panels pick by kind (the Tavern lists who and what comes back), never by the wording.
 */
export function levelEffects(data, buildingId, level) {
  const b = data.buildings.find((x) => x.id === buildingId);
  if (!b || level < 1 || level > b.levels.length) return [];
  const lv = b.levels[level - 1];
  // What the levels before this one had opened (a number a building raises level by level).
  const before = (key) => b.levels.slice(0, level - 1).reduce((m, l) => Math.max(m, l[key] ?? 0), 0);
  const out = [];
  const add = (kind, text) => out.push({ kind, text });
  const names = (list) => list.map((x) => x.name).join(', ');
  // A run's slots this level adds (data/tuning.js SLOTS; the sweep, A2: the biggest thing a level did went unsaid).
  for (const [k, word] of SLOT_WORDS) {
    const r = data.slots?.[k];
    if (!r || r.building !== buildingId || !r.at.includes(level)) continue;
    add('rule', `+1 ${word} slot in every run (${r.base + r.at.filter((at) => at <= level).length} of ${r.base + r.at.length})`);
  }
  if (lv.tree) add('tree', `New Harbor upgrades here: ${names(data.upgrades.filter((u) => u.tier === lv.tree))}`);
  // (The Library's first level opens tier 1 along with its first slot, so it says only that.)
  if (lv.researchSlots === 1) add('research', termLine('research'));
  else if (lv.researchSlots) add('research', `Run ${lv.researchSlots} research projects at once`);
  if (lv.researchTier > 1) {
    const n = data.research.filter((r) => r.tier === lv.researchTier).length;
    add('research', `${n} more research ${n === 1 ? 'project' : 'projects'}`);
  }
  const brings = contentFrom(data, `building:${buildingId}:${level}`);
  for (const c of brings.filter((x) => x.what === 'character')) add('arrival', `New character: ${c.name}`);
  // Phase 7's buildings (data/buildings.js).
  const F = data.tuning.ferry;
  if (lv.lampSpeed) add('rule', `Wayside Lamps light ${Math.round(lv.lampSpeed * 100)}% faster in runs`);
  if (lv.lampSpeedAdd) add('rule', `Wayside Lamps light ${Math.round(lv.lampSpeedAdd * 100)}% faster in runs, on top of the Lamp Post's`);
  if (lv.bellRingAdd) add('rule', `Fog Bells' circles in runs are ${Math.round(lv.bellRingAdd * 100)}% wider, on top of the Chapel's`);
  if (lv.heirloom) add('rule', termLine('heirloom'));
  if (lv.feats) add('rule', termLine('feat'));
  // The Lighthouse (0.9.0): each stage named, and what it adds beyond its content.
  if (lv.stage) add('rule', `Stage ${lv.stage} of ${b.levels.length}: ${b.stages?.[lv.stage - 1] ?? ''}`);
  if (lv.consumableSlotsAdd) add('rule', `Take ${lv.consumableSlotsAdd} more run tool into each run`);
  if (lv.researchSlotsAdd) add('rule', `Run ${lv.researchSlotsAdd} more research project at once`);
  if (lv.marketRaresAdd) add('rule', `The Market sells ${lv.marketRaresAdd} more ${listText(data.market.rare.map((id) => matName(data, id)), 'or')} between runs (${(data.meta.marketRaresPerRun ?? 0) + lv.marketRaresAdd} in all)`);
  if (lv.stage === b.levels.length) add('rule', 'The lamp is lit: its light reaches over the point');
  for (const p of data.hub.props.filter((x) => x.from === `${buildingId}:${level}` && x.name)) add('rule', `On the point: ${p.name}`);
  if (lv.mastery) add('rule', termLine('mastery'));
  // 0.8.2: he rows in on a schedule and ties up near you; his trade opens from a ring by his boat.
  if (lv.ferry === 1) add('rule', `The Ferryman comes into your runs from ${clockText(F.firstCall)}. ${termShort('ferryman').replace(/\.$/, '')}`);
  else if (lv.ferry === 2) add('rule', 'The Ferryman stocks 2 relics instead of 1');
  else if (lv.ferry === 3) add('rule', `The Ferryman's prices drop ${Math.round(F.discount * 100)}%`);
  else if (lv.ferry === 4) add('rule', 'The Ferryman stocks 3 relics instead of 2');
  else if (lv.ferry === 5) add('rule', 'After his first restock, the Ferryman\'s relics are one rarity higher');
  // (The Smithy's description says what gear is, so its first level lists only the slots.)
  if (lv.gearTier > 1) {
    const third = before('gearTier') < THIRD_AFFIX_TIER && lv.gearTier >= THIRD_AFFIX_TIER;
    add('rule', `Gear can be improved up to ${tierName(lv.gearTier)}. ${third ? `Its stat bonuses grow, and ${tierName(THIRD_AFFIX_TIER)} adds a third bonus` : 'Its stat bonuses grow'}`);
  }
  if (lv.gearSlots) {
    const open = GEAR_SLOTS.slice(before('gearSlots'), lv.gearSlots).map((x) => SLOT_NAMES[x]);
    add('rule', open.length > 1 ? `Gear slots: ${listText(open)}` : `New gear slot: ${open[0]}`);
  }
  if (lv.reroll) add('rule', 'Reroll a gear bonus you don\'t want: pick 1 of 3 replacements');
  if (lv.tempering) add('rule', termLine('tempering'));
  if (lv.tideMax) {
    const tides = Array.from({ length: lv.tideMax - before('tideMax') }, (_, k) => before('tideMax') + k + 1);
    add('rule', before('tideMax') ? `Tides up to ${lv.tideMax}` : `Tides ${listText(tides.map(String))}: ${tideLine()}. ${TIDE_HOW}`);
  }
  if (lv.curses) {
    const now = data.curses.slice(before('curses'), lv.curses);
    if (now.length) add('rule', before('curses') ? `New ${now.length > 1 ? 'curses' : 'curse'}: ${names(now)}` : `Curses: ${listText(now.map((c) => c.name))}`);
  }
  if (lv.bellRing) add('rule', `Fog Bells' circles in runs are ${Math.round(lv.bellRing * 100)}% wider`);
  if (lv.market) {
    const r = data.market.rates[lv.market], rare = listText(data.market.rare.map((id) => matName(data, id)), 'or');
    add('rule', lv.market === 1 ? `Trade materials: ${r.common} of one for 1 of another, or ${r.toRare} for 1 ${rare}` : `Better trades: ${r.common} for 1, or ${r.toRare} for 1 ${rare}`);
  }
  if (lv.glassToCoin) add('rule', lv.glassToCoin < 1 ? `Pearls left at the end of a run become Coin: 1 for every ${Math.round(1 / lv.glassToCoin)}` : `Pearls left at the end of a run become Coin: ${lv.glassToCoin} each`);
  if (lv.consumableSlots === 1) add('rule', termLine('consumable', 'Run tools'));
  if (lv.consumableSlots === 1) add('rule', 'Take 1 run tool into each run');
  else if (lv.consumableSlots) add('rule', `Take ${lv.consumableSlots} run tools into each run`);
  if (lv.foodHeal) add('rule', `Food heals ${Math.round(lv.foodHeal * 100)}% more in runs${before('foodHeal') ? ` (it was ${Math.round(before('foodHeal') * 100)}%)` : ''}`);
  // 0.8.2: lamps and bells are on every minimap from the start; this level marks Reliquaries.
  if (lv.tasksOnMap) add('rule', 'Reliquaries show on the minimap wherever they drop');
  if (lv.findsOnMap) add('rule', 'A map\'s small secrets show on the minimap');
  if (lv.challenges) add('rule', termLine('challenge', 'Challenge runs'));
  if (lv.shortRuns) add('rule', termLine('short_run', 'Short runs'));
  if (lv.secretsOnMap) add('rule', 'The map\'s big secrets show on the minimap, with hints here');
  // A level a map's way waits on (0.8.0: the Docks' boat and the Tavern's feat list for the Salt Marsh).
  for (const m of data.maps) {
    const keys = m.unlock === undefined ? [] : [].concat(m.unlock);
    if (!keys.includes(`building:${buildingId}:${level}`)) continue;
    const others = keys.filter((k) => k !== `building:${buildingId}:${level}`);
    add('rule', `Opens the way to ${mapIn(data, m.id)}${others.length ? `, with ${mapKeysText(data, others)}` : ''}`);
  }
  // What it adds to runs (relics, consumables), once the line above has said what those are.
  for (const line of joinsTexts(brings.filter((x) => x.what !== 'character'))) add('joins', line);
  if (data.hub.fog.some((f) => f.revealedBy === `${buildingId}:${level}`)) add('fog', 'Pushes the fog back from nearby streets');
  for (const p of data.hub.plots) if (p.openAt === `${buildingId}:${level}`) add('fog', `Clears the fog so the ${buildingIn(data, p.building)} can be restored`);
  const keeper = data.npcs.find((n) => n.home === buildingId);
  if (keeper && level === 4) add('keeper', `${keeper.name}, the ${keeper.role}, moves back in`);
  if (keeper && level === 5) add('keeper', `${keeper.name} starts walking around the harbor`);
  if (!out.length) add('more', 'Nothing new at this level');
  return out;
}

/** How a run's slots are named on a level's line (data/tuning.js SLOTS). */
const SLOT_WORDS = Object.freeze([['weapons', 'Weapon'], ['passives', 'Passive'], ['relics', 'Relic']]);

/** "Slots: 4 weapons, 4 passives, 3 relics" (the gate's map card; meta/state.js slotsFor). */
export function slotsText(doc, data) {
  if (!data.slots) return null;
  const n = slotsFor(doc, data);
  const part = (k, one, many) => `${n[k]} ${n[k] === 1 ? one : many}`;
  return `Slots: ${part('weapons', 'weapon', 'weapons')}, ${part('passives', 'passive', 'passives')}, ${part('relics', 'relic', 'relics')}`;
}

/** "A, B, and C" (Oxford comma), "A and B", or "A". `and` can be "or". */
export function listText(items, and = 'and') {
  if (items.length < 3) return items.join(` ${and} `);
  return `${items.slice(0, -1).join(', ')}, ${and} ${items.at(-1)}`;
}

/**
 * Where research stands: { state: 'done' | 'active' | 'open' | 'locked', runsLeft?, why? }. A
 * locked project's `why` is the meta layer's own sentence (meta/actions.js whyNotResearch), so
 * what a row shows is what pressing it says.
 */
export function researchState(doc, data, r) {
  if (researchDone(doc).has(r.id)) return { state: 'done' };
  const a = researchActive(doc).find((x) => x.id === r.id);
  if (a) return { state: 'active', runsLeft: a.runsLeft };
  const done = researchDone(doc);
  if (researchTier(doc, data) < r.tier || r.requires.some((q) => !done.has(q)) || researchNeeds(doc, data, r)) return { state: 'locked', why: whyNotResearch(doc, data, r.id) };
  return { state: 'open' };
}

/** An upgrade's place: { rank, ranks, open, why? } (`why`, when it isn't open, as pressing says it). */
export function upgradeState(doc, data, u) {
  const rank = Math.min(rankOf(doc, u.id), u.ranks);
  if (treeTier(doc, data) >= u.tier) return { rank, ranks: u.ranks, open: true, why: null };
  return { rank, ranks: u.ranks, open: false, why: whyNotUpgrade(doc, data, u.id) };
}

/** An upgrade at a rank, as the panel shows ranks: "Brighter Flame 2/5". */
export function rankText(data, id, rank) {
  const u = data.upgrades.find((x) => x.id === id);
  return u ? `${u.name}, rank ${rank} of ${u.ranks}` : `${id}, rank ${rank}`;
}

/** "3 runs" / "1 run". */
export function runsText(n) { return `${n} ${n === 1 ? 'run' : 'runs'}`; }

/** A map's name inside a line: "the Salt Marsh". */
export function mapIn(data, id) {
  return `the ${nameOf(data.maps, id)}`;
}

/**
 * How many runs a project still needs, the way the Library and Next up say it (0.8.0): "2 runs
 * left", or, for one that counts only runs on one map (`runsOn`), "2 more runs on the Salt Marsh".
 */
export function researchRunsText(data, r, n) {
  if (r?.runsOn) return `${n} more ${n === 1 ? 'run' : 'runs'} on ${mapIn(data, r.runsOn)}`;
  return `${runsText(n)} left`;
}

/**
 * A map's card at the gate (0.8.0; a card counts only its own materials): its name and
 * description, then what drops there alone, which of Next up's three a run there gets you closer
 * to (one short of a material only that map drops, or a project that counts only runs there), the
 * research that counts there, and the Tides open there (once the Chapel picks them), held to what
 * the Chapel allows, as the gate's Tide row is. `next`: nextAffordable's three.
 * { id, name, desc, lines: [text] }.
 */
export function mapCard(doc, data, mapId, next = []) {
  const m = data.maps.find((x) => x.id === mapId);
  const own = mapOwnMaterials(data, mapId);
  const lines = [];
  if (own.length) lines.push(`Drops here only: ${listText(own.map((id) => matName(data, id)))}`);
  const moves = next.filter((o) => (o.missing || []).some((x) => own.includes(x.id)) || (o.kind === 'research' && data.research.find((r) => r.id === o.id)?.runsOn === mapId));
  if (moves.length) lines.push(`Gets you closer to: ${listText(moves.map((o) => optionText(data, o).title))}`);
  const counting = researchActive(doc).map((a) => data.research.find((r) => r.id === a.id)).filter((r) => r && (r.runsOn === undefined || r.runsOn === mapId));
  if (counting.length) lines.push(`Research that counts here: ${listText(counting.map((r) => r.name))}`);
  const cap = levelEffect(doc, data, 'chapel', 'tideMax');
  if (cap > 0) {
    const n = Math.min(tidesOpened(doc, mapId), (data.tides || []).length);
    const range = (k) => (k === 1 ? 'Tide 1' : `Tide 1 to ${k}`);   // (round 3: one shape)
    if (n === 0) lines.push(`No Tides open here yet. Kill its last boss to open Tide 1, ${tideLine()}`);
    else if (n <= cap) lines.push(`Tides open here: ${range(n)}`);
    else {
      // More opened here than the Chapel allows: the gate offers up to the cap, and says how to raise it.
      const lv = levelFor(data, 'chapel', 'tideMax', n);
      lines.push(`Tides open here: ${range(n)}. The ${buildingName(data, 'chapel')} allows up to Tide ${cap}${lv ? `. Restore it to Lv ${lv} for more` : ''}`);
    }
  }
  // What the map holds (0.8.2, idea 10: the ledger before the run): its lamps, bells, the Ferryman
  // (once the Docks bring him), and its secrets (by name once found, else unnamed).
  // 0.9.0: the Harbor Orders this map can do, and the gear you'll wear (the lead: gear visible on the way out).
  const orders = ordersFor(doc, data, mapId);
  if (orders.length) lines.push(`Orders here: ${listText(orders.map((f) => f.name))}`);
  const slots = slotsText(doc, data);
  if (slots) lines.push(slots);
  const worn = loadoutText(doc, data);
  if (worn) lines.push(worn);
  const holds = mapHoldsText(doc, data, m);
  if (holds) lines.push(holds);
  return { id: mapId, name: m?.name ?? mapId, desc: m?.desc ?? '', lines };
}

/**
 * "On this map: 5 Wayside Lamps, 3 Fog Bells, the Ferryman, and a secret" (0.8.2): what a map
 * holds, read from its data; a secret found once is named ("and the Wreck Cache"). null for a map
 * with none of them.
 */
export function mapHoldsText(doc, data, m) {
  if (!m) return null;
  const tasks = m.tasks || [];
  // 0.9.0 (W4): a map in acts brings its lamps and bells each act, and has a task of its own.
  const act = Array.isArray(m.acts) ? m.acts[0] : null, each = act ? ' each act' : '';
  const lamps = act ? act.lamps : tasks.filter((t) => t.kind === 'lamp').length, bells = act ? act.bells : tasks.filter((t) => t.kind === 'bell').length;
  const parts = [];
  if (lamps) parts.push(`${lamps} ${lamps === 1 ? 'Wayside Lamp' : 'Wayside Lamps'}${each}`);
  if (bells) parts.push(`${bells} ${bells === 1 ? 'Fog Bell' : 'Fog Bells'}${each}`);
  const cranes = (m.cranes || []).length, cairns = (m.cairns || []).length;
  if (cranes) parts.push(`${cranes} ${cranes === 1 ? 'crane' : 'cranes'}`);
  if (cairns) parts.push(`${cairns} ${cairns === 1 ? 'salt cairn' : 'salt cairns'}`);
  if ((m.ferry?.moorings?.length || m.ferry?.at) && levelOf(doc, 'docks', data) > 0) parts.push('the Ferryman');
  const codex = doc?.profile?.codex || [];
  // Found ones by name; the rest as a count (0.9.0: W4's small secrets made the list long).
  // One a single character can find (data/maps.js `only`: the Drowned Causeway is the Bog Warden's)
  // is counted apart, and says whose it is (the sweep, A4: the card sent everyone after it).
  const found = (m.secrets || []).filter((sc) => codex.includes(`secret:${sc.id}`));
  const left = (m.secrets || []).filter((sc) => !found.includes(sc));
  const hidden = left.filter((sc) => !sc.only).length;
  for (const sc of found) parts.push(`the ${sc.name}`);
  if (hidden) parts.push(hidden === 1 ? (found.length ? 'another secret' : 'a secret') : `${hidden} ${found.length ? 'more secrets' : 'secrets'}`);
  for (const sc of left.filter((x) => x.only)) parts.push(`a secret only the ${nameOf(data.characters, sc.only)} can find`);
  return parts.length ? `On this map: ${listText(parts)}` : null;
}

/** "+150 Coin, +2 Map Scraps" for a table of materials (in the data's order). */
export function plusText(data, mats) {
  return data.materials.filter((m) => mats?.[m.id] > 0).map((m) => `+${mats[m.id].toLocaleString('en-US')} ${m.name}`).join(', ');
}

/**
 * Everything a change list brought home, as material counts: what the run picked up, what its
 * minutes paid, the Sea Glass the Market bought, and the materials orders
 * claims paid. { id: count }.
 */
export function homeTotals(changes) {
  const out = {};
  const add = (id, n) => { if (Number.isFinite(n) && n > 0) out[id] = (out[id] ?? 0) + n; };
  for (const c of changes) {
    if (c.kind === 'material') add(c.id, c.count);
    else if (c.kind === 'glass_coin') add('coin', c.count);
    else if (['time_pay', 'feat'].includes(c.kind)) for (const [id, n] of Object.entries(c.materials || {})) add(id, n);
  }
  return out;
}

/** The order the results tell their news in (0.7.3: most important first). */
const NEWS_ORDER = ['map', 'arrival', 'secret', 'research_done', 'feat', 'tide', 'well', 'mastery', 'feat_found', 'building', 'upgrade', 'research_started', 'codex', 'research', 'record', 'ledger', 'pay', 'glass', 'note'];

/**
 * The results screen's lines, from applyRunResult's changes (and a restore's): [{ kind, text,
 * icon? }]. First the materials that came home, one line each with its icon, totalled over
 * everything that paid some (homeTotals); then the news, most important first (NEWS_ORDER), each
 * with the lines it brings under it (what a project, a secret, a feat opened).
 *
 * `doc` (the profile after the run, when the results know it) keeps out what the player can't use
 * yet (0.7.3): mastery before the Tavern trains it, the Market's Sea Glass line before the Docks
 * (its Coin still counts), and a Tide opened says where it's picked: at the gate, or the Chapel to
 * restore first, or the fog over the Chapel ("The Chapel opens with Lamp Post Lv 3").
 */
export function changeLines(data, changes, doc = null) {
  const news = [];
  const say = (kind, text, under = []) => news.push({ kind, text, under });
  // A secret's unlocks are said once, under the secret (not again as discovered).
  const fromSecret = new Set();
  for (const c of changes) if (c.kind === 'codex' && c.unlocks) for (const u of c.unlocks) fromSecret.add(`${u.what}:${u.id}`);
  const level = (id) => (doc ? levelOf(doc, id, data) : Infinity);
  // What a thing opened, by kind. Gear and run tools found before their building is restored say
  // where they'll be (the sweep, D2: a tonic was announced two runs before there was a shop).
  const WAITS = { recipe: 'smithy', consumable: 'apothecary' };
  const unlockLines = (key, unlocks) => {
    const items = (unlocks || []).map((u) => contentFrom(data, key).find((x) => x.id === u.id) || { name: u.id });
    const out = [];
    for (const what of [...new Set(items.map((x) => x.what))]) {
      const b = WAITS[what];
      const wait = b && level(b) === 0 ? ` (at the ${buildingName(data, b)}, once it's restored)` : '';
      for (const t of joinsTexts(items.filter((x) => x.what === what))) out.push({ kind: 'unlock', text: `${t}${wait}` });
    }
    return out;
  };
  const discovered = [];
  // Several runs' pay (Run again) is said as one line.
  const pays = changes.filter((c) => c.kind === 'time_pay');
  if (pays.length > 1) {
    const sum = { kind: 'time_pay', minutes: 0, materials: {} };
    for (const c of pays) { sum.minutes += c.minutes || 0; for (const [id, n] of Object.entries(c.materials || {})) sum.materials[id] = (sum.materials[id] ?? 0) + n; }
    changes = [...changes.filter((c) => c.kind !== 'time_pay'), sum];
  }
  for (const c of changes) {
    switch (c.kind) {
      case 'research_step':
        say('research', `Research on ${nameOf(data.research, c.id)}: ${runsText(c.runsLeft)} left`);
        break;
      case 'research_done':
        say('research_done', `Research complete: ${nameOf(data.research, c.id)}`, unlockLines(`research:${c.id}`, c.unlocks));
        break;
      case 'research_waiting':
        say('note', c.reason);
        break;
      // 0.8.0: a project that counts only runs on another map (`runsOn`) waited.
      case 'research_elsewhere':
        say('research', `Research on ${nameOf(data.research, c.id)}: ${c.runsLeft} more ${c.runsLeft === 1 ? 'run' : 'runs'} on ${mapIn(data, c.map)}`);
        break;
      case 'well':
        say('well', `Given to the Salt Well: ${nameOf(data.relics, c.id)}. The Ferryman sells it on every map from now on`);
        break;
      case 'sighted': {
        const names = c.names.map((k) => (k.startsWith('enemy:') ? nameOf(data.enemies, k.slice(6)) : fieldGuideEntry(data.meta, k)?.name)).filter(Boolean);
        // 0.9.0 (V4: a 14-name line led the first results): a long list is its count.
        if (names.length > COLLAPSE_AT) say('codex', `${names.length} new in the codex for this map (the pause menu in a run)`);
        else if (names.length) say('codex', `New in the codex: ${listText(names)}`);
        break;
      }
      case 'map_open':
        say('map', `New map: ${nameOf(data.maps, c.id)}. Choose it at the gate`);
        break;
      case 'arrival':
        say('arrival', `New character: ${nameOf(data.characters, c.id)}. Coming home by boat`);
        break;
      case 'codex': {
        const [kind, id] = c.key.split(':');
        if (kind === 'secret') { say('secret', `Secret found: ${nameOf(secretsOf(data), id)}`, unlockLines(c.key, c.unlocks)); break; }
        if (fromSecret.has(c.key)) break;
        // The run's starting weapon isn't news (meta/apply.js marks it); one found on a level-up is.
        if (c.start) break;
        const list = { weapon: data.weapons, passive: data.passives, relic: data.relics }[kind] || [];
        discovered.push(nameOf(list, id));
        break;
      }
      case 'best_time':
        say('record', `New best time: ${clockText(c.seconds)} (was ${clockText(c.previous)})`);
        break;
      case 'building_level':
        say('building', `${buildingName(data, c.id)} Lv ${c.level}`);
        for (const id of c.maps || []) say('map', `New map: ${nameOf(data.maps, id)}. Choose it at the gate`);
        break;
      case 'upgrade_rank':
        say('upgrade', rankText(data, c.id, c.rank));
        break;
      case 'research_started':
        say('research_started', `Research started: ${nameOf(data.research, c.id)} (${runsText(c.runs)})`);
        break;
      case 'time_pay': {
        const paid = plusText(data, c.materials);
        if (paid) say('pay', `Time bonus (${c.minutes} min): ${paid}`);
        break;
      }
      // Phase 7.
      case 'glass_coin':
        if (level('docks') > 0) say('glass', `${Number(c.count).toLocaleString('en-US')} Coin for ${c.glass} leftover ${c.glass === 1 ? 'Pearl' : 'Pearls'}`);
        break;
      case 'ledger': {
        // One run-end number per character (Ruling 21 PB): the count their own job is measured in, with
        // the best so far, or "a new best". A character with no count of its own: its first one.
        const key = [LEDGER_KEY[c.character], ...Object.keys(c.counts || {})].find((k) => k && TRADE_WORDS[k] && c.counts?.[k] > 0);
        if (!key) break;
        const n = c.counts[key], best = (c.best || []).includes(key), top = c.bests?.[key];
        say('ledger', `${nameOf(data.characters, c.character)}: ${n.toLocaleString('en-US')} ${tradeWords(key, n)}${best ? ' (a new best)' : top > n ? ` (best ${top.toLocaleString('en-US')})` : ''}`);
        break;
      }
      case 'mastery':
        if (!doc || levelEffect(doc, data, 'tavern', 'mastery')) say('mastery', `${nameOf(data.characters, c.character)} reached mastery rank ${c.rank}`);
        break;
      case 'tide':
        // The first Tide says what a Tide is (0.9.0, V4: "never says what a Tide is").
        say('tide', `Tide ${c.level} is open${c.map && data.maps.length > 1 ? ` on ${mapIn(data, c.map)}` : ''}${c.level === 1 ? `: ${tideLine()}` : ''}. ${tideWhere(data, doc)}`);
        break;
      case 'feat': {
        const paid = plusText(data, c.materials);
        say('feat', `Order done: ${nameOf(data.feats, c.id)}${paid ? `, ${paid}` : ''}`, unlockLines(`feat:${c.id}`, c.unlocks));
        break;
      }
      case 'feat_found':
        say('feat_found', `New order on the board at the Tavern: ${nameOf(data.feats, c.id)}`);
        break;
      // D3: orders done before the Tavern kept the board, counted once it does.
      case 'orders_kept':
        say('feat', ordersKeptText(data, c.ids.length), (c.ids || []).flatMap((id) => unlockLines(`feat:${id}`, contentFrom(data, `feat:${id}`))));
        break;
      default: break;
    }
  }
  // What the run's build saw for the first time, folded into one line; a long list as its count.
  if (discovered.length > COLLAPSE_AT) say('codex', `Discovered ${discovered.length} new weapons, passives, and relics`);
  else if (discovered.length) say('codex', `Discovered: ${listText(discovered)}`);
  const totals = homeTotals(changes);
  const out = data.materials.filter((m) => totals[m.id] > 0).map((m) => ({ kind: 'material', text: `${totals[m.id].toLocaleString('en-US')} ${m.name}`, icon: m.icon ?? null }));
  const rank = (k) => { const i = NEWS_ORDER.indexOf(k); return i < 0 ? NEWS_ORDER.length : i; };
  news.map((n, i) => ({ n, i })).sort((x, y) => (rank(x.n.kind) - rank(y.n.kind)) || (x.i - y.i))
    .forEach(({ n }) => { out.push({ kind: n.kind, text: n.text }); out.push(...n.under); });
  return out;
}

/** A list longer than this on the results is said as its count (0.9.0). */
export const COLLAPSE_AT = 3;

/** What a Tide is, in one line, wherever one first shows: the glossary's own short line (data/glossary.js), mid-sentence. */
export function tideLine() {
  const t = termShort('tide').replace(/\.$/, '');
  return `${t.charAt(0).toLowerCase()}${t.slice(1)}`;
}
/** The same line, for callers that keep it (the glossary's words; nothing is written here). */
export const TIDE_LINE = tideLine();
/** How a Tide opens: the first sentence of the glossary's "where" for a Tide, with "the" for a map's. */
export const TIDE_HOW = 'Kill the last boss to open Tide 1, then at each Tide to open the next';

/** "Bram kept count: 6 orders done" (D3): orders done before the Tavern kept the board, said when it opens. */
export function ordersKeptText(data, n) {
  const keeper = data.npcs.find((x) => x.home === 'tavern');
  return `${keeper?.name ?? 'The innkeeper'} kept count: ${n} ${n === 1 ? 'order' : 'orders'} done`;
}

/** "1 kill", "300 kills" (0.9.0, V4: "1 kills total"). */
export function killsText(n) {
  return `${Number(n).toLocaleString('en-US')} ${Number(n) === 1 ? 'kill' : 'kills'}`;
}

/**
 * What can be bought now (0.9.0, V4: the results led with lists; the one thing to do showed only
 * in Next up): [{ title, at }], buildings first, at most `n`. at: "Ready at the Lamp Post".
 */
export function readyNow(doc, data, n = 4) {
  const order = { building: 0, research: 1, upgrade: 2 };
  return purchaseOptions(doc, data)
    .filter((o) => o.missing.length === 0 && !(o.waits?.length) && o.kind !== 'consumable' && o.kind !== 'gear_tier')
    .sort((a, b) => (order[a.kind] ?? 3) - (order[b.kind] ?? 3))
    .slice(0, n)
    .map((o) => { const t = optionText(data, o); return { title: t.title, at: `Ready at the ${t.where}`, kind: o.kind, id: o.id }; });
}

/**
 * What a purchase would cost a Ready level (0.9.0, V4: three presses of Brighter Flame took Lamp
 * Post Lv 2 out of reach and nothing said so): `after` is the profile the purchase would leave (or
 * null when it would be refused). The building levels that are Ready now and wouldn't be after,
 * each with what it would be short of: "Leaves Lamp Post Lv 2 short of 61 Oil", or null.
 * `self`: the purchase's own building id, when it's a restore (its own next level isn't news).
 */
export function purchaseWarning(doc, data, after, self = null) {
  if (!after) return null;
  const ready = purchaseOptions(doc, data).filter((o) => o.kind === 'building' && o.missing.length === 0 && o.id !== self);
  if (!ready.length) return null;
  const later = purchaseOptions(after, data);
  const lost = [];
  for (const o of ready) {
    const now = later.find((x) => x.kind === 'building' && x.id === o.id && x.level === o.level);
    if (now && now.missing.length) lost.push(`${buildingName(data, o.id)} Lv ${o.level} short of ${now.missing.map((m) => `${Number(m.need).toLocaleString('en-US')} ${matName(data, m.id)}`).join(', ')}`);
  }
  return lost.length ? `Leaves ${listText(lost)}` : null;
}

/** Where a Tide just opened is picked: at the gate; the Chapel to restore first; or the fog over it. */
function tideWhere(data, doc) {
  if (!doc || levelOf(doc, 'chapel', data) > 0) return 'Pick it at the gate';
  const at = fogOver(doc, data, 'chapel');
  if (at) { const [id, lv] = at.split(':'); return `The ${buildingName(data, 'chapel')} opens with ${buildingName(data, id)} Lv ${lv}`; }
  const waits = levelNeeds(doc, data, 'chapel');   // (X3, D5: its first level waits on the Salt Widow)
  return `Restore the ${buildingName(data, 'chapel')} to pick it at the gate${waits ? `. ${waits}` : ''}`;
}

/**
 * One of the next-3 (meta/next.js): { title, where, readyAt, progress, need }. `where` is the
 * building to go to ("Lamp Post", a label), `readyAt` the line once it's affordable ("Ready" for
 * a building, which is where you go; "Ready at the Lamp Post" for the rest), `need` what's short
 * ("Need 4 Coin, 2 Rope"), or null, `opens` what it adds ("New weapon: Tide Bell"), or null,
 * `runs` a project's map ("Then 2 runs on the Salt Marsh"), or null, and `waits` the maps not open
 * yet that it waits on (meta/next.js's `waits`: "Opens with the Salt Marsh"), or null.
 */
export function optionText(data, o) {
  let title, at;
  if (o.kind === 'building') { title = `${buildingName(data, o.id)} Lv ${o.level}`; at = o.id; }
  else if (o.kind === 'upgrade') { title = rankText(data, o.id, o.rank); at = 'lamp_post'; }
  else if (o.kind === 'craft') { title = nameOf(data.recipes, o.id); at = 'smithy'; }
  else if (o.kind === 'gear_tier') { title = `${nameOf(data.recipes, o.id)}, ${tierName(o.tier)}`; at = 'smithy'; }
  else if (o.kind === 'consumable') { title = nameOf(data.consumables, o.id); at = 'apothecary'; }
  else { title = nameOf(data.research, o.id); at = 'library'; }
  const need = o.missing.length ? `Need ${o.missing.map((m) => `${Number(m.need).toLocaleString('en-US')} ${matName(data, m.id)}`).join(', ')}` : null;
  // The one option that opens content says what (meta/next.js nextAffordable's `opens`).
  const opens = o.opens?.length ? joinsTexts(o.opens).join('. ') : null;
  // A project that counts only runs on one map says so (0.8.0): "Then 2 runs on the Salt Marsh".
  const r = o.kind === 'research' ? data.research.find((x) => x.id === o.id) : null;
  const runs = r?.runsOn ? `Then ${runsText(r.runs)} on ${mapIn(data, r.runsOn)}` : null;
  // A project on a map not open yet, or a cost only a map not open yet drops (0.8.0).
  const waits = o.waits?.length ? `Opens with ${listText(o.waits.map((id) => mapIn(data, id)))}` : null;
  return { title, where: buildingName(data, at), readyAt: o.kind === 'building' ? 'Ready' : `Ready at the ${buildingName(data, at)}`, progress: o.progress, need, opens, runs, waits };
}

/** The line a Phase 7 purchase leaves on its panel (meta/workshop.js's change). */
export function actionLine(data, c) {
  const recipe = (id) => nameOf(data.recipes, id);
  switch (c?.kind) {
    case 'gear_made': return `Made a ${recipe(c.id)}${c.worn ? ' and put it on' : ''}`;
    case 'gear_tier': return `The ${recipe(c.id)} is now ${tierName(c.tier)}`;
    case 'gear_reroll': return `Changed ${nameOf(data.affixes, c.was)} to ${nameOf(data.affixes, c.now)}`;
    case 'gear_worn': return 'Put on';
    case 'gear_off': return 'Taken off';
    case 'consumable': return `Bought ${nameOf(data.consumables, c.id)}. You have ${c.held}`;
    case 'trade': return `Traded ${c.gave} ${matName(data, c.give)} for ${c.got} ${matName(data, c.get)}`;
    case 'skill': return `Took ${nameOf(data.skills, c.id)}`;
    case 'skill_reset': return 'The tree is reset. Every point is back';
    default: return '';
  }
}

/**
 * Up to `n` Harbor Orders not done yet that a run on this map can do (0.9.0): those on the board
 * that name this map, then those that name none, lowest tier first. [feat].
 */
export function ordersFor(doc, data, mapId, n = 3) {
  if (!levelEffect(doc, data, 'tavern', 'feats')) return [];
  const done = featsDone(doc, data), found = new Set(doc?.profile?.featsFound || []);
  const open = (data.feats || []).filter((f) => !done.has(f.id) && featShown(f, done, found) && !['tide', 'run', 'hunt'].includes(f.group));
  const here = open.filter((f) => f.when?.map === mapId || (f.group === 'marsh' && mapId === 'salt_marsh') || (f.group === 'docks' && mapId === 'drowned_docks'));
  const any = open.filter((f) => !f.when?.map && !['docks', 'marsh'].includes(f.group));
  const byTier = (a, b) => (a.tier ?? 1) - (b.tier ?? 1);
  return [...here.sort(byTier), ...any.sort(byTier)].slice(0, n);
}

/**
 * The gear worn into a run, on the gate's map card (0.9.0): "Wearing: Storm Lantern (Rare), Sea
 * Boots (Common)", or "Wearing no gear. Make some at the Smithy" once the Smithy makes it; null before.
 */
export function loadoutText(doc, data) {
  const open = gearSlotsOpen(doc, data);
  if (!open.length) return null;
  const eq = gearEquipped(doc), items = gearItems(doc);
  const worn = open.map((slot) => items.find((x) => x.uid === eq[slot])).filter(Boolean)
    .map((it) => `${nameOf(data.recipes, it.id)} (${tierName(it.tier)})`);
  return worn.length ? `Wearing: ${listText(worn)}` : `Wearing no gear. Make some at the ${buildingName(data, 'smithy')}`;
}

/** What a character's trade counts are called on their ledger (sim/run-result.js `trade`). */
const TRADE_WORDS = Object.freeze({
  lanterns: 'lanterns set down', lamps: 'lamps lit', elites: 'elites landed', reeled: 'things reeled in', sweeps: 'sweeps that hit 3 or more', caches: 'floating chests',
  raised: 'dead raised', deadDamage: 'damage by her dead', crates: 'crates brought up', slots: 'weapon slots', calls: 'tides called', floods: 'floods that caught 20', bells: 'bells rung',
  sigLevel: 'signature weapon level', sigShare: 'percent of damage by the signature weapon',
});

/** Each character's one run-end number on the results (Ruling 21 PB): the count their job is measured in. */
const LEDGER_KEY = Object.freeze({ lamplighter: 'lamps', harpooner: 'elites', punter: 'sweeps', bog_warden: 'raised', drowned_man: 'crates', tide_priest: 'floods' });

/** A trade count's words, one or many ("1 lantern set down", "3 lanterns set down"). */
function tradeWords(k, n) {
  const w = TRADE_WORDS[k];
  if (n !== 1) return w;
  return k === 'slots' ? 'weapon slot' : w.replace(/^(\w+?)s\b/, '$1');
}

/**
 * A character's ledger (profile.characters[id].ledger, kept by meta/apply.js) as lines for the
 * skill tree screen: clears by map and Tide, the best clear, and the most their trade did in a run.
 */
export function ledgerLines(doc, data, character) {
  const L = doc?.profile?.characters?.[character]?.ledger;
  if (!L || typeof L !== 'object') return [];
  const lines = [];
  for (const m of data.maps) {
    const tides = Object.keys(L.clears || {}).filter((k) => k.startsWith(`${m.id}:`)).map((k) => Number(k.split(':')[1])).filter(Number.isFinite).sort((a, b) => a - b);
    if (tides.length) lines.push(`${m.name}: cleared at Tide ${listText(tides.map(String))}`);
  }
  if (L.time > 0) lines.push(`Fastest clear: ${Math.floor(L.time / 60)}:${String(L.time % 60).padStart(2, '0')}`);
  const best = Object.entries(L.best || {}).filter(([k, v]) => TRADE_WORDS[k] && v > 0).map(([k, v]) => `${v.toLocaleString('en-US')} ${TRADE_WORDS[k]}`);
  if (best.length) lines.push(`Most in one run: ${best.join(', ')}`);
  return lines;
}
