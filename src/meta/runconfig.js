// The RunConfig for a run from the harbor (ARCHITECTURE §10.2 steps 1 and 2). Pure; tested in
// Node. The sim checks what it gets (world.js).
//
// From the profile: the pools (what research, the buildings, feats, and challenges have added),
// the Lamp Post's upgrades, worn gear, the character's trained perks, and what the harbor adds to a
// run's tasks (the Ferryman, the lamps, the bells) and its bestiary bonus. From the gate's choices
// (each checked against what the profile has opened): the kit, the mode, the Tide, curses, an
// arcana, consumables, a rune stone, or a challenge run (which sets its own character, Tide, and
// curses, and empties the pools it names).

import { resolveContent, rankOf, levelEffect, tideAvailable, cursesAvailable, perksOf, heldOf } from './state.js';
import { MetaError, writable } from './actions.js';
import { gearForRun, consumableSlots, bestiaryBonus, kitsOf } from './workshop.js';

/** Every bought upgrade rank as modifiers: one rank's mods times the rank. */
export function upgradeMods(doc, data) {
  const mods = [];
  for (const u of data.upgrades) {
    const r = Math.min(rankOf(doc, u.id), u.ranks);
    if (r > 0) for (const m of u.mods) mods.push({ ...m, value: m.value * r });
  }
  return mods;
}

/** What the harbor's buildings add to a run's tasks, the Ferryman, and the minimap (sim/world.js `harbor`). */
export function harborForRun(doc, data) {
  return {
    ferry: levelEffect(doc, data, 'docks', 'ferry'),
    lampSpeed: levelEffect(doc, data, 'lamp_post', 'lampSpeed'),
    bellRing: levelEffect(doc, data, 'chapel', 'bellRing'),
    tasksOnMap: levelEffect(doc, data, 'cartographer', 'tasksOnMap'),
    secretsOnMap: levelEffect(doc, data, 'cartographer', 'secretsOnMap'),
  };
}

/** Can short runs and challenge runs be chosen? (the Cartographer's level) */
export function modesOpen(doc, data) {
  const out = ['standard'];
  if (levelEffect(doc, data, 'cartographer', 'shortRuns')) out.push('short');
  if (levelEffect(doc, data, 'cartographer', 'challenges')) out.push('challenge');
  return out;
}

const nameOf = (list, id) => list.find((x) => x.id === id)?.name ?? id;

/**
 * choice: { character, seed, map?, mode?, kit?, tide?, curses?, arcana?, consumables?, rune?,
 * challenge? }. Throws MetaError, with the reason, for anything the profile can't choose yet.
 */
export function runConfigFor(doc, data, choice) {
  const { seed, map = data.maps[0].id, mode = 'standard' } = choice;
  const content = resolveContent(doc, data);
  if (!modesOpen(doc, data).includes(mode)) throw new MetaError(mode === 'short' ? 'Short runs open at the Cartographer.' : 'Challenge runs open at the Cartographer.');
  // A challenge run sets who sets out, its Tide, and curses of its own.
  const ch = mode === 'challenge' ? (data.challenges || []).find((c) => c.id === choice.challenge) : null;
  if (mode === 'challenge' && !ch) throw new MetaError('Choose a challenge.');
  const character = ch ? ch.character : choice.character;
  if (!content.characters.includes(character)) {
    const c = data.characters.find((x) => x.id === character);
    throw new MetaError(c ? `${c.name} hasn't arrived in the harbor yet.` : `There is no character called "${character}".`);
  }
  // The kit: the character's own, or the other once mastery opens it (a challenge uses the own).
  const kit = !ch && choice.kit ? kitsOf(doc, data, character).find((k) => k.id === choice.kit) : null;
  if (choice.kit && !ch && (!kit || !kit.open)) throw new MetaError('That kit opens with more mastery.');
  // The Tide and curses.
  const tide = ch ? (ch.tide ?? 0) : (choice.tide ?? 0);
  if (!Number.isInteger(tide) || tide < 0) throw new MetaError('A Tide is a whole number, 0 or more.');
  if (!ch && tide > tideAvailable(doc, data)) throw new MetaError(`Tide ${tide} isn't open yet.`);
  const T = tide > 0 ? data.tides[tide - 1] : null;
  const curseIds = ch ? [...new Set([...(ch.curses || [])])] : [...new Set(choice.curses || [])];
  const open = new Set(cursesAvailable(doc, data).map((c) => c.id));
  for (const id of curseIds) if (!ch && !open.has(id)) throw new MetaError(`The ${nameOf(data.curses, id)} curse isn't open yet.`);
  const curses = curseIds.map((id) => data.curses.find((c) => c.id === id));
  // The arcana, consumables, and a rune stone.
  if (choice.arcana && !content.arcana.includes(choice.arcana)) throw new MetaError(`${nameOf(data.arcana, choice.arcana)} isn't open yet.`);
  const cons = [...new Set(choice.consumables || [])];
  if (cons.length > consumableSlots(doc, data)) throw new MetaError(`Only ${consumableSlots(doc, data)} consumables can go into a run.`);
  for (const id of cons) if (heldOf(doc, id) < 1) throw new MetaError(`No ${nameOf(data.consumables, id)} held.`);
  if (choice.rune && heldOf(doc, `rune:${choice.rune}`) < 1) throw new MetaError(`No ${nameOf(data.runes, choice.rune)} stone held.`);

  const gear = gearForRun(doc, data);
  const perks = data.perks.filter((p) => p.character === character && perksOf(doc, character).has(p.id));
  const used = cons.map((id) => data.consumables.find((c) => c.id === id));
  const mods = [
    ...upgradeMods(doc, data),
    ...gear.mods,
    ...perks.flatMap((p) => p.mods),
    ...used.flatMap((c) => c.mods || []),
    ...curses.flatMap((c) => c.mods || []),
  ];
  const mul = (k) => (T ? T[k] : 1) * curses.reduce((m, c) => m * (c[k] ?? 1), 1);
  const pools = { weapons: content.weapons, passives: content.passives, relics: content.relics, runes: content.runes };
  for (const p of ch?.pools || []) pools[p] = [];
  const cfg = {
    seed, map, mode: ch ? 'standard' : mode, character,
    pools,
    mods,
    hpMul: mul('hpMul'), densityMul: mul('densityMul'), enemyDamageMul: mul('damageMul'), enemySpeedMul: mul('speedMul'),
    rewardMul: 1 + (T ? T.rewardMul : 0) + curses.reduce((s, c) => s + c.rewardMul, 0),
    harbor: harborForRun(doc, data),
    tide, curses: curseIds,
  };
  if (curses.some((c) => c.noFood)) cfg.noFood = true;
  const glass = used.reduce((s, c) => s + (c.start?.seaGlass ?? 0), 0);
  if (glass > 0) cfg.startGlass = glass;
  if (choice.arcana) cfg.arcana = choice.arcana;
  if (choice.rune) cfg.startRune = choice.rune;
  if (kit && kit.id) cfg.startWeapon = kit.start;
  if (ch) cfg.challenge = ch.id;
  const bonus = bestiaryBonus(doc, data);
  if (Object.keys(bonus).length) cfg.bestiaryBonus = bonus;
  // Gear's rule affixes: a fourth card, evolutions that need less.
  if (gear.config.draftCards) cfg.draftCards = data.tuning.draft.cards + gear.config.draftCards;
  if (gear.config.evolutionPassiveReduction) cfg.evolutionPassiveReduction = gear.config.evolutionPassiveReduction;
  if (gear.hooks.length) cfg.gearHooks = gear.hooks;
  return cfg;
}

/**
 * The profile as the run starts: the consumables and the rune stone it takes are used up, and the
 * gate's choices are kept for next time. (The app saves this before the run begins, so quitting
 * mid-run doesn't hand them back.)
 */
export function startRunProfile(doc, data, choice) {
  const out = writable(doc, ['consumables', 'setup']);
  for (const id of new Set(choice.consumables || [])) {
    const n = heldOf(out, id) - 1;
    if (n > 0) out.profile.consumables[id] = n; else delete out.profile.consumables[id];
  }
  if (choice.rune) {
    const key = `rune:${choice.rune}`, n = heldOf(out, key) - 1;
    if (n > 0) out.profile.consumables[key] = n; else delete out.profile.consumables[key];
  }
  out.profile.setup = {
    character: choice.character ?? '', kit: choice.kit ?? '', mode: choice.mode ?? 'standard',
    curses: choice.mode === 'challenge' ? [...(doc?.profile?.setup?.curses || [])] : [...(choice.curses || [])],
    arcana: choice.arcana ?? '', consumables: [], rune: '', challenge: choice.challenge ?? '',
  };
  // A challenge run's Tide is the challenge's, not a choice: the last one chosen stays.
  const was = out.profile.tide && typeof out.profile.tide === 'object' ? out.profile.tide : { unlocked: 0, selected: 0 };
  out.profile.tide = { ...was, selected: choice.mode === 'challenge' ? (was.selected ?? 0) : (choice.tide ?? 0) };
  return out;
}

