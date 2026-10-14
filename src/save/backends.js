// Storage backends. Each one only stores and returns text; the store decides what text means.
//
// Backend interface:
//   readCandidates(kind) -> Promise<Array<{ text, source } | { error, source }>>
//        newest first: 'main', 'backup1'..'backup5'. A slot that exists but can't be read comes
//        back as { error } (never silently skipped), so the store knows not to write over it.
//   write(kind, text, { rotate }) -> Promise<void>     rotate: copy the current save into the backups first
//   quarantine(kind) -> Promise<string|null>           copy the main save somewhere no save can reach it
//   writeBlob(folder, name, data) -> Promise<string>   replays and reports; returns where it went
//   label                                               'desktop' | 'web' | 'web-local' | 'memory'

export const BACKUPS = 5;
const KINDS = new Set(['profile', 'settings']);
const NAME_RE = /^[A-Za-z0-9._-]{1,80}$/;

function checkKind(kind) {
  if (!KINDS.has(kind)) throw new Error(`Unknown save kind: ${kind}`);
}
export function checkName(name) {
  if (!NAME_RE.test(name) || name.includes('..')) throw new Error(`Bad file name: ${name}`);
}

/**
 * Backend over a simple async key-value adapter { get(k), set(k, v), del(k), keys() }.
 * Used for IndexedDB, localStorage, and in-memory (tests).
 */
export function createKvBackend(kv, label, { keepBlobs = { replays: 3, reports: 20 }, clock = () => new Date() } = {}) {
  const bak = (kind, i) => `${kind}.bak${i}`;
  return {
    label,
    async readCandidates(kind) {
      checkKind(kind);
      const out = [];
      const slots = [[kind, 'main']];
      for (let i = 1; i <= BACKUPS; i++) slots.push([bak(kind, i), `backup${i}`]);
      for (const [key, source] of slots) {
        try {
          const t = await kv.get(key);
          if (typeof t === 'string') out.push({ text: t, source });
        } catch (e) {
          out.push({ source, error: `could not read ${key}: ${e?.message || e}` });
        }
      }
      return out;
    },
    async write(kind, text, { rotate = false } = {}) {
      checkKind(kind);
      if (typeof text !== 'string') throw new Error('write needs text');
      if (rotate) {
        const cur = await kv.get(kind);
        if (typeof cur === 'string') {
          // Shift bakN -> bakN+1; an empty slot moves down too, so no save is ever held twice.
          for (let i = BACKUPS - 1; i >= 1; i--) {
            const t = await kv.get(bak(kind, i));
            if (typeof t === 'string') await kv.set(bak(kind, i + 1), t);
            else await kv.del(bak(kind, i + 1));
          }
          await kv.set(bak(kind, 1), cur);
        }
      }
      await kv.set(kind, text);
    },
    async quarantine(kind) {
      checkKind(kind);
      const cur = await kv.get(kind);
      if (typeof cur !== 'string') return null;
      const prefix = `${kind}.unreadable-`;
      const existing = (await kv.keys()).filter((k) => k.startsWith(prefix));
      // The same unreadable save seen again (say, on the next launch): it is already safe.
      for (const k of existing) if ((await kv.get(k)) === cur) return k;
      const base = `${prefix}${stampOf(clock())}`;
      let key = base;
      for (let n = 2; existing.includes(key); n++) key = `${base}-${n}`;
      await kv.set(key, cur);
      return key;
    },
    async writeBlob(folder, name, data) {
      checkName(name);
      if (!(folder in keepBlobs)) throw new Error(`Unknown folder: ${folder}`);
      const prefix = `${folder}/`;
      await kv.set(prefix + name, data);
      const all = (await kv.keys()).filter((k) => k.startsWith(prefix)).sort();
      const extra = all.length - keepBlobs[folder];
      for (let i = 0; i < extra; i++) await kv.del(all[i]); // names start with a timestamp: oldest first
      return `${label}:${prefix}${name}`;
    },
  };
}

function stampOf(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

export function memoryKv() {
  const m = new Map();
  return {
    async get(k) { return m.has(k) ? m.get(k) : undefined; },
    async set(k, v) { m.set(k, v); },
    async del(k) { m.delete(k); },
    async keys() { return [...m.keys()]; },
    _map: m,
  };
}

/** IndexedDB key-value adapter (one object store). Rejects if IndexedDB is unavailable. */
export function indexedDbKv(dbName = 'lamplight', storeName = 'kv', idb = globalThis.indexedDB ?? null) {
  const open = () => new Promise((resolve, reject) => {
    if (!idb) { reject(new Error('IndexedDB unavailable')); return; }
    const req = idb.open(dbName, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(storeName)) req.result.createObjectStore(storeName); };
    req.onsuccess = () => {
      const d = req.result;
      // If the browser closes the connection (storage pressure, another tab upgrading), forget it
      // so the next call reopens instead of failing forever.
      d.onclose = () => { dbp = null; };
      d.onversionchange = () => { d.close(); dbp = null; };
      resolve(d);
    };
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
    req.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
  let dbp = null;
  const db = () => {
    if (!dbp) dbp = open().catch((e) => { dbp = null; throw e; });
    return dbp;
  };
  const tx = async (mode, fn) => {
    const d = await db();
    return new Promise((resolve, reject) => {
      const t = d.transaction(storeName, mode);
      const s = t.objectStore(storeName);
      let result;
      Promise.resolve(fn(s, (r) => { result = r; })).catch(reject);
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error || new Error('IndexedDB transaction failed'));
      t.onabort = () => reject(t.error || new Error('IndexedDB transaction aborted'));
    });
  };
  const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  return {
    async ready() { await db(); },
    get: (k) => tx('readonly', async (s, done) => done(await reqP(s.get(k)))),
    set: (k, v) => tx('readwrite', (s) => { s.put(v, k); }),
    del: (k) => tx('readwrite', (s) => { s.delete(k); }),
    keys: () => tx('readonly', async (s, done) => done((await reqP(s.getAllKeys())).map(String))),
  };
}

// localStorage holds only strings: bytes are stored base64 with a tag and turned back on read.
const BYTES_TAG = '\u0000bytes:';
function bytesToB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function b64ToBytes(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** localStorage adapter: the fallback when IndexedDB is blocked (private windows, some policies). */
export function localStorageKv(prefix = 'lamplight:', ls = globalThis.localStorage ?? null) {
  if (!ls) throw new Error('localStorage unavailable');
  return {
    async get(k) {
      const v = ls.getItem(prefix + k);
      if (v === null) return undefined;
      return v.startsWith(BYTES_TAG) ? b64ToBytes(v.slice(BYTES_TAG.length)) : v;
    },
    async set(k, v) { ls.setItem(prefix + k, typeof v === 'string' ? v : BYTES_TAG + bytesToB64(v)); },
    async del(k) { ls.removeItem(prefix + k); },
    async keys() {
      const out = [];
      for (let i = 0; i < ls.length; i++) { const k = ls.key(i); if (k && k.startsWith(prefix)) out.push(k.slice(prefix.length)); }
      return out;
    },
  };
}

/** Desktop backend: every call crosses the preload bridge to the main process, which owns the files. */
export function createDesktopBackend(native) {
  if (!native) throw new Error('Desktop bridge missing');
  return {
    label: 'desktop',
    async readCandidates(kind) { checkKind(kind); return (await native.readSave(kind)) || []; },
    async write(kind, text, { rotate = false } = {}) { checkKind(kind); await native.writeSave(kind, text, { rotate }); },
    async quarantine(kind) { checkKind(kind); return native.quarantineSave(kind); },
    async writeBlob(folder, name, data) {
      checkName(name);
      if (folder === 'replays') return native.writeReplay(name, data);
      if (folder === 'reports') return native.writeReport(name, data);
      throw new Error(`Unknown folder: ${folder}`);
    },
  };
}
