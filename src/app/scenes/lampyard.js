// Phase 1 test scene: a lamplighter walking a dark yard of wet boards and street lamps.
// It proves the whole chain end to end: input -> fixed-tick sim -> interpolated render -> the
// integer-scaled world. Since Phase 3 it is the backdrop behind the title screen (attract: true).

import { Container, Graphics, Sprite, Texture, TilingSprite } from 'pixi.js';
import { frameMove } from '../../lib/inputframe.js';
import { flen } from '../../lib/fmath.js';
import { PLAYER_FEET_ROOM } from '../../render/playerframe.js';
import { floorVariant } from '../../render/viewstate.js';

const SPEED = 80;          // px per second
const DASH_SPEED = 260;
const DASH_TIME = 0.14;
const DASH_COOLDOWN = 0.9;
const YARD = 1600;

// Textures made here skip Pixi's global cache (which would keep every canvas alive forever) and
// are destroyed when the scene exits.
function canvasTexture(owned, w, h, paint) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  paint(g);
  const t = Texture.from(c, true);
  t.source.scaleMode = 'nearest';
  owned.push(t);
  return t;
}

/**
 * The yard's ground: the Drowned Docks' boards from the atlas, placed by the run view's own picker
 * (render/viewstate.js floorVariant) into a 32 x 32 tile block that repeats every 512 px.
 */
const GROUND_TILES = 32;
function groundTexture(owned, atlas) {
  const img = atlas.source.resource;
  const size = GROUND_TILES * 16;
  return canvasTexture(owned, size, size, (g) => {
    for (let ty = 0; ty < GROUND_TILES; ty++) {
      for (let tx = 0; tx < GROUND_TILES; tx++) {
        const r = atlas.rect(`tile_floor_${floorVariant(tx, ty)}`);
        g.drawImage(img, r.x, r.y, r.w, r.h, tx * 16, ty * 16, 16, 16);
      }
    }
  });
}

function glowTexture(owned, radius, color) {
  const size = radius * 2;
  return canvasTexture(owned, size, size, (g) => {
    const grad = g.createRadialGradient(radius, radius, 0, radius, radius, radius);
    grad.addColorStop(0, color);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
  });
}

export function createLampyardScene({ renderer, input, atlas, attract = false }) {
  let root = null;
  const state = {
    x: YARD / 2, y: YARD / 2, px: YARD / 2, py: YARD / 2,
    dashT: 0, dashCd: 0, dashX: 0, dashY: 0, facing: 1, ticks: 0,
  };
  let player, playerGlow;
  let owned = [];

  return {
    safePoint: true,
    state,
    enter() {
      owned = [];
      root = new Container();
      const ground = new TilingSprite({ texture: groundTexture(owned, atlas), width: YARD, height: YARD });
      root.addChild(ground);
      const lampTex = atlas.tex('prop_lamppost');
      const lampGlow = glowTexture(owned, 48, 'rgba(255,190,110,0.55)');
      const glows = [];
      for (let i = 0; i < 40; i++) {
        const lx = 80 + ((i * 397) % (YARD - 160));
        const ly = 80 + ((i * 691) % (YARD - 160));
        const lamp = new Sprite(lampTex);
        lamp.anchor.set(0.5, 1); lamp.position.set(lx, ly);
        root.addChild(lamp);
        const glow = new Sprite(lampGlow);
        glow.anchor.set(0.5); glow.position.set(lx, ly - 19); glow.blendMode = 'add';
        glows.push(glow);
      }
      playerGlow = new Sprite(glowTexture(owned, 64, 'rgba(255,217,138,0.45)'));
      playerGlow.anchor.set(0.5); playerGlow.blendMode = 'add';
      const her = atlas.tex('pc_lamplighter');
      player = new Sprite(her);
      player.anchor.set(0.5, (her.frame.height - PLAYER_FEET_ROOM) / her.frame.height); // her feet
      const fog = new Graphics().rect(0, 0, YARD, YARD).fill({ color: 0x0d1018, alpha: 0.35 });
      // The lamps' light goes over the fog, as hers does (under it, the lamps looked unlit).
      root.addChild(fog, ...glows, playerGlow, player);
      renderer.world.addChild(root);
    },
    exit() {
      renderer.world.removeChild(root);
      root.destroy({ children: true });
      root = null;
      for (const t of owned) t.destroy(true);
      owned = [];
    },
    step(dt) {
      // Behind the title screen the lamplighter walks a slow loop on her own (the menus have
      // the controller).
      const f = attract
        ? { mx: Math.round(Math.cos(state.ticks / 240) * 60), my: Math.round(Math.sin(state.ticks / 240) * 60), buttons: 0 }
        : input.sampleFrame();
      const mv = frameMove(f);
      state.px = state.x; state.py = state.y;
      state.dashCd = Math.max(0, state.dashCd - dt);
      if ((f.buttons & 1) && state.dashCd === 0 && flen(mv.x, mv.y) > 0.2) {
        const m = flen(mv.x, mv.y);
        state.dashX = mv.x / m; state.dashY = mv.y / m;
        state.dashT = DASH_TIME; state.dashCd = DASH_COOLDOWN;
      }
      let vx, vy;
      if (state.dashT > 0) { state.dashT -= dt; vx = state.dashX * DASH_SPEED; vy = state.dashY * DASH_SPEED; }
      else { vx = mv.x * SPEED; vy = mv.y * SPEED; }
      if (vx) state.facing = vx > 0 ? 1 : -1;
      state.x = Math.min(YARD - 8, Math.max(8, state.x + vx * dt));
      state.y = Math.min(YARD - 2, Math.max(16, state.y + vy * dt));
      state.ticks++;
    },
    frame(alpha) {
      const x = state.px + (state.x - state.px) * alpha;
      const y = state.py + (state.y - state.py) * alpha;
      player.position.set(Math.round(x), Math.round(y));
      player.scale.x = state.facing;
      playerGlow.position.set(Math.round(x), Math.round(y) - 8);
      renderer.camera.x = x;
      renderer.camera.y = y - 8;
    },
  };
}
