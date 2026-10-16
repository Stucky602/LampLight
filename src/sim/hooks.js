// The hook registry (ARCHITECTURE §5.12): character mechanics and relic rules as small
// functions. Data names a hook id plus parameters; this file is the only place hook code lives,
// and the content test checks every hook named in data exists here.
//
// Hook points: onTick, onLevelUp, onKill, onBossKill, onHit, onGemCollect, onHeal, onDash (after
// the tick's enemy grid is built), onHurt (a hit taken, with what got past armor and shields, 0 when
// a shield took it all), onChestOpen, modifyStats. Hooks run in the order they were added (the
// character first, then gear's, an arcana's, and relics in the order picked up), so a run replays
// the same way every time. Every hook is
// deterministic and uses only sim APIs; `state` is the hook's own scratch space for the run,
// holding numbers only (the world's state hash covers it).

import { DT, RELIC_SLOT, EF } from './constants.js';
import { EV } from './events.js';

export const HOOK_POINTS = Object.freeze(['onTick', 'onLevelUp', 'onKill', 'onBossKill', 'onHit', 'onGemCollect', 'onHeal', 'onDash', 'onHurt', 'onChestOpen', 'modifyStats']);

// Each hook lists the numeric params it `needs` (the content test checks data supplies them),
// and may have an `init` that runs once when it joins the run.

// Late-bound sim functions (set by world.js) so hooks can act without import cycles.
export const api = {
  explodeAt: null,      // (world, slot, x, y, radius, damage, knockback, excludeEnemy)
  groundAt: null,       // (world, slot, x, y, radius, life, damage, interval, list) -> zone or -1
  compileList: null,    // (world, effects) -> an on-hit list's index
  evolveOne: null,      // (world, source) -> slot index evolved or -1
  markStatsDirty: null, // (world)
  queryEnemies: null,   // (world, x, y, r, out) -> count
  impulse: null,        // (world, e, dx, dy, strength)
  impulseR: null,       // (world, e) with world.scratch.num[1..3] = dx, dy, strength (per-hit hooks)
  midAttack: null,      // (E, e) -> true while it winds up, aims, or charges (can't be held)
  heal: null,           // (world, amount)
};

export const HOOKS = {
  // The Lamplighter: her innate light radius grows (and burns a little harder) with her level.
  lamplighter: {
    needs: ['areaPerLevel', 'damagePerLevel'],
    modifyStats(world, h, mods) {
      const lv = world.player.level - 1;
      if (lv <= 0) return;
      mods.push({ stat: 'area', op: 'pct', value: h.params.areaPerLevel * lv, weapon: 'lamplight' });
      mods.push({ stat: 'might', op: 'pct', value: h.params.damagePerLevel * lv, weapon: 'lamplight' });
    },
    onLevelUp(world) { api.markStatsDirty(world); },
  },

  // The Harpooner: her weapons drag enemies toward her (their knockback pulls instead of
  // pushing, plus an extra tug) and leave them dazed for a moment, so what she reels in arrives
  // unable to hurt her; and each enemy close by adds armor. (Kevin asked for a way to offset her
  // pulling the crowd onto herself. A bonus for standing still was tried first and dropped: in
  // the bot trials no standing-still version beat plain kiting, even with armor, healing, or
  // extra damage for it, and this game gives too many reasons to move (tools/bots/
  // harpooner-trials.mjs). Dazing what she reels in fixed the fault itself.)
  // The daze never stacks past `daze`, bosses shrug it off, and an enemy in the middle of a warned
  // attack isn't dazed (its attack lands when its warning said it would).
  harpooner: {
    needs: ['armorPerNear', 'nearRadius', 'cap', 'pull', 'daze'],
    init(world) { world.knockbackPulls = true; },
    onTick(world, h) {
      if (world.tick % 6 !== 0) return; // ten times a second is plenty
      const p = world.player;
      const n = api.queryEnemies(world, p.x, p.y, h.params.nearRadius, world.scratch.near);
      p.bonusArmor = Math.min(h.params.cap, n * h.params.armorPerNear);
    },
    onHit(world, h, e, slot) {
      if (slot >= RELIC_SLOT) return;
      const E = world.enemies, p = world.player;
      const dx = p.x - E.x[e], dy = p.y - E.y[e];
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d <= 1) return;
      // Every hit runs this: numbers go through the register, not arguments (§17).
      const num = world.scratch.num;
      num[1] = dx / d; num[2] = dy / d; num[3] = h.params.pull;
      api.impulseR(world, e);
      if ((E.flags[e] & EF.BOSS) === 0 && !api.midAttack(E, e) && E.dazeT[e] < h.params.daze) E.dazeT[e] = h.params.daze;
    },
  },

  // Volatile Gems: collecting experience sets off a small blast around you.
  gem_explode: {
    needs: ['damage', 'radius', 'every'],
    onGemCollect(world, h) {
      const now = world.tick * DT;
      if (now - (h.state.last ?? -1e9) < h.params.every) return;
      h.state.last = now;
      const p = world.player;
      api.explodeAt(world, RELIC_SLOT, p.x, p.y, h.params.radius, h.params.damage, 0.6, -1);
    },
  },

  // Glass Lantern: healing becomes a shield instead (capped at a fraction of max HP).
  heal_to_shield: {
    needs: ['capFraction'],
    onHeal(world, h, amount) {
      const p = world.player;
      const cap = world.stats.maxHp * h.params.capFraction;
      p.shield = Math.min(cap, p.shield + amount);
      return 0;
    },
  },

  // Reaper's Wake: kills made while dashing drop more experience.
  dash_double_xp: {
    needs: ['mul'],
    onKill(world, h) {
      if (world.player.dashTicks > 0) world.killXpMul *= h.params.mul;
    },
  },

  // Seventh Bell: every Nth level-up checks for an evolution, no chest needed.
  free_evolution_every: {
    needs: ['every'],
    onLevelUp(world, h) {
      h.state.count = (h.state.count || 0) + 1;
      if (h.state.count % h.params.every === 0) api.evolveOne(world, 'relic');
    },
  },

  // Wreck Lantern (the Drowned Docks' secret): every Nth kill leaves burning oil where it fell,
  // which burns what walks through it. The burn on the oil's own list (compiled once, at join).
  kill_fire_pool: {
    needs: ['every', 'radius', 'duration', 'damage', 'interval', 'dps', 'burn'],
    init(world, h) {
      h.state.count = 0;
      h.state.list = api.compileList(world, [{ type: 'damage' }, { type: 'status', status: 'burn', dps: h.params.dps, duration: h.params.burn }]);
    },
    onKill(world, h, e) {
      h.state.count++;
      if (h.state.count % h.params.every !== 0) return;
      const E = world.enemies, P = h.params;
      api.groundAt(world, RELIC_SLOT, E.x[e], E.y[e], P.radius, P.duration, P.damage, P.interval, h.state.list);
    },
  },

  // Spark Flint: a dash starts with a burst of sparks where you stood.
  dash_burst: {
    needs: ['damage', 'radius', 'knockback'],
    onDash(world, h) {
      const p = world.player;
      api.explodeAt(world, RELIC_SLOT, p.x, p.y, h.params.radius, h.params.damage, h.params.knockback, -1);
    },
  },

  // Barnacle Shell: a hit taken sends a wave out, once per cooldown.
  hurt_wave: {
    needs: ['radius', 'damage', 'knockback', 'cooldown'],
    onHurt(world, h) {
      const now = world.tick * DT;
      if (now - (h.state.last ?? -1e9) < h.params.cooldown) return;
      h.state.last = now;
      const p = world.player;
      api.explodeAt(world, RELIC_SLOT, p.x, p.y, h.params.radius, h.params.damage, h.params.knockback, -1);
      world.events.push(EV.WAVE, p.x, p.y, h.params.radius);
    },
  },

  // Bloodied Hook: enough kills in a short time and your damage rises for a while. The kills are
  // counted in 8 buckets across the window (numbers only, so the state hash covers them).
  streak_fury: {
    needs: ['kills', 'within', 'damage', 'duration'],
    init(world, h) { for (let k = 0; k < 8; k++) h.state[`b${k}`] = 0; h.state.at = 0; h.state.until = -1; },
    onTick(world, h) {
      const step = Math.max(1, Math.round((h.params.within * 60) / 8));
      const at = Math.floor(world.tick / step) % 8;
      if (at !== h.state.at) { h.state.at = at; h.state[`b${at}`] = 0; }
      if (h.state.until >= 0 && world.tick >= h.state.until) { h.state.until = -1; api.markStatsDirty(world); }
    },
    onKill(world, h) {
      h.state[`b${h.state.at}`]++;
      if (h.state.until >= 0) return;
      let n = 0;
      for (let k = 0; k < 8; k++) n += h.state[`b${k}`];
      if (n < h.params.kills) return;
      h.state.until = world.tick + Math.round(h.params.duration * 60);
      for (let k = 0; k < 8; k++) h.state[`b${k}`] = 0;
      api.markStatsDirty(world);
    },
    modifyStats(world, h, mods) {
      if (h.state.until >= 0) mods.push({ stat: 'might', op: 'pct', value: h.params.damage });
    },
  },

  // Drowned Bell: every Nth kill, a toll hits everything near you.
  kill_toll: {
    needs: ['every', 'radius', 'damage', 'knockback'],
    init(world, h) { h.state.count = 0; },
    onKill(world, h) {
      h.state.count++;
      if (h.state.count % h.params.every !== 0) return;
      const p = world.player;
      api.explodeAt(world, RELIC_SLOT, p.x, p.y, h.params.radius, h.params.damage, h.params.knockback, -1);
      world.events.push(EV.WAVE, p.x, p.y, h.params.radius);
    },
  },

  // Gear (data/gear.js): affixes that change the rules, their numbers grown with the item's tier.
  // Oil Wake: a dash leaves burning oil along its path (a pool where it starts, then one every
  // `every` ticks while it lasts), on the oil's own burn list (compiled once, at join).
  dash_trail: {
    needs: ['radius', 'duration', 'damage', 'interval', 'dps', 'burn', 'every'],
    init(world, h) {
      h.state.next = -1;
      h.state.list = api.compileList(world, [{ type: 'damage' }, { type: 'status', status: 'burn', dps: h.params.dps, duration: h.params.burn }]);
    },
    onDash(world, h) {
      const p = world.player, P = h.params;
      api.groundAt(world, RELIC_SLOT, p.x, p.y, P.radius, P.duration, P.damage, P.interval, h.state.list);
      h.state.next = world.tick + P.every;
    },
    onTick(world, h) {
      const p = world.player, P = h.params;
      if (h.state.next < 0 || world.tick < h.state.next) return;
      if (p.dashTicks <= 0) { h.state.next = -1; return; }
      api.groundAt(world, RELIC_SLOT, p.x, p.y, P.radius, P.duration, P.damage, P.interval, h.state.list);
      h.state.next = world.tick + P.every;
    },
  },

  // Tide Pulse: a level-up sends a wave out from you.
  level_pulse: {
    needs: ['radius', 'damage', 'knockback'],
    onLevelUp(world, h) {
      const p = world.player;
      api.explodeAt(world, RELIC_SLOT, p.x, p.y, h.params.radius, h.params.damage, h.params.knockback, -1);
      world.events.push(EV.WAVE, p.x, p.y, h.params.radius);
    },
  },

  // Arcana (data/arcana.js): one chosen at the gate.
  // High Water: every so often, every gem on the map flies to you (as the magnet does).
  arcana_vacuum: {
    needs: ['every'],
    onTick(world, h) {
      h.state.t = (h.state.t || 0) + DT;
      if (h.state.t < h.params.every) return;
      h.state.t -= h.params.every;
      world.magnetAll = world.tuning.xp.magnetItemPull;
      const p = world.player;
      world.events.push(EV.WAVE, p.x, p.y, 40);
    },
  },

  // Brine: kills by Tide weapons heal, up to a cap a second.
  arcana_tide_heal: {
    needs: ['heal', 'perSecond'],
    onKill(world, h, e) {
      const s = world.enemies.killer[e];
      const slot = s >= 0 ? world.slots[s] : null;
      if (!slot || !slot.def || !(slot.def.tags || []).includes('tide')) return;
      const sec = Math.floor(world.tick / 60);
      if (sec !== h.state.sec) { h.state.sec = sec; h.state.n = 0; }
      if (h.state.n >= h.params.perSecond) return;
      h.state.n++;
      api.heal(world, h.params.heal);
    },
  },

  // Kindling: elites drop Embers more often, and bosses drop more (sim/enemies.js, sim/bosses.js).
  arcana_embers: {
    needs: ['eliteMul', 'bossExtra'],
    init(world, h) { world.emberEliteMul = h.params.eliteMul; world.emberBossExtra = h.params.bossExtra; },
  },

  // Glassblower: relics are offered tiers better (sim/relics.js drawRelics).
  arcana_relic_tier: {
    needs: ['tiers'],
    init(world, h) { world.relicTierBonus += h.params.tiers; },
  },

  // Tide Clock: every so often, a wave shoves back everything near you.
  timed_wave: {
    needs: ['every', 'radius', 'damage', 'knockback'],
    onTick(world, h) {
      h.state.t = (h.state.t || 0) + DT;
      if (h.state.t < h.params.every) return;
      h.state.t -= h.params.every;
      const p = world.player;
      api.explodeAt(world, RELIC_SLOT, p.x, p.y, h.params.radius, h.params.damage, h.params.knockback, -1);
      world.events.push(EV.WAVE, p.x, p.y, h.params.radius);
    },
  },
};

export function createHookLists() {
  const lists = {};
  for (const p of HOOK_POINTS) lists[p] = [];
  return lists;
}

/** Add a hook (a character mechanic, a relic, an arcana) to a run. Throws on an unknown id. */
export function addHook(world, id, params = {}, source = '') {
  const def = HOOKS[id];
  if (!def) throw new Error(`Unknown hook "${id}" (from ${source || 'data'})`);
  const entry = { id, params, state: {}, source };
  world.hookEntries.push(entry);
  if (def.init) def.init(world, entry); // once, when the hook joins the run
  for (const point of HOOK_POINTS) {
    const fn = def[point];
    if (fn) world.hooks[point].push({ fn, h: entry });
  }
  if (def.modifyStats) api.markStatsDirty(world);
  return entry;
}

/** Run every hook at a point. */
export function runHooks(world, point, a, b, c) {
  const list = world.hooks[point];
  for (let i = 0; i < list.length; i++) list[i].fn(world, list[i].h, a, b, c);
}

/** Healing passes through onHeal hooks, each of which returns what remains as healing. */
export function filterHeal(world, amount) {
  const list = world.hooks.onHeal;
  let v = amount;
  for (let i = 0; i < list.length && v > 0; i++) v = list[i].fn(world, list[i].h, v);
  return v;
}
