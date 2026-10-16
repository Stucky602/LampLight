// The harbor you walk around in between runs (ARCHITECTURE §10.4): you, the keepers at their
// doors and on their walks, the characters waiting on the square, the fog pulling back, and the
// two set pieces, a building's level-up ceremony and an arrival by boat. Pure and headless: the
// app steps it once a tick with the input frame, the hub view draws what it says, and the tests
// drive it in Node.
//
// You move with the run's own feel (tuning.player.speed and the dash's distance and time, at your
// character's move speed); only the dash's cooldown is the harbor's own (there is nothing to dodge).
// The harbor's timing (the set pieces, the keepers' walks, the reach) is each world's own `timing`,
// read every tick, so the harbor's tuning panel changes it live (hub/tuning.js).
//
// Set pieces run one at a time; one started while another runs waits its turn. Each carries the
// state it leaves behind (the fog cleared, who is out), and applies it at its moment: the fog peels
// back as the building goes up, a keeper steps out when it's done, a newcomer joins the others
// when they reach their spot. Skipping one applies all of it at once.

import { createTerrain, TILE } from '../sim/terrain.js';
import { BTN_DASH } from '../lib/inputframe.js';
import { HUB_TUNING } from '../data/tuning.js';
import { buildHubMap, clearTiles, solidTiles, plotAtDoor, arrivalPath, nearestOpen } from './map.js';

const HALF = TILE / 2;
const center = (t) => t * TILE + HALF;
const clamp01 = (u) => (u < 0 ? 0 : u > 1 ? 1 : u);
const smooth = (u) => { const c = clamp01(u); return c * c * (3 - 2 * c); };

/** How the harbor's set pieces are timed by default (data/tuning.js HUB_TUNING.timing). */
export const HUB_TIMING = HUB_TUNING.timing;

/** A ceremony's length: the pan in, the build or the fog (whichever is longer), the hold, the pan out. */
export function ceremonyTime(T = HUB_TIMING) { return T.panIn + Math.max(T.build, T.fogPeel) + T.hold + T.panOut; }
export const CEREMONY_TIME = ceremonyTime();

/**
 * @param {object} o
 * @param {object} o.hub data/hub.js HUB
 * @param {object} o.terrain data/hub.js HUB_TERRAIN
 * @param {object} o.tuning data/tuning.js (player speed, radius, and dash)
 * @param {Iterable<string>} o.revealed fog region ids already clear
 * @param {Array<{id, sprite, at}>} [o.props] the props that are out (meta/state.js shownProps)
 * @param {number} [o.moveSpeed] your character's move speed (1 = tuning.player.speed)
 * @param {object} [o.timing] the harbor's timing (HUB_TUNING.timing's shape; the app's live copy)
 */
export function createHubWorld({ hub, terrain, tuning, revealed, props = [], moveSpeed = 1, timing = HUB_TIMING }) {
  const map = buildHubMap(hub, terrain);
  const T = tuning.player;
  const w = {
    hub, map,
    T: timing,                        // read every tick: a change to it applies at once
    revealed: new Set(revealed),
    props: [...props],
    clear: null, solid: null, collide: null,
    fogFade: new Map(),               // regionId -> 1..0: a region clearing, fading out
    time: 0,
    speed: T.speed * moveSpeed, radius: T.radius,
    dash: { distance: T.dash.distance, time: T.dash.time },
    player: {
      x: center(hub.spawn[0]), y: center(hub.spawn[1]), px: 0, py: 0,
      fx: 0, fy: 1, facing: 1, moving: false,
      dashTicks: 0, dashSpeed: 0, dashCd: 0, dashX: 0, dashY: 0, prevButtons: 0,
    },
    people: [],                       // keepers and waiting characters (setPeople)
    near: null,                       // what confirm would use: { kind: 'door' | 'gate' | 'person', id }
    cam: { x: 0, y: 0, px: 0, py: 0 },   // where the camera looks (and looked last tick)
    timeline: null,                   // the set piece running now
    queue: [],                        // set pieces waiting their turn
    events: [],                       // this tick's: { kind: 'dash' | 'build_start' | 'build_done' | 'landed' | 'done' | 'walk_off' }
    walkOff: 0,                       // s pushing west off the quay's end (-1: fired, waiting for you to let go)
  };
  w.player.px = w.player.x; w.player.py = w.player.y;
  rebuildSolid(w);
  w.cam.x = w.cam.px = w.player.x; w.cam.y = w.cam.py = w.player.y;
  return w;
}

function rebuildSolid(w) {
  w.clear = clearTiles(w.map, w.revealed);
  w.solid = solidTiles(w.map, w.clear, w.props);
  w.collide = createTerrain({ cols: w.map.cols, rows: w.map.rows, solid: w.solid });
  // Something appeared where you stand (a prop at the end of a ceremony): step to the nearest
  // open tile rather than stick in it. One that only reaches the edge of you pushes you clear of
  // it now, rather than on your next step.
  const p = w.player;
  if (!p) return;
  const tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE);
  if (w.solid[ty * w.map.cols + tx]) {
    const to = nearestOpen(w.map, w.solid, [tx, ty]);
    if (to) { p.x = p.px = center(to[0]); p.y = p.py = center(to[1]); }
  }
  const out = [0, 0];
  if (w.collide.collide(p.x, p.y, w.radius, out)) { p.x = p.px = out[0]; p.y = p.py = out[1]; }
}

/** The props that are out changed (a level brought one out). */
export function setProps(w, props) {
  w.props = [...props];
  rebuildSolid(w);
}

/**
 * The fog's cleared regions changed. The newly clear ones fade out over the timing's fogPeel when
 * `fade` is true, or go at once (loading the harbor).
 */
export function setRevealed(w, revealed, { fade = true } = {}) {
  const next = new Set(revealed);
  if (fade) for (const id of next) if (!w.revealed.has(id)) w.fogFade.set(id, 1);
  w.revealed = next;
  rebuildSolid(w);
}

/**
 * Who is out in the harbor: [{ id, sprite, kind: 'keeper' | 'waiting', post: [x, y], loop?: [[x, y]...] }].
 * A keeper with a loop walks it; everyone else stands at their post (the characters waiting face
 * the middle of the square). People already out keep their place (and their walk) when the list
 * is set again with the same post and walk.
 */
export function setPeople(w, list) {
  const old = new Map(w.people.map((p) => [p.id, p]));
  w.people = list.map((d) => {
    const was = old.get(d.id);
    const same = was && was.kind === d.kind && was.post[0] === d.post[0] && was.post[1] === d.post[1] && (was.loop?.length ?? 0) === (d.loop?.length ?? 0);
    const facing = d.kind === 'waiting' && d.post[0] > w.hub.spawn[0] ? -1 : 1;
    const p = same ? Object.assign(was, d) : { ...d, x: center(d.post[0]), y: center(d.post[1]), facing, leg: 0, wait: 0 };
    p.px = p.x; p.py = p.y;
    return p;
  });
}

function begin(w, tl) {
  if (w.timeline) w.queue.push(tl);
  else w.timeline = tl;
}

/**
 * A building's level-up ceremony: the camera pans to it, the new stage goes up while the fog peels
 * back to `revealed` (the regions clear after this level), then the keeper steps out and the props
 * appear (`people` and `props`: who and what is out after it), and the camera comes back. The
 * three are optional.
 */
export function startCeremony(w, { building, level, from, revealed = null, people = null, props = null }) {
  const plot = w.map.plots.find((p) => p.building === building);
  if (!plot) throw new Error(`startCeremony: no plot for ${building}`);
  begin(w, {
    kind: 'ceremony', building, level, from: from ?? level - 1, t: 0, build: 0,
    x: (plot.x + plot.w / 2) * TILE, y: (plot.y + plot.h / 2) * TILE,
    total: ceremonyTime(w.T), revealed, people, props, built: false, peeled: false,
  });
}

/**
 * An arrival by boat: the camera pans to the boat, which sails the harbor's route; the newcomer
 * steps off, walks up the pier to `waitAt` (a tile on the square), and joins the others; the
 * camera comes back to you. `people` (optional) is who is out afterward; by default the newcomer
 * joins whoever is out now.
 */
export function startArrival(w, { id, sprite, waitAt, people = null }) {
  if (!Array.isArray(waitAt) || waitAt.length !== 2 || !waitAt.every(Number.isInteger)) {
    throw new Error(`startArrival: ${id} needs a tile to wait at on the square ([x, y]), not ${JSON.stringify(waitAt)}`);
  }
  const H = w.hub.harbor;
  const route = H.boatRoute.map(([x, y]) => [center(x), center(y)]);
  const end = route[route.length - 1];
  // She steps off from where she stood in the boat (the view draws her there while it sails).
  const walk = [[end[0] + (H.aboard ?? 0), end[1] + (H.deck ?? 0)], ...arrivalPath(w.hub, waitAt).map(([x, y]) => [center(x), center(y)])];
  begin(w, {
    kind: 'arrival', id, sprite, t: 0, phase: 'panIn', phaseT: 0,
    route, walk, boat: { x: route[0][0], y: route[0][1], px: route[0][0], py: route[0][1], leg: 0, facing: 1 },
    walker: { x: walk[0][0], y: walk[0][1], px: walk[0][0], py: walk[0][1], leg: 0, facing: 1, moving: false },
    waitAt, people,
  });
}

/** Apply what a set piece leaves behind (all of it, when skipped). */
function settle(w, tl, { fade }) {
  if (tl.kind === 'ceremony') {
    if (!tl.peeled) { if (tl.revealed) setRevealed(w, tl.revealed, { fade }); tl.peeled = true; }
    if (!tl.built) { tl.built = true; tl.build = 1; if (tl.people) setPeople(w, tl.people); if (tl.props) setProps(w, tl.props); }
  } else if (!tl.settled) {
    tl.settled = true;
    setPeople(w, tl.people ?? [...w.people.filter((p) => p.id !== tl.id), { id: tl.id, sprite: tl.sprite, kind: 'waiting', post: tl.waitAt }]);
  }
}

/** End the set piece running now and start the next; returns the 'done' event for it. */
function finish(w) {
  const done = { kind: 'done', of: w.timeline.kind };
  w.timeline = w.queue.shift() ?? null;
  if (!w.timeline) { w.cam.x = w.cam.px = w.player.x; w.cam.y = w.cam.py = w.player.y; }
  return done;
}

/**
 * Finish the set piece running now at once (the player pressed a button to skip it): what it
 * leaves behind lands with no fade, and the next one waiting (if any) starts. Returns the events
 * it would have had from here ('build_done', 'landed', then 'done'), so the scene still names what
 * the level brought; the fog's own start ('build_start') is skipped with the rest.
 */
export function skipTimeline(w) {
  const tl = w.timeline;
  if (!tl) return [];
  const out = [];
  if (tl.kind === 'ceremony' && !tl.built) out.push({ kind: 'build_done', building: tl.building, level: tl.level });
  if (tl.kind === 'arrival' && (tl.phase === 'panIn' || tl.phase === 'sail')) out.push({ kind: 'landed', id: tl.id });
  settle(w, tl, { fade: false });
  if (tl.kind === 'arrival') {
    const last = tl.route[tl.route.length - 1], spot = tl.walk[tl.walk.length - 1];
    tl.boat.x = tl.boat.px = last[0]; tl.boat.y = tl.boat.py = last[1];
    tl.walker.x = tl.walker.px = spot[0]; tl.walker.y = tl.walker.py = spot[1]; tl.walker.moving = false;
  }
  w.fogFade.clear();
  out.push(finish(w));
  return out;
}

/** Move toward a point at `speed`; returns true on arrival. Writes x, y, facing on `o`. */
function moveTo(o, tx, ty, speed, dt) {
  const dx = tx - o.x, dy = ty - o.y, d = Math.sqrt(dx * dx + dy * dy);
  const step = speed * dt;
  if (Math.abs(dx) > 0.01) o.facing = dx > 0 ? 1 : -1;
  if (d <= step) { o.x = tx; o.y = ty; return true; }
  o.x += (dx / d) * step; o.y += (dy / d) * step;
  return false;
}

/** Walk `o` along `path` (px points) from its current leg; returns true at the last point. */
function follow(o, path, speed, dt) {
  const next = path[o.leg + 1];
  if (!next) return true;
  if (moveTo(o, next[0], next[1], speed, dt)) o.leg++;
  return o.leg >= path.length - 1;
}

function stepCeremony(w, tl) {
  const T = w.T;
  tl.total = ceremonyTime(T);   // the timing may have been tuned since it started
  const buildT = tl.t - T.panIn;
  if (buildT >= 0 && !tl.peeled) {
    if (tl.revealed) setRevealed(w, tl.revealed, { fade: true });
    tl.peeled = true;
    w.events.push({ kind: 'build_start', building: tl.building, level: tl.level });
  }
  tl.build = clamp01(buildT / T.build);
  if (tl.build >= 1 && !tl.built) {
    tl.built = true;
    if (tl.people) setPeople(w, tl.people);
    if (tl.props) setProps(w, tl.props);
    w.events.push({ kind: 'build_done', building: tl.building, level: tl.level });
  }
  // The camera: to the building, hold, and back to you.
  const k = smooth(tl.t / T.panIn) * (1 - smooth((tl.t - (tl.total - T.panOut)) / T.panOut));
  w.cam.x = w.player.x + (tl.x - w.player.x) * k;
  w.cam.y = w.player.y + (tl.y - w.player.y) * k;
  if (tl.t >= tl.total) w.events.push(finish(w));
}

function stepArrival(w, tl, dt) {
  const T = w.T, p = w.player;
  tl.phaseT += dt;
  // Where they were last tick, for the view to draw between.
  tl.boat.px = tl.boat.x; tl.boat.py = tl.boat.y;
  tl.walker.px = tl.walker.x; tl.walker.py = tl.walker.y;
  if (tl.phase === 'panIn') {
    const k = smooth(tl.phaseT / T.panIn);
    w.cam.x = p.x + (tl.boat.x - p.x) * k; w.cam.y = p.y + (tl.boat.y - p.y) * k;
    if (tl.phaseT >= T.panIn) { tl.phase = 'sail'; tl.phaseT = 0; }
  } else if (tl.phase === 'sail') {
    if (follow(tl.boat, tl.route, T.boatSpeed, dt)) { tl.phase = 'walk'; tl.phaseT = 0; w.events.push({ kind: 'landed', id: tl.id }); }
    w.cam.x = tl.boat.x; w.cam.y = tl.boat.y;
  } else if (tl.phase === 'walk') {
    tl.walker.moving = true;
    if (follow(tl.walker, tl.walk, T.arriveSpeed, dt)) {
      tl.walker.moving = false;
      settle(w, tl, { fade: true });
      tl.phase = 'panOut'; tl.phaseT = 0;
    }
    w.cam.x = tl.walker.x; w.cam.y = tl.walker.y;
  } else {
    const k = smooth(tl.phaseT / T.panOut);
    w.cam.x = tl.walker.x + (p.x - tl.walker.x) * k; w.cam.y = tl.walker.y + (p.y - tl.walker.y) * k;
    if (tl.phaseT >= T.panOut) w.events.push(finish(w));
  }
}

function stepPeople(w, dt) {
  const T = w.T;
  for (const p of w.people) {
    p.px = p.x; p.py = p.y;
    p.moving = false;
    if (!p.loop || p.loop.length < 2) continue;
    if (p.wait > 0) { p.wait -= dt; continue; }
    const next = p.loop[(p.leg + 1) % p.loop.length];
    p.moving = true;
    if (moveTo(p, center(next[0]), center(next[1]), T.walkSpeed, dt)) { p.leg = (p.leg + 1) % p.loop.length; p.wait = T.keeperPause; }
  }
}

/**
 * What's in reach of you: the door, the gate, or the person nearest you, within the reach. People
 * are weighed first, so a door or the gate wins a tie (a keeper walking past a door never takes
 * it over). A plot marked `anySide` (the Lamp Post on the square) is used from any side: the
 * distance is to its nearest edge rather than to its door tile.
 */
function findNear(w) {
  const p = w.player, R = w.T.reach;
  let best = null, bestD = R * R;
  const consider = (kind, id, x, y) => {
    const dx = x - p.x, dy = y - p.y, d = dx * dx + dy * dy;
    if (d <= bestD) { bestD = d; best = { kind, id }; }
  };
  for (const person of w.people) consider('person', person.id, person.x, person.y);
  for (const plot of w.map.plots) {
    if (plot.anySide) {
      const x0 = plot.x * TILE, y0 = plot.y * TILE, x1 = x0 + plot.w * TILE, y1 = y0 + plot.h * TILE;
      consider('door', plot.building, Math.min(Math.max(p.x, x0), x1), Math.min(Math.max(p.y, y0), y1));
    } else consider('door', plot.building, center(plot.door[0]), center(plot.door[1]));
  }
  const g = w.hub.gate.at;
  consider('gate', 'gate', center(g[0]), center(g[1]));
  return best;
}

/**
 * One tick. frame: an InputFrame ({ mx, my, buttons }: axes -127..127, BTN_DASH the dash), or null
 * while a screen is open (you stand still, and the walk-off keeps its state). While a
 * set piece runs you stand still. Read `w.near`, `w.timeline`, `w.events`, and the positions after.
 */
export function stepHub(w, frame, dt) {
  if (!(dt > 0 && dt < Infinity)) return;   // a tick has a length (the loop always passes 1/60 s)
  w.time += dt;
  w.events.length = 0;
  const p = w.player;
  p.px = p.x; p.py = p.y;
  w.cam.px = w.cam.x; w.cam.py = w.cam.y;
  for (const [id, a] of w.fogFade) { const v = a - dt / w.T.fogPeel; if (v <= 0) w.fogFade.delete(id); else w.fogFade.set(id, v); }
  stepPeople(w, dt);
  p.dashCd = Math.max(0, p.dashCd - dt);
  if (w.timeline) {
    p.moving = false; p.dashTicks = 0; p.prevButtons = (frame?.buttons ?? 0) | 0;
    w.timeline.t += dt;
    if (w.timeline.kind === 'ceremony') stepCeremony(w, w.timeline); else stepArrival(w, w.timeline, dt);
    w.near = null;
    return;
  }

  let mx = (frame?.mx ?? 0) / 127, my = (frame?.my ?? 0) / 127;
  if (!(mx >= -1 && mx <= 1)) mx = 0;
  if (!(my >= -1 && my <= 1)) my = 0;
  const m2 = mx * mx + my * my;
  if (m2 > 1) { const m = Math.sqrt(m2); mx /= m; my /= m; }
  p.moving = m2 > 0.0004;
  if (p.moving) { const m = Math.sqrt(mx * mx + my * my); p.fx = mx / m; p.fy = my / m; if (Math.abs(mx) > 0.05) p.facing = mx > 0 ? 1 : -1; }
  const buttons = (frame?.buttons ?? 0) | 0;
  const pressed = (buttons & BTN_DASH) !== 0 && (p.prevButtons & BTN_DASH) === 0;
  p.prevButtons = buttons;
  let vx, vy;
  if (p.dashTicks > 0) {
    p.dashTicks--;
    vx = p.dashX * p.dashSpeed; vy = p.dashY * p.dashSpeed;
  } else if (pressed && p.dashCd === 0) {
    // As in the run (sim/player.js): the dash's time in whole ticks, and exactly its distance.
    const ticks = Math.max(1, Math.round(w.dash.time / dt));
    p.dashX = p.fx; p.dashY = p.fy;
    p.dashSpeed = w.dash.distance / (ticks * dt);
    p.dashTicks = ticks - 1; p.dashCd = w.T.dashCooldown;
    vx = p.dashX * p.dashSpeed; vy = p.dashY * p.dashSpeed;
    w.events.push({ kind: 'dash' });
  } else {
    vx = mx * w.speed; vy = my * w.speed;
  }
  if (vx !== 0 || vy !== 0) {
    const out = [0, 0];
    w.collide.collide(p.x + vx * dt, p.y + vy * dt, w.radius, out);
    p.x = out[0]; p.y = out[1];
  }
  w.cam.x = p.x; w.cam.y = p.y;
  w.near = findNear(w);
  // Walking off the quay's west end, by the gate, sets out (as confirm at the gate does): a
  // push west against the map's edge on the gate's row or the one below it, for timing.walkOff
  // seconds. It fires once a push; only a real frame with west let go arms it again. A null
  // frame (a screen is open: the scene passes no input) leaves it as it was, so closing the
  // gate's screen with the stick still held west doesn't reopen it.
  const g = w.hub.gate.at, row = Math.floor(p.y / TILE);
  const atEdge = p.x <= w.radius + 1 && (row === g[1] || row === g[1] + 1);
  if (atEdge && mx < -0.5 && p.dashTicks === 0) {
    if (w.walkOff >= 0 && (w.walkOff += dt) >= w.T.walkOff - 1e-9) { w.walkOff = -1; w.events.push({ kind: 'walk_off' }); }
  } else if (frame && mx > -0.3) w.walkOff = 0;
}

/** The building whose door this tile is (for tools and tests). */
export function doorAt(w, tile) { return plotAtDoor(w.map, tile)?.building ?? null; }
