// The six characters' hooks (ruling 14 section D and ruling 15, C2). sim/hooks.js joins these to
// its registry (HOOKS), so every rule of that file holds here: a hook is deterministic, uses only
// sim APIs (through `api`, late-bound by world.js), and keeps its running state as numbers in
// `h.state` (the world's state hash walks it). Per-hit and per-kill work allocates nothing (§17).
//
// Each character's hook is:
//   their mechanic               (data/characters.js mechanic.params: h.params)
//   their signature's own verb   at level 1, and its options, lines, and specials, read from the
//                                signature's slot as sl.fx.<key> (data/signatures.js, signature-forms.js)
//   their trade's verb           on its own: where they walk and face, what they are near, a
//                                meter, or a clock (with sim/trades.js). Never the dash (ruling 16:
//                                no hook here has onDash; the dash is the Dash slot's, sim/dash.js)
//   their cost
//   their skills                 the run's tree, read as world.sk.<id> (data/skills.js: the skill's numbers)
// What the trade does feeds the signature's track (sim/trades.js tradeDeed, capDeed).
//
// Stats that change with a state (her oil, his Momentum, a stance) are stepped, and the stats are
// rebuilt only when a step changes: a rebuild is a cold path.

import { DT, TPS, RELIC_SLOT, EF, EF_GONE, ZSTYLE, PK, TASK, TASK_STATE } from './constants.js';
import { EV } from './events.js';
import { raiseThrallAt, alliesStep, biteAt, creditDead, removeAlly, ALLY, RING_X, RING_Y } from './allies.js';
import { growMods, setupTrade, tradeStep, tradeDeed, capDeed, crateUp, purseNeed, onWater, markCrate, TRADE } from './trades.js';
import { wardAt } from './tasks.js';
import { CHEST_ELITE, CHEST_BOSS } from './chests.js';
import { spawnPickup } from './pickups.js';
import { addGlass } from './relics.js';
import { api } from './hooks.js';   // (hooks.js joins this file's hooks; import sim/hooks.js, not this file, first)

// ---------------------------------------------------------------- shared helpers

/** The character's signature weapon's slot (its hook's `state.sig`), or null. */
function sigSlot(world, h) {
  const k = h.state.sig;
  if (!(k >= 0)) return null;
  const sl = world.slots[k];
  return sl && sl.def ? sl : null;
}
const ticks = (sec) => Math.max(1, Math.round(sec * TPS));

function slowE(E, e, pct, sec) { if (E.slowT[e] < sec) E.slowT[e] = sec; if (E.slowPct[e] < pct) E.slowPct[e] = pct; }
function openE(E, e, amp, sec) { if (E.openT[e] < sec) E.openT[e] = sec; if (E.openAmp[e] < amp) E.openAmp[e] = amp; }
function rotE(E, e, sec, amp) { if (E.rotT[e] < sec) E.rotT[e] = sec; if (E.rotAmp[e] < amp) E.rotAmp[e] = amp; }
/** Dazed for `sec` (never a boss, never mid-attack: its attack lands when its warning said). */
function dazeE(E, e, sec) { if ((E.flags[e] & EF.BOSS) === 0 && !api.midAttack(E, e) && E.dazeT[e] < sec) E.dazeT[e] = sec; }
function freezeE(E, e, sec) { if ((E.flags[e] & EF.BOSS) === 0 && E.thawT[e] <= 0 && E.freezeT[e] < sec) E.freezeT[e] = sec; }
/** `dmg` to enemy e from slot (no crit). Returns what it took. */
function hit(world, e, slot, dmg) { world.scratch.num[0] = dmg; return api.damageEnemyR(world, e, slot, false); }
/** Pull enemy e toward (x, y) with `strength`. */
function pullTo(world, e, x, y, strength) {
  const E = world.enemies, dx = x - E.x[e], dy = y - E.y[e], d = Math.sqrt(dx * dx + dy * dy);
  if (d <= 1) return;
  const num = world.scratch.num;
  num[1] = dx / d; num[2] = dy / d; num[3] = strength;
  api.impulseR(world, e);
}
/** A skill's own effect went off (for the presentation: EV.SKILL with its index in data/skills.js). */
function skillEvent(world, id, x, y, b = 0) {
  const tr = world.trade;
  if (tr.ski === undefined) { tr.ski = {}; world.data.skills.forEach((s, i) => { tr.ski[s.id] = i; }); }
  world.events.push(EV.SKILL, x, y, tr.ski[id] ?? -1, b);
}
/** Standing still: st.stillT counts ticks; returns true once it has been `sec` s. */
function stillFor(world, st, sec) {
  if (world.player.moving || world.player.dashTicks > 0) st.stillT = 0; else st.stillT++;
  return st.stillT >= sec * TPS;
}
/** A one-effect list compiled once into state (numbers only): the list's index. */
function listOf(world, st, key, effects) {
  if (!(st[key] >= 0)) st[key] = api.compileList(world, effects);
  return st[key];
}
const DAMAGE_ONLY = [{ type: 'damage' }];

// ---------------------------------------------------------------- the Lamplighter

const CHAINS = new Set(['anchor_chain', 'harpoon_chain']);   // the Harpooner's weapons that pull (ruling 18 KE)
const LANTERNS = 6;   // her list of planted lanterns (a ring: l<k>x, l<k>y, l<k>t in her state)

/** Is (x, y) inside one of her lanterns' light? */
function inLantern(world, st, sl, P, x, y) {
  const r = sl.stats.radius * sl.stats.area * P.lanternMul, r2 = r * r;
  for (let k = 0; k < LANTERNS; k++) {
    if (st[`l${k}t`] === 0) continue;
    const dx = x - st[`l${k}x`], dy = y - st[`l${k}y`];
    if (dx * dx + dy * dy <= r2) return true;
  }
  return false;
}

/** A spare flame set down at her feet as a lantern (her trade: she stood still with one). */
function plantLantern(world, h, sl, atLamp = false) {
  const st = h.state, sk = world.sk, p = world.player, P = h.params;
  // (Ruling 19 KJ: a lamp she lights sets a lantern by it at no cost and for longer; standing to set one, the Great Lamp build, spends a flame.)
  if (!atLamp) { st.flames--; st.plantAt = world.tick + ticks(P.plantGap); }
  const keep = sk.lamp_row ? sk.lamp_row.keep : sl.fx.second_sun ? sl.fx.second_sun.keep : 0;
  const k = st.lp;
  st.lp = (st.lp + 1) % LANTERNS;
  st[`l${k}x`] = p.x; st[`l${k}y`] = p.y; st[`l${k}t`] = keep > 0 ? -1 : world.tick + ticks(atLamp ? P.lampLantern : sk.great_lamp ? sk.great_lamp.sec : P.lanternSec);
  st[`l${k}g`] = atLamp ? 0 : 1;   // (one she set down herself: Great Lamp's, worth `up` lamp lanterns)
  // Standing "until she has set `keep` more": the one set keep + 1 ago goes.
  if (keep > 0) for (let n = keep + 1; n < LANTERNS; n++) st[`l${(k + LANTERNS - n) % LANTERNS}t`] = 0;
  st.planted++;
  world.trade.s.uses++;
  world.trade.s.lanterns = st.planted;
  api.markStatsDirty(world);
  world.events.push(EV.LANTERN, p.x, p.y, sl.stats.radius * sl.stats.area * P.lanternMul, keep > 0 ? 0 : atLamp ? P.lampLantern : P.lanternSec);
  if (!atLamp) tradeDeed(world, 1);   // (a lamp's own lantern: the lamp already paid its deeds)
}

const lamplighter = {
  needs: ['flameKills', 'flameGap', 'plantStill', 'plantGap', 'flames', 'lanternMul', 'lanternDamage', 'lanternSec', 'lanternUp', 'lampLantern', 'flameArea', 'flameMight', 'darkEvery', 'oilFull', 'oilDim', 'oilLow'],
  init(world, h) {
    setupTrade(world, h);
    const st = h.state, sk = world.sk;
    st.flare = 0; st.flareAt = 0; st.litN = 0; st.darkT = 0; st.wakeAt = 0; st.wardAt = 0; st.wakeList = -1;
    st.flames = sk.first_flame ? h.params.flames : 0; st.flameN = 0; st.planted = 0;
    st.oilT = 0; st.oilStep = 3; st.flask = sk.oil_flask ? 1 : 0; st.dark = 0;
    st.lamps = 0; st.stillT = 0; st.stand = 0; st.vigil = 0; st.dashing = 0;
    st.shoveAt = 0; st.fireAt = 0; st.mothAt = 0; st.rowAt = 0; st.wardsAt = 0; st.lp = 0; st.flameAt = 0; st.plantAt = sk.great_lamp ? 0 : 1e9;   /* (ruling 19 KJ: only Great Lamp plants by standing; without it, never) */  st.signalAt = 0; st.road = 0; st.watchT = 0;
    for (let k = 0; k < LANTERNS; k++) { st[`l${k}x`] = 0; st[`l${k}y`] = 0; st[`l${k}t`] = 0; st[`l${k}g`] = 0; }
  },
  undo(world) { world.trade = null; world.player.speedMul = 1; },
  modifyStats(world, h, mods) {
    growMods(world, mods);
    const st = h.state, P = h.params, sk = world.sk, W = 'lamplight';
    const sl = sigSlot(world, h), fx = sl !== null ? sl.fx : null;
    // Her oil: each step down takes a third of the way to oilLow off her lamp's reach and burn.
    if (st.oilStep < 3 && !sk.burn_low) {
      const f = -((1 - P.oilLow) * (3 - st.oilStep)) / 3;
      mods.push({ stat: 'area', op: 'more', value: f, weapon: W });
      mods.push({ stat: 'might', op: 'more', value: f, weapon: W });
      // (Ruling 17 K4: the dark comes in with it: her pickup reach dims the same way.)
      mods.push({ stat: 'magnet', op: 'more', value: f });
    }
    // Ruling 18 KB: on the Marsh her light carries further over the water.
    if (world.marsh && (world.trade?.P.marshArea ?? 0) > 0) mods.push({ stat: 'area', op: 'more', value: world.trade.P.marshArea, weapon: W });
    // Ruling 18 KA: each lantern she has standing adds to Lamplight's damage.
    let lit = 0;
    for (let k = 0; k < LANTERNS; k++) if (st[`l${k}t`] !== 0) lit += st[`l${k}g`] === 1 && sk.great_lamp ? sk.great_lamp.up : 1;
    st.litN = lit;
    if (lit > 0) mods.push({ stat: 'might', op: 'more', value: P.lanternUp * lit, weapon: W });
    if (st.dark === 1) mods.push({ stat: 'area', op: 'more', value: -0.95, weapon: W });
    // (Ruling 19 KJ: her spare flames feed her own light as she walks, its reach and its burn.)
    // Ruling 25 KA: her spare flames widen her light more while she walks (a lamp carried, swinging), less when she stands.
    if (st.flames > 0) { const ar = st.mv === 1 && P.flameMoveArea > 0 ? P.flameMoveArea : P.flameArea; mods.push({ stat: 'area', op: 'more', value: ar * st.flames, weapon: W }); mods.push({ stat: 'might', op: 'more', value: P.flameMight * st.flames, weapon: W }); }
    if (st.vigil === 1) mods.push({ stat: 'area', op: 'more', value: 1, weapon: W });
    if (fx === null) return;
    if (fx.kindle) mods.push(st.flare === 1 ? { stat: 'area', op: 'more', value: fx.kindle.areaAdd, weapon: W } : { stat: 'might', op: 'more', value: fx.kindle.lull, weapon: W });
    if (fx.standing_light) mods.push({ stat: 'area', op: 'more', value: st.stand === 1 ? fx.standing_light.areaAdd : fx.standing_light.moveAdd, weapon: W });
  },
  onTick(world, h) {
    tradeStep(world);
    const sl = sigSlot(world, h);
    if (sl === null) return;
    const fx = sl.fx, st = h.state, P = h.params, sk = world.sk, now = world.tick, p = world.player, s = sl.stats, tr = world.trade;
    let dirty = false;
    // A lamp lit: her flames are full, her oil too (and the flask), and the track moves.
    const lit = world.result.lampsLit;
    if (lit > st.lamps) {
      const n = lit - st.lamps;
      st.lamps = lit;
      if (st.flames !== P.flames) { st.flames = P.flames; dirty = true; }
      st.oilT = 0; if (sk.oil_flask) st.flask = 1;
      plantLantern(world, h, sl, true);
      tr.s.uses += n;
      tradeDeed(world, tr.P.per * n);
      capDeed(world, n);
      world.events.push(EV.OIL, p.x, p.y, 3, 1);
    }
    // Her oil, ten times a second: full in a lit lamp's ward, else it runs.
    if (now % 6 === 0) {
      const inWard = wardAt(world, p.x, p.y) > 0;
      if (inWard) st.oilT = 0; else st.oilT += 6 * DT;
      let step = 3;
      // (Ruling 18 KB: on the Marsh, where the lamps stand far apart, her oil lasts `marshOil` times as long.)
      const full = world.marsh ? P.oilFull * (tr.P.marshOil ?? 1) : P.oilFull;
      if (st.oilT > full) {
        step = 3 - Math.ceil((st.oilT - full) / (P.oilDim / 3));
        if (step < 0) step = 0;
        if (step === 0 && st.flask === 1) { st.flask = 0; st.oilT = 0; step = 3; skillEvent(world, 'oil_flask', p.x, p.y); }
      }
      if (step !== st.oilStep) { st.oilStep = step; dirty = true; world.events.push(EV.OIL, p.x, p.y, step, 0); }
      // Ruling 21 KE: time fighting in the dark (her lamp dimmed) sets a lantern down by itself, and counts for her trade.
      if (st.oilStep < 3) { st.darkT += 6 * DT; if (st.darkT >= P.darkEvery) { st.darkT = 0; plantLantern(world, h, sl, true); tradeDeed(world, 1); } }
      // Burn Low: no dimming; with the oil gone her lamp gutters, dark for `dark` s in every `every`.
      if (sk.burn_low) {
        const dark = step === 0 && (now % ticks(sk.burn_low.every)) < ticks(sk.burn_low.dark) ? 1 : 0;
        if (dark !== st.dark) { st.dark = dark; dirty = true; }
      }
      if (sk.keepers_vigil) { const v = inWard ? 1 : 0; if (v !== st.vigil) { st.vigil = v; dirty = true; } }
      { const mv = p.stillT < 0.5 ? 1 : 0; if (mv !== st.mv) { st.mv = mv; if (st.flames > 0 && P.flameMoveArea > 0) dirty = true; } }
      // Night Watch: a banked Lantern Night falls when she has stood in a lit lamp's ward long enough (sim/trades.js nightCrowd).
      if (sk.night_watch) { st.watchT = inWard && !p.moving ? st.watchT + 6 * DT : 0; tr.s.watch = st.watchT >= sk.night_watch.still ? 1 : 0; }
      // Her spare flames (ruling 17 W4: from a crowd held, never from kills): every flameGap s that
    // flameKills or more enemies stand in her light, a flame fills.
    if (now >= st.flameAt && st.flames < P.flames) {
      st.flameAt = now + ticks(world.marsh ? P.flameGap * (tr.P.marshFlame ?? 1) : P.flameGap);   // (ruling 18 KB: marsh gas feeds them faster)
      const E = world.enemies, n = api.queryEnemies(world, p.x, p.y, sl.stats.radius * sl.stats.area, tr.near);
      let c = 0;
      for (let k = 0; k < n; k++) if ((E.flags[tr.near[k]] & EF_GONE) === 0) c++;
      if (c >= P.flameKills) { st.flames++; dirty = true; }
    }
    // Lamplit Road: inside a lantern's light she walks faster, and her oil fills.
      if (sk.lamplit_road) {
        const v = inLantern(world, st, sl, P, p.x, p.y) ? 1 : 0;
        if (v === 1) st.oilT = 0;
        if (v !== st.road) { st.road = v; p.speedMul = v === 1 ? 1 + sk.lamplit_road.speed : 1; }
      }
    }
    if (fx.kindle) {
      if (st.flare === 0 && now >= st.flareAt) { st.flare = 1; st.flareAt = now + ticks(fx.kindle.sec); dirty = true; world.events.push(EV.WAVE, p.x, p.y, s.radius * s.area * 2); }
      else if (st.flare === 1 && now >= st.flareAt) { st.flare = 0; st.flareAt = now + ticks(fx.kindle.every); dirty = true; }
    }
    const still = stillFor(world, st, fx.standing_light ? fx.standing_light.still : 1e9);
    // Her trade: standing still with a spare flame sets a lantern down at her feet.
    // Great Lamp (ruling 19 KJ: the standing build): standing still with a spare flame sets it down as a lantern.
    if (sk.great_lamp && st.flames > 0 && st.stillT >= P.plantStill * TPS && now >= st.plantAt) plantLantern(world, h, sl);
    if (fx.standing_light) { const v = still ? 1 : 0; if (v !== st.stand) { st.stand = v; dirty = true; } }
    const list = listOf(world, st, 'wakeList', DAMAGE_ONLY);
    if (fx.lamp_wake && p.moving && now >= st.wakeAt) {
      const f = fx.lamp_wake;
      st.wakeAt = now + ticks(f.every);
      const z = api.groundAt(world, sl.index, p.x, p.y, s.radius * s.area * f.radiusMul, f.life, s.damage * f.damageMul, f.interval, list);
      if (z >= 0) world.zones.style[z] = ZSTYLE.WARD;
    }
    if (fx.lamp_shove && now >= st.shoveAt) {
      st.shoveAt = now + ticks(fx.lamp_shove.every);
      api.explodeAt(world, sl.index, p.x, p.y, s.radius * s.area, s.damage * fx.lamp_shove.damageMul, fx.lamp_shove.knockback, -1);
    }
    // Her lanterns: each one standing burns a second at a time (a ward on the ground), from her list.
    if (now % TPS === 0) {
      const sun = fx.second_sun, r = s.radius * s.area * P.lanternMul, dmg = s.damage * (sun ? sun.damageMul : P.lanternDamage);
      for (let k = 0; k < LANTERNS; k++) {
        const t = st[`l${k}t`];
        if (t === 0) continue;
        if (t > 0 && now >= t) { st[`l${k}t`] = 0; api.markStatsDirty(world); continue; }
        const z = api.groundAt(world, sl.index, st[`l${k}x`], st[`l${k}y`], r, 1.02, dmg, 0.5, list);
        if (z >= 0) world.zones.style[z] = ZSTYLE.WARD;
      }
    }
    // Lamp Row: a line of light from each lantern to the next planted, burning what crosses it.
    if (sk.lamp_row && now >= st.rowAt) {
      const f = sk.lamp_row;
      st.rowAt = now + ticks(f.every);
      for (let n = 1; n < LANTERNS; n++) {
        const a = (st.lp + LANTERNS - n) % LANTERNS, b = (st.lp + LANTERNS - n - 1) % LANTERNS;
        if (st[`l${a}t`] === 0 || st[`l${b}t`] === 0) break;
        const ax = st[`l${a}x`], ay = st[`l${a}y`], dx = st[`l${b}x`] - ax, dy = st[`l${b}y`] - ay, d = Math.sqrt(dx * dx + dy * dy);
        const steps = Math.min(12, Math.max(1, Math.round(d / (f.width * 1.5))));
        for (let q = 1; q < steps; q++) api.explodeAt(world, sl.index, ax + (dx * q) / steps, ay + (dy * q) / steps, f.width, s.damage * f.damageMul, 0, -1);
      }
    }
    // Signal Lamp: a beam the way she faces.
    if (sk.signal_lamp && now >= st.signalAt) {
      const f = sk.signal_lamp, len = s.radius * s.area * f.reach, step = f.width * 1.6;
      st.signalAt = now + ticks(f.every);
      for (let d = step; d <= len; d += step) api.explodeAt(world, sl.index, p.x + p.fx * d, p.y + p.fy * d, f.width, s.damage * f.damageMul, 0, -1);
      skillEvent(world, 'signal_lamp', p.x + p.fx * len, p.y + p.fy * len);
    }
    if (sk.bonfire && st.stillT >= sk.bonfire.still * TPS && now >= st.fireAt) {
      const f = sk.bonfire, r = s.radius * s.area * f.reach;
      st.fireAt = now + ticks(f.every);
      api.explodeAt(world, sl.index, p.x, p.y, r, s.damage * f.damageMul, f.knockback, -1);
      world.events.push(EV.WAVE, p.x, p.y, r);
    }
    if (sk.moth_light && now >= st.mothAt) {
      st.mothAt = now + ticks(sk.moth_light.every);
      const E = world.enemies, n = api.queryEnemies(world, p.x, p.y, s.radius * s.area, tr.near);
      for (let k = 0; k < n; k++) if ((E.flags[tr.near[k]] & EF_GONE) === 0) dazeE(E, tr.near[k], sk.moth_light.daze);
    }
    // Burning Wards and Flare Up: the lamps she has lit, on screen.
    if ((sk.burning_wards || sk.flare_up) && world.tasks !== null && now >= st.wardsAt) {
      st.wardsAt = now + ticks(sk.burning_wards ? sk.burning_wards.every : 0.2);
      const wr = world.tuning.tasks.ward.radius * tr.P.wardMul, lr = world.tuning.tasks.lamp.radius + world.tuning.player.radius;
      for (let i = 0; i < world.tasks.length; i++) {
        const t = world.tasks[i];
        if (t.kind !== TASK.LAMP || t.state !== TASK_STATE.DONE) continue;
        const dx = t.x - p.x, dy = t.y - p.y;
        if (dx > 360 || dx < -360 || dy > 220 || dy < -220) continue;
        if (sk.burning_wards) api.explodeAt(world, sl.index, t.x, t.y, wr, s.damage * sk.burning_wards.damageMul, 0, -1);
        if (sk.flare_up && dx * dx + dy * dy <= lr * lr && now >= (st[`f${i}`] ?? 0)) {
          const f = sk.flare_up;
          st[`f${i}`] = now + ticks(f.every);
          api.explodeAt(world, sl.index, t.x, t.y, f.radius, s.damage * f.damageMul, f.knockback, -1);
          world.events.push(EV.WAVE, t.x, t.y, f.radius);
          skillEvent(world, 'flare_up', t.x, t.y);
        }
      }
    }
    if (dirty) api.markStatsDirty(world);
  },
  onKill(world, h, e) {
    const sl = sigSlot(world, h);
    if (sl === null) return;
    const st = h.state, P = h.params, E = world.enemies, p = world.player, s = sl.stats;
    if (!sl.fx.wardlight || E.killer[e] !== sl.index || world.tick < st.wardAt) return;
    const f = sl.fx.wardlight;
    st.wardAt = world.tick + ticks(Math.max(f.every, f.life / f.max));
    const z = api.groundAt(world, sl.index, E.x[e], E.y[e], f.radius * s.area, f.life, s.damage * f.damageMul, f.interval, listOf(world, st, 'wakeList', DAMAGE_ONLY));
    if (z >= 0) world.zones.style[z] = ZSTYLE.WARD;
  },
  onBossKill(world, h) {
    if (!world.sk.first_flame || h.state.flames === h.params.flames) return;
    h.state.flames = h.params.flames;
    api.markStatsDirty(world);
  },
  onHit(world, h, e, slot) {
    if (slot !== h.state.sig) return;
    const sl = world.slots[slot];
    if (!sl) return;
    const fx = sl.fx, E = world.enemies, s = sl.stats;
    if (fx.dread_light) openE(E, e, fx.dread_light.amp, fx.dread_light.sec);
    if (fx.afterglow) {
      const f = fx.afterglow, dps = s.damage * f.dpsMul;
      if (E.burnT[e] < f.duration) E.burnT[e] = f.duration;
      if (E.burnDps[e] < dps) { E.burnDps[e] = dps; E.burnSlot[e] = slot; }
    }
    if (fx.long_shadow) {
      const p = world.player, dx = E.x[e] - p.x, dy = E.y[e] - p.y, r = s.radius * s.area, d2 = dx * dx + dy * dy, from = r * fx.long_shadow.from;
      if (d2 <= (r + E.radius[e]) * (r + E.radius[e]) && d2 >= from * from) hit(world, e, slot, s.damage * fx.long_shadow.mul);
    }
  },
};

// ---------------------------------------------------------------- the Harpooner

const HAULS = 3;   // enemies the Grapnel can be hauling at once (hh<k>: handle, ht<k>: ticks left)

/** Start hauling ordinary enemy e to her feet: dazed, and whatever her options add. */
function startHaul(world, h, sl, e) {
  const E = world.enemies, st = h.state, P = h.params, fx = sl.fx, sk = world.sk, tr = world.trade;
  if ((E.flags[e] & (EF.BOSS | EF.ELITE | EF_GONE)) !== 0 || api.midAttack(E, e)) return false;
  const hd = E.handle(e);
  let free = -1;
  for (let k = 0; k < HAULS; k++) { if (st[`ht${k}`] > 0 && st[`hh${k}`] === hd) return false; if (st[`ht${k}`] <= 0 && free < 0) free = k; }
  if (free < 0) return false;
  st[`hh${free}`] = hd; st[`ht${free}`] = 12;
  const daze = P.haulDaze * (fx.whalers_brace && st.brace === 1 ? fx.whalers_brace.dazeMul : 1);
  if (E.dazeT[e] < daze) E.dazeT[e] = daze;
  if (fx.barbs) slowE(E, e, fx.barbs.slow, fx.barbs.sec);
  if (fx.keelhaul) openE(E, e, fx.keelhaul.amp, fx.keelhaul.sec);
  if (sk.gaffed) openE(E, e, tr.P.gaff, tr.P.gaffSec);
  st.hauls++;
  // Ruling 23 KE: her track moves with how she fights. Every `haulDeed` hauls is a deed toward the Grapnel's next level.
  if (tr && tr.P.haulDeed > 0 && st.hauls % tr.P.haulDeed === 0) { tradeDeed(world, 1); tr.s.haulDeeds = (tr.s.haulDeeds ?? 0) + 1; }
  world.events.push(EV.HAUL, E.x[e], E.y[e], 4);
  // Cast Net: every Nth haul, everything round the hooked enemy comes too.
  if (fx.cast_net && st.hauls % fx.cast_net.every === 0) {
    const f = fx.cast_net, p = world.player, n = api.queryEnemies(world, E.x[e], E.y[e], f.radius, tr.near);
    for (let k = 0; k < n; k++) {
      const o = tr.near[k];
      if ((E.flags[o] & (EF_GONE | EF.BOSS)) !== 0) continue;
      pullTo(world, o, p.x, p.y, f.pull);
      dazeE(E, o, f.daze);
    }
    world.events.push(EV.TRADE, E.x[e], E.y[e], 7, n);
  }
  return true;
}

const harpooner = {
  needs: ['armorPerNear', 'nearRadius', 'cap', 'pull', 'daze', 'haulDaze', 'haulTo', 'crowdHurt', 'bigGame', 'marshMight', 'catchRadius'],
  // Her cost: the crowd she hauls in is at her feet, and every hit she takes is crowdHurt more
  // (on the hit itself: no clock needed, it gives nothing back).
  onHurt(world, h, dmg) {
    const P = h.params, p = world.player;
    if (!(dmg > 0) || !(P.crowdHurt > 0) || p.hp <= 0) return;
    const more = dmg * P.crowdHurt;
    p.hp -= more; world.result.damageTaken += more;
  },
  init(world, h) {
    const st = h.state, sk = world.sk, p = world.player;
    // (Ruling 18 KE: only the Grapnel and the chains pull, in onHit; her other weapons push as anyone's do.)
    world.knockbackPulls = false;
    setupTrade(world, h);
    st.hauls = 0; st.candH = -1; st.cand2 = -1; st.candAt = -1; st.candX = 0; st.candY = 0; st.stillT = 0; st.brace = 0; st.dashing = 0;
    for (let k = 0; k < HAULS; k++) { st[`hh${k}`] = -1; st[`ht${k}`] = 0; }
    st.rideT = 0; st.rideX = 0; st.rideY = 0; st.boardUntil = 0; st.bulwarkAt = 0; st.seenYanks = 0; st.ehUntil = 0; st.ehAt = 0;
    st.coilAt = 0; st.gemsAt = 0; st.ringAt = 0; st.flSec = -1; st.flN = 0;
  },
  undo(world) { world.knockbackPulls = false; world.trade = null; },
  modifyStats(world, h, mods) {
    growMods(world, mods);
    const sl = sigSlot(world, h);
    if (sl !== null && sl.fx.whalers_brace && h.state.brace === 1) mods.push({ stat: 'cooldown', op: 'more', value: sl.fx.whalers_brace.rate, weapon: 'grapnel' });
    if (world.sk.coil && h.state.coilOn === 1) mods.push({ stat: 'cooldown', op: 'more', value: world.sk.coil.rate, weapon: 'grapnel' });
    // (Ruling 21 KB: the Marsh's soft ground holds what she hauls: the Grapnel bites harder there.)
    if (world.marsh && h.params.marshMight > 0) mods.push({ stat: 'might', op: 'more', value: h.params.marshMight, weapon: 'grapnel' });
  },
  onTick(world, h) {
    tradeStep(world);
    const st = h.state, P = h.params, sk = world.sk, p = world.player, tr = world.trade, E = world.enemies, now = world.tick;
    const sl = sigSlot(world, h);
    // Her Armor from the crowd, ten times a second (Boarding Action: full for a while after a ride).
    if (now % 6 === 0) {
      const n = api.queryEnemies(world, p.x, p.y, P.nearRadius, world.scratch.near);
      let a = n * P.armorPerNear;
      if (a > P.cap || now < st.boardUntil) a = P.cap;
      p.bonusArmor = a;
      if (sk.bulwark && a >= P.cap && now >= st.bulwarkAt && n > 0) {
        const f = sk.bulwark;
        st.bulwarkAt = now + ticks(f.every);
        api.explodeAt(world, RELIC_SLOT, p.x, p.y, f.radius, f.damage, f.knockback, -1);
        world.events.push(EV.WAVE, p.x, p.y, f.radius);
        skillEvent(world, 'bulwark', p.x, p.y);
      }
    }
    // Coil (ruling 17 W4: time held, not a kill): while an elite she landed is still dazed at her side, the Grapnel throws faster.
    if (sk.coil) { const v = (tr.s.yanks ?? 0) > 0 && now - (tr.s.yankAt ?? -1e9) < ticks(tr.P.yankDaze) ? 1 : 0; if (v !== st.coilOn) { st.coilOn = v; api.markStatsDirty(world); } }
    if (sl === null) return;
    const fx = sl.fx, s = sl.stats;
    // The trade hook threw this tick (sim/trades.js hookStep, the way she faces): what her skills add.
    if (tr.s.thrownAt === now) {
      const gaff = sk.gaff_hand;
      if (gaff) {
        // Gaff Hand: the throw hits everything along its line.
        const len = tr.P.reach * gaff.reach, step = gaff.width * 1.6;
        for (let d = step; d <= len; d += step) api.explodeAt(world, sl.index, p.x + tr.s.tdx * d, p.y + tr.s.tdy * d, gaff.width, s.damage * gaff.damageMul, 0, -1);
        skillEvent(world, 'gaff_hand', p.x + tr.s.tdx * len, p.y + tr.s.tdy * len);
      }
      if (sk.sleigh_ride && tr.s.got === 1) {
        // Sleigh Ride: she goes to the elite. (It keeps its daze and its gaff, and stays where it is.)
        tr.s.yankT = 0;
        st.rideT = 10; st.rideX = tr.s.gx; st.rideY = tr.s.gy;
        if (p.iframes < 14) p.iframes = 14;
      }
    }
    // Ring of Hooks: every few seconds the nearest few are hooked and hauled.
    if (fx.ring_of_hooks && now >= st.ringAt) {
      const f = fx.ring_of_hooks, n = api.queryEnemies(world, p.x, p.y, f.radius, tr.near);
      st.ringAt = now + ticks(f.every);
      let took = 0;
      for (let k = 0; k < n && took < f.n; k++) {
        const e = tr.near[k];
        if ((E.flags[e] & EF_GONE) !== 0) continue;
        hit(world, e, sl.index, s.damage * f.damageMul);
        if ((E.flags[e] & EF_GONE) === 0 && startHaul(world, h, sl, e)) took++;
      }
    }
    if (fx.whalers_brace) { const v = stillFor(world, st, fx.whalers_brace.still) ? 1 : 0; if (v !== st.brace) { st.brace = v; api.markStatsDirty(world); } }
    // An elite landed by the trade hook (sim/trades.js counts them): what her skills add.
    if (tr.s.yanks > st.seenYanks) {
      st.seenYanks = tr.s.yanks;
      if (sk.salvager && now >= st.gemsAt) { world.magnetAll = world.tuning.xp.magnetItemPull; st.gemsAt = now + ticks(sk.salvager.every); }
      if (sk.elite_hunter) st.ehUntil = now + ticks(sk.elite_hunter.sec);
      if (sk.wrecking_ball) {
        const f = sk.wrecking_ball, r = tr.P.yankTo;
        for (let q = 0; q < 8; q++) api.explodeAt(world, sl.index, p.x + RING_X[q] * r, p.y + RING_Y[q] * r, 26, s.damage * f.damageMul, f.knockback, -1);
        skillEvent(world, 'wrecking_ball', p.x, p.y);
      }
    }
    // The Grapnel's haul: a moment after its last bite, that enemy comes in (with Twin Hooks, the one before it too).
    if (st.candAt >= 0 && now - st.candAt >= 10) {
      let e = E.resolve(st.candH);
      const e2 = fx.twin_hooks && st.cand2 !== st.candH ? E.resolve(st.cand2) : -1;
      // The hook comes back with something on it (C2b, Nov 20): if its last bite killed, it catches the
      // nearest ordinary enemy where that bite landed. Before this, a bite that killed was still the one
      // named, and at the Grapnel's damage every haul went to a dead enemy (911 of 911 in a 20:00 run):
      // the verb and the Forms built on it never fired.
      if (e < 0 || (E.flags[e] & EF_GONE) !== 0) {
        e = -1;
        const n = api.queryEnemies(world, st.candX, st.candY, P.catchRadius, tr.near);
        for (let k = 0; k < n; k++) { const c = tr.near[k]; if ((E.flags[c] & (EF.BOSS | EF.ELITE | EF_GONE)) === 0) { e = c; break; } }
      }
      st.candAt = -1;
      if (e >= 0 && startHaul(world, h, sl, e) && fx.chain_haul) {
        const f = fx.chain_haul, n = api.queryEnemies(world, E.x[e], E.y[e], f.radius, tr.near);
        let took = 0;
        for (let k = 0; k < n && took < f.extra; k++) if (tr.near[k] !== e && startHaul(world, h, sl, tr.near[k])) took++;
      }
      if (e2 >= 0) startHaul(world, h, sl, e2);
      st.candH = -1; st.cand2 = -1;
    }
    for (let k = 0; k < HAULS; k++) {
      if (st[`ht${k}`] <= 0) continue;
      const e = E.resolve(st[`hh${k}`]);
      if (e < 0 || (E.flags[e] & EF_GONE) !== 0) { st[`ht${k}`] = 0; continue; }
      const dx = E.x[e] - p.x, dy = E.y[e] - p.y, d = Math.sqrt(dx * dx + dy * dy) || 1, q = 1 / st[`ht${k}`];
      const nx = E.x[e] - (dx / d) * (d - P.haulTo) * q, ny = E.y[e] - (dy / d) * (d - P.haulTo) * q;
      if (!world.terrain.blockedAt(nx, ny)) { E.x[e] = nx; E.y[e] = ny; }
      E.vx[e] = 0; E.vy[e] = 0;
      st[`ht${k}`]--;
      if (fx.long_line && st[`ht${k}`] % 3 === 0) api.explodeAt(world, sl.index, E.x[e], E.y[e], fx.long_line.radius + E.radius[e], s.damage * fx.long_line.damageMul, 0, e);
      if (st[`ht${k}`] === 0 && sk.deadweight) {
        // Deadweight: thrown on past her, bursting where it lands.
        const f = sk.deadweight, tx = p.x - (dx / d) * f.past, ty = p.y - (dy / d) * f.past;
        if (!world.terrain.blockedAt(tx, ty)) { E.x[e] = tx; E.y[e] = ty; }
        api.explodeAt(world, sl.index, E.x[e], E.y[e], f.radius, s.damage * f.damageMul, 0, -1);
        skillEvent(world, 'deadweight', E.x[e], E.y[e]);
      }
    }
    // Sleigh Ride: she is hauled to what the hook bit, hitting everything on the way.
    if (st.rideT > 0) {
      const f = sk.sleigh_ride, dx = st.rideX - p.x, dy = st.rideY - p.y, d = Math.sqrt(dx * dx + dy * dy) || 1, want = 30;
      if (d > want) {
        const m = (d - want) / st.rideT, nx = p.x + (dx / d) * m, ny = p.y + (dy / d) * m;
        if (!world.terrain.blockedAt(nx, ny)) { p.x = nx; p.y = ny; } else st.rideT = 1;
      }
      if (st.rideT % 2 === 0) api.explodeAt(world, sl.index, p.x, p.y, f.width + 8, s.damage * f.damageMul, 0, -1);
      if (p.iframes < 4) p.iframes = 4;
      if (--st.rideT === 0 && sk.boarding_action) {
        const b = sk.boarding_action, n = api.queryEnemies(world, p.x, p.y, b.radius, tr.near);
        for (let k = 0; k < n; k++) if ((E.flags[tr.near[k]] & EF_GONE) === 0) dazeE(E, tr.near[k], b.daze);
        st.boardUntil = now + ticks(b.sec);
        world.events.push(EV.WAVE, p.x, p.y, b.radius);
        skillEvent(world, 'boarding_action', p.x, p.y);
      }
    }
  },
  onHit(world, h, e, slot) {
    if (slot >= RELIC_SLOT) return;
    const E = world.enemies, p = world.player, st = h.state, mine = slot === st.sig;
    // Her Grapnel's hits and her chains' pull and daze (Slack Line: only the Grapnel's). A chain's
    // (and the Grapnel's) own knock pushes on the same hit, so the pull is that much stronger, to land as a pull.
    const sd = world.slots[slot], chain = !mine && !world.sk.slack_line && sd && sd.def && CHAINS.has(sd.def.id);
    if (mine || chain) {
      const dx = p.x - E.x[e], dy = p.y - E.y[e], d = Math.sqrt(dx * dx + dy * dy);
      if (d > 1) {
        const num = world.scratch.num;
        num[1] = dx / d; num[2] = dy / d; num[3] = h.params.pull + 2 * (sd && sd.stats ? sd.stats.knockback ?? 0 : 0);
        api.impulseR(world, e);
        dazeE(E, e, h.params.daze);
      }
    }
    // Ruling 21 KD: a whaler knows big game: the Grapnel bites a boss or a champion harder.
    if (mine && (E.flags[e] & EF.BOSS) !== 0 && (E.flags[e] & EF_GONE) === 0) { const g = world.slots[slot]; if (g && g.stats) hit(world, e, slot, g.stats.damage * h.params.bigGame); }
    // The Grapnel's bite: this is the one it hauls, a moment from now (and where it bit, for when the bite killed it).
    if (mine && (E.flags[e] & (EF.BOSS | EF.ELITE)) === 0) {
      const hd = E.handle(e);
      if (hd !== st.candH) { st.cand2 = st.candH; st.candH = hd; }
      st.candAt = world.tick; st.candX = E.x[e]; st.candY = E.y[e];
    }
  },
  onKill(world, h, e) {
    const sl = sigSlot(world, h), st = h.state, sk = world.sk, E = world.enemies;
    // Elite Hunter: the elite she just yanked, dead in time, leaves a second chest at her feet.
    if (sk.elite_hunter && world.tick <= st.ehUntil && (E.flags[e] & EF.ELITE) !== 0 && E.handle(e) === world.trade.s.yankH) {
      st.ehUntil = 0;
      spawnPickup(world, PK.CHEST, world.player.x, world.player.y + 12, CHEST_ELITE, 0);
      skillEvent(world, 'elite_hunter', world.player.x, world.player.y);
    }
    if (sl === null || !sl.fx.flense || E.killer[e] !== sl.index) return;
    const f = sl.fx.flense, sec = Math.floor(world.tick / TPS);
    // At most perSec bursts a second, so a burst's own kills can't chain through a crowd.
    if (sec !== st.flSec) { st.flSec = sec; st.flN = 0; }
    if (++st.flN > f.perSec) return;
    // (Ruling 21 WD: a barb, not a burst. It flies to the nearest enemy within reach, hits it, and gaffs it.)
    const tr = world.trade, n = api.queryEnemies(world, E.x[e], E.y[e], f.radius * sl.stats.area * 2, tr.near);
    let best = -1, bd = 1e18;
    for (let k = 0; k < n; k++) { const j = tr.near[k]; if (j === e || (E.flags[j] & EF_GONE) !== 0) continue; const dx = E.x[j] - E.x[e], dy = E.y[j] - E.y[e], d = dx * dx + dy * dy; if (d < bd) { bd = d; best = j; } }
    if (best < 0) return;
    const G = world.tuning.status.gaff;
    openE(E, best, G.amp, G.sec);
    api.explodeAt(world, sl.index, E.x[best], E.y[best], 6, sl.stats.damage * f.damageMul, f.knockback, -1);
  },
};

// ---------------------------------------------------------------- the Punter

/** The pole's sweep all round him (the turn, a vault's landing, or Counterpoise). Returns how many it caught. */
function poleSweep(world, h, sl) {
  const st = h.state, P = h.params, fx = sl.fx, sk = world.sk, p = world.player, tr = world.trade, E = world.enemies, s = sl.stats;
  const r = P.sweepRadius * s.area * (fx.long_sweep ? fx.long_sweep.radius : 1);
  const dmg = s.damage * P.sweepMul * (fx.eddy ? fx.eddy.damageMul : 1);
  const n = api.queryEnemies(world, p.x, p.y, r, tr.near);
  if (fx.splash) for (let k = 0; k < n; k++) slowE(E, tr.near[k], fx.splash.slow, fx.splash.sec);
  const times = fx.crows_landing && n >= fx.crows_landing.count ? 2 : 1;
  for (let q = 0; q < times; q++) api.explodeAt(world, sl.index, p.x, p.y, r, dmg, P.sweepKnock, -1);
  world.events.push(EV.WAVE, p.x, p.y, r);
  if (fx.breakwater) {
    const f = fx.breakwater;
    api.groundAt(world, sl.index, p.x, p.y, r, f.life, s.damage * f.damageMul, f.interval, listOf(world, st, 'slowList', [{ type: 'damage' }, { type: 'status', status: 'slow', pct: f.slow, duration: 1 }]));
  }
  // Eddy: a whirl where it swept, dragging enemies to its middle (punter onTick).
  if (fx.eddy) { st.eddyX = p.x; st.eddyY = p.y; st.eddyR = r; st.eddyUntil = world.tick + ticks(fx.eddy.life); }
  if (fx.follow_through) sl.cd = 0;   // (on the sweep's own clock)
  if (n > 0) {
    st.swept += n; tr.s.swept = st.swept; capDeed(world, n);
    if (n >= 3) {
      // (Ruling 18 KB: on the Marsh, where the water is everywhere, a sweep counts `marshSweep` times.)
      st.sweeps++; tr.s.uses++; tradeDeed(world, world.marsh ? tr.P.marshSweep ?? 1 : 1);
      // Gather Way (ruling 18 KF: in place of a second gem pull): every `every`th such sweep fills his Momentum, once every `gap` s.
      if (sk.gather_way && ++st.gw % sk.gather_way.every === 0 && world.tick >= st.gwAt) { st.gwAt = world.tick + ticks(sk.gather_way.gap); st.meter = 1; }
    }
  }
  return n;
}

const punter = {
  needs: ['steps', 'perStep', 'fill', 'drain', 'pace', 'empty', 'hitSteps', 'turnCos', 'sweepEvery', 'sweepRadius', 'sweepMul', 'sweepKnock'],
  init(world, h) {
    setupTrade(world, h);
    const st = h.state, p = world.player;
    st.bowAt = 0; st.meter = 0; st.mo = 0; st.step = 0; st.lx = p.x; st.ly = p.y; st.wet = 0; st.sweeps = 0; st.swept = 0; st.sweepAt = 0;
    st.guardAt = 0; st.nsAt = 0; st.wakeAt = 0; st.stillT = 0; st.dig = 0; st.gw = 0; st.gwAt = 0; st.slowList = -1; st.wakeList = -1; st.slickList = -1;
    st.ax = p.x; st.ay = p.y; st.hk = 0; st.turnAt = 0; for (let k = 0; k < 4; k++) { st[`hx${k}`] = 0; st[`hy${k}`] = 0; st[`hd${k}`] = 0; }
    st.eddyX = 0; st.eddyY = 0; st.eddyR = 0; st.eddyUntil = -1; st.vaultAt = 0; st.vaultT = 0; st.vx = 0; st.vy = 0; st.vaults = 0;
  },
  undo(world) { world.trade = null; },
  modifyStats(world, h, mods) {
    growMods(world, mods);
    const st = h.state, P = h.params, sk = world.sk, W = 'punt_pole';
    const sl = sigSlot(world, h), fx = sl !== null ? sl.fx : null;
    // Momentum: each step is Damage; with none, his weapons are weaker (the cost), unless the pole is planted (Dig In).
    if (st.step > 0) mods.push({ stat: 'might', op: 'more', value: P.perStep * st.step });
    else if (st.dig !== 1) mods.push({ stat: 'might', op: 'more', value: P.empty });
    if (st.dig === 1) mods.push({ stat: 'area', op: 'more', value: sk.dig_in.area, weapon: W });
    // (C2b, Nov 19: the punt's headway drives the pole. Each step of Momentum lengthens its reach, jab and sweep.)
    if (st.step > 0 && P.reachPerStep > 0) mods.push({ stat: 'area', op: 'more', value: P.reachPerStep * st.step, weapon: W });
    // Ruling 23 KB: the straight line drops more glass. Each step of Momentum makes his Glass Caltrops drop `glassPerStep` faster.
    if (st.step > 0 && P.glassPerStep > 0) mods.push({ stat: 'cooldown', op: 'more', value: -P.glassPerStep * st.step, weapon: 'glass_caltrops' });
    if (sk.sculling && st.wet === 1) mods.push({ stat: 'cooldown', op: 'more', value: -sk.sculling.rate, weapon: W });
    if (fx !== null && fx.full_tilt && st.step >= P.steps) mods.push({ stat: 'cooldown', op: 'more', value: fx.full_tilt.rate, weapon: W });
  },
  onTick(world, h) {
    tradeStep(world);
    const st = h.state, P = h.params, sk = world.sk, p = world.player, now = world.tick, tr = world.trade, E = world.enemies;
    const sl = sigSlot(world, h);
    let dirty = false;
    // Momentum, from ground really covered this tick (a wall, a hold, or a slow starves it).
    const dx = p.x - st.lx, dy = p.y - st.ly;
    st.lx = p.x; st.ly = p.y;
    const need = world.tuning.player.speed * world.stats.moveSpeed * DT * P.pace;
    const wet = onWater(world) ? 1 : 0;
    const fill = P.fill * (sk.water_born && wet === 0 ? sk.water_born.fill : 1);
    if (wet === 1 && st.wet === 0) st.meter = 1;                     // pushing off fills it
    else if (dx * dx + dy * dy >= need * need) st.meter += DT / fill;
    else st.meter -= DT / P.drain;
    // He has to hold a line: four times a second his heading is taken, and a turn of more than
    // turnCos (60 degrees) against where he was heading a second ago bleeds a step (once a second
    // at most). Circling a crowd, the kiter's way, empties it; runs through and past it keep it.
    if (now % 15 === 0) {
      const hx = p.x - st.ax, hy = p.y - st.ay, hd = Math.sqrt(hx * hx + hy * hy);
      st.ax = p.x; st.ay = p.y;
      const k = st.hk, o = (k + 1) % 4;   // the heading a second ago sits in the slot about to be written
      if (hd > 4) {
        const ux = hx / hd, uy = hy / hd;
        if (st[`hd${o}`] === 1 && ux * st[`hx${o}`] + uy * st[`hy${o}`] < P.turnCos && now >= st.turnAt && wet === 0) {
          st.meter -= 1 / P.steps; st.turnAt = now + TPS;
        }
        st[`hx${k}`] = ux; st[`hy${k}`] = uy; st[`hd${k}`] = 1;
      } else st[`hd${k}`] = 0;
      st.hk = o;
    }
    const floor = sk.low_bridge ? sk.low_bridge.floor / P.steps : 0;
    if (st.meter > 1) st.meter = 1; else if (st.meter < floor) st.meter = floor;
    // Slick Water: coming off the water leaves the bank slick.
    if (wet === 0 && st.wet === 1 && sk.slick_water && sl !== null) {
      const f = sk.slick_water;
      api.groundAt(world, sl.index, p.x, p.y, f.radius, f.life, 1, 0.5, listOf(world, st, 'slickList', [{ type: 'status', status: 'slow', pct: f.slow, duration: 1 }]));
      skillEvent(world, 'slick_water', p.x, p.y);
    }
    if (wet !== st.wet) { st.wet = wet; if (sk.sculling) dirty = true; }
    const step = Math.floor(st.meter * P.steps + 1e-9);
    if (step !== st.step) { st.step = step; dirty = true; world.events.push(EV.MOMENTUM, p.x, p.y, step); }
    tr.s.mo = step;
    const full = step >= P.steps;
    if (sk.dig_in) { const v = stillFor(world, st, sk.dig_in.still) ? 1 : 0; if (v !== st.dig) { st.dig = v; dirty = true; } }
    if (sk.never_stop && full && p.slowPct > 0) p.slowPct = 0;
    if (sl !== null) {
      const fx = sl.fx, s = sl.stats;
      // A vault in the air (Pole Vault): he is carried over the crowd, untouchable, and lands in a sweep.
      if (st.vaultT > 0) {
        const nx = p.x + st.vx, ny = p.y + st.vy;
        if (!world.terrain.blockedAt(nx, ny)) { p.x = nx; p.y = ny; st.lx = p.x; st.ly = p.y; }
        if (sk.long_jump && st.vaultT % 3 === 0) {
          const n = api.queryEnemies(world, p.x, p.y, sk.long_jump.width, tr.near);
          for (let k = 0; k < n; k++) if ((E.flags[tr.near[k]] & EF_GONE) === 0) dazeE(E, tr.near[k], sk.long_jump.daze);
        }
        if (p.iframes < 2) p.iframes = 2;
        if (--st.vaultT === 0) { poleSweep(world, h, sl); st.sweepAt = now + ticks(P.sweepEvery); }
      } else if (full && now >= st.sweepAt) {
        // The turn: at full Momentum the pole sweeps all round him on its own clock.
        poleSweep(world, h, sl);
        st.sweepAt = now + ticks(P.sweepEvery + (fx.long_sweep ? fx.long_sweep.every : 0));
      }
      // Pole Vault: at full Momentum, walking into a crowd vaults him over it (once every `every` s).
      if (sk.pole_vault && full && st.vaultT === 0 && p.moving && now >= st.vaultAt && now % 6 === 0) {
        const f = sk.pole_vault, ax = p.x + p.fx * f.reach, ay = p.y + p.fy * f.reach;
        const n = api.queryEnemies(world, ax, ay, f.reach, tr.near);
        let c = 0;
        for (let k = 0; k < n; k++) if ((E.flags[tr.near[k]] & EF_GONE) === 0) c++;
        if (c >= f.count) {
          const over = f.over * (sk.long_jump ? sk.long_jump.over : 1), t = ticks(f.sec);
          st.vaultT = t; st.vx = (p.fx * over) / t; st.vy = (p.fy * over) / t;
          st.vaultAt = now + ticks(f.every); st.vaults++;
          skillEvent(world, 'pole_vault', p.x, p.y);
        }
      }
      // Eddy: the whirl drags what is in it to its middle, a few times a second.
      if (st.eddyUntil >= 0) {
        if (now >= st.eddyUntil) st.eddyUntil = -1;
        else if (now % 6 === 0) {
          const n = api.queryEnemies(world, st.eddyX, st.eddyY, st.eddyR, tr.near);
          for (let k = 0; k < n; k++) { const e = tr.near[k]; if ((E.flags[e] & (EF_GONE | EF.BOSS)) === 0) pullTo(world, e, st.eddyX, st.eddyY, fx.eddy ? fx.eddy.pull : 1); }
        }
      }
      // Water Born: on land at full Momentum, a wake behind him that slows and hurts (Cold Wake: and freezes).
      if (sk.water_born && full && wet === 0 && p.moving && now >= st.wakeAt) {
        const f = sk.water_born, cold = sk.cold_wake;
        st.wakeAt = now + ticks(f.every);
        const fxs = [{ type: 'damage' }, { type: 'status', status: 'slow', pct: f.slow, duration: 1 }];
        if (cold) fxs.push({ type: 'status', status: 'freeze', duration: cold.freeze });
        api.groundAt(world, sl.index, p.x, p.y, f.radius, f.life, s.damage * f.damageMul, f.interval, listOf(world, st, 'wakeList', fxs));
      }
    }
    if (dirty) api.markStatsDirty(world);
  },
  onHit(world, h, e, slot) {
    if (slot !== h.state.sig) return;
    const sl = world.slots[slot];
    if (!sl) return;
    const fx = sl.fx, E = world.enemies, st = h.state;
    if (fx.pin) dazeE(E, e, fx.pin.daze);
    // Long Jab (ruling 18 KF, the pole's own): an enemy at the iron tip takes the hit twice.
    if (fx.long_jab && (E.flags[e] & EF_GONE) === 0) {
      const p = world.player, s = sl.stats, dx = E.x[e] - p.x, dy = E.y[e] - p.y, r = s.radius * s.area * fx.long_jab.tip;
      if (dx * dx + dy * dy >= r * r) hit(world, e, slot, s.damage);
    }
    if (!fx.bow_wave || st.step < h.params.steps || world.tick < st.bowAt) return;
    const f = fx.bow_wave;
    st.bowAt = world.tick + ticks(f.every);
    api.explodeAt(world, slot, E.x[e], E.y[e], f.radius * sl.stats.area, sl.stats.damage * f.damageMul, f.knockback, -1);
  },
  onHurt(world, h, dmg) {
    const st = h.state, sk = world.sk, p = world.player, now = world.tick, P = h.params;
    if (!(dmg > 0)) return;
    const sl = sigSlot(world, h), full = st.step >= P.steps;
    if (full && sk.pole_guard && now >= st.guardAt) {
      // Pole Guard: the hit empties the meter and does no damage.
      st.guardAt = now + ticks(sk.pole_guard.every);
      p.hp += dmg; world.result.damageTaken -= dmg;
      st.meter = 0;
      if (sk.counterpoise && sl !== null) poleSweep(world, h, sl);
      skillEvent(world, 'pole_guard', p.x, p.y);
      return;
    }
    if (full && sk.never_stop && now >= st.nsAt) {
      const f = sk.never_stop;
      st.nsAt = now + ticks(f.every);
      p.hp += dmg; world.result.damageTaken -= dmg;
      api.explodeAt(world, RELIC_SLOT, p.x, p.y, f.radius, 1, f.knockback, -1);
      skillEvent(world, 'never_stop', p.x, p.y);
      return;
    }
    // His cost: a hit knocks him off his stride, `hitSteps` steps of Momentum.
    const floor = sk.low_bridge ? sk.low_bridge.floor / P.steps : 0;
    st.meter -= P.hitSteps / P.steps;
    if (st.meter < floor) st.meter = floor;
  },
};

// ---------------------------------------------------------------- the Bog Warden

const CORPSES = 12;   // the fresh dead she could still raise by walking over them (a ring: c<k>x, c<k>y, c<k>t, c<k>e the enemy type)

/** Her thralls' numbers now (one object for the run, on the trade): the signature's grasp sets the bite. */
function thrallParams(world, h, sl) {
  const tr = world.trade, P = h.params, sk = world.sk;
  if (!tr.tp) tr.tp = { sec: 0, max: 0, damage: 0, every: P.every, speed: P.speed, reach: P.reach };
  const T = tr.tp, fx = sl !== null ? sl.fx : null;
  T.sec = P.sec * (fx && fx.bog_host ? fx.bog_host.secMul : 1) * (sk.the_host ? sk.the_host.secMul : 1) + (fx && fx.peat_fire ? fx.peat_fire.sec : 0);
  T.max = sk.barrow_wight ? 1 : Math.round(P.max * (sk.the_host ? sk.the_host.maxMul : 1));
  T.damage = (sl !== null ? sl.stats.damage : 10) * P.biteMul;
  return T;
}

/** The Barrow Wight's index among her dead, or -1. */
function wightOf(A) { for (let k = 0; k < A.n; k++) if (A.risen[k] === ALLY.WIGHT) return k; return -1; }

/** One of the dead gets up at (x, y) for her (or feeds the wight). Returns true when it did. */
function raiseOne(world, h, sl, type, x, y, elite) {
  const A = world.allies, st = h.state, sk = world.sk, P = h.params, T = thrallParams(world, h, sl);
  if (sk.barrow_wight) {
    let w = wightOf(A);
    if (w < 0) {
      w = raiseThrallAt(world, type, x, y, T, false);
      if (w < 0) return false;
      A.risen[w] = ALLY.WIGHT; A.life[w] = 1; st.feeds = 0;
    } else {
      if (st.feeds < sk.barrow_wight.feeds) st.feeds++;
      A.raised++; world.result.thralls++;
    }
    A.bite[w] = T.damage * 2 * (1 + sk.barrow_wight.per * st.feeds);
    A.radius[w] = world.enemyDefs[A.type[w]].radius * (1.3 + 0.04 * st.feeds);
    return true;
  }
  const k = raiseThrallAt(world, type, x, y, T, elite && sk.fresh_graves !== undefined);
  if (k < 0) return false;
  if (elite) { A.bite[k] *= P.eliteMul; A.radius[k] *= 1.3; if (sk.fresh_graves) A.life[k] *= sk.fresh_graves.secMul; }
  // Long Barrow (ruling 18 KF: in place of a third gem pull): her dead stand longer.
  if (sk.thrall_fetch) A.life[k] *= 1 + sk.thrall_fetch.life;
  return true;
}

/** A thrall's time is up (sim/allies.js A.onFall): Death Rattle and Peat Fire burst; Second Burial raises it once more. */
function thrallFalls(world, k) {
  const A = world.allies, tr = world.trade, h = tr.hk, sk = world.sk, E = world.enemies;
  const sl = sigSlot(world, h), fx = sl !== null ? sl.fx : null;
  if (A.risen[k] === ALLY.RISEN) return false;
  if (sk.death_rattle) { api.explodeAt(world, RELIC_SLOT, A.x[k], A.y[k], sk.death_rattle.radius, A.bite[k] * sk.death_rattle.bites, 0.5, -1); }
  if (fx && fx.peat_fire) {
    const f = fx.peat_fire, n = api.queryEnemies(world, A.x[k], A.y[k], f.radius, tr.near);
    for (let q = 0; q < n; q++) { const e = tr.near[q]; if ((E.flags[e] & EF_GONE) !== 0) continue; { const had = E.hp[e]; creditDead(world, A, hit(world, e, RELIC_SLOT, A.bite[k] * f.bites), had); } if ((E.flags[e] & EF_GONE) === 0) rotE(E, e, f.rot, f.amp); }
    world.events.push(EV.WAVE, A.x[k], A.y[k], f.radius);
  }
  if (sk.second_burial && A.again[k] === 0) {
    A.again[k] = 1; A.life[k] = thrallParams(world, h, sl).sec * sk.second_burial.secMul;
    skillEvent(world, 'second_burial', A.x[k], A.y[k]);
    return true;
  }
  return false;
}

const bog_warden = {
  needs: ['sec', 'max', 'biteMul', 'every', 'speed', 'reach', 'eliteMul', 'others', 'walkRadius', 'walkEvery', 'freshSec', 'bossRot', 'bossAmp', 'bossEvery', 'guardPer', 'guardCap'],
  init(world, h) {
    setupTrade(world, h);
    const st = h.state, A = world.allies, p = world.player;
    world.trade.hk = h;
    st.ringAt = 0; st.walkAt = 0; st.shadowAt = 0; st.bonesAt = 0; st.fetchAt = 0; st.seen = 0; st.bossAt = 0; st.feeds = 0; st.shedAt = 0; st.pallAt = 0; st.stillT = 0; st.rest = 0;
    st.rotAt = 0; st.tf = 0; st.none = 1; st.fired = 0; st.mhAt = 0; st.calls = 0; st.ci = 0; st.rotList = -1;
    for (let k = 0; k < CORPSES; k++) { st[`c${k}x`] = 0; st[`c${k}y`] = 0; st[`c${k}t`] = -1; st[`c${k}e`] = 0; }
    A.onFall = thrallFalls; A.bossRot = h.params.bossRot; A.bossAmp = h.params.bossAmp;
  },
  undo(world) { const A = world.allies; world.trade = null; A.rotSec = 0; A.rotAmp = 0; A.onFall = null; A.bossRot = 0; A.bossAmp = 0; A.rate = 1; A.gather = 0; A.guard = 0; A.guardR = 0; A.hold = 0; },
  modifyStats(world, h, mods) {
    growMods(world, mods);
    // Her cost: every weapon but Bog Hands deals less (Grave Goods: not while no thrall stands).
    const sk = world.sk;
    if (sk.grave_goods && h.state.none === 1) return;
    const less = h.params.others + (sk.borrowed_hands ? sk.borrowed_hands.might : 0);
    if (!less) return;
    mods.push({ stat: 'might', op: 'more', value: less });
    mods.push({ stat: 'might', op: 'more', value: 1 / (1 + less) - 1, weapon: 'bog_hands' });
  },
  onKill(world, h, e) {
    const E = world.enemies, f = E.flags[e];
    if ((f & (EF.BOSS | EF.SWARM)) !== 0) return;
    const sl = sigSlot(world, h), st = h.state, sk = world.sk, killer = E.killer[e];
    const mine = sl !== null && killer === sl.index;
    // What dies rotting, or in a hand's grip, gets up (Borrowed Hands: any weapon's kill).
    const rises = E.rotT[e] > 0 || mine || (sk.borrowed_hands !== undefined && killer >= 0 && killer < RELIC_SLOT);
    if (!rises || !raiseOne(world, h, sl, E.type[e], E.x[e], E.y[e], (f & EF.ELITE) !== 0)) {
      // Not raised: it lies there a while, and her call can still get it up.
      const k = st.ci; st.ci = (st.ci + 1) % CORPSES;
      st[`c${k}x`] = E.x[e]; st[`c${k}y`] = E.y[e]; st[`c${k}t`] = world.tick; st[`c${k}e`] = E.type[e];
    }
  },
  onTick(world, h) {
    const sl = sigSlot(world, h), st = h.state, P = h.params, sk = world.sk, A = world.allies, p = world.player, E = world.enemies, tr = world.trade, now = world.tick;
    const fx = sl !== null ? sl.fx : null, host = fx && fx.bog_host ? fx.bog_host : null;
    const T = thrallParams(world, h, sl);
    A.rotSec = host !== null ? host.rot : 0; A.rotAmp = host !== null ? host.amp : 0;
    // Warden's Rest and Dead March: her dead keep round her, and bite faster.
    const rest = sk.wardens_rest && stillFor(world, st, sk.wardens_rest.still) ? 1 : 0, march = fx && fx.dead_march ? fx.dead_march : null;
    A.rate = (rest === 1 ? sk.wardens_rest.rate : 1) * (march !== null ? march.rate : 1);
    A.gather = rest === 1 || march !== null ? 1 : 0; A.gatherR = march !== null ? march.radius : 60;
    A.guard = P.guardR > 0 ? 1 : 0; A.guardR = P.guardR ?? 0; A.hold = P.hold ?? 0;
    alliesStep(world, T);
    tradeStep(world);
    // The dead that rose since last tick (hers and the map's): the track, and Thrall Fetch.
    if (A.raised > st.seen) {
      const d = A.raised - st.seen;
      st.seen = A.raised;
      capDeed(world, d);
    }
    const none = A.thralls === 0 ? 1 : 0;
    if (none !== st.none) { st.none = none; if (sk.grave_goods) api.markStatsDirty(world); }
    // Ruling 20: her dead stand between her and the crowd: Armor for each one standing, up to `guardCap`.
    // Ruling 23 KD, Barrow Keeper rebuilt: her one great dead stands guard like a whole host (`armor` Armor while it stands; it never falls).
    if (now % 6 === 0) { const g = sk.barrow_wight && wightOf(A) >= 0 ? sk.barrow_wight.armor : A.thralls * h.params.guardPer; world.player.bonusArmor = g < h.params.guardCap ? g : h.params.guardCap; }
    // Ruling 23 KD: the keeper is a wall by itself. Every `sweep` s it strikes every enemy within `reach` px of it with its bite, and holds them (her dead's hold).
    if (sk.barrow_wight && sk.barrow_wight.sweep > 0 && now >= (st.sweepAt ?? 0)) {
      const w = wightOf(A);
      if (w >= 0) {
        st.sweepAt = now + ticks(sk.barrow_wight.sweep);
        const n = api.queryEnemies(world, A.x[w], A.y[w], sk.barrow_wight.reach, tr.near);
        for (let k = 0; k < n; k++) { const e = tr.near[k]; if ((E.flags[e] & EF_GONE) === 0) biteAt(world, A, w, e); }
        if (n > 0) world.events.push(EV.WAVE, A.x[w], A.y[w], sk.barrow_wight.reach);
      }
    }
    // The Barrow Wight loses a feed now and then.
    if (sk.barrow_wight && st.feeds > 0 && now >= st.shedAt) {
      st.shedAt = now + ticks(sk.barrow_wight.shed);
      st.feeds--;
      const w = wightOf(A);
      if (w >= 0) { A.bite[w] = T.damage * 2 * (1 + sk.barrow_wight.per * st.feeds); A.radius[w] = world.enemyDefs[A.type[w]].radius * (1.3 + 0.04 * st.feeds); }
    }
    // A rotting boss sheds a thrall every so often: her army doesn't dry up at the fight that matters.
    if (now >= st.bossAt) {
      st.bossAt = now + ticks(P.bossEvery);
      for (let i = 0; i < E.count; i++) {
        if ((E.flags[i] & EF.BOSS) === 0 || (E.flags[i] & EF_GONE) !== 0 || E.rotT[i] <= 0) continue;
        const type = world.enemyIndex.get(world.map.id === 'salt_marsh' ? 'salted_dead' : 'drowned_sailor') ?? 0;
        raiseOne(world, h, sl, type, E.x[i] + E.radius[i] + 8, E.y[i], false);
        break;
      }
    }
    // Her trade: walking over the fresh dead raises them (one every walkEvery s at most).
    if (now >= st.walkAt && now % 3 === 0) {
      const r2 = P.walkRadius * P.walkRadius, fresh = ticks(P.freshSec);
      for (let k = 0; k < CORPSES; k++) {
        const t = st[`c${k}t`];
        if (t < 0) continue;
        if (now - t > fresh) { st[`c${k}t`] = -1; continue; }
        const cx = st[`c${k}x`] - p.x, cy = st[`c${k}y`] - p.y;
        if (cx * cx + cy * cy > r2) continue;
        if (raiseOne(world, h, sl, st[`c${k}e`], st[`c${k}x`], st[`c${k}y`], false)) {
          st[`c${k}t`] = -1; st.walkAt = now + ticks(P.walkEvery); st.calls++; tr.s.uses++; tradeDeed(world, 1);   // (the track: the dead she walks up, not what her weapons kill)
          world.events.push(EV.CALL_DEAD, p.x, p.y, 0, 1);
        }
        break;
      }
    }
    // Wight's Shadow: every few seconds the wight leaps to the biggest crowd near her, in a burst of rot.
    if (sk.wights_shadow && sl !== null && now >= st.shadowAt) {
      st.shadowAt = now + ticks(sk.wights_shadow.every);
      const w = wightOf(A), f = sk.wights_shadow;
      if (w >= 0) {
        const n = api.queryEnemies(world, p.x, p.y, f.range, tr.near);
        let best = -1, bc = 0;
        for (let k = 0; k < n && k < 16; k++) {
          const e = tr.near[k];
          if ((E.flags[e] & EF_GONE) !== 0) continue;
          const c = api.queryEnemies(world, E.x[e], E.y[e], f.radius, world.scratch.near);
          if (c > bc) { bc = c; best = e; }
        }
        if (best >= 0 && !world.terrain.blockedAt(E.x[best], E.y[best])) {
          const x = E.x[best], y = E.y[best];
          A.x[w] = A.px[w] = x; A.y[w] = A.py[w] = y;
          const m = api.queryEnemies(world, x, y, f.radius, tr.near);
          for (let k = 0; k < m; k++) if ((E.flags[tr.near[k]] & EF_GONE) === 0) rotE(E, tr.near[k], f.rot, f.amp);
          api.explodeAt(world, sl.index, x, y, f.radius, sl.stats.damage * f.damageMul, 0, -1);
          world.events.push(EV.WAVE, x, y, f.radius);
          skillEvent(world, 'wights_shadow', x, y);
        }
      }
    }
    // Tide of Bones: every few seconds her thralls charge the way she faces, each biting what it passes.
    if (sk.tide_of_bones && now >= st.bonesAt) {
      const bones = sk.tide_of_bones;
      st.bonesAt = now + ticks(bones.every);
      let sent = 0;
      for (let k = 0; k < A.n; k++) {
        if (A.risen[k] === ALLY.RISEN) continue;
        const along = bones.reach * ((sent % 4) + 1) * 0.25;
        const x = p.x + p.fx * along, y = p.y + p.fy * along;
        if (!world.terrain.blockedAt(x, y)) { A.x[k] = x; A.y[k] = y; }
        const n = api.queryEnemies(world, A.x[k], A.y[k], bones.width + A.radius[k], tr.near);
        for (let q = 0; q < n; q++) if ((E.flags[tr.near[q]] & EF_GONE) === 0) biteAt(world, A, k, tr.near[q]);
        A.cd[k] = T.every;
        sent++;
      }
      if (sent > 0) skillEvent(world, 'tide_of_bones', p.x, p.y, sent);
    }
    if (sl === null) return;
    const s = sl.stats;
    // Rot Walk: with enough of her dead standing, she leaves rot where she walks.
    if (sk.rot_walk && A.thralls >= sk.rot_walk.count && p.moving && now >= st.rotAt) {
      const f = sk.rot_walk;
      st.rotAt = now + ticks(f.every);
      api.groundAt(world, sl.index, p.x, p.y, f.radius, f.life, s.damage * 0.15, 0.5, listOf(world, st, 'rotList', [{ type: 'damage' }, { type: 'status', status: 'rot', duration: f.rot, amp: f.amp }]));
    }
    // Grave Reach: with each grasp, a hand rises beside each of her thralls too.
    if (fx.grave_reach && sl.fired !== st.fired) {
      st.fired = sl.fired;
      const f = fx.grave_reach;
      let n = 0;
      for (let k = 0; k < A.n && n < f.n; k++) {
        if (A.risen[k] === ALLY.RISEN) continue;
        const t = world.enemyHash.nearest(A.x[k], A.y[k], f.range, E.flags, EF_GONE, -1);
        if (t < 0) continue;
        n++;
        hit(world, t, sl.index, s.damage);
        if ((E.flags[t] & EF_GONE) === 0) { rotE(E, t, f.rot, f.amp); dazeE(E, t, f.daze); }
      }
    }
    if (!fx.mire_ring || now < st.ringAt) return;
    const f = fx.mire_ring, r = f.radius * s.area;
    st.ringAt = now + ticks(f.every);
    const n = api.queryEnemies(world, p.x, p.y, r, tr.near);
    for (let k = 0; k < n; k++) {
      const e = tr.near[k];
      if ((E.flags[e] & EF_GONE) !== 0) continue;
      rotE(E, e, f.rot, f.amp);
      hit(world, e, sl.index, s.damage * f.damageMul);
    }
    world.events.push(EV.WAVE, p.x, p.y, r);
  },
  onHit(world, h, e, slot) {
    if (slot !== h.state.sig) return;
    const sl = world.slots[slot];
    if (!sl) return;
    const fx = sl.fx, E = world.enemies;
    // Mire Grip (ruling 18 KF, the mire's own): where a grasp takes hold, the ground churns a while.
    if (fx.mire_grip) { const f = fx.mire_grip, s = sl.stats; api.groundAt(world, slot, E.x[e], E.y[e], s.radius * s.area * f.radius, f.life, s.damage * f.damageMul, f.interval, listOf(world, h.state, 'gripList', DAMAGE_ONLY)); }
    if (fx.deep_hold) {
      const f = fx.deep_hold;
      dazeE(E, e, f.daze); if (E.rotAmp[e] < f.amp) E.rotAmp[e] = f.amp;
      // The hold squeezes (C2b, Nov 20): while it holds, the grip under it hurts, `squeeze` of the hand's damage every `interval` s.
      if (f.squeeze > 0 && (E.flags[e] & (EF_GONE | EF.BOSS)) === 0) api.groundAt(world, slot, E.x[e], E.y[e], E.radius[e] + 2, f.daze, sl.stats.damage * f.squeeze, f.interval, listOf(world, h.state, 'gripList', DAMAGE_ONLY));
    }
    // Many Hands (ruling 17 W4: on the grasp, not the kill): a grasp also reaches for the nearest enemy beside it, once every `every` s.
    const st = h.state;
    if (fx.many_hands && world.tick >= st.mhAt) {
      const m = fx.many_hands, t = world.enemyHash.nearest(E.x[e], E.y[e], m.range, E.flags, EF_GONE, e);
      st.mhAt = world.tick + ticks(m.every);
      if (t >= 0) { hit(world, t, slot, sl.stats.damage * m.damageMul); if ((E.flags[t] & EF_GONE) === 0) { rotE(E, t, 3, 0.25); dazeE(E, t, 0.5); } }
    }
    if (fx.cold_fingers) slowE(E, e, fx.cold_fingers.slow, fx.cold_fingers.sec);
  },
  onHurt(world, h, dmg) {
    // Pallbearers: the hit falls on her nearest thrall instead.
    const sl = sigSlot(world, h), st = h.state, A = world.allies, p = world.player;
    if (!(dmg > 0) || sl === null || !sl.fx.pallbearers || world.tick < st.pallAt) return;
    let best = -1, bd = Infinity;
    for (let k = 0; k < A.n; k++) {
      if (A.risen[k] !== ALLY.THRALL) continue;
      const dx = A.x[k] - p.x, dy = A.y[k] - p.y, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = k; }
    }
    if (best < 0) return;
    st.pallAt = world.tick + ticks(sl.fx.pallbearers.every);
    p.hp += dmg; world.result.damageTaken -= dmg;
    removeAlly(world, best);
  },
};

// ---------------------------------------------------------------- the Drowned Man

/** A penny finishes enemy e (under the share of health his pennies finish at). */
function finish(world, h, sl, e) {
  const E = world.enemies, st = h.state, P = h.params, sk = world.sk, fx = sl.fx, p = world.player, tr = world.trade, s = tr.s;
  const x = E.x[e], y = E.y[e];
  hit(world, e, sl.index, E.hp[e] + 1);
  st.fin++;
  const cold = sk.cold_hands !== undefined && world.tick >= st.coldAt;
  if (cold) st.coldAt = world.tick + ticks(sk.cold_hands.every);
  if (cold || fx.cold_coin) {
    const r = Math.max(cold ? sk.cold_hands.radius : 0, fx.cold_coin ? fx.cold_coin.radius : 0), n = api.queryEnemies(world, x, y, r, tr.near);
    for (let k = 0; k < n; k++) {
      const o = tr.near[k];
      if (o === e || (E.flags[o] & EF_GONE) !== 0) continue;
      if (cold) freezeE(E, o, sk.cold_hands.freeze);
      if (fx.cold_coin) slowE(E, o, fx.cold_coin.slow, fx.cold_coin.sec);
    }
  }
}

const drowned_man = {
  needs: ['short', 'below', 'pay', 'payEvery', 'finish', 'bossFee'],
  init(world, h) {
    setupTrade(world, h);
    const st = h.state, s = world.trade.s;
    st.short = 0; st.fin = 0; st.coin = 0; st.paid = 0; st.lastCoin = 0; st.owed = 0; st.twoAt = 0; st.coldAt = 0; st.feeAt = 0; st.payAt = 0; st.eyesAt = 0; st.fills = 0; st.toss = 0; st.purseQ = 0;
    s.purse = 0; s.crates = 0; s.seaN = 0; s.slots0 = 0; s.markOn = 0; s.markX = 0; s.markY = 0; s.markAt = 0; s.markOwed = 0;
  },
  undo(world) { world.trade = null; },
  onTick(world, h) {
    const st = h.state, sk = world.sk, p = world.player, tr = world.trade, s = tr.s, now = world.tick;
    // The run's slots are set once the world is made (RunConfig), so his are taken on the first tick.
    if (st.short === 0) {
      st.short = 1;
      const b = world.build;
      s.slots0 = b.weaponSlots;
      b.weaponSlots = Math.max(2, b.weaponSlots - h.params.short);
      api.markStatsDirty(world);
    }
    tradeStep(world);
    const need = purseNeed(world);
    if (s.purse > need) s.purse = need;
    if (sk.heavy_purse) p.bonusArmor = (sk.heavy_purse.armor * s.purse) / need;
    // Ruling 23 KE: the purse weighs his pennies. A quarter of a full purse at a time, so the stats step, not slide.
    if (h.params.purseMight > 0) { const q = Math.floor((4 * s.purse) / need + 1e-9); if (q !== st.purseQ) { st.purseQ = q; api.markStatsDirty(world); } }
    // (Ruling 17 W4: on clocks, not finishes.) Two Coins: every `every` s a throw comes at once.
    // King's Coin: the pennies' damage grows `per` a minute, to its cap. Ferryman's Fee: each time
    // the purse fills, a Pearl.
    const sl0 = sigSlot(world, h);
    if (sl0 !== null && sl0.fx.two_coins && now >= st.twoAt) { sl0.cd = 0; st.twoAt = now + ticks(sl0.fx.two_coins.every); }
    if (sk.coin_of_the_realm && now % (60 * TPS) === 0 && now > 0) {
      const c = Math.min(sk.coin_of_the_realm.cap, sk.coin_of_the_realm.per * Math.floor(now / (60 * TPS)));
      if (c !== st.coin) { st.coin = c; api.markStatsDirty(world); }
    }
    if (s.purse >= need && st.fills === 0) { st.fills = 1; if (sl0 !== null && sl0.fx.ferrymans_fee && now >= st.feeAt) { st.feeAt = now + ticks(sl0.fx.ferrymans_fee.gap); addGlass(world, 1, p.x, p.y); } }
    if (s.purse < need) st.fills = 0;
    const sl = sigSlot(world, h);
    // Paid in Advance (ruling 18 KC): each crate he has brought up this run, up to `max`, adds to the pennies.
    if (sl !== null && sl.fx.paid_in_advance) { const v = Math.min(sl.fx.paid_in_advance.max, s.crates ?? 0); if (v !== st.paid) { st.paid = v; api.markStatsDirty(world); } }
    // His trade: a full purse is paid to the sea, and it marks a crate (at most one every markGap s).
    if (s.purse >= need && s.markOn === 0 && now >= s.markAt) {
      if (sk.wash_up) {
        // Wash Up: the crate comes up at his feet, no walk.
        s.purse = 0; s.markAt = now + ticks(tr.P.markGap);
        const owed = st.owed === 1; st.owed = 0;
        crateUp(world, p.x, p.y + 12, CHEST_ELITE, owed);
      } else if (markCrate(world, sk.deep_water ? sk.deep_water.far : 1)) {
        s.purse = 0; s.markAt = now + ticks(tr.P.markGap); s.markOwed = st.owed; st.owed = 0;
        world.events.push(EV.TRADE, s.markX, s.markY, TRADE.MARK, 1);
      }
      if (st.paid !== 0 && s.purse === 0) { st.paid = 0; api.markStatsDirty(world); }
    }
    // Walking to the marked crate brings it up (Deep Water: it holds a boss chest's worth).
    if (s.markOn === 1) {
      const r = tr.P.ring + world.tuning.player.radius, dx = p.x - s.markX, dy = p.y - s.markY;
      if (dx * dx + dy * dy <= r * r) {
        s.markOn = 0;
        world.events.push(EV.TRADE, s.markX, s.markY, TRADE.MARK, 0);
        const owed = s.markOwed === 1; s.markOwed = 0;
        crateUp(world, s.markX, s.markY, sk.deep_water ? CHEST_BOSS : CHEST_ELITE, owed);
      }
    }
  },
  onBossKill(world, h) {
    // Old Debts: a boss's death fills the purse, and the crate it buys is a sea chest.
    if (!world.sk.old_debts) return;
    world.trade.s.purse = purseNeed(world);
    h.state.owed = 1;
  },
  modifyStats(world, h, mods) {
    growMods(world, mods);
    const st = h.state, sk = world.sk, s = world.trade ? world.trade.s : null, W = 'grave_pennies';
    const sl = sigSlot(world, h);
    if (s === null) return;
    if (sk.empty_hands && s.seaN > 0) mods.push({ stat: 'amount', op: 'add', value: sk.empty_hands.amount * s.seaN, weapon: W });
    if (sk.coin_of_the_realm && st.coin > 0) mods.push({ stat: 'might', op: 'more', value: st.coin, weapon: W });
    if (sl === null) return;
    if (sl.fx.full_purse && s.seaN > 0) mods.push({ stat: 'amount', op: 'add', value: s.seaN, weapon: W });
    if (sl.fx.paid_in_advance && st.paid > 0) mods.push({ stat: 'might', op: 'more', value: sl.fx.paid_in_advance.per * st.paid, weapon: W });
    if (h.params.purseMight > 0 && st.purseQ > 0) mods.push({ stat: 'might', op: 'more', value: (h.params.purseMight * st.purseQ) / 4, weapon: W });
  },
  onHit(world, h, e, slot) {
    if (slot !== h.state.sig) {
      // (Ruling 19 KK: any of his weapons pays the purse too, when it brings an enemy close to him under
      // `finish` of its health; the same once-a-payEvery clock as the pennies, so it is no faster.)
      const E = world.enemies, P = h.params, st = h.state, p = world.player;
      if (slot >= RELIC_SLOT || world.tick < st.payAt || (E.flags[e] & EF_GONE) !== 0 || !(E.hp[e] < E.maxHp[e] * P.finish)) return;
      const dx = E.x[e] - p.x, dy = E.y[e] - p.y;
      if (dx * dx + dy * dy > P.pay * P.pay && !world.sk.charons_change) return;
      const s = world.trade.s, need = purseNeed(world);
      if (s.purse < need) { s.purse += 1; st.payAt = world.tick + ticks(P.payEvery); }
      return;
    }
    const sl = world.slots[slot];
    if (!sl) return;
    const E = world.enemies, fx = sl.fx, f = E.flags[e];
    // Ruling 21 KD: the great pay the ferryman more: a penny hits a boss harder.
    if ((f & EF.BOSS) !== 0 && (f & EF_GONE) === 0) hit(world, e, slot, sl.stats.damage * h.params.bossFee);
    // Heads or Tails (ruling 18 KF, the coin's own): every second penny that hits strikes again as hard.
    if (fx.heads_or_tails && (f & EF_GONE) === 0 && ++h.state.toss % fx.heads_or_tails.every === 0) hit(world, e, slot, sl.stats.damage);
    if ((f & (EF.BOSS | EF_GONE)) !== 0) return;
    if (fx.weighed_down) {
      const w = fx.weighed_down, amp = E.openAmp[e] + w.amp, slow = E.slowPct[e] + w.slow;
      E.openAmp[e] = amp < w.amp * w.max ? amp : w.amp * w.max; E.openT[e] = w.sec;
      E.slowPct[e] = slow < w.slow * w.max ? slow : w.slow * w.max; E.slowT[e] = w.sec;
    }
    // His purse (ruling 17 W4: from pennies that land, never from kills): a penny that hits within
    // `pay` of him pays one in, at most one every payEvery s (Close Reckoning: two, close; Charon's
    // Change: from anywhere on screen).
    const p = world.player, dx = E.x[e] - p.x, dy = E.y[e] - p.y, d2 = dx * dx + dy * dy, st = h.state, P = h.params, s = world.trade.s;
    const close = fx.close_reckoning && d2 <= fx.close_reckoning.radius * fx.close_reckoning.radius;
    if (world.tick >= st.payAt && (d2 <= P.pay * P.pay || world.sk.charons_change)) {
      const need = purseNeed(world);
      if (s.purse < need) { s.purse += close ? fx.close_reckoning.pay : 1; if (s.purse > need) s.purse = need; st.payAt = world.tick + ticks(P.payEvery); }
    }
    if (close) { hit(world, e, slot, sl.stats.damage * fx.close_reckoning.mul); if ((E.flags[e] & EF_GONE) !== 0) return; }
    // Pennies on the Eyes: each penny also hits the nearest enemy beside its target, for `mul` of its damage (on the hit, once every `every` s at most).
    if (fx.eyes_paid && world.tick >= st.eyesAt) {
      st.eyesAt = world.tick + ticks(fx.eyes_paid.every);
      const t = world.enemyHash.nearest(E.x[e], E.y[e], fx.eyes_paid.range, E.flags, EF_GONE, e);
      if (t >= 0) hit(world, t, slot, sl.stats.damage * fx.eyes_paid.mul);
      if ((E.flags[e] & EF_GONE) !== 0) return;
    }
    // The finish: an ordinary enemy under a share of its health (an elite, under less, with the Ferryman's Fee).
    const below = (f & EF.ELITE) !== 0 ? (fx.ferrymans_fee ? fx.ferrymans_fee.elite : 0) : fx.eyes_paid ? fx.eyes_paid.below : h.params.below;
    if (below > 0 && E.hp[e] <= E.maxHp[e] * below) finish(world, h, sl, e);
  },
  onHurt(world, h) {
    // Last Coin: once a run, a blow that would kill him with a full purse empties it instead.
    const sk = world.sk, p = world.player, s = world.trade.s, st = h.state;
    if (!sk.last_coin || st.lastCoin === 1 || p.hp > 0 || s.purse < purseNeed(world)) return;
    st.lastCoin = 1; s.purse = 0;
    p.hp = world.stats.maxHp * sk.last_coin.hp;
    if (p.iframes < TPS) p.iframes = TPS;
    skillEvent(world, 'last_coin', p.x, p.y);
  },
};

// ---------------------------------------------------------------- the Tide Priest

/** Her clock's length now, s (Neap Priest and One Great Tide set their own). */
function tideEvery(world, h) {
  const sk = world.sk;
  return sk.neap_priest ? sk.neap_priest.every : sk.one_great_tide ? sk.one_great_tide.every : h.params.every;
}

/** The ebb: everything in reach is dragged toward her and slowed. `called`: she called it (stronger). */
function ebb(world, h, sl, called) {
  const st = h.state, P = h.params, sk = world.sk, fx = sl.fx, p = world.player, E = world.enemies, tr = world.trade, s = sl.stats;
  const r = s.radius * s.area * (fx.moons_pull ? fx.moons_pull.reach : 1) * (fx.neap_pull ? fx.neap_pull.reach : 1), every = tideEvery(world, h);
  const dmg = fx.drowning_tide ? 0 : s.damage * P.ebbMul * (called ? P.callMul : 1);
  const n = api.queryEnemies(world, p.x, p.y, r, tr.near);
  let caught = 0;
  for (let k = 0; k < n; k++) {
    const e = tr.near[k];
    if ((E.flags[e] & EF_GONE) !== 0) continue;
    caught++;
    if ((E.flags[e] & EF.BOSS) === 0) pullTo(world, e, p.x, p.y, P.ebbPull * (called ? P.callMul : 1));
    slowE(E, e, P.ebbSlow, P.ebbSec);
    if (fx.drowning_tide) openE(E, e, fx.drowning_tide.amp, every * 0.5 + 2);
    if (sk.undertow) dazeE(E, e, sk.undertow.daze);
    if (fx.neap_pull) dazeE(E, e, fx.neap_pull.daze);
    if (called && sk.slack_water) dazeE(E, e, sk.slack_water.sec);
    if (dmg > 0) hit(world, e, sl.index, dmg);
  }
  st.ebbed = 1;
  if (called) { st.calls++; tr.s.uses++; if (caught >= tr.P.catch) tradeDeed(world, 1); if (sk.slack_water) st.t -= sk.slack_water.sec; }
  if (sk.low_water) { st.lowUntil = world.tick + ticks(sk.low_water.sec); p.speedMul = 1 + sk.low_water.speed; }
  world.events.push(EV.TIDE, p.x, p.y, 0, called ? 1 : 0, r);
  world.events.push(EV.WAVE, p.x, p.y, r);
}

/** A ring of `n` pools at `r` from (x, y) (the flood's edge: Tide Marks, the Standing Wave). */
function ringOfPools(world, slot, x, y, r, n, radius, life, damage, interval, list) {
  for (let k = 0; k < n; k++) {
    // An eighth of a turn apart from the table, then the points between by the half-angle sum.
    const a = RING_X[k & 7], b = RING_Y[k & 7];
    const cx = k < 8 ? a : (a * 0.9239 - b * 0.3827), cy = k < 8 ? b : (b * 0.9239 + a * 0.3827);
    api.groundAt(world, slot, x + cx * r, y + cy * r, radius, life, damage, interval, list);
  }
}

/** The flood has passed: her ward (or Blood Tide's healing), the deeds, and what her skills and options leave. */
function floodBroke(world, h, sl) {
  const st = h.state, P = h.params, sk = world.sk, fx = sl.fx, p = world.player, tr = world.trade, s = sl.stats, n = st.waveN;
  // One Great Tide (ruling 21 KC, rebuilt): the great flood doesn't drain away; it stands round her as deep water a while.
  if (sk.one_great_tide && sk.one_great_tide.stand) {
    const g = sk.one_great_tide;
    api.groundAt(world, sl.index, p.x, p.y, s.radius * s.area, g.stand, s.damage * g.standMul, 0.5, listOf(world, st, 'deepList', [{ type: 'damage' }, { type: 'status', status: 'slow', pct: g.slow, duration: 1 }]));
  }
  const r = s.radius * s.area, called = st.callOn === 1;
  if (sk.blood_tide) { st.pass = 1; api.heal(world, Math.min(sk.blood_tide.max, n * sk.blood_tide.per)); st.pass = 0; }
  else {
    // (Ruling 18 follow-up: at higher Tides the sea gives her more, `wardTide` more a Tide.)
    const tm = 1 + (P.wardTide ?? 0) * (world.config.tide ?? 0);
    // Sea's Armor (Ruling 23 KA, a plain defence: nothing she is hit by moves her clock): each flood's shield is `mul` bigger, its cap too.
    const sea = sk.seas_armor ? sk.seas_armor.mul : 1;
    const max = (sk.neap_priest ? sk.neap_priest.wardMax : P.wardMax) * tm * sea;
    let w = sk.one_great_tide ? max * (sk.one_great_tide.ward ?? 1) : Math.max(P.wardMin, P.ward * n) * tm * sea;
    if (sk.one_great_tide) { if (w > p.shield) p.shield = w; st.wardFull = w; }
    if (w > max) w = max;
    if (w > p.shield) p.shield = w;
    st.wardFull = w;
    // The tide's own lift (ruling 18 follow-up): the crowd this flood caught strengthens King Tide until the next one breaks.
    const lift = Math.min(P.liftMax, n * P.liftPer);
    if (lift !== st.lift) { st.lift = lift; api.markStatsDirty(world); }
    if (w > 0) world.events.push(EV.HEAL, p.x, p.y, w, 1);
  }
  // (Ruling 17 W4: by the crowd the flood caught, not its kills.) Stillness: 1 Armor for each 10 it
  // caught, for 5s, up to 5. Tide Table: each enemy it caught brings the next beat cutPerHit sooner,
  // up to a share of the wait.
  if (sk.stillness && n >= 10) { st.still = Math.min(5, Math.floor(n / 10) * sk.stillness.still); st.stillUntil = world.tick + 5 * TPS; }
  if (fx.tide_table) { const f = fx.tide_table, cut = Math.min(n * f.cutPerHit, tideEvery(world, h) * f.maxCut); st.t += cut; }
  if (n >= tr.P.big) capDeed(world, 1);
  if (called) { st.calls++; tr.s.uses++; if (n >= tr.P.catch) tradeDeed(world, 1); if (sk.slack_water) st.t -= sk.slack_water.sec; }
  if (n >= tr.P.big) st.bigFloods++;
  if (n > st.bestFlood) st.bestFlood = n;
  if (sk.tide_marks) { const f = sk.tide_marks; ringOfPools(world, sl.index, st.fx, st.fy, r, f.n, f.radius, f.life, 1, 0.5, listOf(world, st, 'markList', [{ type: 'status', status: 'slow', pct: f.slow, duration: 1 }])); }
  if (fx.twin_tide) st.twinAt = world.tick + ticks(fx.twin_tide.delay);
  if (fx.spring_neap) st.spring = st.spring === 1 ? 0 : 1;
  if (st.callOn === 1 || fx.spring_neap) { st.callOn = 0; api.markStatsDirty(world); }
}

/** Spring Tide's thin flood: a point that runs out `reach` times the flood's reach in `sec`, then back, hitting as it passes (every 4 ticks). */
function springLine(world, st, sl, f, now) {
  const T = Math.round(f.sec * TPS), t = now - st.lineAt;
  if (t > 2 * T) { st.lineAt = -1; return; }
  if (t % 4 !== 0) return;
  const s = sl.stats, len = s.radius * s.area * f.reach, d = len * (t <= T ? t / T : (2 * T - t) / T);
  api.explodeAt(world, sl.index, st.lox + st.ldx * d, st.loy + st.ldy * d, f.width, s.damage * f.damageMul, s.knockback * 0.25, -1);
}

const tide_priest = {
  needs: ['every', 'first', 'ebbMul', 'ebbPull', 'ebbSlow', 'ebbSec', 'ward', 'wardMin', 'wardMax', 'wardSec', 'call', 'crowd', 'callMul', 'liftPer', 'liftMax', 'wardTide', 'bareHurt', 'floodRot', 'floodAmp'],
  init(world, h) {
    setupTrade(world, h);
    const st = h.state, every = tideEvery(world, h);
    st.t = every * 0.5 - Math.min(h.params.first, every * 0.5); st.ebbed = 0; st.prevCd = 0; st.callOn = 0;
    st.waveUntil = -1; st.waveN = 0; st.wardFull = 0; st.lift = 0; st.pass = 0; st.spring = 1; st.twinAt = -1; st.calls = 0; st.bigFloods = 0; st.bestFlood = 0;
    st.fx = 0; st.fy = 0; st.cut = 0; st.bells = 0; st.lowUntil = -1; st.shieldWas = 0; st.rideT = 0; st.rdx = 0; st.rdy = 0;
    st.still = 0; st.stillN = 0; st.stillUntil = 0; st.rites = 0; st.markList = -1; st.wallList = -1; st.lineAt = -1; st.deepList = -1; st.lox = 0; st.loy = 0; st.ldx = 0; st.ldy = 0;
    const sl = sigSlot(world, h);
    if (sl !== null) { sl.cd = every - st.t; st.prevCd = sl.cd; }
  },
  undo(world) { world.trade = null; world.player.speedMul = 1; },
  onHeal(world, h, amount) { return h.state.pass === 1 ? amount : 0; },
  modifyStats(world, h, mods) {
    growMods(world, mods);
    const st = h.state, sk = world.sk, W = 'king_tide', sl = sigSlot(world, h);
    if (sk.neap_priest) mods.push({ stat: 'might', op: 'more', value: sk.neap_priest.mul - 1, weapon: W });
    if (sk.one_great_tide) { mods.push({ stat: 'might', op: 'more', value: sk.one_great_tide.mul - 1, weapon: W }); mods.push({ stat: 'area', op: 'more', value: sk.one_great_tide.area, weapon: W }); }
    if (st.callOn === 1) mods.push({ stat: 'might', op: 'more', value: h.params.callMul - 1, weapon: W });
    if (st.lift > 0) mods.push({ stat: 'might', op: 'more', value: st.lift, weapon: W });
    if (sl !== null && sl.fx.spring_neap) {
      const f = sl.fx.spring_neap;
      mods.push({ stat: 'might', op: 'more', value: st.spring === 1 ? f.big : f.small, weapon: W });
      if (st.spring === 1) mods.push({ stat: 'area', op: 'more', value: f.bigArea, weapon: W });
    }
  },
  onTick(world, h) {
    tradeStep(world);
    const sl = sigSlot(world, h);
    if (sl === null) return;
    const st = h.state, sk = world.sk, p = world.player, tr = world.trade, now = world.tick, fx = sl.fx, s = sl.stats;
    const every = tideEvery(world, h);
    if (st.lineAt >= 0 && fx.spring_tide) springLine(world, st, sl, fx.spring_tide, now);
    // The flood went out (the weapon fired): the clock starts again, and what it hits is counted until it has passed.
    if (sl.cd > st.prevCd + 1) {
      st.t = 0; st.ebbed = 0; st.cut = 0;
      st.waveUntil = now + Math.round(s.duration * TPS) + 1; st.waveN = 0;
      st.fx = p.x; st.fy = p.y;
      world.events.push(EV.TIDE, p.x, p.y, 1, st.callOn, s.radius * s.area);
      // Spring Tide (ruling 18 KF): a thin flood out the way she faces and back (stepped in springLine).
      if (fx.spring_tide) { st.lineAt = now; st.lox = p.x; st.loy = p.y; st.ldx = p.fx; st.ldy = p.fy; }
      // Drowned Bells: the flood rolls out from every Fog Bell rung this run, too.
      if (sk.drowned_bells && world.tasks !== null) {
        const f = sk.drowned_bells;
        for (let i = 0; i < world.tasks.length; i++) {
          const t = world.tasks[i];
          if (t.kind !== TASK.BELL || !(t.uses > 0)) continue;
          api.explodeAt(world, sl.index, t.x, t.y, s.radius * s.area * f.radiusMul, s.damage * f.damageMul, s.knockback, -1);
          world.events.push(EV.WAVE, t.x, t.y, s.radius * s.area * f.radiusMul);
        }
      }
      // Ride the Tide: a called flood carries her out with it.
      if (st.callOn === 1 && sk.ride_the_tide) { st.rideT = ticks(sk.ride_the_tide.sec); if (p.iframes < st.rideT + 6) p.iframes = st.rideT + 6; }
    }
    if (st.waveUntil >= 0 && now >= st.waveUntil) { st.waveUntil = -1; floodBroke(world, h, sl); }
    // Her clock. The weapon's own wait is set from it each tick, so no stat or roll moves it.
    st.t += DT;
    if (st.ebbed === 0 && st.t >= every * 0.5) ebb(world, h, sl, false);
    // Her trade: in the last `call` s before a beat, a crowd within her reach calls it (checked ten times a second).
    if (st.waveUntil < 0 && st.callOn === 0 && now % 6 === 0) {
      const call = Math.min(h.params.call, every * 0.25);
      const toEbb = st.ebbed === 0 && every * 0.5 - st.t <= call, toFlood = st.ebbed === 1 && every - st.t <= call;
      if (toEbb || toFlood) {
        const E = world.enemies, n = api.queryEnemies(world, p.x, p.y, s.radius * s.area, tr.near);
        let c = 0;
        for (let k = 0; k < n; k++) if ((E.flags[tr.near[k]] & EF_GONE) === 0) c++;
        if (c >= (sk.neap_priest ? sk.neap_priest.crowd : h.params.crowd)) {
          if (toEbb) ebb(world, h, sl, true);
          else { st.callOn = 1; st.t = every; st.rdx = p.fx; st.rdy = p.fy; api.markStatsDirty(world); }
        }
      }
    }
    const left = every - st.t;
    sl.cd = left > 0 ? left : 0;
    st.prevCd = sl.cd;
    tr.s.tideT = st.t; tr.s.tideEvery = every;
    // Fog Bells rung since last tick: the track (and with Bell Ringer, the flood at once).
    const rung = world.result.bellsRung;
    if (rung > st.bells) { tradeDeed(world, tr.P.per * (rung - st.bells)); st.bells = rung; if (sk.bell_ringer && st.waveUntil < 0) { st.t = every; sl.cd = 0; st.prevCd = 0; } }
    // The Tide Ward drains away by the next flood (Sea's Armor, One Great Tide: it doesn't).
    // (Ruling 18 follow-up: wardSec 0, the ward never drains with time; only hits spend it, and only a flood breaking fills it.)
    if (h.params.wardSec > 0 && p.shield > 0 && !sk.seas_armor && !sk.one_great_tide && !sk.blood_tide) { p.shield -= (st.wardFull / h.params.wardSec) * DT; if (p.shield < 0) p.shield = 0; }
    st.shieldWas = p.shield;
    if (st.twinAt >= 0 && now >= st.twinAt) {
      st.twinAt = -1;
      const r = s.radius * s.area;
      api.explodeAt(world, sl.index, p.x, p.y, r, s.damage * fx.twin_tide.mul, s.knockback, -1);
      world.events.push(EV.WAVE, p.x, p.y, r);
    }
    if (st.rideT > 0) {
      const v = (s.radius * s.area * 0.6) / ticks(sk.ride_the_tide.sec), nx = p.x + st.rdx * v, ny = p.y + st.rdy * v;
      if (!world.terrain.blockedAt(nx, ny)) { p.x = nx; p.y = ny; }
      st.rideT--;
    }
    if (st.lowUntil >= 0 && now >= st.lowUntil) { st.lowUntil = -1; p.speedMul = 1; }
    // Stillness: Armor while the flood's kills are fresh.
    if (sk.stillness) p.bonusArmor = now < st.stillUntil ? st.still : 0;
  },
  onHurt(world, h, dmg) {
    const st = h.state, sk = world.sk, p = world.player;
    // (Ruling 23 KA: Sea's Armor no longer reads a hit taken; it lives in the shield's size, above.)
    st.shieldWas = p.shield;
    // Ruling 19 KL: her price shows in what she takes: a hit that gets past an empty ward is `bareHurt` worse
    // (the cost-off switch, `pass`, lifts it with "can't heal").
    if (st.pass !== 1 && !sk.blood_tide && dmg > 0 && p.shield <= 0 && p.hp > 0 && h.params.bareHurt > 0) {   // (Blood Tide heals her by the flood instead: no ward, and no bare price)
 const more = dmg * h.params.bareHurt; p.hp -= more; world.result.damageTaken += more; }
    // Last Rites: once a run, under 15% health, the flood at once and 2s she can't be hurt.
    if (!sk.last_rites || st.rites === 1 || !(dmg > 0) || p.hp > world.stats.maxHp * 0.15 || p.hp <= 0) return;
    st.rites = 1;
    st.t = tideEvery(world, h);
    if (p.iframes < 2 * TPS) p.iframes = 2 * TPS;
    skillEvent(world, 'last_rites', p.x, p.y);
  },
  onHit(world, h, e, slot) {
    const st = h.state;
    if (st.waveUntil < 0 || slot !== st.sig) return;
    st.waveN++;
    const sl = world.slots[slot], E = world.enemies;
    if (st.callOn === 1 && world.sk.slack_water) dazeE(E, e, world.sk.slack_water.sec);
    // Ruling 21 KC: the flood carries the candles' rot to all it catches.
    if (h.params.floodAmp > 0) rotE(E, e, h.params.floodRot, h.params.floodAmp);
    // Ruling 23 KC: the other way round. The tide feeds on what already rots: a rotting enemy takes `rotFeed` more from the flood.
    if (h.params.rotFeed > 0 && E.rotT[e] > 0 && (E.flags[e] & EF_GONE) === 0 && sl) hit(world, e, slot, sl.stats.damage * h.params.rotFeed);
    // Moon's Pull: what is within arm's length of her when the flood breaks is hit again.
    if (sl && sl.fx.moons_pull) {
      const f = sl.fx.moons_pull, dx = E.x[e] - st.fx, dy = E.y[e] - st.fy;
      if (dx * dx + dy * dy <= f.near * f.near) hit(world, e, slot, sl.stats.damage * f.mul);
    }
  },
};

export const CHARACTER_HOOKS = { lamplighter, harpooner, punter, bog_warden, drowned_man, tide_priest };
