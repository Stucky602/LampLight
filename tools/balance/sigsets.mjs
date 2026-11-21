// tools/balance/sigsets.mjs: copied from work/cw/C2/tools/sigsets.mjs (X6, Nov 20) so the balance benches and their test
// fixtures can be rebuilt from the repo. Run from the repo root (docs/HANDOFF.md has the commands).
// C2 (ruling 19 KH): every signature's whole option sets (one option on each axis, 8 a signature),
// benched like C1's drafted sets (bench.mjs --sets 1): the character with only its signature, at
// signature level L, from FROM s for SEC s of a Docks run, kite bot, can't die, drafts skipped.
// Health removed a minute by the signature (its row, the Bog Warden's dead included).
// node sigsets.mjs [--chars a,b] [--seeds 3] [--level 20] [--from 900] [--sec 120] --out file.jsonl
// (C2b, Nov 19: 3 seeds by default. One seed read a set at 3.14x its median where three read 2.09x; the fixture takes the median over seeds.)
import { appendFileSync } from 'node:fs';
const R = process.env.TREE || new URL('../..', import.meta.url).pathname.replace(/\/$/, '');   // (the repo this file is in; TREE=<a snapshot> benches that one)
const { DATA } = await import(`${R}/src/data/index.js`);
const { createWorld, stepWorld, decide, currentHalt } = await import(`${R}/src/sim/world.js`);
const { createKiteBot } = await import(`${R}/src/sim/bot.js`);
const { rollUpgrade, takeUpgrade } = await import(`${R}/src/sim/weaponups.js`);
const { takeOption } = await import(`${R}/src/sim/ascend.js`);
const { markStatsDirty, rebuildStats } = await import(`${R}/src/sim/build.js`);
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const seeds = +arg('seeds', 3), out = arg('out', 'sigsets.jsonl'), L = +arg('level', 20);
const FROM = +arg('from', 900), SEC = +arg('sec', 120), MAP = arg('map', 'drowned_docks');
const chars = arg('chars', DATA.characters.map((c) => c.id).join(',')).split(',');
export function sigTrial(ch, forms, seed) {
  const c = DATA.characters.find((x) => x.id === ch);
  const w = createWorld({ seed, character: ch, map: MAP, invulnerable: true, pools: { weapons: [], passives: [], relics: [] }, weaponSlots: 4, passiveSlots: 4, relicSlots: 3, tuning: { embers: { eliteChance: 0 } } }, DATA);
  const s = w.slots.findIndex((x) => x?.def?.id === c.signature);
  for (let k = 0; k < w.slots.length; k++) if (k !== s && k < 9 && w.slots[k]?.def) w.slots[k] = null;
  for (let n = 1, guard = 0; n < L && guard < 2000; guard++) {
    const u = rollUpgrade(w, s, w.rng.draft, null, { noSpecial: true });
    if (!u || u.up === 'line' || u.up === 'special') continue;
    takeUpgrade(w, s, u); n++;
  }
  markStatsDirty(w); rebuildStats(w);
  for (const f of forms) takeOption(w, s, f);
  rebuildStats(w);
  decide(w, { kind: 'dev', cmd: 'jump', to: FROM });
  const bot = createKiteBot({ archetype: 'projectile_storm', stay: true });
  const r0 = w.result.realBySlot[s];
  const end = w.tick + SEC * 60;
  while (w.tick < end && !w.over) {
    stepWorld(w, bot.input(w));
    for (let g = 0; currentHalt(w) && g < 100; g++) {
      const h = currentHalt(w);
      if (h.kind === 'draft') { w.charges.skip = Math.max(1, w.charges.skip); decide(w, { kind: 'skip' }); }
      else if (h.kind === 'ascend') decide(w, { kind: 'keep' });
      else decide(w, bot.decide(w, h));
    }
  }
  return Math.round((w.result.realBySlot[s] - r0) * 60 / SEC);
}
if (process.argv[1].endsWith('sigsets.mjs')) {
  for (const ch of chars) for (let k = 0; k < seeds; k++) {
    const c = DATA.characters.find((x) => x.id === ch);
    const line = DATA.ascensions.find((l) => l.weapons.includes(c.signature));
    const by = ['delivery', 'flight', 'payoff'].map((a) => line.options.filter((o) => o.axis === a).map((o) => o.id));
    for (const a of by[0]) for (const b of by[1]) for (const x of by[2]) {
      let real; try { real = sigTrial(ch, [a, b, x], `c2s-${k}`); } catch (e) { real = 'error: ' + String(e.message).slice(0, 120); }
      appendFileSync(out, JSON.stringify({ ch, set: `${a}+${b}+${x}`, seed: k, real }) + '\n');
    }
    console.log(ch, k);
  }
}
