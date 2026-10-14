// The save store: the one place that decides what saved text means.
//
// Loading tries the main save, then each backup, newest first, and takes the first one that
// verifies and migrates. If the main save exists but can't be used, it is quarantined (copied
// to profile.unreadable-<time>) before anything else happens, so no later save can overwrite
// the newest progress. If nothing can be read, the game starts fresh and the old files stay.
//
// Writes go through one queue, so a run-end save and a hub save can never interleave and land
// out of order.

import { wrap, unwrap } from './envelope.js';
import { migrateProfile, SaveTooNewError } from './migrations.js';
import { defaultProfile, normalizeSettings, defaultSettings } from './schema.js';
import { encodeExportCode, decodeExportCode, summarize } from './codec.js';

/**
 * @param {object} o
 * @param {object} o.backend from backends.js
 * @param {string} [o.build] build id stamped into every envelope
 * @param {()=>string} [o.clock] ISO timestamp source (injectable for tests)
 * @param {Array<Function>} [o.migrations] migration table override (tests only)
 */
export function createStore({ backend, build = 'dev', clock = () => new Date().toISOString(), migrations } = {}) {
  if (!backend) throw new Error('createStore needs a backend');
  // 'unknown' until loadProfile runs; then 'main' | 'backupN' | 'new' | 'too-new'.
  let loadedFrom = 'unknown';
  // True when the main save exists but couldn't be quarantined: the next write must rotate it
  // into the backups rather than overwrite it.
  let mainAtRisk = false;
  let queue = Promise.resolve();

  function enqueue(fn) {
    const run = queue.then(fn);
    queue = run.catch(() => {});
    return run;
  }

  async function protectMain(warnings) {
    try {
      const name = await backend.quarantine('profile');
      if (name) warnings.push(`The unreadable save was kept as ${name}.`);
      mainAtRisk = false;
      return name;
    } catch (e) {
      mainAtRisk = true;
      warnings.push(`Could not set the unreadable save aside (${e.message}); the next save will move it into the backups instead of overwriting it.`);
      return null;
    }
  }

  return {
    get label() { return backend.label; },
    get loadedFrom() { return loadedFrom; },

    /**
     * @returns {Promise<{ doc, source, warnings: string[], tooNew?: boolean, quarantined?: string|null }>}
     * source: 'main' | 'backupN' | 'new' | 'too-new'
     */
    async loadProfile() {
      const warnings = [];
      let candidates = [];
      try { candidates = await backend.readCandidates('profile'); }
      catch (e) { warnings.push(`Could not read saves: ${e.message}`); }
      let mainFailed = false;
      let quarantined = null;
      for (const c of candidates) {
        if (c.error) {
          warnings.push(`${c.source}: ${c.error}`);
          if (c.source === 'main') mainFailed = true;
          continue;
        }
        try {
          const { doc } = unwrap(c.text, 'profile');
          const { doc: migrated, steps, repairs } = migrateProfile(doc, migrations);
          if (mainFailed) quarantined = await protectMain(warnings);
          if (c.source !== 'main') warnings.push(`The main save could not be read, so progress was restored from ${c.source}.`);
          if (steps) warnings.push(`Save updated from version ${doc.v} to ${migrated.v}.`);
          if (repairs.length) warnings.push(`Save repaired: ${repairs.join(', ')}.`);
          loadedFrom = c.source;
          return { doc: migrated, source: c.source, warnings, quarantined };
        } catch (e) {
          if (e instanceof SaveTooNewError) {
            // Never fall back to an older backup over a newer save: that would look like lost progress.
            warnings.push(e.message);
            loadedFrom = 'too-new';
            return { doc: null, source: 'too-new', warnings, tooNew: true, quarantined: null };
          }
          warnings.push(`${c.source}: ${e.message}`);
          if (c.source === 'main') mainFailed = true;
        }
      }
      if (mainFailed) quarantined = await protectMain(warnings);
      if (candidates.length) warnings.push('No save could be read. Starting a new profile; the old files were kept.');
      loadedFrom = 'new';
      return { doc: defaultProfile(), source: 'new', warnings, quarantined };
    },

    /**
     * Save the profile. rotate: true at run ends (the backup chain then holds the last 5 runs).
     * Refuses to save over a too-new save this build couldn't read.
     */
    saveProfile(doc, { rotate = false } = {}) {
      return enqueue(async () => {
        if (loadedFrom === 'too-new') throw new Error('Refusing to overwrite a save from a newer version of Lamplight.');
        if (!doc || typeof doc.v !== 'number') throw new Error('saveProfile needs a profile doc');
        const text = wrap('profile', doc, { build, savedAt: clock() });
        await backend.write('profile', text, { rotate: rotate || mainAtRisk });
        mainAtRisk = false;
        if (loadedFrom !== 'main') loadedFrom = 'main';
      });
    },

    async loadSettings() {
      let candidates = [];
      try { candidates = await backend.readCandidates('settings'); } catch { /* defaults below */ }
      for (const c of candidates) {
        if (c.error) continue;
        try { return normalizeSettings(unwrap(c.text, 'settings').doc); } catch { /* try the next one */ }
      }
      return defaultSettings();
    },

    saveSettings(settings) {
      return enqueue(() => backend.write('settings', wrap('settings', normalizeSettings(settings), { build, savedAt: clock() }), { rotate: false }));
    },

    exportCode(doc) { return encodeExportCode(doc); },

    /** Decode and migrate a code. Nothing is written; call applyImport after the player confirms. */
    previewImport(code) {
      const raw = decodeExportCode(code);
      const { doc } = migrateProfile(raw, migrations);
      return { doc, summary: summarize(doc) };
    },

    /**
     * Replace the profile with an imported one. The current save goes into the backups first;
     * a save from a newer build is quarantined (never merely rotated, since rotation would
     * eventually push it out of the backup chain).
     */
    applyImport(doc) {
      return enqueue(async () => {
        if (!doc || typeof doc.v !== 'number') throw new Error('applyImport needs a profile doc');
        if (loadedFrom === 'too-new') {
          const name = await backend.quarantine('profile');
          if (!name) throw new Error('Could not set the newer save aside, so the import was not applied.');
        }
        await backend.write('profile', wrap('profile', doc, { build, savedAt: clock() }), { rotate: true });
        mainAtRisk = false;
        loadedFrom = 'main';
      });
    },

    writeReplay(name, bytes) { return backend.writeBlob('replays', name, bytes); },
    writeReport(name, text) { return backend.writeBlob('reports', name, text); },
    /** Resolves when every queued write has finished (tests, and before quitting). */
    flush() { return queue; },
  };
}

/** Timestamped file name that sorts oldest-first: 20260927-153012-run.lamprep */
export function stampName(suffix, date = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  const s = `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}-${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}`;
  return `${s}-${suffix}`;
}
