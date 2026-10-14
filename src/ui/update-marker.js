// Status marker for the playtest build: a small plain label in the corner that stays on screen
// until the page reloads, independent of the F3 debug overlay (which can be hidden). It carries
// "update ready" and any storage problem that means progress won't be kept, one line each.

export function createUpdateMarker(root, doc = root.ownerDocument) {
  let el = null;
  const lines = new Map();   // key -> text, in the order first shown
  function render() {
    if (!lines.size) { if (el) el.hidden = true; return; }
    if (!el) {
      el = doc.createElement('div');
      el.className = 'update-marker';
      el.setAttribute('role', 'status');
      root.appendChild(el);
    }
    el.hidden = false;
    el.textContent = [...lines.values()].join('\n');
  }
  return {
    /** Show (or replace) the line for `key`. */
    show(text, key = 'update') { if (lines.get(key) === text) return; lines.set(key, text); render(); },
    /** Remove the line for `key`. */
    clear(key) { if (lines.delete(key)) render(); },
    get text() { return el && !el.hidden ? el.textContent : null; },
  };
}

export const UPDATE_TEXT = {
  ready: 'Update ready. It loads on the main menu, or in the harbor with no menu open.',
  stuck: 'A newer version is out but didn\'t load. Close this tab and open the game again.',
};
