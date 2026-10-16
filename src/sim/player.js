// The player: movement, dash, taking damage, healing, experience and levels.
//
// Movement is the only input (brief §2): the stick or keys steer, and the dash is a movement
// tool with a cooldown and brief invulnerability, never an attack (builder's call 5).

import { DT, TPS } from './constants.js';
import { BTN_DASH } from '../lib/inputframe.js';
import { EV, END } from './events.js';
import { runHooks, filterHeal } from './hooks.js';
import { pushAway } from './enemies.js';
import { endRun } from './run-result.js';

export function createPlayer(x, y) {
  return {
    x, y, px: x, py: y,
    fx: 1, fy: 0,          // facing (last movement direction)
    vx: 0, vy: 0,          // this tick's velocity (bots and teleport-ahead read it)
    moving: false,
    hp: 100, shield: 0,
    level: 1, xp: 0, xpNext: 5,
    dashTicks: 0, dashDx: 0, dashDy: 0, dashSpeed: 0, dashCd: 0,
    iframes: 0,            // ticks of invulnerability left
    prevButtons: 0,
    bonusArmor: 0,         // from hooks (the Harpooner)
    revivals: 0,
  };
}

/** XP needed to go from level L to L + 1 (data/tuning.js xp). */
export function xpToNext(tuning, L) {
  const X = tuning.xp;
  let need;
  if (L < X.lateFrom) need = X.first + X.perLevel * (L - 1);
  else need = X.first + X.perLevel * (X.lateFrom - 2) + X.latePerLevel * (L - X.lateFrom + 1);
  const step = X.steps && X.steps[L];
  return need + (step || 0);
}

export function isInvulnerable(world) {
  const p = world.player;
  return p.dashTicks > 0 || p.iframes > 0 || world.config.invulnerable === true || world.god === true;
}

function endDash(p, T) {
  const after = Math.round(T.dash.iframesAfter * TPS);
  if (after > p.iframes) p.iframes = after;
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

  let vx, vy, dashing = true;
  if (p.dashTicks > 0) {
    vx = p.dashDx * p.dashSpeed; vy = p.dashDy * p.dashSpeed;
    p.dashTicks--;
    if (p.dashTicks === 0) endDash(p, T);
  } else if (pressed && p.dashCd <= 0) {
    // Dash the way you're steering, or the way you last faced.
    p.dashDx = p.fx; p.dashDy = p.fy;
    const ticks = Math.max(1, Math.round(T.dash.time * TPS));
    p.dashSpeed = T.dash.distance / (ticks * DT);
    p.dashCd = T.dash.cooldown * st.dashCooldown;
    vx = p.dashDx * p.dashSpeed; vy = p.dashDy * p.dashSpeed;
    p.dashTicks = ticks - 1;
    if (p.dashTicks === 0) endDash(p, T);
    world.events.push(EV.DASH, p.x, p.y, p.dashDx, p.dashDy);
    runHooks(world, 'onDash');
  } else {
    const sp = T.speed * st.moveSpeed;
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
    const out = world.scratch.v2;
    world.terrain.collide(p.x + vx * DT, p.y + vy * DT, T.radius, out);
    p.x = out[0]; p.y = out[1];
  }
  if (p.dashCd > 0) p.dashCd -= DT;
  if (p.iframes > 0) p.iframes--;
  if (st.regen > 0 && p.hp < st.maxHp) heal(world, st.regen * DT, true);
}

/** Damage to the player (contact, boss attacks, hostile shots). Returns what was taken. */
export function hurtPlayer(world, amount, x, y) {
  if (world.over || !(amount > 0) || isInvulnerable(world)) return 0;
  const p = world.player, T = world.tuning.player;
  let dmg = amount - world.stats.armor - p.bonusArmor;
  if (dmg < T.minDamageTaken) dmg = T.minDamageTaken;
  if (p.shield > 0) {
    const absorbed = p.shield < dmg ? p.shield : dmg;
    p.shield -= absorbed;
    dmg -= absorbed;
    world.events.push(EV.SHIELD_HIT, p.x, p.y, absorbed);
  }
  p.iframes = Math.round(T.contactIframes * TPS);
  if (dmg <= 0) return 0;
  p.hp -= dmg;
  world.result.damageTaken += dmg;
  world.events.push(EV.PLAYER_HURT, x, y, dmg, p.hp > 0 ? p.hp : 0);
  if (p.hp <= 0) playerDown(world);
  return dmg;
}

function playerDown(world) {
  const p = world.player, T = world.tuning.player;
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
  const left = filterHeal(world, amount);
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
  let guard = 0;
  while (p.xp >= p.xpNext && guard++ < 1000) {
    p.xp -= p.xpNext;
    p.level++;
    p.xpNext = xpToNext(world.tuning, p.level);
    world.result.maxLevel = p.level;
    world.events.push(EV.LEVEL_UP, p.x, p.y, p.level);
    runHooks(world, 'onLevelUp', p.level);
    queueDraft(world);
  }
}
