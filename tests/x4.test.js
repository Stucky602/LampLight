// The sweep's sim seams (X4; work/sweep/S1.md, work/sweep/X4.md): the Punter's punt has an end, the
// Marsh's overtime flood leaves a way to everything armed, the dawn crumbles everything and can't
// kill, the threat counts only your weapons' damage, the Brine Vat can't salt a champion, and the
// minor ones (the causeway's sighting, the bell ledger, a dev jump past a boss, a crane re-armed mid-work).
import test from 'node:test';
import assert from 'node:assert/strict';
import { DATA } from '../src/data/index.js';
import { createWorld, stepWorld, decide, currentHalt, hashWorld, buildRunResult } from '../src/sim/world.js';
import { makeWorld, spawnAt, run, IDLE, neutralPace } from './helpers/simworld.js';
import { damageEnemy, spawnEnemy, applyStatus, MUSTER_CAPTAIN } from '../src/sim/enemies.js';
import { makeChampion } from '../src/sim/champions.js';
import { hurtPlayer } from '../src/sim/player.js';
import { crowdArrives, runLedger } from '../src/sim/tasks.js';
import { EV, SIGHT, END } from '../src/sim/events.js';
import { EF, TPS, TASK, TASK_STATE, RELIC_SLOT, INNATE_SLOT, HOP, AI } from '../src/sim/constants.js';
import { TILE } from '../src/sim/terrain.js';
import { endRun } from '../src/sim/run-result.js';

const T = DATA.tuning;
const goTo = (w, x, y) => { w.player.x = w.player.px = x; w.player.y = w.player.py = y; };
/** Step n ticks, answering whatever the run stops for. */
const steps = (w, n, frame = IDLE) => run(w, n, frame, { halts: 'pass' });
const tileOf = (w) => Math.floor(w.player.y / TILE) * w.terrain.cols + Math.floor(w.player.x / TILE);
/** Events of a type over n ticks. */
function collect(w, n, type, frame = IDLE) {
  const out = [];
  for (let k = 0; k < n && !w.over; k++) {
    steps(w, 1, frame);
    const b = w.events;
    for (let i = 0; i < b.count; i++) if (b.type[i] === type) out.push({ a: b.a[i], b: b.b[i], tick: w.tick - 1 });
  }
  return out;
}
/** Straight to overtime: the last boss "falls" and you stay. */
function stay(w) {
  w.director.finalBossDead = true; w.result.cleared = true; w.halts.push({ kind: 'overtime' });
  decide(w, { kind: 'stay' });
}

// ---------------------------------------------------------------- 1. the Punter's punt

/** The water tile nearest him with water `d` tiles all round it, as [x, y] px. */
function waterNear(w, d) {
  const Tn = w.terrain, g = w.trade.grid, p = w.player;
  const wet = (x, y) => x >= 0 && y >= 0 && x < Tn.cols && y < Tn.rows && Tn.solid[y * Tn.cols + x] === 1 && g[y * Tn.cols + x] === 0;
  let best = Infinity, at = null;
  for (let y = d; y < Tn.rows - d; y++) for (let x = d; x < Tn.cols - d; x++) {
    let ok = true;
    for (let dy = -d; dy <= d && ok; dy++) for (let dx = -d; dx <= d && ok; dx++) if (!wet(x + dx, y + dy)) ok = false;
    if (!ok) continue;
    const q = ((x + 0.5) * TILE - p.x) ** 2 + ((y + 0.5) * TILE - p.y) ** 2;
    if (q < best) { best = q; at = [(x + 0.5) * TILE, (y + 0.5) * TILE]; }
  }
  return at;
}

test('the Punter: a punt lasts its seconds; spent on the water he is carried to the bank, winded and shut out of the water until the pole is fresh', async () => {
  const { onWater, puntLeft, puntSpent, poleSpeed, TRADE } = await import('../src/sim/trades.js');
  const w = createWorld(neutralPace({ seed: 7, map: 'drowned_docks', character: 'punter', invulnerable: true, densityCap: 0 }), DATA);
  w.director.eventIdx = w.director.events.length;
  const P = w.trade.P;
  assert.ok(P.punt > 0 && P.rest > 0 && P.winded <= 1 && P.tired < P.punt);
  const at = waterNear(w, 1);
  goTo(w, at[0], at[1]);
  // Pad down on the water: afloat until the pole is spent, the tiring said once before it.
  const evs = collect(w, Math.round(P.punt * TPS) - 2, EV.TRADE);
  assert.equal(onWater(w), true, 'still afloat just before the punt ends');
  assert.ok(puntLeft(w) > 0 && puntLeft(w) < 0.05);
  assert.deepEqual(evs.filter((e) => e.a === TRADE.PUNT).map((e) => e.b), [1], 'the pole tiring, said once');
  const h0 = hashWorld(w); w.trade.s.punt += 0.01; assert.notEqual(hashWorld(w), h0, 'the hash sees the punt'); w.trade.s.punt -= 0.01;
  // Spent: carried to the nearest bank with no input, inside 4 s.
  const more = collect(w, 4 * TPS, EV.TRADE);
  assert.ok(more.some((e) => e.a === TRADE.PUNT && e.b === 0), 'carried ashore');
  assert.equal(onWater(w), false, 'on land');
  assert.equal(w.terrain.blockedAt(w.player.x, w.player.y), false);
  // Beached: the water is a wall to him (and since ruling 14 he isn't slowed: winded is 1).
  const s = w.trade.s;
  if (s.beached === 1) {
    assert.equal(puntSpent(w), true);
    assert.equal(poleSpeed(w), P.winded);
    const dx = at[0] - w.player.x, dy = at[1] - w.player.y, d = Math.hypot(dx, dy);
    steps(w, 20, { mx: Math.round(127 * dx / d), my: Math.round(127 * dy / d), buttons: 0 });
    assert.equal(onWater(w), false, 'he can\'t push off with a spent pole');
  }
  // Fresh again after `rest` s on land in all; then the water is his again.
  const fresh = collect(w, Math.round(P.rest * TPS) + 2, EV.TRADE);
  assert.equal(s.beached, 0);
  assert.equal(puntLeft(w), 1);
  assert.ok(fresh.some((e) => e.a === TRADE.PUNT && e.b === 2) || more.some((e) => e.a === TRADE.PUNT && e.b === 2), 'the pole fresh again, said');
  assert.equal(poleSpeed(w), 1);
  const dx = at[0] - w.player.x, dy = at[1] - w.player.y, d = Math.hypot(dx, dy);
  steps(w, 60, { mx: Math.round(127 * dx / d), my: Math.round(127 * dy / d), buttons: 0 });
  assert.equal(onWater(w), true, 'he poles out again');
  // Off the water before the pole is spent: no beaching, and it rests as he walks.
  const left = puntLeft(w);
  const o = [0, 0]; w.terrain.nearestOpen(Math.floor(w.player.x / TILE), Math.floor(w.player.y / TILE), o);
  goTo(w, o[0], o[1]);
  steps(w, 30);
  assert.equal(s.beached, 0);
  assert.ok(puntLeft(w) > left, 'the pole rests on land');
});

test('the Punter on the Marsh: rule 8 holds his way home while he stands on land (on the water it holds nothing for him)', () => {
  const w = createWorld(neutralPace({ seed: 5, map: 'salt_marsh', character: 'punter', invulnerable: true, densityCap: 0 }), DATA);
  w.director.eventIdx = w.director.events.length;
  w.tick = 200 * 60;   // high water
  steps(w, 30);
  const M = w.marsh, Tn = w.terrain;
  assert.equal(M.level, 101);
  let dry = -1, wet = -1;
  for (let i = 0; i < Tn.wet.length && (dry < 0 || wet < 0); i++) {
    if (wet < 0 && Tn.wet[i] === 1) wet = i;
    if (dry < 0 && Tn.solid[i] === 0 && M.g.floodAt[i] === 255 && i !== M.landing && M.step[i] >= 0) dry = i;
  }
  goTo(w, (dry % Tn.cols + 0.5) * TILE, (Math.floor(dry / Tn.cols) + 0.5) * TILE);
  steps(w, 16);
  assert.equal(M.ptile, dry, 'on land: the chain starts at his tile');
  goTo(w, (wet % Tn.cols + 0.5) * TILE, (Math.floor(wet / Tn.cols) + 0.5) * TILE);
  steps(w, 2);
  assert.equal(M.ptile, M.landing, 'on the water: nothing is held for him');
});

// ---------------------------------------------------------------- 2. the Marsh's overtime flood

test('the Marsh in overtime: act 3\'s sites keep to ground the flood never takes (fewer bells beat drowned ones), and acts 1 and 2 leave it its dry sites', async () => {
  const { floodsEver } = await import('../src/sim/marsh.js');
  const map = DATA.maps.find((m) => m.id === 'salt_marsh');
  const mk = () => { const w = createWorld({ seed: 4, map: 'salt_marsh', character: 'lamplighter', invulnerable: true, densityCap: 0 }, DATA); w.director.eventIdx = w.director.events.length; return w; };
  const never = (w, t) => !floodsEver(w, Math.floor(t.y / TILE) * w.terrain.cols + Math.floor(t.x / TILE));
  const w = mk();
  steps(w, 400 * TPS);            // act 1's bells wake
  crowdArrives(w, true);
  steps(w, 400 * TPS);            // act 2's
  stay(w);
  steps(w, 300 * TPS);            // act 3's
  const a3 = w.tasks.filter((t) => t.act === 3 && (t.kind === TASK.LAMP || t.kind === TASK.BELL));
  assert.equal(a3.filter((t) => t.kind === TASK.LAMP).length, map.acts[2].lamps);
  assert.equal(a3.filter((t) => t.kind === TASK.BELL).length, map.acts[2].bells, 'acts 1 and 2 left act 3 its dry bell sites');
  for (const t of a3) assert.ok(never(w, t), `an act 3 ${t.kind === TASK.LAMP ? 'lamp' : 'bell'} on ground the flood never takes`);
  // With the dry bell sites gone, act 3 brings fewer bells, never a drowned one.
  const v = mk();
  const o = [0, 0];
  map.sites.bell.forEach(([tx, ty], i) => { v.terrain.nearestOpen(tx, ty, o); if (!floodsEver(v, Math.floor(o[1] / TILE) * v.terrain.cols + Math.floor(o[0] / TILE))) v.acts.usedBell[i] = 1; });
  crowdArrives(v, true);
  stay(v);
  steps(v, 300 * TPS);
  assert.equal(v.tasks.filter((t) => t.act === 3 && t.kind === TASK.BELL).length, 0, 'no dry site left: no bell, not a drowned one');
});

test('the Marsh in overtime: the flood leaves a way to everything armed (rule 8 holds a chain to each), from the landing or from far off', () => {
  const w = createWorld({ seed: 'flood', map: 'salt_marsh', character: 'bog_warden', invulnerable: true, densityCap: 0 }, DATA);
  w.director.eventIdx = w.director.events.length;
  steps(w, 30);
  crowdArrives(w, true);
  steps(w, 30);
  stay(w);
  const Tn = w.terrain, M = w.marsh, cols = Tn.cols, n = cols * Tn.rows, p = w.player;
  // The flood at its highest: eleven minutes into overtime.
  w.director.overtimeStartTick = w.tick - 11 * 60 * TPS;
  steps(w, 20 * TPS);
  assert.ok(M.level >= 130, `the flats are flooding (level ${M.level})`);
  const check = (label) => {
    const seen = new Uint8Array(n), q = [tileOf(w)];
    seen[q[0]] = 1;
    while (q.length) {
      const i = q.pop(), x = i % cols;
      for (const j of [x + 1 < cols ? i + 1 : -1, x > 0 ? i - 1 : -1, i + cols < n ? i + cols : -1, i - cols]) if (j >= 0 && !seen[j] && Tn.solid[j] === 0) { seen[j] = 1; q.push(j); }
    }
    const sites = [];
    for (const t of w.tasks) if (t.kind === TASK.CAIRN ? t.state === TASK_STATE.IDLE : t.state !== TASK_STATE.DONE) sites.push(['task ' + t.kind, t.x, t.y]);
    w.trade.sites.forEach((s, k) => sites.push(['bog body ' + k, s.x, s.y]));
    for (const s of w.secrets) if (s.gift && !s.open && w.acts.act >= s.from) sites.push([s.id, s.x, s.y]);
    assert.ok(sites.length >= 20, `${sites.length} armed`);
    for (const [what, x, y] of sites) assert.equal(seen[Math.floor(y / TILE) * cols + Math.floor(x / TILE)], 1, `${label}: you can walk to ${what}`);
  };
  check('from the landing');
  const o = [0, 0]; Tn.nearestOpen(176, 80, o); goTo(w, o[0], o[1]);
  steps(w, 30);
  check('from the far flats');
  const h0 = hashWorld(w); M.siteSig ^= 1; assert.notEqual(hashWorld(w), h0, 'the hash sees the sites held'); M.siteSig ^= 1;
  // Not at an ordinary high water: the creeks still cut the map then.
  const hw = createWorld({ seed: 'flood', map: 'salt_marsh', character: 'lamplighter', invulnerable: true, densityCap: 0 }, DATA);
  hw.director.eventIdx = hw.director.events.length;
  hw.tick = 200 * 60; steps(hw, 30);
  assert.equal(hw.marsh.level, 101);
  assert.equal(hw.marsh.siteN, 0, 'no chains to sites before overtime');
});

// ---------------------------------------------------------------- 3. the dawn

test('the dawn: everything alive crumbles (the boss that came back, a toad in the air, shots and pools), nothing can hurt you after it, and it ends cleared', async () => {
  const { spawnBoss } = await import('../src/sim/director.js');
  const { spawnHostileShot, spawnHazard } = await import('../src/sim/attacks.js');
  const { PF, ZONE, HOSTILE } = await import('../src/sim/constants.js');
  for (const map of ['drowned_docks', 'salt_marsh']) {
    const w = createWorld({ seed: 'dawn-' + map, map, character: 'lamplighter', invulnerable: true, densityCap: 0 }, DATA);
    w.director.eventIdx = w.director.events.length;
    steps(w, 30);
    stay(w);
    const back = spawnBoss(w, DATA.maps.find((m) => m.id === map).overtime.events[0].enemy);   // the 5:00 boss, still alive
    for (const o of w.director.otOnce) o.tick = o.ev.event === 'long_night' ? w.tick + 5 : w.tick + 1e9;
    const toad = spawnAt(w, 'mire_toad', 60, 0);
    const F = w.acts.finale, E = w.enemies;
    for (let k = 0; k < 20 * TPS && !(F.state === 1 && F.pending.length === 0 && F.bosses.length === 2); k++) steps(w, 1);
    assert.equal(F.bosses.length, 2, 'the Long Night\'s two bosses are out');
    const ti = E.resolve(E.handle(toad));
    if (ti >= 0) { E.flags[ti] |= EF.AIR; E.aiState[ti] = HOP.AIR; E.aiTimer[ti] = 5; }
    spawnHostileShot(w, w.player.x + 200, w.player.y, -10, 0, 4, 5, 30);
    spawnHazard(w, w.player.x, w.player.y, 20, 1, 30, 5);
    for (const b of F.bosses) { const e = E.resolve(b.handle); E.flags[e] |= EF.DEAD; }
    w.config = { ...w.config, invulnerable: false };
    steps(w, 1);
    assert.equal(F.state, 2, `${map}: dawn`);
    let alive = 0;
    for (let i = 0; i < E.count; i++) if ((E.flags[i] & EF.DEAD) === 0) alive++;
    assert.equal(alive, 0, `${map}: nothing left alive`);
    assert.equal(back.alive, false, 'the boss that came back is gone');
    assert.equal(w.director.bossesAlive, 0);
    assert.equal(w.result.bossesKilled.length, 2, 'crumbled, not killed: only the Long Night\'s two count');
    const P = w.projectiles, Z = w.zones;
    steps(w, 2);
    for (let i = 0; i < P.count; i++) assert.equal(P.flags[i] & PF.HOSTILE, 0, 'no hostile shot left');
    for (let z = 0; z < Z.count; z++) assert.ok(!(Z.kind[z] === ZONE.HAZARD && Z.slot[z] === HOSTILE), 'no hostile pool left');
    const hp = w.player.hp;
    w.player.iframes = 0;
    assert.equal(hurtPlayer(w, 9999, w.player.x, w.player.y, 1, 0, null), 0, 'nothing hurts you after the dawn');
    assert.equal(w.player.hp, hp);
    for (let k = 0; k < (T.tasks.acts.dawnSec + 1) * TPS && !w.over; k++) steps(w, 1);
    const r = buildRunResult(w);
    assert.deepEqual([r.end, r.dawn, r.cleared], ['cleared', true, true], map);
  }
  // A result never says dawn beside a death.
  const d = makeWorld();
  d.result.dawn = true; endRun(d, END.DIED);
  assert.equal(buildRunResult(d).dawn, false);
});

// ---------------------------------------------------------------- 4. the threat

test('the threat counts your weapons\' damage only: not slot 9 (wards, Lantern Night, thralls, cranes, cairns), and not overkill past an enemy\'s health', () => {
  const w = makeWorld({ invulnerable: true, tuning: { threat: { max: 1.4, from: 0 } } });
  const e = spawnAt(w, 'drowned_sailor', 200, 0);
  w.enemies.hp[e] = w.enemies.maxHp[e] = 10; w.enemies.speed[e] = 0;
  damageEnemy(w, e, 1000, 0);
  assert.equal(w.threat.dealt, 10, 'overkill is nothing');
  assert.equal(w.result.damageBySlot[0], 1000, 'the weapon\'s own tally is as it was');
  const big = spawnAt(w, 'drowned_sailor', 220, 0);
  w.enemies.hp[big] = w.enemies.maxHp[big] = 1e9; w.enemies.speed[big] = 0;
  damageEnemy(w, big, 500, RELIC_SLOT);
  assert.equal(w.threat.dealt, 10, 'slot 9 is not your damage');
  damageEnemy(w, big, 7, INNATE_SLOT);
  assert.equal(w.threat.dealt, 17);
  const bigH = w.enemies.handle(big);
  const h0 = hashWorld(w); w.threat.dealt += 1; assert.notEqual(hashWorld(w), h0, 'the hash sees it'); w.threat.dealt -= 1;
  // A minute of nothing but a relic's damage, far past the reference: the threat stays at 1.
  for (let s = 0; s < 40; s++) { const b = w.enemies.resolve(bigH); damageEnemy(w, b, 100 * T.threat.ref[0][1], RELIC_SLOT); steps(w, TPS); }
  assert.equal(w.threat.mul, 1);
  for (let s = 0; s < 40; s++) { const b = w.enemies.resolve(bigH); damageEnemy(w, b, 100 * T.threat.ref[0][1], 0); steps(w, TPS); }
  assert.equal(w.threat.mul, 1.4, 'a weapon\'s does raise it');
});

// ---------------------------------------------------------------- 5. the Brine Vat

test('the Brine Vat never turns a champion (a muster\'s captain) to salt; a plain elite still crumbles', () => {
  const w = createWorld(neutralPace({ seed: 'salt', map: 'drowned_docks', character: 'lamplighter', invulnerable: true, relics: ['brine_vat'], densityCap: 0 }), DATA);
  w.director.eventIdx = w.director.events.length;
  steps(w, 5);
  const ev = DATA.maps[0].timeline.events.find((x) => x.event === 'muster' && x.champion && x.at >= 900);
  const E = w.enemies, p = w.player;
  const c = spawnEnemy(w, w.enemyIndex.get(ev.enemy), p.x + 300, p.y, { elite: true, affixes: 0 });
  E.boss[c] = MUSTER_CAPTAIN; E.speed[c] = 0;
  const champ = makeChampion(w, c, ev, 0);
  const el = spawnEnemy(w, w.enemyIndex.get(ev.enemy), p.x - 300, p.y, { elite: true, affixes: 0 });
  E.speed[el] = 0;
  const hEl = E.handle(el), hp0 = E.hp[c];
  let salted = false;
  for (let k = 0; k < 12 * TPS; k++) {
    for (const h of [champ.handle, hEl]) { const i = E.resolve(h); if (i >= 0 && k % 30 === 0) applyStatus(w, i, { status: 'slow', pct: 0.3, duration: 1.5 }, 0); }
    steps(w, 1);
    const i = E.resolve(champ.handle);
    if (i >= 0 && E.saltT[i] > 0) salted = true;
  }
  const i = E.resolve(champ.handle);
  assert.ok(i >= 0 && (E.flags[i] & EF.DEAD) === 0, 'the champion stands');
  assert.equal(salted, false, 'never salted');
  assert.ok(E.hp[i] > hp0 * 0.8, `and lost nothing to the Vat (${E.hp[i]} of ${hp0})`);
  assert.ok(E.slowPct[i] >= 0.79, 'the slows still stack on it');
  assert.equal(E.resolve(hEl), -1, 'a plain elite turned to salt and crumbled, as before');
});

// ---------------------------------------------------------------- 6. the minor ones

test('the Drowned Causeway is sighted only where its secret is: the Bog Warden with the secret layer on', () => {
  const near = (character, layers) => {
    const w = createWorld({ seed: 2, map: 'salt_marsh', character, invulnerable: true, densityCap: 0, layers }, DATA);
    const M = w.marsh, Tn = w.terrain, c = M.g.causeway[0], o = [0, 0];
    Tn.nearestOpen(c % Tn.cols - 6, Math.floor(c / Tn.cols), o);
    goTo(w, o[0], o[1]);
    steps(w, 61);
    return (w.seenThings & (1 << SIGHT.CAUSEWAY)) !== 0;
  };
  assert.equal(near('bog_warden'), true);
  assert.equal(near('lamplighter'), false, 'shut to her: not sighted');
  assert.equal(near('bog_warden', { secret: false }), false, 'the layer off: not sighted');
});

test('the ledger counts a Fog Bell once, however often it rings for the Tide Priest (the result still counts every ring)', () => {
  const w = createWorld(neutralPace({ seed: 7, map: 'drowned_docks', character: 'tide_priest', invulnerable: true, densityCap: 0 }), DATA);
  w.director.eventIdx = w.director.events.length;
  const b = w.tasks.findIndex((t) => t.kind === TASK.BELL && t.state === TASK_STATE.IDLE), bell = w.tasks[b];
  for (let ring = 0; ring < 2; ring++) {
    goTo(w, bell.x, bell.y); steps(w, 60);
    assert.equal(bell.state, TASK_STATE.ACTIVE);
    for (let k = 0; k < bell.need + 80 && bell.state === TASK_STATE.ACTIVE; k++) { const e = spawnAt(w, 'drowned_sailor', 4, 0); w.enemies.hp[e] = 1; damageEnemy(w, e, 5, 0); steps(w, 2); }
  }
  assert.equal(bell.state, TASK_STATE.DONE, 'rung twice');
  assert.equal(w.result.bellsRung, 2);
  const L = runLedger(w);
  assert.equal(L.bells.rung, 1, 'one bell');
  assert.ok(L.bells.rung <= L.bells.total);
});

test('a dev jump past a boss begins its act and brings the boss (past the last one: the last boss)', () => {
  const mk = () => { const w = createWorld({ seed: 3, map: 'drowned_docks', character: 'lamplighter', invulnerable: true }, DATA); steps(w, 5); return w; };
  const a = mk();
  decide(a, { kind: 'dev', cmd: 'jump', to: 650 });
  steps(a, 3);
  assert.equal(a.acts.act, 2);
  assert.deepEqual(a.bosses.map((b) => [b.id, b.alive, b.final]), [['harbor_maw', true, false]]);
  const b = mk();
  decide(b, { kind: 'dev', cmd: 'jump', to: 1260 });
  steps(b, 3);
  assert.equal(b.acts.act, 2);
  assert.deepEqual(b.bosses.map((x) => [x.id, x.alive, x.final]), [['the_tidecaller', true, true]], 'only the last boss passed arrives');
  const c = mk();
  decide(c, { kind: 'dev', cmd: 'jump', to: 300 });
  steps(c, 3);
  assert.deepEqual([c.acts.act, c.bosses.length], [1, 0], 'a jump short of a boss is as it was');
});

test('a crane re-armed by a new act in the middle of its work drops its loads first', () => {
  const w = createWorld({ seed: 8, map: 'drowned_docks', character: 'lamplighter', invulnerable: true, densityCap: 0 }, DATA);
  w.director.eventIdx = w.director.events.length;
  const i = w.tasks.findIndex((t) => t.kind === TASK.CRANE), t = w.tasks[i], C = T.tasks.crane;
  goTo(w, t.x, t.y);
  steps(w, Math.round(C.openSec * TPS) + 3);
  assert.equal(t.state, TASK_STATE.DONE);
  assert.ok(t.wave >= 1 && t.wave < t.need, 'its first load is out, more to come');
  goTo(w, t.x + 200, t.y);
  crowdArrives(w, true);
  assert.equal(w.acts.act, 2);
  assert.equal(t.state, TASK_STATE.DONE, 'not re-armed mid-work');
  const arms = collect(w, Math.round(C.loads * C.gap * TPS) + 10, EV.ARM);
  assert.equal(t.wave, t.need, 'every load dropped');
  assert.equal(t.state, TASK_STATE.IDLE, 'and then it is ready for act 2');
  assert.equal(t.act, 2);
  assert.equal(arms.filter((e) => e.b === i).length, 1, 'said once');
});
