// The harbor's app logic that doesn't need a screen (ARCHITECTURE §10.4): what a purchase plays
// out as in the harbor, and what the harbor shows for a profile. Pure; tested in Node.

import { levelOf, revealedFog, hubPeople, shownProps, npcLine, completion } from '../meta/state.js';
import { codexCount } from '../meta/codex.js';
import { levelEffects, buildingName, buildingIn, ordersKeptText } from '../ui/hubtext.js';
import { clockText } from '../lib/text.js';
import { WAITING_LINES } from '../data/npcs.js';

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
    banner: {
      title: `${buildingName(data, change.id)} Lv ${change.level}`,
      lines: [...levelEffects(data, change.id, change.level).map((e) => e.text), ...(change.maps || []).map((id) => `New map: ${data.maps.find((m) => m.id === id)?.name ?? id}. Choose it at the gate`),
        // D3: orders done before the Tavern kept the board, counted as it opens.
        ...(change.orders?.length ? [ordersKeptText(data, change.orders.length)] : [])],
    },
  };
}

/**
 * Who a run brought (0.8.0: a feat, a challenge, a map; applyRunResult's 'arrival' changes), each
 * coming home by boat when the results close: { arriving: [ids], arrivals: [{ id, sprite, waitAt,
 * people }] }. The harbor is built without them (they're still out at sea) until their boat ties up.
 */
export function runArrivals(docAfter, data, changes) {
  const arriving = [...new Set((changes || []).filter((c) => c.kind === 'arrival').map((c) => c.id))];
  const people = hubPeople(docAfter, data);
  const arrivals = arriving.map((id) => {
    const p = people.find((q) => q.id === id);
    return p ? { id, sprite: p.sprite, waitAt: p.post, people } : null;
  }).filter(Boolean);
  return { arriving: arrivals.map((a) => a.id), arrivals };
}

/** What someone on the square says when you walk up: { name, text }. */
export function lineFor(doc, data, id) {
  const npc = data.npcs.find((n) => n.id === id);
  if (npc) return { name: npc.name, text: npcLine(doc, data, id) ?? '...' };
  const c = data.characters.find((x) => x.id === id);
  if (c) return { name: c.name, text: c.hubLine || WAITING_LINES[id] || '...' };
  return null;
}

/** The prompt over what's in reach: "Enter the Library", "Start run", "Talk to Old Wick, the lamplighter". */
export function promptFor(data, near) {
  if (!near) return null;
  if (near.kind === 'gate') return 'Start run';
  if (near.kind === 'door') return near.id === 'lamp_post' ? `Use the ${buildingIn(data, near.id)}` : `Enter the ${buildingIn(data, near.id)}`;
  const npc = data.npcs.find((n) => n.id === near.id);
  const c = npc ? null : data.characters.find((x) => x.id === near.id);
  if (npc) return `Talk to ${npc.name}, the ${npc.role}`;
  return `Talk to ${c?.name ?? near.id}`;
}

/**
 * When a run cleared its map: the time its last boss died (the map's last 'boss' event's enemy, by
 * the result's bossesKilled), or, without that, the time the run ended. null when it didn't clear.
 */
export function clearedAt(result, data = null) {
  if (!(result?.end === 'cleared' || result?.cleared)) return null;
  const map = data?.maps?.find((m) => m.id === result?.map);
  const last = map?.timeline?.events?.filter((e) => e.event === 'boss').reduce((a, e) => (!a || e.at > a.at ? e : a), null);
  const kills = Array.isArray(result.bossesKilled) ? result.bossesKilled.filter((b) => b && b.id === last?.enemy && Number.isFinite(b.time)) : [];
  const end = Number(result.timeSurvived);
  if (kills.length) return Math.min(...kills.map((b) => b.time));
  return Number.isFinite(end) ? end : 0;
}

/**
 * The results screen's heading: { title, line }. The title is the screen's name; the line is how
 * the run ended (the last one, when Run again made it several: runs says how many), naming the map
 * cleared from the data (result.map). A clear says when the last boss died and how long the
 * overtime after it lasted, a death in that overtime included: "Drowned Docks cleared at 21:07,
 * then 4 minutes of overtime".
 */
export function runHeading(result, runs = 1, data = null) {
  const clock = clockText(Number(result?.timeSurvived));
  const map = data?.maps?.find((m) => m.id === result?.map)?.name;
  const at = clearedAt(result, data);
  let how;
  if (at !== null) {
    const over = Math.floor((Number(result.timeSurvived) - at) / 60 + 1e-9);
    how = `${map ?? 'Map'} cleared at ${clockText(at)}${over >= 1 ? `, then ${over} ${over === 1 ? 'minute' : 'minutes'} of overtime` : ''}`;
  } else how = result?.end === 'left' ? `Returned at ${clock}` : `Survived ${clock}`;
  return runs > 1 ? { title: `Results (${runs} runs)`, line: `Last run: ${how}` } : { title: 'Results', line: how };
}

/**
 * The title screen's completion line (0.9.0, brief §6.8): "Completion 23%. Codex 41 of 80", or null
 * on a profile that hasn't played (nothing to show yet).
 */
export function completionText(doc, data) {
  if (!((doc?.stats?.runs ?? 0) > 0)) return null;
  const c = codexCount(doc, data);
  return `Completion ${completion(doc, data).percent}%. Codex ${c.seen} of ${c.of}`;
}

/** The title screen's first button: Start on a new profile, Continue once anything has happened. */
export function titleStartLabel(doc) {
  const started = (doc?.stats?.runs ?? 0) > 0 || Object.values(doc?.profile?.buildings ?? {}).some((v) => v > 0);
  return started ? 'Continue' : 'Start';
}

/**
 * Two runs in a row (Run again goes straight into the next) as one visit to the results: a is what
 * the harbor hasn't shown yet ({ changes, result, runs }), b the run just saved. Materials add up
 * (in the data's order), and so do the minutes' pay and the Sea Glass the Market bought; a
 * project's latest step stands; what finished, what the codex saw, the bestiary's milestones,
 * feats done and found, challenges won, Tides opened, relics given to the Well, maps opened, and
 * who arrived are said once each, and the field guide's new entries add up; a character's mastery
 * says only its highest rank; the longest run keeps the earlier record it beat and the new best; a
 * research wait is said only if the last run didn't count.
 */
export function mergeRuns(a, b, data) {
  const all = [...a.changes, ...b.changes];
  const out = [];
  const mats = new Map();
  for (const c of all) if (c.kind === 'material') mats.set(c.id, (mats.get(c.id) ?? 0) + c.count);
  for (const m of data.materials) if (mats.has(m.id)) out.push({ kind: 'material', id: m.id, count: mats.get(m.id) });
  const pays = all.filter((c) => c.kind === 'time_pay');
  if (pays.length) {
    const paid = {};
    for (const c of pays) for (const [id, n] of Object.entries(c.materials || {})) paid[id] = (paid[id] ?? 0) + n;
    out.push({ kind: 'time_pay', minutes: pays.reduce((s, c) => s + (c.minutes || 0), 0), materials: paid });
  }
  const doneIds = new Set(all.filter((c) => c.kind === 'research_done').map((c) => c.id));
  // A project's latest word stands: a step, or (0.8.0) a wait for runs on its own map.
  const steps = new Map();
  for (const c of all) if ((c.kind === 'research_step' || c.kind === 'research_elsewhere') && !doneIds.has(c.id)) steps.set(c.id, c);
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
  const glass = all.filter((c) => c.kind === 'glass_coin');
  if (glass.length) out.push({ kind: 'glass_coin', glass: glass.reduce((s, c) => s + c.glass, 0), count: glass.reduce((s, c) => s + c.count, 0) });
  // Mastery: each character's highest rank reached.
  const ranks = new Map();
  for (const c of all) if (c.kind === 'mastery' && !(ranks.get(c.character)?.rank >= c.rank)) ranks.set(c.character, c);
  out.push(...ranks.values());
  // Tides (per map), challenges, feats done and found, relics given to the Well, maps opened, and
  // who arrived: once each, in the order they came.
  const once = new Set();
  for (const c of all) {
    const key = c.kind === 'tide' ? `tide:${c.map ?? ''}:${c.level}` : ['challenge', 'feat', 'feat_found', 'well', 'map_open', 'arrival'].includes(c.kind) ? `${c.kind}:${c.id}` : null;
    if (key && !once.has(key)) { once.add(key); out.push(c); }
  }
  // What each map showed for the first time, added up (0.8.0).
  const sights = new Map();
  for (const c of all) if (c.kind === 'sighted') sights.set(c.map, [...new Set([...(sights.get(c.map) || []), ...c.names])]);
  for (const [map, names] of sights) out.push({ kind: 'sighted', map, names });
  return { changes: out, result: b.result, runs: (a.runs ?? 1) + (b.runs ?? 1) };
}

/**
 * What the sweep's rulings paid a save back when it loaded (meta/retired.js profile.retiredNote), as
 * a banner for the next harbor visit: { title, lines }. The tonics the Apothecary no longer sells,
 * at the price paid; the bestiary rungs reached and never claimed.
 */
export function retiredNoteText(data, note) {
  const mats = (m) => data.materials.filter((x) => (m?.[x.id] ?? 0) > 0).map((x) => `${m[x.id].toLocaleString('en-US')} ${x.name}`).join(', ');
  const lines = [];
  if (note?.tonics > 0) lines.push(`The Apothecary sells run tools now. It bought back your ${note.tonics} ${note.tonics === 1 ? 'tonic' : 'tonics'}: ${mats(note.refund)}`);
  if (note?.stones > 0) lines.push(`Runes are gone: their effects are Rare and Epic traits on weapons now. The Smithy bought back your ${note.stones} rune ${note.stones === 1 ? 'stone' : 'stones'}: ${mats(note.stoneRefund)}`);
  if (note?.rungs && Object.keys(note.rungs).length) lines.push(`Kill counts are in the codex now. The rungs you had reached paid: ${mats(note.rungs)}`);
  if (note?.perks > 0) lines.push(`Mastery perks are skill trees now. Your ${note.perks} trained ${note.perks === 1 ? 'perk was' : 'perks were'} bought back (${mats(note.perkRefund)}), and ${note.points} skill ${note.points === 1 ? 'point is' : 'points are'} yours to spend at the Tavern`);
  return { title: 'The harbor has changed', lines };
}
