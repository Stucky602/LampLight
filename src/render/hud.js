// The HUD (ARCHITECTURE §6.2 layer 13): drawn at 640 x 360 in its own layer, so it never jitters
// with the camera. HP (and shield), the dash cooldown, the XP bar, the timer, level,
// kills, weapon and passive icons with levels, the minimap, the boss's health, overtime,
// short notices (the middle line, and the quiet line in the lower third), and the screen flashes.
//
// What to show comes from render/hudmodel.js (tested); this file lays it out. Text uses the pixel
// font from the atlas (render/font.js: Jersey 10, the menus' own typeface, on its own grid); an
// icon's level uses the small damage digits. A line's sprites are only rebuilt when it changes.

import { Container, Graphics, Sprite } from 'pixi.js';
import { VIEW_W, VIEW_H } from './layout.js';
import { color as pal } from '../data/palette.js';
import { glyphKey, advanceOf, FONT_H, textWidth, DIGIT_ADVANCE, DIGIT_H } from './font.js';
import { createHudModel, updateHudModel, HUD_LAYOUT, createHudPlaces, placeHud, placeMapRow, placeTrade, createNoticeQueue, pushNotice, noticeNow, noticeBreak, NOTICE_LINE_H, NOTICE_MAX_W } from './hudmodel.js';
import { minimapBox, MINIMAP, MARK, MARK_SHAPES } from './minimapmodel.js';
import { createMinimap } from './minimap.js';
import { collectArrows } from '../sim/signs.js';
import { placeArrows, ARROW_LOOK, ARROW_SIZE } from './arrows.js';
import { MAX_WEAPON_SLOTS } from '../sim/constants.js';

// The edge arrows' and the map row's colors (render/signview.js SIGN_COLOR's, by key; repeated
// here so the HUD needn't load the world's sign drawing).
const SIGN = { lamp: pal('lamp-4'), bell: pal('gem-3'), ferry: pal('sea-5'), well: pal('fog-4'), reliquary: pal('violet-4'), vault: pal('violet-4'), chest: pal('lamp-3') };

/** How many notice lines can wait behind the one showing (each line its own queue). */
const NOTICE_QUEUE = 3;

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
        x += advanceOf(t[k]);
      }
      for (let k = n; k < glyphs.length; k++) glyphs[k].visible = false;
      line.width = textWidth(t);
    },
  };
  return line;
}

/**
 * A number in the small damage digits (3 x 5, outlined): an icon's level badge, which the font's
 * 10-row figures would bury the icon under. set() rebuilds only when the text or color changes.
 */
export function createDigitText(atlas, { tint = 0xffffff } = {}) {
  const c = new Container();
  const sprites = [];
  let text = null, color = -1;
  const line = {
    view: c,
    width: 0,
    set(t, col = tint) {
      if (t === text && col === color) return;
      text = t; color = col;
      let n = 0;
      for (let k = 0; k < t.length; k++) {
        const d = t.charCodeAt(k) - 48;
        if (d < 0 || d > 9) continue;
        let s = sprites[n];
        if (!s) { s = new Sprite(); sprites.push(s); c.addChild(s); }
        s.texture = atlas.tex(`digit:${d}`);
        s.position.set(n * DIGIT_ADVANCE, 0);
        s.tint = col; s.visible = true;
        n++;
      }
      for (let k = n; k < sprites.length; k++) sprites[k].visible = false;
      line.width = n > 0 ? n * DIGIT_ADVANCE + 1 : 0;
    },
  };
  return line;
}

const COL = {
  xp: pal('gem-3'), hp: pal('rot-3'), shield: pal('sea-6'), dashReady: pal('lamp-5'), dashWait: pal('fog-2'),
  frame: pal('night-0'), back: pal('night-1'), back2: pal('night-2'), boss: pal('rot-2'), hurt: pal('rot-2'), wash: pal('lamp-5'),
  weak: pal('lamp-4'), asc: pal('violet-4'), glass: pal('sea-5'), text: pal('fog-5'), dim: pal('fog-4'), level: pal('lamp-5'), max: pal('lamp-5'), warn: pal('rot-4'), notice: pal('lamp-6'),
  // C3: the signature's frame, a deed's bar, the character's meter.
  sig: pal('lamp-4'), deed: pal('violet-4'), deedDone: pal('lamp-5'), tide: pal('sea-5'), hot: pal('lamp-5'), mark: pal('fog-5'), meter: pal('lamp-4'), label: pal('fog-3'),
  hc: pal('fog-5'), empty: pal('night-4'),
};

export function createHud({ renderer, atlas, hudSettings = { minimap: 'nearby', minimapSize: 'small', arrows: true }, access = {} }) {
  const root = new Container();
  const g = new Graphics();          // bars and frames
  const signG = new Graphics();      // the edge arrows and the map row's marks (0.8.2)
  const flashG = new Graphics();     // hurt edge and level-up wash
  const pipsG = new Graphics();      // ascension pips, over the icons (kept the last child)
  const minimap = createMinimap();   // top right (render/minimap.js), under the kills
  let mapWorld = null;
  root.addChild(flashG, g, minimap.root, signG);
  const txt = (tint) => { const t = createPixelText(atlas, { tint }); root.addChild(t.view); return t; };
  const timer = txt(COL.text), level = txt(COL.level), kills = txt(COL.dim), hp = txt(COL.text), glass = txt(COL.glass);
  const boss = txt(COL.warn), overtime = txt(COL.warn), notice = txt(COL.notice), quiet = txt(COL.dim);
  // A notice too wide for one line wraps onto a second under it (hudmodel.js noticeBreak).
  const notice2 = txt(COL.notice), quiet2 = txt(COL.dim);
  const wrapped = { notice: { from: null, a: '', b: '' }, quiet: { from: null, a: '', b: '' } };
  /** A notice's two lines (the second '' when it fits on one), worked out once per new text. */
  // UI text scale (W7's access.textScale): at 1.5 and up the notice lines draw at twice the font's
  // size (the next whole step, so they stay crisp); 1.25 keeps them as they are.
  const noticeScale = () => ((access.textScale ?? 1) >= 1.5 ? 2 : 1);
  let wrapScale = 1;
  const wrap = (w, text) => {
    const sc = noticeScale();
    if (w.from === text && wrapScale === sc) return w;
    w.from = text; wrapScale = sc;
    const k = noticeBreak(text, NOTICE_MAX_W / sc);
    if (k < 0) { w.a = text; w.b = ''; } else { w.a = text.slice(0, k); w.b = text.slice(k + 1); }
    return w;
  };
  const lampsT = txt(SIGN.lamp), bellsT = txt(SIGN.bell);
  const champ = txt(COL.warn), boss2 = txt(COL.warn);
  // The character's meter (C3): its label, its text, and "Flames" before the Lamplighter's pips.
  const tradeLabel = txt(COL.label), tradeText = txt(COL.text), flamesLabel = txt(COL.label);
  const tradeBox = { x: 0, y: 0, w: 0, h: 0, barX: 0, barW: 0, pipX: 0, textX: 0 }, tradeW = { label: 0, text: 0, flames: 0 };
  const hc = () => access.highContrast === true;
  const targets = [], placed = [], row = { x: 0, y: 0, w: 0, h: 0 }, avoid = [], live = [];
  for (let k = 0; k < 7; k++) avoid.push({ x: 0, y: 0, w: 0, h: 0 });
  const setBox = (b, x, y, w, h) => { b.x = x; b.y = y; b.w = w; b.h = h; return b; };
  /** A minimap mark's shape at (x, y), in a color (the night's dark for its ink-0 parts). */
  const mark = (kind, x, y, col) => { for (const [dx, dy, w, h, ink] of MARK_SHAPES[kind]) signG.rect(x + dx, y + dy, w, h).fill({ color: ink ? col : COL.frame }); };
  const icons = [], iconLv = [];
  const model = createHudModel();
  const places = createHudPlaces();
  const widths = { hp: 0, level: 0, timer: 0, kills: 0, glass: 0, boss: 0, overtime: 0, notice: 0, quiet: 0 };
  const L = HUD_LAYOUT;
  const loud = createNoticeQueue(NOTICE_QUEUE), calm = createNoticeQueue(NOTICE_QUEUE);

  function iconAt(k) {
    if (!icons[k]) {
      const s = new Sprite(); icons.push(s); root.addChild(s);
      const t = createDigitText(atlas, { tint: COL.text }); iconLv.push(t); root.addChild(t.view);
    }
    return icons[k];
  }

  function bar(x, y, w, h, frac, fill, back = COL.back) {
    // High contrast (W7's access.highContrast): a light frame round every bar, so it stands off the ground.
    g.rect(x - 1, y - 1, w + 2, h + 2).fill({ color: hc() ? COL.hc : COL.frame });
    g.rect(x, y, w, h).fill({ color: back });
    if (frac > 0) g.rect(x, y, Math.max(1, Math.round(w * frac)), h).fill({ color: fill });
  }

  // Icons are 18 x 18 (atlas); the level sits on the bottom right corner, over the border.
  function iconRow(list, count, y, k0) {
    let x = L.icons.x, k = k0;
    for (let j = 0; j < count; j++) {
      const it = list[j], s = iconAt(k);
      // The character's own weapon (C3): a 1 px frame in the lamp's amber, and a gap after it.
      if (it.sig) { const z = L.icons.size; pipsG.rect(x - 1, y - 1, z + 2, 1).rect(x - 1, y + z, z + 2, 1).rect(x - 1, y, 1, z).rect(x + z, y, 1, z).fill({ color: COL.sig }); }
      // Its capstone's deed (C3): a 2 px bar under the icon while it counts; lit once done.
      if (it.deed !== undefined && it.deed >= 0) {
        const dy = L.icons.deedY, w = L.icons.size;
        g.rect(x, dy, w, L.icons.deedH).fill({ color: hc() ? COL.hc : COL.empty });
        if (it.deed > 0) g.rect(x, dy, Math.max(1, Math.round(w * it.deed)), L.icons.deedH).fill({ color: it.deedDone ? COL.deedDone : COL.deed });
      }
      s.texture = atlas.tex(it.icon);
      s.position.set(x, y);
      s.visible = true;
      const lv = iconLv[k];
      lv.set(it.levelText, it.max ? COL.max : COL.text);
      lv.view.position.set(x + L.icons.size + 1 - lv.width, y + L.icons.size - DIGIT_H);
      lv.view.visible = true;
      // Ascensions: a violet pip each (2 px, framed) along the icon's top edge, inside its box.
      for (let a = 0; a < (it.asc || 0); a++) pipsG.rect(x + a * 4, y, 4, 4).fill({ color: COL.frame }).rect(x + 1 + a * 4, y + 1, 2, 2).fill({ color: COL.asc });
      x += L.icons.step + (it.sig ? L.icons.sigGap : 0);
      k++;
    }
    return k;
  }

  /** One boss's bar: in a weak window it burns bright (hits land in full); held at a notch, that notch pulses. */
  function bossBar(b, x, w, y, h, nowMs) {
    bar(x, y, w, h, b.frac, b.weak ? COL.weak : COL.boss);
    for (const share of b.notches) {
      const nx = Math.round(x + w * share);
      const at = b.held && Math.abs(b.frac - share) < 0.02;
      g.rect(nx - 1, y - 2, 2, h + 4).fill({ color: COL.frame });
      g.rect(nx, y - 2, 1, h + 4).fill({ color: at ? COL.notice : COL.dim, alpha: at ? 0.6 + 0.4 * Math.sin(nowMs / 90) : 1 });
    }
  }

  /**
   * The character's meter (C3), under the passives: a label, then a bar (King Tide's clock with its
   * ebb marked, the purse, the hook) or steps (Momentum, oil), the Lamplighter's spare flames as
   * pips, and a short text (the purse's count, the thralls standing). Hot (the last seconds before a
   * beat, full Momentum, a crate marked, the hook ready) draws it in the lamp's light color.
   */
  function drawTrade(t, nowMs) {
    const on = !!t.kind;
    tradeLabel.view.visible = tradeText.view.visible = flamesLabel.view.visible = false;
    if (!on) return;
    const R = L.trade;
    tradeLabel.set(t.label); tradeText.set(t.text || ''); if (t.pipsMax) flamesLabel.set('Spare flames');
    tradeW.label = tradeLabel.width; tradeW.text = t.text ? tradeText.width : 0; tradeW.flames = t.pipsMax ? flamesLabel.width : 0;
    const B = placeTrade(tradeBox, t, tradeW);
    tradeLabel.view.visible = true; tradeLabel.view.position.set(B.x, B.y);
    const by = B.y + Math.round((FONT_H - R.barH) / 2) - 1;
    if (t.kind === 'tide' || t.kind === 'purse' || t.kind === 'hook') {
      bar(B.barX, by, B.barW, R.barH, t.frac, t.hot ? COL.hot : t.kind === 'tide' ? COL.tide : COL.meter, COL.empty);
      if (t.mark >= 0) { const mx = Math.round(B.barX + B.barW * t.mark); g.rect(mx, by - 2, 1, R.barH + 4).fill({ color: COL.mark }); }
    } else if (t.kind === 'momentum' || t.kind === 'oil') {
      for (let k = 0; k < t.steps; k++) bar(B.barX + k * 10, by, 8, R.barH, k < t.step ? 1 : 0, t.hot ? COL.hot : COL.meter, COL.empty);
    }
    if (t.pipsMax) {
      flamesLabel.view.visible = true; flamesLabel.view.position.set(B.pipX, B.y);
      const px = B.pipX + tradeW.flames + R.gap;
      for (let k = 0; k < t.pipsMax; k++) {
        const x = px + k * (R.pip + R.pipGap), lit = k < t.pips;
        // A flame: a pip narrow at its top (filled when held, an outline when spent).
        g.rect(x, by - 1, R.pip, R.barH + 2).fill({ color: hc() ? COL.hc : COL.frame });
        if (lit) g.rect(x + 1, by + 1, R.pip - 2, R.barH - 1).fill({ color: COL.meter }).rect(x + 2, by, 1, 1).fill({ color: COL.hot });
        else g.rect(x + 1, by, R.pip - 2, R.barH).fill({ color: COL.empty });
      }
    }
    if (t.text) { tradeText.view.visible = true; tradeText.view.position.set(B.textX, B.y); tradeText.set(t.text, t.hot ? COL.hot : COL.text); }
    // The signature's next trade upgrade (C2's track, ruling 18 KA): a 2 px bar under the row, in the
    // signature frame's amber, filling toward it.
    if (t.nextFrac >= 0) {
      const ny = B.y + FONT_H + 1, nw = Math.max(24, B.textX - B.x - R.gap);
      g.rect(B.x, ny, nw, 2).fill({ color: hc() ? COL.hc : COL.empty });
      if (t.nextFrac > 0) g.rect(B.x, ny, Math.max(1, Math.round(nw * t.nextFrac)), 2).fill({ color: COL.sig });
    }
  }

  /**
   * The edge arrows (0.8.2): to the nearest of each kind off screen (sim/signs.js collectArrows),
   * placed round the view's edge clear of the HUD's corners (render/arrows.js), each in its kind's
   * color, wearing its minimap mark, pointing at it.
   */
  function drawArrows(world, mapBox, rowBox, P, bossShown) {
    if (hudSettings.arrows === false) return;
    const cam = renderer.camera;
    if (!cam) return;
    const n = collectArrows(world, targets, cam.x, cam.y, VIEW_W / 2, VIEW_H / 2);
    if (!n) return;
    let a = 0;
    setBox(avoid[a++], 0, 0, L.icons.x + MAX_WEAPON_SLOTS * L.icons.step + L.icons.sigGap, L.icons.passivesY + L.icons.size + 2);
    if (model.trade.kind) setBox(avoid[a++], tradeBox.x - 2, tradeBox.y - 2, tradeBox.w + 4, tradeBox.h + 4);
    setBox(avoid[a++], P.timerText.x - 4, 0, P.timerText.w + 8, P.timerText.y + FONT_H + 2);
    setBox(avoid[a++], P.glassText.x - 2, 0, VIEW_W - P.glassText.x + 2, P.killsText.y + FONT_H + 2);
    if (mapBox) setBox(avoid[a++], mapBox.x - 3, mapBox.y - 3, mapBox.w + 6, mapBox.h + 6);
    if (rowBox) setBox(avoid[a++], rowBox.x - 4, rowBox.y - 3, rowBox.w + 8, rowBox.h + 5);
    if (bossShown) setBox(avoid[a++], P.bossBar.x - 2, P.bossName.y - 2, P.bossBar.w + 4, P.bossBar.y + P.bossBar.h - P.bossName.y + 4);
    live.length = 0;
    for (let k = 0; k < a; k++) live.push(avoid[k]);
    const m = placeArrows(targets, n, cam, VIEW_W, VIEW_H, live, placed);
    const S = ARROW_SIZE;
    for (let k = 0; k < m; k++) {
      const o = placed[k], look = ARROW_LOOK[o.kind];
      if (!look) continue;
      const col = SIGN[look.color] ?? SIGN.lamp, x = Math.round(o.x), y = Math.round(o.y);
      const ca = Math.cos(o.angle), sa = Math.sin(o.angle);
      // The pointer: a small solid triangle beyond the disc, toward the target.
      const bx = x + ca * (S.disc + 1), by = y + sa * (S.disc + 1), tx = x + ca * S.tip, ty = y + sa * S.tip;
      signG.poly([tx, ty, bx - sa * 3, by + ca * 3, bx + sa * 3, by - ca * 3]).fill({ color: col }).stroke({ width: 1, color: COL.frame, alpha: 0.9 });
      signG.circle(x, y, S.disc).fill({ color: COL.frame, alpha: 0.85 }).stroke({ width: 1, color: col });
      mark(look.mark, x, y, col);
    }
  }

  return {
    root,
    model,
    attach() { renderer.hud.addChild(root); },
    detach() { if (root.parent) root.parent.removeChild(root); minimap.detach(); mapWorld = null; },
    /**
     * Show short lines, ms each, one after another. Lines that come while one shows wait their
     * turn (a lamp lit, then the run's first Sea Glass); at most NOTICE_QUEUE wait, and past that
     * the oldest waiting go, so a busy moment runs at most a few lines late. `quiet`: a line that
     * asks nothing of the player (a level's gift, a first sighting, the Ferryman's new stock) goes
     * on its own line in the lower third (HUD_LAYOUT.quietY), with its own queue; the middle line
     * is for what does.
     */
    notice(lines, ms, nowMs, { quiet: low = false } = {}) {
      pushNotice(low ? calm : loud, lines, ms, nowMs);
    },
    /**
     * Draw the HUD for this frame. flash: { hurt, level } strengths from the run view. covered:
     * a menu is over the run (a level-up, a chest, the pause menu): both notice lines hide and
     * their clocks hold until it closes.
     */
    draw(world, nowMs, flash, covered = false) {
      const m = updateHudModel(model, world);
      // Texts first (their widths decide where things go), then place everything (hudmodel.js).
      hp.set(m.hpText); level.set(m.levelText); timer.set(m.timerText); kills.set(m.killsText); glass.set(m.glassText);
      if (m.boss.shown) boss.set(m.boss.name);
      if (m.overtime.shown) overtime.set(m.overtime.text);
      widths.hp = hp.width; widths.level = level.width; widths.timer = timer.width; widths.kills = kills.width; widths.glass = m.glassShown ? glass.width : 0;
      const said = noticeNow(loud, nowMs, covered), aside = noticeNow(calm, nowMs, covered);
      if (said !== null) { const w = wrap(wrapped.notice, said); notice.set(w.a); notice2.set(w.b); }
      if (aside !== null) { const w = wrap(wrapped.quiet, aside); quiet.set(w.a); quiet2.set(w.b); }
      const ns = noticeScale();
      widths.boss = boss.width; widths.overtime = overtime.width; widths.notice = notice.width * ns; widths.quiet = quiet.width * ns;
      const P = placeHud(places, widths, m.boss.shown);
      g.clear(); pipsG.clear();
      if (root.children.at(-1) !== pipsG) root.addChild(pipsG);   // icons made since go under it
      bar(P.xp.x, P.xp.y, P.xp.w, P.xp.h, m.xpFrac, COL.xp, COL.back2);
      bar(P.hp.x, P.hp.y, P.hp.w, P.hp.h, m.hpFrac, COL.hp);
      if (m.shieldFrac > 0) g.rect(P.hp.x, P.hp.y, Math.max(1, Math.round(P.hp.w * m.shieldFrac)), 2).fill({ color: COL.shield });
      // The dash: one segment a charge (the Dash slot's item, ruling 16); the one recharging fills.
      if (m.dashMax > 1) {
        const n = m.dashMax, gap = 2, sw = Math.floor((P.dash.w - gap * (n - 1)) / n);
        for (let c = 0; c < n; c++) {
          const f = c < m.dashCharges ? 1 : c === m.dashCharges ? m.dashFrac : 0;
          bar(P.dash.x + c * (sw + gap), P.dash.y, sw, P.dash.h, f, c < m.dashCharges ? COL.dashReady : COL.dashWait);
        }
      } else bar(P.dash.x, P.dash.y, P.dash.w, P.dash.h, m.dashFrac, m.dashReady ? COL.dashReady : COL.dashWait);
      hp.view.position.set(P.hpText.x, P.hpText.y);
      level.view.position.set(P.levelText.x, P.levelText.y);
      timer.view.position.set(P.timerText.x, P.timerText.y);
      kills.view.position.set(P.killsText.x, P.killsText.y);
      glass.view.visible = m.glassShown;
      glass.view.position.set(P.glassText.x, P.glassText.y);
      let k = iconRow(m.weapons, m.weaponCount, L.icons.weaponsY, 0);
      k = iconRow(m.passives, m.passiveCount, L.icons.passivesY, k);
      for (let j = k; j < icons.length; j++) { icons[j].visible = false; iconLv[j].view.visible = false; }
      // The minimap (its setting, read live). Materials found are on the pause menu, not here.
      if (mapWorld !== world) { minimap.attach(world); mapWorld = world; }
      const mapBox = minimapBox(hudSettings.minimap, hudSettings.minimapSize);
      minimap.draw(mapBox, hudSettings.minimap, renderer.camera, nowMs);
      boss.view.visible = m.boss.shown;
      boss2.view.visible = m.bossCount > 1;
      if (m.bossCount > 1) {
        // Two bosses (the Long Night, C3): two bars side by side in the one bar's place, each named over it.
        const gap = L.bossPair.gap, half = Math.floor((P.bossBar.w - gap) / 2);
        boss2.set(m.boss2.name);
        bossBar(m.boss, P.bossBar.x, half, P.bossBar.y, P.bossBar.h, nowMs);
        bossBar(m.boss2, P.bossBar.x + half + gap, half, P.bossBar.y, P.bossBar.h, nowMs);
        boss.view.position.set(Math.round(P.bossBar.x + half / 2 - boss.width / 2), P.bossName.y);
        boss2.view.position.set(Math.round(P.bossBar.x + half + gap + half / 2 - boss2.width / 2), P.bossName.y);
      } else if (m.boss.shown) {
        bossBar(m.boss, P.bossBar.x, P.bossBar.w, P.bossBar.y, P.bossBar.h, nowMs);
        boss.view.position.set(P.bossName.x, P.bossName.y);
      }
      drawTrade(m.trade, nowMs);
      // A champion (W3's contract §5): its name and a short bar, under the boss's line or in its place.
      champ.view.visible = m.champion.shown;
      if (m.champion.shown) {
        champ.set(m.champion.name);
        const cy = m.boss.shown ? P.bossBar.y + L.champion.belowBoss : L.bossNameY;
        const cx = Math.round(VIEW_W / 2 - L.champion.w / 2);
        champ.view.position.set(Math.round(VIEW_W / 2 - champ.width / 2), cy);
        bar(cx, cy + L.champion.barDy, L.champion.w, 2, m.champion.frac, COL.boss);
      }
      overtime.view.visible = m.overtime.shown;
      if (m.overtime.shown) overtime.view.position.set(P.overtime.x, P.overtime.y);
      notice.view.visible = said !== null;
      notice2.view.visible = said !== null && wrapped.notice.b !== '';
      for (const t of [notice, notice2, quiet, quiet2]) t.view.scale.set(ns);
      // Two lines at twice the size climb from the quiet line's place, so they stay on the screen.
      const qy = ns > 1 ? P.quiet.y - NOTICE_LINE_H * (ns - 1) * (wrapped.quiet.b ? 2 : 1) : P.quiet.y;
      if (notice.view.visible) notice.view.position.set(P.notice.x, P.notice.y);
      if (notice2.view.visible) notice2.view.position.set(Math.round(P.notice.x + P.notice.w / 2 - (notice2.width * ns) / 2), P.notice.y + NOTICE_LINE_H * ns);
      quiet.view.visible = aside !== null;
      quiet2.view.visible = aside !== null && wrapped.quiet.b !== '';
      if (quiet.view.visible) quiet.view.position.set(P.quiet.x, qy);
      if (quiet2.view.visible) quiet2.view.position.set(Math.round(P.quiet.x + P.quiet.w / 2 - (quiet2.width * ns) / 2), qy + NOTICE_LINE_H * ns);
      // The map's row (0.8.2): lamps lit and bells rung, under the minimap; the lamps glow while
      // Lantern Night is banked. Then the edge arrows.
      signG.clear();
      const rowTop = mapBox ? mapBox.y + mapBox.h + 2 + L.mapRow.gap : MINIMAP.top;
      lampsT.view.visible = bellsT.view.visible = m.rowShown;
      if (m.rowShown) {
        lampsT.set(m.lampsText, m.banked ? COL.notice : SIGN.lamp); bellsT.set(m.bellsText, SIGN.bell);
        placeMapRow(row, { lamps: lampsT.width, bells: m.bellsText ? bellsT.width : 0 }, rowTop);
        if (m.banked) {
          const pulse = 0.55 + 0.45 * Math.sin(nowMs / 260);
          signG.rect(row.x - 3, row.lampY - 2, L.mapRow.markW + L.mapRow.pad + lampsT.width + 5, FONT_H + 3).fill({ color: COL.frame, alpha: 0.7 }).stroke({ width: 1, color: COL.notice, alpha: pulse });
        }
        mark(m.banked ? MARK.LAMP_LIT : MARK.LAMP, row.lampMark, row.lampY + 5, m.banked ? COL.notice : SIGN.lamp);
        lampsT.view.position.set(row.lampText, row.lampY);
        if (m.bellsText) { mark(MARK.BELL, row.bellMark, row.bellY + 5, SIGN.bell); bellsT.view.position.set(row.bellText, row.bellY); }
      }
      drawArrows(world, mapBox, m.rowShown ? row : null, P, m.boss.shown);
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
