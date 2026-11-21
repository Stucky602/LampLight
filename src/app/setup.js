// The gate's second step (ARCHITECTURE §10.2 step 1): how a run sets out. Pure; tested. The rows
// are what the profile has opened right now, and every value is one meta/runconfig.js runConfigFor
// accepts. The sweep, X2 (rulings 11 to 13): the gate had 14 rows for a finished harbor; it has six,
// in this order, each shown once the harbor has opened it:
//   map         the map, and a short run of it once the Cartographer opens short runs
//   character   who sets out, with the skills they have taken
//   kit         the starting weapon
//   heirloom    one relic found before, carried from 0:00 in a relic slot
//   tools       run tools held, up to the harbor's slots (one row, each tool a switch)
//   difficulty  the Tide and the curses, together
// A `choice` row steps with left and right; a `multi` row holds several items: left and right move along them and
// confirm changes the one in focus (ui/hubscreens.js setupScreen). Set runs (they were challenge
// runs) start from the Harbor Orders board, never here.

import { tideAvailable, cursesAvailable, resolveContent, heldOf, levelEffect, mapOpen, mapsOpen, heirloomChoices, orderPosted, slotsFor } from '../meta/state.js';
import { skillsOf } from '../meta/skills.js';
import { kitsOf, consumableSlots } from '../meta/workshop.js';
import { modesOpen, noHealRefusal } from '../meta/runconfig.js';
import { MetaError } from '../meta/actions.js';
import { tideText, tideRules, TIDE_HOW } from '../ui/hubtext.js';
import { termShort } from '../data/glossary.js';

/**
 * The set runs this profile can start from the board: posted, their character arrived, and their
 * map open (runConfigFor refuses the rest).
 */
export function challengesOpen(doc, data) {
  const here = new Set(resolveContent(doc, data).characters);
  return data.challenges.filter((c) => here.has(c.character) && mapOpen(doc, data, c.map ?? data.maps[0].id) && orderPosted(doc, data, data.feats.find((f) => f.id === c.id)));
}

/** Why a set run can't start now ("The Punter hasn't arrived yet"), or null. `order`: its Harbor Order. */
export function whyNotSetRun(doc, data, order) {
  const r = order?.rules;
  if (!r) return 'Not a challenge run';
  if (!orderPosted(doc, data, order)) return 'Not posted yet';
  const c = data.characters.find((x) => x.id === r.character);
  if (!resolveContent(doc, data).characters.includes(r.character)) return `The ${c?.name ?? r.character} hasn't arrived yet`;
  const m = data.maps.find((x) => x.id === r.map);
  if (m && !mapOpen(doc, data, m.id)) return `The ${m.name} isn't open yet`;
  return null;
}

/** Who a choice sets out as: the challenge's character in a challenge run, else the one chosen. */
export function setsOutAs(data, choice) {
  return choice.mode === 'challenge' ? data.challenges.find((c) => c.id === choice.challenge)?.character ?? choice.character : choice.character;
}

/** The weapon a choice starts with: the kit's, or the character's own. */
function firstWeapon(doc, data, choice) {
  const who = setsOutAs(data, choice);
  const kit = choice.mode !== 'challenge' && choice.kit ? kitsOf(doc, data, who).find((k) => k.id === choice.kit) : null;
  return kit ? kit.start : data.characters.find((c) => c.id === who)?.start ?? null;
}

/** The map a choice plays on: a set run's own, else the one chosen (map 1 when none is). */
export function playsOn(data, choice) {
  if (choice.mode === 'challenge') return data.challenges.find((c) => c.id === choice.challenge)?.map ?? data.maps[0].id;
  return choice.map || data.maps[0].id;
}

/** A first choice for a character from the profile's last one (only what's still open), on `map` (map 1 when not given). */
export function startChoice(doc, data, character, map = null) {
  const S = doc?.profile?.setup ?? {};
  const on = map || data.maps[0].id;
  const kits = kitsOf(doc, data, character).filter((k) => k.open).map((k) => k.id);
  const open = new Set(cursesAvailable(doc, data).map((c) => c.id));
  const relic = data.relics.find((r) => r.id === S.heirloom);
  return {
    character,
    kit: S.character === character && kits.includes(S.kit) ? S.kit : '',
    mode: modesOpen(doc, data).includes(S.mode) ? S.mode : 'standard',
    challenge: '',
    tide: Math.min(doc?.profile?.tide?.selected ?? 0, tideAvailable(doc, data, on)),
    map: on,
    curses: (S.curses || []).filter((c) => open.has(c)),
    heirloom: relic && heirloomChoices(doc, data).includes(relic.id) && !noHealRefusal(data, character, relic) ? relic.id : '',
    consumables: [],
    rune: '',
  };
}

/** "A, B, and C". */
const listNames = (n) => (n.length < 3 ? n.join(' and ') : `${n.slice(0, -1).join(', ')}, and ${n.at(-1)}`);
const clock = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;

/** What a mode means on a map, as a label. */
function modeText(data, mode, mapId = data.maps[0].id) {
  const map = data.maps.find((m) => m.id === mapId) ?? data.maps[0];
  const last = Math.max(0, ...map.timeline.events.filter((e) => e.event === 'boss').map((e) => e.at));
  const R = data.tuning.run;
  if (mode === 'short') return `Everything comes ${Math.round(1 / R.shortTimeScale) === 2 ? 'twice' : `${Math.round(1 / R.shortTimeScale)} times`} as fast. The last boss comes at ${clock(last * R.shortTimeScale)}, and the run pays ${Math.round(R.shortRewardMul * 100)}% of what a full run would.`;
  return `The last boss comes at ${clock(last)}.`;
}

/**
 * The gate's rows for a choice, at most seven (the header lists them):
 *   { key, label, kind: 'choice', value, choices: [[value, label]], detail: [lines], icon? }
 *   { key, label, kind: 'multi', items: [{ id, label, on?, press, detail: [lines] }], summary, detail: [lines] }
 * A multi item's `press` is the [key, value] applyRow takes when it is pressed; with `why` it can't
 * be pressed now and says that instead. Empty when the harbor has opened nothing past the map and
 * the character (the gate's cards ask those): the gate then sets out at once.
 */
export function setupRows(doc, data, choice) {
  const rows = [];
  const weaponName = (id) => data.weapons.find((w) => w.id === id)?.name ?? id;
  const descOf = (list, id) => list.find((x) => x.id === id)?.desc ?? null;
  const who = choice.character, C = data.characters.find((c) => c.id === who), whoName = C?.name ?? who;
  const on = playsOn(data, choice);

  // 1. Map (and a short run of it).
  const maps = mapsOpen(doc, data), modes = modesOpen(doc, data);
  const mapChoices = maps.flatMap((id) => modes.map((m) => [m === 'short' ? `${id}:short` : id, `${data.maps.find((x) => x.id === id).name}${m === 'short' ? ', short run' : ''}`]));
  const S = slotsFor(doc, data);
  rows.push({ key: 'map', label: 'Map', kind: 'choice', value: choice.mode === 'short' ? `${on}:short` : on, choices: mapChoices,
    detail: [modeText(data, choice.mode, on), `Slots: ${S.weapons} weapons, ${S.passives} passives, ${S.relics} relics.`] });

  // 2. Character, with the skills in play (ruling 15).
  const chars = resolveContent(doc, data).characters;
  const trained = skillsOf(doc, data, who).map((id) => data.skills.find((s) => s.id === id).name);
  // (Round 2, L2: a character not yet arrived, set by a tool, showed as its raw id; the row always names them.)
  rows.push({ key: 'character', label: 'Character', kind: 'choice', value: who, choices: data.characters.filter((c) => chars.includes(c.id) || c.id === who).map((c) => [c.id, c.name]),
    detail: [C?.desc ?? null, trained.length ? `Skills: ${listNames(trained)}.` : (levelEffect(doc, data, 'tavern', 'mastery') ? 'No skills taken yet.' : null)] });

  // 3. Starting weapon.
  const kits = kitsOf(doc, data, who).filter((k) => k.open);
  if (kits.length > 1) {
    const k = kits.find((x) => x.id === choice.kit) ?? kits[0];
    rows.push({ key: 'kit', label: 'Starting weapon', kind: 'choice', value: choice.kit, choices: kits.map((x) => [x.id, weaponName(x.start)]), detail: [descOf(data.weapons, k.start)] });
  }

  // 4. Heirloom: a relic found before. A character who can't heal isn't offered what only heals
  // (the sweep, A5): the row leaves those out and says so.
  const found = heirloomChoices(doc, data).map((id) => data.relics.find((r) => r.id === id));
  if (found.length) {
    const out = found.filter((r) => noHealRefusal(data, who, r)).map((r) => r.name);
    const relic = found.find((r) => r.id === choice.heirloom);
    rows.push({ key: 'heirloom', label: 'Heirloom', kind: 'choice', value: choice.heirloom, icon: relic?.icon ?? null,
      choices: [['', 'None'], ...found.filter((r) => !noHealRefusal(data, who, r)).map((r) => [r.id, r.name])],
      detail: [relic ? relic.desc : termShort('heirloom'), relic ? `It takes 1 of your ${S.relics} relic slots.` : null,
        ...(out.length ? [`The ${whoName} can't heal, so ${listNames(out)} ${out.length === 1 ? 'is' : 'are'} left out.`] : [])] });
  }

  // 5. Run tools: the ones held, each a switch, up to the slots.
  const held = data.consumables.filter((c) => heldOf(doc, c.id) > 0);
  const slots = consumableSlots(doc, data);
  if (held.length && slots > 0) {
    const taken = choice.consumables.filter(Boolean);
    rows.push({ key: 'tools', label: 'Run tools', kind: 'multi', summary: `${taken.length} of ${slots}`,
      items: held.map((c) => ({ id: c.id, label: c.name, on: taken.includes(c.id), press: [`tool:${c.id}`, !taken.includes(c.id)],
        why: !taken.includes(c.id) && taken.length >= slots ? `Only ${slots} run ${slots === 1 ? 'tool' : 'tools'} can go into a run. Take one out first.` : null,
        detail: [c.desc, `You have ${heldOf(doc, c.id)}. The run uses it up.`] })),
      detail: [termShort('consumable')] });
  }

  // 6. Difficulty: the Tide open on this run's map, and the curses.
  const max = tideAvailable(doc, data, on), curses = cursesAvailable(doc, data);
  if (max > 0 || curses.length) {
    const items = [];
    if (max > 0) {
      const tideLines = choice.tide > 0 ? [tideText(data.tides[choice.tide - 1]), ...tideRules(data, choice.tide)] : [`${termShort('tide')} ${TIDE_HOW}.${maps.length > 1 ? ' Each map has its own Tides.' : ''}`];
      items.push({ id: 'tide_down', label: 'Lower', press: ['tide', Math.max(0, choice.tide - 1)], why: choice.tide <= 0 ? 'No Tide is chosen.' : null, detail: tideLines });
      items.push({ id: 'tide_up', label: 'Raise', press: ['tide', Math.min(max, choice.tide + 1)], why: choice.tide >= max ? `Tide ${max} is the highest open on this map.` : null, detail: tideLines });
    }
    for (const c of curses) items.push({ id: c.id, label: c.name, on: choice.curses.includes(c.id), press: [`curse:${c.id}`, !choice.curses.includes(c.id)], detail: [`Curse: ${c.desc}`, `Pays ${Math.round(c.rewardMul * 100)}% more materials`] });
    const n = choice.curses.length;
    rows.push({ key: 'difficulty', label: 'Difficulty', kind: 'multi', items,
      summary: [max > 0 ? (choice.tide > 0 ? `Tide ${choice.tide}` : 'No Tide') : null, curses.length ? `${n} ${n === 1 ? 'curse' : 'curses'}` : null].filter(Boolean).join(', '),
      detail: [`${termShort('tide')} ${termShort('curse')}`] });
  }

  // Nothing past the map and the character, which the gate's cards have just asked: set out at once.
  if (rows.length === 2) return [];
  for (const r of rows) { r.detail = (r.detail || []).filter(Boolean); for (const it of r.items || []) it.detail = (it.detail || []).filter(Boolean); }
  return rows;
}

/** The choice with one row's new value (`key`: a row's key, or a multi item's `press` key). */
export function applyRow(choice, key, value) {
  const c = { ...choice, curses: [...choice.curses], consumables: [...choice.consumables] };
  if (key.startsWith('curse:')) {
    const id = key.slice(6);
    c.curses = value ? [...new Set([...c.curses, id])] : c.curses.filter((x) => x !== id);
  } else if (key.startsWith('tool:')) {
    const id = key.slice(5);
    c.consumables = value ? [...new Set([...c.consumables.filter(Boolean), id])] : c.consumables.filter((x) => x && x !== id);
  } else if (key === 'map') {
    const [map, mode] = String(value).split(':');
    c.map = map; c.mode = mode === 'short' ? 'short' : 'standard';
  } else c[key] = value;
  return c;
}

/**
 * The choice held to what the profile allows after a change: a kit the character has, a Tide this
 * map has opened, run tools within the slots, and an Heirloom the character can use (runes are
 * gone since ruling 14; `rune` stays empty so the save's shape does).
 */
export function settleChoice(doc, data, choice) {
  const c = { ...choice, curses: [...choice.curses], consumables: choice.consumables.filter(Boolean) };
  if (c.mode === 'challenge') return c;
  const who = c.character;
  // A new character keeps only a kit of their own.
  if (c.kit && !kitsOf(doc, data, who).some((k) => k.open && k.id === c.kit)) c.kit = '';
  // The Tide held to what this map has opened.
  if (Number.isInteger(c.tide)) c.tide = Math.min(c.tide, tideAvailable(doc, data, playsOn(data, c)));
  c.rune = '';
  // What only heals is no use to a character who can't.
  if (c.heirloom && noHealRefusal(data, who, data.relics.find((r) => r.id === c.heirloom))) c.heirloom = '';
  c.consumables = c.consumables.filter((id) => heldOf(doc, id) > 0).slice(0, consumableSlots(doc, data));
  return c;
}

/** The choice as runConfigFor takes it (empty values dropped). */
export function choiceForRun(choice) {
  const out = { character: choice.character, mode: choice.mode };
  if (choice.mode === 'challenge') { out.challenge = choice.challenge; return out; }
  if (choice.kit) out.kit = choice.kit;
  out.tide = choice.tide; out.curses = choice.curses;
  if (choice.map) out.map = choice.map;
  if (choice.heirloom) out.heirloom = choice.heirloom;
  const cons = choice.consumables.filter(Boolean);
  if (cons.length) out.consumables = cons;
  return out;
}

/** What the choice adds to the materials a run brings home ("This run pays 36% more materials"; a set run's own Tide and curses), or null. */
export function rewardText(data, choice) {
  const ch = choice.mode === 'challenge' ? data.challenges.find((c) => c.id === choice.challenge) : null;
  const tide = ch ? ch.tide ?? 0 : choice.tide, curses = ch ? ch.curses || [] : choice.curses;
  const t = tide > 0 ? data.tides[tide - 1].rewardMul : 0;
  const c = curses.reduce((s, id) => s + (data.curses.find((x) => x.id === id)?.rewardMul ?? 0), 0);
  const pct = Math.round((t + c) * 100);
  // A short run pays its share of what a full run with the same Tide and curses would.
  if (choice.mode === 'short') return `This run pays ${Math.round(data.tuning.run.shortRewardMul * (1 + t + c) * 100)}% of a full run's materials`;
  return pct > 0 ? `This run pays ${pct}% more materials` : null;
}
