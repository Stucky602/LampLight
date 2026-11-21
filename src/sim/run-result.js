// RunResult (ARCHITECTURE §5.15): everything the meta layer needs from a finished run, rich
// enough to evaluate every feat without replaying anything.

import { tradeResult } from './trades.js';
import { DT, HIT_SLOTS } from './constants.js';
import { EV, END } from './events.js';
import { runLedger } from './tasks.js';

export const RESULT_VERSION = 1;
const END_NAMES = { [END.DIED]: 'died', [END.LEFT]: 'left', [END.CLEARED]: 'cleared' };

/** Accumulators the systems write to during a run. */
export function createResultState(enemyCount, materialCount) {
  const weaponLevels = new Map(); // weapon id -> highest level reached
  return {
    killsByType: new Uint32Array(enemyCount),
    totalKills: 0,
    elitesKilled: 0,
    bossesKilled: [],          // { id, tick, weapons: [ids, most damage first] }
    damageBySlot: new Float64Array(HIT_SLOTS),
    realBySlot: new Float64Array(HIT_SLOTS),   // health each slot took off enemies (no overkill; C1 Nov 17)
    damageTaken: 0,
    dashKills: 0,
    revivalsUsed: 0,
    gems: 0,
    chests: 0,
    maxLevel: 1,
    evolutions: [],            // (0.9.0: nothing evolves; kept empty for meta and old readers)
    relics: [],
    runes: [],                 // (always empty since ruling 14: runes are gone; kept so an old reader finds a list)
    specials: [],              // Legendary specials taken: { weapon, id, tick }
    dashes: [],                // dash items taken in place of the one held (ruling 16): { id, tick }
    embersSpent: 0,            // Embers spent (to open an axis early, or to switch an option)
    banished: [],
    rerolls: 0,
    skips: 0,
    materialsRaw: new Float64Array(materialCount),
    overtimeMinutes: 0,
    cleared: false,
    secrets: [],
    embers: 0,       // Embers picked up
    // Phase 7: the run's tasks, Sea Glass, relics found, and the first hit taken.
    lampsLit: 0, bellsRung: 0, lanternNight: false,
    lampsMost: 0, nights: 0, ferryTrades: 0,   // 0.8.2: the most lamps lit at once, Lantern Nights, trades opened (the ledger)
    glassEarned: 0, glassMax: 0, reliquaries: 0, ferryBought: 0,
    firstHurtTick: -1,
    ascensions: [],  // { weapon, id, tick }: Embers spent
    // 0.9.0 (builds): Form progress steps taken, relics swapped out (the slots full), skips paid.
    formSteps: 0, relicSwaps: [], skipGifts: 0,
    // Ruling 10 (W1b): weapon upgrades taken, and how many at each rarity (Common ... Legendary).
    weaponUps: 0, upRolls: [0, 0, 0, 0, 0],
    // The Salt Marsh (0.8.0): burning enemies a Sea or Frost hit found (the Quencher feat), the
    // longest seconds among a crowd (the Watchman), the relic given to the Salt Well, what the run
    // met for the first time (the field guide), thralls raised, Try-Pot levels, herbs picked.
    quenched: 0, crowdSec: 0, wellGiven: null, sighted: [], thralls: 0, tryPotLevels: 0,
    // The run's arc and the maps (0.9.0, W4): the highest act reached, the map events that came,
    // the small finds found, cranes and cairns used, whether the Long Night fell and the dawn came,
    // and the dawn chest's items.
    act: 1, mapEvents: [], finds: [], works: 0, heldLamps: 0, longNight: false, dawn: false, dawnItems: null,
    weaponLevels,
    noteWeaponLevel(id, level) {
      if (!(weaponLevels.get(id) >= level)) weaponLevels.set(id, level);
    },
  };
}

/** End the run (death, leaving, or leaving after the last boss). Idempotent. */
export function endRun(world, reason) {
  if (world.over) return;
  world.over = { reason, tick: world.tick };
  world.halts.length = 0; // nothing left to decide
  world.events.push(EV.RUN_END, world.player.x, world.player.y, reason);
}

/** Leave from the pause menu (a recorded decision). After the last boss this counts as cleared. */
export function leaveRun(world) {
  endRun(world, world.director.finalBossDead ? END.CLEARED : END.LEFT);
}

/**
 * What a run's materials are multiplied by on the way home: the harbor's pace (run.materialMul),
 * a short run's share, and a Tide's or curses' reward. The pause menu's "Materials found" uses it
 * too, so it shows what will come home.
 */
export function haulMul(world) {
  return world.tuning.run.materialMul * (world.config.mode === 'short' ? world.tuning.run.shortRewardMul : 1) * (world.config.rewardMul ?? 1);
}

/** The RunResult for a finished (or abandoned) run: plain data, safe to save. */
export function buildRunResult(world) {
  const r = world.result;
  const kills = {};
  world.enemyDefs.forEach((def, i) => { if (r.killsByType[i] > 0) kills[def.id] = r.killsByType[i]; });
  // Materials: greed already counted at pickup; haulMul scales the rest.
  const mul = haulMul(world);
  const materials = {};
  world.materialDefs.forEach((m, i) => {
    const v = Math.floor(r.materialsRaw[i] * mul + 1e-9);
    if (v > 0) materials[m.id] = v;
  });
  const weapons = [];
  for (let s = 0; s < world.slots.length; s++) {
    const slot = world.slots[s];
    if (!slot || !slot.def) continue;
    weapons.push({ id: slot.def.id, slot: s, level: slot.level, runes: [], lines: slot.lines.slice(), specials: slot.specials.slice(), forms: slot.ascensions.map((a) => a.id), deed: slot.deed, damage: Math.round(r.damageBySlot[s]), real: Math.round(r.realBySlot ? r.realBySlot[s] : 0) });
  }
  const tags = {};
  for (let s = 0; s < world.build.weaponSlots; s++) {
    const slot = world.slots[s];
    if (slot) for (const t of slot.def.tags || []) tags[t] = (tags[t] || 0) + 1;
  }
  for (const ps of world.build.passives) for (const t of ps.def.tags || []) tags[t] = (tags[t] || 0) + 1;
  let maxWeaponLevel = 0;
  for (const lv of r.weaponLevels.values()) if (lv > maxWeaponLevel) maxWeaponLevel = lv;
  const end = world.over ? world.over.reason : END.LEFT;
  return {
    v: RESULT_VERSION,
    seed: world.config.seed,
    map: world.map.id,
    mode: world.config.mode || 'standard',
    character: world.character.id,
    end: END_NAMES[end],
    timeSurvived: Math.round((world.over ? world.over.tick : world.tick) * DT * 100) / 100,
    ticks: world.over ? world.over.tick : world.tick,
    level: world.player.level,
    kills, totalKills: r.totalKills, elitesKilled: r.elitesKilled,
    bossesKilled: r.bossesKilled.map((b) => ({ id: b.id, time: Math.round(b.tick * DT), weapons: b.weapons })),
    cleared: r.cleared,
    weapons,
    weaponLevelMax: Object.fromEntries(r.weaponLevels),
    maxWeaponLevel,
    passives: world.build.passives.map((p) => ({ id: p.def.id, level: p.level })),
    relics: r.relics.slice(),
    runes: [],
    specials: r.specials.map((x) => ({ ...x })), embersSpent: r.embersSpent,
    dash: world.dash ? { id: world.dash.def.id, ups: world.dash.ups.map((u) => u.up), swaps: r.dashes.length } : null,
    evolutions: r.evolutions.map((e) => e.into),
    tags,
    materials,
    damageTaken: Math.round(r.damageTaken),
    dashKills: r.dashKills,
    revivalsUsed: r.revivalsUsed,
    gems: r.gems,
    chests: r.chests,
    overtimeMinutes: r.overtimeMinutes,
    secretsFound: r.secrets.slice(),
    embers: r.embers,
    ascensions: r.ascensions.map((a) => ({ ...a })),
    formSteps: r.formSteps, relicSwaps: r.relicSwaps.slice(),
    weaponUps: r.weaponUps, upRolls: r.upRolls.slice(),
    // The capstones taken (a Form line's payoff), by weapon.
    capstones: r.ascensions.filter((a) => a.capstone).map((a) => a.weapon),
    // The most Forms on one weapon.
    maxForms: world.slots.reduce((m, s) => (s && s.ascensions ? Math.max(m, s.ascensions.length) : m), 0),
    lampsLit: r.lampsLit, bellsRung: r.bellsRung, lanternNight: r.lanternNight,
    seaGlass: world.glass, seaGlassEarned: r.glassEarned, seaGlassMax: r.glassMax,
    reliquaries: r.reliquaries, ferryBought: r.ferryBought,
    // The map's ledger (0.8.2, idea 10): the run against what the map holds (sim/tasks.js runLedger).
    ledger: runLedger(world), lanternNights: r.nights, ferryTrades: r.ferryTrades,
    // Seconds before the first hit taken (the whole run when none was).
    untouchedSec: Math.round((r.firstHurtTick >= 0 ? r.firstHurtTick : (world.over ? world.over.tick : world.tick)) * DT),
    // What the run was played as (from the RunConfig): the meta layer's feats and challenges read these.
    tide: world.config.tide ?? 0, curses: (world.config.curses || []).slice(), heirloom: world.config.heirloom ?? null,
    challenge: world.config.challenge ?? null, kit: world.config.startWeapon ?? null,
    rerolls: r.rerolls, skips: r.skips, banished: r.banished.slice(),
    // The Salt Marsh (0.8.0): the Quencher's and the Watchman's numbers, the Salt Well's relic
    // (the Ferryman's Well slot, B5), first sightings (the field guide), thralls raised, the Try-Pot's levels, herbs, the run's layers.
    quenched: r.quenched, crowdSec: r.crowdSec, wellGiven: r.wellGiven, sighted: r.sighted.slice(),
    // Ruling 14 (C2): what her dead dealt (their own row), and what the character's trade did (sim/trades.js tradeResult).
    thrallDamage: Math.round(world.allies ? world.allies.dealt : 0), trade: tradeResult(world),
    thralls: r.thralls, tryPotLevels: r.tryPotLevels, herbsPicked: world.marsh ? world.marsh.herbsPicked : 0,
    layers: { ...world.layers },
    // W4 (0.9.0; work/veteran/W4-NOTES.md): act 1..3, mapEvents and finds as ids, dawn true when the Long Night was won.
    // (dawn is never true beside a death: from the dawn on nothing hurts you, sim/acts.js; the check here keeps old replays honest.)
    act: r.act, mapEvents: r.mapEvents.slice(), finds: r.finds.slice(), works: r.works, longNight: r.longNight, dawn: r.dawn === true && end !== END.DIED,
    dawnItems: r.dawnItems ? r.dawnItems.map((it) => ({ ...it })) : null,
    // The tuning panel or its dev commands were used in this run (the save is marked, §15).
    devTools: world.decisions.some((d) => d.kind === 'dev' || d.kind === 'tune'),
  };
}
