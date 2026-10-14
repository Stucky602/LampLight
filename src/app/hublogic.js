// The harbor's app logic that doesn't need a screen (ARCHITECTURE §10.4): what a purchase plays
// out as in the harbor, and what the harbor shows for a profile. Pure; tested in Node.

import { levelOf, revealedFog, hubPeople, shownProps, npcLine } from '../meta/state.js';
import { levelEffects, buildingName, buildingIn } from '../ui/hubtext.js';
import { clockText } from '../lib/text.js';

/** Each building's level, for the view: { lamp_post: 2, library: 0, ... }. */
export function levelsOf(doc, data) {
  return Object.fromEntries(data.buildings.map((b) => [b.id, levelOf(doc, b.id, data)]));
}

/**
 * What the harbor plays after a building's level (restoreBuilding's 'building_level' change, with
 * the profile after it): the ceremony, carrying the fog, the props, and the people after it (but
 * not whoever arrives by boat), then an arrival for each character the level brought, and the
 * banner that names what the level did.
 */
export function levelSetPieces(docAfter, data, change) {
  const people = hubPeople(docAfter, data);
  const arriving = change.unlocks.filter((u) => u.what === 'character').map((u) => u.id);
  return {
    ceremony: {
      building: change.id, level: change.level,
      revealed: revealedFog(docAfter, data), props: shownProps(docAfter, data),
      people: people.filter((p) => !arriving.includes(p.id)),
    },
    arrivals: arriving.map((id) => {
      const p = people.find((q) => q.id === id);
      return p ? { id, sprite: p.sprite, waitAt: p.post, people } : null;
    }).filter(Boolean),
    banner: { title: `${buildingName(data, change.id)} Lv ${change.level}`, lines: levelEffects(data, change.id, change.level).map((e) => e.text) },
  };
}

/** What someone on the square says when you walk up: { name, text }. */
export function lineFor(doc, data, id) {
  const npc = data.npcs.find((n) => n.id === id);
  if (npc) return { name: npc.name, text: npcLine(doc, data, id) ?? '...' };
  const c = data.characters.find((x) => x.id === id);
  if (c) return { name: c.name, text: c.hubLine || '...' };
  return null;
}

/** The prompt over what's in reach: "Enter Library", "Start run", "Talk to Old Wick". */
export function promptFor(data, near) {
  if (!near) return null;
  if (near.kind === 'gate') return 'Start run';
  if (near.kind === 'door') return near.id === 'lamp_post' ? `Use ${buildingIn(data, near.id)}` : `Enter ${buildingIn(data, near.id)}`;
  const npc = data.npcs.find((n) => n.id === near.id);
  const c = npc ? null : data.characters.find((x) => x.id === near.id);
  return `Talk to ${npc?.name ?? c?.name ?? near.id}`;
}

/**
 * The results screen's heading: { title, line }. The title is the screen's name; the line is how
 * the run ended (the last one, when Run again made it several: runs says how many), naming the map
 * cleared from the data (result.map).
 */
export function runHeading(result, runs = 1, data = null) {
  const clock = clockText(Number(result?.timeSurvived));
  const map = data?.maps?.find((m) => m.id === result?.map)?.name;
  const how = result?.end === 'cleared' || result?.cleared ? `${map ?? 'Map'} cleared in ${clock}`
    : result?.end === 'left' ? `Returned at ${clock}`
      : `Survived ${clock}`;
  return runs > 1 ? { title: `Results (${runs} runs)`, line: `Last run: ${how}` } : { title: 'Results', line: how };
}

/** The title screen's first button: Start on a new profile, Continue once anything has happened. */
export function titleStartLabel(doc) {
  const started = (doc?.stats?.runs ?? 0) > 0 || Object.values(doc?.profile?.buildings ?? {}).some((v) => v > 0);
  return started ? 'Continue' : 'Start';
}

/**
 * Two runs in a row (Run again goes straight into the next) as one visit to the results: a is what
 * the harbor hasn't shown yet ({ changes, result, runs }), b the run just saved. Materials add up
 * (in the data's order); a project's latest step stands; what finished, what the codex saw, and the
 * bestiary's milestones are said once each; the longest run keeps the earlier record it beat and
 * the new best; a research wait is said only if the last run didn't count.
 */
export function mergeRuns(a, b, data) {
  const all = [...a.changes, ...b.changes];
  const out = [];
  const mats = new Map();
  for (const c of all) if (c.kind === 'material') mats.set(c.id, (mats.get(c.id) ?? 0) + c.count);
  for (const m of data.materials) if (mats.has(m.id)) out.push({ kind: 'material', id: m.id, count: mats.get(m.id) });
  const doneIds = new Set(all.filter((c) => c.kind === 'research_done').map((c) => c.id));
  const steps = new Map();
  for (const c of all) if (c.kind === 'research_step' && !doneIds.has(c.id)) steps.set(c.id, c);
  out.push(...steps.values());
  out.push(...all.filter((c) => c.kind === 'research_done'));
  const waiting = b.changes.find((c) => c.kind === 'research_waiting');
  if (waiting) out.push(waiting);
  const seen = new Set();
  for (const c of all) {
    const key = c.kind === 'codex' ? `codex:${c.key}` : c.kind === 'bestiary' ? `bestiary:${c.id}:${c.kills}` : null;
    if (key && !seen.has(key)) { seen.add(key); out.push(c); }
  }
  const bests = all.filter((c) => c.kind === 'best_time');
  if (bests.length) out.push({ kind: 'best_time', seconds: bests[bests.length - 1].seconds, previous: bests[0].previous });
  return { changes: out, result: b.result, runs: (a.runs ?? 1) + (b.runs ?? 1) };
}
