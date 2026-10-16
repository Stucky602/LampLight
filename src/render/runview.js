// The run, drawn (ARCHITECTURE §6). Reads the sim's state and event buffer; writes nothing back.
//
// Layers, bottom to top (§6.2):
//   ground tiles · decals · blob shadows · ground zones · gems and pickups · enemies (and the
//   ones dying) · shots · elites and bosses (y-sorted; bosses are rigs) · sparks and embers
//   (additive) · the light map (multiplied) · fog (thinned wherever the light map is bright)
//   · warnings (drawn after the light and fog so a hazard is never lost in the dark)
//   · the player (above all of it, so she is never lost either) · damage numbers.
// The HUD is separate (render/hud.js), in its own layer that never shakes.
//
// Each frame: positions are interpolated between the last two ticks by `alpha`; sprites sit on
// whole pixels. Everything that is many (enemies, shots, gems, shadows, sparks, digits, tiles)
// is a ParticleContainer drawing from the one atlas texture. What the view remembers between
// frames (effects, warnings, the dying, per-enemy squash and facing) lives in render/viewstate.js,
// which the gate tests; this file only draws. The per-entity loops create no objects; a frame
// allocates a few small objects (Graphics styles, the camera split), well inside the §17 budget.

import { Container, Graphics, ParticleContainer, Particle, Sprite, RenderTexture, TilingSprite } from 'pixi.js';
import { TELE, PICK, END } from '../sim/events.js';
import { EF, PF, ZONE, AI, CAP, INNATE_SLOT } from '../sim/constants.js';
import { CHARGER, RANGED } from '../sim/enemies.js';
import { TILE } from '../sim/terrain.js';
import { VIEW_W, VIEW_H, MARGIN, splitCamera } from './layout.js';
import { color as pal } from '../data/palette.js';
import { packColor, fadeOut } from './feel.js';
import { DIGIT_ADVANCE } from './font.js';
import {
  createViewState, resetViewState, consumeEvents, markTick, noteEnemy, expireTelegraphs, expireDying, expireLights,
  screenFlash, enemyLook, LOOK_COLOR, FX_COLOR, PF_FRAME, simSeconds, animFrameIndex, stepHop, dazeWobble, groundFrame, BOLT_MS,
} from './viewstate.js';
import { RIGS } from './rigs.js';
import { rigInput } from './rigpose.js';
import { createRigView } from './rigview.js';
import { PLAYER_FEET_ROOM } from './playerframe.js';

const TAU = Math.PI * 2;
const WHITE = 0xffffff;
const LIGHT_W = Math.ceil((VIEW_W + MARGIN * 2) / 2) + 1;
const LIGHT_H = Math.ceil((VIEW_H + MARGIN * 2) / 2) + 1;

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
  return (E.ai[i] === AI.charger && E.aiState[i] === CHARGER.WINDUP) || (E.ai[i] === AI.ranged_slow && E.aiState[i] === RANGED.WARN);
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
  const numbersLayer = createLayer();
  // The player is drawn last of the world, above the light, fog, and warnings: she is never lost
  // under a pile of warning shapes or in the dark (§16.4: the player is the highest-contrast thing
  // on screen, never tinted). Her lamp lights her spot anyway.
  const playerLayer = new Container();
  root.addChild(groundLayer.container, decals.container, shadows.container, zoneG, pickups.container, enemies.container,
    shots.container, actors, effects.container, lightSprite, fogSprite, teleG, playerLayer, numbersLayer.container);

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
  const playerTex = new Map(data.characters.map((c) => [c.sprite, [T(c.sprite), T(`${c.sprite}#flash`)]]));

  // Colors, packed once.
  const C = {
    white: packColor(WHITE), lamp: FX_COLOR.lamp, cool: FX_COLOR.cool, ember: FX_COLOR.ember, gem: FX_COLOR.gem,
    warn: FX_COLOR.warn, warnHot: FX_COLOR.warnHot, violet: FX_COLOR.violet,
    crit: pal('lamp-5'), hurt: pal('rot-4'), heal: pal('moss-4'), number: pal('fog-5'),
    rot3: pal('rot-3'), rot2: pal('rot-2'), violet1: pal('violet-1'), fog: pal('night-4'),
  };
  const LOOK_PACKED = LOOK_COLOR.map((c) => packColor(c));

  // The player, elites, and bosses: real sprites, y-sorted.
  const playerSprite = new Sprite();
  playerSprite.anchor.set(0.5);
  playerLayer.addChild(playerSprite);
  const actorPool = [];
  const actorList = new Int32Array(CAP.enemies); // every elite and boss in view, however many
  let actorCount = 0;

  let world = null;
  let now = 0;               // render clock, ms
  let groundKey = -1;
  const stats = { enemiesDrawn: 0, shotsDrawn: 0, particles: 0, numbers: 0, lights: 0, jsMs: 0 };
  let passMs = 0;            // time in the light and fog render passes (GPU submission, not our JS)
  const origin = { x: 0, y: 0 }; // world position of light-map pixel (0, 0)
  const flashOut = { hurt: 0, level: 0 };
  const shakeOut = new Float64Array(2);

  function lerp(a, b, t) { return a + (b - a) * t; }

  function inView(x, y, pad) {
    return x > origin.x - pad && x < origin.x + VIEW_W + MARGIN * 2 + pad && y > origin.y - pad && y < origin.y + VIEW_H + MARGIN * 2 + pad;
  }

  function drawGround() {
    const tr = world.terrain;
    const tx0 = Math.floor(origin.x / TILE) - 1, ty0 = Math.floor(origin.y / TILE) - 1;
    const key = (ty0 + 1024) * 4096 + (tx0 + 1024);
    if (key === groundKey) return;
    groundKey = key;
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
    let drawn = 0;
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
      if ((f & (EF.ELITE | EF.BOSS)) !== 0) {
        actorList[actorCount++] = i;
        shadows.add(SHADOW[2], Math.round(x), Math.round(y + r * 0.8), r / 15, r / 20, 0, C.white);
        continue;
      }
      // Squash on hit, pop in on spawn, bob, lean into the walk, and the warning swell.
      let sx = 1, sy = 1;
      const since = now - st.hitAt[id];
      if (since < sq.ms) { const s = sq.hit * (1 - since / sq.ms); sx += s * 0.6; sy -= s; }
      const born = now - st.bornAt[id];
      if (born < sq.ms * 1.5) { const s = sq.spawn * (1 - born / (sq.ms * 1.5)); sx -= s; sy -= s; }
      if (isWarned(E, i)) { sx *= 1 + 0.12 * pulse; sy *= 1 + 0.12 * pulse; }
      const look = enemyLook(E, i, simMs, pulse, isWarned);
      const by = Math.round(Math.sin(phase + E.anim[i] * TAU) * bob.px);
      // Lean into the walk; a dazed enemy wobbles instead (its cue: it keeps its colors, §16.4).
      const lean = E.dazeT[i] > 0 ? dazeWobble(simSec, E.anim[i]) : dx > 0.05 ? bob.lean : dx < -0.05 ? -bob.lean : 0;
      const type = E.type[i];
      const fr = animFrame(E, i, simSec);
      const tex = E.flash[i] > 0 ? typeFlash[type][fr] : typeTex[type][fr];
      enemies.add(tex, Math.round(x), Math.round(y) + by, sx * st.facing[id], sy, lean, LOOK_PACKED[look]);
      shadows.add(r > 6 ? SHADOW[1] : SHADOW[0], Math.round(x), Math.round(y + r * 0.9), 1, 1, 0, C.white);
      drawn++;
    }
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
      const x = lerp(E.px[i], E.x[i], alpha), y = lerp(E.py[i], E.y[i], alpha);
      if (typeRig[type] >= 0 && E.boss[i] >= 0) { drawRig(typeRig[type], i, x, y, id, pulse, simSec); continue; }
      let s = actorPool[used];
      if (!s) { s = new Sprite(); s.anchor.set(0.5); actorPool.push(s); actors.addChild(s); }
      used++;
      const fr = animFrame(E, i, simSec);
      s.texture = E.flash[i] > 0 ? eliteFlash[type][fr] : eliteTex[type][fr];
      const since = now - st.hitAt[id];
      const sq = since < F.squash.ms ? F.squash.hit * 0.5 * (1 - since / F.squash.ms) : 0;
      const swell = (boss ? Math.sin(simSec * 2.6) * F.bob.bossBreathe : 0) + (isWarned(E, i) ? 0.1 * pulse : 0);
      s.position.set(Math.round(x), Math.round(y + (boss ? Math.sin(simSec * 1.9) * F.bob.bossPx : 0)));
      s.scale.set((1 + sq * 0.6 + swell) * st.facing[id], 1 - sq + swell);
      s.rotation = E.dazeT[i] > 0 ? dazeWobble(simSec, E.anim[i]) * 0.5 : 0;
      s.tint = LOOK_COLOR[enemyLook(E, i, simMs, pulse, isWarned)];
      s.visible = true;
      s.zIndex = y;
    }
    // The player: blinks while the invulnerability after a hit lasts (not after a dash).
    const x = lerp(p.px, p.x, alpha), y = lerp(p.py, p.y, alpha);
    const tex = playerTex.get(world.character.sprite);
    const blink = p.iframes > 0 && now - st.hurtAt < 2500 && ((simMs / 70) | 0) % 2 === 0;
    playerSprite.texture = blink ? tex[1] : tex[0];
    // A step bob while walking (the pack's characters are single frames): up a pixel every
    // other step, on sim time, so she stands still whenever the sim does.
    const step = world.over ? 0 : stepHop(p.moving, simSec, F.bob.stepsPerSec);
    playerSprite.position.set(Math.round(x), Math.round(y) - PLAYER_FEET_ROOM - step);
    if (p.fx > 0.1) playerSprite.scale.x = 1; else if (p.fx < -0.1) playerSprite.scale.x = -1;
    playerSprite.visible = !world.over || world.over.reason !== END.DIED || ((now / 120) | 0) % 2 === 0;
    shadows.add(SHADOW[0], Math.round(x), Math.round(y + 5), 1, 1, 0, C.white);
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
      else tex = P.a[i] === 2 ? CHEST_B : CHEST_E;
      const hover = kind === PICK.CHEST ? 0 : Math.round(Math.sin(now / 260 + i));
      pickups.add(tex, Math.round(x), Math.round(y) + hover, 1, 1, 0, C.white);
    }
    // The map's secret caches, until opened.
    for (const s of world.secrets) if (!s.open && inView(s.x, s.y, 16)) pickups.add(CACHE, Math.round(s.x), Math.round(s.y), 1, 1, 0, C.white);
    pickups.end();
  }

  function drawShots(alpha) {
    const P = world.projectiles;
    shots.begin();
    let n = 0;
    for (let i = 0; i < P.count; i++) {
      if ((P.flags[i] & PF.DEAD) !== 0) continue;
      const x = lerp(P.px[i], P.x[i], alpha), y = lerp(P.py[i], P.y[i], alpha);
      if (!inView(x, y, 16)) continue;
      const hostile = (P.flags[i] & PF.HOSTILE) !== 0;
      const tex = hostile ? hostileTex : (shotTex[P.def[i]] || PARTICLE_FRAMES[PF_FRAME.PLUS]);
      const dx = P.x[i] - P.px[i], dy = P.y[i] - P.py[i];
      const rot = !hostile && shotUpright[P.def[i]] === true ? 0 : dx * dx + dy * dy > 0.01 ? Math.atan2(dy, dx) : 0;
      shots.add(tex, Math.round(x), Math.round(y), 1, 1, rot, C.white);
      n++;
    }
    // A beam's own sprite (the Signal Mirror's glint, the lens) where it leaves you, while it lasts.
    const Z = world.zones;
    for (let z = 0; z < Z.count; z++) {
      if (Z.kind[z] !== ZONE.BEAM) continue;
      const def = world.slots[Z.slot[z]]?.defIndex;
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
      if (kind === ZONE.AURA) {
        g.circle(Math.round(x), Math.round(y), r).fill({ color: C.lamp, alpha: 0.05 }).stroke({ width: 1, color: C.lamp, alpha: 0.22 });
      } else if (kind === ZONE.WAVE) {
        g.circle(Math.round(x), Math.round(y), r).stroke({ width: Math.max(1, Z.thickness[i] * 0.35), color: C.cool, alpha: 0.55 * (1 - u) + 0.15 });
      } else if (kind === ZONE.BEAM) {
        g.moveTo(Math.round(x), Math.round(y)).lineTo(Math.round(x + Z.dx[i] * Z.length[i]), Math.round(y + Z.dy[i] * Z.length[i]))
          .stroke({ width: Math.max(2, Z.thickness[i]), color: C.lamp, alpha: 0.7 * (1 - u) + 0.2 });
      } else if (kind === ZONE.GROUND) {
        const flick = 0.18 + 0.07 * Math.sin(now / 70 + i);
        g.circle(Math.round(x), Math.round(y), r).fill({ color: C.rot3, alpha: flick * (1 - u * 0.6) });
        if (((now / 50) | 0) % 5 === i % 5) st.sparks.spawn(x + (st.rand() - 0.5) * r, y + (st.rand() - 0.5) * r, 0, -20, 400, PF_FRAME.DOT, C.ember, 0, 0);
      } else if (kind === ZONE.HAZARD && Z.age[i] >= Z.warn[i]) {
        // The pool itself (its warning is drawn with the other warnings, unlit).
        g.circle(Math.round(x), Math.round(y), r).fill({ color: C.violet1, alpha: 0.75 }).stroke({ width: 1, color: C.rot2, alpha: 0.9 });
      }
    }
    drawBolts(g);
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

  function drawWarnings() {
    const g = teleG, Z = world.zones, F = feel.telegraph;
    const pulse = 0.5 + 0.5 * Math.sin(simSeconds(world) * F.pulsePerSec * TAU);
    expireTelegraphs(st, world.tick);
    g.clear();
    const W = st.tele;
    for (let k = 0; k < W.n; k++) {
      const u = 1 - (W.end[k] - world.tick) / W.total[k];
      const x = Math.round(W.x[k]), y = Math.round(W.y[k]), s = W.size[k], a = W.ang[k];
      const edge = 0.55 + 0.45 * pulse;
      switch (W.shape[k]) {
        case TELE.RING:
          g.circle(x, y, s).fill({ color: C.warn, alpha: 0.08 + 0.22 * u }).stroke({ width: 2, color: C.warnHot, alpha: edge });
          g.circle(x, y, Math.max(1, s * u)).stroke({ width: 1, color: C.warnHot, alpha: 0.8 });
          break;
        case TELE.LINE: {
          const w = F.lineWidth, ex = Math.cos(a), ey = Math.sin(a), nx = (-ey * w) / 2, ny = (ex * w) / 2;
          g.poly([x + nx, y + ny, x + ex * s + nx, y + ey * s + ny, x + ex * s - nx, y + ey * s - ny, x - nx, y - ny])
            .fill({ color: C.warn, alpha: 0.1 + 0.25 * u }).stroke({ width: 1, color: C.warnHot, alpha: edge });
          break;
        }
        case TELE.FAN: {
          const spread = (s * Math.PI) / 180, len = F.fanLength;
          for (let j = -2; j <= 2; j++) {
            const aa = a + ((j / 2) * spread) / 2;
            g.moveTo(x, y).lineTo(x + Math.cos(aa) * len, y + Math.sin(aa) * len).stroke({ width: 1, color: C.warnHot, alpha: edge * 0.8 });
          }
          break;
        }
        case TELE.SUMMON:
          g.circle(x, y, s).stroke({ width: 1, color: C.violet, alpha: edge });
          break;
        default: break;
      }
    }
    // Hazard pools warn by filling in before they hurt.
    for (let i = 0; i < Z.count; i++) {
      if (Z.kind[i] !== ZONE.HAZARD || Z.age[i] >= Z.warn[i]) continue;
      const u = Z.warn[i] > 0 ? Z.age[i] / Z.warn[i] : 1;
      const x = Math.round(Z.x[i]), y = Math.round(Z.y[i]), r = Z.radius[i];
      g.circle(x, y, r).fill({ color: C.warn, alpha: 0.1 + 0.25 * u }).stroke({ width: 2, color: C.warnHot, alpha: 0.55 + 0.45 * pulse });
      g.circle(x, y, Math.max(1, r * u)).stroke({ width: 1, color: C.warnHot, alpha: 0.7 });
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

  function drawNumbers() {
    const N = st.numbers, F = feel.numbers;
    N.expire(now, F.lifeMs);
    numbersLayer.begin();
    for (let i = 0; i < N.max; i++) {
      if (N.live[i] === 0) continue;
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
    const amb = Math.min(1, Math.max(0, (world.map.ambient ?? 0.35) + L.ambientBoost));
    const r0 = performance.now();
    app.render({ container: lightRoot, target: lightRT, clear: true, clearColor: [amb, amb, Math.min(1, amb * 1.08), 1] });
    // Fog: drifting noise, anchored to the world, cut away by the same lights.
    fogTile.tint = C.fog;
    fogTile.alpha = feel.fog.density;
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
    get shake() { return st.shake; },
    /** Start drawing a run. */
    attach(w) {
      world = w;
      feel = w.tuning.feel;
      groundKey = -1;
      renderer.world.addChild(root);
      resetViewState(st);
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
      consumeEvents(st, world.events, {
        now, tick: world.tick, feel, numbersOn: access.damageNumbers !== false, playerX: p.x, playerY: p.y,
        slotOf: world.enemies.slotOf,
      });
    },
    /** Draw one frame. alpha: how far between the last two ticks. frameMs: real frame time. */
    draw(alpha, frameMs) {
      if (!world) return;
      const t0 = performance.now();
      feel = world.tuning.feel;
      now += frameMs;
      const p = world.player;
      // Camera: centered on the player, plus shake (whole pixels), then kept inside the map, so a
      // shake at the map's edge never shows what lies past it.
      let cx = lerp(p.px, p.x, alpha), cy = lerp(p.py, p.y, alpha) - 4;
      st.shake.update(frameMs / 1000, feel.shake.decayPerSec);
      if (access.shake !== false) { st.shake.offsetInto(shakeOut, now / 1000, feel.shake.maxOffset); cx += shakeOut[0]; cy += shakeOut[1]; }
      const tr = world.terrain;
      cx = Math.min(Math.max(cx, VIEW_W / 2), tr.width - VIEW_W / 2);
      cy = Math.min(Math.max(cy, VIEW_H / 2), tr.height - VIEW_H / 2);
      renderer.camera.x = cx; renderer.camera.y = cy;
      origin.x = splitCamera(cx - VIEW_W / 2).whole - MARGIN;
      origin.y = splitCamera(cy - VIEW_H / 2).whole - MARGIN;
      drawGround();
      drawZones(alpha);
      drawPickups(alpha);
      drawEnemies(alpha);
      drawShots(alpha);
      drawActors(alpha);
      drawEffects(frameMs);
      drawLight(alpha, renderer.app.renderer);
      drawWarnings();
      drawNumbers();
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
