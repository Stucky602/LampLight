// The player: movement, dash, taking damage, healing, experience and levels.
//
// Movement is the only input (brief §2): the stick or keys steer, and the dash is a movement
// tool with a cooldown and brief invulnerability, never an attack (builder's call 5).

import { DT, TPS } from './constants.js';
import { BTN_DASH } from '../lib/inputframe.js';
import { EV, END, HURT, HITSTOP } from './events.js';
import { hurtSource } from './attacks.js';
import { runHooks, filterHeal } from './hooks.js';
import { poleMove, poleSpeed, puntStep } from './trades.js';
import { pushAway } from './enemies.js';
import { endRun } from './run-result.js';
import { fpow } from '../lib/fmath.js';
import { rechargeDash, spendDash } from './dash.js';

export function createPlayer(x, y) {
  return {
    x, y, px: x, py: y,
    fx: 1, fy: 0,          // facing (last movement direction)
    vx: 0, vy: 0,          // this tick's velocity (bots and teleport-ahead read it)
    moving: false,
    hp: 100, shield: 0,
    level: 1, xp: 0, xpNext: 5,
    dashTicks: 0, dashDx: 0, dashDy: 0, dashSpeed: 0, dashCd: 0, dashStart: -1, dashEnd: -1,
    speedMul: 1,   // a character's share on the walking pace (set by their hook: C2; never the dash)
    dashCharges: 1,        // dashes ready now (ruling 16: the Dash slot's item sets how many; dashCd is the next one's recharge)
    moveT: 0, stillT: 0,   // seconds moving, and standing still, without a break (a dash counts as moving)
    ruleAt: 0,             // the tick a stance rule may fire again (Waders' rule)
    iframes: 0,            // ticks of invulnerability left
    prevButtons: 0,
    bonusArmor: 0,         // from hooks (the Harpooner)
    revivals: 0,
    // What slows you (0.9.0): midges' stings (each a share, for a while, up to a few) and a Brine
    // elite's touch. slowPct is the total now (at most tuning.player.slowMax).
    slowPct: 0, stings: 0, stingT: 0, brineT: 0,
  };
}

/**
 * XP needed to go from level L to L + 1 (data/tuning.js xp). A bump [at, amount, width] adds
 * `amount` XP spread as a triangle over the levels within `width` of `at` (0.9.0: the old one-level
 * steps at 20 and 40 stalled the run; spread out they cost the same by a few levels on).
 */
export function xpToNext(tuning, L) {
  const X = tuning.xp;
  let need;
  if (L < X.lateFrom) need = X.first + X.perLevel * (L - 1);
  else need = X.first + X.perLevel * (X.lateFrom - 2) + X.latePerLevel * (L - X.lateFrom + 1);
  for (const b of X.bumps || []) {
    const d = L > b[0] ? L - b[0] : b[0] - L;
    if (d < b[2]) need += (b[1] / b[2]) * (1 - d / b[2]);
  }
  const step = X.steps && X.steps[L];
  need += step || 0;
  need = Math.round(need);   // (whole XP before any growth)
  // Past growthFrom, each level costs `growth` times the one before (0.7.3).
  if (X.growthFrom !== undefined && L >= X.growthFrom) need = Math.round(need * fpow(X.growth, L + 1 - X.growthFrom));
  return need;
}

export function isInvulnerable(world) {
  const p = world.player;
  // (From the dawn to the run's end nothing hurts you: the Long Night is won when its last boss falls. sim/acts.js dawn)
  return p.dashTicks > 0 || p.iframes > 0 || world.config.invulnerable === true || world.god === true || (world.torc !== null && world.torc.sinkUntil >= 0) || world.director.dawn === true;
}

/** Sunk into the peat (the Bog Torc): still and untouchable until you rise. */
export function isSunk(world) { return world.torc !== null && world.torc.sinkUntil >= 0; }

function endDash(world, p) {
  const after = Math.round(dashStats(world).iframesAfter * TPS);
  if (after > p.iframes) p.iframes = after;
}

/** The dash as the Dash slot's item has it (the run's tuning when there is no item). */
function dashStats(world) { return world.dash ? world.dash.stats : { ...world.tuning.player.dash, charges: 1 }; }

/** A tick of the dash's recharge (sim/dash.js; without an item, the old single cooldown). */
function recharge(world, p) {
  if (world.dash) rechargeDash(world);
  else if (p.dashCd > 0) p.dashCd -= DT;
}

/** After the player moves: seconds moving and standing still, without a break (a dash counts as moving). */
export function stanceStep(p) {
  if (p.moving || p.dashTicks > 0) { p.stillT = 0; p.moveT += DT; } else { p.moveT = 0; p.stillT += DT; }
}

/** Step 2: movement and dash from this tick's input frame. */
export function playerStep(world, frame) {
  const p = world.player, T = world.tuning.player, st = world.stats;
  p.px = p.x; p.py = p.y;
  // An InputFrame is two axes from -127 to 127 and a button mask; anything else (a broken
  // replay, a bad caller) is read as no input rather than poisoning the run with NaN.
  let mx = frame.mx / 127, my = frame.my / 127;
  if (!(mx >= -1 && mx <= 1)) mx = 0;
  if (!(my >= -1 && my <= 1)) my = 0;
  const m2 = mx * mx + my * my;
  if (m2 > 1) { const m = Math.sqrt(m2); mx /= m; my /= m; }
  p.moving = m2 > 0.0004;
  if (p.moving) { const m = Math.sqrt(mx * mx + my * my); p.fx = mx / m; p.fy = my / m; }
  const buttons = frame.buttons | 0;
  const pressed = (buttons & BTN_DASH) !== 0 && (p.prevButtons & BTN_DASH) === 0;
  p.prevButtons = buttons;

  slowStep(world, p);
  let vx, vy, dashing = true;
  // The Punter's punt (sim/trades.js): its clock runs before he moves; with the pole spent on the
  // water, the water carries him to the bank and the stick does nothing until he's on it (a dash still goes).
  const poling = world.trade !== null && world.trade !== undefined && world.trade.grid !== null;
  const carried = poling && !isSunk(world) && puntStep(world, world.scratch.v2);
  if (isSunk(world)) {
    // Sunk into the peat: you don't move (a press does nothing), and you rise when it's over.
    p.vx = 0; p.vy = 0; p.moving = false;
    recharge(world, p);
    if (p.iframes > 0) p.iframes--;
    return;
  }
  if (p.dashTicks > 0) {
    vx = p.dashDx * p.dashSpeed; vy = p.dashDy * p.dashSpeed;
    p.dashTicks--;
    if (p.dashTicks === 0) { endDash(world, p); p.dashEnd = world.tick; }
  } else if (pressed && (world.dash ? p.dashCharges > 0 : p.dashCd <= 0)) {
    // Dash the way you're steering, or the way you last faced. It does nothing else (ruling 16).
    const D = dashStats(world);
    p.dashDx = p.fx; p.dashDy = p.fy;
    const ticks = Math.max(1, Math.round(D.time * TPS));
    p.dashSpeed = D.distance / (ticks * DT);
    if (world.dash) spendDash(world); else p.dashCd = D.cooldown * st.dashCooldown;
    vx = p.dashDx * p.dashSpeed; vy = p.dashDy * p.dashSpeed;
    p.dashTicks = ticks - 1;
    p.dashStart = world.tick; // the tick a dash began
    if (p.dashTicks === 0) { endDash(world, p); p.dashEnd = world.tick; }
    world.events.push(EV.DASH, p.x, p.y, p.dashDx, p.dashDy);
    world.dashedNow = true; // its hooks run once the enemy grid is rebuilt (world.js stepWorld)
  } else if (carried) {
    vx = world.scratch.v2[0]; vy = world.scratch.v2[1];
    p.moving = false;
    dashing = false;
  } else {
    const sp = T.speed * st.moveSpeed * p.speedMul * (1 - p.slowPct) * (poling ? poleSpeed(world) : 1); // the Punter poling (sim/trades.js)
    vx = mx * sp; vy = my * sp;
    dashing = false;
  }
  // A lure (the Harbor Maw) draws you toward it while it warns; a dash is free of it.
  const pl = world.pull;
  if (pl.ticks > 0) {
    pl.ticks--;
    if (!dashing) {
      const dx = pl.x - p.x, dy = pl.y - p.y, d = Math.sqrt(dx * dx + dy * dy);
      if (d > 1) { vx += (dx / d) * pl.speed; vy += (dy / d) * pl.speed; }
    }
  }
  p.vx = vx; p.vy = vy;
  if (vx !== 0 || vy !== 0) {
    const tr = world.trade;
    if (tr && tr.grid !== null) {
      // The Punter (0.9.0, W2): water is ground to him (his own grid, sim/trades.js).
      const r = tr.reg;
      r[0] = p.x + vx * DT; r[1] = p.y + vy * DT; r[2] = T.radius;
      poleMove(world, r);
      p.x = r[0]; p.y = r[1];
    } else {
      const out = world.scratch.v2;
      world.terrain.collide(p.x + vx * DT, p.y + vy * DT, T.radius, out);
      p.x = out[0]; p.y = out[1];
    }
  }
  recharge(world, p);
  if (p.iframes > 0) p.iframes--;
  if (st.regen > 0 && p.hp < st.maxHp) heal(world, st.regen * DT, true);
}

/** What slows you, a tick on: stings and Brine run out, and the total is told when it changes. */
function slowStep(world, p) {
  if (p.stingT > 0) { p.stingT -= DT; if (p.stingT <= 0) { p.stingT = 0; p.stings = 0; } }
  if (p.brineT > 0) { p.brineT -= DT; if (p.brineT < 0) p.brineT = 0; }
  const T = world.tuning.player.slow;
  let s = p.stings * T.sting + (p.brineT > 0 ? T.brine : 0);
  if (s > T.max) s = T.max;
  s = Math.round(s * 1000) / 1000;
  if (s !== p.slowPct) {
    const cause = p.brineT > 0 ? 2 : 1;
    p.slowPct = s;
    world.events.push(EV.PLAYER_SLOW, p.x, p.y, s, cause);
  }
}

/** A midge's sting (its touch hurt you): one more, up to tuning.player.slow.stings, all lasting stingSec from now. */
export function sting(world) {
  const p = world.player, T = world.tuning.player.slow;
  if (p.stings < T.stings) p.stings++;
  p.stingT = T.stingSec;
}

/** A Brine elite's touch: slowed for brineSec. */
export function brine(world) { world.player.brineT = world.tuning.player.slow.brineSec; }

const SRC = new Int32Array(2);

/** Record a hit taken (world.lastHurt and the hurt log ring): what, whose, which attack, how much. */
function noteHurt(world, kind, type, attack, dmg) {
  const L = world.lastHurt;
  L.tick = world.tick; L.kind = kind; L.type = type; L.attack = attack ? attack.key ?? null : null; L.name = attack ? attack.name ?? null : null; L.damage = dmg;
  const log = world.hurtLog, r = log.list[log.at];
  r.tick = L.tick; r.kind = kind; r.type = type; r.attack = L.attack; r.name = L.name; r.damage = dmg;
  log.at = (log.at + 1) % log.list.length;
  if (log.n < log.list.length) log.n++;
}

/** The last hits taken, oldest first (the death recap; a new array). */
export function hurtLogList(world) {
  const log = world.hurtLog, out = [];
  for (let k = 0; k < log.n; k++) out.push({ ...log.list[(log.at - log.n + k + log.list.length) % log.list.length] });
  return out;
}

/**
 * Damage to the player (contact, boss attacks, hostile shots). Returns what was taken. kind (HURT),
 * type (the enemy type index, -1 none), and attack (its data: key and name, or null) say what hit
 * you; with no kind, the shot or pool standing at (x, y) says (sim/attacks.js hurtSource).
 */
export function hurtPlayer(world, amount, x, y, kind = 0, type = -1, attack = null) {
  if (world.over || !(amount > 0) || isInvulnerable(world)) return 0;
  if (kind === 0) { attack = hurtSource(world, x, y, SRC); kind = SRC[0]; type = SRC[1]; }
  const p = world.player, T = world.tuning.player;
  let dmg = amount * world.enemyDamageMul - world.stats.armor - p.bonusArmor; // a Tide hits harder
  if (dmg < T.minDamageTaken) dmg = T.minDamageTaken;
  if (p.shield > 0) {
    const absorbed = p.shield < dmg ? p.shield : dmg;
    p.shield -= absorbed;
    dmg -= absorbed;
    world.events.push(EV.SHIELD_HIT, p.x, p.y, absorbed, 0, kind, type);
  }
  p.iframes = Math.round(T.contactIframes * TPS);
  noteHurt(world, kind, type, attack, dmg > 0 ? dmg : 0);
  // A real hit asks for hit-stop (never a drain); a boss's or a champion's attack asks for more.
  const big = kind === HURT.BOSS || (kind === HURT.ATTACK && attack !== null && attack.champion === true);
  world.events.push(EV.HIT_STOP, x, y, big ? HITSTOP.BOSS_HIT : HITSTOP.HURT, dmg > 0 ? dmg : 0);
  if (dmg <= 0) {
    // A shield took all of it: still a hit taken, for what answers one (Barnacle Shell).
    if (world.hooks.onHurt.length > 0) runHooks(world, 'onHurt', 0);
    return 0;
  }
  p.hp -= dmg;
  world.result.damageTaken += dmg;
  if (world.result.firstHurtTick < 0) world.result.firstHurtTick = world.tick;
  world.events.push(EV.PLAYER_HURT, x, y, dmg, p.hp > 0 ? p.hp : 0, kind, type);
  if (world.hooks.onHurt.length > 0) runHooks(world, 'onHurt', dmg);
  if (world.rules.thickcoat && dmg > 0) pushAway(world, p.x, p.y, 50, 2.5);   // the Thick Coat's rule
  if (p.hp <= 0) playerDown(world);
  return dmg;
}

/**
 * A leech's drain: health lost without a hit (no invulnerability after it, no armor), counted as
 * damage taken; never while you can't be hurt. Returns what was drained.
 */
export function drainPlayer(world, amount, type = -1) {
  if (world.over || !(amount > 0) || isInvulnerable(world)) return 0;
  const p = world.player;
  p.hp -= amount;
  world.result.damageTaken += amount;
  if (world.result.firstHurtTick < 0) world.result.firstHurtTick = world.tick;
  noteHurt(world, HURT.DRAIN, type, null, amount);
  world.events.push(EV.PLAYER_HURT, p.x, p.y, amount, p.hp > 0 ? p.hp : 0, HURT.DRAIN, type);   // no hit-stop: a drain isn't a hit
  if (p.hp <= 0) playerDown(world);
  return amount;
}

function playerDown(world) {
  const p = world.player, T = world.tuning.player;
  // The Bog Torc: once a run, instead of dying you sink into the peat (sim/hooks.js bog_torc).
  const torc = world.torc;
  if (torc !== null && torc.ready === 1) {
    torc.ready = 0;
    world.torcSpent = true;
    torc.sinkUntil = world.tick + Math.round(torc.params.sinkSec * TPS);
    p.hp = 1;
    p.dashTicks = 0;
    world.events.push(EV.SINK, p.x, p.y, 1);
    return;
  }
  if (p.revivals > 0) {
    p.revivals--;
    p.hp = world.stats.maxHp * T.reviveHpFraction;
    p.iframes = Math.round(T.reviveIframes * TPS);
    world.result.revivalsUsed++;
    world.events.push(EV.REVIVE, p.x, p.y);
    pushAway(world, p.x, p.y, T.reviveClearRadius, 3);
    return;
  }
  p.hp = 0;
  endRun(world, END.DIED);
}

/** Healing (pickups, regen). onHeal hooks may turn it into something else (a shield). */
export function heal(world, amount, quiet = false) {
  if (world.over || !(amount > 0)) return 0;
  const p = world.player;
  const left = filterHeal(world, amount * world.tideRules.healMul); // a Tide's weaker healing (data/tide.js)
  if (left <= 0) return 0;
  const before = p.hp;
  p.hp = Math.min(world.stats.maxHp, p.hp + left);
  const healed = p.hp - before;
  if (!quiet && healed > 0) world.events.push(EV.HEAL, p.x, p.y, healed, 0);
  return healed;
}

/** Experience from a gem (the growth stat multiplies it). */
export function gainXp(world, value) {
  world.player.xp += value * world.stats.growth;
}

/** Step 11: level-ups. Each one queues a draft (the level-up screen). */
export function levelCheck(world, queueDraft) {
  const p = world.player;
  // Never two level-ups inside tuning.xp.draftGap seconds: a level earned sooner waits, its XP kept.
  // (A dev command's levels come at once: world.levelNow.)
  if (world.tick < world.draftAt && world.levelNow <= 0) return;
  let guard = 0;
  while (p.xp >= p.xpNext && (guard++ < 1 || world.levelNow > 0)) {
    if (world.levelNow > 0) world.levelNow--;
    world.draftAt = world.tick + Math.round((world.tuning.xp.draftGap ?? 0) * TPS);
    p.xp -= p.xpNext;
    p.level++;
    p.xpNext = xpToNext(world.tuning, p.level);
    world.result.maxLevel = p.level;
    world.events.push(EV.LEVEL_UP, p.x, p.y, p.level);
    runHooks(world, 'onLevelUp', p.level);
    if (world.rules.almanac && p.level % 5 === 0) world.charges.reroll++;   // the Almanac's rule
    queueDraft(world);
  }
}
