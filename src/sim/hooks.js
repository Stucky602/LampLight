// The hook registry (ARCHITECTURE §5.12): character mechanics and relic rules as small
// functions. Data names a hook id plus parameters; this file is the only place hook code lives,
// and the content test checks every hook named in data exists here.
//
// Hook points: onTick, onLevelUp, onKill, onBossKill, onHit, onGemCollect, onHeal, onDash,
// onChestOpen, modifyStats. Hooks run in the order they were added (the character first, then
// relics in the order picked up), so a run replays the same way every time. Every hook is
// deterministic and uses only sim APIs; `state` is the hook's own scratch space for the run,
// holding numbers only (the world's state hash covers it).

import { DT, RELIC_SLOT, EF } from './constants.js';
import { EV } from './events.js';

export const HOOK_POINTS = Object.freeze(['onTick', 'onLevelUp', 'onKill', 'onBossKill', 'onHit', 'onGemCollect', 'onHeal', 'onDash', 'onChestOpen', 'modifyStats']);

// Each hook lists the numeric params it `needs` (the content test checks data supplies them),
// and may have an `init` that runs once when it joins the run.

// Late-bound sim functions (set by world.js) so hooks can act without import cycles.
export const api = {
  explodeAt: null,      // (world, slot, x, y, radius, damage, knockback, excludeEnemy)
  evolveOne: null,      // (world, source) -> slot index evolved or -1
  markStatsDirty: null, // (world)
  queryEnemies: null,   // (world, x, y, r, out) -> count
  impulse: null,        // (world, e, dx, dy, strength)
  impulseR: null,       // (world, e) with world.scratch.num[1..3] = dx, dy, strength (per-hit hooks)
  midAttack: null,      // (E, e) -> true while it winds up, aims, or charges (can't be held)
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
