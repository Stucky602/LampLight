// The settings screen's rows and what each change does (ARCHITECTURE §8 accessibility toggles,
// §13.2 display modes). Changes apply at once and are saved a moment later.

import { settingsScreen } from '../ui/menus.js';
import { settingRefusal } from './runlogic.js';

/**
 * @param {object} o
 * @param {object} o.settings the live settings object (changed in place)
 * @param {boolean} o.desktop whether display modes can be changed (the .exe)
 * @param {()=>boolean} o.atTitleOrHarbor true at the title or in the harbor, settled there (borderless
 *   can be switched only there: the switch reloads the page, which a run can't survive)
 * @param {(go: ()=>void)=>Promise<boolean>} [o.reopen] leave the page for a new window: calls go once
 *   progress is safe (app/keeper.js), resolves to whether it did
 */
export function openSettings({ ui, menuCtx, settings, desktop, native, atTitleOrHarbor, reopen = null, input, audio, renderer, save, onClose }) {
  const s = settings;
  const rows = [];
  if (desktop) {
    rows.push({ key: 'display.mode', label: 'Display', kind: 'choice', value: s.display.mode, choices: [['fullscreen', 'Fullscreen'], ['borderless', 'Borderless'], ['windowed', 'Windowed']] });
  }
  rows.push(
    { key: 'display.fillScreen', label: 'Stretch to fill', kind: 'toggle', value: s.display.fillScreen },
    { key: 'audio.master', label: 'Master volume', kind: 'slider', value: s.audio.master, min: 0, max: 1, step: 0.1, format: (v) => `${Math.round(v * 100)}%` },
    { key: 'audio.sfx', label: 'Sound effects', kind: 'slider', value: s.audio.sfx, min: 0, max: 1, step: 0.1, format: (v) => `${Math.round(v * 100)}%` },
    { key: 'controls.prompts', label: 'Button prompts', kind: 'choice', value: s.controls.prompts, choices: [['auto', 'Auto'], ['playstation', 'PlayStation'], ['xbox', 'Xbox'], ['keyboard', 'Keyboard']] },
    { key: 'controls.deadzone', label: 'Stick deadzone', kind: 'slider', value: s.controls.deadzone, min: 0, max: 0.6, step: 0.05, format: (v) => `${Math.round(v * 100)}%` },
    { key: 'access.shake', label: 'Screen shake', kind: 'toggle', value: s.access.shake },
    { key: 'access.damageNumbers', label: 'Damage numbers', kind: 'toggle', value: s.access.damageNumbers },
    { key: 'access.flashReduction', label: 'Reduce flashing', kind: 'toggle', value: s.access.flashReduction },
  );
  let screen = null;
  const apply = (key, v) => {
    const [group, name] = key.split('.');
    if (key === 'display.mode') {
      const from = s.display.mode;
      const why = settingRefusal(key, v, from, atTitleOrHarbor());
      if (why) { screen.setRow(key, { value: from, note: why }); return; }
      s.display.mode = v;
      screen.setRow(key, { note: null });
      // Saved first, then switched: a borderless switch replaces the window (and this page) at
      // once, so a save left waiting would be lost, and so would progress a failed save holds.
      const go = () => native?.setDisplayMode?.(v);
      if (!reopen || (v !== 'borderless' && from !== 'borderless')) { save(true).finally(go); return; }
      reopen(go).then((left) => {
        if (left) return;
        // Staying: the mode on disk goes back too (the flush before leaving wrote the new one),
        // so the next launch opens the window the player still has.
        s.display.mode = from;
        screen.setRow(key, { value: from, note: 'Progress isn\'t saved yet, so the window can\'t change. Try again in a moment.' });
        save(true);
      });
      return;
    } else {
      s[group][name] = v;
    }
    if (group === 'audio') audio.setVolumes(s.audio);
    if (group === 'controls') { input.setSettings(s.controls); ui.relabel(); }
    if (key === 'display.fillScreen') renderer.setFillScreen(v);
    save();
  };
  screen = settingsScreen(menuCtx, { rows, onChange: apply, onBack: () => { ui.close(screen); onClose?.(); } });
  ui.push(screen);
  return screen;
}
