// The sweep's save fixes (S4 A1, A3): unlock keys that moved, and a reconcile that stays linear.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deflateSync, strToU8 } from 'fflate';

import { createStore } from '../src/save/store.js';
import { createKvBackend, memoryKv } from '../src/save/backends.js';
import { defaultProfile } from '../src/save/schema.js';
import { decodeExportCode, encodeExportCode, b64urlEncode, CodeError, MAX_SAVE_ENTRIES } from '../src/save/codec.js';
import { crc32Hex } from '../src/lib/hash.js';
import { profileFromLoad } from '../src/app/profileboot.js';
import { reconcileProfile, MOVED_UNLOCKS } from '../src/meta/reconcile.js';
import { resolveContent, runConfigFor, contentOpen, isUnlocked, parseUnlock, contentKinds, masteryOf, npcLine, researchDone } from '../src/meta/index.js';
import { DATA } from '../src/data/index.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/saves/from-0.7.0-${name}.json`, import.meta.url), 'utf8'));

/** A fixture's save file loaded the way the game loads it: the store, migrations, reconcile. */
async function loadOld(old) {
  const kv = memoryKv();
  kv._map.set('profile', old.envelope);
  const store = createStore({ backend: createKvBackend(kv, 'memory'), build: 'now' });
  const boot = profileFromLoad(await store.loadProfile(), DATA);
  return { store, doc: boot.profile, notes: boot.notes };
}

/** What 0.7.0 gave the profile that this build still has under the same id (retired content is set aside, not lost). */
const stillHere = (kind, ids) => ids.filter((id) => (DATA[kind] || []).some((x) => x.id === id));

for (const name of ['early', 'max']) {
  test(`saves: a profile written by 0.7.0's own code keeps everything it could play (${name})`, async () => {
    const old = fixture(name);
    const { store, doc } = await loadOld(old);
    const now = resolveContent(doc, DATA);
    for (const [kind, ids] of Object.entries(old.content)) {
      const lost = stillHere(kind, ids).filter((id) => !now[kind].includes(id));
      assert.deepEqual(lost, [], `0.7.0 had these ${kind} and this build takes them away`);
    }
    // Every character it could play can set out, with the mastery it had.
    for (const ch of old.content.characters) {
      assert.doesNotThrow(() => runConfigFor(doc, DATA, { seed: 'x5', character: ch }), `${ch} can't set out`);
      assert.equal(masteryOf(doc, DATA, ch).xp, old.mastery[ch].xp);
    }
    // The save code gives the same profile as the file, and a second load changes nothing.
    assert.deepEqual(reconcileProfile(store.previewImport(old.code).doc, DATA).doc, doc);
    await store.saveProfile(doc);
    const again = profileFromLoad(await store.loadProfile(), DATA);
    assert.deepEqual(again.profile, doc);
  });
}

test('saves: the 0.7.0 harbor with the Tavern before the Lamp Post keeps the Harpooner, Undertow, and the Lucky Knot', async () => {
  const { doc } = await loadOld(fixture('early'));
  // The fixture is the case: the old keys met, the new ones not.
  assert.equal(isUnlocked(doc, DATA, 'building:lamp_post:2'), false);
  assert.equal(researchDone(doc).has('signal_codes'), false);
  const now = resolveContent(doc, DATA);
  assert.ok(now.characters.includes('harpooner'));
  assert.ok(now.passives.includes('undertow') && now.passives.includes('lucky_knot'));
  const cfg = runConfigFor(doc, DATA, { seed: 'x5', character: 'harpooner' });
  assert.ok(cfg.pools.passives.includes('undertow') && cfg.pools.passives.includes('lucky_knot'));
  // A held key opens content only: the Lamp Post is still Lv 1 and the Harbor Clock is not done.
  assert.equal(doc.profile.buildings.lamp_post, 1);
  for (const k of ['building:lamp_post:2', 'research:signal_codes', 'research:drowned_charms']) assert.ok(doc.profile.kept.includes(k), k);
  assert.equal(doc.profile.keptThrough, MOVED_UNLOCKS.length);
});

test('saves: every row of the moved-keys table names keys this build can read, and its new key opens something', () => {
  const opened = new Set(contentKinds(DATA).flatMap(([, list]) => list.map((x) => x.unlock)));
  for (const r of MOVED_UNLOCKS) {
    assert.notEqual(parseUnlock(r.was).kind, 'unknown', r.was);
    assert.notEqual(parseUnlock(r.now).kind, 'unknown', r.now);
    assert.ok(opened.has(r.now), `${r.now} opens no content: the row is stale, or the key moved again and needs a new row`);
  }
});

test('saves: a moved key is judged once, so a harbor built after the move earns the content the new way', () => {
  const data = { ...DATA, movedUnlocks: [{ was: 'building:tavern:1', now: 'building:lamp_post:2' }] };
  // A new profile: nothing met, the row judged, nothing held.
  const fresh = reconcileProfile(defaultProfile(), data).doc;
  assert.equal(fresh.profile.keptThrough, 1);
  assert.equal(fresh.profile.kept, undefined);
  // It restores the Tavern first, after the move: no Harpooner until the Lamp Post is Lv 2.
  fresh.profile.buildings = { lamp_post: 1, tavern: 1 };
  const later = reconcileProfile(fresh, data).doc;
  assert.equal(later.profile.kept, undefined);
  assert.equal(resolveContent(later, data).characters.includes('harpooner'), false);
  // The same harbor in a save from before the move (no count of rows judged): held.
  const old = defaultProfile();
  old.profile.buildings = { lamp_post: 1, tavern: 1 };
  const kept = reconcileProfile(old, data).doc;
  assert.deepEqual(kept.profile.kept, ['building:lamp_post:2']);
  assert.ok(resolveContent(kept, data).characters.includes('harpooner'));
  assert.ok(contentOpen(kept, data, 'building:lamp_post:2'));
  assert.equal(isUnlocked(kept, data, 'building:lamp_post:2'), false);
  // A save that had not met the old key holds nothing, then or later.
  const none = reconcileProfile(defaultProfile(), data).doc;
  assert.equal(resolveContent(none, data).characters.includes('harpooner'), false);
});

test('saves: a key that moved twice follows both moves, and a build with a shorter table keeps what a longer one held', () => {
  const two = { ...DATA, movedUnlocks: [{ was: 'building:tavern:1', now: 'building:library:1' }, { was: 'building:library:1', now: 'building:lamp_post:2' }] };
  const old = defaultProfile();
  old.profile.buildings = { tavern: 1 };
  const a = reconcileProfile(old, two).doc;
  assert.ok(a.profile.kept.includes('building:lamp_post:2'));
  assert.equal(a.profile.keptThrough, 2);
  // Opened by a build with one row: the held keys and the count stay.
  const one = { ...DATA, movedUnlocks: two.movedUnlocks.slice(0, 1) };
  const b = reconcileProfile(a, one).doc;
  assert.deepEqual(b.profile.kept, a.profile.kept);
  assert.equal(b.profile.keptThrough, 2);
  // Junk in the list is dropped, not thrown on.
  const junk = structuredClone(a);
  junk.profile.kept = [1, null, 'building:lamp_post:2', { x: 1 }, 'y'.repeat(500)];
  junk.profile.keptThrough = 'many';
  junk.profile.buildings = {};
  assert.deepEqual(reconcileProfile(junk, two).doc.profile.kept, ['building:lamp_post:2']);
});

test('saves: a held key opens content and nothing else (no townsfolk line, no research, no building)', async () => {
  const { doc } = await loadOld(fixture('early'));
  const without = structuredClone(doc);
  delete without.profile.kept;
  for (const n of DATA.npcs) assert.equal(npcLine(doc, DATA, n.id), npcLine(without, DATA, n.id));
  assert.deepEqual(doc.profile.research, without.profile.research);
});

// ---------------------------------------------------------------- A3: linear, and capped

const codeOfJson = (json) => `LAMP1.${b64urlEncode(deflateSync(strToU8(json), { level: 6 }))}.${crc32Hex(json)}`;

test('save code: a code whose lists hold far more than a save is refused, quickly', () => {
  const big = { v: 4, profile: { codex: Array.from({ length: 300000 }, (_, i) => `w${i}`) }, stats: {} };
  const code = codeOfJson(JSON.stringify(big));
  assert.ok(code.length > 500000);
  const t = process.cpuUsage();
  assert.throws(() => decodeExportCode(code), (e) => e instanceof CodeError && /far more than a save/.test(e.message));
  const u = process.cpuUsage(t);
  assert.ok((u.user + u.system) / 1000 < 3000, `refusing took ${(u.user + u.system) / 1000} ms of CPU`);
  // Nested lists too (a gear inventory, a map's seen list), and tables by their keys.
  for (const profile of [
    { gear: { inventory: Array.from({ length: MAX_SAVE_ENTRIES + 1 }, () => 0) } },
    { seen: { drowned_docks: Array.from({ length: MAX_SAVE_ENTRIES + 1 }, () => 'a') } },
    { materials: Object.fromEntries(Array.from({ length: MAX_SAVE_ENTRIES + 1 }, (_, i) => [`m${i}`, 1])) },
  ]) assert.throws(() => decodeExportCode(codeOfJson(JSON.stringify({ v: 4, profile, stats: {} }))), /far more than a save/);
  // A real save's code is untouched by the cap.
  const d = defaultProfile();
  assert.deepEqual(decodeExportCode(encodeExportCode(d)), d);
});

test('reconcile: 150,000 made-up entries in every list are fitted in linear time (a file on disk has no cap)', () => {
  const N = 150000;
  const d = defaultProfile();
  d.profile.codex = Array.from({ length: N }, (_, i) => (i % 3 ? `w${i}` : 'weapon:flare_barrage'));
  d.profile.orphans.codex = Array.from({ length: N }, (_, i) => (i % 2 ? `weapon:${DATA.weapons.find((w) => !w.innate).id}` : `o${i}`));
  d.profile.feats = Array.from({ length: N }, (_, i) => `f${i}`);
  d.profile.featsHeld = Array.from({ length: N }, (_, i) => `f${i}`);
  d.profile.bestiary = Object.fromEntries(Array.from({ length: N }, (_, i) => [`e${i}`, 1]));
  d.profile.consumables = Object.fromEntries(Array.from({ length: N }, (_, i) => [`c${i}`, 1]));
  d.profile.gear.inventory = Array.from({ length: N }, () => ({ uid: 1, id: DATA.recipes[0].id, tier: 1, affixes: [] }));
  d.profile.gear.equipped = Object.fromEntries(Array.from({ length: N }, (_, i) => [`s${i}`, i]));
  const t = process.cpuUsage();
  const out = reconcileProfile(d, DATA);
  const u = process.cpuUsage(t);
  // Quadratic, this ran for six minutes (S4 A3). Linear, it is about a second of CPU here.
  assert.ok((u.user + u.system) / 1000 < 20000, `reconcile took ${(u.user + u.system) / 1000} ms of CPU`);
  // And it did the work: nothing dropped, every item its own uid.
  assert.equal(out.doc.profile.orphans.codex.length, new Set([...d.profile.codex, ...d.profile.orphans.codex]).size - 1);
  assert.equal(new Set(out.doc.profile.gear.inventory.map((it) => it.uid)).size, N);
  assert.equal(out.doc.profile.orphans.feats.length, N);
});

// ---------------------------------------------------------------- small gaps a mutation run found (S4 D4)

test('store: rotation never writes a sixth backup, a blob name with a slash is refused, and an at-risk save rotates once, not ever after', async () => {
  const { BACKUPS, checkName } = await import('../src/save/backends.js');
  const { wrap } = await import('../src/save/envelope.js');
  const kv = memoryKv();
  const backend = createKvBackend(kv, 'memory');
  for (let i = 0; i < BACKUPS + 4; i++) await backend.write('profile', `save ${i}`, { rotate: true });
  assert.deepEqual([...kv._map.keys()].filter((k) => k.startsWith('profile')).sort(), ['profile', ...Array.from({ length: BACKUPS }, (_, i) => `profile.bak${i + 1}`)], 'the save and five backups, no sixth');
  assert.equal(kv._map.get(`profile.bak${BACKUPS}`), 'save 3', 'the oldest kept is five saves back');
  for (const bad of ['a/b', 'a\\b', '/x', 'x/', '..', 'a..b', '']) assert.throws(() => checkName(bad), /Bad file name/, bad);
  await assert.rejects(() => backend.writeBlob('reports', 'a/b.json', 'x'), /Bad file name/);
  checkName('20260902-101500-report.json');
  // A main save that can't be read and can't be set aside (the file is locked), a good backup: the
  // next save rotates (the damaged file is not written over without a copy), and the saves after
  // it don't (a harbor purchase must not push a run's backup out).
  const k2 = memoryKv();
  const a = defaultProfile(); a.stats.runs = 1;
  k2._map.set('profile', 'not a save');
  k2._map.set('profile.bak1', wrap('profile', a, { build: 't' }));
  const store = createStore({ backend: { ...createKvBackend(k2, 'memory'), quarantine: async () => { throw new Error('locked'); } }, build: 't' });
  const load = await store.loadProfile();
  assert.equal(load.doc.stats.runs, 1, 'loaded from the backup');
  assert.ok(load.warnings.some((w) => /the next save will move it into the backups/.test(w)));
  const chain = () => JSON.stringify(Array.from({ length: BACKUPS }, (_, i) => k2._map.get(`profile.bak${i + 1}`) ?? null));
  const before = chain();
  const b = structuredClone(load.doc); b.stats.runs = 2;
  await store.saveProfile(b);
  const afterFirst = chain();
  assert.notEqual(afterFirst, before, 'the first save after an at-risk load rotates');
  for (let n = 3; n < 8; n++) { const c = structuredClone(b); c.stats.runs = n; await store.saveProfile(c); }
  assert.equal(chain(), afterFirst, 'five more plain saves leave the backups alone');
});

test('hash: the one-pass CRC-32 of a string is the CRC-32 of its UTF-8 bytes, for every kind of character', async () => {
  const { crc32, crc32Bytes, utf8, crc32Hex } = await import('../src/lib/hash.js');
  const cases = ['', 'a', 'The quick brown fox', '{"v":4,"profile":{}}', 'é', 'ß∑…', '日本語', '😀', 'a😀b', '\ud83d', '\ude00', 'x\ud83dy', '\ude00\ud83d', '\ud83d😀', '\u0000\u007f\u0080߿ࠀ￿', 'é'.repeat(1000) + '😀'.repeat(500)];
  let s = 1;
  const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
  for (let k = 0; k < 200; k++) cases.push(Array.from({ length: 1 + Math.floor(rnd() * 40) }, () => String.fromCharCode(Math.floor(rnd() * 0x10000))).join(''));
  for (const str of cases) assert.equal(crc32(str), crc32Bytes(utf8(str)), JSON.stringify(str).slice(0, 60));
  // Against Node's own UTF-8 too (what desktop/savefs.cjs hashes), and the known value of "123456789".
  for (const str of cases) assert.equal(crc32(str), crc32Bytes(new Uint8Array(Buffer.from(str, 'utf8'))), JSON.stringify(str).slice(0, 60));
  assert.equal(crc32Hex('123456789'), 'cbf43926');
  // Every fixture save ever shipped still passes its own checksum.
  const { unwrap } = await import('../src/save/envelope.js');
  for (const v of [1, 2, 3, 4]) assert.ok(unwrap(readFileSync(new URL(`./fixtures/saves/profile-v${v}.txt`, import.meta.url), 'utf8'), 'profile').doc);
});

test('saves: the retired lists are not part of a new profile, an old save\'s are mapped and then gone, and one still holding something is left alone', () => {
  const fresh = defaultProfile();
  assert.ok(!('bestiaryClaimed' in fresh.profile) && !('challenges' in fresh.profile) && !('arcana' in fresh.profile.setup));
  const fitted = reconcileProfile(fresh, DATA).doc;
  assert.ok(!('bestiaryClaimed' in fitted.profile) && !('challenges' in fitted.profile) && !('arcana' in fitted.profile.setup));
  // An old save with empty ones (every 0.7.x to 0.9.0 save has them): gone after a load, and a second load changes nothing.
  const old = defaultProfile();
  old.profile.bestiaryClaimed = {}; old.profile.challenges = []; old.profile.setup.arcana = '';
  const once = reconcileProfile(old, DATA).doc;
  assert.ok(!('bestiaryClaimed' in once.profile) && !('challenges' in once.profile) && !('arcana' in once.profile.setup));
  assert.deepEqual(reconcileProfile(once, DATA).doc, once);
  // A save already mapped that an older build then wrote to: what it holds is not deleted.
  const later = structuredClone(once);
  later.profile.bestiaryClaimed = { fog_wisp: 2 };
  later.profile.challenges = ['some_old_run'];
  const kept = reconcileProfile(later, DATA).doc;
  const all = JSON.stringify(kept.profile);
  assert.ok(all.includes('some_old_run') || (kept.profile.feats || []).includes('some_old_run'), 'the win is still in the save (kept, mapped, or set aside)');
});
