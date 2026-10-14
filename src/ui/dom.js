// A tiny element builder for the menus. Text always goes in as text (never as HTML), so content
// from data or a save can't inject markup.

/**
 * h('div', { class: 'card', data: { focus: 'c0' }, onclick }, 'text', child, ...)
 * Attributes: class, data (dataset), on<event> handlers, hidden, and anything else as an attribute.
 */
export function h(tag, attrs = null, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'data') for (const [dk, dv] of Object.entries(v)) { if (dv !== undefined && dv !== null) el.dataset[dk] = String(dv); }
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'hidden') el.hidden = true;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (typeof c === 'string' || typeof c === 'number') el.appendChild(document.createTextNode(String(c)));
    else el.appendChild(c);
  }
}

/** Replace an element's children. */
export function fill(el, ...children) {
  el.textContent = '';
  append(el, children);
  return el;
}
