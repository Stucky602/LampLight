// Debug overlay (F3): build, controller, prompts, frame rate, sim health, errors.
// Plain DOM text; the in-world HUD is Pixi (Phase 3).

import { glyphFor } from '../input/glyphs.js';

export function createDebugOverlay(root, { build, target }) {
  const el = document.createElement('div');
  el.className = 'debug-overlay';
  el.setAttribute('aria-live', 'off');
  root.appendChild(el);
  let visible = true;
  let acc = 0, frames = 0, fps = 0, frameAvg = 16.7, worst = 0, worstShown = 0;
  let sinceText = 1e9;
  let lastText = '';
  const TYPE_NAMES = { playstation: 'PlayStation controller', xbox: 'Xbox controller', generic: 'Controller' };

  return {
    toggle() { visible = !visible; el.hidden = !visible; },
    get visible() { return visible; },
    update(frameMs, { input, loop, errors, scene, extra = '' }) {
      acc += frameMs; frames++;
      frameAvg = frameAvg * 0.95 + frameMs * 0.05;
      if (frameMs > worst) worst = frameMs;
      if (acc >= 500) { fps = Math.round((frames * 1000) / acc); acc = 0; frames = 0; worstShown = worst; worst = 0; }
      sinceText += frameMs;
      if (!visible || sinceText < 100) return; // text refresh at most 10x a second
      sinceText = 0;
      const style = input.promptStyle;
      const dev = input.device === 'gamepad' ? (TYPE_NAMES[input.controllerType] || 'Controller') : input.device === 'mouse' ? 'Mouse' : 'Keyboard';
      const lines = [
        `Lamplight ${build} (${target})`,
        `${fps} fps · frame ${frameAvg.toFixed(1)} ms (worst ${Math.round(worstShown)}) · tick ${loop.tick} · steps/frame ${loop.stepsLastFrame}${loop.droppedMs > 0 ? ` · dropped ${Math.round(loop.droppedMs)} ms` : ''}`,
        `Scene: ${scene || '-'}${loop.isPaused() ? ` · paused (${loop.pauseReasons().join(', ')})` : ''}`,
        `Input: ${dev} · pads ${input.padCount} · prompts ${style}`,
        `Move ${glyphFor(style, 'move')} · Dash ${glyphFor(style, 'dash')} · Hide this ${style === 'keyboard' ? 'F3' : '(F3 on keyboard)'}`,
      ];
      if (extra) lines.push(extra);
      if (errors.count) lines.push(`Errors: ${errors.count} (last: ${errors.last.message})`);
      const n = errors.lastNotice;
      if (n) lines.push(`Note: ${n.message}`);
      const text = lines.join('\n');
      if (text !== lastText) { el.textContent = text; lastText = text; }
    },
  };
}
