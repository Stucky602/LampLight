// Rule 8's exhaustive sweep (docs/design/SALT_MARSH.md rule 8; ARCHITECTURE §5.17): the flood never
// closes around you. Workspace-only (the gate checks the hardest spots and one overtime walk:
// tests/marsh.test.js). Exit 1 on any failure.
//
// 1. Every standable tile at 6 water levels (a quarter in, the causeway's height, three quarters,
//    high water, an overtime flood over the flats, and the overtime flood's cap): the search's chain from the tile reaches the
//    landing in 4-connected steps over ground that isn't a stump or deep water, and a pass from the
//    tile holds every would-be-wet tile on it. Every 97th tile also has its hold put on the ground
//    (a refresh) and a walk home searched on the solid grid itself.
// 2. Six 6-minute overtime walks (different seeds and routes) with glass pillars raised around you
//    every 2 s: after every rebuild that changed the water, a walk home exists on the solid grid,
//    and no pillar stands on your way (one the chain comes to run through falls at once).
//
//   node tools/marsh/rule8.mjs [--walks 6] [--minutes 6]
import { DATA } from '../../src/data/index.js';
import { createWorld, stepWorld, decide, currentHalt } from '../../src/sim/world.js';
import { rule8, flatsLevel } from '../../src/sim/marsh.js';
import { raisePillar } from '../../src/sim/storm.js';
import { TILE } from '../../src/sim/terrain.js';

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? Number(process.argv[i + 1]) : dflt; };
const WALKS = arg('walks', 6), MINUTES = arg('minutes', 6);
const tester = { id: 'tester', name: 'Tester', desc: 'For tools.', sprite: 'pc_lamplighter', start: null, innate: null, base: {}, mechanic: null, unlock: 'starter' };
const D = { ...DATA, characters: [...DATA.characters, tester] };
const make = (seed) => {
  const w = createWorld({ seed, map: 'salt_marsh', character: 'tester', densityCap: 0, invulnerable: true }, D);
  w.director.eventIdx = w.director.events.length;
  return w;
};
// Answer every halt changing the build as little as can be (tests/helpers/simworld.js passHalts).
const ANSWER = { chest: { kind: 'ok' }, rune: { kind: 'discard' }, relic: { kind: 'pick', index: 0 }, ferry: { kind: 'done' }, ascend: { kind: 'keep' }, well: { kind: 'keep' } };
const answer = (w) => {
  for (let h = currentHalt(w); h; h = currentHalt(w)) {
    if (h.kind === 'draft') { w.charges.skip = Math.max(1, w.charges.skip); decide(w, { kind: 'skip' }); }
    else decide(w, ANSWER[h.kind] ?? { kind: 'stay' });
  }
};
const failures = [];
const fail = (msg) => { if (failures.length < 50) failures.push(msg); };
const t0 = performance.now();

// ---------------------------------------------------------------- 1. every tile at 5 levels
{
  const w = make(1);
  const M = w.marsh, T = w.terrain, g = M.g, cols = T.cols, n = cols * T.rows;
  const flood = g.floodAt, base = T.base;
  const seen = new Uint8Array(n), q = new Int32Array(n);
  const home = (s) => {
    seen.fill(0);
    let h = 0, t = 0;
    q[t++] = s; seen[s] = 1;
    while (h < t) {
      const i = q[h++];
      if (i === M.landing) return true;
      const x = i % cols;
      for (const j of [x + 1 < cols ? i + 1 : -1, x > 0 ? i - 1 : -1, i + cols < n ? i + cols : -1, i - cols]) if (j >= 0 && !seen[j] && !T.solid[j]) { seen[j] = 1; q[t++] = j; }
    }
    return false;
  };
  const levels = [25, 50, 75, 101, flatsLevel(g, 0.24, MAP_KEEP()), flatsLevel(g, 1, MAP_KEEP())];
  function MAP_KEEP() { return DATA.maps.find((m) => m.id === 'salt_marsh').water.overtime.keepDry; }
  let tiles = 0, deep = 0;
  for (const L of levels) {
    M.level = L;
    rule8.search(M, T, L);
    for (let p = 0; p < n; p++) {
      if (base[p] === 1) continue;
      tiles++;
      // The chain: 4-connected, never a stump or deep water, to the landing.
      let steps = 0, i = p;
      for (; i !== M.landing && i >= 0 && steps < n; steps++) {
        const j = M.step[i];
        if (j < 0) { fail(`level ${L}: tile ${p % cols},${Math.floor(p / cols)} has no step home at ${i % cols},${Math.floor(i / cols)}`); break; }
        const d = Math.abs(j - i);
        if (!(d === 1 || d === cols) || base[j] === 1) { fail(`level ${L}: a bad step ${i} -> ${j}`); break; }
        i = j;
      }
      if (i !== M.landing) continue;
      rule8.pass(M, T, p);
      for (let k = p; ; k = M.step[k]) { if (flood[k] < L && M.held[k] !== 1) fail(`level ${L}: from ${p % cols},${Math.floor(p / cols)} the tile ${k % cols},${Math.floor(k / cols)} isn't held`); if (k === M.landing) break; }
      if (p % 97 === 0) {
        // The real thing: the hold on the ground, a walk home on the solid grid.
        rule8.touchLevelRange(M, 0, 255);
        rule8.applyGround(w, M);
        if (!home(p)) fail(`level ${L}: no walk home from ${p % cols},${Math.floor(p / cols)} on the ground`);
        deep++;
      }
    }
    console.log(`level ${L}: ${tiles} tiles so far, ${deep} walked on the ground`);
  }
}

// ---------------------------------------------------------------- 2. overtime walks among pillars
for (let k = 0; k < WALKS; k++) {
  const w = make(100 + k);
  const M = w.marsh, T = w.terrain, cols = T.cols, n = cols * T.rows;
  w.director.overtime = true; w.director.overtimeStartTick = 0;
  const rng = w.rng.root.fork(`walk${k}`);
  const route = Array.from({ length: 10 }, () => [8 + rng.int(240), 8 + rng.int(240)]);
  const seen = new Uint8Array(n), q = new Int32Array(n);
  const tile = () => Math.floor(w.player.y / TILE) * cols + Math.floor(w.player.x / TILE);
  const home = () => {
    const s = tile();
    if (T.solid[s]) return false;
    seen.fill(0);
    let h = 0, t = 0;
    q[t++] = s; seen[s] = 1;
    while (h < t) {
      const i = q[h++];
      if (i === M.landing) return true;
      const x = i % cols;
      for (const j of [x + 1 < cols ? i + 1 : -1, x > 0 ? i - 1 : -1, i + cols < n ? i + cols : -1, i - cols]) if (j >= 0 && !seen[j] && !T.solid[j]) { seen[j] = 1; q[t++] = j; }
    }
    return false;
  };
  let leg = 0, pillars = 0, checks = 0, last = -1;
  for (let t = 0; t < MINUTES * 3600; t++) {
    const [tx, ty] = route[leg % route.length];
    const dx = (tx + 0.5) * TILE - w.player.x, dy = (ty + 0.5) * TILE - w.player.y, d = Math.hypot(dx, dy) || 1;
    if (d < 24 || t % 1200 === 1199) leg++;
    answer(w);
    stepWorld(w, { mx: Math.round((dx / d) * 127), my: Math.round((dy / d) * 127), buttons: 0 });
    if (t % 120 === 0) {
      const p = tile();
      if (raisePillar(w, (p % cols) + (rng.int(13) - 6), Math.floor(p / cols) + (rng.int(13) - 6))) pillars++;
    }
    if (w.tick % 15 === 1 && (M.level !== last || t % 600 === 1)) {
      last = M.level; checks++;
      if (!home()) fail(`walk ${k}: no way home at ${(w.tick / 60).toFixed(1)}s, level ${M.level}`);
      for (let s = 0; s < w.storm.pillarTile.length; s++) { const i = w.storm.pillarTile[s]; if (i >= 0 && M.level > 0 && M.pathMark[i] === M.passId) fail(`walk ${k}: a pillar on the way home at ${i % cols},${Math.floor(i / cols)}`); }
    }
  }
  console.log(`walk ${k}: level ${M.level}, ${pillars} pillars, ${checks} checks, ${M.searches} searches`);
}

console.log(`${((performance.now() - t0) / 1000).toFixed(1)} s`);
if (failures.length) { console.error(`RULE 8 FAIL:\n${failures.join('\n')}`); process.exit(1); }
console.log('RULE 8 PASS');
