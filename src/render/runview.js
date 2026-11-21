// The run, drawn (ARCHITECTURE §6). Reads the sim's state and event buffer; writes nothing back.
//
// Layers, bottom to top (§6.2):
//   ground tiles · decals · blob shadows · ground zones · gems and pickups · enemies (and the
//   ones dying) · shots · elites and bosses (y-sorted; bosses are rigs) · sparks and embers
//   (additive) · the light map (multiplied) · fog (thinned wherever the light map is bright)
//   · warnings (drawn after the light and fog so a hazard is never lost in the dark)
//   · the player (above all of it, so she is never lost either) · damage numbers.
// The HUD is separate (render/hud.js), in its own layer.
//
// Each frame: positions are interpolated between the last two ticks by `alpha`; sprites sit on
// whole pixels. Everything that is many (enemies, shots, gems, shadows, sparks, digits, tiles)
// is a ParticleContainer drawing from the one atlas texture. What the view remembers between
// frames (effects, warnings, the dying, per-enemy squash and facing) lives in render/viewstate.js,
// which the gate tests; this file only draws. The per-entity loops create no objects; a frame
// allocates a few small objects (Graphics styles, the camera split), well inside the §17 budget.

import { Container, Graphics, ParticleContainer, Particle, Sprite, RenderTexture, TilingSprite } from 'pixi.js';
import { TELE, PICK, END } from '../sim/events.js';
import { EF, PF, ZONE, ZF, ZSTYLE, MARKS, AI, CAP, INNATE_SLOT, TASK, TASK_STATE, LEECH } from '../sim/constants.js';
import { isSunk } from '../sim/player.js';
import { isNight, ward } from '../sim/tasks.js';
import { CHARGER, RANGED } from '../sim/enemies.js';
import { hazardLook, HAZARD_LOOK } from '../sim/attacks.js';
import { TILE } from '../sim/terrain.js';
import { VIEW_W, VIEW_H, MARGIN, splitCamera } from './layout.js';
import { color as pal } from '../data/palette.js';
import { packColor, fadeOut } from './feel.js';
import { DIGIT_ADVANCE } from './font.js';
import {
  createViewState, resetViewState, consumeEvents, markTick, noteEnemy, expireTelegraphs, expireDying, expireLights,
  screenFlash, enemyLook, LOOK, LOOK_COLOR, FX_COLOR, PF_FRAME, simSeconds, animFrameIndex, stepHop, dazeWobble, groundFrame, BOLT_MS, HAUL_MS, wardStrength,
  MARSH_COLOR, airLift, airProgress, NUMBERS_CLEAR, TIER, TELL_PX, poolTierAt, tellShowing,
} from './viewstate.js';
import { RIGS } from './rigs.js';
import { weaponLook } from '../data/ascensions.js';
import { capstoneLook } from './looks.js';
import { rigInput } from './rigpose.js';
import { createRigView } from './rigview.js';
import { createSignView, skiffAt, SIGN_COLOR, LAMP_GLASS, LAMP_GLASS_DX } from './signview.js';
import { PLAYER_FEET_ROOM } from './playerframe.js';
import { runAmbient } from './brightness.js';

const TAU = Math.PI * 2;
/** Elite affix bits (data/enemies.js AFFIXES, W3's contract §4), in the order their pips are drawn. */
const AFFIX_BIT = Object.freeze({ warded: 1, herald: 2, molten: 4, tethered: 8, brine: 16 });
const AFFIX_ORDER = Object.freeze([1, 2, 4, 8, 16]);
const WHITE = 0xffffff;
const LIGHT_W = Math.ceil((VIEW_W + MARGIN * 2) / 2) + 1;
const LIGHT_H = Math.ceil((VIEW_H + MARGIN * 2) / 2) + 1;
/** How high a hop or a leap rises at its top (px): a toad's, and a boss's (the Old Grey's). */
const HOP_PX = 12, LEAP_PX = 36;

/** A ParticleContainer plus the particles it draws this frame (reused frame to frame). */
function createLayer(opts = {}) {
  const container = new ParticleContainer({
    dynamicProperties: { position: true, vertex: true, rotation: true, uvs: true, color: true },
    roundPixels: true,
    ...opts,
  });
  const parts = [];
  const vis = container.particleChildren;
  let n = 0;
  return {
    container,
    begin() { n = 0; },
    add(tex, x, y, sx, sy, rot, col) {
      let p = parts[n];
      if (!p) { p = new Particle({ texture: tex, anchorX: 0.5, anchorY: 0.5 }); parts.push(p); }
      p.texture = tex; p.x = x; p.y = y; p.scaleX = sx; p.scaleY = sy; p.rotation = rot;
      p.color = col;
      vis[n] = p;
      n++;
      return p;
    },
    end() { if (vis.length !== n) vis.length = n; },
    get count() { return n; },
  };
}

/** Is this enemy showing a warning (a charger winding up, a gunner aiming)? */
function isWarned(E, i) {
  // EF.WARNING (W3, 0.9.0): any enemy showing a warned attack of its own (a rat or a midge
  // crouched to pounce, a champion).
  return (EF.WARNING !== undefined && (E.flags[i] & EF.WARNING) !== 0)
    || (E.ai[i] === AI.charger && E.aiState[i] === CHARGER.WINDUP) || (E.ai[i] === AI.ranged_slow && E.aiState[i] === RANGED.WARN);
}

export function createRunView({ renderer, atlas, data, access }) {
  let feel = data.tuning.feel;
  const st = createViewState({ slots: CAP.enemies });
  const root = new Container();
  const groundLayer = createLayer({ dynamicProperties: { position: false, vertex: false, rotation: false, uvs: false, color: false } });
  const decals = createLayer();
  const shadows = createLayer();
  const zoneG = new Graphics();
  const pickups = createLayer();
  const enemies = createLayer();
  const shots = createLayer();
  const actors = new Container();
  actors.sortableChildren = true;
  const effects = createLayer();
  effects.container.blendMode = 'add';
  const lightRT = RenderTexture.create({ width: LIGHT_W, height: LIGHT_H });
  const fogRT = RenderTexture.create({ width: LIGHT_W, height: LIGHT_H });
  lightRT.source.scaleMode = 'linear';
  fogRT.source.scaleMode = 'linear';
  const lightSprite = new Sprite(lightRT);
  lightSprite.blendMode = 'multiply';
  lightSprite.scale.set(2);
  const fogSprite = new Sprite(fogRT);
  fogSprite.scale.set(2);
  const teleG = new Graphics();
  // C3: the elite affixes' icons over an elite's head (art/draw/affixes.js), unlit like the warnings.
  const affixLayer = createLayer();
  const numbersLayer = createLayer();
  // The player is drawn last of the world, above the light, fog, and warnings: she is never lost
  // under a pile of warning shapes or in the dark (§16.4: the player is the highest-contrast thing
  // on screen, never tinted). Her lamp lights her spot anyway.
  const playerLayer = new Container();
  // Over her too (0.8.0): leeches latched on, and the peat while the Bog Torc has her sunk.
  const latchLayer = createLayer();
  const peatG = new Graphics();
  // The map's signs (0.8.2, render/signview.js): rings and wards on the ground under the light;
  // the lamps' glass, the bell's count, what a thing pays, and the beams over the fog (under the
  // warnings, which nothing covers).
  const signs = createSignView({ atlas, spark: (x, y, vx, vy, ms, col) => st.sparks.spawn(x, y, vx, vy, ms, PF_FRAME.SPARK, col, 0, 0) });
  root.addChild(groundLayer.container, decals.container, shadows.container, zoneG, signs.ground, pickups.container, enemies.container,
    shots.container, actors, effects.container, lightSprite, fogSprite, signs.over, teleG, affixLayer.container, playerLayer, numbersLayer.container);

  // Light and fog passes (rendered into their own small textures before the world is drawn).
  const lightRoot = new Container();
  const lights = createLayer({ texture: atlas.glow });
  lights.container.blendMode = 'add';
  lightRoot.addChild(lights.container);
  const fogRoot = new Container();
  const fogTile = new TilingSprite({ texture: atlas.fog, width: LIGHT_W, height: LIGHT_H });
  const fogCut = createLayer({ texture: atlas.glow });
  fogCut.container.blendMode = 'erase';
  fogRoot.addChild(fogTile, fogCut.container);

  const T = (id) => atlas.tex(id);
  const PARTICLE_FRAMES = [T('p1'), T('p2'), T('p3'), T('p4'), T('ring')]; // PF_FRAME order
  const SHADOW = [T('shadow_s'), T('shadow_m'), T('shadow_l')];
  const DIGIT = []; for (let d = 0; d < 10; d++) DIGIT.push(T(`digit:${d}`));
  const groundCache = new Map();
  const groundTex = (id) => { let t = groundCache.get(id); if (t === undefined) { t = T(id); groundCache.set(id, t); } return t; };
  const GEM = [T('gem_1'), T('gem_2'), T('gem_3'), T('gem_big')];
  // Per enemy type: its animation frames (one for a still sprite), plain, flashing, and elite.
  const typeTex = [], typeFlash = [], eliteTex = [], eliteFlash = [], typeFps = [], typeRig = [];
  const rigIds = Object.keys(RIGS);
  for (const e of data.enemies) {
    typeTex.push(atlas.frames(e.sprite)); typeFlash.push(atlas.frames(e.sprite, '#flash'));
    const boss = e.ai.type === 'boss';
    eliteTex.push(boss ? [T(e.sprite)] : atlas.frames(e.sprite, '#elite'));
    eliteFlash.push(boss ? [T(`${e.sprite}#flash`)] : atlas.frames(e.sprite, '#elite#flash'));
    typeFps.push(atlas.anim(e.sprite).fps);
    typeRig.push(boss ? rigIds.indexOf(e.sprite) : -1);
  }
  /** Which animation frame enemy i shows (viewstate.animFrameIndex); a held enemy stops on one frame. */
  const animFrame = (E, i, simSec) => animFrameIndex(typeTex[E.type[i]].length, typeFps[E.type[i]], simSec, E.anim[i], E.freezeT[i] > 0 || E.dazeT[i] > 0);
  const shotTex = data.weapons.map((w) => (atlas.has(w.sprite) ? T(w.sprite) : T('p3')));
  const shotUpright = data.weapons.map((w) => w.upright === true); // drawn as they stand (weapons.js)
  const shotLight = data.weapons.map((w) => (w.tags.includes('fire') || w.tags.includes('light') ? 1 : 0));
  const hostileTex = T('proj_hostile');
  const matTex = data.materials.map((m) => T(m.icon));
  const PK_HEAL = T('pk_heal'), PK_MAGNET = T('pk_magnet'), CHEST_E = T('chest_elite'), CHEST_B = T('chest_boss'), CACHE = T('secret_cache'), EMBER = T('pk_ember');
  // Phase 7: a Reliquary, the vault, Sea Glass, the run's tasks, and the Ferryman's skiff.
  const RELIQ = T('pk_reliquary'), VAULT = T('pk_vault'), GLASS = T('pk_glass'), LAMP = T('prop_lamppost'), BELL = T('task_bell'), SKIFF = T('ferry_skiff');
  // The Ferryman himself, standing in his skiff (0.8.2): the harbor's old fisher, reused.
  const FERRYMAN = T('npc_fisher');
  const skiff = { shown: false, x: 0, y: 0, u: 0 };
  // The player in a run wears her light rim (the atlas's `#rim` frames), so she reads over a crowd.
  const playerTex = new Map(data.characters.map((c) => [c.sprite, [T(`${c.sprite}#rim`), T(`${c.sprite}#rim#flash`)]]));
  // The Salt Marsh's (0.8.0): glass pillars, herb beds, the Salt Well, the bog body (its secret).
  const PILLAR = T('marsh_pillar'), HERBS = T('marsh_herbs'), WELL = T('marsh_well'), BOGBODY = T('marsh_bog_body');
  const PIP = PARTICLE_FRAMES[PF_FRAME.SPARK];
  /** How high each enemy in view is drawn this frame (in the air), for the elites and bosses drawn after. */
  const liftOf = new Float32Array(CAP.enemies);
  const latchedList = new Int32Array(8);
  let latchedCount = 0;
  let slowStep = -1;   // the render step the last slow drop fell on

  // Colors, packed once.
  const C = {
    white: packColor(WHITE), dim: packColor(pal('fog-2')), lamp: FX_COLOR.lamp, cool: FX_COLOR.cool, ember: FX_COLOR.ember, gem: FX_COLOR.gem,
    warn: FX_COLOR.warn, warnHot: FX_COLOR.warnHot, violet: FX_COLOR.violet, ward: FX_COLOR.ward,
    crit: pal('lamp-5'), hurt: pal('rot-4'), heal: pal('moss-4'), number: pal('fog-5'),
    rot3: pal('rot-3'), rot2: pal('rot-2'), rope: pal('wood-4'), pole: pal('wood-4'), poleLit: pal('skin-3'), sea: pal('sea-5'), violet1: pal('violet-1'), fog: pal('night-4'),
    thrall: packColor(MARSH_COLOR.thrall), thrallPip: packColor(MARSH_COLOR.thrallPip), feverPip: packColor(MARSH_COLOR.feverPip),
    salt: packColor(MARSH_COLOR.salt), puddle: pal('gem-3'), puddleEdge: pal('gem-4'), glass: pal('fog-5'), well: MARSH_COLOR.well,
    peat: MARSH_COLOR.peat, peatTop: MARSH_COLOR.peatTop,
    // High contrast's light outline round a warning (0.9.0, W7's access.highContrast).
    hcEdge: pal('fog-5'), brine: pal('fog-4'),
    // Elite affixes, in AFFIX_ORDER: Warded, Herald, Molten, Tethered, Brine; and the pips' backing.
    affix: [pal('fog-5'), pal('lamp-5'), pal('rot-3'), pal('violet-4'), pal('sea-6')], pipBack: pal('night-0'),
  };
  const LOOK_PACKED = LOOK_COLOR.map((c) => packColor(c));

  // The player, elites, and bosses: real sprites, y-sorted.
  const playerSprite = new Sprite();
  playerSprite.anchor.set(0.5);
  playerLayer.addChild(playerSprite);
  playerLayer.addChild(peatG, latchLayer.container);
  const actorPool = [];
  const actorList = new Int32Array(CAP.enemies); // every elite and boss in view, however many
  let actorCount = 0;

  let world = null;
  /** Warned now: a charger winding up, a gunner aiming, or a DIM tell flashing its body (0.9.0). */
  const warnedNow = (E, i) => isWarned(E, i) || tellShowing(st, E.idAt(i), E.handle(i), world.tick);
  let now = 0;               // render clock, ms
  let groundKey = -1;
  let groundVersion = -1;
  const stats = { enemiesDrawn: 0, shotsDrawn: 0, particles: 0, numbers: 0, lights: 0, jsMs: 0 };
  let passMs = 0;            // time in the light and fog render passes (GPU submission, not our JS)
  const origin = { x: 0, y: 0 }; // world position of light-map pixel (0, 0)
  const flashOut = { hurt: 0, level: 0 };

  function lerp(a, b, t) { return a + (b - a) * t; }

  function inView(x, y, pad) {
    return x > origin.x - pad && x < origin.x + VIEW_W + MARGIN * 2 + pad && y > origin.y - pad && y < origin.y + VIEW_H + MARGIN * 2 + pad;
  }

  function drawGround() {
    const tr = world.terrain;
    const tx0 = Math.floor(origin.x / TILE) - 1, ty0 = Math.floor(origin.y / TILE) - 1;
    // Rebuilt when the camera crosses a tile, or the ground changes under it (the Marsh's water and
    // glass pillars bump terrain.version, at most 4 times a second).
    const key = (ty0 + 1024) * 4096 + (tx0 + 1024);
    if (key === groundKey && tr.version === groundVersion) return;
    groundKey = key;
    groundVersion = tr.version;
    groundLayer.begin();
    const cols = Math.ceil((VIEW_W + MARGIN * 2) / TILE) + 3, rows = Math.ceil((VIEW_H + MARGIN * 2) / TILE) + 3;
    for (let ty = ty0; ty < ty0 + rows; ty++) {
      if (ty < 0 || ty >= tr.rows) continue;
      for (let tx = tx0; tx < tx0 + cols; tx++) {
        if (tx < 0 || tx >= tr.cols) continue;
        const tex = groundTex(groundFrame(tr, tx, ty));
        groundLayer.add(tex, tx * TILE + TILE / 2, ty * TILE + TILE / 2, 1, 1, 0, C.white);
      }
    }
    groundLayer.end();
    groundLayer.container.update();
  }

  function drawEnemies(alpha) {
    const E = world.enemies, F = feel, bob = F.bob, sq = F.squash;
    const simSec = simSeconds(world), simMs = simSec * 1000;
    const phase = simSec * bob.perSec * TAU;
    // The warning pulse and status flickers run on sim time too: they hold while the sim does.
    const pulse = 0.5 + 0.5 * Math.sin(simSec * F.telegraph.pulsePerSec * TAU * 2);
    enemies.begin(); shadows.begin();
    actorCount = 0;
    latchedCount = 0;
    let drawn = 0;
    const latches = world.enemyLatch;
    for (let i = 0; i < E.count; i++) {
      const f = E.flags[i];
      if ((f & EF.DEAD) !== 0) continue;
      const x = lerp(E.px[i], E.x[i], alpha), y = lerp(E.py[i], E.y[i], alpha);
      const r = E.radius[i];
      if (!inView(x, y, r + 16)) continue;
      const id = E.idAt(i);
      noteEnemy(st, id, E.handle(i), now);
      const dx = E.x[i] - E.px[i];
      if (dx > 0.05) st.facing[id] = 1; else if (dx < -0.05) st.facing[id] = -1;
      // In the air (a toad's hop, the Old Grey's leap): raised along an arc over its flight, its
      // shadow already on the spot it will land (where its warning ring is).
      let lift = 0, gx = x, gy = y;
      if ((f & EF.AIR) !== 0) {
        const boss = (f & EF.BOSS) !== 0 && E.boss[i] >= 0 ? world.bosses[E.boss[i]] : null;
        const ax = boss ? boss.ax : E.ax[i], ay = boss ? boss.ay : E.ay[i];
        lift = airLift(airProgress(boss ? boss.sx : E.dx[i], boss ? boss.sy : E.dy[i], x, y, ax, ay), boss ? LEAP_PX : HOP_PX);
        gx = ax; gy = ay;
      }
      liftOf[i] = lift;
      if ((f & (EF.ELITE | EF.BOSS)) !== 0) {
        actorList[actorCount++] = i;
        shadows.add(SHADOW[2], Math.round(gx), Math.round(gy + r * 0.8), r / 15, r / 20, 0, C.white);
        continue;
      }
      // A leech latched on rides over you: drawn on your layer (drawLatched), not under you.
      if (latches !== undefined && latches[E.type[i]] === 1 && E.aiState[i] === LEECH.LATCHED) {
        if (latchedCount < latchedList.length) latchedList[latchedCount++] = i;
        continue;
      }
      // Squash on hit, pop in on spawn, bob, lean into the walk, and the warning swell.
      let sx = 1, sy = 1;
      const since = now - st.hitAt[id];
      if (since < sq.ms) { const s = sq.hit * (1 - since / sq.ms); sx += s * 0.6; sy -= s; }
      const born = now - st.bornAt[id];
      if (born < sq.ms * 1.5) { const s = sq.spawn * (1 - born / (sq.ms * 1.5)); sx -= s; sy -= s; }
      if (warnedNow(E, i)) { sx *= 1 + 0.12 * pulse; sy *= 1 + 0.12 * pulse; }
      const look = enemyLook(E, i, simMs, pulse, warnedNow);
      const type = E.type[i];
      const shadowTex = r > 6 ? SHADOW[1] : SHADOW[0];
      if (look === LOOK.SALT) {
        // Turned to salt (the Brine Vat): a pale grey still silhouette, no bob, no lean, no squash.
        enemies.add(typeFlash[type][0], Math.round(x), Math.round(y), st.facing[id], 1, 0, C.salt);
        shadows.add(shadowTex, Math.round(x), Math.round(y + r * 0.9), 1, 1, 0, C.white);
        drawn++;
        continue;
      }
      const by = lift > 0 ? 0 : Math.round(Math.sin(phase + E.anim[i] * TAU) * bob.px);
      // Lean into the walk; a dazed enemy wobbles instead (its cue: it keeps its colors, §16.4).
      const lean = E.dazeT[i] > 0 ? dazeWobble(simSec, E.anim[i]) : dx > 0.05 ? bob.lean : dx < -0.05 ? -bob.lean : 0;
      const fr = animFrame(E, i, simSec);
      const tex = E.flash[i] > 0 ? typeFlash[type][fr] : typeTex[type][fr];
      const ey = Math.round(y - lift) + by;
      enemies.add(tex, Math.round(x), ey, sx * st.facing[id], sy, lean, LOOK_PACKED[look]);
      shadows.add(shadowTex, Math.round(gx), Math.round(gy + r * 0.9), 1, 1, 0, C.white);
      // Marsh Fever: a violet pip over the one carrying it.
      if (E.feverT[i] > 0) enemies.add(PIP, Math.round(x), ey - Math.round(r) - 4, 1, 1, 0, C.feverPip);
      drawn++;
    }
    drawThralls(alpha, simSec);
    // The dying: flash white, pop, shrink, facing the way they fell.
    expireDying(st, now, F.deathMs, F.deathBigMul);
    const D = st.dying;
    for (let k = 0; k < D.n; k++) {
      const u = (now - D.t[k]) / (F.deathMs * (D.big[k] ? F.deathBigMul : 1));
      const s = u < 0.25 ? 1 + u * 1.2 : 1.3 * (1 - (u - 0.25) / 0.75);
      const type = D.type[k];
      const tex = D.big[k] ? eliteFlash[type][0] : (u < 0.5 ? typeFlash[type][0] : typeTex[type][0]);
      enemies.add(tex, Math.round(D.x[k]), Math.round(D.y[k]), s * D.face[k], s, 0, packColor(WHITE, 1 - u * 0.6));
    }
    enemies.end();
    stats.enemiesDrawn = drawn;
  }

  // The Bog Warden's thralls (sim/allies.js): each its own enemy's sprite, darkened with a cool tint,
  // its moss-green pip above it, walking the way it goes.
  function drawThralls(alpha, simSec) {
    const A = world.allies;
    if (!A) return;
    for (let k = 0; k < A.n; k++) {
      const x = lerp(A.px[k], A.x[k], alpha), y = lerp(A.py[k], A.y[k], alpha);
      if (!inView(x, y, 24)) continue;
      const type = A.type[k], fr = animFrameIndex(typeTex[type].length, typeFps[type], simSec, (k * 0.37) % 1);
      const face = A.x[k] < A.px[k] ? -1 : 1;
      enemies.add(typeTex[type][fr], Math.round(x), Math.round(y), face, 1, 0, C.thrall);
      enemies.add(PIP, Math.round(x), Math.round(y - A.radius[k]) - 5, 1, 1, 0, C.thrallPip);
      shadows.add(SHADOW[0], Math.round(x), Math.round(y + A.radius[k] * 0.9), 1, 1, 0, C.white);
    }
  }

  // Over the player: leeches latched on (riding with her), and the Bog Torc's peat round her while
  // she's sunk (sim/player.js isSunk).
  function drawLatched(alpha, simSec, px, py) {
    const E = world.enemies;
    latchLayer.begin();
    for (let k = 0; k < latchedCount; k++) {
      const i = latchedList[k];
      const x = lerp(E.px[i], E.x[i], alpha), y = lerp(E.py[i], E.y[i], alpha);
      const type = E.type[i], fr = animFrame(E, i, simSec);
      latchLayer.add(E.flash[i] > 0 ? typeFlash[type][fr] : typeTex[type][fr], Math.round(x), Math.round(y) - 6, x < px ? 1 : -1, 1, 0, C.white);
    }
    latchLayer.end();
    peatG.clear();
    if (isSunk(world)) {
      const x = Math.round(px), y = Math.round(py);
      peatG.ellipse(x, y - 1, 11, 6).fill({ color: C.peat, alpha: 1 }).ellipse(x - 1, y - 4, 9, 3).fill({ color: C.peatTop, alpha: 1 });
    }
  }

  function drawActors(alpha) {
    const E = world.enemies, p = world.player, F = feel;
    const simSec = simSeconds(world), simMs = simSec * 1000;
    const pulse = 0.5 + 0.5 * Math.sin(simSec * F.telegraph.pulsePerSec * TAU * 2);
    let used = 0;
    rigLightCount = 0;
    for (let r = 0; r < rigPool.length; r++) rigPool[r].used = 0;
    for (let k = 0; k < actorCount; k++) {
      const i = actorList[k];
      const type = E.type[i], boss = (E.flags[i] & EF.BOSS) !== 0;
      const id = E.idAt(i);
      const x = lerp(E.px[i], E.x[i], alpha), y = lerp(E.py[i], E.y[i], alpha) - liftOf[i];
      if (typeRig[type] >= 0 && E.boss[i] >= 0) { drawRig(typeRig[type], i, x, y, id, pulse, simSec); continue; }
      let s = actorPool[used];
      if (!s) { s = new Sprite(); s.anchor.set(0.5); actorPool.push(s); actors.addChild(s); }
      used++;
      const fr = animFrame(E, i, simSec);
      s.texture = E.flash[i] > 0 ? eliteFlash[type][fr] : eliteTex[type][fr];
      const since = now - st.hitAt[id];
      const sq = since < F.squash.ms ? F.squash.hit * 0.5 * (1 - since / F.squash.ms) : 0;
      const swell = (boss ? Math.sin(simSec * 2.6) * F.bob.bossBreathe : 0) + (warnedNow(E, i) ? 0.1 * pulse : 0);
      s.position.set(Math.round(x), Math.round(y + (boss ? Math.sin(simSec * 1.9) * F.bob.bossPx : 0)));
      s.scale.set((1 + sq * 0.6 + swell) * st.facing[id], 1 - sq + swell);
      s.rotation = E.dazeT[i] > 0 ? dazeWobble(simSec, E.anim[i]) * 0.5 : 0;
      s.tint = LOOK_COLOR[enemyLook(E, i, simMs, pulse, warnedNow)];
      s.visible = true;
      s.zIndex = y;
    }
    // The player: blinks while the invulnerability after a hit lasts (not after a dash).
    const x = lerp(p.px, p.x, alpha), y = lerp(p.py, p.y, alpha);
    const tex = playerTex.get(world.character.sprite);
    const blink = p.iframes > 0 && now - st.hurtAt < 2500 && ((simMs / 70) | 0) % 2 === 0;
    playerSprite.texture = blink ? tex[1] : tex[0];
    // A step bob while walking (the pack's characters are single frames): up a pixel every
    // other step, on sim time, so she stands still whenever the sim does. Sunk in the peat (the
    // Bog Torc), she sits low in it.
    const step = world.over ? 0 : stepHop(p.moving, simSec, F.bob.stepsPerSec);
    const sunk = isSunk(world) ? 6 : 0;
    playerSprite.position.set(Math.round(x), Math.round(y) - PLAYER_FEET_ROOM - step + sunk);
    drawLatched(alpha, simSec, x, y);
    if (p.fx > 0.1) playerSprite.scale.x = 1; else if (p.fx < -0.1) playerSprite.scale.x = -1;
    playerSprite.visible = !world.over || world.over.reason !== END.DIED || ((now / 120) | 0) % 2 === 0;
    shadows.add(SHADOW[0], Math.round(x), Math.round(y + 5), 1, 1, 0, C.white);
    // Slowed (W3's contract §4: midge stings, a Brine elite's touch): cold drops falling off her
    // feet, more the slower she is. She keeps her colors (never tinted).
    if (p.slowPct > 0 && ((now / 80) | 0) !== slowStep) {
      slowStep = (now / 80) | 0;
      if (st.rand() < p.slowPct * 2) st.sparks.spawn(x + (st.rand() - 0.5) * 8, y + 2, 0, 18, 360, PF_FRAME.DOT, C.cool, 0, 0);
    }
    for (let k = used; k < actorPool.length; k++) actorPool[k].visible = false;
    for (let r = 0; r < rigPool.length; r++) { const list = rigPool[r]; for (let k = list.used; k < list.views.length; k++) list.views[k].view.visible = false; }
    actors.sortChildren();
    shadows.end();
  }

  // Bosses are rigs (render/rigs.js): a few views per boss kind, reused (one list per rig, in
  // RIGS order, so a frame walks arrays, not a Map).
  const rigPool = rigIds.map((rigId) => ({ rigId, views: [], used: 0 }));
  const rigLights = new Float64Array(4 * 8);   // x, y, radius, color
  let rigLightCount = 0;
  const lightOut = new Float64Array(4);
  function drawRig(r, i, x, y, id, pulse, simSec) {
    const E = world.enemies, F = feel, list = rigPool[r];
    let v = list.views[list.used];
    if (!v) { v = createRigView(atlas, list.rigId); list.views.push(v); actors.addChild(v.view); }
    list.used++;
    rigInput(world, world.bosses[E.boss[i]], E.anim[i], v.input);
    v.view.visible = true;
    v.view.zIndex = y;
    v.draw(Math.round(x), Math.round(y + Math.sin(simSec * 1.9) * F.bob.bossPx), st.facing[id], E.flash[i] > 0, LOOK_COLOR[enemyLook(E, i, simSec * 1000, pulse, isWarned)]);
    if (rigLightCount < 8 && v.lightAt(lightOut)) { rigLights.set(lightOut, rigLightCount * 4); rigLightCount++; }
  }

  function drawPickups(alpha) {
    const G = world.gems, P = world.pickups, V = feel.vacuum;
    const frameStep = (now / 16) | 0;
    pickups.begin();
    for (let i = 0; i < G.count; i++) {
      const x = lerp(G.px[i], G.x[i], alpha), y = lerp(G.py[i], G.y[i], alpha);
      if (!inView(x, y, 12)) continue;
      const v = G.value[i];
      const tex = G.big[i] ? GEM[3] : v < 5 ? GEM[0] : v < 20 ? GEM[1] : GEM[2];
      pickups.add(tex, Math.round(x), Math.round(y), 1, 1, 0, C.white);
      // The vacuum's sparkle trail, from a few of the gems in flight each frame.
      if (G.state[i] === 1 && V.trail > 0 && (i + frameStep) % V.trailEvery === 0) st.sparks.spawn(x, y, 0, 0, 200, PF_FRAME.DOT, C.gem, 0, 0);
    }
    for (let i = 0; i < P.count; i++) {
      const x = lerp(P.px[i], P.x[i], alpha), y = lerp(P.py[i], P.y[i], alpha);
      if (!inView(x, y, 16)) continue;
      const kind = P.kind[i];
      let tex;
      if (kind === PICK.MATERIAL) tex = matTex[P.a[i]] || matTex[0];
      else if (kind === PICK.HEAL) tex = PK_HEAL;
      else if (kind === PICK.MAGNET) tex = PK_MAGNET;
      else if (kind === PICK.EMBER) tex = EMBER;
      else if (kind === PICK.RELIQUARY) tex = RELIQ;
      else if (kind === PICK.VAULT) tex = VAULT;
      else if (kind === PICK.GLASS) tex = GLASS;
      else tex = P.a[i] === 2 ? CHEST_B : CHEST_E;
      const hover = kind === PICK.CHEST || kind === PICK.VAULT || kind === PICK.RELIQUARY ? 0 : Math.round(Math.sin(now / 260 + i));
      pickups.add(tex, Math.round(x), Math.round(y) + hover, 1, 1, 0, C.white);
    }
    // The map's secret caches, until opened.
    // (On the Marsh the secret is the bog body on its island.)
    const cache = world.marsh ? BOGBODY : CACHE;
    // (0.9.0, W4: a small find is drawn by render/signview.js as a glint, and only once it's out.)
    for (const s of world.secrets) if (!s.open && !s.gift && inView(s.x, s.y, 16)) pickups.add(cache, Math.round(s.x), Math.round(s.y), 1, 1, 0, C.white);
    drawMarshProps();
    // The tasks (a Wayside Lamp is a lamppost, a Fog Bell a bell on the ground) and the skiff.
    for (const t of world.tasks) {
      if ((t.kind !== TASK.LAMP && t.kind !== TASK.BELL) || !inView(t.x, t.y, 24)) continue;   // a crane or cairn: render/signview.js draws it
      pickups.add(t.kind === TASK.LAMP ? LAMP : BELL, Math.round(t.x), Math.round(t.y) - (t.kind === TASK.LAMP ? 8 : 0), 1, 1, 0, t.state === TASK_STATE.DONE && t.kind === TASK.BELL ? C.dim : C.white);
    }
    // The Ferryman (0.8.2, idea 6): not there until his first call; he rows in on the water to the
    // mooring he picked and ties up. He stands in the skiff, the hull drawn over his legs.
    skiffAt(world.ferry, world.tick + alpha, skiff);
    if (skiff.shown && inView(skiff.x, skiff.y, 24)) {
      const bob = Math.round(Math.sin(now / 500)), sx = Math.round(skiff.x), sy = Math.round(skiff.y) + bob;
      const face = world.ferry.bx >= world.ferry.fromX ? 1 : -1;
      pickups.add(FERRYMAN, sx + 3 * face, sy - 9, face, 1, 0, C.white);
      pickups.add(SKIFF, sx, sy, face, 1, 0, C.white);
    }
    pickups.end();
  }

  // The Salt Marsh's things on the ground: herb beds left on dry mud, the open well, glass pillars
  // standing (each on its tile, its foot at the tile's bottom).
  function drawMarshProps() {
    const M = world.marsh, T = world.terrain, cols = T.cols;
    if (M) {
      for (let k = 0; k < M.herbTile.length; k++) {
        if (M.herbLeft[k] === 0) continue;
        const i = M.herbTile[k];
        if (T.wet[i] === 1) continue;
        const x = (i % cols) * TILE + TILE / 2, y = Math.floor(i / cols) * TILE + TILE / 2;
        if (inView(x, y, 12)) pickups.add(HERBS, x, y, 1, 1, 0, C.white);
      }
    }
    const W = world.well;
    if (W && W.open && inView(W.x, W.y, 16)) pickups.add(WELL, Math.round(W.x), Math.round(W.y), 1, 1, 0, C.white);
    const St = world.storm;
    if (St && St.pillars > 0) {
      const h = PILLAR.frame.height;
      for (let k = 0; k < St.pillarTile.length; k++) {
        const i = St.pillarTile[k];
        if (i < 0) continue;
        const x = (i % cols) * TILE + TILE / 2, y = Math.floor(i / cols) * TILE + TILE - h / 2;
        if (inView(x, y, h)) pickups.add(PILLAR, x, Math.round(y), 1, 1, 0, C.white);
      }
    }
  }

  // A slot's shots wear its weapon's look: its capstone's sprite once that Form is taken (W1's
  // contract §3, data/ascensions.js weaponLook). Worked out once a frame per slot, not per shot.
  // C3: a capstone's own look (render/looks.js): the color its shots trail, its wave's ring, its
  // light's rim, its beam (slotCol, an rgb; -1 none), and the trail's particle frame.
  const slotShot = [], slotKey = [], slotCol = [], slotFrame = [], slotDef = [];
  function refreshSlotLooks() {
    for (let s = 0; s < world.slots.length; s++) {
      const sl = world.slots[s];
      const key = sl && sl.def ? `${sl.def.id}:${(sl.ascensions || []).map((a) => a.id).join(',')}` : '';
      if (slotKey[s] === key) continue;
      slotKey[s] = key;
      if (!key) { slotShot[s] = null; slotCol[s] = -1; slotDef[s] = ''; continue; }
      const look = weaponLook(sl.def, sl.ascensions || []);
      slotShot[s] = look.sprite !== sl.def.sprite && atlas.has(look.sprite) ? T(look.sprite) : null;
      const cap = capstoneLook(sl.ascensions);
      slotCol[s] = cap ? pal(cap.color) : -1;
      slotFrame[s] = cap && cap.frame ? PF_FRAME[cap.frame] : PF_FRAME.DOT;
      slotDef[s] = sl.def.id;
    }
  }
  /** A slot's capstone color for the view state (a strike's sparks), or -1. */
  const lookOf = (s) => (s >= 0 && s < slotCol.length && slotCol[s] !== undefined ? slotCol[s] : -1);

  let trailStep = 0, auraMote = -1;
  function drawShots(alpha) {
    const P = world.projectiles;
    refreshSlotLooks();
    trailStep = (trailStep + 1) % 3;
    shots.begin();
    let n = 0;
    for (let i = 0; i < P.count; i++) {
      if ((P.flags[i] & PF.DEAD) !== 0) continue;
      const x = lerp(P.px[i], P.x[i], alpha), y = lerp(P.py[i], P.y[i], alpha);
      if (!inView(x, y, 16)) continue;
      const hostile = (P.flags[i] & PF.HOSTILE) !== 0;
      const tex = hostile ? hostileTex : (slotShot[P.slot[i]] || shotTex[P.def[i]] || PARTICLE_FRAMES[PF_FRAME.PLUS]);
      const dx = P.x[i] - P.px[i], dy = P.y[i] - P.py[i];
      const rot = !hostile && shotUpright[P.def[i]] === true ? 0 : dx * dx + dy * dy > 0.01 ? Math.atan2(dy, dx) : 0;
      const sc = P.scale[i] > 1 ? P.scale[i] : 1; // an Eclipse orb, grown
      shots.add(tex, Math.round(x), Math.round(y), sc, sc, rot, C.white);
      n++;
      // A capstone's trail (C3): every third frame per shot, a short-lived spark of its color behind it.
      if (!hostile) {
        const col = slotCol[P.slot[i]];
        if (col !== undefined && col >= 0 && ((i + trailStep) % 3) === 0 && st.sparks.count < feel.particles.busyAt) st.sparks.spawn(x - dx * 0.5, y - dy * 0.5, 0, 0, 240, slotFrame[P.slot[i]], col, 0, 0);
      }
    }
    // A beam's own sprite (the Signal Mirror's glint, the lens) where it leaves you, while it lasts.
    const Z = world.zones;
    for (let z = 0; z < Z.count; z++) {
      if (Z.kind[z] !== ZONE.BEAM) continue;
      const def = world.slots[Z.slot[z]]?.defIndex;
      if (slotDef[Z.slot[z]] === 'punt_pole') continue;   // the pole is drawn as a pole (drawZones), no glint
      const tex = def === undefined ? null : shotTex[def];
      if (!tex) continue;
      shots.add(tex, Math.round(Z.x[z] + Z.dx[z] * 8), Math.round(Z.y[z] + Z.dy[z] * 8), 1, 1, 0, C.white);
      n++;
    }
    shots.end();
    stats.shotsDrawn = n;
  }

  function drawZones(alpha) {
    const Z = world.zones, p = world.player, g = zoneG;
    g.clear();
    const px = lerp(p.px, p.x, alpha), py = lerp(p.py, p.y, alpha);
    for (let i = 0; i < Z.count; i++) {
      const kind = Z.kind[i];
      let x = Z.x[i], y = Z.y[i];
      if (kind === ZONE.AURA) { x = px; y = py; }
      const r = Z.radius[i];
      if (!inView(x, y, r + 8)) continue;
      const life = Z.life[i] > 0 ? Z.life[i] : 1, u = Math.min(1, Z.age[i] / life);
      const zs = Z.slot[i], zcol = slotCol[zs] !== undefined && slotCol[zs] >= 0 ? slotCol[zs] : -1, zdef = slotDef[zs] || '';
      if (kind === ZONE.AURA) {
        // Your own light's reach (the Lamplighter's Lamplight, the game's title): a warm wash with a
        // solid edge, never dashed, so it can't be read as a lamp's ring (0.8.2: those are dashed).
        // C3: the judges found it near invisible (0.05 and 0.1); the wash and the edge are lifted,
        // and motes of flame rise off the edge where it burns. A capstone colors the edge.
        const rx = Math.round(x), ry = Math.round(y), edge = zcol >= 0 ? zcol : C.lamp;
        const breathe = 0.5 + 0.5 * Math.sin(simSeconds(world) * 2.4);
        g.circle(rx, ry, r).fill({ color: C.ember, alpha: 0.1 + 0.03 * breathe });
        g.circle(rx, ry, r).stroke({ width: 2, color: edge, alpha: 0.55 + 0.15 * breathe });
        g.circle(rx, ry, Math.max(2, r - 3)).stroke({ width: 1, color: C.ember, alpha: 0.25 });
        if (((now / 45) | 0) !== auraMote) {
          auraMote = (now / 45) | 0;
          const ang = st.rand() * TAU;
          st.sparks.spawn(x + Math.cos(ang) * r, y + Math.sin(ang) * r, 0, -26, 520, PF_FRAME.DOT, edge, 0, 0);
        }
      } else if (kind === ZONE.WAVE) {
        const w = Math.max(1, Z.thickness[i] * 0.35), a = 0.55 * (1 - u) + 0.15, rx = Math.round(x), ry = Math.round(y);
        if ((Z.flags[i] & ZF.CONE) !== 0) {
          // The Fog Horn: its note as two grey arcs rolling out in its cone (a wide, soft front and a
          // thin one just behind it), not a ring.
          const mid = Math.atan2(Z.dy[i], Z.dx[i]), half = Math.acos(Math.max(-1, Math.min(1, Z.length[i])));
          g.moveTo(rx + Math.cos(mid - half) * r, ry + Math.sin(mid - half) * r).arc(rx, ry, r, mid - half, mid + half).stroke({ width: w + 1, color: zcol >= 0 ? zcol : C.fog, alpha: a * 0.8 });
          const r2 = r - w - 3;
          if (r2 > 2) g.moveTo(rx + Math.cos(mid - half * 0.8) * r2, ry + Math.sin(mid - half * 0.8) * r2).arc(rx, ry, r2, mid - half * 0.8, mid + half * 0.8).stroke({ width: 1, color: C.fog, alpha: a * 0.5 });
        } else if (zdef === 'king_tide') {
          // King Tide (C3: its own, not the Tide Bell's ring): a heavy swell, a foam line inside it,
          // and a capstone's color on the foam.
          g.circle(rx, ry, r).stroke({ width: w + 2, color: C.sea, alpha: a });
          g.circle(rx, ry, Math.max(2, r - w - 2)).stroke({ width: 1, color: zcol >= 0 ? zcol : C.glass, alpha: a * 0.9 });
        } else {
          // Icy Swell (Ruling 25 PB): the far band where the wave freezes is marked on the wave itself, a
          // still frost band from `from` of its reach to its edge for the wave's life (no flash, no pulse),
          // and the ring turns frost-colored once it is inside the band.
          const crest = world.slots[zs]?.fx?.crest, R = Z.maxRadius[i];
          if (crest && R > 0) {
            const inner = R * crest.from, mid = (inner + R) / 2, band = Math.max(2, R - inner);
            const hold = u < 0.85 ? 1 : (1 - u) / 0.15;   // steady for the wave's life, easing out only at its very end
            g.circle(rx, ry, mid).stroke({ width: band, color: C.puddle, alpha: 0.12 * hold });
            g.circle(rx, ry, R).stroke({ width: 1, color: C.puddleEdge, alpha: 0.5 * hold });
          }
          g.circle(rx, ry, r).stroke({ width: crest && r >= R * crest.from ? w + 1 : w, color: crest && r >= R * crest.from ? C.puddleEdge : zcol >= 0 ? zcol : C.cool, alpha: crest && r >= R * crest.from ? Math.max(a, 0.6) : a });
        }
      } else if (kind === ZONE.BEAM) {
        const x2 = Math.round(x + Z.dx[i] * Z.length[i]), y2 = Math.round(y + Z.dy[i] * Z.length[i]);
        if (zdef === 'punt_pole') {
          // The Punt Pole (C3: its own, not the Signal Mirror's light): a wooden pole, darker at its
          // iron-shod foot, jabbed out and back.
          const jab = u < 0.5 ? u * 2 : 2 - u * 2, ex = Math.round(x + Z.dx[i] * Z.length[i] * (0.4 + 0.6 * jab)), ey = Math.round(y + Z.dy[i] * Z.length[i] * (0.4 + 0.6 * jab));
          g.moveTo(Math.round(x), Math.round(y)).lineTo(ex, ey).stroke({ width: 2, color: C.pole, alpha: 1 });
          g.moveTo(Math.round(x), Math.round(y) - 1).lineTo(ex, ey - 1).stroke({ width: 1, color: C.poleLit, alpha: 0.8 });
          g.circle(ex, ey, 1.5).fill({ color: zcol >= 0 ? zcol : C.fog, alpha: 1 });
        } else g.moveTo(Math.round(x), Math.round(y)).lineTo(x2, y2).stroke({ width: Math.max(2, Z.thickness[i]), color: zcol >= 0 ? zcol : C.lamp, alpha: 0.7 * (1 - u) + 0.2 });
      } else if (kind === ZONE.GROUND && Z.style[i] === ZSTYLE.FLARE) {
        // A hanging flare: a bright point over the spot, its light below, sparks falling from it.
        const fy = Math.round(y) - 18;
        g.circle(Math.round(x), Math.round(y), r).fill({ color: C.lamp, alpha: 0.08 * (1 - u * 0.5) });
        g.circle(Math.round(x), fy, 2).fill({ color: WHITE, alpha: 0.95 }).circle(Math.round(x), fy, 4).fill({ color: C.lamp, alpha: 0.4 });
        if (((now / 40) | 0) % 3 === i % 3) st.sparks.spawn(x + (st.rand() - 0.5) * 6, fy, (st.rand() - 0.5) * 30, 60, 500, PF_FRAME.DOT, C.ember, 0, 0);
      } else if (kind === ZONE.GROUND && Z.style[i] === ZSTYLE.WARD) {
        // A ward: a small lantern on the ground, pulsing its ring outward.
        const ring = (Z.age[i] / 0.6) % 1; // on sim time: its own age
        g.circle(Math.round(x), Math.round(y), Math.max(2, r * ring)).stroke({ width: 1, color: C.lamp, alpha: 0.5 * (1 - ring) });
        g.rect(Math.round(x) - 2, Math.round(y) - 4, 4, 5).fill({ color: C.lamp, alpha: 0.9 }).rect(Math.round(x) - 1, Math.round(y) - 6, 2, 2).fill({ color: C.fog, alpha: 1 });
      } else if (kind === ZONE.GROUND) {
        const flick = 0.18 + 0.07 * Math.sin(now / 70 + i);
        g.circle(Math.round(x), Math.round(y), r).fill({ color: C.rot3, alpha: flick * (1 - u * 0.6) });
        if (((now / 50) | 0) % 5 === i % 5) st.sparks.spawn(x + (st.rand() - 0.5) * r, y + (st.rand() - 0.5) * r, 0, -20, 400, PF_FRAME.DOT, C.ember, 0, 0);
      } else if (kind === ZONE.TETHER) {
        // A tether: the harpoon's chain, from you to the enemy it's stuck in.
        g.moveTo(Math.round(px), Math.round(py)).lineTo(Math.round(x), Math.round(y)).stroke({ width: 2, color: C.fog, alpha: 0.95 })
          .moveTo(Math.round(px), Math.round(py)).lineTo(Math.round(x), Math.round(y)).stroke({ width: 1, color: C.number, alpha: 0.7 * (1 - u) + 0.3 });
      } else if (kind === ZONE.MARK && Z.style[i] === MARKS.STATIC) {
        // A charged enemy: a flicker of sparks on it.
        if (((now / 60) | 0) % 4 === i % 4) st.sparks.spawn(x + (st.rand() - 0.5) * 8, y - 4 + (st.rand() - 0.5) * 8, 0, 0, 160, PF_FRAME.DOT, C.lamp, 0, 0);
      } else if (kind === ZONE.PUDDLE) {
        // A brine puddle (Brine Spring): a pale, cold sheet on the ground, its rim catching the light.
        g.circle(Math.round(x), Math.round(y), r).fill({ color: C.puddle, alpha: 0.12 * (1 - u * 0.5) }).stroke({ width: 1, color: C.puddleEdge, alpha: 0.35 * (1 - u * 0.5) });
      } else if (kind === ZONE.SPIKE) {
        // A glass spike (Storm Glass): a small shard standing up, glinting.
        const sx = Math.round(x), sy = Math.round(y);
        g.poly([sx - 2, sy, sx, sy - 9, sx + 2, sy]).fill({ color: C.glass, alpha: 0.9 }).stroke({ width: 1, color: C.lamp, alpha: 0.6 });
      } else if (kind === ZONE.HAZARD && Z.age[i] >= Z.warn[i]) {
        // The pool itself (its warning is drawn with the other warnings, unlit), by what it is
        // (W3's contract §4): black water, a Molten elite's fire, a champion's brine, a boss's pools.
        const hl = world.attack ? hazardLook(world, i) : HAZARD_LOOK.POOL, cx = Math.round(x), cy = Math.round(y);
        if (hl === HAZARD_LOOK.FIRE) {
          g.circle(cx, cy, r).fill({ color: C.rot3, alpha: 0.35 + 0.1 * Math.sin(now / 60 + i) }).stroke({ width: 1, color: C.ember, alpha: 0.9 });
          if (((now / 70) | 0) % 3 === i % 3) st.sparks.spawn(x + (st.rand() - 0.5) * r, y + (st.rand() - 0.5) * r, 0, -24, 380, PF_FRAME.DOT, C.ember, 0, 0);
        } else if (hl === HAZARD_LOOK.BRINE) {
          g.circle(cx, cy, r).fill({ color: C.brine, alpha: 0.4 }).stroke({ width: 1, color: C.glass, alpha: 0.9 });
        } else g.circle(cx, cy, r).fill({ color: C.violet1, alpha: 0.75 }).stroke({ width: 1, color: C.rot2, alpha: 0.9 });
      }
    }
    drawBolts(g);
    drawZaps(g);
    drawHauls(g);
    drawSlotProps(g, px, py);
  }

  // Static's zaps: a short jagged line from a charged enemy to the neighbor it zapped.
  function drawZaps(g) {
    const Zp = st.zaps;
    for (let k = 0; k < Zp.n; k++) {
      const age = now - Zp.t[k];
      if (age >= BOLT_MS) continue;
      const a = 1 - age / BOLT_MS;
      const x1 = Zp.x[k], y1 = Zp.y[k], x2 = Zp.x2[k], y2 = Zp.y2[k];
      const mx = (x1 + x2) / 2 + ((k * 7) % 9) - 4, my = (y1 + y2) / 2 + ((k * 5) % 9) - 4;
      g.moveTo(Math.round(x1), Math.round(y1)).lineTo(Math.round(mx), Math.round(my)).lineTo(Math.round(x2), Math.round(y2)).stroke({ width: 1, color: WHITE, alpha: a });
    }
  }

  // The Harpooner's line (C3, EV.HAUL): a rope from her to what her hook took, snapping taut and fading.
  function drawHauls(g) {
    const H = st.hauls;
    for (let k = 0; k < H.n; k++) {
      const age = now - H.t[k];
      if (age >= HAUL_MS) continue;
      const a = 1 - age / HAUL_MS;
      g.moveTo(Math.round(H.x[k]), Math.round(H.y[k])).lineTo(Math.round(H.x2[k]), Math.round(H.y2[k])).stroke({ width: 2, color: C.rope, alpha: 0.9 * a })
        .moveTo(Math.round(H.x[k]), Math.round(H.y[k]) - 1).lineTo(Math.round(H.x2[k]), Math.round(H.y2[k]) - 1).stroke({ width: 1, color: C.number, alpha: 0.6 * a });
    }
  }

  // What a weapon's Forms stand in the world: a Planted Rod, a Pyre at your side.
  function drawSlotProps(g, px, py) {
    for (let s = 0; s < world.slots.length; s++) {
      const sl = world.slots[s];
      if (!sl || !sl.fx) continue;
      if (sl.fx.rod && sl.fs.rodUntil >= world.tick) {
        const x = Math.round(sl.fs.rodX), y = Math.round(sl.fs.rodY);
        if (inView(x, y, 30)) {
          g.rect(x - 1, y - 22, 2, 22).fill({ color: C.fog, alpha: 1 }).rect(x - 2, y - 24, 4, 2).fill({ color: C.number, alpha: 1 });
          g.circle(x, y - 25, 2 + (((simSeconds(world) / 0.12) | 0) % 2)).fill({ color: C.lamp, alpha: 0.8 });
        }
      }
      if (sl.fx.pyre && sl.fs.pyre > 0) {
        // The pyre: a heap at your side with a flame for each one gathered.
        const x = Math.round(px + 12), y = Math.round(py - 4), n = sl.fs.pyre;
        g.rect(x - 4, y + 2, 9, 2).fill({ color: C.fog, alpha: 1 });
        for (let k = 0; k < n; k++) {
          const fx = x - 3 + (k % 4) * 2, fy = y - Math.floor(k / 4) * 3 + Math.round(Math.sin(simSeconds(world) / 0.09 + k));
          g.rect(fx, fy, 1, 2).fill({ color: k % 2 ? C.lamp : C.ember, alpha: 0.9 });
        }
      }
    }
  }

  // Lightning: a jagged white-gold line from 96 px above each strike's own hit down to it, fading
  // over BOLT_MS. The jags come from the bolt's position, so a bolt keeps its shape while it shows.
  function drawBolts(g) {
    const B = st.bolts;
    for (let k = 0; k < B.n; k++) {
      const age = now - B.t[k];
      if (age >= BOLT_MS) continue;
      const a = 1 - age / BOLT_MS, x = Math.round(B.x[k]), y = Math.round(B.y[k]);
      for (let pass = 0; pass < 2; pass++) {
        let seed = ((x * 73856093) ^ (y * 19349663)) >>> 0;
        g.moveTo(x, y - 96);
        for (let j = 1; j <= 6; j++) {
          seed = (seed * 1103515245 + 12345) >>> 0;
          const jx = j === 6 ? 0 : ((seed >>> 16) % 13) - 6;
          g.lineTo(x + jx, y - 96 + j * 16);
        }
        if (pass === 0) g.stroke({ width: 3, color: C.lamp, alpha: 0.45 * a });
        else g.stroke({ width: 1, color: WHITE, alpha: a });
      }
    }
  }

  // A boss shrugging off a hit its fight-length cap ate (viewstate.js HIT_CAPPED): a pale ward
  // round it, fading over WARD_MS. Drawn with the warnings (unlit), so it shows in the dark too.
  function drawWards(g, alpha) {
    const E = world.enemies;
    for (let k = 0; k < actorCount; k++) {
      const i = actorList[k];
      if ((E.flags[i] & EF.BOSS) === 0) continue;
      const a = wardStrength(st, E.handle(i), now);
      if (a <= 0) continue;
      const x = Math.round(lerp(E.px[i], E.x[i], alpha)), y = Math.round(lerp(E.py[i], E.y[i], alpha)), r = Math.round(E.radius[i] + 6);
      g.circle(x, y, r).fill({ color: C.ward, alpha: 0.07 * a }).stroke({ width: 2, color: C.ward, alpha: 0.75 * a });
      g.circle(x, y, r + 3).stroke({ width: 1, color: C.ward, alpha: 0.3 * a });
    }
  }

  // Warnings, by tier (0.9.0, W3's contract §1). MAJOR (bosses, champions, map strikes, and any
  // warning from a sim that gives no tier): the full bright shape. FULL (an ordinary warning that
  // threatens you): the full shape, thinner and dimmer. DIM: a tell only, a 20 px arrow from the
  // enemy along its line (its body flashes, drawEnemies) or a thin dim outline round a ring or a
  // pool. High contrast (Settings, access.highContrast): every shape at full strength with a 1 px
  // light outline round it, and the boss's shapes a pixel thicker.
  function drawWarnings(alpha) {
    const g = teleG, Z = world.zones, F = feel.telegraph;
    const pulse = 0.5 + 0.5 * Math.sin(simSeconds(world) * F.pulsePerSec * TAU);
    const hc = access.highContrast === true;
    expireTelegraphs(st, world.tick);
    g.clear();
    const W = st.tele;
    for (let k = 0; k < W.n; k++) {
      const u = 1 - (W.end[k] - world.tick) / W.total[k];
      const x = Math.round(W.x[k]), y = Math.round(W.y[k]), s = W.size[k], a = W.ang[k];
      const tier = W.tier[k] || TIER.MAJOR;
      const major = tier === TIER.MAJOR, dim = tier === TIER.DIM;
      const edge = hc ? 1 : (0.55 + 0.45 * pulse) * (major ? 1 : dim ? 0.5 : 0.7);
      const fillK = hc ? 1.4 : major ? 1 : 0.55;
      const lw = major ? (hc ? 3 : 2) : 1;
      switch (W.shape[k]) {
        case TELE.RING:
          if (dim) { g.circle(x, y, s).stroke({ width: 1, color: C.warnHot, alpha: hc ? 1 : 0.35 }); if (hc) g.circle(x, y, s + 1).stroke({ width: 1, color: C.hcEdge, alpha: 1 }); break; }
          g.circle(x, y, s).fill({ color: C.warn, alpha: (0.08 + 0.22 * u) * fillK }).stroke({ width: lw, color: C.warnHot, alpha: edge });
          g.circle(x, y, Math.max(1, s * u)).stroke({ width: 1, color: C.warnHot, alpha: 0.8 * (major || hc ? 1 : 0.6) });
          if (hc) g.circle(x, y, s + lw).stroke({ width: 1, color: C.hcEdge, alpha: 1 });
          break;
        case TELE.LINE: {
          const ex = Math.cos(a), ey = Math.sin(a);
          if (dim) {
            // The tell: a short arrow out of the enemy, the way it will go.
            const tx = x + ex * TELL_PX, ty = y + ey * TELL_PX, hx = -ey * 3, hy = ex * 3;
            if (hc) g.moveTo(x, y).lineTo(tx, ty).stroke({ width: 3, color: C.hcEdge, alpha: 1 });
            g.moveTo(x, y).lineTo(tx, ty).stroke({ width: 1, color: C.warnHot, alpha: hc ? 1 : 0.75 });
            g.poly([tx + ex * 2, ty + ey * 2, tx - ex * 3 + hx, ty - ey * 3 + hy, tx - ex * 3 - hx, ty - ey * 3 - hy]).fill({ color: C.warnHot, alpha: hc ? 1 : 0.75 });
            break;
          }
          const w = major ? F.lineWidth + (hc ? 2 : 0) : Math.max(4, Math.round(F.lineWidth / 2)), nx = (-ey * w) / 2, ny = (ex * w) / 2;
          g.poly([x + nx, y + ny, x + ex * s + nx, y + ey * s + ny, x + ex * s - nx, y + ey * s - ny, x - nx, y - ny])
            .fill({ color: C.warn, alpha: (0.1 + 0.25 * u) * fillK }).stroke({ width: hc ? 2 : 1, color: hc ? C.hcEdge : C.warnHot, alpha: edge });
          break;
        }
        case TELE.FAN: {
          const spread = (s * Math.PI) / 180, len = F.fanLength;
          for (let j = -2; j <= 2; j++) {
            const aa = a + ((j / 2) * spread) / 2;
            if (hc) g.moveTo(x, y).lineTo(x + Math.cos(aa) * len, y + Math.sin(aa) * len).stroke({ width: lw + 2, color: C.hcEdge, alpha: 1 });
            g.moveTo(x, y).lineTo(x + Math.cos(aa) * len, y + Math.sin(aa) * len).stroke({ width: major ? lw - 1 : 1, color: C.warnHot, alpha: edge * 0.8 });
          }
          break;
        }
        case TELE.SUMMON:
          g.circle(x, y, s).stroke({ width: hc ? 2 : 1, color: C.violet, alpha: hc ? 1 : edge });
          break;
        default: break;
      }
    }
    // Hazard pools warn by filling in before they hurt (a DIM one: a thin outline only).
    for (let i = 0; i < Z.count; i++) {
      if (Z.kind[i] !== ZONE.HAZARD || Z.age[i] >= Z.warn[i]) continue;
      const u = Z.warn[i] > 0 ? Z.age[i] / Z.warn[i] : 1;
      const x = Math.round(Z.x[i]), y = Math.round(Z.y[i]), r = Z.radius[i];
      const tier = poolTierAt(st, Z.x[i], Z.y[i], world.tick) || TIER.MAJOR;
      if (tier === TIER.DIM) {
        g.circle(x, y, r).stroke({ width: 1, color: C.warnHot, alpha: hc ? 1 : 0.35 });
        if (hc) g.circle(x, y, r + 1).stroke({ width: 1, color: C.hcEdge, alpha: 1 });
        continue;
      }
      const major = tier === TIER.MAJOR;
      g.circle(x, y, r).fill({ color: C.warn, alpha: (0.1 + 0.25 * u) * (hc ? 1.4 : major ? 1 : 0.55) })
        .stroke({ width: major ? (hc ? 3 : 2) : 1, color: C.warnHot, alpha: hc ? 1 : (0.55 + 0.45 * pulse) * (major ? 1 : 0.7) });
      g.circle(x, y, Math.max(1, r * u)).stroke({ width: 1, color: C.warnHot, alpha: 0.7 });
      if (hc) g.circle(x, y, r + (major ? 3 : 1)).stroke({ width: 1, color: C.hcEdge, alpha: 1 });
    }
    drawWards(g, alpha);
    drawAffixes(g, alpha);
  }

  // Elite affixes (W3's contract §4), drawn unlit with the warnings: a pip over the elite for each,
  // each its own shape (never told apart by color alone); a Warded elite's ward a ring while it
  // holds; a Tethered elite's links thin lines to the two it shares damage with.
  const AFFIX_TEX = ['affix_warded', 'affix_herald', 'affix_molten', 'affix_tethered', 'affix_brine'].map((id) => (atlas.has(id) ? T(id) : PIP));
  function drawAffixes(g, alpha) {
    affixLayer.begin();
    try { drawAffixIcons(g, alpha); } finally { affixLayer.end(); }
  }
  function drawAffixIcons(g, alpha) {
    const E = world.enemies;
    if (E.affix === undefined) return;
    for (let k = 0; k < actorCount; k++) {
      const i = actorList[k];
      const bits = E.affix[i];
      if (!bits) continue;
      const x = Math.round(lerp(E.px[i], E.x[i], alpha)), y = Math.round(lerp(E.py[i], E.y[i], alpha) - liftOf[i]), r = E.radius[i];
      if ((bits & AFFIX_BIT.warded) !== 0 && E.ward !== undefined && E.ward[i] > 0) {
        // A ring for each hit the ward has left (C3: one ring as thick as the hits drew as a square block at this size).
        for (let k = 0; k < Math.min(3, E.ward[i]); k++) g.circle(x, y, Math.round(r + 6 + k * 3)).stroke({ width: 1, color: C.affix[0], alpha: 0.85 - k * 0.2 });
      }
      if ((bits & AFFIX_BIT.tethered) !== 0 && E.link0 !== undefined) {
        for (const L of [E.link0, E.link1]) {
          const j = L[i] > 0 ? E.resolve(L[i] - 1) : -1;   // kept as handle + 1, 0 for none (sim/affixes.js)
          if (j < 0) continue;
          g.moveTo(x, y).lineTo(Math.round(lerp(E.px[j], E.x[j], alpha)), Math.round(lerp(E.py[j], E.y[j], alpha))).stroke({ width: 1, color: C.affix[3], alpha: 0.6 });
        }
      }
      // The icons, in a row over its head (C3: a shield, a pennant, a flame, two links, a drop),
      // each on a dark square so it reads over the crowd.
      let n = 0;
      for (let b = 0; b < AFFIX_ORDER.length; b++) if ((bits & AFFIX_ORDER[b]) !== 0) n++;
      let px = x - (n - 1) * 7;
      const py = Math.round(y - r * 1.6 - 8);
      for (let b = 0; b < AFFIX_ORDER.length; b++) {
        if ((bits & AFFIX_ORDER[b]) === 0) continue;
        g.rect(px - 7, py - 7, 14, 14).fill({ color: C.pipBack, alpha: 0.75 });
        affixLayer.add(AFFIX_TEX[b], px, py, 1, 1, 0, C.white);
        px += 14;
      }
    }
  }

  function drawEffects(frameMs) {
    const S = st.sparks;
    S.step(frameMs);
    effects.begin();
    for (let i = 0; i < S.count; i++) {
      const a = fadeOut(S.age[i], S.life[i], 0.4);
      const grow = S.grow[i];
      const sc = grow > 0 ? 1 + grow * (S.age[i] / S.life[i]) : 1;
      effects.add(PARTICLE_FRAMES[S.frame[i]], Math.round(S.x[i]), Math.round(S.y[i]), sc, sc, 0, packColor(S.color[i], a));
    }
    effects.end();
    stats.particles = S.count;
    // Decals under everything.
    const D = st.decals, life = feel.decalMs;
    decals.begin();
    for (let i = 0; i < D.n; i++) {
      const age = now - D.t[i];
      if (age > life) continue;
      decals.add(SHADOW[D.size[i] ? 2 : 1], Math.round(D.x[i]), Math.round(D.y[i]), D.size[i] ? 1 : 1.4, D.size[i] ? 1.2 : 1.6, 0, packColor(WHITE, 0.9 * (1 - age / life)));
    }
    decals.end();
  }

  function drawNumbers(alpha) {
    const N = st.numbers, F = feel.numbers, p = world.player;
    const px = lerp(p.px, p.x, alpha), py = lerp(p.py, p.y, alpha), clear2 = NUMBERS_CLEAR * NUMBERS_CLEAR;
    N.expire(now, F.lifeMs);
    numbersLayer.begin();
    for (let i = 0; i < N.max; i++) {
      if (N.live[i] === 0) continue;
      // Never over the player (a number that drifted into her ring, or she walked under it).
      if (N.kind[i] < 2) { const dx = N.x[i] - px, dy = N.y[i] - 8 - py; if (dx * dx + dy * dy < clear2) continue; }
      const age = now - N.born[i];
      const v = Math.max(1, Math.round(N.value[i]));
      const k = N.kind[i];
      const rgb = k === 1 ? C.crit : k === 2 ? C.hurt : k === 3 ? C.heal : C.number;
      const col = packColor(rgb, fadeOut(age, F.lifeMs, 0.55));
      let digits = 0;
      for (let t = v; t > 0; t = Math.floor(t / 10)) digits++;
      let x = Math.round(N.x[i] + (digits * DIGIT_ADVANCE) / 2 - DIGIT_ADVANCE / 2);
      const y = Math.round(N.y[i] - 8 - F.rise * Math.min(1, age / (F.lifeMs * 0.6)));
      for (let t = v; t > 0; t = Math.floor(t / 10)) { numbersLayer.add(DIGIT[t % 10], x, y, 1, 1, 0, col); x -= DIGIT_ADVANCE; }
    }
    numbersLayer.end();
    stats.numbers = N.count;
  }

  // ---------------------------------------------------------------- light and fog

  function lightAt(x, y, r, rgb, intensity) {
    const lx = (x - origin.x) / 2, ly = (y - origin.y) / 2, lr = r / 2;
    if (lx < -lr || ly < -lr || lx > LIGHT_W + lr || ly > LIGHT_H + lr) return false;
    lights.add(atlas.glow, lx, ly, r / 64, r / 64, 0, packColor(rgb, intensity));
    fogCut.add(atlas.glow, lx, ly, (r * 1.15) / 64, (r * 1.15) / 64, 0, packColor(WHITE, Math.min(1, intensity * feel.fog.lightCut)));
    return true;
  }

  function drawLight(alpha, app) {
    const L = feel.light, p = world.player;
    lights.begin(); fogCut.begin();
    let n = 0;
    const px = lerp(p.px, p.x, alpha), py = lerp(p.py, p.y, alpha);
    // The lamp. The Lamplighter's grows with her aura (her innate weapon).
    let lamp = L.player + L.playerLevelGrowth * (p.level - 1);
    const aura = world.slots[INNATE_SLOT];
    if (aura && aura.auraHandle !== undefined) {
      const z = world.zones.resolve(aura.auraHandle);
      if (z >= 0) lamp = Math.max(lamp, world.zones.radius[z] * 2.4);
    }
    lightAt(px, py - 4, lamp, C.lamp, 1); n++;
    lightAt(px, py - 4, lamp * 0.45, WHITE, 0.5); n++;
    // An Ember on the ground glows violet, so it's seen in the dark.
    const PU = world.pickups;
    for (let i = 0; i < PU.count && n < L.maxLights; i++) if (PU.kind[i] === PICK.EMBER && lightAt(PU.x[i], PU.y[i], 40, C.violet, 0.7)) n++;
    // The tasks: a lit lamp burns, an unlit one glows faintly so it's seen; a waking bell, faintly
    // blue. The Ferryman's lantern. A Reliquary and the vault glow.
    // 0.8.2: a lit lamp is a ward, and looks it: a warm pool of light across its whole reach (twice
    // what a lamp gave before, in a warmer color) and a bright point at its glass. An unlit one
    // glows faintly so it's seen; the fog taking it back shrinks its pool with its ward.
    for (let i = 0; i < world.tasks.length; i++) {
      if (n >= L.maxLights) break;
      const t = world.tasks[i];
      if (t.kind === TASK.LAMP) {
        const r = ward(world, i);
        if (r > 0) {
          if (lightAt(t.x, t.y, r * 2.6, SIGN_COLOR.ward, 0.85)) n++;
          if (n < L.maxLights && lightAt(t.x + LAMP_GLASS_DX, t.y - LAMP_GLASS, 40, C.lamp, 1)) n++;
        } else if (lightAt(t.x, t.y - 14, 34, C.lamp, 0.5)) n++;
      } else if (t.kind === TASK.BELL && t.state !== TASK_STATE.DONE && lightAt(t.x, t.y, 30, SIGN_COLOR.bell, 0.5)) n++;
    }
    // The Ferryman's lantern, on the water as he rows in, then where he's tied up.
    if (skiff.shown && n < L.maxLights && lightAt(skiff.x, skiff.y - 10, 50, C.lamp, 0.8)) n++;
    // The open Salt Well glows faintly cold, so it's found in the dark.
    if (world.well && world.well.open && n < L.maxLights && lightAt(world.well.x, world.well.y, 54, C.well, 0.6)) n++;
    for (let i = 0; i < PU.count && n < L.maxLights; i++) {
      if (PU.kind[i] === PICK.RELIQUARY && lightAt(PU.x[i], PU.y[i], 46, C.violet, 0.8)) n++;
      else if (PU.kind[i] === PICK.VAULT && lightAt(PU.x[i], PU.y[i], 60, C.lamp, 0.9)) n++;
    }
    // Lantern Night: your light reaches as far as it burns.
    if (isNight(world) && n < L.maxLights) { lightAt(px, py, world.tuning.tasks.night.light * 2, C.lamp, 0.55); n++; }
    // A secret cache glows faintly violet through the dark until it's opened (you see it once
    // you're near; nothing points the way).
    for (const s of world.secrets) if (!s.open && n < L.maxLights && lightAt(s.x, s.y, 56 + 8 * Math.sin(now / 400), C.violet, 0.6)) n++;
    // A boss's own light: the Maw's lure glows like a lamp (that's the lure), the Tidecaller's eyes.
    for (let k = 0; k < rigLightCount && n < L.maxLights; k++) if (lightAt(rigLights[k * 4], rigLights[k * 4 + 1], rigLights[k * 4 + 2], rigLights[k * 4 + 3], 0.75)) n++;
    // Then, in order, until maxLights: fire and light shots, flashes, chests, ground, gems.
    const P = world.projectiles;
    for (let i = 0; i < P.count && n < L.maxLights; i++) {
      if ((P.flags[i] & PF.DEAD) !== 0) continue;
      const hostile = (P.flags[i] & PF.HOSTILE) !== 0;
      if (!hostile && !shotLight[P.def[i]]) continue;
      if (lightAt(lerp(P.px[i], P.x[i], alpha), lerp(P.py[i], P.y[i], alpha), hostile ? 22 : L.flare, hostile ? C.warn : C.lamp, 0.8)) n++;
    }
    expireLights(st, now);
    const TL = st.lights;
    for (let k = 0; k < TL.n && n < L.maxLights; k++) {
      if (lightAt(TL.x[k], TL.y[k], TL.r[k], TL.col[k], 1 - (now - TL.t[k]) / TL.ms[k])) n++;
    }
    const Pk = world.pickups;
    for (let i = 0; i < Pk.count && n < L.maxLights; i++) if (Pk.kind[i] === PICK.CHEST && lightAt(Pk.x[i], Pk.y[i], 40, C.lamp, 0.8)) n++;
    const Z = world.zones;
    for (let i = 0; i < Z.count && n < L.maxLights; i++) {
      if (Z.kind[i] === ZONE.GROUND && lightAt(Z.x[i], Z.y[i], Z.radius[i] * 2.2, C.ember, 0.55)) n++;
      else if (Z.kind[i] === ZONE.HAZARD && lightAt(Z.x[i], Z.y[i], Z.radius[i] * 2, C.warn, 0.45)) n++;
    }
    const G = world.gems;
    for (let i = 0; i < G.count && n < L.maxLights; i++) if (lightAt(G.x[i], G.y[i], L.gem * (G.big[i] ? 3 : 1), C.gem, 0.35)) n++;
    lights.end(); fogCut.end();
    stats.lights = n;
    // Lantern Night lifts the dark and the fog.
    const night = isNight(world);
    // The ambient light: the map's, the tuning's boost, and the Brightness setting (render/brightness.js).
    const amb = runAmbient(world.map.ambient, L.ambientBoost, access.brightness, night ? 0.3 : 0);
    const r0 = performance.now();
    app.render({ container: lightRoot, target: lightRT, clear: true, clearColor: [amb, amb, Math.min(1, amb * 1.08), 1] });
    // Fog: drifting noise, anchored to the world, cut away by the same lights.
    fogTile.tint = C.fog;
    fogTile.alpha = feel.fog.density * (night ? 0.15 : 1);
    const drift = (now / 1000) * feel.fog.drift;
    fogTile.tilePosition.set(-origin.x / 2 + drift * 0.5, -origin.y / 2 + drift * 0.2);
    app.render({ container: fogRoot, target: fogRT, clear: true, clearColor: [0, 0, 0, 0] });
    passMs = performance.now() - r0;
    lightSprite.position.set(origin.x, origin.y);
    fogSprite.position.set(origin.x, origin.y);
  }

  // ---------------------------------------------------------------- public

  return {
    root,
    stats,
    state: st,
    /** Start drawing a run. */
    attach(w) {
      world = w;
      slotKey.length = 0; slotShot.length = 0;
      feel = w.tuning.feel;
      groundKey = -1;
      renderer.world.addChild(root);
      resetViewState(st);
      signs.reset();
    },
    detach() {
      if (root.parent) root.parent.removeChild(root);
      world = null;
    },
    /** After each sim tick: the events before `endIndex` came from tick `tick` (warning timing). */
    markTick(endIndex, tick) { markTick(st, endIndex, tick); },
    /** Read the events the sim wrote since the last frame (call before clearing the buffer). */
    consume() {
      if (!world) return;
      feel = world.tuning.feel;
      const p = world.player;
      signs.consume(world, now);
      consumeEvents(st, world.events, {
        now, tick: world.tick, feel, numbersOn: access.damageNumbers !== false, playerX: p.x, playerY: p.y, reduced: !!access.flashReduction,
        slotOf: world.enemies.slotOf, alive: world.enemies.count,
        noBolt: world.slots[0]?.def?.id === 'bog_hands' ? 0 : -1,   // (W2: her hands rise out of the mud, no lightning)
        strikeColor: lookOf,   // C3: a strike weapon's capstone throws sparks of its color where it lands
      });
    },
    /** Draw one frame. alpha: how far between the last two ticks. frameMs: real frame time. */
    draw(alpha, frameMs) {
      if (!world) return;
      const t0 = performance.now();
      feel = world.tuning.feel;
      now += frameMs;
      const p = world.player;
      // Camera: centered on the player, then kept inside the map. No screen shake: Kevin, 0.7.0
      // ("it's making me sick to my stomach"); hits read through light, sparks, and hit-stop.
      let cx = lerp(p.px, p.x, alpha), cy = lerp(p.py, p.y, alpha) - 4;
      const tr = world.terrain;
      cx = Math.min(Math.max(cx, VIEW_W / 2), tr.width - VIEW_W / 2);
      cy = Math.min(Math.max(cy, VIEW_H / 2), tr.height - VIEW_H / 2);
      renderer.camera.x = cx; renderer.camera.y = cy;
      origin.x = splitCamera(cx - VIEW_W / 2).whole - MARGIN;
      origin.y = splitCamera(cy - VIEW_H / 2).whole - MARGIN;
      drawGround();
      drawZones(alpha);
      signs.draw(world, inView, now, simSeconds(world));
      drawPickups(alpha);
      drawEnemies(alpha);
      drawShots(alpha);
      drawActors(alpha);
      drawEffects(frameMs);
      drawLight(alpha, renderer.app.renderer);
      drawWarnings(alpha);
      drawNumbers(alpha);
      // The debug overlay shows the view's own JavaScript time, without the GPU passes.
      stats.jsMs = stats.jsMs * 0.9 + (performance.now() - t0 - passMs) * 0.1;
    },
    /** Screen-space effects the HUD draws: 0..1 strengths of the hurt edge and the level-up wash. */
    screenFlash() { return screenFlash(st, now, feel.flash, !!access.flashReduction, flashOut); },
    get now() { return now; },
    destroy() {
      this.detach();
      root.destroy({ children: true });
      lightRoot.destroy({ children: true });
      fogRoot.destroy({ children: true });
      lightRT.destroy(true); fogRT.destroy(true);
    },
  };
}
