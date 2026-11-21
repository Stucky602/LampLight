// tools/balance/bench.mjs: copied from work/cw/C1/bench.mjs (X6, Nov 20) so the balance benches and their test
// fixtures can be rebuilt from the repo. Run from the repo root (docs/HANDOFF.md has the commands).
// C1's bench (CW2's B2 bench, adapted to ruling 14): one weapon alone at a fixed level, from 6:00 to
// 8:30 of a Docks run (a bot that can't die, every draft skipped, no passives), bare, then with each
// Form option alone, each Rare/Epic line alone, each Legendary special alone. Health removed a minute
// (no overkill) and kills. Usage: node bench.mjs [--list a,b] [--seeds 2] [--level 10] --out file.jsonl
import { appendFileSync } from 'node:fs';
const R = process.env.TREE || new URL('../..', import.meta.url).pathname.replace(/\/$/, '');   // (the repo this file is in; TREE=<a snapshot> benches that one)
const { DATA } = await import(`${R}/src/data/index.js`);
if (process.env.PATCH) new Function('DATA', process.env.PATCH)(DATA);   // (C1b: try a number without editing the tree)
const { createWorld, stepWorld, decide, currentHalt } = await import(`${R}/src/sim/world.js`);
const { createKiteBot } = await import(`${R}/src/sim/bot.js`);
const { EV } = await import(`${R}/src/sim/events.js`);
const { rollUpgrade, takeUpgrade } = await import(`${R}/src/sim/weaponups.js`);
const { takeOption } = await import(`${R}/src/sim/ascend.js`);
const { markStatsDirty, rebuildStats } = await import(`${R}/src/sim/build.js`);
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const seeds = +arg('seeds', 2), out = arg('out', 'bench.jsonl'), L = +arg('level', 10);
const all = DATA.weapons.filter((w) => !w.innate && !w.signature).map((w) => w.id);
const list = arg('list', all.join(',')).split(',');
const FROM = +arg('from', 360), SEC = +arg('sec', 150), MOVE = arg('move', 'kite'), MAP = arg('map', 'drowned_docks');
const PIECES = arg('pieces', null)?.split(',');
const TANK = arg('tank', '0') === '1';   // mortal with a huge health pool: counts damage taken (the ruler for control lines)
// --move plant: a player who stands and turns to fight: every 2.5s, a step of 0.3s toward the nearest enemy (setting the facing), then still.
// --move circle: walking a circle about 50px across every 4s (closes loops of its own glass).
function circleInput(w) {
  const a = (w.tick % 240) / 240 * 6.283185307179586;
  return { mx: Math.round(127 * Math.cos(a)), my: Math.round(127 * Math.sin(a)), buttons: 0 };
}
function plantInput(w) {
  const p = w.player, E = w.enemies, t = w.tick % 150;
  if (t >= 18) return { mx: 0, my: 0, buttons: 0 };
  let best = 1e18, bx = 0, by = 0;
  for (let e = 0; e < E.count; e++) { const dx = E.x[e] - p.x, dy = E.y[e] - p.y, d = dx * dx + dy * dy; if (d < best) { best = d; bx = dx; by = dy; } }
  const d = Math.sqrt(best) || 1;
  return { mx: Math.round(127 * bx / d), my: Math.round(127 * by / d), buttons: 0 };
}

function trial(id, { forms = [], lines = [], specials = [], seed }) {
  const data = { ...DATA, characters: [...DATA.characters, { id: 'trial', name: 'Trial', desc: 'A stand-in.', sprite: 'pc_lamplighter', start: id, innate: null, base: { maxHp: TANK ? 1e7 : 100 }, unlock: 'starter' }] };
  const w = createWorld({ seed, character: 'trial', map: MAP, invulnerable: !TANK, pools: { weapons: [id], passives: [], relics: [] }, weaponSlots: 4, passiveSlots: 4, relicSlots: 3, tuning: { embers: { eliteChance: 0 } } }, data);
  for (let k = 0; k < w.slots.length; k++) if (w.slots[k]?.def && w.slots[k].def.id !== id && k < 9) w.slots[k] = null;
  const s = w.slots.findIndex((x) => x?.def?.id === id);
  // The ladder: numbers rolled as level-up cards would be (lines and specials left out).
  for (let n = 1, guard = 0; n < L && guard < 2000; guard++) {
    const u = rollUpgrade(w, s, w.rng.draft, null, { noSpecial: true });
    if (!u || u.up === 'line' || u.up === 'special') continue;
    takeUpgrade(w, s, u); n++;
  }
  for (const l of lines) takeUpgrade(w, s, { up: 'line', line: l });
  for (const x of specials) takeUpgrade(w, s, { up: 'special', special: x });
  markStatsDirty(w); rebuildStats(w);
  for (const f of forms) takeOption(w, s, f);
  rebuildStats(w);
  decide(w, { kind: 'dev', cmd: 'jump', to: FROM });
  const bot = createKiteBot({ archetype: 'projectile_storm', stay: true });
  let kills = 0;
  const d0 = w.threat.dealt, t0 = w.result.damageTaken;
  const end = w.tick + SEC * 60;
  while (w.tick < end && !w.over) {
    stepWorld(w, MOVE === 'plant' ? plantInput(w) : MOVE === 'circle' ? circleInput(w) : bot.input(w));
    const ev = w.events;
    for (let i = 0; i < ev.count; i++) if (ev.type[i] === EV.KILL && ev.c[i] === s) kills++;
    for (let g = 0; currentHalt(w) && g < 100; g++) {
      const h = currentHalt(w);
      if (h.kind === 'draft') { w.charges.skip = Math.max(1, w.charges.skip); decide(w, { kind: 'skip' }); }
      else if (h.kind === 'ascend') decide(w, { kind: 'keep' });
      else decide(w, bot.decide(w, h));
    }
  }
  return { id, forms, lines, specials, seed, move: MOVE, real: Math.round((w.threat.dealt - d0) * 60 / SEC), taken: Math.round((w.result.damageTaken - t0) * 60 / SEC), kpm: Math.round(kills * 60 / SEC) };
}

for (const id of list) for (let k = 0; k < seeds; k++) {
  const seed = `c1b-${k}`;
  const def = DATA.weapons.find((w) => w.id === id), line = DATA.ascensions.find((l) => l.weapons.includes(id));
  const jobs = [{}];
  const COMBOS = arg('combos', null);
  if (arg('sets', '0') === '1') {   // Ruling 18 WA: every whole set, one option on each axis (8 a weapon)
    const by = ['delivery', 'flight', 'payoff'].map((a) => line.options.filter((o) => o.axis === a).map((o) => o.id));
    const ex = (x, y) => { const ox = line.options.find((o) => o.id === x), oy = line.options.find((o) => o.id === y); return (ox.excludes || []).includes(y) || (oy.excludes || []).includes(x); };
    for (const a of by[0]) for (const b of by[1]) for (const c of by[2]) if (!ex(a, b) && !ex(a, c) && !ex(b, c)) jobs.push({ forms: [a, b, c] });
  } else if (COMBOS) { for (const c of COMBOS.split(',')) { const ids = c.split('+'); const j = { forms: ids.filter((x) => line.options.some((o) => o.id === x)), lines: ids.filter((x) => (def.lines || []).some((l) => l.id === x)), specials: ids.filter((x) => (def.specials || []).some((l) => l.id === x)) }; if (j.forms.length + j.lines.length + j.specials.length === ids.length) jobs.push(j); } }
  else {
  for (const o of line.options) jobs.push({ forms: [o.id] });
  for (const l of def.lines || []) jobs.push({ lines: [l.id] });
  for (const x of def.specials || []) jobs.push({ specials: [x.id] });
  }
  for (const j of jobs) {
    if (!COMBOS && PIECES && (j.forms || j.lines || j.specials) && ![...(j.forms || []), ...(j.lines || []), ...(j.specials || [])].some((x) => PIECES.includes(x))) continue;
    let row;
    try { row = trial(id, { ...j, seed }); } catch (e) { row = { id, ...j, seed, error: String(e.message).slice(0, 200) }; }
    appendFileSync(out, JSON.stringify(row) + '\n');
  }
  console.log(id, k);
}
