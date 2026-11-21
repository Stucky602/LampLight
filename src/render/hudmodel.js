// What the HUD shows, worked out from the world (pure; tested in Node). render/hud.js only lays
// it out. Strings are rebuilt only when the number behind them changes, and the lists reuse
// their entries, so a steady HUD makes no garbage frame to frame.

import { formatClock, formatCount } from './hudtext.js';
import { VIEW_W } from './layout.js';
import { FONT_H, textWidth } from './font.js';
import { weaponLook } from '../data/ascensions.js';
import { dashCooldown } from '../sim/dash.js';
import { trackState, purseNeed } from '../sim/trades.js';

/**
 * Where the HUD's pieces sit, in view pixels (the view is 640 x 360). render/hud.js draws from
 * these and placeHud; tests/view.test.js checks that nothing overlaps at the longest texts.
 */
export const HUD_LAYOUT = Object.freeze({
  edge: 6,                                   // margin from the screen's left and right sides
  xp: Object.freeze({ x: 1, y: 1, h: 3 }),   // the XP bar runs the full width, 1 px in
  hp: Object.freeze({ x: 6, y: 9, w: 96, h: 5 }),
  dash: Object.freeze({ x: 6, y: 16, w: 96, h: 1 }),
  lineY: 7,                                  // the top line of text: HP, level, timer, kills (its 12-row cell ends at 18, the outline at 19)
  lineGap: 8,                                // between the HP text and the level
  // Weapon and passive icons (C3: the signature first, framed, with a gap after it; a 2 px deed bar
  // under each icon that is counting toward its capstone, so the passives sit 2 px lower).
  icons: Object.freeze({ x: 6, step: 21, size: 18, weaponsY: 21, passivesY: 44, sigGap: 3, deedY: 40, deedH: 2 }),
  // The character's own meter (C3, ruling 14 D and E): under the passives, a label and a bar or
  // pips: King Tide's clock, the Punter's Momentum, the Lamplighter's oil and spare flames, the
  // Drowned Man's purse, the Bog Warden's thralls, the Harpooner's hook.
  trade: Object.freeze({ x: 6, y: 66, gap: 4, barW: 56, barH: 4, pip: 5, pipGap: 2 }),
  // Two bosses at once (the Long Night): two bars side by side in the one bar's place.
  bossPair: Object.freeze({ gap: 8 }),
  bossBar: Object.freeze({ w: 240, y: 35, h: 4 }),
  bossNameY: 21,                             // the 12-row cell (descenders) ends a pixel above the bar's frame
  overtimeY: 21,                             // ...or under the boss's bar while a boss is up
  overtimeBelowBossY: 42,
  // A champion's name and short bar (0.9.0): on the boss's line when no boss is up, else under its bar.
  champion: Object.freeze({ w: 120, barDy: FONT_H + 2, belowBoss: 8 }),
  noticeY: 96,
  // Notices that ask nothing of the player (a level's gift, a first sighting, the Ferryman's new
  // stock) sit on their own line in the lower third, under the fight, centered (0.7.3); the middle
  // line (noticeY) is for what does.
  quietY: 292,
  // The map's row (0.8.2, proposal 2.1): lamps lit and bells rung, under the minimap (or where the
  // minimap would be when it's off), right-aligned with it.
  mapRow: Object.freeze({ gap: 5, markW: 7, pad: 2, between: 6 }),
});

/** The widest a notice line runs before it wraps onto a second line under it, px (0.9.0). */
export const NOTICE_MAX_W = 560;
/** The second line of a wrapped notice sits this far under the first. */
export const NOTICE_LINE_H = FONT_H + 1;

/**
 * Split a notice too wide for one line: the index of the space it breaks at (the first line runs to
 * it, the second starts after it), or -1 when it fits. Breaks at the last space that keeps the first
 * line within maxW; one with no such space is left whole.
 */
export function noticeBreak(text, maxW = NOTICE_MAX_W) {
  if (textWidth(text) <= maxW) return -1;
  for (let i = text.length - 1; i > 0; i--) if (text[i] === ' ' && textWidth(text.slice(0, i)) <= maxW) return i;
  return -1;
}

/**
 * Where the map's row goes: right-aligned at the view's right margin, `top` px down (under the
 * minimap's frame, or the minimap's own top with it off). widths: { lamps, bells } (the texts). Its
 * pieces (each mark, then its text) in `out` { x, y, w, h, lampMark, lampText, bellMark, bellText }.
 */
export function placeMapRow(out, widths, top, L = HUD_LAYOUT) {
  const R = L.mapRow;
  // Labeled ("Lamps 3/5", "Bells 1/2": RULING-L1), so the two sit one over the other, narrow enough to
  // stay clear of the notice line at every minimap size.
  const lampW = R.markW + R.pad + widths.lamps, bellW = widths.bells > 0 ? R.markW + R.pad + widths.bells : 0;
  const w = Math.max(lampW, bellW);
  const x = VIEW_W - L.edge - w;
  out.x = x; out.y = top; out.w = w; out.h = bellW ? FONT_H * 2 + 2 : FONT_H;
  out.lampY = top; out.bellY = top + FONT_H + 2;
  out.lampMark = x + Math.floor(R.markW / 2); out.lampText = x + R.markW + R.pad;
  out.bellMark = out.lampMark; out.bellText = out.lampText;
  return out;
}

const box = () => ({ x: 0, y: 0, w: 0, h: 0 });

/** The HUD's placed boxes, made once and rewritten by placeHud every frame (no garbage). */
export function createHudPlaces() {
  return {
    xp: box(), hp: box(), dash: box(), bossBar: box(),            // bars (inside their 1 px frame)
    hpText: box(), levelText: box(), timerText: box(), killsText: box(), glassText: box(), // texts (inside their outline)
    bossName: box(), overtime: box(), notice: box(), quiet: box(),
  };
}

function set(b, x, y, w, h) { b.x = x; b.y = y; b.w = w; b.h = h; }

/**
 * Place the HUD's bars and texts for this frame. `widths` holds each text's width in pixels
 * (hp, level, timer, kills, glass, boss, overtime, notice, quiet); `bossShown` moves the overtime line under
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
  // Pearls, to the left of the kills (a run's own money: it shows once there's any to spend).
  set(P.glassText, P.killsText.x - L.lineGap - (W.glass ?? 0), y, W.glass ?? 0, FONT_H);
  set(P.bossBar, VIEW_W / 2 - L.bossBar.w / 2, L.bossBar.y, L.bossBar.w, L.bossBar.h);
  set(P.bossName, Math.round(VIEW_W / 2 - W.boss / 2), L.bossNameY, W.boss, FONT_H);
  set(P.overtime, Math.round(VIEW_W / 2 - W.overtime / 2), bossShown ? L.overtimeBelowBossY : L.overtimeY, W.overtime, FONT_H);
  set(P.notice, Math.round(VIEW_W / 2 - W.notice / 2), L.noticeY, W.notice, FONT_H);
  set(P.quiet, Math.round(VIEW_W / 2 - (W.quiet ?? 0) / 2), L.quietY, W.quiet ?? 0, FONT_H);
  return P;
}

/**
 * A notice line's queue (the middle line, and the quiet line in the lower third, each its own):
 * the line showing until `until`, and up to `max` waiting their turn, each shown after the one
 * before. Past `max` waiting, the oldest waiting go, so a busy moment runs at most a few lines
 * late. While a menu covers the screen (`covered`), the line hides and its clock holds, so a
 * notice that came just before a level-up is read whole after it.
 */
export function createNoticeQueue(max = 3) {
  return { text: '', until: 0, next: [], max, heldAt: -1 };
}

/** Lines to show for `ms` each, from `now` (ms), after any already showing or waiting. */
export function pushNotice(q, lines, ms, now) {
  const list = (Array.isArray(lines) ? lines : [lines]).filter(Boolean);
  if (!list.length) return;
  const waiting = q.heldAt >= 0 || now < q.until;
  for (const text of waiting ? list : list.slice(1)) q.next.push({ text, ms });
  if (!waiting) { q.text = list[0]; q.until = now + ms; }
  if (q.next.length > q.max) q.next.splice(0, q.next.length - q.max);
}

/** The line to show now, or null: the next waiting one takes over when the last runs out. */
export function noticeNow(q, now, covered = false) {
  if (covered) { if (q.heldAt < 0) q.heldAt = now; return null; }
  if (q.heldAt >= 0) { q.until += now - q.heldAt; q.heldAt = -1; }
  if (now >= q.until && q.next.length) { const n = q.next.shift(); q.text = n.text; q.until = now + n.ms; }
  return now < q.until ? q.text : null;
}

const NO_NOTCHES = Object.freeze([]);

function entry() { return { icon: '', level: 0, levelText: '', max: false, asc: 0, sig: false, deed: -1, deedDone: false, _lv: -1, _def: null, _shut: false }; }

function bossEntry() { return { shown: false, name: '', frac: 0, notches: NO_NOTCHES, held: false, weak: false }; }

/** Is this weapon's capstone axis shut for the run (its line's unlock the profile lacks)? As sim/ascend.js capstoneShut. */
function capstoneShut(world, def) {
  const line = world.ascensionLines?.get(def.id), open = world.config?.forms;
  if (!line || !line.capstoneUnlock || !Array.isArray(open)) return false;
  const first = line.options.find((o) => o.capstone);
  return !!first && !open.includes(first.id);
}

export function createHudModel() {
  return {
    xpFrac: 0, hpFrac: 0, shieldFrac: 0, dashFrac: 1, dashReady: true,
    hpText: '', levelText: '', timerText: '', killsText: '',
    glassShown: false, glassText: '',
    // The map's row (0.8.2): lamps lit of all, bells rung of all, and whether Lantern Night is banked.
    rowShown: false, lampsText: '', bellsText: '', banked: false,
    weapons: [], weaponCount: 0,
    passives: [], passiveCount: 0,
    // The boss's bar: its phase notches (shares of its health, highest first; W3's phase gates),
    // whether a gate holds it now, and whether it's in a weak window. `boss2`: a second boss up at
    // the same time (the Long Night brings two): both bars side by side (C3).
    boss: bossEntry(), boss2: bossEntry(), bossCount: 0,
    // The Dash slot's charges (ruling 16): held now, the most, and the next one's recharge.
    dashCharges: 1, dashMax: 1,
    // The character's meter (C3): kind 'tide' | 'momentum' | 'oil' | 'purse' | 'thralls' | 'hook' | ''.
    trade: { kind: '', label: '', frac: 0, mark: -1, steps: 0, step: 0, pips: 0, pipsMax: 0, text: '', hot: false, _text: '' },
    // A champion on screen (W3's contract §5): a small bar with its name under the boss's line.
    champion: { shown: false, name: '', frac: 0 },
    overtime: { shown: false, text: '' },
    // Last numbers behind the strings.
    _hp: -1, _maxHp: -1, _level: -1, _secs: -1, _kills: -1, _ot: -1, _glass: -1, _row: -1,
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
 * The character's meter (C3), from the trade's own state (sim/trades.js world.trade.s, C2-DESIGN
 * section 0's HUD reads). Pure. Strings change only when their number does.
 *   tide      King Tide's clock: frac of the wait gone, a mark at the ebb (the half), hot in the last
 *             seconds before a beat (when a crowd of 12 calls it)
 *   momentum  the Punter's four steps
 *   oil       the Lamplighter's oil (three steps) and her spare flames (pips)
 *   purse     the Drowned Man's grave pennies toward a marked crate; hot while a crate is marked
 *   thralls   the Bog Warden's dead standing
 *   hook      the Harpooner's trade hook, filling to its next throw
 */
export function updateTrade(t, world) {
  const tr = world.trade, ch = world.character?.id;
  t.kind = ''; t.mark = -1; t.steps = 0; t.pips = 0; t.pipsMax = 0; t.hot = false; t.nextFrac = -1;
  if (!tr) return t;
  const s = tr.s;
  let text = '';
  if (ch === 'tide_priest' && s.tideEvery > 0) {
    t.kind = 'tide'; t.label = 'King Tide';
    t.frac = Math.min(1, Math.max(0, s.tideT / s.tideEvery)); t.mark = 0.5;
    const call = Math.min(world.character.mechanic?.params?.call ?? 5, s.tideEvery * 0.25) / s.tideEvery;
    t.hot = (t.frac < 0.5 && 0.5 - t.frac <= call) || (t.frac >= 0.5 && 1 - t.frac <= call);
  } else if (ch === 'punter') {
    t.kind = 'momentum'; t.label = 'Momentum'; t.steps = world.character.mechanic?.params?.steps ?? 4; t.step = s.mo ?? 0; t.hot = t.step >= t.steps;
  } else if (ch === 'lamplighter') {
    t.kind = 'oil'; t.label = 'Fuel'; t.steps = 3; t.step = s.oilStep ?? 3; t.pips = s.flames ?? 0; t.pipsMax = world.character.mechanic?.params?.flames ?? 3;
  } else if (ch === 'drowned_man') {
    const need = purseNeed(world);
    t.kind = 'purse'; t.label = 'Purse'; t.frac = need > 0 ? Math.min(1, (s.purse ?? 0) / need) : 0; t.hot = s.markOn === 1;
    text = s.markOn === 1 ? 'Crate marked' : `${Math.floor(s.purse ?? 0)}/${need}`;
  } else if (ch === 'bog_warden') {
    t.kind = 'thralls'; t.label = 'Thralls'; text = String(world.allies?.thralls ?? 0);
  } else if (ch === 'harpooner') {
    const sk = world.sk || {}, every = (sk.hand_line ? sk.hand_line.every : sk.gaff_hand ? sk.gaff_hand.every : tr.P.every ?? 6) * 60;
    t.kind = 'hook'; t.label = 'Hook';
    t.frac = every > 0 ? Math.min(1, Math.max(0, 1 - ((s.throwAt ?? 0) - world.tick) / every)) : 1; t.hot = t.frac >= 1;
  }
  // Ruling 18 KA (C2): the deeds toward the signature's next trade upgrade. C3 draws it as a thin bar
  // under the meter (the signature's own color, the deed bars' shape), so the row reads at a glance;
  // the stats screen says the count in words ("one from the trade (3/6 to the next)").
  const tk = trackState(world);
  t.nextFrac = t.kind !== '' && tk && tk.need > 1 ? Math.min(1, Math.max(0, tk.have / tk.need)) : -1;
  if (text !== t._text) { t._text = text; t.text = text; }
  return t;
}

/**
 * Where the character's meter goes: its label at (x, y), then the bar or the pips after it, then
 * its text. widths: { label, text } (px). Writes { x, y, w, h, barX, barW, pipX, textX } into out.
 */
export function placeTrade(out, t, widths, L = HUD_LAYOUT) {
  const R = L.trade;
  out.x = R.x; out.y = R.y; out.h = FONT_H;
  let x = R.x + widths.label + R.gap;
  out.barX = x; out.barW = 0;
  if (t.kind === 'tide' || t.kind === 'purse' || t.kind === 'hook') { out.barW = R.barW; x += R.barW + R.gap; }
  else if (t.kind === 'momentum' || t.kind === 'oil') { out.barW = t.steps * 8 + (t.steps - 1) * 2; x += out.barW + R.gap; }
  out.pipX = x;
  if (t.pipsMax > 0) x += widths.flames + R.gap + t.pipsMax * (R.pip + R.pipGap) + R.gap;
  out.textX = x;
  out.w = x + (widths.text || 0) - R.x;
  return out;
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
  // The dash: the Dash slot's item (ruling 16) sets its charges and recharge; without one, the old single dash.
  const dashMax = world.dash ? dashCooldown(world) : world.tuning.player.dash.cooldown * st.dashCooldown;
  m.dashMax = world.dash ? world.dash.stats.charges : 1;
  m.dashCharges = world.dash ? Math.max(0, Math.min(m.dashMax, p.dashCharges)) : (p.dashCd <= 0 ? 1 : 0);
  m.dashReady = world.dash ? p.dashCharges > 0 : p.dashCd <= 0;
  m.dashFrac = m.dashCharges >= m.dashMax ? 1 : dashMax > 0 ? Math.min(1, Math.max(0, 1 - p.dashCd / dashMax)) : 1;
  if (p.level !== m._level) { m._level = p.level; m.levelText = `Lv ${p.level}`; }
  const secs = Math.floor((world.over ? world.over.tick : world.tick) / 60);
  if (secs !== m._secs) { m._secs = secs; m.timerText = formatClock(secs); }
  const kills = world.result.totalKills;
  if (kills !== m._kills) { m._kills = kills; m.killsText = `${formatCount(kills)} ${kills === 1 ? 'kill' : 'kills'}`; }
  const glass = world.glass ?? 0;
  // Pearls (0.8.2: Sea Glass by its new name; ids keep "glass"): only in a run with the Ferryman.
  m.glassShown = glass > 0 || !!world.ferry;
  if (glass !== m._glass) { m._glass = glass; m.glassText = `${formatCount(glass)} ${glass === 1 ? 'Pearl' : 'Pearls'}`; }

  // The map's row: lamps lit now of all, bells rung of all (0.8.2). The lamps glow while Lantern
  // Night is banked (idea 4).
  let lit = 0, lamps = 0, rung = 0, bells = 0;
  for (const t of world.tasks || []) {
    if (t.kind === 1) { lamps++; if (t.state === 2) lit++; } else if (t.kind === 2) { bells++; if (t.state === 2) rung++; }   // (a crane or cairn: neither)
  }
  m.rowShown = lamps + bells > 0;
  const rowKey = ((lit * 64 + lamps) * 64 + rung) * 64 + bells;
  if (rowKey !== m._row) { m._row = rowKey; m.lampsText = `Lamps ${lit}/${lamps}`; m.bellsText = bells ? `Bells ${rung}/${bells}` : ''; }   // (RULING-L1: labeled, not bare numbers)
  m.banked = world.night?.banked === true;

  // Weapons in slot order, then passives.
  let n = 0;
  for (let s = 0; s < world.build.weaponSlots; s++) if (world.slots[s] && world.slots[s].def) n++;
  let s = 0;
  const track = world.trade ? trackState(world) : null;
  fillList(m.weapons, n, (k, e) => {
    while (!(world.slots[s] && world.slots[s].def)) s++;
    const slot = world.slots[s++];
    e.level = slot.level; e.max = false;   // a weapon never tops out (ruling 10, W1b)
    const asc = slot.ascensions ? slot.ascensions.length : 0;   // ascensions: pips on the icon
    // Its icon: the capstone's once taken (W1's contract §3), worked out only when it changes.
    if (e._def !== slot.def || e.asc !== asc || !e.icon) { e._def = slot.def; e.icon = weaponLook(slot.def, slot.ascensions || []).icon; e._shut = capstoneShut(world, slot.def); }
    e.asc = asc;
    // The character's own weapon (C3): marked, and its deed is the character's (the track's).
    e.sig = !!slot.def.signature;
    // The capstone's deed (ruling 14 C8): a bar under the icon while it counts; full and lit once
    // done and the choice waits; gone once a capstone is taken, or when the run can't open it.
    const capHeld = (slot.ascensions || []).some((a) => a.capstone);
    let have = 0, need = 0, done = false;
    if (e.sig && track && track.deed.need > 0) { have = track.deed.have; need = track.deed.need; done = track.deed.done; }
    else if (!e.sig && slot.def.deed && !e._shut) { need = slot.def.deed.count; have = slot.deed ?? 0; done = (slot.axes & 4) !== 0 || have >= need; }
    e.deed = capHeld || need <= 0 ? -1 : Math.min(1, have / need);
    e.deedDone = e.deed >= 0 && done;
  });
  m.weaponCount = n;
  const ps = world.build.passives;
  fillList(m.passives, ps.length, (k, e) => { e.icon = ps[k].def.icon; e.level = ps[k].level; e.max = ps[k].level >= ps[k].def.maxLevel; });
  m.passiveCount = ps.length;

  // The first two living bosses (the Long Night brings two at once: C3).
  m.boss.shown = false; m.boss2.shown = false; m.bossCount = 0;
  for (const b of world.bosses) {
    if (!b.alive) continue;
    const e = world.enemies.resolve(b.handle);
    if (e < 0) continue;
    const o = m.bossCount === 0 ? m.boss : m.boss2;
    o.shown = true;
    o.name = world.enemyDefs[b.type].name;
    o.frac = Math.min(1, Math.max(0, world.enemies.hp[e] / world.enemies.maxHp[e]));
    o.notches = b.notches ?? NO_NOTCHES;
    o.held = b.held === true;
    o.weak = world.tick >= (b.weakFrom ?? -1) && world.tick < (b.weakUntil ?? -1);
    if (++m.bossCount === 2) break;
  }
  updateTrade(m.trade, world);
  // The first champion alive (a muster's captain with a name and one warned attack).
  m.champion.shown = false;
  for (const c of world.champions || []) {
    if (c.state !== 1) continue;
    const e = world.enemies.resolve(c.handle);
    if (e < 0) continue;
    m.champion.shown = true;
    m.champion.name = c.name;
    m.champion.frac = Math.min(1, Math.max(0, world.enemies.hp[e] / world.enemies.maxHp[e]));
    break;
  }
  const d = world.director;
  m.overtime.shown = d.overtime === true;
  if (d.overtimeMinutes !== m._ot) { m._ot = d.overtimeMinutes; m.overtime.text = `Overtime: minute ${d.overtimeMinutes}`; }
  return m;
}
