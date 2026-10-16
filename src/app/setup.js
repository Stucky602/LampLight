// The gate's second step (ARCHITECTURE §10.2 step 1): how a run sets out, once the harbor has
// opened any choice beyond the character. Pure; tested. The rows are what the profile has opened
// right now, each a choice the screen steps through with left and right (ui/hubscreens.js
// setupScreen) with a detail line for its value, and every value is one meta/runconfig.js
// runConfigFor accepts: only challenges whose character has arrived, and only rune stones the
// run's first weapon can take (a stone is used up as the run sets out, so one that can't be
// placed would be lost).

import { tideAvailable, cursesAvailable, resolveContent, heldOf, levelEffect } from '../meta/state.js';
import { kitsOf, consumableSlots } from '../meta/workshop.js';
import { modesOpen } from '../meta/runconfig.js';
import { runeFits } from '../sim/weapons.js';
import { MetaError } from '../meta/actions.js';
import { tideText, rewardText as rewardLabels } from '../ui/hubtext.js';

/** The challenge runs this profile can set out on (their character has arrived). */
export function challengesOpen(doc, data) {
  const here = new Set(resolveContent(doc, data).characters);
  return data.challenges.filter((c) => here.has(c.character));
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

/** Can a rune stone go into the run's first weapon at 0:00? (A stone that can't would be used up for nothing.) */
export function stoneFits(doc, data, choice, runeId) {
  const rune = data.runes.find((r) => r.id === runeId), weapon = data.weapons.find((w) => w.id === firstWeapon(doc, data, choice));
  return !!rune && !!weapon && (weapon.runeSlots ?? 0) > 0 && runeFits(rune, weapon, [], []);
}

/** The gate's last check before a run takes its stone (app/flow.js): throws when it can't be placed. */
export function checkStone(doc, data, choice) {
  if (choice.rune && !stoneFits(doc, data, choice, choice.rune)) {
    const w = data.weapons.find((x) => x.id === firstWeapon(doc, data, choice));
    throw new MetaError(`${data.runes.find((r) => r.id === choice.rune)?.name ?? choice.rune} doesn't fit the ${w?.name ?? 'first weapon'}.`);
  }
}

const MODE_NAMES = Object.freeze({ standard: 'Standard', short: 'Short (10:00)', challenge: 'Challenge' });

/** A first choice for a character from the profile's last one (only what's still open). */
export function startChoice(doc, data, character) {
  const S = doc?.profile?.setup ?? {};
  const kits = kitsOf(doc, data, character).filter((k) => k.open).map((k) => k.id);
  const modes = modesFor(doc, data);
  const mode = modes.includes(S.mode) ? S.mode : 'standard';
  const open = new Set(cursesAvailable(doc, data).map((c) => c.id));
  const chs = challengesOpen(doc, data);
  return {
    character,
    kit: S.character === character && kits.includes(S.kit) ? S.kit : '',
    mode,
    challenge: chs.some((c) => c.id === S.challenge) ? S.challenge : (chs[0]?.id ?? ''),
    tide: Math.min(doc?.profile?.tide?.selected ?? 0, tideAvailable(doc, data)),
    curses: (S.curses || []).filter((c) => open.has(c)),
    arcana: resolveContent(doc, data).arcana.includes(S.arcana) ? S.arcana : '',
    consumables: [],
    rune: '',
  };
}

/**
 * The rows for a choice: [{ key, label, kind: 'choice' | 'toggle', value, choices? }]. Empty when
 * there's nothing to choose but the character (the gate then sets out at once).
 */
export function setupRows(doc, data, choice) {
  const rows = [];
  const challenge = choice.mode === 'challenge';
  const kits = kitsOf(doc, data, choice.character).filter((k) => k.open);
  const weaponName = (id) => data.weapons.find((w) => w.id === id)?.name ?? id;
  const descOf = (list, id) => list.find((x) => x.id === id)?.desc ?? null;
  if (kits.length > 1 && !challenge) {
    const k = kits.find((x) => x.id === choice.kit) ?? kits[0];
    rows.push({ key: 'kit', label: 'Kit', kind: 'choice', value: choice.kit, choices: kits.map((x) => [x.id, `${x.name} (${weaponName(x.start)})`]), detail: [`Starting weapon: ${weaponName(k.start)}`] });
  }
  const modes = modesFor(doc, data);
  if (modes.length > 1) rows.push({ key: 'mode', label: 'Run', kind: 'choice', value: choice.mode, choices: modes.map((m) => [m, MODE_NAMES[m]]), detail: [modeText(data, choice.mode)] });
  if (challenge) {
    const won = new Set(doc?.profile?.challenges || []);
    const c = data.challenges.find((x) => x.id === choice.challenge);
    rows.push({ key: 'challenge', label: 'Challenge', kind: 'choice', value: choice.challenge, choices: challengesOpen(doc, data).map((x) => [x.id, `${x.name}${won.has(x.id) ? ' (won)' : ''}`]),
      detail: c ? [c.desc, `Reward: ${rewardLabels(data, 'challenge', c)}${won.has(c.id) ? ' (won)' : ''}`] : null });
  } else {
    const max = tideAvailable(doc, data);
    if (max > 0) rows.push({ key: 'tide', label: 'Tide', kind: 'choice', value: choice.tide, choices: Array.from({ length: max + 1 }, (_, k) => [k, k === 0 ? 'None' : `Tide ${k}`]), detail: choice.tide > 0 ? [tideText(data.tides[choice.tide - 1])] : null });
    for (const c of cursesAvailable(doc, data)) rows.push({ key: `curse:${c.id}`, label: `Curse: ${c.name}`, kind: 'toggle', value: choice.curses.includes(c.id), detail: [c.desc, `+${Math.round(c.rewardMul * 100)}% Materials`] });
  }
  const arcana = resolveContent(doc, data).arcana;
  if (arcana.length) rows.push({ key: 'arcana', label: 'Arcana', kind: 'choice', value: choice.arcana, choices: [['', 'None'], ...arcana.map((id) => [id, data.arcana.find((a) => a.id === id).name])], detail: choice.arcana ? [descOf(data.arcana, choice.arcana)] : null, icon: choice.arcana ? data.arcana.find((a) => a.id === choice.arcana)?.icon : null });
  // A slot a consumable: the ones held, none twice.
  const held = data.consumables.filter((c) => heldOf(doc, c.id) > 0);
  const slots = consumableSlots(doc, data);
  if (held.length) {
    for (let k = 0; k < slots; k++) {
      const others = choice.consumables.filter((_, j) => j !== k);
      const v = choice.consumables[k] || '';
      rows.push({ key: `slot:${k}`, label: `Consumable ${k + 1}`, kind: 'choice', value: v, choices: [['', 'None'], ...held.filter((c) => !others.includes(c.id)).map((c) => [c.id, `${c.name} (${heldOf(doc, c.id)})`])], detail: v ? [descOf(data.consumables, v)] : null });
    }
  }
  const stones = data.runes.filter((r) => heldOf(doc, `rune:${r.id}`) > 0 && stoneFits(doc, data, choice, r.id));
  if (stones.length && levelEffect(doc, data, 'smithy', 'runeCrafting')) rows.push({ key: 'rune', label: 'Rune stone', kind: 'choice', value: choice.rune, choices: [['', 'None'], ...stones.map((r) => [r.id, `${r.name} (${heldOf(doc, `rune:${r.id}`)})`])], detail: choice.rune ? [descOf(data.runes, choice.rune), `Placed in the ${weaponName(firstWeapon(doc, data, choice))} at 0:00`] : null });
  return rows;
}

/** What a mode means, as a label. */
function modeText(data, mode) {
  if (mode === 'challenge') return 'A set character and rules; each won once';
  const last = Math.max(0, ...data.maps[0].timeline.events.filter((e) => e.event === 'boss').map((e) => e.at));
  const R = data.tuning.run;
  if (mode === 'short') return `Last boss at ${clock(last * R.shortTimeScale)}, ${Math.round(R.shortRewardMul * 100)}% Materials`;
  return `Last boss at ${clock(last)}`;
}

const clock = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;

/** The choice with one row's new value. */
export function applyRow(choice, key, value) {
  const c = { ...choice, curses: [...choice.curses], consumables: [...choice.consumables] };
  if (key.startsWith('curse:')) {
    const id = key.slice(6);
    c.curses = value ? [...new Set([...c.curses, id])] : c.curses.filter((x) => x !== id);
  } else if (key.startsWith('slot:')) {
    const k = Number(key.slice(5));
    while (c.consumables.length <= k) c.consumables.push('');
    c.consumables[k] = value;
  } else c[key] = value;
  // (A slot left empty keeps its place: setting the second slot never moves its pick to the first.)
  while (c.consumables.length && !c.consumables.at(-1)) c.consumables.pop();
  return c;
}

/**
 * The choice held to what the profile allows after a change: a challenge one that can set out,
 * and no rune stone the run's first weapon can't take (a new kit or a challenge changes it).
 */
export function settleChoice(doc, data, choice) {
  const c = { ...choice, curses: [...choice.curses], consumables: [...choice.consumables] };
  if (c.mode === 'challenge' && !challengesOpen(doc, data).some((x) => x.id === c.challenge)) c.challenge = challengesOpen(doc, data)[0]?.id ?? '';
  if (c.rune && !stoneFits(doc, data, c, c.rune)) c.rune = '';
  return c;
}

/** The choice as runConfigFor takes it (empty values dropped). */
export function choiceForRun(choice) {
  const out = { character: choice.character, mode: choice.mode };
  if (choice.mode === 'challenge') out.challenge = choice.challenge;
  else { if (choice.kit) out.kit = choice.kit; out.tide = choice.tide; out.curses = choice.curses; }
  if (choice.arcana) out.arcana = choice.arcana;
  const cons = choice.consumables.filter(Boolean);
  if (cons.length) out.consumables = cons;
  if (choice.rune) out.rune = choice.rune;
  return out;
}

/** What the choice adds to the materials a run brings home ("+36% Materials"; a challenge run's own Tide and curses), or null. */
export function rewardText(data, choice) {
  const ch = choice.mode === 'challenge' ? data.challenges.find((c) => c.id === choice.challenge) : null;
  const tide = ch ? ch.tide ?? 0 : choice.tide, curses = ch ? ch.curses || [] : choice.curses;
  const t = tide > 0 ? data.tides[tide - 1].rewardMul : 0;
  const c = curses.reduce((s, id) => s + (data.curses.find((x) => x.id === id)?.rewardMul ?? 0), 0);
  const pct = Math.round((t + c) * 100);
  return pct > 0 ? `+${pct}% Materials` : null;
}

/** The modes the gate offers: a challenge run only while one can set out. */
function modesFor(doc, data) {
  const open = challengesOpen(doc, data).length > 0;
  return modesOpen(doc, data).filter((m) => m !== 'challenge' || open);
}
