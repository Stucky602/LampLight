// Scripted players for tests, balance sweeps, and the soak run (ARCHITECTURE §14).
//
// A bot reads the world (as a player reads the screen) and returns an InputFrame each tick,
// plus a decision whenever the run is halted. It's deterministic: the same world gives the same
// input, so a bot run replays exactly.
//
// The kiting bot steers by scoring 16 directions (context steering): for each, it looks at the
// spot it would reach in a fraction of a second and adds up the danger there (enemies by
// closeness and contact damage, warned charge lines, hazard pools, boss slams and charges,
// hostile shots, walls, the map edge), minus what it wants there (a heal when hurt, a chest, the
// magnet item, gems, a slow circle around the crowd). It takes the best direction and dashes
// when even that one is about to be hit. It plays like a careful player who never aims, which is
// the only kind of player this game has (brief §2).

import { EF, ZONE, PF, PK, AI, TASK, TASK_STATE } from './constants.js';
import { taskRadius } from './tasks.js';
import { quantizeAxis } from '../lib/inputframe.js';
import { CHARGER } from './enemies.js';
import { BOSS_STATE } from './bosses.js';
import { sincosInto, TAU } from '../lib/fmath.js';
import { optionChoices, isDrafted } from './ascend.js';
import { upgradeScore, bestTagWeight } from './weaponups.js';
import { relicsFull } from './build.js';
import { FERRY_KINDS } from './relics.js';
import { createBotPath } from './botpath.js';
import { tradeErrand } from './trades.js';
import { dashNumbers } from './dash.js';

/** Nothing solid on the straight line from (x0, y0) to (x1, y1), looked at every 8 px. */
function clearLine(terrain, x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0, steps = Math.ceil(Math.sqrt(dx * dx + dy * dy) / 8);
  for (let k = 1; k < steps; k++) if (terrain.blockedAt(x0 + (dx * k) / steps, y0 + (dy * k) / steps)) return false;
  return true;
}

const N_DIR = 16;
/** Unit vectors for the 16 directions, as x, y pairs. */
const DIRS = new Float64Array(N_DIR * 2);
{
  const sc = new Float64Array(2);
  for (let k = 0; k < N_DIR; k++) { sincosInto((k / N_DIR) * TAU, sc, 0); DIRS[2 * k] = sc[1]; DIRS[2 * k + 1] = sc[0]; }
}

const LOOK_S = 0.3;       // s ahead each probe looks
const SEE = 200;          // px: enemies farther than this are ignored
const LOOT_RANGE = 220;   // px: gems farther than this are ignored
const STANDOFF = 26;      // px between bodies: closer than this it backs off, farther it closes in
const FALLOFF = 20;       // px²: how fast an enemy's danger fades with distance

const TAGS_BY_ARCHETYPE = {
  orbit_tank: ['light', 'fire'],
  projectile_storm: ['fire', 'light'],
  burning_ground: ['fire'],
  summoner: ['echo'],
  chain_lightning: ['steel', 'sea'],
  speed_glass: ['sea', 'steel'],
};

// Passive stats that keep a player alive (the bot values them more when hurt).
const DEFENSIVE = new Set(['maxHp', 'armor', 'regen', 'moveSpeed']);

/**
 * @param {object} [o]
 * @param {string} [o.archetype] a key of TAGS_BY_ARCHETYPE (steers draft picks)
 * @param {0|1|'alt'} [o.option] which of an axis's two Form options it takes (0: the first)
 * @param {boolean} [o.stay] stay for overtime after the last boss
 * @param {number} [o.dashDistance] dash when an enemy is this close (px between bodies)
 * @param {'plain'|'careful'} [o.picker] how it drafts: 'plain' (its archetype's tags, the card's worth) or
 *   'careful' (C1, Nov 17: builds around what it holds: tags it already carries, its best weapon, partner
 *   passives, the next axis, Legendaries; see carefulScore)
 * @param {boolean} [o.follow] (0.8.2) a player who follows the edge arrows: between bosses and
 *   while healthy it heads for the nearest unlit lamp, bell not yet rung, and the Ferryman once he's
 *   tied up with something it can afford, and stays in a ring until it's done. Off by default, so
 *   the balance sweeps, the soak, and the pacing yields play as they did.
 */
export function createKiteBot({ archetype = 'projectile_storm', stay = false, dashDistance = 6, follow = false, option = 0, picker = 'plain' } = {}) {
  const prefer = TAGS_BY_ARCHETYPE[archetype] || [];
  let formsTaken = 0;   // (option 'alt': first options and second options in turn)
  const frame = { mx: 0, my: 0, buttons: 0 };
  const danger = new Float64Array(N_DIR);
  const want = new Float64Array(N_DIR);
  let dashHeld = false;
  let side = 1;
  let lastK = 0;
  let tradedCall = -1;   // (follow) the Ferryman's call it has traded at already
  const path = createBotPath(), pdir = new Float64Array(2);
  const bossPath = createBotPath();   // (to a boss behind a wall: its own field, so the errand's isn't rebuilt)   // (follow, W4) walking to an errand round walls and water

  /**
   * (follow) Where the arrows lead now: { x, y, r } (a ring to stay in), or null. A lamp or a bell
   * tolled (its kill ring), else the nearest unlit lamp, bell not rung (its start ring), or the
   * Ferryman tied up with something it can afford.
   */
  function errand(world) {
    const p = world.player, tasks = world.tasks || [];
    if (world.bosses.some((b) => b.alive) || p.hp < world.stats.maxHp * 0.4) return null;
    for (const t of tasks) if (t.kind === TASK.BELL && t.state === TASK_STATE.ACTIVE) return { x: t.x, y: t.y, r: taskRadius(world, t) * 0.55 };
    const d2 = (x, y) => (x - p.x) * (x - p.x) + (y - p.y) * (y - p.y);
    for (const t of tasks) if (t.kind === TASK.LAMP && t.state === TASK_STATE.ACTIVE && d2(t.x, t.y) < 120 * 120) return { x: t.x, y: t.y, r: taskRadius(world, t) * 0.6 };
    let best = null, bestD = Infinity;
    for (const t of tasks) {
      if (t.state === TASK_STATE.DONE) continue;
      const d = d2(t.x, t.y);
      if (d < bestD) { bestD = d; best = { x: t.x, y: t.y, r: t.kind === TASK.LAMP ? taskRadius(world, t) * 0.6 : world.tuning.tasks.bell.startRadius * 0.6 }; }
    }
    // (W4) A chest waiting on the ground (a map event's cache, the arrows point at it).
    const P = world.pickups;
    for (let i = 0; i < P.count; i++) {
      if (P.kind[i] !== PK.CHEST) continue;
      const d = d2(P.x[i], P.y[i]);
      if (d < bestD) { bestD = d; best = { x: P.x[i], y: P.y[i], r: 6 }; }
    }
    const F = world.ferry;
    if (F && F.moored && F.calls !== tradedCall && F.offers.some((o) => !o.sold && !o.gone && o.price <= world.glass && (o.kind !== FERRY_KINDS.relic || !world.build.relics.some((r) => r.id === o.id)))) {
      if (d2(F.x, F.y) < bestD) best = { x: F.x, y: F.y, r: world.tuning.ferry.radius * 0.5 };
    }
    // (W2) The character's own errand on the map, as a player who knows their trade would go to it.
    const tr = tradeErrand(world);
    if (tr !== null && d2(tr.x, tr.y) < bestD) best = tr;
    return best;
  }

  /** Add `w` to every direction by how much it points along (ux, uy) (nothing for the far side). */
  function pull(ux, uy, w) {
    for (let k = 0; k < N_DIR; k++) {
      const c = DIRS[2 * k] * ux + DIRS[2 * k + 1] * uy;
      if (c > 0) want[k] += w * c;
    }
  }

  function input(world) {
    const p = world.player, E = world.enemies, n = E.count;
    const PR = world.tuning.player.radius;
    const look = world.tuning.player.speed * world.stats.moveSpeed * LOOK_S;
    danger.fill(0);
    want.fill(0);
    let closest = 1e9, cx = 0, cy = 0, cw = 0;
    // The nearest living boss, wherever it is (a player hunts it down).
    let boss = -1, bossGap = 1e9;
    for (let bi = 0; bi < world.bosses.length; bi++) {
      const e = world.bosses[bi].alive ? E.resolve(world.bosses[bi].handle) : -1;
      if (e < 0) continue;
      const dx = E.x[e] - p.x, dy = E.y[e] - p.y;
      const gap = Math.sqrt(dx * dx + dy * dy) - E.radius[e] - PR;
      if (gap < bossGap) { boss = e; bossGap = gap; }
    }

    // Enemies: a smooth field that rises steeply near each body, plus warned charge lines.
    for (let i = 0; i < n; i++) {
      if ((E.flags[i] & EF.DEAD) !== 0) continue;
      const ex = E.x[i], ey = E.y[i];
      const dx = ex - p.x, dy = ey - p.y, d2 = dx * dx + dy * dy;
      if (d2 > SEE * SEE) continue;
      const gap = Math.sqrt(d2) - E.radius[i] - PR;
      const isBoss = (E.flags[i] & EF.BOSS) !== 0;
      if (gap < closest) closest = gap;
      cx += ex; cy += ey; cw++;
      const threat = E.contact[i] + 2;
      const touch = E.radius[i] + PR + 4;
      if (isBoss) {
        // A boss only hurts on touch (its attacks are scored below): fight it up close.
        for (let k = 0; k < N_DIR; k++) {
          const qx = p.x + DIRS[2 * k] * look - ex, qy = p.y + DIRS[2 * k + 1] * look - ey;
          if (qx * qx + qy * qy < touch * touch) danger[k] += threat;
        }
        continue;
      }
      let line = 0;
      if (E.ai[i] === AI.charger && (E.aiState[i] === CHARGER.WINDUP || E.aiState[i] === CHARGER.DASH)) {
        const def = world.enemyDefs[E.type[i]].ai;
        // (The warned line is dashSpeed x dashTime at any pace: a slower dash runs longer, tuning.pace.speed.)
        line = (E.aiState[i] === CHARGER.WINDUP ? def.dashSpeed * def.dashTime : def.dashSpeed * world.tuning.pace.speed * E.aiTimer[i]) + touch + 12;
      }
      for (let k = 0; k < N_DIR; k++) {
        const qx = p.x + DIRS[2 * k] * look - ex, qy = p.y + DIRS[2 * k + 1] * look - ey;
        const q2 = qx * qx + qy * qy;
        danger[k] += (threat * FALLOFF) / (q2 + FALLOFF);
        if (q2 < touch * touch) danger[k] += threat;
        if (line > 0) {
          const along = qx * E.dx[i] + qy * E.dy[i];
          const across = qx * E.dy[i] - qy * E.dx[i];
          if (along > -touch && along < line && across < touch + 6 && across > -touch - 6) danger[k] += 40;
        }
      }
    }

    // Hazard pools (warned or armed): worse toward the middle, so the bot walks out.
    const Z = world.zones;
    for (let z = 0; z < Z.count; z++) {
      if (Z.kind[z] !== ZONE.HAZARD) continue;
      const rz = Z.radius[z] + PR + 8;
      for (let k = 0; k < N_DIR; k++) {
        const qx = p.x + DIRS[2 * k] * look - Z.x[z], qy = p.y + DIRS[2 * k + 1] * look - Z.y[z];
        const dq = Math.sqrt(qx * qx + qy * qy);
        if (dq < rz) danger[k] += 20 + 30 * (1 - dq / rz);
      }
    }

    // Hostile shots: the stretch each will cover while the bot moves.
    const P = world.projectiles;
    for (let s = 0; s < P.count; s++) {
      if ((P.flags[s] & PF.HOSTILE) === 0) continue;
      const sx = P.x[s], sy = P.y[s];
      const ddx = sx - p.x, ddy = sy - p.y;
      if (ddx * ddx + ddy * ddy > SEE * SEE) continue;
      const vx = P.vx[s] * LOOK_S, vy = P.vy[s] * LOOK_S, v2 = vx * vx + vy * vy || 1;
      const reach = P.radius[s] + PR + 6;
      for (let k = 0; k < N_DIR; k++) {
        const qx = p.x + DIRS[2 * k] * look - sx, qy = p.y + DIRS[2 * k + 1] * look - sy;
        let t = (qx * vx + qy * vy) / v2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ox = qx - vx * t, oy = qy - vy * t;
        if (ox * ox + oy * oy < reach * reach) danger[k] += 25;
      }
    }

    // Boss slams and charges while they warn or run.
    for (let bi = 0; bi < world.bosses.length; bi++) {
      const b = world.bosses[bi];
      if (!b.alive || !b.attack || (b.state !== BOSS_STATE.WARN && b.state !== BOSS_STATE.CHARGE)) continue;
      const e = E.resolve(b.handle);
      if (e < 0) continue;
      const a = b.attack;
      for (let k = 0; k < N_DIR; k++) {
        const qx = p.x + DIRS[2 * k] * look - E.x[e], qy = p.y + DIRS[2 * k + 1] * look - E.y[e];
        if ((a.type === 'slam_ring' || a.type === 'lure') && b.state === BOSS_STATE.WARN) {
          // A lure's ring: wider, since it draws you in while it warns.
          const r = (a.type === 'lure' ? a.bite + 30 : a.radius) + PR + 10, dq = Math.sqrt(qx * qx + qy * qy);
          if (dq < r) danger[k] += 30 + 30 * (1 - dq / r);
        } else if (a.type === 'charge_line') {
          const len = (b.state === BOSS_STATE.WARN ? a.length : b.chargeLeft) + E.radius[e];
          const half = E.radius[e] + a.width * 0.25 + PR + 8;
          const along = qx * b.adx + qy * b.ady, across = qx * b.ady - qy * b.adx;
          if (along > -half && along < len && across < half && across > -half) danger[k] += 45;
        }
      }
    }

    // Walls and the map edge.
    const terrain = world.terrain, W = terrain.width, H = terrain.height, edge = 64;
    for (let k = 0; k < N_DIR; k++) {
      const ux = DIRS[2 * k], uy = DIRS[2 * k + 1];
      const qx = p.x + ux * look, qy = p.y + uy * look;
      if (terrain.blockedAt(qx, qy) || terrain.blockedAt(p.x + ux * look * 0.5, p.y + uy * look * 0.5)) danger[k] += 50;
      if (qx < edge) danger[k] += ((edge - qx) / edge) * 4;
      if (qx > W - edge) danger[k] += ((qx - (W - edge)) / edge) * 4;
      if (qy < edge) danger[k] += ((edge - qy) / edge) * 4;
      if (qy > H - edge) danger[k] += ((qy - (H - edge)) / edge) * 4;
    }

    // What it wants: a boss between attacks gets circled close, where orbits and auras reach
    // it; otherwise circle the crowd at weapon range (close enough for orbits and auras to
    // work, never so close it gets touched), then loot.
    // (Below 40% health it stops pressing the boss and plays safe until it finds a heal.)
    const bs = boss >= 0 && E.boss[boss] >= 0 ? world.bosses[E.boss[boss]] : null;
    if (bs && bs.state !== BOSS_STATE.WARN && bs.state !== BOSS_STATE.CHARGE && p.hp > world.stats.maxHp * 0.4) {
      const dx = E.x[boss] - p.x, dy = E.y[boss] - p.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
      pull((-dy / d) * side, (dx / d) * side, 0.4);
      // (0.9.0 release) Round walls and water when the straight line to it is shut: on the Marsh at
      // high water a straight pull held the bot against a bank in a pocket the boss couldn't enter,
      // and the Long Night never ended (stays runs at salt_marsh stages 1 and 3 ran out at 45:00).
      // Along that way it goes firmly (over the map edge's soft push, which a way along the edge met
      // at the same weight), though never into a wall or onto an enemy.
      if (bossGap > 12 && !clearLine(terrain, p.x, p.y, E.x[boss], E.y[boss]) && bossPath.dirTo(world, p.x, p.y, E.x[boss], E.y[boss], pdir)) pull(pdir[0], pdir[1], bossGap > 120 ? 5 : 0.5);
      else if (bossGap > 12) pull(dx / d, dy / d, bossGap > 120 ? 0.9 : 0.5);
    } else if (cw > 0) {
      const dx = p.x - cx / cw, dy = p.y - cy / cw, d = Math.sqrt(dx * dx + dy * dy) || 1;
      pull((-dy / d) * side, (dx / d) * side, 0.3);
      if (closest > STANDOFF) pull(-dx / d, -dy / d, closest > STANDOFF * 3 ? 0.5 : 0.25);
      if ((world.tick % 1800) === 0) side = -side;
    }
    const hurt = p.hp < world.stats.maxHp * 0.7;
    const Pk = world.pickups;
    let bestPk = -1, bestPkW = 0;
    for (let i = 0; i < Pk.count; i++) {
      const kind = Pk.kind[i];
      const w = kind === PK.HEAL ? (hurt ? 1.2 : 0) : kind === PK.CHEST ? 0.8 : kind === PK.MAGNET ? 0.6 : 0.25;
      if (w === 0) continue;
      const dx = Pk.x[i] - p.x, dy = Pk.y[i] - p.y, d2 = dx * dx + dy * dy;
      if (d2 > 400 * 400) continue;
      const score = w / (1 + d2 / 40000);
      if (score > bestPkW) { bestPkW = score; bestPk = i; }
    }
    // (0.9.0 release) Not one behind a wall or water: pulled straight at it, the bot held still
    // against the bank, a step toward it and a step back, whatever else it was going to.
    if (bestPk >= 0 && !clearLine(terrain, p.x, p.y, Pk.x[bestPk], Pk.y[bestPk])) bestPk = -1;
    if (bestPk >= 0) {
      const dx = Pk.x[bestPk] - p.x, dy = Pk.y[bestPk] - p.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
      pull(dx / d, dy / d, bestPkW);
    }
    const G = world.gems;
    let gx = 0, gy = 0, gBest = LOOT_RANGE * LOOT_RANGE;
    for (let i = 0; i < G.count; i++) {
      const dx = G.x[i] - p.x, dy = G.y[i] - p.y, d2 = dx * dx + dy * dy;
      if (d2 < gBest) { gBest = d2; gx = dx; gy = dy; }
    }
    if (gx !== 0 || gy !== 0) { const d = Math.sqrt(gx * gx + gy * gy); pull(gx / d, gy / d, 0.3); }
    else if (cw === 0 && bestPk < 0) {
      // Nothing around: wander toward the middle of the map.
      const dx = W / 2 - p.x, dy = H / 2 - p.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
      pull(dx / d, dy / d, 0.1);
    }
    // (follow) What the arrows point at: head for it, and once there stay in its ring.
    if (follow) {
      const job = errand(world);
      if (job) {
        const dx = job.x - p.x, dy = job.y - p.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
        if (d > job.r) {
          if (path.dirTo(world, p.x, p.y, job.x, job.y, pdir)) pull(pdir[0], pdir[1], d > 200 ? 0.6 : 1.2);
          else pull(dx / d, dy / d, d > 200 ? 0.6 : 1.2);
        }
      }
      const F = world.ferry;
      if (F && F.moored && !F.armed) tradedCall = F.calls;
    }
    // A little momentum so it doesn't jitter between two equal choices.
    pull(DIRS[2 * lastK], DIRS[2 * lastK + 1], 0.08);

    let best = 0, bestS = -1e18;
    for (let k = 0; k < N_DIR; k++) {
      const s = want[k] - danger[k];
      if (s > bestS) { bestS = s; best = k; }
    }
    lastK = best;
    frame.mx = quantizeAxis(DIRS[2 * best]);
    frame.my = quantizeAxis(DIRS[2 * best + 1]);
    // Dash when even the best way is about to be hit, or something is already on top of you.
    const wantDash = (danger[best] > 8 || closest < dashDistance) && (world.dash ? p.dashCharges > 0 : p.dashCd <= 0) && p.dashTicks === 0;
    frame.buttons = wantDash && !dashHeld ? 1 : 0;
    dashHeld = frame.buttons !== 0;
    return frame;
  }

  function scoreCard(world, c) {
    const hurt = world.player.hp < world.stats.maxHp * 0.5;
    if (c.kind === 'heal') return hurt ? 50 : 1;
    if (c.kind === 'coin') return 0.5;
    // The Dash slot (ruling 16): a card for the held item is a small pick; another item, a smaller one.
    // The bot takes the held item's first two cards and a second charge when offered; it swaps only
    // for an item that holds more dashes than the one it has.
    if (c.kind === 'dash') {
      if (!c.isNew) return (world.dash?.ups.length ?? 0) < 2 || c.up === 'dash_charges' ? 24 : 9;
      const d = world.dashDefs.find((x) => x.id === c.id);
      return (d?.charges ?? 1) > (world.dash?.stats.charges ?? 1) ? 24 : 6;
    }
    let s = 10;
    const def = c.kind === 'weapon' ? world.weaponDefs[world.weaponIndex.get(c.id)] : world.passiveDefs.find((x) => x.id === c.id);
    const tags = (def && def.tags) || [];
    for (const t of tags) if (prefer.includes(t)) s += 12;
    if (c.kind === 'weapon') {
      let owned = 0;
      for (let k = 0; k < world.build.weaponSlots; k++) if (isDrafted(world.slots[k])) owned++;
      if (c.isNew) return s + (owned < 3 ? 30 : 12);
      // A rolled upgrade (ruling 10): its own score x rarity x the weapon's tag weight
      // (sim/weaponups.js upgradeScore), over the best tag weight among the weapons carried, so a
      // Common on the build's best weapon scores what a level-up did before (a new weapon still
      // comes first early) and a higher rarity or a better-matched weapon more.
      // (upgradeScore is the card's worth to its weapon x the tag weight: a Common number is about 0.2.)
      return (s + 15) * 5 * upgradeScore(world, c) / bestTagWeight(world);
    }
    // Passives: capstone partners of owned weapons (0.9.0), then ones that keep you alive.
    for (let k = 0; k < world.build.weaponSlots; k++) {
      const sl = world.slots[k];
      // A weapon's partner makes its capstone hit harder (ruling 14: it no longer opens it).
      if (sl && sl.def && sl.def.partner === c.id) s += sl.ascensions.some((o) => o.capstone) ? 30 : 14;
    }
    const mods = def && def.levels ? def.levels[0] : null;
    if (mods && mods.some((m) => DEFENSIVE.has(m.stat))) s += hurt ? 22 : 10;
    return s;
  }

  /**
   * What a dash item is worth to the careful picker right now (ruling 18 WF): reach a minute
   * (distance x charges over recharge, rooted: the first metres matter most), the moment after it
   * you can't be hurt (worth more when hurt or late), and its mark on the ground (worth more the
   * thicker the crowd round you). A swap starts the new item fresh, so it must beat the held item's
   * numbers after its cards.
   */
  function dashWorth(world, def, stats, hurt) {
    const T = world.tuning.player.dash;
    const reach = Math.sqrt((stats.distance / T.distance) * stats.charges * (T.cooldown / stats.cooldown));
    const late = world.tick > 600 * 60;
    const guard = Math.max(0, stats.iframesAfter - T.iframesAfter) * (hurt ? 2 : late ? 1.2 : 0.6);
    const p = world.player, E = world.enemies;
    let near = 0;
    for (let e = 0; e < E.count; e++) { const dx = E.x[e] - p.x, dy = E.y[e] - p.y; if (dx * dx + dy * dy < 6400) near++; }
    const crowd = Math.min(1.5, near / 25);
    const m = def.mark;
    let mark = 0;
    if (m && m.kind === 'slow') mark = m.pct * Math.min(3, m.sec) * Math.min(1.5, m.radius / 24) * crowd * 0.5;
    else if (m && m.kind === 'knock') mark = Math.min(1, m.strength / 4) * Math.min(1.5, m.radius / 30) * crowd * 0.5;
    return reach + guard + mark;
  }

  function carefulDash(world, c, hurt) {
    const d = world.dash;
    if (!c.isNew) return (d?.ups.length ?? 0) < 2 || c.up === 'dash_charges' ? 40 : 16;
    const def = world.dashDefs.find((x) => x.id === c.id);
    if (!def || !d) return 6;
    const now = dashWorth(world, d.def, d.stats, hurt);
    const gain = dashWorth(world, def, dashNumbers(world.tuning, def, []), hurt) / Math.max(0.1, now) - 1;
    // (A clear gain is worth about a good line; a small one, about a number; none, nothing.)
    return gain > 0.12 ? 60 + 300 * Math.min(0.5, gain) : gain > 0 ? 10 : 2;
  }

  /**
   * The careful picker: what a player who builds around a plan takes. Two or three weapons that
   * share tags, levelled where the damage already is (rolled upgrades multiply what a weapon does,
   * so focus compounds), their partner passives, and every line, Legendary, and axis on the way.
   */
  function carefulScore(world, c) {
    const hurt = world.player.hp < world.stats.maxHp * 0.6;
    if (c.kind === 'heal') return hurt ? 80 : 1;
    if (c.kind === 'coin') return 0.5;
    if (c.kind === 'dash') return carefulDash(world, c, hurt);
    const held = [];
    for (let k = 0; k < world.build.weaponSlots; k++) if (isDrafted(world.slots[k])) held.push(world.slots[k]);
    const tagsHeld = new Map();
    for (const sl of held) for (const t of sl.def.tags || []) tagsHeld.set(t, (tagsHeld.get(t) ?? 0) + 1);
    const shared = (tags) => (tags || []).reduce((n, t) => n + (tagsHeld.get(t) ?? 0), 0);
    if (c.kind === 'weapon') {
      const def = world.weaponDefs[world.weaponIndex.get(c.id)];
      if (c.isNew) {
        if (held.length === 0) return 200;
        // A fifth only when nothing else is worth it (ruling 21, Tide 5: careful runs that died held 5
        // or 6 weapons at levels 1 to 7 and 2 to 4 passives; a tag shared with many held must not buy one).
        // (C1b, Nov 19: the cap was at a fourth, so on a five-slot harbor careful left a weapon slot empty
        // in 36 of 59 Docks Tide 0 runs where random filled it in all 60. Filled, careful cleared
        // 39 of 45 on the same seeds where it had cleared 33.)
        if (held.length >= 4) return 2 + 4 * Math.min(2, shared(def.tags));
        return 60 + 25 * shared(def.tags);
      }
      const sl = world.slots[c.slot ?? world.slots.findIndex((x) => x && x.def && x.def.id === c.id)];
      // Focus: the share of the build's damage this weapon does (at least a little for a new one).
      let total = 0;
      for (const o of held) total += world.result.damageBySlot[o.index] || 0;
      const share = total > 0 && sl ? Math.max(0.15, (world.result.damageBySlot[sl.index] || 0) / total) : 0.5;
      // (Focus, but not hoarding: the card's own worth leads, and damage cards shrink on a weapon
      // that has taken many, so a second weapon's cards come to be worth more.)
      let v = 100 * (0.4 + share) * (upgradeScore(world, c) / 0.2);
      if (c.up === 'special') v += 120;
      else if (c.up === 'line') v += 50;
      if (c.opens) v += 70;
      else if (c.next && c.next.left === 1) v += 20;
      return v;
    }
    const def = world.passiveDefs.find((x) => x.id === c.id);
    let v = 15;
    for (const sl of held) if (sl.def.partner === c.id) v += 70 * (0.5 + ((world.result.damageBySlot[sl.index] || 0) > 0 ? 0.5 : 0));
    const mods = def && def.levels ? def.levels[0] : [];
    // What the passive does for the run (C2's finding, Nov 18: a careful build that never took reach,
    // speed, or defense starved for XP and died). Behind the clock (fewer levels than a run of this
    // length has), pickup reach and XP come first; low on health, defense; speed always helps a kiter.
    const behind = Math.max(0, (world.tick / 3600) * 1.7 + 2 - world.player.level);
    const hpShare = world.player.hp / Math.max(1, world.stats.maxHp);
    for (const m of mods) {
      if (m.tags && m.tags.length) v += 18 * shared(m.tags);
      else if (m.stat === 'magnet' || m.stat === 'growth') v += 30 + 12 * Math.min(6, behind);
      else if (m.stat === 'moveSpeed') v += 45;
      else if (m.stat === 'maxHp' || m.stat === 'armor' || m.stat === 'regen') v += (hpShare < 0.6 ? 90 : 40) + (world.tick > 600 * 60 ? 20 : 0);
      else v += 12;
    }
    // A passive slot left empty is a slot wasted: the first two passives come early, and the rest
    // before a weapon past the third. A passive held is worth its next level (the random picker,
    // filling six passives to level 5, outlived careful runs at Tide 5).
    if (c.isNew && world.build.passives.length < 2) v += 40;
    else if (c.isNew && world.build.passives.length < world.build.passiveSlots) v += 20;
    if (!c.isNew) v += 15;
    if (c.keystone) v += 25;
    return v;
  }

  function decide(world, halt) {
    switch (halt.kind) {
      case 'draft': {
        let best = 0, bestS = -1;
        const score = picker === 'careful' ? carefulScore : scoreCard;
        halt.offer.forEach((c, i) => { const s = score(world, c); if (s > bestS) { bestS = s; best = i; } });
        return { kind: 'pick', index: best };
      }
      case 'chest': return { kind: 'ok' };
      case 'overtime': return stay ? { kind: 'stay' } : { kind: 'leave' };
      case 'ascend': {
        // An axis's choice: its first option, or its second (`option`: 0, 1, or 'alt' for one then the
        // other, so measurements see both). An Ember: the highest-level weapon whose next axis it
        // can open early. The bots never switch an option.
        const pickOf = (list) => list[Math.min(list.length - 1, option === 'alt' ? (formsTaken++) % 2 : option)];
        if (Number.isInteger(halt.slot) && halt.axis) {
          const free = optionChoices(world, halt.slot).filter((c) => c.cost === 'free' && c.option.axis === halt.axis);
          return free.length ? { kind: 'ascend', slot: halt.slot, id: pickOf(free).option.id } : { kind: 'keep' };
        }
        let best = -1, bestC = null;
        for (let s = 0; s < world.build.weaponSlots; s++) {
          const cs = optionChoices(world, s).filter((c) => c.cost === 'free' || (world.build.embers > 0 && !c.switches));
          if (!cs.length) continue;
          const free = cs.filter((c) => c.cost === 'free');
          if (best < 0 || (free.length && bestC[0].cost !== 'free') || ((free.length > 0) === (bestC[0].cost === 'free') && world.slots[s].level > world.slots[best].level)) { best = s; bestC = free.length ? free : cs; }
        }
        if (best < 0) return { kind: 'keep' };
        const axis = bestC[0].option.axis;
        return { kind: 'ascend', slot: best, id: pickOf(bestC.filter((c) => c.option.axis === axis)).option.id };
      }
      case 'relic': {
        // A Reliquary's or the vault's three: the highest tier, the first of those. With the slots
        // full (0.9.0), it gives up its lowest-tier relic for one a tier better, or passes.
        let best = 0;
        halt.offer.forEach((id, i) => { if (tierOf(world, id) > tierOf(world, halt.offer[best])) best = i; });
        if (!relicsFull(world)) return { kind: 'pick', index: best };
        const out = lowestRelic(world);
        return out && tierOf(world, halt.offer[best]) > out.tier ? { kind: 'pick', index: best, swap: out.id } : { kind: 'pass' };
      }
      case 'ferry': {
        // A relic it can afford and doesn't carry, food when hurt, or nothing.
        const F = world.ferry, hurt = world.player.hp < world.stats.maxHp * 0.5;
        const full = relicsFull(world), out = full ? lowestRelic(world) : null;
        const k = F.offers.findIndex((o) => !o.sold && !o.gone && o.price <= world.glass
          && ((o.kind === FERRY_KINDS.relic && !world.build.relics.some((r) => r.id === o.id) && (!full || (out && tierOf(world, o.id) > out.tier))) || (o.kind === FERRY_KINDS.food && hurt)));
        if (k < 0) return { kind: 'done' };
        return full && F.offers[k].kind === FERRY_KINDS.relic ? { kind: 'buy', index: k, swap: out.id } : { kind: 'buy', index: k };
      }
      // The Salt Well: the bots keep what they carry (giving one up is a long-game choice).
      case 'well': return { kind: 'keep' };
      case 'bellpick': {
        // A rung bell's pick: the option it would draft first (the highest card score).
        let best = 0, bestS = -1;
        halt.options.forEach((o, i) => { const sc = scoreCard(world, { kind: o.kind, id: o.id, isNew: false }); if (sc > bestS) { bestS = sc; best = i; } });
        return { kind: 'pick', index: best };
      }
      default: return { kind: 'ok' };
    }
  }

  function tierOf(world, id) { return world.relicDefs.find((r) => r.id === id)?.tier ?? 0; }
  /** The carried relic it would give up first: the lowest tier, the earliest found of those. */
  function lowestRelic(world) {
    let out = null;
    for (const r of world.build.relics) if (!out || r.tier < out.tier) out = r;
    return out;
  }

  return { input, decide };
}

export { TAGS_BY_ARCHETYPE };
