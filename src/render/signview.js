// The map's things, shown before you reach them and while you do them (0.8.2;
// work/interact/proposal.md 2.1 to 2.3 and ideas 1 to 6; the sim's side: sim/signs.js).
//
// The ring rule (the lead's decision 2): a SOLID ring in the warning color means something lands
// there (those are drawn with the warnings, render/runview.js); a DASHED ring in the thing's own
// color is a task area: a lamp's, a lit lamp's ward, a bell's small start ring and its kill ring,
// the Ferryman's, the Salt Well's. A ring that fills (a lamp lighting, a ring opening in 0.6 s)
// shows how far round it has filled as a solid arc over its dashes; there is no timer anywhere.
//
// What this draws, in two layers the run view places:
//   ground (in the world, under the light): the rings, a lit lamp's warm pool, a tolled bell's crew
//     gathering in the fog, a rung bell's wave, a lamp's flare as it catches, the moorings.
//   over (after the light and fog, unlit, so it reads in the dark): a lamp's glass (dark until lit,
//     then bright), the bell's count, what an unlit lamp or idle bell pays, the light beams over a
//     Reliquary and the vault, and "Carry a relic first" over the Salt Well.
// Pure helpers (tested in Node) come first; the drawing reads the sim and writes nothing back.

import { Container, Graphics, Sprite } from 'pixi.js';
import { color as pal } from '../data/palette.js';
import { collectRings, rewardOf, makeRing, RING, REWARD } from '../sim/signs.js';
import { ward } from '../sim/tasks.js';
import { TASK, TASK_STATE, PK, EF } from '../sim/constants.js';
import { EV } from '../sim/events.js';
import { createPixelText } from './hud.js';
import { textWidth } from './font.js';
import { craneRects, cairnRects, LANDMARK_TOP } from './landmarks.js';
import { findOut } from '../sim/acts.js';
import { tradeSiteUsed, onWater, puntLeft, TRADE_RING } from '../sim/trades.js';

/**
 * Each kind's own color (the rings, the edge arrows, the minimap's marks and the HUD's row all
 * use these): lamp gold, a ward's pool a warmer orange, the bell blue, the Ferryman teal, the
 * Salt Well a cold grey, a Reliquary and the vault violet, a chest amber.
 */
export const SIGN_COLOR = Object.freeze({
  lamp: pal('lamp-4'), ward: pal('lamp-3'), bell: pal('gem-3'), ferry: pal('sea-5'), well: pal('fog-4'),
  reliquary: pal('violet-4'), vault: pal('violet-4'), chest: pal('lamp-3'),
  // 0.9.0 (W4): the Docks' cranes (their timber) and the Marsh's salt cairns (salt, pale).
  crane: pal('wood-4'), cairn: pal('fog-5'),
  // 0.9.0 (W2): the characters' trades: the dead the Bog Warden raises (moss), sunken cargo (sea).
  raise: pal('moss-4'), cargo: pal('sea-4'),
});

// The crane's and cairn's rects (render/landmarks.js), [not ready, ready], and their colors (made once).
const CRANE_RECTS = [craneRects(false), craneRects(true)], CAIRN_RECTS = [cairnRects(false), cairnRects(true)];
const PROP_COL = {};
for (const list of [...CRANE_RECTS, ...CAIRN_RECTS]) for (const r of list) PROP_COL[r[4]] = pal(r[4]);

/** A dashed ring: dashes this long with gaps this long (world px), at least MIN_DASHES round. */
export const DASH = Object.freeze({ px: 5, gap: 4, min: 8 });

/** How many dashes go round a ring of radius r (even, so opposite sides match). */
export function dashCount(r) {
  const n = Math.round((2 * Math.PI * Math.max(0, r)) / (DASH.px + DASH.gap));
  return Math.max(DASH.min, n + (n % 2));
}

/**
 * Dash k of n round a ring, as angles (radians, 0 = east, clockwise on screen) into out[0], out[1]:
 * each dash takes its share of the circle less its gap, starting from the top.
 */
export function dashSpan(k, n, out) {
  const step = (Math.PI * 2) / n, on = step * (DASH.px / (DASH.px + DASH.gap));
  out[0] = -Math.PI / 2 + k * step;
  out[1] = out[0] + on;
  return out;
}

/**
 * Where the Ferryman's skiff is (idea 6): rowing in from fromX, fromY to his mooring between his
 * call and tying up (eased: he slows as he comes alongside), then at rest there. Into `out`:
 * { shown, x, y, u } (u: 0 at his call, 1 tied up). Not shown before his first call.
 */
export function skiffAt(F, tick, out) {
  if (!F || !F.moored) { out.shown = false; return out; }
  const span = Math.max(1, F.tiedTick - F.callTick);
  const u = Math.min(1, Math.max(0, (tick - F.callTick) / span));
  const e = 1 - (1 - u) * (1 - u);
  out.shown = true; out.u = u;
  out.x = F.fromX + (F.bx - F.fromX) * e;
  out.y = F.fromY + (F.by - F.fromY) * e;
  return out;
}

/** The share (0..1) of a tolled bell's gathering done: 0 at its toll, 1 as its crew walks in. */
export function gatherShare(t, tick, gatherTicks) {
  if (!t || t.crewTick < 0) return -1;
  return Math.min(1, Math.max(0, 1 - (t.crewTick - tick) / Math.max(1, gatherTicks)));
}

/** How long the view's own flares last (ms of the render clock). */
export const FLARE_MS = Object.freeze({ wave: 380, lit: 520, beam: 900 });

/**
 * The view's memory of the moments it marks: a rung bell's wave across its ring, a lamp's flare
 * as it catches, and when each drop that gets a beam landed (so its beam flares up first).
 * Fixed stores; nothing grows.
 */
export function createSignState(max = 16) {
  return { n: 0, max, kind: new Uint8Array(max), x: new Float32Array(max), y: new Float32Array(max), r: new Float32Array(max), t: new Float64Array(max) };
}

/** Kinds of a flare in the sign state. */
export const FLARE = Object.freeze({ WAVE: 1, LIT: 2 });

function addFlare(S, kind, x, y, r, now) {
  let k = S.n < S.max ? S.n++ : 0;
  if (S.n >= S.max) {
    // Full: the oldest goes.
    let old = Infinity;
    for (let j = 0; j < S.n; j++) if (S.t[j] < old) { old = S.t[j]; k = j; }
  }
  S.kind[k] = kind; S.x[k] = x; S.y[k] = y; S.r[k] = r; S.t[k] = now;
}

/** Read the frame's events into the sign state (before the buffer clears). */
export function consumeSigns(S, ev, world, now) {
  for (let i = 0; i < ev.count; i++) {
    if (ev.type[i] !== EV.TASK || ev.b[i] !== 2) continue;
    const t = world.tasks?.[ev.c[i]];
    if (!t) continue;
    if (t.kind === TASK.BELL) addFlare(S, FLARE.WAVE, t.x, t.y, ringR(world, t), now);
    else addFlare(S, FLARE.LIT, t.x, t.y, world.tuning.tasks.ward?.radius ?? 80, now);
  }
}

function ringR(world, t) {
  const T = world.tuning.tasks;
  return T.bell.radius * (1 + (world.config.harbor?.bellRing ?? 0));
}

/**
 * The lamppost's glass (prop_lamppost, 11 x 25, drawn centered 8 px above the lamp's point, which
 * puts its top-left corner at (x - 6, y - 20) as the half pixels round): the 3 x 3 pane at
 * columns 4 to 6, rows 4 to 6, so its middle is 1 px left of the point and LAMP_GLASS px above it.
 */
export const LAMP_GLASS = 15;
export const LAMP_GLASS_DX = -1;

// ---------------------------------------------------------------- drawing

/**
 * @param {object} o
 * @param {object} o.atlas
 * @param {(x:number,y:number,vx:number,vy:number,ms:number,color:number)=>void} o.spark an ember spark
 */
/**
 * A character's trade on the map (0.9.0, W2; sim/trades.js): the sites as small marks on the ground
 * (a bog body, a wreck crew's broken boat, a sunken crate's buoy, a punt cache's float), the
 * Harpooner's line to what she reels in or yanks, and the Punter's punt under him on the water.
 * `g` the ground layer, `o` over the fog. Reads the world only.
 */
function drawTrade(world, g, o, inView, simSec) {
  const tr = world.trade;
  if (!tr) return;
  const s = tr.s, p = world.player;
  for (let k = 0; k < tr.sites.length; k++) {
    if (tradeSiteUsed(s, k)) continue;
    const st = tr.sites[k], x = Math.round(st.x), y = Math.round(st.y);
    if (!inView(x, y, 12)) continue;
    if (tr.kind === TRADE_RING.BODY) {
      // A body in the peat: a long dark mound, a pale hand at its head.
      g.ellipse(x, y + 1, 7, 3).fill({ color: pal('rot-1'), alpha: 1 }).stroke({ width: 1, color: pal('night-0'), alpha: 1 });
      g.rect(x - 6, y - 2, 2, 2).fill({ color: pal('fog-4'), alpha: 1 });
    } else if (tr.kind === TRADE_RING.CREW) {
      // A crew's boat, broken: two ribs and a keel.
      g.rect(x - 7, y + 1, 14, 2).fill({ color: pal('wood-1'), alpha: 1 });
      g.rect(x - 5, y - 4, 2, 6).fill({ color: pal('wood-2'), alpha: 1 }).rect(x + 3, y - 4, 2, 6).fill({ color: pal('wood-2'), alpha: 1 });
    } else {
      // Sunken cargo: a buoy bobbing over it.
      const bob = Math.round(Math.sin(simSec * 2 + k) * 1);
      g.rect(x - 2, y - 5 + bob, 5, 6).fill({ color: pal('rot-3'), alpha: 1 }).rect(x - 2, y - 3 + bob, 5, 2).fill({ color: pal('fog-5'), alpha: 1 });
      g.rect(x - 1, y + 1 + bob, 3, 1).fill({ color: pal('night-0'), alpha: 0.8 });
    }
  }
  if (tr.id === 'pole' && s.cacheOn === 1 && inView(s.cacheX, s.cacheY, 10)) {
    // A punt cache: a crate on a float.
    const x = Math.round(s.cacheX), y = Math.round(s.cacheY) + Math.round(Math.sin(simSec * 2) * 1);
    g.rect(x - 6, y + 1, 12, 2).fill({ color: pal('wood-1'), alpha: 1 });
    g.rect(x - 4, y - 5, 8, 6).fill({ color: pal('wood-3'), alpha: 1 }).stroke({ width: 1, color: pal('night-0'), alpha: 1 });
  }
  if (tr.id === 'pole' && onWater(world)) {
    // The Punter on the water: his punt under him.
    // (X4: with under a third of the punt left its planks darken and lighten four times a second: the pole is tiring.)
    const x = Math.round(p.x), y = Math.round(p.y) + 4;
    const tiring = puntLeft(world) < 0.3 && Math.floor(simSec * 8) % 2 === 0;
    g.rect(x - 9, y - 2, 18, 4).fill({ color: pal(tiring ? 'wood-1' : 'wood-2'), alpha: 1 }).stroke({ width: 1, color: pal('night-0'), alpha: 1 });
  }
  if (tr.id === 'hook') {
    // Her line to what she reels in, and to the elite she yanks.
    const reach = tr.P.reach, K = world.pickups;
    for (let i = 0; i < K.count; i++) {
      const kd = K.kind[i];
      if (kd !== PK.CHEST && kd !== PK.RELIQUARY && kd !== PK.VAULT && kd !== PK.EMBER) continue;
      const dx = K.x[i] - p.x, dy = K.y[i] - p.y;
      if (dx * dx + dy * dy > reach * reach || dx * dx + dy * dy < 100) continue;
      o.moveTo(Math.round(p.x), Math.round(p.y) - 4).lineTo(Math.round(K.x[i]), Math.round(K.y[i])).stroke({ width: 1, color: pal('wood-4'), alpha: 0.8 });
    }
    if (s.yankT > 0) {
      const e = world.enemies.resolve(s.yankH);
      if (e >= 0) o.moveTo(Math.round(p.x), Math.round(p.y) - 4).lineTo(Math.round(world.enemies.x[e]), Math.round(world.enemies.y[e])).stroke({ width: 1, color: pal('fog-5'), alpha: 0.9 });
    }
  }
}

export function createSignView({ atlas, spark }) {
  const ground = new Graphics();
  const over = new Container();
  const overG = new Graphics();
  over.addChild(overG);
  const S = createSignState();
  const rings = [];
  for (let k = 0; k < 12; k++) rings.push(makeRing());
  const span = [0, 0];
  const reward = { kind: 0, pearls: 0, chest: false };
  // Pixel text in the world (outlined, the HUD's font), reused frame to frame.
  const texts = [];
  let textN = 0;
  const icons = [];
  let iconN = 0;
  const PEARL = atlas.tex('pk_glass');
  let lastStep = -1;   // the burn's sparks: a few each 90 ms step, not each frame
  function text(str, col, x, y) {
    let t = texts[textN];
    if (!t) { t = createPixelText(atlas); texts.push(t); over.addChild(t.view); }
    textN++;
    t.set(str, col);
    t.view.position.set(Math.round(x), Math.round(y));
    t.view.visible = true;
    return t;
  }
  function icon(tex, x, y) {
    let s = icons[iconN];
    if (!s) { s = new Sprite(); s.anchor.set(0.5); icons.push(s); over.addChild(s); }
    iconN++;
    s.texture = tex;
    s.position.set(Math.round(x), Math.round(y));
    s.visible = true;
    return s;
  }

  /** A dashed ring, its color, at alpha a; width w. */
  function dashed(g, x, y, r, col, a, w = 1) {
    const n = dashCount(r);
    for (let k = 0; k < n; k++) {
      dashSpan(k, n, span);
      g.moveTo(x + Math.cos(span[0]) * r, y + Math.sin(span[0]) * r).arc(x, y, r, span[0], span[1]).stroke({ width: w, color: col, alpha: a });
    }
  }
  /** How far round a ring has filled: a solid arc from the top, clockwise. */
  function filled(g, x, y, r, f, col) {
    if (!(f > 0)) return;
    const a0 = -Math.PI / 2, a1 = a0 + Math.min(1, f) * Math.PI * 2;
    g.moveTo(x + Math.cos(a0) * r, y + Math.sin(a0) * r).arc(x, y, r, a0, a1).stroke({ width: 2, color: col, alpha: 0.95 });
  }

  /**
   * The flame over a lamp's reward (what a lit lamp gives: its burning light): a candle flame, a
   * teardrop narrow at its tip and round at its foot, its white core low in it, outlined dark so it
   * reads on the ground. 3 x 6, rows from the tip.
   */
  function flameMark(g, x, y) {
    g.rect(x - 2, y - 3, 5, 7).fill({ color: pal('night-0'), alpha: 0.85 });
    g.rect(x, y - 3, 1, 2).fill({ color: pal('lamp-4'), alpha: 1 });
    g.rect(x - 1, y - 1, 3, 3).fill({ color: pal('lamp-3'), alpha: 1 });
    g.rect(x, y, 1, 2).fill({ color: pal('lamp-6'), alpha: 1 });
    g.rect(x - 1, y + 2, 3, 1).fill({ color: pal('lamp-2'), alpha: 1 });
  }

  return {
    ground, over, state: S,
    consume(world, now) { consumeSigns(S, world.events, world, now); },
    reset() { S.n = 0; },
    /**
     * Draw this frame's signs. inView(x, y, pad): whether a point is near the view. now: the render
     * clock (ms); simSec: the sim's clock (s), for what should hold while the sim does.
     */
    draw(world, inView, now, simSec) {
      const g = ground, o = overG, T = world.tuning;
      g.clear(); o.clear();
      textN = 0; iconN = 0;
      const tasks = world.tasks || [];
      // A lit lamp's ward: its warm pool on the ground, and where it ends (idea 1).
      for (let i = 0; i < tasks.length; i++) {
        const t = tasks[i];
        if (t.kind !== TASK.LAMP || t.state !== TASK_STATE.DONE) continue;
        const r = ward(world, i);
        if (!(r > 0) || !inView(t.x, t.y, r)) continue;
        const x = Math.round(t.x), y = Math.round(t.y);
        g.circle(x, y, r).fill({ color: SIGN_COLOR.ward, alpha: 0.1 });
        g.circle(x, y, r * 0.55).fill({ color: SIGN_COLOR.lamp, alpha: 0.06 });
      }
      // The rings (sim/signs.js collectRings): dashed, each in its own color, filling as it goes.
      const n = collectRings(world, rings);
      for (let k = 0; k < n; k++) {
        const R = rings[k];
        if (!inView(R.x, R.y, R.r + 4)) continue;
        const x = Math.round(R.x), y = Math.round(R.y), col = SIGN_COLOR[R.color] ?? SIGN_COLOR.lamp;
        const a = R.kind === RING.WARD ? 0.4 : R.fill > 0 ? 0.8 : 0.55;
        dashed(g, x, y, R.r, col, a, R.kind === RING.BELL || R.kind === RING.WARD ? 1 : 1);
        filled(g, x, y, R.r, R.fill, col);
        // The bell's count (the number over it, idea 2) goes over the fog, below.
        if (R.kind === RING.BELL && R.count >= 0) text(String(R.count), SIGN_COLOR.bell, x - textWidth(String(R.count)) / 2, y - 30);
      }
      // A tolled bell's crew gathering in the fog round it, then walking in (idea 2): dark shapes
      // that thicken until they come.
      const gather = Math.max(1, Math.round((T.tasks.bell?.gatherSec ?? 1.2) * 60));
      for (const t of tasks) {
        const u = gatherShare(t, world.tick, gather);
        if (u < 0) continue;
        for (let k = 0; k < t.crewN; k++) {
          const cx = t.crewX[k], cy = t.crewY[k];
          if (!inView(cx, cy, 12)) continue;
          // Drawn over the fog (dark on dark under it would never show): a hunched figure taking
          // shape, its edge catching a little cold light.
          const sway = Math.round(Math.sin(simSec * 3 + k) * 1.5), x0 = Math.round(cx), y0 = Math.round(cy);
          o.ellipse(x0, y0, 4 + 2 * u, 6 + 2 * u).fill({ color: pal('night-0'), alpha: 0.3 + 0.5 * u }).stroke({ width: 1, color: pal('fog-2'), alpha: 0.15 + 0.45 * u });
          o.circle(x0 + sway, y0 - 7 - Math.round(2 * u), 2 + u).fill({ color: pal('night-0'), alpha: 0.3 + 0.5 * u }).stroke({ width: 1, color: pal('fog-2'), alpha: 0.15 + 0.45 * u });
        }
      }
      // The maps' own tasks (0.9.0, W4): a crane or a cairn standing at its place (render/landmarks.js).
      for (let i = 0; i < tasks.length; i++) {
        const t = tasks[i];
        if ((t.kind !== TASK.CRANE && t.kind !== TASK.CAIRN) || !inView(t.x, t.y - 30, 60)) continue;
        const crane = t.kind === TASK.CRANE, rects = (crane ? CRANE_RECTS : CAIRN_RECTS)[t.state === TASK_STATE.IDLE ? 1 : 0];
        const fx = Math.round(t.x), fy = Math.round(t.y) + 6;
        for (const [dx, dy, w, h, c] of rects) g.rect(fx + dx, fy + dy, w, h).fill({ color: PROP_COL[c], alpha: 1 });
      }
      // Small finds (0.9.0, W4): unmarked; a faint glint once you're near and it's out.
      const pl = world.player;
      for (const sc of world.secrets || []) {
        if (sc.open || !sc.gift || !findOut(world, sc)) continue;
        const dx = sc.x - pl.x, dy = sc.y - pl.y;
        if (dx * dx + dy * dy > 150 * 150 || !inView(sc.x, sc.y, 8)) continue;
        const tw = ((simSec * 2 + sc.x) | 0) % 3, gx = Math.round(sc.x), gy = Math.round(sc.y);
        o.rect(gx, gy - 1 - tw, 1, 3 + tw).fill({ color: pal('fog-5'), alpha: 0.7 });
        o.rect(gx - 1, gy, 3, 1).fill({ color: pal('fog-5'), alpha: 0.7 });
      }
      // The moorings (idea 6): a post at the boards beside each, so the Ferryman's places show.
      const F = world.ferry;
      if (F?.moorings) {
        for (const m of F.moorings) {
          const px = Math.round(m.x + (m.bx - m.x) * 0.45), py = Math.round(m.y + (m.by - m.y) * 0.45);
          if (!inView(px, py, 8)) continue;
          g.rect(px - 1, py - 5, 3, 6).fill({ color: pal('wood-2'), alpha: 1 }).rect(px - 1, py - 5, 3, 1).fill({ color: pal('wood-4'), alpha: 1 });
        }
      }
      // 0.9.0 (W2): the characters' trades (sim/trades.js), drawn in code.
      drawTrade(world, g, o, inView, simSec);
      // The flares: a rung bell's wave across its ring, a lamp's light spreading as it catches.
      for (let k = 0; k < S.n; k++) {
        const age = now - S.t[k];
        const ms = S.kind[k] === FLARE.WAVE ? FLARE_MS.wave : FLARE_MS.lit;
        if (age < 0 || age > ms) continue;
        const u = age / ms, r = Math.max(2, S.r[k] * (S.kind[k] === FLARE.WAVE ? u : 0.3 + 0.7 * u));
        const col = S.kind[k] === FLARE.WAVE ? SIGN_COLOR.bell : SIGN_COLOR.lamp;
        g.circle(Math.round(S.x[k]), Math.round(S.y[k]), r).stroke({ width: S.kind[k] === FLARE.WAVE ? 3 : 2, color: col, alpha: 0.8 * (1 - u) });
      }

      // ---- over the fog: the lamps' glass, what things pay, the beams, the Well's refusal.
      for (let i = 0; i < tasks.length; i++) {
        const t = tasks[i];
        if (!inView(t.x, t.y, 40)) continue;
        const x = Math.round(t.x), y = Math.round(t.y);
        if (t.kind === TASK.LAMP) {
          const lit = t.state === TASK_STATE.DONE && ward(world, i) > 0;
          const gx = x + LAMP_GLASS_DX, gy = y - LAMP_GLASS;
          if (lit) {
            // Lit (a gas lamp at night: the glass the brightest thing on it, the flame a white core
            // standing in it, its light spilling past the bars): the pane bright, the core white
            // and flickering a pixel taller now and then, a soft halo round the lantern.
            const fl = ((simSec * 9) | 0) % 3;
            o.circle(gx, gy, 6).fill({ color: pal('lamp-5'), alpha: 0.16 });
            o.rect(gx - 1, gy - 1, 3, 3).fill({ color: pal('lamp-5'), alpha: 1 });
            o.rect(gx, gy - (fl === 1 ? 1 : 0), 1, 2 + (fl === 1 ? 1 : 0)).fill({ color: pal('lamp-6'), alpha: 1 });
          } else {
            // Unlit: the glass dark, a glint of the night on its top-left corner.
            o.rect(gx - 1, gy - 1, 3, 3).fill({ color: pal('night-3'), alpha: 1 });
            o.rect(gx - 1, gy - 1, 1, 1).fill({ color: pal('fog-1'), alpha: 1 });
          }
        }
        // What it pays if you do it now (core 2.3): over an unlit lamp and an idle bell.
        if (!rewardOf(world, i, reward)) continue;
        const top = t.kind === TASK.LAMP ? y - 30 : t.kind === TASK.CRANE ? y - LANDMARK_TOP.crane - 2 : t.kind === TASK.CAIRN ? y - LANDMARK_TOP.cairn - 6 : y - 18;
        const pearls = reward.pearls > 0 ? String(reward.pearls) : '';
        const lead = reward.kind === REWARD.WARD ? 6 : reward.kind === REWARD.WORK ? 0 : textWidth(`+${T.tasks.bell?.levels ?? 2} Lv`) + 4;
        const w = lead + (pearls ? 4 + 7 + 1 + textWidth(pearls) : 0) + (reward.chest ? 8 : 0);
        let cx = x - Math.round(w / 2);
        if (reward.kind === REWARD.WARD) { flameMark(o, cx + 2, top); cx += 6; } else if (reward.kind === REWARD.PICK) { text(`+${T.tasks.bell?.levels ?? 2} Lv`, SIGN_COLOR.bell, cx, top - 5); cx += lead; }
        if (pearls) { cx += 4; icon(PEARL, cx + 3, top); text(pearls, pal('fog-5'), cx + 8, top - 5); cx += 8 + textWidth(pearls); }
        // A held lamp also pays a chest: a small closed chest after the rest (0.9.0, W4).
        if (reward.chest) { o.rect(cx + 3, top - 3, 6, 5).fill({ color: pal('night-0'), alpha: 1 }).rect(cx + 4, top - 2, 4, 3).fill({ color: SIGN_COLOR.chest, alpha: 1 }).rect(cx + 4, top - 1, 4, 1).fill({ color: pal('wood-2'), alpha: 1 }); }
      }
      // Beams over a Reliquary (violet) and the vault (gold-white), so neither lands unseen.
      const P = world.pickups;
      for (let i = 0; i < P.count; i++) {
        const kd = P.kind[i];
        if (kd !== PK.RELIQUARY && kd !== PK.VAULT) continue;
        if (!inView(P.x[i], P.y[i], 80)) continue;
        const x = Math.round(P.x[i]), y = Math.round(P.y[i]);
        const col = kd === PK.VAULT ? pal('lamp-5') : SIGN_COLOR.reliquary, h = kd === PK.VAULT ? 84 : 64;
        const pulse = 0.75 + 0.25 * Math.sin(now / 220 + i);
        o.rect(x - 3, y - h, 7, h - 4).fill({ color: col, alpha: 0.16 * pulse });
        o.rect(x - 1, y - h, 3, h - 4).fill({ color: col, alpha: 0.38 * pulse });
        o.rect(x, y - h, 1, h - 4).fill({ color: pal('white'), alpha: 0.5 * pulse });
      }
      // The Salt Well with nothing to give: say so over it while you stand in its ring.
      const W = world.well, p = world.player;
      if (W && W.open && W.given === null && (world.build?.relics?.length ?? 0) === 0) {
        const dx = p.x - W.x, dy = p.y - W.y, r = T.well?.radius ?? 22;
        if (dx * dx + dy * dy <= r * r) { const s = 'Carry a relic first'; text(s, pal('fog-5'), W.x - textWidth(s) / 2, W.y - 29); }
      }
      // What stands in a ward burns (its burn is the sim's; this is what it looks like): a small
      // flame licking up off each one (a fire seen from above at this size: a flickering tongue of
      // orange with a yellow-white heart, leaning with the flicker), and embers rising off them.
      const E = world.enemies, step = (now / 90) | 0, newStep = step !== lastStep;
      lastStep = step;
      for (let i = 0; i < tasks.length; i++) {
        const t = tasks[i];
        if (t.kind !== TASK.LAMP || t.state !== TASK_STATE.DONE) continue;
        const r = ward(world, i);
        if (!(r > 0) || !inView(t.x, t.y, r)) continue;
        const r2 = r * r;
        for (let e = 0; e < E.count; e++) {
          if ((E.flags[e] & (EF.DEAD | EF.AIR)) !== 0) continue;
          const dx = E.x[e] - t.x, dy = E.y[e] - t.y;
          if (dx * dx + dy * dy > r2 || !inView(E.x[e], E.y[e], 8)) continue;
          // Rows from the tip: one pixel leaning with the flicker, then the body three wide, its
          // heart low in it (pale yellow over white), as a flame is brightest at its root.
          const fx = Math.round(E.x[e]), fy = Math.round(E.y[e] - E.radius[e]) - 1, tall = ((e * 3 + step) % 3), lean = ((e + step) % 3) - 1;
          const h = 3 + tall;
          o.rect(fx + lean, fy - h + 1, 1, 1).fill({ color: pal('lamp-4'), alpha: 1 });
          o.rect(fx - 1, fy - h + 2, 3, h - 1).fill({ color: pal('lamp-3'), alpha: 1 });
          o.rect(fx, fy - 1, 1, 1).fill({ color: pal('lamp-5'), alpha: 1 });
          o.rect(fx, fy, 1, 1).fill({ color: pal('lamp-6'), alpha: 1 });
          if (spark && newStep && ((e * 7 + step) % 3) === 0) spark(E.x[e] + ((e * 13 + step) % 9) - 4, fy - 3, ((e + step) % 3) * 6 - 6, -30, 520, (e & 1) ? pal('lamp-5') : pal('lamp-3'));
        }
      }
      for (let k = textN; k < texts.length; k++) texts[k].view.visible = false;
      for (let k = iconN; k < icons.length; k++) icons[k].visible = false;
    },
    destroy() { ground.destroy(); over.destroy({ children: true }); },
  };
}
