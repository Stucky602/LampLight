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

import { EF, ZONE, PF, PK, AI } from './constants.js';
import { quantizeAxis } from '../lib/inputframe.js';
import { openSocketsFor } from './chests.js';
import { CHARGER } from './enemies.js';
import { BOSS_STATE } from './bosses.js';
import { sincosInto, TAU } from '../lib/fmath.js';
import { openAscensions } from './ascend.js';

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
  chain_lightning: ['steel', 'tide'],
  speed_glass: ['tide', 'steel'],
};

// Passive stats that keep a player alive (the bot values them more when hurt).
const DEFENSIVE = new Set(['maxHp', 'armor', 'regen', 'moveSpeed']);

/**
 * @param {object} [o]
 * @param {string} [o.archetype] a key of TAGS_BY_ARCHETYPE (steers draft picks)
 * @param {boolean} [o.stay] stay for overtime after the last boss
 * @param {number} [o.dashDistance] dash when an enemy is this close (px between bodies)
 */
export function createKiteBot({ archetype = 'projectile_storm', stay = false, dashDistance = 6 } = {}) {
  const prefer = TAGS_BY_ARCHETYPE[archetype] || [];
  const frame = { mx: 0, my: 0, buttons: 0 };
  const danger = new Float64Array(N_DIR);
  const want = new Float64Array(N_DIR);
  let dashHeld = false;
  let side = 1;
  let lastK = 0;

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
        line = def.dashSpeed * (E.aiState[i] === CHARGER.WINDUP ? def.dashTime : E.aiTimer[i]) + touch + 12;
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
      if (bossGap > 12) pull(dx / d, dy / d, bossGap > 120 ? 0.9 : 0.5);
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
    const wantDash = (danger[best] > 8 || closest < dashDistance) && p.dashCd <= 0 && p.dashTicks === 0;
    frame.buttons = wantDash && !dashHeld ? 1 : 0;
    dashHeld = frame.buttons !== 0;
    return frame;
  }

  function scoreCard(world, c) {
    const hurt = world.player.hp < world.stats.maxHp * 0.5;
    if (c.kind === 'heal') return hurt ? 50 : 1;
    if (c.kind === 'coin') return 0.5;
    if (c.kind === 'relic') return 60;
    let s = 10;
    const def = c.kind === 'weapon' ? world.weaponDefs[world.weaponIndex.get(c.id)] : world.passiveDefs.find((x) => x.id === c.id);
    const tags = (def && def.tags) || [];
    for (const t of tags) if (prefer.includes(t)) s += 12;
    if (c.kind === 'weapon') {
      let owned = 0;
      for (let k = 0; k < world.build.weaponSlots; k++) if (world.slots[k]) owned++;
      s += c.isNew ? (owned < 4 ? 30 : 12) : 15;
      return s;
    }
    // Passives: evolution partners of owned weapons, then ones that keep you alive.
    for (let k = 0; k < world.build.weaponSlots; k++) {
      const sl = world.slots[k];
      if (sl && sl.def.evolution && sl.def.evolution.passive === c.id) s += sl.level >= 5 ? 30 : 18;
    }
    const mods = def && def.levels ? def.levels[0] : null;
    if (mods && mods.some((m) => DEFENSIVE.has(m.stat))) s += hurt ? 22 : 10;
    return s;
  }

  function decide(world, halt) {
    switch (halt.kind) {
      case 'draft': {
        let best = 0, bestS = -1;
        halt.offer.forEach((c, i) => { const s = scoreCard(world, c); if (s > bestS) { bestS = s; best = i; } });
        return { kind: 'pick', index: best };
      }
      case 'chest': return { kind: 'ok' };
      case 'rune': {
        const rune = world.runeDefs.find((r) => r.id === halt.rune);
        const open = openSocketsFor(world, rune);
        return open.length ? { kind: 'place', slot: open[0] } : { kind: 'discard' };
      }
      case 'overtime': return stay ? { kind: 'stay' } : { kind: 'leave' };
      case 'ascend': {
        // The highest-level weapon that can still ascend, its first open ascension.
        let best = -1;
        for (let s = 0; s < world.build.weaponSlots; s++) if (openAscensions(world, s).length && (best < 0 || world.slots[s].level > world.slots[best].level)) best = s;
        return best >= 0 ? { kind: 'ascend', slot: best, id: openAscensions(world, best)[0].id } : { kind: 'keep' };
      }
      default: return { kind: 'ok' };
    }
  }

  return { input, decide };
}

export { TAGS_BY_ARCHETYPE };
