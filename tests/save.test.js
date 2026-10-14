import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { createStore, stampName } from '../src/save/store.js';
import { createKvBackend, memoryKv, createDesktopBackend, localStorageKv, BACKUPS } from '../src/save/backends.js';
import { openStore, IDB_MARKER } from '../src/app/platform.js';
import { wrap, unwrap, SaveCorruptError } from '../src/save/envelope.js';
import { migrateProfile, SaveTooNewError, PROFILE_MIGRATIONS } from '../src/save/migrations.js';
import { defaultProfile, defaultSettings, normalizeSettings, PROFILE_VERSION } from '../src/save/schema.js';
import { encodeExportCode, decodeExportCode, CodeError, b64urlEncode, b64urlDecode, summarize } from '../src/save/codec.js';
import { crc32 } from '../src/lib/hash.js';
import { reconcileProfile } from '../src/meta/reconcile.js';
import { profileFromLoad } from '../src/app/profileboot.js';
import { DATA } from '../src/data/index.js';

const require = createRequire(import.meta.url);
const savefs = require('../desktop/savefs.cjs');
const HERE = dirname(fileURLToPath(import.meta.url));

function sampleDoc() {
  const d = defaultProfile();
  d.profile.materials = { oil: 12, drowned_pages: 4 };
  d.profile.buildings = { lamp_post: 2, library: 1 };
  d.stats.runs = 7;
  d.stats.playtimeSec = 3600 * 2.5;
  return d;
}
const memStore = () => { const kv = memoryKv(); return { kv, store: createStore({ backend: createKvBackend(kv, 'memory'), build: 'test', clock: () => '2026-09-27T00:00:00.000Z' }) }; };

test('envelope: round-trips and detects damage', () => {
  const doc = sampleDoc();
  const text = wrap('profile', doc, { build: 'b1', savedAt: 'now' });
  assert.deepEqual(unwrap(text, 'profile').doc, doc);
  const env = JSON.parse(text);
  env.data = env.data.replace('"oil":12', '"oil":99');
  assert.throws(() => unwrap(JSON.stringify(env), 'profile'), SaveCorruptError);
  assert.throws(() => unwrap(text.slice(0, text.length / 2), 'profile'), SaveCorruptError, 'a torn write');
  assert.throws(() => unwrap(text, 'settings'), SaveCorruptError, 'wrong kind');
  assert.throws(() => unwrap('{"format":"other"}', 'profile'), SaveCorruptError);
});

test('store: a fresh install starts a new profile quietly', async () => {
  const { store } = memStore();
  const r = await store.loadProfile();
  assert.equal(r.source, 'new');
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.doc, defaultProfile());
});

test('store: save then load returns the same profile', async () => {
  const { store } = memStore();
  await store.saveProfile(sampleDoc());
  const r = await store.loadProfile();
  assert.equal(r.source, 'main');
  assert.deepEqual(r.doc, sampleDoc());
});

test('store: rotation keeps exactly five backups, newest first', async () => {
  const { store, kv } = memStore();
  for (let i = 1; i <= 8; i++) { const d = sampleDoc(); d.stats.runs = i; await store.saveProfile(d, { rotate: true }); }
  const cands = await createKvBackend(kv, 'memory').readCandidates('profile');
  assert.equal(cands.length, 1 + BACKUPS);
  const runs = cands.map((c) => JSON.parse(JSON.parse(c.text).data).stats.runs);
  assert.deepEqual(runs, [8, 7, 6, 5, 4, 3]);
});

test('store: a damaged main save falls back to the newest good backup, and says so', async () => {
  const { store, kv } = memStore();
  for (let i = 1; i <= 3; i++) { const d = sampleDoc(); d.stats.runs = i; await store.saveProfile(d, { rotate: true }); }
  kv._map.set('profile', '{"format":"lamplight-save","kind":"profile","crc":"00000000","data":"{}"}');
  const r = await store.loadProfile();
  assert.equal(r.source, 'backup1');
  assert.equal(r.doc.stats.runs, 2);
  assert.ok(r.warnings.some((w) => w.includes('restored from backup1')));
});

test('store: when nothing is readable it starts fresh but never deletes the old files', async () => {
  const { store, kv } = memStore();
  kv._map.set('profile', 'garbage');
  kv._map.set('profile.bak1', 'more garbage');
  const r = await store.loadProfile();
  assert.equal(r.source, 'new');
  assert.ok(r.warnings.some((w) => w.includes('old files were kept')));
  assert.equal(kv._map.get('profile'), 'garbage');
  assert.equal(kv._map.get('profile.bak1'), 'more garbage');
});

test('store: a save from a newer build is never replaced by an older backup or overwritten', async () => {
  const { store, kv } = memStore();
  await store.saveProfile(sampleDoc(), { rotate: true });
  await store.saveProfile(sampleDoc(), { rotate: true });
  const future = { ...sampleDoc(), v: PROFILE_VERSION + 1 };
  kv._map.set('profile', wrap('profile', future));
  const r = await store.loadProfile();
  assert.equal(r.tooNew, true);
  assert.equal(r.doc, null);
  await assert.rejects(() => store.saveProfile(sampleDoc()), /newer version/);
});

test('boot: a save from a newer build stops the game with the store\'s sentence; any other load is fitted to this build', async () => {
  const { store, kv } = memStore();
  kv._map.set('profile', wrap('profile', { ...sampleDoc(), v: PROFILE_VERSION + 1 }));
  const stopped = profileFromLoad(await store.loadProfile(), DATA);
  assert.equal(stopped.profile, undefined, 'no profile: a save it can\'t read is never reconciled');
  assert.match(stopped.stop, /^This save is from a newer version of Lamplight \(save version \d+, this version reads up to \d+\)\. Update the game to load it\. The save file hasn't been changed\.$/);
  assert.ok(stopped.notes.some((n) => /newer version/.test(n)), 'and the log keeps it too');
  // An ordinary save: fitted to this build (a material it doesn't know set aside), with the notes.
  const odd = sampleDoc();
  odd.profile.materials.moonstone = 3;
  const { store: s2 } = memStore();
  await s2.saveProfile(odd);
  const ok = profileFromLoad(await s2.loadProfile(), DATA);
  assert.equal(ok.stop, undefined);
  assert.equal(ok.profile.profile.materials.moonstone, undefined);
  assert.equal(ok.profile.profile.orphans.materials.moonstone, 3);
  assert.ok(ok.notes.some((n) => n === 'Stored content this version doesn\'t have: materials:moonstone.'), ok.notes.join(' | '));
  // A save holding something set aside that this build knows again: it comes back, and the log says so.
  const back = sampleDoc();
  back.profile.orphans = { materials: { rum: 6 } };
  const { store: s4 } = memStore();
  await s4.saveProfile(back);
  const restored = profileFromLoad(await s4.loadProfile(), DATA);
  assert.equal(restored.profile.profile.materials.rum, 6);
  assert.ok(restored.notes.some((n) => n === 'Restored content this version has again: materials:rum.'), restored.notes.join(' | '));
  // A new profile (nothing saved yet) starts as it is.
  const { store: s3 } = memStore();
  assert.deepEqual(profileFromLoad(await s3.loadProfile(), DATA).profile, reconcileProfile(defaultProfile(), DATA).doc);
});

test('store: a number stored as text is read as the number, not reset', async () => {
  const { store, kv } = memStore();
  const d = sampleDoc();
  d.stats.runs = '12'; d.stats.bestTimeSec = ' 900 '; d.stats.kills = 'lots';
  kv._map.set('profile', wrap('profile', d));
  const r = await store.loadProfile();
  assert.equal(r.doc.stats.runs, 12);
  assert.equal(r.doc.stats.bestTimeSec, 900);
  assert.equal(r.doc.stats.kills, 0, 'text that isn\'t a number is repaired to the default');
  assert.ok(r.warnings.some((w) => /stats\.runs \(read as a number\)/.test(w)));
});

test('store: repairs missing fields in a hand-damaged but valid save', async () => {
  const { store, kv } = memStore();
  const d = sampleDoc();
  delete d.profile.research;
  d.stats.kills = 'lots';
  kv._map.set('profile', wrap('profile', d));
  const r = await store.loadProfile();
  assert.deepEqual(r.doc.profile.research, defaultProfile().profile.research);
  assert.equal(r.doc.stats.kills, 0);
  assert.equal(r.doc.profile.materials.oil, 12, 'real progress untouched');
  assert.ok(r.warnings.some((w) => w.startsWith('Save repaired')));
});

test('settings: normalization drops junk and keeps valid choices', async () => {
  assert.deepEqual(normalizeSettings(null), defaultSettings());
  const n = normalizeSettings({ display: { mode: 'exclusive', fillScreen: true }, audio: { master: 5, sfx: 0.3 }, controls: { prompts: 'xbox', deadzone: -1 }, extra: 1 });
  assert.equal(n.display.mode, 'fullscreen');
  assert.equal(n.display.fillScreen, true);
  assert.equal(n.audio.master, 0.8);
  assert.equal(n.audio.sfx, 0.3);
  assert.equal(n.controls.prompts, 'xbox');
  assert.equal(n.controls.deadzone, 0.2);
  assert.equal('extra' in n, false);
  const { store } = memStore();
  await store.saveSettings({ ...defaultSettings(), audio: { master: 0.5, music: 0.1, sfx: 1 } });
  assert.equal((await store.loadSettings()).audio.master, 0.5);
});

test('migrations: the table matches the version; bad and future docs are refused', () => {
  assert.equal(PROFILE_MIGRATIONS.length, PROFILE_VERSION - 1);
  assert.throws(() => migrateProfile({}), /Not a Lamplight profile/);
  assert.throws(() => migrateProfile({ v: 0 }), /Not a Lamplight profile/);
  assert.throws(() => migrateProfile({ v: PROFILE_VERSION + 1, profile: {} }), SaveTooNewError);
  const input = sampleDoc();
  const { doc } = migrateProfile(input);
  assert.notEqual(doc, input, 'migration never mutates its input');
});

test('migrations: every fixture save ever shipped still loads (kept forever)', async () => {
  const dir = join(HERE, 'fixtures', 'saves');
  const files = readdirSync(dir).filter((f) => f.startsWith('profile-v'));
  assert.ok(files.length >= 1, 'at least one fixture');
  const versions = new Set();
  for (const f of files) {
    const { doc } = unwrap(readFileSync(join(dir, f), 'utf8'), 'profile');
    versions.add(doc.v);
    const { doc: m } = migrateProfile(doc);
    assert.equal(m.v, PROFILE_VERSION, f);
    assert.ok(m.profile && m.stats, f);
    assert.ok(Object.keys(m.profile.materials).length > 0, `${f}: progress survived`);
    // Then fitted to this build as the game loads it: the full shape, and every count it held.
    const { doc: r } = reconcileProfile(m, DATA);
    const shape = defaultProfile();
    for (const [k, v] of Object.entries(shape.profile)) {
      assert.equal(Array.isArray(r.profile[k]), Array.isArray(v), `${f}: profile.${k} is ${Array.isArray(v) ? 'a list' : 'an object'}`);
      assert.equal(typeof r.profile[k], typeof v, `${f}: profile.${k}`);
    }
    for (const k of Object.keys(shape.stats)) assert.ok(Number.isInteger(r.stats[k]) && r.stats[k] >= 0, `${f}: stats.${k}`);
    for (const [id, n] of Object.entries(doc.profile.materials)) {
      if (DATA.materials.some((x) => x.id === id)) assert.equal(r.profile.materials[id], n, `${f}: ${id} kept`);
      else assert.equal(r.profile.orphans.materials[id], n, `${f}: ${id} set aside, not lost`);
    }
    for (const [id, lv] of Object.entries(doc.profile.buildings || {})) if (DATA.buildings.some((b) => b.id === id)) assert.equal(r.profile.buildings[id], lv, `${f}: ${id} level kept`);
    assert.ok(Array.isArray(r.profile.research.done) && Array.isArray(r.profile.research.active), f);
    for (const a of r.profile.research.active) assert.ok(typeof a.id === 'string' && Number.isInteger(a.runsLeft) && a.runsLeft >= 1, `${f}: ${JSON.stringify(a)}`);
    // Everything else it held survives too (§12.2: an update never wipes progress): lifetime
    // numbers, kill counts, upgrade ranks, research (done or running, here or set aside), the
    // codex, the characters' own progress, and the flags.
    assert.deepEqual(r.stats, doc.stats, `${f}: lifetime numbers`);
    const O = r.profile.orphans;
    for (const [id, n] of Object.entries(doc.profile.bestiary || {})) {
      assert.equal(DATA.enemies.some((e) => e.id === id) ? r.profile.bestiary[id] : O.bestiary?.[id], n, `${f}: ${n} ${id} kills kept`);
    }
    for (const [id, n] of Object.entries(doc.profile.upgrades || {})) assert.equal(r.profile.upgrades[id] ?? O.upgrades?.[id], n, `${f}: ${id} rank kept`);
    for (const id of doc.profile.research.done) assert.ok(r.profile.research.done.includes(id) || O.research?.[id] === 'done', `${f}: ${id} done, kept`);
    for (const a of doc.profile.research.active) {
      const here = r.profile.research.active.find((x) => x.id === a.id), aside = O.research?.[a.id];
      assert.ok((here && here.runsLeft === a.runsLeft) || aside?.runsLeft === a.runsLeft, `${f}: ${a.id} still running with ${a.runsLeft} to go`);
    }
    for (const k of doc.profile.codex) assert.ok(r.profile.codex.includes(k) || O.codex?.includes(k), `${f}: codex ${k} kept`);
    assert.deepEqual(r.profile.characters, doc.profile.characters, `${f}: characters' progress`);
    assert.deepEqual(r.profile.flags, doc.profile.flags, `${f}: flags`);
  }
  for (let v = 1; v <= PROFILE_VERSION; v++) assert.ok(versions.has(v), `missing fixture for profile v${v}`);
});

test('codec: export codes round-trip, tolerate line breaks, and reject damage', () => {
  const doc = sampleDoc();
  const code = encodeExportCode(doc);
  assert.match(code, /^LAMP1\.[A-Za-z0-9_-]+\.[0-9a-f]{8}$/);
  assert.deepEqual(decodeExportCode(code), doc);
  const wrapped = code.match(/.{1,40}/g).join('\n  ');
  assert.deepEqual(decodeExportCode(wrapped), doc);
  const mid = Math.floor(code.length / 2);
  const flipped = code.slice(0, mid) + (code[mid] === 'A' ? 'B' : 'A') + code.slice(mid + 1);
  assert.throws(() => decodeExportCode(flipped), CodeError);
  assert.throws(() => decodeExportCode('hello'), /start with LAMP1/);
  assert.throws(() => decodeExportCode('LAMP2.abc.00000000'), /newer version/);
  assert.throws(() => decodeExportCode(code.split('.').slice(0, 2).join('.')), /incomplete/);
  assert.throws(() => decodeExportCode('LAMP1.a$b.00000000'), CodeError);
  assert.throws(() => decodeExportCode(42), CodeError);
});

test('codec: pasted extras are handled plainly (quotes and a full stop pass; real junk is named)', () => {
  const doc = sampleDoc();
  const code = encodeExportCode(doc);
  assert.deepEqual(decodeExportCode(`"${code}".`), doc, 'quotes and a sentence full stop around the code');
  assert.deepEqual(decodeExportCode(`\u201c${code}\u201d`), doc, 'curly quotes from a chat app');
  const [p, body, crc] = code.split('.');
  assert.deepEqual(decodeExportCode(`${p}.${body}.${crc.toUpperCase()}`), doc, 'checksum case does not matter');
  assert.throws(() => decodeExportCode(`${code}.LAMP1`), /extra characters at the end/);
  assert.throws(() => decodeExportCode(`${code}zz`), /extra characters at the end/);
  assert.throws(() => decodeExportCode(`${code.slice(0, -3)}`), /incomplete/);
});

test('codec: base64url matches a reference implementation for every length 0..40', () => {
  for (let n = 0; n <= 40; n++) {
    const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + n * 11) & 255);
    const enc = b64urlEncode(bytes);
    assert.equal(enc, Buffer.from(bytes).toString('base64url'));
    assert.deepEqual([...b64urlDecode(enc)], [...bytes]);
  }
});

test('codec: import preview migrates and summarizes; apply keeps the old save as a backup', async () => {
  const { store, kv } = memStore();
  const original = sampleDoc();
  original.stats.runs = 1;
  await store.saveProfile(original);
  const incoming = sampleDoc();
  const { doc, summary } = store.previewImport(store.exportCode(incoming));
  assert.equal(summary.runs, 7);
  assert.equal(summary.hours, 2.5);
  assert.equal(summary.buildings, 2);
  assert.equal(summary.buildingLevels, 3);
  await store.applyImport(doc);
  const cands = await createKvBackend(kv, 'memory').readCandidates('profile');
  assert.equal(JSON.parse(JSON.parse(cands[0].text).data).stats.runs, 7);
  assert.equal(cands[1].source, 'backup1');
  assert.equal(JSON.parse(JSON.parse(cands[1].text).data).stats.runs, 1);
  assert.equal(summarize({ v: 1, profile: {} }).runs, 0);
});

test('blobs: replays keep the newest 3, reports the newest 20; names are sanitized', async () => {
  const kv = memoryKv();
  const be = createKvBackend(kv, 'memory');
  for (let i = 0; i < 6; i++) await be.writeBlob('replays', `2026092${i}-run.lamprep`, new Uint8Array([i]));
  const keys = (await kv.keys()).filter((k) => k.startsWith('replays/')).sort();
  assert.deepEqual(keys, ['replays/20260923-run.lamprep', 'replays/20260924-run.lamprep', 'replays/20260925-run.lamprep']);
  await assert.rejects(() => be.writeBlob('replays', '../evil', 'x'));
  await assert.rejects(() => be.writeBlob('nowhere', 'a.txt', 'x'));
  assert.match(stampName('run.lamprep', new Date(Date.UTC(2026, 8, 27, 15, 30, 12))), /^20260927-153012-run\.lamprep$/);
});

test('desktop bridge backend forwards calls and validates names', async () => {
  const calls = [];
  const native = {
    readSave: async (k) => { calls.push(['read', k]); return [{ text: 'x', source: 'main' }]; },
    writeSave: async (k, t, o) => { calls.push(['write', k, o.rotate]); },
    writeReplay: async (n) => { calls.push(['replay', n]); return 'path'; },
    writeReport: async (n) => { calls.push(['report', n]); return 'path'; },
  };
  const be = createDesktopBackend(native);
  await be.readCandidates('profile');
  await be.write('settings', 'x', { rotate: false });
  await be.writeBlob('replays', 'a.lamprep', new Uint8Array(1));
  await be.writeBlob('reports', 'b.txt', 'hi');
  assert.deepEqual(calls, [['read', 'profile'], ['write', 'settings', false], ['replay', 'a.lamprep'], ['report', 'b.txt']]);
  await assert.rejects(() => be.readCandidates('passwords'));
  assert.throws(() => createDesktopBackend(null));
});

test('desktop files: atomic writes, 5-deep rotation, and fallback reading on a real disk', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lamplight-save-'));
  try {
    for (let i = 1; i <= 7; i++) {
      savefs.writeSave(dir, 'profile', wrap('profile', { ...sampleDoc(), stats: { ...sampleDoc().stats, runs: i } }), { rotate: true });
    }
    const names = readdirSync(dir).sort();
    assert.deepEqual(names, ['profile.bak1.json', 'profile.bak2.json', 'profile.bak3.json', 'profile.bak4.json', 'profile.bak5.json', 'profile.json']);
    assert.ok(!names.some((n) => n.endsWith('.tmp')), 'no temp files left behind');
    // Damage the main file: the store (fed by the real files) falls back to backup1.
    writeFileSync(join(dir, 'profile.json'), '{"torn":');
    const native = {
      readSave: async (k) => savefs.readCandidates(dir, k),
      writeSave: async (k, t, o) => savefs.writeSave(dir, k, t, o),
    };
    const store = createStore({ backend: createDesktopBackend(native) });
    const r = await store.loadProfile();
    assert.equal(r.source, 'backup1');
    assert.equal(r.doc.stats.runs, 6);
    assert.throws(() => savefs.writeSave(dir, 'secrets', 'x'));
    assert.throws(() => savefs.writeSave(dir, 'profile', 42));
    // Blobs keep the newest N.
    for (let i = 0; i < 5; i++) savefs.writeBlob(dir, 'replays', `2026090${i}-r.lamprep`, new Uint8Array([1, 2, 3]), 3);
    assert.deepEqual(readdirSync(join(dir, 'replays')).sort(), ['20260902-r.lamprep', '20260903-r.lamprep', '20260904-r.lamprep']);
    assert.throws(() => savefs.writeBlob(dir, 'replays', '..\\evil', 'x', 3));
    // Settings are readable synchronously at startup, and a damaged file gives null, not a crash.
    savefs.writeSave(dir, 'settings', wrap('settings', { ...defaultSettings(), display: { mode: 'windowed', fillScreen: false } }));
    assert.equal(savefs.readSettingsSync(dir).display.mode, 'windowed');
    writeFileSync(join(dir, 'settings.json'), 'nope');
    assert.equal(savefs.readSettingsSync(dir), null);
    assert.equal(existsSync(join(dir, 'settings.json')), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('desktop CRC matches the game CRC byte for byte', () => {
  for (const s of ['', 'a', '123456789', '€ and 😀', 'lone \ud800 surrogate', JSON.stringify(sampleDoc())]) assert.equal(savefs.crc32(s), crc32(s));
});

// ---------------------------------------------------------------- judge round 1 fixes
const envOf = (runs) => { const d = sampleDoc(); d.stats.runs = runs; return wrap('profile', d); };
const runsOf = (text) => JSON.parse(JSON.parse(text).data).stats.runs;

test('store: after restoring from a backup, the first save cannot destroy the unreadable newer save', async () => {
  const { store, kv } = memStore();
  kv._map.set('profile.bak1', envOf(1));
  const newest = envOf(2).replace('"crc":"', '"crc":"0'); // run 2, damaged (a future migration bug would look the same)
  kv._map.set('profile', newest);
  const r = await store.loadProfile();
  assert.equal(r.source, 'backup1');
  assert.ok(r.quarantined && r.quarantined.startsWith('profile.unreadable-'));
  assert.equal(kv._map.get(r.quarantined), newest, 'the damaged newest save is kept byte for byte');
  await store.saveProfile(r.doc); // an ordinary hub-action save, rotate: false
  assert.equal(kv._map.get(r.quarantined), newest, 'still there after the next save');
  assert.equal(runsOf(kv._map.get('profile.bak1')), 1, 'backups untouched');
});

test('store: a main save that exists but cannot be read is never overwritten', async () => {
  const kv = memoryKv();
  kv._map.set('profile.bak1', envOf(1));
  const realGet = kv.get;
  kv.get = async (k) => { if (k === 'profile') throw new Error('locked'); return realGet(k); };
  kv._map.set('profile', envOf(9));
  const store = createStore({ backend: createKvBackend(kv, 'memory') });
  const r = await store.loadProfile();
  assert.equal(r.source, 'backup1');
  assert.ok(r.warnings.some((w) => w.includes('locked')));
  // The file stays unreadable, so quarantine fails and the next save must rotate, which also
  // needs to read it: the save fails loudly instead of overwriting.
  await assert.rejects(() => store.saveProfile(r.doc));
  assert.equal(runsOf(kv._map.get('profile')), 9, 'the unreadable save was not overwritten');
});

test('store: overlapping saves are applied in the order they were made', async () => {
  const kv = memoryKv();
  const slowSet = kv.set;
  kv.set = async (k, v) => { await new Promise((res) => setTimeout(res, k === 'profile' && v.includes('"runs":1,') ? 30 : 1)); return slowSet(k, v); };
  const store = createStore({ backend: createKvBackend(kv, 'memory') });
  const a = sampleDoc(); a.stats.runs = 1;
  const b = sampleDoc(); b.stats.runs = 2;
  const p1 = store.saveProfile(a, { rotate: true }); // run-end save, slow
  const p2 = store.saveProfile(b);                   // hub action right after, fast
  await Promise.all([p1, p2]);
  assert.equal(runsOf(kv._map.get('profile')), 2, 'the later save wins');
});

test('store: importing over a newer-version save quarantines it first', async () => {
  const { store, kv } = memStore();
  const future = wrap('profile', { ...sampleDoc(), v: PROFILE_VERSION + 1 });
  kv._map.set('profile', future);
  const r = await store.loadProfile();
  assert.equal(r.tooNew, true);
  const { doc } = store.previewImport(store.exportCode(sampleDoc()));
  await store.applyImport(doc);
  const kept = [...kv._map.entries()].find(([k]) => k.startsWith('profile.unreadable-'));
  assert.ok(kept, 'the newer save was set aside');
  assert.equal(kept[1], future);
  assert.equal(runsOf(kv._map.get('profile')), 7);
  await store.saveProfile(doc); // normal saving resumes after the import
});

test('store: rotation never leaves the same save in two backup slots', async () => {
  const kv = memoryKv();
  const be = createKvBackend(kv, 'memory');
  kv._map.set('profile', envOf(10));
  kv._map.set('profile.bak1', envOf(9));
  kv._map.set('profile.bak3', envOf(7)); // a gap at bak2
  await be.write('profile', envOf(11), { rotate: true });
  const texts = [];
  for (let i = 1; i <= BACKUPS; i++) { const t = kv._map.get(`profile.bak${i}`); if (t) texts.push(runsOf(t)); }
  assert.deepEqual(texts, [10, 9, 7]);
  assert.equal(new Set(texts).size, texts.length);
});

test('migrations: a two-step chain runs in order; a bad step is caught; too-new is relative to the table', () => {
  const m1 = (d) => ({ ...d, v: 2, profile: { ...d.profile, renamed: d.profile.old } });
  const m2 = (d) => ({ ...d, v: 3, profile: { ...d.profile, count: (d.profile.renamed || 0) + 1 } });
  const { doc, steps } = migrateProfile({ v: 1, profile: { old: 4 } }, [m1, m2]);
  assert.equal(doc.v, 3);
  assert.equal(steps, 2);
  assert.equal(doc.profile.count, 5);
  assert.equal(migrateProfile({ v: 2, profile: { renamed: 1 } }, [m1, m2]).steps, 1);
  assert.throws(() => migrateProfile({ v: 1, profile: {} }, [(d) => ({ ...d, v: 3 }), m2]), /did not produce v2/);
  assert.throws(() => migrateProfile({ v: 4, profile: {} }, [m1, m2]), SaveTooNewError);
});

test('repair: nested fields are repaired at every depth without touching good values', async () => {
  const { store, kv } = memStore();
  const d = sampleDoc();
  d.profile.research = {};
  d.profile.gear = { inventory: 'nope', equipped: { lantern: 'x' } };
  d.profile.tide = { unlocked: NaN, selected: 2 };
  kv._map.set('profile', wrap('profile', d));
  const r = await store.loadProfile();
  assert.deepEqual(r.doc.profile.research, defaultProfile().profile.research);
  assert.deepEqual(r.doc.profile.gear.inventory, []);
  assert.deepEqual(r.doc.profile.gear.equipped, { lantern: 'x' });
  assert.equal(r.doc.profile.tide.unlocked, 0);
  assert.equal(r.doc.profile.tide.selected, 2);
  assert.ok(r.warnings.some((w) => w.includes('profile.research.done')));
});

test('settings: borderless is a valid display mode', () => {
  assert.equal(normalizeSettings({ display: { mode: 'borderless' } }).display.mode, 'borderless');
});

test('localStorage backend: text and bytes both round-trip; only its own keys are listed', async () => {
  const m = new Map();
  const fake = {
    getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k),
    key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; },
  };
  m.set('other-app', 'x');
  const kv = localStorageKv('lamplight:', fake);
  await kv.set('a', 'text');
  await kv.set('b', new Uint8Array([0, 1, 254, 255]));
  assert.equal(await kv.get('a'), 'text');
  assert.deepEqual([...(await kv.get('b'))], [0, 1, 254, 255]);
  assert.deepEqual((await kv.keys()).sort(), ['a', 'b']);
  assert.throws(() => localStorageKv('x', null));
});

test('platform: storage falls back IndexedDB -> localStorage -> memory, and says so', async () => {
  let persisted = 0;
  const m = new Map();
  const fakeLs = {
    getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k),
    key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; },
  };
  const a = await openStore({ indexedDB: undefined, localStorage: fakeLs, navigator: { storage: { persist: async () => { persisted++; return true; } } } });
  assert.equal(a.store.label, 'web-local');
  assert.match(a.note, /local storage/);
  assert.equal(persisted, 1, 'asked the browser to keep the save');
  const b = await openStore({ indexedDB: undefined, localStorage: undefined });
  assert.equal(b.store.label, 'memory');
  assert.match(b.note, /lost when the tab closes/);
  const native = { platform: 'desktop', readSave: async () => [], writeSave: async () => {}, writeReplay: async () => '', writeReport: async () => '', quarantineSave: async () => null };
  const c = await openStore({ lamplightNative: native });
  assert.equal(c.store.label, 'desktop');
  assert.equal(c.note, null);
});

test('store backends: quarantining the same unreadable save twice keeps one copy; a different one gets its own', async () => {
  const kv = memoryKv();
  const t = new Date(Date.UTC(2026, 8, 27, 12, 0, 0));
  const b = createKvBackend(kv, 'memory', { clock: () => t });
  kv._map.set('profile', 'broken-1');
  const q1 = await b.quarantine('profile');
  assert.equal(await b.quarantine('profile'), q1, 'same bytes: the existing copy');
  kv._map.set('profile', 'broken-2');
  const q2 = await b.quarantine('profile');
  assert.notEqual(q2, q1, 'same second, different save: a second name');
  assert.equal(kv._map.get(q1), 'broken-1');
  assert.equal(kv._map.get(q2), 'broken-2');
  assert.equal([...kv._map.keys()].filter((k) => k.startsWith('profile.unreadable-')).length, 2);
});

test('desktop files: quarantine keeps one copy per distinct save, and a locked read waits once', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lamplight-q-'));
  try {
    const t = new Date(Date.UTC(2026, 8, 27, 12, 0, 0));
    writeFileSync(join(dir, 'profile.json'), 'broken-1');
    const q1 = savefs.quarantine(dir, 'profile', t);
    assert.equal(savefs.quarantine(dir, 'profile', t), q1, 'same bytes: the existing copy');
    writeFileSync(join(dir, 'profile.json'), 'broken-2');
    const q2 = savefs.quarantine(dir, 'profile', t);
    assert.equal(q2, 'profile.unreadable-20260927-120000-2.json', 'same second, different save: a second name');
    assert.equal(readFileSync(join(dir, q1), 'utf8'), 'broken-1');
    assert.equal(readFileSync(join(dir, q2), 'utf8'), 'broken-2');
    // Reads block the main process, so a locked read retries once, briefly, then reports an error.
    const realFs = require('node:fs');
    const waits = [];
    const locked = { ...realFs, readFileSync: (p, enc) => { if (String(p).endsWith('profile.json')) { const e = new Error('no'); e.code = 'EBUSY'; throw e; } return realFs.readFileSync(p, enc); } };
    const c = savefs.create(locked, (ms) => waits.push(ms)).readCandidates(dir, 'profile');
    assert.deepEqual(waits, savefs.READ_WAITS_MS);
    assert.ok(waits.reduce((a, b) => a + b, 0) <= 100, 'at most 100 ms of waiting per file');
    assert.match(c[0].error, /EBUSY/);
    assert.throws(() => savefs.create(locked, () => {}).quarantine(dir, 'profile', t), /no/, 'an unreadable main save makes quarantine fail loudly (the store then rotates it)');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A just-enough IndexedDB double over a Map: open() succeeds (or fails) on the next microtask;
// requests succeed on a microtask and each transaction completes on the next macrotask.
function fakeIdb({ fail = false, data = new Map() } = {}) {
  return {
    data,
    open() {
      const req = {};
      queueMicrotask(() => {
        if (fail) { req.error = new Error('UnknownError opening backing store'); req.onerror?.(); return; }
        req.result = {
          objectStoreNames: { contains: () => true },
          transaction() {
            const t = {};
            const reqOf = (fn) => { const r = {}; queueMicrotask(() => { r.result = fn(); r.onsuccess?.(); }); return r; };
            t.objectStore = () => ({
              get: (k) => reqOf(() => data.get(k)),
              put: (v, k) => reqOf(() => { data.set(k, v); }),
              delete: (k) => reqOf(() => { data.delete(k); }),
              getAllKeys: () => reqOf(() => [...data.keys()]),
            });
            setTimeout(() => t.oncomplete?.(), 0);
            return t;
          },
        };
        req.onsuccess?.();
      });
      return req;
    },
  };
}
function fakeLocalStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k),
    key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; }, _map: m,
  };
}

test('platform: once the profile lives in IndexedDB, a failed open never starts a fresh save somewhere else', async () => {
  const ls = fakeLocalStorage();
  const idb = fakeIdb();
  const ok = await openStore({ indexedDB: idb, localStorage: ls });
  assert.equal(ok.store.label, 'web');
  assert.equal(ls.getItem(IDB_MARKER), null, 'opening alone marks nothing: no save exists yet');
  await ok.store.saveSettings(defaultSettings());
  assert.equal(ls.getItem(IDB_MARKER), null, 'settings are not the saved game');
  await ok.store.saveProfile(sampleDoc());
  assert.equal(ls.getItem(IDB_MARKER), '1', 'marked on the first profile save');
  assert.equal(typeof idb.data.get('profile'), 'string');
  const bad = await openStore({ indexedDB: fakeIdb({ fail: true }), localStorage: ls });
  assert.equal(bad.store.label, 'memory', 'not localStorage: that would look like a new game');
  assert.equal(bad.loud, true, 'shown on screen, not only in the overlay');
  assert.match(bad.note, /couldn't be opened/);
  assert.deepEqual([...ls._map.keys()], [IDB_MARKER], 'nothing written beside the real save');
  // A profile already in IndexedDB (the marker lost somehow) is marked again on open.
  const ls3 = fakeLocalStorage();
  await openStore({ indexedDB: fakeIdb({ data: new Map(idb.data) }), localStorage: ls3 });
  assert.equal(ls3.getItem(IDB_MARKER), '1');
  // A first launch that never saved, then a failed open: localStorage, quietly.
  const ls4 = fakeLocalStorage();
  await openStore({ indexedDB: fakeIdb(), localStorage: ls4 });
  const later = await openStore({ indexedDB: fakeIdb({ fail: true }), localStorage: ls4 });
  assert.equal(later.store.label, 'web-local');
  assert.equal(later.loud, false);
  // The smoke test's own save space ignores the marker and never sets it.
  const ls2 = fakeLocalStorage();
  const smoke = await openStore({ indexedDB: fakeIdb(), localStorage: ls2 }, { namespace: 'smoke' });
  await smoke.store.saveProfile(sampleDoc());
  assert.equal(ls2.getItem(IDB_MARKER), null);
  const smokeBad = await openStore({ indexedDB: fakeIdb({ fail: true }), localStorage: ls }, { namespace: 'smoke' });
  assert.equal(smokeBad.store.label, 'web-local');
});

test('desktop files: locked renames are retried; a rename that keeps failing leaves the old save intact', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lamplight-lock-'));
  try {
    const realFs = require('node:fs');
    let fails = 2;
    const flaky = { ...realFs, renameSync: (a, b) => { if (fails-- > 0) { const e = new Error('busy'); e.code = 'EPERM'; throw e; } return realFs.renameSync(a, b); } };
    const waits = [];
    const fsA = savefs.create(flaky, (ms) => waits.push(ms));
    fsA.writeSave(dir, 'profile', envOf(1));
    assert.equal(runsOf(readFileSync(join(dir, 'profile.json'), 'utf8')), 1);
    assert.equal(waits.length, 2, 'retried twice, then succeeded');
    const broken = { ...realFs, renameSync: () => { const e = new Error('locked'); e.code = 'EBUSY'; throw e; } };
    const fsB = savefs.create(broken, () => {});
    assert.throws(() => fsB.writeSave(dir, 'profile', envOf(2)), /locked/);
    assert.equal(runsOf(readFileSync(join(dir, 'profile.json'), 'utf8')), 1, 'old save untouched');
    assert.equal(existsSync(join(dir, 'profile.json.tmp')), false, 'temp file cleaned up');
    // A read that stays locked is reported as an error entry, never as "missing".
    const locked = { ...realFs, readFileSync: (p, enc) => { if (String(p).endsWith('profile.json')) { const e = new Error('no'); e.code = 'EACCES'; throw e; } return realFs.readFileSync(p, enc); } };
    const c = savefs.create(locked, () => {}).readCandidates(dir, 'profile');
    assert.equal(c[0].source, 'main');
    assert.match(c[0].error, /EACCES/);
    // Quarantine copies the main save aside.
    const q = savefs.quarantine(dir, 'profile', new Date(Date.UTC(2026, 8, 27, 12, 0, 0)));
    assert.equal(q, 'profile.unreadable-20260927-120000.json');
    assert.equal(readFileSync(join(dir, q), 'utf8'), readFileSync(join(dir, 'profile.json'), 'utf8'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
