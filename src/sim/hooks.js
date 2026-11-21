// The hook registry (ARCHITECTURE §5.12): character mechanics and relic rules as small
// functions. Data names a hook id plus parameters; this file is the only place hook code lives,
// and the content test checks every hook named in data exists here.
//
// Hook points: onTick, onLevelUp, onKill, onBossKill, onHit, onGemCollect, onHeal, onHurt (a hit taken, with what got past armor and shields, 0 when
// a shield took it all), onChestOpen, modifyStats. There is no onDash (ruling 16: the dash is an
// escape and nothing else; tests/content.test.js fails on a hook that reads it). Hooks run in the order they were added (the
// character first, then gear's, and relics in the order picked up), so a run replays
// the same way every time. Every hook is
// deterministic and uses only sim APIs; `state` is the hook's own scratch space for the run,
// holding numbers only (the world's state hash covers it).

import { DT, TPS, RELIC_SLOT, EF, EF_GONE, MAX_WEAPON_SLOTS, ZSTYLE } from './constants.js';
import { EV, STATUS } from './events.js';
import { CHARACTER_HOOKS } from './hooks-characters.js';

export const HOOK_POINTS = Object.freeze(['onTick', 'onLevelUp', 'onKill', 'onBossKill', 'onHit', 'onGemCollect', 'onHeal', 'onHurt', 'onChestOpen', 'modifyStats']);

// Each hook lists the numeric params it `needs` (the content test checks data supplies them),
// and may have an `init` that runs once when it joins the run, and an `undo` that takes back what
// `init` did to the world (a relic given to the Salt Well: sim/build.js removeRelic). Every hook
// whose init changes the world has an undo (the content test checks).

// Late-bound sim functions (set by world.js) so hooks can act without import cycles.
export const api = {
  explodeAt: null,      // (world, slot, x, y, radius, damage, knockback, excludeEnemy)
  groundAt: null,       // (world, slot, x, y, radius, life, damage, interval, list) -> zone or -1
  compileList: null,    // (world, effects) -> an on-hit list's index
  evolveOne: null,      // (world, source) -> -1 (0.9.0: nothing evolves; kept for hooks that still ask)
  collectEmber: null,   // (world, x, y): an Ember gained (sim/ascend.js), the Form choice if one can take it
  markStatsDirty: null, // (world)
  queryEnemies: null,   // (world, x, y, r, out) -> count
  impulse: null,        // (world, e, dx, dy, strength)
  impulseR: null,       // (world, e) with world.scratch.num[1..3] = dx, dy, strength (per-hit hooks)
  midAttack: null,      // (E, e) -> true while it winds up, aims, or charges (can't be held)
  heal: null,           // (world, amount)
  damageEnemyR: null,   // (world, e, slot, crit) with world.scratch.num[0] = the amount
};

export const HOOKS = {
  // ---------------------------------------------------------------- the characters (ruling 14 D, 15, 16: C2)
  // Their hooks live in sim/hooks-characters.js and join the registry here.
  ...CHARACTER_HOOKS,

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

  // Reaper's Wake: kills made while you stand still drop more experience.
  still_double_xp: {
    needs: ['mul'],
    onKill(world, h) {
      const p = world.player;
      if (!p.moving && p.dashTicks <= 0) world.killXpMul *= h.params.mul;
    },
  },

  // Seventh Bell: every Nth level-up gives an Ember (0.9.0: it evolved a ready weapon, and the
  // evolutions are gone). Its price (-10% XP) is the relic's own modifier.
  ember_every: {
    needs: ['every'],
    onLevelUp(world, h) {
      h.state.count = (h.state.count || 0) + 1;
      if (h.state.count % h.params.every === 0) api.collectEmber(world, world.player.x, world.player.y);
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
      // Never into the last quarter of the zone pool (0.8.1: every 2nd kill at a crowded pace, the
      // pace dials turned up, would fill it and leave the weapons' own pools no room).
      if (world.zones.count >= (world.zones.capacity * 3) >> 2) return;
      const E = world.enemies, P = h.params;
      api.groundAt(world, RELIC_SLOT, E.x[e], E.y[e], P.radius, P.duration, P.damage, P.interval, h.state.list);
    },
  },

  // Spark Flint: every so often while you keep moving, a burst of sparks where you stand.
  walk_burst: {
    needs: ['damage', 'radius', 'knockback', 'every'],
    init(world, h) { h.state.next = 0; },
    onTick(world, h) {
      const p = world.player;
      if (world.tick < h.state.next || p.moveT < 0.5) return;
      h.state.next = world.tick + Math.round(h.params.every * TPS);
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

  // Bloodied Hook (W4, Nov 17: was kills in a window): while enough enemies are close, more damage.
  // Counted every 6 ticks; the stats are rebuilt only when it turns on or off.
  crowd_fury: {
    needs: ['count', 'radius', 'damage'],
    init(world, h) { h.state.on = 0; },
    onTick(world, h) {
      if (world.tick % 6 !== 0) return;
      const p = world.player, on = api.queryEnemies(world, p.x, p.y, h.params.radius, world.scratch.near) >= h.params.count ? 1 : 0;
      if (on !== h.state.on) { h.state.on = on; api.markStatsDirty(world); }
    },
    modifyStats(world, h, mods) {
      if (h.state.on === 1) mods.push({ stat: 'might', op: 'pct', value: h.params.damage });
    },
  },

  // Wreck Lantern (W4, Nov 17: was every 2nd kill): on its own clock, burning oil under the nearest enemy.
  timed_pool: {
    needs: ['every', 'radius', 'duration', 'damage', 'interval', 'dps', 'burn', 'reach'],
    init(world, h) {
      h.state.next = 0;
      h.state.list = api.compileList(world, [{ type: 'damage' }, { type: 'status', status: 'burn', dps: h.params.dps, duration: h.params.burn }]);
    },
    onTick(world, h) {
      if (world.tick < h.state.next) return;
      const p = world.player, E = world.enemies, P = h.params;
      const e = world.enemyHash.nearest(p.x, p.y, P.reach, E.flags, EF_GONE, -1);
      if (e < 0) return;
      h.state.next = world.tick + Math.round(P.every * TPS);
      api.groundAt(world, RELIC_SLOT, E.x[e], E.y[e], P.radius, P.duration, P.damage, P.interval, h.state.list);
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
  // Oil Wake: walking leaves burning oil, a pool every `every` seconds while you keep moving, on
  // the oil's own burn list (compiled once, at join).
  walk_trail: {
    needs: ['radius', 'duration', 'damage', 'interval', 'dps', 'burn', 'every'],
    init(world, h) {
      h.state.next = 0;
      h.state.list = api.compileList(world, [{ type: 'damage' }, { type: 'status', status: 'burn', dps: h.params.dps, duration: h.params.burn }]);
    },
    onTick(world, h) {
      const p = world.player, P = h.params;
      if (world.tick < h.state.next || p.moveT < 0.3) return;
      h.state.next = world.tick + Math.round(P.every * TPS);
      api.groundAt(world, RELIC_SLOT, p.x, p.y, P.radius, P.duration, P.damage, P.interval, h.state.list);
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

  // Moon Pull and Long Beam (relics; they were arcana before the sweep's ruling 11): every so often,
  // every gem on the map flies to you (as the magnet does).
  gem_vacuum: {
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

  // Brine: kills by Sea weapons heal, up to a cap a second.
  sea_heal: {
    needs: ['heal', 'perSecond'],
    onKill(world, h, e) {
      const s = world.enemies.killer[e];
      const slot = s >= 0 ? world.slots[s] : null;
      if (!slot || !slot.def || !(slot.def.tags || []).includes('sea')) return;
      const sec = Math.floor(world.tick / 60);
      if (sec !== h.state.sec) { h.state.sec = sec; h.state.n = 0; }
      if (h.state.n >= h.params.perSecond) return;
      h.state.n++;
      api.heal(world, h.params.heal);
    },
  },

  // Kindling: elites drop Embers more often, and bosses drop more (sim/enemies.js, sim/bosses.js).
  ember_luck: {
    needs: ['eliteMul', 'bossExtra'],
    init(world, h) { world.emberEliteMul = h.params.eliteMul; world.emberBossExtra = h.params.bossExtra; },
    undo(world) { world.emberEliteMul = 1; world.emberBossExtra = 0; },
  },

  // Glassblower: relics are offered tiers better (sim/relics.js drawRelics).
  relic_tier: {
    needs: ['tiers'],
    init(world, h) { world.relicTierBonus += h.params.tiers; },
    undo(world, h) { world.relicTierBonus -= h.params.tiers; },
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

  // ---------------------------------------------------------------- the Salt Marsh (0.8.0)

  // Brine Vat: slows add together up to `cap`; held there `holdSec`, an enemy turns to salt for
  // `saltSec` (it can't move or hurt you), then crumbles (sim/enemies.js).
  brine_vat: {
    needs: ['cap', 'holdSec', 'saltSec'],
    init(world, h) { world.slowStack = h.params.cap; world.saltAfter = h.params.holdSec; world.saltSec = h.params.saltSec; },
    // Given to the Well: its salt ends (salted enemies walk again, nothing crumbles), and the slows
    // it stacked end with it (the next slow lands as it would without the Vat).
    undo(world) {
      world.slowStack = 0; world.saltAfter = 1; world.saltSec = 4;
      const E = world.enemies;
      for (let i = 0; i < E.count; i++) {
        E.saltT[i] = 0; E.saltHold[i] = 0;
        if (E.slowT[i] > 0) { E.slowT[i] = 0; E.slowPct[i] = 0; }
      }
    },
  },

  // Quench Bucket: a Sea or Frost hit on a burning enemy puts it out, and the burn left lands at
  // once on it and what touches it (sim/holds.js quench).
  quench_bucket: {
    needs: ['mul', 'reach'],
    init(world, h) { world.quench = { mul: h.params.mul, reach: h.params.reach }; },
    undo(world) { world.quench = null; },
  },

  // Cold Iron: a Steel kill on a slowed or frozen enemy shatters it into shards that slow (sim/holds.js shatterAt).
  cold_iron: {
    needs: ['count', 'damage', 'slow'],
    init(world, h) {
      world.coldIron = { count: h.params.count, damage: h.params.damage, list: api.compileList(world, [{ type: 'damage' }, { type: 'status', status: 'slow', pct: h.params.slow, duration: 1.5 }]) };
    },
    undo(world) { world.coldIron = null; },
  },

  // Watchman's Rattle: `count` enemies close by for `sec` s and every weapon fires at once; it
  // won't sound again until the crowd near you drops under `reset`.
  watchmans_rattle: {
    needs: ['count', 'sec', 'reset', 'radius'],
    init(world, h) { h.state.held = 0; h.state.armed = 1; },
    onTick(world, h) {
      if (world.tick % 6 !== 0) return;
      const p = world.player, n = api.queryEnemies(world, p.x, p.y, h.params.radius, world.scratch.near);
      if (h.state.armed === 0) { if (n < h.params.reset) h.state.armed = 1; return; }
      if (n < h.params.count) { h.state.held = 0; return; }
      h.state.held += 0.1;
      if (h.state.held + 1e-9 < h.params.sec) return;
      h.state.held = 0; h.state.armed = 0;
      for (let s = 0; s < MAX_WEAPON_SLOTS; s++) { const sl = world.slots[s]; if (sl && sl.cd > 0) sl.cd = 0; }
      world.events.push(EV.RATTLE, p.x, p.y);
    },
  },

  // Sea Urchin: an enemy that hits you takes `mul` times your Armor (world.hurtBy: sim/enemies.js contactStep).
  sea_urchin: {
    needs: ['mul'],
    onHurt(world, h) {
      const e = world.hurtBy;
      if (e < 0 || (world.enemies.flags[e] & EF_GONE) !== 0) return;
      const dmg = h.params.mul * (world.stats.armor + world.player.bonusArmor);
      if (!(dmg > 0)) return;
      world.scratch.num[0] = dmg;
      api.damageEnemyR(world, e, RELIC_SLOT, false);
    },
  },

  // Try-Pot: after a skip, the next level-up offers only what you own, and the pick gains
  // `levels` levels (sim/draft.js). It never locks the draft: with nothing owned to offer, the
  // offer is the usual one.
  try_pot: {
    needs: ['levels'],
    // (X4: a pot swapped out and bought back comes back as it left, armed or not: world.tryPotArmed.)
    init(world, h) { world.tryPot = { levels: h.params.levels, armed: world.tryPotArmed ? 1 : 0 }; },
    undo(world) { world.tryPotArmed = world.tryPot !== null && world.tryPot.armed === 1; world.tryPot = null; },
  },

  // Bog Torc: once a run, instead of dying you sink into the peat for `sinkSec` s, untouchable and
  // still; what touches you rots; then you rise at `riseHp` of your health (sim/player.js).
  bog_torc: {
    needs: ['sinkSec', 'riseHp', 'rotSec', 'rotAmp', 'radius'],
    // (S1 and X4: "once a run" is kept on the world, world.torcSpent, so a spent Torc swapped out at a
    // Reliquary and bought back from the Ferryman comes back spent.)
    init(world, h) { world.torc = { ready: world.torcSpent ? 0 : 1, sinkUntil: -1, params: h.params }; },
    undo(world) { world.torc = null; },
    onTick(world, h) {
      const T = world.torc;
      if (T === null || T.sinkUntil < 0) return;
      const p = world.player;
      if (world.tick >= T.sinkUntil) {
        T.sinkUntil = -1;
        p.hp = world.stats.maxHp * h.params.riseHp;
        p.iframes = Math.max(p.iframes, Math.round(0.5 * TPS));
        world.events.push(EV.SINK, p.x, p.y, 0);
        return;
      }
      if (world.tick % 15 !== 0) return;
      const E = world.enemies, near = world.scratch.near;
      const n = api.queryEnemies(world, p.x, p.y, h.params.radius, near);
      for (let k = 0; k < n; k++) {
        const e = near[k];
        if ((E.flags[e] & EF_GONE) !== 0) continue;
        if (E.rotT[e] < h.params.rotSec) E.rotT[e] = h.params.rotSec;
        if (E.rotAmp[e] < h.params.rotAmp) E.rotAmp[e] = h.params.rotAmp;
      }
    },
  },
};

export function createHookLists() {
  const lists = {};
  for (const p of HOOK_POINTS) lists[p] = [];
  return lists;
}

/** Add a hook (a character mechanic, a relic, a gear rule) to a run. Throws on an unknown id. */
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

/**
 * Take a hook entry back out of the run (a relic given to the Salt Well): off every hook point,
 * out of the state hash's list, and its `undo` run, so the run is as it would be without it.
 */
export function removeHook(world, entry) {
  const k = world.hookEntries.indexOf(entry);
  if (k < 0) return;
  world.hookEntries.splice(k, 1);
  for (const point of HOOK_POINTS) {
    const list = world.hooks[point];
    for (let i = list.length - 1; i >= 0; i--) if (list[i].h === entry) list.splice(i, 1);
  }
  const def = HOOKS[entry.id];
  if (def.undo) def.undo(world, entry);
  if (def.modifyStats) api.markStatsDirty(world);
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
