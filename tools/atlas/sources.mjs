// The atlas's inputs, fingerprinted (ARCHITECTURE §16.3). The builder writes the fingerprint into
// src/assets/atlas.json; the gate (tests/art.test.js) works it out again from the committed files
// and fails if they differ, so a change to the manifest, a drawing, the palette, or the builder
// can't ship with a stale atlas. The raw packs aren't in the repo, so they have their own
// fingerprint, which only the builder can check.
//
// The inputs are found, not listed: every file the builder imports, and every file those import,
// followed through the whole tree (so a drawing that starts using another helper is covered the
// day it does). The walk stops at src/data/index.js (the game's content; what the atlas takes
// from it, each icon's tag, is fingerprinted directly), at tests/helpers/jsscan.js (the scanner
// this file reads code with: how it reads is pinned by the codeOf test, and a fix the boundary
// test needs shouldn't ask for a rebuild), and at anything outside the repo (npm packages).

import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { scanJs, importsOf } from '../../tests/helpers/jsscan.js';

/** Where the walk starts: the builder's command and its core. */
export const ATLAS_ROOTS = Object.freeze(['tools/atlas/build.mjs', 'tools/atlas/atlas.mjs', 'tools/atlas/sources.mjs']);
/** Imported by the builder but not part of what the atlas looks like. */
export const ATLAS_STOPS = Object.freeze(['src/data/index.js', 'tests/helpers/jsscan.js']);

const isWord = (c) => /[A-Za-z0-9_$]/.test(c) || c.charCodeAt(0) > 127;
/** Brackets, separators, and quotes: never part of a longer token, so the space beside them never matters. */
const SEPARATE = new Set(['(', ')', '[', ']', '{', '}', ',', ';', ':', "'", '"', '`']);

/**
 * Whether the whitespace between two characters of code matters: only where closing it up could
 * join two tokens into one (two words, `let x`; two operators, `+ +`; a dot beside anything,
 * `1 .toFixed`). Everywhere else (`x = 1` and `x=1`, `f(a, b)` and `f(a,b)`) it doesn't.
 */
function spaceMatters(a, b) {
  if (SEPARATE.has(a) || SEPARATE.has(b)) return false;
  if (a === '.' || b === '.') return true;
  return isWord(a) === isWord(b);
}

/**
 * A file's code with comments taken out and the spacing between tokens dropped wherever it can't
 * change what the code says, so editing a comment, re-indenting, or running a formatter never
 * asks for a rebuild. What's inside strings, template text, and regexes is kept exactly (a sprite
 * drawn as text rows counts its spaces).
 */
export function codeOf(text) {
  const src = text.replace(/\r\n/g, '\n');
  const { noComments, literal } = scanJs(src);
  let out = '', gap = false;
  for (let i = 0; i < noComments.length; i++) {
    const c = noComments[i];
    if (!literal[i] && (c === ' ' || c === '\t' || c === '\n' || c === '\r')) { gap = true; continue; }
    if (gap && out && !literal[i] && spaceMatters(out[out.length - 1], c)) out += ' ';
    gap = false;
    out += c;
  }
  return out;
}

/** Files whose contents decide the atlas, relative to the repo root (sorted): the import walk. */
export function atlasInputs(root, roots = ATLAS_ROOTS, stops = ATLAS_STOPS) {
  const seen = new Set();
  const visit = (rel) => {
    if (seen.has(rel) || stops.includes(rel)) return;
    const p = join(root, rel);
    if (!existsSync(p)) throw new Error(`atlas input missing: ${rel}`);
    seen.add(rel);
    for (const spec of importsOf(scanJs(readFileSync(p, 'utf8')).importText)) {
      if (!spec.startsWith('.')) continue;                 // node: builtins and npm packages
      const target = relative(root, resolve(dirname(p), spec)).split(sep).join('/');
      if (target.startsWith('..')) continue;               // outside the repo
      visit(target);
    }
  };
  for (const r of roots) visit(r);
  return [...seen].sort();
}

/**
 * The fingerprint of the committed inputs, plus the data that picks icon colors (each icon's
 * first tag), so retagging a weapon asks for a rebuild too.
 */
export function atlasSourceHash(root, iconKeys, roots = ATLAS_ROOTS, stops = ATLAS_STOPS) {
  const h = createHash('sha256');
  for (const rel of atlasInputs(root, roots, stops)) {
    h.update(`${rel}\n`);
    h.update(codeOf(readFileSync(join(root, rel), 'utf8')));
  }
  h.update(JSON.stringify(Object.entries(iconKeys).sort()));
  return h.digest('hex').slice(0, 16);
}

/** The fingerprint of the pack files the manifest uses (only the builder has them). */
export function packHash(packDir, files) {
  const h = createHash('sha256');
  for (const f of [...files].sort()) { h.update(`${f}\n`); h.update(readFileSync(join(packDir, f))); }
  return h.digest('hex').slice(0, 16);
}
