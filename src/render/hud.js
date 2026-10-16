// The HUD (ARCHITECTURE §6.2 layer 13): drawn at 640 x 360 in its own layer, so it never jitters
// with the camera or the shake. HP (and shield), the dash cooldown, the XP bar, the timer, level,
// kills, weapon and passive icons with levels, materials found, the boss's health, overtime,
// short notices, and the screen flashes.
//
// What to show comes from render/hudmodel.js (tested); this file lays it out. Text uses the 5 x 7
// pixel font from the atlas, and a line's glyph sprites are only rebuilt when its text changes.

import { Container, Graphics, Sprite } from 'pixi.js';
import { VIEW_W, VIEW_H } from './layout.js';
import { color as pal } from '../data/palette.js';
import { glyphKey, FONT_ADVANCE, FONT_H, textWidth } from './font.js';
import { createHudModel, updateHudModel, layoutMaterials, HUD_LAYOUT, createHudPlaces, placeHud } from './hudmodel.js';
import { minimapBox, materialsLayoutFor, minimapFade } from './minimapmodel.js';
import { createMinimap } from './minimap.js';

/** A line of pixel text. set() rebuilds its glyphs only when the text or color changes. */
export function createPixelText(atlas, { outlined = true, tint = 0xffffff } = {}) {
  const c = new Container();
  const glyphs = [];
  let text = null, color = -1;
  const prefix = outlined ? 'glyph_o:' : 'glyph:';
  const line = {
    view: c,
    width: 0,
    set(t, col = tint) {
      if (t === text && col === color) return;
      text = t; color = col;
      let n = 0, x = 0;
      for (let k = 0; k < t.length; k++) {
        const g0 = glyphKey(t[k]);
        if (g0 !== null) {
          let g = glyphs[n];
          if (!g) { g = new Sprite(); glyphs.push(g); c.addChild(g); }
          g.texture = atlas.tex(prefix + g0);
          g.position.set(x - (outlined ? 1 : 0), outlined ? -1 : 0);
          g.tint = col;
          g.visible = true;
          n++;
        }
        x += FONT_ADVANCE;
      }
      for (let k = n; k < glyphs.length; k++) glyphs[k].visible = false;
      line.width = textWidth(t);
    },
  };
  return line;
}

const COL = {
  xp: pal('gem-3'), hp: pal('rot-3'), shield: pal('sea-6'), dashReady: pal('lamp-5'), dashWait: pal('fog-2'),
  frame: pal('night-0'), back: pal('night-1'), back2: pal('night-2'), boss: pal('rot-2'), hurt: pal('rot-2'), wash: pal('lamp-5'),
  asc: pal('violet-4'), text: pal('fog-5'), dim: pal('fog-4'), level: pal('lamp-5'), max: pal('lamp-5'), warn: pal('rot-4'), notice: pal('lamp-6'),
};

export function createHud({ renderer, atlas, hudSettings = { minimap: 'nearby', minimapSize: 'small' } }) {
  const root = new Container();
  const g = new Graphics();          // bars and frames
  const flashG = new Graphics();     // hurt edge and level-up wash
  const pipsG = new Graphics();      // ascension pips, over the icons (kept the last child)
  const minimap = createMinimap();   // top right (render/minimap.js), under the kills
  let mapWorld = null;
  const matBox = { x: 0, y: 0, w: 0, h: 0 }, feet = { x: 0, y: 0 };   // scratch: the materials' extent, your feet in the view
  root.addChild(flashG, g, minimap.root);
  const txt = (tint) => { const t = createPixelText(atlas, { tint }); root.addChild(t.view); return t; };
  const timer = txt(COL.text), level = txt(COL.level), kills = txt(COL.dim), hp = txt(COL.text);
  const boss = txt(COL.warn), overtime = txt(COL.warn), notice = txt(COL.notice);
  const icons = [], iconLv = [], mats = [], matTxt = [], matPlace = [];
  const model = createHudModel();
  const places = createHudPlaces();
  const widths = { hp: 0, level: 0, timer: 0, kills: 0, boss: 0, overtime: 0, notice: 0 };
  const L = HUD_LAYOUT;
  let noticeUntil = 0;

  function iconAt(k) {
    if (!icons[k]) {
      const s = new Sprite(); icons.push(s); root.addChild(s);
      const t = createPixelText(atlas, { tint: COL.text }); iconLv.push(t); root.addChild(t.view);
    }
    return icons[k];
  }

  function bar(x, y, w, h, frac, fill, back = COL.back) {
    g.rect(x - 1, y - 1, w + 2, h + 2).fill({ color: COL.frame });
    g.rect(x, y, w, h).fill({ color: back });
    if (frac > 0) g.rect(x, y, Math.max(1, Math.round(w * frac)), h).fill({ color: fill });
  }

  // Icons are 18 x 18 (atlas); the level sits on the bottom right corner, over the border.
  function iconRow(list, count, y, k0) {
    let x = L.icons.x, k = k0;
    for (let j = 0; j < count; j++) {
      const it = list[j], s = iconAt(k);
      s.texture = atlas.tex(it.icon);
      s.position.set(x, y);
      s.visible = true;
      const lv = iconLv[k];
      lv.set(it.levelText, it.max ? COL.max : COL.text);
      lv.view.position.set(x + L.icons.size + 1 - lv.width, y + L.icons.size - FONT_H + 1);
      lv.view.visible = true;
      // Ascensions: a violet pip each (2 px, framed) along the icon's top edge, inside its box.
      for (let a = 0; a < (it.asc || 0); a++) pipsG.rect(x + a * 4, y, 4, 4).fill({ color: COL.frame }).rect(x + 1 + a * 4, y + 1, 2, 2).fill({ color: COL.asc });
      x += L.icons.step;
      k++;
    }
    return k;
  }

  return {
    root,
    model,
    attach() { renderer.hud.addChild(root); },
    detach() { if (root.parent) root.parent.removeChild(root); minimap.detach(); mapWorld = null; },
    /** Show a short line in the middle of the screen until nowMs + ms. */
    notice(text, ms, nowMs) { notice.set(text); noticeUntil = nowMs + ms; },
    /** Draw the HUD for this frame. flash: { hurt, level } strengths from the run view. */
    draw(world, nowMs, flash) {
      const m = updateHudModel(model, world);
      // Texts first (their widths decide where things go), then place everything (hudmodel.js).
      hp.set(m.hpText); level.set(m.levelText); timer.set(m.timerText); kills.set(m.killsText);
      if (m.boss.shown) boss.set(m.boss.name);
      if (m.overtime.shown) overtime.set(m.overtime.text);
      widths.hp = hp.width; widths.level = level.width; widths.timer = timer.width; widths.kills = kills.width;
      widths.boss = boss.width; widths.overtime = overtime.width; widths.notice = notice.width;
      const P = placeHud(places, widths, m.boss.shown);
      g.clear(); pipsG.clear();
      if (root.children.at(-1) !== pipsG) root.addChild(pipsG);   // icons made since go under it
      bar(P.xp.x, P.xp.y, P.xp.w, P.xp.h, m.xpFrac, COL.xp, COL.back2);
      bar(P.hp.x, P.hp.y, P.hp.w, P.hp.h, m.hpFrac, COL.hp);
      if (m.shieldFrac > 0) g.rect(P.hp.x, P.hp.y, Math.max(1, Math.round(P.hp.w * m.shieldFrac)), 2).fill({ color: COL.shield });
      bar(P.dash.x, P.dash.y, P.dash.w, P.dash.h, m.dashFrac, m.dashReady ? COL.dashReady : COL.dashWait);
      hp.view.position.set(P.hpText.x, P.hpText.y);
      level.view.position.set(P.levelText.x, P.levelText.y);
      timer.view.position.set(P.timerText.x, P.timerText.y);
      kills.view.position.set(P.killsText.x, P.killsText.y);
      let k = iconRow(m.weapons, m.weaponCount, L.icons.weaponsY, 0);
      k = iconRow(m.passives, m.passiveCount, L.icons.passivesY, k);
      for (let j = k; j < icons.length; j++) { icons[j].visible = false; iconLv[j].view.visible = false; }
      // Materials found this run: right-aligned under the kills, the last found nearest the
      // edge, wrapping before they reach the boss's bar (hudmodel.js layoutMaterials).
      for (let j = 0; j < m.materialCount; j++) {
        const e = m.materials[m.materialCount - 1 - j];
        if (!mats[j]) { mats[j] = new Sprite(); root.addChild(mats[j]); matTxt[j] = createPixelText(atlas, { tint: COL.dim }); root.addChild(matTxt[j].view); matPlace[j] = { iconW: 0, iconH: 0, textW: 0, ix: 0, iy: 0, tx: 0, ty: 0 }; }
        matTxt[j].set(e.text);
        const tex = atlas.tex(e.icon);
        mats[j].texture = tex;
        const pl = matPlace[j];
        pl.iconW = tex.frame.width; pl.iconH = tex.frame.height; pl.textW = matTxt[j].width;
      }
      // The minimap (its setting, read live), and the materials moved down under it.
      if (mapWorld !== world) { minimap.attach(world); mapWorld = world; }
      const mapBox = minimapBox(hudSettings.minimap, hudSettings.minimapSize);
      minimap.draw(mapBox, hudSettings.minimap, renderer.camera, nowMs);
      layoutMaterials(matPlace, m.materialCount, materialsLayoutFor(mapBox));
      // The materials fade as the minimap does while you stand under them (they reach down into
      // the play field once a few rows wrap under a Large minimap).
      matBox.x = Infinity; matBox.y = Infinity; let mx1 = -Infinity, my1 = -Infinity;
      for (let j = 0; j < m.materialCount; j++) {
        const pl = matPlace[j];
        matBox.x = Math.min(matBox.x, pl.ix); matBox.y = Math.min(matBox.y, pl.iy, pl.ty);
        mx1 = Math.max(mx1, pl.tx + pl.textW); my1 = Math.max(my1, pl.iy + pl.iconH, pl.ty + FONT_H);
      }
      matBox.w = mx1 - matBox.x; matBox.h = my1 - matBox.y;
      feet.x = world.player.x - renderer.camera.x + VIEW_W / 2; feet.y = world.player.y - renderer.camera.y + VIEW_H / 2;
      const matAlpha = m.materialCount ? minimapFade(matBox, feet) : 1;
      for (let j = 0; j < m.materialCount; j++) {
        const pl = matPlace[j];
        matTxt[j].view.position.set(pl.tx, pl.ty); mats[j].position.set(pl.ix, pl.iy);
        mats[j].visible = true; matTxt[j].view.visible = true;
        mats[j].alpha = matAlpha; matTxt[j].view.alpha = matAlpha;
      }
      for (let j = m.materialCount; j < mats.length; j++) { if (mats[j]) { mats[j].visible = false; matTxt[j].view.visible = false; } }
      boss.view.visible = m.boss.shown;
      if (m.boss.shown) {
        bar(P.bossBar.x, P.bossBar.y, P.bossBar.w, P.bossBar.h, m.boss.frac, COL.boss);
        boss.view.position.set(P.bossName.x, P.bossName.y);
      }
      overtime.view.visible = m.overtime.shown;
      if (m.overtime.shown) overtime.view.position.set(P.overtime.x, P.overtime.y);
      notice.view.visible = nowMs < noticeUntil;
      if (notice.view.visible) notice.view.position.set(P.notice.x, P.notice.y);
      // Screen flashes: a red edge when hurt, a warm wash on a level-up.
      flashG.clear();
      if (flash.hurt > 0) {
        const a = 0.45 * flash.hurt;
        flashG.rect(0, 0, VIEW_W, 6).fill({ color: COL.hurt, alpha: a });
        flashG.rect(0, VIEW_H - 6, VIEW_W, 6).fill({ color: COL.hurt, alpha: a });
        flashG.rect(0, 6, 6, VIEW_H - 12).fill({ color: COL.hurt, alpha: a });
        flashG.rect(VIEW_W - 6, 6, 6, VIEW_H - 12).fill({ color: COL.hurt, alpha: a });
      }
      if (flash.level > 0) flashG.rect(0, 0, VIEW_W, VIEW_H).fill({ color: COL.wash, alpha: 0.18 * flash.level });
    },
    destroy() { this.detach(); minimap.destroy(); root.destroy({ children: true }); },
  };
}
