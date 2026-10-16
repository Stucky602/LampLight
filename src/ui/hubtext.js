// What the harbor's panels and the results screen say (ARCHITECTURE §10.4, §10.2 step 5), built
// from the data and the meta layer's change lists, worded as docs/WRITING.md says: labels and
// short lines, not sentences about the player. Pure (no DOM); tested.

import { contentFrom, researchDone, researchActive, researchTier, rankOf, treeTier, secretsOf } from '../meta/state.js';
import { whyNotResearch, whyNotUpgrade } from '../meta/actions.js';
import { clockText, midSentence } from '../lib/text.js';

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

/** "15 Oil, 15 Coin, 10 Timber". */
export function costText(data, cost) {
  const parts = Object.entries(cost).map(([id, n]) => `${n} ${matName(data, id)}`);
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
  return kinds.map((k) => (k.what ? `New ${k.what}: ${k.names.join(', ')}` : `Unlocked: ${k.names.join(', ')}`));
}

/**
 * What a building's level brings: [{ kind, text }], in this order. The kinds:
 *   'tree'      the tier of the Lamp Post's upgrades it unlocks
 *   'research'  the Library's research slots, and the research tier it unlocks
 *   'arrival'   a character who comes by boat
 *   'fog'       the fog clearing from its streets
 *   'joins'     what it adds to runs
 *   'keeper'    its keeper at the door (level 4), then walking the streets (level 5)
 *   'more'      only when it brings none of those
 * The panels pick by kind (the Tavern lists who and what comes back), never by the wording.
 */
export function levelEffects(data, buildingId, level) {
  const b = data.buildings.find((x) => x.id === buildingId);
  if (!b || level < 1 || level > b.levels.length) return [];
  const lv = b.levels[level - 1];
  const out = [];
  const add = (kind, text) => out.push({ kind, text });
  if (lv.tree) add('tree', `Unlocks upgrade tier ${lv.tree}`);
  // (The Library's first level unlocks tier 1 along with its first slot, so it says only that.)
  if (lv.researchSlots === 1) add('research', 'Unlocks research');
  else if (lv.researchSlots) add('research', `Research slots: ${lv.researchSlots}`);
  if (lv.researchTier > 1) add('research', `Unlocks research tier ${lv.researchTier}`);
  const brings = contentFrom(data, `building:${buildingId}:${level}`);
  for (const c of brings.filter((x) => x.what === 'character')) add('arrival', `New character: ${c.name}`);
  for (const line of joinsTexts(brings.filter((x) => x.what !== 'character'))) add('joins', line);
  if (data.hub.fog.some((f) => f.revealedBy === `${buildingId}:${level}`)) add('fog', 'Clears the fog nearby');
  const keeper = data.npcs.find((n) => n.home === buildingId);
  if (keeper && level === 4) add('keeper', `${keeper.name} returns`);
  if (keeper && level === 5) add('keeper', `${keeper.name} walks the harbor`);
  if (!out.length) add('more', 'No new unlocks');
  return out;
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
  if (researchTier(doc, data) < r.tier || r.requires.some((q) => !done.has(q))) return { state: 'locked', why: whyNotResearch(doc, data, r.id) };
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
  return u ? `${u.name} ${rank}/${u.ranks}` : `${id} ${rank}`;
}

/** "3 runs" / "1 run". */
export function runsText(n) { return `${n} ${n === 1 ? 'run' : 'runs'}`; }

/**
 * The results screen's lines, from applyRunResult's changes (and a restore's): [{ kind, text,
 * icon? }] in the order they came. Materials come as one line each with their icon.
 */
export function changeLines(data, changes) {
  const out = [];
  // A kill count can cross two milestones in one run (10 and 100): say only the highest.
  const topMilestone = new Map();
  // A secret's unlocks are said once, under the secret (not again as discovered).
  const fromSecret = new Set();
  for (const c of changes) if (c.kind === 'codex' && c.unlocks) for (const u of c.unlocks) fromSecret.add(`${u.what}:${u.id}`);
  for (const c of changes) if (c.kind === 'bestiary') topMilestone.set(c.id, Math.max(topMilestone.get(c.id) ?? 0, c.kills));
  for (const c of changes) {
    switch (c.kind) {
      case 'material': {
        const m = data.materials.find((x) => x.id === c.id);
        out.push({ kind: 'material', text: `${c.count} ${m?.name ?? c.id}`, icon: m?.icon ?? null });
        break;
      }
      case 'research_step':
        out.push({ kind: 'research', text: `Research: ${nameOf(data.research, c.id)} (${runsText(c.runsLeft)} left)` });
        break;
      case 'research_done': {
        const items = c.unlocks.map((u) => contentFrom(data, `research:${c.id}`).find((x) => x.id === u.id) || { name: u.id });
        out.push({ kind: 'research_done', text: `Research complete: ${nameOf(data.research, c.id)}` });
        for (const line of joinsTexts(items)) out.push({ kind: 'unlock', text: line });
        break;
      }
      case 'research_waiting':
        out.push({ kind: 'note', text: c.reason });
        break;
      case 'codex': {
        const [kind, id] = c.key.split(':');
        if (kind === 'secret') {
          out.push({ kind: 'secret', text: `Secret found: ${nameOf(secretsOf(data), id)}` });
          const items = (c.unlocks || []).map((u) => contentFrom(data, c.key).find((x) => x.id === u.id) || { name: u.id });
          for (const line of joinsTexts(items)) out.push({ kind: 'unlock', text: line });
          break;
        }
        if (fromSecret.has(c.key)) break;
        const list = { weapon: data.weapons, passive: data.passives, relic: data.relics, rune: data.runes }[kind] || [];
        out.push({ kind: 'codex', text: `Discovered: ${nameOf(list, id)}` });
        break;
      }
      case 'bestiary':
        // A lifetime count, not this run's.
        if (c.kills === topMilestone.get(c.id)) out.push({ kind: 'bestiary', text: `${nameOf(data.enemies, c.id)}: ${c.kills.toLocaleString('en-US')} kills total` });
        break;
      case 'best_time':
        out.push({ kind: 'record', text: `New best time: ${clockText(c.seconds)} (was ${clockText(c.previous)})` });
        break;
      case 'building_level':
        out.push({ kind: 'building', text: `${buildingName(data, c.id)} Lv ${c.level}` });
        break;
      case 'upgrade_rank':
        out.push({ kind: 'upgrade', text: rankText(data, c.id, c.rank) });
        break;
      case 'research_started':
        out.push({ kind: 'research', text: `Research started: ${nameOf(data.research, c.id)} (${runsText(c.runs)})` });
        break;
      default: break;
    }
  }
  return out;
}

/**
 * One of the next-3 (meta/next.js): { title, where, readyAt, progress, need }. `where` is the
 * building to go to ("Lamp Post", a label), `readyAt` the line once it's affordable ("Ready" for
 * a building, which is where you go; "Ready at Lamp Post" for the rest), and `need` what's short
 * ("Need 4 Coin, 2 Rope"), or null.
 */
export function optionText(data, o) {
  let title, at;
  if (o.kind === 'building') { title = `${buildingName(data, o.id)} Lv ${o.level}`; at = o.id; }
  else if (o.kind === 'upgrade') { title = rankText(data, o.id, o.rank); at = 'lamp_post'; }
  else { title = nameOf(data.research, o.id); at = 'library'; }
  const need = o.missing.length ? `Need ${o.missing.map((m) => `${m.need} ${matName(data, m.id)}`).join(', ')}` : null;
  return { title, where: buildingName(data, at), readyAt: o.kind === 'building' ? 'Ready' : `Ready at ${buildingName(data, at)}`, progress: o.progress, need };
}
