// tools/balance/run-cw2.mjs: copied from work/cw/C2/tools/run-cw2.mjs (X6, Nov 20) so the balance benches and their test
// fixtures can be rebuilt from the repo. Run from the repo root (docs/HANDOFF.md has the commands).
// CW2 round 2: one character run, measured. Built from CW2-r1 chars.mjs, C1's clears.mjs, and C2's share.mjs (cost-off switches).
// node run.mjs --chars a,b --maps drowned_docks,salt_marsh --tide 0|5 --seeds 3 [--from 0] [--pick careful|random|plain]
//   [--off 1] [--skills id,id] [--god 1] [--mins 23] [--stand 1] --out file.jsonl
// Reads the tree it sits in, or TREE=<a snapshot>.
import { appendFileSync } from 'node:fs';
const R = process.env.TREE || new URL('../..', import.meta.url).pathname.replace(/\/$/, '');   // (the repo this file is in; TREE=<a snapshot> benches that one)
const { DATA } = await import(`${R}/src/data/index.js`);
const { createWorld, stepWorld, decide, currentHalt } = await import(`${R}/src/sim/world.js`);
const { createKiteBot } = await import(`${R}/src/sim/bot.js`);
const { measureConfig } = await import(`${R}/tools/pacing/measure.mjs`);
const { buildRunResult } = await import(`${R}/src/sim/run-result.js`);
const PL = await import(`${R}/src/sim/player.js`);
const { EV } = await import(`${R}/src/sim/events.js`);
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const tide = +arg('tide', 0), seeds = +arg('seeds', 3), from = +arg('from', 0), pick = arg('pick', 'careful'), mins = +arg('mins', 23);
const god = arg('god', '0') === '1', off = arg('off', '0') === '1', out = arg('out', 'runs.jsonl');
const maps = arg('maps', 'drowned_docks').split(',');
const chars = arg('chars', DATA.characters.map((c) => c.id).join(',')).split(',');
const skillIds = arg('skills', '').split(',').filter(Boolean);
const T = tide > 0 ? DATA.tides[tide - 1] : null;
const changing = (c) => (c.kind === 'weapon' && (c.isNew || c.up === 'line' || c.up === 'special' || !!c.opens)) || (c.kind === 'passive' && (c.isNew || c.keystone)) || (c.kind === 'dash' && c.isNew);
let lcg = 1;
const rnd = () => { lcg = (lcg * 1103515245 + 12345) % 2147483648; return lcg / 2147483648; };
for (const map of maps) for (const ch of chars) for (let k = from; k < from + seeds; k++) {
  const stage = +arg('stage', tide > 0 ? 3 : (map === 'salt_marsh' ? 1 : 0));
  const cfg = { ...measureConfig(k, god, map, stage), character: ch, tide };
  delete cfg.startWeapon;
  if (T) { cfg.hpMul = (cfg.hpMul ?? 1) * T.hpMul; cfg.densityMul = (cfg.densityMul ?? 1) * T.densityMul; cfg.enemyDamageMul = (cfg.enemyDamageMul ?? 1) * T.damageMul; cfg.enemySpeedMul = (cfg.enemySpeedMul ?? 1) * T.speedMul; }
  const who = DATA.characters.find((c) => c.id === ch);
  if (who.noHeal && !(off && arg('offfood', '') === '1')) cfg.noHeal = true;   // (--offfood 1: the cost off from the start, food and heal relics too)
  const sk = {};
  for (const id of skillIds) { const s = DATA.skills.find((x) => x.id === id); if (s && s.character === ch) sk[id] = s.p; }
  if (Object.keys(sk).length) cfg.skills = sk;
  if (off && ch === 'drowned_man') cfg.mods = [...(cfg.mods || []), { stat: 'maxHp', op: 'add', value: 15 }, { stat: 'moveSpeed', op: 'more', value: 1 / 0.85 - 1 }];
  const w = createWorld(cfg, DATA);
  if (off) {   // C2's switches (work/cw/C2/tools/share.mjs), the cost taken away
    const e = w.hookEntries.find((x) => x.source === `character:${ch}`), P = e.params;
    if (ch === 'lamplighter') P.oilLow = 1;
    if (ch === 'harpooner') { w.knockbackPulls = false; P.pull = 0; P.crowdHurt = 0; }
    if (ch === 'punter') { P.empty = 0; P.hitSteps = 0; P.turnCos = -2; }
    if (ch === 'bog_warden') P.others = 0;
    if (ch === 'drowned_man') { P.short = 0; w.trade.P = { ...w.trade.P, seaEvery: 2, over: 1 }; }
    if (ch === 'tide_priest') { e.state.pass = 1; w.config.noHeal = false; }
    w.statsDirty = true;
  }
  const bot = createKiteBot({ archetype: ['projectile_storm', 'orbit_tank', 'burning_ground'][k % 3], follow: true, picker: pick === 'random' ? 'plain' : pick, option: arg('option', '0') === 'alt' ? 'alt' : +arg('option', '0') });
  const botB = arg('sigopt', '') ? createKiteBot({ archetype: ['projectile_storm', 'orbit_tank', 'burning_ground'][k % 3], follow: true, picker: pick === 'random' ? 'plain' : pick, option: +arg('sigopt', '1') }) : null;
  lcg = 7 + k * 7919 + ch.length * 104729 + map.length * 31;
  const hk = w.hookEntries.find((e) => e.source === `character:${ch}`);
  const stand = arg('stand', '1') === '1' && ch === 'lamplighter';
  let still = 0;
  const IDLE = { mx: 0, my: 0, buttons: 0 };
  const nm = (t) => (t >= 0 ? w.enemyDefs[t]?.id ?? t : 'none');
  const HK = ['', 'contact', 'shot', 'boss', 'strike', 'drain', 'hazard', 'attack'];
  const hurtBy = {}, permin = [], dlog = [];
  let drafts = 0, changed = 0, legOffers = 0, lineOffers = 0, plainOnly = 0, sigUps = 0, tradeUps = 0;
  const t0 = performance.now();
  w.eventsPerTick = true;
  while (!w.over && w.tick < mins * 3600) {
    let f = bot.input(w);
    if (stand && still === 0 && hk.state.flames > 0 && w.tick >= (hk.state.plantAt ?? 0) && w.tick % 30 === 0) {
      const near = w.enemyHash.query(w.player.x, w.player.y, 70, w.scratch.near, -1);
      if (near === 0) still = 70;
    }
    if (still > 0) { still--; f = IDLE; }
    stepWorld(w, f);
    const ev = w.events;
    for (let i = 0; i < ev.count; i++) {
      if (ev.type[i] === EV.PLAYER_HURT) { const key = `${HK[ev.c[i]] ?? ev.c[i]}:${nm(ev.d[i])}`; hurtBy[key] = (hurtBy[key] ?? 0) + ev.a[i]; }
      else if (ev.type[i] === EV.SIG_UP) { sigUps++; if (ev.b && ev.b[i] === 1) tradeUps++; }
    }
    for (let g = 0; currentHalt(w) && g < 100; g++) {
      const h = currentHalt(w);
      if (h.kind === 'draft') {
        drafts++; dlog.push([Math.floor(w.tick / 3600), h.offer.some(changing) ? 1 : 0, h.offer.map((c) => c.kind === 'weapon' ? (c.isNew ? 'new' : c.up) : c.kind + (c.isNew ? '+' : '')).join(',')]);
        if (h.offer.some(changing)) changed++; else plainOnly++;
        legOffers += h.offer.filter((c) => c.up === 'special').length;
        lineOffers += h.offer.filter((c) => c.up === 'line').length;
        if (pick === 'random') { decide(w, { kind: 'pick', index: Math.floor(rnd() * h.offer.length) }); continue; }
      }
      let dd = bot.decide(w, h);
      if (botB && dd.kind === 'ascend' && w.slots[dd.slot]?.def?.signature) { const db = botB.decide(w, h); if (db.kind === 'ascend' && db.slot === dd.slot) dd = db; }
      decide(w, dd);
    }
    if (w.tick % 3600 === 0) {
      const real = {};
      for (let s = 0; s < w.slots.length; s++) { const sl = w.slots[s]; if (sl && sl.def && w.result.realBySlot[s] > 0) real[sl.def.id] = Math.round(w.result.realBySlot[s]); }
      if (w.allies && w.allies.dealt > 0) real.thralls = Math.round(w.allies.dealt);
      permin.push({ kills: w.result.totalKills, lv: w.player.level, hp: Math.round(w.player.hp), real });
    }
  }
  const r = buildRunResult(w);
  const sigId = who.signature;
  const recap = r.end === 'died' && PL.hurtLogList ? PL.hurtLogList(w).slice(-6).map((h) => `${HK[h.kind] ?? h.kind}:${nm(h.type)}:${h.attack ?? ''}:${Math.round(h.damage)}`) : null;
  const row = { map, ch, k, tide, stage, pick, off, god, option: arg('option', '0'), skills: skillIds.join('+'), end: r.end, cleared: r.end === 'cleared', sec: Math.round(w.tick / 60), level: r.level, kills: r.totalKills,
    taken: r.damageTaken, hurtBy: Object.fromEntries(Object.entries(hurtBy).map(([a, b]) => [a, Math.round(b)])), recap, firstHit: r.untouchedSec,
    weapons: r.weapons.map((x) => ({ id: x.id, lv: x.level, real: x.real, dmg: x.damage, lines: x.lines, specials: x.specials, forms: x.forms })),
    passives: r.passives, thralls: r.thrallDamage, trade: r.trade, sig: sigId, slots: w.build.weaponSlots, dash: r.dash, bosses: r.bossesKilled.map((b) => `${b.id}@${b.time}`),
    drafts, dlog, changed, plainOnly, legOffers, lineOffers, sigUps, tradeUps, permin, ms: Math.round(performance.now() - t0) };
  appendFileSync(out, JSON.stringify(row) + '\n');
  console.log(`${map} t${tide} ${ch} k${k} ${pick}${off ? ' OFF' : ''}${row.skills ? ' ' + row.skills : ''} ${r.end} ${row.sec}s L${r.level} kills ${r.totalKills} ${row.ms}ms`);
}
