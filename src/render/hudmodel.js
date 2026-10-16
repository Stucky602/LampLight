// What the HUD shows, worked out from the world (pure; tested in Node). render/hud.js only lays
// it out. Strings are rebuilt only when the number behind them changes, and the lists reuse
// their entries, so a steady HUD makes no garbage frame to frame.

import { formatClock, formatCount } from './hudtext.js';
import { VIEW_W } from './layout.js';
import { FONT_H } from './font.js';

/**
 * Where the HUD's pieces sit, in view pixels (the view is 640 x 360). render/hud.js draws from
 * these and placeHud; tests/view.test.js checks that nothing overlaps at the longest texts.
 */
export const HUD_LAYOUT = Object.freeze({
  edge: 6,                                   // margin from the screen's left and right sides
  xp: Object.freeze({ x: 1, y: 1, h: 3 }),   // the XP bar runs the full width, 1 px in
  hp: Object.freeze({ x: 6, y: 9, w: 96, h: 5 }),
  dash: Object.freeze({ x: 6, y: 16, w: 96, h: 1 }),
  lineY: 8,                                  // the top line of text: HP, level, timer, kills
  lineGap: 8,                                // between the HP text and the level
  icons: Object.freeze({ x: 6, step: 21, size: 18, weaponsY: 21, passivesY: 42 }),
  bossBar: Object.freeze({ w: 240, y: 30, h: 4 }),
  bossNameY: 20,
  overtimeY: 20,                             // ...or under the boss's bar while a boss is up
  overtimeBelowBossY: 38,
  noticeY: 96,
  // Materials: rows 17 px apart (the tallest material icon is 16), kept 10 px clear of the
  // right end of the boss's bar.
  materials: Object.freeze({ top: 19, rowH: 17, clear: 10 }),
});

/** layoutMaterials's settings, from the layout above. */
export const MATERIALS_LAYOUT = Object.freeze({
  rightX: VIEW_W - HUD_LAYOUT.edge,
  minX: VIEW_W / 2 + HUD_LAYOUT.bossBar.w / 2 + HUD_LAYOUT.materials.clear,
  top: HUD_LAYOUT.materials.top,
  rowH: HUD_LAYOUT.materials.rowH,
});

const box = () => ({ x: 0, y: 0, w: 0, h: 0 });

/** The HUD's placed boxes, made once and rewritten by placeHud every frame (no garbage). */
export function createHudPlaces() {
  return {
    xp: box(), hp: box(), dash: box(), bossBar: box(),            // bars (inside their 1 px frame)
    hpText: box(), levelText: box(), timerText: box(), killsText: box(), // texts (inside their outline)
    bossName: box(), overtime: box(), notice: box(),
  };
}

function set(b, x, y, w, h) { b.x = x; b.y = y; b.w = w; b.h = h; }

/**
 * Place the HUD's bars and texts for this frame. `widths` holds each text's width in pixels
 * (hp, level, timer, kills, boss, overtime, notice); `bossShown` moves the overtime line under
 * the boss's bar. A text's box is where its glyphs start, without the 1 px outline; a bar's is
 * inside its 1 px frame.
 */
export function placeHud(places, widths, bossShown, L = HUD_LAYOUT) {
  const P = places, W = widths, y = L.lineY;
  set(P.xp, L.xp.x, L.xp.y, VIEW_W - 2 * L.xp.x, L.xp.h);
  set(P.hp, L.hp.x, L.hp.y, L.hp.w, L.hp.h);
  set(P.dash, L.dash.x, L.dash.y, L.dash.w, L.dash.h);
  const hpX = L.hp.x + L.hp.w + 4;
  set(P.hpText, hpX, y, W.hp, FONT_H);
  set(P.levelText, hpX + W.hp + L.lineGap, y, W.level, FONT_H);
  set(P.timerText, Math.round(VIEW_W / 2 - W.timer / 2), y, W.timer, FONT_H);
  set(P.killsText, VIEW_W - L.edge - W.kills, y, W.kills, FONT_H);
  set(P.bossBar, VIEW_W / 2 - L.bossBar.w / 2, L.bossBar.y, L.bossBar.w, L.bossBar.h);
  set(P.bossName, Math.round(VIEW_W / 2 - W.boss / 2), L.bossNameY, W.boss, FONT_H);
  set(P.overtime, Math.round(VIEW_W / 2 - W.overtime / 2), bossShown ? L.overtimeBelowBossY : L.overtimeY, W.overtime, FONT_H);
  set(P.notice, Math.round(VIEW_W / 2 - W.notice / 2), L.noticeY, W.notice, FONT_H);
  return P;
}

function entry() { return { icon: '', level: 0, levelText: '', max: false, asc: 0, _lv: -1 }; }

export function createHudModel() {
  return {
    xpFrac: 0, hpFrac: 0, shieldFrac: 0, dashFrac: 1, dashReady: true,
    hpText: '', levelText: '', timerText: '', killsText: '',
    weapons: [], weaponCount: 0,
    passives: [], passiveCount: 0,
    materials: [], materialCount: 0,       // { icon, count, text }
    boss: { shown: false, name: '', frac: 0 },
    overtime: { shown: false, text: '' },
    // Last numbers behind the strings.
    _hp: -1, _maxHp: -1, _level: -1, _secs: -1, _kills: -1, _ot: -1,
  };
}

function fillList(list, n, get) {
  while (list.length < n) list.push(entry());
  for (let k = 0; k < n; k++) {
    const e = list[k];
    get(k, e);
    if (e._lv !== e.level) { e._lv = e.level; e.levelText = e.level > 1 ? String(e.level) : ''; }
  }
}

/**
 * Lay out the materials found, right to left from `rightX`, each a count with its icon to the
 * left; a row that would reach past `minX` wraps to a new row below, so the list never runs into
 * the boss's bar in the middle of the screen. `items[k]` has iconW, iconH, textW; this writes
 * ix, iy (the icon's top left) and tx, ty (the count's). Returns the number of rows.
 */
export function layoutMaterials(items, count, { rightX, minX, top, rowH }) {
  let x = rightX, row = 0;
  for (let k = 0; k < count; k++) {
    const it = items[k];
    const need = it.textW + 1 + it.iconW;
    if (x - need < minX && x !== rightX) { row++; x = rightX; }
    const y = top + row * rowH;
    x -= it.textW;
    it.tx = x; it.ty = y + 3;
    x -= it.iconW + 1;
    it.ix = x; it.iy = y + 6 - Math.floor(it.iconH / 2);   // icons differ in size: centered on the count
    x -= 6;
  }
  return count > 0 ? row + 1 : 0;
}

/** Bring the model up to date with the world. Returns the model. */
export function updateHudModel(m, world) {
  const p = world.player, st = world.stats;
  const maxHp = st.maxHp > 0 ? st.maxHp : 1;
  m.xpFrac = p.xpNext > 0 ? Math.min(1, Math.max(0, p.xp / p.xpNext)) : 0;
  m.hpFrac = Math.min(1, Math.max(0, p.hp / maxHp));
  m.shieldFrac = Math.min(1, Math.max(0, p.shield / maxHp));
  const hp = Math.ceil(Math.max(0, p.hp)), mh = Math.round(maxHp);
  if (hp !== m._hp || mh !== m._maxHp) { m._hp = hp; m._maxHp = mh; m.hpText = `${hp}/${mh}`; }
  const dashMax = world.tuning.player.dash.cooldown * st.dashCooldown;
  m.dashReady = p.dashCd <= 0;
  m.dashFrac = dashMax > 0 ? Math.min(1, Math.max(0, 1 - p.dashCd / dashMax)) : 1;
  if (p.level !== m._level) { m._level = p.level; m.levelText = `LV ${p.level}`; }
  const secs = Math.floor((world.over ? world.over.tick : world.tick) / 60);
  if (secs !== m._secs) { m._secs = secs; m.timerText = formatClock(secs); }
  const kills = world.result.totalKills;
  if (kills !== m._kills) { m._kills = kills; m.killsText = `${formatCount(kills)} KILLS`; }

  // Weapons in slot order, then passives.
  let n = 0;
  for (let s = 0; s < world.build.weaponSlots; s++) if (world.slots[s] && world.slots[s].def) n++;
  let s = 0;
  fillList(m.weapons, n, (k, e) => {
    while (!(world.slots[s] && world.slots[s].def)) s++;
    const slot = world.slots[s++];
    e.icon = slot.def.icon; e.level = slot.level; e.max = slot.level >= slot.def.maxLevel;
    e.asc = slot.ascensions ? slot.ascensions.length : 0;   // ascensions: pips on the icon
  });
  m.weaponCount = n;
  const ps = world.build.passives;
  fillList(m.passives, ps.length, (k, e) => { e.icon = ps[k].def.icon; e.level = ps[k].level; e.max = ps[k].level >= ps[k].def.maxLevel; });
  m.passiveCount = ps.length;

  // Materials found this run, in data order, only the ones with at least 1.
  const raw = world.result.materialsRaw;
  let mc = 0;
  for (let i = 0; i < raw.length; i++) {
    const c = Math.floor(raw[i] + 1e-9);
    if (c <= 0) continue;
    let e = m.materials[mc];
    if (!e) { e = { icon: '', count: -1, text: '' }; m.materials.push(e); }
    e.icon = world.materialDefs[i].icon;
    if (e.count !== c) { e.count = c; e.text = String(c); }
    mc++;
  }
  m.materialCount = mc;

  // The first living boss.
  m.boss.shown = false;
  for (const b of world.bosses) {
    if (!b.alive) continue;
    const e = world.enemies.resolve(b.handle);
    if (e < 0) continue;
    m.boss.shown = true;
    m.boss.name = world.enemyDefs[b.type].name;
    m.boss.frac = Math.min(1, Math.max(0, world.enemies.hp[e] / world.enemies.maxHp[e]));
    break;
  }
  const d = world.director;
  m.overtime.shown = d.overtime === true;
  if (d.overtimeMinutes !== m._ot) { m._ot = d.overtimeMinutes; m.overtime.text = `OVERTIME ${d.overtimeMinutes} MIN`; }
  return m;
}
