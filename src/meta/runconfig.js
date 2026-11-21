// The RunConfig for a run from the harbor (ARCHITECTURE §10.2 steps 1 and 2). Pure; tested in
// Node. The sim checks what it gets (world.js).
//
// From the profile: the pools (what research, the buildings, feats, and challenges have added),
// the Lamp Post's upgrades, worn gear, the character's skill tree, and what the harbor adds to a
// run's tasks (the Ferryman, the lamps, the bells) and its trophies' bonus. From the gate's choices
// (each checked against what the profile has opened): the kit, the mode, the Tide, curses, an
// Heirloom (a relic found before, carried from 0:00 in a relic slot), run tools; or a
// set run started from the Harbor Orders board (mode 'challenge': it sets its own character, map,
// Tide, and curses, empties the pools it names, and takes no Heirloom and no run tools). A character
// who can't heal (the Tide Priest) gets no food drops, no heal-only relics in the pool, and can't be
// sent out with a heal-only Heirloom.
//
// 0.8.0, the Salt Marsh: the map (only one that's open; a challenge plays on its own), the map's
// layers (what of it the profile has opened: MAP_LAYERS), its own Tides, and the relics given to
// the Salt Well (the Ferryman's Well slot, on every map).

import { runSkills } from './skills.js';
import { resolveContent, heirloomOpen, heirloomChoices, orderPosted, slotsFor, rankOf, levelEffect, cursesAvailable, heldOf, mapOpen, mapMissing, killsOf, tidesOpened, wellRelics, isUnlocked, mapEventsOpen, contentOpen } from './state.js';
import { MetaError, writable, levelFor, mapNeedsText } from './actions.js';
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
    // (The Lighthouse's stages 1 and 8 add to the Lamp Post's and the Chapel's.)
    lampSpeed: levelEffect(doc, data, 'lamp_post', 'lampSpeed') + levelEffect(doc, data, 'lighthouse', 'lampSpeedAdd'),
    bellRing: levelEffect(doc, data, 'chapel', 'bellRing') + levelEffect(doc, data, 'lighthouse', 'bellRingAdd'),
    tasksOnMap: levelEffect(doc, data, 'cartographer', 'tasksOnMap'),
    // The Cartographer's level 2 marks a map's small secrets; its last marks the big ones too.
    findsOnMap: Math.max(levelEffect(doc, data, 'cartographer', 'findsOnMap'), levelEffect(doc, data, 'cartographer', 'secretsOnMap')),
    secretsOnMap: levelEffect(doc, data, 'cartographer', 'secretsOnMap'),
    // The Apothecary's healing side: food heals this share more.
    foodHeal: levelEffect(doc, data, 'apothecary', 'foodHeal'),
  };
}

/** The modes the gate offers: a full run, and a short run once the Cartographer opens it. (A set run starts from the board.) */
export function modesOpen(doc, data) {
  const out = ['standard'];
  if (levelEffect(doc, data, 'cartographer', 'shortRuns')) out.push('short');
  return out;
}

const nameOf = (list, id) => list.find((x) => x.id === id)?.name ?? id;

/** Gear's rule affixes that are a stat the run starts with (data/gear.js; added once however many pieces carry one). */
const GEAR_RULE_STATS = Object.freeze(['revival', 'reroll', 'banish', 'skip', 'armor']);

/**
 * The hooks that only change healing (sim/hooks.js): a shield from heals, a heal from kills. For a
 * character who can't heal, a relic that does nothing else is useless.
 */
export const HEAL_HOOKS = Object.freeze(['heal_to_shield', 'sea_heal']);

/** Does this thing (a relic, a run tool) do nothing but heal: a heal hook, or only HP Regen? */
export function healOnly(x) {
  if (!x) return false;
  if (x.hook) return HEAL_HOOKS.includes(x.hook);
  // (A run tool that only makes food heal more: the Herb Salve.)
  if (x.start && Object.keys(x.start).every((k) => k === 'foodHeal') && !(x.mods || []).length) return true;
  const mods = x.mods || [];
  return mods.length > 0 && !x.start && mods.every((m) => m.stat === 'regen' && m.value > 0);
}

/**
 * Why a character who can't heal can't take this relic as an Heirloom ("The Tide Priest can't heal:
 * Brine would do nothing."), or null. The gate leaves those out (app/setup.js); this is the
 * same rule for a choice that asks anyway.
 */
export function noHealRefusal(data, character, x) {
  const c = data.characters.find((y) => y.id === character);
  return c?.noHeal && healOnly(x) ? `The ${c.name} can't heal: ${x.name} would do nothing.` : null;
}

/**
 * What opens each of a map's layers (RunConfig.layers; docs/design/SALT_MARSH_BUILD.md), any one
 * key enough: 'boss:<id>' that boss killed on any run (the bestiary counts it), 'tide:<map>:<n>'
 * that many Tides opened on that map, 'building:<id>:<n>' that building's level. (Two Tide key
 * styles, on purpose: 'tide:<map>:<n>' here reads one map's ladder, tidesOpened; 'tide:<n>' in
 * state.js `reached`, for the harbor's props and keepers' lines, reads the highest on any map,
 * highestTide.) On the Salt
 * Marsh: the storm once the Old Grey has died, the Salt Well after its first clear (its Tide 1),
 * and the secret at its Tide 2 or the Cartographer's level 5. A map without `layers` sends none.
 */
export const MAP_LAYERS = Object.freeze({
  salt_marsh: Object.freeze({
    storm: Object.freeze(['boss:old_grey']),
    well: Object.freeze(['tide:salt_marsh:1']),
    secret: Object.freeze(['tide:salt_marsh:2', 'building:cartographer:5']),
  }),
});

/** Is one of MAP_LAYERS' keys met? */
export function layerKeyMet(doc, data, key) {
  const t = /^tide:([a-z0-9_]+):(\d+)$/.exec(key);
  if (t) return tidesOpened(doc, t[1]) >= Number(t[2]);
  const b = /^boss:([a-z0-9_]+)$/.exec(key);
  if (b) return killsOf(doc, b[1]) > 0;
  return isUnlocked(doc, data, key);
}

/** A map's layers for this profile: { storm, well, secret } as true or false, or null for a map without any. */
export function layersFor(doc, data, mapId) {
  const m = data.maps.find((x) => x.id === mapId);
  if (!m?.layers?.length) return null;
  const rules = MAP_LAYERS[mapId] || {};
  return Object.fromEntries(m.layers.map((k) => [k, (rules[k] || []).some((key) => layerKeyMet(doc, data, key))]));
}

/**
 * choice: { character, seed, map?, mode?, kit?, tide?, curses?, heirloom?, consumables?,
 * challenge? }. Throws MetaError, with the reason, for anything the profile can't choose yet.
 */
export function runConfigFor(doc, data, choice) {
  const { seed, mode = 'standard' } = choice;
  const content = resolveContent(doc, data);
  if (mode !== 'challenge' && !modesOpen(doc, data).includes(mode)) throw new MetaError('Short runs open at the Cartographer.');
  // A set run (started from the board) sets who sets out, its Tide, and curses of its own, and plays on its own map.
  const ch = mode === 'challenge' ? (data.challenges || []).find((c) => c.id === choice.challenge) : null;
  if (mode === 'challenge' && !ch) throw new MetaError('Choose a challenge run on the Harbor Orders board.');
  if (ch && !orderPosted(doc, data, data.feats.find((f) => f.id === ch.id))) throw new MetaError(`${ch.name} isn't posted on the board yet.`);
  const map = ch ? (ch.map ?? data.maps[0].id) : (choice.map || data.maps[0].id);
  const M = data.maps.find((m) => m.id === map);
  if (!M) throw new MetaError(`There is no map called "${map}".`);
  if (!mapOpen(doc, data, map)) throw new MetaError(`The ${M.name} isn't open yet.${mapMissing(doc, data, map).length ? ` ${mapNeedsText(data, map, mapMissing(doc, data, map))}` : ''}`);
  const character = ch ? ch.character : choice.character;
  if (!content.characters.includes(character)) {
    const c = data.characters.find((x) => x.id === character);
    throw new MetaError(c ? `${c.name} hasn't arrived in the harbor yet.` : `There is no character called "${character}".`);
  }
  // The kit: the character's own, or the other once mastery opens it (a challenge uses the own).
  const kit = !ch && choice.kit ? kitsOf(doc, data, character).find((k) => k.id === choice.kit) : null;
  if (choice.kit && !ch && (!kit || !kit.open)) throw new MetaError('That starting weapon opens at a higher mastery rank.');
  // The Tide and curses.
  const tide = ch ? (ch.tide ?? 0) : (choice.tide ?? 0);
  if (!Number.isInteger(tide) || tide < 0) throw new MetaError('A Tide is a whole number, 0 or more.');
  if (!ch && tide > 0) {
    // What this map has opened first (its own ladder), then the Chapel's cap (every map alike).
    const opened = tidesOpened(doc, map);
    if (tide > data.tides.length) throw new MetaError(`There is no Tide ${tide}.`);
    if (tide > opened) {
      const step = opened > 0 ? `Clear the ${M.name} at Tide ${opened}` : `Clear the ${M.name}`;
      throw new MetaError(`Tide ${tide} isn't open on the ${M.name} yet. ${tide === opened + 1 ? `${step} first.` : `${step} to open Tide ${opened + 1}.`}`);
    }
    if (tide > levelEffect(doc, data, 'chapel', 'tideMax')) {
      const lv = levelFor(data, 'chapel', 'tideMax', tide);
      throw new MetaError(lv ? `Tide ${tide} needs the ${nameOf(data.buildings, 'chapel')} at Lv ${lv}.` : `Tide ${tide} is not in this version.`);
    }
  }
  const T = tide > 0 ? data.tides[tide - 1] : null;
  const curseIds = ch ? [...new Set([...(ch.curses || [])])] : [...new Set(choice.curses || [])];
  const open = new Set(cursesAvailable(doc, data).map((c) => c.id));
  for (const id of curseIds) if (!ch && !open.has(id)) throw new MetaError(`The ${nameOf(data.curses, id)} curse isn't open yet.`);
  const curses = curseIds.map((id) => data.curses.find((c) => c.id === id));
  // The Heirloom and run tools. (A set run takes none: its rules are set.)
  const heirloom = ch ? null : (choice.heirloom || null);
  if (heirloom) {
    if (!heirloomOpen(doc, data)) throw new MetaError(`An Heirloom needs the ${nameOf(data.buildings, 'tavern')} at Lv ${levelFor(data, 'tavern', 'heirloom', 1)}.`);
    if (!heirloomChoices(doc, data).includes(heirloom)) throw new MetaError(`${nameOf(data.relics, heirloom)} hasn't been found in a run yet.`);
    const why = noHealRefusal(data, character, data.relics.find((r) => r.id === heirloom));
    if (why) throw new MetaError(why);
  }
  const cons = ch ? [] : [...new Set(choice.consumables || [])];
  if (cons.length > consumableSlots(doc, data)) throw new MetaError(`Only ${consumableSlots(doc, data)} run ${consumableSlots(doc, data) === 1 ? 'tool' : 'tools'} can go into a run.`);
  for (const id of cons) if (heldOf(doc, id) < 1) throw new MetaError(`You have no ${nameOf(data.consumables, id)}.`);
  for (const id of cons) { const why = noHealRefusal(data, character, data.consumables.find((c) => c.id === id)); if (why) throw new MetaError(why); }

  const gear = gearForRun(doc, data);
  const used = cons.map((id) => data.consumables.find((c) => c.id === id));
  const mods = [
    ...upgradeMods(doc, data),
    ...gear.mods,
    // Gear's rules that are a number the run starts with (a Revival, a reroll, a banish, a skip).
    ...GEAR_RULE_STATS.filter((k) => gear.config[k]).map((k) => ({ stat: k, op: 'add', value: gear.config[k] })),
    // (Ruling 16: gear no longer touches the dash; the old -10% Dash Cooldown rule is +5% Move Speed.)
    ...(gear.config.moveSpeed ? [{ stat: 'moveSpeed', op: 'pct', value: gear.config.moveSpeed }] : []),
    ...used.flatMap((c) => c.mods || []),
    ...curses.flatMap((c) => c.mods || []),
  ];
  const mul = (k) => (T ? T[k] : 1) * curses.reduce((m, c) => m * (c[k] ?? 1), 1);
  // A character who can't heal (data/characters.js noHeal: the Tide Priest) is never offered a relic
  // that only changes healing (the sweep, A5).
  const who = data.characters.find((c) => c.id === character);
  const noHeal = !!who?.noHeal;
  const relicPool = noHeal ? content.relics.filter((id) => !healOnly(data.relics.find((r) => r.id === id))) : content.relics;
  const pools = { weapons: content.weapons, passives: content.passives, relics: relicPool };
  for (const p of ch?.pools || []) pools[p] = [];
  const cfg = {
    seed, map, mode: ch ? 'standard' : mode, character,
    pools,
    mods,
    hpMul: mul('hpMul'), densityMul: mul('densityMul'), enemyDamageMul: mul('damageMul'), enemySpeedMul: mul('speedMul'),
    rewardMul: 1 + (T ? T.rewardMul : 0) + curses.reduce((s, c) => s + c.rewardMul, 0) + curses.length * (gear.config.cursePay ?? 0),
    harbor: { ...harborForRun(doc, data), ...(gear.config.lampSpeed ? { lampSpeed: harborForRun(doc, data).lampSpeed + gear.config.lampSpeed } : {}) },
    tide, curses: curseIds,
  };
  // The run's slots and the capstones opened (0.9.0, rulings 1, 3, and 4).
  const slots = slotsFor(doc, data);
  cfg.weaponSlots = slots.weapons; cfg.passiveSlots = slots.passives; cfg.relicSlots = slots.relics;
  cfg.forms = content.forms;
  // No food drops under the Hunger curse, nor for a character who can't heal (it would do nothing).
  if (curses.some((c) => c.noFood) || noHeal) cfg.noFood = true;
  if (noHeal) cfg.noHeal = true;
  // What a run tool or gear puts in hand at 0:00: Pearls, Embers.
  const glass = used.reduce((s, c) => s + (c.start?.seaGlass ?? 0), 0) + (gear.config.startGlass ?? 0);
  if (glass > 0) cfg.startGlass = glass;
  const embers = used.reduce((s, c) => s + (c.start?.embers ?? 0), 0);
  if (embers > 0) cfg.startEmbers = embers;
  const salve = used.reduce((s, c) => s + (c.start?.foodHeal ?? 0), 0);
  if (salve > 0) cfg.harbor = { ...cfg.harbor, foodHeal: (cfg.harbor.foodHeal ?? 0) + salve };
  // The Heirloom: a relic carried from 0:00, in a relic slot (sim/world.js `relics`; `heirloom` is for the result).
  if (heirloom) { cfg.relics = [heirloom]; cfg.heirloom = heirloom; }
  // Tempering (the Smithy's Lv 4): the weapon you set out with starts with one of its Rare lines.
  if (!ch && levelEffect(doc, data, 'smithy', 'tempering')) cfg.tempered = true;
  if (kit && kit.id) cfg.startWeapon = kit.start;
  // A weapon's orders (C3, ruling 18 P1; data/orders-weapons.js): the weapon you set out with,
  // tempered once its capstone order is done; every weapon whose mastery order is done brings its
  // first Legendary early.
  const startId = ch ? data.characters.find((c) => c.id === character)?.start : (kit?.start ?? data.characters.find((c) => c.id === character)?.start);
  const perks = (data.weaponPerks || []).filter((x) => contentOpen(doc, data, x.unlock));
  if (!ch && startId && perks.some((x) => x.kind === 'temper' && x.weapon === startId)) cfg.tempered = true;
  const early = perks.filter((x) => x.kind === 'early').map((x) => x.weapon);
  if (early.length) cfg.legendaryEarly = early;
  if (ch) cfg.challenge = ch.id;
  // The character's skill tree as it stands (ruling 15, meta/skills.js): { id: its numbers }.
  const skills = runSkills(doc, data, character);
  if (skills) cfg.skills = skills;
  // The map's layers (the Salt Marsh's storm, well, and secret), as the profile has opened them.
  const layers = layersFor(doc, data, map);
  if (layers) cfg.layers = layers;
  // The map's event deck as the profile has opened it (0.9.0, W4 and W5: orders open entries).
  const events = mapEventsOpen(doc, data, map);
  if (events) cfg.mapEvents = events;
  // Relics given to the Salt Well: the Ferryman offers them in a Well slot, on every map (those the
  // run's pools still hold: a challenge that empties the relics empties this too).
  const well = wellRelics(doc, data).filter((id) => pools.relics.includes(id));
  if (well.length) cfg.wellRelics = well;
  const bonus = bestiaryBonus(doc, data);
  if (Object.keys(bonus).length) cfg.bestiaryBonus = bonus;
  // Gear's rule affixes: a fourth card, capstones that need less. (The Spyglass adds a card too.)
  const moreCards = (gear.config.draftCards ?? 0) + used.reduce((s, c) => s + (c.start?.draftCards ?? 0), 0);
  if (moreCards) cfg.draftCards = Math.min(6, data.tuning.draft.cards + moreCards);
  if (gear.config.evolutionPassiveReduction) cfg.evolutionPassiveReduction = gear.config.evolutionPassiveReduction;
  if (gear.hooks.length) cfg.gearHooks = gear.hooks;
  return cfg;
}

/**
 * The profile as the run starts: the run tools it takes are used up, and the
 * gate's choices are kept for next time. (The app saves this before the run begins, so quitting
 * mid-run doesn't hand them back.)
 */
export function startRunProfile(doc, data, choice) {
  const out = writable(doc, ['consumables', 'setup']);
  for (const id of new Set(choice.mode === 'challenge' ? [] : (choice.consumables || []))) {
    const n = heldOf(out, id) - 1;
    if (n > 0) out.profile.consumables[id] = n; else delete out.profile.consumables[id];
  }
  const lastMap = doc?.profile?.setup?.map;
  out.profile.setup = {
    // (A set run starts from the board: the gate's last character, kit, and mode stay.)
    character: choice.mode === 'challenge' ? (doc?.profile?.setup?.character ?? '') : (choice.character ?? ''), kit: choice.mode === 'challenge' ? (doc?.profile?.setup?.kit ?? '') : (choice.kit ?? ''),
    mode: choice.mode === 'challenge' ? (doc?.profile?.setup?.mode === 'short' ? 'short' : 'standard') : (choice.mode ?? 'standard'),
    curses: choice.mode === 'challenge' ? [...(doc?.profile?.setup?.curses || [])] : [...(choice.curses || [])],
    heirloom: choice.mode === 'challenge' ? (doc?.profile?.setup?.heirloom ?? '') : (choice.heirloom ?? ''), consumables: [], rune: '', challenge: '',
    // A challenge plays on its own map: the map last chosen stays.
    map: choice.mode === 'challenge' ? (typeof lastMap === 'string' ? lastMap : '') : (choice.map ?? ''),
  };
  // A challenge run's Tide is the challenge's, not a choice: the last one chosen stays. (Save v4:
  // `tide` holds only the last one chosen; what's opened is per map, in `tides`.)
  const was = out.profile.tide && typeof out.profile.tide === 'object' ? out.profile.tide : { selected: 0 };
  out.profile.tide = { selected: choice.mode === 'challenge' ? (was.selected ?? 0) : (choice.tide ?? 0) };
  return out;
}

// The map's unlock keys in plain words live with the other refusals (meta/actions.js), which the
// harbor's costs and research use too; they're named here as well, where the gate's callers look.
export { mapNeedsText, mapKeysText } from './actions.js';
