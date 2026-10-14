// A small stand-in for the browser's DOM, enough for the menus to run in Node (ui/dom.js,
// ui/focus.js, ui/screens.js, ui/hubscreens.js, ui/hubhud.js): elements with children and text,
// classes, data attributes, attributes, style (with custom properties), listeners and click(),
// hidden, scrollTop, and querySelector(All) for simple selectors (tag, .class, #id, [attr],
// [attr="value"], joined into compounds, and descendants separated by spaces).
//
// Layout is not modeled: getBoundingClientRect() is all zeros unless a test sets `el.rect`, and
// offsetParent is null for anything hidden or not attached under document.body.

const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

class FakeText {
  constructor(text) { this.nodeType = 3; this.data = String(text); this.parentNode = null; }
  get textContent() { return this.data; }
  set textContent(v) { this.data = String(v); }
  remove() { this.parentNode?.removeChild(this); }
}

function makeStyle() {
  const custom = new Map();
  return {
    setProperty(k, v) { custom.set(k, String(v)); },
    getPropertyValue(k) { return custom.get(k) ?? ''; },
    removeProperty(k) { custom.delete(k); },
  };
}

/** One compound selector ('button.btn[data-focus="restore"]') tested against one element. */
function matchesCompound(el, sel) {
  const m = /^([a-zA-Z][\w-]*|\*)?((?:\.[\w-]+|#[\w-]+|\[[^\]]+\])*)$/.exec(sel);
  if (!m) throw new Error(`fakedom: can't read the selector "${sel}"`);
  if (m[1] && m[1] !== '*' && el.tagName !== m[1].toUpperCase()) return false;
  for (const part of m[2].match(/\.[\w-]+|#[\w-]+|\[[^\]]+\]/g) || []) {
    if (part[0] === '.') { if (!el.classList.contains(part.slice(1))) return false; continue; }
    if (part[0] === '#') { if (el.getAttribute('id') !== part.slice(1)) return false; continue; }
    const a = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(part);
    if (!a) throw new Error(`fakedom: can't read the attribute selector "${part}"`);
    const v = el.getAttribute(a[1]);
    if (v === null || (a[2] !== undefined && v !== a[2])) return false;
  }
  return true;
}

/** A selector of compounds separated by spaces (descendants), within `root`. */
function matchesSelector(el, sel, root) {
  const parts = sel.trim().split(/\s+/);
  if (!matchesCompound(el, parts[parts.length - 1])) return false;
  let k = parts.length - 2;
  for (let x = el.parentNode; k >= 0 && x && x !== root; x = x.parentNode) if (x.nodeType === 1 && matchesCompound(x, parts[k])) k--;
  return k < 0;
}

class FakeElement {
  constructor(doc, tag) {
    this.ownerDocument = doc;
    this.nodeType = 1;
    this.tagName = tag.toUpperCase();
    this.childNodes = [];
    this.parentNode = null;
    this.dataset = {};
    this.attrs = new Map();
    this.style = makeStyle();
    this.listeners = new Map();
    this.hidden = false;
    this.scrollTop = 0;
    this.rect = null;           // { left, top, width, height } when a test needs layout
    this.classes = [];
  }

  get className() { return this.classes.join(' '); }
  set className(v) { this.classes = String(v).split(/\s+/).filter(Boolean); }
  get classList() {
    const el = this;
    return {
      add: (...c) => { for (const x of c) if (!el.classes.includes(x)) el.classes.push(x); },
      remove: (...c) => { el.classes = el.classes.filter((x) => !c.includes(x)); },
      toggle: (c, on) => {
        const want = on === undefined ? !el.classes.includes(c) : !!on;
        if (want) el.classList.add(c); else el.classList.remove(c);
        return want;
      },
      contains: (c) => el.classes.includes(c),
    };
  }

  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
  get textContent() { return this.childNodes.map((n) => n.textContent).join(''); }
  set textContent(v) {
    for (const n of this.childNodes) n.parentNode = null;
    this.childNodes = [];
    if (v !== '' && v !== null && v !== undefined) this.appendChild(new FakeText(v));
  }

  appendChild(n) { n.parentNode?.removeChild(n); n.parentNode = this; this.childNodes.push(n); return n; }
  append(...nodes) { for (const n of nodes) this.appendChild(typeof n === 'string' ? new FakeText(n) : n); }
  prepend(n) { n.parentNode?.removeChild(n); n.parentNode = this; this.childNodes.unshift(n); return n; }
  removeChild(n) { const i = this.childNodes.indexOf(n); if (i >= 0) this.childNodes.splice(i, 1); n.parentNode = null; return n; }
  remove() { this.parentNode?.removeChild(this); }
  contains(n) { for (let x = n; x; x = x.parentNode) if (x === this) return true; return false; }

  setAttribute(k, v) {
    if (k === 'class') this.className = v;
    else if (k.startsWith('data-')) this.dataset[camel(k.slice(5))] = String(v);
    else this.attrs.set(k, String(v));
  }
  getAttribute(k) {
    if (k === 'class') return this.className;
    if (k.startsWith('data-')) return this.dataset[camel(k.slice(5))] ?? null;
    return this.attrs.has(k) ? this.attrs.get(k) : null;
  }
  hasAttribute(k) { return this.getAttribute(k) !== null; }
  removeAttribute(k) {
    if (k.startsWith('data-')) delete this.dataset[camel(k.slice(5))];
    else this.attrs.delete(k);
  }

  addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(fn); }
  removeEventListener(type, fn) { const l = this.listeners.get(type); if (l) this.listeners.set(type, l.filter((f) => f !== fn)); }
  dispatchEvent(ev) {
    if (!ev.target) ev.target = this;
    // Bubbles up, as a click does.
    for (let x = this; x; x = x.parentNode) for (const f of [...(x.listeners?.get(ev.type) || [])]) f(ev);
    return true;
  }
  click() { this.dispatchEvent({ type: 'click', target: null }); }

  /** Null when this or an ancestor is hidden, or it isn't under document.body (as display:none is). */
  get offsetParent() {
    for (let x = this; x; x = x.parentNode) {
      if (x.hidden) return null;
      if (x === this.ownerDocument.body) return x;
    }
    return null;
  }
  scrollIntoView() {}
  getBoundingClientRect() {
    const r = this.rect || { left: 0, top: 0, width: 0, height: 0 };
    return { left: r.left, top: r.top, width: r.width, height: r.height, x: r.left, y: r.top, right: r.left + r.width, bottom: r.top + r.height };
  }
  getClientRects() { return this.offsetParent ? [this.getBoundingClientRect()] : []; }
  closest(sel) { for (let x = this; x && x.nodeType === 1; x = x.parentNode) if (matchesSelector(x, sel, null)) return x; return null; }
  matches(sel) { return matchesSelector(this, sel, null); }
  querySelectorAll(sel) {
    const out = [];
    const walk = (n) => { for (const c of n.children) { if (matchesSelector(c, sel, this)) out.push(c); walk(c); } };
    walk(this);
    return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
}

/** A stand-in document: createElement, createTextNode, and a body to attach things under. */
export function createFakeDocument() {
  const doc = {
    createElement: (tag) => new FakeElement(doc, tag),
    createTextNode: (text) => new FakeText(text),
  };
  doc.body = new FakeElement(doc, 'body');
  return doc;
}

/**
 * Install a fresh stand-in document as the global `document` (ui/dom.js builds with it), and CSS.escape
 * (ui/focus.js uses it) if Node lacks it. Returns the document.
 */
export function installFakeDocument() {
  const doc = createFakeDocument();
  globalThis.document = doc;
  if (!globalThis.CSS) globalThis.CSS = { escape: (s) => String(s).replace(/["\\]/g, '\\$&') };
  return doc;
}

/** Every text under an element, one string per text node that isn't blank (for asserting what a screen says). */
export function textsOf(el) {
  const out = [];
  const walk = (n) => { for (const c of n.childNodes) { if (c.nodeType === 3) { if (c.data.trim()) out.push(c.data.trim()); } else walk(c); } };
  walk(el);
  return out;
}
