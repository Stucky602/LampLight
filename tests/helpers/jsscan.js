// A small JavaScript scanner for the gate's source checks (not a full parser).
//
// Returns three copies of the source, the same length, positions preserved:
//   noComments  comments blanked (newlines kept); strings, templates, and regexes intact
//   importText  comments, template text, and regex bodies blanked; string contents intact, so
//               import specifiers are readable but an import written inside a template or a
//               regex is not mistaken for a real one
//   codeOnly    comments blanked AND the contents of strings, templates, and regex literals
//               blanked (delimiters kept); `${...}` inside templates stays code
// plus `literal`, a byte per position: 1 inside the contents of a string, template text, or regex
// Regex literals are told apart from division by the previous significant token, including the
// `)` that closes an if/while/for/with condition (`if (ok) /re/.test(s)`).

const REGEX_AFTER = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^']);
const REGEX_KEYWORDS = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);
const CONDITION_KEYWORDS = new Set(['if', 'while', 'for', 'with']);

export function scanJs(src) {
  const n = src.length;
  const nc = src.split('');   // no comments
  const it = src.split('');   // import text
  const co = src.split('');   // code only
  const literal = new Uint8Array(n); // 1 inside a string, template text, or regex literal
  const blank = (arr, i) => { if (arr[i] !== '\n') arr[i] = ' '; };
  const lit = (i) => { if (i < n) literal[i] = 1; };
  const blank3 = (i) => { blank(nc, i); blank(it, i); blank(co, i); };
  const tplDepth = [];        // brace depth at each open `${`
  const parens = [];          // per open '(': does it hold an if/while/for/with condition?
  let braces = 0;
  let lastSig = '';           // last significant char in code
  let lastWord = '';          // last identifier in code
  let i = 0;

  while (i < n) {
    const c = src[i], d = src[i + 1];
    // Comments.
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') { blank3(i); i++; }
      continue;
    }
    if (c === '/' && d === '*') {
      blank3(i); blank3(i + 1); i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { blank3(i); i++; }
      if (i < n) { blank3(i); blank3(i + 1); i += 2; }
      continue;
    }
    // Strings.
    if (c === '"' || c === "'") {
      i++;
      while (i < n && src[i] !== c && src[i] !== '\n') {
        if (src[i] === '\\') { blank(co, i); lit(i); i++; }
        blank(co, i); lit(i); i++;
      }
      i++;
      lastSig = c; lastWord = '';
      continue;
    }
    // Template literal text (also re-entered after a `${...}` closes).
    if (c === '`') {
      i++;
      i = scanTemplateText(i);
      continue;
    }
    // Template expression end.
    if (c === '}' && tplDepth.length && braces === tplDepth[tplDepth.length - 1]) {
      tplDepth.pop();
      i++;
      i = scanTemplateText(i);
      continue;
    }
    // Regex literal.
    if (c === '/' && (lastSig === '' || REGEX_AFTER.has(lastSig) || REGEX_KEYWORDS.has(lastWord))) {
      i++;
      let inClass = false;
      while (i < n && src[i] !== '\n') {
        const r = src[i];
        if (r === '\\') { blank(co, i); blank(it, i); lit(i); i++; blank(co, i); blank(it, i); lit(i); i++; continue; }
        if (r === '[') inClass = true;
        else if (r === ']') inClass = false;
        else if (r === '/' && !inClass) break;
        blank(co, i); blank(it, i); lit(i); i++;
      }
      i++;
      while (i < n && /[a-z]/i.test(src[i])) i++; // flags
      lastSig = '/'; lastWord = '';
      continue;
    }
    if (c === '{') braces++;
    else if (c === '}') braces--;
    if (c === '(') { parens.push(CONDITION_KEYWORDS.has(lastWord)); lastSig = '('; lastWord = ''; i++; continue; }
    if (c === ')') {
      // After an if/while/for/with condition, a statement starts: a '/' there begins a regex.
      lastSig = parens.pop() ? '(' : ')';
      lastWord = '';
      i++;
      continue;
    }
    if (/[A-Za-z0-9_$]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_$]/.test(src[j])) j++;
      lastWord = src.slice(i, j);
      lastSig = 'a';
      i = j;
      continue;
    }
    if (!/\s/.test(c)) { lastSig = c; lastWord = ''; }
    i++;
  }
  return { noComments: nc.join(''), importText: it.join(''), codeOnly: co.join(''), literal };

  // Scan template text from i until the closing backtick or a `${`; returns the next index.
  function scanTemplateText(j) {
    while (j < n) {
      const t = src[j];
      if (t === '\\') { blank(co, j); blank(it, j); lit(j); j++; blank(co, j); blank(it, j); lit(j); j++; continue; }
      if (t === '`') { lastSig = '`'; lastWord = ''; return j + 1; }
      if (t === '$' && src[j + 1] === '{') { tplDepth.push(braces); lastSig = '{'; lastWord = ''; return j + 2; }
      blank(co, j); blank(it, j); lit(j); j++;
    }
    return j;
  }
}

/** Import specifiers (static imports, re-exports, dynamic imports) from scanJs(...).importText. */
export function importsOf(importText) {
  const out = [];
  const re = /(?:^|[;\n}])\s*(?:import|export)\s+[^'";]*?\bfrom\s*(['"])([^'"]+)\1|(?:^|[;\n}])\s*import\s*(['"])([^'"]+)\3|\bimport\s*\(\s*(['"])([^'"]+)\5\s*\)/g;
  let m;
  while ((m = re.exec(importText))) out.push(m[2] || m[4] || m[6]);
  return out;
}

/** Strip // and /* *\/ comments from JSONC text (outside strings) and trailing commas. */
export function stripJsonc(text) {
  let out = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < n && text[j] !== '"') { if (text[j] === '\\') j++; j++; }
      out += text.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === '/' && text[i + 1] === '/') { while (i < n && text[i] !== '\n') i++; continue; }
    if (c === '/' && text[i + 1] === '*') { i += 2; while (i < n && !(text[i] === '*' && text[i + 1] === '/')) i++; i += 2; continue; }
    out += c;
    i++;
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}
