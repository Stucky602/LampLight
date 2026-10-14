// What sits over the harbor while you walk it (ARCHITECTURE §10.4): your materials (top left),
// the three things you can nearly afford (bottom left: clear of the buildings up the hill, and of
// the page's status notice in the bottom right), the prompt over what's in reach, what a keeper
// says, a banner when a building comes back, and how to skip a set piece (bottom left too; the
// panels hide during a set piece). DOM in the menu layer, under any screen, never taking input. A
// corner panel fades while you walk under it.
//
// Positions are in the 640 x 360 view's pixels (the view says where things are: toView()); the
// menu layer's --u is one of them in screen pixels.

import { h, fill } from './dom.js';
import { optionText } from './hubtext.js';

/**
 * @param {object} o
 * @param {HTMLElement} o.root the menu layer (ui.view)
 * @param {(id: string, scale?: number) => HTMLElement} o.icon atlas icons
 * @param {(action: string) => HTMLElement} o.glyph button prompts that follow the controller
 * @param {object} o.data the content bundle
 */
export function createHubHud({ root, icon, glyph, data }) {
  const mats = h('div', { class: 'hud-mats' });
  const next = h('div', { class: 'hud-next' });
  const prompt = h('div', { class: 'hud-prompt', hidden: true });
  const bubble = h('div', { class: 'hud-bubble', hidden: true });
  const banner = h('div', { class: 'hud-banner', hidden: true });
  const skip = h('div', { class: 'hud-skip', hidden: true }, glyph('confirm'), ' Skip');
  const el = h('div', { class: 'hub-hud' }, mats, next, prompt, bubble, banner, skip);
  root.prepend(el);   // under every screen
  // The materials the harbor asks for: the ones some building, project, or upgrade costs.
  const wanted = data.materials.filter((m) => [
    ...data.buildings.flatMap((b) => b.levels.map((l) => l.cost)), ...data.research.map((r) => r.cost), ...data.upgrades.map((u) => u.cost),
  ].some((c) => c[m.id] > 0));
  let bannerUntil = 0, bubbleFor = null, promptKey = '';
  const at = (node, x, y) => { node.style.left = `calc(var(--u) * ${Math.round(x)})`; node.style.top = `calc(var(--u) * ${Math.round(y)})`; };
  const unit = () => parseFloat(root.style.getPropertyValue('--u')) || 1;

  return {
    el,
    /** Material counts, in the data's order (the ones you have none of, dimmed). */
    setMaterials(have) {
      fill(mats, ...wanted.map((m) => {
        const n = have?.[m.id] ?? 0;
        return h('span', { class: `hud-mat${n > 0 ? '' : ' none'}`, title: m.name }, icon(m.icon, 1), ` ${n}`);
      }));
    },
    /** The next three (meta/next.js nextAffordable). */
    setNext(options) {
      if (!options.length) { fill(next); next.hidden = true; return; }
      next.hidden = false;
      fill(next, h('div', { class: 'hud-next-title' }, 'Next up'), ...options.map((o) => {
        const t = optionText(data, o);
        return h('div', { class: 'hud-next-row' },
          h('div', { class: 'hud-next-name' }, t.title),
          h('span', { class: 'meter' }, h('span', { class: 'meter-fill', style: { width: `${Math.round(t.progress * 100)}%` } })),
          h('div', { class: t.need ? 'hud-next-need' : 'hud-next-ready' }, t.need ?? t.readyAt));
      }));
    },
    /**
     * Fade a corner panel while you're under it. pos: where your feet are in the view (null: you
     * aren't out, as in a set piece). Call before placing the prompt and the bubble, so the
     * panels are measured before anything moves.
     */
    placePlayer(pos) {
      const u = unit(), r = el.getBoundingClientRect();
      for (const node of [mats, next]) {
        let under = false;
        if (pos && !node.hidden) {
          const b = node.getBoundingClientRect();
          const x = r.left + pos.x * u, y = r.top + pos.y * u;
          // Your figure stands about 22 px tall over its feet, and 8 px either side.
          under = x > b.left - 8 * u && x < b.right + 8 * u && y > b.top && y < b.bottom + 22 * u;
        }
        node.classList.toggle('under', under);
      }
    },
    /** The prompt over what's in reach: text, at a view position (null hides it). */
    setPrompt(text, pos) {
      if (!text || !pos) { prompt.hidden = true; promptKey = ''; return; }
      if (promptKey !== text) { fill(prompt, glyph('confirm'), ` ${text}`); promptKey = text; }
      prompt.hidden = false;
      at(prompt, pos.x, pos.y);
    },
    /** A keeper's line in a bubble over them, until `untilMs` or until they're out of reach. */
    say(id, name, text, untilMs) {
      bubbleFor = { id, untilMs };
      fill(bubble, h('span', { class: 'bubble-name' }, name), h('span', { class: 'bubble-text' }, text));
    },
    /** Place (or hide) the bubble: pos of the person speaking, now in ms, and who's in reach. */
    placeBubble(pos, nowMs, nearId) {
      if (!bubbleFor || !pos || nowMs > bubbleFor.untilMs || nearId !== bubbleFor.id) { bubble.hidden = true; if (bubbleFor && (nowMs > bubbleFor.untilMs || nearId !== bubbleFor.id)) bubbleFor = null; return; }
      bubble.hidden = false;
      at(bubble, pos.x, pos.y);
    },
    get speaking() { return bubbleFor?.id ?? null; },
    /** A banner across the top: a title and a few lines, for `ms`. */
    showBanner(title, lines, nowMs, ms = 4200) {
      fill(banner, h('div', { class: 'banner-title' }, title), ...lines.map((t) => h('div', { class: 'banner-line' }, t)));
      banner.hidden = false;
      bannerUntil = nowMs + ms;
    },
    tick(nowMs) { if (!banner.hidden && nowMs > bannerUntil) banner.hidden = true; },
    setSkip(on) { skip.hidden = !on; },
    /** Hide the corner panels (while a screen or a set piece has the stage). */
    setQuiet(on) { el.classList.toggle('quiet', !!on); },
    destroy() { el.remove(); },
  };
}
