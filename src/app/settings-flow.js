// The settings screen's rows and what each change does (ARCHITECTURE §8 accessibility toggles,
// §13.2 display modes). Changes apply at once and are saved a moment later.
//
// 0.9.0 (W7): every row says what it does (V4: "what is Stretch to fill?"), the rows come in
// groups, and there are new ones: Text size, High-contrast warnings, Brightness, Music, Sea and
// wind (W6), Level-ups with a full build, and Controls, which opens the remap screen.

import { settingsScreen, controlsScreen } from '../ui/menus.js';
import { settingRefusal } from './runlogic.js';
import { BRIGHTNESS } from '../render/brightness.js';
import { REMAPPABLE, ACTION_NAMES, normalizeBindings, rebind, rebindRefusal, savedBindings, dashOnConfirm, setDashOnConfirm, buttonsText } from '../input/bindings.js';

const pct = (v) => `${Math.round(v * 100)}%`;

/** What each row does, shown under the list while it has focus (docs/WRITING.md: plain sentences). */
export const SETTING_DESCS = Object.freeze({
  'display.mode': 'Fullscreen covers the screen. Borderless is a window the size of the screen. Windowed is a normal window.',
  'display.fillScreen': 'Off keeps the picture sharp at whole steps, with black bars where it doesn\'t fit. On stretches it to fill the screen, a little blurry.',
  'access.brightness': 'How bright the ground is in runs and the harbor at night.',
  'access.textScale': 'The size of the words in menus and over the harbor.',
  'access.highContrast': 'Warnings for attacks are drawn brighter, with a light outline.',
  'access.damageNumbers': 'Numbers over enemies when you hit them.',
  'access.flashReduction': 'Keeps the big flashes (a boss dying, Lantern Night) dim.',
  'audio.master': 'Every sound in the game.',
  'audio.music': 'The music in the harbor and in runs.',
  'audio.ambience': 'The sea and the wind under the music.',
  'audio.sfx': 'Weapons, hits, pickups, and the menus.',
  'controls.open': 'Change which button or key does what, for the controller and the keyboard.',
  'controls.prompts': 'Which buttons the prompts show. Auto follows the controller or keyboard you used last.',
  'controls.deadzone': 'How far the stick moves before you do. Raise it if you drift with the stick let go.',
  'controls.rumble': 'The controller shakes for a few things on the map, such as a lamp lit or a Reliquary dropping.',
  'controls.rumbleStrength': 'How hard the controller shakes.',
  'play.fullBuild': 'Once every slot is full and every passive is at its top level, a level-up offers only weapon levels. Pick for me takes the best one (the highest rarity, on the weapon that shares the most tags with your build) and says so, without stopping the run.',
  'hud.minimap': 'Nearby shows the ground round you. Whole map shows all of it. Off hides it.',
  'hud.minimapSize': 'How big the minimap is in the top right.',
  'hud.arrows': 'Arrows at the screen\'s edge point to lamps, bells, the Ferryman, and drops out of sight.',
});

/**
 * @param {object} o
 * @param {object} o.settings the live settings object (changed in place)
 * @param {boolean} o.desktop whether display modes can be changed (the .exe)
 * @param {()=>boolean} o.atTitleOrHarbor true at the title or in the harbor, settled there (borderless
 *   can be switched only there: the switch reloads the page, which a run can't survive)
 * @param {(go: ()=>void)=>Promise<boolean>} [o.reopen] leave the page for a new window: calls go once
 *   progress is safe (app/keeper.js), resolves to whether it did
 */
export function openSettings({ ui, menuCtx, settings, desktop, native, atTitleOrHarbor, reopen = null, input, audio, renderer, save, rumble = null, onClose }) {
  const s = settings;
  const rows = [];
  const slider = (key, label, value) => ({ key, label, kind: 'slider', value, min: 0, max: 1, step: 0.1, format: pct });
  if (desktop) {
    rows.push({ key: 'display.mode', label: 'Display', kind: 'choice', value: s.display.mode, choices: [['fullscreen', 'Fullscreen'], ['borderless', 'Borderless'], ['windowed', 'Windowed']], group: 'Display' });
  }
  rows.push(
    { key: 'display.fillScreen', label: 'Stretch to fill', kind: 'toggle', value: s.display.fillScreen, group: desktop ? null : 'Display' },
    // W6's Brightness (0.9.0): the run's ground and the harbor's night.
    { key: BRIGHTNESS.key, label: 'Brightness', kind: 'slider', value: s.access.brightness, min: BRIGHTNESS.min, max: BRIGHTNESS.max, step: BRIGHTNESS.step, format: pct },
    { key: 'access.textScale', label: 'Text size', kind: 'choice', value: s.access.textScale, choices: [[1, '100%'], [1.25, '125%'], [1.5, '150%']] },
    { key: 'access.highContrast', label: 'High-contrast warnings', kind: 'toggle', value: s.access.highContrast },
    { key: 'access.damageNumbers', label: 'Damage numbers', kind: 'toggle', value: s.access.damageNumbers },
    { key: 'access.flashReduction', label: 'Reduce flashing', kind: 'toggle', value: s.access.flashReduction },
    { ...slider('audio.master', 'Master volume', s.audio.master), group: 'Sound' },
    slider('audio.music', 'Music', s.audio.music),
    slider('audio.ambience', 'Sea and wind', s.audio.ambience),
    slider('audio.sfx', 'Sound effects', s.audio.sfx),
    { key: 'controls.open', label: 'Controls', kind: 'open', value: 'Change buttons', run: () => openControls(), group: 'Controls' },
    { key: 'controls.prompts', label: 'Button prompts', kind: 'choice', value: s.controls.prompts, choices: [['auto', 'Auto'], ['playstation', 'PlayStation'], ['xbox', 'Xbox'], ['keyboard', 'Keyboard']] },
    { key: 'controls.deadzone', label: 'Stick deadzone', kind: 'slider', value: s.controls.deadzone, min: 0, max: 0.6, step: 0.05, format: pct },
    // Rumble (0.8.2): the controller shakes for a few things on the map; never the screen.
    { key: 'controls.rumble', label: 'Rumble', kind: 'toggle', value: s.controls.rumble },
    slider('controls.rumbleStrength', 'Rumble strength', s.controls.rumbleStrength),
    { key: 'play.fullBuild', label: 'When the build is full', kind: 'choice', value: s.play.fullBuild, choices: [['choose', 'Let me choose'], ['auto', 'Pick for me']], group: 'Runs' },
    { key: 'hud.minimap', label: 'Minimap', kind: 'choice', value: s.hud.minimap, choices: [['nearby', 'Nearby'], ['map', 'Whole map'], ['off', 'Off']] },
    { key: 'hud.minimapSize', label: 'Minimap size', kind: 'choice', value: s.hud.minimapSize, choices: [['small', 'Small'], ['large', 'Large']] },
    // The arrows at the screen's edge to lamps, bells, the Ferryman, and drops (0.8.2).
    { key: 'hud.arrows', label: 'Edge arrows', kind: 'toggle', value: s.hud.arrows },
  );
  for (const r of rows) r.desc = SETTING_DESCS[r.key] ?? '';
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
    if (key === 'access.textScale') ui.setTextScale?.(v);
    // Turned on, or its strength changed: one shake, so the player feels what it is now.
    if (s.controls.rumble && (key === 'controls.rumble' || key === 'controls.rumbleStrength')) rumble?.play('vault');
    save();
  };

  /** Settings, Controls: the remap screen (input/bindings.js does the rules). */
  function openControls() {
    let waiting = null;
    let why = null;   // why the last change was refused (the sweep, S3b F10), shown under the list
    const current = () => normalizeBindings({ keys: s.controls.keys, pad: s.controls.pad });
    const style = () => (input.controllerType === 'playstation' || s.controls.prompts === 'playstation' ? 'playstation' : 'xbox');
    const store = (b) => {
      s.controls.keys = savedBindings(b, 'keys');
      s.controls.pad = savedBindings(b, 'pad');
      input.setSettings(s.controls);
      ui.relabel();
      save();
    };
    const view = () => {
      const b = current();
      return {
        rows: REMAPPABLE.map((a) => ({ action: a, label: ACTION_NAMES[a], pad: buttonsText(b, 'pad', a, style()), keys: buttonsText(b, 'keys', a, 'keyboard') })),
        dashPad: dashOnConfirm(b, 'pad'), dashKeys: dashOnConfirm(b, 'keys'), waiting, why,
      };
    };
    const c = controlsScreen(menuCtx, {
      view,
      padName: style() === 'playstation' ? 'PlayStation' : 'Xbox',
      onRebind: (action, device) => {
        if (waiting) return;
        waiting = { action, device };
        why = null;
        c.refresh();
        input.captureNext(device, (code) => {
          waiting = null;
          // The press that was heard mustn't also act on the screen as it's let go.
          input.releaseAll();
          why = code !== null ? rebindRefusal(current(), device, action, code) : null;
          if (code !== null && !why) { store(rebind(current(), device, action, code)); menuCtx.sound?.('ui_confirm'); } else menuCtx.sound?.('ui_back');
          c.refresh();
        });
      },
      onDashOnConfirm: (device, on) => { store(setDashOnConfirm(current(), device, on)); menuCtx.sound?.('ui_move'); c.refresh(); },
      onReset: () => { s.controls.keys = {}; s.controls.pad = {}; input.setSettings(s.controls); ui.relabel(); save(); c.refresh(); },
      onBack: () => { input.cancelCapture?.(); ui.close(c); },
    });
    ui.push(c);
    return c;
  }

  screen = settingsScreen(menuCtx, { rows, onChange: apply, onBack: () => { ui.close(screen); onClose?.(); } });
  screen.openControls = openControls;
  ui.push(screen);
  return screen;
}
