// Live tuning and dev commands (ARCHITECTURE §15), as logged decisions.
//
// The tuning panel and the dev commands change a run while it is being played. Each change is a
// decision (world.js decide()), logged with its tick like a draft pick, so a replay of a run
// that was tuned or cheated mid-way still plays back exactly. Nothing here runs unless a person
// asks for it from the panel.
//
//   { kind: 'tune', path: 'enemies.separation', value: 0.4 }
//   { kind: 'tune', path: 'character.harpooner.daze', value: 0.3 }   the run's character's own numbers
//   { kind: 'dev', cmd: 'spawn', count: 2000, enemy?: 'drowned_sailor' }
//   { kind: 'dev', cmd: 'jump', to: 590 }            seconds; forward only; skips the events between
//   { kind: 'dev', cmd: 'give', what: 'weapon' | 'passive' | 'relic' | 'rune', id }
//   { kind: 'dev', cmd: 'level', count?: 1 }
//   { kind: 'dev', cmd: 'god', on: true | false }
//   { kind: 'dev', cmd: 'heal' }
//   { kind: 'dev', cmd: 'clear' }                    kills nothing: removes every regular enemy
//   { kind: 'dev', cmd: 'chest', boss?: true }        opens a chest where you stand (the reel)

import { HIT_RING, TPS, EF } from './constants.js';
import { spawnEnemy } from './enemies.js';
import { applyCard } from './draft.js';
import { openSocketsFor, openChest, CHEST_BOSS, CHEST_ELITE } from './chests.js';
import { addRelic, markStatsDirty } from './build.js';
import { xpToNext } from './player.js';
import { TAU, sincosInto } from '../lib/fmath.js';

const MAX_SPAWN = 4096;

/** The value at a dotted path in a tuning object, or undefined. */
export function tuningAt(tuning, path) {
  let o = tuning;
  for (const k of String(path).split('.')) {
    if (o === null || typeof o !== 'object' || !Object.prototype.hasOwnProperty.call(o, k)) return undefined;
    o = o[k];
  }
  return o;
}

/**
 * Why this tuning change can't be made (a sentence), or null if it can. Only values that are
 * already in the tuning can change, and only to the same shape: a finite number for a number,
 * a list of finite numbers of the same length for a list.
 */
export function checkTune(tuning, path, value) {
  if (typeof path !== 'string' || !path) return 'a tuning change needs a path like "enemies.separation"';
  const cur = tuningAt(tuning, path);
  if (cur === undefined) return `there is no tuning value "${path}"`;
  if (typeof cur === 'number') {
    if (!Number.isFinite(value)) return `${path} should be a number`;
    if (path === 'caps.weapon.maxPierce' && !(value <= HIT_RING)) return `${path} can be at most ${HIT_RING} (what a shot can remember)`;
    return null;
  }
  if (Array.isArray(cur)) {
    const flat = (a) => (Array.isArray(a) ? a.flat(2) : null);
    const want = flat(cur), got = flat(value);
    if (!got || got.length !== want.length || !got.every(Number.isFinite)) return `${path} should be a list of ${want.length} numbers`;
    return null;
  }
  if (typeof cur === 'boolean') return typeof value === 'boolean' ? null : `${path} should be true or false`;
  return `${path} is a group of values, not one value`;
}

// ---------------------------------------------------------------- the character's own numbers
// The run's character mechanic (a hook, §5.12) has numbers of its own in data (the Harpooner's
// daze, the Lamplighter's growth per level). The panel shows them as "character.<id>.<name>", so
// Kevin can try them live like any tuning value.

function characterHook(world) {
  const c = world.character;
  return c && c.mechanic ? world.hookEntries.find((e) => e.source === `character:${c.id}`) ?? null : null;
}

/**
 * The run's character mechanic numbers, shaped like a tuning group: { [character id]: params }
 * (empty for a character without a mechanic). `live` false gives the character's defaults from
 * data instead of the run's current values.
 */
export function characterTuning(world, live = true) {
  const entry = characterHook(world);
  if (!entry) return {};
  return { [world.character.id]: live ? entry.params : (world.character.mechanic.params || {}) };
}

/** Why this change to the character's numbers can't be made (a sentence), or null if it can. */
export function checkCharacterTune(world, path, value) {
  const [, id, name, ...rest] = String(path).split('.');
  const entry = characterHook(world);
  if (!entry || id !== world.character.id || rest.length || typeof entry.params[name] !== 'number') {
    return `there is no character value "${path}" in this run`;
  }
  return Number.isFinite(value) ? null : `${path} should be a number`;
}

/**
 * Set one tuning value on this world. The world's tuning shares untouched groups with the data
 * module, so the path is copied on the way down: a change never leaks into the defaults or into
 * another run. A "character." path changes the run's own copy of its character's numbers.
 */
export function tuneDecide(world, d) {
  if (typeof d.path === 'string' && d.path.startsWith('character.')) {
    const bad = checkCharacterTune(world, d.path, d.value);
    if (bad) throw new Error(`tune: ${bad}`);
    const entry = characterHook(world);
    entry.params = { ...entry.params, [d.path.split('.')[2]]: d.value };  // a copy: data stays as it was
    markStatsDirty(world);
    return;
  }
  const bad = checkTune(world.tuning, d.path, d.value);
  if (bad) throw new Error(`tune: ${bad}`);
  const keys = d.path.split('.');
  world.tuning = { ...world.tuning };
  let o = world.tuning;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    o[k] = Array.isArray(o[k]) ? o[k].slice() : { ...o[k] };
    o = o[k];
  }
  const last = keys[keys.length - 1];
  o[last] = Array.isArray(d.value) ? structuredClone(d.value) : d.value;
  markStatsDirty(world);
}

function checkId(list, id, what) {
  const def = list.find((x) => x.id === id);
  if (!def) throw new Error(`dev: unknown ${what} "${id}"`);
  return def;
}

/** Run one dev command. Throws a plain message for one that can't run. */
export function devDecide(world, d) {
  switch (d.cmd) {
    case 'spawn': {
      const count = d.count;
      if (!(Number.isInteger(count) && count >= 1 && count <= MAX_SPAWN)) throw new Error(`dev spawn: count must be a whole number from 1 to ${MAX_SPAWN}`);
      let types;
      if (d.enemy !== undefined) {
        const t = world.enemyIndex.get(d.enemy);
        if (t === undefined) throw new Error(`dev spawn: unknown enemy "${d.enemy}"`);
        if (world.enemyDefs[t].ai.type === 'boss') throw new Error('dev spawn: bosses come from the timeline, not the spawn command');
        types = [t];
      } else {
        const b = world.director.bands[world.director.band];
        types = b.types;
      }
      // A thick ring around the player, from just inside the view to the spawn ring.
      const p = world.player, rng = world.rng.spawn, sc = world.scratch.sc, terrain = world.terrain;
      const inner = 150, outer = world.tuning.enemies.spawnRing;
      let made = 0;
      for (let k = 0, tries = 0; k < count && tries < count * 4; tries++) {
        sincosInto(rng.next() * TAU, sc, 0);
        const r = inner + rng.next() * (outer - inner);
        const x = p.x + sc[1] * r, y = p.y + sc[0] * r;
        if (x < 8 || y < 8 || x > terrain.width - 8 || y > terrain.height - 8 || terrain.blockedAt(x, y)) continue;
        if (spawnEnemy(world, types[rng.int(types.length)], x, y, null) < 0) break;
        made++; k++;
      }
      return made;
    }
    case 'jump': {
      const to = Math.round(d.to * TPS);
      if (!(Number.isFinite(d.to) && to > world.tick)) throw new Error('dev jump: the time must be later than now (seconds into the run)');
      world.tick = to;
      // Events between then and now are skipped (a dev jump is for looking at a moment, not for
      // playing through what was skipped).
      const dir = world.director, t = to / TPS;
      while (dir.eventIdx < dir.events.length && dir.events[dir.eventIdx].at < t) dir.eventIdx++;
      return to;
    }
    case 'give': {
      switch (d.what) {
        case 'weapon': {
          const def = checkId(world.weaponDefs, d.id, 'weapon');
          if (def.innate) throw new Error(`dev give: ${d.id} is a character's own weapon`);
          const owned = world.slots.find((s) => s && s.def && s.def.id === d.id);
          if (owned && owned.level >= owned.def.maxLevel) throw new Error(`dev give: ${def.name} is already at its highest level`);
          applyCard(world, { kind: 'weapon', id: d.id, isNew: !owned });
          return 1;
        }
        case 'passive': {
          const def = checkId(world.passiveDefs, d.id, 'passive');
          const owned = world.build.passives.find((p) => p.def.id === d.id);
          if (owned && owned.level >= def.maxLevel) throw new Error(`dev give: ${def.name} is already at its highest level`);
          applyCard(world, { kind: 'passive', id: d.id });
          return 1;
        }
        case 'relic': {
          const def = checkId(world.relicDefs, d.id, 'relic');
          if (world.build.relics.includes(def)) throw new Error(`dev give: already holding ${d.id}`);
          addRelic(world, def);
          return 1;
        }
        case 'rune': {
          const rune = checkId(world.runeDefs, d.id, 'rune');
          if (!openSocketsFor(world, rune).length) throw new Error(`dev give: no open socket fits ${d.id}`);
          world.halts.push({ kind: 'rune', rune: rune.id });
          return 1;
        }
        default: throw new Error(`dev give: "${d.what}" is not weapon, passive, relic, or rune`);
      }
    }
    case 'level': {
      const n = d.count ?? 1;
      if (!(Number.isInteger(n) && n >= 1 && n <= 50)) throw new Error('dev level: count must be a whole number from 1 to 50');
      // Enough experience for n levels (plus a crumb, so rounding can't leave it a hair short);
      // the level check at the end of the next tick queues the drafts.
      const p = world.player;
      let need = p.xpNext - p.xp;
      for (let L = p.level + 1; L < p.level + n; L++) need += xpToNext(world.tuning, L);
      p.xp += need + 1e-6;
      return n;
    }
    case 'god':
      if (typeof d.on !== 'boolean') throw new Error('dev god: on must be true or false');
      // A world flag, not the RunConfig: a replay starts from the config the run started with.
      world.god = d.on;
      return 1;
    case 'heal':
      world.player.hp = world.stats.maxHp;
      return 1;
    case 'clear': {
      const E = world.enemies;
      let n = 0;
      for (let i = 0; i < E.count; i++) {
        if ((E.flags[i] & (EF.BOSS | EF.DEAD)) !== 0) continue;
        E.flags[i] |= EF.DEAD | EF.RESOLVED | EF.VANISH;
        n++;
      }
      return n;
    }
    case 'chest':
      openChest(world, d.boss === true ? CHEST_BOSS : CHEST_ELITE, world.player.x, world.player.y);
      return 1;
    default:
      throw new Error(`dev: unknown command "${d.cmd}"`);
  }
}
