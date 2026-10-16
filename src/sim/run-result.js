// RunResult (ARCHITECTURE §5.15): everything the meta layer needs from a finished run, rich
// enough to evaluate every feat without replaying anything.

import { DT, HIT_SLOTS } from './constants.js';
import { EV, END } from './events.js';

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
    damageTaken: 0,
    dashKills: 0,
    revivalsUsed: 0,
    gems: 0,
    chests: 0,
    maxLevel: 1,
    evolutions: [],            // { from, into, source, tick }
    relics: [],
    runes: [],                 // { weapon, rune }
    banished: [],
    rerolls: 0,
    skips: 0,
    materialsRaw: new Float64Array(materialCount),
    overtimeMinutes: 0,
    cleared: false,
    secrets: [],
    embers: 0,       // Embers picked up
    ascensions: [],  // { weapon, id, tick }: Embers spent
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

/** The RunResult for a finished (or abandoned) run: plain data, safe to save. */
export function buildRunResult(world) {
  const r = world.result;
  const kills = {};
  world.enemyDefs.forEach((def, i) => { if (r.killsByType[i] > 0) kills[def.id] = r.killsByType[i]; });
  // Materials: greed already counted at pickup; short runs and challenge rewards scale the haul.
  const mul = (world.config.mode === 'short' ? world.tuning.run.shortRewardMul : 1) * (world.config.rewardMul ?? 1);
  const materials = {};
  world.materialDefs.forEach((m, i) => {
    const v = Math.floor(r.materialsRaw[i] * mul + 1e-9);
    if (v > 0) materials[m.id] = v;
  });
  const weapons = [];
  for (let s = 0; s < world.slots.length; s++) {
    const slot = world.slots[s];
    if (!slot || !slot.def) continue;
    weapons.push({ id: slot.def.id, slot: s, level: slot.level, runes: slot.runes.filter(Boolean).map((x) => x.id), damage: Math.round(r.damageBySlot[s]) });
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
    runes: r.runes.slice(),
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
    rerolls: r.rerolls, skips: r.skips, banished: r.banished.slice(),
    // The tuning panel or its dev commands were used in this run (the save is marked, §15).
    devTools: world.decisions.some((d) => d.kind === 'dev' || d.kind === 'tune'),
  };
}
