// File operations for the desktop build's main process. Plain Node, no Electron, so the tests
// can exercise it directly (every function takes an injectable fs for failure tests).
//
// The main process never interprets save contents. It moves bytes safely:
// - writes are atomic (temp file, flush to disk, rename over the old file), so a crash or power
//   cut mid-write leaves either the old save or the new one, never half of each;
// - Windows antivirus and sync tools briefly lock fresh files; locked reads and renames are
//   retried (writes for about a second, reads once) before giving up, and giving up never loses
//   the old file;
// - at run ends the current save is copied into a 5-deep backup chain before it is replaced;
// - reads return the main file and every backup, newest first; a file that exists but can't be
//   read comes back as an error entry (not "missing"), so the game never treats it as absent;
// - quarantine() copies a save the game couldn't read to profile.unreadable-<time>.json, where
//   no later save or rotation can touch it.
'use strict';

const nodeFs = require('fs');
const path = require('path');

const BACKUPS = 5;
const KINDS = new Set(['profile', 'settings']);
const NAME_RE = /^[A-Za-z0-9._-]{1,80}$/;
const MAX_TEXT = 32 * 1024 * 1024;
const RETRY_CODES = new Set(['EBUSY', 'EPERM', 'EACCES']);
// Waiting blocks the main process (and with it every window), so reads retry once, briefly: a
// read that stays locked comes back as an error entry and the game falls back to a backup.
// Writes wait longer, because giving up on a write means the save doesn't happen.
const RETRY_WAITS_MS = [30, 60, 120, 250, 500];
const READ_WAITS_MS = [50];

function checkKind(kind) {
  if (!KINDS.has(kind)) throw new Error(`Unknown save kind: ${kind}`);
}
function checkName(name) {
  if (typeof name !== 'string' || !NAME_RE.test(name) || name.includes('..')) throw new Error(`Bad file name: ${name}`);
}
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Run fn, retrying while it fails with a transient lock error. */
function withRetry(fn, sleep = sleepSync, waits = RETRY_WAITS_MS) {
  for (let i = 0; ; i++) {
    try { return fn(); } catch (e) {
      if (!RETRY_CODES.has(e && e.code) || i >= waits.length) throw e;
      sleep(waits[i]);
    }
  }
}

function mainFile(dir, kind) { return path.join(dir, `${kind}.json`); }
function backupFile(dir, kind, i) { return path.join(dir, `${kind}.bak${i}.json`); }

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

function create(fs = nodeFs, sleep = sleepSync) {
  function writeAtomic(file, data) {
    const tmp = `${file}.tmp`;
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeSync(fd, typeof data === 'string' ? data : Buffer.from(data));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    try {
      withRetry(() => fs.renameSync(tmp, file), sleep); // replaces the old file in one step
    } catch (e) {
      try { fs.unlinkSync(tmp); } catch { /* leave it; it's harmless */ }
      throw e;
    }
  }

  function rotateBackups(dir, kind) {
    const main = mainFile(dir, kind);
    if (!fs.existsSync(main)) return;
    // Shift bakN -> bakN+1, oldest first. A gap moves down too (the slot is emptied), so the
    // chain never holds two copies of the same save.
    for (let i = BACKUPS - 1; i >= 1; i--) {
      const from = backupFile(dir, kind, i);
      const to = backupFile(dir, kind, i + 1);
      if (fs.existsSync(from)) withRetry(() => fs.renameSync(from, to), sleep);
      else if (fs.existsSync(to)) withRetry(() => fs.unlinkSync(to), sleep);
    }
    withRetry(() => fs.copyFileSync(main, backupFile(dir, kind, 1)), sleep);
  }

  function readCandidates(dir, kind) {
    checkKind(kind);
    const out = [];
    const files = [[mainFile(dir, kind), 'main']];
    for (let i = 1; i <= BACKUPS; i++) files.push([backupFile(dir, kind, i), `backup${i}`]);
    for (const [file, source] of files) {
      try {
        out.push({ text: withRetry(() => fs.readFileSync(file, 'utf8'), sleep, READ_WAITS_MS), source });
      } catch (e) {
        if (e && e.code === 'ENOENT') continue; // missing is fine
        out.push({ source, error: `${e && e.code ? e.code : 'ERROR'}: could not read ${path.basename(file)}` });
      }
    }
    return out;
  }

  function writeSave(dir, kind, text, opts = {}) {
    checkKind(kind);
    if (typeof text !== 'string') throw new Error('Save text must be a string');
    if (text.length > MAX_TEXT) throw new Error('Save text is too large');
    fs.mkdirSync(dir, { recursive: true });
    if (opts.rotate) rotateBackups(dir, kind);
    writeAtomic(mainFile(dir, kind), text);
  }

  /**
   * Copy the main save aside so nothing can overwrite it. Returns the file name it is kept under
   * (an existing copy if this exact save was already set aside), or null if there is no main save.
   * Throws if the main save can't be read; the game then treats it as at risk and rotates it
   * into the backups instead of writing over it.
   */
  function quarantine(dir, kind, when = new Date()) {
    checkKind(kind);
    const main = mainFile(dir, kind);
    if (!fs.existsSync(main)) return null;
    const bytes = withRetry(() => fs.readFileSync(main), sleep, READ_WAITS_MS);
    const prefix = `${kind}.unreadable-`;
    const existing = fs.readdirSync(dir).filter((n) => n.startsWith(prefix) && n.endsWith('.json'));
    for (const n of existing) {
      try {
        const p = path.join(dir, n);
        if (fs.statSync(p).size === bytes.length && fs.readFileSync(p).equals(bytes)) return n;
      } catch { /* unreadable copy: make a fresh one */ }
    }
    const base = `${prefix}${stamp(when)}`;
    let name = `${base}.json`;
    for (let n = 2; existing.includes(name); n++) name = `${base}-${n}.json`;
    writeAtomic(path.join(dir, name), bytes);
    return name;
  }

  /** Write a replay or report into a subfolder, keeping only the newest `keep` files. */
  function writeBlob(dir, folder, name, data, keep) {
    checkName(name);
    if (!(data instanceof Uint8Array) && typeof data !== 'string') throw new Error('Replays and reports must be bytes or text');
    if (data.length > MAX_TEXT) throw new Error('That file is too large');
    const sub = path.join(dir, folder);
    fs.mkdirSync(sub, { recursive: true });
    const file = path.join(sub, name);
    writeAtomic(file, data);
    const names = fs.readdirSync(sub).filter((n) => !n.endsWith('.tmp')).sort(); // timestamped: oldest first
    for (let i = 0; i < names.length - keep; i++) {
      try { fs.unlinkSync(path.join(sub, names[i])); } catch { /* best effort */ }
    }
    return file;
  }

  /** Read settings.json synchronously at startup (the window mode must be known before the window opens). */
  function readSettingsSync(dir) {
    try {
      const env = JSON.parse(fs.readFileSync(mainFile(dir, 'settings'), 'utf8'));
      if (env && env.format === 'lamplight-save' && typeof env.data === 'string' && crc32Hex(env.data) === env.crc) {
        return JSON.parse(env.data);
      }
    } catch { /* defaults */ }
    return null;
  }

  return { writeAtomic, rotateBackups, readCandidates, writeSave, quarantine, writeBlob, readSettingsSync };
}

// Same CRC-32 as src/lib/hash.js (tests check they agree, lone surrogates included).
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(str) {
  const bytes = Buffer.from(str, 'utf8');
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function crc32Hex(str) { return crc32(str).toString(16).padStart(8, '0'); }

module.exports = {
  BACKUPS, READ_WAITS_MS, RETRY_WAITS_MS, create, withRetry, checkName, crc32, crc32Hex, mainFile, backupFile, stamp,
  ...create(),
};
